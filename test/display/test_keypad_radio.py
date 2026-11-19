"""The radio plate driven by the knob alone, through the real key paths.

docs/tech-debt/keypad-page-navigation.md, the first page of the plan. Every press here is a
real one: a Chromium key event (the browser path of services/servicekeypad.js) or a frame on
the /keypad socket (main/keypad.go on the Pi). Nothing dispatches the `keypad` event itself,
which is what test_keypad.py and test_radio.py do and why they could not see the service.

The model is the radio's own, kept by the plan: PREV and NEXT walk the stops, TAP on a radio
stop enters or leaves edit mode, in edit mode PREV and NEXT change the value, TAP on a
recording plays it, TAP on SWITCH FREQ. swaps active and standby. The stops, in order:

    each radio:  MHz, kHz, SWITCH FREQ., and with its sliders shown VOL, SQL
    then:        each playback row, newest first

The walk stops at both ends (D2). The closed copy of the plate in the sidebar never hears the
knob (D3), on this page or another. A key mapped to nothing does nothing (D1).

Two radios: an SDR with sliders and a serial one. The fake backend does not store a POST, so
after each press the plate reads the fixture back and the standby is where the case set it.
"""

import json
import math
import re
import sys

import known
from plates import Display, Result

PANELS = [(480, 480), (800, 480), (1024, 600), (1280, 800)]
ROUND_RADIUS = 240

# The real names, from web/settings/keypad.json
PREV, TAP, NEXT = "1", "2", "3"
ALIASES = [("ArrowUp", "ArrowDown", "Enter"), ("ArrowLeft", "ArrowRight", "Enter")]

BOX = "[ui-view] #radio_box"
SCOPE = "angular.element(document.querySelector('%s')).scope()" % BOX

# What the pilot sees as the knob's place: the stops lit red (browse) or green (edit), the
# radio panel with the bar, and the playback row with the bar
FOCUS = """(() => {
    const view = document.querySelector('[ui-view]');
    const stops = [], bars = [];
    view.querySelectorAll('#radio_box').forEach((box, i) => {
        const names = [['radio_stop_' + i + '_0', 'mhz'], ['radio_stop_' + i + '_1', 'khz'],
                       ['radio_stop_' + i + '_4', 'swap'],
                       ['radio_level_' + i + '_2', 'vol'], ['radio_level_' + i + '_3', 'sql']];
        names.forEach(([id, name]) => {
            const e = box.querySelector('#' + id);
            if (e && /(btn|label)-(danger|success)/.test(e.className)) {
                stops.push({stop: 'r' + i + ':' + name, edit: /btn-success/.test(e.className)});
            }
        });
        if (box.querySelector('.panel.keypadSelectedYes')) bars.push('r' + i);
    });
    view.querySelectorAll('tr[id^=radio_playback_]').forEach(e => {
        if (e.classList.contains('keypadSelectedYes')) {
            const n = 'p' + e.id.split('_').pop();
            stops.push({stop: n, edit: false});
            bars.push(n);
        }
    });
    return {stops: stops, bars: bars};
})()"""

# The focused element's box, to see it on the glass
FOCUS_BOX = """(() => {
    const view = document.querySelector('[ui-view]');
    const e = [...view.querySelectorAll('[id^=radio_stop_], [id^=radio_level_], tr[id^=radio_playback_]')]
        .find(e => /(btn|label)-(danger|success)/.test(e.className) || e.classList.contains('keypadSelectedYes'));
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom};
})()"""

SIDEBAR_KNOB = """(() => {
    const boxes = [...document.querySelectorAll('#radio_box')].filter(e => !e.closest('[ui-view]'));
    if (!boxes.length) return null;
    const s = angular.element(boxes[0]).scope();
    return [s.scrollItemCounter, s.scrollItemRight, !!s.scrollItemSelected, s.isSidebar];
})()"""

WALK = ["r0:mhz", "r0:khz", "r0:swap", "r0:vol", "r0:sql", "r1:mhz", "r1:khz", "r1:swap", "p0", "p1", "p2"]


