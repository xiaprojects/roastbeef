#!/usr/bin/env python3
"""Integration test: a recorded flight's receiver input through the real stratuxrun.

The fixture is two minutes of I-RVDX's 2026-09-13 flight over central Italy
(log clock 1740-1860 s, the ITY437 overflight at 29 000 ft): every line dump1090
sent the daemon on the aircraft, and the GPS fixes, as a trace that a stratuxrun
built from this checkout replays through its normal input paths. The recording
also holds what the aircraft's daemon made of those same inputs, so that is the
expected output:

  ownship    every fix settles to the recorded situation, float32 for float32
  fusion     each target, after the same messages, has the recorded identity,
             position (bit for bit), altitude, velocity, accuracy and signal
  geometry   distance and bearing are the recorded ones, to within ownship's
             movement between the GPS fixes the log kept (the receiver ran faster)
  currency   each cycle sends the targets the aircraft did, away from the 6 s and
             25 s age limits where a few milliseconds of phase decide (the 6 s limit
             itself only matters for targets without velocity, which this window has
             none of: main/traffic_test.go covers it)
  GDL90      what an EFB receives: valid frames, a heartbeat a second with the GPS
             flag, an ownship report on the GPS position, and no traffic report at
             a position its target never transmitted

Messages the trace has not yet carried cannot be compared (a callsign the aircraft
learnt a minute before the window), so a field is checked only once the trace has
delivered its source, and the first 30 s of the trace only warm the daemon up.

    python3 test_daemon.py              # build, replay (~2.5 min), check
    RB_REPLAY_KEEP=/tmp/r python3 test_daemon.py   # keep the daemon's log and HOME
"""

import bisect
import collections
import json
import math
import os
import re
import sys

import replay
from replay import f32, rfc3339_clock


class Result:
    """PASS/FAIL lines as the display tests print them."""

    def __init__(self):
        self.checks = []

    def check(self, cond, label, extra=""):
        self.checks.append((bool(cond), label))
        print("  %s %s%s" % ("PASS" if cond else "FAIL", label, ("  [%s]" % (extra,)) if extra else ""))
        return bool(cond)

    @property
    def failed(self):
        return [c for c in self.checks if not c[0]]


NAME = "flightlog-20260913111200.0341.1740-1860"
TRACE = os.path.join(replay.FIXTURES, NAME + ".trace.csv.gz")
EXPECTED = os.path.join(replay.FIXTURES, NAME + ".expected.json.gz")

# A message carries the source of a fused field when this holds for it; until the
# trace has delivered one for a target, that field still holds what the aircraft
# learnt before the trace began.
SOURCE = {
    "Tail": lambda m: m["Tail"] is not None and m["DF"] in (17, 18, 20, 21),
    "Emitter_category": lambda m: m["Emitter_category"] is not None,
    "Squawk": lambda m: m["Squawk"] is not None,
    "NACp": lambda m: m["NACp"] is not None,
    "OnGround": lambda m: m["OnGround"] is not None,
    "Addr_type": lambda m: m["DF"] in (17, 18),
    "TargetType": lambda m: m["DF"] in (17, 18),
    "NIC": lambda m: m["DF"] in (17, 18) and 5 <= m["TypeCode"] <= 22 and m["TypeCode"] != 19,
    "Speed": lambda m: m["Speed_valid"],
    "Speed_valid": lambda m: m["Speed_valid"],
    "Track": lambda m: m["Speed_valid"],
    "Vvel": lambda m: m["Speed_valid"],
    "AltIsGNSS": lambda m: True,
    "GnssDiffFromBaroAlt": lambda m: m["GnssDiffFromBaroAlt"] is not None,
    "Alt": lambda m: m["Alt"] is not None,
    "Lat": lambda m: m["Position_valid"],
    "Lng": lambda m: m["Position_valid"],
}
FLOAT32 = {"Lat", "Lng", "Track", "Lat_fix", "Lng_fix"}
SIGNAL_HISTORY = 8          # SignalLevel is the maximum of the last 8 replies
AGE_LIMITS = (6.0, 25.0)    # traffic.go: current while under 6 s, or 25 s extrapolated
AGE_SLACK = 1.5             # seconds either side of a limit not compared
RADAR_RANGE_M = 40 * 1852 * 1.3   # the aircraft's RadarRange, with traffic.go's margin


