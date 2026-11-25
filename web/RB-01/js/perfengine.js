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
 * perfengine.js: the aircraft performance engine (docs/performance/implementation.md).
 *
 * Pure: no Angular, no DOM, no clock. It runs in the HMI (addons/js/performance.js
 * feeds it once a second) and in Node (tools/performance/perfrun.js runs it over a
 * recorded flight for training and checking), so the KPIs a pilot sees and the
 * points the trainer fits come from the same code.
 *
 *   sample   one normalized second of flight (perfSampleFromSituation): speeds in kt,
 *            altitudes in ft, vertical speed in ft/min, temperatures in °C
 *   segment  a steady window the detector found: "level" (vertical speed about 0,
 *            wings level, speed and RPM steady) or "climb" (full power, steady
 *            climb), with the means and spreads of its samples
 *   KPI      an indicator in %: 100 is the aircraft as trained (performance.json),
 *            lower is worse. Each algorithm produces some of them; the engine adds
 *            OVERALL, the weighted geometric mean of the valid ones
 *
 * Algorithms register with PerformanceAlgorithms.register(); "rb-open" (this file) is
 * the open reference, "ems" shows a value another process posts into the EMS stream,
 * which is how a closed-source algorithm plugs in (docs/performance/professional-algorithms.md).
 */

var PERF_ENGINE_VERSION = "1.0.0";

// Defaults for every key of performance.json "detector" and "display".
var PERF_DEFAULT_DETECTOR = {
    samplePeriodS: 1.0,     // s between kept samples (the flight log rate)
    windowS: 20,            // s of samples a steady segment spans
    minFill: 0.7,           // fraction of windowS/samplePeriodS samples it must hold
    minSpeedKt: 50,         // airborne
    maxRollDeg: 8,          // wings level
    maxGDev: 0.15,          // |G - 1|: no manoeuvre
    maxSpeedStdKt: 3,       // steady speed
    maxRpmTrend: 50,        // steady power: RPM change between the first and last third
                            // of the window (a throttle movement). Roughness is not a
                            // reason to reject: it is what the fuel KPI measures
    levelVsFpm: 150,        // |mean vertical speed| of a level segment
    maxVsStdFpm: 250,       // and its spread (turbulence)
    climbVsFpm: 300,        // mean vertical speed of a climb segment
    climbMinRpm: 0,         // full power: RPM at or above (0: not checked)
    climbMinMapInHg: 0,     // and manifold pressure at or above (0: not checked)
    emsStaleS: 5            // an EMS value older than this is not used
};

var PERF_DEFAULT_DISPLAY = {
    scaleMin: 50,
    scaleMax: 130,
    fadeS: 300,             // older KPI: drawn dimmed
    holdS: 1800,            // older KPI: withdrawn (--)
    smoothing: 0.5,         // weight of a new segment in the running KPI
    bands: [
        { color: "red", min: 0, max: 70 },
        { color: "yellow", min: 70, max: 90 },
        { color: "green", min: 90, max: 200 }
    ]
};

// ---- atmosphere ------------------------------------------------------------

// ISA temperature (°C) at a pressure altitude (ft)
function perfIsaTempC(pressureAltFt) {
    return 15 - 1.98 * pressureAltFt / 1000;
}

// Density ratio sigma = rho / rho0 at a pressure altitude (ft) and outside air
// temperature (°C); ISA temperature when oatC is null.
function perfDensityRatio(pressureAltFt, oatC) {
    var pa = isFinite(pressureAltFt) ? pressureAltFt : 0;
    var delta = Math.pow(Math.max(1 - 6.8756e-6 * pa, 0.01), 5.2559);   // pressure ratio
    var t = (oatC === null || oatC === undefined || !isFinite(oatC)) ? perfIsaTempC(pa) : oatC;
    var theta = (t + 273.15) / 288.15;
    return delta / theta;
}

// Density altitude (ft) of a density ratio
function perfDensityAltitudeFt(sigma) {
    return (1 - Math.pow(Math.max(sigma, 0.01), 1 / 4.2559)) / 6.8756e-6;
}

// Power a normally aspirated piston engine gives at density ratio sigma, as a
// fraction of sea level ISA (Gagg-Ferrar).
function perfPowerRatio(sigma) {
    return Math.max(0, 1.132 * sigma - 0.132);
}

// ---- small maths -----------------------------------------------------------

function perfFinite(v) {
    return v !== null && v !== undefined && typeof v === "number" && isFinite(v);
}

function perfMean(list) {
    var s = 0, n = 0;
    for (var i = 0; i < list.length; i++) {
        if (perfFinite(list[i])) { s += list[i]; n++; }
    }
    return n ? s / n : null;
}

