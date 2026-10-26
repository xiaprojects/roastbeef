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
 * 07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
 * 08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
    windestimator.js: the wind for the RB-01 display, two ways
    Features:
        - Airspeed + GPS fit (WindSource "tas"): no heading at all. While the
          course changes, the ground vector minus the wind must keep the length
          of the true airspeed, |Vg - W| = k * TAS, whichever way the nose
          points. A turn of 30-60 degrees pins the wind, a turn past ~140
          degrees also gives k, the scale of the airspeed system (one aircraft
          read TAS 2.5% high). The fit is held through straight flight for up to
          WIND_HOLD seconds or WIND_HOLD_ALT feet of altitude change.
        - Compass triangle (WindSource "ias", or "gs" without an airspeed): the
          ground vector minus the airspeed along the true heading
          (AHRSMagHeading + MagneticVariation, variation.js), averaged as a
          vector over WIND_COMPASS_WINDOW seconds of steady flight. Turns are
          left out: the heading lags and the aircraft slips. Every degree of
          heading error moves this wind by TAS/57 kt (2.4 kt at 140 kt TAS), so
          it is the fallback, used only while no fit is held.
        - Driven by the data clock (GPSLastFixSinceMidnightUTC), not the wall
          clock, so a replay or a test runs it as fast as it is fed. At most one
          sample per WIND_SAMPLE_PERIOD; a clock that goes backwards restarts it.

    Pure: no Angular, no DOM. servicesituation.js feeds it every frame with
    observe() and publishes estimate() into the situation.
*/

var WIND_SAMPLE_PERIOD = 1.0;   // s of data time between kept samples
var WIND_MIN_GS = 30;           // kt: below this the track means nothing
var WIND_MIN_TAS = 40;          // kt: airborne, for the airspeed fit
var WIND_FIT_WINDOW = 180;      // s of samples the airspeed fit looks at
var WIND_FIT_MIN_SAMPLES = 30;
var WIND_FIT_SPREAD = 0.06;     // course spread to fit the wind: smaller
                                // eigenvalue of the track scatter matrix, 0 for
                                // a straight line, 0.5 for a full circle; 0.06 is
                                // two legs 30 degrees apart or a 60 degree turn
var WIND_FIT_SPREAD_SCALE = 0.35; // ... and to fit the airspeed scale k too (~140 deg)
var WIND_FIT_SCALE_ALT = 1000;  // ft: k only from a near-level turn, the wind
                                // changes with height in a climbing one
var WIND_FIT_SCALE_RMS = 3;     // kt: and only from a clean fit (not a loop)
var WIND_FIT_RMS_MAX = 5;       // kt: residual of an acceptable fit
var WIND_FIT_SE_MAX = 2;        // kt: its standard error along the weakest direction
var WIND_SCALE_MIN = 0.85;      // plausible airspeed scale
var WIND_SCALE_MAX = 1.15;
var WIND_HOLD = 900;            // s a fitted wind is kept in straight flight
var WIND_HOLD_ALT = 2000;       // ft of altitude change that retires it
var WIND_COMPASS_WINDOW = 45;   // s of steady compass-triangle samples averaged
var WIND_COMPASS_MIN = 5;       // samples needed in that window
var WIND_STEADY_ROLL = 10;      // deg of bank that makes a sample a turn
var WIND_STEADY_TURN = 3;       // deg/s of track rate that makes a sample a turn
var WIND_MAX_DRIFT = 45;        // deg between heading and track: compass not trusted
var WIND_FIT_MAX_ROLL = 60;     // deg: beyond, the pitot is not trusted either
var WIND_FIT_MAX_PITCH = 30;

