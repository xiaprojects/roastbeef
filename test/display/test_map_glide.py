"""The glide range on the map: the area reachable in a best-glide descent.

glideReach (js/glidereach.js) fans GLIDE_RADIALS ground tracks out from the
aircraft and glides along each at the best-glide speed of aircraft.json
"bestGlide", losing TAS / (glideRatio * GS) feet per foot of ground, until the
glide path is clearanceAglFt above the terrain under it, the wind stops it, or
the terrain data ends. The map draws the ends of the radials as one polygon.

    parameters   aircraft.json bestGlide read, defaults for missing or out of range
    still air    flat ground: every radial (height - ground - clearance) * ratio
    wind         downwind longer, upwind shorter, crosswind crabs, by the triangle;
                 a wind stronger than the airspeed stops the upwind radials
    ridge        a ridge it cannot clear ends the radials that meet it
    edge         unknown ground past the terrain data is not reachable
    too low      below the clearance nothing is drawn
    Po plain     the real grid at 3,000 ft: every radial matches an oracle
    Alps         10,000 ft at Aosta: the oracle again, the mountains cut it short
    map          the polygon on the map is the reach, translucent magenta
    profile      a bigger ratio in aircraft.json is a bigger area; disabled, none
    switcher     'Glide range' off draws nothing and is remembered
    no fix       nothing drawn
"""

import json
import math
import sys

from plates import Display, Result
from test_map_terrain import load_grid, SCOPE, LAYERS_RESTORED

FT = 0.3048
EARTH = 6371000.0
RADIALS = 120

GLIDE_SHOWN = "%s.map.getLayers().getArray().find(l => l.get('title') === 'Glide range')" % SCOPE
GLIDE_SAVED = "localStorage.getItem('stratux.map.layers.Glide range.visible')"

# A synthetic window: `rows` x `cols` cells of 0.01 deg from (lat0, lon0), all at
# `elev` metres, with an optional east-west ridge row of `ridge_elev` at `ridge_lat`.
SYNTH = """((lat0, lon0, rows, cols, elev, ridgeLat, ridgeElev) => {
    const data = [];
    for (let i = 0; i < rows; i++) {
        const lat = lat0 + (i + 0.5) * 0.01;
        const e = (ridgeLat !== null && Math.abs(lat - ridgeLat) < 0.01) ? ridgeElev : elev;
        data.push(new Array(cols).fill(e));
    }
    return {terrainData: data, moltipliers: {lat: 0.01, lon: 0.01},
            planimetry: {start: {lat: lat0, lon: lon0},
                         end: {lat: lat0 + rows * 0.01, lon: lon0 + cols * 0.01}}};
})(%r, %r, %d, %d, %r, %s, %r)"""


def reach(d, grid_js, lat, lon, alt_ft, params, wind=None):
    return d.page.eval("glideReach(%s, %r, %r, %r, glideParameters({bestGlide: %s}), %s)"
                       % (grid_js, lat, lon, alt_ft, json.dumps(params), json.dumps(wind)))


def tas(ias, alt_ft):
    sigma = max(1 - 6.8756e-6 * max(alt_ft, 0), 0.01) ** 4.2559
    return ias / math.sqrt(sigma)


def ground_speed(track, v, wfrom, wkt):
    a = math.radians(track - wfrom)
    cross = wkt * math.sin(a)
    if abs(cross) >= v:
        return 0
    return math.sqrt(v * v - cross * cross) - wkt * math.cos(a)


