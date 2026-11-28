/**
 * This file is part of RB.
 *
 * Copyright (C) 2023 XIAPROJECTS SRL
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
 * Top and bottom bars, docs/tech-debt/top-bottom-bars.md
 * - TopBarCtrl: the status values the pilot reads, plates/sidetop.html; the slots that
 *   do not fit are dropped in TOP_BAR_DROP_ORDER, the slots of TOP_BAR_SLOTS_HIDDEN (or
 *   localStorage.topBarSlotsHidden) are left out: "Changing the top bar" in
 *   docs/tech-debt/top-bottom-bars.md
 * - BottomBarCtrl: draws the soft keys of main.js, plates/sidebottom.html, and the
 *   readings under their labels: QNH, ETA to the active waypoint, the first running timer,
 *   the CPU load and the battery voltage
 * Both are created and destroyed by the ng-if of their bar in index.html
*/
angular.module('appControllers').controller('TopBarCtrl', TopBarCtrl);
angular.module('appControllers').controller('BottomBarCtrl', BottomBarCtrl);

// A value with no data, or whose source has stopped: never X and never an old number
const BAR_NO_DATA = "---";
// The situation values go to BAR_NO_DATA when no SituationUpdated has come for this long
const TOP_BAR_STALE_SECONDS = 3;
// TRAFFIC counts the targets heard in this window
const TOP_BAR_TRAFFIC_SECONDS = 60;
// OIL, AGL and AP go to BAR_NO_DATA when their stream has been quiet for this long:
// EMS frames come at least every ~2.3 s, the status and the autopilot every 1 s
const TOP_BAR_STREAM_STALE_SECONDS = 5;
// When the bar is too narrow the slots are dropped in this order; the others never are
const TOP_BAR_DROP_ORDER = ["voice", "utc", "gmax", "uptime", "track", "stby", "traffic", "agl", "outsideTemperature", "oil", "ap"];
// The slots (data-slot of plates/sidetop.html) the bar leaves out. WIND took the first place
// from the speed on 2026-11-23; the speed slot is kept for the units with no airspeed sensor,
// where the wind needs a heading to be estimated at all: take "speed" out of this list, or
// set localStorage.topBarSlotsHidden on the unit, to show it again
const TOP_BAR_SLOTS_HIDDEN = ["speed"];

/**
 * topBarSlotsHidden: the slots the bar leaves out on this unit
 * @returns localStorage.topBarSlotsHidden when it is a JSON list of slot names ('[]' shows
 *          every slot), TOP_BAR_SLOTS_HIDDEN otherwise. Read when the bar is created: hide
 *          and show the bar, or reload, after changing it
 */
function topBarSlotsHidden() {
    try {
        const stored = JSON.parse(localStorage.getItem("topBarSlotsHidden"));
        if (Array.isArray(stored) && stored.every(function (slot) { return typeof slot === "string"; })) {
            return stored;
        }
    } catch (e) {
        // Not JSON, or no storage in this browser: the default
    }
    return TOP_BAR_SLOTS_HIDDEN;
}

/**
 * barNumber: a value as the bar shows it
 * @param {*} raw - The number from the situation, anything else is no data
 * @param {*} decimals - Digits after the point
 * @param {*} convert - Optional, to the pilot's unit
 * @returns The text, BAR_NO_DATA if raw is not a number
 */
function barNumber(raw, decimals, convert) {
    if (typeof raw !== "number" || !isFinite(raw)) {
        return BAR_NO_DATA;
    }
    return (convert !== undefined ? convert(raw) : raw).toFixed(decimals);
}

// The daemon uptime, Uptime of the status in milliseconds, as H:MM
function barUptime(raw) {
    if (typeof raw !== "number" || !isFinite(raw) || raw < 0) {
        return BAR_NO_DATA;
    }
    const minutes = Math.floor(raw / 60000);
    return Math.floor(minutes / 60) + ":" + ("0" + (minutes % 60)).slice(-2);
}

// A track in three digits, 000 to 359
function barTrack(raw) {
    if (typeof raw !== "number" || !isFinite(raw)) {
        return BAR_NO_DATA;
    }
    const degrees = ((Math.round(raw) % 360) + 360) % 360;
    return ("00" + degrees).slice(-3) + "°";
}

