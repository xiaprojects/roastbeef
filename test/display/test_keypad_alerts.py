"""The alerts plate on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: each row is a stop, most recent first; TAP plays
its sound again, as a touch on the row does. A new alert arriving above keeps the knob on the
alert it was on, not on the place.
"""

import sys

import keypadtest as kt
from plates import Result
from test_alerts import listed, EMS_RED, EMS_YELLOW, TIMER

READY = "[ui-view] .alertsline"
SRC = "document.getElementById('audioproxy').getAttribute('src')"


def alerts():
    return [listed(19064455, TIMER, "Timer 1 fired"),
            listed(19070000, EMS_YELLOW, "CHTMAX yellow 190", seconds=134),
            listed(19080000, EMS_RED, "OILAVG red 125", active=True, seconds=75)]


def setup(d):
    d.srv.rest["/getAlerts"] = alerts()


def main():
    res = Result()
    d = kt.boot(setup=setup)
    try:
        kt.route(d, "alerts", READY, 3)
        names = kt.stops(d)
        res.check(len(names) == 3 and "OILAVG" in names[0], "three rows, most recent first", names)
        kt.check_entry(d, res, "alerts", lambda: d.page.eval(SRC))
        kt.check_walk(d, res, "alerts", plate="alerts")
        kt.check_socket(d, res, "alerts")

        sounds = d.page.eval("angular.element(document.querySelector('%s')).scope().data_list.map(a => '/' + a.sound)" % READY)
        wrong = []
        for k in range(3):
            d.page.eval("document.getElementById('audioproxy').removeAttribute('src')")
            kt.go_to(d, k)
            d.key(kt.TAP)
            knob = d.page.eval(SRC)
            d.page.eval("document.getElementById('audioproxy').removeAttribute('src')")
            d.page.eval("document.querySelectorAll('[ui-view] .alertsline')[%d].click()" % k)
            d.page.pump(0.2)
            hand = d.page.eval(SRC)
            if not (knob == hand == sounds[k]):
                wrong.append((k, knob, hand, sounds[k]))
        res.check(not wrong, "TAP on each row plays its sound, as a touch on it does", wrong)

        # A new alert above: the knob stays on the alert it was on
        kt.go_to(d, 1)
        on = kt.lit(d)
        d.srv.set_rest("/getAlerts", alerts() + [listed(19090000, EMS_RED, "CHTMAX red 230", active=True, seconds=3)])
        d.page.wait("document.querySelectorAll('%s').length == 4" % READY, timeout=5, label="new alert")
        d.page.pump(0.4)
        res.check(kt.lit(d) == on and kt.focus(d).get("index") == 2,
                  "a new alert above keeps the knob on the same alert", (on, kt.lit(d), kt.focus(d)))

        kt.check_return(d, res, "alerts", "alerts", READY)
        res.check(not kt.errors(d, "alerts"), "no JS error", kt.errors(d, "alerts")[:3])
    finally:
        kt.close(d)
    for width, height in kt.PANELS:
        d = kt.boot((width, height), setup)
        try:
            kt.route(d, "alerts", READY, 3)
            kt.check_glass(d, res, "alerts", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
