"""Read a recorded Stratux flight log back as WebSocket frames. Standard library only.

`main/datalog.go` writes the daemon's state to SQLite as it runs: the very same
`mySituation`, `TrafficInfo`, EMS and status structs that go out on the service
WebSockets, one row each time they are broadcast. Reading those rows back and
pushing them down the same sockets therefore replays a real flight into the
HMI, with no hardware and no Go daemon.

    log = FlightLog("test-data/flightlog-sample.sqlite")
    for t, path, frame in log.events():          # t: seconds since the log began
        srv.push(path, frame)

The daemon builds the tables by reflection over its Go structs, so the columns
drift with the code (a January 2026 log and a June 2026 log already differ).
Everything here discovers the columns at run time; nothing assumes a list.

Three things differ between a row and the JSON the daemon sends, and are undone
in `frame()`:

- `time.Time` fields are stored via `String()` ("2026-06-14 10:22:43.88 +0000 UTC")
  where `encoding/json` emits RFC 3339 ("2026-06-14T10:22:43.88Z"). The plates
  `Date.parse()` these, and only the RFC form parses reliably.
- Nested structs with a `String()` method (`Magnetometer`) are stored as a JSON
  *string*, where the socket carries a nested object.
- `bool` is stored as INTEGER 0/1, where the socket carries true/false.

A log is named by path, or by its file name in test-data/ (with or without
`.sqlite`, or any unique part of it): `FlightLog("flightlog-sample")`.

CLI:
    python3 flightlog.py list
    python3 flightlog.py info    <log>
    python3 flightlog.py extract <in> <out.sqlite> --from 120 --to 300
    python3 flightlog.py expect  <log> [out.json]     # checkpoints for test_flight.py
    python3 flightlog.py path    <log> [out.json]     # committable track for flightpath.py
"""

import heapq
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
# Where the repo keeps sample recordings; a log can be named by its file there
TEST_DATA = os.path.join(os.path.dirname(os.path.dirname(HERE)), "test-data")

# Which table feeds which socket. Order matters only as a tiebreak when two
# streams share a timestamp: the situation goes first, like the daemon, which
# updates ownship before it extrapolates traffic against it.
STREAMS = (
    ("mySituation", "/situation"),
    ("traffic", "/traffic"),
    ("ems", "/ems"),
    ("bridgefloat", "/bridge/float/ws"),
    ("status", "/status"),
)

# `ems` and `bridgefloat` hold one (SensorName, SensorValue) row per *changed*
# reading, but their sockets send the whole accumulated {name: value} map on
# every change (managementinterface.go, handleEMSSetRequest). The plates rely on
# that: ems.js zeroes any gauge whose source is missing from a frame. So the
# rows are folded into a running map and the map is what gets replayed.
KEY_VALUE_TABLES = ("ems", "bridgefloat")

# Go `bool` fields, stored as INTEGER. From `grep bool` over TrafficInfo,
# status and MagnetometerData in main/. SituationData has none.
BOOL_COLUMNS = {
    "OnGround", "Position_valid", "AltIsGNSS", "Speed_valid", "ExtrapolatedPosition",
    "BearingDist_valid", "IsStratux",
    "OGN_connected", "APRS_connected", "AIS_connected", "Ping_connected",
    "Pong_connected", "UATRadio_connected", "GPS_connected", "FLARM_In_connected",
    "BMPConnected", "IMUConnected", "NightMode", "OGN_tx_enabled",
    "Calibrating",
}

# Seconds of silence inserted between two daemon starts found in one file.
SESSION_GAP = 1.0

# Go time.Time.String(): "2026-06-14 10:22:43.88 +0000 UTC", optionally with the
# monotonic reading ("m=+8.819") that time.Now() carries (seen in ems.Clock).
_GO_TIME = re.compile(
    r"^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d+))? ([+-])(\d\d)(\d\d) \w+(?: m=.*)?$")