// True airspeed in knots from IAS (knots) with the ISA density ratio at the
// pressure altitude (feet); 0 when there is no airspeed source.
function windTrueAirspeed(situation) {
    var ias = situation.IndicatedAirSpeed ?? 0;
    if (!isFinite(ias) || ias <= 0)
        return 0;
    var pa = situation.BaroPressureAltitude ?? situation.GPSAltitudeMSL ?? 0;
    if (!isFinite(pa))
        pa = 0;
    var sigma = Math.pow(Math.max(1 - 6.8756e-6 * pa, 0.01), 4.2559);
    return ias / Math.sqrt(sigma);
}

// -180..180, wrap safe
function windAngleDiff(a, b) {
    return ((a - b + 540) % 360) - 180;
}

// An attitude angle the AHRS really reported (not the 3276.7 invalid sentinel)
function windAttitude(v) {
    return (typeof v === "number" && isFinite(v) && Math.abs(v) <= 360) ? v : null;
}

// True heading from the magnetic AHRSMagHeading and the variation, null when
// there is no heading. Without a known variation the heading is taken as true.
function windTrueHeading(situation) {
    var hdg = windAttitude(situation.AHRSMagHeading);
    if (hdg === null)
        return null;
    var v = situation.MagneticVariationValid === true ? situation.MagneticVariation : 0;
    if (typeof v !== "number" || !isFinite(v))
        v = 0;
    return ((hdg + v) % 360 + 360) % 360;
}

function WindEstimator() {
    this.reset();
}