function perfStd(list) {
    var m = perfMean(list);
    if (m === null) return null;
    var s = 0, n = 0;
    for (var i = 0; i < list.length; i++) {
        if (perfFinite(list[i])) { s += (list[i] - m) * (list[i] - m); n++; }
    }
    return n > 1 ? Math.sqrt(s / (n - 1)) : 0;
}

// The sample-to-sample noise of a series, std(diff)/sqrt(2): roughness without the trend
function perfJitter(list) {
    var d = [];
    for (var i = 1; i < list.length; i++) {
        if (perfFinite(list[i]) && perfFinite(list[i - 1])) d.push(list[i] - list[i - 1]);
    }
    if (d.length < 2) return null;
    return perfStd(d) / Math.SQRT2;
}

function perfClamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// A linear model of performance.json: intercept + sum(coef[i] * x[features[i]]).
// value is null when a feature is missing. outside counts the features out of the
// trained range widened by margin (a fraction of its width).
function perfModelEval(model, x, margin) {
    if (!model || !perfFinite(model.intercept)) return { value: null, outside: 0 };
    var v = model.intercept, outside = 0;
    var features = model.features || [];
    var m = perfFinite(margin) ? margin : 0.1;
    for (var i = 0; i < features.length; i++) {
        var f = features[i], xv = x[f];
        if (!perfFinite(xv) || !perfFinite(model.coef[i])) return { value: null, outside: 0 };
        v += model.coef[i] * xv;
        var r = model.range && model.range[f];
        if (r && r.length == 2) {
            var w = Math.max(r[1] - r[0], 1e-6) * m;
            if (xv < r[0] - w || xv > r[1] + w) outside++;
        }
    }
    return { value: v, outside: outside };
}

// ---- sample ----------------------------------------------------------------

// The EMS keys the reference algorithm reads (lower case, as main/ems.go keeps them).
var PERF_EMS_KEYS = {
    rpm: "enginerpm",
    map: "manifoldpressure",
    oat: "outsidetemperature",
    fuelPressure: "fuelpressure",
    fuelFlow: "fuelflow",
    icingCarb: "icing_carb",
    icingAirframe: "icing_airframe"
};

// One normalized second of flight from the daemon's situation (plus the HMI's wind
// fields, servicesituation.js) and the EMS map. ems may carry "_age" (key -> s since
// it last changed); a value older than emsStaleS is dropped. t is in seconds.
// tools/performance/perf_extract.py builds the same object from a flight log.
function perfSampleFromSituation(situation, ems, t, emsAge, emsStaleS) {
    var s = situation || {};
    var e = ems || {};
    var stale = perfFinite(emsStaleS) ? emsStaleS : PERF_DEFAULT_DETECTOR.emsStaleS;
    function emsValue(key) {
        var v = e[key];
        if (!perfFinite(v)) return null;
        if (emsAge && perfFinite(emsAge[key]) && emsAge[key] > stale) return null;
        return v;
    }
    var oat = emsValue(PERF_EMS_KEYS.oat);
    if (oat !== null && (oat < -60 || oat > 60)) oat = null;   // an open thermocouple (main/icing.go)
    var egt = [], cht = [];
    for (var c = 1; c <= 6; c++) {
        var ev = emsValue("egt" + c), cv = emsValue("cht" + c);
        if (ev !== null && ev > 50) egt.push(ev);
        if (cv !== null && cv > 0) cht.push(cv);
    }
    var ias = perfFinite(s.IndicatedAirSpeed) && s.IndicatedAirSpeed > 0 ? s.IndicatedAirSpeed : null;
    return {
        t: t,
        iasKt: ias,
        gsKt: perfFinite(s.GPSGroundSpeed) ? s.GPSGroundSpeed : null,
        trackDeg: perfFinite(s.GPSTrueCourse) ? s.GPSTrueCourse : null,
        windValid: !!s.WindValid,
        windSpeedKt: perfFinite(s.WindSpeed) ? s.WindSpeed : null,
        windFromDeg: perfFinite(s.WindDirection) ? s.WindDirection : null,
        pitchDeg: perfFinite(s.AHRSPitch) ? s.AHRSPitch : null,
        rollDeg: perfFinite(s.AHRSRoll) ? s.AHRSRoll : null,
        gload: perfFinite(s.AHRSGLoad) ? s.AHRSGLoad : null,
        vsFpm: perfFinite(s.BaroVerticalSpeed) ? s.BaroVerticalSpeed : null,
        pressureAltFt: perfFinite(s.BaroPressureAltitude) ? s.BaroPressureAltitude : null,
        oatC: oat,
        rpm: emsValue(PERF_EMS_KEYS.rpm),
        mapInHg: emsValue(PERF_EMS_KEYS.map),
        fuelPressure: emsValue(PERF_EMS_KEYS.fuelPressure),
        fuelFlow: emsValue(PERF_EMS_KEYS.fuelFlow),
        egt: egt,
        cht: cht,
        icingCarb: emsValue(PERF_EMS_KEYS.icingCarb),
        icingAirframe: emsValue(PERF_EMS_KEYS.icingAirframe),
        ems: e
    };
}

