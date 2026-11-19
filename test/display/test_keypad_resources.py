"""The resources plate on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4. The plate opens on the first image, full screen.
With an image shown: PREV / NEXT the previous / next one, stopping at both ends, TAP back to
the list. On the list: each row is a stop, TAP shows it, as a touch on it does.
"""

import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] #zoomContainer"
SHOWN = """(() => { const z = document.querySelector('[ui-view] #zoomContainer');
    if (z.style.display != 'block') return null;
    const m = z.style.backgroundImage.match(/([^/"]+)\\.png/); return m ? m[1] : '?'; })()"""
NAMES = ["Checklist", "Weight", "Charts"]


def setup(d):
    d.srv.rest["/resources"] = [{"Name": n, "Path": "/img/%s.png" % n.lower()} for n in NAMES]


def shown(d):
    return d.page.eval(SHOWN)


def main():
    res = Result()
    d = kt.boot(setup=setup)
    try:
        kt.route(d, "resources", READY)
        d.page.wait("document.querySelectorAll('[ui-view] tr[data-keypad]').length == 3", timeout=10, label="rows")
        d.page.pump(0.3)
        res.check(shown(d) == "checklist", "the plate opens on the first image", shown(d))
        seen = []
        for key in (kt.NEXT, kt.NEXT, kt.NEXT, kt.PREV, "ArrowLeft", "ArrowLeft"):
            d.key(key, settle=0.15)
            seen.append(shown(d))
        res.check(seen == ["weight", "charts", "charts", "weight", "checklist", "checklist"],
                  "with an image shown PREV / NEXT step through them and stop at both ends", seen)
        d.ws_key(kt.NEXT)
        res.check(shown(d) == "weight", "the Pi's keyboard too", shown(d))
        d.key(kt.TAP)
        res.check(shown(d) is None and kt.focus(d).get("index") == -1, "TAP goes back to the list, no row focused",
                  (shown(d), kt.focus(d)))

        kt.check_walk(d, res, "resources list", NAMES, plate="resources")
        kt.go_to(d, 2)
        d.key(kt.TAP)
        res.check(shown(d) == "charts", "TAP on a row shows it", shown(d))
        d.key(kt.TAP)
        d.page.eval("document.querySelectorAll('[ui-view] tr[data-keypad]')[2].click()")
        d.page.pump(0.2)
        res.check(shown(d) == "charts", "as a touch on the row does", shown(d))
        d.page.eval("document.querySelector('[ui-view] #zoomContainer').click()")
        d.page.pump(0.2)
        res.check(shown(d) is None, "a touch on the image goes back too", shown(d))
        d.key(kt.PREV)
        res.check(kt.lit(d) == ["Weight"], "the knob kept its row while the image was open, and walks on", kt.lit(d))
        res.check(not kt.errors(d, "resources"), "no JS error", kt.errors(d, "resources")[:3])
    finally:
        kt.close(d)
    for width, height in kt.PANELS:
        d = kt.boot((width, height), setup)
        try:
            kt.route(d, "resources", READY)
            d.page.wait("document.querySelectorAll('[ui-view] tr[data-keypad]').length == 3", timeout=10, label="rows")
            d.key(kt.TAP)
            kt.check_glass(d, res, "resources", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
