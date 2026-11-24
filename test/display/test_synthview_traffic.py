"""Traffic and ownship tubes on the 3D synthetic view.

Every aircraft in the scene carries two dark tubes (updateTubes in
plates/js/synthview.js): one down to sea level, and its predicted path, from
the aircraft to where it will be in synthview.json "projection.seconds" at its
ground speed, track and vertical speed.

    scale        a terrain cell is eastScale() as wide as it is long, so the
                 mesh and every position keep true horizontal proportions
    position     a target's scene distance from the aircraft is its true
                 distance in metres times setup.unitsPerMeter
    altitude     a pressure altitude is drawn MSL: shifted by the aircraft's
                 GPS MSL minus pressure altitude; a GNSS altitude as it came
    path         seconds x ground speed across, seconds x vertical speed up:
                 a climb points up, a descent down
    vertical     the vertical tube runs from sea level to the aircraft
    update       a new altitude, speed or vertical speed resizes both tubes
    north        a 000 track gets a path (it used to get none)
    no speed     Speed_valid false: no path
    no vertical  Vvel_valid false: a level path in the lighter grey
    ownship      the aircraft's own path from GPS ground speed and vertical speed
    height       no "verticalExaggeration": one unit a metre, as always; with 1,
                 terrain, tubes and paths all at unitsPerMeter a metre of height
"""

import math
import sys
import time

from plates import Display, Result

SV = "angular.element(document.getElementById('synthviewFrame')).scope()"

LAT, LON = 44.88, 10.00
MSL_FT, PA_FT = 4000.0, 3700.0     # a low pressure day: pressure altitude 300 ft below MSL
START = {"GPSLatitude": LAT, "GPSLongitude": LON, "GPSAltitudeMSL": MSL_FT,
         "BaroPressureAltitude": PA_FT, "BaroSourceType": 1, "GPSFixQuality": 2,
         "GPSTrueCourse": 90.0, "GPSGroundSpeed": 110.0, "GPSVerticalSpeed": 500 / 60.0}

PROBE = """(name => {
    const r = %s.resources; if (!r) return null;
    const it = r.items.find(i => i.name === name);
    if (!it || !it.referenceTubeVertical) return null;
    const p = it.referenceTubeFront, v = it.referenceTubeVertical;
    const out = {x: it.x, y: it.elevation, z: it.y,
        vTop: v.position.y + v.scale.y / 2, vBottom: v.position.y - v.scale.y / 2,
        vx: v.position.x, vz: v.position.z, vVisible: v.visible,
        upm: r.setup.unitsPerMeter, k: r.setup.heightScale, path: null};
    if (p) {
        const a = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion).multiplyScalar(p.scale.y / 2);
        out.path = {visible: p.visible, color: p.material.color.getHex(),
            start: [p.position.x - a.x, p.position.y - a.y, p.position.z - a.z],
            end: [p.position.x + a.x, p.position.y + a.y, p.position.z + a.z]};
    }
    return out;
})(%%r)""" % SV

GEOMETRY = """(() => {
    const s = %s, r = s.resources, t = r.terrain, g = s.remote.rendering.terrainBrown;
    return {east: t.eastScale(), mpc: t.metersPerCell(), origin: t.origin,
            step: t.moltipliers, cell: r.setup.cellSize, upm: r.setup.unitsPerMeter,
            rows: t.terrainData.length, cols: t.terrainData[0].length,
            width: g.geometry.parameters.width, height: g.geometry.parameters.height,
            seconds: s.remote.rendering.projectionSetup(r.setup.projection).seconds};
})()""" % SV


def target(icao, lat, lon, alt, track, speed, vvel, gnss=False, speed_valid=True, vvel_valid=True):
    return {"Icao_addr": icao, "Tail": "", "Reg": "", "Lat": lat, "Lng": lon,
            "Alt": alt, "AltIsGNSS": gnss, "Track": track, "Speed": speed,
            "Speed_valid": speed_valid, "Vvel": vvel, "Vvel_valid": vvel_valid, "Position_valid": True,
            "Emitter_category": 1, "OnGround": False, "Age": 0.5}


def push(d, *targets, rounds=3):
    for _ in range(rounds):
        d.srv.push_situation(**START)
        for t in targets:
            d.srv.push("/traffic", t)
        time.sleep(0.4)
    d.page.pump(0.5)