/**
 * barWind: the wind of windestimator.js as the bar shows it, METAR style
 * @param {*} situation - WindValid, WindDirection (FROM, true), WindSpeed (kt)
 * @returns "270°/15": the direction in three digits, 360 for north (000 is calm), then the
 *          speed in the pilot's unit; BAR_NO_DATA with no estimate
 */
function barWind(situation) {
    if (situation.WindValid !== true || typeof situation.WindSpeed !== "number" || !isFinite(situation.WindSpeed)
        || typeof situation.WindDirection !== "number" || !isFinite(situation.WindDirection)) {
        return BAR_NO_DATA;
    }
    const degrees = ((Math.round(situation.WindDirection) % 360) + 360) % 360;
    return ("00" + (degrees === 0 ? 360 : degrees)).slice(-3) + "°/"
        + Math.round(pilotDisplayedSpeedFromKT(situation.WindSpeed));
}

// WIND and the unit; EST when the ground speed stood in for a missing airspeed (WindSource
// "gs"), as the attitude plate marks it
function barWindLabel(source) {
    return "WIND " + (source === "gs" ? "EST " : "") + barSpeedUnit();
}

// The speed unit the pilot picked in aircraft.json
function barSpeedUnit() {
    return window.aircraftData?.units?.speed ?? "KMH";
}

// The altitude unit the pilot picked in aircraft.json: feet or meters, as the conversion
function barAltitudeUnit() {
    const unit = String(window.aircraftData?.units?.altimeter ?? "meters").toLowerCase();
    return unit.startsWith("f") ? "ft" : "m";
}

// VOICE: rbvoice has no event for the end of its spoken answer, so ANSW lasts as long as
// the reply takes to say at this pace, between the two limits
const TOP_BAR_VOICE_CHARS_PER_SECOND = 14;
const TOP_BAR_VOICE_ANSWER_MIN_SECONDS = 2;
const TOP_BAR_VOICE_ANSWER_MAX_SECONDS = 20;
// A SPEAKING 1 whose SPEAKING 0 never came stops counting after this long
const TOP_BAR_VOICE_SPEAKING_MAX_SECONDS = 30;
// A THINKING 1 whose answer never came stops counting after this long (rbvoice waits rb-llm 30 s at most)
const TOP_BAR_VOICE_THINKING_MAX_SECONDS = 35;

/**
 * barVoice: the state of the voice recognition (rbvoice) as the bar shows it
 * @param {*} voice - wakeWord and trigger: the bridge keys voice_wakeword and voice_trigger,
 *                    undefined until rbvoice publishes them; speakingUntil, thinkingUntil and answerUntil:
 *                    Date.now() limits
 * @param {*} now - Date.now()
 * @returns ANSW while the reply is spoken, SPEAK while the pilot speaks, THINK while rb-llm prepares
 *          an answer (rbvoice keeps listening meanwhile, so SPEAK wins), LISTNG while rbvoice
 *          listens (wake word on, or after a push to talk), MNUAL when it waits for a push to talk,
 *          BAR_NO_DATA before rbvoice has published its keys
 */
function barVoice(voice, now) {
    if (now < voice.answerUntil) {
        return "ANSW";
    }
    if (now < voice.speakingUntil) {
        return "SPEAK";
    }
    if (now < voice.thinkingUntil) {
        return "THINK";
    }
    if (voice.trigger === true || voice.wakeWord === true) {
        return "LISTNG";
    }
    return voice.wakeWord === false ? "MNUAL" : BAR_NO_DATA;
}

// An altitude in feet, as the daemon gives it, in the pilot's unit
function barAltitudeFromFeet(raw) {
    return barNumber(raw, 0, function (feet) {
        return pilotDisplayedAltitudeFromMeters(feet / 3.28084);
    });
}

