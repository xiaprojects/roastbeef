/**
 * This file is part of RB.
 *
 * Copyright (C) 2026 XIAPROJECTS SRL
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
 * 07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
 * 08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
 *
 * Settings addon: forms for the JSON files under settings/ the HMI loads on boot.
 *
 *   aircraft.json  the aircraft profile (serviceaircraft.js -> window.aircraftData):
 *                  registration and pilot, the pilot's display units with their
 *                  conversion factors (js/global.js), and the GPS speed gauge
 *                  (SixPackInstruments.js).
 *   ems.json       the engine gauges, {widgets: [...]}, drawn by plates/ems.html
 *                  on the EMS page and in the sidebar (main.js loads it into
 *                  MainCtrl's $scope.EMS).
 *   navigation.json the plate order the knob rotates through, one list per
 *                  display shape (services/servicekeypad.js).
 *   keypad.json    key names -> knob functions, and direct keys -> plates
 *                  (services/servicekeypad.js).
 *   Autopilot_HomeWaypoint  not a file: the Bring Me Home target in stratux.conf,
 *                  read from /getSettings and written with /setSettings
 *                  (plates/js/autopilot.js reads it on entry).
 *
 * Sections that are not files but stratux.conf, read from /getSettings and
 * written with /setSettings; only the keys that changed are posted, coerced to
 * the types managementinterface.go asserts (a wrong type panics the request):
 *   Autopilot      Autopilot_HomeWaypoint, the Bring Me Home target
 *                  (plates/js/autopilot.js reads it on entry).
 *   AHRS           IMUMapping, which axis of the IMU chip points to the nose
 *                  ([forward, 0], forward = +-1 X, +-2 Y, +-3 Z, see
 *                  makeOrientationQuaternion in main/sensors.go; the daemon
 *                  re-levels the AHRS when it changes), the G meter limits and
 *                  the pressure altitude offset.
 *   Receiver       ownship Mode S codes, watch list, PPM, dump1090 gain, the
 *                  bearingless target circle, the traffic source in the
 *                  callsign, and the serial outputs (one post per port).
 *   Hardware       the receivers, sensors and features the daemon runs.
 *
 * The speed gauge and every EMS widget share the same shape (label, unit,
 * min/max, scale sweep in degrees, coloured arcs), so one editor serves both;
 * the EMS-only fields are the sensor key (`source`), where the gauge is shown
 * (`displayInSidebar`) and the tick-label decimals/multiplier (`ceil`/`scale`).
 *
 * Each file is read with GET /settings/<name>.json and written back with
 * POST /settings/<name>.json (managementinterface.go). Runtime fields the
 * plates keep in the same objects (speed, raw, speedDegree, speedTicks) are
 * carried through untouched so a save round-trips the file.
 *
 * Test with:
 * curl "http://localhost/settings/aircraft.json"
 * curl "http://localhost/settings/ems.json" -X POST -d @web/settings/ems.json
 * curl "http://localhost/setSettings" -X POST -d '{"Autopilot_HomeWaypoint":{"Lat":41.95,"Lon":12.5,"Ele":0,"Cmt":"Home"}}'
 * curl "http://localhost/setSettings" -X POST -d '{"IMUMapping":[2,0]}'
 * curl "http://localhost/setSettings" -X POST -d '{"PPM":0,"WatchList":"LIRU LIRA"}'
 *
*/

angular.module('appControllers').controller('SettingsCtrl', SettingsCtrl);

var URL_AIRCRAFT_SETTINGS = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/aircraft.json";
var URL_EMS_SETTINGS = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/ems.json";
var URL_NAVIGATION_SETTINGS = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/navigation.json";
var URL_KEYPAD_SETTINGS = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/keypad.json";
// URL_SETTINGS_GET / URL_SETTINGS_SET come from js/global.js

// How /setSettings type-asserts each stratux.conf key (handleSettingsSetRequest
// in managementinterface.go): a wrong type panics the request, so every value
// is coerced before it is posted. Keys not listed are posted as they are.
var SETTINGS_CONF_TYPES = {
    bool: [
        "EstimateBearinglessDist", "DisplayTrafficSource",
        "GPS_Enabled", "UAT_Enabled", "ES_Enabled", "OGN_Enabled", "AIS_Enabled", "APRS_Enabled",
        "IMU_Sensor_Enabled", "BMP_Sensor_Enabled", "MS4525DO_Enabled", "Ping_Enabled", "Pong_Enabled", "OGNI2CTXEnabled",
        "Camera_Enabled", "Audio_Enabled", "Autopilot_Enabled", "AutopilotUdp_Enabled",
        "Keypad_Enabled", "Radio_Enabled", "EMS_Enabled", "SwitchBoard_Enabled"
    ],
    int: ["PPM", "AltitudeOffset", "PWMDutyMin", "AutopilotUdp_Port"],
    float: ["Dump1090Gain"],
    string: ["OwnshipModeS", "WatchList", "GLimits"]
};