def oracle(grid, lat, lon, alt_ft, ratio, ias, clearance_ft, wind=None):
    """The reach along each radial, marched over the grid the browser loaded."""
    def elev(la, lo):
        e, _ = grid.lookup(la, lo)
        return e
    h0, clr = alt_ft * FT, clearance_ft * FT
    here = elev(lat, lon)
    if here is None or h0 < max(here, 0) + clr:
        return None
    v = tas(ias, alt_ft)
    m_lat = EARTH * math.pi / 180
    m_lon = m_lat * math.cos(math.radians(lat))
    step = max(50, 0.5 * min(grid.dlat, grid.dlon * math.cos(math.radians(lat))) * m_lat)
    out = []
    for r in range(RADIALS):
        track = r * 360 / RADIALS
        gs = ground_speed(track, v, *(wind or (0, 0)))
        d = 0.0
        if gs > 0:
            sink = v / (ratio * gs)
            prev = h0 - max(here, 0) - clr
            for k in range(1, 4001):
                dk = k * step
                t = math.radians(track)
                e = elev(lat + dk * math.cos(t) / m_lat, lon + dk * math.sin(t) / m_lon)
                if e is None:
                    break
                margin = h0 - dk * sink - max(e, 0) - clr
                if margin < 0:
                    d = dk - step * margin / (margin - prev)
                    break
                d, prev = dk, margin
        out.append(d)
    return out, step


def pure(d, res):
    """glideReach and glideParameters on synthetic ground, against the triangle."""
    p = d.page.eval("glideParameters({})")
    res.check(p == {"enabled": True, "glideRatio": 9, "speedKt": 75, "clearanceAglFt": 500, "useWind": True},
              "parameters: defaults without a bestGlide block", p)
    p = d.page.eval("glideParameters({bestGlide: {glideRatio: 100, speedKt: '90', clearanceAglFt: -1,"
                    " enabled: 'no', useWind: false}})")
    res.check(p == {"enabled": True, "glideRatio": 9, "speedKt": 90, "clearanceAglFt": 500, "useWind": False},
              "parameters: out of range or mistyped fall back, the rest are taken", p)

    flat = SYNTH % (44.0, 9.0, 200, 200, 100.0, "null", 0.0)
    params = {"glideRatio": 10, "speedKt": 75, "clearanceAglFt": 500}
    want = (3000 * FT - 100 - 500 * FT) * 10
    r = reach(d, flat, 45.0, 10.0, 3000, params)
    worst = max(abs(x - want) for x in r["reachM"]) if r else None
    res.check(r and len(r["points"]) == RADIALS and worst < 1,
              "still air: every radial %.0f m on flat ground" % want, worst)
    # The polygon's points are where the radials say
    lat, lon = r["points"][30]          # due east
    res.check(abs(lat - 45.0) < 1e-9 and abs((lon - 10.0) * math.cos(math.radians(45)) * EARTH * math.pi / 180 - want) < 1,
              "still air: the east point is %.0f m east" % want, r["points"][30])

    v = tas(75, 3000)
    r = reach(d, flat, 45.0, 10.0, 3000, params, {"from": 0, "speed": 20})
    bad = []
    for track in (0, 90, 180, 270, 45):
        expect = want * ground_speed(track, v, 0, 20) / v
        got = r["reachM"][int(track * RADIALS / 360)]
        if abs(got - expect) > 1:
            bad.append("%d: %.0f want %.0f" % (track, got, expect))
    res.check(not bad, "wind 20 kt from north: radials by the wind triangle (TAS %.1f kt)" % v, bad)
    res.check(r["reachM"][60] > want > r["reachM"][0],
              "wind: downwind longer than still air, upwind shorter",
              (round(r["reachM"][0]), round(r["reachM"][60])))

    r = reach(d, flat, 45.0, 10.0, 3000, params, {"from": 0, "speed": 120})
    res.check(r["reachM"][0] == 0 and r["limit"][0] == "wind" and r["reachM"][60] > 0,
              "wind stronger than the airspeed: nothing upwind, still a reach downwind",
              (r["reachM"][0], r["limit"][0]))

    ridge = SYNTH % (44.0, 9.0, 200, 200, 100.0, 45.03, 900.0)
    r = reach(d, ridge, 45.0, 10.0, 3000, params)
    res.check(r["limit"][0] == "terrain" and 2000 < r["reachM"][0] < 3400 and abs(r["reachM"][60] - want) < 1,
              "ridge 3 km north: north radial stops at it, south one does not",
              (round(r["reachM"][0]), r["limit"][0], round(r["reachM"][60])))

    edge = SYNTH % (44.0, 9.0, 102, 200, 100.0, "null", 0.0)   # ends at 45.02 N
    r = reach(d, edge, 45.0, 10.0, 3000, params)
    res.check(r["limit"][0] == "edge" and r["reachM"][0] < 2300 and abs(r["reachM"][60] - want) < 1,
              "edge of the data 2.2 km north: the north radial ends there",
              (round(r["reachM"][0]), r["limit"][0]))

    res.check(reach(d, flat, 45.0, 10.0, 700, params) is None,
              "too low: 700 ft over 330 ft ground with a 500 ft clearance draws nothing")
    res.check(reach(d, "null", 45.0, 10.0, 3000, params) is None, "no terrain: nothing")


