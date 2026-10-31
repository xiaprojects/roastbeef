"""The slip/skid bar under the roll pointer on the attitude plate.

A PFD hangs the slip/skid indicator under the roll pointer and slides it away
from the pointer, one bar width at full scale, which is one ball width of a
traditional inclinometer. Full scale here is 10 degrees and a positive
AHRSSlipSkid sends it left - the scale and the sign of the shared AHRS renderer
in web/plates/js/ahrs.js, so the ball and the synthetic view read alike.

Travel is measured in bar widths off the centred position rather than in pixels,
so the test says what the instrument has to do and not what the panel happens to
be sized at.
"""


import sys

from plates import Display, Result

PX = 2            # layout rounding, in pixels
AHRS_INVALID = 3276.7

BAR_JS = """(function () {
    var e = document.querySelector('.attitude-slipskid');
    if (!e) return {shown: false};
    var r = e.getBoundingClientRect();
    // .attitude-center carries the pointer artwork and shares the overlays'
    // containing block, so it is the frame both are positioned in
    var ball = document.querySelector('.attitude-center').getBoundingClientRect();
    return {
        shown: true,
        left: r.left - ball.left,
        centre: r.left + r.width / 2 - ball.left,
        width: r.width,
        top: r.top - ball.top,
        ballCentre: ball.width / 2,
        ballHeight: ball.height
    };
})()"""

LEVEL = {"GPSAltitudeMSL": 3500.0, "BaroPressureAltitude": 3500.0,
         "GPSFixQuality": 2, "AHRSPitch": 2.0, "AHRSRoll": 0.0,
         "BaroSourceType": 1, "BaroVerticalSpeed": 0.0}


def at_skid(d, seq, skid):
    """Fly at a slip angle and read the bar once it has slid into place."""
    d.fly(frames=4, interval=0.25, TestSeq=seq, AHRSSlipSkid=skid, **LEVEL)
    d.page.wait("window.situation.TestSeq === %d" % seq, timeout=10,
                label="skid %.1f published" % skid)
    d.page.pump(1.0)  # the bar transitions over 0.4s
    return d.page.eval(BAR_JS)


def main():
    res = Result()
    with Display() as d:
        d.show("attitude", "#attitude-rollpitch")

        # Coordinated: the bar sits centred under the pointer, which is drawn on
        # the centreline, and high on the ball where the pointer is
        zero = at_skid(d, 1, 0.0)
        res.check(zero["shown"], "the bar is on the attitude plate", zero)
        res.check(abs(zero["centre"] - zero["ballCentre"]) <= PX,
                  "coordinated flight centres it under the roll pointer",
                  "%.1f vs %.1f" % (zero["centre"], zero["ballCentre"]))
        res.check(0.08 * zero["ballHeight"] < zero["top"] < 0.16 * zero["ballHeight"],
                  "it hangs just under the pointer, not out in the sky",
                  "%.0f px down a %.0f px ball" % (zero["top"], zero["ballHeight"]))

        # One bar width of travel is full scale, and full scale is 10 degrees
        full = at_skid(d, 2, 10.0)
        res.check(abs((zero["left"] - full["left"]) - zero["width"]) <= PX,
                  "10 degrees of slip is one bar width of travel",
                  "%.1f px of a %.1f px bar" % (zero["left"] - full["left"], zero["width"]))
        res.check(full["left"] < zero["left"],
                  "a positive slip sends it left, like the ball")

        # The other way, and proportional in between
        right = at_skid(d, 3, -10.0)
        res.check(abs((right["left"] - zero["left"]) - zero["width"]) <= PX
                  and right["left"] > zero["left"],
                  "a negative slip sends it right by the same amount",
                  "%.1f px" % (right["left"] - zero["left"]))
        half = at_skid(d, 4, 5.0)
        res.check(abs((zero["left"] - half["left"]) - zero["width"] / 2) <= PX,
                  "half scale is half a bar width",
                  "%.1f px" % (zero["left"] - half["left"]))

        # Past full scale it pegs rather than sliding off the pointer
        pegged = at_skid(d, 5, 35.0)
        res.check(abs(pegged["left"] - full["left"]) <= PX,
                  "it pegs at one bar width however hard the slip",
                  "%.1f vs %.1f" % (pegged["left"], full["left"]))

        # With no attitude solution the AHRS sends 3276.7 for every angle:
        # clamping that would peg the bar hard over and show a slip that is not
        # happening, so it goes away instead
        res.check(at_skid(d, 6, AHRS_INVALID)["shown"] is False,
                  "no attitude solution hides the bar rather than pegging it")
        res.check(at_skid(d, 7, 0.0)["shown"] is True,
                  "and it comes back when the AHRS does")

        # Same gate as the tapes: the six-pack has its own slip ball
        d.show("sixpack", None)
        d.fly(frames=3, interval=0.25, TestSeq=8, AHRSSlipSkid=5.0, **LEVEL)
        d.page.wait("window.situation.TestSeq === 8", timeout=10, label="sixpack frame")
        res.check(d.page.eval("document.querySelectorAll('.attitude-slipskid').length") == 0,
                  "the bar stays off the six-pack ball, which has a slip ball of its own")

        errs = d.js_errors()
        res.check(not errs, "no JS errors across the slip/skid run", errs[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
