"""The glide range on the 3D synthetic view.

The synthetic view stands the boundary of the reachable area (glideReach,
js/glidereach.js, the one the 2D map outlines) on its terrain as a dashed
translucent curtain with a solid line along its foot (buildGlideRange in
plates/js/synthview.js), styled by synthview.json "glideRange".

    reach        the same reach the map computes, over the same shared window,
                 and it matches the oracle of test_map_glide.py
    curtain      one 'glideRange' group: a dashed curtain and its outline
    on terrain   every foot vertex liftMeters above the terrain mesh under it,
                 every top vertex wallMeters above its foot
    dashed       the curtain covers part of the boundary, not all of it
    too low      below the clearance the curtain goes
    profile      bestGlide.enabled false in aircraft.json: no curtain
"""

import sys

from plates import Display, Result
from test_map_terrain import load_grid
from test_map_glide import oracle, fly

SV = "angular.element(document.getElementById('synthviewFrame')).scope()"
GROUP = """(() => { const s = window.__rbScene; if (!s) return null;
    let g = null; s.traverse(o => { if (o.name === 'glideRange') g = o; }); return g; })()"""
GROUPS = """(() => { const s = window.__rbScene; if (!s) return -1;
    let n = 0; s.traverse(o => { if (o.name === 'glideRange') n++; }); return n; })()"""

# Every outline vertex against the terrain mesh under it (Rendering.groundAt)
ON_TERRAIN = """((lift, wall) => {
    const g = %s; if (!g) return null;
    const r = %s.remote.rendering;
    const line = g.getObjectByName('glideRangeLine').geometry.attributes.position.array;
    const curtain = g.getObjectByName('glideRangeCurtain').geometry.attributes.position.array;
    let foot = 0, top = 0, bad = [];
    for (let i = 0; i < line.length; i += 3) {
        const ground = r.groundAt(line[i], line[i + 2]);
        if (ground === null) { bad.push(['off', line[i], line[i + 2]]); continue; }
        const base = Math.max(ground, 0) + lift;
        if (Math.abs(line[i + 1] - base) < 0.01) foot++;
        else if (Math.abs(line[i + 1] - base - wall) < 0.01) top++;
        else bad.push([line[i], line[i + 1], line[i + 2], base]);
    }
    return {foot: foot, top: top, bad: bad.slice(0, 3), nbad: bad.length,
            curtainTriangles: curtain.length / 9, color: g.children[0].material.color.getHex(),
            opacity: g.children[0].material.opacity};
})(%r, %r)"""


def wait_glide(d, lat, lon, alt_ft):
    for _ in range(3):
        fly(d, lat, lon, alt_ft)
        d.page.pump(1.2)
    try:
        d.page.wait("(f => f && f[0] === %r && f[1] === %r && f[2] === %r)(%s.glideFor)"
                    % (lat, lon, float(alt_ft), SV), timeout=20, label="3D glide range")
    except TimeoutError:
        pass


def main():
    res = Result()
    lat, lon, alt = 45.74, 7.32, 10000
    with Display(situation={"GPSFixQuality": 0}) as d:
        grid = load_grid(d.srv)
        style = d.page.eval("fetch('/settings/synthview.json').then(r => r.json()).then(j => j.glideRange)")
        fly(d, lat, lon, alt)
        d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
        d.instrument_three()
        d.show("synthview", "#synthviewFrame", timeout=25)
        wait_glide(d, lat, lon, alt)

        got = d.page.eval("%s.glideReach" % SV)
        res.check(got is not None, "a reach is computed at %d ft over Aosta" % alt)
        same = d.page.eval("(r => r && JSON.stringify(r.reachM))(glideReach(globalTerrainGrid.data, %r, %r, %r,"
                           " glideParameters(window.aircraftData), null))" % (lat, lon, alt))
        res.check(got and same == d.page.eval("JSON.stringify(%s.glideReach.reachM)" % SV),
                  "the same reach the map computes, over the shared window")
        p = d.page.eval("glideParameters(window.aircraftData)")
        want = oracle(grid, lat, lon, alt, p["glideRatio"], p["speedKt"], p["clearanceAglFt"])
        if got and want:
            off = [i for i, (g, w) in enumerate(zip(got["reachM"], want[0])) if abs(g - w) > max(1, 0.01 * w)]
            res.check(not off, "every radial matches the oracle", off[:3])

        res.check(d.page.eval(GROUPS) == 1, "one 'glideRange' group in the scene", d.page.eval(GROUPS))
        lift = style.get("liftMeters", 15) if style else 15
        wall = style.get("wallMeters", 150) if style else 150
        t = d.page.eval(ON_TERRAIN % (GROUP, SV, lift, wall))
        res.check(t and t["foot"] > 2 * 120 and t["nbad"] == 0,
                  "every foot vertex %g m above the terrain mesh, every top %g m above it" % (lift, wall),
                  t and {k: t[k] for k in ("foot", "top", "nbad", "bad")})
        # Each dash adds 2 triangles and one top segment (2 vertices) per sample
        # step; foot segments cover every step.
        res.check(t and 0 < t["top"] < t["foot"] and t["curtainTriangles"] == t["top"],
                  "the curtain is dashed: it covers part of the boundary",
                  t and (t["top"] // 2, t["foot"] // 2))
        res.check(t and t["color"] == (style or {}).get("color", 0xFF00FF)
                  and abs(t["opacity"] - (style or {}).get("opacity", 0.55)) < 1e-6,
                  "coloured as synthview.json glideRange says", t and (hex(t["color"]), t["opacity"]))
        d.shot("synthview_glide")

        # -- too low: the curtain goes ------------------------------------------
        wait_glide(d, 45.74, 7.32, 2000)       # Aosta valley floor is ~580 m
        res.check(d.page.eval("%s.glideReach" % SV) is None and d.page.eval(GROUPS) == 0,
                  "below the clearance: no curtain", d.page.eval(GROUPS))

        # -- the profile turns it off -------------------------------------------
        wait_glide(d, lat, lon, alt)
        res.check(d.page.eval(GROUPS) == 1, "back up: the curtain again", d.page.eval(GROUPS))
        d.page.eval("window.aircraftData.bestGlide = Object.assign({}, window.aircraftData.bestGlide, {enabled: false})")
        wait_glide(d, lat, lon, alt + 10)
        res.check(d.page.eval(GROUPS) == 0, "bestGlide.enabled false: no curtain", d.page.eval(GROUPS))

        res.check(not d.js_errors(), "no JS errors", d.js_errors()[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
