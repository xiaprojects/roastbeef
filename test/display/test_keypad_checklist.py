"""The checklist plate driven by the knob alone, through the real key paths.

docs/tech-debt/keypad-page-navigation.md, after the radio. Every press is a real Chromium key
event or a frame on the /keypad socket. The model is the checklist's own:

    PREV / NEXT  one row up / down, across the sections, stopping at both ends (D2)
    TAP          the row's next status: CHECK > PASS > SKIP > FAIL > TODO > CHECK

The knob's row is the plate's, not the checklist's: the checks carry an `isselected` field that
is saved with the checklist, which is where the knob used to live. It went to the daemon on
every TAP, came back on the next boot, could light several rows, and a checklist saved without
one left the knob dead. The suite runs on a checklist saved without one and on one saved with
two. A TAP posts the item on the bridge as `CHECKLIST_{section}_{row}` = status position, as a
choice in the row's list does.
"""

import copy
import json
import math
import re
import sys

import known
from plates import Display, Result

PANELS = [(480, 480), (1024, 600), (1280, 800)]
ROUND_RADIUS = 240
PREV, TAP, NEXT = "1", "2", "3"
VALUES = ["todo", "pass", "skip", "fail", "test"]

SCOPE = "angular.element(document.querySelector('[ui-view] .checksline')).scope()"

LIT = """[...document.querySelectorAll('[ui-view] tr.checksline')]
    .filter(e => e.classList.contains('keypadSelectedYes')).map(e => e.id)"""

ROW_BOX = """(() => {
    const e = document.querySelector('[ui-view] tr.checksline.keypadSelectedYes');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom};
})()"""


def checklist(sections=2, rows=3, saved=()):
    """A checklist as the daemon stores it. `saved`: the (section, row) saved as the knob's."""
    out = []
    for g in range(sections):
        items = []
        for i in range(rows):
            items.append({"date": "", "dateParsed": "__:__", "id": i,
                          "isselected": "keypadSelectedYes" if (g, i) in saved else "",
                          "name": "ITEM %d.%d" % (g, i), "text": "DO %d.%d" % (g, i), "value": "todo"})
        out.append({"date": "", "dateParsed": "__:__", "id": g, "isselected": "", "items": items,
                    "name": "SECTION %d" % g, "text": "DOLIST", "value": "todo"})
    return out


def rows_of(data):
    return ["check_%d_%d" % (g, i) for g in range(len(data)) for i in range(len(data[g]["items"]))]


def bridge_posts(d):
    out = []
    for path, body in d.srv.posted:
        if re.sub("/+", "/", path.split("?")[0]) == "/bridge/float":
            msg = json.loads(body)
            if any(k.startswith("CHECKLIST_") for k in msg):
                out.append(msg)
    return out


def list_posts(d):
    return [json.loads(body) for path, body in d.srv.posted
            if re.sub("/+", "/", path.split("?")[0]) == "/checklist/default/status"]


def lit(d):
    return d.page.eval(LIT)


def open_display(data, size=(1280, 1000)):
    d = Display()
    d.srv.rest["/checklist/default/status"] = data
    d.__enter__()
    d.page.send("Emulation.setDeviceMetricsOverride", width=size[0], height=size[1],
                deviceScaleFactor=1, mobile=False)
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
    show(d, data)
    return d


def show(d, data):
    d.show("checklist", "[ui-view] tr.checksline")
    d.page.wait("document.querySelectorAll('[ui-view] tr.checksline').length == %d" % len(rows_of(data)),
                timeout=10, label="checklist rows")
    d.srv.wait_for_client("/keypad", timeout=10)
    d.page.pump(0.3)


def home(d, data):
    for _ in range(len(rows_of(data)) + 1):
        d.key(PREV, settle=0.05)
    d.page.pump(0.2)


def go_to(d, data, row):
    home(d, data)
    for _ in range(rows_of(data).index(row)):
        d.key(NEXT, settle=0.05)
    d.page.pump(0.2)