function TopBarCtrl($scope, $interval, $http) {
    var trafficHeard = {}; // Icao_addr to the Date.now() it was last heard
    var alertsList = $scope.alertsList; // The last list of AlertsService, undefined until the first
    // rbvoice: the bridge keys and how long the pilot's speech and the spoken reply last, barVoice()
    const voice = { wakeWord: undefined, trigger: undefined, speakingUntil: 0, thinkingUntil: 0, answerUntil: 0 };
    // Date.now() of the last frame of each stream, and the slots that go to BAR_NO_DATA when it stops
    const streams = {
        situation: { time: 0, seconds: TOP_BAR_STALE_SECONDS, slots: ["wind", "speed", "track", "gmax", "alt"] },
        ems: { time: 0, seconds: TOP_BAR_STREAM_STALE_SECONDS, slots: ["oil"] },
        status: { time: 0, seconds: TOP_BAR_STREAM_STALE_SECONDS, slots: ["agl", "uptime"] },
        autopilot: { time: 0, seconds: TOP_BAR_STREAM_STALE_SECONDS, slots: ["ap"] }
    };

    $scope.values = {
        wind: BAR_NO_DATA, speed: BAR_NO_DATA, track: BAR_NO_DATA, uptime: BAR_NO_DATA, gmax: BAR_NO_DATA, alt: BAR_NO_DATA,
        agl: BAR_NO_DATA, ap: BAR_NO_DATA, com: BAR_NO_DATA, stby: BAR_NO_DATA, oil: BAR_NO_DATA,
        outsideTemperature: BAR_NO_DATA, voice: BAR_NO_DATA,
        utc: "", traffic: "0"
    };
    $scope.altitudeUnit = barAltitudeUnit();
    $scope.temperatureUnit = pilotTemperatureUnit();
    // IAS when the airspeed board reports one, GPS ground speed otherwise: servicesituation.js
    $scope.speedLabel = "GS " + barSpeedUnit();
    $scope.windLabel = barWindLabel("");
    // The slots left out on this unit, fixed for the life of the bar
    const slotsHidden = topBarSlotsHidden();
    $scope.slotShown = function (slot) {
        return slotsHidden.indexOf(slot) < 0;
    };

    // Outside a digest only this bar is checked, inside one the running digest takes the change
    function redraw() {
        if (!$scope.$root.$$phase) {
            $scope.$digest();
        }
    }

    // The altimeter: the pressure altitude on the QNH in use, as the altimeter plate has it
    function barAltitude(situation) {
        // Only a current barometer (servicesituation.js BaroValid): a stopped one or
        // the ADS-B estimate reads --- rather than a frozen or borrowed altitude
        if (situation.BaroValid !== true || typeof situation.QNH !== "number") {
            return BAR_NO_DATA;
        }
        return barAltitudeFromFeet(situation.BaroPressureAltitude + 27 * (situation.QNH - 1013.25));
    }

    // COM and STBY: the selection of the first active radio, --- when none is active
    function showRadio(radios) {
        const radio = (Array.isArray(radios) ? radios.find(r => r && r.Enabled) : null) || {};
        $scope.values.com = radio.FrequencyActive || BAR_NO_DATA;
        $scope.values.stby = radio.FrequencyStandby || BAR_NO_DATA;
    }

    function showTraffic() {
        const since = Date.now() - TOP_BAR_TRAFFIC_SECONDS * 1000;
        Object.keys(trafficHeard).forEach(function (key) {
            if (trafficHeard[key] < since) {
                delete trafficHeard[key];
            }
        });
        $scope.values.traffic = String(Object.keys(trafficHeard).length);
    }

    // The rbvoice keys of the addons bridge (rbvoice bridge.py); false when the frame has neither
    function voiceBridge(bridge) {
        var found = false;
        if (typeof bridge.voice_wakeword === "number") {
            voice.wakeWord = bridge.voice_wakeword >= 0.5;
            found = true;
        }
        if (typeof bridge.voice_trigger === "number") {
            voice.trigger = bridge.voice_trigger >= 0.5;
            found = true;
        }
        $scope.values.voice = barVoice(voice, Date.now());
        return found;
    }

    // What each event changes; every one then redraws the bar
    const listeners = {
        SituationUpdated: function (situation) {
            streams.situation.time = Date.now();
            $scope.values.wind = barWind(situation);
            $scope.windLabel = barWindLabel(situation.WindSource);
            $scope.values.speed = barNumber(situation.SpeedKt, 0, pilotDisplayedSpeedFromKT);
            $scope.values.track = barTrack(situation.GPSTrueCourse);
            $scope.values.gmax = barNumber(situation.AHRSGLoadMax, 1);
            $scope.values.alt = barAltitude(situation);
            $scope.speedLabel = (situation.SpeedSource || "GS") + " " + barSpeedUnit();
            $scope.altitudeUnit = barAltitudeUnit();
        },
        RadarChanged: function (target) {
            trafficHeard[target.Icao_addr] = Date.now();
            showTraffic();
        },
        AlertsUpdated: function (list) {
            alertsList = list;
        },
        RadioUpdated: showRadio,
        // The bridge carries every addon: only a frame with the rbvoice keys redraws the bar
        BridgeUpdated: voiceBridge,
        // rbvoice through the keypad socket: SPEAKING 1 and 0 around the pilot's speech, then
        // VOICE with the reply ("out", empty when rbvoice does not answer). With rb-llm, THINKING 1
        // after the question and THINKING 0 before its VOICE, or when push to talk cancels it
        voice: function (event) {
            const now = Date.now();
            if (event.key === "SPEAKING") {
                voice.speakingUntil = event.status === 1 ? now + TOP_BAR_VOICE_SPEAKING_MAX_SECONDS * 1000 : 0;
                if (event.status === 1) {
                    voice.answerUntil = 0;
                }
            } else if (event.key === "THINKING") {
                voice.speakingUntil = 0;
                voice.thinkingUntil = event.status === 1 ? now + TOP_BAR_VOICE_THINKING_MAX_SECONDS * 1000 : 0;
            } else if (event.key === "VOICE") {
                // A new utterance cancels a pending question without THINKING 0: any reply ends it
                voice.speakingUntil = 0;
                voice.thinkingUntil = 0;
                const seconds = String(event.out || "").length / TOP_BAR_VOICE_CHARS_PER_SECOND;
                voice.answerUntil = event.out ? now + 1000 * Math.min(TOP_BAR_VOICE_ANSWER_MAX_SECONDS,
                    Math.max(TOP_BAR_VOICE_ANSWER_MIN_SECONDS, seconds)) : 0;
            }
            $scope.values.voice = barVoice(voice, now);
        },
        // EMS frames are partial: the oil temperature is kept while any frame keeps coming
        EMSUpdated: function (ems) {
            streams.ems.time = Date.now();
            if (typeof ems.oiltemperature === "number") {
                $scope.values.oil = barNumber(ems.oiltemperature, 0, pilotDisplayedTemperaturesFromCelsius);
            }
            if (typeof ems.outsidetemperature === "number") {
                $scope.values.outsideTemperature = barNumber(ems.outsidetemperature, 0, pilotDisplayedTemperaturesFromCelsius);
            }
            $scope.temperatureUnit = pilotTemperatureUnit();
        },
        // AGL from main/terrain.go: only with the terrain alerts on and a fix over the grid
        StatusUpdated: function (status) {
            streams.status.time = Date.now();
            $scope.values.uptime = barUptime(status.Uptime);
            $scope.values.agl = status.Terrain_AglValid === true ? barAltitudeFromFeet(status.Terrain_AglFt) : BAR_NO_DATA;
        },
        // The bearing the autopilot steers to and the side; OFF when not engaged
        AutopilotUpdated: function (autopilot) {
            streams.autopilot.time = Date.now();
            const gprmb = autopilot.GPRMB || {};
            $scope.values.ap = autopilot.Active !== true ? "OFF"
                : barTrack(gprmb.TrueBearing) + ({ R: " \u25BA", L: " \u25C4" }[gprmb.Steer] || "");
        }
    };
    const handlers = {};
    Object.keys(listeners).forEach(function (name) {
        handlers[name] = function (event) {
            if (listeners[name](event.detail || {}) !== false) {
                redraw();
            }
        };
        addEventListener(name, handlers[name]);
    });

    // Drops the slots of TOP_BAR_DROP_ORDER, first to last, until the bar is one row that fits.
    // TopBarCtrl shares its element with ng-include, which leaves the controller a comment node:
    // the bar is found in the document
    function fitSlots() {
        const status = document.querySelector(".rb-bar-top .rb-status");
        if (status === null) {
            return;
        }
        const dropped = status.querySelectorAll(".rb-slot-dropped");
        for (var index = 0; index < dropped.length; index++) {
            dropped[index].classList.remove("rb-slot-dropped");
        }
        for (index = 0; index < TOP_BAR_DROP_ORDER.length && status.scrollWidth > status.clientWidth; index++) {
            const slot = status.querySelector(".rb-slot[data-slot='" + TOP_BAR_DROP_ORDER[index] + "']");
            if (slot !== null) {
                slot.classList.add("rb-slot-dropped");
            }
        }
    }

    // Every second: the clock, the targets no longer heard, the streams that have stopped,
    // and what fits now that the values may have changed length
    function tick() {
        const now = Date.now();
        $scope.values.utc = new Date(now).toISOString().substring(11, 16);
        showTraffic();
        $scope.values.voice = barVoice(voice, now);
        angular.forEach(streams, function (stream) {
            if (now - stream.time > stream.seconds * 1000) {
                stream.slots.forEach(function (slot) {
                    $scope.values[slot] = BAR_NO_DATA;
                });
            }
        });
        redraw();
        fitSlots();
    }

    // Every alert of the list, active or not: the alerts page shows them all
    $scope.alertsCount = function () {
        return Array.isArray(alertsList) ? String(alertsList.length) : BAR_NO_DATA;
    };

    // The severity of the worst alert not yet seen on the alerts page, as the balloon has it,
    // "" when the pilot has seen them all
    $scope.alertsLamp = function () {
        var worst = -1;
        (Array.isArray(alertsList) ? alertsList : []).forEach(function (alert) {
            if ($scope.alertUnseen === undefined || !$scope.alertUnseen(alert)) {
                return;
            }
            const row = $scope.alertMappingRow !== undefined ? $scope.alertMappingRow(alert.Type) : undefined;
            // An event type the mapping cannot name is a warning, as for the balloon
            var severity = ALERT_BALLOON_SEVERITY.indexOf(row !== undefined ? row.Icon : "warning");
            if (severity < 0) {
                severity = ALERT_BALLOON_SEVERITY.indexOf("warning");
            }
            worst = Math.max(worst, severity);
        });
        return worst < 0 ? "" : ALERT_BALLOON_SEVERITY[worst];
    };

    $scope.open = function (href) {
        document.location = href;
    };

    // invokeApply false: tick() checks this bar only
    var ticker = $interval(tick, 1000, 0, false);
    $scope.values.utc = new Date().toISOString().substring(11, 16);

    // The daemon sends the radios only when they change: ask once for where they are now
    $http.get(URL_RADIO_GET).then(function (response) {
        showRadio(response.data);
    }, function () { });
    // The bridge socket says nothing on connect: ask once whether rbvoice has published its keys
    $http.get(URL_BRIDGE_FLOAT_SET).then(function (response) {
        voiceBridge(angular.fromJson(response.data) || {});
    }, function () { });

    // The width of the bar changes with the window and the side panels; the first
    // observation also fits the bar as soon as its content is drawn
    const resizeObserver = new ResizeObserver(fitSlots);
    $scope.$on("$includeContentLoaded", function () {
        const bar = document.querySelector(".rb-bar-top");
        if (bar !== null) {
            resizeObserver.observe(bar);
        }
    });

    $scope.$on('$destroy', function () {
        Object.keys(handlers).forEach(function (name) {
            removeEventListener(name, handlers[name]);
        });
        $interval.cancel(ticker);
        resizeObserver.disconnect();
    });
}

