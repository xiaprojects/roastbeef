"""Does servicesituation.js derive the wind, and does the attitude plate show it?

The wind comes from windestimator.js, two ways: an airspeed + GPS fit over a
course change, which never looks at the heading (WindSource "tas"), and, while
no fit is held, the compass triangle averaged over 45 s of steady flight
("ias", or "gs" when the ground speed stands in for a missing airspeed). The
estimator runs on the GPS clock the frames carry, so every frame here advances
GPSLastFixSinceMidnightUTC by a data second, and a case that must start from
nothing first jumps the clock past every window and the hold.

Three parts:
- the compass triangle, asserted on `window.situation` (the frame the service
  publishes) rather than on pixels. Each case is a run of frames with a known
  heading, track, ground speed and airspeed; the expected wind was worked out by
  hand (and in triangle() below) - the display must agree to half a knot and
  one degree. They fly outside the variation grid, where the compass is taken
  as true; one more flies inside it with a magnetic compass, which the
  variation must turn true. Then the averaging and the turn gate.
- the attitude plate's wind box: the digits, the EST tag that marks a
  drift-only estimate, and the angle the arrow is turned to, against the true
  heading when the compass reads magnetic. The readout is
  damped over ~5s, so each case is preceded by frames with no estimate: that
  resets the filter, and the first estimate is then shown undamped and exact.
- the airspeed fit: a full turn flown with a compass 12 degrees out and a TAS
  reading 2.5% high must still give the wind to half a knot and learn the 2.5%,
  hold it through straight flight, and give it up after 2000 ft or 15 minutes.
"""


import json
import math
import os
import sys

from plates import Display, Result, WEB

SPEED_TOL = 0.5     # kt
DIR_TOL = 1.0       # degrees


class Clock:
    """The GPS clock the frames carry, in seconds since midnight."""

    def __init__(self, t=1000.0):
        self.t = t

    def tick(self, dt=1.0):
        self.t += dt
        return self.t

    def jump(self):
        """Past the 45 s average, the 180 s fit window and the 900 s hold."""
        self.t += 2000.0


CLOCK = Clock()


# Where the hand-worked cases fly: outside the variation grid (Europe as
# shipped), so there is no variation and the compass is taken as true. The
# variation cases fly on the 43N 12E grid node, at the grid's own date.
NO_VARIATION = (10.0, 10.0)
NODE = (43.0, 12.0)
NODE_VARIATION = json.load(open(os.path.join(WEB, "settings", "deviation.json")))["declination"][16][44]
GRID_DATE = "2027-07-02T12:00:00Z"   # 2027.5


def frame(seq, hdg, trk, gs, ias, pa=0.0, fix=2, roll=0.0, where=NO_VARIATION):
    """A complete frame: every field the estimate reads is set explicitly, because
    the fake backend keeps whatever the previous case pushed."""
    return {"TestSeq": seq, "AHRSMagHeading": hdg, "GPSTrueCourse": trk,
            "GPSGroundSpeed": gs, "IndicatedAirSpeed": ias,
            "BaroPressureAltitude": pa, "GPSAltitudeMSL": pa, "GPSFixQuality": fix,
            "AHRSRoll": roll, "AHRSPitch": 0.0, "GPSVerticalSpeed": 0.0,
            "GPSLatitude": where[0], "GPSLongitude": where[1], "GPSTime": GRID_DATE}


def feed(d, frames, dt=1.0, interval=0.15):
    """Push frames one after the other, each dt data seconds after the last,
    faster than real time (the service handles at most one frame per 100 ms)."""
    for f in frames:
        d.srv.push_situation(GPSLastFixSinceMidnightUTC=CLOCK.tick(dt), **f)
        d.page.pump(interval)


def situation(d):
    return json.loads(d.page.eval("JSON.stringify(window.situation)"))


def settle(d, f, cond, tries=16):
    """Keep `f` coming, a data second apart, until the published situation
    carries it and satisfies cond (the service publishes at least once a second).
    Returns the last published situation either way."""
    s = {}
    for _ in range(tries):
        d.srv.push_situation(GPSLastFixSinceMidnightUTC=CLOCK.tick(1.0), **f)
        d.page.pump(0.3)
        s = situation(d)
        if s.get("TestSeq") == f["TestSeq"] and cond(s):
            break
    return s


