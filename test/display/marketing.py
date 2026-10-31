#!/usr/bin/env python3
"""Marketing screenshots of the RB-01 HMI for www.rbavionics.com.

Not a test: it drives the same fake backend and recorded flight as
test_flight.py, but at exact panel geometries and 2x pixel density, and writes
the frames the website uses.

    RB_SHOTS=/some/dir ./marketing.py

Writes into $RB_SHOTS (default shots/marketing):
  panel_<plate>.png          1280x800 @2x, the rectangular RB-01 panel
  round_<checkpoint>.png     720x720 @2x attitude, one per flight checkpoint
  readouts.json              what the attitude plate showed at each checkpoint
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("RB_SHOTS", os.path.join(HERE, "shots", "marketing"))

from plates import Display, SHOTS  # noqa: E402

LOG = os.environ.get("RB_FLIGHT_LOG", "flightlog-20260913111200.0341")
LEAD_IN = 5.0
SCALE = 2

# plate, ready selector, checkpoint whose state it is shown in
PANEL = [
    ("attitude", "#attitude-rollpitch", "turn"),
    ("sixpack", None, "turn"),
    ("hsi", "#hsi", "climb"),
    ("ems", None, "top"),
    ("emsegt", None, "top"),
    ("radar", "canvas, svg", "takeoff"),
    ("synthview", "#synthviewFrame", "climb"),
    ("autopilot", None, "top"),
    ("radio", None, "top"),
]


def geometry(d, width, height):
    d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                deviceScaleFactor=SCALE, mobile=False)
    d.page.pump(0.8)


def read_attitude(d):
    return d.page.eval("""(() => {
        const txt = sel => (document.querySelector(sel) || {textContent: ''}).textContent.trim();
        return {speed: txt('.attitude-speed'), altitude: txt('.attitude-altimeter'),
                heading: txt('.attitude-heading')};
    })()""")


def at(d, log, t):
    d.replay(log, start=max(0.0, t - LEAD_IN)).step(LEAD_IN)
    d.settle(timeout=20)


def main():
    with open(os.path.join(HERE, "expected", LOG + ".json")) as fh:
        expected = json.load(fh)
    log = os.path.join(os.path.dirname(os.path.dirname(HERE)), "test-data", expected["log"])
    checkpoints = {c["name"]: c for c in expected["checkpoints"]}
    written = []

    with Display(window="1280,800") as d:
        geometry(d, 1280, 800)
        for plate, ready, when in PANEL:
            d.show(plate, ready, timeout=25)
            at(d, log, checkpoints[when]["t"])
            written.append(d.shot("panel_%s" % plate))

    readouts = []
    with Display(window="720,720") as d:
        geometry(d, 720, 720)
        d.show("attitude", "#attitude-rollpitch", timeout=25)
        for c in expected["checkpoints"]:
            at(d, log, c["t"])
            written.append(d.shot("round_%s" % c["name"]))
            readouts.append(dict(read_attitude(d), name=c["name"], t=c["t"], why=c["why"]))

    path = os.path.join(SHOTS, "readouts.json")
    with open(path, "w") as fh:
        json.dump(readouts, fh, indent=1)
    written.append(path)
    for tmp in ("_settle_a.png", "_settle_b.png"):
        if os.path.exists(os.path.join(SHOTS, tmp)):
            os.remove(os.path.join(SHOTS, tmp))
    print("\n".join(written))
    return 0


if __name__ == "__main__":
    sys.exit(main())
