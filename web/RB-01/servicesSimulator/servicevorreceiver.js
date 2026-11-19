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
    servicevorreceiver.js: an rb-vor receiver, in the browser.

    The VOR addon tunes by posting vorfreq (and gsselect) to /bridge/float and
    draws what the receiver posts back there. This file is that receiver, with
    RB-VOR-IF v2.4 on the wire (rb-vor/docs/RB-VOR-IF-v2.4.md): every vor*, loc*
    and gs* field on every payload, kHz out, the same status codes, locdev and
    gsdev gated by a usable status.

    What it receives comes from the replayed aircraft and /settings/db.vor.json:
        - VOR: the radial from the station, degrees magnetic, inside the
          station's range and the radio horizon; a TACAN has no VOR to hear
        - LOC: the angle off the front course, full scale at 2.5 degrees, inside
          the Annex 10 coverage (10 degrees to 25 NM, 35 degrees to 17 NM)
        - GS: the angle off the glide path, full scale at 0.24 times the path
          angle, within 8 degrees and 10 NM, between 0.45 and 1.75 path angles
    Outside the localizer's coverage the localizer and the glide slope fly a
    demonstration approach instead: an intercept from full scale, then small
    corrections, every SIMVOR_DEMO_PERIOD seconds. A recorded flight almost
    never passes through an ILS, and a localizer that only ever said NO SIGNAL
    would show nothing of the plate. The VOR is always the geometry.

    simulatorVor.gsShared = true on the browser console makes it a one-dongle
    receiver: LOC or GS, by the plate's switch. The default has two dongles,
    so the localizer bar and the glide-slope marker show together.
*/

var URL_SIMVOR_DB_GET = "/settings/db.vor.json";

// Seconds of each step after a retune: TUNING, then ACQUIRING, then judged
const SIMVOR_TUNING_S = 1;
const SIMVOR_ACQUIRING_S = 2;
const SIMVOR_TICK_MS = 500;

const SIMVOR_STATUS_IDLE = 0;
const SIMVOR_STATUS_NO_SIGNAL = 1;
const SIMVOR_STATUS_TUNING = 2;
const SIMVOR_STATUS_ACQUIRING = 3;
const SIMVOR_STATUS_DEGRADED = 4;
const SIMVOR_STATUS_TRACKING = 5;

// A station without a range in the database
const SIMVOR_DEFAULT_RANGE_NM = 40;
// Beyond this share of its range a station is DEGRADED, not TRACKING
const SIMVOR_DEGRADED_SHARE = 0.8;

// Localizer: half the course sector, the coverage, and the angle it is judged degraded at
const SIMVOR_LOC_HALF_SECTOR_DEG = 2.5;
const SIMVOR_LOC_COVERAGE = [{ angle: 10, range: 25 }, { angle: 35, range: 17 }];
// Glide slope (Annex 10 Vol I 3.1.5.3)
const SIMVOR_GS_DEFAULT_ANGLE = 3.0;
const SIMVOR_GS_FULL_SCALE = 0.24;
const SIMVOR_GS_LATERAL_DEG = 8;
const SIMVOR_GS_RANGE_NM = 10;
const SIMVOR_GS_LOWEST = 0.45;
const SIMVOR_GS_HIGHEST = 1.75;

// The demonstration approach, seconds per run
const SIMVOR_DEMO_PERIOD = 90;

// RB-VOR-IF v2.4 section 2.6: the glide-path channel paired with each localizer channel, kHz
const SIMVOR_GS_PAIRING = {
    108100: 334700, 108150: 334550, 108300: 334100, 108350: 333950, 108500: 329900,
    108550: 329750, 108700: 330500, 108750: 330350, 108900: 329300, 108950: 329150,
    109100: 331400, 109150: 331250, 109300: 332000, 109350: 331850, 109500: 332600,
    109550: 332450, 109700: 333200, 109750: 333050, 109900: 333800, 109950: 333650,
    110100: 334400, 110150: 334250, 110300: 335000, 110350: 334850, 110500: 329600,
    110550: 329450, 110700: 330200, 110750: 330050, 110900: 330800, 110950: 330650,
    111100: 331700, 111150: 331550, 111300: 332300, 111350: 332150, 111500: 332900,
    111550: 332750, 111700: 333500, 111750: 333350, 111900: 331100, 111950: 330950
};

const SIMVOR_EARTH_NM = 3440.065;
const SIMVOR_FEET_PER_NM = 6076.12;

function simvorWrap180(angle) {
    return ((angle % 360) + 540) % 360 - 180;
}

function simvorClamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

// Bearing from the first point to the second, degrees true, and the distance in NM
function simvorBearingDistance(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const dLon = (lon2 - lon1) * r;
    const y = Math.sin(dLon) * Math.cos(lat2 * r);
    const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLon);
    const a = Math.pow(Math.sin((lat2 - lat1) * r / 2), 2)
        + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin(dLon / 2), 2);
    return {
        bearing: (Math.atan2(y, x) / r + 360) % 360,
        distance: 2 * SIMVOR_EARTH_NM * Math.asin(Math.min(1, Math.sqrt(a)))
    };
}

// NM at which two antennas see each other over a smooth earth, heights in feet
function simvorRadioHorizon(feetA, feetB) {
    return 1.23 * (Math.sqrt(Math.max(feetA, 0)) + Math.sqrt(Math.max(feetB, 0)));
}

// The status a measurement gets once judged, by how far the station is
function simvorJudged(distance, range) {
    return distance > range * SIMVOR_DEGRADED_SHARE ? SIMVOR_STATUS_DEGRADED : SIMVOR_STATUS_TRACKING;
}

// RB-VOR-IF v2.4 section 2.2: kHz of a channel, its mode, or null for a rejected frequency
function simvorChannel(mhz) {
    const khz = Math.round(mhz * 1000);
    if (!isFinite(khz) || khz < 108000 || khz > 117950 || Math.abs(mhz * 1000 - khz) > 1 || khz % 50 != 0) {
        return null;
    }
    const localizer = khz <= 111950 && Math.floor(khz / 100) % 2 == 1;
    return { khz: khz, localizer: localizer };
}

/**
 * SimulatedVorReceiver Class
 */
function SimulatedVorReceiver() {
    this.navaids = [];
    this.gsShared = false;   // one dongle for the localizer and the glide slope
    this.channel = null;     // the channel tuned, from simvorChannel
    this.tunedAt = 0;        // Date.now() of the retune
    this.gsSelect = 0;
    this.gsSwitchedAt = 0;   // Date.now() of the last LOC/GS switch on a shared dongle
    this.mode = "";          // "geometry" or "demo" for an ILS, for the console
}