def gdl90_latlng_field(v):
    """The 24-bit lat/lon field makeLatLng() writes for float32 v (truncated)."""
    wk = int(f32(f32(v) / f32(180.0 / 8388608.0)))
    return wk & 0xFFFFFF


class Inputs:
    """The trace, indexed: each target's messages and position messages on the log
    clock, and the fix times."""

    def __init__(self, trace, offset):
        self.msgs = collections.defaultdict(list)       # icao -> [(t, message)]
        self.fixes = []
        for t, ctx, data in trace:
            t += offset
            if ctx == "dump1090":
                m = json.loads(data)
                if m["Icao_addr"] != 0x07FFFFFF:
                    self.msgs[m["Icao_addr"] & 0xFFFFFF].append((t, m))
            elif data.startswith("$GNGGA"):
                self.fixes.append(t)
        self.times = {icao: [t for t, _ in ms] for icao, ms in self.msgs.items()}
        self.position_times = {icao: [t for t, m in ms if m["Position_valid"]]
                               for icao, ms in self.msgs.items()}
        self.positions = {icao: {(gdl90_latlng_field(m["Lat"]), gdl90_latlng_field(m["Lng"]))
                                 for _, m in ms if m["Position_valid"]}
                          for icao, ms in self.msgs.items()}

    def count(self, icao, t):
        """Messages for icao in the trace up to t."""
        return bisect.bisect_right(self.times.get(icao, []), t)

    def delivered(self, icao, n, field):
        """Whether the first n trace messages for icao include a source of field."""
        if field == "SignalLevel":
            return sum(1 for _, m in self.msgs[icao][:n] if m["SignalLevel"] > 0) >= SIGNAL_HISTORY
        return any(SOURCE[field](m) for _, m in self.msgs[icao][:n])

    def position_age(self, icao, t):
        """Seconds since icao's last position message at t, or None."""
        ts = self.position_times.get(icao, [])
        i = bisect.bisect_right(ts, t)
        return t - ts[i - 1] if i else None

    def fix_at(self, t):
        """Index of the GPS fix ownship was on at t."""
        return bisect.bisect_right(self.fixes, t)


def message_offsets(rows, inputs):
    """Per recorded row, recorded ReceivedMsgs minus the trace messages it reflects.

    The aircraft counted messages since it first heard the target, the replay since the
    trace began, so for one target the difference is a constant - until the aircraft
    dropped the target after 60 s of silence and started again. Rows are split where it
    jumps, and each run takes its most common value (a row's time is only known to
    10 ms, so a reply in the same tick can put it one out)."""
    out = {}
    by_icao = collections.defaultdict(list)
    for i, r in enumerate(rows):
        by_icao[r["Icao_addr"]].append(i)
    for icao, idx in by_icao.items():
        idx.sort(key=lambda i: rows[i]["cycle"])
        runs, run = [], []
        for i in idx:
            d = rows[i]["ReceivedMsgs"] - inputs.count(icao, rows[i]["cycle"])
            if run and abs(d - run[-1][1]) > 5:
                runs.append(run)
                run = []
            run.append((i, d))
        runs.append(run)
        for run in runs:
            mode = collections.Counter(d for _, d in run).most_common(1)[0][0]
            for i, _ in run:
                out[i] = mode
    return out


def same(field, a, b):
    if field == "SignalLevel":
        return abs(a - b) < 1e-6
    if field in FLOAT32:
        return f32(a) == f32(b)
    return a == b


