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
 *   do not fit are dropped in TOP_BAR_DROP_ORDER
 * - BottomBarCtrl: draws the soft keys of main.js, plates/sidebottom.html
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
const TOP_BAR_DROP_ORDER = ["utc", "gmax", "qnh", "track", "stby", "traffic", "agl", "oil", "ap"];

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

// A track in three digits, 000 to 359
function barTrack(raw) {
    if (typeof raw !== "number" || !isFinite(raw)) {
        return BAR_NO_DATA;
    }
    const degrees = ((Math.round(raw) % 360) + 360) % 360;
    return ("00" + degrees).slice(-3) + "°";
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

// An altitude in feet, as the daemon gives it, in the pilot's unit
function barAltitudeFromFeet(raw) {
    return barNumber(raw, 0, function (feet) {
        return pilotDisplayedAltitudeFromMeters(feet / 3.28084);
    });
}

function TopBarCtrl($scope, $interval, $http) {
    var trafficHeard = {}; // Icao_addr to the Date.now() it was last heard
    var alertsList = $scope.alertsList; // The last list of AlertsService, undefined until the first
    // Date.now() of the last frame of each stream, and the slots that go to BAR_NO_DATA when it stops
    const streams = {
        situation: { time: 0, seconds: TOP_BAR_STALE_SECONDS, slots: ["speed", "track", "qnh", "gmax", "alt"] },
        ems: { time: 0, seconds: TOP_BAR_STREAM_STALE_SECONDS, slots: ["oil"] },
        status: { time: 0, seconds: TOP_BAR_STREAM_STALE_SECONDS, slots: ["agl"] },
        autopilot: { time: 0, seconds: TOP_BAR_STREAM_STALE_SECONDS, slots: ["ap"] }
    };

    $scope.values = {
        speed: BAR_NO_DATA, track: BAR_NO_DATA, qnh: BAR_NO_DATA, gmax: BAR_NO_DATA, alt: BAR_NO_DATA,
        agl: BAR_NO_DATA, ap: BAR_NO_DATA, com: BAR_NO_DATA, stby: BAR_NO_DATA, oil: BAR_NO_DATA,
        utc: "", traffic: "0"
    };
    $scope.altitudeUnit = barAltitudeUnit();
    $scope.temperatureUnit = pilotTemperatureUnit();
    // IAS when the airspeed board reports one, GPS ground speed otherwise: servicesituation.js
    $scope.speedLabel = "GS " + barSpeedUnit();

    // Outside a digest only this bar is checked, inside one the running digest takes the change
    function redraw() {
        if (!$scope.$root.$$phase) {
            $scope.$digest();
        }
    }

    // The altimeter: the pressure altitude on the QNH in use, as the altimeter plate has it
    function barAltitude(situation) {
        if (situation.BaroSourceType === 0 || typeof situation.QNH !== "number") {
            return BAR_NO_DATA;
        }
        return barAltitudeFromFeet(situation.BaroPressureAltitude + 27 * (situation.QNH - 1013.25));
    }

    // COM and STBY: the selection of the first radio
    function showRadio(radios) {
        const radio = Array.isArray(radios) && radios.length > 0 ? radios[0] : {};
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

    // What each event changes; every one then redraws the bar
    const listeners = {
        SituationUpdated: function (situation) {
            streams.situation.time = Date.now();
            $scope.values.speed = barNumber(situation.SpeedKt, 0, pilotDisplayedSpeedFromKT);
            $scope.values.track = barTrack(situation.GPSTrueCourse);
            $scope.values.qnh = barNumber(situation.QNH, 0);
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
        // EMS frames are partial: the oil temperature is kept while any frame keeps coming
        EMSUpdated: function (ems) {
            streams.ems.time = Date.now();
            if (typeof ems.oiltemperature === "number") {
                $scope.values.oil = barNumber(ems.oiltemperature, 0, pilotDisplayedTemperaturesFromCelsius);
            }
            $scope.temperatureUnit = pilotTemperatureUnit();
        },
        // AGL from main/terrain.go: only with the terrain alerts on and a fix over the grid
        StatusUpdated: function (status) {
            streams.status.time = Date.now();
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
            listeners[name](event.detail || {});
            redraw();
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

    // The alerts whose condition is still there, undefined before the first list
    function activeAlerts() {
        if (!Array.isArray(alertsList)) {
            return undefined;
        }
        return alertsList.filter(function (alert) {
            return alert.Active === true;
        });
    }

    $scope.alertsCount = function () {
        const active = activeAlerts();
        return active === undefined ? BAR_NO_DATA : String(active.length);
    };

    // The severity of the worst active alert as the balloon has it, "" when none is active
    $scope.alertsLamp = function () {
        var worst = -1;
        (activeAlerts() || []).forEach(function (alert) {
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

function BottomBarCtrl($scope) {
    // The key table, its level and what a key does live in main.js, so a key also works
    // with the bar hidden and from a keypad: a touch only sends the slot
    $scope.press = function (slot) {
        dispatchEvent(new CustomEvent("softkey", { detail: { slot: slot } }));
    };
}