def wind_of(s):
    return "%s %.2f kt from %.1f" % (s.get("WindSource"), s.get("WindSpeed", -1),
                                     s.get("WindDirection", -1))


def dir_err(a, b):
    return abs(((a - b + 540) % 360) - 180)


def matches(s, source, speed, direction, speed_tol=SPEED_TOL, dir_tol=DIR_TOL):
    return (s.get("WindValid") is True and s.get("WindSource") == source
            and abs(s.get("WindSpeed", -1) - speed) <= speed_tol
            and dir_err(s.get("WindDirection", -1), direction) <= dir_tol)


def vector_err(s, speed, direction):
    """Knots between the published wind and (speed, direction FROM)."""
    if s.get("WindValid") is not True:
        return float("inf")
    r = math.radians
    a, b = s.get("WindSpeed", 0), s.get("WindDirection", 0)
    return math.hypot(a * math.sin(r(b)) - speed * math.sin(r(direction)),
                      a * math.cos(r(b)) - speed * math.cos(r(direction)))


def triangle(hdg, trk, gs, tas):
    """Ground vector minus air vector: (east, north) where the wind blows TO."""
    r = math.radians
    return (gs * math.sin(r(trk)) - tas * math.sin(r(hdg)),
            gs * math.cos(r(trk)) - tas * math.cos(r(hdg)))


def polar(e, n):
    """(speed, direction FROM) of a wind vector."""
    return math.hypot(e, n), (math.degrees(math.atan2(-e, -n)) + 360) % 360


def expect_wind(res, d, label, f, source, speed, direction):
    CLOCK.jump()
    feed(d, [f] * 6)
    s = settle(d, f, lambda s: s.get("WindValid") is True)
    res.check(matches(s, source, speed, direction), label, wind_of(s))


def expect_no_wind(res, d, label, f):
    CLOCK.jump()
    feed(d, [f] * 6)
    s = settle(d, f, lambda s: True, tries=3)
    res.check(s.get("TestSeq") == f["TestSeq"] and s.get("WindValid") is False
              and s.get("WindSpeed") == 0 and s.get("WindSource") == "",
              label, "valid=%r speed=%r source=%r" % (
                  s.get("WindValid"), s.get("WindSpeed"), s.get("WindSource")))


