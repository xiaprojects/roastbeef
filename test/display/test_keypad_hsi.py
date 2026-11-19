"""The HSI plate and the knob: what it does today, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 6.5: a direct page with its own knob code, kept as is.

    PREV  course -5 degrees      NEXT  course +5 degrees      TAP  back to the track (0)

The HSI is in the Square navigation list only; on the other shapes the knob reaches it all the
same since the service fix (F1), which this suite also covers at 1280x800.
"""

import sys

import keypadtest as kt
from plates import Result

OVERRIDE = "angular.element(document.getElementById('hsi')).scope().overrideHSI"


def main():
    res = Result()
    for width, height in ((480, 480), (1280, 800)):
        d = kt.boot((width, height))
        label = "%dx%d" % (width, height)
        try:
            kt.route(d, "hsi", "[ui-view] #hsi")
            d.srv.wait_for_client("/situation", timeout=10)
            d.srv.push_situation(GPSLatitude=43.6, GPSLongitude=10.3, GPSFixQuality=1, GPSTrueCourse=90)
            d.page.pump(0.4)
            seen = []
            for key in (kt.NEXT, kt.NEXT, kt.PREV, "ArrowDown", "ArrowUp", "ArrowUp"):
                d.key(key, settle=0.1)
                seen.append(d.page.eval(OVERRIDE))
            res.check(seen == [5, 10, 5, 10, 5, 0], "%s PREV / NEXT turn the course 5 degrees a click" % label, seen)
            d.key(kt.NEXT)
            d.ws_key(kt.NEXT)
            res.check(d.page.eval(OVERRIDE) == 10, "%s the Pi's keyboard too" % label, d.page.eval(OVERRIDE))
            d.key(kt.TAP)
            res.check(d.page.eval(OVERRIDE) == 0 and d.hash() == "#/hsi", "%s TAP back to the track, on the plate" % label,
                      (d.page.eval(OVERRIDE), d.hash()))
            res.check(not kt.errors(d, "hsi"), "%s no JS error" % label, kt.errors(d, "hsi")[:3])
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
