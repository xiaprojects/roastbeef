"""Unusual-attitude recovery chevrons on the attitude ball.

Three red chevrons point at the horizon when the pitch gets dangerous: down when
the nose is high, up when it is low. Garmin's experimental EFIS puts them up past
50 degrees nose up and 30 nose down, and declutters the secondary readouts while
they are there - that is the behaviour asserted here, including the hysteresis
that stops the warning blinking while the aircraft hangs on the threshold.

Asserted on the DOM and on where the stack actually lands on screen, not on
pixels: what matters is that it is the right count, the right way up, and on the
side of the ball the pilot has to fly back towards.

The synthetic view draws the same stack from the same threshold (globalPitchChevrons
in global.js), and stands its HSI down to make room - checked here on a screen
tall enough to have one.
"""


import sys

from plates import Display, Result

STACK_JS = """(function () {
    var e = document.querySelector('.attitude-chevrons');
    if (!e) return {shown: false};
    var r = e.getBoundingClientRect();
    var ballEl = document.querySelector('.attitude-center');
    var ball = ballEl ? ballEl.getBoundingClientRect()
                      : {top: 0, bottom: window.innerHeight};
    return {
        shown: true,
        count: e.children.length,
        down: e.className.indexOf('attitude-chevrons-down') >= 0,
        up: e.className.indexOf('attitude-chevrons-up') >= 0,
        above: (r.top + r.bottom) / 2 < (ball.top + ball.bottom) / 2,
        visible: r.width > 0 && r.height > 0,
        size: Math.round(r.width) + 'x' + Math.round(r.height)
    };
})()"""


def at_pitch(d, seq, pitch):
    """Fly to a pitch, wait for the frame to be published, and read the stack."""
    d.fly(frames=3, interval=0.25, TestSeq=seq, AHRSPitch=pitch, AHRSRoll=0.0)
    d.page.wait("window.situation.TestSeq === %d" % seq, timeout=10,
                label="pitch %.0f published" % pitch)
    d.page.pump(0.3)
    return d.page.eval(STACK_JS)


def wind_shown(d):
    return d.page.eval("!!document.querySelector('.attitude-wind')")


def hsi_height(d):
    """0 when the synthetic view's HSI is not on screen (ng-show sets display:none)."""
    return d.page.eval("var h = document.querySelector('#hsi');"
                       " h ? h.getBoundingClientRect().height : 0")


def synth_checks(res, d):
    """The 3D view raises the same stack from the same threshold."""
    d.show("synthview", "#synthviewFrame")
    res.check(at_pitch(d, 20, 5.0)["shown"] is False,
              "no chevrons on the synthetic view in level flight")
    c = at_pitch(d, 21, 62.0)
    res.check(c["shown"] and c["count"] == 3 and c["down"] and c["visible"]
              and c["above"],
              "three chevrons over the synthetic view past 50 nose up", c)
    c = at_pitch(d, 22, -41.0)
    res.check(c["shown"] and c["count"] == 3 and c["up"] and c["visible"]
              and c["above"] is False,
              "three chevrons over the synthetic view past 30 nose down", c)
    res.check(at_pitch(d, 23, 0.0)["shown"] is False,
              "they clear when the attitude is recovered")


def hsi_declutter(res):
    """On a tall screen the synthetic view carries an HSI where the nose-low
    stack has to go, so it stands down while the warning is up."""
    with Display(window="768,1100") as d:
        d.show("synthview", "#synthviewFrame")
        at_pitch(d, 30, 2.0)
        res.check(hsi_height(d) > 0,
                  "the synthetic view shows its HSI on a tall screen")
        at_pitch(d, 31, 62.0)
        res.check(hsi_height(d) == 0,
                  "the HSI stands down for the recovery chevrons")
        at_pitch(d, 32, 2.0)
        res.check(hsi_height(d) > 0,
                  "and comes back once the attitude is recovered")
        errs = d.js_errors()
        res.check(not errs, "no JS errors on the synthetic view", errs[:1])


def main():
    res = Result()
    with Display() as d:
        d.show("attitude", "#attitude-rollpitch")

        # Steep is not dangerous: no warning in anything a pilot flies on purpose
        for seq, pitch, label in [(1, 0.0, "level flight"),
                                  (2, 30.0, "a steep climb"),
                                  (3, -25.0, "a steep descent")]:
            res.check(at_pitch(d, seq, pitch)["shown"] is False,
                      "no chevrons in %s" % label, "%.0f deg" % pitch)

        # A dead AHRS sends 3276.7 for every angle: clamped like a number that
        # would hold the warning on for ever
        res.check(at_pitch(d, 12, 3276.7)["shown"] is False,
                  "no attitude solution raises no warning")

        # Nose high past 50: push, the horizon is below
        c = at_pitch(d, 4, 62.0)
        res.check(c["shown"] and c["count"] == 3 and c["down"] and c["visible"],
                  "three chevrons past 50 nose up", c)
        res.check(c["above"], "nose-high chevrons sit above the aircraft symbol",
                  c["size"])
        res.check(not wind_shown(d),
                  "the wind readout declutters while the warning is up")

        # Hysteresis: it holds through the noise at the limit, and once it has
        # cleared it takes the full threshold again to come back
        res.check(at_pitch(d, 5, 49.0)["down"] is True,
                  "warning holds just under the threshold")
        res.check(at_pitch(d, 6, 47.0)["shown"] is False,
                  "warning clears when pitch comes back")
        res.check(at_pitch(d, 7, 49.0)["shown"] is False,
                  "49 does not re-arm it, it takes 50 again")
        res.check(wind_shown(d), "the wind readout comes back with it")

        # Nose low past 30: pull, the horizon is above
        c = at_pitch(d, 8, -41.0)
        res.check(c["shown"] and c["count"] == 3 and c["up"] and c["visible"],
                  "three chevrons past 30 nose down", c)
        res.check(c["above"] is False,
                  "nose-low chevrons sit below the aircraft symbol", c["size"])
        res.check(at_pitch(d, 9, -29.0)["up"] is True,
                  "warning holds just under the threshold")
        res.check(at_pitch(d, 10, -27.0)["shown"] is False,
                  "warning clears when pitch comes back")

        # The ball in the six-pack shows it too: a recovery cue is not a
        # full-screen-only luxury
        d.show("sixpack", None)
        d.fly(frames=4, interval=0.25, TestSeq=11, AHRSPitch=62.0, AHRSRoll=0.0)
        d.page.wait("window.situation.TestSeq === 11", timeout=10, label="sixpack frame")
        d.page.pump(0.4)
        res.check(d.page.eval(
            "document.querySelectorAll('.attitude-chevrons .attitude-chevron').length") == 3,
            "the recovery cue is on the six-pack ball as well")

        synth_checks(res, d)

        errs = d.js_errors()
        res.check(not errs, "no JS errors across the chevron run", errs[:1])

    hsi_declutter(res)

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