def go_time_to_rfc3339(text):
    """'2026-06-14 10:22:43.88 +0000 UTC' -> '2026-06-14T10:22:43.88Z', like encoding/json."""
    m = _GO_TIME.match(text)
    if not m:
        return text
    y, mo, d, h, mi, s, frac, sign, zh, zm = m.groups()
    out = "%s-%s-%sT%s:%s:%s" % (y, mo, d, h, mi, s)
    if frac:
        out += "." + frac
    if zh == "00" and zm == "00":
        return out + "Z"
    return "%s%s%s:%s" % (out, sign, zh, zm)


def parse_go_time(text):
    """Go time.Time.String() -> naive UTC datetime. Year-1 (stratuxClock) values parse too."""
    m = _GO_TIME.match(text)
    if not m:
        raise ValueError("not a Go time: %r" % text)
    y, mo, d, h, mi, s, frac, sign, zh, zm = m.groups()
    micro = int((frac or "0").ljust(6, "0")[:6])
    dt = datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), micro)
    offset = timedelta(hours=int(zh), minutes=int(zm))
    return dt - offset if sign == "+" else dt + offset


def frame(row):
    """One sqlite row -> the dict the daemon would have sent on the socket."""
    out = {}
    for key in row.keys():
        if key in ("id", "timestamp_id"):
            continue
        value = row[key]
        if isinstance(value, str):
            if _GO_TIME.match(value):
                value = go_time_to_rfc3339(value)
            elif value.startswith("{") and value.endswith("}"):
                try:
                    value = json.loads(value)
                except ValueError:
                    pass
        elif key in BOOL_COLUMNS:
            value = bool(value)
        out[key] = value
    return out


def available(folder=TEST_DATA):
    """The flight logs in `folder`, as [(name, path)]. The name is the file
    name without .sqlite - what resolve() and every `log` argument accept."""
    if not os.path.isdir(folder):
        return []
    return [(fn[:-len(".sqlite")], os.path.join(folder, fn))
            for fn in sorted(os.listdir(folder)) if fn.endswith(".sqlite")]


def resolve(name, folder=TEST_DATA):
    """A log's path from a path, or from its name in `folder`: exact (with or
    without .sqlite) first, then any unique part of the name."""
    if os.path.isfile(name):
        return name
    logs = available(folder)
    for n, path in logs:
        if name in (n, n + ".sqlite"):
            return path
    hits = [path for n, path in logs if name in n]
    if len(hits) == 1:
        return hits[0]
    names = ", ".join(n for n, _ in logs) or "none"
    if hits:
        raise FileNotFoundError("%r matches several logs in %s: %s" % (name, folder, names))
    raise FileNotFoundError("no flight log %r (a path, or one of %s in %s)" % (name, names, folder))


def summary(path):
    """What a listing shows for one log; never raises (an empty or foreign
    file gets an "error" instead of duration/sessions)."""
    out = {"name": os.path.basename(path)[:-len(".sqlite")] if path.endswith(".sqlite")
           else os.path.basename(path),
           "path": path, "size": os.path.getsize(path)}
    try:
        log = FlightLog(path)
    except (ValueError, sqlite3.DatabaseError) as exc:
        out["error"] = str(exc).split(": ", 1)[-1]
        return out
    out.update(duration=round(log.duration, 1), sessions=len(log.sessions),
               started=log.started.strftime("%Y-%m-%d %H:%M UTC") if log.started else None,
               situations=log.count("mySituation") if "mySituation" in log.tables else 0,
               targets=log.db.execute("SELECT COUNT(DISTINCT Icao_addr) FROM traffic").fetchone()[0]
               if "traffic" in log.tables else 0)
    log.close()
    return out


