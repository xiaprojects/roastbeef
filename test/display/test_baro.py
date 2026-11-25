"""Is the barometric altitude current, and is it a barometer?

services/servicesituation.js publishes BaroStatus with every frame: "ok", "stale" when the
daemon's BaroLastMeasurementTime has not moved for 1 s (the unit's own sensor, read at
10 Hz) or 3 s (an OGN tracker or $PGRMZ, 1 Hz), "none" when there is no barometer or only
the pressure altitude the daemon estimates from ADS-B traffic (BaroSourceType 4). The
plates follow it:

- the altimeter plate is crossed out BARO FAIL or NO BARO, the needles hold
- the attitude plate's altitude box is the barometric altitude on the setting beside
  it - never the GPS altitude - and reads --- in red without a current barometer
- AUTO does not derive a setting from an estimate
- the vertical speed falls back to the GPS rate, and with no fix either the strip reads
  --- and the variometer gauge NO VS
- the attitude plate's heading box is the GPS track, labelled TRK, and --- without a fix

The fake backend stamps BaroLastMeasurementTime freshly on every frame, as the daemon
does; a test pins it to stop the barometer (rbserver.FakeStratux.push_situation).
"""

import sys

from plates import Display, Result

# GPS 1000 ft, baro 1270 ft: AUTO gives 1003.25 hPa (shown 1003), and the altimeter
# 1270 + 27 x (1003.25 - 1013.25) = 1000 ft. The GPS climbs at 10 ft/s, the barometer at 150 ft/min, so the two
# vertical speed sources tell apart: +600 and +150, under AUTO's 200 ft/min gate.
FRAME = dict(GPSAltitudeMSL=1000.0, BaroPressureAltitude=1270.0, BaroVerticalSpeed=150.0,
             GPSVerticalSpeed=10.0, GPSFixQuality=1, BaroSourceType=1, GPSTrueCourse=123.0,
             GPSGroundSpeed=90.0, AHRSGyroHeading=200.0, BaroLastMeasurementTime=None)
STOPPED = "0001-01-01T05:00:00.000Z"

ATTITUDE = """(() => {
    const t = sel => { const e = document.querySelector(sel); return e ? e.textContent.trim() : null; };
    const red = sel => { const e = document.querySelector(sel); return !!e && e.classList.contains('attitude-fail-text'); };
    const box = document.querySelector('.attitude-heading');
    return {alt: t('.attitude-altimeter'), altRed: red('.attitude-altimeter'),
            vs: t('.attitude-vsi-value'), vsRed: red('.attitude-vsi-value'),
            hdg: box ? box.childNodes[0].textContent.trim() : null, hdgRed: red('.attitude-heading'),
            hdgSource: t('.attitude-heading-source'), qnh: parseInt(t('.attitude-qnh'))};
})()"""

ALTIMETER = """(() => {
    const p = document.querySelector('[ui-view] .altimeter');
    if (!p) return null;
    const f = p.querySelector('.attitude-fail-label');
    return {fail: f ? f.textContent.trim() : '', qnh: parseInt(p.querySelector('.altimeter-qnh').textContent),
            needle: p.querySelector('.altimeter-fi_needle').style.transform};
})()"""


def fly(d, frames=4, interval=0.25, **over):
    d.fly(frames=frames, interval=interval, **dict(FRAME, **over))
    d.page.pump(0.3)


def status(d):
    return d.page.eval("window.situation.BaroStatus")


# Covers: RB-HLR-ALT-140
def check_altitude_box(d, res):
    d.show("attitude", ".attitude-altimeter")
    fly(d)
    a = d.page.eval(ATTITUDE)
    res.check(a["alt"] == "1000" and not a["altRed"] and a["qnh"] == 1003,
              "the altitude box is the barometric altitude on the AUTO 1003 hPa", a)
    # Climbing at 500 ft/min AUTO holds its setting, so the box can be told from the
    # GPS: the GPS 300 ft up and the barometer 100 ft up must read 1100, not 1300
    fly(d, BaroVerticalSpeed=500.0, GPSAltitudeMSL=1300.0, BaroPressureAltitude=1370.0)
    a = d.page.eval(ATTITUDE)
    res.check(a["alt"] == "1100" and a["qnh"] == 1003, "and follows the barometer, not the GPS", a)
    fly(d)


