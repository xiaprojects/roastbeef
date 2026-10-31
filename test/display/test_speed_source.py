"""Does the display switch from GPS ground speed to indicated airspeed, and say so?

servicesituation.js resolves the speed once per frame - SpeedKt is the airspeed
board's IAS when it reports one, the GPS ground speed otherwise, and SpeedSource
names which - so the plates never disagree on the source. The speed gauge, the
attitude tape and the bottom bar consume it. This asserts on the published frame
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


def main():
    res = Result()
    with Display() as d:
        d.show("hsi", "#hsi")

        # -- the service ----------------------------------------------------
        expect_speed(res, d, "GS when the airspeed board reports nothing",
                     frame(1, gs=100, ias=0), "GS", 100)
        expect_speed(res, d, "IAS as soon as the board reports one",
                     frame(2, gs=100, ias=120), "IAS", 120)
        expect_speed(res, d, "a negative airspeed is not a source",
                     frame(3, gs=100, ias=-5), "GS", 100)

        # The pilot's unit for this aircraft (the device fixture's aircraft.json)
        d.page.wait("window.aircraftData && window.aircraftData.units", timeout=10,
                    label="aircraft units loaded")
        ratio = d.page.eval("window.aircraftData.units.speedConversionFromKmh.multiply")
        unit = d.page.eval("window.aircraftData.units.speed")
        pilot = lambda kt: int(kt * KT_TO_KMH * ratio)

        # -- speed gauge ----------------------------------------------------
        d.show("speed", GAUGE + " .speed-label")
        d.fly(frames=4, interval=0.3, **frame(4, gs=100, ias=0))
        published(d, 4)
        d.page.pump(0.5)
        res.check(text(d, GAUGE + " .speed-label") == "GS", "gauge labelled GS on ground speed",
                  text(d, GAUGE + " .speed-label"))
        res.check(text(d, GAUGE + " .speed-value").strip() == str(pilot(100)),
                  "gauge shows ground speed in %s" % unit, text(d, GAUGE + " .speed-value").strip())
        plain = arc_colors(d)
        res.check(plain and all(c in ("rgb(255, 255, 255)", "rgb(0, 0, 0)") for c in plain),
                  "colour arcs suppressed on ground speed (FHA-SPD-2)", plain)

        d.fly(frames=4, interval=0.3, **frame(5, gs=100, ias=120))
        published(d, 5)
        d.page.pump(0.5)
        res.check(text(d, GAUGE + " .speed-label") == "IAS", "gauge labelled IAS on airspeed",
                  text(d, GAUGE + " .speed-label"))
        res.check(text(d, GAUGE + " .speed-value").strip() == str(pilot(120)),
                  "gauge shows airspeed in %s" % unit, text(d, GAUGE + " .speed-value").strip())
        coloured = arc_colors(d)
        res.check(any(c not in ("rgb(255, 255, 255)", "rgb(0, 0, 0)") for c in coloured),
                  "colour arcs drawn on airspeed", coloured)

        # -- attitude tape --------------------------------------------------
        d.show("attitude", ".attitude-speed")
        d.fly(frames=4, interval=0.3, **frame(6, gs=100, ias=0))
        published(d, 6)
        d.page.pump(0.5)
        res.check(text(d, ".attitude-speed-source").strip() == "GS %s" % unit,
                  "tape annunciates GS and the unit", text(d, ".attitude-speed-source"))
        value = text(d, ".attitude-speed").strip().split()[0]
        res.check(value == str(pilot(100)), "tape value converted to %s" % unit, value)

        d.fly(frames=4, interval=0.3, **frame(7, gs=100, ias=120))
        published(d, 7)
        d.page.pump(0.5)
        res.check(text(d, ".attitude-speed-source").strip() == "IAS %s" % unit,
                  "tape annunciates IAS", text(d, ".attitude-speed-source"))
        value = text(d, ".attitude-speed").strip().split()[0]
        res.check(value == str(pilot(120)), "tape follows the airspeed", value)

        # -- bottom bar -----------------------------------------------------
        d.page.eval("(function(){var s = angular.element(document.body).scope();"
                    " s.uiSidebarBottom = true; s.$apply();})()")
        d.page.wait("!!document.querySelector('.navbar-absolute-bottom .rb-button-switch')",
                    timeout=10, label="bottom bar")
        tile = lambda: d.page.eval(
            "angular.element(document.querySelector('.navbar-absolute-bottom')).scope().items[0]")
        d.fly(frames=4, interval=0.3, **frame(8, gs=100, ias=0))
        published(d, 8)
        d.page.pump(0.5)
        t = tile()
        res.check(t["title"] == "GS\n%s" % unit and t["value"] == str(pilot(100)),
                  "bottom tile GS in %s" % unit, t)
        d.fly(frames=4, interval=0.3, **frame(9, gs=100, ias=120))
        published(d, 9)
        d.page.pump(0.5)
        t = tile()
        res.check(t["title"] == "IAS\n%s" % unit and t["value"] == str(pilot(120)),
                  "bottom tile IAS in %s" % unit, t)

        errs = d.js_errors()
        res.check(not errs, "no JS errors across the speed source run", errs[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