class FlightLog:
    """A recorded flight, read-only."""

    def __init__(self, path):
        self.path = resolve(path)
        # immutable=1: a plain read-only open of a WAL-mode file still creates
        # -wal/-shm files beside it, which is no way to treat a fixture in the
        # repo. The daemon has finished with these files, so nothing is lost.
        # check_same_thread=False: Replay iterates the generators from its own
        # thread. Only one thread ever reads at a time.
        self.db = sqlite3.connect("file:%s?mode=ro&immutable=1" % self.path, uri=True,
                                  check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.tables = [r[0] for r in self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        if "timestamp" not in self.tables:
            raise ValueError("%s: no 'timestamp' table - not a Stratux flight log" % self.path)
        # timestamp.id -> seconds since the log began. Every row in every other
        # table points here via timestamp_id, so this is the one clock.
        #
        # The clock is StratuxClock_value, not the GPS time: it is present on
        # every bucket and monotonic from daemon start, whereas the GPS time is
        # only there once a fix exists (the January 2026 logs open with a few
        # stratuxClock-only buckets). One legacy `stratux.sqlite` file can hold
        # several daemon starts, each with the clock reset to zero - those
        # sessions are laid end to end with a short gap.
        self._t = {}
        self.sessions = []
        cur = None
        offset = 0.0
        for tid, startup, clock, pref, gps in self.db.execute(
                "SELECT id, StartupID, StratuxClock_value, Time_type_preference, GPSClock_value "
                "FROM timestamp ORDER BY id"):
            clock = parse_go_time(clock)
            if cur is None or startup != cur["startup"]:
                if cur is not None:
                    offset = cur["end"] + SESSION_GAP
                cur = {"startup": startup, "clock0": clock, "start": offset,
                       "end": offset, "gps": None}
                self.sessions.append(cur)
            t = offset + (clock - cur["clock0"]).total_seconds()
            self._t[tid] = t
            cur["end"] = t
            if pref and cur["gps"] is None:
                cur["gps"] = parse_go_time(gps)
        self.started = next((s["gps"] for s in self.sessions if s["gps"]), None)
        self.duration = cur["end"] if cur else 0.0

    def close(self):
        self.db.close()

    def columns(self, table):
        return [r[1] for r in self.db.execute("PRAGMA table_info(%s)" % table)]

    def count(self, table):
        return self.db.execute("SELECT COUNT(*) FROM %s" % table).fetchone()[0]

    # -- time window -> timestamp id range --------------------------------
    def _id_range(self, start, end):
        """Smallest and largest timestamp.id whose time lies in [start, end]."""
        ids = [tid for tid, t in self._t.items()
               if t >= start and (end is None or t <= end)]
        if not ids:
            return None
        return min(ids), max(ids)

    def _rows(self, table, start, end):
        rng = self._id_range(start, end)
        if rng is None or table not in self.tables:
            return iter(())
        return self.db.execute(
            "SELECT * FROM %s WHERE timestamp_id BETWEEN ? AND ? ORDER BY id" % table, rng)

    # -- per-stream generators of (t, frame) -------------------------------
    def stream(self, table, start=0.0, end=None):
        """Yield (t, frame) for one table, in the order the daemon sent them."""
        if table in KEY_VALUE_TABLES:
            state = self._kv_state_before(table, start)
            bucket_id = None
            for row in self._rows(table, start, end):
                if row["timestamp_id"] != bucket_id and bucket_id is not None:
                    yield self._t[bucket_id], dict(state)
                bucket_id = row["timestamp_id"]
                state[row["SensorName"]] = row["SensorValue"]
            if bucket_id is not None:
                yield self._t[bucket_id], dict(state)
            return
        for row in self._rows(table, start, end):
            yield self._t[row["timestamp_id"]], frame(row)

    def _kv_state_before(self, table, start):
        """The sensor map as the daemon held it just before `start`: the last
        value logged for each name. Empty when starting from the top."""
        state = {}
        if table not in self.tables or start <= 0.0:
            return state
        window = self._id_range(start, None)
        if window is None:
            return state
        for name, value in self.db.execute(
                "SELECT SensorName, SensorValue FROM %s WHERE timestamp_id < ? ORDER BY id"
                % table, (window[0],)):
            state[name] = value
        return state

    def events(self, start=0.0, end=None, streams=None):
        """Yield (t, socket path, frame) across streams, merged in time order.

        `streams` is a list of socket paths to include; default is all present.
        """
        def feed(table, path, order):
            # A helper rather than a generator expression in the loop: the
            # expression would close over `path` late and tag every event with
            # the last stream's path.
            for n, (t, fr) in enumerate(self.stream(table, start, end)):
                yield t, order, n, path, fr

        feeds = [feed(table, path, order)
                 for order, (table, path) in enumerate(STREAMS)
                 if table in self.tables and not (streams and path not in streams)]
        for t, _order, _n, path, fr in heapq.merge(*feeds, key=lambda e: e[:3]):
            yield t, path, fr

    def situation_at(self, t):
        """The last situation frame at or before `t`, or None. Seeds a fresh display."""
        rng = self._id_range(0.0, t)
        if rng is None or "mySituation" not in self.tables:
            return None
        row = self.db.execute(
            "SELECT * FROM mySituation WHERE timestamp_id <= ? ORDER BY id DESC LIMIT 1",
            (rng[1],)).fetchone()
        return frame(row) if row else None

    def traffic_at(self, t, window=5.0):
        """Every distinct target with a valid position reported in the `window`
        seconds up to `t` - what the daemon sends when a /traffic socket connects."""
        latest = {}
        for _t, fr in self.stream("traffic", max(0.0, t - window), t):
            if fr.get("Position_valid"):
                latest[fr["Icao_addr"]] = fr
        return list(latest.values())

    # -- summary -----------------------------------------------------------
    def info(self):
        lines = ["%s" % self.path,
                 "  duration %.0f s, %d timestamp buckets, %d session%s" % (
                     self.duration, len(self._t), len(self.sessions),
                     "" if len(self.sessions) == 1 else "s")]
        for s in self.sessions:
            lines.append("    startup %d  t=%.0f..%.0f s  %s" % (
                s["startup"], s["start"], s["end"],
                ("GPS %s UTC" % s["gps"]) if s["gps"] else "no GPS time"))
        for table in self.tables:
            if table == "sqlite_sequence":
                continue
            n = self.count(table)
            extra = ""
            if table == "mySituation" and n and self.duration:
                extra = "  (%.2f Hz)" % (n / self.duration)
            elif table == "traffic" and n:
                extra = "  (%d targets)" % self.db.execute(
                    "SELECT COUNT(DISTINCT Icao_addr) FROM traffic").fetchone()[0]
            elif table in KEY_VALUE_TABLES and n:
                names = [r[0] for r in self.db.execute(
                    "SELECT DISTINCT SensorName FROM %s ORDER BY 1" % table)]
                extra = "  (%d sensors: %s%s)" % (
                    len(names), ", ".join(names[:6]), ", ..." if len(names) > 6 else "")
            lines.append("  %-18s %7d rows%s" % (table, n, extra))
        return "\n".join(lines)


# -- expectations for an integration test ----------------------------------

# What a checkpoint records of the situation: the fields the plates display
# directly (attitude.html binds parseInt() of the first four, rotate() of the
# roll) plus what a map or a reviewer needs to place the moment.
CHECKPOINT_FIELDS = ("GPSGroundSpeed", "GPSAltitudeMSL", "GPSTrueCourse", "AHRSGyroHeading",
                     "AHRSRoll", "AHRSPitch", "GPSVerticalSpeed", "BaroPressureAltitude",
                     "GPSLatitude", "GPSLongitude", "GPSFixQuality")
AIRBORNE_KT = 40.0          # ground speed above which the aircraft is flying
# map.js admits and keeps a target while its Age is within the shared
# TRAFFIC_MAX_AGE_SECONDS (59 s, js/global.js - the map's own 15 s constant
# only drives the opacity fade) and ages it by wall clock from receipt; a
# replay delivers a window in a burst, so the set it shows sits between
# "surely still there" and "possibly still there".
TRAFFIC_MUST_AGE, TRAFFIC_MAY_AGE, TRAFFIC_WINDOW = 54.0, 64.0, 10.0


def _median(values):
    values = sorted(values)
    return values[len(values) // 2] if values else 0.0


def checkpoints(log):
    """Moments of a flight worth verifying, derived from its own profile:
    [(name, t, why)]. A recording with no take-off gets start/middle/end."""
    sit = list(log.stream("mySituation"))
    if not sit:
        return []
    airborne = [(t, f) for t, f in sit if f["GPSGroundSpeed"] > AIRBORNE_KT]
    lo, hi = 10.0, max(10.0, log.duration - 5.0)
    clamp = lambda t: min(max(t, lo), hi)
    if len(airborne) < 30:
        third = log.duration / 3
        return [("start", clamp(10.0), "10 s in"),
                ("middle", clamp(third * 1.5), "halfway"),
                ("end", clamp(log.duration - 10), "10 s before the end")]

    t_off, t_land = airborne[0][0], airborne[-1][0]
    ground = sit[0][1]["GPSAltitudeMSL"]
    t_top, top = max(sit, key=lambda e: e[1]["GPSAltitudeMSL"])
    t_climb = next((t for t, f in sit
                    if t > t_off and f["GPSAltitudeMSL"] >= ground + 0.6 * (top["GPSAltitudeMSL"] - ground)),
                   t_top)
    # steepest sustained bank: the 5 s median of |roll|, ignoring sensor
    # glitches beyond 80 degrees
    rolls = [(t, abs(f["AHRSRoll"])) for t, f in airborne if abs(f["AHRSRoll"]) <= 80]
    t_turn, best = t_top, -1.0
    for i in range(len(rolls)):
        window = [r for t, r in rolls[i:i + 5]]
        if len(window) == 5 and _median(window) > best:
            best, t_turn = _median(window), rolls[i + 2][0]
    t_final = next((t for t, f in reversed(airborne)
                    if t < t_land - 5 and f["GPSAltitudeMSL"] < ground + 500 and f["GPSGroundSpeed"] > 55),
                   t_land - 20)
    named = [("takeoff", t_off + 10, "10 s after ground speed first exceeded %.0f kt" % AIRBORNE_KT),
             ("climb", t_climb, "60%% of the way from %.0f ft to the top of climb" % ground),
             ("top", t_top, "highest altitude of the flight"),
             ("turn", t_turn, "steepest sustained bank (5 s median of |roll|: %.0f deg)" % best),
             ("final", t_final, "last time below %.0f ft and above 55 kt before landing" % (ground + 500)),
             ("landed", t_land + 15, "15 s after ground speed last exceeded %.0f kt" % AIRBORNE_KT)]
    out, seen = [], set()
    for name, t, why in sorted(named, key=lambda e: e[1]):
        t = round(clamp(t), 1)
        if t not in seen:
            seen.add(t)
            out.append((name, t, why))
    return out


def expectations(log):
    """What the display must show at each checkpoint of `log`, as JSON-ready
    data: the situation fields, the accumulated EMS and bridge maps, and the
    traffic targets that must / may be on the map."""
    cps = []
    for name, t, why in checkpoints(log):
        sit = log.situation_at(t) or {}
        latest = {}
        for _t, fr in log.stream("traffic", max(0.0, t - TRAFFIC_WINDOW), t):
            if fr.get("Position_valid"):
                latest[fr["Icao_addr"]] = fr
        targets = sorted(latest.values(), key=lambda fr: fr.get("Age", 0))
        cps.append({
            "name": name, "t": t, "why": why,
            "situation": {k: sit.get(k) for k in CHECKPOINT_FIELDS},
            "ems": log._kv_state_before("ems", t + 1e-3),
            "bridge": log._kv_state_before("bridgefloat", t + 1e-3),
            "traffic": {
                "must": [{"Icao_addr": fr["Icao_addr"], "Tail": fr.get("Tail", ""), "Age": fr.get("Age")}
                         for fr in targets if fr.get("Age", 99) <= TRAFFIC_MUST_AGE],
                "may": [{"Icao_addr": fr["Icao_addr"], "Tail": fr.get("Tail", ""), "Age": fr.get("Age")}
                        for fr in targets if fr.get("Age", 99) <= TRAFFIC_MAY_AGE]},
        })
    return {"log": os.path.basename(log.path), "duration": round(log.duration, 1),
            "started": log.started.strftime("%Y-%m-%dT%H:%M:%SZ") if log.started else None,
            "checkpoints": cps}


# -- fixture extraction -----------------------------------------------------

# What a replay needs. The raw radio tables (es_messages alone is ~90% of a
# log's bytes) are dropped, as are the tables the daemon never fills.
EXTRACT_TABLES = ("startup", "timestamp", "mySituation", "traffic", "ems",
                  "bridgefloat", "status")


def extract(src_path, dst_path, start=0.0, end=None, tables=EXTRACT_TABLES):
    """Copy the window [start, end] seconds of `src` into a new, small log.

    Row ids are kept as they are, so timestamp_id links stay valid and a row in
    the extract can be found again in the original.
    """
    src = FlightLog(src_path)
    rng = src._id_range(start, end)
    if rng is None:
        raise ValueError("no rows in [%s, %s]" % (start, end))
    if os.path.exists(dst_path):
        os.remove(dst_path)
    dst = sqlite3.connect(dst_path)
    for table in tables:
        if table not in src.tables:
            continue
        ddl = src.db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()[0]
        dst.execute(ddl)
        if table == "startup":
            rows = src.db.execute("SELECT * FROM startup")
        elif table == "timestamp":
            rows = src.db.execute("SELECT * FROM timestamp WHERE id BETWEEN ? AND ?", rng)
        else:
            rows = src.db.execute(
                "SELECT * FROM %s WHERE timestamp_id BETWEEN ? AND ?" % table, rng)
        cols = src.columns(table)
        marks = ",".join("?" * len(cols))
        dst.executemany("INSERT INTO %s (%s) VALUES (%s)" % (table, ",".join(cols), marks),
                        (tuple(r) for r in rows))
    dst.commit()
    dst.execute("VACUUM")
    dst.close()
    src.close()
    return dst_path


# -- committable track ------------------------------------------------------

# A path fixture carries only what the synthetic-vision guidance test needs to
# fly the aircraft: the situation fields the plates bind. Traffic and EMS are
# left out - test_flight.py and test_replay.py already cover those streams, and
# leaving them out is what keeps the file small enough to commit.
PATH_FIELDS = CHECKPOINT_FIELDS + ("GPSLastFixSinceMidnightUTC",)
PATH_EVERY = 5.0            # seconds between samples; the log itself is ~1 Hz
COORD_FIELDS = ("GPSLatitude", "GPSLongitude")


def track(log, every=PATH_EVERY, fields=PATH_FIELDS):
    """The flight's ground track, downsampled, as JSON-ready data.

    A recording is 100 MB of SQLite and cannot go in git; this is the same path
    in a few tens of KB of readable JSON, which `flightpath.FlightPath` replays
    through the same sockets. Only rows with a GPS fix are kept, so a fixture
    never starts with the 0/0 position the daemon logs before the first fix.
    """
    samples, last = [], None
    for t, fr in log.stream("mySituation", 0.0, None):
        if not fr.get("GPSLatitude") and not fr.get("GPSLongitude"):
            continue                      # no fix yet
        if last is not None and t - last < every:
            continue
        last = t
        sample = {"t": round(t, 1)}
        for key in fields:
            value = fr.get(key)
            if isinstance(value, float):
                # 6 dp is ~0.1 m of latitude; everything else is a reading whose
                # own resolution is far coarser than 0.01, and the extra digits
                # were most of the file size.
                value = round(value, 6 if key in COORD_FIELDS else 2)
            sample[key] = value
        samples.append(sample)
    if not samples:
        raise ValueError("%s has no situation rows with a GPS fix" % log.path)
    lats = [s["GPSLatitude"] for s in samples]
    lons = [s["GPSLongitude"] for s in samples]
    alts = [s["GPSAltitudeMSL"] for s in samples if s.get("GPSAltitudeMSL") is not None]
    return {
        "log": os.path.basename(log.path),
        "duration": round(log.duration, 1),
        "started": log.started.strftime("%Y-%m-%dT%H:%M:%SZ") if log.started else None,
        "every": every,
        "fields": list(fields),
        "bounds": {"lat": [min(lats), max(lats)], "lon": [min(lons), max(lons)],
                   "alt_ft": [min(alts), max(alts)] if alts else None},
        "samples": samples,
    }


def write_path_json(data, out):
    """Write a track with one sample per line.

    `json.dump(indent=1)` spreads each sample over a dozen lines, which is most
    of the file and makes a diff unreadable. One line per sample keeps the
    metadata browsable and turns a re-extraction into a line-per-second diff.
    """
    head = {k: v for k, v in data.items() if k != "samples"}
    with open(out, "w") as fh:
        fh.write("{\n")
        for key, value in head.items():
            fh.write(" %s: %s,\n" % (json.dumps(key), json.dumps(value)))
        fh.write(' "samples": [\n')
        for i, sample in enumerate(data["samples"]):
            fh.write("  %s%s\n" % (json.dumps(sample, separators=(",", ":")),
                                    "," if i < len(data["samples"]) - 1 else ""))
        fh.write(" ]\n}\n")
    return out


def main(argv):
    if argv and argv[0] == "list":
        logs = available()
        if not logs:
            print("no .sqlite flight logs in %s" % TEST_DATA)
        for name, path in logs:
            info = summary(path)
            if "error" in info:
                print("%-34s %7.1f MB  -  %s" % (name, info["size"] / 1e6, info["error"]))
                continue
            print("%-34s %7.1f MB  %5.0f s  %2d targets  %s%s" % (
                name, info["size"] / 1e6, info["duration"], info["targets"],
                info["started"] or "no GPS time",
                "" if info["sessions"] == 1 else "  (%d sessions)" % info["sessions"]))
        return 0
    if len(argv) >= 2 and argv[0] == "info":
        print(FlightLog(argv[1]).info())
        return 0
    if len(argv) >= 2 and argv[0] == "expect":
        log = FlightLog(argv[1])
        exp = expectations(log)
        out = argv[2] if len(argv) > 2 else os.path.join(
            HERE, "expected", exp["log"].replace(".sqlite", "") + ".json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as fh:
            json.dump(exp, fh, indent=1)
            fh.write("\n")
        for cp in exp["checkpoints"]:
            sit = cp["situation"]
            print("  %-8s t=%6.1f  %3.0f kt %5.0f ft trk %3.0f roll %+5.1f  traffic %d..%d  - %s" % (
                cp["name"], cp["t"], sit["GPSGroundSpeed"] or 0, sit["GPSAltitudeMSL"] or 0,
                sit["GPSTrueCourse"] or 0, sit["AHRSRoll"] or 0,
                len(cp["traffic"]["must"]), len(cp["traffic"]["may"]), cp["why"]))
        print("wrote %s" % os.path.relpath(out))
        return 0
    if len(argv) >= 2 and argv[0] == "path":
        every = PATH_EVERY
        rest = list(argv[1:])
        if "--every" in rest:
            i = rest.index("--every")
            every = float(rest[i + 1])
            del rest[i:i + 2]
        log = FlightLog(rest[0])
        data = track(log, every=every)
        out = rest[1] if len(rest) > 1 else os.path.join(
            HERE, "fixtures", data["log"].replace(".sqlite", "") + ".path.json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        write_path_json(data, out)
        b = data["bounds"]
        print("  %d samples every %.0f s over %.0f s" % (len(data["samples"]), every, data["duration"]))
        print("  lat %.4f..%.4f  lon %.4f..%.4f  alt %.0f..%.0f ft" % (
            b["lat"][0], b["lat"][1], b["lon"][0], b["lon"][1],
            (b["alt_ft"] or [0, 0])[0], (b["alt_ft"] or [0, 0])[1]))
        print("wrote %s (%.1f KB)" % (os.path.relpath(out), os.path.getsize(out) / 1024))
        return 0
    if len(argv) >= 3 and argv[0] == "extract":
        start, end = 0.0, None
        args = argv[3:]
        while args:
            flag, val = args[0], args[1] if len(args) > 1 else None
            if flag == "--from":
                start = float(val)
            elif flag == "--to":
                end = float(val)
            else:
                print("unknown option %s" % flag)
                return 2
            args = args[2:]
        out = extract(argv[1], argv[2], start, end)
        print(FlightLog(out).info())
        print("  %d bytes" % os.path.getsize(out))
        return 0
    print(__doc__.split("CLI:")[1].strip())
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
