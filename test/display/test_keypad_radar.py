"""The radar plate: the knob turns the range or the altitude band, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: `radar` is a direct page, no focus to move.

    range mode     PREV  range down (Ra-)     NEXT  range up (Ra+)
    altitude mode  PREV  band narrower (Alt-) NEXT  band wider (Alt+)
    TAP            switches between the two; every entry starts on the range

The ranges are the plate's own, 2 5 10 20 40 NM, the bands 5 10 20 50 100 500 hundred feet,
stopping at both ends; each change is saved as RadarRange / RadarLimits, as the buttons do. The
label being turned is outlined (keypadEdit) from the first knob key on, not on entry. The closed
copy of the plate in the right sidebar must not move with it (D3).
"""

import json
import re
import sys

import keypadtest as kt
from plates import Result

RANGE = "parseInt(document.querySelector('[ui-view] .radar-range').textContent)"
SIDEBAR_RANGE = """(() => { const e = [...document.querySelectorAll('.radar-range')].find(e => !e.closest('[ui-view]'));
    return e ? parseInt(e.textContent) : null; })()"""


BAND = "angular.element(document.querySelector('[ui-view] .radar-altband')).scope().AltDiffThreshold"
SIDEBAR_BAND = """(() => { const e = [...document.querySelectorAll('.radar-altband')].find(e => !e.closest('[ui-view]'));
    return e ? e.textContent.trim() : null; })()"""
OUTLINED = """[...document.querySelectorAll('.radar-range, .radar-altband')].filter(e => e.classList.contains('keypadEdit'))
    .map(e => (e.closest('[ui-view]') ? '' : 'sidebar ') + (e.classList.contains('radar-range') ? 'range' : 'alt'))"""


def saved(d, key="RadarRange"):
    out = []
    for path, body in d.srv.posted:
        if re.sub("/+", "/", path.split("?")[0]) == "/setSettings":
            msg = json.loads(body)
            if key in msg:
                out.append(msg[key])
    return out


def band(d):
    return d.page.eval(BAND)


def setup(d):
    d.srv.settings["RadarRange"] = 10
    d.srv.settings["RadarLimits"] = 2000


def rng(d):
    return d.page.eval(RANGE)


def press(d, key, send=None):
    (send or d.key)(key)
    d.page.pump(0.2)
    return rng(d)


def main():
    res = Result()
    for width, height in ((1280, 800), (480, 480)):
        d = kt.boot((width, height), setup)
        label = "%dx%d" % (width, height)
        try:
            kt.route(d, "radar", "[ui-view] .radar-range")
            d.page.wait("%s == 10" % RANGE, timeout=10, label="range 10")
            side = d.page.eval(SIDEBAR_RANGE)
            side_band = d.page.eval(SIDEBAR_BAND)
            res.check(d.page.eval(OUTLINED) == [], "%s nothing outlined on entry" % label, d.page.eval(OUTLINED))
            before = len(saved(d))
            seen = [press(d, kt.NEXT) for _ in range(3)]
            res.check(seen == [20, 40, 40], "%s NEXT: 20, 40, and stays at 40" % label, seen)
            seen = [press(d, kt.PREV) for _ in range(6)]
            res.check(seen == [20, 10, 5, 2, 2, 2], "%s PREV: down to 2 and stays" % label, seen)
            res.check(saved(d)[before:before + 2] == [20, 40], "%s each change is saved as RadarRange" % label,
                      saved(d)[before:])
            res.check(d.page.eval(OUTLINED) == ["range"], "%s the range label is outlined once the knob turns" % label,
                      d.page.eval(OUTLINED))

            # TAP: the altitude band
            r, n, b = rng(d), len(saved(d)), band(d)
            d.key(kt.TAP)
            d.page.pump(0.3)
            res.check(rng(d) == r and band(d) == b == 20 and len(saved(d)) == n and d.hash() == "#/radar"
                      and d.page.eval(OUTLINED) == ["alt"], "%s TAP switches to the altitude band, changes nothing" % label,
                      (rng(d), band(d), len(saved(d)) - n, d.hash(), d.page.eval(OUTLINED)))
            limits = len(saved(d, "RadarLimits"))
            bands = []
            for key in (kt.NEXT,) * 4 + (kt.PREV,) * 7:
                d.key(key, settle=0.15)
                bands.append(band(d))
            res.check(bands == [50, 100, 500, 500, 100, 50, 20, 10, 5, 5, 5],
                      "%s NEXT widens the band to 50000 ft, PREV narrows it to 500 ft, stopping at both ends" % label, bands)
            res.check(saved(d, "RadarLimits")[limits:limits + 3] == [5000, 10000, 50000],
                      "%s each change is saved as RadarLimits" % label, saved(d, "RadarLimits")[limits:])
            res.check(rng(d) == r, "%s and the range does not move" % label, rng(d))

            # TAP again: back on the range
            d.key("Enter")
            d.page.pump(0.3)
            res.check(d.page.eval(OUTLINED) == ["range"] and press(d, kt.NEXT) == 5 and band(d) == 5,
                      "%s TAP again: back on the range" % label, (d.page.eval(OUTLINED), rng(d), band(d)))
            press(d, kt.PREV)
            res.check(d.page.eval(SIDEBAR_RANGE) == side and d.page.eval(SIDEBAR_BAND) == side_band,
                      "%s the sidebar copy did not move" % label,
                      (side, d.page.eval(SIDEBAR_RANGE), side_band, d.page.eval(SIDEBAR_BAND)))
            if width == 1280:
                res.check(side is not None, "the right sidebar holds a copy of the radar")
                res.check(press(d, "ArrowDown") == 5 and press(d, "ArrowUp") == 2, "the arrows too", rng(d))
                res.check(press(d, kt.NEXT, d.ws_key) == 5, "and the Pi's keyboard", rng(d))
                # The same as a touch on Ra+
                d.page.eval("angular.element(document.querySelector('[ui-view] .radar-range')).scope().$apply(s => s.radarZoomIn())")
                d.page.pump(0.2)
                d.page.eval("document.querySelector('[ui-view] .radar-zoomout').click()")
                d.page.pump(0.2)
                touch = rng(d)
                press(d, kt.PREV)
                knob = press(d, kt.NEXT)
                res.check(touch == knob == 5, "NEXT does what a touch on Ra+ does", (touch, knob))
                # Another page: nothing saved
                d.show("emsegt", None)
                n = len(saved(d))
                for key in (kt.NEXT, kt.PREV, kt.NEXT):
                    d.key(key, settle=0.1)
                d.page.pump(0.4)
                res.check(len(saved(d)) == n, "on another page the knob saves no range", saved(d)[n:])
                kt.route(d, "radar", "[ui-view] .radar-range")
                d.page.pump(0.4)
                start = rng(d)
                got = press(d, kt.NEXT)
                res.check(got == {2: 5, 5: 10, 10: 20, 20: 40, 40: 40}[start],
                          "back on the radar one NEXT is one step: no listener left behind", (start, got))
                res.check(d.page.eval(OUTLINED) == ["range"], "and a new entry starts on the range", d.page.eval(OUTLINED))
                d.key(kt.TAP)
                d.page.pump(0.3)
                start = band(d)
                d.key(kt.PREV)
                d.page.pump(0.3)
                res.check(band(d) == {5: 5, 10: 5, 20: 10, 50: 20, 100: 50, 500: 100}[start],
                          "one TAP is one switch: no listener left behind", (start, band(d)))
            res.check(not kt.errors(d, "radar"), "%s no JS error" % label, kt.errors(d, "radar")[:3])
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
