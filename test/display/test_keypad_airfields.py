"""The airfields plate and the knob, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 6.5 then phase 5. Written first against the plate's own
knob model and kept through its move onto js/keypadfocus.js, so it states what both must do:

- NEXT walks the airfield rows in the order shown, one lit at a time, and stops at the last;
- TAP on the lit row sets a direct-to that airfield (the route posted to /autopilot), as a
  touch on the row does;
- a TAP right after entry sets no direct-to (only on the helper: the old plate had its first row
  selected on entry, so a stray press flew to it);
- the sort toggle is a stop (only on the helper), and TAP on it re-sorts.
"""

import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] tr[id^=line_0_]"
ROWS = "[...document.querySelectorAll('[ui-view] tr[id^=line_0_]')].map(e => e.querySelector('strong').textContent.trim())"
LIT_ROW = """(() => { const e = [...document.querySelectorAll('[ui-view] tr[id^=line_0_]')]
    .find(e => e.classList.contains('keypadFocus') || e.classList.contains('keypadSelectedYesFull'));
    return e ? e.querySelector('strong').textContent.trim() : null; })()"""
HELPER = "!!document.querySelector('[ui-view] [data-keypad]')"


def target(d):
    """The airfield of the last direct-to: the last waypoint of the route posted to /autopilot."""
    import json, re
    posts = [b for p, b in d.srv.posted if re.sub("/+", "/", p.split("?")[0]) == "/autopilot" and b.strip()]
    route = json.loads(posts[-1]) if posts else None
    try:
        return route[-1]["Cmt"] if route else None
    except (KeyError, IndexError, TypeError):
        return str(route)[:60]


def show(d):
    d.show("airfields", None)
    d.srv.wait_for_client("/situation", timeout=10)
    for _ in range(30):
        d.srv.push_situation(GPSLatitude=43.68, GPSLongitude=10.39, GPSFixQuality=1)
        d.page.pump(0.4)
        if d.page.eval("document.querySelectorAll('%s').length > 3" % READY):
            break
    d.srv.wait_for_client("/keypad", timeout=10)
    d.page.pump(0.5)


def main():
    res = Result()
    d = kt.boot()
    try:
        show(d)
        rows = d.page.eval(ROWS)
        helper = d.page.eval(HELPER)
        res.check(len(rows) > 3, "airfields listed (%d)" % len(rows), rows[:3])

        if helper:
            before = len(d.srv.posted)
            d.key(kt.TAP)
            d.page.pump(0.5)
            res.check(len(d.srv.posted) == before, "a TAP right after entry sets no direct-to", d.srv.posted[before:][:1])
            stops = kt.stops(d)
            res.check(stops[0].startswith("SORT BY") and len(stops) == len(rows) + 1,
                      "the sort toggle is the first stop, then each row", stops[:3])

        # Walk the rows: to the first row, then NEXT one at a time
        for _ in range(len(rows) + 2):
            d.key(kt.PREV, settle=0.02)
        if helper:
            d.key(kt.NEXT, settle=0.1)    # past the sort toggle
        seen = [d.page.eval(LIT_ROW)]
        n = min(len(rows), 8)
        for _ in range(n - 1):
            d.key(kt.NEXT, settle=0.1)
            seen.append(d.page.eval(LIT_ROW))
        res.check(seen == rows[:n], "NEXT walks the rows in the order shown", (seen, rows[:n]))

        d.key(kt.TAP, settle=1.0)
        res.check(target(d) == seen[-1] and d.hash() == "#/hsi",
                  "TAP on the lit row sets a direct-to it, and opens the HSI", (target(d), seen[-1], d.hash()))
        show(d)
        rows = d.page.eval(ROWS)
        d.page.eval("document.querySelectorAll('[ui-view] tr[id^=line_0_]')[2].click()")
        d.page.pump(1.0)
        res.check(target(d) == rows[2] and d.hash() == "#/hsi", "as a touch on a row does", (target(d), rows[2], d.hash()))

        show(d)
        for _ in range(len(rows) + 3):
            d.key(kt.NEXT, settle=0.02)
        d.page.pump(0.3)
        rows = d.page.eval(ROWS)
        res.check(d.page.eval(LIT_ROW) == rows[-1], "NEXT stops at the last row", (d.page.eval(LIT_ROW), rows[-1]))

        if helper:
            for _ in range(len(rows) + 2):
                d.key(kt.PREV, settle=0.02)
            first = kt.lit(d)
            d.key(kt.TAP, settle=0.5)
            res.check(kt.lit(d) != first and kt.lit(d)[0].startswith("SORT BY") and d.page.eval(ROWS) != rows,
                      "TAP on the sort toggle re-sorts the list, the knob stays on the toggle", (first, kt.lit(d)))
            kt.check_glass(d, res, "airfields", 1280, 1000)
        res.check(not kt.errors(d, "airfields"), "no JS error", kt.errors(d, "airfields")[:3])
    finally:
        kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