def radios():
    return [{"Name": "COM1", "Driver": "SDR", "Enabled": True, "Dual": False, "Path": "",
             "FrequencyActive": "121.500", "FrequencyStandby": "118.000",
             "LabelActive": "", "LabelStandby": "", "SquelchLevel": 4, "VolumeLevel": 40},
            {"Name": "COM2", "Driver": "NMEA", "Enabled": True, "Dual": False, "Path": "",
             "FrequencyActive": "122.800", "FrequencyStandby": "118.000",
             "LabelActive": "", "LabelStandby": "", "SquelchLevel": 0, "VolumeLevel": 0}]


def recordings(count=3):
    out = []
    for n in range(count):
        name = "radio_20261117_10%02d00_1215%02d000.mp3" % (n, n * 5)
        out.append({"Name": name, "Source": "RTL", "Path": "/playback/" + name, "Size": 30000 + n,
                    "ModTime": "2026-11-17T10:%02d:00+01:00" % n, "Frequency": ""})
    return out


def posted(d, index=None):
    """The body of every POST to /radio/<index> so far, or to any radio as (index, body)."""
    out = []
    for path, body in d.srv.posted:
        m = re.match(r"^/radio/(\d+)$", re.sub("/+", "/", path.split("?")[0]))
        if m:
            if index is None:
                out.append((int(m.group(1)), json.loads(body)))
            elif int(m.group(1)) == index:
                out.append(json.loads(body))
    return out


def focus(d):
    return d.page.eval(FOCUS)


def where(d):
    f = focus(d)
    return [s["stop"] for s in f["stops"]]


def editing(d):
    return any(s["edit"] for s in focus(d)["stops"])


def open_display(width=1280, height=1000, playback=3):
    d = Display()
    d.srv.rest["/radio"] = radios()
    d.srv.rest["/playback"] = recordings(playback)
    d.srv.rest["/playback/"] = d.srv.rest["/playback"]
    for p in recordings(4):
        d.srv.rest[p["Path"]] = {}   # the audio element loads it: no 404 in the console
    return d, (width, height)


def boot(d, size):
    d.page.send("Emulation.setDeviceMetricsOverride", width=size[0], height=size[1],
                deviceScaleFactor=1, mobile=False)
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
    show_radio(d)


def show_radio(d):
    d.show("radio", BOX)
    d.page.wait("document.querySelectorAll('[ui-view] tr[id^=radio_playback_]').length > 0 && "
                "document.querySelectorAll('%s').length == 2" % BOX, timeout=10,
                label="radios and playback rows")
    d.srv.wait_for_client("/keypad", timeout=10)
    d.page.pump(0.3)


def show_levels(d):
    """Open the sliders of the SDR radio, by its SQL button, as a pilot does."""
    if not d.page.eval("!!document.querySelector('[ui-view] #radio_levels_0')"):
        d.page.click("""[ui-view] a[ng-click="toggleLevels(radio)"]""")
        d.page.wait("!!document.querySelector('[ui-view] #radio_levels_0')", timeout=5,
                    label="sliders shown")
        d.page.pump(0.2)


def home(d):
    """Back to the first stop, out of edit mode, with the knob itself."""
    if editing(d):
        d.key(TAP)
    for _ in range(len(WALK) + 2):
        d.key(PREV, settle=0.05)
    d.page.pump(0.2)


def go_to(d, stop):
    home(d)
    for _ in range(WALK.index(stop)):
        d.key(NEXT, settle=0.05)
    d.page.pump(0.2)
    return where(d)


def wait_post(d, before, index=None, seconds=1.5):
    for _ in range(int(seconds / 0.1)):
        d.page.pump(0.1)
        if len(posted(d, index)) > before:
            break
    d.page.pump(0.1)
    return posted(d, index)[before:]


def check_entry(d, res):
    res.check(where(d) == ["r0:mhz"], "on entry the knob is on the first radio's MHz", where(d))
    res.check(not editing(d), "and not editing")
    res.check(focus(d)["bars"] == ["r0"], "with the bar on that radio", focus(d)["bars"])


