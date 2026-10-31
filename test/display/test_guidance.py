"""The guidance tunnel, flown down a real recorded path.

test_synthview.py checks that the tunnel is built and looks right, but from
three hand-typed waypoints and an aircraft that barely moves. Nothing checked it
against a real flight - and nothing could, because a recording carries no flight
plan: main/datalog.go logs mySituation, traffic, ems, bridgefloat and status,
never the autopilot. A log holds the path *flown*, never the route *programmed*.

So the plan is derived from the track itself (flightpath.waypoints()), and that
is what makes the central assertion possible: the route came from this very
flight, so the aircraft must fly down the middle of its own tunnel. Douglas-
Peucker bounds how far a discarded sample sits from the chord it kept, so there
is a number to assert against rather than a guessed tolerance. If the
projection, the world scale or the elevation handling were wrong, the tunnel
would be somewhere else and the measured offset would blow past that bound.

    RB_PATH=<name> python3 test_guidance.py      # another committed track
"""

import os
import sys
import time

from flightpath import FlightPath
from plates import Display, Result

FIXTURE = os.environ.get("RB_PATH", "flightlog-20260913111200.0341")

# web/settings/elevations.json covers this box. Outside it the DEM never loads,
# the terrain is never ready and no tunnel is ever built - so a fixture swap
# that wanders out of it must fail loudly here, not time out mysteriously later.
DEM_LAT, DEM_LON = (37.0, 47.0), (4.0, 19.0)

TOLERANCE_NM = 0.5                      # the simplification bound
CORRIDOR_M = TOLERANCE_NM * 1852.0      # 926 m; see FlightPath.waypoints

# guidance defaults, web/settings/synthview.json
WIDTH_CELLS, MAX_BOXES = 0.35, 60

# Log seconds to fly to. The recording is airborne from about t=260; these sit
# on the climb, the far leg and the return, so the tunnel is rebuilt across
# several different headings.
START = 520.0
CHECKPOINTS = (("climb", 620.0), ("transit", 1500.0), ("return", 2300.0))

# resources (terrain, setup, items) lives in the controller closure, but
# RemoteController.updateItemsBySituation is handed all three on every frame and
# the instance is on the scope - so shadow it there. instrument_three() already
# tags the tunnel meshes and captures the scene.
HOOK = """(() => {
    const sc = angular.element(document.querySelector('#synthviewFrame')).scope();
    if (!sc || !sc.remote) return 'no scope.remote';
    const r = sc.remote;
    if (r.__rbHooked) return 'already';
    const orig = r.updateItemsBySituation.bind(r);
    r.updateItemsBySituation = function (items, situation, resources) {
        window.__rbItems = items;
        window.__rbTerrain = resources.terrain;
        window.__rbSetup = resources.setup;
        return orig(items, situation, resources);
    };
    r.__rbHooked = true;
    return 'hooked';
})()"""

# One read of everything the checks need. The world scale is measured through
# the scene's own plan(), so the test never assumes a DEM resolution: plan() is
# linear, so two offsets give the units-per-degree, and the ground size of a
# degree gives units per metre.
SCENE = """((lat) => {
    const s = window.__rbScene, t = window.__rbTerrain, setup = window.__rbSetup;
    if (!s || !t || !setup) return null;
    const f = [];
    s.traverse(o => { if (o.userData && o.userData.rbGuidance) f.push(o); });
    const me = window.__rbItems && window.__rbItems[0];
    const D = 0.01, cell = setup.cellSize;
    const o0 = t.plan(lat, 12.0), oN = t.plan(lat + D, 12.0), oE = t.plan(lat, 12.0 + D);
    const uNS = Math.abs(oN[1] - o0[1]) * cell / (D * 111132.0);
    const uEW = Math.abs(oE[0] - o0[0]) * cell / (D * 111320.0 * Math.cos(lat * Math.PI / 180));
    return {
        count: f.length,
        frames: f.map(o => [o.position.x, o.position.y, o.position.z]),
        width: f.length ? f[0].scale.x : null,
        me: me ? [me.x, me.elevation, me.y] : null,
        cellSize: cell, uNS: uNS, uEW: uEW,
        groups: window.__rbTunnelGroups || 0
    };
})(%s)"""


def lateral_m(scene):
    """Ownship's perpendicular distance from the tunnel line, in ground metres.

    World units are anisotropic - plan() has no cos(lat) term - so each axis is
    converted before the offset is measured.
    """
    me, frames = scene.get("me"), scene.get("frames") or []
    uNS, uEW = scene.get("uNS"), scene.get("uEW")
    if not me or len(frames) < 2:
        return None
    if not _finite(uNS) or not _finite(uEW) or uNS <= 0 or uEW <= 0:
        return None
    near = sorted(frames, key=lambda f: (f[0] - me[0]) ** 2 + (f[2] - me[2]) ** 2)[:2]
    (ax, _a, az), (bx, _b, bz) = near
    px, pz = (me[0] - ax) / uEW, (me[2] - az) / uNS
    ex, ez = (bx - ax) / uEW, (bz - az) / uNS
    leg = (ex * ex + ez * ez) ** 0.5
    if leg < 1e-6:
        return (px * px + pz * pz) ** 0.5
    return abs(px * ez - pz * ex) / leg


def _finite(v):
    return isinstance(v, (int, float)) and v == v and abs(v) != float("inf")


def serve(route):
    """The plan as the daemon would return it - the _t bookkeeping stripped."""
    return [{k: v for k, v in wp.items() if not k.startswith("_")} for wp in route]