// The derived quantities of a sample: density, true and equivalent airspeed and
// where the airspeed came from ("IAS", "WIND": ground vector minus the HMI's wind,
// "GS": ground speed, biased by the wind).
function perfDerive(sample) {
    var d = {};
    var pa = perfFinite(sample.pressureAltFt) ? sample.pressureAltFt : null;
    d.sigma = pa === null ? null : perfDensityRatio(pa, sample.oatC);
    d.sigmaIsa = pa === null ? null : perfDensityRatio(pa, null);
    d.densityAltFt = d.sigma === null ? null : perfDensityAltitudeFt(d.sigma);
    d.speedSource = null;
    d.tasKt = null;
    d.easKt = null;
    if (perfFinite(sample.iasKt)) {
        d.speedSource = "IAS";
        d.easKt = sample.iasKt;
        d.tasKt = d.sigma ? sample.iasKt / Math.sqrt(d.sigma) : sample.iasKt;
    } else if (perfFinite(sample.gsKt)) {
        var tas = sample.gsKt;
        d.speedSource = "GS";
        if (sample.windValid && perfFinite(sample.windSpeedKt) && perfFinite(sample.windFromDeg) && perfFinite(sample.trackDeg)) {
            // Air vector = ground vector - wind vector (the wind blows towards from + 180)
            var tr = sample.trackDeg * Math.PI / 180, wt = (sample.windFromDeg + 180) * Math.PI / 180;
            var ax = sample.gsKt * Math.sin(tr) - sample.windSpeedKt * Math.sin(wt);
            var ay = sample.gsKt * Math.cos(tr) - sample.windSpeedKt * Math.cos(wt);
            tas = Math.sqrt(ax * ax + ay * ay);
            d.speedSource = "WIND";
        }
        d.tasKt = tas;
        d.easKt = d.sigma ? tas * Math.sqrt(d.sigma) : tas;
    }
    d.invEas2 = perfFinite(d.easKt) && d.easKt > 1 ? (100 / d.easKt) * (100 / d.easKt) : null;
    d.egtSpreadC = sample.egt && sample.egt.length >= 2 ? Math.max.apply(null, sample.egt) - Math.min.apply(null, sample.egt) : null;
    return d;
}

// ---- steady segment detector ------------------------------------------------

function PerfSteadyDetector(config) {
    this.c = Object.assign({}, PERF_DEFAULT_DETECTOR, config || {});
    this.buffer = [];
}

