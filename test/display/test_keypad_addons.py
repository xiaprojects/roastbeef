"""The addons plate on the knob helper, through the real key paths.

The list of the installed addons of the OTA plate on its own page, #/addons: in the navigation
list after the switchboard and on bottom bar slot 4 as the alternative to SWITCH. Each addon row
is a stop, TAP opens the addon as its START does.
"""

import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] [data-keypad]"


def main():
    res = Result()
    d = kt.boot()
    try:
        kt.route(d, "addons", READY)
        names = kt.stops(d)
        addons = d.page.eval("angular.element(document.querySelector('%s')).scope().addons.map(a => [a.name, a.hash])" % READY)
        res.check(names == [a[0] for a in addons] and len(names) > 0, "one stop per addon row", (names, addons))
        kt.check_entry(d, res, "addons", d.hash)
        kt.check_walk(d, res, "addons", plate="addons")
        kt.check_socket(d, res, "addons")
        kt.go_to(d, len(names) - 1)
        d.key(kt.TAP, settle=0.6)
        res.check(d.hash() == "#" + addons[-1][1], "TAP opens the addon, as START does", (d.hash(), addons[-1]))
        res.check(not kt.errors(d, "addons"), "no JS error", kt.errors(d, "addons")[:3])
    finally:
        kt.close(d)
    for width, height in kt.PANELS:
        d = kt.boot((width, height))
        try:
            kt.route(d, "addons", READY)
            kt.check_glass(d, res, "addons", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