WindEstimator.prototype = {
    constructor: WindEstimator,

    // keepScale: a clock restart is not a new airspeed system
    reset: function (keepScale) {
        if (!keepScale)
            this.tasScale = 1;
        this.now = null;        // data time of the newest frame, s
        this.lastRaw = null;    // raw GPSLastFixSinceMidnightUTC, for the midnight wrap
        this.dayOffset = 0;
        this.last = null;       // newest kept sample
        this.fitSamples = [];   // airborne samples for the airspeed fit
        this.compass = [];      // steady compass-triangle winds
        this.fit = null;        // held airspeed fit: {e, n, t, alt, rms, scale}
    },

    // Data time in seconds, unwrapped across midnight; null when unusable
    dataTime: function (situation) {
        var raw = situation.GPSLastFixSinceMidnightUTC;
        if (typeof raw !== "number" || !isFinite(raw) || raw <= 0)
            return Date.now() / 1000;
        if (this.lastRaw !== null && raw < this.lastRaw - 43200)
            this.dayOffset += 86400;
        this.lastRaw = raw;
        return raw + this.dayOffset;
    },

    observe: function (situation) {
        if (!(situation.GPSFixQuality > 0))
            return;
        var t = this.dataTime(situation);
        if (this.now !== null && t < this.now) {
            // the clock went backwards: a replay restarted, or a new receiver
            this.reset(true);
            t = this.dataTime(situation);
        }
        if (this.now === null || t > this.now)
            this.now = t;
        if (this.last !== null && t - this.last.t < WIND_SAMPLE_PERIOD)
            return;

        var gs = situation.GPSGroundSpeed;
        var trk = situation.GPSTrueCourse;
        var ias = situation.IndicatedAirSpeed ?? 0;
        if (!isFinite(gs) || !isFinite(trk) || !isFinite(ias) || ias < 0)
            return;
        var s = {
            t: t,
            gs: gs,
            trk: trk,
            tas: windTrueAirspeed(situation),
            hdg: windTrueHeading(situation),
            roll: windAttitude(situation.AHRSRoll),
            pitch: windAttitude(situation.AHRSPitch),
            alt: situation.BaroPressureAltitude ?? situation.GPSAltitudeMSL ?? 0,
            vz: (situation.GPSVerticalSpeed ?? 0) * 0.592484 // ft/s -> kt
        };
        var rate = null;
        if (this.last !== null && t - this.last.t <= 5)
            rate = windAngleDiff(trk, this.last.trk) / (t - this.last.t);
        this.last = s;
        if (gs < WIND_MIN_GS)
            return;

        // Airspeed fit: any attitude a pitot can still be trusted at
        if (s.tas >= WIND_MIN_TAS
            && (s.roll === null || Math.abs(s.roll) <= WIND_FIT_MAX_ROLL)
            && (s.pitch === null || Math.abs(s.pitch) <= WIND_FIT_MAX_PITCH)) {
            this.fitSamples.push(s);
            while (this.fitSamples.length > 0 && this.fitSamples[0].t < t - WIND_FIT_WINDOW)
                this.fitSamples.shift();
            this.tryFit();
        }

        // Compass triangle: steady flight only
        var steady = (s.roll === null || Math.abs(s.roll) < WIND_STEADY_ROLL)
            && (rate === null || Math.abs(rate) < WIND_STEADY_TURN);
        if (s.hdg !== null && steady && Math.abs(windAngleDiff(trk, s.hdg)) < WIND_MAX_DRIFT) {
            var source = s.tas > 0 ? "ias" : "gs";
            var air = s.tas > 0 ? s.tas * this.tasScale : gs;
            if (this.compass.length > 0 && this.compass[0].source !== source)
                this.compass = []; // never average an airspeed wind with a drift-only one
            this.compass.push({
                t: t,
                source: source,
                e: gs * Math.sin(trk * Math.PI / 180) - air * Math.sin(s.hdg * Math.PI / 180),
                n: gs * Math.cos(trk * Math.PI / 180) - air * Math.cos(s.hdg * Math.PI / 180)
            });
        }
        while (this.compass.length > 0 && this.compass[0].t <= t - WIND_COMPASS_WINDOW)
            this.compass.shift();
    },

    // Fit |Vg - W| = k * TAS over the window when the course has changed enough.
    tryFit: function () {
        var ss = this.fitSamples;
        var n = ss.length;
        if (n < WIND_FIT_MIN_SAMPLES)
            return;
        // Course spread: smaller eigenvalue of the mean track scatter matrix
        var sxx = 0, sxy = 0, syy = 0;
        for (var i = 0; i < n; i++) {
            var a = ss[i].trk * Math.PI / 180;
            sxx += Math.sin(a) * Math.sin(a);
            sxy += Math.sin(a) * Math.cos(a);
            syy += Math.cos(a) * Math.cos(a);
        }
        var spread = windMinEigen(sxx / n, sxy / n, syy / n);
        if (spread < WIND_FIT_SPREAD)
            return;
        var altLo = Infinity, altHi = -Infinity;
        for (var j = 0; j < n; j++) {
            altLo = Math.min(altLo, ss[j].alt);
            altHi = Math.max(altHi, ss[j].alt);
        }
        var fitScale = spread >= WIND_FIT_SPREAD_SCALE && altHi - altLo <= WIND_FIT_SCALE_ALT;
        var r = windFitAirspeed(ss, this.fit ? this.fit.e : 0, this.fit ? this.fit.n : 0,
            this.tasScale, fitScale);
        if (r === null)
            return;
        if (r.rms > WIND_FIT_RMS_MAX || r.se > WIND_FIT_SE_MAX || Math.hypot(r.e, r.n) > 150)
            return;
        if (fitScale) {
            if (r.scale < WIND_SCALE_MIN || r.scale > WIND_SCALE_MAX)
                return;
            if (r.rms <= WIND_FIT_SCALE_RMS)
                this.tasScale = r.scale;
        }
        var last = ss[n - 1];
        this.fit = { e: r.e, n: r.n, t: last.t, alt: last.alt, rms: r.rms, scale: this.tasScale };
    },

    // {valid, speed (kt), direction (deg FROM, METAR style), source}
    estimate: function (situation) {
        var none = { valid: false, speed: 0, direction: 0, source: "" };
        if (!(situation.GPSFixQuality > 0) || this.now === null)
            return none;
        var alt = situation.BaroPressureAltitude ?? situation.GPSAltitudeMSL ?? 0;
        if (this.fit !== null && this.now - this.fit.t <= WIND_HOLD
            && Math.abs(alt - this.fit.alt) <= WIND_HOLD_ALT)
            return windResult(this.fit.e, this.fit.n, "tas");
        var c = this.compass;
        var e = 0, nn = 0, k = 0;
        for (var i = 0; i < c.length; i++) {
            if (c[i].t > this.now - WIND_COMPASS_WINDOW) {
                e += c[i].e;
                nn += c[i].n;
                k++;
            }
        }
        if (k < WIND_COMPASS_MIN)
            return none;
        return windResult(e / k, nn / k, c[c.length - 1].source);
    }
};

