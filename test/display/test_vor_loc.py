"""The VOR plate's localizer mode (RB-VOR-IF v2.3), on all five panels.

rb-vor, with loc.enabled, publishes six loc* fields on the float bridge. The plate is in
LOC mode while locfreqactive is non-zero, and draws the HSI's deviation bar ONLY while
locstatus >= 4. Noise decodes as a centred needle, so a bar drawn on anything less is a
plausible approach on no signal: the failure this mode must not have. Every other state
parks the bar (it is not drawn) and the status word says why.

Frames go through the real bridge socket (rbserver push -> services/servicebridge.js ->
BridgeUpdated), so this is the plate as the pilot sees it, with a fake receiver.

Direction. plates/js/hsi.js moves the bar by -vertical * 12.5 viewbox units in the course
pointer's frame, dots 25 apart, clamp +/-6. The HSI plate feeds `vertical` with
dist * tan(track - bearing), positive when the course lies to the left, so positive moves
the bar LEFT: the bar shows where the course is. locdev > 0 means 150 Hz predominates =
aircraft right of the front course = fly left, so it must put the bar LEFT of centre,
and locdev 100 (full scale) on the third dot (6 half-dots = 75 units).

The ILS list entry is a fixture added to the page at test time only; the shipped list
carries no localizers (they come from the AIP, rb-vor docs/loc-plan.md Q5).
"""

import json
import math
import re
import sys

from plates import Display, Result

PANELS = [(480, 480), (800, 480), (1024, 600), (1280, 800), (1920, 1080)]
ROUND_RADIUS = 240

ROOT = "[ui-view] .addonVorSquare"
STATUS = "[ui-view] .addonVorLabelTopRight"
SCOPE = "angular.element(document.querySelector('%s')).scope()" % ROOT
SHOWS = """document.querySelector('%s').innerText.split('\\n')
    .map(s => s.trim()).filter(s => s)""" % STATUS
FIXTURE = {"name": "TEST LOC FIXTURE", "id": "TSTX", "type": "ILS", "freq": 110.3, "course": 90}
VOR_KEYS = ("vorradial", "vorsnr", "voram", "vorstatus", "vorsub", "vorfreqactive")

# Where the bar is on the screen against the centre of the rose, in viewbox units
# (the svg's own scale), and whether it is drawn at all
BAR = """(() => {
    const s = %s, hsi = s.vorHSI;
    if (!hsi) return null;
    const bar = hsi.verticalLineDirection;
    const svg = document.querySelector('#vorHSI svg').getBoundingClientRect();
    const r = bar.node.getBoundingClientRect();
    const scale = svg.width / 280;
    return {drawn: bar.visible() && r.width > 0,
            dx: ((r.left + r.width / 2) - (svg.left + svg.width / 2)) / scale,
            dy: ((r.top + r.height / 2) - (svg.top + svg.height / 2)) / scale,
            frame: bar.cx()};
})()""" % SCOPE

# A text element's own box: every corner on the glass of the round panel, and not under
# a navigation FAB (what is at the corner is the element itself)
# (a hit anywhere in `own`, the element's own row or box, is the element: a two-line text's
# box has a corner beside its shorter line, as test_vor.py accepts for the OFF row)
CORNERS = """(() => {
    const el = document.querySelector(%s), own = document.querySelector(%s);
    if (!el || el.offsetParent === null) return null;
    const r = el.getBoundingClientRect();
    return [[r.left + 1, r.top + 1], [r.right - 1, r.top + 1],
            [r.left + 1, r.bottom - 1], [r.right - 1, r.bottom - 1]].map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return {x, y, clear: !!hit && own.contains(hit),
                hit: hit ? hit.tagName + '.' + hit.className : 'nothing'};
    });
})()"""


def boot(d, width, height):
    d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                deviceScaleFactor=1, mobile=False)
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
    d.page.wait("""(() => { const i = angular.element(document.body).injector();
                            return !!i && !!i.get('$state').get('vor'); })()""",
                timeout=15, label="the vor addon")
    d.show("addons/vor", ROOT)


