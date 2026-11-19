"""Shared checks for plates on the knob helper (web/RB-01/js/keypadfocus.js).

docs/tech-debt/keypad-page-navigation.md 6.3: the generic checks every helper page passes, through
real key presses. A page suite boots a Display, routes its plate and calls these with what it
expects; its own checks are what TAP does on that page.
"""

import math

import known
from plates import Display

PREV, TAP, NEXT = "1", "2", "3"
ROUND_RADIUS = 240
PANELS = [(480, 480), (800, 480), (1024, 600), (1280, 800)]

FOCUS = "window.keypadFocusState ? window.keypadFocusState() : null"
# Each highlighted element, by its text (or data-keypad-name)
LIT = """[...document.querySelectorAll('[ui-view] .keypadFocus, [ui-view] .keypadEdit')]
    .map(e => (e.getAttribute('data-keypad-name') || e.textContent).replace(/\\s+/g, ' ').trim())"""
ALL_LIT = "document.querySelectorAll('.keypadFocus, .keypadEdit').length"
# In the helper's order: data-keypad-order first, then the page
STOPS = """[...document.querySelectorAll('[ui-view] [data-keypad]')]
    .filter(e => e.offsetParent !== null && !e.disabled && !e.hasAttribute('disabled'))
    .map((e, n) => ({e: e, n: n, o: isNaN(parseFloat(e.getAttribute('data-keypad-order'))) ? n : parseFloat(e.getAttribute('data-keypad-order'))}))
    .sort((a, b) => (a.o - b.o) || (a.n - b.n))
    .map(x => (x.e.getAttribute('data-keypad-name') || x.e.textContent).replace(/\\s+/g, ' ').trim())"""
LIT_BOX = """(() => {
    const e = document.querySelector('[ui-view] .keypadFocus, [ui-view] .keypadEdit');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom,
            left: r.left, right: r.right};
})()"""


def boot(size=(1280, 1000), setup=None):
    """A Display with an exact viewport. `setup(d)` runs before the browser starts."""
    d = Display()
    if setup:
        setup(d)
    d.__enter__()
    d.page.send("Emulation.setDeviceMetricsOverride", width=size[0], height=size[1],
                deviceScaleFactor=1, mobile=False)
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
    return d


def close(d):
    d.__exit__(None, None, None)


def route(d, plate, ready, count=None):
    """Show the plate, wait for `ready` and, when given, for `count` stops."""
    d.show(plate, ready, timeout=25)
    if count is not None:
        d.page.wait("(%s).length == %d" % (STOPS, count), timeout=10, label="%d stops" % count)
    d.srv.wait_for_client("/keypad", timeout=10)
    d.page.pump(0.3)


def focus(d):
    return d.page.eval(FOCUS) or {}


def lit(d):
    return d.page.eval(LIT)


def stops(d):
    return d.page.eval(STOPS)


def first(d, n=None):
    """Back to no focus is not possible with the knob; back to the first stop is."""
    for _ in range((n or len(stops(d))) + 1):
        d.key(PREV, settle=0.03)
    d.page.pump(0.15)


def go_to(d, index):
    first(d)
    for _ in range(index):
        d.key(NEXT, settle=0.03)
    d.page.pump(0.2)


def check_entry(d, res, label, tap_effect):
    """No focus on entry, and a TAP then does nothing. `tap_effect()` returns a value that
    changes when something happened (a hash, a request count)."""
    f = focus(d)
    res.check(f.get("index") == -1 and f.get("count", 0) > 0,
              "%s: on entry nothing has the focus (%s stops)" % (label, f.get("count")), f)
    before = tap_effect()
    d.key(TAP)
    d.ws_key(TAP)
    d.page.pump(0.5)
    res.check(tap_effect() == before and lit(d) == [], "%s: a TAP before any turn does nothing" % label,
              (before, tap_effect(), lit(d)))


def check_walk(d, res, label, want=None, prev=PREV, nxt=NEXT, plate=None):
    """NEXT walks every stop once in order, one lit at a time, stopping at the end; PREV back."""
    want = want if want is not None else stops(d)
    first(d, len(want))
    seen = [lit(d)]
    for _ in range(len(want) - 1):
        d.key(nxt, settle=0.08)
        seen.append(lit(d))
    flat = [s[0] if len(s) == 1 else s for s in seen]
    res.check(all(len(s) == 1 for s in seen) and d.page.eval(ALL_LIT) == 1,
              "%s: exactly one stop lit at each step" % label, seen)
    res.check(flat == want, "%s: NEXT walks every stop once, in order (%d)" % (label, len(want)), flat)
    d.key(nxt)
    res.check(lit(d) == [want[-1]], "%s: NEXT at the last stop stays there" % label, lit(d))
    back = [(lit(d) or [None])[0]]
    for _ in range(len(want) - 1):
        d.key(prev, settle=0.08)
        back.append((lit(d) or [None])[0])
    res.check(back == want[::-1], "%s: PREV walks back" % label, back)
    d.key(prev)
    res.check(lit(d) == [want[0]], "%s: PREV at the first stop stays there" % label, lit(d))
    if plate:
        res.check(d.hash().split("?")[0] == "#/" + plate, "%s: and the plate never changed" % label, d.hash())


def check_socket(d, res, label):
    first(d)
    d.ws_key(NEXT)
    want = stops(d)[1:2]
    res.check(lit(d) == want, "%s: the Pi's keyboard (/keypad socket) moves the focus too" % label, (lit(d), want))


def check_glass(d, res, label, width, height):
    """Walk every stop; each one lit is on the glass (inside the circle on a square panel)."""
    first(d)
    off = []
    n = len(stops(d))
    for i in range(n):
        if i:
            d.key(NEXT, settle=0.1)
        b = d.page.eval(LIT_BOX)
        if b is None:
            off.append((i, "none lit"))
        elif width == height:
            if math.hypot(b["x"] - width / 2, b["y"] - height / 2) > ROUND_RADIUS:
                off.append((i, round(b["x"]), round(b["y"])))
        elif b["top"] < -1 or b["bottom"] > height + 1:
            off.append((i, round(b["top"]), round(b["bottom"])))
    res.check(not off, "%s %dx%d: every stop is on the glass when the knob is on it" % (label, width, height), off[:4])


def check_return(d, res, label, plate, ready, away="emsegt"):
    """Leave and come back: no focus, and one NEXT moves one stop (no listener left behind)."""
    d.show(away, None)
    d.page.pump(0.4)
    route(d, plate, ready)
    res.check(focus(d).get("index") == -1, "%s: back on the plate nothing has the focus" % label, focus(d))
    d.key(NEXT)
    res.check(focus(d).get("index") == 0, "%s: one NEXT takes the first stop" % label, focus(d))


def errors(d, plate):
    return [e for e in d.js_errors() if not known.lookup("keypad", plate, e)
            and "failed to load resource" not in e.lower()]