def check_walk(d, res, prev, nxt, label):
    home(d)
    seen, bars, single = [], [], True
    seen.append(where(d))
    for _ in range(len(WALK) - 1):
        d.key(nxt, settle=0.1)
        seen.append(where(d))
        bars.append(focus(d)["bars"])
    single = all(len(s) == 1 for s in seen)
    flat = [s[0] if s else None for s in seen]
    res.check(flat == WALK, "%s: NEXT walks every stop once, in order" % label, flat)
    res.check(single, "%s: exactly one stop lit at each step" % label)
    want_bars = [[w.split(":")[0]] for w in WALK[1:]]
    res.check(bars == want_bars, "%s: the bar follows the knob" % label, bars)
    for _ in range(2):
        d.key(nxt, settle=0.1)
    res.check(where(d) == [WALK[-1]], "%s: NEXT at the last recording stays there" % label, where(d))
    back = [where(d)[0]]
    for _ in range(len(WALK) - 1):
        d.key(prev, settle=0.1)
        back.append((where(d) or [None])[0])
    res.check(back == WALK[::-1], "%s: PREV walks back the same stops" % label, back)
    for _ in range(2):
        d.key(prev, settle=0.1)
    res.check(where(d) == [WALK[0]], "%s: PREV at the first stop stays there" % label, where(d))
    res.check(d.hash().endswith("/radio"), "%s: and the plate never changed" % label, d.hash())


def check_socket(d, res):
    home(d)
    d.ws_key(NEXT)
    d.ws_key(NEXT)
    res.check(where(d) == ["r0:swap"], "the Pi's keyboard (/keypad socket) moves the knob too", where(d))
    d.ws_key(PREV)
    res.check(where(d) == ["r0:khz"], "and back", where(d))
    d.ws_key(TAP)
    res.check(editing(d), "and TAP enters edit mode")
    d.ws_key(TAP)
    res.check(not editing(d), "and leaves it")


def tap_turn(d, stop, index, key):
    """Edit mode on a radio stop, one turn: what it posted, and the edit state on the way."""
    d.srv.rest["/radio"][index]["FrequencyStandby"] = "118.030"
    d.page.eval(SCOPE + ".radioRefresh()")
    d.page.pump(0.3)
    go_to(d, stop)
    d.key(TAP)
    entered = editing(d) and where(d) == [stop]
    before = len(posted(d, index))
    d.key(key)
    bodies = wait_post(d, before, index)
    d.key(TAP)
    left = not editing(d) and where(d) == [stop]
    return entered, left, bodies


def press(d, expr, nth):
    """A finger on the nth control of the routed plate doing `expr`, scrolled into view first.

    Display.click_expr counts the sidebar's closed copy too, which comes first in the DOM.
    """
    box = d.page.eval("""(() => {
        const hits = [...document.querySelectorAll('[ui-view] [ng-click]')]
            .filter(e => e.getAttribute('ng-click') === %s);
        const e = hits[%d];
        if (!e) return null;
        e.scrollIntoView({behavior: 'instant', block: 'center'});
        const r = e.getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    })()""" % (json.dumps(expr), nth))
    d.page.pump(0.1)
    return d._click_at(box)


def touch(d, expr, nth, index):
    d.srv.rest["/radio"][index]["FrequencyStandby"] = "118.030"
    d.page.eval(SCOPE + ".radioRefresh()")
    d.page.pump(0.3)
    before = len(posted(d, index))
    press(d, expr, nth)
    return wait_post(d, before, index)


def check_tap_equals_touch(d, res):
    cases = [("r0:mhz", 0, "increaseFreq(radio,1000)", "increaseFreq(radio,-1000)"),
             ("r0:khz", 0, "increaseFreq(radio,5)", "increaseFreq(radio,-5)"),
             ("r1:mhz", 1, "increaseFreq(radio,1000)", "increaseFreq(radio,-1000)"),
             ("r1:khz", 1, "increaseFreq(radio,5)", "increaseFreq(radio,-5)")]
    for stop, index, up, down in cases:
        for key, expr in ((NEXT, up), (PREV, down)):
            entered, left, knob = tap_turn(d, stop, index, key)
            hand = touch(d, expr, index, index)
            res.check(entered, "%s TAP enters edit mode on that stop" % stop)
            res.check(len(knob) == 1 and knob == hand,
                      "%s %s in edit posts what a touch on %s posts" % (stop, "NEXT" if key == NEXT else "PREV", expr),
                      "knob %r touch %r" % (knob, hand))
            res.check(left, "%s TAP leaves edit mode, still on the stop" % stop)
    # Nothing else may post the other radio
    before = len(posted(d, 1))
    tap_turn(d, "r0:khz", 0, NEXT)
    res.check(len(posted(d, 1)) == before, "turning radio 1 never posts radio 2")


