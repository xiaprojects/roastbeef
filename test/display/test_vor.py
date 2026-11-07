"""The VOR addon's station list, and the OFF row at the top of it.

OFF is the only control that makes rb-vor give the dongle back, so it is what lets the
radio have it (test/integration/test_vor_radio.py runs both for real). vorfreq has no
empty value on the float bridge, so off is 0, which rb-vor refuses and releases on.

The first row of a list is where the north navigation zone sits above 480 px high, and
that zone keeps taking presses after it fades. A press in the middle of the word can
land 2 px clear of it while the end of the word is underneath, so all four corners of
the word are hit-tested. On the round panel they must also be on the glass.
"""

import json
import math
import re
import sys

from plates import Display, Result

PANELS = [(480, 480), (800, 480), (1024, 600), (1280, 800), (1920, 1080)]
ROUND_RADIUS = 240

ROOT = "[ui-view] .addonVorSquare"
STATUS = "[ui-view] .addonVorLabelTopRight"     # also the button that opens the list
CELLS = "document.querySelectorAll('[ui-view] tr[ng-click] td')"
# The word's own box, not its cell's, and whether each corner of it reaches the row
CORNERS = """(() => {
    const cell = [...%s].find(e => e.textContent.trim() === %%s);
    const range = document.createRange();
    range.selectNodeContents(cell);
    const r = range.getBoundingClientRect(), row = cell.parentElement;
    return [[r.left + 1, r.top + 1], [r.right - 1, r.top + 1],
            [r.left + 1, r.bottom - 1], [r.right - 1, r.bottom - 1]].map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return {x, y, reached: !!hit && row.contains(hit),
                hit: hit ? hit.tagName + '.' + hit.className : 'nothing'};
    });
})()""" % CELLS


def boot(d, width, height):
    d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                deviceScaleFactor=1, mobile=False)
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
    d.page.wait("""(() => { const i = angular.element(document.body).injector();
                            return !!i && !!i.get('$state').get('vor'); })()""",
                timeout=15, label="the vor addon")
    d.show("addons/vor", ROOT)


def posted(d):
    """The body of every POST to /bridge/float so far."""
    return [json.loads(body) for path, body in d.srv.posted
            if re.sub("/+", "/", path.split("?")[0]) == "/bridge/float"]


def open_list(d):
    d.page.click(STATUS)
    d.page.wait("%s.length > 0" % CELLS, timeout=5, label="the list")
    d.page.pump(0.2)


def press(d, word):
    """Press `word` in the list; what it posted, None if nothing."""
    before = len(posted(d))
    d.page.eval("[...%s].find(e => e.textContent.trim() === %s).scrollIntoView({block: 'center'})"
                % (CELLS, json.dumps(word)))
    d.page.pump(0.2)
    box = d.page.eval(CORNERS % json.dumps(word))
    x = sum(c["x"] for c in box) / 4
    y = sum(c["y"] for c in box) / 4
    for kind in ("mousePressed", "mouseReleased"):
        d.page.send("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
    for _ in range(20):
        d.page.pump(0.1)
        if len(posted(d)) > before:
            return posted(d)[-1]
    return None


def main():
    res = Result()
    for width, height in PANELS:
        with Display() as d:
            boot(d, width, height)
            label = "%dx%d" % (width, height)
            open_list(d)
            corners = d.page.eval(CORNERS % json.dumps("OFF"))
            bad = [c["hit"] for c in corners if not c["reached"]]
            res.check(not bad, "%-9s every corner of OFF can be pressed" % label, bad)
            if width == height:
                far = max(math.hypot(c["x"] - width / 2, c["y"] - height / 2) for c in corners)
                res.check(far <= ROUND_RADIUS, "%-9s OFF is on the glass" % label,
                          "%.0f px from the centre" % far)
            body = press(d, "OFF")
            res.check(body == {"vorfreq": 0}, "%-9s it posts vorfreq 0" % label, repr(body))
            open_list(d)
            body = press(d, "Alghero")
            res.check(body == {"vorfreq": 113.8}, "%-9s a station posts its frequency" % label, repr(body))
            res.check(not d.js_errors(), "%-9s no errors" % label, d.js_errors()[:2])
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
