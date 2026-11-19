"""The timers plate on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4. Per timer: START/STOP, mode (TIMER/CHRNO, only
while stopped), -5 and +5 (only on a running countdown), and DELETE last, so that NEXT, NEXT,
TAP by habit cannot reach it; then "Create new timer". TAP is a touch on the button. The old
hand-written selection had a comparison where an assignment was meant and cleared with the outer
loop index, and kept its highlight in the timers' data.
"""

import json
import re
import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] #timer_create"


def timers():
    return [{"CountDown": 0, "Epoch": 0, "Status": False, "Fired": False},
            {"CountDown": 1200, "Epoch": 0, "Status": False, "Fired": False}]


STOPPED = ["Timer 1 START", "Timer 1 MODE", "Timer 1 DELETE",
           "Timer 2 START", "Timer 2 MODE", "Timer 2 DELETE", "CREATE"]


def requests(d):
    out = []
    for path, body in d.srv.posted:
        if re.sub("/+", "/", path.split("?")[0]).startswith("/timers"):
            out.append(("POST/PUT", re.sub("/+", "/", path), body))
    out += [("DELETE", re.sub("/+", "/", p), "") for p in d.srv.deleted]
    return out


def setup(d):
    d.srv.rest["/timers"] = timers()


def wait(d, before, seconds=1.5):
    """The requests sent since `before`, a snapshot of requests(d)."""
    for _ in range(int(seconds / 0.1)):
        d.page.pump(0.1)
        if len(requests(d)) > len(before):
            break
    d.page.pump(0.3)
    now = requests(d)
    for r in before:
        now.remove(r)
    return now


def tap_on(d, name):
    kt.first(d)
    names = kt.stops(d)
    for _ in range(names.index(name)):
        d.key(kt.NEXT, settle=0.03)
    d.page.pump(0.15)
    on = kt.lit(d)
    before = requests(d)
    d.key(kt.TAP)
    return on, wait(d, before)


def reset(d):
    d.srv.rest["/timers"] = timers()
    d.page.eval("angular.element(document.querySelector('[ui-view] #timer_create')).scope().refreshTimers()")
    d.page.wait("(%s).length == %d" % (kt.STOPS, len(STOPPED)), timeout=5, label="timers back")
    d.page.pump(0.3)


def main():
    res = Result()
    d = kt.boot(setup=setup)
    try:
        kt.route(d, "timers", READY, len(STOPPED))
        kt.check_entry(d, res, "timers", lambda: len(requests(d)))
        kt.check_walk(d, res, "timers", STOPPED, plate="timers")
        kt.check_walk(d, res, "timers arrows", STOPPED, prev="ArrowUp", nxt="ArrowDown", plate="timers")
        kt.check_socket(d, res, "timers")

        # START: posts the timer running; the button becomes STOP and keeps the focus
        on, got = tap_on(d, "Timer 1 START")
        body = json.loads(got[0][2]) if got and got[0][2] else {}
        res.check(len(got) == 1 and body.get("0", {}).get("Status") is True,
                  "TAP on START posts timer 1 running", got)
        res.check(kt.lit(d) == ["Timer 1 STOP"], "and the knob stays on it, now STOP", kt.lit(d))
        stops = kt.stops(d)
        res.check("Timer 1 MODE" not in stops, "the mode button of a running timer is not a stop", stops)
        before = requests(d)
        d.key(kt.TAP)
        got = wait(d, before)
        body = json.loads(got[0][2]) if got and got[0][2] else {}
        res.check(body.get("0", {}).get("Status") is False, "TAP again stops it", got)

        # The same by touch
        reset(d)
        before = requests(d)
        d.page.eval("document.querySelector('[ui-view] [data-keypad-name=\"Timer 1 START\"]').click()")
        hand = wait(d, before)
        res.check(len(hand) == 1 and json.loads(hand[0][2]).get("0", {}).get("Status") is True,
                  "a touch on START posts the same", hand)

        # Mode on the countdown: back to a chronometer
        reset(d)
        on, got = tap_on(d, "Timer 2 MODE")
        body = json.loads(got[0][2]) if got and got[0][2] else {}
        res.check(on == ["Timer 2 MODE"] and body.get("1", {}).get("CountDown") == 0,
                  "TAP on MODE switches timer 2 to a chronometer", (on, got))

        # A running countdown shows -5 and +5, before DELETE
        reset(d)
        tap_on(d, "Timer 2 START")
        stops = kt.stops(d)
        res.check(stops[3:7] == ["Timer 2 STOP", "Timer 2 +5", "Timer 2 DELETE", "CREATE"] or
                  stops[3:8] == ["Timer 2 STOP", "Timer 2 -5", "Timer 2 +5", "Timer 2 DELETE", "CREATE"],
                  "a running countdown: STOP, -5, +5, then DELETE", stops)
        on, got = tap_on(d, "Timer 2 +5")
        body = json.loads(got[0][2]) if got and got[0][2] else {}
        res.check(body.get("1", {}).get("CountDown") == 1500, "TAP on +5 adds five minutes", got)

        reset(d)
        on, got = tap_on(d, "Timer 2 DELETE")
        res.check(got == [("DELETE", "/timers/1", "")], "TAP on DELETE deletes timer 2", got)
        reset(d)
        on, got = tap_on(d, "CREATE")
        res.check(len(got) == 1 and got[0][1] == "/timers", "TAP on Create posts a new timer", got)

        reset(d)
        kt.check_return(d, res, "timers", "timers", READY)
        res.check(not kt.errors(d, "timers"), "no JS error", kt.errors(d, "timers")[:3])
    finally:
        kt.close(d)

    for width, height in kt.PANELS:
        d = kt.boot((width, height), setup)
        try:
            kt.route(d, "timers", READY, len(STOPPED))
            kt.check_glass(d, res, "timers", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
