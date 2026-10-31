"""The hardware knob is the primary input on an RB-01, so drive it everywhere.

Eleven controllers bind the `keypad` event (see services/servicekeypad.js). This
sends every mapped key to every screen and checks nothing throws, then walks the
configured navigation order end to end.
"""

import json
import os
import sys

import known
from plates import Display, Result, WEB

KEYS = ["KEYPAD_MAPPING_PREV", "KEYPAD_MAPPING_NEXT", "KEYPAD_MAPPING_TAP",
        "MediaTrackNext", "MediaTrackPrevious", "SwipeLeft", "SwipeRight"]

# Screens whose controllers listen for the keypad event
LISTENERS = [
    ("synthview", "#synthviewFrame"), ("hsi", "#hsi"), ("airfields", None),
    ("timers", None), ("switchboard", None), ("checklist", None),
    ("aircraft", None), ("autopilot", None), ("radio", None),
    ("attitude", "#attitude-rollpitch"), ("sixpack", None), ("camera", None),
]

ENVIRONMENTAL = ("getusermedia", "notallowederror", "notfounderror",
                 "permission", "speechrecognition", "mediadevices",
                 "notreadableerror")


def environmental(text):
    low = text.lower()
    return any(tok in low for tok in ENVIRONMENTAL)


def nav_order():
    with open(os.path.join(WEB, "settings", "navigation.json")) as fh:
        nav = json.load(fh)
    # the HMI picks a list by aspect ratio; the square one is the superset we test
    return nav.get("navigationSortSquare") or nav.get("navigationSort") or []


def main():
    res = Result()
    failures = []
    known_hits = []

    with Display() as d:
        # 1. every mapped key on every listening screen
        for plate, ready in LISTENERS:
            try:
                d.show(plate, ready, timeout=20)
            except TimeoutError:
                res.check(False, "%-12s reachable" % plate)
                continue

            bad = []
            for key in KEYS:
                before = len(d.page.errors)
                d.keypad(key)
                new = [e for e in d.page.errors[before:] if not environmental(e)]
                for text in new:
                    issue = known.lookup("keypad", plate, text)
                    if issue:
                        known_hits.append((issue, "%s/%s" % (plate, key)))
                    else:
                        bad.append((key, text[:90]))
                        failures.append((plate, key, text[:90]))
                # a key may navigate away; come back before the next one
                if not d.hash().endswith("/" + plate):
                    try:
                        d.show(plate, ready, timeout=15)
                    except TimeoutError:
                        break
            res.check(not bad, "%-12s survives all %d keypad keys" % (plate, len(KEYS)),
                      bad[0] if bad else "")

        # 2. the configured navigation order must be walkable end to end
        order = nav_order()
        res.check(len(order) > 5, "navigation.json defines an order",
                  "%d screens" % len(order))
        broken = []
        for entry in order:
            plate = entry.replace("#/", "") or "home"
            before = len(d.page.errors)
            try:
                d.show(plate, None, timeout=18)
            except TimeoutError:
                broken.append((plate, "did not render"))
                continue
            for text in [e for e in d.page.errors[before:] if not environmental(e)]:
                issue = known.lookup("keypad", plate, text)
                if issue:
                    known_hits.append((issue, "nav:" + plate))
                else:
                    broken.append((plate, text[:80]))
        res.check(not broken, "every screen in the navigation order loads cleanly",
                  broken[:2] if broken else "")

    known.report(known_hits)

    if failures:
        print("\n  \033[31mKEYPAD FAILURES\033[0m")
        for plate, key, err in failures:
            print("    %-12s %-24s %s" % (plate, key, err))

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
