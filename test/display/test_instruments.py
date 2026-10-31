"""Do the instruments actually track live data, and hold still when it is static?

Deliberately structure-agnostic: it asserts on rendered pixels rather than on
internal element names, so it survives cosmetic edits but still catches a frozen
or runaway instrument.
"""


import sys

from plates import Display, Result, moved_pixels

# Pixels are the honest signal here. These instruments are drawn with svg.js and
# animate by setting attributes on the ROOT <svg> (viewBox/transform), which an
# innerHTML fingerprint silently misses - it reports "unchanged" while the needle
# visibly swings. So assert on what the pilot actually sees.
MOVED_WHEN_CHANGED = 2000     # px that must move when the data changes
MOVED_WHEN_STATIC = 400       # px allowed to drift when the data is constant
                              # (clocks and timers tick regardless)


def track_test(d, res, plate, ready, first, second, label):
    """Instrument must move for different data and settle for identical data."""
    d.show(plate, ready, timeout=20)

    d.fly(frames=4, interval=0.25, **first)
    d.settle(republish=first)
    shot_a = d.shot("instr_%s_a" % plate)

    d.fly(frames=4, interval=0.25, **second)
    took = d.settle(republish=second)
    shot_b = d.shot("instr_%s_b" % plate)

    d.fly(frames=4, interval=0.25, **second)
    d.settle(republish=second)
    shot_c = d.shot("instr_%s_c" % plate)

    changed = moved_pixels(shot_a, shot_b)
    static = moved_pixels(shot_b, shot_c)

    res.check(changed > MOVED_WHEN_CHANGED,
              "%-11s tracks %s" % (plate, label),
              "%d px moved, settled in %.1fs" % (changed, took))
    res.check(0 <= static <= MOVED_WHEN_STATIC,
              "%-11s settles when %s is constant" % (plate, label),
              "%d px drift" % static)


def main():
    res = Result()
    traffic = [
        {"Icao_addr": 11111, "Tail": "ABCDE", "Lat": 45.06, "Lng": 10.03, "Alt": 5300,
         "Track": 200, "Speed": 130, "Position_valid": True, "Emitter_category": 1,
         "Age": 1, "Last_seen": "2024-01-01T00:00:00Z"},
    ]
    with Display(traffic=traffic) as d:
        # Attitude indicator must follow pitch and roll
        track_test(d, res, "attitude", "#attitude-rollpitch",
                   {"AHRSPitch": 0.0, "AHRSRoll": 0.0},
                   {"AHRSPitch": 12.0, "AHRSRoll": -25.0}, "attitude")

        # HSI must follow track
        track_test(d, res, "hsi", "#hsi",
                   {"GPSTrueCourse": 0.0, "AHRSGyroHeading": 0.0},
                   {"GPSTrueCourse": 135.0, "AHRSGyroHeading": 135.0}, "heading")

        # Airspeed / altitude tapes must follow their sources
        track_test(d, res, "speed", None,
                   {"GPSGroundSpeed": 60.0},
                   {"GPSGroundSpeed": 145.0}, "ground speed")
        track_test(d, res, "altimeter", None,
                   {"GPSAltitudeMSL": 2000.0, "BaroPressureAltitude": 2000.0},
                   {"GPSAltitudeMSL": 8500.0, "BaroPressureAltitude": 8500.0},
                   "altitude")
        track_test(d, res, "variometer", None,
                   {"GPSVerticalSpeed": 0.0, "BaroVerticalSpeed": 0.0},
                   {"GPSVerticalSpeed": 900.0, "BaroVerticalSpeed": 900.0},
                   "vertical speed")
        track_test(d, res, "gmetergauge", None,
                   {"AHRSGLoad": 1.0}, {"AHRSGLoad": 2.4}, "g load")

        errs = d.js_errors()
        res.check(not errs, "no JS errors across the instrument run", errs[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
