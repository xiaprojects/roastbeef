"""The air quality addon (#/addons/airquality): six G-meter style gauges (AQI, eCO2, TVOC, RH,
carburettor icing, airframe icing).

Drives the situation through each state the page draws (no sensor, warm-up, clean, yellow,
red and off-scale, stale), pushes the icing probes of main/icing.go on the EMS stream
(severe, low power, withdrawn) and checks the values, the value box coloured by the band of the
rule in settings/rbvoice-aircraft-rules.json (the file the daemon alarms on), the arcs drawn
from those same bands, that the dials and the footnote stay on the glass (inside the circle on
the round 480x480 panel, inside the plate elsewhere) and that there is no JS error.
Screenshots go to shots/airquality_*.png.
The addon is not in the fixture's /addons: the suite adds it.
"""

import json
import math
import os
import sys
import time

import keypadtest as kt
from plates import Result

READY = "[ui-view] .addonAqView .speed"
ADDON = {"controller": "AirqualityCtrl", "hash": "/addons/airquality", "html": "addons/airquality.html",
         "js": "addons/js/airquality.js", "name": "airquality"}

GAUGES = "angular.element(document.querySelector('[ui-view] .addonAqView')).scope().gauges"
DIALS = """[...document.querySelectorAll('[ui-view] .addonAqView .speed, [ui-view] .addonAqFootnote')]
           .map(e => { const b = e.getBoundingClientRect();
                       return {c: e.className, l: b.left, r: b.right, top: b.top, bottom: b.bottom}; })"""
RULES = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "web", "settings",
                                    "rbvoice-aircraft-rules.json")))["rules"]
YELLOW_BOX, RED_BOX, BLACK = "#aaaa00", "#aa0000", "#000000"

NO_SENSOR = dict(AirQualityIndex=0, AirQualityTVOC=0, AirQualityECO2=0, AirQualityValidity="",
                 AirQualityLastMeasurementTime="0001-01-01T00:00:00Z", BaroHumidity=0)
CABIN = dict(BaroHumidity=46.0, BaroTemperature=22.4, BaroLastMeasurementTime="0001-01-01T00:20:00Z")


def setup(d):
    d.srv.rest["/addons"] = d.srv.rest["/addons"] + [ADDON]
    d.srv.situation.update(NO_SENSOR)


def ready(d):
    d.page.wait("""(() => { const i = angular.element(document.body).injector();
                            return !!i && !!i.get('$state').get('airquality'); })()""", timeout=15, label="addon")
    kt.route(d, "addons/airquality", READY)


SEQ = [0]


def sample(d, index, eco2, tvoc, validity="normal", **extra):
    """Push a fresh ENS160 sample (a new LastMeasurementTime each time)."""
    SEQ[0] += 1
    # servicesituation.js publishes at most one frame a second when attitude and altitude
    # hold still and drops the rest; the daemon streams several a second, so resend like it.
    for _ in range(6):
        d.srv.push_situation(AirQualityIndex=index, AirQualityECO2=eco2, AirQualityTVOC=tvoc,
                             AirQualityValidity=validity,
                             AirQualityLastMeasurementTime="0001-01-01T00:30:%02d.5Z" % (SEQ[0] % 60), **extra)
        time.sleep(0.3)
    d.page.wait("angular.element(document.querySelector('[ui-view] .addonAqView')).scope().gauges[0].speed == '%s'"
                % (index if validity != "invalid" else "--"), timeout=6, label="sample %d" % index)
    d.page.pump(0.3)


def ems(d, frame, key, want):
    """Push one EMS frame (the daemon's whole map) and wait for gauge key to read want."""
    for _ in range(3):
        d.srv.push("/ems", frame)
        time.sleep(0.4)
    d.page.wait("angular.element(document.querySelector('[ui-view] .addonAqView')).scope().gauges"
                ".find(g => g.key == '%s').speed == '%s'" % (key, want), timeout=6, label="ems %s" % key)
    d.page.pump(0.3)