// Adds a sample (with its derived values in sample.d). Returns a segment when the
// window holds a steady one, and then starts a new window: segments never overlap,
// so successive ones are independent measurements.
PerfSteadyDetector.prototype.push = function (sample) {
    var c = this.c;
    var b = this.buffer;
    if (b.length && sample.t < b[b.length - 1].t) b.length = 0;   // the clock went back
    b.push(sample);
    while (b.length && sample.t - b[0].t > c.windowS) b.shift();
    var need = Math.max(3, Math.floor(c.minFill * c.windowS / c.samplePeriodS));
    if (b.length < need || sample.t - b[0].t < c.windowS * 0.9) return null;

    var col = function (f) { return b.map(f); };
    var speed = col(function (x) { return x.d.easKt; });
    var tas = col(function (x) { return x.d.tasKt; });
    var vs = col(function (x) { return x.vsFpm; });
    var roll = col(function (x) { return x.rollDeg; });
    var g = col(function (x) { return x.gload; });
    var rpm = col(function (x) { return x.rpm; });
    var map = col(function (x) { return x.mapInHg; });

    var speedMean = perfMean(speed), vsMean = perfMean(vs);
    if (speedMean === null || vsMean === null || speedMean < c.minSpeedKt) return null;
    for (var i = 0; i < b.length; i++) {
        if (perfFinite(b[i].rollDeg) && Math.abs(b[i].rollDeg) > c.maxRollDeg) return null;
        if (perfFinite(b[i].gload) && Math.abs(b[i].gload - 1) > c.maxGDev) return null;
    }
    if (perfStd(speed) > c.maxSpeedStdKt) return null;
    var rpmMean = perfMean(rpm), rpmStd = perfStd(rpm);
    var third = Math.max(1, Math.floor(b.length / 3));
    var rpmFirst = perfMean(rpm.slice(0, third)), rpmLast = perfMean(rpm.slice(-third));
    if (rpmFirst !== null && rpmLast !== null && Math.abs(rpmLast - rpmFirst) > c.maxRpmTrend) return null;

    var phase = null;
    if (Math.abs(vsMean) <= c.levelVsFpm && perfStd(vs) <= c.maxVsStdFpm) {
        phase = "level";
    } else if (vsMean >= c.climbVsFpm) {
        var mapMean = perfMean(map);
        var fullRpm = !(c.climbMinRpm > 0) || (rpmMean !== null && rpmMean >= c.climbMinRpm);
        var fullMap = !(c.climbMinMapInHg > 0) || (mapMean !== null && mapMean >= c.climbMinMapInHg);
        if (fullRpm && fullMap) phase = "climb";
    }
    if (phase === null) return null;

    var tasMean = perfMean(tas), pitchMean = perfMean(col(function (x) { return x.pitchDeg; }));
    // Flight path angle: in a slight climb part of the pitch is the path, not the wing
    var gamma = tasMean > 1 ? Math.atan(vsMean / (tasMean * 101.269)) * 180 / Math.PI : 0;
    var seg = {
        phase: phase,
        t: sample.t,
        t0: b[0].t,
        n: b.length,
        speedSource: b[b.length - 1].d.speedSource,
        easKt: speedMean,
        iasKt: perfMean(col(function (x) { return x.iasKt; })),
        tasKt: tasMean,
        gsKt: perfMean(col(function (x) { return x.gsKt; })),
        vsFpm: vsMean,
        vsStdFpm: perfStd(vs),
        pitchDeg: pitchMean,
        gammaDeg: gamma,
        aoaPitchDeg: pitchMean === null ? null : pitchMean - gamma,
        rollDeg: perfMean(roll),
        gload: perfMean(g),
        rpm: rpmMean,
        rpmStd: rpmStd,
        rpmJitter: perfJitter(rpm),
        mapInHg: perfMean(map),
        pressureAltFt: perfMean(col(function (x) { return x.pressureAltFt; })),
        oatC: perfMean(col(function (x) { return x.oatC; })),
        densityAltFt: perfMean(col(function (x) { return x.d.densityAltFt; })),
        invEas2: (100 / speedMean) * (100 / speedMean),
        egtSpreadC: perfMean(col(function (x) { return x.d.egtSpreadC; })),
        fuelPressure: perfMean(col(function (x) { return x.fuelPressure; })),
        fuelPressureStd: perfStd(col(function (x) { return x.fuelPressure; })),
        fuelPressureJitter: perfJitter(col(function (x) { return x.fuelPressure; })),
        fuelFlow: perfMean(col(function (x) { return x.fuelFlow; }))
    };
    this.buffer = [];
    return seg;
};

// ---- algorithm registry ----------------------------------------------------

// An algorithm is { id, version, kpis: [ids it can produce], create(indicators, ctx) }.
// create returns an instance with:
//   sample(sample)      every kept second (sample.d holds the derived values)
//   segment(segment)    every steady segment
//   results(now)        { kpiId: { value, status, detail, quality, t } } for the KPIs it
//                       has; value null with a status when it has none yet
// indicators are the entries of performance.json "indicators" that name this algorithm.
// ctx: { config, display, engine }.
var PerformanceAlgorithms = {
    registry: {},
    register: function (algorithm) {
        if (!algorithm || !algorithm.id || typeof algorithm.create !== "function") {
            throw new Error("PerformanceAlgorithms.register: needs id and create()");
        }
        this.registry[algorithm.id] = algorithm;
    },
    get: function (id) {
        return this.registry[id] || null;
    }
};

// A running KPI: successive measurements blended with the display smoothing.
function perfBlend(prev, value, t, smoothing, extra) {
    var out = Object.assign({}, extra || {});
    if (prev && perfFinite(prev.value)) {
        out.value = prev.value + smoothing * (value - prev.value);
        out.count = (prev.count || 1) + 1;
    } else {
        out.value = value;
        out.count = 1;
    }
    out.t = t;
    out.status = out.status || "";
    return out;
}

// ---- rb-open: the open reference algorithm ----------------------------------
//
//   cruise    level: TAS against the trained TAS at this RPM (and MAP, density...)
//   attitude  level: the angle of attack the wing needs. pitch - path angle =
//             a + b * (100/EAS)^2 in level flight; extra pitch means more lift needed
//             (weight, ice, a dirty wing), less means lighter.
//             % = aoaRef / (aoaRef + extra pitch)
//   climb     climb: vertical speed against the trained one at this density altitude
//   engine    climb: full power RPM against the trained one, cubed (power of a fixed
//             pitch propeller)
//   fuel      level and climb: EGT spread between cylinders, RPM and fuel pressure
//             roughness against their trained levels (dirty fuel, a fouled plug)
//   density   every second: engine power at today's air against standard air at the
//             same pressure altitude (summer heat, Gagg-Ferrar)
//   icing     every second: 100 - the icing advisories of main/icing.go

