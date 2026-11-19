"""The map plate: the knob zooms, through the real key paths.

docs/tech-debt/keypad-page-navigation.md, 3.4: `map` is a direct page, no focus to move.

    PREV  zoom out one level      NEXT  zoom in one level      TAP  nothing

Whole levels, about the middle of the map as the pinch does, from wherever a pinch left it,
within 2 to 18. Every press is a real Chromium key or a frame on the /keypad socket. An arrow
is a knob key here, so it must not also pan the map, which OpenLayers does with the arrows when
the map has the focus.
"""

import sys

import known
from plates import Display, Result

PREV, TAP, NEXT = "1", "2", "3"
SCOPE = "angular.element(document.getElementById('map_display')).scope()"
VIEW = SCOPE + ".map.getView()"
STATE = "(() => { const v = %s; const c = v.getCenter(); return {zoom: v.getZoom(), x: c[0], y: c[1]}; })()" % VIEW
# Tiles come from the internet or the daemon, neither of which is here
NETWORK = ("failed to load resource", "net::", "err_")


def state(d):
    return d.page.eval(STATE)


def zoom(d):
    return state(d)["zoom"]


def set_zoom(d, z):
    d.page.eval("%s.setZoom(%r)" % (VIEW, z))
    d.page.pump(0.2)


def ready(d):
    d.show("map", "#map_display", timeout=25)
    d.page.wait("!!(%s && %s.map && %s.getZoom() !== undefined)" % (SCOPE, SCOPE, VIEW), timeout=15,
                label="map view")
    # The first fix centres the map on the aircraft at level 10, replacing the view
    d.srv.wait_for_client("/situation", timeout=10)
    for _ in range(20):
        d.srv.push_situation(GPSLatitude=43.6, GPSLongitude=10.4, GPSFixQuality=1)
        d.page.pump(0.3)
        if d.page.eval("!!%s.gpsLayer" % SCOPE):
            break
    d.page.wait("!!%s.gpsLayer" % SCOPE, timeout=5, label="view on the fix")
    d.srv.wait_for_client("/keypad", timeout=10)
    d.page.pump(0.3)


def errors(d):
    return [e for e in d.js_errors()
            if not any(t in e.lower() for t in NETWORK) and not known.lookup("keypad", "map", e)]


def same_centre(a, b):
    return abs(a["x"] - b["x"]) < 1 and abs(a["y"] - b["y"]) < 1


def check_zoom(d, res, label, prev, nxt, send):
    set_zoom(d, 10)
    before = state(d)
    send(nxt)
    res.check(zoom(d) == 11, "%s NEXT zooms in one level" % label, zoom(d))
    send(nxt)
    res.check(zoom(d) == 12, "%s and again" % label, zoom(d))
    send(prev)
    send(prev)
    send(prev)
    res.check(zoom(d) == 9, "%s PREV zooms out one level a click" % label, zoom(d))
    res.check(same_centre(state(d), before), "%s about the middle of the map" % label, (before, state(d)))


def check_rest(d, res):
    # From where a pinch left it, to whole levels
    set_zoom(d, 10.4)
    d.key(NEXT)
    res.check(zoom(d) == 11, "from 10.4 NEXT goes to 11", zoom(d))
    set_zoom(d, 10.6)
    d.key(PREV)
    res.check(zoom(d) == 10, "from 10.6 PREV goes to 10", zoom(d))

    # The ends
    set_zoom(d, 17)
    for _ in range(3):
        d.key(NEXT)
    res.check(zoom(d) == 18, "NEXT stops at level 18", zoom(d))
    # Level 2, or the widest the view allows: on a wide panel the world must fill it, ~2.3 here
    set_zoom(d, 3)
    for _ in range(3):
        d.key(PREV)
    widest = zoom(d)
    d.key(PREV)
    res.check(2 <= widest < 2.5 and zoom(d) == widest, "PREV stops at level 2, or the widest the view allows",
              (widest, zoom(d)))
    d.key(NEXT)
    res.check(zoom(d) == 3, "and NEXT from there goes to 3", zoom(d))

    # Quick clicks, as a knob turned fast
    set_zoom(d, 8)
    for _ in range(5):
        d.key(NEXT, settle=0.02)
    d.page.pump(0.3)
    res.check(zoom(d) == 13, "five quick clicks are five levels", zoom(d))

    # TAP does nothing here
    before = state(d)
    d.key(TAP)
    d.key("Enter")
    res.check(state(d) == before and d.hash().endswith("/map"), "TAP changes nothing", (before, state(d), d.hash()))

    # A finger on the map, then the arrows: zoom only, no pan
    set_zoom(d, 10)
    d.page.click("#map_display canvas")
    d.page.pump(0.3)
    before = state(d)
    d.key("ArrowDown")
    d.key("ArrowRight")
    d.page.pump(0.6)
    after = state(d)
    res.check(after["zoom"] == 12 and same_centre(before, after),
              "after a touch on the map the arrows zoom and do not pan it", (before, after))


def check_return(d, res):
    d.show("radio", None)
    d.key(NEXT)
    d.key(PREV)
    ready(d)
    set_zoom(d, 10)
    d.key(NEXT)
    res.check(zoom(d) == 11, "back on the map one NEXT is one level: no listener left by the last visit", zoom(d))


def main():
    res = Result()
    for width, height in ((1280, 800), (480, 480)):
        d = Display()
        with d:
            d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                        deviceScaleFactor=1, mobile=False)
            d.page.goto(d.srv.url + "/RB-01/index.html")
            d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
            ready(d)
            label = "%dx%d" % (width, height)
            check_zoom(d, res, label + " 1/3", PREV, NEXT, d.key)
            if width == 1280:
                check_zoom(d, res, label + " arrows", "ArrowUp", "ArrowDown", d.key)
                check_zoom(d, res, label + " socket", PREV, NEXT, d.ws_key)
                check_rest(d, res)
                check_return(d, res)
            res.check(not errors(d), "%s no JS error" % label, errors(d)[:3])
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
