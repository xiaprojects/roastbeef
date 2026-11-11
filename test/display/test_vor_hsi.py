"""The VOR plate in VOR mode (RB-VOR-IF v2.3), on all five panels.

test_vor.py covers the list and its OFF row, test_vor_loc.py the localizer. This is the
rest of what the pilot reads off the plate with a VOR tuned: the status word, the station
and channel under it, the measurements in the other corner, the TO/FROM button, and the
course pointer on the rose.

Frames go through the real bridge socket (rbserver push -> services/servicebridge.js ->
BridgeUpdated) and the track through the situation socket, so this is the plate as the
pilot sees it, with a fake receiver.

What the interface says (../rb-vor/docs/RB-VOR-IF-v2.3.md):
  3.1  vorradial is the radial FROM the station, degrees magnetic. TO = radial + 180.
  3.3  no vor* field is gated: in NO SIGNAL and ACQUIRING the last radial is still sent.
  4.1  use vorradial only when vorstatus >= 4: do not display it otherwise.
  4.2  an independent staleness timeout, 3 s recommended: a killed daemon leaves its
       last values on the bridge.
  4.4  the 359 -> 0 wrap.

The course pointer. HSICircleRenderer (plates/js/hsi.js) turns the rose by -track and the
pointer group by -center, so with `center` = track - course the arrow's screen angle is
course - track, and it reads `course` on the rose: what the HSI plate and the LOC mode of
this plate do. The test measures where the arrow head is on the screen against the centre
of the rose, so it does not depend on how the plate gets there.

"Drawn" is the arrow head with a box and no hidden ancestor up to the svg, so hiding the
arrow, its group or making either transparent all count as not drawn.
"""

import json
import math
import re
import sys

from plates import Display, Result

PANELS = [(480, 480), (800, 480), (1024, 600), (1280, 800), (1920, 1080)]
ROUND_RADIUS = 240
STALE_S = 3.0             # RB-VOR-IF v2.3 4.2, the recommended timeout
TOLERANCE = 3.0           # degrees, for the pointer's measured angle

ROOT = "[ui-view] .addonVorSquare"
STATUS = "[ui-view] .addonVorLabelTopRight"     # also the button that opens the list
TOFROM = "[ui-view] .addonVorLabelTopLeft"      # also the TO/FROM button
CELLS = "document.querySelectorAll('[ui-view] tr[ng-click] td')"
SCOPE = "angular.element(document.querySelector('%s')).scope()" % ROOT

# The status word (the first label), then the station and channel spans
SHOWS = """(() => {
    const el = document.querySelector('%s');
    const word = el.querySelector('.label');
    const spans = [...el.querySelectorAll('span')].map(s => s.innerText.trim());
    return {word: word ? word.innerText.trim() : null, name: spans[0], freq: spans[1]};
})()""" % STATUS

# The arrow head of the course pointer: its screen angle, clockwise from up, and whether
# it is drawn. The first polygon of the pointer group is the arrow (plates/js/hsi.js).
POINTER = """(() => {
    const hsi = %s.vorHSI;
    if (!hsi) return null;
    const svg = document.querySelector('#vorHSI svg');
    const arrow = hsi.containerCenter.node.querySelector('polygon');
    const s = svg.getBoundingClientRect(), r = arrow.getBoundingClientRect();
    let hidden = false;
    for (let e = arrow; e && e !== svg; e = e.parentNode) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0
            || e.getAttribute('opacity') === '0') hidden = true;
    }
    const dx = (r.left + r.width / 2) - (s.left + s.width / 2);
    const dy = (r.top + r.height / 2) - (s.top + s.height / 2);
    return {drawn: !hidden && r.width > 0 && r.height > 0,
            angle: (Math.atan2(dx, -dy) * 180 / Math.PI + 360) %% 360};
})()""" % SCOPE

