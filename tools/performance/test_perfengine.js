#!/usr/bin/env node
/*
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
 *
 * test_perfengine.js: unit tests of web/RB-01/js/perfengine.js, no browser.
 *
 *   node tools/performance/test_perfengine.js
 *
 * One behaviour per check. The page itself is test/display/test_performance.py.
 */
"use strict";
const path = require("path");
const fs = require("fs");
const perf = require(path.join(__dirname, "..", "..", "web", "RB-01", "js", "perfengine.js"));

let passed = 0, failed = 0;
function check(ok, what, info) {
    if (ok) { passed++; console.log("  PASS " + what); }
    else { failed++; console.log("  FAIL " + what + (info === undefined ? "" : "  " + JSON.stringify(info))); }
}
const near = (a, b, tol) => a !== null && a !== undefined && Math.abs(a - b) <= tol;

// A trained file small enough to reason about: TAS = 0.07 * rpm, pitch = -2 + 2 * (100/EAS)^2,
// climb 700 fpm, full power 2300 rpm.
const CONFIG = {
    detector: { climbMinRpm: 2000 },
    indicators: [
        { id: "cruise", algorithm: "rb-open", model: { target: "tasKt", features: ["rpm"], intercept: 0, coef: [0.07], range: { rpm: [1800, 2500] } } },
        { id: "attitude", algorithm: "rb-open", minAoaDeg: 2.5, model: { target: "aoaPitchDeg", features: ["invEas2"], intercept: -2, coef: [2], range: { invEas2: [0.3, 3] } } },
        { id: "climb", algorithm: "rb-open", model: { target: "vsFpm", features: [], intercept: 700, coef: [] } },
        { id: "engine", algorithm: "rb-open", model: { target: "rpm", features: [], intercept: 2300, coef: [] } },
        { id: "fuel", algorithm: "rb-open", egtSpreadRefC: 20, egtSpreadTolC: 40, rpmJitterRef: 5, rpmJitterTol: 30 },
        { id: "density", algorithm: "rb-open", weight: 0.5 },
        { id: "icing", algorithm: "rb-open" }
    ]
};

// n seconds of steady flight at sea level ISA, ending at t0 + n
function fly(engine, o, n, t0) {
    const rpm = o.rpm ?? 2200;
    const tas = o.tas ?? 0.07 * rpm;
    const inv = (100 / tas) * (100 / tas);
    let seg = [];
    for (let i = 0; i < n; i++) {
        const jitter = o.jitter ? (i % 2 ? o.jitter : -o.jitter) : 0;
        const s = {
            t: (t0 ?? 0) + i + 1, iasKt: tas, gsKt: tas, trackDeg: 0, windValid: false,
            pitchDeg: o.pitch ?? (-2 + 2 * inv + (o.extraPitch ?? 0)), rollDeg: o.roll ?? 0, gload: o.g ?? 1,
            vsFpm: o.vs ?? 0, pressureAltFt: o.alt ?? 0, oatC: o.oat === undefined ? 15 : o.oat,
            rpm: (o.rpmAt ? o.rpmAt(i) : rpm) + jitter, mapInHg: null, fuelPressure: null, fuelFlow: null,
            egt: o.egt ?? [700, 710, 715], cht: [], icingCarb: o.carb ?? null, icingAirframe: o.airframe ?? null,
            ems: o.ems ? o.ems(i) : {}
        };
        const r = engine.observe(s);
        if (r) seg.push(r);
    }
    return seg;
}
const kpi = (engine, id) => engine.kpis().find(k => k.id === id);

console.log("atmosphere");
check(near(perf.perfDensityRatio(0, 15), 1, 1e-4), "ISA sea level: sigma 1");
check(near(perf.perfDensityRatio(5000, null), 0.8617, 1e-3), "ISA 5000 ft: sigma 0.862");
check(near(perf.perfDensityAltitudeFt(perf.perfDensityRatio(5000, null)), 5000, 5), "density altitude of ISA 5000 ft is 5000 ft");
check(perf.perfDensityAltitudeFt(perf.perfDensityRatio(2000, 35)) > 4500, "2000 ft at 35 °C: density altitude above 4500 ft");
check(near(perf.perfPowerRatio(1), 1, 1e-9), "Gagg-Ferrar: full power at sigma 1");