def wait_bridge(d, before, seconds=1.5):
    for _ in range(int(seconds / 0.1)):
        d.page.pump(0.1)
        if len(bridge_posts(d)) > before:
            break
    d.page.pump(0.2)
    return bridge_posts(d)[before:]


def check_walk(d, data, res, label):
    rows = rows_of(data)
    res.check(lit(d) == [rows[0]], "%s: on entry one row is lit, the first" % label, lit(d))
    seen = [lit(d)]
    for _ in range(len(rows) - 1):
        d.key(NEXT, settle=0.1)
        seen.append(lit(d))
    res.check(all(len(s) == 1 for s in seen), "%s: exactly one row lit at each step" % label, seen)
    res.check([s[0] if s else None for s in seen] == rows, "%s: NEXT walks every row once, across the sections" % label,
              [s[0] if s else None for s in seen])
    d.key(NEXT, settle=0.1)
    d.key(NEXT, settle=0.1)
    res.check(lit(d) == [rows[-1]], "%s: NEXT at the last row stays there" % label, lit(d))
    back = [(lit(d) or [None])[0]]
    for _ in range(len(rows) - 1):
        d.key(PREV, settle=0.1)
        back.append((lit(d) or [None])[0])
    res.check(back == rows[::-1], "%s: PREV walks back the same rows" % label, back)
    d.key(PREV, settle=0.1)
    res.check(lit(d) == [rows[0]], "%s: PREV at the first row stays there" % label, lit(d))
    res.check(d.hash().endswith("/checklist"), "%s: and the plate never changed" % label, d.hash())


def check_tap(d, data, res):
    # A row in the second section: its key names the section and the row
    go_to(d, data, "check_1_1")
    seen = []
    for _ in range(len(VALUES)):
        before = len(bridge_posts(d))
        d.key(TAP)
        seen += wait_bridge(d, before)
    want = [{"CHECKLIST_1_1": n} for n in (1, 2, 3, 4, 0)]
    res.check(seen == want, "TAP cycles the row PASS, SKIP, FAIL, TODO, CHECK and posts each", seen)
    res.check(lit(d) == ["check_1_1"], "and the knob stays on the row", lit(d))
    shown = d.page.eval("document.querySelector('[ui-view] #check_1_1').className")
    res.check("todo" in shown.split(), "the row shows the status it is back to", shown)

    # The same row by touch: a choice in its list posts what the knob posted
    before = len(bridge_posts(d))
    d.key(TAP)
    knob = wait_bridge(d, before)
    before = len(bridge_posts(d))
    d.page.eval("""(() => {
        const s = document.querySelector('[ui-view] #check_1_2 select');
        s.focus(); s.value = 'pass'; s.dispatchEvent(new Event('change'));
    })()""")
    touch = wait_bridge(d, before)
    res.check(knob == [{"CHECKLIST_1_1": 1}] and touch == [{"CHECKLIST_1_2": 1}],
              "TAP posts what a choice of the next status in the row's list posts", (knob, touch))
    res.check(lit(d) == ["check_1_2"], "a touch on a row brings the knob to it", lit(d))
    res.check(d.page.eval("document.activeElement.tagName") != "SELECT",
              "and the list gives the focus back", d.page.eval("document.activeElement.tagName"))
    d.key(PREV)
    res.check(lit(d) == ["check_1_1"], "so the knob turns at once after a touch", lit(d))
    # Leave the rows as they came
    d.page.eval(SCOPE + ".$apply(() => " + SCOPE + ".data_list.forEach(g => g.items.forEach(i => i.value = 'todo')))")


