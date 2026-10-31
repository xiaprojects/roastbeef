"""The vertical speed strip on the attitude plate.

A magenta bar growing from a zero line at mid strip, up for a climb and down for
a sink, full scale at the same +/-2000 fpm as the variometer gauge, with the
digits riding the tip of the bar and blanked near zero the way a PFD blanks them.

Measured on the rendered rectangles rather than on the bound style, so the test
covers the CSS as well as the arithmetic: the bar has to end up on the right side
of the zero line, the right length, and inside the strip.
"""


import sys

from plates import Display, Result

PX = 4  # rounding and border slack, in pixels

VSI_JS = """(function () {
    var s = document.querySelector('.attitude-vsi');
    if (!s) return {shown: false};
    var sr = s.getBoundingClientRect();
    var b = s.querySelector('.attitude-vsi-bar').getBoundingClientRect();
    var z = s.querySelector('.attitude-vsi-zero').getBoundingClientRect();
    var v = s.querySelector('.attitude-vsi-value');
    var vr = v ? v.getBoundingClientRect() : null;
    return {
        shown: true,
        zero: Math.round(z.top),
        half: Math.round(sr.height / 2),
        top: Math.round(sr.top),
        barTop: Math.round(b.top),
        barBottom: Math.round(b.bottom),
        barHeight: Math.round(b.height),
        inside: b.left >= sr.left - 1 && b.right <= sr.right + 1,
        digits: v ? v.innerText.trim() : "",
        digitsMid: vr ? Math.round(vr.top + vr.height / 2) : null
    };
})()"""

LEVEL = {"GPSAltitudeMSL": 3500.0, "BaroPressureAltitude": 3500.0,
         "GPSFixQuality": 2, "AHRSPitch": 2.0, "AHRSRoll": 0.0,
         "BaroSourceType": 1, "GPSVerticalSpeed": 0.0}


def at_vs(d, seq, vs, **extra):
    """Fly at a vertical speed and read the strip once the bar has eased into place."""
    frame = dict(LEVEL, TestSeq=seq, BaroVerticalSpeed=vs)
    frame.update(extra)
    d.fly(frames=4, interval=0.25, **frame)
    d.page.wait("window.situation.TestSeq === %d" % seq, timeout=10,
                label="vs %.0f published" % vs)
    d.page.pump(1.0)  # the bar transitions over 0.4s
    return d.page.eval(VSI_JS)


def main():
    res = Result()
    with Display() as d:
        d.show("attitude", "#attitude-rollpitch")

        # 750 fpm up: the bar stands on the zero line and reaches 3/8 of the way
        # to the top of the strip, with the digits at its tip
        s = at_vs(d, 1, 750.0)
        res.check(s["shown"] and s["inside"], "the strip is on the attitude plate", s)
        res.check(abs(s["barBottom"] - s["zero"]) <= PX and s["barTop"] < s["zero"],
                  "a climb draws the bar above the zero line", s)
        res.check(abs(s["barHeight"] - 0.375 * s["half"]) <= PX,
                  "750 of 2000 fpm is 3/8 of half the strip",
                  "%d px of %d" % (s["barHeight"], s["half"]))
        res.check(s["digits"] == "+750", "the digits read the climb", s["digits"])
        res.check(abs(s["digitsMid"] - s["barTop"]) <= PX + 2,
                  "the digits ride the tip of the bar",
                  "%s vs %s" % (s["digitsMid"], s["barTop"]))

        # 1500 fpm down: the other way, same arithmetic
        s = at_vs(d, 2, -1500.0)
        res.check(abs(s["barTop"] - s["zero"]) <= PX and s["barBottom"] > s["zero"],
                  "a sink draws the bar below the zero line", s)
        res.check(abs(s["barHeight"] - 0.75 * s["half"]) <= PX,
                  "1500 of 2000 fpm is 3/4 of half the strip",
                  "%d px of %d" % (s["barHeight"], s["half"]))
        res.check(s["digits"] == "-1500", "the digits read the sink", s["digits"])
        res.check(abs(s["digitsMid"] - s["barBottom"]) <= PX + 2,
                  "the digits ride the tip of the bar")

        # Level: a bare scale, no number twitching around zero
        s = at_vs(d, 3, 20.0)
        res.check(s["digits"] == "" and s["barHeight"] <= PX,
                  "level flight leaves the scale bare", s)
        res.check(at_vs(d, 4, -90.0)["digits"] == "",
                  "and so does anything under 100 fpm")

        # Past full scale the bar pegs, but the digits still tell the truth
        s = at_vs(d, 5, 3200.0)
        res.check(abs(s["barHeight"] - s["half"]) <= PX
                  and abs(s["barTop"] - s["top"]) <= PX,
                  "the bar pegs at full scale", s)
        res.check(s["digits"] == "+3200", "the digits keep reading past full scale",
                  s["digits"])

        # Digits are rounded, so the last 50 fpm of baro noise cannot flicker them
        res.check(at_vs(d, 6, 735.0)["digits"] == "+750", "735 fpm reads +750")
        res.check(at_vs(d, 7, 724.0)["digits"] == "+700", "724 fpm reads +700")

        # No baro fitted: the GPS rate is the only one there is, and it arrives
        # in feet per second
        s = at_vs(d, 8, 0.0, BaroSourceType=0, GPSVerticalSpeed=10.0)
        res.check(s["digits"] == "+600",
                  "without a baro the GPS rate drives the strip", s["digits"])
        res.check(abs(s["barBottom"] - s["zero"]) <= PX and s["barTop"] < s["zero"],
                  "and it draws the same way up", s)

        # Same gate as the other tapes: the six-pack ball is too small for it
        d.show("sixpack", None)
        d.fly(frames=3, interval=0.25, TestSeq=9, BaroVerticalSpeed=750.0, **LEVEL)
        d.page.wait("window.situation.TestSeq === 9", timeout=10, label="sixpack frame")
        res.check(d.page.eval("document.querySelectorAll('.attitude-vsi').length") == 0,
                  "the strip stays off the six-pack ball, like the other tapes")

        errs = d.js_errors()
        res.check(not errs, "no JS errors across the variometer run", errs[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
