"""Synthetic vision: terrain, traffic and the autopilot guidance tunnel."""

import sys
import time

from plates import Display, Result

# North-bound climb, then a right turn east.
ROUTE = [
    {"Lat": 44.90, "Lon": 10.00, "Ele": 3000, "Status": 2, "Cmt": "A"},
    {"Lat": 45.10, "Lon": 10.00, "Ele": 4500, "Status": 1, "Cmt": "B"},
    {"Lat": 45.10, "Lon": 10.25, "Ele": 4500, "Status": 0, "Cmt": "C"},
]

START = {"GPSLatitude": 44.88, "GPSLongitude": 10.00,
         "GPSAltitudeMSL": 4000.0, "GPSTrueCourse": 0.0, "GPSGroundSpeed": 110.0}

FRAME_PROBE = """(() => {
    const s = window.__rbScene; if (!s) return null;
    const f = []; s.traverse(o => { if (o.userData && o.userData.rbGuidance) f.push(o); });
    if (!f.length) return {count: 0};
    const m = f[0];
    return {
        count: f.length,
        geometry: m.geometry.type,
        color: '#' + m.material.color.getHexString(),
        opacity: m.material.opacity,
        depthWrite: m.material.depthWrite,
        renderOrder: m.renderOrder,
        finite: f.every(x => isFinite(x.position.x) && isFinite(x.position.y)
                             && isFinite(x.position.z)),
        sharedGeometry: f.every(x => x.geometry === m.geometry),
        sharedMaterial: f.every(x => x.material === m.material),
        climbs: f[f.length-1].position.y > f[0].position.y
    };
})()"""


def enter_synthview(d):
    """The scene is built on plate entry, so instrument before navigating."""
    d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
    d.instrument_three()
    d.show("synthview", "#synthviewFrame", timeout=25)
    d.fly(frames=8, interval=0.4, GPSLatitude=(44.88, 0.002), **{
        k: v for k, v in START.items() if k != "GPSLatitude"})
    return d


def main():
    res = Result()
    with Display(route=ROUTE, situation=START) as d:
        res.check(d.srv.wait_for_client("/situation"), "UI opened /situation")
        enter_synthview(d)

        res.check(d.page.eval("!!document.querySelector('#synthviewFrame canvas')"),
                  "WebGL canvas created")

        d.page.wait("window.__rbTunnelGroups > 0", timeout=25, label="tunnel built")
        f = d.page.eval(FRAME_PROBE)

        res.check(f and f["count"] > 3, "tunnel built from GET /autopilot",
                  "frames=%s" % (f and f["count"]))
        res.check(f["geometry"] == "ShapeGeometry", "frames are ShapeGeometry")
        res.check(f["color"] == "#ff00ff", "frames are magenta", f["color"])
        res.check(f["depthWrite"] is False, "depthWrite off so the tunnel blends")
        res.check(f["renderOrder"] == 1, "renderOrder set above the terrain")
        res.check(f["finite"], "no NaN positions (frustum culling intact)")
        res.check(f["sharedGeometry"] and f["sharedMaterial"],
                  "geometry and material are shared, not per frame")
        res.check(f["climbs"], "tunnel follows the climb profile")
        d.shot("synthview_tunnel")

        # Waypoint sequencing must drop the leg just flown
        before = d.page.eval("window.__rbTunnelGroups")
        d.srv.route = [dict(w) for w in ROUTE]
        d.srv.route[1]["Status"] = 2
        d.srv.route[2]["Status"] = 1
        d.srv.push_autopilot(Active=True,
                             To={"Lat": 45.10, "Lon": 10.25, "Ele": 4500, "Cmt": "C"})
        time.sleep(1.5)
        d.page.pump(1.0)
        after = d.page.eval("window.__rbTunnelGroups")
        res.check(after > before, "WaypointChanged rebuilds the tunnel",
                  "%s -> %s" % (before, after))

        # ... but an unchanged plan must not churn
        settled = d.page.eval("window.__rbTunnelGroups")
        d.srv.push_autopilot(Active=True,
                             To={"Lat": 45.10, "Lon": 10.25, "Ele": 4500, "Cmt": "C"})
        time.sleep(1.5)
        d.page.pump(0.5)
        res.check(d.page.eval("window.__rbTunnelGroups") == settled,
                  "identical plan does not rebuild")

        # An empty flight plan must clear the tunnel, not throw
        d.srv.route = []
        d.srv.push_autopilot(Active=False,
                             To={"Lat": 0, "Lon": 0, "Ele": 0, "Cmt": ""})
        time.sleep(1.5)
        d.page.pump(0.5)
        empty = d.page.eval(FRAME_PROBE)
        res.check(empty is None or empty["count"] == 0,
                  "empty flight plan clears the tunnel",
                  "frames=%s" % (empty and empty["count"]))

        # Leaving and re-entering must not leak scene objects
        d.show("radar", None, timeout=20)
        time.sleep(0.5)
        d.show("synthview", "#synthviewFrame", timeout=25)
        d.fly(frames=4, interval=0.3, **START)
        res.check(not d.js_errors(), "no JS errors on the synthview plate",
                  d.js_errors()[:1])

        res.check(not d.srv.missing, "no missing assets",
                  sorted(set(d.srv.missing))[:3])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
