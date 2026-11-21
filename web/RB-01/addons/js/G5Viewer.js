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
 *
 * G5 Viewer: every value RB-01 holds that a G5 shows, drawn in the G5's arrangement, so
 * the two can be compared side by side on the panel. It is a validation page, not a
 * primary instrument. Two pages, as on the G5: attitude (PFD) and HSI; TAP switches.
 *
 * Sources, the same ones the other plates read so a mismatch here is a mismatch there:
 *  - SituationUpdated (services/servicesituation.js): attitude, slip, turn rate, baro and
 *    GPS altitude, vertical speed, SpeedKt/SpeedSource (IAS or GS), QNH, wind, variation
 *  - EMSUpdated: outsidetemperature (OAT, °C from the probe)
 *  - AutopilotUpdated: the active leg (GPRMB), drives the GPS course and CDI
 *  - BridgeUpdated: rb-vor (VOR bearing, LOC and GS deviation) when it is running
 *
 * Units: speed and temperature follow aircraft.json like the rest of RB-01; altitude is
 * feet unless aircraft.json says metres; the baro setting is hPa.
 */

angular.module('appControllers').controller('G5ViewerCtrl', G5ViewerCtrl);

// GPS CDI full scale (two dots), NM: the en-route sensitivity
const G5_GPS_CDI_FULL_SCALE_NM = 2.0;
const G5_PITCH_PX_PER_DEG = 6;
const G5_TREND_SECONDS = 6;
const G5_COLORS = {
    sky: "#1f66d1", ground: "#7a4a1c", white: "#ffffff", black: "#000000",
    tape: "rgba(40,40,40,0.72)", magenta: "#ff40ff", cyan: "#00e5ff", green: "#00ff00",
    yellow: "#ffff00", amber: "#ffb000", red: "#ff2020", grey: "#9a9a9a", aircraft: "#ffd000"
};

