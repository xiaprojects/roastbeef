"""The OTA plate on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: each addon row is a stop, TAP opens the addon as
its START does. INSTALL and UPDATE are not stops: touch runs them with no confirmation, and the
plan leaves a knob confirmation to the owner, so a stray press cannot start an install.
"""

import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] [data-keypad]"
UPDATES = [{"component": "rb-vor", "version": 3, "installed": 2}, {"component": "rb-ems", "version": 1, "installed": -1}]


def setup(d):
    d.srv.rest["/updates/available"] = UPDATES


def main():
    res = Result()
    d = kt.boot(setup=setup)
    try:
        kt.route(d, "ota", READY)
        d.page.wait("document.querySelectorAll('[ui-view] a[ng-click^=installUpdate]').length > 0", timeout=10, label="updates")
        names = kt.stops(d)
        addons = d.page.eval("angular.element(document.querySelector('%s')).scope().addons.map(a => [a.name, a.hash])" % READY)
        res.check(names == [a[0] for a in addons] and len(names) > 0, "one stop per addon row", (names, addons))
        res.check(d.page.eval("[...document.querySelectorAll('[ui-view] a[ng-click^=installUpdate]')].every(e => !e.hasAttribute('data-keypad'))"),
                  "INSTALL and UPDATE are not stops")
        kt.check_entry(d, res, "ota", d.hash)
        kt.check_walk(d, res, "ota", plate="ota")
        kt.check_socket(d, res, "ota")
        for _ in range(len(names) + 2):
            d.key(kt.NEXT, settle=0.03)
        res.check(not [p for p, _ in d.srv.posted if "ota" in p.lower() or "update" in p.lower()],
                  "turning past the last addon reaches no update", d.srv.posted[-3:])
        kt.go_to(d, len(names) - 1)
        d.key(kt.TAP, settle=0.6)
        res.check(d.hash() == "#" + addons[-1][1], "TAP opens the addon, as START does", (d.hash(), addons[-1]))
        res.check(not kt.errors(d, "ota"), "no JS error", kt.errors(d, "ota")[:3])
    finally:
        kt.close(d)
    for width, height in kt.PANELS:
        d = kt.boot((width, height), setup)
        try:
            kt.route(d, "ota", READY)
            kt.check_glass(d, res, "ota", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
