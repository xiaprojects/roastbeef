"""The switchboard plate driven by the knob, through js/keypadfocus.js and the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: each tile is a stop, TAP runs it as a touch does.
A tile drives the aircraft (the fixture's run `halt` and `reboot`), so nothing has the focus when
the page opens: the first NEXT takes the first tile, the first PREV the last, and a TAP before
either runs nothing. The walk stops at both ends (D2). Every press is a real Chromium key or a
frame on the /keypad socket.

It is also the first plate on the shared helper, so the generic checks of 6.3 run here: one
highlight, on the glass, kept when the list is redrawn, gone with the plate.
"""

import json
import math
import re
import sys

import known
from plates import Display, Result

PANELS = [(480, 480), (800, 480), (1024, 600), (1280, 800)]
ROUND_RADIUS = 240
PREV, TAP, NEXT = "1", "2", "3"

# Harmless stand-ins, as many as the aircraft has, so the grid scrolls on the small panels
NAMES = ["DSP OFF", "DSP ON", "CON BT", "VOL 50%", "VOL 75%", "VOL MAX", "PWR OFF", "CON BT2",
         "PWR RBT", "ACC CGE", "GYR CGE", "LIGHTS"]

FOCUS = "window.keypadFocusState ? window.keypadFocusState() : null"
LIT = """[...document.querySelectorAll('.keypadFocus, .keypadEdit')].map(e => e.textContent.trim())"""
TILES = """[...document.querySelectorAll('[ui-view] .switchBoardButton')].map(e => e.textContent.trim())"""
LIT_BOX = """(() => {
    const e = document.querySelector('[ui-view] .keypadFocus');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom};
})()"""


def switches():
    return [{"Name": n, "Type": 2, "Status": 0, "Uri": "echo %d" % i, "UriStatus": "",
             "EpochStart": 0, "EpochFinish": 0} for i, n in enumerate(NAMES)]


def runs(d):
    """The switches run so far, by Uri."""
    out = []
    for path, body in d.srv.posted:
        if re.sub("/+", "/", path.split("?")[0]) == "/switches":
            try:
                out.append(json.loads(body)["Uri"])
            except (ValueError, KeyError, TypeError):
                out.append(body)
    return out


def focus(d):
    return d.page.eval(FOCUS) or {}


def lit(d):
    return d.page.eval(LIT)


def open_display(size=(1280, 1000)):
    d = Display()
    d.srv.settings["Switches"] = switches()
    d.srv.settings["SwitchBoard_Enabled"] = True
    d.__enter__()
    d.page.send("Emulation.setDeviceMetricsOverride", width=size[0], height=size[1],
                deviceScaleFactor=1, mobile=False)
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
    show(d)
    return d


def show(d):
    d.show("switchboard", "[ui-view] .switchBoardButton")
    d.page.wait("document.querySelectorAll('[ui-view] .switchBoardButton').length == %d" % len(NAMES),
                timeout=10, label="tiles")
    d.srv.wait_for_client("/keypad", timeout=10)
    d.page.pump(0.3)


def press(d, index):
    """A finger on tile `index`, scrolled into view first."""
    box = d.page.eval("""(() => {
        const e = document.querySelectorAll('[ui-view] .switchBoardButton')[%d];
        e.scrollIntoView({behavior: 'instant', block: 'center'});
        const r = e.getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    })()""" % index)
    d.page.pump(0.1)
    return d._click_at(box)


def wait_run(d, before, seconds=1.5):
    for _ in range(int(seconds / 0.1)):
        d.page.pump(0.1)
        if len(runs(d)) > before:
            break
    d.page.pump(0.2)
    return runs(d)[before:]


def check_entry(d, res):
    f = focus(d)
    res.check(f.get("page") == "switchboard" and f.get("index") == -1 and f.get("count") == len(NAMES),
              "on entry no tile has the focus, %d stops" % len(NAMES), f)
    before = len(runs(d))
    d.key(TAP)
    d.key("Enter")
    d.ws_key(TAP)
    d.page.pump(0.6)
    res.check(len(runs(d)) == before and lit(d) == [], "a TAP before any turn runs no switch", runs(d)[before:])
    d.key(NEXT)
    res.check(lit(d) == [NAMES[0]], "the first NEXT takes the first tile", lit(d))


