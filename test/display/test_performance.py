"""The performance addon (#/addons/performance): horizontal G-meter KPIs from js/perfengine.js
and settings/performance.json (docs/performance/implementation.md).

Before any flight every KPI reads -- with the reason (WAIT LEVEL, NO RPM...). The live
streams reach the engine (the situation and EMS frames the server pushes). Then a synthetic
flight is fed straight into the engine, a second per sample but all at once, and the page must
show: level flight exactly on the trained models = CRUISE and ATTITUDE 100 in green boxes and
an OVERALL; the same RPM 15 % slower = CRUISE about 85 in a yellow box; a 90 °C EGT spread =
FUEL red; an "ems" indicator showing the KPI another process posts, NO DATA once its heartbeat
stops. The rows stay on the glass (inside the circle on the round 480x480 panel) and there is
no JS error. Screenshots go to shots/performance_*.png.
The addon is not in the fixture's /addons: the suite adds it.
"""

import json
import math
import os
import sys
import time

import keypadtest as kt
from plates import Result

READY = "[ui-view] .addonPerfView .addonPerfRow"
ADDON = {"controller": "PerformanceCtrl", "hash": "/addons/performance", "html": "addons/performance.html",
         "js": "addons/js/performance.js", "name": "performance"}
CONFIG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "web", "RB-01", "settings",
                                     "performance.json")))
KPIS = "angular.element(document.querySelector('[ui-view] .addonPerfView')).scope().kpis"
BOXES = """[...document.querySelectorAll('[ui-view] .addonPerfRow, [ui-view] .addonPerfScale, [ui-view] .addonPerfFootnote')]
           .map(e => { const b = e.getBoundingClientRect();
                       return {c: e.className, l: b.left, r: b.right, top: b.top, bottom: b.bottom}; })"""
GREEN_BOX, YELLOW_BOX, RED_BOX = "#00aa00", "#aaaa00", "#aa0000"

# A synthetic flight: level at 3000 ft, ISA, 2200 rpm, the IAS and pitch the trained models
# expect scaled by cruise (speed) and extraPitch (deg). Fed into the engine with times ending now.
FLY = """(function (spec) {
    const svc = window.performanceService;
    if (spec.config) svc.start(spec.config, 'test');
    const e = svc.engine;
    const ind = {}; e.config.indicators.forEach(i => ind[i.id] = i);
    const pa = 3000, rpm = spec.rpm || 2200;
    const sigma = perfDensityRatio(pa, perfIsaTempC(pa));
    const tas = perfModelEval(ind.cruise.model, {rpm: rpm, vsFpm: 0}).value * (spec.cruise || 1);
    const ias = tas * Math.sqrt(sigma);
    const inv = (100 / ias) * (100 / ias);
    const pitch = perfModelEval(ind.attitude.model, {invEas2: inv}).value + (spec.extraPitch || 0);
    const now = Date.now() / 1000, n = spec.seconds || 120;
    for (let i = 0; i < n; i++) {
        const ems = Object.assign({}, spec.ems || {});
        if (spec.beat) ems[spec.beat] = i;     // a heartbeat that keeps counting
        e.observe({
            t: now - n + i + 1, iasKt: ias, gsKt: tas, trackDeg: 90, windValid: false,
            pitchDeg: pitch, rollDeg: 1, gload: 1.0, vsFpm: (i % 2 ? 20 : -20), pressureAltFt: pa,
            oatC: perfIsaTempC(pa) + (spec.isaDev || 0), rpm: rpm + (i % 2 ? 3 : -3),
            mapInHg: null, fuelPressure: null, fuelFlow: null,
            egt: spec.egt || [700, 710, 705], cht: [150, 150, 150],
            icingCarb: 0, icingAirframe: 0, ems: ems
        });
    }
    return e.kpis(now).map(k => [k.id, k.value === null ? null : Math.round(k.value), k.status]);
})(SPEC)"""


def setup(d):
    d.srv.rest["/addons"] = d.srv.rest["/addons"] + [ADDON]


def ready(d):
    d.page.wait("""(() => { const i = angular.element(document.body).injector();
                            return !!i && !!i.get('$state').get('performance')
                                && !!window.performanceService && window.performanceService.ready; })()""",
                timeout=15, label="addon")
    kt.route(d, "addons/performance", READY)


def fly(d, **spec):
    out = d.page.eval(FLY.replace("SPEC", json.dumps(spec)))
    d.page.pump(1.3)   # the page renders once a second
    return {k[0]: k for k in out}


def rows(d):
    return {k["id"]: k for k in d.page.eval(KPIS)}


def check_glass(d, res, width, height):
    off = []
    for b in d.page.eval(BOXES):
        corners = [(x, y) for x in (b["l"], b["r"]) for y in (b["top"], b["bottom"])]
        if width == height:
            if any(math.hypot(x - width / 2, y - height / 2) > kt.ROUND_RADIUS + 1 for x, y in corners):
                off.append((b["c"][:20], round(b["l"]), round(b["top"]), round(b["r"]), round(b["bottom"])))
        elif b["top"] < 0 or b["bottom"] > height + 1 or b["l"] < 0 or b["r"] > width + 1:
            off.append((b["c"][:20], round(b["l"]), round(b["top"]), round(b["r"]), round(b["bottom"])))
    res.check(not off, "performance %dx%d: every row is on the glass" % (width, height), off[:4])