def compass_checks(res, d):
    # Scenario A: an airspeed source. Track 10 right of heading at equal
    # speeds is a pure crosswind from the left (west), 100*sin(10) kt.
    expect_wind(res, d, "A: crosswind from drift with IAS",
                frame(1, hdg=0, trk=10, gs=100, ias=100), "ias", 17.43, 275.0)
    # Ground speed 20 kt below airspeed on the same line: 20 kt on the nose
    expect_wind(res, d, "A: headwind from IAS minus GS",
                frame(2, hdg=0, trk=0, gs=80, ias=100), "ias", 20.0, 0.0)
    # At 5000 ft the same IAS is a 107.7 kt TAS, so the headwind grows
    expect_wind(res, d, "A: IAS is corrected to TAS at altitude",
                frame(3, hdg=0, trk=0, gs=80, ias=100, pa=5000.0), "ias", 27.73, 0.0)

    # The same crosswind with a compass that reads magnetic: on the grid node
    # the true heading 000 reads 360 - variation, and the wind must not move
    expect_wind(res, d, "A: magnetic compass turned true with the variation (%+.1f)" % NODE_VARIATION,
                frame(10, hdg=360 - NODE_VARIATION, trk=10, gs=100, ias=100, where=NODE),
                "ias", 17.43, 275.0)

    # Scenario B: no airspeed, the ground speed stands in for it
    expect_wind(res, d, "B: crosswind from drift without IAS",
                frame(4, hdg=0, trk=10, gs=100, ias=0), "gs", 17.43, 275.0)
    # Heading 350 / track 010 is a 20 degree drift, not 340
    expect_wind(res, d, "B: heading/track difference wraps at north",
                frame(5, hdg=350, trk=10, gs=100, ias=0), "gs", 34.73, 270.0)

    # Gates
    expect_no_wind(res, d, "no estimate when heading and track disagree by 45+",
                   frame(6, hdg=0, trk=60, gs=100, ias=0))
    expect_no_wind(res, d, "no estimate without a GPS fix",
                   frame(7, hdg=0, trk=10, gs=100, ias=0, fix=0))
    expect_no_wind(res, d, "no estimate on a negative airspeed",
                   frame(8, hdg=0, trk=10, gs=100, ias=-5))
    expect_no_wind(res, d, "no estimate taxiing (ground speed under 30 kt)",
                   frame(14, hdg=0, trk=10, gs=20, ias=0))

    # The estimate does not depend on the QNH source: switch the altimeter to
    # a pilot-set QNH (the AUTO branch is skipped) and the wind is still there
    d.page.eval("dispatchEvent(new CustomEvent('SituationUpdatedByPilot',"
                " {detail: {AutoQNH: false, QNH: 1020}}))")
    expect_wind(res, d, "B: still estimated with a pilot-set QNH",
                frame(9, hdg=0, trk=10, gs=100, ias=0), "gs", 17.43, 275.0)
    s = situation(d)
    res.check(s.get("AutoQNH") is False and s.get("QNH") == 1020,
              "pilot-set QNH really was in force", "AutoQNH=%r QNH=%r" % (
                  s.get("AutoQNH"), s.get("QNH")))

    # Averaging: a compass jittering 4 degrees either side. One sample is
    # 7 kt out; the published wind is the vector mean of the samples.
    CLOCK.jump()
    a = frame(15, hdg=356, trk=10, gs=100, ias=100)
    b = dict(a, AHRSMagHeading=4)
    feed(d, [a, b] * 20)
    e1, n1 = triangle(356, 10, 100, 100)
    e2, n2 = triangle(4, 10, 100, 100)
    speed, direction = polar((e1 + e2) / 2, (n1 + n2) / 2)
    s = situation(d)
    # published at some frame of the run: an odd count shifts the mean 0.2 kt
    one = polar(e1, n1)
    res.check(s.get("WindSource") == "ias" and vector_err(s, speed, direction) <= SPEED_TOL,
              "jittering compass: the vector mean of the samples is published",
              "%s, expected %.2f from %.1f (%.2f kt off), one sample %.2f from %.1f" % (
                  wind_of(s), speed, direction, vector_err(s, speed, direction), one[0], one[1]))

    # Turns are left out: the heading lags and the aircraft slips. Steady
    # first (no airspeed, so no fit gets in the way), then a 3.5 deg/s turn at
    # 30 degrees of bank with the compass 40 degrees behind the track.
    CLOCK.jump()
    steady = frame(16, hdg=0, trk=10, gs=100, ias=0)
    feed(d, [steady] * 10)
    turn = [frame(16, hdg=10 + 3.5 * i - 40, trk=10 + 3.5 * i, gs=100, ias=0, roll=30)
            for i in range(1, 15)]
    feed(d, turn)
    s = situation(d)
    res.check(matches(s, "gs", 17.43, 275.0),
              "turning samples do not enter the average", wind_of(s))
    more = [frame(16, hdg=10 + 3.5 * i - 40, trk=10 + 3.5 * i, gs=100, ias=0, roll=30)
            for i in range(15, 60)]
    feed(d, more)
    s = settle(d, more[-1], lambda s: True, tries=2)
    res.check(s.get("WindValid") is False,
              "after 45 s of turning the average has run out", wind_of(s))


# What the attitude plate's wind box is showing. The arrow angle is read from
# the bound inline style rather than the computed matrix, which during the 1s
# CSS transition is wherever the animation has got to.
WIND_BOX_JS = r"""(function () {
    var box = document.querySelector('.attitude-wind');
    if (!box) return null;
    var arrow = box.querySelector('.attitude-wind-arrow');
    var style = arrow.getAttribute('style') || '';
    var m = style.match(/rotate\(([-0-9.]+)deg\)/);
    var matrix = new DOMMatrixReadOnly(getComputedStyle(arrow).transform);
    return {
        direction: box.querySelector('.attitude-wind-direction').innerText.trim(),
        speed: box.querySelector('.attitude-wind-speed').firstChild.textContent.trim(),
        unit: box.querySelector('.attitude-wind-unit').innerText.trim(),
        est: !!box.querySelector('.attitude-wind-estimated'),
        hidden: arrow.className.indexOf('attitude-wind-invalid') >= 0,
        bound: m ? parseFloat(m[1]) : null,
        drawn: (Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 360) % 360
    };
})()"""

NO_ESTIMATE = frame(90, hdg=0, trk=70, gs=100, ias=0)  # resets the display filter