def check_walk(d, res, prev, nxt, label):
    # Back to the first tile with the knob itself
    for _ in range(len(NAMES)):
        d.key(prev, settle=0.03)
    seen = [lit(d)]
    for _ in range(len(NAMES) - 1):
        d.key(nxt, settle=0.08)
        seen.append(lit(d))
    res.check(all(len(s) == 1 for s in seen), "%s: exactly one tile lit at each step" % label, seen)
    res.check([s[0] if s else None for s in seen] == NAMES, "%s: NEXT walks every tile once, in order" % label,
              [s[0] if s else None for s in seen])
    d.key(nxt)
    res.check(lit(d) == [NAMES[-1]], "%s: NEXT at the last tile stays there" % label, lit(d))
    back = [(lit(d) or [None])[0]]
    for _ in range(len(NAMES) - 1):
        d.key(prev, settle=0.08)
        back.append((lit(d) or [None])[0])
    res.check(back == NAMES[::-1], "%s: PREV walks back" % label, back)
    d.key(prev)
    res.check(lit(d) == [NAMES[0]], "%s: PREV at the first tile stays there" % label, lit(d))
    res.check(d.hash().endswith("/switchboard"), "%s: and the plate never changed" % label, d.hash())


def check_tap(d, res):
    for k in (0, 3, len(NAMES) - 1):
        for _ in range(len(NAMES)):
            d.key(PREV, settle=0.03)
        for _ in range(k):
            d.key(NEXT, settle=0.03)
        before = len(runs(d))
        d.key(TAP)
        knob = wait_run(d, before)
        before = len(runs(d))
        press(d, k)
        hand = wait_run(d, before)
        res.check(knob == ["echo %d" % k] and knob == hand,
                  "TAP on %s runs it, as a touch on it does" % NAMES[k], (knob, hand))
    # The plate redraws a tile with the daemon's answer: the knob stays on it
    for _ in range(len(NAMES)):
        d.key(PREV, settle=0.03)
    d.key(NEXT)
    d.key(NEXT)
    before = len(runs(d))
    d.key(TAP)
    wait_run(d, before)
    d.page.pump(0.4)
    res.check(lit(d) == [NAMES[2]] and focus(d).get("index") == 2,
              "the tile redrawn after it ran keeps the focus", (lit(d), focus(d)))
    d.key(NEXT)
    res.check(lit(d) == [NAMES[3]], "and NEXT goes on from it", lit(d))


def check_return(d, res):
    d.show("radio", None)
    before = len(runs(d))
    for key in (NEXT, TAP, PREV, TAP):
        d.key(key, settle=0.1)
    d.page.pump(0.5)
    res.check(len(runs(d)) == before, "on another page the knob runs no switch", runs(d)[before:])
    show(d)
    res.check(focus(d).get("index") == -1 and lit(d) == [], "back on the plate nothing has the focus", focus(d))
    d.key(NEXT)
    res.check(lit(d) == [NAMES[0]], "and one NEXT takes the first tile: no listener left by the last visit", lit(d))
    before = len(runs(d))
    d.key(TAP)
    res.check(wait_run(d, before) == ["echo 0"], "one TAP runs it once")


def check_socket(d, res):
    for _ in range(len(NAMES)):
        d.ws_key(PREV, settle=0.03)
    d.ws_key(NEXT)
    res.check(lit(d) == [NAMES[1]], "the Pi's keyboard (/keypad socket) moves the focus too", lit(d))


def check_panels(res):
    for width, height in PANELS:
        d = open_display((width, height))
        try:
            off = []
            for n in range(len(NAMES)):
                d.key(NEXT, settle=0.1)
                b = d.page.eval(LIT_BOX)
                if b is None:
                    off.append((NAMES[n], "none lit"))
                elif width == height:
                    if math.hypot(b["x"] - width / 2, b["y"] - height / 2) > ROUND_RADIUS:
                        off.append((NAMES[n], round(b["x"]), round(b["y"])))
                elif b["top"] < 0 or b["bottom"] > height:
                    off.append((NAMES[n], round(b["top"]), round(b["bottom"])))
            res.check(not off, "%dx%d every tile is on the glass when the knob is on it" % (width, height), off[:4])
            errors = [e for e in d.js_errors() if not known.lookup("keypad", "switchboard", e)]
            res.check(not errors, "%dx%d no JS error" % (width, height), errors[:2])
        finally:
            d.__exit__(None, None, None)


def main():
    res = Result()
    d = open_display()
    try:
        res.check(d.page.eval(TILES) == NAMES, "the plate shows the configured tiles", d.page.eval(TILES))
        check_entry(d, res)
        check_walk(d, res, PREV, NEXT, "1/3")
        check_walk(d, res, "ArrowUp", "ArrowDown", "ArrowUp/ArrowDown")
        check_socket(d, res)
        check_tap(d, res)
        check_return(d, res)
        errors = [e for e in d.js_errors() if not known.lookup("keypad", "switchboard", e)]
        res.check(not errors, "no JS error across the suite", errors[:3])
    finally:
        d.__exit__(None, None, None)
    check_panels(res)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