function G5ViewerCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "G5Viewer";
    const controllerName = name + "Ctrl";

    $scope.keypadFocus = new KeypadFocus($scope, $state, name);

    // Everything the two pages draw, already in display units
    const st = {
        page: 0,                   // 0 PFD, 1 HSI
        attValid: false, aligning: false,
        pitch: 0, roll: 0, slip: 0, slipValid: false, chevrons: "",
        turnRate: null,            // deg/s, + right
        hdg: null, hdgLabel: "HDG", // magnetic heading, or GPS track when there is no magnetometer
        track: null,               // magnetic ground track
        gpsFix: false, sats: 0,
        speed: null, speedSource: "GS", gs: null, speedTrend: 0,
        alt: null, altSource: "BARO", altTrend: 0, gpsAlt: null,
        qnh: null, autoQnh: false,
        vs: null,
        oat: null,
        gload: null, gMin: null, gMax: null,
        wind: { valid: false, dir: 0, speed: 0, estimated: false },
        variation: 0,
        gpsNav: null,              // {dtk, xtk, wpt, dist, ete}
        vor: null,                 // {bearing, freq}
        loc: null,                 // {dev}  fraction of full scale, + = bar right
        gsDev: null,               // fraction of full scale, + = fly up
        lastSituation: 0
    };

    const units = {
        speedLabel: function () {
            const s = String(window.aircraftData?.units?.speed ?? "KT").toUpperCase();
            if (s.indexOf("KM") >= 0) return "KM/H";
            if (s.indexOf("MPH") >= 0) return "MPH";
            return "KT";
        },
        meters: function () {
            return String(window.aircraftData?.units?.altimeter ?? "feet").toLowerCase().indexOf("met") >= 0;
        },
        altFromFeet: function (ft) {
            return units.meters() ? ft * 0.3048 : ft;
        },
        altLabel: function () { return units.meters() ? "M" : "FT"; },
        tempLabel: function () { return pilotTemperatureUnit(); }
    };

    // Speed bands from aircraft.json (the round speed gauge's arcs), in the pilot's unit:
    // each arc runs from its threshold to the next one. Black arcs are "no band".
    function speedBands() {
        const arcs = window.aircraftData?.GPSGroundSpeed?.arcs;
        if (!Array.isArray(arcs)) return [];
        const out = [];
        for (let i = 0; i < arcs.length; i++) {
            const from = Number(arcs[i].threshold);
            const to = i + 1 < arcs.length ? Number(arcs[i + 1].threshold) : from + 1000;
            const c = String(arcs[i].color || "").toLowerCase();
            if (!isFinite(from) || c == "#000000" || c == "#0000ff") continue;
            out.push({ from: from, to: to, color: c });
        }
        return out;
    }

    function num(v) {
        const x = Number(v);
        return isFinite(x) ? x : null;
    }
    function wrap360(d) { return ((d % 360) + 360) % 360; }

    // A filtered rate of change, per second, for the 6 s trend vectors
    function makeTrend() {
        return { t: 0, v: null, rate: 0 };
    }
    const speedTrendF = makeTrend();
    const altTrendF = makeTrend();
    function trendUpdate(f, v, now) {
        if (v === null) { f.v = null; f.rate = 0; return 0; }
        if (f.v !== null && now > f.t) {
            const dt = (now - f.t) / 1000;
            if (dt > 0.05 && dt < 3) {
                const k = Math.min(1, dt / 1.5);
                f.rate += ((v - f.v) / dt - f.rate) * k;
            }
        }
        if (now - f.t >= 50) { f.t = now; f.v = v; }
        return f.rate * G5_TREND_SECONDS;
    }

    /*****************************************************
     * Data
     */
    function situationUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("SituationUpdated", situationUpdateEventListener);
            return;
        }
        const s = event.detail;
        const now = Date.now();
        st.lastSituation = now;

        st.variation = s.MagneticVariationValid === true ? Number(s.MagneticVariation) : 0;

        st.attValid = globalAHRSValueIsValid(s.AHRSPitch) && globalAHRSValueIsValid(s.AHRSRoll);
        st.aligning = !st.attValid && ((s.AHRSStatus & (1 << 3)) != 0);
        st.pitch = st.attValid ? Number(s.AHRSPitch) : 0;
        st.roll = st.attValid ? Number(s.AHRSRoll) : 0;
        st.chevrons = globalPitchChevrons(s.AHRSPitch, st.chevrons);
        st.slipValid = globalAHRSValueIsValid(s.AHRSSlipSkid);
        st.slip = st.slipValid ? Number(s.AHRSSlipSkid) : 0;
        st.turnRate = globalAHRSValueIsValid(s.AHRSTurnRate) ? Number(s.AHRSTurnRate)
            : (globalAHRSValueIsValid(s.GPSTurnRate) ? Number(s.GPSTurnRate) : null);

        st.gpsFix = s.GPSFixQuality > 0;
        st.sats = s.GPSSatellites || 0;
        st.track = st.gpsFix && isFinite(s.GPSTrueCourse) ? wrap360(s.GPSTrueCourse - st.variation) : null;
        // Magnetic heading from the magnetometer (what mag-can-bridge sends the EFIS);
        // without it, the GPS track, labelled TRK as the G5 does
        // (main/sensors.go reports ahrs.Invalid without one)
        if (globalAHRSValueIsValid(s.AHRSMagHeading)) {
            st.hdg = wrap360(Number(s.AHRSMagHeading));
            st.hdgLabel = "HDG";
        } else if (st.track !== null) {
            st.hdg = st.track;
            st.hdgLabel = "TRK";
        } else {
            st.hdg = null;
        }

        st.gs = st.gpsFix ? pilotDisplayedSpeedFromKT(Number(s.GPSGroundSpeed) || 0) : null;
        st.speed = pilotDisplayedSpeedFromKT(Number(s.SpeedKt ?? s.GPSGroundSpeed) || 0);
        st.speedSource = s.SpeedSource ?? "GS";
        st.speedTrend = trendUpdate(speedTrendF, st.speed, now);

        st.qnh = num(s.QNH);
        st.autoQnh = s.AutoQNH === true;
        const hasBaro = s.BaroSourceType != 0 && isFinite(s.BaroPressureAltitude);
        st.gpsAlt = st.gpsFix ? units.altFromFeet(Number(s.GPSAltitudeMSL)) : null;
        if (hasBaro) {
            // The altimeter plate's formula: 27 ft per hPa
            const q = st.qnh === null ? 1013.25 : st.qnh;
            st.alt = units.altFromFeet(Number(s.BaroPressureAltitude) + 27 * (q - 1013.25));
            st.altSource = "BARO";
        } else {
            st.alt = st.gpsAlt;
            st.altSource = "GPS";
        }
        st.altTrend = trendUpdate(altTrendF, st.alt, now);

        let vs = Number(s.BaroVerticalSpeed);
        if (s.BaroSourceType == 0 || !isFinite(vs)) {
            vs = (Number(s.GPSVerticalSpeed) || 0) * 60;
        }
        st.vs = vs;

        st.gload = num(s.AHRSGLoad);
        st.gMin = num(s.AHRSGLoadMin);
        st.gMax = num(s.AHRSGLoadMax);

        st.wind = {
            valid: s.WindValid === true,
            dir: wrap360(Number(s.WindDirection) - st.variation),
            speed: pilotDisplayedSpeedFromKT(Number(s.WindSpeed) || 0),
            estimated: s.WindSource == "gs"
        };
        // OAT comes only from the EMS probe: BaroTemperature is the sensor inside the box
        requestDraw();
    }

    function emsUpdated(event) {
        if (($scope === undefined) || ($scope === null) || ($state.current.controller != controllerName)) {
            removeEventListener("EMSUpdated", emsUpdated);
            return;
        }
        const ems = event.detail || {};
        if (typeof ems.outsidetemperature === "number" && isFinite(ems.outsidetemperature)) {
            st.oat = pilotDisplayedTemperaturesFromCelsius(ems.outsidetemperature);
            requestDraw();
        }
    }

    function autopilotUpdated(event) {
        if (($scope === undefined) || ($scope === null) || ($state.current.controller != controllerName)) {
            removeEventListener("AutopilotUpdated", autopilotUpdated);
            return;
        }
        const k = event.detail || {};
        const r = k.GPRMB;
        if (!r || !(r.WaypointDest || (k.To && (k.To.Lat || k.To.Lon)))) {
            st.gpsNav = null;
        } else {
            const xtk = (Number(r.XTRKDistance) || 0) * (r.Steer == "R" ? 1 : -1); // + = course to the right
            const kt = Number(r.Knots) || 0;
            const dist = Number(r.Distance) || 0;
            const course = isFinite(r.LegCourse) && r.LegCourse != 0 ? r.LegCourse : r.TrueBearing;
            st.gpsNav = {
                dtk: wrap360(Number(course) - st.variation),
                xtk: xtk,
                wpt: r.WaypointDest || (k.To && k.To.Cmt) || "WPT",
                dist: dist,
                ete: kt > 1 ? dist / kt * 3600 : null,
                active: k.Active === true
            };
        }
        requestDraw();
    }

    function bridgeUpdatedEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
            return;
        }
        const b = event.detail || {};
        // rb-vor, as the VOR addon reads it: status 4 DEGRADED and 5 FIX are usable
        if (Number(b.vorstatus) >= 4 && isFinite(b.vorradial)) {
            st.vor = { bearing: wrap360(Number(b.vorradial) + 180), freq: Number(b.vorfreqactive) || 0 };
        } else {
            st.vor = null;
        }
        // locdev / gsdev: % of full scale. LOC: + moves the bar left (vor.js passes it negated)
        st.loc = Number(b.locstatus) >= 4 && isFinite(b.locdev) ? { dev: -Number(b.locdev) / 100 } : null;
        st.gsDev = Number(b.gsstatus) >= 4 && isFinite(b.gsdev) ? Number(b.gsdev) / 100 : null;
        requestDraw();
    }

    $scope.nextPage = function () {
        st.page = (st.page + 1) % 2;
        requestDraw();
    };

    /*****************************************************
     * Canvas
     */
    // Logical drawing size: the short side is kept at the G5's proportions (360 high, or 480
    // wide in portrait) so the fonts stay legible, the long side follows the plate. Every
    // element is placed against these, so the page fills the whole plate at any aspect.
    let W = 480, H = 360;
    let canvas = null, ctx = null, scale = 1, drawPending = false, alive = true, resizeObs = null;

    function setupCanvas() {
        canvas = document.getElementById("addonG5Canvas");
        if (!canvas) return false;
        ctx = canvas.getContext("2d");
        resize();
        const wrapEl = document.getElementById("addonG5Wrap");
        if (window.ResizeObserver && wrapEl) {
            resizeObs = new ResizeObserver(resize);
            resizeObs.observe(wrapEl);
        } else {
            addEventListener("resize", resize);
        }
        return true;
    }

    function resize() {
        if (!canvas) return;
        const wrapEl = canvas.parentElement;
        let cw = wrapEl.clientWidth || window.innerWidth;
        let ch = wrapEl.clientHeight || window.innerHeight;
        if (cw / ch >= 4 / 3) {
            H = 360; W = 360 * cw / ch;
        } else {
            W = 480; H = 480 * ch / cw;
        }
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(cw * dpr);
        canvas.height = Math.floor(ch * dpr);
        scale = canvas.width / W;
        requestDraw();
    }

    function requestDraw() {
        if (drawPending || !alive) return;
        drawPending = true;
        requestAnimationFrame(function () {
            drawPending = false;
            if (!ctx) { if (!setupCanvas()) return; }
            draw();
        });
    }

    function font(px, bold) {
        return (bold === false ? "" : "bold ") + px + "px 'Arial Narrow', Arial, Helvetica, sans-serif";
    }
    function text(str, x, y, color, px, align, baseline) {
        ctx.fillStyle = color;
        ctx.font = font(px);
        ctx.textAlign = align || "center";
        ctx.textBaseline = baseline || "middle";
        ctx.fillText(str, x, y);
    }
    function box(x, y, w, h, stroke, fill) {
        ctx.fillStyle = fill || G5_COLORS.black;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = stroke || G5_COLORS.white;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
    }
    function pad3(v) { return String(Math.round(wrap360(v)) % 360 || 360).padStart(3, "0"); }

    function draw() {
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.fillStyle = G5_COLORS.black;
        ctx.fillRect(0, 0, W, H);
        if (st.page == 0) drawPFD(); else drawHSI();
        const stale = Date.now() - st.lastSituation > 3000;
        if (stale) {
            text("NO DATA", W / 2, H / 2 + 60, G5_COLORS.amber, 20);
        }
    }

    /*****************************************************
     * PFD page
     */
    const AC = { x: 232, y: 182, r: 125 };   // attitude centre and roll scale radius, set per frame

    function drawPFD() {
        // Centred between the speed tape (0..70) and the altitude tape (W-102..)
        AC.x = (70 + W - 102) / 2;
        AC.y = H / 2 + 2;
        AC.r = Math.max(90, Math.min(AC.x - 80, H * 0.35, 200));
        drawAttitude();
        drawRollScale();
        drawAircraftSymbol();
        drawSpeedTape();
        drawAltTape();
        drawVsi();
        drawHeadingStrip();
        drawPfdFields();
        drawGlideSlope();
        if (!st.attValid) drawFailX(70, 30, W - 102 - 70, H - 50, st.aligning ? "AHRS ALIGN" : "ATTITUDE FAIL");
    }

    function drawAttitude() {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.clip();
        ctx.translate(AC.x, AC.y);
        ctx.rotate(-st.roll * Math.PI / 180);
        const off = st.pitch * G5_PITCH_PX_PER_DEG;
        ctx.fillStyle = G5_COLORS.sky;
        ctx.fillRect(-800, -1600 + off, 1600, 1600);
        ctx.fillStyle = G5_COLORS.ground;
        ctx.fillRect(-800, off, 1600, 1600);
        ctx.strokeStyle = G5_COLORS.white;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-800, off); ctx.lineTo(800, off); ctx.stroke();

        // Pitch ladder: 2.5° steps, labels every 10°, inside the central window
        ctx.save();
        ctx.beginPath();
        ctx.rect(-110, -(AC.r - 5), 220, 2 * AC.r - 15);
        ctx.clip();
        ctx.lineWidth = 1.5;
        for (let p = -90; p <= 90; p += 2.5) {
            if (p == 0) continue;
            const y = off - p * G5_PITCH_PX_PER_DEG;
            if (Math.abs(y) > AC.r + 5) continue;
            const half = (p % 10 == 0) ? 40 : (p % 5 == 0 ? 20 : 10);
            ctx.strokeStyle = G5_COLORS.white;
            ctx.beginPath(); ctx.moveTo(-half, y); ctx.lineTo(half, y); ctx.stroke();
            if (p % 10 == 0) {
                text(String(Math.abs(p)), -half - 14, y, G5_COLORS.white, 13);
                text(String(Math.abs(p)), half + 14, y, G5_COLORS.white, 13);
            }
        }
        // Recovery chevrons, the RB-01 thresholds (global.js)
        if (st.chevrons) {
            const dir = st.chevrons == "down" ? 1 : -1;  // down = nose high, point to the horizon below
            const baseP = st.chevrons == "down" ? 40 : -20;
            for (let i = 0; i < 2; i++) {
                const y = off - (baseP + (st.chevrons == "down" ? i * 10 : -i * 10)) * G5_PITCH_PX_PER_DEG;
                ctx.strokeStyle = G5_COLORS.red;
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(-30, y - dir * 15); ctx.lineTo(0, y + dir * 10); ctx.lineTo(30, y - dir * 15);
                ctx.stroke();
            }
        }
        ctx.restore();
        ctx.restore();
    }

    function drawRollScale() {
        const r = AC.r;
        ctx.save();
        ctx.translate(AC.x, AC.y);
        ctx.strokeStyle = G5_COLORS.white;
        ctx.fillStyle = G5_COLORS.white;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, (-90 - 60) * Math.PI / 180, (-90 + 60) * Math.PI / 180);
        ctx.stroke();
        [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60].forEach(function (a) {
            const len = (Math.abs(a) == 30 || Math.abs(a) == 60) ? 14 : 8;
            ctx.save();
            ctx.rotate(a * Math.PI / 180);
            if (Math.abs(a) == 45) {
                ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-4, -r - 8); ctx.lineTo(4, -r - 8); ctx.closePath(); ctx.fill();
            } else {
                ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r - len); ctx.stroke();
            }
            ctx.restore();
        });
        // Zero index: fixed white triangle above the arc
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-8, -r - 12); ctx.lineTo(8, -r - 12); ctx.closePath(); ctx.fill();

        // Roll pointer and slip/skid bar, turning with the bank
        ctx.rotate(-st.roll * Math.PI / 180);
        const tipY = -r + 2;
        ctx.fillStyle = G5_COLORS.white;
        ctx.strokeStyle = G5_COLORS.black;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, tipY); ctx.lineTo(-9, tipY + 14); ctx.lineTo(9, tipY + 14); ctx.closePath();
        ctx.fill(); ctx.stroke();
        if (st.slipValid) {
            // Full scale 10°, one bar width, the RB-01 sign: positive slip moves it left
            const clamped = Math.max(-10, Math.min(10, st.slip));
            const dx = -clamped / 10 * 18;
            ctx.fillStyle = G5_COLORS.white;
            ctx.fillRect(dx - 9, tipY + 17, 18, 5);
            ctx.strokeRect(dx - 9, tipY + 17, 18, 5);
        }
        ctx.restore();
    }

    function drawAircraftSymbol() {
        ctx.save();
        ctx.translate(AC.x, AC.y);
        ctx.fillStyle = G5_COLORS.aircraft;
        ctx.strokeStyle = G5_COLORS.black;
        ctx.lineWidth = 1.5;
        // Wings
        [-1, 1].forEach(function (s) {
            ctx.beginPath();
            ctx.moveTo(s * 40, -3); ctx.lineTo(s * 80, -3); ctx.lineTo(s * 80, 4); ctx.lineTo(s * 40, 4); ctx.closePath();
            ctx.fill(); ctx.stroke();
        });
        // Delta
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(-32, 18); ctx.lineTo(-14, 18); ctx.lineTo(0, 9); ctx.lineTo(14, 18); ctx.lineTo(32, 18); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
    }

    function drawTapeReadout(x, y, w, h, value, pointerRight) {
        ctx.save();
        ctx.fillStyle = G5_COLORS.black;
        ctx.strokeStyle = G5_COLORS.white;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (pointerRight) {
            ctx.moveTo(x, y - h / 2); ctx.lineTo(x + w, y - h / 2); ctx.lineTo(x + w, y - 7);
            ctx.lineTo(x + w + 8, y); ctx.lineTo(x + w, y + 7); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x, y + h / 2);
        } else {
            ctx.moveTo(x + w, y - h / 2); ctx.lineTo(x, y - h / 2); ctx.lineTo(x, y - 7);
            ctx.lineTo(x - 8, y); ctx.lineTo(x, y + 7); ctx.lineTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        text(value, x + w / 2, y + 1, G5_COLORS.white, 22);
        ctx.restore();
    }

    function drawSpeedTape() {
        const x = 0, w = 70, top = 40, bottom = H - 30, cy = AC.y;
        const unit = units.speedLabel();
        const span = (unit == "KM/H" ? 110 : 60) * (bottom - top) / 290;   // same spacing at any height
        const pxPer = (bottom - top) / span;
        const minor = unit == "KM/H" ? 10 : 5, major = unit == "KM/H" ? 20 : 10;
        ctx.save();
        ctx.fillStyle = G5_COLORS.tape;
        ctx.fillRect(x, top, w, bottom - top);
        ctx.beginPath(); ctx.rect(x, top, w + 10, bottom - top); ctx.clip();
        const v = st.speed === null ? 0 : st.speed;
        // Colour bands on the right edge
        speedBands().forEach(function (b) {
            const y1 = cy - (b.to - v) * pxPer, y2 = cy - (b.from - v) * pxPer;
            ctx.fillStyle = b.color == "#ffffff" ? G5_COLORS.white : b.color;
            const narrow = b.color == "#ffffff";
            ctx.fillRect(x + w - (narrow ? 4 : 8), y1, narrow ? 4 : 8, y2 - y1);
        });
        ctx.strokeStyle = G5_COLORS.white;
        ctx.lineWidth = 1.5;
        const start = Math.floor((v - span) / minor) * minor;
        for (let s = Math.max(0, start); s <= v + span; s += minor) {
            const y = cy - (s - v) * pxPer;
            const big = s % major == 0;
            ctx.beginPath(); ctx.moveTo(x + w - 8 - (big ? 12 : 6), y); ctx.lineTo(x + w - 8, y); ctx.stroke();
            if (big) text(String(s), x + w - 26, y, G5_COLORS.white, 16, "right");
        }
        // 6 s trend vector
        if (Math.abs(st.speedTrend) > 1) {
            ctx.fillStyle = G5_COLORS.magenta;
            const len = Math.max(-140, Math.min(140, st.speedTrend * pxPer));
            ctx.fillRect(x + w - 4, Math.min(cy, cy - len), 4, Math.abs(len));
        }
        ctx.restore();
        drawTapeReadout(x + 4, cy, w - 18, 34, st.speed === null ? "---" : String(Math.round(Math.max(0, st.speed))), true);
        // Source and unit; GS read as airspeed is annunciated (FHA-SPD-2)
        box(x, top - 26, w, 24, G5_COLORS.white);
        text(st.speedSource == "IAS" ? unit : "GS " + unit, x + w / 2, top - 14,
            st.speedSource == "IAS" ? G5_COLORS.white : G5_COLORS.amber, 14);
    }

    function drawAltTape() {
        const x = W - 102, w = 72, top = 40, bottom = H - 38, cy = AC.y;
        const meters = units.meters();
        const span = (meters ? 180 : 600) * (bottom - top) / 282;
        const pxPer = (bottom - top) / span;
        const minor = meters ? 10 : 20, major = meters ? 50 : 100;
        ctx.save();
        ctx.fillStyle = G5_COLORS.tape;
        ctx.fillRect(x, top, w, bottom - top);
        ctx.beginPath(); ctx.rect(x - 6, top, w + 6, bottom - top); ctx.clip();
        const v = st.alt === null ? 0 : st.alt;
        ctx.strokeStyle = G5_COLORS.white;
        ctx.lineWidth = 1.5;
        const start = Math.floor((v - span) / minor) * minor;
        for (let a = start; a <= v + span; a += minor) {
            const y = cy - (a - v) * pxPer;
            const big = a % major == 0;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (big ? 12 : 6), y); ctx.stroke();
            if (big) text(String(a), x + w - 4, y, G5_COLORS.white, 15, "right");
        }
        if (Math.abs(st.altTrend) > 10) {
            ctx.fillStyle = G5_COLORS.magenta;
            const len = Math.max(-140, Math.min(140, st.altTrend * pxPer));
            ctx.fillRect(x - 4, Math.min(cy, cy - len), 4, Math.abs(len));
        }
        // GPS altitude as a small cyan marker for the baro/GPS comparison
        if (st.altSource == "BARO" && st.gpsAlt !== null && Math.abs(st.gpsAlt - v) < span) {
            const y = cy - (st.gpsAlt - v) * pxPer;
            ctx.fillStyle = G5_COLORS.cyan;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y - 5); ctx.lineTo(x + 8, y + 5); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        drawTapeReadout(x + 6, cy, w - 6, 34, st.alt === null ? "-----" : String(Math.round(st.alt)), false);
        // Baro setting box
        box(x, bottom + 2, W - x, 26, G5_COLORS.white);
        if (st.altSource == "GPS") {
            text("GPS ALT", (x + W) / 2, bottom + 15, G5_COLORS.amber, 15);
        } else {
            text(st.qnh === null ? "----" : Math.round(st.qnh) + (st.autoQnh ? "A" : "") + " hPa",
                (x + W) / 2, bottom + 15, G5_COLORS.cyan, 15);
        }
        box(x, top - 26, w, 24, G5_COLORS.white);
        text(units.altLabel() + (st.altSource == "GPS" ? " GPS" : ""), x + w / 2, top - 14,
            st.altSource == "GPS" ? G5_COLORS.amber : G5_COLORS.white, 14);
    }

    function drawVsi() {
        const x = W - 28, w = 28, top = 72, bottom = H - 68, cy = AC.y;
        const meters = units.meters();
        const full = meters ? 10 : 2000;                    // m/s or fpm at the ends
        const vs = st.vs === null ? 0 : (meters ? st.vs * 0.3048 / 60 : st.vs);
        const half = (bottom - top) / 2;
        ctx.save();
        ctx.fillStyle = G5_COLORS.tape;
        ctx.fillRect(x, top, w, bottom - top);
        ctx.strokeStyle = G5_COLORS.white;
        ctx.lineWidth = 1.5;
        const steps = meters ? [2, 4, 6, 8, 10] : [500, 1000, 1500, 2000];
        steps.forEach(function (s) {
            [-1, 1].forEach(function (sg) {
                const y = cy - sg * s / full * half;
                const big = meters ? s % 4 == 0 || s == 10 : s % 1000 == 0;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (big ? 10 : 6), y); ctx.stroke();
                if (big) text(meters ? String(s) : String(s / 1000), x + 20, y, G5_COLORS.white, 12);
            });
        });
        ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + 12, cy); ctx.stroke();
        const clamped = Math.max(-full, Math.min(full, vs));
        const py = cy - clamped / full * half;
        ctx.fillStyle = G5_COLORS.magenta;
        ctx.beginPath(); ctx.moveTo(x + 2, py); ctx.lineTo(x + 14, py - 6); ctx.lineTo(x + 14, py + 6); ctx.closePath(); ctx.fill();
        ctx.restore();
        // Numeric VS above or below the scale
        const label = meters ? vs.toFixed(1) : String(Math.round(vs / 10) * 10);
        if (Math.abs(vs) >= (meters ? 0.5 : 100)) {
            text(label, x + w / 2, vs > 0 ? top - 14 : bottom + 14, G5_COLORS.white, 12);
        }
    }

    function drawHeadingStrip() {
        const top = 0, h = 30, left = 80, right = W - 108, cx = AC.x;
        const pxPerDeg = 4;
        ctx.save();
        ctx.fillStyle = G5_COLORS.tape;
        ctx.fillRect(left, top, right - left, h);
        ctx.beginPath(); ctx.rect(left, top, right - left, h); ctx.clip();
        if (st.hdg !== null) {
            ctx.strokeStyle = G5_COLORS.white;
            ctx.lineWidth = 1.5;
            const start = Math.floor((st.hdg - 40) / 5) * 5;
            for (let d = start; d <= st.hdg + 40; d += 5) {
                const x = cx + (d - st.hdg) * pxPerDeg;
                const big = d % 10 == 0;
                ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x, h - (big ? 10 : 5)); ctx.stroke();
                if (wrap360(d) % 30 == 0) {
                    const lab = { 0: "N", 90: "E", 180: "S", 270: "W" }[wrap360(d)] ?? String(wrap360(d) / 10);
                    text(lab, x, 10, G5_COLORS.white, 13);
                }
            }
            // Ground track: magenta diamond
            if (st.track !== null && st.hdgLabel == "HDG") {
                let dt = ((st.track - st.hdg + 540) % 360) - 180;
                const x = cx + dt * pxPerDeg;
                ctx.fillStyle = G5_COLORS.magenta;
                ctx.beginPath(); ctx.moveTo(x, h - 12); ctx.lineTo(x + 5, h - 6); ctx.lineTo(x, h); ctx.lineTo(x - 5, h - 6); ctx.closePath(); ctx.fill();
            }
            // GPS desired track: magenta course bug
            if (st.gpsNav) {
                let dt = ((st.gpsNav.dtk - st.hdg + 540) % 360) - 180;
                const lim = (right - left) / 2 / pxPerDeg - 4;
                const x = cx + Math.max(-lim, Math.min(lim, dt)) * pxPerDeg;
                ctx.strokeStyle = G5_COLORS.magenta;
                ctx.lineWidth = 2;
                ctx.strokeRect(x - 5, h - 6, 10, 6);
            }
        }
        ctx.restore();
        // Turn-rate bar along the bottom of the strip: standard rate (3°/s) at the marks
        const stdPx = 3 * 6 * pxPerDeg;   // heading change in 6 s at standard rate
        ctx.strokeStyle = G5_COLORS.white;
        ctx.lineWidth = 1.5;
        [-1, 1].forEach(function (s) {
            ctx.beginPath(); ctx.moveTo(cx + s * stdPx, h + 1); ctx.lineTo(cx + s * stdPx, h + 7); ctx.stroke();
        });
        if (st.turnRate !== null) {
            const len = Math.max(-stdPx * 1.4, Math.min(stdPx * 1.4, st.turnRate * 6 * pxPerDeg));
            ctx.fillStyle = G5_COLORS.magenta;
            ctx.fillRect(Math.min(cx, cx + len), h + 1, Math.abs(len), 5);
        }
        // Heading box
        box(cx - 30, top, 60, h, G5_COLORS.white);
        text(st.hdg === null ? "---" : pad3(st.hdg) + "°", cx, h / 2 + 1, G5_COLORS.white, 20);
        box(cx - 64, top + 6, 32, 18, G5_COLORS.grey);
        text(st.hdgLabel, cx - 48, top + 15, st.hdgLabel == "TRK" ? G5_COLORS.amber : G5_COLORS.white, 12);
    }

    function drawPfdFields() {
        // Bottom: ground speed, OAT, wind, G
        const y = H - 20, h = 20;
        const fl = 80, fw = (W - 108 - fl - 8) / 3;   // three fields between the tapes
        const fx = function (i) { return fl + i * (fw + 4); };
        box(fx(0), y, fw, h, G5_COLORS.grey);
        text("GS " + (st.gs === null ? "---" : Math.round(st.gs)), fx(0) + fw / 2, y + h / 2, G5_COLORS.white, 14);
        box(fx(1), y, fw, h, G5_COLORS.grey);
        text("OAT " + (st.oat === null ? "---" : Math.round(st.oat) + units.tempLabel()), fx(1) + fw / 2, y + h / 2, G5_COLORS.white, 14);
        box(fx(2), y, fw, h, G5_COLORS.grey);
        if (st.wind.valid) {
            text(pad3(st.wind.dir) + "°/" + Math.round(st.wind.speed) + (st.wind.estimated ? "e" : ""),
                fx(2) + fw / 2, y + h / 2, G5_COLORS.white, 14);
        } else {
            text("WIND ---", fx(2) + fw / 2, y + h / 2, G5_COLORS.grey, 14);
        }
        // G meter, under the speed tape
        if (st.gload !== null) {
            text(st.gload.toFixed(1) + "G", 35, H - 14, G5_COLORS.white, 14);
        }
        // GPS status top left, like the G5's GPS annunciation
        if (!st.gpsFix) {
            text("NO GPS", 120, 46, G5_COLORS.amber, 13);
        }
    }

    function drawGlideSlope() {
        if (st.gsDev === null) return;
        const x = W - 118, top = AC.y - 70, bottom = AC.y + 70;
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(x - 8, top - 6, 16, bottom - top + 12);
        ctx.strokeStyle = G5_COLORS.white;
        ctx.lineWidth = 1.5;
        [-2, -1, 1, 2].forEach(function (d) {
            const y = AC.y - d * 35;
            ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke();
        });
        ctx.beginPath(); ctx.moveTo(x - 7, AC.y); ctx.lineTo(x + 7, AC.y); ctx.stroke();
        const y = AC.y - Math.max(-1, Math.min(1, st.gsDev)) * 70;
        ctx.fillStyle = G5_COLORS.green;
        ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill();
        text("G", x, top - 14, G5_COLORS.green, 12);
        ctx.restore();
    }

    function drawFailX(x, y, w, h, label) {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = G5_COLORS.red;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x + 10, y + 10); ctx.lineTo(x + w - 10, y + h - 10);
        ctx.moveTo(x + w - 10, y + 10); ctx.lineTo(x + 10, y + h - 10);
        ctx.stroke();
        box(AC.x - 80, AC.y - 16, 160, 32, G5_COLORS.red);
        text(label, AC.x, AC.y, st.aligning ? G5_COLORS.amber : G5_COLORS.red, 17);
        ctx.restore();
    }

    /*****************************************************
     * HSI page
     */
    function drawHSI() {
        const cx = W / 2, cy = H / 2 + 18, r = Math.max(80, Math.min(H / 2 - 40, W / 2 - 100));
        const hdg = st.hdg === null ? 0 : st.hdg;
        const rot = function (d) { return (d - hdg - 90) * Math.PI / 180; };

        // Compass rose
        ctx.save();
        ctx.fillStyle = "#111111";
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = G5_COLORS.white;
        ctx.lineWidth = 1.5;
        for (let d = 0; d < 360; d += 5) {
            const a = rot(d);
            const len = d % 10 == 0 ? 14 : 7;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            ctx.lineTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len));
            ctx.stroke();
            if (d % 30 == 0) {
                const lab = { 0: "N", 90: "E", 180: "S", 270: "W" }[d] ?? String(d / 10);
                ctx.save();
                ctx.translate(cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28));
                ctx.rotate(a + Math.PI / 2);
                text(lab, 0, 0, G5_COLORS.white, d % 90 == 0 ? 20 : 16);
                ctx.restore();
            }
        }
        // 45° index marks outside the rose
        [45, 90, 135, 180, 225, 270, 315].forEach(function (o) {
            const a = (o - 90) * Math.PI / 180;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3));
            ctx.lineTo(cx + Math.cos(a) * (r + 11), cy + Math.sin(a) * (r + 11));
            ctx.stroke();
        });

        // Turn-rate arc at the top of the rose: 6 s of turn
        if (st.turnRate !== null) {
            const deg = Math.max(-25, Math.min(25, st.turnRate * 6));
            ctx.strokeStyle = G5_COLORS.magenta;
            ctx.lineWidth = 5;
            ctx.beginPath();
            const a0 = -Math.PI / 2, a1 = (-90 + deg) * Math.PI / 180;
            ctx.arc(cx, cy, r + 6, Math.min(a0, a1), Math.max(a0, a1));
            ctx.stroke();
            ctx.strokeStyle = G5_COLORS.white;
            ctx.lineWidth = 1.5;
            [-18, 18].forEach(function (d) {
                const a = (-90 + d) * Math.PI / 180;
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2));
                ctx.lineTo(cx + Math.cos(a) * (r + 12), cy + Math.sin(a) * (r + 12));
                ctx.stroke();
            });
        }

        // VOR bearing pointer (cyan, thin) when rb-vor has a fix
        if (st.vor) {
            const a = rot(st.vor.bearing);
            ctx.strokeStyle = G5_COLORS.cyan;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx - Math.cos(a) * (r - 18), cy - Math.sin(a) * (r - 18));
            ctx.lineTo(cx + Math.cos(a) * (r - 18), cy + Math.sin(a) * (r - 18));
            ctx.stroke();
            ctx.fillStyle = G5_COLORS.cyan;
            const tx = cx + Math.cos(a) * (r - 18), ty = cy + Math.sin(a) * (r - 18);
            ctx.save(); ctx.translate(tx, ty); ctx.rotate(a);
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-12, -6); ctx.lineTo(-12, 6); ctx.closePath(); ctx.fill();
            ctx.restore();
        }

        // Course pointer and CDI: GPS leg (magenta), else LOC (green)
        let course = null, dev = null, color = G5_COLORS.magenta, source = "";
        if (st.gpsNav) {
            course = st.gpsNav.dtk;
            dev = Math.max(-1.2, Math.min(1.2, st.gpsNav.xtk / G5_GPS_CDI_FULL_SCALE_NM));
            source = "GPS";
        } else if (st.loc) {
            course = st.track !== null ? st.track : hdg;   // no LOC course without a station pick: hold the track
            dev = Math.max(-1.2, Math.min(1.2, st.loc.dev));
            color = G5_COLORS.green;
            source = "LOC";
        }
        if (course !== null) {
            const a = rot(course);
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(a + Math.PI / 2);
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 4;
            // Head and tail
            ctx.beginPath(); ctx.moveTo(0, -r + 18); ctx.lineTo(0, -55); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, -r + 6); ctx.lineTo(-10, -r + 24); ctx.lineTo(10, -r + 24); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(0, 55); ctx.lineTo(0, r - 18); ctx.stroke();
            // Deviation dots: two each side, 25 px a dot
            ctx.strokeStyle = G5_COLORS.white;
            ctx.lineWidth = 1.5;
            [-2, -1, 1, 2].forEach(function (d) {
                ctx.beginPath(); ctx.arc(d * 28, 0, 4, 0, Math.PI * 2); ctx.stroke();
            });
            // The bar
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            const bx = dev * 56;
            ctx.beginPath(); ctx.moveTo(bx, -50); ctx.lineTo(bx, 50); ctx.stroke();
            // TO flag
            ctx.fillStyle = G5_COLORS.white;
            ctx.beginPath(); ctx.moveTo(30, -38); ctx.lineTo(22, -26); ctx.lineTo(38, -26); ctx.closePath(); ctx.fill();
            ctx.restore();
        }

        // Ground track diamond on the rose
        if (st.track !== null && st.hdgLabel == "HDG") {
            const a = rot(st.track);
            ctx.save();
            ctx.translate(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
            ctx.rotate(a + Math.PI / 2);
            ctx.fillStyle = G5_COLORS.magenta;
            ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(5, 0); ctx.lineTo(0, 6); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill();
            ctx.restore();
        }

        // Ownship
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = G5_COLORS.white;
        ctx.strokeStyle = G5_COLORS.black;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -22); ctx.lineTo(3, -8); ctx.lineTo(22, 2); ctx.lineTo(22, 6); ctx.lineTo(3, 2); ctx.lineTo(2, 14);
        ctx.lineTo(8, 19); ctx.lineTo(8, 22); ctx.lineTo(0, 20); ctx.lineTo(-8, 22); ctx.lineTo(-8, 19); ctx.lineTo(-2, 14);
        ctx.lineTo(-3, 2); ctx.lineTo(-22, 6); ctx.lineTo(-22, 2); ctx.lineTo(-3, -8); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.restore();

        // Lubber and heading box at the top
        box(cx - 32, 2, 64, 30, G5_COLORS.white);
        text(st.hdg === null ? "---" : pad3(st.hdg) + "°", cx, 18, G5_COLORS.white, 20);
        ctx.fillStyle = G5_COLORS.white;
        ctx.beginPath(); ctx.moveTo(cx, cy - r + 2); ctx.lineTo(cx - 7, cy - r - 10); ctx.lineTo(cx + 7, cy - r - 10); ctx.closePath(); ctx.fill();
        text(st.hdgLabel, cx - 50, 17, st.hdgLabel == "TRK" ? G5_COLORS.amber : G5_COLORS.white, 12);

        // Nav source and desired track (top left), waypoint (top right)
        if (source) {
            text(source, 8, 14, color, 18, "left");
            if (st.gpsNav) {
                text("DTK " + pad3(st.gpsNav.dtk) + "°", 8, 36, G5_COLORS.magenta, 15, "left");
                text("XTK " + Math.abs(st.gpsNav.xtk).toFixed(2) + (st.gpsNav.xtk >= 0 ? "R" : "L"), 8, 54, G5_COLORS.white, 13, "left");
            }
        } else {
            text("NO NAV", 8, 14, G5_COLORS.grey, 16, "left");
        }
        if (st.gpsNav) {
            text(String(st.gpsNav.wpt).substring(0, 8), W - 8, 14, G5_COLORS.magenta, 16, "right");
            text(st.gpsNav.dist.toFixed(1) + " NM", W - 8, 34, G5_COLORS.white, 15, "right");
            if (st.gpsNav.ete !== null) {
                text("ETE " + textBySeconds(Math.round(st.gpsNav.ete)), W - 8, 52, G5_COLORS.white, 13, "right");
            }
        }
        if (st.vor) {
            text("VOR " + (st.vor.freq > 1000 ? (st.vor.freq / 1000).toFixed(2) : st.vor.freq.toFixed(2)), 8, 76, G5_COLORS.cyan, 13, "left");
            text("BRG " + pad3(st.vor.bearing) + "°", 8, 92, G5_COLORS.cyan, 13, "left");
        }

        // Side readouts: speed (left), altitude and baro (right)
        box(4, cy - 30, 72, 34, G5_COLORS.white);
        text(st.speed === null ? "---" : String(Math.round(Math.max(0, st.speed))), 40, cy - 12, G5_COLORS.white, 22);
        text(st.speedSource == "IAS" ? units.speedLabel() : "GS " + units.speedLabel(), 40, cy - 38,
            st.speedSource == "IAS" ? G5_COLORS.white : G5_COLORS.amber, 12);
        box(W - 84, cy - 30, 80, 34, G5_COLORS.white);
        text(st.alt === null ? "-----" : String(Math.round(st.alt)), W - 44, cy - 12, G5_COLORS.white, 22);
        text(units.altLabel() + (st.altSource == "GPS" ? " GPS" : ""), W - 44, cy - 38,
            st.altSource == "GPS" ? G5_COLORS.amber : G5_COLORS.white, 12);
        if (st.altSource == "BARO" && st.qnh !== null) {
            text(Math.round(st.qnh) + (st.autoQnh ? "A" : "") + " hPa", W - 44, cy + 16, G5_COLORS.cyan, 13);
        }
        if (st.vs !== null) {
            const meters = units.meters();
            text("VS " + (meters ? (st.vs * 0.3048 / 60).toFixed(1) : Math.round(st.vs / 10) * 10), W - 44, cy + 34, G5_COLORS.white, 13);
        }

        // Bottom corners: wind (left), GS and OAT (right)
        if (st.wind.valid) {
            const wa = (st.wind.dir + 180 - hdg) * Math.PI / 180;   // arrow points downwind, relative to the nose
            ctx.save();
            ctx.translate(26, H - 34);
            ctx.rotate(wa);
            ctx.strokeStyle = G5_COLORS.white;
            ctx.fillStyle = G5_COLORS.white;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, -10); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(-5, -5); ctx.lineTo(5, -5); ctx.closePath(); ctx.fill();
            ctx.restore();
            text(pad3(st.wind.dir) + "°", 46, H - 42, G5_COLORS.white, 13, "left");
            text(Math.round(st.wind.speed) + " " + units.speedLabel() + (st.wind.estimated ? " e" : ""), 46, H - 24, G5_COLORS.white, 13, "left");
        } else {
            text("WIND ---", 8, H - 24, G5_COLORS.grey, 13, "left");
        }
        text("GS " + (st.gs === null ? "---" : Math.round(st.gs) + " " + units.speedLabel()), W - 8, H - 42, G5_COLORS.white, 13, "right");
        text("OAT " + (st.oat === null ? "---" : Math.round(st.oat) + units.tempLabel()), W - 8, H - 24, G5_COLORS.white, 13, "right");
        if (!st.gpsFix) {
            text("NO GPS", W - 8, 76, G5_COLORS.amber, 13, "right");
        }
    }

    /*****************************************************
     * Lifecycle
     */
    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
        alive = false;
        if (resizeObs) resizeObs.disconnect();
        removeEventListener("resize", resize);
        removeEventListener("EMSUpdated", emsUpdated);
        removeEventListener("SituationUpdated", situationUpdateEventListener);
        removeEventListener("AutopilotUpdated", autopilotUpdated);
        removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
        $interval.cancel(staleTimer);
    };

    // Redraw once a second without data, so NO DATA appears when the feed stops
    const staleTimer = $interval(requestDraw, 1000, 0, false);

    addEventListener("SituationUpdated", situationUpdateEventListener);
    addEventListener("EMSUpdated", emsUpdated);
    addEventListener("AutopilotUpdated", autopilotUpdated);
    addEventListener("BridgeUpdated", bridgeUpdatedEventListener);

    // The template is in the DOM after this digest
    setTimeout(function () {
        setupCanvas();
        if (window.situation && Object.keys(window.situation).length > 0) {
            situationUpdateEventListener({ detail: window.situation });
        }
    }, 0);
}
