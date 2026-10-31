"""Replay a recorded flight through the HMI and check the plates follow it.

Every other test file scripts its own situation. This one uses three minutes of
a real flight (test-data/flightlog-sample.sqlite, cut from a datalog.go
recording with flightlog.py) so the plates get the shape of real data: a
climbing take-off, a 250-degree turn at 60 degrees of bank, twenty-odd ADS-B
targets and a live engine monitor - all at once, on the log's own clock.

The turn is the useful bit. Between t=140 (wings level, track 190) and t=160
(64 degrees left bank, track 103) every attitude and heading instrument must
move a lot; that is asserted on pixels, like test_instruments.py does.
"""

import json
import re
import sys

from flightlog import FlightLog
from plates import Display, Result, FLIGHT, moved_pixels

MOVED_WHEN_CHANGED = 2000   # px that must move between level flight and the turn

LEVEL = 140.0               # log seconds: wings level, track 190, 1100 ft
BANKED = 160.4              # log seconds: -64 deg roll, track 103, climbing

RFC3339 = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$")


def reader_test(res, log):
    """The reader itself, with no browser: shape and cadence of the frames."""
    events = list(log.events())
    by_path = {}
    for _t, path, fr in events:
        by_path.setdefault(path, []).append(fr)

    res.check(175 < log.duration < 185, "fixture is three minutes long",
              "%.0f s" % log.duration)
    sit = by_path.get("/situation", [])
    res.check(0.9 < len(sit) / log.duration < 1.1, "situation is logged at 1 Hz",
              "%d frames in %.0f s" % (len(sit), log.duration))
    res.check(all(a[0] <= b[0] for a, b in zip(events, events[1:])),
              "events come out in time order")

    # The conversions frame() promises - see the flightlog.py docstring.
    first = sit[0]
    res.check(RFC3339.match(first["GPSTime"] or ""), "time.Time is emitted as RFC 3339",
              first["GPSTime"])
    res.check(isinstance(first.get("Magnetometer"), dict), "Magnetometer is a nested object")
    traffic = by_path.get("/traffic", [])
    res.check(traffic and isinstance(traffic[0]["Position_valid"], bool),
              "bool columns are emitted as booleans")
    targets = {fr["Icao_addr"] for fr in traffic}
    res.check(len(targets) >= 10, "fixture carries a useful amount of traffic",
              "%d targets, %d frames" % (len(targets), len(traffic)))

    ems = by_path.get("/ems", [])
    res.check(ems and len(ems[-1]) >= len(ems[0]),
              "EMS frames are the accumulated sensor map",
              "%d -> %d sensors" % (len(ems[0]), len(ems[-1])))
    try:
        for _t, _path, fr in events:
            json.dumps(fr)
        serialisable = True
    except (TypeError, ValueError):
        serialisable = False
    res.check(serialisable, "every frame is JSON serialisable")


def turn_test(d, res, log, plate, ready, label):
    """Plate must look different in the turn than it did in level flight."""
    d.show(plate, ready, timeout=20)
    rp = d.replay(log, start=LEVEL - 5)
    rp.step(5)                         # -> LEVEL
    d.settle()
    shot_a = d.shot("replay_%s_level" % plate)

    rp.step(BANKED - LEVEL)            # -> BANKED
    took = d.settle()
    shot_b = d.shot("replay_%s_banked" % plate)

    changed = moved_pixels(shot_a, shot_b)
    res.check(changed > MOVED_WHEN_CHANGED,
              "%-9s follows the recorded %s" % (plate, label),
              "%d px moved, %d frames, settled in %.1fs" % (changed, rp.pushed, took))


def ems_test(d, res, log):
    """The gauge must read what the engine monitor logged."""
    d.show("ems", ".ems_intrument", timeout=20)
    rp = d.replay(log, start=0)
    rp.step(5)
    d.page.pump(0.8)                   # serviceems.js batches frames per animation frame

    gauges = d.page.eval("""[...document.querySelectorAll('.ems_intrument')].map(el => [
        el.querySelector('.speed-label').textContent.trim(),
        el.querySelector('.speed-value').textContent.trim()])""") or []
    shown = {label: value for label, value in gauges}
    # ems.js does parseInt() on the value it displays
    logged = [str(int(fr["oiltemperature"]))
              for _t, fr in log.stream("ems", 0, rp.position) if "oiltemperature" in fr]
    got = shown.get("OIL TEMP")
    res.check(bool(logged) and got == logged[-1],
              "ems OIL TEMP reads the logged oiltemperature",
              "gauge %r, log %r" % (got, logged[-1:] and logged[-1]))
    res.check("OUT TEMP" in shown and shown["OUT TEMP"] not in ("", "0"),
              "ems OUT TEMP is driven", shown.get("OUT TEMP"))

    # The daemon posts engine data at ~6 Hz, faster than the 300 ms window in
    # serviceems.js, and only when a value changes. Two frames 50 ms apart and
    # then silence is what the last change before the engine settles looks
    # like: the second one must reach the gauge, not wait for a third.
    frames = [fr for _t, fr in log.stream("ems", 0, 30) if "oiltemperature" in fr]
    first, last = dict(frames[0]), dict(frames[1])
    first["oiltemperature"], last["oiltemperature"] = 61.0, 62.0
    d.srv.push("/ems", first)
    d.page.pump(0.05)
    d.srv.push("/ems", last)
    d.page.pump(1.0)
    got = d.page.eval("""[...document.querySelectorAll('.ems_intrument')]
        .filter(el => el.querySelector('.speed-label').textContent.trim() == 'OIL TEMP')
        .map(el => el.querySelector('.speed-value').textContent.trim())[0]""")
    res.check(got == "62", "ems shows the last of two frames 50 ms apart", "gauge %r" % got)


def playback_test(d, res, log):
    """Real-time playback at 20x while the pilot flips through the plates."""
    d.show("attitude", "#attitude-rollpitch", timeout=20)
    rp = d.replay(log, start=0).play(speed=20)
    for plate in ("hsi", "map", "radar", "attitude"):
        d.page.pump(1.5)
        d.show(plate)
    finished = rp.wait(20)
    res.check(finished and rp.done, "playback runs the whole flight at 20x",
              "position %.0f s, %d frames" % (rp.position, rp.pushed))
    total = sum(1 for _ in log.events())
    res.check(rp.pushed + rp.coalesced == total, "every frame of the log was consumed",
              "%d delivered + %d coalesced of %d" % (rp.pushed, rp.coalesced, total))
    traffic = sum(1 for _t, path, _f in log.events() if path == "/traffic")
    res.check(rp.pushed >= traffic + 3, "traffic is never coalesced",
              "%d delivered, %d traffic frames" % (rp.pushed, traffic))


def main():
    res = Result()
    log = FlightLog(FLIGHT)
    print("  %s" % log.info().replace("\n", "\n  "))

    reader_test(res, log)

    with Display() as d:
        ems_test(d, res, log)
        turn_test(d, res, log, "attitude", "#attitude-rollpitch", "bank")
        turn_test(d, res, log, "hsi", "#hsi", "turn")
        playback_test(d, res, log)

        errs = d.js_errors()
        res.check(not errs, "no JS errors across the replayed flight", errs[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
