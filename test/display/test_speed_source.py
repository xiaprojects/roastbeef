"""Does the display switch from GPS ground speed to indicated airspeed, and say so?

servicesituation.js resolves the speed once per frame - SpeedKt is the airspeed
board's IAS when it reports one, the GPS ground speed otherwise, and SpeedSource
names which - so the plates never disagree on the source. The speed gauge, the
attitude tape and slot 1 of the top bar consume it. This asserts on the published frame
and on the text and colours the plates render from it, all in the pilot's unit
from aircraft.json.
"""


import json
import sys

from plates import Display, Result

KT_TO_KMH = 1.852


def frame(seq, gs, ias, fix=2):
    """Every field the resolution reads is set explicitly, because the fake
    backend keeps whatever the previous case pushed."""
    return {"TestSeq": seq, "GPSGroundSpeed": gs, "IndicatedAirSpeed": ias,
            "GPSFixQuality": fix}


def published(d, seq):
    d.page.wait("window.situation.TestSeq === %d" % seq, timeout=10,
                label="frame %d published" % seq)
    return json.loads(d.page.eval("JSON.stringify(window.situation)"))


def text(d, selector):
    return d.page.eval("(document.querySelector(%r) || {textContent: null}).textContent"
                       % selector)


# The EMS widgets in the side panels reuse the gauge's classes, so the speed
# plate is addressed through the routed view
GAUGE = "[ui-view] .speed"


def arc_colors(d):
    return d.page.eval("Array.from(document.querySelectorAll(%r))"
                       ".map(e => getComputedStyle(e).backgroundColor)" % (GAUGE + " .arc"))


def expect_speed(res, d, label, f, source, kt):
    d.fly(frames=4, interval=0.3, **f)
    s = published(d, f["TestSeq"])
    res.check(s.get("SpeedSource") == source and abs(s.get("SpeedKt", -1) - kt) < 1e-6,
              label, "source=%r kt=%r" % (s.get("SpeedSource"), s.get("SpeedKt")))
    return s


def pilot_unit(d):
    """The pilot's unit for this aircraft (the device fixture's aircraft.json) and
    the conversion of a speed in knots into it, as the plates print it."""
    d.page.wait("window.aircraftData && window.aircraftData.units", timeout=10,
                label="aircraft units loaded")
    ratio = d.page.eval("window.aircraftData.units.speedConversionFromKmh.multiply")
    unit = d.page.eval("window.aircraftData.units.speed")
    return unit, (lambda kt: int(kt * KT_TO_KMH * ratio))


def lines(d, selector):
    """The rendered lines of an element, as the pilot reads them: the tape prints
    the unit and the source one above the other."""
    return d.page.eval("(function(){var e = document.querySelector(%r);"
                       " return e ? e.innerText.split(/\\s+/).filter(Boolean) : null;})()"
                       % selector)


# Covers: RB-HLR-SPD-200
def check_service(res, d):
    """servicesituation.js resolves the source once for every plate."""
    expect_speed(res, d, "GS when the airspeed board reports nothing",
                 frame(1, gs=100, ias=0), "GS", 100)
    expect_speed(res, d, "IAS as soon as the board reports one",
                 frame(2, gs=100, ias=120), "IAS", 120)
    expect_speed(res, d, "a negative airspeed is not a source",
                 frame(3, gs=100, ias=-5), "GS", 100)


# Covers: RB-HLR-SPD-210
def check_gauge_label(res, d, unit, pilot):
    d.show("speed", GAUGE + " .speed-label")
    d.fly(frames=4, interval=0.3, **frame(4, gs=100, ias=0))
    published(d, 4)
    d.page.pump(0.5)
    res.check(text(d, GAUGE + " .speed-label") == "GS", "gauge labelled GS on ground speed",
              text(d, GAUGE + " .speed-label"))
    res.check(text(d, GAUGE + " .speed-value").strip() == str(pilot(100)),
              "gauge shows ground speed in %s" % unit, text(d, GAUGE + " .speed-value").strip())

    d.fly(frames=4, interval=0.3, **frame(5, gs=100, ias=120))
    published(d, 5)
    d.page.pump(0.5)
    res.check(text(d, GAUGE + " .speed-label") == "IAS", "gauge labelled IAS on airspeed",
              text(d, GAUGE + " .speed-label"))
    res.check(text(d, GAUGE + " .speed-value").strip() == str(pilot(120)),
              "gauge shows airspeed in %s" % unit, text(d, GAUGE + " .speed-value").strip())


