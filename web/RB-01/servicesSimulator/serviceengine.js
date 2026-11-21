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
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
 */
/*
    serviceengine.js: the EMS readings the recording does not hold.

    No flight log on hand has rpm, manifold pressure, oil or fuel pressure, fuel
    levels or the electrical bus, so their gauges would sit at 0 for the whole
    replay. This file makes them up from what the aircraft is doing - climbing,
    cruising, descending, on the ground - for a Rotax 912 like the one ems.json
    is drawn for, and sends them on /ems twice a second, merged with the
    recorded readings as the daemon merges every sender's.

    Features:
        - Only keys the replay lacks: a recording that has one wins
        - Cylinders the recording lacks (cht3, egt4) follow the ones it has
        - Fuel burns with the power set, and the tanks fill again when the flight loops
        - simulatorEngine.enabled = false on the browser console stops it
*/

const ENGINE_TICK_MS = 500;
// Seconds for the engine to settle on a new power setting
const ENGINE_RPM_TAU_S = 3;

// Rotax 912: rpm by phase of flight, and the manifold pressure (inHg) they give at sea level
const ENGINE_RPM = { ground: 1900, climb: 5500, cruise: 5000, descent: 4100 };
const ENGINE_RPM_IDLE = 1800;
const ENGINE_RPM_FULL = 5500;
const ENGINE_MAP_IDLE = 12;
const ENGINE_MAP_FULL = 28.5;
// Below this ground speed (kt) the aircraft is on the ground; vertical speeds (ft/min) of a climb and a descent
const ENGINE_GROUND_KT = 35;
const ENGINE_CLIMB_FPM = 250;
const ENGINE_DESCENT_FPM = -300;

const ENGINE_FUEL_START_L = [48, 46];

// Every key this file can make, and how: from the engine state and the readings of the replay
const ENGINE_KEYS = {
    "enginerpm": (e) => Math.round(e.rpm + 12 * Math.sin(e.t * 1.3)),
    "manifoldpressure": (e) => +e.map.toFixed(1),
    "oilpressure": (e) => +(50 + 15 * e.power - 0.15 * (e.ems.oiltemperature - 80) + 0.6 * Math.sin(e.t / 4)).toFixed(1),
    "fuelpressure": (e) => +(5.0 + 0.4 * e.power + 0.05 * Math.sin(e.t * 0.9)).toFixed(2),
    "fuel1": (e) => +e.fuel[0].toFixed(1),
    "fuel2": (e) => +e.fuel[1].toFixed(1),
    "fuelflow": (e) => +e.flow.toFixed(1),
    "batteryvoltage": (e) => +((e.rpm > 2500 ? 14.1 : 13.4) + 0.05 * Math.sin(e.t / 6)).toFixed(2),
    "alternatorout": (e) => +((e.rpm > 2500 ? 14.2 : 13.5) + 0.05 * Math.sin(e.t / 5)).toFixed(2),
    "amps": (e) => +(7 + 1.5 * Math.sin(e.t / 9)).toFixed(1),
    "flaps": (e) => e.groundSpeed < 75 ? 50 : 0,
    "trim": (e) => Math.round(simulatorEngineClamp((120 - e.groundSpeed) / 3, -10, 20)),
    // Fixed gear: always down and locked
    "gearnose": () => 1,
    "gearleft": () => 1,
    "gearright": () => 1,
    "cht3": (e) => +(engineAverage(e.ems, ["cht1", "cht2", "cht4"], 150) + 4).toFixed(1),
    "egt4": (e) => +(engineAverage(e.ems, ["egt1", "egt2", "egt3"], 660) - 9).toFixed(1)
};

function simulatorEngineClamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

// The mean of the readings present, or `otherwise` without any
function engineAverage(readings, keys, otherwise) {
    const values = keys.map(key => readings[key]).filter(value => typeof value == "number");
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : otherwise;
}

/**
 * SimulatedEngine Class
 */
function SimulatedEngine() {
    this.enabled = true;
    this.keys = null;       // the keys to send, once the replay says which it lacks
    this.rpm = ENGINE_RPM.ground;
    this.fuel = ENGINE_FUEL_START_L.slice();
    this.loops = 0;
}

SimulatedEngine.prototype = {
    constructor: SimulatedEngine,

    phase: function (situation) {
        if (!(situation.GPSGroundSpeed >= ENGINE_GROUND_KT)) {
            return "ground";
        }
        var fpm = (situation.GPSVerticalSpeed || 0) * 60; // ft/s
        if (fpm > ENGINE_CLIMB_FPM) {
            return "climb";
        }
        if (fpm < ENGINE_DESCENT_FPM) {
            return "descent";
        }
        return "cruise";
    },

    tick: function (elapsed) {
        if (!this.enabled || simulatorReplay === null) {
            return;
        }
        const situation = simulatorReplay.lastFrames["/situation"];
        if (situation === undefined) {
            return;
        }
        if (this.keys === null) {
            const recorded = simulatorReplay.streams["/ems"] ? simulatorReplay.streams["/ems"].fields : [];
            this.keys = Object.keys(ENGINE_KEYS).filter(key => recorded.indexOf(key) < 0);
        }
        if (this.loops != simulatorReplay.loops) {
            this.loops = simulatorReplay.loops;
            this.fuel = ENGINE_FUEL_START_L.slice();
        }
        // Seconds of flight, as the replay counts them (REPLAY_MAX_STEP: no burst after a background tab)
        const seconds = Math.min(elapsed, REPLAY_MAX_STEP) * simulatorReplay.speed;
        const target = ENGINE_RPM[this.phase(situation)];
        this.rpm += (target - this.rpm) * (1 - Math.exp(-seconds / ENGINE_RPM_TAU_S));

        const power = simulatorEngineClamp((this.rpm - ENGINE_RPM_IDLE) / (ENGINE_RPM_FULL - ENGINE_RPM_IDLE), 0, 1);
        const map = simulatorEngineClamp(ENGINE_MAP_IDLE + power * (ENGINE_MAP_FULL - ENGINE_MAP_IDLE)
            - (situation.GPSAltitudeMSL || 0) / 1000, 10, 29.5);
        // About 6 L/h at idle, 22 at full power
        const flow = 6 + 16 * Math.pow(power, 1.5);
        this.fuel = this.fuel.map(level => Math.max(level - flow / 2 * seconds / 3600, 0));

        const state = {
            t: Date.now() / 1000,
            rpm: this.rpm,
            power: power,
            map: map,
            flow: flow,
            fuel: this.fuel,
            groundSpeed: situation.GPSGroundSpeed || 0,
            ems: Object.assign({ oiltemperature: 85 }, simulatorReplay.lastFrames["/ems"])
        };
        // The whole map, as the daemon sends it on every change (handleEMSSetRequest):
        // the Engine page draws a key a frame lacks as 0 (plates/js/ems.js), so
        // frames of these keys alone would hold the recorded oil and outside
        // temperature at 0 between the replay's own.
        const frame = Object.assign({}, simulatorReplay.lastFrames["/ems"]);
        this.keys.forEach(key => frame[key] = ENGINE_KEYS[key](state));
        if (this.keys.length) {
            loopbackPush("/ems", JSON.stringify(frame));
        }
    }
};

var simulatorEngine = new SimulatedEngine();

window.addEventListener("load", function () {
    var lastTick = Date.now();
    window.setInterval(() => {
        const now = Date.now();
        simulatorEngine.tick((now - lastTick) / 1000);
        lastTick = now;
    }, ENGINE_TICK_MS);
});
