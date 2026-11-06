#!/usr/bin/env python3
"""Convert a recorded flight into the replay that simulator.html plays.

    ./flightlog2replay.py flightlog-sample                    # a name in test-data/, or a path
    ./flightlog2replay.py flight.sqlite --from 120 --to 900   # log seconds to keep
    ./flightlog2replay.py flight.sqlite -o /tmp/replay.json

Writes web/settings/replay.json unless told otherwise. Needs a checkout of this
repo: the SQLite is read by test/display/flightlog.py, which already undoes what
main/datalog.go does to a frame. Standard library only.

A daemon frame is 1-2 KB and a flight has tens of thousands of them, which is far
too much to fetch for a web page. So only what changed is kept:

    {"version": 1, "log": "...", "started": "...", "duration": 180.0,
     "streams": {"/situation": {"fields": ["GPSLatitude", ...],
                                "times": ["GPSTime", ...],
                                "rows": [[0.0, 0, 42.9, 1, 12.7], [1.0, 0, 42.91]]},
                 "/traffic": {"key": "Icao_addr", "fields": [...], "times": [...],
                              "rows": [[0.1, 5022289, 0, "RYR6EW"]]}}}

A stream is named after the socket it plays on. A row is [t, name, value, ...]:
t is seconds into the replay, name an index into `fields`, and each value holds
until a later row changes it. A stream with a `key` has one such state per target
and the key's value follows t. The fields in `times` are time.Time, as seconds
since the Unix epoch or, for the daemon's uptime clock (year 1), since Go's zero
time: that is what lets servicereplay.js move every clock forward on each loop.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "test", "display"))

from flightlog import FlightLog, STREAMS  # noqa: E402

DEFAULT_OUT = os.path.join(HERE, "..", "..", "settings", "replay.json")

# table -> key of a stream with one state per target. /bridge/float/ws is left out
# on purpose: only addons read it, simulator.html lists none, and it is by far the
# busiest table of a recent log.
KEYS = {"mySituation": None, "traffic": "Icao_addr", "ems": None, "status": None}

# Worth the bytes in a replay only where something can see them. The last NMEA
# sentence is 45 new characters on every frame and no plate reads it.
DROPPED = {"GPSLastValidNMEAMessage"}

# Decimal places kept: 6 is ~0.1 m of latitude; every other reading resolves far
# coarser than 0.001 and the float32 noise beyond it was most of the file.
COORDINATES = {"GPSLatitude", "GPSLongitude", "Lat", "Lng", "Lat_fix", "Lng_fix"}
DECIMALS = 3

# A time.Time, as flightlog.frame() renders it
RFC3339 = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$")
UNIX_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
GO_ZERO_TIME = datetime(1, 1, 1, tzinfo=timezone.utc)


def seconds(text):
    """RFC 3339 -> seconds on the clock it was read from. See the docstring."""
    moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    origin = GO_ZERO_TIME if moment.year == 1 else UNIX_EPOCH
    return round((moment - origin).total_seconds(), DECIMALS)


def compact(name, value):
    if isinstance(value, float):
        return round(value, 6 if name in COORDINATES else DECIMALS)
    if isinstance(value, dict):
        return {k: compact(k, v) for k, v in value.items()}
    return value


def encode(frames, key, period, start):
    """(t, frame) -> a stream of the replay, keeping at most one frame every
    `period` seconds per target. The frames in between are not lost: the next
    one kept carries whatever they changed."""
    fields, times, rows, last_t, state = {}, set(), [], {}, {}
    for t, frame in frames:
        who = frame[key] if key else None
        if who in last_t and t - last_t[who] < period:
            continue
        last_t[who] = t
        held = state.setdefault(who, {})
        row = [round(t - start, 2)] + ([who] if key else [])
        for name, value in frame.items():
            if name == key or name in DROPPED:
                continue
            if isinstance(value, str) and RFC3339.match(value):
                times.add(name)
                value = seconds(value)
            else:
                value = compact(name, value)
            if name not in held or held[name] != value:
                held[name] = value
                row += [fields.setdefault(name, len(fields)), value]
        rows.append(row)
    stream = {"fields": list(fields), "times": sorted(times), "rows": rows}
    if key:
        stream["key"] = key
    return stream


def replay(log, start, end, period):
    """The whole file, as a dict."""
    stop = log.duration if end is None else min(end, log.duration)
    streams = {}
    for table, path in STREAMS:
        if table in KEYS and table in log.tables:
            # /situation keeps every row: it is what the plates animate
            keep = 0.0 if table == "mySituation" else period
            encoded = encode(log.stream(table, start, end), KEYS[table], keep, start)
            if encoded["rows"]:
                streams[path] = encoded
    if "/situation" not in streams:
        raise ValueError("%s has no situation rows between t=%.0f and t=%.0f"
                         % (log.path, start, stop))
    return {"version": 1, "log": os.path.basename(log.path),
            "started": log.started.strftime("%Y-%m-%dT%H:%M:%SZ") if log.started else None,
            "duration": round(stop - start, 2), "streams": streams}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("log", help="a datalog.go SQLite flight log: a path, or its name in test-data/")
    ap.add_argument("-o", "--out", default=DEFAULT_OUT, help="default: web/settings/replay.json")
    ap.add_argument("--from", dest="start", type=float, default=0.0, help="log seconds to start at")
    ap.add_argument("--to", dest="end", type=float, default=None, help="log seconds to stop at")
    ap.add_argument("--period", type=float, default=1.0,
                    help="seconds between frames of one traffic target, or of the EMS "
                         "(default %(default)s); the situation always keeps every row")
    args = ap.parse_args(argv)

    log = FlightLog(args.log)
    data = replay(log, args.start, args.end, args.period)
    log.close()
    with open(args.out, "w") as fh:
        json.dump(data, fh, separators=(",", ":"), allow_nan=False)
        fh.write("\n")
    for path, stream in data["streams"].items():
        print("  %-11s %6d rows  %3d fields" % (path, len(stream["rows"]), len(stream["fields"])))
    print("wrote %s: %.0f s of %s, %.0f KB"
          % (os.path.relpath(args.out), data["duration"], data["log"],
             os.path.getsize(args.out) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