var PERF_OPEN_STATUS = {
    untrained: "UNTRAINED",
    waitLevel: "WAIT LEVEL",
    waitClimb: "WAIT CLIMB",
    noRpm: "NO RPM",
    noSpeed: "NO SPEED",
    noOat: "NO OAT",
    noData: "NO DATA",
    outside: "OUT OF RANGE"
};

function PerfOpenAlgorithm(indicators, ctx) {
    this.ind = {};
    for (var i = 0; i < indicators.length; i++) this.ind[indicators[i].id] = indicators[i];
    this.display = ctx.display;
    this.out = {};
    this.lastSampleT = null;
}

// A reason for no value. A sticky one (from a segment: OUT OF RANGE, UNTRAINED) stays
// until the next measurement; the others are worked out again every second.
PerfOpenAlgorithm.prototype.status = function (id, status, sticky) {
    var o = this.out[id];
    if (o && perfFinite(o.value)) return;
    if (o && o.sticky && !sticky) return;
    this.out[id] = { value: null, status: status, sticky: !!sticky };
};

PerfOpenAlgorithm.prototype.measure = function (id, value, t, extra) {
    if (!perfFinite(value)) return;
    var v = perfClamp(value, 0, 200);
    var ind = this.ind[id] || {};
    var a = perfFinite(ind.smoothing) ? ind.smoothing : this.display.smoothing;
    this.out[id] = perfBlend(this.out[id], v, t, a, extra);
};

// The rated value of a model, or the reason there is none.
PerfOpenAlgorithm.prototype.expect = function (id, x) {
    var ind = this.ind[id];
    if (!ind) return null;
    if (!ind.model) { this.status(id, PERF_OPEN_STATUS.untrained, true); return null; }
    var e = perfModelEval(ind.model, x, ind.model.rangeMargin);
    if (e.value === null) { this.status(id, PERF_OPEN_STATUS.noData, true); return null; }
    if (e.outside > 0) { this.status(id, PERF_OPEN_STATUS.outside, true); return null; }
    return e.value;
};

PerfOpenAlgorithm.prototype.sample = function (s) {
    this.lastSampleT = s.t;
    var d = s.d;
    for (var k in this.out) {
        if (!perfFinite(this.out[k].value) && !this.out[k].sticky) delete this.out[k];
    }
    if (this.ind.density) {
        if (d.sigma === null) this.status("density", PERF_OPEN_STATUS.noData);
        else if (s.oatC === null) this.status("density", PERF_OPEN_STATUS.noOat);
        else {
            var p = perfPowerRatio(d.sigma), p0 = perfPowerRatio(d.sigmaIsa);
            var isaDev = s.oatC - perfIsaTempC(s.pressureAltFt);
            // Every second: a slower blend so a sample does not jump it
            var prev = this.out.density;
            var v = p0 > 0 ? 100 * p / p0 : null;
            if (v !== null) {
                var a = prev && perfFinite(prev.value) ? 0.1 : 1;
                this.out.density = {
                    value: prev && perfFinite(prev.value) ? prev.value + a * (v - prev.value) : v,
                    t: s.t, status: "",
                    detail: "ISA" + (isaDev >= 0 ? "+" : "") + Math.round(isaDev) + "° DA " + Math.round(d.densityAltFt / 100) * 100 + "ft"
                };
            }
        }
    }
    if (this.ind.icing) {
        var ind = this.ind.icing;
        var carbW = perfFinite(ind.carbWeight) ? ind.carbWeight : 1;
        var risks = [];
        if (perfFinite(s.icingAirframe)) risks.push(s.icingAirframe);
        if (perfFinite(s.icingCarb)) risks.push(s.icingCarb * carbW);
        if (!risks.length) this.status("icing", PERF_OPEN_STATUS.noData);
        else {
            var risk = Math.max.apply(null, risks);
            this.out.icing = {
                value: perfClamp(100 - risk, 0, 100), t: s.t, status: "",
                detail: "carb " + (perfFinite(s.icingCarb) ? Math.round(s.icingCarb) : "--") + "% · airframe " +
                    (perfFinite(s.icingAirframe) ? Math.round(s.icingAirframe) : "--") + "%"
            };
        }
    }
    // Before the first segment, say what is missing
    ["cruise", "attitude", "climb", "engine"].forEach(function (k) {
        if (this.ind[k] && !this.ind[k].model) this.status(k, PERF_OPEN_STATUS.untrained, true);
    }, this);
    if (s.rpm === null) {
        ["cruise", "engine", "fuel"].forEach(function (k) { this.status(k, PERF_OPEN_STATUS.noRpm); }, this);
    }
    if (d.speedSource === null) {
        ["cruise", "attitude", "climb"].forEach(function (k) { this.status(k, PERF_OPEN_STATUS.noSpeed); }, this);
    }
    ["cruise", "attitude", "fuel"].forEach(function (k) {
        if (this.ind[k] && !this.out[k]) this.status(k, PERF_OPEN_STATUS.waitLevel);
    }, this);
    ["climb", "engine"].forEach(function (k) {
        if (this.ind[k] && !this.out[k]) this.status(k, PERF_OPEN_STATUS.waitClimb);
    }, this);
};