# An element's own box: every corner on the glass of the round panel, and what is at the
# corner is the element itself (not a navigation FAB)
CORNERS = """(() => {
    const el = document.querySelector(%s);
    if (!el || el.offsetParent === null) return null;
    const r = el.getBoundingClientRect();
    return [[r.left + 1, r.top + 1], [r.right - 1, r.top + 1],
            [r.left + 1, r.bottom - 1], [r.right - 1, r.bottom - 1]].map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return {x, y, clear: !!hit && el.contains(hit),
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


def vor(status=5, radial=130, khz=109400, snr=40, am=28, sub=29):
    """A v2.3 payload from a receiver with loc.enabled, on a VOR channel."""
    return {"vorradial": radial, "vorsnr": snr, "voram": am, "vorstatus": status,
            "vorsub": sub, "vorfreqactive": khz, "vorfreq": khz / 1000.0,
            "locstatus": 0, "locdev": 0, "locddm": 0, "locsdm": 0, "locsnr": 0,
            "locfreqactive": 0}


def settle(d):
    d.page.pump(0.2)
    d.page.eval("%s.$apply()" % SCOPE)
    d.page.pump(0.1)


def frame(d, **values):
    """One bridge frame, the whole map as RB-01 sends it, and the plate caught up."""
    d.srv.push("/bridge/float/ws", values)
    want = (values["vorstatus"], values["vorradial"], values["vorfreqactive"])
    for _ in range(20):
        d.page.pump(0.1)
        got = d.page.eval("(() => { const i = %s.items; return [i.vorstatus, i.vorradial,"
                          " i.vorfreqactive]; })()" % SCOPE)
        if tuple(got) == want:
            break
    settle(d)


def track(d, degrees):
    d.srv.push_situation(GPSTrueCourse=degrees)
    for _ in range(20):
        d.page.pump(0.1)
        if d.page.eval(SCOPE + ".items.GPSTrueCourse") == degrees:
            break
    settle(d)


def off_by(a, b):
    """The circular difference of two angles, degrees."""
    return abs((a - b + 180) % 360 - 180)


def press_at(d, x, y):
    for kind in ("mousePressed", "mouseReleased"):
        d.page.send("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)


def press(d, selector):
    """A real mouse press in the middle of the first line of `selector`."""
    box = d.page.eval("""(() => {
        const e = document.querySelector(%s), l = e.querySelector('.label') || e;
        const r = l.getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    })()""" % json.dumps(selector))
    press_at(d, box["x"], box["y"])
    settle(d)


def posted(d):
    return [json.loads(body) for path, body in d.srv.posted
            if re.sub("/+", "/", path.split("?")[0]) == "/bridge/float"]


def corners_ok(d, res, label, selector, width, height, what):
    corners = d.page.eval(CORNERS % json.dumps(selector))
    res.check(bool(corners), "%-9s %s is shown" % (label, what))
    if not corners:
        return
    under = [c["hit"] for c in corners if not c["clear"]]
    res.check(not under, "%-9s every corner of %s can be pressed" % (label, what), under)
    if width == height:
        far = max(math.hypot(c["x"] - width / 2, c["y"] - height / 2) for c in corners)
        res.check(far <= ROUND_RADIUS, "%-9s %s is on the glass" % (label, what),
                  "%.0f px from the centre" % far)


def check_status(d, res, label):
    """Every vorstatus: its word, and the radial drawn only when usable (4.1)."""
    words = {0: "OFF", 1: "NO SIGNAL", 2: "TUNING", 3: "ACQUIRING", 4: "DEGRADED", 5: "FIX"}
    for status, word in sorted(words.items()):
        # v2.3 3.3: OFF and TUNING carry zeros, NO SIGNAL and ACQUIRING the last radial
        carried = status in (1, 3, 4, 5)
        frame(d, **vor(status=status, radial=130 if carried else 0,
                       khz=0 if status == 0 else 109400,
                       snr=40 if carried else 0, am=28 if carried else 0))
        shows, ptr = d.page.eval(SHOWS), d.page.eval(POINTER)
        res.check(shows["word"] == word, "%-9s vorstatus %d: the label says %s"
                  % (label, status, word), shows)
        usable = status >= 4
        res.check(ptr and ptr["drawn"] == usable,
                  "%-9s vorstatus %d: the course pointer is %s"
                  % (label, status, "drawn" if usable else "not drawn (4.1)"), ptr)


def check_labels(d, res, label):
    """The station and channel under the word, and the measurements opposite."""
    frame(d, **vor(status=5, khz=109400, snr=41, am=27, sub=31))
    shows = d.page.eval(SHOWS)
    res.check(shows["name"] == "Perugia", "%-9s 109400 names Perugia" % label, shows)
    try:
        mhz = float(shows["freq"])
        mhz = mhz / 1000 if mhz > 1000 else mhz
    except (TypeError, ValueError):
        mhz = None
    res.check(mhz is not None and abs(mhz - 109.4) < 0.001,
              "%-9s the channel is shown" % label, shows)
    left = d.page.eval("document.querySelector('%s').innerText" % TOFROM)
    want = ["SNR: 41", "SUB: 31", "AM: 27"]
    res.check(all(w in left for w in want), "%-9s SNR, SUB and AM are the receiver's" % label,
              left.replace("\n", " | "))
    frame(d, **vor(status=5, khz=109200))   # a VOR channel the shipped list leaves empty
    shows = d.page.eval(SHOWS)
    res.check(shows["name"] == "", "%-9s a channel not in the list names nothing" % label, shows)


def check_duplicate(d, res, label):
    """Pisa and Catania share 112.10: the one picked stays named when the daemon answers.
    Pisa is also a TACAN on 108.30, so the row is found by name and frequency."""
    d.page.click(STATUS)
    d.page.wait("%s.length > 0" % CELLS, timeout=5, label="the list")
    d.page.pump(0.2)
    d.page.eval("[...%s].find(e => e.textContent.trim() === 'Pisa'"
                " && e.nextElementSibling && e.nextElementSibling.textContent.trim() === '112.1').scrollIntoView({block: 'center'})"
                % CELLS)
    d.page.pump(0.2)
    box = d.page.eval("""(() => {
        const r = [...%s].find(e => e.textContent.trim() === 'Pisa'
            && e.nextElementSibling && e.nextElementSibling.textContent.trim() === '112.1').getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    })()""" % CELLS)
    before = len(posted(d))
    press_at(d, box["x"], box["y"])
    d.page.wait("!!document.querySelector('%s') && %s.items.searchEnabled == false"
                % (ROOT, SCOPE), timeout=5, label="back on the rose")
    settle(d)
    body = posted(d)[-1] if len(posted(d)) > before else None
    res.check(body == {"vorfreq": 112.1}, "%-9s Pisa posts 112.1" % label, repr(body))
    res.check(d.page.eval(SHOWS)["name"] == "Pisa", "%-9s Pisa is named at once" % label,
              d.page.eval(SHOWS))
    frame(d, **vor(status=3, khz=112100))
    res.check(d.page.eval(SHOWS)["name"] == "Pisa",
              "%-9s ... and still Pisa when the receiver reports 112100" % label,
              d.page.eval(SHOWS))


def check_pointer(d, res, label, width, height):
    """TO/FROM, and the pointer reading the course on the rose, at two tracks."""
    frame(d, **vor(status=5, radial=130))
    corners_ok(d, res, label, TOFROM, width, height, "the TO/FROM button")
    shows_to = d.page.eval("document.querySelector('%s .label').innerText.trim()" % TOFROM)
    res.check(shows_to == "TO", "%-9s TO by default" % label, shows_to)

    for trk in (0, 90):
        track(d, trk)
        for radial in (130, 359, 1):
            frame(d, **vor(status=5, radial=radial))
            for _ in range(2):
                word = d.page.eval("document.querySelector('%s .label').innerText.trim()" % TOFROM)
                course = radial if word == "FROM" else (radial + 180) % 360
                ptr = d.page.eval(POINTER)
                want = (course - trk) % 360
                res.check(ptr and ptr["drawn"] and off_by(ptr["angle"], want) <= TOLERANCE,
                          "%-9s track %03d, radial %03d %s: the pointer reads %03d on the rose"
                          % (label, trk, radial, word, course),
                          "at %.0f on the screen, want %.0f" % (ptr["angle"], want) if ptr else ptr)
                before = word
                press(d, TOFROM)
                word = d.page.eval("document.querySelector('%s .label').innerText.trim()" % TOFROM)
                res.check(word == {"TO": "FROM", "FROM": "TO"}[before],
                          "%-9s a press turns %s into %s" % (label, before, word), word)
    track(d, 0)
    # back to TO for whatever follows
    if d.page.eval("document.querySelector('%s .label').innerText.trim()" % TOFROM) == "FROM":
        press(d, TOFROM)


def check_stale(d, res, label):
    """A daemon that stops sending: its last FIX must not stay on the plate (4.2)."""
    frame(d, **vor(status=5, radial=130))
    res.check(d.page.eval(POINTER)["drawn"], "%-9s FIX: drawn" % label)
    d.page.pump(STALE_S + 1.0)
    settle(d)
    shows, ptr = d.page.eval(SHOWS), d.page.eval(POINTER)
    res.check(not ptr["drawn"] and shows["word"] != "FIX",
              "%-9s %.0f s with no frame: no pointer, no FIX (4.2)" % (label, STALE_S + 1),
              (shows, ptr))


def check_bar(d, res, label):
    """The VOR mode computes no deviation: the bar is never drawn (a centred lie)."""
    frame(d, **vor(status=5, radial=130))
    drawn = d.page.eval("%s.vorHSI.verticalLineDirection.visible()" % SCOPE)
    res.check(not drawn, "%-9s no deviation bar in VOR mode" % label)
    d.shot("vor-hsi-%s" % label)


def main():
    res = Result()
    for width, height in PANELS:
        with Display() as d:
            boot(d, width, height)
            label = "%dx%d" % (width, height)
            check_status(d, res, label)
            check_labels(d, res, label)
            check_duplicate(d, res, label)
            check_pointer(d, res, label, width, height)
            check_bar(d, res, label)
            check_stale(d, res, label)
            res.check(not d.js_errors(), "%-9s no errors" % label, d.js_errors()[:2])
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
