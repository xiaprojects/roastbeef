#!/usr/bin/env python3
"""Magnetic declination grids: writes web/settings/databases/deviations/<region>.json.

Evaluates the World Magnetic Model (NOAA NCEI / BGS) on a regular latitude and
longitude grid at sea level, so the HMI can turn a true track into a magnetic
one without carrying the spherical-harmonic model. The coefficient file is not
in the repository; fetch it from NOAA once:

    curl -sSLO https://www.ncei.noaa.gov/sites/default/files/2024-12/WMM2025COF.zip
    unzip WMM2025COF.zip

    scripts/gen_deviation.py WMM2025COF/WMM.COF                 every region
    scripts/gen_deviation.py WMM2025COF/WMM.COF --region usa    just one
    scripts/gen_deviation.py WMM2025COF/WMM.COF --test \\
        WMM2025COF/WMM2025_TestValues.txt                       check the model first

web/settings/deviation.json is the grid the device uses: a copy of one region
(Europe as shipped), the way elevations.json is picked from databases/elevations.

The grid is node based: declination[i][j] is the value at latitude
start.lat + i * step.lat and longitude start.lon + j * step.lon, both ends
included, and annualChange[i][j] its rate. Interpolate bilinearly between the
four nodes around the position and add annualChange * (year - date) to move it
off the grid date. Positive is East: magnetic = true - declination.
"""

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "web", "settings", "databases", "deviations")

# name: (label, lat start, lat end, lon start, lon end), whole degrees.
REGIONS = {
    # Canary Islands and Azores to the Urals foothills, Cyprus to North Cape.
    "europe": ("Europe", 27, 72, -32, 45),
    # Puerto Rico and Hawaii to the Arctic coast of Alaska, Aleutians east of 180.
    "usa": ("the USA", 17, 72, -180, -64),
    # Lake Erie to northern Ellesmere, Yukon to Newfoundland. North of about 70N
    # the horizontal field is under 6000 nT, the WMM caution zone.
    "canada": ("Canada", 41, 84, -142, -52),
}
STEP = 1
# Middle of the WMM2025 validity, so the grid is never more than 2.5 years off.
DATE = 2027.5

# WGS84 ellipsoid and the geomagnetic reference radius, km.
WGS84_A = 6378.137
WGS84_F = 1 / 298.257223563
GEOMAG_RE = 6371.2


def read_cof(path):
    """Reads a WMM .COF file: (epoch, model name, {(n, m): (g, h, gdot, hdot)})."""
    with open(path) as f:
        header = f.readline().split()
        epoch, name = float(header[0]), header[1]
        coef = {}
        for line in f:
            fields = line.split()
            if len(fields) < 6:
                break
            n, m = int(fields[0]), int(fields[1])
            coef[(n, m)] = tuple(float(v) for v in fields[2:6])
    return epoch, name, coef


def legendre(nmax, theta):
    """Schmidt semi-normalised P[n][m](cos theta) and its derivative in theta."""
    ct, st = math.cos(theta), math.sin(theta)
    p = [[0.0] * (nmax + 1) for _ in range(nmax + 1)]
    dp = [[0.0] * (nmax + 1) for _ in range(nmax + 1)]
    p[0][0] = 1.0
    for n in range(1, nmax + 1):
        for m in range(n + 1):
            if m == n:
                p[n][m] = st * p[n - 1][m - 1]
                dp[n][m] = st * dp[n - 1][m - 1] + ct * p[n - 1][m - 1]
            else:
                k = 0.0
                if n > 1:
                    k = ((n - 1) ** 2 - m * m) / ((2 * n - 1) * (2 * n - 3))
                p2 = p[n - 2][m] if n > 1 else 0.0
                dp2 = dp[n - 2][m] if n > 1 else 0.0
                p[n][m] = ct * p[n - 1][m] - k * p2
                dp[n][m] = ct * dp[n - 1][m] - st * p[n - 1][m] - k * dp2
    # Gauss to Schmidt semi-normalised.
    s = 1.0
    for n in range(1, nmax + 1):
        s *= (2 * n - 1) / n
        sm = s
        for m in range(n + 1):
            if m > 0:
                sm *= math.sqrt((n - m + 1) * (2 if m == 1 else 1) / (n + m))
            p[n][m] *= sm
            dp[n][m] *= sm
    return p, dp


