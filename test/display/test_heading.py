"""The heading plate: a magnetic card with every heading source on it, the variation and the wind.

plates/heading.html with SixPackInstrumentHeading (plates/js/SixPackInstruments.js):
- the card follows the selected source (GPS > GYRO > MAG, test_keypad_heading.py
  covers the cycling) and is magnetic: GPSTrueCourse and AHRSGyroHeading are
  true and get MagneticVariation (East positive) taken off, AHRSMagHeading is
  already magnetic. Without a variation the card is true and the plate says so.
- a mark for each source at its own value on the card: MAG white and GYRO cyan
  on the rim, the GPS track a magenta diamond inside it, hidden below 5 kt;
  an invalid source hides its mark.
- the wind arrow on the rim where the wind comes from, pointing in, the wind
  magnetic in the readout, with head/tail and cross components against the nose.

The frames go straight into the plate's updateSituation with the live feed
unhooked, so servicesituation.js (the wind estimator, the variation grid) is not
in the way: those have their own tests (test_wind.py, test_variation.py).
"""

import json
import sys

from plates import Display, Result

ROOT = "[ui-view] .gyro"
INVALID = 3276.7   # ahrs.Invalid, AHRS_INVALID in global.js

HOOK = """(function(){
  var s = angular.element(document.querySelector('%s')).scope();
  if (!s.__feed) { s.__feed = s.updateSituation; s.updateSituation = function(){}; }
  return true;
})()""" % ROOT

STATE = """(function(){
  var s = angular.element(document.querySelector('%s')).scope();
  var sit = %%s;
  s.Heading.sourceName = %%s;
  s.__feed(sit);
  s.$apply();
  function angle(sel) {
    var e = document.querySelector('[ui-view] ' + sel);
    return e ? parseFloat(e.style.transform.replace(/[^-0-9.]/g, '')) : null;
  }
  function shown(sel) {
    var e = document.querySelector('[ui-view] ' + sel);
    return !!e && !e.classList.contains('ng-hide');
  }
  function text(sel) {
    var e = document.querySelector('[ui-view] ' + sel);
    return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null;
  }
  return JSON.stringify({
    card: angle('.gyrobearing'),
    mag: angle('.gyro-mark-mag'), magShown: shown('.gyro-mark-mag'),
    gyro: angle('.gyro-mark-gyro'), gyroShown: shown('.gyro-mark-gyro'),
    trk: angle('.gyro-mark-trk'), trkShown: shown('.gyro-mark-trk'),
    wind: angle('.gyro-mark-wind'), windShown: shown('.gyro-mark-wind'),
    readout: text('.gyroheading-track'), source: text('.gyroheading-source'),
    variation: text('.gyroheading-variation'),
    windText: text('.gyroheading-wind'), windTextShown: shown('.gyroheading-wind'),
    est: shown('.gyroheading-est'),
    comp: text('.gyroheading-windcomp')
  });
})()""" % ROOT


def situation(**over):
    """Level flight at 100 kt: compass 100 magnetic, gyro and track 103 true,
    variation 3 E, wind from 40 true at 20 kt (the estimator's output)."""
    s = {"GPSFixQuality": 2, "GPSGroundSpeed": 100.0, "GPSTrueCourse": 103.0,
         "AHRSGyroHeading": 103.0, "AHRSMagHeading": 100.0,
         "MagneticVariation": 3.0, "MagneticVariationValid": True,
         "WindValid": False, "WindSpeed": 0.0, "WindDirection": 0.0, "WindSource": "tas"}
    s.update(over)
    return s


def state(d, source, **over):
    return json.loads(d.page.eval(STATE % (json.dumps(situation(**over)), json.dumps(source))))


def near(a, b, tol=0.15):
    return a is not None and abs(((a - b + 540) % 360) - 180) <= tol


# Covers: RB-HLR-HDG-010, RB-HLR-HDG-040
def check_sources(d, res):
    """The card follows the selected source, says which, and is magnetic."""
    # MAG primary: card on the compass, the true sources 3 degrees back
    s = state(d, "MAG")
    res.check(near(s["card"], -100) and s["readout"] == "100°" and s["source"] == "MAG",
              "MAG turns the card to the compass", (s["card"], s["readout"], s["source"]))
    res.check(near(s["mag"], 0) and near(s["gyro"], 0) and near(s["trk"], 0)
              and s["magShown"] and s["gyroShown"] and s["trkShown"],
              "gyro and track 103 true sit on 100 magnetic with 3 E",
              (s["mag"], s["gyro"], s["trk"]))
    res.check(s["variation"] == "VAR 3°E", "the variation reads East", s["variation"])

    # Each mark at its own value, the shortest way round across north
    s = state(d, "GYRO", AHRSGyroHeading=2.0, AHRSMagHeading=350.0, GPSTrueCourse=13.0)
    res.check(near(s["card"], -359) and s["readout"] == "359°",
              "GYRO 002 true reads 359 magnetic", (s["card"], s["readout"]))
    res.check(near(s["mag"], -9) and near(s["trk"], 11) and near(s["gyro"], 0),
              "MAG 9 left and TRK 11 right of the gyro across north",
              (s["mag"], s["gyro"], s["trk"]))
    res.check(near(s["mag"] % 360, 351) and near((s["trk"] + 359) % 360, 10),
              "every mark lands on its own card value", (s["mag"], s["trk"]))

    # West variation, GPS primary
    s = state(d, "GPS", MagneticVariation=-2.4, GPSTrueCourse=88.0)
    res.check(s["readout"] == "090°" and s["variation"] == "VAR 2°W" and s["source"] == "GPS",
              "GPS 088 true with 2.4 W reads 090", (s["readout"], s["variation"]))

    # No variation: one true card, said so
    s = state(d, "MAG", MagneticVariationValid=False, MagneticVariation=0.0)
    res.check(near(s["gyro"], 3) and near(s["trk"], 3) and s["variation"] == "VAR --- TRUE",
              "outside the grid the card is true and says TRUE", (s["gyro"], s["variation"]))


