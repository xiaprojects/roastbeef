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

    The addons' bridge (/bridge/float) is the daemon's: a write is merged into
    one map, and the whole map goes to /bridge/float/ws when anything changed.
    servicevorreceiver.js is the receiver on the other side of it.

    Not simulated: the autopilot takes a route but never flies it, so /autopilot
    stays silent, and no alert is ever raised.
*/

// The VOR addon (servicevorreceiver.js answers it) and the performance one (pure JS on
// the situation and the simulated engine). The other bundled ones drive hardware
// (magnetometer) or save to the aircraft (settings).
const DAEMON_ADDONS = [
    { "controller": "VorCtrl", "hash": "/addons/vor", "html": "addons/vor.html", "js": "addons/js/vor.js", "name": "vor" },
    { "controller": "PerformanceCtrl", "hash": "/addons/performance", "html": "addons/performance.html", "js": "addons/js/performance.js", "name": "performance" }
];

// What a real RB-01 sends, for the keys the plates read. Radar: 40 NM, no altitude filter.
var daemonSettings = {
    "RadarLimits": 50000,
    "RadarRange": 40,
    "Charts_Enabled": false,
    "Cameras": [],
    // SW_TYPE_CMD (2): a shell command on the aircraft, here one that always succeeds
    "Switches": [
        { "Name": "LANDING LIGHT", "Type": 2, "Status": 0, "Uri": "true", "UriStatus": "", "EpochStart": 0, "EpochFinish": 0 },
        { "Name": "STROBES", "Type": 2, "Status": 0, "Uri": "true", "UriStatus": "", "EpochStart": 0, "EpochFinish": 0 },
        { "Name": "PITOT HEAT", "Type": 2, "Status": 0, "Uri": "true", "UriStatus": "", "EpochStart": 0, "EpochFinish": 0 }
    ]
};

// main/switchboard.go
const DAEMON_SW_TYPE_CMD = 2;
const DAEMON_SW_STATUS_RUNNING = 1;
const DAEMON_SW_STATUS_FINISH_0 = 2;
const DAEMON_SW_COMMAND_S = 2;  // how long a forked command runs

// The addons' bridge: name -> float
var daemonBridge = {};

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

// setFloats (main/bridge.go): merge, and send the whole map if anything changed.
// The daemon decodes a map[string]float32: anything but numbers is refused whole.
function daemonBridgeSet(values) {
    if (values === null || typeof values != "object" || Array.isArray(values)) {
        return;
    }
    const keys = Object.keys(values);
    if (keys.some(key => values[key] !== null && typeof values[key] != "number")) {
        return;
    }
    var changed = false;
    keys.forEach(key => {
        const value = values[key] === null ? 0 : Math.fround(values[key]);
        if (daemonBridge[key] !== value) {
            daemonBridge[key] = value;
            changed = true;
        }
    });
    if (changed) {
        loopbackPush("/bridge/float/ws", JSON.stringify(daemonBridge));
    }
}

// A seconds-since-epoch clock, as the switchboard's Epoch fields are
function daemonEpoch() {
    return Math.floor(Date.now() / 1000);
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
    "/bridge/float": {
        GET: () => daemonBridge,
        POST: (body) => {
            const values = daemonBody(body);
            daemonBridgeSet(values);
            // The receivers are clients of the bridge: they hear the write
            if (typeof simulatorVor !== "undefined") {
                simulatorVor.command(values);
            }
            return {};
        }
    },
    // handleSwitchBoardPut: run a command now, and answer how it went
    "/switches": {
        PUT: (body) => {
            const command = daemonBody(body);
            const epoch = daemonEpoch();
            return Object.assign(command, { "Status": DAEMON_SW_STATUS_FINISH_0, "EpochStart": epoch, "EpochFinish": epoch });
        }
    },
    "/timers": {
        GET: () => daemonTimers,
        PUT: () => {
            daemonTimers.push({ "CountDown": 0, "Epoch": 0, "Fired": false, "Status": false });
            daemonTimersChanged();
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
            daemonTimersChanged();
            return {};
        }
    },
    "/autopilot": {
        GET: () => daemonWaypoints,
        POST: (body) => {
            const waypoints = daemonBody(body);
            daemonWaypoints = Array.isArray(waypoints) ? waypoints : [];
            return [];
        },
        DELETE: () => {
            daemonWaypoints = [];
            return {};
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
    // handleSwitchBoardPost: fork a saved command; it finishes a little later
    "/switches/": {
        POST: (body, path) => {
            const index = parseInt(path.substring(path.lastIndexOf("/") + 1));
            const item = daemonSettings.Switches[index];
            if (item === undefined || item.Type != DAEMON_SW_TYPE_CMD) {
                return {};
            }
            const started = Object.assign({}, item, { "Status": DAEMON_SW_STATUS_RUNNING, "EpochStart": daemonEpoch(), "EpochFinish": daemonEpoch() });
            daemonSettings.Switches[index] = started;
            setTimeout(() => {
                if (daemonSettings.Switches[index] === started) {
                    daemonSettings.Switches[index] = Object.assign({}, started, { "Status": DAEMON_SW_STATUS_FINISH_0, "EpochFinish": daemonEpoch() });
                }
            }, DAEMON_SW_COMMAND_S * 1000);
            return started;
        }
    },
    "/timers/": {
        DELETE: (body, path) => {
            const index = parseInt(path.substring(path.lastIndexOf("/") + 1));
            if (index < daemonTimers.length) {
                daemonTimers.splice(index, 1);
                daemonTimersChanged();
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

// handleTimersWS: the list on every change, as /timers answers it
function daemonTimersChanged() {
    loopbackPush("/timers/ws", JSON.stringify(daemonTimers));
}

// handleRadarWS: the radar learns its range and altitude filter on connect
function daemonSocketOpened(path) {
    if (path == "/radar") {
        daemonRadarUpdate();
    }
    // As the daemon, the list on connect: the same answer as its REST path
    if (path == "/alerts/ws") {
        loopbackPush(path, JSON.stringify(DAEMON_REST["/getAlerts"].GET()));
    }
    if (path == "/timers/ws") {
        daemonTimersChanged();
    }
    if (path == "/playback/ws") {
        loopbackPush(path, JSON.stringify(DAEMON_REST["/playback"].GET()));
    }
}
