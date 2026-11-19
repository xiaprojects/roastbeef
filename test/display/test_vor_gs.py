"""The VOR plate's glide slope (RB-VOR-IF v2.4), on all five panels.

rb-vor, with gs.enabled, adds seven gs* fields. Two things are checked here:

The LOC / GS switch (section 2.5). With one dongle for the ILS (gsshared 1) the pilot
picks which half to receive: the switch posts gsselect 0 or 1 to the float bridge. It
exists only while gsshared is 1 and no VOR is tuned. With GS selected the localizer is
not received (locfreqactive 0): the plate shows the glide slope's own words and values,
never VOR OFF.

The glide-slope diamonds. Drawn ONLY while gsstatus >= 4 (false paths above the true
one, and a localizer may have no glide path at all), hidden otherwise, also in VOR mode.
gsdev > 0 = 150 Hz = below the path = fly up = diamond ABOVE centre. plates/js/hsi.js
moves the diamonds by -glideSlope * 25/3 viewbox units (the HSI root is 280 units wide), clamp +/-15, and the plate maps
gsdev 100 to 15: full scale is 125 units.

Frames go through the real bridge socket, as in test_vor_loc.py, whose helpers this uses.
"""

import json
import sys

from plates import Display, Result
from test_vor_loc import (PANELS, ROOT, SCOPE, SHOWS, FIXTURE, BAR, boot, corners_ok,
                          posted, vor)

SWITCH = "[ui-view] .addonVorGsSwitch"
FULL = 125.0               # gsdev 100, in viewbox units

DIAMOND = """(() => {
    const hsi = %s.HSI;
    if (!hsi) return null;
    const root = document.querySelector('#vorHSI').getBoundingClientRect();
    const scale = root.width / 280;
    return [...document.querySelectorAll('#vorHSI .hsi-gs-diamond')].map(p => {
        const r = p.getBoundingClientRect();
        return {drawn: !!hsi.showGs && r.width > 0 && r.height > 0,
                dy: ((r.top + r.height / 2) - (root.top + root.height / 2)) / scale};
    });
})()""" % SCOPE

# The two small "GS" labels: drawn only while a glide-slope signal is received
LABELS = """(() => {
    const hsi = %s.HSI;
    if (!hsi) return null;
    return {gsActive: hsi.gsActive,
            drawn: [...document.querySelectorAll('#vorHSI .hsi-gs-label')].map(e => {
                const r = e.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            })};
})()""" % SCOPE


def frame(d, **values):
    d.srv.push("/bridge/float/ws", values)
    for _ in range(20):
        d.page.pump(0.1)
        d.page.eval("%s.$apply()" % SCOPE)
        items = d.page.eval(SCOPE + ".items")
        if (items["gsfreqactive"] == values.get("gsfreqactive", 0)
                and items["locfreqactive"] == values.get("locfreqactive", 0)):
            break
    d.page.pump(0.2)
    d.page.eval("%s.$apply()" % SCOPE)
    d.page.pump(0.1)


LOC_KHZ, GS_KHZ = 110300, 335000          # the fixture's 110.30 and its paired glide path


def ils(shared, select, locstatus=5, locdev=0, gsstatus=5, gsdev=0):
    """A v2.4 payload on the fixture's localizer. One dongle: only the selected half."""
    v = dict.fromkeys(("vorradial", "vorsnr", "voram", "vorstatus", "vorsub",
                       "vorfreqactive"), 0)
    v.update(vorfreq=LOC_KHZ / 1000.0, gsshared=1 if shared else 0,
             locstatus=locstatus, locdev=locdev, locddm=round(locdev * 1.55), locsdm=40,
             locsnr=35, locfreqactive=LOC_KHZ,
             gsstatus=gsstatus, gsdev=gsdev, gsddm=round(gsdev * 1.75), gssdm=80, gssnr=30,
             gsfreqactive=GS_KHZ)
    if shared and select == 0:
        v.update(gsstatus=0, gsdev=0, gsddm=0, gssdm=0, gssnr=0, gsfreqactive=0)
    if shared and select == 1:
        v.update(locstatus=0, locdev=0, locddm=0, locsdm=0, locsnr=0, locfreqactive=0)
    return v