def main():
    res = Result()
    d = kt.boot((1024, 600), setup)
    try:
        ready(d)
        r = rows(d)
        ids = [k["id"] for k in d.page.eval(KPIS)]
        want = ["overall"] + [i["id"] for i in CONFIG["indicators"]]
        res.check(ids == want, "one row per indicator of performance.json, OVERALL first", ids)
        res.check(all(not k["valid"] and k["text"] == "--" for k in r.values()),
                  "before any flight every KPI reads --", [(k["id"], k["text"]) for k in r.values()])
        src = d.page.eval("window.performanceService.source")
        res.check(src is not None and src.endswith("settings/performance.json"),
                  "performance.json loaded", src)
        d.shot("performance_waiting")

        # The live streams reach the engine: RPM from the EMS stream, the situation once a second
        t0 = d.page.eval("window.performanceService.engine.lastT || 0")
        for _ in range(8):
            d.srv.push("/ems", {"enginerpm": 2200, "outsidetemperature": 9})
            d.srv.push_situation(IndicatedAirSpeed=140, BaroPressureAltitude=3000, BaroVerticalSpeed=0,
                                 AHRSPitch=-4.0, AHRSRoll=1.0, AHRSGLoad=1.0, GPSGroundSpeed=145)
            time.sleep(0.35)
        d.page.pump(1.2)
        t1 = d.page.eval("window.performanceService.engine.lastT || 0")
        rpm = d.page.eval("window.performanceService.lastEms.enginerpm")
        r = rows(d)
        res.check(t1 > t0 and rpm == 2200, "the situation and EMS streams feed the engine", [t0, t1, rpm])
        res.check(r["cruise"]["note"] == "WAIT LEVEL" and r["climb"]["note"] == "WAIT CLIMB"
                  and r["engine"]["note"] == "WAIT CLIMB" and r["icing"]["note"] == "NO DATA"
                  and not r["cruise"]["valid"],
                  "airborne, not steady yet: the rows say what they wait for", [(k["id"], k["note"]) for k in r.values()])
        res.check(r["density"]["valid"] and 95 <= int(r["density"]["text"]) <= 105,
                  "OAT 9 °C at 3000 ft (about ISA): DENSITY about 100", r["density"])

        k = fly(d, config=CONFIG)
        r = rows(d)
        res.check(k["cruise"][1] == 100 and k["attitude"][1] == 100,
                  "level flight on the trained models: CRUISE and ATTITUDE 100", [k["cruise"], k["attitude"]])
        res.check(r["cruise"]["box"] == GREEN_BOX and r["attitude"]["box"] == GREEN_BOX and r["cruise"]["valid"],
                  "... in green boxes", [r["cruise"]["box"], r["attitude"]["box"]])
        res.check(r["overall"]["valid"] and 95 <= int(r["overall"]["text"]) <= 101,
                  "OVERALL from the valid KPIs", r["overall"])
        res.check(abs(r["cruise"]["left"] - (100 - 50) / 80 * 100) < 0.5,
                  "the needle sits on the 100 % line", r["cruise"]["left"])
        res.check(r["climb"]["note"] == "WAIT CLIMB" and not r["climb"]["valid"],
                  "no climb flown: CLIMB still waits", r["climb"])
        d.shot("performance_nominal")

        k = fly(d, config=CONFIG, cruise=0.85)
        r = rows(d)
        res.check(83 <= k["cruise"][1] <= 87 and r["cruise"]["box"] == YELLOW_BOX,
                  "15 % slower at the same RPM: CRUISE about 85, yellow", [k["cruise"], r["cruise"]["box"]])
        res.check("kt TAS" in r["cruise"]["note"], "the row says the speeds it compared", r["cruise"]["note"])

        k = fly(d, config=CONFIG, extraPitch=1.0, egt=[640, 730, 700])
        r = rows(d)
        res.check(k["attitude"][1] is not None and k["attitude"][1] < 90,
                  "1 deg more pitch for the same speed: ATTITUDE below 90 (more lift needed)", k["attitude"])
        res.check(r["fuel"]["box"] == RED_BOX and k["fuel"][1] < 70,
                  "a 90 °C EGT spread: FUEL red", [k["fuel"], r["fuel"]["box"]])
        d.shot("performance_degraded")

        # A closed-source algorithm: its own process posts perf_pro and a heartbeat on the EMS stream
        pro = json.loads(json.dumps(CONFIG))
        pro["indicators"].append({"id": "pro", "label": "PRO", "algorithm": "ems", "source": "perf_pro",
                                  "heartbeat": "perf_pro_hb", "staleS": 10})
        k = fly(d, config=pro, seconds=30, ems={"perf_pro": 93.4}, beat="perf_pro_hb")
        res.check(k["pro"][1] == 93, "an \"ems\" indicator shows the posted KPI", k["pro"])
        k = fly(d, seconds=30, ems={"perf_pro": 93.4, "perf_pro_hb": 1})
        res.check(k["pro"][1] is None and k["pro"][2] == "NO DATA",
                  "heartbeat stuck for 30 s: NO DATA", k["pro"])
        pro["indicators"].append({"id": "missing", "label": "MISSING", "algorithm": "not-installed"})
        k = fly(d, config=pro, seconds=5)
        res.check(k["missing"][2] == "NO ALGORITHM", "an algorithm that is not installed: NO ALGORITHM", k["missing"])
        errs = kt.errors(d, "performance")
        res.check(not errs, "no JS error", errs[:3])
    finally:
        kt.close(d)

    for width, height in kt.PANELS:
        d = kt.boot((width, height), setup)
        try:
            ready(d)
            fly(d, config=CONFIG, cruise=0.93, egt=[690, 720, 700])
            check_glass(d, res, width, height)
            d.shot("performance_%dx%d" % (width, height))
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