def own_altitudes(situation, times, w):
    """Ownship's altitude as the daemon takes it for its outputs (makeOwnshipReport,
    computeRelativeVertical): the pressure altitude while there is one - here the
    daemon's own estimate from ADS-B, from about two minutes in - else the GPS's. From
    the /situation samples either side of wall time w, since the outputs and the samples
    are not in step."""
    i = bisect.bisect_right(times, w)
    alts = []
    for _, s in situation[max(i - 1, 0):i + 1]:
        baro = rfc3339_clock(s["BaroLastMeasurementTime"])
        fresh = baro > 0 and rfc3339_clock(s["GPSLastFixLocalTime"]) - baro < 15
        alts.append(s["BaroPressureAltitude"] if fresh else s["GPSAltitudeMSL"])
    return alts


def check(run, exp, trace, res):
    offset = exp["offset"]
    inputs = Inputs(trace, offset)
    rows = exp["traffic"]

    # -- the daemon itself -----------------------------------------------------------
    print("\n-- daemon")
    res.check(run.returncode == 0, "stratuxrun replays the whole trace and exits 0", run.returncode)
    crashes = [l for l in run.log.splitlines() if "panic" in l or "runtime error" in l or "fatal error" in l]
    res.check(not crashes, "its log has no panic or runtime error", crashes[:3])

    # -- ownship ----------------------------------------------------------------------
    print("\n-- ownship")
    fix_times = [f["t"] for f in exp["situation"]]
    settled = {}
    for _, s in run.situation:   # the last sample per fix: after its GGA, RMC and GST
        t = rfc3339_clock(s["GPSLastFixLocalTime"]) + offset   # a tick or two after the line
        i = bisect.bisect_right(fix_times, t)
        if i and t - fix_times[i - 1] < 0.3:
            settled[fix_times[i - 1]] = s
    wrong = []
    for fix in exp["situation"]:
        t, s = fix["t"], settled.get(fix["t"])
        if s is None:
            wrong.append((t, "never applied"))
            continue
        for k in replay.SITUATION_FIELDS:
            if (f32(s[k]) != f32(fix[k])) if isinstance(fix[k], float) else s[k] != fix[k]:
                wrong.append((t, k, s[k], fix[k]))
    res.check(fix_times and not wrong, "every one of the %d GPS fixes settles to the recorded "
              "situation, float32 for float32" % len(fix_times), wrong[:3])

    # -- fusion: the replayed state after the same messages ----------------------------
    print("\n-- fusion")
    first = {}
    for _, fr in run.traffic:
        first.setdefault((fr["Icao_addr"], fr["ReceivedMsgs"]), fr)
    offsets = message_offsets(rows, inputs)
    compared = collections.Counter()
    wrong = collections.defaultdict(list)
    matched = unmatched = 0
    for i, r in enumerate(rows):
        icao = r["Icao_addr"]
        n = r["ReceivedMsgs"] - offsets[i]
        fr = first.get((icao, n))
        if n <= 0 or fr is None:
            unmatched += 1
            continue
        matched += 1
        for field in list(SOURCE) + ["SignalLevel"]:
            if not inputs.delivered(icao, n, field):
                continue
            a, b = fr[field], r[field]
            if field in ("Lat", "Lng", "Alt"):
                if r["ExtrapolatedPosition"]:   # the extrapolator moved it; the fix is kept
                    if field == "Alt":
                        continue
                    b = r[field + "_fix"]
                if fr["ExtrapolatedPosition"]:
                    if field == "Alt":
                        continue
                    a = fr[field + "_fix"]
            compared[field] += 1
            if not same(field, a, b):
                wrong[field].append(("%06X" % icao, n, a, b))
    res.check(matched > 0.9 * len(rows), "%d of %d recorded target states found in the replay by "
              "message count" % (matched, len(rows)), "%d before the trace" % unmatched)
    for field in list(SOURCE) + ["SignalLevel"]:
        res.check(compared[field] and not wrong[field],
                  "%-20s matches in %d states" % (field, compared[field]), wrong[field][:3])

    # -- geometry and currency, per cycle ------------------------------------------------
    print("\n-- geometry and currency")
    rec_cycles = collections.defaultdict(dict)
    for r in rows:
        rec_cycles[round(r["cycle"], 1)][r["Icao_addr"]] = r
    rec_times = sorted(rec_cycles)
    rep_cycles = collections.defaultdict(dict)
    for _, fr in run.radar:
        if fr["Position_valid"]:
            t = rfc3339_clock(fr["Last_seen"]) + fr["Age"] + offset
            rep_cycles[round(t, 1)][fr["Icao_addr"]] = fr

    # The log kept one GPS fix a second from a faster receiver, so the aircraft may have
    # computed from a sample between two logged fixes: allow ownship's movement over the
    # interval between them, and nothing for the target, whose position is the same.
    speed = {f["t"]: f["GPSGroundSpeed"] * 0.514444 for f in exp["situation"]}
    geometry, wrong_geo = 0, []
    by_count = collections.defaultdict(list)
    for t, cyc in rep_cycles.items():
        for icao, fr in cyc.items():
            by_count[(icao, fr["ReceivedMsgs"])].append((t, fr))
    for i, r in enumerate(rows):
        if r["ExtrapolatedPosition"] or not r["BearingDist_valid"]:
            continue
        for t, fr in by_count.get((r["Icao_addr"], r["ReceivedMsgs"] - offsets[i]), []):
            if fr["ExtrapolatedPosition"] or inputs.fix_at(t) != inputs.fix_at(r["cycle"]):
                continue
            i = inputs.fix_at(r["cycle"])
            if not 0 < i < len(fix_times):
                continue
            tol = speed[fix_times[i - 1]] * (fix_times[i] - fix_times[i - 1]) + 1.0
            geometry += 1
            if (abs(fr["Distance"] - r["Distance"]) > tol or
                    abs(fr["Bearing"] - r["Bearing"]) > math.degrees(math.atan2(tol, r["Distance"])) + 1e-3):
                wrong_geo.append(("%06X" % r["Icao_addr"], fr["Distance"], r["Distance"],
                                  fr["Bearing"], r["Bearing"]))
    res.check(geometry > 100 and not wrong_geo, "distance and bearing agree with the recorded ones, "
              "to ownship's movement between logged fixes, in %d cycles" % geometry, wrong_geo[:3])

    def near_limit(icao, t):
        age = inputs.position_age(icao, t)
        return age is None or any(abs(age - lim) < AGE_SLACK for lim in AGE_LIMITS)

    seen_at = collections.defaultdict(list)
    for r in rows:
        seen_at[r["Icao_addr"]].append(r["cycle"])
    cycles, missing, phantom, holes = 0, [], [], 0
    for t, cyc in sorted(rep_cycles.items()):
        if not exp["start"] + 1 < t < exp["end"] - 1:
            continue
        j = bisect.bisect_left(rec_times, t)
        near = min(rec_times[max(j - 1, 0):j + 1], key=lambda x: abs(x - t))
        if abs(near - t) > 1.0:
            continue
        cycles += 1
        rec = rec_cycles[near]
        for icao in set(cyc) | set(rec):
            if near_limit(icao, t) or near_limit(icao, near):
                continue
            if icao in rec and icao not in cyc and rec[icao]["Distance"] < RADAR_RANGE_M * 0.95:
                missing.append((round(t, 1), "%06X" % icao))
            if icao in cyc and icao not in rec:
                # The aircraft's daemon dropped dead-reckoned targets for one cycle at a time
                # (fixed since; see extrapolateStaleTraffic): a hole between two recorded
                # cycles is that, not a target the replay made up.
                if any(abs(c - near) < 1.5 for c in seen_at[icao]):
                    holes += 1
                else:
                    phantom.append((round(t, 1), "%06X" % icao))
    res.check(cycles > 100, "%d replayed cycles paired with a recorded one" % cycles)
    res.check(not missing, "no target the aircraft sent is missing from the replay", missing[:5])
    res.check(not phantom, "no target is sent that the aircraft did not send",
              "%d one-cycle gaps in the recording filled" % holes if not phantom else phantom[:5])

    # -- GDL90, as an EFB receives it --------------------------------------------------------
    print("\n-- GDL90")
    msgs, bad = [], 0
    for w, buf in run.gdl90:
        for p in replay.gdl90_messages(buf):
            if p is None:
                bad += 1
            else:
                msgs.append((w, p))
    res.check(msgs and not bad, "%d messages, every CRC valid" % len(msgs), "%d bad" % bad)
    duration = trace[-1][0]
    beats = [p for _, p in msgs if p[0] == 0x00]
    res.check(abs(len(beats) - duration) <= 3, "one heartbeat a second (%d in %.0f s)" % (len(beats), duration))
    gps_beats = [p for p in beats[int(replay.LEAD) + 3:] if not p[1] & 0x80]
    res.check(not gps_beats, "heartbeats flag the GPS position valid once fixes arrive",
              "%d without" % len(gps_beats))
    fix_fields = {(gdl90_latlng_field(f["GPSLatitude"]), gdl90_latlng_field(f["GPSLongitude"]))
                  for f in exp["situation"]}
    own = [replay.gdl90_report(p) for _, p in msgs if p[0] == 0x0A]
    off_fix = [o for o in own if (int(o["lat"] * (1 << 23) / 180) & 0xFFFFFF,
                                  int(o["lng"] * (1 << 23) / 180) & 0xFFFFFF) not in fix_fields]
    res.check(len(own) >= duration - replay.LEAD - 5, "an ownship report every second with a fix "
              "(%d)" % len(own))
    res.check(not off_fix, "every ownship report is at a GPS fix's position", off_fix[:2])
    times = [w for w, _ in run.situation]
    wrong_alt = []
    for w, p in msgs:
        if p[0] == 0x0A:
            alt = replay.gdl90_report(p)["alt"]   # 25 ft steps, truncated
            if alt is None or not any(0 <= a - alt < 25 for a in own_altitudes(run.situation, times, w)):
                wrong_alt.append((round(w - run.started, 1), alt, own_altitudes(run.situation, times, w)))
    res.check(not wrong_alt, "every ownship report's altitude is the daemon's pressure altitude, or "
              "the GPS's while it has none", wrong_alt[:3])
    hae = {int(f32(f32(f["GPSHeightAboveEllipsoid"]) / f32(5.0))) for f in exp["situation"]}
    geo = [int.from_bytes(p[1:3], "big", signed=True) for _, p in msgs if p[0] == 0x0B]
    res.check(len(geo) >= duration - replay.LEAD - 5 and all(g in hae for g in geo),
              "a geometric altitude every second with a fix, each a fix's height above the "
              "ellipsoid (%d)" % len(geo), [g * 5 for g in geo if g not in hae][:3])
    reports = [replay.gdl90_report(p) for _, p in msgs if p[0] == 0x14]
    invented = [rp for rp in reports if not rp["misc"] & 0x04 and
                (int(rp["lat"] * (1 << 23) / 180) & 0xFFFFFF, int(rp["lng"] * (1 << 23) / 180) & 0xFFFFFF)
                not in inputs.positions.get(rp["icao"], ())]
    res.check(reports and not invented, "none of %d traffic reports is at a position its target "
              "did not transmit (extrapolated ones are flagged)" % len(reports),
              [("%06X" % rp["icao"], rp["lat"], rp["lng"]) for rp in invented[:3]])
    unknown = {rp["icao"] for rp in reports} - set(inputs.msgs)
    res.check(not unknown, "every reported address was received", ["%06X" % a for a in unknown])