def check_saved_place(res):
    """A checklist saved with two knob places: one row lit, and the knob never saved."""
    data = checklist(saved=[(0, 0), (1, 2)])
    d = open_display(data)
    try:
        res.check(lit(d) == ["check_0_0"], "saved with two places: one row lit", lit(d))
        d.key(NEXT)
        d.key(NEXT)
        d.key(NEXT)
        before = len(list_posts(d))
        d.key(TAP)
        d.page.pump(0.6)
        posts = list_posts(d)[before:]
        res.check(len(posts) == 1, "a TAP saves the checklist once", len(posts))
        if posts:
            places = [(g, i) for g, sec in enumerate(posts[0]) for i, item in enumerate(sec["items"])
                      if item.get("isselected") == "keypadSelectedYes"]
            res.check(places == [(0, 0), (1, 2)], "and what it saves is not the knob's place", places)
            res.check(posts[0][1]["items"][0]["value"] == "pass", "but the row the knob is on", posts[0][1]["items"][0])
    finally:
        d.__exit__(None, None, None)


def check_return(d, data, res):
    go_to(d, data, "check_1_0")
    d.show("radio", None)
    d.key(NEXT)
    d.key(TAP)
    d.key(TAP)
    d.page.pump(0.4)
    show(d, data)
    res.check(lit(d) == ["check_1_0"], "coming back, the knob is on the row it left", lit(d))
    before = len(bridge_posts(d))
    before_list = len(list_posts(d))
    d.key(NEXT)
    res.check(lit(d) == ["check_1_1"], "one NEXT moves one row", lit(d))
    d.key(TAP)
    got = wait_bridge(d, before)
    d.page.pump(0.4)
    res.check(got == [{"CHECKLIST_1_1": 1}] and len(list_posts(d)) - before_list == 1,
              "one TAP posts once: no listener left by the last visit", (got, len(list_posts(d)) - before_list))
    d.key(TAP)
    d.key(TAP)
    d.key(TAP)
    d.key(TAP)


def check_socket(d, data, res):
    home(d, data)
    d.ws_key(NEXT)
    res.check(lit(d) == ["check_0_1"], "the Pi's keyboard (/keypad socket) moves the knob too", lit(d))
    d.ws_key(PREV)
    res.check(lit(d) == ["check_0_0"], "and back", lit(d))


def check_fixture(res):
    """The aircraft's own checklist, saved with the knob on its first row."""
    d = Display()
    with d:
        d.show("checklist", "[ui-view] tr.checksline")
        d.page.pump(0.4)
        res.check(lit(d) == ["check_0_0"], "the aircraft's checklist: one row lit, the first", lit(d))
        d.key(NEXT)
        res.check(lit(d) == ["check_0_1"], "and NEXT moves it", lit(d))


def check_panels(res):
    data = checklist(sections=3, rows=5)
    for width, height in PANELS:
        d = open_display(data, (width, height))
        try:
            home(d, data)
            off = []
            for n, row in enumerate(rows_of(data)):
                if n:
                    d.key(NEXT, settle=0.12)
                b = d.page.eval(ROW_BOX)
                if b is None:
                    off.append((row, "none lit"))
                elif width == height:
                    # the row is wide: its middle must be on the glass
                    if math.hypot(b["x"] - width / 2, b["y"] - height / 2) > ROUND_RADIUS:
                        off.append((row, round(b["x"]), round(b["y"])))
                elif b["top"] < 0 or b["bottom"] > height:
                    off.append((row, round(b["top"]), round(b["bottom"])))
            res.check(not off, "%dx%d every row is on the glass when the knob is on it" % (width, height), off[:4])
            errors = [e for e in d.js_errors() if not known.lookup("keypad", "checklist", e)]
            res.check(not errors, "%dx%d no JS error" % (width, height), errors[:2])
        finally:
            d.__exit__(None, None, None)


def main():
    res = Result()
    data = checklist()
    d = open_display(copy.deepcopy(data))
    try:
        check_walk(d, data, res, "1/3")
        check_socket(d, data, res)
        check_tap(d, data, res)
        check_return(d, data, res)
        errors = [e for e in d.js_errors() if not known.lookup("keypad", "checklist", e)]
        res.check(not errors, "no JS error across the suite", errors[:3])
    finally:
        d.__exit__(None, None, None)
    check_saved_place(res)
    check_fixture(res)
    check_panels(res)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
