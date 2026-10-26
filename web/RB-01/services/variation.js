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
    variation.js: magnetic variation (declination) at the aircraft
    Features:
        - Reads /settings/deviation.json once (retried until it loads): a World
          Magnetic Model grid written by scripts/gen_deviation.py, see
          docs/http-api.md for the format
        - Bilinear between the four nodes around the position, plus the annual
          change times the years off the grid date
        - East positive: magnetic = true - variation, true = magnetic + variation
        - Outside the grid there is no variation (valid false, value 0): the
          compass then stays the true-referenced one the magnetometer addon's
          OFFSET FROM GPS TRACK makes it. Outside the model's validFrom..validTo
          the value is still given, flagged expired: the annual change
          extrapolates it, which beats no variation at all.

    Pure apart from load(): no Angular, no DOM. servicesituation.js publishes
    it in every situation as MagneticVariation / MagneticVariationValid /
    MagneticVariationExpired.
*/

function MagneticVariation() {
    this.grid = null;
}

MagneticVariation.prototype = {
    constructor: MagneticVariation,

    // Accept a deviation.json object; false (and no grid) when it is malformed
    setGrid: function (g) {
        this.grid = null;
        if (!g || !g.planimetry || !g.planimetry.start || !g.planimetry.end || !g.step
            || !Array.isArray(g.declination))
            return false;
        var s = g.planimetry.start, e = g.planimetry.end;
        var rows = Math.round((e.lat - s.lat) / g.step.lat) + 1;
        var cols = Math.round((e.lon - s.lon) / g.step.lon) + 1;
        if (!(rows >= 2 && cols >= 2 && g.step.lat > 0 && g.step.lon > 0))
            return false;
        var shaped = function (m) {
            return Array.isArray(m) && m.length === rows
                && m.every(function (r) { return Array.isArray(r) && r.length === cols; });
        };
        if (!shaped(g.declination) || (g.annualChange !== undefined && !shaped(g.annualChange)))
            return false;
        this.grid = {
            lat0: s.lat, lon0: s.lon, dlat: g.step.lat, dlon: g.step.lon,
            rows: rows, cols: cols,
            declination: g.declination,
            annual: g.annualChange || null,
            date: isFinite(g.date) ? g.date : null,
            validFrom: isFinite(g.validFrom) ? g.validFrom : -Infinity,
            validTo: isFinite(g.validTo) ? g.validTo : Infinity,
            model: g.model || ""
        };
        return true;
    },

    // GET the grid, retrying every 30 s until it loads (the daemon may not be up)
    load: function (url) {
        var self = this;
        if (url === undefined)
            url = (typeof URL_HOST_PROTOCOL !== "undefined" ? URL_HOST_PROTOCOL + URL_HOST_BASE : "")
                + "/settings/deviation.json";
        fetch(url, { cache: "no-cache" }).then(function (r) {
            if (!r.ok)
                throw new Error("HTTP " + r.status);
            return r.json();
        }).then(function (g) {
            if (!self.setGrid(g))
                throw new Error("malformed grid");
        }).catch(function (err) {
            console.log("variation: " + url + ": " + err.message + ", retrying in 30 s");
            setTimeout(function () { self.load(url); }, 30000);
        });
    },

    // {valid, variation (deg, East positive), expired} at a position and a
    // decimal year
    at: function (lat, lon, year) {
        var none = { valid: false, variation: 0, expired: false };
        var g = this.grid;
        if (g === null || typeof lat !== "number" || typeof lon !== "number"
            || !isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0))
            return none;
        lon = ((lon + 180) % 360 + 360) % 360 - 180;
        var fi = (lat - g.lat0) / g.dlat;
        var fj = (lon - g.lon0) / g.dlon;
        if (fi < 0 || fi > g.rows - 1 || fj < 0 || fj > g.cols - 1)
            return none;
        var i = Math.min(Math.floor(fi), g.rows - 2);
        var j = Math.min(Math.floor(fj), g.cols - 2);
        var a = fi - i, b = fj - j;
        var bilinear = function (m) {
            return m[i][j] * (1 - a) * (1 - b) + m[i + 1][j] * a * (1 - b)
                + m[i][j + 1] * (1 - a) * b + m[i + 1][j + 1] * a * b;
        };
        var v = bilinear(g.declination);
        if (g.annual !== null && g.date !== null && isFinite(year))
            v += bilinear(g.annual) * (year - g.date);
        return { valid: true, variation: v, expired: !(year >= g.validFrom && year <= g.validTo) };
    }
};

// Decimal year of a situation: its GPS time, else the system clock
function magneticVariationYear(situation) {
    var t = Date.parse(situation.GPSTime);
    if (!isFinite(t) || t <= 0)
        t = Date.now();
    var d = new Date(t);
    var y = d.getUTCFullYear();
    var start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
    return y + (t - start) / (end - start);
}

if (typeof module !== "undefined")
    module.exports = { MagneticVariation: MagneticVariation, magneticVariationYear: magneticVariationYear };