PerfOpenAlgorithm.prototype.segment = function (seg) {
    var x = seg;   // the segment carries every feature name the trainer may use
    var quality = seg.speedSource;
    if (seg.phase == "level") {
        if (this.ind.cruise && perfFinite(seg.rpm)) {
            var tasExp = this.expect("cruise", x);
            if (tasExp !== null && tasExp > 10 && perfFinite(seg.tasKt)) {
                this.measure("cruise", 100 * seg.tasKt / tasExp, seg.t, {
                    quality: quality,
                    detail: Math.round(seg.tasKt) + " kt TAS / " + Math.round(tasExp) + " @ " + Math.round(seg.rpm) + " rpm"
                });
            }
        }
        if (this.ind.attitude && perfFinite(seg.aoaPitchDeg)) {
            var ind = this.ind.attitude;
            var pitchExp = this.expect("attitude", x);
            if (pitchExp !== null) {
                // The angle of attack the model expects at this speed: its 1/EAS² term,
                // or the configured cruise AoA when the training could not separate it
                var b = ind.model.features && ind.model.features[0] == "invEas2" ? ind.model.coef[0] * seg.invEas2 : 0;
                var aoaRef = Math.max(perfFinite(ind.minAoaDeg) ? ind.minAoaDeg : 2.5, b > 0 ? b : (perfFinite(ind.aoaRefDeg) ? ind.aoaRefDeg : 4));
                var extra = seg.aoaPitchDeg - pitchExp;
                var kpi = 100 * aoaRef / Math.max(aoaRef + extra, 0.1);
                var detail = (extra >= 0 ? "+" : "") + extra.toFixed(1) + "° pitch";
                if (perfFinite(ind.referenceMassKg)) {
                    detail += " · ≈" + Math.round(ind.referenceMassKg * 100 / kpi) + " kg";
                }
                this.measure("attitude", kpi, seg.t, { quality: quality, detail: detail });
            }
        }
    }
    if (seg.phase == "climb") {
        if (this.ind.climb) {
            var vsExp = this.expect("climb", x);
            if (vsExp !== null && vsExp > 100) {
                this.measure("climb", 100 * seg.vsFpm / vsExp, seg.t, {
                    quality: quality,
                    detail: Math.round(seg.vsFpm) + " / " + Math.round(vsExp) + " fpm @ DA " + Math.round(seg.densityAltFt / 100) * 100 + "ft"
                });
            }
        }
        if (this.ind.engine && perfFinite(seg.rpm)) {
            var rpmExp = this.expect("engine", x);
            if (rpmExp !== null && rpmExp > 100) {
                this.measure("engine", 100 * Math.pow(seg.rpm / rpmExp, 3), seg.t, {
                    quality: quality,
                    detail: Math.round(seg.rpm) + " / " + Math.round(rpmExp) + " rpm full power"
                });
            }
        }
    }
    if (this.ind.fuel) {
        var f = this.ind.fuel;
        var pens = [], parts = [];
        function penalty(v, ref, tol) {
            if (!perfFinite(v) || !perfFinite(ref) || !(tol > 0)) return null;
            return perfClamp((v - ref) / tol, 0, 1);
        }
        var pe = penalty(seg.egtSpreadC, f.egtSpreadRefC, f.egtSpreadTolC);
        if (pe !== null) { pens.push(pe); parts.push("EGT Δ" + Math.round(seg.egtSpreadC) + "°"); }
        var pr = penalty(seg.rpmJitter, f.rpmJitterRef, f.rpmJitterTol);
        if (pr !== null) { pens.push(pr); parts.push("RPM ±" + Math.round(seg.rpmJitter)); }
        var pf = penalty(seg.fuelPressureJitter, f.fuelPressureJitterRef, f.fuelPressureJitterTol);
        if (pf !== null) { pens.push(pf); parts.push("FP ±" + seg.fuelPressureJitter.toFixed(1)); }
        if (pens.length) {
            // The worst symptom counts double: one bad cylinder is enough
            var worst = Math.max.apply(null, pens);
            var mean = pens.reduce(function (a, v) { return a + v; }, 0) / pens.length;
            this.measure("fuel", 100 * (1 - (2 * worst + mean) / 3), seg.t, { quality: quality, detail: parts.join(" · ") });
        } else if (!f.egtSpreadRefC && !f.rpmJitterRef && !f.fuelPressureJitterRef) {
            this.status("fuel", PERF_OPEN_STATUS.untrained, true);
        }
    }
};