def field(model, year, lat, lon, alt_km=0.0):
    """Geodetic north, east, down field (nT) and its rate (nT/year)."""
    phi, lam = math.radians(lat), math.radians(lon)
    e2 = WGS84_F * (2 - WGS84_F)
    rc = WGS84_A / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    p = (rc + alt_km) * math.cos(phi)
    z = (rc * (1 - e2) + alt_km) * math.sin(phi)
    r = math.hypot(p, z)
    phic = math.asin(z / r)
    epoch, _, coef = model
    nmax = max(n for n, _ in coef)
    leg, dleg = legendre(nmax, math.pi / 2 - phic)

    def sum_field(gh):
        x = y = zz = 0.0
        for n in range(1, nmax + 1):
            ar = (GEOMAG_RE / r) ** (n + 2)
            for m in range(n + 1):
                g, h = gh(n, m)
                cm, sm = math.cos(m * lam), math.sin(m * lam)
                x += ar * (g * cm + h * sm) * dleg[n][m]
                y += ar * m * (g * sm - h * cm) * leg[n][m]
                zz -= ar * (n + 1) * (g * cm + h * sm) * leg[n][m]
        y /= math.cos(phic)
        # Geocentric to geodetic: rotate north and down by the latitude difference.
        d = phic - phi
        return (x * math.cos(d) - zz * math.sin(d), y, x * math.sin(d) + zz * math.cos(d))

    dt = year - epoch
    now = sum_field(lambda n, m: (coef[(n, m)][0] + dt * coef[(n, m)][2],
                                  coef[(n, m)][1] + dt * coef[(n, m)][3]))
    rate = sum_field(lambda n, m: (coef[(n, m)][2], coef[(n, m)][3]))
    return now, rate


def declination(model, year, lat, lon, alt_km=0.0):
    """Declination (deg, East positive) and its annual change (deg/year)."""
    (x, y, _), (dx, dy, _) = field(model, year, lat, lon, alt_km)
    h2 = x * x + y * y
    return math.degrees(math.atan2(y, x)), math.degrees((x * dy - y * dx) / h2)


def self_test(model, path):
    """Compares against the NOAA test values (decimal year, km, lat, lon, D, ..., dD/dt)."""
    worst = worst_rate = 0.0
    count = 0
    with open(path) as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            v = [float(s) for s in line.split()]
            d, rate = declination(model, v[0], v[2], v[3], v[1])
            worst = max(worst, abs(d - v[4]))
            worst_rate = max(worst_rate, abs(rate - v[11]))
            count += 1
    print("%d test points: worst declination error %.3f deg, worst rate error %.5f deg/year"
          % (count, worst, worst_rate))
    # The test file rounds D to 0.01 deg.
    return worst < 0.006 and worst_rate < 1e-4


def write_region(model, region, path):
    epoch, name, _ = model
    label, lat_start, lat_end, lon_start, lon_end = REGIONS[region]
    lats = range(lat_start, lat_end + 1, STEP)
    lons = range(lon_start, lon_end + 1, STEP)
    decl, change = [], []
    for lat in lats:
        row = [declination(model, DATE, lat, lon) for lon in lons]
        decl.append([round(d, 1) for d, _ in row])
        change.append([round(c, 2) for _, c in row])

    doc = {
        "description": "Magnetic declination (variation) for %s at sea level, degrees East positive: magnetic = true - declination" % label,
        "model": name,
        "source": "NOAA NCEI / BGS World Magnetic Model, https://www.ncei.noaa.gov/products/world-magnetic-model",
        "generator": "scripts/gen_deviation.py",
        "validFrom": epoch,
        "validTo": epoch + 5,
        "date": DATE,
        "planimetry": {"start": {"lat": lat_start, "lon": lon_start}, "end": {"lat": lat_end, "lon": lon_end}},
        "step": {"lat": STEP, "lon": STEP},
        "declination": decl,
        "annualChange": change,
    }
    # One grid row per line, like elevations.json, so a diff shows what moved.
    text = json.dumps(doc, indent=4)
    for key in ("declination", "annualChange"):
        rows = ",\n".join("        " + json.dumps(r, separators=(",", ":")) for r in doc[key])
        start = text.index('"%s": [' % key)
        end = text.index("\n    ]", start) + len("\n    ]")
        text = text[:start] + '"%s": [\n%s\n    ]' % (key, rows) + text[end:]
    with open(path, "w") as f:
        f.write(text + "\n")
    print("wrote %s: %d x %d nodes, %s at %.1f" % (path, len(decl), len(decl[0]), name, DATE))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cof", help="WMM coefficient file (WMM.COF)")
    parser.add_argument("--test", metavar="TESTVALUES", help="check the model against the NOAA test values")
    parser.add_argument("--region", action="append", choices=sorted(REGIONS),
                        help="region to write, repeatable (default: all)")
    parser.add_argument("-o", "--output", help="output file, with a single --region")
    args = parser.parse_args()
    regions = args.region or sorted(REGIONS)
    if args.output and len(regions) != 1:
        parser.error("-o needs exactly one --region")

    model = read_cof(args.cof)
    if args.test and not self_test(model, args.test):
        sys.exit("model does not match the test values")
    for region in regions:
        write_region(model, region, args.output or os.path.join(OUT_DIR, region + ".json"))


if __name__ == "__main__":
    main()
