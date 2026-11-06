/**
 * This file is part of RB.
 *
 * Copyright (C) 2024 XIAPROJECTS SRL
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.

 * This source is part of the project RB:
 * 01 -> Display with Synthetic vision, Autopilot and ADSB
 * 02 -> Display with SixPack
 * 03 -> Display with Autopilot, ADSB, Radio, Flight Computer
 * 04 -> Display with EMS: Engine monitoring system
 * 05 -> Display with Stratux BLE Traffic
 * 06 -> Display with Android 6.25" 7" 8" 10" 10.2"
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
 */
/*
    servicedaemon.js: the daemon's REST interface, in the browser.

    What the plates read and write, kept in memory: a pilot can tune the radio,
    run a timer, tick a checklist or load a route, and it all reads back until
    the page is reloaded. Only what the HMI really calls is here, see the handlers
    of the same name in main/managementinterface.go.

    Not simulated: the autopilot takes a route but never flies it, so /autopilot
    stays silent, and no alert is ever raised.
*/

// No addon: the bundled ones drive hardware, or save to the aircraft
const DAEMON_ADDONS = [];

// What a real RB-01 sends, for the keys the plates read. Radar: 40 NM, no altitude filter.
var daemonSettings = {
    "RadarLimits": 50000,
    "RadarRange": 40,
    "Charts_Enabled": false,
    "Cameras": [],
    "Switches": []
};

var daemonRadios = [{
    "Driver": "SIMULATOR", "Name": "SIM", "Path": "", "Enabled": true, "Dual": true,
    "FrequencyActive": "118.000", "LabelActive": "", "FrequencyStandby": "121.500", "LabelStandby": "",
    "SquelchLevel": 0, "VolumeLevel": 0
}];

var daemonTimers = [
    { "CountDown": 1200, "Epoch": 0, "Fired": false, "Status": false },
    { "CountDown": 0, "Epoch": 0, "Fired": false, "Status": false }
];

var daemonWaypoints = [];

function daemonChecklistGroup(id, name, items) {
    return {
        "id": id, "name": name, "text": "DOLIST", "value": "todo", "date": "", "dateParsed": "__:__", "isselected": "",
        "items": items.map((item, index) => ({
            "id": index, "name": item[0], "text": item[1], "value": "todo", "date": "", "dateParsed": "__:__",
            "isselected": (id == 0 && index == 0) ? "keypadSelectedYes" : ""
        }))
    };
}

var daemonChecklist = [
    daemonChecklistGroup(0, "BEFORE START", [["BELTS", "FASTENED"], ["HEADSET", "ON"], ["FUEL", "BOTH ON"]]),
    daemonChecklistGroup(1, "BEFORE TAKEOFF", [["MASTER", "ON"], ["FLAPS", "SET"], ["TRIM", "SET"]]),
    daemonChecklistGroup(2, "AFTER LANDING", [["FLAPS", "UP"], ["TRANSPONDER", "STANDBY"]])
];

// The body of a write, or {} for one without a body
function daemonBody(body) {
    try {
        return JSON.parse(body) || {};
    } catch (error) {
        return {};
    }
}

function daemonRadarUpdate() {
    loopbackPush("/radar", JSON.stringify(daemonSettings));
}

// path -> method -> handler(body), whose return value is the JSON answer
const DAEMON_REST = {
    "/getSettings": { GET: () => daemonSettings },
    "/setSettings": {
        POST: (body) => {
            const changes = daemonBody(body);
            Object.assign(daemonSettings, changes);
            if ("RadarLimits" in changes || "RadarRange" in changes) {
                daemonRadarUpdate();
            }
            return daemonSettings;
        }
    },
    "/addons": { GET: () => DAEMON_ADDONS },
    "/getAlerts": { GET: () => [] },
    "/resources": { GET: () => [] },
    "/playback": { GET: () => [] },
    "/updates/available": { GET: () => [] },
    "/tiles/tilesets": { GET: () => ({}) },
    "/radio": { GET: () => daemonRadios },
    "/timers": {
        GET: () => daemonTimers,
        PUT: () => {
            daemonTimers.push({ "CountDown": 0, "Epoch": 0, "Fired": false, "Status": false });
            return daemonTimers;
        },
        POST: (body) => {
            const changes = daemonBody(body);
            Object.keys(changes).forEach(id => {
                if (id < daemonTimers.length) {
                    const timer = changes[id];
                    daemonTimers[id] = { "CountDown": timer.CountDown, "Epoch": timer.Epoch, "Fired": timer.Fired, "Status": timer.Status };
                }
            });
            return {};
        }
    },
    "/autopilot": {
        GET: () => daemonWaypoints,
        POST: (body) => {
            const waypoints = daemonBody(body);
            daemonWaypoints = Array.isArray(waypoints) ? waypoints : [];
            return [];
        }
    },
    "/checklist/default/status": {
        GET: () => daemonChecklist,
        POST: (body) => {
            const checklist = daemonBody(body);
            if (Array.isArray(checklist)) {
                daemonChecklist = checklist;
            }
            return {};
        }
    }
};

// The same, for paths ending in an index or a name
const DAEMON_REST_PREFIXES = {
    "/charts/view/": { GET: () => ({}) },
    "/radio/": {
        POST: (body, path) => {
            const index = parseInt(path.substring(path.lastIndexOf("/") + 1));
            if (index < daemonRadios.length) {
                Object.assign(daemonRadios[index], daemonBody(body));
            }
            loopbackPush("/radioStatus", JSON.stringify(daemonRadios));
            return daemonRadios;
        }
    },
    "/timers/": {
        DELETE: (body, path) => {
            const index = parseInt(path.substring(path.lastIndexOf("/") + 1));
            if (index < daemonTimers.length) {
                daemonTimers.splice(index, 1);
            }
            return daemonTimers;
        }
    }
};

/**
 * daemonRoute: the daemon's answer to a request
 * @param {*} method - GET, POST, PUT, DELETE
 * @param {*} path - absolute path on this site, null for another site
 * @returns the function giving the answer from the body of the request; null for a
 * request that is not for the daemon. A write it does not handle only has to succeed.
 */
function daemonRoute(method, path) {
    if (path === null || path.startsWith("/settings/")) {
        return null;
    }
    method = method.toUpperCase();
    var handlers = DAEMON_REST[path];
    if (handlers === undefined) {
        const prefix = Object.keys(DAEMON_REST_PREFIXES).find(item => path.startsWith(item));
        if (prefix !== undefined) {
            handlers = DAEMON_REST_PREFIXES[prefix];
        }
    }
    if (handlers !== undefined && handlers[method] !== undefined) {
        return (body) => handlers[method](body, path);
    }
    // Plates, scripts and styles are all GET
    if (method != "GET") {
        return () => ({});
    }
    return null;
}

// handleRadarWS: the radar learns its range and altitude filter on connect
function daemonSocketOpened(path) {
    if (path == "/radar") {
        daemonRadarUpdate();
    }
}