def main():
    res = Result()
    try:
        fp = FlightPath(FIXTURE)
    except (FileNotFoundError, ValueError) as exc:
        print("  no track fixture (%s)" % exc)
        print("  make one: python3 flightlog.py path <recording.sqlite>")
        return 0

    # -- the plan, before a browser is involved ---------------------------
    res.check(fp.within(DEM_LAT, DEM_LON), "track is inside the terrain DEM",
              "lat %.2f..%.2f lon %.2f..%.2f" % (fp.bounds["lat"][0], fp.bounds["lat"][1],
                                                 fp.bounds["lon"][0], fp.bounds["lon"][1]))
    route = fp.waypoints(tolerance_nm=TOLERANCE_NM)
    res.check(len(route) >= 4, "plan derived from the recorded track",
              "%d waypoints at %.2f NM" % (len(route), TOLERANCE_NM))

    worst_plan = max(fp.cross_track_m(route, s["t"]) for s in fp.airborne())
    res.check(worst_plan <= CORRIDOR_M, "the flight stays inside its own plan",
              "%.0f m of %.0f m" % (worst_plan, CORRIDOR_M))

    # -- and now on the display -------------------------------------------
    fp.sequence(route, START)
    with Display(route=serve(route), situation=fp.situation_at(START)) as d:
        d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
        d.instrument_three()
        d.show("synthview", "#synthviewFrame", timeout=25)
        res.check(d.page.eval(HOOK) in ("hooked", "already"),
                  "scene internals reachable for measurement")

        rp = d.srv.replay(fp.events(start=START), position=START)
        rp.prime(fp.situation_at(START))
        rp.step(20)          # the frame after the connect seed is the first the
                             # HMI acts on; the terrain load starts from it

        try:
            d.page.wait("window.__rbTunnelGroups > 0", timeout=180, label="tunnel")
            built = True
        except TimeoutError:
            built = False
        res.check(built, "tunnel built from the derived plan")
        if not built:
            print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
            return 1

        first = d.page.eval(SCENE % fp.situation_at(START)["GPSLatitude"])
        res.check(first and first["cellSize"] > 0, "scene scale readable",
                  first and "cellSize=%d" % first["cellSize"])
        res.check(abs(first["width"] - WIDTH_CELLS * first["cellSize"]) < 1.0,
                  "frame width is widthCells x cellSize",
                  "%.0f vs %.0f" % (first["width"], WIDTH_CELLS * first["cellSize"]))

        worst_lateral, drawn, previous_groups = 0.0, 0, first["groups"]
        previous_target = fp.sequence(route, START)
        for name, t in CHECKPOINTS:
            target = fp.sequence(route, t)
            sequenced = target != previous_target
            previous_target = target
            d.srv.route = serve(route)
            d.srv.push_autopilot(Active=True, To={
                "Lat": route[target]["Lat"], "Lon": route[target]["Lon"],
                "Ele": route[target]["Ele"], "Cmt": route[target]["Cmt"]})
            # The rebuild is an async GET /autopilot off the WaypointChanged
            # event, so wait for it rather than sampling a counter that may
            # still be in flight - the first one lands slowest, behind the
            # initial terrain build.
            rebuilt = True
            if sequenced:
                try:
                    d.page.wait("window.__rbTunnelGroups > %d" % previous_groups,
                                timeout=30, label="%s rebuild" % name)
                except TimeoutError:
                    rebuilt = False
            else:
                d.page.pump(1.5)
            if t > rp.position:
                rp.step(t - rp.position)
            d.page.pump(1.0)

            scene = d.page.eval(SCENE % fp.situation_at(t)["GPSLatitude"])
            if not scene or not scene["count"]:
                res.check(False, "%-8s tunnel drawn" % name)
                continue
            drawn += 1

            # The route signature gates rebuilds, so the tunnel must rebuild
            # when the active waypoint moved on and hold still when it did not.
            if sequenced:
                res.check(rebuilt and scene["groups"] > previous_groups,
                          "%-8s sequencing rebuilt the tunnel" % name,
                          "%d -> %d" % (previous_groups, scene["groups"]))
            else:
                res.check(scene["groups"] == previous_groups,
                          "%-8s unchanged plan did not rebuild" % name,
                          "still %d" % scene["groups"])
            previous_groups = scene["groups"]

            res.check(scene["count"] <= MAX_BOXES,
                      "%-8s frames within maxBoxes" % name,
                      "%d of %d" % (scene["count"], MAX_BOXES))
            res.check(all(_finite(v) for f in scene["frames"] for v in f),
                      "%-8s no NaN frame positions" % name)

            offset = lateral_m(scene)
            worst_lateral = max(worst_lateral, offset or 0.0)
            res.check(offset is not None and offset <= CORRIDOR_M,
                      "%-8s aircraft is inside its own tunnel" % name,
                      "%.0f m of %.0f m" % (offset, CORRIDOR_M) if offset is not None
                      else "not measurable")
            d.shot("guidance_%s" % name)

        res.check(drawn == len(CHECKPOINTS), "tunnel drawn at every checkpoint",
                  "%d of %d" % (drawn, len(CHECKPOINTS)))
        print("\n  worst lateral offset over the flight: %.0f m (allowed %.0f)"
              % (worst_lateral, CORRIDOR_M))
        res.check(not d.js_errors(), "no JS errors while flying the tunnel",
                  d.js_errors()[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
