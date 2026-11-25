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
 * airquality.js: the air quality page, #/addons/airquality. Six round
 * instruments of the G-meter / speed component (css/Speed.css): AQI 1..5,
 * eCO2 and TVOC from the ENS160 (main/airquality.go), the cabin relative
 * humidity (BaroHumidity: AHT20/21 or BME680) with the cabin temperature, and
 * the two icing advisories of main/icing.go, read from the EMS stream:
 * icing_carb (carburettor icing chart, % risk if power is reduced) and
 * icing_airframe (% chance of icing conditions). They need
 * the outside air temperature from the EMS: without it they read NO DATA.
 *
 * The coloured arcs are the bands of the rules in
 * settings/rbvoice-aircraft-rules.json (CABINAIR, ECO2, TVOC, ICINGCARB,
 * ICINGAIRFRAME),
 * the same file the daemon alarms on (main/ems.go): the value box turns yellow
 * or red exactly when the rule is in that band. While the ENS160 warms up the
 * daemon does not feed the rules, so the box stays black then.
 * Display only.
*/

angular.module('appControllers').controller('AirqualityCtrl', AirqualityCtrl);

const AQ_RULES_URL = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/rbvoice-aircraft-rules.json";
const AQ_START = -140;         // degrees from 12 o'clock, clockwise, of the scale minimum
const AQ_SWEEP = 280;          // 4 ticks of 70 degrees
const AQ_TICKS = 4;
const AQ_STALE_MS = 10000;     // no new sample for this long: NO DATA
const AQ_TREND_MS = 60000;     // trend compares with the value a minute ago
const AQ_TREND_RATIO = 0.05;   // a 5 % change is a trend
const AQ_WORDS = ["EXCELLENT", "GOOD", "MODERATE", "POOR", "UNHEALTHY"];
// main/icing.go carbIcingPercent: the chart zone as a percentage
const AQ_CARB_WORDS = { 0: "NONE", 25: "LIGHT", 50: "LOW PWR", 75: "MODERATE", 100: "SEVERE" };
// The colours of the G-meter arcs, and the speed plate's darker box behind the value
const AQ_ARC_COLORS = { green: "#00ff00", yellow: "#ffff00", red: "#ff0000" };
const AQ_BOX_COLORS = { yellow: "#aaaa00", red: "#aa0000" };

// The shipped rules, used until (or if never) the file loads.
const AQ_DEFAULT_RULES = {
    CABINAIR: [{ color: "green", min: 0.5, max: 3.5 }, { color: "yellow", min: 3.5, max: 4.5 }, { color: "red", min: 4.5, max: 99 }],
    ECO2: [{ color: "green", min: 400, max: 1000 }, { color: "yellow", min: 1000, max: 1500 }, { color: "red", min: 1500, max: 65000 }],
    TVOC: [{ color: "green", min: 0, max: 660 }, { color: "yellow", min: 660, max: 2200 }, { color: "red", min: 2200, max: 65000 }],
    // Display only: the daemon has no humidity rule, so these bands stay as written here
    CABINHUMIDITY: [{ color: "yellow", min: 0, max: 20 }, { color: "green", min: 20, max: 70 }, { color: "yellow", min: 70, max: 100 }],
    ICINGCARB: [{ color: "green", min: 0, max: 20 }, { color: "yellow", min: 20, max: 60 }, { color: "red", min: 60, max: 100 }],
    ICINGAIRFRAME: [{ color: "green", min: 0, max: 20 }, { color: "yellow", min: 20, max: 60 }, { color: "red", min: 60, max: 100 }]
};

function AirqualityCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "airquality";
    const controllerName = "AirqualityCtrl";

    // Nothing to operate: the knob only moves between pages.
    $scope.keypadFocus = new KeypadFocus($scope, $state, name);

    const DEFS = [
        { key: "aqi", rule: "CABINAIR", label: "AQI", unit: "", min: 1, max: 5 },
        { key: "eco2", rule: "ECO2", label: "eCO₂", unit: "ppm", min: 400, max: 2000 },
        { key: "tvoc", rule: "TVOC", label: "TVOC", unit: "ppb", min: 0, max: 3000 },
        { key: "rh", rule: "CABINHUMIDITY", label: "RH", unit: "%", min: 0, max: 100 },
        { key: "carb", rule: "ICINGCARB", label: "CARB ICE", unit: "%", min: 0, max: 100 },
        { key: "airframe", rule: "ICINGAIRFRAME", label: "AIRFRAME", unit: "%", min: 0, max: 100 }
    ];
    let bands = angular.copy(AQ_DEFAULT_RULES);
    const last = { stamp: null, seenAt: 0, history: [] };
    let lastSituation = {};
    // The last EMS map: each frame of the stream is the daemon's whole map, so a probe
    // missing from it was withdrawn (main/icing.go: its inputs are not reliable)
    let lastEms = {};

    function angleOf(d, v) {
        const c = Math.max(d.min, Math.min(d.max, v));
        return AQ_START + (c - d.min) / (d.max - d.min) * AQ_SWEEP;
    }

    // The rule's bands as G-meter arcs, clipped to the dial.
    function arcsOf(d) {
        const out = [];
        (bands[d.rule] || []).forEach(function (b) {
            const lo = Math.max(Number(b.min), d.min), hi = Math.min(Number(b.max), d.max);
            const color = AQ_ARC_COLORS[b.color];
            if (!(hi > lo) || color === undefined) return;
            out.push({
                color: color,
                startDegree: angleOf(d, lo) + "deg",
                sizeDegree: ((hi - lo) / (d.max - d.min) * AQ_SWEEP) + "deg"
            });
        });
        return out;
    }

    // The band containing v, the most severe one on a shared bound, as main/ems.go ruleColor.
    function colorOf(rule, v) {
        const list = bands[rule] || [];
        for (const c of ["red", "yellow", "green"]) {
            for (const b of list) {
                if (b.color == c && v >= Number(b.min) && v <= Number(b.max)) return c;
            }
        }
        return "";
    }

    function trendOf(key, now, v) {
        let ref = null;
        for (let i = 0; i < last.history.length; i++) {
            if (now - last.history[i].t <= AQ_TREND_MS) { ref = last.history[i]; break; }
        }
        if (!ref || now - ref.t < AQ_TREND_MS / 2) return "";
        const base = Math.max(ref[key], key == "tvoc" ? 20 : 400);
        const d = (v - ref[key]) / base;
        return d > AQ_TREND_RATIO ? String.fromCodePoint(9650) : d < -AQ_TREND_RATIO ? String.fromCodePoint(9660) : "";
    }

    // One instrument in the shape of the G-meter's $scope.Speed.
    function gauge(d, value, valid, live, unit, label) {
        const color = live ? colorOf(d.rule, value) : "";
        return {
            key: d.key,
            label: label === undefined ? d.label : label,
            unit: unit === undefined ? d.unit : unit,
            arcs: arcsOf(d),
            speedTicks: createProgressiveTicksForRoundInstrument(d.max, d.min, AQ_START + AQ_SWEEP, AQ_START, AQ_TICKS, 0),
            valid: valid,
            speed: valid ? String(Math.round(value)) : "--",
            // css/Speed.css sizes the value for 3 characters; 4 digits would cover the ticks
            valueSize: valid && String(Math.round(value)).length >= 4 ? "22cqmin" : "30cqmin",
            speedDegree: (angleOf(d, value) + 90) + "deg",
            backgroundColor: AQ_BOX_COLORS[color] || "#000000",
            color: color,
            opacity: 1
        };
    }

    // An icing advisory: the value in %, a word under it, NO DATA while withdrawn.
    function icingGauge(d, raw, wordOf) {
        const v = Number(raw);
        const valid = raw !== undefined && raw !== null && isFinite(v);
        const word = valid ? wordOf(Math.round(v)) : "NO DATA";
        const g = gauge(d, valid ? v : 0, valid, valid, word);
        g.opacity = valid ? 1 : 0.35;
        return g;
    }

    function render(s, now) {
        const validity = String(s.AirQualityValidity ?? "");
        const index = Number(s.AirQualityIndex) || 0;
        const stamp = s.AirQualityLastMeasurementTime ?? null;
        if (stamp !== last.stamp) {
            last.stamp = stamp;
            last.seenAt = now;
        }
        const present = validity !== "" && index > 0;
        const stale = present && now - last.seenAt > AQ_STALE_MS;
        const usable = present && !stale && validity != "invalid";
        const live = usable && validity == "normal";

        let status = "";
        let opacity = 1;
        if (!present) { status = "NO SENSOR"; opacity = 0.35; }
        else if (stale) { status = "NO DATA"; opacity = 0.35; }
        else if (validity == "warm-up") { status = "WARM-UP"; opacity = 0.6; }
        else if (validity == "start-up") { status = "START-UP"; opacity = 0.6; }
        else if (validity != "normal") { status = "INVALID"; opacity = 0.35; }

        const values = { aqi: index, eco2: Number(s.AirQualityECO2) || 0, tvoc: Number(s.AirQualityTVOC) || 0 };
        if (usable && stamp !== null && (last.history.length == 0 || last.history[last.history.length - 1].stamp !== stamp)) {
            last.history.push({ t: now, stamp: stamp, eco2: values.eco2, tvoc: values.tvoc });
        }
        while (last.history.length && now - last.history[0].t > 2 * AQ_TREND_MS) last.history.shift();

        const out = [];
        const aqiWord = usable ? AQ_WORDS[Math.min(4, Math.max(0, index - 1))] : "";
        out.push(gauge(DEFS[0], values.aqi, usable, live, status || aqiWord));
        out.push(gauge(DEFS[1], values.eco2, usable, live, undefined, DEFS[1].label + (usable ? trendOf("eco2", now, values.eco2) : "")));
        out.push(gauge(DEFS[2], values.tvoc, usable, live, undefined, DEFS[2].label + (usable ? trendOf("tvoc", now, values.tvoc) : "")));
        for (let i = 0; i < 3; i++) out[i].opacity = opacity;

        // Cabin humidity, with the cabin temperature beside the unit
        const hum = Number(s.BaroHumidity) || 0;
        let rhUnit = "%";
        const baroStamp = String(s.BaroLastMeasurementTime ?? "");
        const t = Number(s.BaroTemperature);
        if (baroStamp !== "" && baroStamp.indexOf("0001-01-01T00:00:00") !== 0 && isFinite(t)) {
            rhUnit = "% " + Math.round(pilotDisplayedTemperaturesFromCelsius(t)) + pilotTemperatureUnit();
        }
        const rh = gauge(DEFS[3], hum, hum > 0, hum > 0, hum > 0 ? rhUnit : "NO SENSOR");
        rh.opacity = hum > 0 ? 1 : 0.35;
        out.push(rh);

        // Icing, from the EMS probes of main/icing.go
        out.push(icingGauge(DEFS[4], lastEms.icing_carb, function (v) { return AQ_CARB_WORDS[v] || ""; }));
        out.push(icingGauge(DEFS[5], lastEms.icing_airframe, function (v) {
            return v <= 0 ? "NONE" : v < 50 ? "POSSIBLE" : "LIKELY";
        }));

        $scope.gauges = out;
    }

    // ---- wiring -----------------------------------------------------------

    render(lastSituation, Date.now());

    // The EMS stream sends only on change: start from the current map
    $http.get(URL_EMS_GET).then(function (response) {
        const ems = angular.fromJson(response.data);
        if (ems && typeof ems === "object") {
            lastEms = ems;
            render(lastSituation, Date.now());
        }
    }, function () {
        // NO DATA until the stream brings a frame
    });

    $http.get(AQ_RULES_URL).then(function (response) {
        const rules = angular.fromJson(response.data)?.rules;
        if (!Array.isArray(rules)) return;
        rules.forEach(function (r) {
            if (DEFS.some(d => d.rule == r.name) && Array.isArray(r.colors)) bands[r.name] = r.colors;
        });
        render(lastSituation, Date.now());
    }, function () {
        // keep the shipped bands
    });

    function situationUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("SituationUpdated", situationUpdateEventListener);
            return; // we are getting called once after clicking away from the page
        }
        lastSituation = event.detail || {};
        $scope.$evalAsync(function () { render(lastSituation, Date.now()); });
    }

    function emsUpdated(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("EMSUpdated", emsUpdated);
            return;
        }
        lastEms = event.detail || {};
        $scope.$evalAsync(function () { render(lastSituation, Date.now()); });
    }

    // Re-render once a second so NO DATA appears even when the situation stream stops.
    const ticker = $interval(function () { render(lastSituation, Date.now()); }, 1000);

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };
    $state.get(name).onExit = function () {
        console.log("onExit" + name);
        removeEventListener("SituationUpdated", situationUpdateEventListener);
        removeEventListener("EMSUpdated", emsUpdated);
        $interval.cancel(ticker);
    };
    $scope.$on("$destroy", function () {
        removeEventListener("SituationUpdated", situationUpdateEventListener);
        removeEventListener("EMSUpdated", emsUpdated);
        $interval.cancel(ticker);
    });

    addEventListener("SituationUpdated", situationUpdateEventListener);
    addEventListener("EMSUpdated", emsUpdated);
}
