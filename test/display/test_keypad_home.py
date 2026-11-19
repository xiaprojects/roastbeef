"""The home page as a knob launcher, through js/keypadfocus.js and the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: each tile that opens a page is a stop, left column
then right; TAP opens it, as a touch does. Tiles that open nothing are not stops. With it every
page is three keys away. The page is routed both as #/ and #/aircraft.
"""

import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] .aircraft"
# The tiles that open a page, in reading order, from the plate's own model
TILES = """(() => {
    const s = angular.element(document.querySelector('[ui-view] .aircraft')).scope();
    return s.items[0].concat(s.items[1]).filter(i => i.href).map(i => i.href);
})()"""
LIT_HREF = """(() => {
    const e = document.querySelector('[ui-view] .keypadFocus');
    return e ? angular.element(e).scope().item.href : null;
})()"""


def main():
    res = Result()
    d = kt.boot()
    try:
        for plate in ("", "aircraft"):
            label = "#/" + plate
            kt.route(d, plate, READY)
            hrefs = d.page.eval(TILES)
            res.check(len(hrefs) == len(kt.stops(d)) and len(hrefs) > 5,
                      "%s: one stop per tile that opens a page (%d)" % (label, len(hrefs)), (hrefs, kt.stops(d)))
            kt.check_entry(d, res, label, d.hash)
            kt.check_walk(d, res, label, plate=plate)
            if plate == "":
                kt.check_walk(d, res, label + " arrows", prev="ArrowUp", nxt="ArrowDown", plate=plate)
                kt.check_socket(d, res, label)

        # TAP opens each tile's page, as a touch on it does
        kt.route(d, "", READY)
        hrefs = d.page.eval(TILES)
        wrong = []
        for k, href in enumerate(hrefs):
            kt.route(d, "", READY)
            kt.go_to(d, k)
            on = d.page.eval(LIT_HREF)
            d.key(kt.TAP, settle=0.6)
            if on != href or d.hash().split("?")[0] != href:
                wrong.append((k, href, on, d.hash()))
        res.check(not wrong, "TAP on each of the %d tiles opens its page" % len(hrefs), wrong[:3])
        kt.route(d, "", READY)
        d.page.eval("document.querySelectorAll('[ui-view] [data-keypad]')[1].click()")
        d.page.pump(0.6)
        res.check(d.hash() == hrefs[1], "a touch on the same tile opens the same page", (d.hash(), hrefs[1]))

        kt.route(d, "", READY)
        kt.check_return(d, res, "#/", "", READY)
        res.check(not kt.errors(d, "aircraft"), "no JS error", kt.errors(d, "aircraft")[:3])
    finally:
        kt.close(d)

    for width, height in kt.PANELS:
        d = kt.boot((width, height))
        try:
            kt.route(d, "", READY)
            kt.check_glass(d, res, "#/", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
