"""The altimeter plate: the knob sets the QNH, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: `altimeter` is a direct page, no focus to move.

    PREV  QNH -1 hPa, AUTO off      NEXT  QNH +1 hPa, AUTO off      TAP  AUTO on

The same three actions as the plate's own touch zones (north, south, centre), which send
SituationUpdatedByPilot to services/servicesituation.js. AUTO derives the QNH from the GPS and
the baro altitude while the aircraft is level; a QNH the pilot sets holds until AUTO again.
Every press is a real Chromium key or a frame on the /keypad socket.

The frames here keep the same baro altitude, as on the ground: the plate used to redraw only
when that changed, so a new QNH or AUTO did not show until the aircraft climbed.
"""

import sys

import known
from plates import Display, Result

PREV, TAP, NEXT = "1", "2", "3"
# 1000 ft GPS, 1270 ft at 1013.25: AUTO gives 1013.25 - 10 = 1003.25, shown 1003
FRAME = dict(GPSAltitudeMSL=1000, BaroPressureAltitude=1270, BaroVerticalSpeed=0, GPSFixQuality=1,
             GPSLatitude=43.6, GPSLongitude=10.4)
AUTO_QNH = 1003

READ = """(() => {
    const p = document.querySelector('[ui-view] .altimeter');
    if (!p) return null;
    const auto = p.querySelector('.altimeter-qnh-auto');
    return {qnh: parseInt(p.querySelector('.altimeter-qnh').textContent),
            auto: !!auto && auto.classList.contains('label-success'),
            needle: p.querySelector('.altimeter-fi_needle').style.transform};
})()"""


def read(d):
    return d.page.eval(READ)


def frames(d, n=3):
    for _ in range(n):
        d.srv.push_situation(**FRAME)
        d.page.pump(0.35)
    d.page.pump(0.3)


def ready(d):
    d.show("altimeter", "[ui-view] .altimeter")
    d.srv.wait_for_client("/situation", timeout=10)
    d.srv.wait_for_client("/keypad", timeout=10)
    frames(d, 4)


def press(d, key, send=None):
    (send or d.key)(key)
    frames(d, 2)
    return read(d)


def errors(d):
    return [e for e in d.js_errors() if not known.lookup("keypad", "altimeter", e)]


def check_knob(d, res, label, prev, nxt, tap, send):
    press(d, tap, send)
    start = read(d)
    res.check(start["qnh"] == AUTO_QNH and start["auto"], "%s AUTO shows the derived QNH" % label, start)
    got = press(d, nxt, send)
    res.check(got["qnh"] == AUTO_QNH + 1 and not got["auto"], "%s NEXT sets QNH +1 hPa and AUTO off" % label, got)
    res.check(got["needle"] != start["needle"], "%s and the needle moves, the baro altitude unchanged" % label,
              (start["needle"], got["needle"]))
    press(d, nxt, send)
    got = press(d, nxt, send)
    res.check(got["qnh"] == AUTO_QNH + 3, "%s each click is 1 hPa" % label, got)
    got = press(d, prev, send)
    res.check(got["qnh"] == AUTO_QNH + 2, "%s PREV takes 1 hPa off" % label, got)
    frames(d, 4)
    res.check(read(d)["qnh"] == AUTO_QNH + 2 and not read(d)["auto"],
              "%s the pilot's QNH holds over new frames" % label, read(d))
    got = press(d, tap, send)
    res.check(got["auto"] and got["qnh"] == AUTO_QNH, "%s TAP turns AUTO on, back to the derived QNH" % label, got)
    res.check(d.hash().endswith("/altimeter"), "%s and the plate never changed" % label, d.hash())


def check_touch(d, res):
    """The knob and the plate's own touch zones do the same."""
    press(d, TAP)
    knob = press(d, NEXT)
    press(d, TAP)
    d.page.eval("document.querySelector('[ui-view] .altimeter .fabNorthCenter').click()")
    frames(d, 2)
    hand = read(d)
    res.check(knob["qnh"] == hand["qnh"] == AUTO_QNH + 1 and not knob["auto"] and not hand["auto"],
              "NEXT does what a touch on the north zone does", (knob, hand))
    d.page.eval("document.querySelector('[ui-view] .altimeter .fabCenter').click()")
    frames(d, 2)
    res.check(read(d)["auto"], "a touch on the centre turns AUTO on, as TAP does", read(d))


def check_other_page(d, res):
    """The sixpack holds an altimeter too: the knob must not set the QNH from there."""
    press(d, TAP)
    d.show("sixpack", None)
    frames(d, 2)
    for key in (NEXT, NEXT, PREV, NEXT):
        d.key(key, settle=0.1)
    frames(d, 2)
    ready(d)
    got = read(d)
    res.check(got["auto"] and got["qnh"] == AUTO_QNH, "on the sixpack the knob leaves the QNH alone", got)
    got = press(d, NEXT)
    res.check(got["qnh"] == AUTO_QNH + 1, "back on the altimeter one NEXT is 1 hPa: no listener left behind", got)
    press(d, TAP)


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
            check_knob(d, res, label + " 1/2/3", PREV, NEXT, TAP, d.key)
            if width == 1280:
                # Not in the Landscape navigation list: the knob reaches it all the same
                check_knob(d, res, label + " arrows", "ArrowUp", "ArrowDown", "Enter", d.key)
                check_knob(d, res, label + " socket", PREV, NEXT, TAP, d.ws_key)
                check_touch(d, res)
                check_other_page(d, res)
            res.check(not errors(d), "%s no JS error" % label, errors(d)[:3])
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
