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

    glidereach.js: the area the aircraft can still reach in a best-glide
    descent, engine out, over the real terrain and with the wind.

    From the aircraft, GLIDE_RADIALS ground tracks fan out all round. Along each
    one the aircraft glides at its best-glide speed: in still air it loses one
    foot for every glideRatio feet flown; with the wind it covers the ground at
    the ground speed of that track, so it loses TAS / (glideRatio * GS) feet per
    foot of ground. The radial ends where the glide path comes down to
    clearanceAglFt above the terrain under it (the first ridge it cannot clear
    stops it, the valley beyond is not reachable), where the ground speed is
    zero or less (the wind is stronger than the airspeed), or at the edge of the
    terrain data (unknown ground is not reachable ground). The ends of the
    radials, joined in order, are the boundary of the area.

    Not modelled, so cover them with clearanceAglFt: the turn onto the track,
    the time to set up the glide, wind changing with height, a windmilling or
    stopped propeller changing the ratio. docs/glide-range.md.

    Pure: no Angular, no DOM, no OpenLayers. The map (plates/js/map.js) draws it.
*/

var GLIDE_RADIALS = 120;            // tracks, every 3 degrees
var GLIDE_EARTH_M = 6371000;
var GLIDE_FT = 0.3048;
var GLIDE_MAX_STEPS = 4000;         // per radial, whatever the grid

// What aircraft.json "bestGlide" may say, and what is taken when it says nothing
// usable: a typical light single. Out of range or not a number = the default.
var GLIDE_DEFAULTS = {
    enabled: true,
    glideRatio: 9,          // still-air ratio at best-glide speed, engine out
    speedKt: 75,            // best-glide indicated airspeed
    clearanceAglFt: 500,    // the glide path must stay this high above the terrain
    useWind: true           // correct the reach with the estimated wind
};
var GLIDE_LIMITS = {
    glideRatio: [2, 60],
    speedKt: [20, 300],
    clearanceAglFt: [0, 5000]
};

// The bestGlide block of aircraft.json, checked: every field present and in range.
function glideParameters(aircraftData) {
    var raw = (aircraftData && typeof aircraftData.bestGlide === "object" && aircraftData.bestGlide) || {};
    var p = {};
    for (var key in GLIDE_DEFAULTS) {
        var value = raw[key];
        var limits = GLIDE_LIMITS[key];
        if (limits) {
            value = Number(value);
            p[key] = (raw[key] !== null && raw[key] !== "" && isFinite(value)
                && value >= limits[0] && value <= limits[1]) ? value : GLIDE_DEFAULTS[key];
        } else {
            p[key] = (typeof value === "boolean") ? value : GLIDE_DEFAULTS[key];
        }
    }
    return p;
}

// ISA true airspeed for an indicated one at an altitude in feet
function glideTrueAirspeed(iasKt, altitudeFt) {
    var sigma = Math.pow(Math.max(1 - 6.8756e-6 * Math.max(altitudeFt, 0), 0.01), 4.2559);
    return iasKt / Math.sqrt(sigma);
}

// Ground speed along a true track, gliding at tasKt in a wind blowing FROM
// windFrom at windKt; <= 0 when the aircraft cannot make way along it.
function glideGroundSpeed(trackDeg, tasKt, windFrom, windKt) {
    var a = (trackDeg - windFrom) * Math.PI / 180;
    var cross = windKt * Math.sin(a);
    if (Math.abs(cross) >= tasKt)
        return 0;
    return Math.sqrt(tasKt * tasKt - cross * cross) - windKt * Math.cos(a);
}

// Terrain elevation in metres at (lat, lon) from a window of the shared grid
// (globalTerrainGrid.data, js/global.js), null off it.
function glideTerrainAt(grid, lat, lon) {
    var i = Math.floor((lat - grid.planimetry.start.lat) / grid.moltipliers.lat);
    if (i < 0 || i >= grid.terrainData.length)
        return null;
    var row = grid.terrainData[i];
    var j = Math.floor((lon - grid.planimetry.start.lon) / grid.moltipliers.lon);
    if (j < 0 || j >= row.length)
        return null;
    return row[j];
}

// The reach from (lat, lon) at altitudeFt MSL over `grid`.
//   wind   {from, speed} in degrees true and knots, or null for still air
// Returns null when there is nothing to draw (no grid, already below the
// clearance), else
//   {points: [[lat, lon], ...] one per radial, clockwise from north,
//    reachM: metres along each radial, limit: why each ended
//    ("terrain", "wind", "edge"), tasKt}
function glideReach(grid, lat, lon, altitudeFt, params, wind) {
    if (!grid || !grid.terrainData || !grid.terrainData.length || !isFinite(lat)
        || !isFinite(lon) || !isFinite(altitudeFt))
        return null;
    var clearance = params.clearanceAglFt * GLIDE_FT;
    var h0 = altitudeFt * GLIDE_FT;
    var here = glideTerrainAt(grid, lat, lon);
    if (here === null || h0 < Math.max(here, 0) + clearance)
        return null;

    var tas = glideTrueAirspeed(params.speedKt, altitudeFt);
    var windFrom = 0, windKt = 0;
    if (wind && isFinite(wind.from) && isFinite(wind.speed) && wind.speed > 0) {
        windFrom = wind.from;
        windKt = wind.speed;
    }
    // Half a grid cell, so no cell is stepped over
    var step = Math.max(50, 0.5 * Math.min(grid.moltipliers.lat,
        grid.moltipliers.lon * Math.cos(lat * Math.PI / 180)) * Math.PI / 180 * GLIDE_EARTH_M);
    var mPerLat = GLIDE_EARTH_M * Math.PI / 180;
    var mPerLon = mPerLat * Math.cos(lat * Math.PI / 180);

    var points = [], reachM = [], limit = [];
    var any = false;
    for (var r = 0; r < GLIDE_RADIALS; r++) {
        var track = r * 360 / GLIDE_RADIALS;
        var gs = glideGroundSpeed(track, tas, windFrom, windKt);
        var d = 0, why = "wind";
        if (gs > 0) {
            var sink = tas / (params.glideRatio * gs); // metres lost per metre of ground
            var dn = Math.cos(track * Math.PI / 180) / mPerLat;
            var de = Math.sin(track * Math.PI / 180) / mPerLon;
            var prevMargin = h0 - Math.max(here, 0) - clearance;
            why = "edge";
            for (var k = 1; k <= GLIDE_MAX_STEPS; k++) {
                var dk = k * step;
                var elev = glideTerrainAt(grid, lat + dk * dn, lon + dk * de);
                if (elev === null)
                    break;
                var margin = h0 - dk * sink - Math.max(elev, 0) - clearance;
                if (margin < 0) {
                    // Between the last step that cleared and this one
                    d = dk - step * margin / (margin - prevMargin);
                    why = "terrain";
                    break;
                }
                d = dk;
                prevMargin = margin;
            }
        }
        if (d > 0)
            any = true;
        reachM.push(d);
        limit.push(why);
        var t = track * Math.PI / 180;
        points.push([lat + d * Math.cos(t) / mPerLat, lon + d * Math.sin(t) / mPerLon]);
    }
    if (!any)
        return null;
    return { points: points, reachM: reachM, limit: limit, tasKt: tas };
}