def wait_item(d, name, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        got = d.page.eval(PROBE % name)
        if got and got["path"] is not None:
            return got
        d.page.pump(0.5)
    return d.page.eval(PROBE % name)


def close(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


def metres(lat1, lon1, lat2, lon2):
    """Local flat-earth metres, the projection the scene uses."""
    north = (lat2 - lat1) * 111132.0
    east = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return east, north


def check_path(res, got, label, speed_kt, track, vvel_fpm, seconds):
    p = got and got["path"]
    if not p:
        res.check(False, label, "no path")
        return
    k = got["k"]
    across = speed_kt * 1852.0 / 3600.0 * seconds * got["upm"]
    want = [across * math.sin(math.radians(track)), vvel_fpm * 0.3048 / 60.0 * seconds * k,
            -across * math.cos(math.radians(track))]
    start_ok = all(close(p["start"][i], [got["x"], got["y"] * k, got["z"]][i], 0.5) for i in range(3))
    end_ok = all(close(p["end"][i] - p["start"][i], want[i], 0.5) for i in range(3))
    res.check(p["visible"] and start_ok and end_ok, label,
              "start %s end-start %s want %s" % (
                  [round(v, 1) for v in p["start"]],
                  [round(p["end"][i] - p["start"][i], 1) for i in range(3)],
                  [round(v, 1) for v in want]))


HEIGHTS = """(() => {
    const s = %s, r = s.resources, R = s.remote.rendering, t = r.terrain;
    const g = R.terrainBrown.geometry, pos = g.attributes.position.array;
    const rows = t.terrainData.length, cols = t.terrainData[0].length;
    let worst = 0, top = 0;
    for (let j = 0; j < pos.length / 3; j++) {
        const metres = t.terrainData[rows - 1 - Math.floor(j / cols)][j %% cols];
        worst = Math.max(worst, Math.abs(pos[j * 3 + 2] - metres * r.setup.heightScale));
        top = Math.max(top, pos[j * 3 + 2]);
    }
    const x = R.terrainBrown.position.x, z = R.terrainBrown.position.z;
    return {k: r.setup.heightScale, upm: r.setup.unitsPerMeter, worst: worst, top: top,
            ground: R.groundAt(x, z), sceneY: R.sceneY(1000)};
})()""" % SV


def enter(d):
    res_ok = d.srv.wait_for_client("/situation")
    d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
    d.instrument_three()
    d.show("synthview", "#synthviewFrame", timeout=25)
    d.fly(frames=8, interval=0.4, **START)
    d.page.wait("(s => s && s.resources && s.resources.setup.unitsPerMeter > 0)(%s)" % SV,
                timeout=30, label="terrain loaded")
    return res_ok


def true_heights(res):
    """verticalExaggeration 1: every height at unitsPerMeter a metre."""
    over = {"/settings/synthview.json": {"verticalExaggeration": 1}}
    with Display(situation=START, settings_overrides=over) as d:
        enter(d)
        h = d.page.eval(HEIGHTS)
        res.check(close(h["k"], h["upm"], 1e-9) and h["k"] < 0.6,
                  "exaggeration 1: heightScale is unitsPerMeter",
                  "%.4f vs %.4f" % (h["k"], h["upm"]))
        res.check(h["worst"] < 1e-3 and h["top"] > 0,
                  "exaggeration 1: terrain vertices at metres x heightScale",
                  "worst %.4f, highest %.0f units" % (h["worst"], h["top"]))
        res.check(close(h["sceneY"], 1000 * h["k"], 1e-6), "sceneY scales metres by heightScale")
        push(d, target("BBB001", LAT + 0.05, LON + 0.07, 4500, 45.0, 120, 1000))
        got = wait_item(d, "BBB001")
        res.check(got and close(got["vTop"], (4500 + MSL_FT - PA_FT) * 0.3048 * got["k"], 0.01),
                  "exaggeration 1: vertical tube up to the scaled altitude",
                  got and "%.1f units" % got["vTop"])
        check_path(res, got, "exaggeration 1: climbing path scaled the same", 120, 45.0, 1000,
                   d.page.eval("%s.remote.rendering.projectionSetup(%s.resources.setup.projection).seconds" % (SV, SV)))
        d.shot("synthview_traffic_true_heights")
        res.check(not d.js_errors(), "exaggeration 1: no JS errors", d.js_errors()[:1])


def main():
    res = Result()
    with Display(situation=START) as d:
        res.check(d.srv.wait_for_client("/situation"), "UI opened /situation")
        d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
        d.instrument_three()
        d.show("synthview", "#synthviewFrame", timeout=25)
        d.fly(frames=8, interval=0.4, **START)
        d.page.wait("(s => s && s.resources && s.resources.setup.unitsPerMeter > 0)(%s)" % SV,
                    timeout=30, label="terrain loaded")

        # -- scale -------------------------------------------------------
        g = d.page.eval(GEOMETRY)
        want_east = (math.cos(math.radians(g["origin"]["lat"])) * 111320.0 * g["step"]["lon"]
                     / (111132.0 * g["step"]["lat"]))
        res.check(close(g["east"], want_east, 1e-9) and 0.6 < g["east"] < 0.8,
                  "a cell is cos(lat) as wide as it is long at %.2f N" % g["origin"]["lat"],
                  "%.4f vs %.4f" % (g["east"], want_east))
        res.check(close(g["width"] / g["height"], g["cols"] * g["east"] / g["rows"], 1e-6),
                  "the terrain mesh is drawn in true proportions",
                  "%.1f x %.1f, %d x %d cells" % (g["width"], g["height"], g["cols"], g["rows"]))
        res.check(close(g["upm"], g["cell"] / g["mpc"], 1e-9),
                  "unitsPerMeter is cellSize over the cell's metres",
                  "%.4f units/m, %.0f m cells" % (g["upm"], g["mpc"]))
        res.check(g["seconds"] == 60, "predicted path over 60 s (synthview.json)", g["seconds"])
        res.check(d.page.eval("%s.resources.setup.heightScale" % SV) == 1,
                  "no verticalExaggeration: one unit a metre of height, as always")
        seconds = g["seconds"]

        # -- a climbing target north-east, pressure altitude ---------------
        t_lat, t_lon = LAT + 0.05, LON + 0.07
        climb = target("AAA001", t_lat, t_lon, 4500, 45.0, 120, 1000)
        push(d, climb)
        got = wait_item(d, "AAA001")
        res.check(got is not None and got["path"] is not None, "the target is in the scene")
        me = d.page.eval(PROBE % "ME")
        east, north = metres(LAT, LON, t_lat, t_lon)
        if got and me:
            dx, dz = got["x"] - me["x"], got["z"] - me["z"]
            res.check(close(dx, east * got["upm"], 0.01 * abs(east * got["upm"]))
                      and close(-dz, north * got["upm"], 0.01 * abs(north * got["upm"])),
                      "target east and north of us in true metres",
                      "scene %.0f, %.0f want %.0f, %.0f" % (dx, -dz, east * got["upm"], north * got["upm"]))
        res.check(got and close(got["y"], (4500 + MSL_FT - PA_FT) * 0.3048, 0.01),
                  "pressure altitude drawn MSL (+300 ft on this day)",
                  got and "%.1f m" % got["y"])
        res.check(got and got["vVisible"] and close(got["vBottom"], 0, 0.01)
                  and close(got["vTop"], got["y"], 0.01)
                  and close(got["vx"], got["x"], 0.01) and close(got["vz"], got["z"], 0.01),
                  "vertical tube from sea level up to the target",
                  got and "%.1f..%.1f" % (got["vBottom"], got["vTop"]))
        check_path(res, got, "climbing path: 045, 120 kt, +1000 ft/min over %d s" % seconds,
                   120, 45.0, 1000, seconds)
        p = got and got["path"]
        res.check(p and p["end"][1] > p["start"][1], "a climbing target's path points up")
        d.shot("synthview_traffic_climb")

        # -- the same target descends, higher and slower --------------------
        push(d, target("AAA001", t_lat, t_lon, 5200, 200.0, 90, -800))
        got = d.page.eval(PROBE % "AAA001")
        res.check(got and close(got["vTop"], (5200 + MSL_FT - PA_FT) * 0.3048, 0.01)
                  and close(got["vBottom"], 0, 0.01),
                  "vertical tube follows the new altitude", got and "%.1f m" % got["vTop"])
        check_path(res, got, "path follows: 200, 90 kt, -800 ft/min", 90, 200.0, -800, seconds)
        p = got and got["path"]
        res.check(p and p["end"][1] < p["start"][1], "a descending target's path points down")

        # -- GNSS altitude, north track, no speed ---------------------------
        push(d, target("AAA002", LAT + 0.03, LON - 0.04, 6000, 0.0, 100, 0, gnss=True),
             target("AAA003", LAT - 0.03, LON + 0.03, 3000, 270.0, 0, 0, speed_valid=False))
        north_t = wait_item(d, "AAA002")
        res.check(north_t and close(north_t["y"], 6000 * 0.3048, 0.01),
                  "GNSS altitude drawn as it came", north_t and "%.1f m" % north_t["y"])
        check_path(res, north_t, "a 000 track gets a level path north", 100, 0.0, 0, seconds)
        slow = wait_item(d, "AAA003")
        res.check(slow and slow["path"] and not slow["path"]["visible"],
                  "no speed report: no path", slow and slow["path"])

        # -- no vertical rate -----------------------------------------------
        push(d, target("AAA004", LAT + 0.02, LON + 0.02, 3500, 135.0, 100, 700, vvel_valid=False))
        unknown = wait_item(d, "AAA004")
        check_path(res, unknown, "no vertical rate: a level path, Vvel ignored", 100, 135.0, 0, seconds)
        res.check(unknown and unknown["path"] and unknown["path"]["color"] == 0x8a8a8a
                  and got["path"]["color"] == 0x1c1c1c,
                  "drawn lighter grey, a known rate dark",
                  unknown and unknown["path"] and hex(unknown["path"]["color"]))

        # -- ownship -------------------------------------------------------
        d.fly(frames=3, interval=0.3, **START)
        me = d.page.eval(PROBE % "ME")
        check_path(res, me, "own path from GPS: 090, 110 kt, +500 ft/min", 110, 90.0, 500, seconds)
        res.check(me and close(me["vTop"], MSL_FT * 0.3048, 0.01),
                  "own vertical tube up to GPS MSL", me and "%.1f m" % me["vTop"])

        res.check(not d.js_errors(), "no JS errors on the synthview plate", d.js_errors()[:1])

    true_heights(res)

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
