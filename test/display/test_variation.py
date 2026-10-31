"""Magnetic variation: does servicesituation.js publish it, and does the
magnetometer addon align the compass to the magnetic track with it?

The variation comes from /settings/deviation.json (variation.js): a WMM grid,
bilinear between the four nodes around the position plus the annual change
times the years off the grid date, East positive, true = magnetic + variation.
The expected values below are worked out here, in reference(), from the same
file and the format documented in docs/http-api.md - not from the JavaScript
under test.

Two parts:
- the fields every published situation carries: MagneticVariation,
  MagneticVariationValid, MagneticVariationExpired - on a grid node, between
  nodes on another date, outside the grid, with no position, past the model's
  validity;
- OFFSET FROM GPS TRACK in the magnetometer addon: inside the grid it must align
  the compass to the magnetic track (GPS track minus the variation), outside it
  to the true track, as before.
"""


import calendar
import datetime
import json
import os
import sys

from plates import Display, Result, WEB

GRID = json.load(open(os.path.join(WEB, "settings", "deviation.json")))

ADDON = {"name": "magnetometer", "js": "addons/js/magnetometer.js", "hash": "/addons/magnetometer",
         "html": "addons/magnetometer.html", "controller": "MagnetometerCtrl"}
VIEW = "[ui-view] "

TOL = 1e-6   # degrees: the same arithmetic, so only rounding separates them


def reference(lat, lon, year):
    """The variation at a position and a decimal year, or None outside the grid."""
    s, st = GRID["planimetry"]["start"], GRID["step"]
    dec, ann = GRID["declination"], GRID["annualChange"]
    fi = (lat - s["lat"]) / st["lat"]
    fj = (lon - s["lon"]) / st["lon"]
    if fi < 0 or fj < 0 or fi > len(dec) - 1 or fj > len(dec[0]) - 1:
        return None
    i, j = min(int(fi), len(dec) - 2), min(int(fj), len(dec[0]) - 2)
    a, b = fi - i, fj - j

    def bilinear(m):
        return (m[i][j] * (1 - a) * (1 - b) + m[i + 1][j] * a * (1 - b)
                + m[i][j + 1] * (1 - a) * b + m[i + 1][j + 1] * a * b)
    return bilinear(dec) + bilinear(ann) * (year - GRID["date"])


def decimal_year(iso):
    t = datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    start = datetime.datetime(t.year, 1, 1, tzinfo=datetime.timezone.utc)
    days = 366 if calendar.isleap(t.year) else 365
    return t.year + (t - start).total_seconds() / (days * 86400)


def published(d, seq, **fields):
    """Push the frame until the service has published it, then read it back."""
    for _ in range(12):
        d.srv.push_situation(TestSeq=seq, **fields)
        d.page.pump(0.3)
        s = json.loads(d.page.eval("JSON.stringify(window.situation)"))
        if s.get("TestSeq") == seq:
            return s
    return s