def wind_box(d, f):
    """Show one estimate undamped: kill the estimate first, then build the new one."""
    CLOCK.jump()
    feed(d, [NO_ESTIMATE] * 2)
    d.page.wait("window.situation.WindValid === false", timeout=10,
                label="filter reset")
    feed(d, [f] * 6)
    settle(d, f, lambda s: s.get("WindValid") is True or f is NO_WIND_CASE)
    d.page.pump(1.2)  # the arrow's 1 s CSS transition
    return d.page.eval(WIND_BOX_JS)


def shown_speed(d, kt):
    """The knots as the box must print them, in the pilot's own unit."""
    return str(d.page.eval("Math.round(pilotDisplayedSpeedFromKT(%f))" % kt))


NO_WIND_CASE = frame(13, hdg=0, trk=70, gs=100, ias=0)


def plate_checks(res, d):
    d.show("attitude", "#attitude-rollpitch")

    # Drift-only estimate: wind from the west, nose 350, so the arrow points
    # right and a little down - 270 + 180 - 350 = 100 degrees from the nose
    b = wind_box(d, frame(11, hdg=350, trk=10, gs=100, ias=0))
    res.check(b["direction"] == "270" + "°"
              and b["speed"] == shown_speed(d, 34.73)
              and b["unit"] != "" and b["hidden"] is False,
              "wind box shows the drift estimate", b)
    res.check(abs(((b["bound"] - 100 + 180) % 360) - 180) <= 1.0,
              "arrow points where the wind blows, relative to the nose",
              "%.1f deg" % b["bound"])
    res.check(abs(((b["drawn"] - 100 + 180) % 360) - 180) <= 1.0,
              "the rotation really is applied to the element",
              "%.1f deg drawn" % b["drawn"])
    res.check(b["est"] is True, "drift-only estimate is tagged EST")

    # With an airspeed the wind is measured, not estimated: 20 kt on the nose,
    # so the arrow points straight down and there is no EST tag
    b = wind_box(d, frame(12, hdg=0, trk=0, gs=80, ias=100))
    res.check(b["direction"] == "360" + "°" and b["speed"] == shown_speed(d, 20.0),
              "wind box shows a headwind from north as 360", b)
    res.check(abs(((b["bound"] - 180 + 180) % 360) - 180) <= 1.0,
              "a headwind points down the screen", "%.1f deg" % b["bound"])
    res.check(b["est"] is False, "a wind measured against IAS is not tagged EST")

    # The same headwind with a magnetic compass on the grid node: the wind is
    # true, so the arrow must be drawn against the true heading, not the
    # magnetic one (which would turn it by the variation)
    b = wind_box(d, frame(17, hdg=360 - NODE_VARIATION, trk=0, gs=80, ias=100, where=NODE))
    res.check(b["direction"] == "360" + "\u00b0" and abs(((b["bound"] - 180 + 180) % 360) - 180) <= 1.0,
              "with a magnetic compass the arrow is relative to the true nose",
              "%s, %.1f deg" % (b["direction"], b["bound"]))

    # No estimate: dashes and no arrow, never a stale wind left on screen
    b = wind_box(d, NO_WIND_CASE)
    res.check(b["direction"] == "---" + "°" and b["speed"] == "--"
              and b["est"] is False and b["hidden"] is True,
              "wind box dashes out when there is no estimate", b)


# The airspeed fit. Wind 250/15, true airspeed 140 kt, sea level so TAS = IAS.
WIND_FROM, WIND_KT, TAS_KT = 250.0, 15.0, 140.0
TAS_HIGH = 1.025        # the airspeed system reads 2.5% high
COMPASS_ERROR = 12.0    # degrees: a compass the fit must not care about


def flown(seq, hdg, roll=0.0, pa=0.0, wind_from=WIND_FROM, wind_kt=WIND_KT):
    """The frame of an aircraft really heading `hdg` at TAS_KT in the wind."""
    r = math.radians
    we = -wind_kt * math.sin(r(wind_from))
    wn = -wind_kt * math.cos(r(wind_from))
    e = TAS_KT * math.sin(r(hdg)) + we
    n = TAS_KT * math.cos(r(hdg)) + wn
    trk = (math.degrees(math.atan2(e, n)) + 360) % 360
    return frame(seq, hdg=(hdg + COMPASS_ERROR) % 360, trk=trk, gs=math.hypot(e, n),
                 ias=TAS_KT * TAS_HIGH, pa=pa, roll=roll)