console.log("steady segment detector");
let e = new perf.PerformanceEngine(CONFIG);
let segs = fly(e, {}, 20);
check(segs.length === 1 && segs[0].phase === "level", "20 s of level flight: one level segment", segs.map(s => s.phase));
check(fly(new perf.PerformanceEngine(CONFIG), {}, 15).length === 0, "15 s are not enough");
check(fly(new perf.PerformanceEngine(CONFIG), { roll: 15 }, 40).length === 0, "banked 15 deg: no segment");
check(fly(new perf.PerformanceEngine(CONFIG), { g: 1.4 }, 40).length === 0, "1.4 G: no segment");
check(fly(new perf.PerformanceEngine(CONFIG), { rpmAt: i => 2000 + 10 * i }, 40).length === 0,
    "throttle moving 10 rpm/s: no segment");
segs = fly(new perf.PerformanceEngine(CONFIG), { jitter: 60 }, 20);
check(segs.length === 1 && segs[0].rpmJitter > 50, "a rough engine (±60 rpm) is still steady: the fuel KPI must see it",
    segs.map(s => s.rpmJitter));
segs = fly(new perf.PerformanceEngine(CONFIG), { vs: 700, rpm: 2300 }, 20);
check(segs.length === 1 && segs[0].phase === "climb", "700 fpm at 2300 rpm: a climb segment", segs.map(s => s.phase));
check(fly(new perf.PerformanceEngine(CONFIG), { vs: 700, rpm: 1900 }, 20).length === 0,
    "700 fpm below climbMinRpm: not a full power climb");
check(fly(new perf.PerformanceEngine(CONFIG), { tas: 40 }, 40).length === 0, "below minSpeedKt: on the ground");
check(near(segs[0].gammaDeg, Math.atan(700 / (161 * 101.269)) * 180 / Math.PI, 0.01),
    "the segment carries the flight path angle");

console.log("KPIs");
e = new perf.PerformanceEngine(CONFIG);
check(kpi(e, "cruise").value === null && kpi(e, "overall").value === null, "nothing flown: no values");
fly(e, {}, 5);
check(kpi(e, "cruise").status === "WAIT LEVEL" && kpi(e, "climb").status === "WAIT CLIMB",
    "flying, not steady yet: WAIT LEVEL / WAIT CLIMB", [kpi(e, "cruise").status, kpi(e, "climb").status]);
fly(e, {}, 60, 5);
check(near(kpi(e, "cruise").value, 100, 0.01), "on the model: CRUISE 100", kpi(e, "cruise"));
check(near(kpi(e, "attitude").value, 100, 0.5), "on the model: ATTITUDE 100", kpi(e, "attitude"));
check(near(kpi(e, "fuel").value, 100, 0.01), "smooth, even EGTs: FUEL 100", kpi(e, "fuel"));
check(near(kpi(e, "density").value, 100, 0.01), "ISA: DENSITY 100", kpi(e, "density"));
check(kpi(e, "icing").value === null && kpi(e, "icing").status === "NO DATA", "no icing probes: ICING NO DATA");
const ov = kpi(e, "overall");
check(near(ov.value, 100, 0.5) && ov.detail.indexOf("4 of 7") === 0, "OVERALL from the 4 valid KPIs", ov);

e = new perf.PerformanceEngine(CONFIG);
fly(e, { tas: 0.07 * 2200 * 0.85 }, 120);
check(near(kpi(e, "cruise").value, 85, 1), "15 % slower at the same RPM: CRUISE 85", kpi(e, "cruise"));
check(perf.perfBandColor(kpi(e, "cruise").bands, kpi(e, "cruise").value) === "yellow", "85 is in the yellow band");

e = new perf.PerformanceEngine(CONFIG);
fly(e, { extraPitch: 0.5 }, 200);
const att = kpi(e, "attitude").value;
// aoaRef = max(2.5, 2 * (100/154)^2 = 0.84) = 2.5: 2.5 / 3.0
check(near(att, 100 * 2.5 / 3.0, 1), "0.5 deg more pitch at the same speed: ATTITUDE 83 (more lift needed)", att);

e = new perf.PerformanceEngine(CONFIG);
fly(e, { egt: [640, 720, 730] }, 60);
check(kpi(e, "fuel").value < 20, "a 90 °C EGT spread: FUEL near 0", kpi(e, "fuel"));
e = new perf.PerformanceEngine(CONFIG);
fly(e, { jitter: 12 }, 60);
const rough = kpi(e, "fuel").value;
check(rough > 20 && rough < 70, "a rougher engine (±12 rpm every second, trained ±5): FUEL between 20 and 70", rough);

e = new perf.PerformanceEngine(CONFIG);
fly(e, { vs: 560, rpm: 2300 }, 60);
check(near(kpi(e, "climb").value, 80, 1), "560 fpm of 700: CLIMB 80", kpi(e, "climb"));
check(near(kpi(e, "engine").value, 100, 0.01), "rated RPM at full power: ENGINE 100", kpi(e, "engine"));

