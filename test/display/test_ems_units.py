"""Are the EMS temperatures shown in the unit the pilot picked in aircraft.json?

The daemon publishes what the probe reports and ems.json authors its gauge
scales to match, both in degrees C (main/ems.go). aircraft.json carries the
pilot's temperature unit, so the EMS screens convert: js/global.js owns the
conversion, and emsApplyPilotUnits moves the whole dial - scale, tick labels
and arc thresholds - so the needle and the colours go on agreeing with the
number. Pressures, volts, litres and rpm must not be touched.

The device fixture is a degrees F aircraft, so the shipped path under test here
is the converted one; the last case flips the unit at runtime, the way the
settings addon does.
"""


import json
import sys

from plates import Display, Result


def to_f(c):
    return c * 1.8 + 32


# The fixture's OIL TEMP gauge, in the degrees C ems.json stores
OIL_MIN_C, OIL_MAX_C = 30, 120
OIL_THRESHOLDS_C = [0, 60, 90, 110]


def widgets(d):
    """MainCtrl's EMS widgets: exactly the objects ems.html binds."""
    return json.loads(d.page.eval(
        "JSON.stringify((angular.element(document.body).scope().EMS || []).map(function(w){"
        "return {label: w.label, source: w.source, unit: w.unit,"
        " min: w.minSpeed, max: w.maxSpeed, speed: w.speed, degree: w.speedDegree,"
        " thresholds: (w.arcs || []).map(function(a){return a.threshold;}),"
        " ticks: (w.speedTicks || []).map(function(t){return t.speed;}),"
        " sidebar: !!w.displayInSidebar};}))"))


def widget(d, label, sidebar=False):
    for w in widgets(d):
        if w["label"] == label and w["sidebar"] == sidebar:
            return w
    return None


def rendered(d, label):
    """What the routed EMS page actually puts on screen for one gauge."""
    return json.loads(d.page.eval("""
        JSON.stringify((function () {
            var out = null;
            document.querySelectorAll('[ui-view] .ems_intrument').forEach(function (el) {
                var l = el.querySelector('.speed-label');
                if (!l || l.textContent.trim() !== %s) {
                    return;
                }
                var u = el.querySelector('.speed-unit');
                var v = el.querySelector('.speed-value');
                var bg = el.querySelector('.speed-round-background');
                out = {
                    unit: u ? u.textContent.trim() : null,
                    value: v ? v.textContent.trim() : null,
                    background: bg ? getComputedStyle(bg).backgroundColor : null,
                    ticks: Array.from(el.querySelectorAll('.speed-number'))
                        .map(function (e) { return e.textContent.trim(); })
                };
            });
            return out;
        })())""" % json.dumps(label)))


def push_ems(d, **values):
    """One EMS frame, then let the 300 ms merge window in serviceems.js close."""
    d.srv.push("/ems", values)
    d.page.pump(0.9)