NMEA_TYPES = {"GPRMC", "GPGGA", "GPGSA", "PGRMZ", "PFLAA", "PFLAU"}
_NMEA = re.compile(r"\$([^$*]*)\*([0-9A-F]{2})\r\n")


def nmea_fields(line):
    """The fields of $<body>*<checksum>CRLF, or None if it is not one or the checksum
    is wrong."""
    m = _NMEA.fullmatch(line)
    if not m:
        return None
    x = 0
    for c in m.group(1).encode("ascii", "replace"):
        x ^= c
    return m.group(1).split(",") if x == int(m.group(2), 16) else None


def nmea_degrees(field, hemisphere):
    v = float(field)
    d = math.floor(v / 100) + math.fmod(v, 100) / 60
    return -d if hemisphere in "SW" else d


def dist_rect(lat1, lon1, lat2, lon2):
    """common.DistRect: metres north and east from point 1 to point 2."""
    r = 6371008.8
    return (math.radians(lat2 - lat1) * r,
            math.radians(lon2 - lon1) * r * abs(math.cos(math.radians((lat1 + lat2) / 2))))


def bursts(items, gap=0.3):
    """Group [(wall time, x)], in time order, into bursts separated by more than gap s."""
    out = []
    for w, x in items:
        if out and w - out[-1][-1][0] < gap:
            out[-1].append((w, x))
        else:
            out.append([(w, x)])
    return out