/**
 * bottomBarEta: the UTC time of arrival at the active waypoint, HH:MM
 * @param {*} autopilot - The last AutopilotUpdated, undefined when none
 * @param {*} now - Date.now()
 * @returns The time, BAR_NO_DATA with the autopilot off, no valid leg or no closing speed
 */
function bottomBarEta(autopilot, now) {
    const gprmb = autopilot !== undefined && autopilot.Active === true ? autopilot.GPRMB || {} : {};
    // Knots is the speed towards the waypoint: zero or less never arrives
    if (gprmb.Status !== "A" || !(gprmb.Knots > 0) || !(gprmb.Distance >= 0)) {
        return BAR_NO_DATA;
    }
    return new Date(now + gprmb.Distance / gprmb.Knots * 3600 * 1000).toISOString().substring(11, 16);
}

/**
 * bottomBarTimer: the first running timer as the timers page shows it
 * @param {*} timers - The list of TimersService (/timers/ws), undefined before the first
 * @param {*} now - Date.now()
 * @returns Time left of a countdown, time elapsed of a chrono, BAR_NO_DATA when none runs
 */
function bottomBarTimer(timers, now) {
    const timer = Array.isArray(timers) ? timers.find(function (t) { return t && t.Status === true && t.Epoch > 0; }) : undefined;
    if (timer === undefined) {
        return BAR_NO_DATA;
    }
    const elapsed = Math.floor(now / 1000) - timer.Epoch;
    return textBySeconds(Math.max(0, timer.CountDown > 0 ? timer.CountDown - elapsed : elapsed));
}

