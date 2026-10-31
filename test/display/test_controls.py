"""Press every button on every screen.

For each ng-click control this checks two things a pilot would notice:
  1. the control is actually reachable by touch (nothing covering it), and
  2. pressing it does not throw.

Controls that navigate are fine - the plate is restored afterwards.
"""

import sys

import known
from plates import Display, Result

# Screens in the order the HMI lists them, plus the ones only reachable directly.
PLATES = [
    ("home", None), ("resources", None), ("synthview", "#synthviewFrame"),
    ("hsi", "#hsi"), ("speed", None), ("attitude", "#attitude-rollpitch"),
    ("altimeter", None), ("turnslip", None), ("heading", None),
    ("variometer", None), ("gmetergauge", None), ("sixpack", None),
    ("airfields", None), ("autopilot", None), ("timers", None),
    ("ems", None), ("emsegt", None), ("radio", None), ("checklist", None),
    ("switchboard", None), ("map", "#map_display"), ("radar", "canvas, svg"),
    ("alerts", None), ("charts", None), ("aircraft", None), ("camera", None),
    ("voice", None), ("ota", None),
]

# Plates that deliberately open something full-screen on arrival; the pilot taps
# it away before anything underneath is touchable. resources.js:54 zooms the
# first resource as soon as the list loads (the aircraft has three).
DISMISS_ON_ARRIVAL = {"resources": "backFromZoom($event);"}

# Headless Chrome has no camera, microphone or speech engine. Those failures are
# the environment, not the display.
ENVIRONMENTAL = ("getusermedia", "notallowederror", "notfounderror",
                 "permission", "speechrecognition", "webkitspeechrecognition",
                 "mediadevices", "notreadableerror")


def environmental(text):
    low = text.lower()
    return any(token in low for token in ENVIRONMENTAL)


def main():
    res = Result()
    unreachable, throwing, pressed = [], [], 0
    known_hits = []
    chrome_done = False

    with Display(window="1024,768") as d:
        for plate, ready in PLATES:
            try:
                d.show(plate, ready, timeout=20)
            except TimeoutError:
                res.check(False, "%-12s reachable to test" % plate)
                continue
            if plate in DISMISS_ON_ARRIVAL:
                d.page.pump(0.6)                 # let the plate's own GET land
                d.click_expr(DISMISS_ON_ARRIVAL[plate])
                d.page.pump(0.3)

            all_controls = [c for c in d.controls() if c["visible"]]
            # The navbar/sidebar/FAB chrome is identical on every plate, so click
            # it once (on the first screen) and only the plate's own controls
            # after that. Reachability is still checked everywhere, since that is
            # cheap and does vary by plate.
            if chrome_done:
                controls = [c for c in all_controls if c["scope"] == "plate"]
            else:
                controls = all_controls
                chrome_done = True
            if not all_controls:
                continue

            covered = []
            for c in all_controls:
                # only a genuine overlay counts; off-viewport just needs scrolling
                if not c["covered"]:
                    continue
                issue = known.lookup("controls", plate, c["expr"])
                if issue:
                    known_hits.append((issue, "%s/%s" % (plate, c["expr"][:18])))
                else:
                    covered.append(c)
                    unreachable.append((plate, c["expr"], c["covering"]))

            # Address controls by what they do, not by index: a click that
            # re-renders the plate shifts every index after it.
            seen = {}
            for c in controls:
                nth = seen.get(c["expr"], 0)
                seen[c["expr"]] = nth + 1
                before = len(d.page.errors)
                if not d.click_expr(c["expr"], nth):
                    continue
                pressed += 1
                d.page.pump(0.45)

                for text in [e for e in d.page.errors[before:] if not environmental(e)]:
                    issue = known.lookup("controls", plate, text)
                    if issue:
                        known_hits.append((issue, "%s/%s" % (plate, c["expr"][:24])))
                    else:
                        throwing.append((plate, c["expr"], c["label"], text[:110]))

                # A control may have navigated, opened a modal, or reloaded.
                if not d.hash().endswith("/" + plate) and plate != "home":
                    try:
                        d.show(plate, ready, timeout=15)
                    except TimeoutError:
                        break

            res.check(not covered, "%-12s no control is covered (of %d)"
                      % (plate, len(all_controls)),
                      "%d covered" % len(covered) if covered else "")
            res.check(not [t for t in throwing if t[0] == plate],
                      "%-12s no control throws" % plate,
                      len([t for t in throwing if t[0] == plate]) or "")
            d.shot("controls_%s" % plate)

    known.report(known_hits)

    print("\n  pressed %d controls across %d screens" % (pressed, len(PLATES)))
    if unreachable:
        print("\n  \033[33mUNREACHABLE CONTROLS\033[0m")
        for plate, expr, covering in unreachable:
            print("    %-12s %-40s covered by %s" % (plate, expr, covering))
    if throwing:
        print("\n  \033[31mCONTROLS THAT THROW\033[0m")
        for plate, expr, label, err in throwing:
            print("    %-12s %-34s %s" % (plate, expr, err))

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
