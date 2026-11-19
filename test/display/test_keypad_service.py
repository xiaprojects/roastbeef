"""The keypad service: which page a key reaches, through the real key paths.

docs/tech-debt/keypad-page-navigation.md, phase 0a (section 5.1) and its test (6.2). Every
press is a real Chromium key event or a frame on the /keypad socket, never a dispatched
`keypad` event, so services/servicekeypad.js is under test:

- F1: PREV, TAP and NEXT reach the plate on every route, in the navigation list or not, at
  each display shape. A page outside the list used to send the pilot home on any key.
- D1: a key mapped to nothing does nothing.
- The swipe keys still walk the navigation list of the shape.
- F2: a key typed into a text field is text, not a keypad key.
- F3: a mapped key does only its keypad work: no page scroll.
- F6: a keypad.json missing one list does not throw.
- A hold from the Pi is a keypadHold, not a press.

What each plate does with the key is the plate's own suite (test_keypad_radio.py).
"""

import json
import sys

import known
from plates import Display, Result

SHAPES = [("Square", 480, 480), ("Landscape", 1280, 800), ("Portrait", 800, 1280)]

# Section 1 of the plan; the addons in the fixture's /addons. "" is home
ROUTES = ["", "aircraft", "sixpack", "speed", "attitude", "altimeter", "turnslip", "heading",
          "variometer", "gmetergauge", "synthview", "hsi", "airfields", "autopilot", "timers",
          "ems", "emsegt", "radio", "camera", "checklist", "alerts", "charts", "switchboard",
          "voice", "map", "radar", "resources", "ota", "addons/vor", "addons/example"]

# A TAP here acts on the plate, which is the point; it must not leave the page
COUNT = """(() => {
    window.__keypad = [];
    window.__keypadHold = 0;
    if (!window.__keypadCounting) {
        window.__keypadCounting = true;
        // Only the service's three: airfields, autopilot, checklist, timers also send 'from'
        // and 'to' at the ends of a list (F5), which go when each page migrates
        addEventListener('keypad', e => { if (/^KEYPAD_MAPPING_/.test(e.key)) window.__keypad.push(e.key); });
        addEventListener('keypadHold', e => window.__keypadHold++);
    }
    return true;
})()"""

ENVIRONMENTAL = ("getusermedia", "notallowederror", "notfounderror", "permission",
                 "speechrecognition", "mediadevices", "notreadableerror", "404")


def boot(width, height, keypad=None):
    d = Display()
    if keypad is not None:
        d.srv.rest["/settings/keypad.json"] = keypad
    d.__enter__()
    d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                deviceScaleFactor=1, mobile=False)
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
    d.page.pump(1.0)
    d.page.eval(COUNT)
    return d


def served(d, path):
    return d.page.eval("fetch(%s).then(r => r.json())" % json.dumps(path), await_promise=True)


def go(d, route):
    d.page.eval("window.location.hash = '#/%s'" % route)
    d.page.pump(0.8)
    d.page.eval(COUNT)


def errors_since(d, before, plate):
    out = []
    for text in d.page.errors[before:]:
        if any(tok in text.lower() for tok in ENVIRONMENTAL):
            continue
        if known.lookup("keypad", plate, text):
            continue
        out.append(text[:100])
    return out


def check_routes(res):
    for shape, width, height in SHAPES:
        d = boot(width, height)
        try:
            nav = served(d, "/settings/navigation.json")
            in_list = nav.get("navigationSort" + shape) or nav.get("navigationSort")
            missed, moved, broke = [], [], []
            for route in ROUTES:
                go(d, route)
                before = len(d.page.errors)
                want = "#/" + route
                # TAP first: on a page with knob stops nothing has the focus yet, so it acts on
                # nothing; PREV then NEXT end on the first stop, which TAP has not touched
                for key in ("2", "1", "3"):
                    d.key(key, settle=0.15)
                got = d.page.eval("window.__keypad")
                if got != ["KEYPAD_MAPPING_TAP", "KEYPAD_MAPPING_PREV", "KEYPAD_MAPPING_NEXT"]:
                    missed.append((route or "home", got))
                if d.hash().split("?")[0] != want:
                    moved.append((route or "home", d.hash()))
                broke += [(route or "home", e) for e in errors_since(d, before, route or "home")]
            outside = [r for r in ROUTES if "#/" + r not in in_list]
            res.check(not missed, "%-9s PREV, TAP, NEXT reach the plate on all %d routes (%d outside the list)"
                      % (shape, len(ROUTES), len(outside)), missed[:4])
            res.check(not moved, "%-9s and no route changes page on them" % shape, moved[:4])
            res.check(not broke, "%-9s and no JS error" % shape, broke[:3])
        finally:
            d.__exit__(None, None, None)