# No Covers: RB-HLR-SPD-220 is an open finding. The arcs are drawn on ground speed
# too, so the first check fails, and the requirement stays in requirements/untraced.txt
# until it passes.
def check_gauge_arcs(res, d):
    d.show("speed", GAUGE + " .speed-label")
    d.fly(frames=4, interval=0.3, **frame(4, gs=100, ias=0))
    published(d, 4)
    d.page.pump(0.5)
    plain = arc_colors(d)
    res.check(plain and all(c in ("rgb(255, 255, 255)", "rgb(0, 0, 0)") for c in plain),
              "colour arcs suppressed on ground speed (FHA-SPD-2)", plain)
    d.fly(frames=4, interval=0.3, **frame(5, gs=100, ias=120))
    published(d, 5)
    d.page.pump(0.5)
    coloured = arc_colors(d)
    res.check(any(c not in ("rgb(255, 255, 255)", "rgb(0, 0, 0)") for c in coloured),
              "colour arcs drawn on airspeed", coloured)


# Covers: RB-HLR-SPD-210
def check_tape_label(res, d, unit, pilot):
    d.show("attitude", ".attitude-speed")
    d.fly(frames=4, interval=0.3, **frame(6, gs=100, ias=0))
    published(d, 6)
    d.page.pump(0.5)
    res.check(lines(d, ".attitude-speed-source") == [unit, "GS"],
              "tape annunciates GS and the unit", lines(d, ".attitude-speed-source"))
    value = text(d, ".attitude-speed").strip().split()[0]
    res.check(value == str(pilot(100)), "tape value converted to %s" % unit, value)

    d.fly(frames=4, interval=0.3, **frame(7, gs=100, ias=120))
    published(d, 7)
    d.page.pump(0.5)
    res.check(lines(d, ".attitude-speed-source") == [unit, "IAS"],
              "tape annunciates IAS", lines(d, ".attitude-speed-source"))
    value = text(d, ".attitude-speed").strip().split()[0]
    res.check(value == str(pilot(120)), "tape follows the airspeed", value)


# Covers: RB-HLR-SPD-230
def check_no_fix(res, d):
    """A ground speed without a fix is marked failed, on the gauge and on the tape;
    an airspeed is not, because it does not come from the GPS."""
    for plate, ready, failed in (("speed", GAUGE + " .speed-label", "[ui-view] .speed .attitude-fail"),
                                 ("attitude", ".attitude-speed", ".attitude-speed.attitude-fail-text")):
        d.show(plate, ready)
        for seq, ias, fix, want in ((10, 0, 0, True), (11, 0, 2, False), (12, 120, 0, False)):
            d.fly(frames=4, interval=0.3, **frame(seq, gs=100, ias=ias, fix=fix))
            published(d, seq)
            d.page.pump(0.5)
            got = d.page.eval("!!document.querySelector(%r)" % failed)
            res.check(got == want, "%s: %s with fix quality %d %s" % (
                plate, "IAS" if ias else "GS", fix, "marked failed" if want else "not marked"), got)


# Covers: RB-HLR-SPD-210
def check_top_bar_label(res, d, unit, pilot):
    # Left out by default since WIND took the first place (TOP_BAR_SLOTS_HIDDEN): shown
    # again as a unit with no airspeed sensor would, read when the bar is created
    d.page.eval("localStorage.setItem('topBarSlotsHidden', '[]')")
    d.page.eval("(function(){var s = angular.element(document.body).scope();"
                " s.uiSidebarTop = true; s.$apply();})()")
    d.page.wait("!!document.querySelector(\".rb-bar-top [data-slot='speed']\")",
                timeout=10, label="top bar")
    tile = lambda: {part: (text(d, ".rb-bar-top [data-slot='speed'] .rb-slot-%s" % part) or "").strip()
                    for part in ("label", "value")}
    d.fly(frames=4, interval=0.3, **frame(8, gs=100, ias=0))
    published(d, 8)
    d.page.pump(0.5)
    t = tile()
    res.check(t["label"] == "GS %s" % unit and t["value"] == str(pilot(100)),
              "top bar speed GS in %s" % unit, t)
    d.fly(frames=4, interval=0.3, **frame(9, gs=100, ias=120))
    published(d, 9)
    d.page.pump(0.5)
    t = tile()
    res.check(t["label"] == "IAS %s" % unit and t["value"] == str(pilot(120)),
              "top bar speed IAS in %s" % unit, t)


def main():
    res = Result()
    with Display() as d:
        d.show("hsi", "#hsi")
        check_service(res, d)
        unit, pilot = pilot_unit(d)
        check_gauge_label(res, d, unit, pilot)
        check_gauge_arcs(res, d)
        check_tape_label(res, d, unit, pilot)
        check_no_fix(res, d)
        check_top_bar_label(res, d, unit, pilot)

        errs = d.js_errors()
        res.check(not errs, "no JS errors across the speed source run", errs[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