# Covers: RB-HLR-ALT-070, RB-HLR-ALT-200
def check_stopped_barometer(d, res):
    d.show("attitude", ".attitude-altimeter")
    fly(d)
    fly(d, frames=8, BaroLastMeasurementTime=STOPPED)   # 2 s on one stamp
    a = d.page.eval(ATTITUDE)
    res.check(status(d) == "stale", "the unit's barometer on one stamp for 2 s is stale", status(d))
    res.check(a["alt"] == "---" and a["altRed"], "the altitude box reads --- in red", a)
    res.check(a["vs"] == "+600" and not a["vsRed"], "the strip gives way to the GPS rate, +600", a)
    d.show("altimeter", "[ui-view] .altimeter")
    fly(d, frames=8, BaroLastMeasurementTime=STOPPED)
    p = d.page.eval(ALTIMETER)
    res.check(p["fail"] == "BARO FAIL", "the altimeter plate is crossed out BARO FAIL", p)
    fly(d)   # the stamp runs again
    p = d.page.eval(ALTIMETER)
    res.check(status(d) == "ok" and p["fail"] == "", "a barometer that runs again is current at once", (status(d), p))

    # An NMEA barometer sends at 1 Hz: 2 s on one stamp is not yet stale, 4 s is
    fly(d, frames=8, BaroSourceType=3, BaroLastMeasurementTime=STOPPED)
    res.check(status(d) == "ok", "a $PGRMZ barometer 2 s on one stamp is still current", status(d))
    fly(d, frames=10, BaroSourceType=3, BaroLastMeasurementTime=STOPPED)
    res.check(status(d) == "stale", "and 4.5 s on it is stale", status(d))
    fly(d)


# Covers: RB-HLR-ALT-130
def check_no_barometer(d, res):
    d.show("altimeter", "[ui-view] .altimeter")
    fly(d)
    before = d.page.eval(ALTIMETER)
    for label, over in (("the ADS-B estimate", dict(BaroSourceType=4)),
                        ("no barometer", dict(BaroSourceType=0)),
                        ("never measured", dict(BaroLastMeasurementTime="0001-01-01T00:00:00Z"))):
        # 300 ft more GPS: AUTO would move to 1014 if it derived from what is there
        fly(d, GPSAltitudeMSL=1300.0, **over)
        p = d.page.eval(ALTIMETER)
        res.check(status(d) == "none" and p["fail"] == "NO BARO", "%s: NO BARO" % label, (status(d), p))
        res.check(p["qnh"] == before["qnh"] and p["needle"] == before["needle"],
                  "%s: AUTO holds %d hPa and the needles hold" % (label, before["qnh"]), p)
    d.show("attitude", ".attitude-altimeter")
    fly(d, BaroSourceType=4)
    a = d.page.eval(ATTITUDE)
    res.check(a["alt"] == "---" and a["altRed"], "the estimate is not in the attitude plate's altitude box", a)
    fly(d)


# Covers: RB-HLR-ALT-200
def check_no_vertical_speed(d, res):
    d.show("attitude", ".attitude-altimeter")
    fly(d, BaroSourceType=0, GPSFixQuality=0)
    a = d.page.eval(ATTITUDE)
    res.check(a["vs"] == "---" and a["vsRed"], "no barometer and no fix: the strip reads --- in red", a)
    d.show("variometer", "[ui-view] .variometer")
    fly(d, BaroSourceType=0, GPSFixQuality=0)
    shown = d.page.eval("!!document.querySelector('[ui-view] .variometer .attitude-fail')")
    res.check(shown, "and the variometer gauge is crossed out NO VS", shown)
    fly(d)
    shown = d.page.eval("!!document.querySelector('[ui-view] .variometer .attitude-fail')")
    res.check(not shown, "with the barometer back the gauge reads again", shown)


# Covers: RB-HLR-HDG-070
def check_heading_box(d, res):
    d.show("attitude", ".attitude-heading")
    fly(d)
    a = d.page.eval(ATTITUDE)
    res.check(a["hdg"] == "123" and a["hdgSource"] == "TRK" and not a["hdgRed"],
              "the heading box is the GPS track, labelled TRK", a)
    fly(d, GPSFixQuality=0)
    a = d.page.eval(ATTITUDE)
    res.check(a["hdg"] == "---" and a["hdgRed"] and a["hdgSource"] == "TRK",
              "without a fix it reads --- in red, not the gyro's 200", a)
    fly(d, GPSGroundSpeed=2.0)
    a = d.page.eval(ATTITUDE)
    res.check(a["hdg"] == "123", "below 3 kt the held track stays (owner decision 2026-11-25)", a)


def main():
    res = Result()
    with Display() as d:
        check_altitude_box(d, res)
        check_stopped_barometer(d, res)
        check_no_barometer(d, res)
        check_no_vertical_speed(d, res)
        check_heading_box(d, res)
        errs = d.js_errors()
        res.check(not errs, "no JS errors", errs[:2])
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