def fields_checks(res, d):
    # On a grid node at the grid's own date: exactly the node's value
    when = "2027-07-02T12:00:00Z"   # 2027.5, the date the shipped grid is evaluated at
    s = published(d, 1, GPSLatitude=43.0, GPSLongitude=12.0, GPSTime=when, GPSFixQuality=2)
    node = GRID["declination"][16][44]
    res.check(s.get("MagneticVariationValid") is True
              and abs(s.get("MagneticVariation", 99) - node) < TOL
              and s.get("MagneticVariationExpired") is False,
              "on the 43N 12E node at %.1f: the node's value" % decimal_year(when),
              "%r, node %r" % (s.get("MagneticVariation"), node))

    # Between nodes, on another date: bilinear plus the annual change
    when = "2026-10-25T14:00:00Z"
    lat, lon = 43.1047, 12.2513
    s = published(d, 2, GPSLatitude=lat, GPSLongitude=lon, GPSTime=when)
    want = reference(lat, lon, decimal_year(when))
    res.check(s.get("MagneticVariationValid") is True
              and abs(s.get("MagneticVariation", 99) - want) < TOL,
              "between nodes on %s: bilinear plus annual change" % when[:10],
              "%r, expected %.6f" % (s.get("MagneticVariation"), want))

    # The same position with no fix (the last known one): still known
    s = published(d, 3, GPSLatitude=lat, GPSLongitude=lon, GPSTime=when, GPSFixQuality=0)
    res.check(s.get("MagneticVariationValid") is True
              and abs(s.get("MagneticVariation", 99) - want) < TOL,
              "the last known position gives the variation without a fix",
              repr(s.get("MagneticVariation")))

    # Outside the grid (Europe as shipped): no variation, and 0, not a guess
    s = published(d, 4, GPSLatitude=10.0, GPSLongitude=10.0, GPSFixQuality=2)
    res.check(s.get("MagneticVariationValid") is False and s.get("MagneticVariation") == 0,
              "outside the grid: no variation", "valid=%r value=%r" % (
                  s.get("MagneticVariationValid"), s.get("MagneticVariation")))

    # No position at all (0, 0 before the first fix): no variation
    s = published(d, 5, GPSLatitude=0.0, GPSLongitude=0.0)
    res.check(s.get("MagneticVariationValid") is False,
              "no position: no variation", repr(s.get("MagneticVariationValid")))

    # Past the model's validity: extrapolated with the annual change, flagged
    when = "2031-01-01T00:00:00Z"
    s = published(d, 6, GPSLatitude=43.0, GPSLongitude=12.0, GPSTime=when)
    want = reference(43.0, 12.0, decimal_year(when))
    res.check(s.get("MagneticVariationValid") is True and s.get("MagneticVariationExpired") is True
              and abs(s.get("MagneticVariation", 99) - want) < TOL,
              "past %s: extrapolated and flagged expired" % GRID["validTo"],
              "%r expired=%r, expected %.6f" % (s.get("MagneticVariation"),
                                                s.get("MagneticVariationExpired"), want))


MAG = {"MagMaxX": 349, "MagMaxY": 683, "MagMaxZ": 377, "MagMinX": -487, "MagMinY": -310,
       "MagMinZ": -637, "X": -379, "Y": 373, "Z": -543, "Heading": 100, "Offset": 0,
       "Calibrating": False}


def offsets_posted(d, since):
    out = []
    for path, body in d.srv.posted[since:]:
        if path == "/magnetometer":
            try:
                out.append(json.loads(body).get("Offset"))
            except ValueError:
                pass
    return out


def press_offset(d, seq, **where):
    """Fly straight on heading 100 / track 110 and press OFFSET FROM GPS TRACK."""
    published(d, seq, AHRSMagHeading=100.0, GPSTrueCourse=110.0, GPSGroundSpeed=100.0,
              GPSFixQuality=2, GPSTime="2027-07-02T12:00:00Z", Magnetometer=MAG, **where)
    since = len(d.srv.posted)
    d.page.eval("document.querySelector(%s).click()"
                % json.dumps(VIEW + "[ng-click='applyGpsTrackOffset()']"))
    for _ in range(20):
        d.page.pump(0.2)
        got = offsets_posted(d, since)
        if len(got) >= 2:   # PUT then POST
            return got
    return offsets_posted(d, since)


def addon_checks(res, d):
    d.page.wait("!!angular.element(document.body).injector().get('$state').get('magnetometer')",
                timeout=25, label="addon registered")
    d.show("addons/magnetometer", VIEW + ".addonMagToolbar", timeout=25)

    v = GRID["declination"][16][44]
    got = press_offset(d, 10, GPSLatitude=43.0, GPSLongitude=12.0)
    want = round(110.0 - v - 100.0, 1)
    res.check(len(got) == 2 and all(abs(o - want) < 1e-9 for o in got),
              "inside the grid: aligned to the magnetic track (track - %.1f)" % v,
              "offsets posted %r, expected %r twice (PUT, POST)" % (got, want))

    got = press_offset(d, 11, GPSLatitude=10.0, GPSLongitude=10.0)
    res.check(len(got) == 2 and all(abs(o - 10.0) < 1e-9 for o in got),
              "outside the grid: aligned to the true track, as before",
              "offsets posted %r, expected 10.0 twice" % got)


def main():
    res = Result()
    d = Display(window="1024,768")
    # The captured /addons list is from an aircraft without this addon.
    d.srv.rest["/addons"] = d.srv.rest["/addons"] + [ADDON]
    with d:
        d.show("hsi", "#hsi")
        d.page.wait("window.magneticVariation && window.magneticVariation.grid !== null",
                    timeout=15, label="deviation.json loaded")
        fields_checks(res, d)
        addon_checks(res, d)
        res.check(not d.js_errors(), "no JS errors in the whole run", d.js_errors()[:2])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
