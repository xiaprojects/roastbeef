"""The camera plate on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: each camera's heading (TAP = Edit / Save), while
editing its type list (an adjust stop: TAP to edit, PREV / NEXT to choose, TAP to leave), then
the two create buttons. The name and URL fields are never stops (D5); typed into, they keep
the text and the knob does not move.
"""

import json
import re
import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] #camera_add"
SCOPE = "angular.element(document.querySelector('[ui-view] #camera_add')).scope()"


def setup(d):
    d.srv.settings["Cameras"] = [{"Name": "Hangar", "Type": 0, "Url": "img/logo-transparent.png"},
                                 {"Name": "Tail", "Type": 0, "Url": "img/logo-transparent.png"}]


def saved(d):
    return [json.loads(body) for path, body in d.srv.posted
            if re.sub("/+", "/", path.split("?")[0]) == "/setSettings" and "Cameras" in body]


def to(d, name):
    kt.first(d)
    for _ in range(kt.stops(d).index(name)):
        d.key(kt.NEXT, settle=0.03)
    d.page.pump(0.15)


def main():
    res = Result()
    d = kt.boot(setup=setup)
    try:
        kt.route(d, "camera", READY, 4)
        want = ["Hangar EDIT", "Tail EDIT", "CREATE ONLINE", "CREATE USB"]
        res.check(kt.stops(d) == want, "the stops: each heading, then the two create buttons", kt.stops(d))
        kt.check_entry(d, res, "camera", lambda: (len(saved(d)), d.page.eval(SCOPE + ".cameras.length")))
        kt.check_walk(d, res, "camera", want, plate="camera")
        kt.check_socket(d, res, "camera")

        to(d, "Hangar EDIT")
        d.key(kt.TAP)
        res.check(kt.lit(d) == ["Hangar SAVE"] and kt.stops(d)[:3] == ["Hangar SAVE", "Hangar TYPE", "Tail EDIT"],
                  "TAP on the heading edits: its type list is a stop, the text fields are not", (kt.lit(d), kt.stops(d)))
        d.key(kt.NEXT)
        d.key(kt.TAP)
        f = kt.focus(d)
        res.check(f.get("mode") == "edit" and d.page.eval("document.querySelectorAll('[ui-view] .keypadEdit').length") == 1,
                  "TAP on the type list enters edit mode, drawn green", f)
        d.key(kt.NEXT)
        res.check(d.page.eval(SCOPE + ".cameras[0].Type") == "1", "NEXT chooses Website", d.page.eval(SCOPE + ".cameras[0].Type"))
        d.key(kt.PREV)
        res.check(d.page.eval(SCOPE + ".cameras[0].Type") == "0", "PREV back to Image", d.page.eval(SCOPE + ".cameras[0].Type"))
        d.key(kt.TAP)
        res.check(kt.focus(d).get("mode") == "browse", "TAP leaves edit mode", kt.focus(d))

        # Text typed into the name field is text
        d.page.eval("document.querySelector('[ui-view] input[ng-model=\"camera.Name\"]').focus()")
        for ch in "13":
            d.key(ch, text=ch, settle=0.05)
        d.page.pump(0.3)
        name = d.page.eval("document.querySelector('[ui-view] input[ng-model=\"camera.Name\"]').value")
        res.check(name == "Hangar13" and kt.lit(d) == ["Hangar13 TYPE"],
                  "typing 1 and 3 in the name field types them, the knob stays", (name, kt.lit(d)))
        d.page.eval("document.activeElement.blur()")

        d.key(kt.PREV)
        before = len(saved(d))
        d.key(kt.TAP, settle=0.6)
        got = saved(d)[before:]
        res.check(len(got) == 1 and got[0]["Cameras"][0]["Name"] == "Hangar13",
                  "TAP on SAVE saves the cameras", got)
        res.check(kt.lit(d) == ["Hangar13 EDIT"], "and the knob stays on the heading", kt.lit(d))

        to(d, "CREATE ONLINE")
        d.key(kt.TAP)
        res.check(d.page.eval(SCOPE + ".cameras.length") == 3 and "Camera SAVE" in kt.stops(d),
                  "TAP on create adds a camera, open for editing", kt.stops(d))

        kt.check_return(d, res, "camera", "camera", READY)
        res.check(not kt.errors(d, "camera"), "no JS error", kt.errors(d, "camera")[:3])
    finally:
        kt.close(d)
    for width, height in kt.PANELS:
        d = kt.boot((width, height), setup)
        try:
            kt.route(d, "camera", READY, 4)
            kt.check_glass(d, res, "camera", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