PerfOpenAlgorithm.prototype.results = function () {
    return this.out;
};

PerformanceAlgorithms.register({
    id: "rb-open",
    version: "1.0.0",
    kpis: ["cruise", "attitude", "climb", "engine", "fuel", "density", "icing"],
    create: function (indicators, ctx) { return new PerfOpenAlgorithm(indicators, ctx); }
});

// ---- ems: a value another process computes ----------------------------------
//
// An indicator { "algorithm": "ems", "source": "perf_cruise" } shows the EMS key
// perf_cruise (a % already). A closed-source algorithm runs as its own process and
// POSTs its KPIs to the daemon like any EMS sender (docs/performance/professional-algorithms.md).
// It may also post "<source>_status" (an index of PERF_EMS_STATUS) and
// "<source>_quality" (0 bad .. 1 good). The EMS stream only carries changes, so
// freshness is not judged from the KPI: with "heartbeat": "<key>" the indicator reads
// NO DATA once that key (a counter the process bumps every second) stops changing for
// staleS seconds (default 10).

var PERF_EMS_STATUS = ["", "UNTRAINED", "WAIT LEVEL", "WAIT CLIMB", "NO DATA", "OUT OF RANGE", "LICENSE"];

function PerfEmsAlgorithm(indicators, ctx) {
    this.indicators = indicators;
    this.out = {};
    this.beats = {};
}

PerfEmsAlgorithm.prototype.sample = function (s) {
    var ems = s.ems || {};
    for (var i = 0; i < this.indicators.length; i++) {
        var ind = this.indicators[i];
        var key = ind.source;
        var v = ems[key];
        var st = ems[key + "_status"];
        var stale = false;
        if (ind.heartbeat) {
            var hb = ems[ind.heartbeat];
            var beat = this.beats[ind.heartbeat];
            if (!beat || beat.v !== hb) beat = this.beats[ind.heartbeat] = { v: hb, t: s.t };
            stale = !perfFinite(hb) || s.t - beat.t > (perfFinite(ind.staleS) ? ind.staleS : 10);
        }
        if (perfFinite(v) && !stale) {
            this.out[ind.id] = {
                value: perfClamp(v, 0, 200), t: s.t,
                status: perfFinite(st) ? (PERF_EMS_STATUS[st] || "") : "",
                quality: perfFinite(ems[key + "_quality"]) ? ems[key + "_quality"] : null,
                detail: ind.detail || ""
            };
        } else {
            this.out[ind.id] = { value: null, status: !stale && perfFinite(st) && PERF_EMS_STATUS[st] ? PERF_EMS_STATUS[st] : "NO DATA" };
        }
    }
};

PerfEmsAlgorithm.prototype.segment = function () { };
PerfEmsAlgorithm.prototype.results = function () { return this.out; };

PerformanceAlgorithms.register({
    id: "ems",
    version: "1.0.0",
    kpis: [],
    create: function (indicators, ctx) { return new PerfEmsAlgorithm(indicators, ctx); }
});

// ---- engine ----------------------------------------------------------------

// config: the parsed performance.json. Indicators naming an algorithm that is not
// registered read "NO ALGORITHM": a professional build that is not installed.
function PerformanceEngine(config) {
    var cfg = config || {};
    this.config = {
        detector: Object.assign({}, PERF_DEFAULT_DETECTOR, cfg.detector || {}),
        display: Object.assign({}, PERF_DEFAULT_DISPLAY, cfg.display || {}),
        overall: Object.assign({ enabled: true, label: "OVERALL", minIndicators: 2 }, cfg.overall || {}),
        indicators: Array.isArray(cfg.indicators) ? cfg.indicators.filter(function (i) { return i && i.id && i.enabled !== false; }) : []
    };
    this.detector = new PerfSteadyDetector(this.config.detector);
    this.instances = [];
    this.missing = {};
    this.lastT = null;
    this.segments = [];          // collect mode: every segment found
    this.collect = false;
    var groups = {};
    this.config.indicators.forEach(function (ind) {
        var alg = ind.algorithm || "rb-open";
        (groups[alg] = groups[alg] || []).push(ind);
    });
    var ctx = { config: this.config, display: this.config.display, engine: this };
    for (var id in groups) {
        var algorithm = PerformanceAlgorithms.get(id);
        if (!algorithm) {
            groups[id].forEach(function (ind) { this.missing[ind.id] = true; }, this);
            continue;
        }
        this.instances.push(algorithm.create(groups[id], ctx));
    }
}