# Covers: RB-HLR-HDG-020, RB-HLR-HDG-030
def check_invalid_sources(d, res):
    """A source that has nothing to say loses its mark; a selected one reads ---."""
    # Invalid sources lose their mark; the primary says --- and holds the card
    s = state(d, "MAG", AHRSMagHeading=INVALID)
    res.check(not s["magShown"] and s["gyroShown"] and s["readout"] == "---°",
              "no magnetometer: no MAG mark, MAG primary reads ---", (s["magShown"], s["readout"]))
    s = state(d, "GYRO", AHRSGyroHeading=INVALID)
    res.check(not s["gyroShown"] and s["magShown"], "no gyro: no GYRO mark", s["gyroShown"])
    s = state(d, "MAG", GPSGroundSpeed=3.0)
    res.check(not s["trkShown"], "below 5 kt there is no track diamond", s["trkShown"])
    s = state(d, "GPS", GPSFixQuality=0)
    res.check(s["source"] == "GYRO" and not s["trkShown"], "no fix: GPS gives way to the gyro",
              (s["source"], s["trkShown"]))
    s = state(d, "GPS", GPSGroundSpeed=3.0)
    res.check(s["readout"] == "---°" and s["source"] == "GPS",
              "GPS primary below 5 kt reads ---", (s["source"], s["readout"]))


def main():
    res = Result()
    with Display() as d:
        # The windestimator would keep its own wind; aircraft.json units: km/h
        d.show("heading", ROOT)
        d.page.eval(HOOK)
        unit = d.page.eval("window.aircraftData?.units?.speed ?? 'KMH'")
        kmh = d.page.eval("pilotDisplayedSpeedFromKT(1)")

        check_sources(d, res)
        check_invalid_sources(d, res)

        # Wind: from 40 true = 37 magnetic, nose 100 magnetic
        state(d, "MAG")   # WindValid false resets the damping: the next one is exact
        s = state(d, "MAG", WindValid=True, WindSpeed=20.0, WindDirection=40.0)
        head = round(20 * kmh * 0.4539905)    # cos(63)
        cross = round(20 * kmh * 0.8910065)   # sin(63), from the left
        res.check(s["windShown"] and near(s["wind"], 37 - 100),
                  "the wind arrow sits on 037 on the card", s["wind"])
        res.check(s["windTextShown"] and s["windText"].startswith("WIND 037°/%d %s" % (round(20 * kmh), unit))
                  and not s["est"], "the wind reads magnetic in the pilot's unit", s["windText"])
        res.check(s["comp"] == "▼%d ▶%d" % (head, cross),
                  "headwind and a crosswind from the left", s["comp"])
        s = state(d, "MAG", WindValid=True, WindSpeed=20.0, WindDirection=40.0, WindSource="gs")
        res.check(s["est"], "a drift-only wind is tagged EST", s["windText"])
        state(d, "MAG")
        s = state(d, "MAG", WindValid=True, WindSpeed=10.0, WindDirection=283.0)
        res.check(s["comp"].startswith("▲") and s["comp"].endswith(" 0"),
                  "a wind on the tail is a tailwind", s["comp"])
        s = state(d, "MAG")
        res.check(not s["windShown"] and not s["windTextShown"], "no wind, no arrow and no readout",
                  (s["windShown"], s["windTextShown"]))

        # Pictures for a look at the layout, wide and on the round panel. The
        # touch zones fade out over 10 s; the pictures skip that
        for w, h in ((1024, 768), (480, 480), (320, 320)):
            d.page.send("Emulation.setDeviceMetricsOverride", width=w, height=h,
                        deviceScaleFactor=1, mobile=False)
            d.page.goto(d.srv.url + "/RB-01/index.html#/heading")
            d.page.wait("!!document.querySelector(%r)" % ROOT, timeout=25, label="heading root")
            d.page.pump(0.6)
            d.page.eval(HOOK)
            d.page.eval("""(function(){var st=document.createElement('style');
              st.textContent='.fabNavigation{animation:none!important;background:transparent!important;border:none!important}';
              document.head.appendChild(st);})()""")
            state(d, "MAG", AHRSMagHeading=95.0, GPSTrueCourse=110.0, AHRSGyroHeading=101.0,
                  WindValid=True, WindSpeed=18.0, WindDirection=40.0)
            d.page.pump(0.3)
            d.shot("heading_%dx%d" % (w, h))

        errs = d.js_errors()
        res.check(not errs, "no JS error", errs[:3])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
