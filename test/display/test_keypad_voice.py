"""The voice plate on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: PRIMARIO, SECONDARIO, DISPLAY (the name this display
answers to), then Enable Audio; TAP is a touch on the button.
"""

import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] [data-keypad]"
STORE = "[localStorage.getItem('displayName'), localStorage.getItem('Display_Audio_Enabled')]"
WANT = ["PRIMARIO", "SECONDARIO", "DISPLAY", "Enable Audio"]


def main():
    res = Result()
    d = kt.boot()
    try:
        d.page.eval("localStorage.removeItem('displayName'); localStorage.removeItem('Display_Audio_Enabled')")
        kt.route(d, "voice", READY, 4)
        kt.check_entry(d, res, "voice", lambda: d.page.eval(STORE))
        kt.check_walk(d, res, "voice", WANT, plate="voice")
        kt.check_socket(d, res, "voice")
        got = []
        for k, value in ((1, "secondario"), (2, "display"), (0, "primario")):
            kt.go_to(d, k)
            d.key(kt.TAP)
            got.append(d.page.eval(STORE)[0])
        res.check(got == ["secondario", "display", "primario"], "TAP on a name sets it", got)
        kt.go_to(d, 3)
        d.key(kt.TAP)
        res.check(d.page.eval(STORE)[1] == "true", "TAP on Enable Audio enables it", d.page.eval(STORE))
        d.page.eval("localStorage.removeItem('displayName')")
        d.page.eval("document.querySelectorAll('[ui-view] [data-keypad]')[1].click()")
        res.check(d.page.eval(STORE)[0] == "secondario", "as a touch does", d.page.eval(STORE))
        kt.check_return(d, res, "voice", "voice", READY)
        res.check(not kt.errors(d, "voice"), "no JS error", kt.errors(d, "voice")[:3])
        d.page.eval("localStorage.removeItem('displayName')")
    finally:
        kt.close(d)
    for width, height in kt.PANELS:
        d = kt.boot((width, height))
        try:
            kt.route(d, "voice", READY, 4)
            kt.check_glass(d, res, "voice", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
