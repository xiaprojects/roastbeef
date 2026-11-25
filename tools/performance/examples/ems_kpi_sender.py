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
"""ems_kpi_sender.py: the skeleton of an out-of-process performance algorithm.

A professional (closed-source) algorithm runs as its own program, in any language.
Once a second it reads the daemon's data, computes its KPIs and POSTs them to the
daemon's EMS endpoint, like any engine monitor:

    POST http://<rb-01>/setEMS   {"perf_pro_cruise": 97.3, "perf_pro_hb": 1234}

The daemon logs every changed value into the flight log (table ems), pushes it to
the HMI on the EMS stream, and can raise alerts on it through
settings/rbvoice-aircraft-rules.json. performance.json shows it with:

    {"id": "proCruise", "label": "CRUISE+", "algorithm": "ems",
     "source": "perf_pro_cruise", "heartbeat": "perf_pro_hb", "staleS": 10}

This example "computes" a constant and a heartbeat; replace compute() with yours.
docs/performance/professional-algorithms.md describes the contract.

    python3 tools/performance/examples/ems_kpi_sender.py --host http://localhost:8000
"""

import argparse
import json
import time
import urllib.request

STATUS = {"ok": 0, "untrained": 1, "wait_level": 2, "wait_climb": 3, "no_data": 4, "out_of_range": 5, "license": 6}


def get(host, path):
    with urllib.request.urlopen(host + path, timeout=2) as r:
        return json.loads(r.read().decode())


def post(host, values):
    req = urllib.request.Request(host + "/setEMS", data=json.dumps(values).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(req, timeout=2).read()


def compute(situation, ems):
    """Your algorithm. Returns {kpi key: %} and a status per key."""
    if not ems.get("enginerpm"):
        return {}, {"perf_pro_cruise": STATUS["no_data"]}
    return {"perf_pro_cruise": 97.3}, {"perf_pro_cruise": STATUS["ok"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="http://localhost", help="the RB-01 daemon")
    a = ap.parse_args()
    beat = 0
    while True:
        try:
            situation, ems = get(a.host, "/getSituation"), get(a.host, "/getEMS")
            values, status = compute(situation, ems)
            beat = (beat + 1) % 100000
            out = {"perf_pro_hb": beat}
            out.update(values)
            out.update({k + "_status": v for k, v in status.items()})
            post(a.host, out)
        except OSError as e:
            print("ems_kpi_sender:", e)
        time.sleep(1.0)


if __name__ == "__main__":
    main()
