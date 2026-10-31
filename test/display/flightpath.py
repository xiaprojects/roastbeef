"""Replay a committed flight track, and derive a flight plan from it.

A recording (`flightlog.py`) is 100 MB of SQLite and cannot go in git, so none
of them are tracked - which is why a test that needs a real flight has to guard
for a missing file. `flightlog.py path` writes the same ground track as a few
hundred KB of readable JSON; this reads it back and feeds it through the fake
backend's sockets, so a test can fly a real recorded path on any clean clone.

    path = FlightPath("fixtures/flightlog-....path.json")
    rp   = srv.replay(path.events(start=260))
    rp.prime(path.situation_at(260))
    rp.step(30)

`events()` yields the same `(t, path, frame)` tuples `FlightLog.events()` does,
so `FakeStratux.replay` (rbserver.py) takes it unchanged. Only `/situation` is
carried: the track is what this fixture is for, and the recorded traffic and EMS
streams are already covered by test_replay.py and test_flight.py.

The daemon never logs the autopilot flight plan (see `main/datalog.go` - the
tables are mySituation/traffic/ems/bridgefloat/status), so a recording holds the
path *flown* and never the route *programmed*. `waypoints()` closes that gap by
deriving a plan from the track itself, which is what makes a guidance-tunnel
test over real flight data possible at all.
"""

import json
import math
import os

from rbserver import DEFAULT_SITUATION

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")

# Waypoint.Status in main/autopilot.go, mirrored in the RB-01 plates
WAYPOINT_PATH, WAYPOINT_TARGET, WAYPOINT_PAST = 0, 1, 2

NM_M = 1852.0
AIRBORNE_KT = 40.0          # same threshold flightlog.checkpoints() uses


def _metres(a, b):
    """Ground distance between two samples, in metres."""
    lat = math.radians((a["GPSLatitude"] + b["GPSLatitude"]) * 0.5)
    return math.hypot((b["GPSLatitude"] - a["GPSLatitude"]) * 111132.0,
                      (b["GPSLongitude"] - a["GPSLongitude"]) * 111320.0 * math.cos(lat))


def _cross_track_m(point, start, end):
    """Perpendicular distance from `point` to the start-end chord, in metres.

    Flat-earth over a few NM, which is all a leg of a light-aircraft route is.
    """
    lat0 = math.radians(start["GPSLatitude"])
    def xy(s):
        return ((s["GPSLongitude"] - start["GPSLongitude"]) * 111320.0 * math.cos(lat0),
                (s["GPSLatitude"] - start["GPSLatitude"]) * 111132.0)
    px, py = xy(point)
    ex, ey = xy(end)
    leg = math.hypot(ex, ey)
    if leg < 1e-6:
        return math.hypot(px, py)
    return abs(px * ey - py * ex) / leg