def fly(d, lat, lon, alt_ft, fix=2):
    d.fly(frames=3, interval=0.3, GPSLatitude=lat, GPSLongitude=lon,
          GPSAltitudeMSL=float(alt_ft), GPSFixQuality=fix)


def wait_glide(d, lat, lon, alt_ft, timeout=30):
    try:
        d.page.wait("(f => f && f[0] === %r && f[1] === %r && f[2] === %r && %s.terrainGrid)(%s.glideFor)"
                    % (lat, lon, float(alt_ft), SCOPE, SCOPE), timeout=timeout,
                    label="glide range at %s, %s, %d ft" % (lat, lon, alt_ft))
    except TimeoutError:
        pass
    # The terrain window may land just after the fix: let one more recompute run
    d.page.pump(1.2)
    fly(d, lat, lon, alt_ft)
    d.page.pump(1.2)


def on_map(d, res, grid, name, lat, lon, alt_ft):
    tag = "%-9s" % name
    fly(d, lat, lon, alt_ft)
    wait_glide(d, lat, lon, alt_ft)
    got = d.page.eval("%s.glideReach" % SCOPE)
    sit = d.page.eval("window.situation")
    wind = (sit["WindDirection"], sit["WindSpeed"]) if sit.get("WindValid") else None
    p = d.page.eval("glideParameters(window.aircraftData)")
    want = oracle(grid, lat, lon, alt_ft, p["glideRatio"], p["speedKt"], p["clearanceAglFt"], wind)
    res.check(got is not None and want is not None, "%s a glide range is drawn" % tag)
    if got is None or want is None:
        return None
    radii, step = want
    off = [(i * 3, round(g), round(w)) for i, (g, w) in enumerate(zip(got["reachM"], radii))
           if abs(g - w) > 1 and abs(g - w) > 0.01 * w]
    res.check(not off, "%s every radial matches the oracle (%.0f-%.0f m, wind %s)"
              % (tag, min(radii), max(radii), wind), off[:3])
    return got


def drawn_polygon(d):
    return d.page.eval("""(() => {
        const f = %s.glideSource.getFeatures();
        if (f.length !== 1) return f.length;
        return f[0].getGeometry().getCoordinates()[0].map(c => ol.proj.toLonLat(c).reverse());
    })()""" % SCOPE)


def glide_pixels(d):
    """Magenta-ish pixels on the glide layer's canvas"""
    return d.page.eval("""(() => {
        %s.map.renderSync();
        const c = document.querySelector('.map-glide canvas');
        if (!c) return -1;
        const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let p = 0; p < px.length; p += 4)
            if (px[p + 3] && px[p] > 2 * px[p + 1] && px[p + 2] > 2 * px[p + 1]) n++;
        return n;
    })()""" % SCOPE)


