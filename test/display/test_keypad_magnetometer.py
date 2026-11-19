"""The magnetometer addon on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: mode, calibrate, config, autocal, then RESET and
the offset from the GPS track, which change the calibration, last. TAP is a touch on the button:
RESET keeps its confirmation, the first TAP arms it and only a second one deletes.
The addon is not in the fixture's /addons: the suite adds it.
"""

import re
import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] .addonMagToolbar"
ADDON = {"controller": "MagnetometerCtrl", "hash": "/addons/magnetometer", "html": "addons/magnetometer.html",
         "js": "addons/js/magnetometer.js", "name": "magnetometer"}


def setup(d):
    d.srv.rest["/addons"] = d.srv.rest["/addons"] + [ADDON]
    d.srv.rest["/magnetometer"] = {}


def deletes(d):
    return [p for p in d.srv.deleted if re.sub("/+", "/", p.split("?")[0]) == "/magnetometer"]


def ready(d):
    d.page.wait("""(() => { const i = angular.element(document.body).injector();
                            return !!i && !!i.get('$state').get('magnetometer'); })()""", timeout=15, label="addon")
    kt.route(d, "addons/magnetometer", READY, 6)


def main():
    res = Result()
    d = kt.boot(setup=setup)
    try:
        ready(d)
        names = kt.stops(d)
        res.check(names[4] == "RESET" and names[5] == "OFFSET FROM GPS TRACK" and len(names) == 6,
                  "six stops, RESET and the GPS offset last", names)
        kt.check_entry(d, res, "magnetometer", lambda: len(deletes(d)))
        kt.check_walk(d, res, "magnetometer", plate="addons/magnetometer")
        kt.check_socket(d, res, "magnetometer")

        kt.go_to(d, 4)
        d.key(kt.TAP)
        res.check(kt.lit(d) == ["CONFIRM RESET"] and deletes(d) == [], "a first TAP on RESET only arms it", (kt.lit(d), deletes(d)))
        d.key(kt.TAP, settle=0.6)
        res.check(len(deletes(d)) == 1, "a second TAP resets the calibration", deletes(d))

        kt.go_to(d, 2)
        d.key(kt.TAP, settle=0.6)
        res.check(kt.lit(d) == ["CLOSE"] and d.page.eval("!!document.querySelector('[ui-view] .addonMagConfig')"),
                  "TAP on CONFIG opens the configuration", kt.lit(d))
        d.key(kt.TAP)
        res.check(kt.lit(d) == ["CONFIG"], "and TAP closes it", kt.lit(d))
        res.check(not kt.errors(d, "magnetometer"), "no JS error", kt.errors(d, "magnetometer")[:3])
    finally:
        kt.close(d)
    for width, height in kt.PANELS:
        d = kt.boot((width, height), setup)
        try:
            ready(d)
            kt.check_glass(d, res, "magnetometer", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
