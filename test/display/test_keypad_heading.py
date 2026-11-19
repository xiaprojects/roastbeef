"""The heading plate: a press of the knob cycles the heading source, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: a direct page. There is no heading bug to turn;
the one thing the plate operates is its source, GPS > GYRO > MAG, on the centre touch zone.

    TAP   next source, as the centre touch zone      PREV, NEXT   nothing
"""

import sys

import keypadtest as kt
from plates import Result

SOURCE = "document.querySelector('[ui-view] .gyroheading-source').textContent.trim()"


def main():
    res = Result()
    for width, height in ((480, 480), (1280, 800)):
        d = kt.boot((width, height))
        label = "%dx%d" % (width, height)
        try:
            kt.route(d, "heading", "[ui-view] .gyroheading-source")
            start = d.page.eval(SOURCE)
            order = ["GPS", "GYRO", "MAG"]
            seen = []
            for send in (d.key, d.key, d.ws_key):
                send(kt.TAP)
                seen.append(d.page.eval(SOURCE))
            i = order.index(start)
            res.check(seen == [order[(i + n) % 3] for n in (1, 2, 3)], "%s TAP cycles the source from %s" % (label, start), seen)
            for key in (kt.PREV, kt.NEXT, "ArrowUp", "ArrowDown"):
                d.key(key)
            res.check(d.page.eval(SOURCE) == seen[-1] and d.hash() == "#/heading", "%s PREV and NEXT do nothing" % label,
                      (d.page.eval(SOURCE), d.hash()))
            if width == 1280:
                d.page.eval("document.querySelector('[ui-view] .fabCenter').click()")
                d.page.pump(0.2)
                hand = d.page.eval(SOURCE)
                res.check(hand == order[(order.index(seen[-1]) + 1) % 3], "a touch on the centre does the same", hand)
                d.show("altimeter", None)
                d.page.pump(0.4)
                kt.route(d, "heading", "[ui-view] .gyroheading-source")
                before = d.page.eval(SOURCE)
                d.key(kt.TAP)
                res.check(d.page.eval(SOURCE) == order[(order.index(before) + 1) % 3],
                          "back on the plate one TAP is one step", (before, d.page.eval(SOURCE)))
                d.show("altimeter", None)
                d.key(kt.TAP)   # AUTO on, as it came
            res.check(not kt.errors(d, "heading"), "%s no JS error" % label, kt.errors(d, "heading")[:3])
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