def press(d, selector):
    box = d.page.eval("""(() => { const r = document.querySelector(%s).getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()""" % json.dumps(selector))
    for kind in ("mousePressed", "mouseReleased"):
        d.page.send("Input.dispatchMouseEvent", type=kind, x=box["x"], y=box["y"],
                    button="left", clickCount=1)


def press_and_read(d, selector):
    before = len(posted(d))
    press(d, selector)
    for _ in range(20):
        d.page.pump(0.1)
        if len(posted(d)) > before:
            break
    return posted(d)[-1] if len(posted(d)) > before else None


def switch_shown(d):
    return d.page.eval("(() => { const e = document.querySelector(%s);"
                       " return !!e && e.offsetParent !== null; })()" % json.dumps(SWITCH))


def active(d):
    return d.page.eval("[...document.querySelectorAll(%s)].filter(b => b.classList.contains('btn-warning'))"
                       ".map(b => b.innerText.trim())" % json.dumps(SWITCH + " button"))


def labels_ok(d, res, label, drawn, what=""):
    d.page.pump(0.3)
    ls = d.page.eval(LABELS)
    ok = (bool(ls) and len(ls["drawn"]) == 2 and ls["gsActive"] == drawn
          and all(x == drawn for x in ls["drawn"]))
    res.check(ok, "%-9s %s" % (label, what), ls)


def diamonds_ok(d, res, label, drawn, dy=None, what=""):
    d.page.pump(0.3)
    ds = d.page.eval(DIAMOND)
    ok = all(x["drawn"] == drawn for x in ds)
    if ok and dy is not None:
        ok = all(abs(x["dy"] - dy) <= 1.5 for x in ds)
    res.check(ok, "%-9s %s" % (label, what), ds)
    labels_ok(d, res, label, drawn, "%s: GS labels %s" % (what, "shown" if drawn else "hidden"))