def fit_checks(res, d):
    d.page.eval("window.windEstimator.reset()")  # forget the airspeed scale too
    CLOCK.jump()

    # A course change of 60 degrees, airspeed scale still unknown: the wind is
    # fitted, the crosswind exactly, the along-track part off by the 2.5% (3.5 kt)
    legs = [flown(20, 0)] * 40 + [flown(20, 3.0 * i) for i in range(1, 21)] + [flown(20, 60)] * 40
    feed(d, legs)
    s = settle(d, legs[-1], lambda s: s.get("WindSource") == "tas", tries=4)
    res.check(s.get("WindSource") == "tas" and vector_err(s, WIND_KT, WIND_FROM) <= 4.5,
              "60 degree course change: airspeed fit, within the 3.5 kt airspeed error",
              "%s, %.1f kt off" % (wind_of(s), vector_err(s, WIND_KT, WIND_FROM)))

    # A full level turn: now the airspeed scale is fitted too, and the wind is exact
    d.page.eval("window.windEstimator.reset()")
    CLOCK.jump()
    circle = ([flown(21, 0)] * 30
              + [flown(21, 3.0 * i, roll=25) for i in range(1, 120)]
              + [flown(21, 0)] * 40)
    feed(d, circle)
    s = settle(d, circle[-1], lambda s: s.get("WindSource") == "tas", tries=4)
    res.check(matches(s, "tas", WIND_KT, WIND_FROM, dir_tol=2.0),
              "full turn: the wind to half a knot with the compass %g deg out" % COMPASS_ERROR,
              wind_of(s))
    scale = d.page.eval("window.windEstimator.tasScale")
    res.check(abs(scale - 1 / TAS_HIGH) < 0.003,
              "full turn: learns that the airspeed reads 2.5% high",
              "scale %.4f, expected %.4f" % (scale, 1 / TAS_HIGH))
    e, n = triangle(COMPASS_ERROR, circle[-1]["GPSTrueCourse"],
                    circle[-1]["GPSGroundSpeed"], TAS_KT)
    wrong = polar(e, n)
    off = vector_err({"WindValid": True, "WindSpeed": wrong[0], "WindDirection": wrong[1]},
                     WIND_KT, WIND_FROM)
    res.check(off > 10,
              "(the compass triangle on those frames would be far out)",
              "%.1f kt from %.0f, %.0f kt off" % (wrong[0], wrong[1], off))

    # Held through straight flight: 10 minutes on 090, long past the fit window
    straight = [flown(22, 90)] * 60
    feed(d, straight, dt=10.0)
    s = settle(d, straight[-1], lambda s: True, tries=2)
    res.check(matches(s, "tas", WIND_KT, WIND_FROM, dir_tol=2.0),
              "the fit is held through 10 minutes of straight flight", wind_of(s))

    # Retired by a climb of more than 2000 ft: back to the compass triangle,
    # which with this compass is far out - but labelled for what it is
    climbed = [flown(23, 90, pa=2500.0)] * 8
    feed(d, climbed)
    s = settle(d, climbed[-1], lambda s: s.get("WindSource") != "tas", tries=6)
    res.check(s.get("WindValid") is True and s.get("WindSource") == "ias",
              "a 2500 ft climb retires the fit (compass triangle again)", wind_of(s))

    # Retired by time: back at the fit's altitude but 15+ minutes later
    d.page.eval("window.windEstimator.reset()")
    CLOCK.jump()
    feed(d, circle)
    s = settle(d, circle[-1], lambda s: s.get("WindSource") == "tas", tries=4)
    # 1200 s: the fit stays fresh while the turn is still in its 180 s window,
    # so the 900 s hold counts from a little after the turn
    late = [flown(24, 90)] * 24
    feed(d, late, dt=50.0)
    s = settle(d, late[-1], lambda s: s.get("WindSource") == "ias", tries=10)
    res.check(s.get("WindValid") is True and s.get("WindSource") == "ias",
              "after 15 minutes the fit is no longer shown", wind_of(s))


def main():
    res = Result()
    with Display() as d:
        d.show("hsi", "#hsi")
        d.page.wait("window.magneticVariation && window.magneticVariation.grid !== null",
                    timeout=15, label="deviation.json loaded")
        compass_checks(res, d)
        plate_checks(res, d)
        fit_checks(res, d)

        errs = d.js_errors()
        res.check(not errs, "no JS errors across the wind run", errs[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
