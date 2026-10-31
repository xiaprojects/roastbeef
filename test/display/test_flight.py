"""Replay one specific recorded flight and verify the display shows what was flown.

The recording is the ground truth. `flightlog.py expect` derives checkpoints
from the flight's own profile (take-off, climb, steepest turn, top, final,
landed) and writes what the display must show at each into
expected/<log>.json - a file a reviewer can read. This test replays the
flight to each checkpoint and reads the plates back:

  attitude   the speed, altitude and heading readouts and the bank angle,
             which attitude.html binds straight from the situation;
  ems        the gauges whose sensors the flight carries (RPM, oil, OAT);
  map        the ownship position and the set of traffic targets drawn.

Then the take-off is played at speed while flipping through the plates, to
catch anything that only breaks with data flowing.

    RB_FLIGHT_LOG=20260905080041 python3 test_flight.py   # another recording

If expected/<log>.json is missing it is generated first; if it no longer
matches the recording (a regenerated fixture, an edited file) that is reported
before anything is replayed.
"""

import json
import os
import sys

import flightlog
from flightlog import FlightLog
from plates import Display, Result

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.environ.get("RB_FLIGHT_LOG", "flightlog-20260913111200.0341")
LEAD_IN = 5.0                 # seconds of flight replayed before each checkpoint
ROLL_TOLERANCE = 0.05         # degrees; the style is rotate(-AHRSRoll deg) verbatim
POSITION_TOLERANCE = 1e-4     # degrees of lat/lon; 1e-4 is ~10 m


def expected_for(log):
    """expected/<log>.json, generated if absent; also a fresh derivation so a
    stale file is caught."""
    fresh = flightlog.expectations(log)
    path = os.path.join(HERE, "expected", fresh["log"].replace(".sqlite", "") + ".json")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump(fresh, fh, indent=1)
        print("  generated %s" % os.path.relpath(path))
    with open(path) as fh:
        return json.load(fh), fresh, path


def read_attitude(d):
    """What attitude.html shows: the bound readouts and the applied bank."""
    return d.page.eval("""(() => {
        const txt = sel => (document.querySelector(sel) || {textContent: ''}).textContent.trim();
        const m = /rotate\\((-?[\\d.]+)deg\\)/.exec(document.getElementById('attitude-rollpitch').style.transform || '');
        return {speed: txt('.attitude-speed'), altitude: txt('.attitude-altimeter'),
                heading: txt('.attitude-heading'), roll: m ? parseFloat(m[1]) : null};
    })()""")


def read_ems(d):
    gauges = d.page.eval("""[...document.querySelectorAll('.ems_intrument')].map(el => [
        el.querySelector('.speed-label').textContent.trim(),
        el.querySelector('.speed-value').textContent.trim()])""") or []
    return dict(gauges)


def read_map(d):
    """Ownship lon/lat and the Icao addresses the map is drawing."""
    return d.page.eval("""(() => {
        const sc = angular.element(document.getElementById('map_display')).scope();
        const own = sc.gpsLayer ? ol.proj.toLonLat(
            sc.gpsLayer.getSource().getFeatures()[0].getGeometry().getCoordinates()) : null;
        return {own: own, targets: (sc.aircraft || []).map(a => a.Icao_addr)};
    })()""")