function BottomBarCtrl($scope, $interval, $http) {
    var autopilot; // The last AutopilotUpdated
    var autopilotTime = 0; // Date.now() it came
    var qnh; // QNH of the last SituationUpdated
    var situationTime = 0;
    var ems = {}; // cpu_load_1m and batteryvoltage, kept across the partial EMS frames
    var emsTime = 0;
    var timers = $scope.timersList; // The last list of TimersService, undefined until the first

    // The readings under the key labels, by the `value` of the key in main.js
    $scope.keyValues = { qnh: BAR_NO_DATA, eta: BAR_NO_DATA, timer: BAR_NO_DATA, cpu: BAR_NO_DATA, battery: BAR_NO_DATA };

    // The key table, its level and what a key does live in main.js, so a key also works
    // with the bar hidden and from a keypad: a touch only sends the slot
    $scope.press = function (slot) {
        dispatchEvent(new CustomEvent("softkey", { detail: { slot: slot } }));
    };

    function show() {
        const now = Date.now();
        $scope.keyValues.eta = now - autopilotTime > TOP_BAR_STREAM_STALE_SECONDS * 1000 ? BAR_NO_DATA : bottomBarEta(autopilot, now);
        $scope.keyValues.timer = bottomBarTimer(timers, now);
        const situationLive = now - situationTime <= TOP_BAR_STALE_SECONDS * 1000;
        const emsLive = now - emsTime <= TOP_BAR_STREAM_STALE_SECONDS * 1000;
        $scope.keyValues.qnh = "QNH " + (situationLive ? barNumber(qnh, 0) : BAR_NO_DATA);
        $scope.keyValues.cpu = "CPU " + (emsLive ? barNumber(ems.cpu_load_1m, 2) : BAR_NO_DATA);
        $scope.keyValues.battery = (emsLive ? barNumber(ems.batteryvoltage, 1) : BAR_NO_DATA) + " V";
        // An event can come after the bar is gone
        if ($scope.$root !== null && !$scope.$root.$$phase) {
            $scope.$digest();
        }
    }

    // The daemon pushes the list on every change: the countdown itself is counted here
    function timersUpdated(event) {
        timers = event.detail;
        show();
    }
    addEventListener("TimersUpdated", timersUpdated);

    function autopilotUpdated(event) {
        autopilot = event.detail || {};
        autopilotTime = Date.now();
        show();
    }
    addEventListener("AutopilotUpdated", autopilotUpdated);

    function situationUpdated(event) {
        qnh = (event.detail || {}).QNH;
        situationTime = Date.now();
        show();
    }
    addEventListener("SituationUpdated", situationUpdated);

    // EMS frames are partial: a value is kept while any frame keeps coming
    function emsUpdated(event) {
        const frame = event.detail || {};
        ["cpu_load_1m", "batteryvoltage"].forEach(function (name) {
            if (typeof frame[name] === "number") {
                ems[name] = frame[name];
            }
        });
        emsTime = Date.now();
        show();
    }
    addEventListener("EMSUpdated", emsUpdated);

    // Every second: the countdown runs and a stopped autopilot stream goes to BAR_NO_DATA
    // invokeApply false: show() checks this bar only
    var ticker = $interval(show, 1000, 0, false);
    show();

    $scope.$on('$destroy', function () {
        removeEventListener("AutopilotUpdated", autopilotUpdated);
        removeEventListener("SituationUpdated", situationUpdated);
        removeEventListener("EMSUpdated", emsUpdated);
        removeEventListener("TimersUpdated", timersUpdated);
        $interval.cancel(ticker);
    });
}