class FlightPath:
    """A committed JSON track: replayable, and reducible to a flight plan."""

    def __init__(self, path):
        if not os.path.isabs(path) and not os.path.exists(path):
            candidate = os.path.join(FIXTURES, path)
            if not candidate.endswith(".json"):
                candidate += ".path.json"
            if os.path.exists(candidate):
                path = candidate
        self.path = path
        with open(path) as fh:
            self.data = json.load(fh)
        self.samples = self.data["samples"]
        if not self.samples:
            raise ValueError("%s has no samples" % path)

    # -- shape -------------------------------------------------------------
    @property
    def duration(self):
        return float(self.data.get("duration") or self.samples[-1]["t"])

    @property
    def bounds(self):
        return self.data["bounds"]

    def within(self, lat_range, lon_range):
        """Is the whole track inside this box? The synthetic vision only has a
        DEM for part of the world, and outside it the terrain never loads."""
        lat, lon = self.bounds["lat"], self.bounds["lon"]
        return (lat_range[0] <= lat[0] and lat[1] <= lat_range[1] and
                lon_range[0] <= lon[0] and lon[1] <= lon_range[1])

    def __len__(self):
        return len(self.samples)

    def __repr__(self):
        return "<FlightPath %s %d samples %.0f s>" % (
            os.path.basename(self.path), len(self.samples), self.duration)

    # -- replay ------------------------------------------------------------
    def _frame(self, sample):
        """A sample as a *complete* situation frame.

        The fixture stores only the dozen fields that describe the path, but the
        plates bind far more than that and a partial frame breaks them: radar.js
        does `.toFixed()` on fields it assumes are present, and because that
        throws inside the socket's onmessage the whole delivery chain stops -
        every other plate, synthview included, then never sees the situation at
        all. So the sample is merged over a full default, exactly as
        FakeStratux.push_situation does for a hand-written one.
        """
        frame = dict(DEFAULT_SITUATION)
        frame.update({k: v for k, v in sample.items() if k != "t"})
        return frame

    def situation_at(self, t):
        """The last sample at or before `t`, as a complete situation frame."""
        chosen = self.samples[0]
        for sample in self.samples:
            if sample["t"] > t:
                break
            chosen = sample
        return self._frame(chosen)

    def events(self, start=0.0, end=None):
        """`(t, "/situation", frame)` tuples, as FlightLog.events() yields.

        Feed to `FakeStratux.replay(events, position=start)` - the position must
        match, or every event looks like it is in the future and nothing is ever
        delivered.
        """
        for sample in self.samples:
            if sample["t"] < start:
                continue
            if end is not None and sample["t"] > end:
                break
            yield (sample["t"], "/situation", self._frame(sample))

    # -- the flight plan the recording never had ---------------------------
    def airborne(self, kt=AIRBORNE_KT):
        """Samples with the aircraft actually flying, taxi and apron trimmed."""
        flying = [s for s in self.samples if (s.get("GPSGroundSpeed") or 0) > kt]
        return flying or list(self.samples)

    def waypoints(self, tolerance_nm=0.5, count=None, kt=AIRBORNE_KT):
        """A flight plan along the track, as `GET /autopilot` would return it.

        Douglas-Peucker keeps the points that actually define the shape - the
        turns - rather than an arbitrary time slice, so the plan looks like one
        a pilot would have entered. `Ele` is the recorded altitude at that
        point, which is what makes the tunnel follow the flight's own profile.

        **The tolerance is a guarantee**, and that is the point: Douglas-Peucker
        keeps every discarded sample within `tolerance_nm` of the kept chord, so
        the aircraft provably never strays further than that from the plan it
        flies. A test can assert against that number instead of guessing one.
        Measured on the 0341 recording: 0.5 NM -> 21 waypoints, worst 877 m of
        926; 0.25 -> 35 and 449 m; 1.0 -> 14 and 1785 m of 1852.

        `count` thins the result to at most that many waypoints. It **breaks the
        guarantee** (on 0341, thinning to 7 pushes the worst error to 2690 m,
        nearly 3x the tolerance) because dropping a kept point moves the chord
        away from the samples it was keeping. Use it only when the shape matters
        more than the bound, and never as the basis for a cross-track assertion.

        Status is left as PATH throughout; `sequence()` sets the active leg.
        """
        flying = self.airborne(kt)
        keep = _simplify(flying, tolerance_nm * NM_M)
        if count and len(keep) > count:
            keep = _thin_to(keep, count)
        route = []
        for sample in keep:
            route.append({
                "Lat": round(sample["GPSLatitude"], 6),
                "Lon": round(sample["GPSLongitude"], 6),
                "Ele": int(round(sample.get("GPSAltitudeMSL") or 0)),
                "Status": WAYPOINT_PATH,
                "Cmt": "t+%.0f" % sample["t"],
                # not sent to the HMI (it ignores unknown keys) but lets a test
                # line a waypoint up with the moment the aircraft reaches it
                "_t": sample["t"],
            })
        return route

    def reached(self, route, t):
        """Index of the last waypoint the aircraft has passed by log second `t`."""
        passed = -1
        for i, wp in enumerate(route):
            if wp.get("_t") is not None and wp["_t"] <= t:
                passed = i
        return passed

    def sequence(self, route, t):
        """Set Status as the autopilot would have at `t`: everything behind the
        aircraft PAST, the next waypoint TARGET, the rest PATH."""
        target = min(self.reached(route, t) + 1, len(route) - 1)
        for i, wp in enumerate(route):
            wp["Status"] = (WAYPOINT_PAST if i < target else
                            WAYPOINT_TARGET if i == target else WAYPOINT_PATH)
        return target

    def cross_track_m(self, route, t):
        """How far the aircraft is from the leg it should be flying at `t`.

        The plan came from this very track, so this is small by construction -
        it is the error the simplification introduced, and the yardstick a test
        compares the drawn tunnel against.
        """
        target = self.sequence(list(route), t)
        if target <= 0:
            return 0.0
        here = self.situation_at(t)
        here = {"GPSLatitude": here["GPSLatitude"], "GPSLongitude": here["GPSLongitude"]}
        start = {"GPSLatitude": route[target - 1]["Lat"], "GPSLongitude": route[target - 1]["Lon"]}
        end = {"GPSLatitude": route[target]["Lat"], "GPSLongitude": route[target]["Lon"]}
        return _cross_track_m(here, start, end)


def _simplify(samples, tolerance_m):
    """Douglas-Peucker on the ground track."""
    if len(samples) < 3:
        return list(samples)
    first, last = samples[0], samples[-1]
    worst, index = 0.0, 0
    for i in range(1, len(samples) - 1):
        d = _cross_track_m(samples[i], first, last)
        if d > worst:
            worst, index = d, i
    if worst <= tolerance_m:
        return [first, last]
    left = _simplify(samples[:index + 1], tolerance_m)
    right = _simplify(samples[index:], tolerance_m)
    return left[:-1] + right


def _thin_to(points, count):
    """Drop the least significant intermediate points until `count` remain.

    The ends are a departure and an arrival and are always kept; of the rest,
    the point whose removal moves the track least goes first.
    """
    keep = list(points)
    while len(keep) > count:
        worst, index = None, None
        for i in range(1, len(keep) - 1):
            d = _cross_track_m(keep[i], keep[i - 1], keep[i + 1])
            if worst is None or d < worst:
                worst, index = d, i
        keep.pop(index)
    return keep


if __name__ == "__main__":
    import sys
    fp = FlightPath(sys.argv[1] if len(sys.argv) > 1
                    else "flightlog-20260913111200.0341")
    print(fp)
    print("bounds", fp.bounds)
    route = fp.waypoints()
    print("\n%d waypoints at 0.5 NM" % len(route))
    for i, wp in enumerate(route):
        print("  %d  %9.5f %9.5f  %5d ft  t+%-6.0f %s" % (
            i, wp["Lat"], wp["Lon"], wp["Ele"], wp["_t"], wp["Cmt"]))
    worst = max(fp.cross_track_m(route, s["t"]) for s in fp.airborne())
    print("\nworst cross-track of the flight from its own derived plan: %.0f m" % worst)