def check_swap(d, res):
    """SWITCH FREQ. is an action: TAP swaps, as a touch does, and there is no edit mode."""
    for index in (0, 1):
        stop = "r%d:swap" % index
        d.srv.rest["/radio"][index]["FrequencyStandby"] = "118.030"
        d.page.eval(SCOPE + ".radioRefresh()")
        d.page.pump(0.3)
        go_to(d, stop)
        before = len(posted(d, index))
        d.key(TAP)
        knob = wait_post(d, before, index)
        res.check(not editing(d) and where(d) == [stop], "%s TAP does not enter edit mode" % stop, where(d))
        d.key(NEXT)
        res.check(where(d) == [WALK[WALK.index(stop) + 1]], "%s and NEXT moves on" % stop, where(d))
        hand = touch(d, "switchFreq(radio)", index, index)
        res.check(len(knob) == 1 and knob == hand and knob[0]["FrequencyActive"] == "118.030",
                  "%s TAP posts the swap a touch on SWITCH FREQ. posts" % stop, "knob %r touch %r" % (knob, hand))


def check_levels(d, res):
    for stop, field, step in (("r0:vol", "VolumeLevel", 10), ("r0:sql", "SquelchLevel", 1)):
        go_to(d, stop)
        start = d.page.eval(SCOPE + ".radio." + ("volume" if field == "VolumeLevel" else "squelch"))
        d.key(TAP)
        res.check(editing(d), "%s TAP enters edit mode" % stop)
        before = len(posted(d, 0))
        d.key(NEXT)
        bodies = wait_post(d, before, 0, seconds=2.0)
        res.check(bodies == [{field: start + step}], "%s NEXT posts %s %d" % (stop, field, start + step), repr(bodies))
        d.key(TAP)
        res.check(not editing(d) and where(d) == [stop], "%s TAP leaves edit mode" % stop, where(d))


def check_playback(d, res):
    rows = d.page.eval(SCOPE + ".replayList.map(p => p.Path)")
    res.check(len(rows) == 3, "three recordings listed", rows)
    for k in range(len(rows)):
        d.page.eval("document.getElementById('audioproxy').removeAttribute('src')")
        go_to(d, "p%d" % k)
        d.key(TAP)
        knob = d.page.eval("document.getElementById('audioproxy').getAttribute('src')")
        d.page.eval("document.getElementById('audioproxy').removeAttribute('src')")
        press(d, "playAudio(playback.Path)", k)
        d.page.pump(0.2)
        hand = d.page.eval("document.getElementById('audioproxy').getAttribute('src')")
        res.check(knob == rows[k] and knob == hand,
                  "TAP on recording %d plays it, as a touch on its row does" % (k + 1),
                  "knob %r touch %r" % (knob, hand))
        res.check(not editing(d) and where(d) == ["p%d" % k], "and the knob stays on that row", where(d))


def check_refresh(d, res):
    go_to(d, "r0:khz")
    d.srv.push("/radioStatus", d.srv.rest["/radio"])
    d.page.pump(0.4)
    res.check(where(d) == ["r0:khz"], "a radio status frame leaves the knob where it was", where(d))
    go_to(d, "p1")
    d.srv.push("/radioStatus", d.srv.rest["/radio"])
    d.page.pump(0.4)
    res.check(where(d) == ["p1"], "and on a recording too", where(d))
    d.srv.set_rest("/playback", recordings(4))
    d.page.pump(0.6)
    res.check(where(d) == ["p1"], "a new recording leaves the knob on the same row", where(d))
    d.srv.set_rest("/playback", recordings(3))
    d.page.pump(0.6)


