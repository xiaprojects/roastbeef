"""The VOR addon on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4. On the instrument: TO/FROM (LOC or GS on an ILS)
and the status, which opens the station search. With the list open: OFF, then each station,
nearest first; TAP tunes it as a touch does and closes the list. Opening or closing the list
changes the view, so the knob starts afresh there: no focus until the next turn.
"""

import json
import re
import sys

import keypadtest as kt
from plates import Result

ROOT = "[ui-view] .addonVorSquare"
LIST = "[ui-view] tr[data-keypad]"
VORTO = "angular.element(document.querySelector('%s')).scope().items.vorto" % ROOT


def bridge(d):
    return [json.loads(body) for path, body in d.srv.posted
            if re.sub("/+", "/", path.split("?")[0]) == "/bridge/float"]


def ready(d):
    d.page.wait("""(() => { const i = angular.element(document.body).injector();
                            return !!i && !!i.get('$state').get('vor'); })()""", timeout=15, label="vor addon")
    kt.route(d, "addons/vor", ROOT, 2)


def wait_bridge(d, before, seconds=1.5):
    for _ in range(int(seconds / 0.1)):
        d.page.pump(0.1)
        if len(bridge(d)) > before:
            break
    d.page.pump(0.2)
    return bridge(d)[before:]


def main():
    res = Result()
    d = kt.boot()
    try:
        ready(d)
        res.check(kt.stops(d) == ["TO/FROM", "SEARCH"], "on the instrument: TO/FROM, then the search", kt.stops(d))
        kt.check_entry(d, res, "vor", lambda: (len(bridge(d)), d.page.eval(VORTO)))
        kt.check_walk(d, res, "vor", ["TO/FROM", "SEARCH"], plate="addons/vor")
        kt.check_socket(d, res, "vor")

        # TO/FROM, as a touch
        kt.go_to(d, 0)
        start = d.page.eval(VORTO)
        d.key(kt.TAP)
        knob = d.page.eval(VORTO)
        d.page.eval("document.querySelector('[ui-view] [data-keypad-name=\"TO/FROM\"]').click()")
        d.page.pump(0.3)
        res.check(knob != start and d.page.eval(VORTO) == start, "TAP toggles TO/FROM, as a touch does",
                  (start, knob, d.page.eval(VORTO)))
        res.check(kt.lit(d) == ["TO/FROM"], "and the knob stays on it", kt.lit(d))

        # The search: the list opens, the knob starts afresh on it
        kt.go_to(d, 1)
        d.key(kt.TAP)
        d.page.wait("document.querySelectorAll('%s').length > 1" % LIST, timeout=5, label="station list")
        d.page.pump(0.3)
        rows = kt.stops(d)
        res.check(rows[0] == "OFF" and len(rows) > 3, "TAP on the status opens the list: OFF, then the stations",
                  rows[:4])
        res.check(kt.focus(d).get("index") == -1 and kt.lit(d) == [], "with no focus until the next turn", kt.focus(d))
        d.key(kt.NEXT)
        d.key(kt.NEXT)
        res.check(kt.lit(d) == [rows[1]], "NEXT, NEXT: the nearest station", (kt.lit(d), rows[1]))
        want = float(rows[1].split()[-1])
        before = len(bridge(d))
        d.key(kt.TAP)
        got = wait_bridge(d, before)
        res.check(got and got[-1].get("vorfreq") == want, "TAP tunes it", got)
        res.check(d.page.eval("document.querySelectorAll('%s').length" % LIST) == 0 and kt.stops(d) == ["TO/FROM", "SEARCH"],
                  "and closes the list, back on the instrument", kt.stops(d))
        res.check(kt.focus(d).get("index") == -1, "with no focus", kt.focus(d))

        # OFF from the list, as a touch on it
        kt.go_to(d, 1)
        d.key(kt.TAP)
        d.page.wait("document.querySelectorAll('%s').length > 1" % LIST, timeout=5, label="station list")
        d.key(kt.NEXT)
        before = len(bridge(d))
        d.key(kt.TAP)
        got = wait_bridge(d, before)
        res.check(got and got[-1].get("vorfreq") == 0, "TAP on OFF posts vorfreq 0, which releases the dongle", got)

        # The whole list walks, one at a time, and stops at the end
        kt.go_to(d, 1)
        d.key(kt.TAP)
        d.page.wait("document.querySelectorAll('%s').length > 1" % LIST, timeout=5, label="station list")
        rows = kt.stops(d)
        for _ in range(len(rows) + 2):
            d.key(kt.NEXT, settle=0.02)
        d.page.pump(0.3)
        res.check(kt.lit(d) == [rows[-1]], "NEXT walks the %d rows and stops at the last" % len(rows), (kt.lit(d), rows[-1]))
        b = d.page.eval(kt.LIT_BOX)
        res.check(b and -1 <= b["top"] and b["bottom"] <= 1001, "the last row is scrolled onto the glass", b)
        d.page.eval("angular.element(document.querySelector('%s')).scope().$apply(s => s.items.searchEnabled = false)" % ROOT)

        kt.check_return(d, res, "vor", "addons/vor", ROOT)
        res.check(not kt.errors(d, "vor"), "no JS error", kt.errors(d, "vor")[:3])
    finally:
        kt.close(d)

    for width, height in kt.PANELS:
        d = kt.boot((width, height))
        try:
            ready(d)
            kt.check_glass(d, res, "vor", width, height)
            kt.go_to(d, 1)
            d.key(kt.TAP)
            d.page.wait("document.querySelectorAll('%s').length > 1" % LIST, timeout=5, label="station list")
            kt.check_glass(d, res, "vor list", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