SimulatedVorReceiver.prototype = {
    constructor: SimulatedVorReceiver,

    // Of the stations on a frequency, the nearest that a VOR receiver can hear
    station: function (khz, localizer, here) {
        var best = null;
        this.navaids.forEach(navaid => {
            if (Math.round(navaid.freq * 1000) != khz) {
                return;
            }
            const isLoc = navaid.type == "ILS" || navaid.type == "LOC";
            if (isLoc != localizer) {
                return;
            }
            const distance = here ? simvorBearingDistance(here.lat, here.lon, navaid.lat, navaid.lon).distance : 0;
            if (best === null || distance < best.distance) {
                best = { navaid: navaid, distance: distance };
            }
        });
        return best ? best.navaid : null;
    },

    // The aircraft, from the last situation the replay sent; null without a fix
    aircraft: function () {
        const situation = simulatorReplay ? simulatorReplay.lastFrames["/situation"] : undefined;
        if (situation === undefined || !(situation.GPSFixQuality > 0)) {
            return null;
        }
        return { lat: situation.GPSLatitude, lon: situation.GPSLongitude, feet: situation.GPSAltitudeMSL };
    },

    // Every field this receiver publishes, at rest
    idle: function () {
        return {
            "vorradial": 0, "vorsnr": 0, "voram": 0, "vorstatus": 0, "vorsub": 0, "vorfreqactive": 0,
            "locstatus": 0, "locdev": 0, "locddm": 0, "locsdm": 0, "locsnr": 0, "locfreqactive": 0,
            "gsstatus": 0, "gsdev": 0, "gsddm": 0, "gssdm": 0, "gssnr": 0, "gsfreqactive": 0, "gsshared": 0
        };
    },

    // The bridge said something: a retune, or a LOC/GS switch
    command: function (values) {
        if ("vorfreq" in values) {
            const channel = values.vorfreq ? simvorChannel(values.vorfreq) : null;
            const khz = channel ? channel.khz : 0;
            if (khz != (this.channel ? this.channel.khz : 0)) {
                this.channel = channel;
                this.tunedAt = Date.now();
                this.gsSwitchedAt = this.tunedAt;
            }
        }
        if ("gsselect" in values) {
            const select = values.gsselect == 1 ? 1 : 0;
            if (select != this.gsSelect) {
                this.gsSelect = select;
                this.gsSwitchedAt = Date.now();
            }
        }
        this.publish();
    },

    // The status of a receiver `since` ms after it was tuned, or null once it is judged
    settling: function (since) {
        const seconds = (Date.now() - since) / 1000;
        if (seconds < SIMVOR_TUNING_S) {
            return SIMVOR_STATUS_TUNING;
        }
        if (seconds < SIMVOR_TUNING_S + SIMVOR_ACQUIRING_S) {
            return SIMVOR_STATUS_ACQUIRING;
        }
        return null;
    },

    vor: function (payload, here) {
        payload.vorfreqactive = this.channel.khz;
        const settling = this.settling(this.tunedAt);
        if (settling == SIMVOR_STATUS_TUNING) {
            payload.vorstatus = settling;
            return;
        }
        const navaid = this.station(this.channel.khz, false, here);
        // A TACAN's VHF frequency is a DME pairing: there is no VOR on it to hear
        if (navaid === null || here === null || navaid.type == "TACAN") {
            payload.vorstatus = settling || SIMVOR_STATUS_NO_SIGNAL;
            return;
        }
        const geometry = simvorBearingDistance(navaid.lat, navaid.lon, here.lat, here.lon);
        const range = Math.min(navaid.range_nm || SIMVOR_DEFAULT_RANGE_NM,
            simvorRadioHorizon(here.feet, navaid.elevation_ft || 0));
        if (geometry.distance > range) {
            payload.vorstatus = settling || SIMVOR_STATUS_NO_SIGNAL;
            return;
        }
        const now = Date.now() / 1000;
        payload.vorradial = Math.round(geometry.bearing - (navaid.magvar || 0) + 360) % 360;
        payload.vorsnr = Math.round(simvorClamp(48 - geometry.distance * 0.5, 14, 48) + Math.sin(now / 3));
        payload.voram = Math.round(29 + Math.sin(now / 7));
        payload.vorsub = Math.round(30 + Math.sin(now / 5));
        payload.vorstatus = settling || simvorJudged(geometry.distance, range);
    },

    // Deviations in % of full scale, + = 150 Hz predominates, from the aircraft against the station
    // (both null outside the localizer's coverage)
    ilsGeometry: function (navaid, here) {
        const result = { loc: null, gs: null, gsHeard: false };
        if (navaid === null || here === null) {
            return result;
        }
        const geometry = simvorBearingDistance(navaid.lat, navaid.lon, here.lat, here.lon);
        const courseTrue = isFinite(navaid.course_true) ? navaid.course_true : (navaid.course || 0) + (navaid.magvar || 0);
        // On the approach the aircraft is behind the station, on the reciprocal of the front course.
        // Negative = right of the course as seen flying it.
        const off = simvorWrap180(geometry.bearing - courseTrue - 180);
        const heard = geometry.distance <= simvorRadioHorizon(here.feet, navaid.elevation_ft || 0)
            && SIMVOR_LOC_COVERAGE.some(sector => Math.abs(off) <= sector.angle && geometry.distance <= sector.range);
        if (!heard) {
            return result;
        }
        result.distance = geometry.distance;
        result.loc = simvorClamp(-off / SIMVOR_LOC_HALF_SECTOR_DEG * 100, -100, 100);
        if (navaid.type != "ILS") {
            return result;
        }
        const pathAngle = navaid.glideslope || SIMVOR_GS_DEFAULT_ANGLE;
        const elevation = Math.atan2(here.feet - (navaid.elevation_ft || 0), geometry.distance * SIMVOR_FEET_PER_NM) * 180 / Math.PI;
        if (Math.abs(off) <= SIMVOR_GS_LATERAL_DEG && geometry.distance <= SIMVOR_GS_RANGE_NM
            && elevation >= pathAngle * SIMVOR_GS_LOWEST && elevation <= pathAngle * SIMVOR_GS_HIGHEST) {
            result.gsHeard = true;
            result.gs = simvorClamp((pathAngle - elevation) / (pathAngle * SIMVOR_GS_FULL_SCALE) * 100, -100, 100);
        }
        return result;
    },

    // The demonstration approach at `seconds` into a run: an intercept from the right
    // and from below, captured, then the small corrections of a hand-flown approach
    demo: function (seconds) {
        const t = seconds % SIMVOR_DEMO_PERIOD;
        const loc = 100 * Math.exp(-t / 12) * Math.cos(2 * Math.PI * t / 40) + 8 * Math.sin(2 * Math.PI * t / 13);
        const g = Math.max(t - 15, 0);
        const gs = 100 * Math.exp(-g / 12) * Math.cos(2 * Math.PI * g / 50) + 6 * Math.sin(2 * Math.PI * t / 17);
        return { loc: simvorClamp(loc, -100, 100), gs: simvorClamp(gs, -100, 100), gsHeard: true, distance: 5 };
    },

    ils: function (payload, here) {
        const navaid = this.station(this.channel.khz, true, here);
        const gsKhz = SIMVOR_GS_PAIRING[this.channel.khz] || 0;
        const shared = this.gsShared;
        const receiveLoc = !shared || this.gsSelect == 0;
        const receiveGs = !shared || this.gsSelect == 1;
        payload.gsshared = shared ? 1 : 0;

        var measured = this.ilsGeometry(navaid, here);
        this.mode = "geometry";
        if (navaid !== null && measured.loc === null) {
            measured = this.demo((Date.now() - this.tunedAt) / 1000);
            this.mode = "demo";
            if (navaid.type != "ILS") {
                measured.gsHeard = false;
            }
        }
        const since = shared ? this.gsSwitchedAt : this.tunedAt;
        const range = this.mode == "demo" ? SIMVOR_GS_RANGE_NM : (navaid ? navaid.range_nm || 18 : 18);

        if (receiveLoc) {
            payload.locfreqactive = this.channel.khz;
            const settling = this.settling(since);
            if (settling == SIMVOR_STATUS_TUNING) {
                payload.locstatus = settling;
            } else if (measured.loc === null) {
                payload.locstatus = settling || SIMVOR_STATUS_NO_SIGNAL;
            } else {
                payload.locstatus = settling || simvorJudged(measured.distance, range);
                // section 3.11 deadbands: 2 % on locdev, 4 on the DDM
                payload.locddm = 4 * Math.round(measured.loc * 1.55 / 4);
                payload.locsdm = 40;
                payload.locsnr = 4 * Math.round(simvorClamp(40 - measured.distance, 28, 40) / 4);
                if (payload.locstatus >= SIMVOR_STATUS_DEGRADED) {
                    payload.locdev = 2 * Math.round(measured.loc / 2);
                }
            }
        }
        if (receiveGs && gsKhz > 0) {
            payload.gsfreqactive = gsKhz;
            const settling = this.settling(since);
            if (settling == SIMVOR_STATUS_TUNING) {
                payload.gsstatus = settling;
            } else if (!measured.gsHeard) {
                // A localizer-only approach, or out of the glide path's coverage
                payload.gsstatus = settling || SIMVOR_STATUS_NO_SIGNAL;
            } else {
                payload.gsstatus = settling || simvorJudged(measured.distance, SIMVOR_GS_RANGE_NM);
                payload.gsddm = 4 * Math.round(measured.gs * 1.75 / 4);
                payload.gssdm = 80;
                payload.gssnr = 4 * Math.round(simvorClamp(38 - measured.distance, 26, 38) / 4);
                if (payload.gsstatus >= SIMVOR_STATUS_DEGRADED) {
                    payload.gsdev = 2 * Math.round(measured.gs / 2);
                }
            }
        }
    },

    // What the receiver hears now, posted to the bridge: it reaches the plate if anything changed
    publish: function () {
        const payload = this.idle();
        if (this.channel !== null) {
            const here = this.aircraft();
            if (this.channel.localizer) {
                this.ils(payload, here);
            } else {
                this.vor(payload, here);
            }
        }
        daemonBridgeSet(payload);
    }
};

var simulatorVor = new SimulatedVorReceiver();

window.addEventListener("load", function () {
    fetch(URL_SIMVOR_DB_GET).then(function (response) {
        if (!response.ok) {
            throw new Error("HTTP error " + response.status);
        }
        return response.json();
    }).then(function (db) {
        simulatorVor.navaids = (db.navaids || []).filter(navaid =>
            ["VOR", "VOR-DME", "VORTAC", "TACAN", "ILS", "LOC"].indexOf(navaid.type) >= 0
            && isFinite(navaid.lat) && isFinite(navaid.lon) && isFinite(navaid.freq));
    }).catch(function (error) {
        console.error("No stations for the VOR receiver from " + URL_SIMVOR_DB_GET + ": " + error.message);
    });
    // A receiver with loc.enabled and gs.enabled says so from the start
    simulatorVor.publish();
    window.setInterval(() => simulatorVor.publish(), SIMVOR_TICK_MS);
});
