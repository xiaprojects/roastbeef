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
 * logbook.js: the flight log recorded by the GPS Hobbs meter (main/hobbsmeter.go,
 * GET /settings/hobbsmeter.json, docs/http-api.md), newest flight first.
 * Opened from the Propeller and Engine tiles of the Aircraft plate.
 *
 * Each flight is named by the nearest airfield of settings/db.airfields.json within
 * LOGBOOK_AIRFIELD_RADIUS_KM of where it opened and closed (the meter opens a flight
 * at 50 km/h on the runway and closes it 60 s after slowing down), else by its
 * coordinates. Only the newest flight can be in progress: an older one without a landing
 * was left open by a power cut (the meter keeps it as last flushed). A TAP (or touch) on a row shows its times and altitudes. The list is
 * read again whenever HobbsTimeMinutes in /getStatus changes, so a flight in progress
 * stays live.
 */

angular.module('appControllers').controller('LogbookCtrl', LogbookCtrl);
LogbookCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];

var URL_HOBBSMETER_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/hobbsmeter.json";
var URL_LOGBOOK_AIRFIELDS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/db.airfields.json";
var LOGBOOK_AIRFIELD_RADIUS_KM = 5;
var LOGBOOK_FEET_PER_METER = 3.28084;

// Minutes as h:mm
function logbookMinutesText(minutes) {
    minutes = Math.max(0, Math.round(Number(minutes) || 0));
    const m = minutes % 60;
    return Math.floor(minutes / 60) + ":" + (m < 10 ? "0" : "") + m;
}

// RFC 3339 time, as the meter writes it, to a Date; null when empty or not a time
// (the file is hand-editable)
function logbookParseTime(text) {
    if (typeof text !== "string" || text == "") {
        return null;
    }
    const date = new Date(text);
    return isNaN(date.getTime()) ? null : date;
}

function logbookTwoDigits(n) {
    return (n < 10 ? "0" : "") + n;
}

function logbookDateText(date) {
    return date.getUTCFullYear() + "-" + logbookTwoDigits(date.getUTCMonth() + 1) + "-" + logbookTwoDigits(date.getUTCDate());
}

function logbookClockText(date) {
    return logbookTwoDigits(date.getUTCHours()) + ":" + logbookTwoDigits(date.getUTCMinutes()) + "Z";
}