def frame(d, **values):
    """One bridge frame, the whole map as RB-01 sends it."""
    d.srv.push("/bridge/float/ws", values)
    for _ in range(20):
        d.page.pump(0.1)
        d.page.eval("%s.$apply()" % SCOPE)
        if d.page.eval(SCOPE + ".items.locfreqactive") == values.get("locfreqactive", 0):
            break
    d.page.pump(0.2)
    d.page.eval("%s.$apply()" % SCOPE)
    d.page.pump(0.1)


NO_ENTRY_KHZ = 108900      # a localizer channel with no list entry: no front course known


def loc(status, dev=0, khz=NO_ENTRY_KHZ, **extra):
    """A v2.3 payload on a localizer channel: every vor* field 0."""
    v = dict.fromkeys(VOR_KEYS, 0)
    v.update(locstatus=status, locdev=dev, locddm=round(dev * 1.55), locsdm=39, locsnr=35,
             locfreqactive=khz, vorfreq=khz / 1000.0)
    v.update(extra)
    return v


def vor(status=5, khz=109400, with_loc=True):
    v = {"vorradial": 130, "vorsnr": 40, "voram": 28, "vorstatus": status, "vorsub": 29,
         "vorfreqactive": khz, "vorfreq": khz / 1000.0}
    if with_loc:
        v.update(locstatus=0, locdev=0, locddm=0, locsdm=0, locsnr=0, locfreqactive=0)
    return v


def corners_ok(d, res, label, selector, width, height, what, own=None):
    corners = d.page.eval(CORNERS % (json.dumps(selector), json.dumps(own or selector)))
    res.check(bool(corners), "%-9s %s is shown" % (label, what))
    if not corners:
        return
    under = [c["hit"] for c in corners if not c["clear"]]
    res.check(not under, "%-9s %s is clear of the FABs and controls" % (label, what), under)
    inside = all(0 <= c["x"] <= width and 0 <= c["y"] <= height for c in corners)
    res.check(inside, "%-9s %s is on the screen" % (label, what))
    if width == height:
        far = max(math.hypot(c["x"] - width / 2, c["y"] - height / 2) for c in corners)
        res.check(far <= ROUND_RADIUS, "%-9s %s is on the glass" % (label, what),
                  "%.0f px from the centre" % far)


def posted(d):
    return [json.loads(body) for path, body in d.srv.posted
            if re.sub("/+", "/", path.split("?")[0]) == "/bridge/float"]


def check_list(d, res, label, width, height):
    """The ILS mechanism: a fixture entry, its LOC tag and the notice row."""
    # The fixture alone: the shipped list (from db.vor.json) has real stations on the
    # channels this test uses, 108.90 and 110.30, and would answer for them instead
    d.page.eval("(() => { const s = %s; s.vorList = [%s]; s.$apply(); })()"
                % (SCOPE, json.dumps(FIXTURE)))
    d.page.click(STATUS)
    d.page.wait("document.querySelectorAll('[ui-view] tr[ng-click] td').length > 0",
                timeout=5, label="the list")
    d.page.pump(0.3)
    notice = d.page.eval("(() => { const e = document.querySelector('[ui-view] .addonVorLocListNotice');"
                         " return e ? e.innerText.trim() : null; })()")
    res.check(notice and "NOT APPROACH GUIDANCE" in notice,
              "%-9s the list says LOC is supplemental" % label, notice)
    corners_ok(d, res, label, "[ui-view] .addonVorLocListNoticeText", width, height,
               "the list's LOC notice", own="[ui-view] .addonVorLocListNotice")
    # the OFF row stays pressable with the notice row below it
    d.page.eval("[...document.querySelectorAll('[ui-view] tr[ng-click] td')]"
                ".find(e => e.textContent.trim() === 'OFF').scrollIntoView({block: 'center'})")
    d.page.pump(0.2)
    tag = d.page.eval("[...document.querySelectorAll('[ui-view] tr[ng-click]')]"
                      ".filter(r => r.innerText.indexOf(%s) >= 0)"
                      ".map(r => r.querySelector('.label') ? r.querySelector('.label').innerText : '')"
                      % json.dumps(FIXTURE["name"]))
    res.check(tag == ["LOC"], "%-9s the ILS entry is tagged LOC" % label, tag)
    before = len(posted(d))
    d.page.eval("[...document.querySelectorAll('[ui-view] tr[ng-click] td')]"
                ".find(e => e.textContent.trim() === %s).scrollIntoView({block: 'center'})"
                % json.dumps(FIXTURE["name"]))
    d.page.pump(0.2)
    box = d.page.eval("""(() => {
        const e = [...document.querySelectorAll('[ui-view] tr[ng-click] td')]
            .find(e => e.textContent.trim() === %s);
        const r = e.getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    })()""" % json.dumps(FIXTURE["name"]))
    for kind in ("mousePressed", "mouseReleased"):
        d.page.send("Input.dispatchMouseEvent", type=kind, x=box["x"], y=box["y"],
                    button="left", clickCount=1)
    for _ in range(20):
        d.page.pump(0.1)
        if len(posted(d)) > before:
            break
    body = posted(d)[-1] if len(posted(d)) > before else None
    res.check(body == {"vorfreq": 110.3}, "%-9s the ILS entry posts its frequency to vorfreq"
              % label, repr(body))
    d.page.wait("!!document.querySelector('%s') && %s.items.searchEnabled == false"
                % (ROOT, SCOPE), timeout=5, label="back on the rose")