// e/n: the wind vector, where it blows TO, kt
function windResult(e, n, source) {
    return {
        valid: true,
        speed: Math.hypot(e, n),
        direction: (Math.atan2(-e, -n) * 180 / Math.PI + 360) % 360,
        source: source
    };
}

// Smaller eigenvalue of the symmetric matrix [[a, b], [b, c]]
function windMinEigen(a, b, c) {
    var m = (a + c) / 2;
    var d = Math.sqrt(Math.max(0, (a - c) * (a - c) / 4 + b * b));
    return m - d;
}

// Gauss-Newton for |Vg - W| = k * TASh. Returns {e, n, scale, rms, se} in kt,
// se the standard error of W along its weakest direction, or null.
function windFitAirspeed(samples, e0, n0, scale0, fitScale) {
    var we = e0, wn = n0, k = scale0, rms = 0, se = 0;
    var m = fitScale ? 3 : 2;
    for (var it = 0; it < 30; it++) {
        var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        var B = [0, 0, 0];
        var ss = 0;
        for (var i = 0; i < samples.length; i++) {
            var s = samples[i];
            var a = s.trk * Math.PI / 180;
            var de = s.gs * Math.sin(a) - we;
            var dn = s.gs * Math.cos(a) - wn;
            var len = Math.hypot(de, dn);
            if (len < 1)
                continue;
            var th = s.tas;
            if (Math.abs(s.vz) < th)
                th = Math.sqrt(th * th - s.vz * s.vz);
            var res = len - k * th;
            var J = [-de / len, -dn / len, -th];
            ss += res * res;
            for (var p = 0; p < m; p++) {
                B[p] -= J[p] * res;
                for (var q = 0; q < m; q++)
                    A[p][q] += J[p] * J[q];
            }
        }
        var d = windSolve(A, B, m);
        if (d === null)
            return null;
        we += d[0];
        wn += d[1];
        if (fitScale)
            k += d[2];
        rms = Math.sqrt(ss / samples.length);
        var lmin = windMinEigen(A[0][0], A[0][1], A[1][1]);
        se = lmin > 0 ? rms / Math.sqrt(lmin) : Infinity;
        if (Math.abs(d[0]) + Math.abs(d[1]) < 0.01)
            return { e: we, n: wn, scale: k, rms: rms, se: se };
    }
    return null; // did not converge
}

// Solve the m x m (2 or 3) system A x = B by Cramer's rule; null when singular
function windSolve(A, B, m) {
    if (m === 2) {
        var det2 = A[0][0] * A[1][1] - A[0][1] * A[1][0];
        if (Math.abs(det2) < 1e-9)
            return null;
        return [(B[0] * A[1][1] - B[1] * A[0][1]) / det2, (A[0][0] * B[1] - A[1][0] * B[0]) / det2, 0];
    }
    function det3(M) {
        return M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
            - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
            + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    }
    var det = det3(A);
    if (Math.abs(det) < 1e-9)
        return null;
    var x = [0, 0, 0];
    for (var c = 0; c < 3; c++) {
        var M = [A[0].slice(), A[1].slice(), A[2].slice()];
        for (var r = 0; r < 3; r++)
            M[r][c] = B[r];
        x[c] = det3(M) / det;
    }
    return x;
}

if (typeof module !== "undefined")
    module.exports = { WindEstimator: WindEstimator, windTrueAirspeed: windTrueAirspeed };