def check(d, res, label, width, height):
    d.page.eval("(() => { const s = %s; s.vorList = [%s]; s.$apply(); })()"
                % (SCOPE, json.dumps(FIXTURE)))

    # VOR: no switch, no diamonds
    frame(d, **dict(vor(status=5), gsstatus=0, gsdev=0, gsfreqactive=0, gsshared=0))
    res.check(not switch_shown(d), "%-9s VOR: no LOC / GS switch" % label)
    diamonds_ok(d, res, label, False, what="VOR: no glide-slope diamonds")

    # Two dongles: both halves together, no switch, diamonds with the bar
    frame(d, **ils(False, 0, gsdev=50))
    res.check(not switch_shown(d), "%-9s two dongles: no switch" % label)
    diamonds_ok(d, res, label, True, -FULL / 2,
                "two dongles, gsdev +50 (fly up): diamonds half scale above centre")
    res.check(d.page.eval(BAR)["drawn"], "%-9s ... and the LOC bar with them" % label)

    # One dongle, LOC selected: switch shown, LOC lit, on the glass and pressable
    frame(d, **ils(True, 0))
    res.check(switch_shown(d), "%-9s one dongle: the switch is shown" % label)
    res.check(active(d) == ["LOC"], "%-9s ... on LOC" % label, active(d))
    for i, word in ((1, "LOC"), (2, "GS")):
        sel = "%s button:nth-child(%d)" % (SWITCH, i)
        corners_ok(d, res, label, sel, width, height, "the %s button" % word, own=SWITCH)
    diamonds_ok(d, res, label, False, what="LOC selected: no diamonds")
    shows = d.page.eval(SHOWS)
    res.check(shows[:1] == ["LOC"], "%-9s LOC selected: the LOC words" % label, shows)

    # Press GS: posts gsselect 1, lights GS
    body = press_and_read(d, SWITCH + " button:nth-child(2)")
    res.check(body == {"gsselect": 1}, "%-9s GS posts gsselect 1" % label, repr(body))
    d.page.pump(0.2)
    res.check(active(d) == ["GS"], "%-9s ... and GS is lit" % label, active(d))

    # GS received alone: its words, not VOR OFF, no LOC bar, the notice says GS
    for status, word in ((1, "GS NO SIGNAL"), (2, "GS TUNING"), (3, "GS ACQUIRING")):
        frame(d, **ils(True, 1, gsstatus=status, gsdev=50))
        shows = d.page.eval(SHOWS)
        res.check(shows[:1] == [word], "%-9s %s: the label says so" % (label, word), shows)
        diamonds_ok(d, res, label, False, what="%s: diamonds parked" % word)
    frame(d, **ils(True, 1, gsstatus=5, gsdev=100))
    shows = d.page.eval(SHOWS)
    res.check(shows[:1] == ["GS"] and FIXTURE["name"] in shows and str(GS_KHZ) in shows,
              "%-9s GS tracking: GS, the station, the glide-path channel" % label, shows)
    left = d.page.eval("document.querySelector('[ui-view] .addonVorLabelTopLeft').innerText")
    res.check("SDM: 80" in left and "SUB:" not in left, "%-9s the GS values on the left" % label, left)
    res.check(not d.page.eval(BAR)["drawn"], "%-9s no LOC bar while on GS" % label)
    diamonds_ok(d, res, label, True, -FULL, "gsdev +100: diamonds at full scale above")
    frame(d, **ils(True, 1, gsstatus=4, gsdev=-50))
    diamonds_ok(d, res, label, True, FULL / 2, "gsdev -50 degraded (fly down): half scale below")
    frame(d, **ils(True, 1, gsstatus=5, gsdev=200))
    diamonds_ok(d, res, label, True, -FULL, "gsdev past full scale: clamped")
    note = d.page.eval("document.querySelector('[ui-view] .addonVorLocNotice').innerText")
    res.check("GS SUPPLEMENTAL" in note and "NOT APPROACH GUIDANCE" in note,
              "%-9s the notice says GS, not approach guidance" % label, note)

    # Lost: parked at once
    frame(d, **ils(True, 1, gsstatus=1, gsdev=0))
    diamonds_ok(d, res, label, False, what="GS lost: diamonds parked")

    # Back to LOC
    body = press_and_read(d, SWITCH + " button:nth-child(1)")
    res.check(body == {"gsselect": 0}, "%-9s LOC posts gsselect 0" % label, repr(body))
    frame(d, **ils(True, 0, locdev=50))
    res.check(d.page.eval(SHOWS)[:1] == ["LOC"] and d.page.eval(BAR)["drawn"],
              "%-9s back on LOC: the bar again" % label)
    diamonds_ok(d, res, label, False, what="... and no diamonds")

    # The bridge echoes gsselect 1 (another view pressed it): the switch follows
    frame(d, **dict(ils(True, 1), gsselect=1))
    res.check(active(d) == ["GS"], "%-9s gsselect echoed on the bridge lights GS" % label,
              active(d))

    # Off: everything gone
    frame(d, **dict(vor(status=0, khz=0), gsstatus=0, gsfreqactive=0, gsshared=0, gsselect=0))
    res.check(not switch_shown(d) and d.page.eval(SHOWS)[:1] == ["OFF"],
              "%-9s OFF: no switch, OFF" % label)
    diamonds_ok(d, res, label, False, what="OFF: no diamonds")


def main():
    res = Result()
    for width, height in PANELS:
        with Display() as d:
            boot(d, width, height)
            label = "%dx%d" % (width, height)
            check(d, res, label, width, height)
            res.check(not d.js_errors(), "%-9s no errors" % label, d.js_errors()[:2])
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
