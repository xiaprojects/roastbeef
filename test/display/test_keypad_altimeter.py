"""The altimeter plate: the knob sets the QNH, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: `altimeter` is a direct page, no focus to move.

    PREV  QNH -1 hPa, AUTO off      NEXT  QNH +1 hPa, AUTO off      TAP  AUTO on

The same three actions as the plate's own touch zones (north, south, centre), which send
SituationUpdatedByPilot to services/servicesituation.js. AUTO derives the QNH from the GPS and
the baro altitude while the aircraft is level; a QNH the pilot sets holds until AUTO again.
Every press is a real Chromium key or a frame on the /keypad socket.

The frames here keep the same baro altitude, as on the ground: the plate used to redraw only
when that changed, so a new QNH or AUTO did not show until the aircraft climbed.

The pilot cannot set a QNH outside 850..1100 hPa (QNH_MIN / QNH_MAX in SixPackInstruments.js):
a step past a limit stays on it, a step from an AUTO value outside the range lands on the limit.
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


# Covers: RB-HLR-ALT-090, RB-HLR-ALT-100, RB-HLR-ALT-110
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


# Covers: RB-HLR-ALT-100
def check_limits(d, res, label):
    """The pilot QNH stops at 1100 and 850 hPa, whatever AUTO derived."""
    global FRAME
    keep = FRAME
    try:
        # GPS 0 ft, baro -2322 ft: AUTO gives 1013.25 + 86 = 1099.25, shown 1099
        FRAME = dict(keep, GPSAltitudeMSL=0, BaroPressureAltitude=-2322)
        press(d, TAP)
        res.check(read(d)["qnh"] == 1099, "%s AUTO near the top limit" % label, read(d))
        got = press(d, NEXT)
        res.check(got["qnh"] == 1100 and not got["auto"], "%s NEXT reaches 1100 hPa" % label, got)
        got = press(d, NEXT)
        got = press(d, NEXT)
        res.check(got["qnh"] == 1100, "%s NEXT past 1100 hPa is blocked" % label, got)
        got = press(d, PREV)
        res.check(got["qnh"] == 1099, "%s PREV comes back down from the limit" % label, got)
        # GPS 0 ft, baro 4428 ft: AUTO gives 1013.25 - 164 = 849.25, shown 849, outside the range
        FRAME = dict(keep, GPSAltitudeMSL=0, BaroPressureAltitude=4428)
        press(d, TAP)
        res.check(read(d)["qnh"] == 849 and read(d)["auto"], "%s AUTO below the bottom limit" % label, read(d))
        got = press(d, PREV)
        res.check(got["qnh"] == 850 and not got["auto"],
                  "%s PREV from an AUTO value below 850 lands on 850 hPa" % label, got)
        got = press(d, PREV)
        res.check(got["qnh"] == 850, "%s PREV past 850 hPa is blocked" % label, got)
        got = press(d, NEXT)
        res.check(got["qnh"] == 851, "%s NEXT goes up from the limit" % label, got)
    finally:
        FRAME = keep
    press(d, TAP)
    res.check(read(d)["auto"] and read(d)["qnh"] == AUTO_QNH, "%s back to AUTO" % label, read(d))


# Covers: RB-HLR-ALT-120
def check_auto_gates(d, res):
    """AUTO derives the QNH only with a fix and while the baro says level, under
    200 fpm; otherwise the last derived one holds."""
    global FRAME
    keep = FRAME
    try:
        press(d, TAP)
        # 300 ft more GPS: AUTO would give 1013.25 + 1 = 1014.25 if it derived now
        for label, over in (("climbing at 500 fpm", dict(BaroVerticalSpeed=500)),
                            ("sinking at 250 fpm", dict(BaroVerticalSpeed=-250)),
                            ("without a fix", dict(GPSFixQuality=0))):
            FRAME = dict(keep, GPSAltitudeMSL=1300, **over)
            frames(d, 4)
            got = read(d)
            res.check(got["qnh"] == AUTO_QNH and got["auto"], "AUTO keeps %d hPa %s" % (AUTO_QNH, label), got)
        FRAME = dict(keep, GPSAltitudeMSL=1300, BaroVerticalSpeed=150)
        frames(d, 4)
        got = read(d)
        res.check(got["qnh"] == 1014 and got["auto"], "level again, AUTO derives 1014 hPa", got)
    finally:
        FRAME = keep
    press(d, TAP)
    res.check(read(d)["qnh"] == AUTO_QNH, "and back on the first frame, %d hPa" % AUTO_QNH, read(d))


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
            check_limits(d, res, label)
            check_auto_gates(d, res)
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