def main():
    res = Result()
    with Display() as d:
        d.page.wait("window.aircraftData && window.aircraftData.units", timeout=15,
                    label="aircraft profile loaded")
        d.page.wait("(angular.element(document.body).scope().EMS || []).length > 0",
                    timeout=15, label="EMS widgets loaded")
        unit = d.page.eval("window.aircraftData.units.temperatures")
        res.check(unit == "°F", "the fixture aircraft is in °F", unit)

        d.show("ems", "[ui-view] .ems_intrument")

        # -- the dial moves to the pilot's unit, all of it -------------------
        oil = widget(d, "OIL TEMP")
        res.check(oil is not None, "the EMS page has an OIL TEMP gauge")
        res.check(oil and oil["unit"] == "°F", "gauge relabelled °F",
                  oil and oil["unit"])
        res.check(oil and abs(oil["min"] - to_f(OIL_MIN_C)) < 1e-6
                  and abs(oil["max"] - to_f(OIL_MAX_C)) < 1e-6,
                  "scale converted to %g..%g" % (to_f(OIL_MIN_C), to_f(OIL_MAX_C)),
                  oil and (oil["min"], oil["max"]))
        want = [to_f(t) for t in OIL_THRESHOLDS_C]
        res.check(oil and len(oil["thresholds"]) == len(want)
                  and all(abs(a - b) < 1e-6 for a, b in zip(oil["thresholds"], want)),
                  "arc thresholds converted to %s" % want, oil and oil["thresholds"])
        res.check(oil and oil["ticks"] and abs(float(oil["ticks"][0]) - to_f(OIL_MIN_C)) < 0.5
                  and abs(float(oil["ticks"][-1]) - to_f(OIL_MAX_C)) < 0.5,
                  "tick labels run %g..%g" % (to_f(OIL_MIN_C), to_f(OIL_MAX_C)),
                  oil and (oil["ticks"][:1] + oil["ticks"][-1:]))

        # -- a reading, converted, and the needle still where C put it -------
        push_ems(d, oiltemperature=100, oilpressure=45, enginerpm=2400)
        oil = widget(d, "OIL TEMP")
        res.check(oil and oil["speed"] == 212, "100 °C shown as 212", oil and oil["speed"])
        dom = rendered(d, "OIL TEMP")
        res.check(dom and dom["value"] == "212" and dom["unit"] == "°F",
                  "the page renders 212 °F", dom and (dom["value"], dom["unit"]))
        # The conversion is affine, so the needle must sit at the same fraction
        # of the sweep as the degrees C dial had it.
        fraction = (100 - OIL_MIN_C) / float(OIL_MAX_C - OIL_MIN_C)
        in_f = (oil["speed"] - oil["min"]) / float(oil["max"] - oil["min"])
        res.check(abs(in_f - fraction) < 0.01, "needle unmoved by the relabelling",
                  "%.4f vs %.4f" % (in_f, fraction))

        # -- everything that is not a temperature is left alone --------------
        pres = widget(d, "OIL PRES")
        res.check(pres and pres["unit"] == "PSI" and pres["min"] == 0 and pres["max"] == 135,
                  "the pressure gauge keeps its unit and scale",
                  pres and (pres["unit"], pres["min"], pres["max"]))
        res.check(pres and pres["speed"] == 45, "pressure shown as the probe reports it",
                  pres and pres["speed"])
        rpm = widget(d, "RPM")
        res.check(rpm and rpm["unit"] == "100rpm" and rpm["speed"] == 2400,
                  "rpm untouched", rpm and (rpm["unit"], rpm["speed"]))

        # -- the colours still change at the same temperature ---------------
        push_ems(d, oiltemperature=89)
        below = rendered(d, "OIL TEMP")
        push_ems(d, oiltemperature=91)
        above = rendered(d, "OIL TEMP")
        res.check(below and above and below["background"] != above["background"],
                  "the 90 °C arc still trips between 89 and 91 °C",
                  (below and below["background"], above and above["background"]))

        # -- the sidebar draws the same widgets ------------------------------
        side = widget(d, "OIL TEMP", sidebar=True)
        res.check(side and side["unit"] == "°F" and side["speed"] == int(to_f(91)),
                  "the sidebar gauge is converted too", side and (side["unit"], side["speed"]))

        # -- the EGT page ----------------------------------------------------
        d.show("emsegt", ".emsegt, [ui-view]")
        push_ems(d, cht1=100, egt1=700, oiltemperature=95, outsidetemperature=20)
        bars = json.loads(d.page.eval(
            "JSON.stringify((function(){var s = angular.element("
            "document.querySelector('[ui-view]')).scope();"
            "return {bars: (s.bars || []).map(function(b){return {name: b.name, format: b.format};}),"
            " oil: s.oilTemperature, out: s.outsideTemperature};})())"))
        cht1 = [b for b in bars["bars"] if b["name"] == "Cht1"]
        egt1 = [b for b in bars["bars"] if b["name"] == "Egt1"]
        res.check(cht1 and cht1[0]["format"] == "212°", "CHT1 bar reads 212°",
                  cht1 and cht1[0]["format"])
        res.check(egt1 and egt1[0]["format"] == "1292°", "EGT1 bar reads 1292°",
                  egt1 and egt1[0]["format"])
        res.check(bars["oil"] == 203, "EGT page oil temperature is 203 °F", bars["oil"])
        res.check(bars["out"] == 68, "EGT page outside temperature is 68 °F", bars["out"])

        # -- a unit change while the page is open ----------------------------
        d.show("ems", "[ui-view] .ems_intrument")
        d.page.eval("(function(){var u = window.aircraftData.units;"
                    " u.temperatures = '°C';"
                    " u.temperatureConversionFromC = {multiply: 1, sum: 0};})()")
        push_ems(d, oiltemperature=100)
        oil = widget(d, "OIL TEMP")
        res.check(oil and oil["unit"] == "°C" and oil["speed"] == 100,
                  "switching to °C relabels and rescales live",
                  oil and (oil["unit"], oil["speed"]))
        res.check(oil and abs(oil["min"] - OIL_MIN_C) < 1e-6
                  and abs(oil["max"] - OIL_MAX_C) < 1e-6,
                  "the scale is back on the ems.json degrees C, not converted twice",
                  oil and (oil["min"], oil["max"]))
        want = OIL_THRESHOLDS_C
        res.check(oil and all(abs(a - b) < 1e-6 for a, b in zip(oil["thresholds"], want)),
                  "thresholds back to %s" % want, oil and oil["thresholds"])

        # A factor typed in under an unchanged label must redraw too: the guard
        # keys on the conversion, not on the label.
        d.page.eval("(function(){var u = window.aircraftData.units;"
                    " u.temperatureConversionFromC = {multiply: 1, sum: 273.15};})()")
        push_ems(d, oiltemperature=100)
        oil = widget(d, "OIL TEMP")
        res.check(oil and oil["speed"] == 373
                  and abs(oil["min"] - (OIL_MIN_C + 273.15)) < 1e-6,
                  "a factor change under the same label redraws the dial",
                  oil and (oil["speed"], oil["min"]))

        errs = d.js_errors()
        res.check(not errs, "no JS errors across the EMS unit run", errs[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
