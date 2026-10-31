"""Smoke every RB-01 plate: does it load, bind live data, and stay error free?

This is the broad net. Feature-specific depth lives in the test_<plate>.py files.
"""

import sys

from plates import Display, Result

# plate -> a selector that only exists once the plate has actually rendered
PLATES = [
    ("home", None),
    ("attitude", "#attitude-rollpitch"),
    ("sixpack", None),
    ("speed", None),
    ("altimeter", None),
    ("variometer", None),
    ("turnslip", None),
    ("heading", None),
    ("gmetergauge", None),
    ("hsi", "#hsi"),
    ("radar", "canvas, svg"),
    ("synthview", "#synthviewFrame"),
    ("map", "#map_display"),
    ("ems", None),
    ("emsegt", None),
    ("autopilot", None),
    ("alerts", None),
    ("checklist", None),
    ("timers", None),
    ("airfields", None),
    ("resources", None),
    ("aircraft", None),
    ("switchboard", None),
    ("charts", None),
]

TRAFFIC = [
    {"Icao_addr": 11111, "Tail": "ABCDE", "Lat": 45.05, "Lng": 10.02, "Alt": 5200,
     "Track": 180, "Speed": 120, "Position_valid": True, "Emitter_category": 1,
     "Age": 1, "Last_seen": "2024-01-01T00:00:00Z"},
    {"Icao_addr": 22222, "Tail": "FGHIJ", "Lat": 44.95, "Lng": 9.98, "Alt": 4800,
     "Track": 0, "Speed": 95, "Position_valid": True, "Emitter_category": 1,
     "Age": 1, "Last_seen": "2024-01-01T00:00:00Z"},
]


def main():
    res = Result()
    with Display(traffic=TRAFFIC) as d:
        for plate, ready in PLATES:
            before = len(d.js_errors())
            try:
                d.show(plate, ready, timeout=20)
                loaded = True
            except TimeoutError as exc:
                loaded = False
                print("    (%s)" % exc)
            d.fly(frames=3, interval=0.25,
                  GPSLatitude=45.0, GPSTrueCourse=90.0, AHRSPitch=4.0, AHRSRoll=-7.0)
            new_errors = d.js_errors()[before:]
            res.check(loaded, "%-12s renders" % plate)
            res.check(not new_errors, "%-12s error free" % plate,
                      new_errors[:1] if new_errors else "")
            d.shot("plate_%s" % plate)

        print("\n  404s during the sweep: %s" % (sorted(set(d.srv.missing)) or "none"))

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