def check_states(d, res, label, width, height):
    unit = 37.5            # locdev 50 = 3 half-dots = 37.5 viewbox units

    frame(d, **vor(status=0, khz=0))
    bar = d.page.eval(BAR)
    res.check(bar and not bar["drawn"], "%-9s OFF: no bar" % label, bar)

    # Every state below 4 parks the bar, whatever locdev says, and names the reason
    for status, word in ((0, "LOC OFF"), (1, "LOC NO SIGNAL"), (2, "LOC TUNING"),
                         (3, "LOC ACQUIRING")):
        frame(d, **loc(status, dev=50))
        shows, bar = d.page.eval(SHOWS), d.page.eval(BAR)
        res.check(shows[:1] == [word] and not bar["drawn"],
                  "%-9s %s: bar parked, the label says so" % (label, word), (shows, bar))
    corners_ok(d, res, label, "[ui-view] .addonVorLocNotice", width, height,
               "the LOC notice")
    note = d.page.eval("document.querySelector('[ui-view] .addonVorLocNotice').innerText")
    res.check("NOT APPROACH GUIDANCE" in note, "%-9s it says not approach guidance" % label, note)

    # The bar and the word beside it change together: from ACQUIRING to tracking with no
    # digest forced by the test, sampled as fast as the page allows. Drawn straight from
    # the bridge event, the bar once led the label by a digest (test_vor_radio.py).
    d.srv.push("/bridge/float/ws", loc(5, dev=50))
    split = []
    for _ in range(40):
        d.page.pump(0.02)
        shows, bar = d.page.eval(SHOWS), d.page.eval(BAR)
        if bar["drawn"] != (shows[:1] in (["LOC"], ["LOC DEGRADED"])):
            split.append((shows[:1], bar["drawn"]))
    res.check(not split, "%-9s bar and status word never disagree" % label, split[:2])
    frame(d, **loc(1, dev=0))
    d.srv.push("/bridge/float/ws", loc(5, dev=50))
    d.page.pump(0.5)
    d.srv.push("/bridge/float/ws", loc(1, dev=0))
    split = []
    for _ in range(40):
        d.page.pump(0.02)
        shows, bar = d.page.eval(SHOWS), d.page.eval(BAR)
        if bar["drawn"] and shows[:1] not in (["LOC"], ["LOC DEGRADED"]):
            split.append((shows[:1], bar["drawn"]))
    res.check(not split, "%-9s ... nor when the signal goes" % label, split[:2])

    # Usable: drawn, sense and scale. No station entry, so the pointer is up (the track)
    # and screen left is the pointer's left.
    frame(d, **loc(5, dev=50))
    shows, bar = d.page.eval(SHOWS), d.page.eval(BAR)
    res.check(shows[:1] == ["LOC"] and bar["drawn"], "%-9s LOC tracking: the bar is drawn"
              % label, (shows, bar))
    res.check(abs(bar["dx"] + unit) <= 1.5,
              "%-9s locdev +50 (fly left): the bar is left of centre by 1.5 dots" % label,
              "%.1f units" % bar["dx"])
    frame(d, **loc(4, dev=-100))
    shows, bar = d.page.eval(SHOWS), d.page.eval(BAR)
    res.check(shows[:1] == ["LOC DEGRADED"] and bar["drawn"] and abs(bar["dx"] - 2 * unit) <= 1.5,
              "%-9s locdev -100, degraded: the bar on the right, third dot" % label,
              (shows, bar))
    frame(d, **loc(5, dev=0))
    bar = d.page.eval(BAR)
    res.check(bar["drawn"] and abs(bar["dx"]) <= 1.5,
              "%-9s locdev 0 on a usable signal: centred, and drawn" % label, bar)

    # Lost: back to NO SIGNAL parks it at once
    frame(d, **loc(1, dev=0))
    res.check(not d.page.eval(BAR)["drawn"], "%-9s signal lost: parked again" % label)

    # The fixture's front course is 090 and the track 000 (the backend's situation): the
    # pointer points right, so the course pointer's left is UP on the screen. Fly left on
    # a 090 course = the course line is north of the aircraft = the bar above centre.
    frame(d, **loc(5, dev=50, khz=110300))
    bar = d.page.eval(BAR)
    res.check(abs(bar["frame"] + unit) <= 0.5 and abs(bar["dy"] + unit) <= 1.5
              and abs(bar["dx"]) <= 1.5,
              "%-9s front course 090, track 000, locdev +50: the bar 1.5 dots north" % label, bar)
    shows = d.page.eval(SHOWS)
    res.check(shows[1:2] == [FIXTURE["name"]], "%-9s the label names the station" % label, shows)

    # Mode change: a VOR clears the LOC display, and back
    frame(d, **vor(status=5))
    shows, bar = d.page.eval(SHOWS), d.page.eval(BAR)
    notice = d.page.eval("!!document.querySelector('[ui-view] .addonVorLocNotice')")
    res.check(shows[:1] == ["FIX"] and not bar["drawn"] and not notice,
              "%-9s to a VOR: LOC labels, bar and notice gone" % label, (shows, bar, notice))
    left = d.page.eval("document.querySelector('[ui-view] .addonVorLabelTopLeft').innerText")
    res.check("SUB:" in left and "SDM" not in left, "%-9s the VOR corner is back" % label, left)
    frame(d, **loc(5, dev=-50))
    bar = d.page.eval(BAR)
    res.check(d.page.eval(SHOWS)[:1] == ["LOC"] and bar["drawn"] and abs(bar["dx"] - unit) <= 1.5,
              "%-9s and back to the localizer" % label, bar)

    # A receiver without loc.enabled sends no loc* keys and rejects the channel
    frame(d, **dict(vor(status=0, khz=0, with_loc=False), vorfreq=110.3,
                    locfreqactive=0, locstatus=0, locdev=0))
    d.page.eval("(() => { const s = %s; s.items.locKnown = false; s.$apply(); })()" % SCOPE)
    d.page.pump(0.2)
    shows, bar = d.page.eval(SHOWS), d.page.eval(BAR)
    res.check(shows[:1] == ["NO LOC"] and not bar["drawn"],
              "%-9s a receiver that cannot decode it: NO LOC, no bar" % label, (shows, bar))

    # A stale map (a killed localizer daemon, then a VOR): the VOR wins, no bar
    frame(d, **dict(vor(status=5), locfreqactive=110300, locstatus=5, locdev=50))
    res.check(not d.page.eval(BAR)["drawn"] and d.page.eval(SHOWS)[:1] == ["FIX"],
              "%-9s both channels on the bridge: VOR shown, no bar" % label)

    frame(d, **vor(status=0, khz=0))
    res.check(not d.page.eval(BAR)["drawn"] and d.page.eval(SHOWS)[:1] == ["OFF"],
              "%-9s OFF: no bar, OFF" % label)


def main():
    res = Result()
    for width, height in PANELS:
        with Display() as d:
            boot(d, width, height)
            label = "%dx%d" % (width, height)
            check_list(d, res, label, width, height)
            check_states(d, res, label, width, height)
            res.check(not d.js_errors(), "%-9s no errors" % label, d.js_errors()[:2])
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
