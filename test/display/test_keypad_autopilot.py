"""The autopilot plate on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: the stops are the ones the owner chose
(2026-11-18), in this order:

- the HSI panel: TAP lets the knob turn the approach direction (override radial), 1 degree a
  click; TAP again releases it;
- the HOME button: TAP = a touch on it (direct-to home);
- each waypoint of the flight plan: TAP = a touch on the row (direct-to it);
- each airfield of the list: TAP = a touch on the row (direct-to it).

Nothing else is a stop: not the AHRS, destination and forecast panels, not Nearest, STOP AP,
the waypoint trash, Drop Route, the GPX import or the sort toggle. No focus on entry; after a
direct-to by the knob the knob lands on the HSI panel, to set the approach direction.
"""

import json
import re
import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] #hsi_panel"
SCOPE = "angular.element(document.getElementById('hsi_panel')).scope()"
OVERRIDE = SCOPE + ".overrideHSI"
LABEL = "document.querySelector('[ui-view] #overrideHSI').className"
HOME = {"Lat": 43.7, "Lon": 10.4, "Ele": 10, "Cmt": "LIRP HOME"}
NOT_STOPS = """[...document.querySelectorAll(['#ahrs_panel', '#dest_panel', '#forecast_panel',
    'button[ng-click^=directToNearest]', 'button[ng-click^=autopilotStop]', 'a[ng-click^=dropWaypoint]',
    'button[ng-click^=dropWaypoints]', 'input[type=file]', 'a[ng-click*=airfieldsReload]'].map(s => '[ui-view] ' + s).join(', '))]
    .filter(e => e.hasAttribute('data-keypad')).map(e => e.id || e.outerHTML.slice(0, 60))"""


def route():
    return [{"Lat": 43.68 + n * 0.1, "Lon": 10.39 + n * 0.1, "Ele": 100, "Status": 0, "Cmt": "WP%d" % n}
            for n in range(3)]


def setup(d):
    d.srv.route = route()
    d.srv.settings["Autopilot_HomeWaypoint"] = HOME


def targets(d):
    out = []
    for path, body in d.srv.posted:
        if re.sub("/+", "/", path.split("?")[0]) == "/autopilot" and body.strip():
            pts = json.loads(body)
            out.append([p.get("Cmt") for p in pts if p.get("Status") == 1])   # WAYPOINT_STATUS_TARGET
    return out


def show(d, reset=False):
    if reset:    # a fresh plan of three waypoints, read again on entry
        d.srv.route = route()
        d.show("emsegt", None)
        d.page.pump(0.3)
    kt.route(d, "autopilot", READY)
    d.page.wait("document.querySelectorAll('[ui-view] tr[id^=line_0_]').length == 3", timeout=10, label="waypoints")
    d.page.wait("document.querySelectorAll('[ui-view] tr[id^=airfield_]').length > 3", timeout=10, label="airfields")
    d.srv.wait_for_client("/situation", timeout=10)
    d.srv.push_situation(GPSLatitude=43.6, GPSLongitude=10.3, GPSFixQuality=1, GPSTrueCourse=90)
    d.page.pump(0.5)


def direct(d, res, index, want, label):
    """Knob to stop `index`, TAP: a direct-to `want`, and the knob lands on the HSI."""
    kt.go_to(d, index)
    before = len(targets(d))
    d.key(kt.TAP, settle=0.8)
    got = targets(d)[before:]
    res.check(got and got[-1] == [want], "TAP on %s flies direct to it, as a touch does" % label, (got, want))
    res.check(kt.lit(d) == ["hsi"] and kt.focus(d)["mode"] == "browse" and d.hash() == "#/autopilot",
              "after it the knob is on the HSI panel", (kt.lit(d), kt.focus(d), d.hash()))


def main():
    res = Result()
    d = kt.boot(setup=setup)
    try:
        show(d)
        names = kt.stops(d)
        airfields = d.page.eval("[...document.querySelectorAll('[ui-view] tr[id^=airfield_]')].map(e => 'AF ' + e.querySelector('strong').textContent.trim())")
        res.check(names == ["hsi", "home", "WP WP0", "WP WP1", "WP WP2"] + airfields and len(airfields) > 3,
                  "the stops: HSI, HOME, the plan's waypoints, the airfields (%d)" % len(names), names[:7])
        res.check(d.page.eval(NOT_STOPS) == [], "nothing else is a stop", d.page.eval(NOT_STOPS))
        kt.check_entry(d, res, "autopilot", lambda: len(d.srv.posted))
        kt.check_walk(d, res, "autopilot", want=names[:8] if len(names) <= 8 else None, plate="autopilot")
        kt.check_socket(d, res, "autopilot")

        # HSI: TAP, turn the approach direction, TAP releases
        kt.first(d)
        start = d.page.eval(OVERRIDE)
        d.key(kt.TAP)
        editing = (kt.focus(d)["mode"], d.page.eval(LABEL))
        seen = []
        for key in (kt.NEXT, kt.NEXT, kt.NEXT, kt.PREV):
            d.key(key, settle=0.1)
            seen.append(d.page.eval(OVERRIDE) - start)
        res.check(editing[0] == "edit" and "label-danger" in editing[1] and seen == [1, 2, 3, 2] and kt.lit(d) == ["hsi"],
                  "TAP on the HSI: the knob turns the approach direction, 1 degree a click", (editing, seen, kt.lit(d)))
        text = d.page.eval("document.querySelector('[ui-view] #overrideHSI').textContent")
        res.check(("%d" % (start + 2)) in text, "the override shows on the panel", text)
        d.key(kt.TAP)
        released = (kt.focus(d)["mode"], d.page.eval(OVERRIDE) - start, d.page.eval(LABEL))
        d.key(kt.NEXT)
        res.check(released[0] == "browse" and released[1] == 2 and "label-warning" in released[2] and kt.lit(d) == ["home"],
                  "TAP again releases it, the direction kept; NEXT moves on to HOME", (released, kt.lit(d)))

        direct(d, res, 3, "WP1", "a waypoint of the plan")
        airfield = kt.stops(d)[5]
        direct(d, res, 5, airfield[3:], "an airfield")
        direct(d, res, 1, HOME["Cmt"], "HOME")

        # A touch with the knob unused lights nothing
        show(d, reset=True)
        d.page.eval("document.querySelectorAll('[ui-view] tr[id^=line_0_]')[2].click()")
        d.page.pump(0.8)
        res.check(targets(d)[-1] == ["WP2"] and kt.lit(d) == [], "a touch on a row flies there, the knob unused lights nothing",
                  (targets(d)[-1:], kt.lit(d)))
        kt.check_return(d, res, "autopilot", "autopilot", READY)
        res.check(not kt.errors(d, "autopilot"), "no JS error", kt.errors(d, "autopilot")[:3])
    finally:
        kt.close(d)
    for width, height in kt.PANELS[:3]:
        d = kt.boot((width, height), setup)
        try:
            show(d)
            kt.go_to(d, 0)
            off = []
            for i in range(7):    # HSI, HOME, three waypoints, two airfields
                b = d.page.eval(kt.LIT_BOX)
                if b is None or (width == height and ((b["x"] - width / 2) ** 2 + (b["y"] - height / 2) ** 2) ** 0.5 > kt.ROUND_RADIUS) \
                        or (width != height and (b["top"] < -1 or b["bottom"] > height + 1)):
                    off.append((i, b))
                d.key(kt.NEXT, settle=0.1)
            res.check(not off, "%dx%d: the stops are on the glass when the knob is on them" % (width, height), off[:3])
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