function LogbookCtrl($rootScope, $scope, $state, $http, $interval) {
    const name = "logbook";

    $scope.logbook = {
        loaded: false,
        error: "",
        entries: [],
        flights: 0,
        totalText: "0:00"
    };
    $scope.logbookRaw = [];
    $scope.logbookAirfields = [];
    $scope.logbookHobbsMinutes = undefined;

    // The nearest airfield within the radius; null when none
    $scope.nearestAirfield = function (lat, lon) {
        var best = null;
        var bestKm = LOGBOOK_AIRFIELD_RADIUS_KM;
        $scope.logbookAirfields.forEach(field => {
            if (typeof field.Lat !== "number" || typeof field.Lon !== "number") {
                return;
            }
            const km = distance(lon, lat, field.Lon, field.Lat);
            if (km <= bestKm) {
                bestKm = km;
                best = field;
            }
        });
        if (best === null) {
            return null;
        }
        // An ICAO code when it has one, else its name: "IT-0001" says nothing to a pilot
        if (typeof best.gps_code === "string" && /^[A-Z]{4}$/.test(best.gps_code)) {
            return best.gps_code;
        }
        return best.name || best.local_code || best.ident || null;
    };

    // Where a flight opened or closed: the airfield, else the coordinates
    $scope.placeText = function (lat, lon) {
        lat = Number(lat);
        lon = Number(lon);
        if (!isFinite(lat) || !isFinite(lon) || (lat == 0 && lon == 0)) {
            return "---";
        }
        const field = $scope.nearestAirfield(lat, lon);
        if (field !== null) {
            return field;
        }
        return Math.abs(lat).toFixed(3) + (lat >= 0 ? "N " : "S ") + Math.abs(lon).toFixed(3) + (lon >= 0 ? "E" : "W");
    };

    function pointText(date, lat, lon, altitudeMeters, place) {
        const parts = [];
        if (date !== null) {
            parts.push(logbookDateText(date) + " " + logbookClockText(date));
        }
        parts.push(place);
        const alt = Number(altitudeMeters);
        if (isFinite(alt) && alt != 0) {
            parts.push((alt * LOGBOOK_FEET_PER_METER).toFixed(0) + " ft");
        }
        return parts.join(" · ");
    }

    // One hobbsmeter.json entry to one row
    $scope.logbookRow = function (entry, index) {
        const departure = logbookParseTime(entry.departureTime);
        const landed = logbookParseTime(entry.landedTime);
        // Not closed: the flight in progress, or one a power cut left open (the newest only can
        // be in progress, logbookRefresh decides). An entry without a departure time is broken
        const open = departure !== null && (entry.landedTime === undefined || entry.landedTime === "");
        const from = $scope.placeText(entry.departureLatitude, entry.departureLongitude);
        const to = open ? "" : $scope.placeText(entry.landedLatitude, entry.landedLongitude);
        var elapsedText = "";
        if (departure !== null && landed !== null && landed >= departure) {
            elapsedText = logbookMinutesText((landed - departure) / 60000);
        }
        return {
            key: String(entry.departureTime) + "#" + index,
            open: open,
            inFlight: false,
            expanded: false,
            sortTime: departure !== null ? departure.getTime() : -Infinity,
            index: index,
            date: departure !== null ? logbookDateText(departure) : String(entry.departureTime || "---"),
            departureClock: departure !== null ? logbookClockText(departure) : "",
            from: from,
            to: to,
            hobbsText: logbookMinutesText(entry.hobbsTimeMinutes),
            departureText: pointText(departure, entry.departureLatitude, entry.departureLongitude, entry.departureAltitudeMeters, from),
            landedText: open ? "" : pointText(landed, entry.landedLatitude, entry.landedLongitude, entry.landedAltitudeMeters, to),
            elapsedText: elapsedText
        };
    };

    // Rebuild the rows, newest first; a row the pilot opened stays open
    $scope.logbookRefresh = function () {
        const expanded = {};
        $scope.logbook.entries.forEach(row => {
            if (row.expanded) {
                expanded[row.key] = true;
            }
        });
        var total = 0;
        const rows = [];
        $scope.logbookRaw.forEach((entry, index) => {
            if (entry === null || typeof entry !== "object") {
                return;
            }
            total += Math.max(0, Number(entry.hobbsTimeMinutes) || 0);
            const row = $scope.logbookRow(entry, index);
            row.expanded = expanded[row.key] === true;
            rows.push(row);
        });
        // Newest first; entries without a readable time keep the file order, at the end
        rows.sort((a, b) => (b.sortTime - a.sortTime) || (b.index - a.index));
        if (rows.length > 0 && rows[0].open) {
            rows[0].inFlight = true;
        }
        $scope.logbook.entries = rows;
        $scope.logbook.flights = rows.length;
        $scope.logbook.totalText = logbookMinutesText(total);
    };

    $scope.logbookLoad = function () {
        $http.get(URL_HOBBSMETER_GET).then(function (response) {
            const list = angular.fromJson(response.data);
            $scope.logbookRaw = Array.isArray(list) ? list : [];
            $scope.logbook.error = "";
            $scope.logbook.loaded = true;
            $scope.logbookRefresh();
        }, function () {
            $scope.logbook.error = "Flight log not available";
            $scope.logbook.loaded = true;
        });
    };

    $http.get(URL_LOGBOOK_AIRFIELDS_GET).then(function (response) {
        const list = angular.fromJson(response.data);
        if (Array.isArray(list)) {
            $scope.logbookAirfields = list;
            $scope.logbookRefresh();
        }
    });
    $scope.logbookLoad();

    // A flight in progress or a landing changes HobbsTimeMinutes: read the log again
    function statusUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "LogbookCtrl") {
            removeEventListener("StatusUpdated", statusUpdateEventListener);
            return;
        }
        const minutes = event.detail ? event.detail.HobbsTimeMinutes : undefined;
        if (minutes === undefined) {
            return;
        }
        if ($scope.logbookHobbsMinutes !== undefined && $scope.logbookHobbsMinutes != minutes) {
            $scope.logbookLoad();
        }
        $scope.logbookHobbsMinutes = minutes;
    }
    addEventListener("StatusUpdated", statusUpdateEventListener);

    // The knob: one stop per flight, newest first; TAP shows its details as a touch does
    $scope.keypadFocus = new KeypadFocus($scope, $state, name);

    $scope.$on('$destroy', function () {
        removeEventListener("StatusUpdated", statusUpdateEventListener);
    });
}