def main():
    res = Result()
    with Display(situation={"GPSFixQuality": 0},
                 settings_overrides={"/settings/aircraft.json": {
                     "bestGlide": {"glideRatio": 10, "speedKt": 80, "clearanceAglFt": 600}}}) as d:
        grid = load_grid(d.srv)
        d.show("map", "#map_display", timeout=25)
        d.page.wait(LAYERS_RESTORED, timeout=15, label="map layers restored")

        pure(d, res)

        p = d.page.eval("glideParameters(window.aircraftData)")
        res.check(p["glideRatio"] == 10 and p["speedKt"] == 80 and p["clearanceAglFt"] == 600,
                  "profile: the map reads bestGlide from aircraft.json", p)
        res.check(d.page.eval("%s?.getVisible()" % GLIDE_SHOWN), "map has a visible 'Glide range' layer")

        fly(d, 45.07, 11.14, 3000, fix=0)
        d.page.pump(1.2)
        fly(d, 45.07, 11.14, 3000, fix=0)
        res.check(d.page.eval("%s.glideReach" % SCOPE) is None and drawn_polygon(d) == 0,
                  "no fix: nothing drawn")

        po = on_map(d, res, grid, "Po plain", 45.07, 11.14, 3000)
        poly = drawn_polygon(d)
        res.check(isinstance(poly, list) and len(poly) == RADIALS + 1
                  and all(abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6
                          for a, b in zip(poly, po["points"] if po else [])),
                  "map: the polygon is the reach, closed", len(poly) if isinstance(poly, list) else poly)
        d.page.eval("%s.map.getView().setCenter(ol.proj.fromLonLat([11.14, 45.07])); "
                    "%s.map.getView().setZoom(10)" % (SCOPE, SCOPE))
        res.check(glide_pixels(d) > 1000, "map: the area is drawn in magenta", glide_pixels(d))
        d.shot("map_glide_po")

        alps = on_map(d, res, grid, "Alps", 45.74, 7.32, 10000)
        if alps:
            res.check("terrain" in alps["limit"] and min(alps["reachM"]) < 0.5 * max(alps["reachM"]),
                      "Alps      the mountains cut some radials well short",
                      (round(min(alps["reachM"])), round(max(alps["reachM"]))))
        d.page.eval("%s.map.getView().setCenter(ol.proj.fromLonLat([7.32, 45.74]))" % SCOPE)
        d.shot("map_glide_alps")

        # -- the profile changes the area ---------------------------------------
        # Over the flat Po plain the reach scales with the ratio; in the Alps the
        # mountains would cap it.
        before = sum(po["reachM"]) if po else 0
        d.page.eval("window.aircraftData.bestGlide.glideRatio = 20")
        on_map(d, res, grid, "ratio 20", 45.07, 11.14, 3000)
        after = d.page.eval("%s.glideReach?.reachM.reduce((a, b) => a + b)" % SCOPE)
        res.check(after and abs(after / before - 2) < 0.1, "profile: ratio 20 doubles the reach of 10 on the plain",
                  "%.2fx" % ((after or 0) / max(before, 1)))
        d.page.eval("window.aircraftData.bestGlide.enabled = false")
        d.page.pump(1.2)
        fly(d, 45.07, 11.14, 3000)
        res.check(drawn_polygon(d) == 0, "profile: enabled false draws nothing")
        d.page.eval("window.aircraftData.bestGlide.enabled = true")

        # -- the layer switcher -------------------------------------------------
        d.page.eval("%s.setVisible(false)" % GLIDE_SHOWN)
        res.check(drawn_polygon(d) == 0 and d.page.eval(GLIDE_SAVED) == "false",
                  "switcher: off draws nothing and is saved", d.page.eval(GLIDE_SAVED))
        d.show("speed", timeout=25)
        d.show("map", "#map_display", timeout=25)
        d.page.wait(LAYERS_RESTORED, timeout=15, label="map layers restored")
        fly(d, 45.74, 7.32, 10000)
        d.page.pump(1.2)
        fly(d, 45.74, 7.32, 10000)
        res.check(not d.page.eval("%s.getVisible()" % GLIDE_SHOWN) and drawn_polygon(d) == 0,
                  "switcher: still off on the next visit")
        d.page.eval("%s.setVisible(true)" % GLIDE_SHOWN)
        d.page.pump(2)
        res.check(isinstance(drawn_polygon(d), list), "switcher: on again, drawn again")

        res.check(not d.js_errors(), "no JS errors", d.js_errors()[:1])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