def check_socket_and_keys(res):
    d = boot(1280, 800)
    try:
        nav = served(d, "/settings/navigation.json")["navigationSortLandscape"]
        for route in ("ota", "addons/vor", "hsi"):
            go(d, route)
            for key in ("2", "1", "3"):
                d.ws_key(key, settle=0.15)
            got = d.page.eval("window.__keypad")
            res.check(len(got) == 3 and d.hash() == "#/" + route,
                      "1280x800 #/%-10s (not in the list) gets the knob from the Pi's socket" % route,
                      (got, d.hash()))
            for key in ("x", "F7", "Escape", "z"):
                d.key(key, settle=0.1)
                d.ws_key(key, settle=0.1)
            res.check(d.hash() == "#/" + route and d.page.eval("window.__keypad") == got,
                      "1280x800 #/%-10s keys mapped to nothing do nothing (D1)" % route, d.hash())

        # The swipe keys walk the shape's list, both ends wrap as before
        go(d, nav[0].replace("#/", ""))
        walked = [d.hash()]
        for _ in range(len(nav)):
            d.key("b", settle=0.5)
            walked.append(d.hash() or "#/")
        res.check(walked == nav + [nav[0]], "b (SwipeRight) walks the Landscape list and wraps",
                  [w for w, n in zip(walked, nav + [nav[0]]) if w != n][:3])
        d.key("a", settle=0.5)
        res.check(d.hash() == nav[-1], "a (SwipeLeft) wraps back to the last page", d.hash())
        go(d, "ota")
        d.key("b", settle=0.5)
        res.check(d.hash() == nav[0], "a swipe outside the list starts it from its first page", d.hash())

        # A hold from the Pi
        go(d, "radio")
        d.ws_key("3", status=2)
        res.check(d.page.eval("window.__keypadHold") == 1 and d.page.eval("window.__keypad") == [],
                  "a hold on the socket is a keypadHold, not a press",
                  (d.page.eval("window.__keypadHold"), d.page.eval("window.__keypad")))

        # A direct key still opens its page
        d.key("C", settle=0.5)
        res.check(d.hash() == "#/airfields", "a direct key (C) still opens its page", d.hash())

        check_typing(d, res)
        check_scroll(d, res)
    finally:
        d.__exit__(None, None, None)


def check_typing(d, res):
    """A field on the plate: what is typed stays in it and reaches no keypad listener."""
    go(d, "radio")
    for tag, html in (("input", "<input id='kt' type='text'>"),
                      ("textarea", "<textarea id='kt'></textarea>")):
        d.page.eval("""(() => {
            const old = document.getElementById('kt'); if (old) old.remove();
            document.querySelector('[ui-view]').insertAdjacentHTML('afterbegin', %s);
            document.getElementById('kt').focus();
        })()""" % json.dumps(html))
        d.page.eval(COUNT)
        for ch in "123ab":
            d.key(ch, text=ch, settle=0.05)
        d.key("Enter", text="\r", settle=0.05)
        d.key("ArrowLeft", settle=0.05)
        d.page.pump(0.4)
        value = d.page.eval("document.getElementById('kt').value")
        res.check(value.startswith("123ab"), "typing in a %s keeps the text" % tag, repr(value))
        res.check(d.page.eval("window.__keypad") == [], "and sends no keypad key", d.page.eval("window.__keypad"))
        res.check(d.hash() == "#/radio", "and a, b do not change page", d.hash())
    d.page.eval("document.getElementById('kt').remove()")


SCROLLER = """(() => {
    let e = document.querySelector('[ui-view]');
    while (e && e !== document.body) {
        const o = getComputedStyle(e).overflowY;
        if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e;
        e = e.parentElement;
    }
    return document.scrollingElement;
})()"""
SCROLLED = "(%s).scrollTop" % SCROLLER


def check_scroll(d, res):
    """An arrow mapped to the knob must not scroll the plate as well."""
    go(d, "ems")   # nothing to operate (inert): any scroll would be the browser's
    d.page.eval("""(() => {
        const tall = document.createElement('div');
        tall.id = 'tall'; tall.style.height = '4000px';
        document.querySelector('[ui-view]').appendChild(tall);
        const s = %s;
        s.setAttribute('tabindex', '-1'); s.focus();
    })()""" % SCROLLER)
    d.page.pump(0.3)
    start = d.page.eval(SCROLLED)
    # The browser does scroll here on a key the knob does not use
    d.page.send("Input.dispatchKeyEvent", type="rawKeyDown", key="PageDown", code="PageDown",
                windowsVirtualKeyCode=34)
    d.page.send("Input.dispatchKeyEvent", type="keyUp", key="PageDown", code="PageDown",
                windowsVirtualKeyCode=34)
    d.page.pump(0.5)
    paged = d.page.eval(SCROLLED)
    if paged == start:
        print("  SKIP the plate does not scroll on PageDown here: the arrow check proves nothing")
        return
    for _ in range(4):
        d.page.send("Input.dispatchKeyEvent", type="rawKeyDown", key="ArrowDown", code="ArrowDown",
                    windowsVirtualKeyCode=40)
        d.page.send("Input.dispatchKeyEvent", type="keyUp", key="ArrowDown", code="ArrowDown",
                    windowsVirtualKeyCode=40)
    d.page.pump(0.5)
    res.check(d.page.eval(SCROLLED) == paged, "ArrowDown (NEXT) does not scroll the plate",
              (start, paged, d.page.eval(SCROLLED)))
    d.page.eval("document.getElementById('tall').remove()")


def check_partial_mapping(res):
    with open_keypad() as keypad:
        del keypad["keypad"]["SwipeLeft"]
        d = boot(1280, 800, keypad=keypad)
        try:
            go(d, "radio")
            before = len(d.page.errors)
            for key in ("3", "a", "x"):
                d.key(key, settle=0.2)
            got = d.page.eval("window.__keypad")
            res.check(got == ["KEYPAD_MAPPING_NEXT"], "keypad.json without SwipeLeft: NEXT still works", got)
            res.check(not errors_since(d, before, "radio"), "and nothing throws", errors_since(d, before, "radio")[:2])
        finally:
            d.__exit__(None, None, None)


class open_keypad:
    def __enter__(self):
        from plates import WEB
        import os
        with open(os.path.join(WEB, "settings", "keypad.json")) as fh:
            return json.load(fh)

    def __exit__(self, *exc):
        return False


def main():
    res = Result()
    check_routes(res)
    check_socket_and_keys(res)
    check_partial_mapping(res)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
