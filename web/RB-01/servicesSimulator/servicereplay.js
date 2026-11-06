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
    servicereplay.js: plays /settings/replay.json down the loopback sockets, for ever.

    The file is written by flightlog2replay.py, which also describes its format.

    Features:
        - Each stream plays on its own socket, on the clock of the log
        - Traffic goes out on /traffic and /radar, as main/traffic.go does
        - Interpolate the situation, which the log only holds at 1 Hz
        - Repeat the status, which the log only holds every 30 s
        - Every clock keeps running forward across a loop

    simulatorReplay.speed on the browser console runs it faster.
*/

var URL_REPLAY_GET = "/settings/replay.json";

const REPLAY_VERSION = 1;
const REPLAY_TICK_MS = 50;
// Background tabs tick once a second or slower. The replay waits for them
// instead of catching up with a burst.
const REPLAY_MAX_STEP = 1;

// Seconds between two frames of the streams the log holds too thinly to send as
// they are. Both go out from the top of the replay, not from their first row.
//   /situation  one row per second, the daemon sends ten: fed the log as it is, the
//               horizon would jump once a second. Between two rows the flown values
//               are interpolated, and the rest (clocks, satellites) holds.
//   /status     one row every 30 s, the daemon sends one a second: the home page
//               would show nothing for half a minute, and the radar's clock would
//               stop in between. The last row repeats, with its clock running.
const REPLAY_PACED_STREAMS = { "/situation": 0.1, "/status": 1 };
// A longer hole in the log is a hole: hold, do not glide across it
const REPLAY_MAX_INTERPOLATED_GAP = 3;
const REPLAY_LINEAR_FIELDS = ["GPSLatitude", "GPSLongitude", "GPSAltitudeMSL", "GPSHeightAboveEllipsoid",
    "GPSGroundSpeed", "GPSVerticalSpeed", "GPSTurnRate", "BaroPressureAltitude", "BaroVerticalSpeed",
    "IndicatedAirSpeed", "AHRSSlipSkid", "AHRSTurnRate", "AHRSGLoad"];
const REPLAY_HEADING_FIELDS = ["GPSTrueCourse", "AHRSGyroHeading", "AHRSMagHeading"];
const REPLAY_ATTITUDE_FIELDS = ["AHRSPitch", "AHRSRoll"];

// Seconds of nothing between the end of the flight and the next one
const REPLAY_LOOP_GAP = 1;

// A time in the file is seconds since the Unix epoch or, below this, since Go's
// zero time: the daemon's uptime clock, whose year is 1. Zero itself means never.
const REPLAY_UPTIME_LIMIT = 1e8;
const REPLAY_GO_ZERO_TIME = "0001-01-01T00:00:00Z";
const REPLAY_GO_ZERO_TIME_MS = Date.parse(REPLAY_GO_ZERO_TIME);

// The value `fraction` of the way from one reading to the next. 3276.7 is not a
// reading: AHRSGyroHeading sits on it for minutes in a real log.
function replayLinear(from, to, fraction) {
    return from + (to - from) * fraction;
}

// By the short way round: 359 to 1 is 2 degrees, and the result stays in 0..360
function replayHeading(from, to, fraction) {
    const delta = ((to - from) % 360 + 540) % 360 - 180;
    return (from + delta * fraction + 360) % 360;
}

// The same in -180..180: 179 to -179 is 2 degrees too, and aerobatics do cross it
function replayAttitude(from, to, fraction) {
    const angle = replayHeading(from, to, fraction);
    return angle > 180 ? angle - 360 : angle;
}

const REPLAY_BLENDS = {};
REPLAY_LINEAR_FIELDS.forEach(name => REPLAY_BLENDS[name] = replayLinear);
REPLAY_HEADING_FIELDS.forEach(name => REPLAY_BLENDS[name] = replayHeading);
REPLAY_ATTITUDE_FIELDS.forEach(name => REPLAY_BLENDS[name] = replayAttitude);

