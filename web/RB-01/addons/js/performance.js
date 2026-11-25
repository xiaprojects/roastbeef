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
 * performance.js: the aircraft performance page, #/addons/performance.
 *
 * Two parts:
 *   window.performanceService  runs from boot (js/main.js loads every addon script
 *       then), not only while the page is open: steady segments take minutes to
 *       collect. It loads performance.json, any "plugins" scripts it names (extra
 *       algorithms, docs/performance/professional-algorithms.md), and feeds
 *       js/perfengine.js one sample a second from the situation and EMS streams.
 *   PerformanceCtrl  draws the KPIs as horizontal G-meters once a second.
 *
 * performance.json is looked for first at /settings/performance.json (web/settings,
 * on the boot partition of an RB-01, kept across updates: the aircraft's own
 * training) and then at RB-01/settings/performance.json (the shipped sample).
 * Display only.
*/

angular.module('appControllers').controller('PerformanceCtrl', PerformanceCtrl);

var PERF_CONFIG_URLS = [
    URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/performance.json",
    "settings/performance.json"
];
// The G-meter arc colours, and the speed plate's darker box behind the value
var PERF_ARC_COLORS = { green: "#00ff00", yellow: "#ffff00", red: "#ff0000", white: "#ffffff" };
var PERF_BOX_COLORS = { green: "#00aa00", yellow: "#aaaa00", red: "#aa0000", white: "#333333" };

window.performanceService = (function () {
    var service = {
        engine: null,
        config: null,
        source: null,      // the URL performance.json came from
        error: null,
        lastSituation: {},
        lastEms: {},
        ready: false
    };

    function now() { return Date.now() / 1000; }

    // Starts (or restarts) the engine with a parsed performance.json.
    service.start = function (config, source) {
        service.config = config || {};
        service.source = source || null;
        service.engine = new PerformanceEngine(service.config);
        service.ready = true;
    };

    service.kpis = function () {
        return service.engine ? service.engine.kpis(now()) : [];
    };

    service.feed = function () {
        if (!service.engine) return;
        var c = service.engine.config.detector;
        if (service.engine.lastT !== null && now() - service.engine.lastT < c.samplePeriodS * 0.95) return;
        service.engine.observe(perfSampleFromSituation(service.lastSituation, service.lastEms, now(), null, c.emsStaleS));
    };

    // Extra algorithm scripts named by performance.json "plugins", loaded in order.
    function loadPlugins(list, done) {
        if (!Array.isArray(list) || !list.length) { done(); return; }
        var src = list[0];
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { loadPlugins(list.slice(1), done); };
        s.onerror = function () {
            console.error("performance: plugin " + src + " did not load");
            loadPlugins(list.slice(1), done);
        };
        document.head.appendChild(s);
    }

    function load(i) {
        if (i >= PERF_CONFIG_URLS.length) {
            service.error = "NO performance.json";
            service.start({}, null);
            return;
        }
        fetch(PERF_CONFIG_URLS[i], { cache: "no-store" }).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        }).then(function (config) {
            if (!config || !Array.isArray(config.indicators)) throw new Error("no indicators");
            loadPlugins(config.plugins, function () { service.start(config, PERF_CONFIG_URLS[i]); });
        }).catch(function () {
            load(i + 1);
        });
    }

    addEventListener("SituationUpdated", function (event) {
        service.lastSituation = event.detail || {};
        service.feed();
    });
    addEventListener("EMSUpdated", function (event) {
        service.lastEms = event.detail || {};
    });
    load(0);
    return service;
})();

function PerformanceCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "performance";

    // Nothing to operate: the knob only moves between pages.
    $scope.keypadFocus = new KeypadFocus($scope, $state, name);

    function scale() {
        const d = window.performanceService.engine ? window.performanceService.engine.config.display : PERF_DEFAULT_DISPLAY;
        return { min: Number(d.scaleMin), max: Number(d.scaleMax) };
    }

    function pos(v, sc) {
        return (Math.max(sc.min, Math.min(sc.max, v)) - sc.min) / (sc.max - sc.min) * 100;
    }

    function bandsOf(bands, sc) {
        const out = [];
        (bands || []).forEach(function (b) {
            const lo = Math.max(Number(b.min), sc.min), hi = Math.min(Number(b.max), sc.max);
            const color = PERF_ARC_COLORS[b.color];
            if (!(hi > lo) || color === undefined) return;
            out.push({ left: pos(lo, sc), width: pos(hi, sc) - pos(lo, sc), color: color });
        });
        return out;
    }

    function render() {
        const svc = window.performanceService;
        const sc = scale();
        const ticks = [];
        const step = (sc.max - sc.min) / 4;
        for (let i = 0; i <= 4; i++) {
            const v = sc.min + i * step;
            ticks.push({ left: pos(v, sc), text: String(Math.round(v)) });
        }
        $scope.scaleTicks = ticks;
        $scope.baseline = pos(100, sc);

        $scope.kpis = svc.kpis().map(function (k) {
            const valid = k.value !== null;
            const color = valid ? perfBandColor(k.bands, k.value) : "";
            let note = valid ? k.detail : k.status;
            if (valid && k.quality == "GS") note = "GS · " + note;    // ground speed stood in for the airspeed
            return {
                id: k.id,
                label: k.label,
                valid: valid,
                text: valid ? String(Math.round(k.value)) : "--",
                left: valid ? pos(k.value, sc) : 0,
                bands: bandsOf(k.bands, sc),
                box: PERF_BOX_COLORS[color] || "#000000",
                note: note,
                opacity: valid ? k.fade : 0.45
            };
        });
        const cfg = svc.config || {};
        $scope.footnote = svc.error ? [svc.error, ""] : [
            (cfg.aircraft ? cfg.aircraft + " · " : "") + (cfg.trainedAt ? "trained " + cfg.trainedAt : "UNTRAINED"),
            "100 % = as trained · advisory only"];
    }

    render();
    const ticker = $interval(render, 1000);

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };
    $state.get(name).onExit = function () {
        console.log("onExit" + name);
        $interval.cancel(ticker);
    };
    $scope.$on("$destroy", function () {
        $interval.cancel(ticker);
    });
}