# What a glider computer or EFB on the FLARM NMEA port receives, checked against the
# GDL90 an EFB receives from the same replay: the two are written by the same loop over
# the traffic table, so each 1 Hz cycle must name the same targets on both, in the same
# place relative to ownship.
# Covers: RB-HLR-TRF-320
def test_flarm_nmea(run, exp, trace, res):
    print("\n-- FLARM NMEA (TCP :%d)" % replay.NMEA_PORT)
    if run.nmea is None:
        print("  SKIP port %d was in use before the daemon started (another stratuxrun?)" % replay.NMEA_PORT)
        return
    duration, offset = trace[-1][0], exp["offset"]
    sentences, bad = [], []
    for w, line in run.nmea:
        f = nmea_fields(line)
        if f is None:
            bad.append(line)
        else:
            sentences.append((w, f))
    res.check(sentences and not bad, "%d sentences, every one $<body>*<checksum>CRLF with a valid "
              "checksum" % len(sentences), bad[:3])
    types = collections.Counter(f[0] for _, f in sentences)
    res.check({"GPRMC", "GPGGA", "PFLAA", "PFLAU"} <= set(types) <= NMEA_TYPES,
              "the sentences expected, and only those", dict(types))
    pflau = [(w, f) for w, f in sentences if f[0] == "PFLAU"]
    res.check(abs(len(pflau) - duration) <= 3 and all(len(f) == 11 for _, f in pflau),
              "one 11-field PFLAU a second (%d in %.0f s)" % (len(pflau), duration))

    # Ownship: every RMC and GGA with a fix is at a recorded GPS fix, to the 0.00001'
    # the format carries; the GGA altitude in metres to its 0.1 m.
    fixes = exp["situation"]
    def at_fix(lat, lng, alt_m=None):
        return any(abs(lat - f32(x["GPSLatitude"])) < 1e-5 / 60 and abs(lng - f32(x["GPSLongitude"])) < 1e-5 / 60
                   and (alt_m is None or abs(alt_m - f32(x["GPSAltitudeMSL"]) / 3.28084) < 0.051)
                   for x in fixes)
    rmc = [f for _, f in sentences if f[0] == "GPRMC" and f[2] == "A"]
    gga = [f for _, f in sentences if f[0] == "GPGGA" and f[6] != "0"]
    off = [f for f in rmc if not at_fix(nmea_degrees(f[3], f[4]), nmea_degrees(f[5], f[6]))]
    off += [f for f in gga if not at_fix(nmea_degrees(f[2], f[3]), nmea_degrees(f[4], f[5]), float(f[9]))]
    res.check(len(rmc) >= duration - replay.LEAD - 5 and len(gga) == len(rmc) and not off,
              "an RMC and a GGA every second with a fix, each at a recorded fix (%d)" % len(rmc), off[:2])
    first_fix = next((w for w, f in sentences if f[0] == "GPRMC" and f[2] == "A"), None)
    no_gps = [f for w, f in pflau if first_fix is not None and w > first_fix + 3 and f[3] != "2"]
    res.check(first_fix is not None and not no_gps, "PFLAU reports the GPS fix once fixes arrive",
              "%d without" % len(no_gps))

    # Traffic, cycle by cycle against the GDL90 traffic reports.
    gdl = []
    for w, buf in run.gdl90:
        gdl += [(w, replay.gdl90_report(p)) for p in replay.gdl90_messages(buf) if p and p[0] == 0x14]
    gdl_cycles = bursts(gdl)
    gdl_times = [b[0][0] for b in gdl_cycles]
    situation = [(w, s) for w, s in run.situation]
    situation_times = [w for w, _ in situation]
    fix_times = [x["t"] for x in fixes]
    cycles, paired, differ, wrong_ne, wrong_vert, positioned = 0, set(), [], [], [], 0
    for b in bursts([(w, f) for w, f in sentences if f[0] in ("PFLAA", "PFLAU")]):
        w0 = b[0][0]
        j = bisect.bisect_left(gdl_times, w0 - 0.5)
        near = [k for k in range(j, min(j + 2, len(gdl_times))) if abs(gdl_times[k] - w0) < 0.5]
        reports = {}
        for k in near:
            paired.add(k)
            reports.update({r["icao"]: r for _, r in gdl_cycles[k]})
        pflaa = {int(f[6].split("!")[0], 16): f for _, f in b if f[0] == "PFLAA" and f[3] != ""}
        cycles += 1
        if set(pflaa) != set(reports):
            differ.append((round(w0 - run.started, 1), sorted("%06X" % a for a in set(pflaa) ^ set(reports))))
            continue
        # The cycle's ownship is one of the recorded fixes: the one that puts the target
        # where the GDL90 report has it, to the report's 2.4 m resolution and the metre
        # PFLAA truncates to.
        t = w0 - run.started + offset
        cands = fixes[bisect.bisect_left(fix_times, t - 3):bisect.bisect_right(fix_times, t + 0.5)]
        own_alts = own_altitudes(situation, situation_times, w0)
        for icao, f in pflaa.items():
            r = reports[icao]
            positioned += 1
            errs = [max(abs(int(f[2]) - n), abs(int(f[3]) - e)) for n, e in
                    (dist_rect(f32(x["GPSLatitude"]), f32(x["GPSLongitude"]), r["lat"], r["lng"]) for x in cands)]
            if not errs or min(errs) > 5:
                wrong_ne.append(("%06X" % icao, f[2], f[3], round(min(errs), 1) if errs else None))
            if r["alt"] is not None and own_alts:
                # GDL90 altitude is 25 ft steps, PFLAA metres truncated
                if min(abs(int(f[4]) - (r["alt"] - a) * 0.3048) for a in own_alts) > 25 * 0.3048 + 1.5:
                    wrong_vert.append(("%06X" % icao, f[4], r["alt"], own_alts))
    unpaired = [round(gdl_times[k] - run.started, 1) for k in range(len(gdl_cycles)) if k not in paired
                and run.nmea and run.nmea[0][0] + 1 < gdl_times[k] < run.nmea[-1][0] - 1]
    res.check(cycles > 100 and not differ and not unpaired, "each of %d cycles sends PFLAA for exactly "
              "the targets it sends GDL90 traffic reports for" % cycles,
              differ[:3] or ["GDL90 without PFLAA at %s" % unpaired[:3]] if differ or unpaired else "")
    res.check(positioned > 1000 and not wrong_ne, "PFLAA relative north/east put each of %d targets where "
              "its GDL90 report does, to 5 m" % positioned, wrong_ne[:3])
    res.check(not wrong_vert, "PFLAA relative vertical matches the GDL90 altitude, to its 25 ft step",
              wrong_vert[:3])


def main():
    trace = replay.read_trace(TRACE)
    exp = replay.read_expected(EXPECTED)
    print("replaying %s: %d lines, %.0f s" % (NAME, len(trace), trace[-1][0]))
    run = replay.run(TRACE, exp["settings"], keep=os.environ.get("RB_REPLAY_KEEP"))
    res = Result()
    check(run, exp, trace, res)
    test_flarm_nmea(run, exp, trace, res)
    print("\n%d checks, %d failed" % (len(res.checks), len(res.failed)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