def checkpoint_test(d, res, log, cp, gauges):
    name, t, sit = cp["name"], cp["t"], cp["situation"]
    tag = "%-7s t=%-6.1f" % (name, t)

    # -- attitude: exact bindings of the situation ------------------------
    d.show("attitude", "#attitude-rollpitch", timeout=20)
    d.replay(log, start=t - LEAD_IN).step(LEAD_IN)
    d.settle()
    shown = read_attitude(d)
    d.shot("flight_%s_attitude" % name)
    want_heading = int(sit["GPSTrueCourse"]) if sit["GPSFixQuality"] > 0 else int(sit["AHRSGyroHeading"])
    res.check(shown["speed"] == str(int(sit["GPSGroundSpeed"])),
              "%s attitude shows %d kt" % (tag, int(sit["GPSGroundSpeed"])), shown["speed"])
    res.check(shown["altitude"] == str(int(sit["GPSAltitudeMSL"])),
              "%s attitude shows %d ft" % (tag, int(sit["GPSAltitudeMSL"])), shown["altitude"])
    res.check(shown["heading"] == str(want_heading),
              "%s attitude shows heading %d" % (tag, want_heading), shown["heading"])
    res.check(shown["roll"] is not None and abs(shown["roll"] + sit["AHRSRoll"]) <= ROLL_TOLERANCE,
              "%s attitude is banked %+.1f deg" % (tag, sit["AHRSRoll"]), shown["roll"])

    # -- ems: gauges whose sensors the flight carries ---------------------
    if gauges:
        d.show("ems", ".ems_intrument", timeout=20)
        d.replay(log, start=t - LEAD_IN).step(LEAD_IN)
        d.page.pump(0.8)                       # serviceems.js publishes per animation frame
        shown = read_ems(d)
        for source, label in gauges:
            want = cp["ems"].get(source)
            if want is None:
                continue
            res.check(shown.get(label) == str(int(want)),
                      "%s ems %s reads %d" % (tag, label, int(want)), shown.get(label))

    # -- map: ownship and the traffic set ---------------------------------
    d.show("map", "#map_display", timeout=25)
    d.replay(log, start=t - LEAD_IN).step(LEAD_IN)
    d.page.pump(1.6)                           # the map ages and prunes on a 1 s tick
    shown = read_map(d)
    d.shot("flight_%s_map" % name)
    own = shown.get("own")
    res.check(own and abs(own[1] - sit["GPSLatitude"]) < POSITION_TOLERANCE
              and abs(own[0] - sit["GPSLongitude"]) < POSITION_TOLERANCE,
              "%s map ownship at %.4f %.4f" % (tag, sit["GPSLatitude"], sit["GPSLongitude"]),
              own and "%.4f %.4f" % (own[1], own[0]))
    must = {x["Icao_addr"] for x in cp["traffic"]["must"]}
    may = {x["Icao_addr"] for x in cp["traffic"]["may"]}
    drawn = set(shown.get("targets") or [])
    res.check(must <= drawn <= may,
              "%s map draws the %d..%d live targets" % (tag, len(must), len(may)),
              "%d drawn%s" % (len(drawn), "" if must <= drawn <= may else
                              ", missing %s, extra %s" % (sorted(must - drawn), sorted(drawn - may))))


def playback_test(d, res, log, exp):
    """The take-off at 30x while the pilot flips through the plates."""
    t_off = next((cp["t"] for cp in exp["checkpoints"] if cp["name"] == "takeoff"), 10.0)
    d.show("attitude", "#attitude-rollpitch", timeout=20)
    rp = d.replay(log, start=max(0.0, t_off - 20)).play(speed=30, until=t_off + 100)
    for plate in ("hsi", "map", "radar", "ems", "attitude"):
        d.page.pump(0.8)
        d.show(plate)
    finished = rp.wait(20)
    res.check(finished, "take-off plays at 30x across the plates",
              "t=%.0f s, %d frames" % (rp.position, rp.pushed))


def main():
    res = Result()
    try:
        log = FlightLog(LOG)
    except FileNotFoundError as exc:
        # The recordings are large and may not be in every checkout (CI, a
        # shallow clone). Say so and pass vacuously rather than fail a suite
        # for a missing 100 MB file.
        print("  SKIP recording %s not available: %s" % (LOG, exc))
        print("\n0/0 checks passed (skipped)")
        return 0
    print("  %s" % log.info().replace("\n", "\n  "))
    exp, fresh, path = expected_for(log)
    print("  expectations: %s" % os.path.relpath(path))
    for cp in exp["checkpoints"]:
        print("    %-8s t=%6.1f  %s" % (cp["name"], cp["t"], cp["why"]))

    same = [cp["t"] for cp in exp["checkpoints"]] == [cp["t"] for cp in fresh["checkpoints"]] and all(
        a["situation"] == b["situation"] for a, b in zip(exp["checkpoints"], fresh["checkpoints"]))
    res.check(same, "expected/%s matches the recording (rerun flightlog.py expect if not)"
              % os.path.basename(path))
    if not same:
        return 1

    # Gauges the aircraft configures whose sensor this flight actually logged
    with open(os.path.join(HERE, "fixtures", "rb01-device.json")) as fh:
        widgets = json.load(fh)["files"]["/settings/ems.json"]["widgets"]
    logged = set().union(*(cp["ems"].keys() for cp in exp["checkpoints"]))
    gauges = sorted({(w["source"], w["label"]) for w in widgets if w["source"] in logged})
    print("  gauges checked: %s" % ", ".join(label for _s, label in gauges))

    with Display() as d:
        for cp in exp["checkpoints"]:
            checkpoint_test(d, res, log, cp, gauges)
        playback_test(d, res, log, exp)
        errs = d.js_errors()
        res.check(not errs, "no JS errors across the flight", errs[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
