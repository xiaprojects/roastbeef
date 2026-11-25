#!/usr/bin/env python3
# This file is part of RB.
#
# Copyright (C) 2026 XIAPROJECTS SRL
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, version 3.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.
"""perf_extract.py: a recorded flight log as the performance engine's samples.

Reads a daemon flight log (flightlog-*.sqlite, stratux-*.sqlite) and writes one
JSON object per mySituation row, the same object web/RB-01/js/perfengine.js
perfSampleFromSituation() builds from the live situation and EMS map:

    python3 tools/performance/perf_extract.py test-data/flightlog-X.sqlite > samples.jsonl

The time t is the daemon clock (timestamp.StratuxClock_value) in seconds, so it
never jumps with the GPS. EMS rows (long format: SensorName, SensorValue) are
merged in log order; a value older than --ems-stale seconds is left out, as a
sender that went silent. The HMI's wind estimate is not in the log, so samples
carry windValid false: without an airspeed board the speed is the ground speed.

docs/performance/training-from-sqlite.md walks through it.
"""

import argparse
import json
import math
import re
import sqlite3
import sys
from datetime import datetime

SITUATION_COLUMNS = [
    "GPSGroundSpeed", "GPSTrueCourse", "IndicatedAirSpeed", "AHRSPitch", "AHRSRoll",
    "AHRSGLoad", "BaroVerticalSpeed", "BaroPressureAltitude", "GPSAltitudeMSL",
    "GPSFixQuality",
]

# EMS key -> sample field, as perfengine.js PERF_EMS_KEYS
EMS_FIELDS = {
    "enginerpm": "rpm",
    "manifoldpressure": "mapInHg",
    "outsidetemperature": "oatC",
    "fuelpressure": "fuelPressure",
    "fuelflow": "fuelFlow",
    "icing_carb": "icingCarb",
    "icing_airframe": "icingAirframe",
}

_CLOCK = re.compile(r"^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d+))?")


def clock_seconds(text):
    """'0001-01-01 00:00:24.66 +0000 UTC' -> seconds since 0001-01-01."""
    m = _CLOCK.match(text or "")
    if not m:
        return None
    y, mo, d, h, mi, s, frac = m.groups()
    base = datetime(int(y), int(mo), int(d), int(h), int(mi), int(s))
    sec = (base - datetime(1, 1, 1)).total_seconds()
    if frac:
        sec += float("0." + frac)
    return sec


def finite(v):
    return isinstance(v, (int, float)) and math.isfinite(v)


def samples(path, ems_stale=10.0):
    """Yields the samples of one flight log, in time order."""
    db = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
    if "mySituation" not in tables or "timestamp" not in tables:
        return
    have = {r[1] for r in db.execute("pragma table_info('mySituation')")}
    cols = [c for c in SITUATION_COLUMNS if c in have]

    clock = {}
    for tid, sc in db.execute("select id, StratuxClock_value from timestamp"):
        clock[tid] = clock_seconds(sc)

    ems_rows = []
    if "ems" in tables:
        ems_rows = db.execute(
            "select timestamp_id, lower(SensorName), SensorValue from ems order by timestamp_id, id").fetchall()
    ei = 0
    ems_val, ems_t = {}, {}

    q = "select timestamp_id, %s from mySituation order by timestamp_id, id" % ", ".join(cols)
    last_t = None
    for row in db.execute(q):
        tid = row[0]
        t = clock.get(tid)
        if t is None:
            continue
        s = dict(zip(cols, row[1:]))
        while ei < len(ems_rows) and ems_rows[ei][0] <= tid:
            etid, name, value = ems_rows[ei]
            ei += 1
            et = clock.get(etid)
            if et is not None and finite(value):
                ems_val[name] = value
                ems_t[name] = et
        if last_t is not None and t < last_t:
            # the daemon restarted inside one file: the clock starts again
            ems_val, ems_t = {}, {}
        last_t = t

        def ems(name):
            if name not in ems_val or t - ems_t[name] > ems_stale:
                return None
            return ems_val[name]

        sample = {
            "t": t,
            "iasKt": s.get("IndicatedAirSpeed") if finite(s.get("IndicatedAirSpeed")) and s["IndicatedAirSpeed"] > 0 else None,
            "gsKt": s.get("GPSGroundSpeed") if finite(s.get("GPSGroundSpeed")) and (s.get("GPSFixQuality") or 1) > 0 else None,
            "trackDeg": s.get("GPSTrueCourse"),
            "windValid": False,
            "windSpeedKt": None,
            "windFromDeg": None,
            "pitchDeg": s.get("AHRSPitch"),
            "rollDeg": s.get("AHRSRoll"),
            "gload": s.get("AHRSGLoad"),
            "vsFpm": s.get("BaroVerticalSpeed"),
            "pressureAltFt": s.get("BaroPressureAltitude"),
        }
        for key, field in EMS_FIELDS.items():
            sample[field] = ems(key)
        if sample["oatC"] is not None and not (-60 <= sample["oatC"] <= 60):
            sample["oatC"] = None   # an open thermocouple, as main/icing.go
        egt, cht = [], []
        for c in range(1, 7):
            e, h = ems("egt%d" % c), ems("cht%d" % c)
            if e is not None and e > 50:
                egt.append(e)
            if h is not None and h > 0:
                cht.append(h)
        sample["egt"], sample["cht"] = egt, cht
        sample["ems"] = {k: v for k, v in ems_val.items() if t - ems_t[k] <= ems_stale and k.startswith("perf_")}
        yield sample


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("logs", nargs="+", help="flight log .sqlite files")
    ap.add_argument("--ems-stale", type=float, default=10.0, help="s after which an EMS value is dropped")
    a = ap.parse_args()
    out = sys.stdout
    for path in a.logs:
        for s in samples(path, a.ems_stale):
            out.write(json.dumps(s, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