function SettingsCtrl($rootScope, $scope, $state, $http, $interval, $q) {

    const name = "settings";
    const controllerName = String(name).charAt(0).toLocaleUpperCase() + String(name).slice(1) + "Ctrl";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
    };

    console.log("Controller " + name);

    // One section per file: $scope[section] is the object being edited (null
    // until loaded) and state[section] tracks it against the last copy known
    // to match the file, to flag pending edits.
    $scope.tabs = [
        { id: "aircraft", label: "Aircraft" },
        { id: "ems", label: "EMS" },
        { id: "autopilot", label: "Autopilot" },
        { id: "ahrs", label: "AHRS" },
        { id: "receiver", label: "Receiver" },
        { id: "hardware", label: "Hardware" },
        { id: "navigation", label: "Navigation" },
        { id: "keypad", label: "Keypad" }
    ];
    $scope.section = "aircraft";
    $scope.state = {};
    $scope.tabs.forEach(function (tab) {
        $scope[tab.id] = null;
        $scope.state[tab.id] = { saved: null, saveStatus: "", saveError: "", loadError: "" };
    });
    // The last stratux.conf from /getSettings, for the fields that depend on
    // another setting (the altitude offset only applies with a baro sensor).
    $scope.conf = {};
    // The gauge in the editor: the speed gauge, or the selected EMS widget.
    $scope.gauge = null;
    $scope.selectedWidget = 0;
    // Editor choices bound from inside ng-if blocks, kept in an object so the
    // child scopes write through to this one.
    $scope.edit = {
        showJson: false,
        navigationList: "navigationSort",
        navigationAdd: "",
        directKeyMap: "directKey",
        directKeyAdd: { key: "", href: "" }
    };

    // Display unit choices: picking one fills in the conversion factors the
    // HMI applies to km/h, meters and °C (see pilotDisplayed* in js/global.js).
    $scope.unitPresets = {
        speed: [
            { label: "KMH", multiply: 1, sum: 0 },
            { label: "KT", multiply: 0.539957, sum: 0 },
            { label: "MPH", multiply: 0.621371, sum: 0 }
        ],
        altimeter: [
            { label: "feet", multiply: 3.28084, sum: 0 },
            { label: "meters", multiply: 1, sum: 0 }
        ],
        temperatures: [
            { label: "°C", multiply: 1, sum: 0 },
            { label: "°F", multiply: 1.8, sum: 32 }
        ]
    };
    const unitConversionKey = {
        speed: "speedConversionFromKmh",
        altimeter: "altimeterConversionFromMeters",
        temperatures: "temperatureConversionFromC"
    };

    // The sensor keys the daemon publishes on /ems (main/ems.go), lower case as
    // the stream has them; a file may name others, they are added on load.
    $scope.emsSources = [
        "enginerpm", "manifoldpressure", "oiltemperature", "oilpressure", "coolanttemperature",
        "outsidetemperature", "fuelpressure", "fuel1", "fuel2", "fuel", "fuelremaining",
        "batteryvoltage", "alternatorout", "amps",
        "cht1", "cht2", "cht3", "cht4", "egt1", "egt2", "egt3", "egt4"
    ];
    $scope.placements = [
        { value: true, label: "Sidebar" },
        { value: false, label: "EMS page" }
    ];

    // A gauge with one white arc over the whole sweep, to start from.
    function defaultGauge(label, unit, min, max, startDegree, endDegree) {
        return {
            "startSpeedDegree": startDegree, "endSpeedDegree": endDegree, "label": label, "unit": unit,
            "speed": 0, "minSpeed": min, "maxSpeed": max, "backgroundColor": "#000000", "speedDegree": "45deg",
            "arcs": [
                { "color": "#ffffff", "sizeDegree": (endDegree - startDegree) + "deg", "startDegree": startDegree + "deg", "threshold": min, "backgroundColor": "#333333" }
            ],
            "speedTicks": []
        };
    }

    // Fill in whatever a hand-edited file may lack so every ng-model has a
    // home, and make sure the current unit labels are selectable even when
    // they are not one of the presets.
    function normalizeAircraft(db) {
        if (db.units === undefined || db.units === null) {
            db.units = {};
        }
        Object.keys(unitConversionKey).forEach(function (kind) {
            const key = unitConversionKey[kind];
            if (db.units[key] === undefined || db.units[key] === null) {
                db.units[key] = { multiply: 1, sum: 0 };
            }
            if (db.units[kind] === undefined || db.units[kind] === null) {
                db.units[kind] = $scope.unitPresets[kind][0].label;
            }
            const known = $scope.unitPresets[kind].some(function (u) { return u.label == db.units[kind]; });
            if (!known) {
                $scope.unitPresets[kind].push({
                    label: db.units[kind],
                    multiply: db.units[key].multiply,
                    sum: db.units[key].sum
                });
            }
        });
        if (db.GPSGroundSpeed === undefined || db.GPSGroundSpeed === null) {
            db.GPSGroundSpeed = defaultGauge("GPS SPEED", db.units.speed, 0, 330, 0, 330);
            db.GPSGroundSpeed.raw = -1;
            db.GPSGroundSpeed.sensorType = "GPSGroundSpeed";
        }
        if (!Array.isArray(db.GPSGroundSpeed.arcs)) {
            db.GPSGroundSpeed.arcs = [];
        }
        return db;
    }

    function normalizeEms(db) {
        if (!Array.isArray(db.widgets)) {
            db.widgets = [];
        }
        db.widgets.forEach(function (widget) {
            if (!Array.isArray(widget.arcs)) {
                widget.arcs = [];
            }
            if (widget.displayInSidebar !== true) {
                widget.displayInSidebar = false;
            }
            if (widget.ceil === undefined || widget.ceil === null) {
                widget.ceil = 0;
            }
            if (widget.scale === undefined || widget.scale === null) {
                widget.scale = 1;
            }
            if (widget.source === undefined || widget.source === null) {
                widget.source = $scope.emsSources[0];
            }
            if ($scope.emsSources.indexOf(widget.source) < 0) {
                $scope.emsSources.push(widget.source);
            }
        });
        return db;
    }

    // Other plates read the aircraft profile from here on controller entry.
    function applyAircraftLive(db) {
        window.aircraftData = db;
    }

    // The EMS page and sidebar draw MainCtrl's $scope.EMS, which main.js filled
    // from ems.json on boot: refresh it the same way so the change shows
    // without a reload.
    function applyEmsLive(db) {
        var owner = $scope.$parent;
        while (owner && !Object.prototype.hasOwnProperty.call(owner, "EMS")) {
            owner = owner.$parent;
        }
        if (!owner || typeof createProgressiveTicksForRoundInstrument !== "function") {
            return;
        }
        var widgets = angular.copy(db.widgets);
        widgets.forEach(function (widget) {
            widget.speedTicks = createProgressiveTicksForRoundInstrument(widget.maxSpeed, widget.minSpeed,
                widget.endSpeedDegree, widget.startSpeedDegree, 9, widget.ceil, widget.scale);
            widget.arcs.forEach(function (arc) {
                arc.activeColor = arc.color;
            });
        });
        owner.EMS = widgets;
    }

    // Every plate the router knows, addons included, for the navigation and
    // direct key pickers; hashes a file names that are not routed are added on
    // load so the selects still show them.
    $scope.plates = $state.get().filter(function (s) {
        return s.name && s.url;
    }).map(function (s) {
        return { hash: "#" + s.url, name: s.name };
    }).sort(function (a, b) {
        return a.name == "home" ? -1 : b.name == "home" ? 1 : a.name.localeCompare(b.name);
    });

    function knownPlate(hash) {
        if (typeof hash !== "string" || hash.length == 0) {
            return;
        }
        if (!$scope.plates.some(function (p) { return p.hash == hash; })) {
            $scope.plates.push({ hash: hash, name: hash });
        }
    }

    $scope.plateName = function (hash) {
        const plate = $scope.plates.find(function (p) { return p.hash == hash; });
        return plate ? plate.name : hash;
    };

    // ---- stratux.conf sections: a section is a list of keys picked out of
    // /getSettings; Save posts the ones that changed, coerced to the type the
    // daemon asserts, and takes the daemon's answer (the full settings) as the
    // new truth, so what it normalized (upper-cased codes, ...) shows at once.
    function confType(key) {
        var found = "raw";
        Object.keys(SETTINGS_CONF_TYPES).forEach(function (type) {
            if (SETTINGS_CONF_TYPES[type].indexOf(key) >= 0) {
                found = type;
            }
        });
        return found;
    }

    function coerce(key, value) {
        switch (confType(key)) {
            case "bool":
                return value === true;
            case "int":
                return Math.round(Number(value)) || 0;
            case "float":
                return Number(value) || 0;
            case "string":
                return (value === undefined || value === null) ? "" : String(value);
            default:
                return value;
        }
    }

    // keys   what to read out of /getSettings and post back
    // opts   normalize(obj, db)        after the keys are copied in
    //        serialize(body, obj)      last word on what is posted
    //        skip                      keys the form edits but never posts alone
    //        extraPosts(obj, saved)    bodies to post before the main one
    //        validate(obj)             why Save is blocked, or ""
    function confSection(keys, opts) {
        opts = opts || {};
        return {
            getUrl: URL_SETTINGS_GET, postUrl: URL_SETTINGS_SET, name: "stratux.conf",
            conf: true, keys: keys,
            normalize: function (db) {
                var obj = {};
                keys.forEach(function (key) {
                    obj[key] = coerce(key, angular.copy(db[key]));
                });
                if (opts.normalize) {
                    opts.normalize(obj, db);
                }
                return obj;
            },
            serialize: function (obj, saved) {
                var body = {};
                keys.forEach(function (key) {
                    if (opts.skip && opts.skip.indexOf(key) >= 0) {
                        return;
                    }
                    if (saved === null || saved === undefined || !angular.equals(obj[key], saved[key])) {
                        body[key] = coerce(key, obj[key]);
                    }
                });
                if (opts.serialize) {
                    opts.serialize(body, obj);
                }
                return angular.toJson(body);
            },
            extraPosts: opts.extraPosts,
            // An input whose value fails its type or its min/max leaves the
            // model undefined (Angular's validators): posting that would write
            // a coerced 0, so block Save until the field reads back a number.
            validate: function (obj) {
                var bad = "";
                keys.forEach(function (key) {
                    const type = confType(key);
                    if (!bad && (type == "int" || type == "float") && !isFinite(obj[key])) {
                        bad = key;
                    }
                });
                if (bad !== "") {
                    return bad + ": not a number, or outside the allowed range.";
                }
                return opts.validate ? opts.validate(obj) : "";
            },
            applyLive: function () { }
        };
    }

    // ---- Autopilot: the home waypoint out of the daemon settings
    function normalizeAutopilot(db) {
        const home = db.Autopilot_HomeWaypoint || {};
        return {
            Autopilot_HomeWaypoint: {
                Lat: Number(home.Lat) || 0,
                Lon: Number(home.Lon) || 0,
                Ele: Math.round(Number(home.Ele) || 0),
                Cmt: typeof home.Cmt === "string" ? home.Cmt : "Home"
            }
        };
    }

    // /setSettings asserts the four fields and their types without checking
    // (managementinterface.go), so never post an empty input through.
    function serializeAutopilot(obj) {
        const home = obj.Autopilot_HomeWaypoint;
        return angular.toJson({
            Autopilot_HomeWaypoint: {
                Lat: Number(home.Lat) || 0,
                Lon: Number(home.Lon) || 0,
                Ele: Math.round(Number(home.Ele) || 0),
                Cmt: (home.Cmt || "Home").toString()
            }
        });
    }

    $scope.hasGpsFix = function () {
        return window.situation !== undefined && window.situation.GPSFixQuality > 0;
    };

    $scope.useCurrentPosition = function () {
        if (!$scope.hasGpsFix() || $scope.autopilot === null) {
            return;
        }
        const home = $scope.autopilot.Autopilot_HomeWaypoint;
        home.Lat = Number(window.situation.GPSLatitude.toFixed(6));
        home.Lon = Number(window.situation.GPSLongitude.toFixed(6));
        home.Ele = Math.round(window.situation.GPSAltitudeMSL * 3.28084);
    };

    // ---- AHRS: the sensor board's forward axis (IMUMapping[0], see
    // makeOrientationQuaternion in main/sensors.go: +-1 X, +-2 Y, +-3 Z).
    $scope.imuAxes = [
        { value: -1, label: "-X toward nose (Stratux default)" },
        { value: 1, label: "+X toward nose" },
        { value: 2, label: "+Y toward nose (RY836AI)" },
        { value: -2, label: "-Y toward nose" },
        { value: 3, label: "+Z toward nose" },
        { value: -3, label: "-Z toward nose" }
    ];

    // Two numbers separated by a space, as the web UI's gLimitsInput validates.
    const RE_GLIMITS = /^([-+]?[0-9]*\.?[0-9]+( [-+]?[0-9]*\.?[0-9]+)*|)$/;

    const ahrsSection = confSection(["IMUMapping", "GLimits", "AltitudeOffset"], {
        normalize: function (obj) {
            var forward = Array.isArray(obj.IMUMapping) ? parseInt(obj.IMUMapping[0]) : 0;
            if (isNaN(forward) || forward == 0 || forward < -3 || forward > 3) {
                forward = -1; // what the daemon assumes when unset
            }
            obj.IMUMapping = [forward, 0];
        },
        validate: function (obj) {
            if (!RE_GLIMITS.test(obj.GLimits)) {
                return "G limits: numbers separated by a space, e.g. -1.76 4.4";
            }
            return "";
        }
    });

    // ---- Receiver: ownship, traffic and the serial outputs
    $scope.dump1090Gains = [0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4,
        28.0, 29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48.0, 49.6];
    $scope.serialBauds = [1200, 4800, 9600, 19200, 38400, 57200, 115200];
    $scope.serialCapabilities = [
        { value: 0, label: "Disabled" },
        { value: 1, label: "GDL90" },
        { value: 2, label: "AHRS FFSIM" },
        { value: 4, label: "AHRS GDL90" },
        { value: 8, label: "FLARM NMEA (default)" },
        { value: 16, label: "FFSIM" }
    ];

    const RE_HEX_CODES = /^$|^([0-9A-Fa-f]{6},?)*$/;
    const RE_WATCHLIST = /^([A-Za-z0-9]{4}( [A-Za-z0-9]{4})*|)$/;

    const receiverSection = confSection([
        "OwnshipModeS", "WatchList", "PPM", "Dump1090Gain", "EstimateBearinglessDist", "DisplayTrafficSource",
        "SerialOutputs"
    ], {
        skip: ["SerialOutputs"],
        normalize: function (obj, db) {
            // The daemon keeps the outputs in a map keyed by device; edit them
            // as a list, in a stable order so a save can diff them.
            obj.SerialOutputs = [];
            if (db.SerialOutputs !== undefined && db.SerialOutputs !== null) {
                Object.keys(db.SerialOutputs).sort().forEach(function (dev) {
                    const out = db.SerialOutputs[dev];
                    obj.SerialOutputs.push({
                        DeviceString: out.DeviceString || dev,
                        Baud: Number(out.Baud) || 38400,
                        Capability: Number(out.Capability) || 0
                    });
                });
            }
            obj.OwnshipModeS = obj.OwnshipModeS.toUpperCase();
            obj.WatchList = obj.WatchList.toUpperCase();
            if ($scope.dump1090Gains.indexOf(obj.Dump1090Gain) < 0) {
                $scope.dump1090Gains.push(obj.Dump1090Gain);
                $scope.dump1090Gains.sort(function (a, b) { return a - b; });
            }
        },
        serialize: function (body) {
            // The daemon upper-cases these itself; do it here too so the value
            // that was compared against the file is the value that was posted.
            if (body.OwnshipModeS !== undefined) {
                body.OwnshipModeS = body.OwnshipModeS.toUpperCase();
            }
            if (body.WatchList !== undefined) {
                body.WatchList = body.WatchList.toUpperCase();
            }
        },
        // /setSettings takes one serial port per request, as "SerialOutput";
        // only the ports the daemon listed are ever posted (posting an unknown
        // device panics the handler on a daemon with no serial outputs).
        extraPosts: function (obj, saved) {
            var posts = [];
            obj.SerialOutputs.forEach(function (out, index) {
                const before = (saved && saved.SerialOutputs) ? saved.SerialOutputs[index] : null;
                if (before === null || before === undefined || !angular.equals(out, before)) {
                    posts.push(angular.toJson({ SerialOutput: {
                        DeviceString: out.DeviceString,
                        Baud: Number(out.Baud),
                        Capability: Number(out.Capability)
                    } }));
                }
            });
            return posts;
        },
        validate: function (obj) {
            if (!RE_HEX_CODES.test(obj.OwnshipModeS)) {
                return "Ownship codes: 6 hex digits each, comma separated.";
            }
            if (!RE_WATCHLIST.test(obj.WatchList)) {
                return "Watch list: 4 character identifiers separated by spaces.";
            }
            return "";
        }
    });

    // ---- Hardware: the receivers, sensors and features the daemon runs
    const hardwareSection = confSection([
        "GPS_Enabled", "UAT_Enabled", "ES_Enabled", "OGN_Enabled", "AIS_Enabled", "APRS_Enabled",
        "IMU_Sensor_Enabled", "BMP_Sensor_Enabled", "MS4525DO_Enabled", "PWMDutyMin", "Ping_Enabled", "Pong_Enabled",
        "OGNI2CTXEnabled", "Camera_Enabled", "Audio_Enabled", "Autopilot_Enabled", "AutopilotUdp_Enabled",
        "AutopilotUdp_Port", "Keypad_Enabled", "Radio_Enabled", "EMS_Enabled", "SwitchBoard_Enabled"
    ], {
        validate: function (obj) {
            if (obj.PWMDutyMin < 0 || obj.PWMDutyMin > 100) {
                return "Minimum fan duty cycle: 0 to 100 %.";
            }
            if (obj.AutopilotUdp_Port < 1 || obj.AutopilotUdp_Port > 65535) {
                return "Autopilot UDP port: 1 to 65535.";
            }
            return "";
        }
    });

    // ---- Navigation: one plate list per display shape
    $scope.displayShape = typeof whichKeywordIsForThisDisplay === "function" ? whichKeywordIsForThisDisplay() : "";
    $scope.navigationLists = [
        { key: "navigationSort", label: "Default" },
        { key: "navigationSortSquare", label: "Square" },
        { key: "navigationSortLandscape", label: "Landscape" },
        { key: "navigationSortPortrait", label: "Portrait" }
    ];
    function normalizeNavigation(db) {
        $scope.navigationLists.forEach(function (list) {
            if (db[list.key] === undefined || db[list.key] === null) {
                db[list.key] = [];
            }
            if (Array.isArray(db[list.key])) {
                db[list.key].forEach(knownPlate);
            }
        });
        // Open on the list this display actually uses
        if ($scope.displayShape && Array.isArray(db["navigationSort" + $scope.displayShape])) {
            $scope.edit.navigationList = "navigationSort" + $scope.displayShape;
        }
        return db;
    }

    $scope.navigationEntries = function () {
        if ($scope.navigation === null) {
            return null;
        }
        const list = $scope.navigation[$scope.edit.navigationList];
        return Array.isArray(list) ? list : null;
    };

    $scope.navigationListLabel = function () {
        const list = $scope.navigationLists.find(function (l) { return l.key == $scope.edit.navigationList; });
        return (list ? list.label : $scope.edit.navigationList) + (list && list.label == $scope.displayShape ? " (this display)" : "");
    };

    $scope.addNavigation = function () {
        const entries = $scope.navigationEntries();
        if (entries === null || !$scope.edit.navigationAdd) {
            return;
        }
        entries.push($scope.edit.navigationAdd);
    };

    $scope.moveNavigation = function (index, delta) {
        const entries = $scope.navigationEntries();
        const to = index + delta;
        if (entries === null || to < 0 || to >= entries.length) {
            return;
        }
        entries[index] = entries.splice(to, 1, entries[index])[0];
    };

    $scope.removeNavigation = function (index) {
        const entries = $scope.navigationEntries();
        if (entries !== null) {
            entries.splice(index, 1);
        }
    };

    // The knob service keeps the list for this display on MainCtrl.
    function applyNavigationLive(db) {
        var owner = $scope.$parent;
        while (owner && !Object.prototype.hasOwnProperty.call(owner, "keypadSettingsNavigation")) {
            owner = owner.$parent;
        }
        if (!owner) {
            return;
        }
        const list = db["navigationSort" + $scope.displayShape];
        owner.keypadSettingsNavigation = Array.isArray(list) ? list : db.navigationSort;
    }

    // ---- Keypad: key names to functions, and direct keys to plates
    $scope.keypadFunctions = [
        { key: "KEYPAD_MAPPING_PREV", label: "Previous", hint: "knob left, to the plate" },
        { key: "KEYPAD_MAPPING_TAP", label: "Tap", hint: "knob press, to the plate" },
        { key: "KEYPAD_MAPPING_NEXT", label: "Next", hint: "knob right, to the plate" },
        { key: "SwipeLeft", label: "Swipe Left", hint: "previous plate in the list" },
        { key: "SwipeRight", label: "Swipe Right", hint: "next plate in the list" }
    ];
    $scope.keypadText = {};
    $scope.directKeyMaps = [
        { key: "directKey", label: "Default" },
        { key: "directKeySquare", label: "Square" },
        { key: "directKeyLandscape", label: "Landscape" },
        { key: "directKeyPortrait", label: "Portrait" }
    ];
    function normalizeKeypad(db) {
        if (db.keypad === undefined || db.keypad === null) {
            db.keypad = {};
        }
        $scope.keypadFunctions.forEach(function (fn) {
            if (!Array.isArray(db.keypad[fn.key])) {
                db.keypad[fn.key] = [];
            }
            $scope.keypadText[fn.key] = db.keypad[fn.key].join(", ");
        });
        if (db.keypad.directKey === undefined || db.keypad.directKey === null) {
            db.keypad.directKey = {};
        }
        $scope.directKeyMaps.forEach(function (map) {
            const entries = db.keypad[map.key];
            if (entries !== undefined && entries !== null) {
                Object.keys(entries).forEach(function (key) {
                    knownPlate(entries[key] ? entries[key].href : undefined);
                });
            }
        });
        // Runtime cache the knob service adds to its copy; never in the file.
        delete db.keypad.cacheFunctions;
        return db;
    }

    // The text inputs hold the comma separated lists; the arrays are the model.
    $scope.parseKeypadText = function (fn) {
        $scope.keypad.keypad[fn] = ($scope.keypadText[fn] || "").split(",").map(function (k) {
            return k.trim();
        }).filter(function (k) {
            return k.length > 0;
        });
    };

    $scope.directKeyEntries = function () {
        if ($scope.keypad === null) {
            return null;
        }
        const entries = $scope.keypad.keypad[$scope.edit.directKeyMap];
        return (entries !== undefined && entries !== null && typeof entries === "object") ? entries : null;
    };

    $scope.directKeyEntriesCount = function () {
        const entries = $scope.directKeyEntries();
        return entries === null ? 0 : Object.keys(entries).length;
    };

    $scope.directKeyMapLabel = function () {
        const map = $scope.directKeyMaps.find(function (m) { return m.key == $scope.edit.directKeyMap; });
        return "Direct keys: " + (map ? map.label : $scope.edit.directKeyMap) + (map && map.label == $scope.displayShape ? " (this display)" : "");
    };

    $scope.addDirectKey = function () {
        const key = ($scope.edit.directKeyAdd.key || "").trim();
        if (key.length == 0 || !$scope.edit.directKeyAdd.href || $scope.keypad === null) {
            return;
        }
        if ($scope.directKeyEntries() === null) {
            $scope.keypad.keypad[$scope.edit.directKeyMap] = {};
        }
        $scope.keypad.keypad[$scope.edit.directKeyMap][key] = { href: $scope.edit.directKeyAdd.href };
        $scope.edit.directKeyAdd.key = "";
    };

    $scope.removeDirectKey = function (key) {
        const entries = $scope.directKeyEntries();
        if (entries !== null) {
            delete entries[key];
        }
    };

    // The knob service reads its mappings from MainCtrl; a fresh copy drops
    // its cached key->function table so it is rebuilt from the new lists.
    function applyKeypadLive(db) {
        var owner = $scope.$parent;
        while (owner && !Object.prototype.hasOwnProperty.call(owner, "keypadSettings")) {
            owner = owner.$parent;
        }
        if (owner) {
            owner.keypadSettings = angular.copy(db.keypad);
        }
    }

    const files = {
        aircraft: { getUrl: URL_AIRCRAFT_SETTINGS, postUrl: URL_AIRCRAFT_SETTINGS, name: "aircraft.json",
            normalize: normalizeAircraft, serialize: angular.toJson, applyLive: applyAircraftLive },
        ems: { getUrl: URL_EMS_SETTINGS, postUrl: URL_EMS_SETTINGS, name: "ems.json",
            normalize: normalizeEms, serialize: angular.toJson, applyLive: applyEmsLive },
        autopilot: { getUrl: URL_SETTINGS_GET, postUrl: URL_SETTINGS_SET, name: "stratux.conf", conf: true,
            keys: ["Autopilot_HomeWaypoint"], normalize: normalizeAutopilot, serialize: serializeAutopilot,
            applyLive: function () { },
            validate: function (obj) {
                const home = obj.Autopilot_HomeWaypoint;
                if (home.Lat === null || home.Lon === null || !isFinite(home.Lat) || !isFinite(home.Lon)) {
                    return "Latitude and longitude are required.";
                }
                if (!isFinite(home.Ele)) {
                    return "Elevation: not a number.";
                }
                return "";
            } },
        ahrs: ahrsSection,
        receiver: receiverSection,
        hardware: hardwareSection,
        navigation: { getUrl: URL_NAVIGATION_SETTINGS, postUrl: URL_NAVIGATION_SETTINGS, name: "navigation.json",
            normalize: normalizeNavigation, serialize: angular.toJson, applyLive: applyNavigationLive },
        keypad: { getUrl: URL_KEYPAD_SETTINGS, postUrl: URL_KEYPAD_SETTINGS, name: "keypad.json",
            normalize: normalizeKeypad, serialize: angular.toJson, applyLive: applyKeypadLive }
    };

    $scope.file = function () {
        return $scope[$scope.section];
    };

    $scope.fileName = function () {
        return files[$scope.section].name;
    };

    // What Save would post, for the preview.
    $scope.filePreview = function () {
        const file = $scope.file();
        return file === null ? null :
            angular.fromJson(files[$scope.section].serialize(file, $scope.state[$scope.section].saved));
    };

    // Point the editor at the section's gauge, keeping the EMS selection valid.
    function refreshGauge() {
        if ($scope.section == "aircraft") {
            $scope.gauge = $scope.aircraft ? $scope.aircraft.GPSGroundSpeed : null;
            return;
        }
        if ($scope.section != "ems") {
            $scope.gauge = null;
            return;
        }
        const widgets = $scope.ems ? $scope.ems.widgets : [];
        if ($scope.selectedWidget >= widgets.length) {
            $scope.selectedWidget = widgets.length - 1;
        }
        if ($scope.selectedWidget < 0) {
            $scope.selectedWidget = 0;
        }
        $scope.gauge = widgets.length > 0 ? widgets[$scope.selectedWidget] : null;
    }

    $scope.setSection = function (section) {
        $scope.section = section;
        $scope.edit.showJson = false;
        refreshGauge();
    };

    // Why the current section cannot be saved as it stands, or "".
    $scope.saveBlocked = function () {
        const file = files[$scope.section];
        const obj = $scope[$scope.section];
        if (obj === null || !file.validate) {
            return "";
        }
        return file.validate(obj) || "";
    };

    $scope.selectWidget = function (index) {
        $scope.selectedWidget = index;
        refreshGauge();
    };

    $scope.addWidget = function () {
        const widget = defaultGauge("NEW", "", 0, 100, 225, 495);
        widget.ceil = 0;
        widget.scale = 1;
        widget.displayInSidebar = false;
        widget.source = $scope.emsSources[0];
        $scope.ems.widgets.push(widget);
        $scope.selectWidget($scope.ems.widgets.length - 1);
    };

    $scope.duplicateWidget = function () {
        if ($scope.gauge === null) {
            return;
        }
        $scope.ems.widgets.splice($scope.selectedWidget + 1, 0, angular.copy($scope.gauge));
        $scope.selectWidget($scope.selectedWidget + 1);
    };

    $scope.removeWidget = function () {
        if ($scope.gauge === null) {
            return;
        }
        $scope.ems.widgets.splice($scope.selectedWidget, 1);
        refreshGauge();
    };

    $scope.moveWidget = function (delta) {
        const widgets = $scope.ems.widgets;
        const to = $scope.selectedWidget + delta;
        if (to < 0 || to >= widgets.length) {
            return;
        }
        widgets[$scope.selectedWidget] = widgets.splice(to, 1, widgets[$scope.selectedWidget])[0];
        $scope.selectWidget(to);
    };

    $scope.applyUnitPreset = function (kind) {
        const label = $scope.aircraft.units[kind];
        const preset = $scope.unitPresets[kind].find(function (u) { return u.label == label; });
        if (preset === undefined) {
            return;
        }
        $scope.aircraft.units[unitConversionKey[kind]] = { multiply: preset.multiply, sum: preset.sum };
    };

    // Arc angles are stored as CSS rotations ("45deg"); expose them to the
    // number inputs as plain degrees (ng-model-options getterSetter).
    $scope.degreeField = function (arc, key) {
        return function (value) {
            if (arguments.length > 0) {
                arc[key] = ((value === null || value === undefined || isNaN(value)) ? 0 : Math.round(value)) + "deg";
                return;
            }
            const degrees = parseInt(arc[key]);
            return isNaN(degrees) ? 0 : degrees;
        };
    };

    $scope.addArc = function () {
        const arcs = $scope.gauge.arcs;
        var start = $scope.gauge.startSpeedDegree || 0;
        var threshold = $scope.gauge.minSpeed || 0;
        if (arcs.length > 0) {
            const last = arcs[arcs.length - 1];
            start = (parseInt(last.startDegree) || 0) + (parseInt(last.sizeDegree) || 0);
            threshold = last.threshold;
        }
        arcs.push({
            "color": "#ffffff",
            "sizeDegree": "30deg",
            "startDegree": start + "deg",
            "threshold": threshold,
            "backgroundColor": "#333333"
        });
    };

    $scope.removeArc = function (index) {
        $scope.gauge.arcs.splice(index, 1);
    };

    // Take a freshly loaded (or just saved) document as the section's truth.
    function applyLoaded(section, db) {
        const file = files[section];
        const state = $scope.state[section];
        if (file.conf) {
            $scope.conf = db;
        }
        $scope[section] = file.normalize(db);
        state.saved = angular.copy($scope[section]);
        state.saveStatus = "";
        state.loadError = "";
        refreshGauge();
    }

    function loadFailed(section, message) {
        $scope[section] = null;
        $scope.state[section].loadError = message;
        refreshGauge();
    }

    // Fetch one URL and hand the document to every section that reads it, so
    // the stratux.conf sections share a single /getSettings.
    function fetch(url, sections) {
        // Bypass the static server's max-age so a fresh save is visible.
        return $http.get(url, { params: { "_": Date.now() } }).then(function (response) {
            var db = angular.fromJson(response.data);
            sections.forEach(function (section) {
                if (db === undefined || db === null || Object.keys(db).length == 0) {
                    loadFailed(section, files[section].name + " is empty");
                } else {
                    applyLoaded(section, angular.copy(db));
                }
            });
        }, function (response) {
            sections.forEach(function (section) {
                loadFailed(section, "Cannot load " + files[section].name + " (HTTP " + response.status + ")");
            });
        });
    }

    $scope.reload = function (section) {
        const state = $scope.state[section];
        state.loadError = "";
        state.saveError = "";
        fetch(files[section].getUrl, [section]);
    };

    function reloadAll() {
        var byUrl = {};
        Object.keys(files).forEach(function (section) {
            const url = files[section].getUrl;
            byUrl[url] = (byUrl[url] || []).concat([section]);
        });
        Object.keys(byUrl).forEach(function (url) {
            fetch(url, byUrl[url]);
        });
    }

    $scope.save = function (section) {
        const file = files[section];
        const state = $scope.state[section];
        state.saveStatus = "saving";
        state.saveError = "";
        // angular.toJson drops the $$hashKey ng-repeat adds to the arrays.
        const body = file.serialize($scope[section], state.saved);
        const extras = file.extraPosts ? file.extraPosts($scope[section], state.saved) : [];
        if (file.conf && extras.length == 0 && body == "{}") {
            state.saveStatus = "saved"; // nothing changed: no need to write settings
            return;
        }
        var chain = $q.when();
        extras.forEach(function (extra) {
            chain = chain.then(function () { return $http.post(file.postUrl, extra); });
        });
        chain.then(function () {
            return $http.post(file.postUrl, body);
        }).then(function (response) {
            const data = angular.fromJson(response.data);
            if (file.conf && data && typeof data === "object" &&
                    file.keys.some(function (key) { return key in data; })) {
                // /setSettings answers with the settings as the daemon holds
                // them now: take that, so what it normalized shows at once.
                applyLoaded(section, data);
            } else {
                if (file.conf) {
                    // Show what was actually posted, not what was typed.
                    angular.extend($scope[section], angular.fromJson(body));
                }
                state.saved = angular.copy($scope[section]);
            }
            state.saveStatus = "saved";
            file.applyLive(angular.fromJson(body));
        }, function (response) {
            state.saveStatus = "error";
            state.saveError = "Save failed (HTTP " + response.status + ")";
        });
    };

    Object.keys(files).forEach(function (section) {
        $scope.$watch(section, function (current) {
            const state = $scope.state[section];
            if (current === null || state.saved === null || state.saveStatus == "saving") {
                return;
            }
            if (!angular.equals(current, state.saved)) {
                state.saveStatus = "modified";
            } else if (state.saveStatus == "modified") {
                state.saveStatus = "";
            }
        }, true);
    });

    reloadAll();
};
