"""The G-meter plate: a press of the knob resets Max and Min, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: `gmetergauge` is a direct page, no focus to move.

    TAP   reset Max-Min (POST /resetGMeter), as the centre touch zone does
    PREV, NEXT   nothing: there is nothing to change

The daemon starts Max and Min again from the G of the moment; the plate shows them from the next
situation frame. Every press is a real Chromium key or a frame on the /keypad socket.
"""

import re
import sys

import known
from plates import Display, Result

PREV, TAP, NEXT = "1", "2", "3"
SHOWN = """(() => {
    const p = document.querySelector('[ui-view] .speed');
    return p ? {max: p.querySelector('.speed-label').textContent.trim(),
                min: p.querySelector('.speed-unit').textContent.trim()} : null;
})()"""


def resets(d):
    return sum(1 for path, _ in d.srv.posted if re.sub("/+", "/", path.split("?")[0]) == "/resetGMeter")


def frames(d, **fields):
    for _ in range(3):
        d.srv.push_situation(**fields)
        d.page.pump(0.3)


def ready(d):
    d.show("gmetergauge", "[ui-view] .speed")
    d.srv.wait_for_client("/situation", timeout=10)
    d.srv.wait_for_client("/keypad", timeout=10)
    frames(d, AHRSGLoad=1.0, AHRSGLoadMax=3.4, AHRSGLoadMin=-1.2)


def count(d, send, key):
    before = resets(d)
    send(key)
    d.page.pump(0.4)
    return resets(d) - before


def errors(d):
    return [e for e in d.js_errors() if not known.lookup("keypad", "gmetergauge", e)]


def main():
    res = Result()
    for width, height in ((480, 480), (1280, 800)):
        d = Display()
        with d:
            d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                        deviceScaleFactor=1, mobile=False)
            d.page.goto(d.srv.url + "/RB-01/index.html")
            d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
            ready(d)
            label = "%dx%d" % (width, height)
            shown = d.page.eval(SHOWN)
            res.check(shown == {"max": "3.4▲", "min": "-1.2▼"}, "%s Max and Min shown" % label, shown)

            res.check(count(d, d.key, TAP) == 1, "%s TAP resets Max-Min, once" % label)
            # What the daemon answers with: Max and Min from the G now
            frames(d, AHRSGLoad=1.0, AHRSGLoadMax=1.0, AHRSGLoadMin=1.0)
            shown = d.page.eval(SHOWN)
            res.check(shown == {"max": "1.0▲", "min": "1.0▼"}, "%s and the plate shows them restarted" % label, shown)
            res.check(count(d, d.key, "Enter") == 1, "%s Enter is TAP too" % label)
            res.check(count(d, d.ws_key, TAP) == 1, "%s so is TAP from the Pi's socket" % label)
            moved = sum(count(d, d.key, k) for k in (PREV, NEXT, "ArrowUp", "ArrowDown"))
            moved += sum(count(d, d.ws_key, k) for k in (PREV, NEXT))
            res.check(moved == 0 and d.hash().endswith("/gmetergauge"),
                      "%s PREV and NEXT do nothing" % label, (moved, d.hash()))

            if width == 1280:
                before = resets(d)
                d.page.eval("document.querySelector('[ui-view] .speed .fabCenter').click()")
                d.page.pump(0.4)
                res.check(resets(d) - before == 1, "the centre touch zone posts the same reset")

                # Another page with a knob of its own, and the sixpack that holds instruments
                for page in ("altimeter", "sixpack"):
                    d.show(page, None)
                    d.page.pump(0.5)
                    res.check(count(d, d.key, TAP) == 0, "on #/%s TAP resets no G-meter" % page)
                ready(d)
                res.check(count(d, d.key, TAP) == 1, "back on the G-meter one TAP is one reset: no listener left behind")
                d.show("altimeter", None)
                d.key(TAP)   # leave AUTO on, as it came
            res.check(not errors(d), "%s no JS error" % label, errors(d)[:3])
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