// Feeds one sample (perfSampleFromSituation). Samples closer than samplePeriodS to
// the last kept one are skipped; returns the segment it completed, if any.
PerformanceEngine.prototype.observe = function (sample) {
    var c = this.config.detector;
    if (!sample || !perfFinite(sample.t)) return null;
    if (this.lastT !== null && sample.t >= this.lastT && sample.t - this.lastT < c.samplePeriodS * 0.95) return null;
    this.lastT = sample.t;
    sample.d = perfDerive(sample);
    for (var i = 0; i < this.instances.length; i++) this.instances[i].sample(sample);
    var seg = this.detector.push(sample);
    if (seg) {
        if (this.collect) this.segments.push(seg);
        for (var j = 0; j < this.instances.length; j++) this.instances[j].segment(seg);
    }
    return seg;
};

// The KPIs in the order of performance.json, each
//   { id, label, value (% or null), status, detail, quality, age (s), fade (0..1), weight }
// with OVERALL first when enabled. now is the time of the last sample when omitted.
PerformanceEngine.prototype.kpis = function (now) {
    var t = perfFinite(now) ? now : this.lastT;
    var disp = this.config.display;
    var all = {};
    for (var i = 0; i < this.instances.length; i++) Object.assign(all, this.instances[i].results());
    var list = [];
    var sumW = 0, sumLog = 0, used = 0;
    this.config.indicators.forEach(function (ind) {
        var r = all[ind.id] || {};
        var k = {
            id: ind.id,
            label: ind.label || ind.id.toUpperCase(),
            value: perfFinite(r.value) ? r.value : null,
            status: this.missing[ind.id] ? "NO ALGORITHM" : (r.status || (perfFinite(r.value) ? "" : "NO DATA")),
            detail: r.detail || "",
            quality: r.quality || null,
            weight: perfFinite(ind.weight) ? ind.weight : 1,
            age: null,
            fade: 1,
            bands: ind.bands || disp.bands
        };
        if (k.value !== null && perfFinite(r.t) && perfFinite(t)) {
            k.age = Math.max(0, t - r.t);
            if (k.age > disp.holdS) { k.value = null; k.status = "EXPIRED"; }
            else if (k.age > disp.fadeS) k.fade = 0.5;
        }
        if (k.value !== null && k.weight > 0) {
            sumW += k.weight;
            sumLog += k.weight * Math.log(Math.max(k.value, 1));
            used++;
        }
        list.push(k);
    }, this);
    if (this.config.overall.enabled) {
        var ok = used >= this.config.overall.minIndicators && sumW > 0;
        list.unshift({
            id: "overall",
            label: this.config.overall.label,
            value: ok ? Math.exp(sumLog / sumW) : null,
            status: ok ? "" : "NO DATA",
            detail: used + " of " + this.config.indicators.length + " indicators",
            quality: null,
            weight: 0,
            age: 0,
            fade: 1,
            bands: this.config.overall.bands || disp.bands
        });
    }
    return list;
};

// The colour of the band holding v, the most severe on a shared bound (main/ems.go ruleColor).
function perfBandColor(bands, v) {
    if (!perfFinite(v)) return "";
    var order = ["red", "yellow", "green", "white"];
    for (var o = 0; o < order.length; o++) {
        for (var i = 0; i < (bands || []).length; i++) {
            var b = bands[i];
            if (b.color == order[o] && v >= Number(b.min) && v <= Number(b.max)) return b.color;
        }
    }
    return "";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        PERF_ENGINE_VERSION: PERF_ENGINE_VERSION,
        PERF_DEFAULT_DETECTOR: PERF_DEFAULT_DETECTOR,
        PERF_DEFAULT_DISPLAY: PERF_DEFAULT_DISPLAY,
        PerformanceEngine: PerformanceEngine,
        PerformanceAlgorithms: PerformanceAlgorithms,
        PerfSteadyDetector: PerfSteadyDetector,
        perfSampleFromSituation: perfSampleFromSituation,
        perfDerive: perfDerive,
        perfDensityRatio: perfDensityRatio,
        perfDensityAltitudeFt: perfDensityAltitudeFt,
        perfPowerRatio: perfPowerRatio,
        perfIsaTempC: perfIsaTempC,
        perfModelEval: perfModelEval,
        perfBandColor: perfBandColor
    };
}
