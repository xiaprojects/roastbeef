"""The settings addon and the keypad: the keypad is off on this page (F10).

docs/tech-debt/keypad-page-navigation.md 3.4: the settings addon is ground use, text heavy, with
a touch screen or a real keyboard. A key typed into one of its fields, including the knob's own
1 / 2 / 3, arrows, Enter and the swipe keys a / b, goes into the field. Outside a field too, no
key from Chromium or from the Pi (main/keypad.go over /keypad) reaches a keypad listener, a hold
listener, the swipe list or a direct key. Touch swipes still leave the page, and the keypad
works again on the next page. No knob stops here.
The addon is not in the fixture's /addons: the suite adds it.
"""

import sys

import keypadtest as kt
from plates import Result

ADDON = {"controller": "SettingsCtrl", "hash": "/addons/settings", "html": "addons/settings.html",
         "js": "addons/js/settings.js", "name": "settings"}
COUNT = """(() => { window.__keypad = []; if (!window.__counting) { window.__counting = true;
    addEventListener('keypad', e => window.__keypad.push(e.key)); } return true; })()"""
HELD = """(() => { window.__held = []; if (!window.__holding) { window.__holding = true;
    addEventListener('keypadHold', e => window.__held.push(e.key)); } return true; })()"""


def setup(d):
    d.srv.rest["/addons"] = d.srv.rest["/addons"] + [ADDON]


def main():
    res = Result()
    d = kt.boot(setup=setup)
    try:
        d.page.wait("""(() => { const i = angular.element(document.body).injector();
                                return !!i && !!i.get('$state').get('settings'); })()""", timeout=15, label="addon")
        kt.route(d, "addons/settings", "[ui-view] input[ng-model='aircraft.name']")
        for model, text in (("aircraft.name", "I-AB12"), ("aircraft.pilot", "ab 123"), ("aircraft.propellerTime", "123")):
            d.page.eval(COUNT)
            d.page.eval("""(() => { const e = document.querySelector("[ui-view] input[ng-model='%s']");
                e.scrollIntoView({block: 'center'}); e.value = ''; e.dispatchEvent(new Event('input')); e.focus(); })()""" % model)
            for ch in text:
                d.key(ch, text=ch, settle=0.03)
            d.key("ArrowLeft", settle=0.03)
            d.key("Enter", text="\r", settle=0.03)
            d.page.pump(0.3)
            value = d.page.eval("document.querySelector(\"[ui-view] input[ng-model='%s']\").value" % model)
            res.check(value == text, "typing %r into %s keeps it" % (text, model), value)
            res.check(d.page.eval("window.__keypad") == [] and d.hash() == "#/addons/settings",
                      "and no keypad key, no page change", (d.page.eval("window.__keypad"), d.hash()))
        # F10: the keypad is off on this page, not only inside a field. Nothing from Chromium or
        # from the Pi reaches the keypad, the swipe list or a direct key until the pilot leaves
        d.page.eval("document.activeElement.blur()")
        d.page.eval(COUNT)
        d.page.eval(HELD)
        for name in (kt.PREV, kt.TAP, kt.NEXT, "a", "b", "c", "Enter", "ArrowDown", "MediaPlayPause"):
            d.key(name, settle=0.05)
        d.page.pump(0.3)
        res.check(d.page.eval("window.__keypad") == [] and d.hash() == "#/addons/settings",
                  "outside a field the keyboard reaches no keypad, swipe or direct key",
                  (d.page.eval("window.__keypad"), d.hash()))
        for name in ("1", "2", "3", "A", "B", "C", "ENTER", "MediaPlayPause"):
            d.ws_key(name, settle=0.05)
        d.ws_key("2", status=2, settle=0.05)
        d.page.pump(0.3)
        res.check(d.page.eval("window.__keypad") == [] and d.page.eval("window.__held") == []
                  and d.hash() == "#/addons/settings",
                  "a key from the Pi reaches no keypad, no hold and no page change",
                  (d.page.eval("window.__keypad"), d.page.eval("window.__held"), d.hash()))
        # Touch stays the way out: the navigation FABs swipe through the same "key" event
        d.page.eval("dispatchEvent(new KeyboardEvent('key', {key: 'DOM_CLICK_E'}))")
        d.page.pump(1.0)
        res.check(d.hash() != "#/addons/settings", "a touch swipe still leaves the page", d.hash())
        # Leaving the page gives the keypad back: B from the Pi is the radar's direct key
        d.ws_key("B", settle=1.0)
        res.check(d.hash() == "#/radar", "after leaving, the keypad works again", d.hash())
        res.check(not kt.errors(d, "settings"), "no JS error", kt.errors(d, "settings")[:3])
    finally:
        kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