def check_sidebar(d, res):
    before_sidebar = d.page.eval(SIDEBAR_KNOB)
    if before_sidebar is None:
        res.check(False, "the sidebar holds a copy of the radio plate (startup.js RightPages)")
        return
    res.check(before_sidebar[3] is True, "the sidebar copy knows it is the sidebar", before_sidebar)
    # On the radio page: one press, one post
    go_to(d, "r0:mhz")
    d.key(TAP)
    before = len(posted(d))
    d.key(NEXT)
    bodies = wait_post(d, before)
    d.key(TAP)
    res.check(len(bodies) == 1, "a turn in edit mode posts once, not once per copy", repr(bodies))
    res.check(d.page.eval(SIDEBAR_KNOB) == before_sidebar, "the sidebar copy's knob did not move",
              d.page.eval(SIDEBAR_KNOB))
    # On another page that is in the list and has no knob of its own
    d.show("emsegt", None)
    before = len(posted(d))
    for key in (NEXT, TAP, NEXT, NEXT, PREV, TAP):
        d.key(key, settle=0.1)
    d.page.pump(1.0)
    res.check(len(posted(d)) == before, "on another page the knob posts nothing to any radio",
              repr(posted(d)[before:]))
    res.check(d.page.eval(SIDEBAR_KNOB) == before_sidebar, "and the sidebar copy did not move",
              d.page.eval(SIDEBAR_KNOB))
    res.check(d.hash().endswith("/emsegt"), "and the page stayed", d.hash())


def check_return(d, res):
    """A listener left behind by the last visit would move the knob twice."""
    d.show("timers", None)
    show_radio(d)
    show_levels(d)
    check_entry(d, res)
    d.key(NEXT)
    res.check(where(d) == ["r0:khz"], "back on the plate one NEXT moves one stop", where(d))


def check_keys(d, res):
    home(d)
    for key in ("x", "q", "F7"):
        d.key(key)
    res.check(where(d) == ["r0:mhz"] and d.hash().endswith("/radio"),
              "keys mapped to nothing do nothing (D1)", (where(d), d.hash()))
    d.key("b")
    res.check(d.hash().endswith("/camera"), "b (SwipeRight) still changes page", d.hash())
    show_radio(d)
    d.key("a")
    res.check(d.hash().endswith("/emsegt"), "a (SwipeLeft) still changes page", d.hash())
    show_radio(d)
    show_levels(d)


def check_slider_has_focus(d, res):
    """A slider a finger left focused must not take the arrows from the knob."""
    home(d)
    d.page.eval("document.querySelector('[ui-view] input[aria-label=Volume]').focus()")
    before = len(posted(d, 0))
    d.key("ArrowRight")
    d.page.pump(1.0)
    res.check(where(d) == ["r0:khz"], "an arrow key with the slider focused moves the knob", where(d))
    res.check(len(posted(d, 0)) == before, "and does not step the slider", repr(posted(d, 0)[before:]))
    d.page.eval("document.activeElement.blur()")


def check_panels(res):
    """Every stop the knob reaches is on the glass, at every panel."""
    for width, height in PANELS:
        d, size = open_display(width, height)
        with d:
            boot(d, size)
            show_levels(d)
            home(d)
            out = []
            for n, stop in enumerate(WALK):
                if n:
                    d.key(NEXT, settle=0.15)
                b = d.page.eval(FOCUS_BOX)
                if b is None:
                    out.append((stop, "none lit"))
                    continue
                if width == height:
                    off = math.hypot(b["x"] - width / 2, b["y"] - height / 2) > ROUND_RADIUS
                else:
                    off = b["top"] < 0 or b["bottom"] > height
                if off:
                    out.append((stop, round(b["x"]), round(b["y"])))
            label = "%dx%d" % (width, height)
            res.check(not out, "%-9s every stop is on the glass when the knob is on it" % label, out)
            errors = [e for e in d.js_errors() if not known.lookup("keypad", "radio", e)]
            res.check(not errors, "%-9s no JS error" % label, errors[:2])


def main():
    res = Result()
    d, size = open_display()
    with d:
        boot(d, size)
        check_entry(d, res)
        show_levels(d)
        check_walk(d, res, PREV, NEXT, "1/3")
        for prev, nxt, _ in ALIASES:
            check_walk(d, res, prev, nxt, "%s/%s" % (prev, nxt))
        check_socket(d, res)
        check_keys(d, res)
        check_tap_equals_touch(d, res)
        check_swap(d, res)
        check_levels(d, res)
        check_playback(d, res)
        check_refresh(d, res)
        check_slider_has_focus(d, res)
        check_sidebar(d, res)
        check_return(d, res)
        errors = [e for e in d.js_errors() if not known.lookup("keypad", "radio", e)]
        res.check(not errors, "no JS error across the suite", errors[:3])
    check_panels(res)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