ReplayPlayer.prototype = {
    constructor: ReplayPlayer,

    // Back to the top of the log. The clocks do not follow: see clockShift.
    rewind: function () {
        this.position = 0;
        Object.keys(this.streams).forEach(path => {
            const stream = this.streams[path];
            stream.cursor = 0;
            stream.states = {};
            stream.due = 0;
            if (path in REPLAY_PACED_STREAMS) {
                this.apply(stream, stream.rows[0]);
                stream.cursor = 1;
            }
        });
    },

    // One row onto the state of its stream, or of its target. Returns that state.
    apply: function (stream, row) {
        const keyed = stream.key !== undefined;
        const id = keyed ? row[1] : "";
        var state = stream.states[id];
        if (state === undefined) {
            state = stream.states[id] = {};
            if (keyed) {
                state[stream.key] = id;
            }
        }
        for (var index = keyed ? 2 : 1; index < row.length; index += 2) {
            state[stream.fields[row[index]]] = row[index + 1];
        }
        return state;
    },

    // RFC 3339, like encoding/json, on a clock that never goes backwards
    time: function (seconds) {
        if (seconds === 0) {
            return REPLAY_GO_ZERO_TIME;
        }
        const origin = seconds < REPLAY_UPTIME_LIMIT ? REPLAY_GO_ZERO_TIME_MS : 0;
        return new Date(origin + (seconds + this.clockShift) * 1000).toISOString();
    },

    send: function (path, stream, state) {
        const frame = Object.assign({}, state);
        stream.times.forEach(name => {
            if (frame.hasOwnProperty(name)) {
                frame[name] = this.time(frame[name]);
            }
        });
        const text = JSON.stringify(frame);
        loopbackPush(path, text);
        if (path == "/traffic") {
            loopbackPush("/radar", text);
        }
    },

    // The situation at this.position: the last row, moved towards the next one.
    // Only what the next row changes can differ, so only that is looked at.
    situation: function (stream) {
        const frame = Object.assign({}, stream.states[""]);
        const before = stream.rows[stream.cursor - 1];
        const after = stream.rows[stream.cursor];
        if (after === undefined || after[0] - before[0] > REPLAY_MAX_INTERPOLATED_GAP) {
            return frame;
        }
        const fraction = Math.max(this.position - before[0], 0) / (after[0] - before[0]);
        for (var index = 1; index < after.length; index += 2) {
            const name = stream.fields[after[index]];
            const blend = REPLAY_BLENDS[name];
            if (blend !== undefined && globalAHRSValueIsValid(frame[name]) && globalAHRSValueIsValid(after[index + 1])) {
                frame[name] = blend(frame[name], after[index + 1], fraction);
            }
        }
        return frame;
    },

    // The status at this.position: the last row, with the time since then on its clock
    status: function (stream) {
        const frame = Object.assign({}, stream.states[""]);
        frame.UptimeClock += this.position - stream.rows[stream.cursor - 1][0];
        return frame;
    },

    // Seconds of wall clock have passed
    tick: function (elapsed) {
        this.position += Math.min(elapsed, REPLAY_MAX_STEP) * this.speed;
        if (this.position >= this.duration) {
            // Radar drops a target by Last_seen against UptimeClock, and both are
            // in the log. Replayed as they are, the end of the flight would be in
            // the future of the next loop and its targets would never expire. The
            // GPS clock of the wind estimator is left alone: it keeps its own
            // time from GPSLastFixSinceMidnightUTC, and resets on a replay restart.
            this.clockShift += this.duration + REPLAY_LOOP_GAP;
            this.rewind();
        }
        Object.keys(this.streams).forEach(path => {
            const stream = this.streams[path];
            const period = REPLAY_PACED_STREAMS[path];
            while (stream.cursor < stream.rows.length && stream.rows[stream.cursor][0] <= this.position) {
                const state = this.apply(stream, stream.rows[stream.cursor]);
                stream.cursor++;
                if (period === undefined) {
                    this.send(path, stream, state);
                }
            }
            if (period !== undefined && this.position >= stream.due) {
                stream.due = this.position + period;
                this.send(path, stream, path == "/status" ? this.status(stream) : this.situation(stream));
            }
        });
    }
};

/**
 * ReplayPlayer Class
 * @param {*} replay - the parsed content of replay.json
 */
function ReplayPlayer(replay) {
    this.streams = replay.streams;
    this.duration = replay.duration;
    this.speed = 1;
    this.clockShift = 0;    // seconds added to every clock, grows by a flight on each loop
    this.rewind();
}

var simulatorReplay = null;

// After load: this file runs ahead of the scripts it plays to, and of the sockets
// that listen. A flight started any earlier would be half over for nobody.
window.addEventListener("load", function () {
    fetch(URL_REPLAY_GET).then(function (response) {
        if (!response.ok) {
            throw new Error("HTTP error " + response.status);
        }
        return response.json();
    }).then(function (replay) {
        if (replay.version !== REPLAY_VERSION) {
            throw new Error("version " + replay.version + ", this player reads " + REPLAY_VERSION);
        }
        simulatorReplay = new ReplayPlayer(replay);
        var lastTick = Date.now();
        window.setInterval(() => {
            const now = Date.now();
            simulatorReplay.tick((now - lastTick) / 1000);
            lastTick = now;
        }, REPLAY_TICK_MS);
    }).catch(function (error) {
        console.error("No replay to play from " + URL_REPLAY_GET + ": " + error.message);
    });
});