def gauges(d):
    return {g["key"]: g for g in d.page.eval(GAUGES)}


def check_glass(d, res, label, width, height):
    """Each dial (a circle) and the footnote inside the round glass, or inside the plate."""
    off = []
    for b in d.page.eval(DIALS):
        if width == height and "speed" in b["c"]:
            cx, cy, r = (b["l"] + b["r"]) / 2, (b["top"] + b["bottom"]) / 2, (b["r"] - b["l"]) / 2
            if math.hypot(cx - width / 2, cy - height / 2) + r > kt.ROUND_RADIUS + 1:
                off.append(("dial", round(cx), round(cy), round(r)))
        elif width == height:
            for x in (b["l"], b["r"]):
                for y in (b["top"], b["bottom"]):
                    if math.hypot(x - width / 2, y - height / 2) > kt.ROUND_RADIUS:
                        off.append(("footnote", round(x), round(y)))
        elif b["top"] < 0 or b["bottom"] > height + 1 or b["l"] < 0 or b["r"] > width + 1:
            off.append((b["c"], round(b["l"]), round(b["top"]), round(b["r"]), round(b["bottom"])))
    res.check(not off, "%s %dx%d: every dial is on the glass" % (label, width, height), off[:4])


def main():
    res = Result()
    d = kt.boot((1024, 600), setup)
    try:
        ready(d)
        g = gauges(d)
        res.check(all(g[k]["unit"] == "NO DATA" and g[k]["speed"] == "--" and g[k]["opacity"] == 0.35
                      for k in ("carb", "airframe")),
                  "no OAT or humidity: both icing gauges read NO DATA, dimmed", [g["carb"], g["airframe"]])
        res.check(all(g[k]["speed"] == "--" for k in ("aqi", "eco2", "tvoc", "rh"))
                  and g["aqi"]["unit"] == "NO SENSOR" and not g["aqi"]["valid"],
                  "no sensor: every value reads -- and AQI says NO SENSOR", g["aqi"])
        d.shot("airquality_none")

        # The arcs are the rule's bands: CABINAIR yellow 3.5..4.5 on the 1..5 dial of 280 degrees
        aqi_rule = [r for r in RULES if r["name"] == "CABINAIR"][0]
        yellow = [b for b in aqi_rule["colors"] if b["color"] == "yellow"][0]
        want = -140 + (yellow["min"] - 1) / 4 * 280
        arcs = g["aqi"]["arcs"]
        res.check(len(arcs) == 3 and any(a["color"] == "#ffff00" and abs(float(a["startDegree"][:-3]) - want) < 0.01
                                         for a in arcs),
                  "the AQI arcs are the CABINAIR bands (yellow from %.1f deg)" % want, arcs)

        sample(d, 2, 640, 120, "warm-up", **CABIN)
        g = gauges(d)
        res.check(g["aqi"]["speed"] == "2" and g["aqi"]["unit"] == "WARM-UP" and g["eco2"]["speed"] == "640"
                  and g["tvoc"]["speed"] == "120", "warm-up: values shown, AQI says WARM-UP", g["aqi"])
        res.check(all(g[k]["backgroundColor"] == BLACK for k in ("aqi", "eco2", "tvoc")) and g["aqi"]["opacity"] == 0.6,
                  "warm-up: dimmed, no band colour (the daemon does not alarm yet)",
                  [g[k]["backgroundColor"] for k in g])
        # The fixture's aircraft profile is in Fahrenheit: 22.4 C is 72 F.
        res.check(g["rh"]["speed"] == "46" and g["rh"]["unit"] == "% 72°F" and g["rh"]["backgroundColor"] == BLACK,
                  "cabin: 46 %, 72 °F, green", g["rh"])
        d.shot("airquality_warmup")

        sample(d, 1, 450, 25)
        g = gauges(d)
        res.check(g["aqi"]["unit"] == "EXCELLENT" and g["aqi"]["opacity"] == 1
                  and all(g[k]["backgroundColor"] == BLACK for k in ("aqi", "eco2", "tvoc")),
                  "normal and clean: EXCELLENT, black boxes", g["aqi"])
        res.check(g["aqi"]["speedDegree"] == "-50deg", "AQI 1 puts the needle at the scale start", g["aqi"]["speedDegree"])
        d.shot("airquality_excellent")

        sample(d, 4, 1250, 900)
        g = gauges(d)
        res.check(g["aqi"]["unit"] == "POOR" and all(g[k]["backgroundColor"] == YELLOW_BOX for k in ("aqi", "eco2", "tvoc")),
                  "AQI 4, 1250 ppm, 900 ppb: the three boxes yellow", [g[k]["backgroundColor"] for k in g])
        d.shot("airquality_poor")

        sample(d, 5, 3200, 8000, BaroHumidity=78.0)
        g = gauges(d)
        res.check(all(g[k]["backgroundColor"] == RED_BOX for k in ("aqi", "eco2", "tvoc"))
                  and g["eco2"]["speed"] == "3200" and g["eco2"]["speedDegree"] == "230deg",
                  "AQI 5, 3200 ppm, 8000 ppb: red boxes, the eCO2 needle pinned at the scale end", g["eco2"])
        res.check(g["rh"]["backgroundColor"] == YELLOW_BOX, "78 % humidity: yellow (the page's own bands)", g["rh"])
        d.shot("airquality_unhealthy")

        # Icing: cabin 20 °C 60 % (dew point 12 °C), OAT 15 °C: blue on the chart
        icing = {"dew_point": 12, "outside_humidity": 82, "icing_carb": 100,
                 "icing_airframe": 0}
        ems(d, icing, "carb", "100")
        g = gauges(d)
        res.check(g["carb"]["unit"] == "SEVERE" and g["carb"]["backgroundColor"] == RED_BOX and g["carb"]["valid"],
                  "carb icing 100 %: SEVERE, red (ICINGCARB)", g["carb"])
        res.check(g["airframe"]["speed"] == "0" and g["airframe"]["unit"] == "NONE"
                  and g["airframe"]["backgroundColor"] == BLACK,
                  "airframe 0 %: NONE, black box", g["airframe"])
        d.shot("airquality_icing_severe")

        icing.update(dew_point=-3, icing_carb=50, icing_airframe=40)
        ems(d, icing, "carb", "50")
        g = gauges(d)
        res.check(g["carb"]["unit"] == "LOW PWR" and g["carb"]["backgroundColor"] == YELLOW_BOX,
                  "carb icing 50 %: LOW PWR, yellow", g["carb"])
        res.check(g["airframe"]["speed"] == "40" and g["airframe"]["unit"] == "POSSIBLE"
                  and g["airframe"]["backgroundColor"] == YELLOW_BOX,
                  "airframe 40 %: POSSIBLE, yellow", g["airframe"])
        d.shot("airquality_icing_lowpower")

        # OAT lost: the daemon withdraws the outside probes
        ems(d, {"dew_point": -3}, "carb", "--")
        g = gauges(d)
        res.check(g["carb"]["unit"] == "NO DATA" and g["airframe"]["unit"] == "NO DATA",
                  "icing probes withdrawn: NO DATA", [g["carb"]["unit"], g["airframe"]["unit"]])

        time.sleep(11)
        d.page.pump(1.2)
        g = gauges(d)
        res.check(g["aqi"]["unit"] == "NO DATA" and g["aqi"]["speed"] == "--", "no new sample for 10 s: NO DATA", g["aqi"])
        d.shot("airquality_stale")
        errs = kt.errors(d, "airquality")
        res.check(not errs, "no JS error", errs[:3])
    finally:
        kt.close(d)

    for width, height in kt.PANELS:
        d = kt.boot((width, height), setup)
        try:
            ready(d)
            sample(d, 4, 1250, 450, **CABIN)
            ems(d, {"dew_point": 12, "icing_carb": 75, "icing_airframe": 40}, "carb", "75")
            check_glass(d, res, "airquality", width, height)
            d.shot("airquality_%dx%d" % (width, height))
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