e = new perf.PerformanceEngine(CONFIG);
fly(e, { alt: 3000, oat: 35 }, 30);
const dens = kpi(e, "density");
check(dens.value < 92 && dens.value > 80 && dens.detail.indexOf("ISA+") === 0,
    "3000 ft at 35 °C (ISA+26): DENSITY in the 80s", dens);
e = new perf.PerformanceEngine(CONFIG);
fly(e, { oat: null }, 5);
check(kpi(e, "density").status === "NO OAT", "no OAT: DENSITY says NO OAT");

e = new perf.PerformanceEngine(CONFIG);
fly(e, { carb: 75, airframe: 20 }, 3);
check(near(kpi(e, "icing").value, 25, 0.01), "carb icing 75 %: ICING 25", kpi(e, "icing"));

e = new perf.PerformanceEngine(CONFIG);
fly(e, { rpm: 1200, tas: 84 }, 40);
check(kpi(e, "cruise").status === "OUT OF RANGE" && kpi(e, "cruise").value === null,
    "1200 rpm, trained 1800-2500: OUT OF RANGE, no value", kpi(e, "cruise"));

e = new perf.PerformanceEngine({ indicators: [{ id: "cruise" }, { id: "climb" }, { id: "fuel" }] });
fly(e, {}, 40);
check(kpi(e, "cruise").status === "UNTRAINED" && kpi(e, "climb").status === "UNTRAINED" && kpi(e, "fuel").status === "UNTRAINED",
    "no model in performance.json: UNTRAINED", e.kpis().map(k => k.status));

e = new perf.PerformanceEngine(CONFIG);
fly(e, {}, 40);
const fresh = kpi(e, "cruise");
const old = e.kpis(e.lastT + 400).find(k => k.id === "cruise");
const gone = e.kpis(e.lastT + 4000).find(k => k.id === "cruise");
check(fresh.fade === 1 && old.fade === 0.5 && gone.value === null && gone.status === "EXPIRED",
    "a KPI fades after fadeS and is withdrawn after holdS", [fresh.fade, old.fade, gone.status]);

console.log("plug-ins");
e = new perf.PerformanceEngine({ indicators: [{ id: "x", algorithm: "acme-pro" }] });
check(kpi(e, "x").status === "NO ALGORITHM", "an algorithm that is not installed: NO ALGORITHM");

perf.PerformanceAlgorithms.register({
    id: "test-constant", version: "0.0.1", kpis: ["const"],
    create: function (indicators) {
        let last = null;
        return {
            sample: function (s) { last = s.t; },
            segment: function () { },
            results: function () { return { [indicators[0].id]: { value: indicators[0].value, t: last, detail: "constant" } }; }
        };
    }
});
e = new perf.PerformanceEngine({ indicators: [{ id: "k", algorithm: "test-constant", value: 77 }, { id: "cruise", model: CONFIG.indicators[0].model }] });
fly(e, {}, 40);
check(kpi(e, "k").value === 77 && kpi(e, "k").detail === "constant", "a registered JS algorithm: its KPI is listed", kpi(e, "k"));
check(near(kpi(e, "overall").value, Math.sqrt(77 * 100), 0.01), "... and counts in OVERALL (geometric mean)", kpi(e, "overall"));

e = new perf.PerformanceEngine({ indicators: [{ id: "pro", algorithm: "ems", source: "perf_pro", heartbeat: "perf_hb", staleS: 10 }] });
fly(e, { ems: i => ({ perf_pro: 91.2, perf_pro_status: 0, perf_hb: i }) }, 30);
check(near(kpi(e, "pro").value, 91.2, 1e-6), "\"ems\" algorithm: the posted KPI with a live heartbeat", kpi(e, "pro"));
fly(e, { ems: () => ({ perf_pro: 91.2, perf_hb: 29 }) }, 30, 30);
check(kpi(e, "pro").value === null && kpi(e, "pro").status === "NO DATA", "... NO DATA once the heartbeat stops", kpi(e, "pro"));
e = new perf.PerformanceEngine({ indicators: [{ id: "pro", algorithm: "ems", source: "perf_pro" }] });
fly(e, { ems: () => ({ perf_pro_status: 6 }) }, 3);
check(kpi(e, "pro").status === "LICENSE", "a posted status code: LICENSE", kpi(e, "pro"));

console.log("shipped sample");
const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "web", "RB-01", "settings", "performance.json"), "utf8"));
e = new perf.PerformanceEngine(shipped);
check(e.kpis().length === shipped.indicators.length + 1 && Object.keys(e.missing).length === 0,
    "web/RB-01/settings/performance.json loads, every algorithm is installed");

console.log("\n" + passed + "/" + (passed + failed) + " checks passed");
process.exit(failed ? 1 : 0);
