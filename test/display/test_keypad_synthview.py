"""The synthetic view: the knob orbits the camera, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: a direct page.

    PREV  orbit left 10 degrees      NEXT  orbit right 10 degrees      TAP  back to the pilot's view

The clean-up removed the cases bound to the raw names MediaTrackNext / MediaTrackPrevious
(zoom), which the service never sends to a plate: those names are PREV and NEXT in keypad.json,
and so they orbit like any other PREV / NEXT key.
"""

import sys

import keypadtest as kt
from plates import Result

SCOPE = "angular.element(document.getElementById('synthviewFrame')).scope()"
STATE = "(() => { const s = %s; return {reset: s.remote.reset, direction: s.cameraRotating.direction}; })()" % SCOPE


def state(d):
    return d.page.eval(STATE)


def main():
    res = Result()
    d = kt.boot()
    try:
        d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
        kt.route(d, "synthview", "#synthviewFrame")
        d.srv.wait_for_client("/situation", timeout=10)
        # The scene has nothing to orbit around until the terrain is in: turn until it is
        for _ in range(60):
            d.srv.push_situation(GPSLatitude=43.6, GPSLongitude=10.4, GPSFixQuality=1, GPSAltitudeMSL=1500)
            d.key(kt.NEXT, settle=0.3)
            if state(d)["reset"]:
                break
        start = state(d)
        res.check(start["reset"] is True, "NEXT takes the camera off the pilot's view", start)
        seen = []
        for key in (kt.NEXT, kt.NEXT, kt.PREV, "ArrowRight", "MediaTrackNext", "MediaTrackPrevious"):
            d.key(key, settle=0.15)
            seen.append(state(d)["direction"] - start["direction"])
        res.check(seen == [10, 20, 10, 20, 10, 20], "each click orbits 10 degrees, the MediaTrack keys too", seen)
        d.ws_key(kt.NEXT)
        res.check(state(d)["direction"] - start["direction"] == 30, "and the Pi's keyboard", state(d))
        d.key(kt.TAP)
        res.check(state(d)["reset"] is False, "TAP brings back the pilot's view", state(d))
        res.check(d.hash() == "#/synthview", "and the plate never changed", d.hash())
        res.check(not kt.errors(d, "synthview"), "no JS error", kt.errors(d, "synthview")[:3])
    finally:
        kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
