"""The terrain overlay on the map, flown over Europe.

The map colours the synthetic view's terrain against the aircraft's GPS altitude
with the rule the 3D view uses (globalTerrainColor in js/global.js): green clear,
yellow less than 200 m below the aircraft, red above it, blue at or below sea
level, nothing before the first fix. Both screens share one window of the
elevation grid around the aircraft (globalTerrainGrid in js/global.js), cut
anew once the aircraft is half way to its edge; outside it nothing is drawn.

The test flies the display over real European terrain and reads the overlay back
pixel by pixel: a probe every few pixels across the whole map, each checked
against a second copy of the rule applied to the very grid the browser loaded,
cut the way the display should cut it. A wrong projection, a flipped row order,
a cell off by one, a window in the wrong place or a stale altitude therefore
shows up as a mismatch at a named position, not as a picture that looks about
right. Named points (Mont Blanc, the sea off Genoa, ...) then check that the
data says what a pilot expects there.

    no fix       nothing downloaded, nothing drawn
    Alps FL100   Aosta at 10,000 ft: Mont Blanc red, slopes yellow, valleys green
    Alps FL160   the same place at 16,000 ft: above everything, all green
    Genoa        3,000 ft on the coast: the sea blue, the Apennines red
    Po plain     2,000 ft at Ostiglia: green around the aircraft
    north edge   the grid ends at 47 N: nothing is drawn past it
    window       zoomed out, only the window around the aircraft is drawn, and
                 only its cells are in memory
    map follows  40% of the way to the window's edge, the window stays; past half
                 way, one download and a new window around the aircraft
    switcher     tapping Terrain in the layer switcher hides and shows the overlay,
                 and the choice is still there on the next visit to the map
    3D view      the terrain mesh holds the same window, coloured the same way
    3D follows   past half way the mesh is replaced by the new window, laid where
                 it belongs, with the airfields it brings in
    on request   with the overlay off the map downloads nothing; the screen that
                 needs the terrain first downloads it and the other reuses it
"""

import json
import math
import sys
import time
import urllib.request

from plates import Display, Result

FT = 0.3048
CAUTION_M = 200                 # TERRAIN_CAUTION_METERS, js/global.js
WINDOW = 75 / 1.86 / 45         # TERRAIN_WINDOW_DEGREES, js/global.js: half the side
POI_ABOVE_GROUND = 100          # elevantionPOIfromSurface, synthview.js: airfield markers
PROBE_STEP = 16                 # pixels between probes, about 3000 per map
# A probe this close to a cell edge (in cells) could fall either side of it
# depending on the last bit of a float, so it is not compared.
EDGE = 0.02

WATER, CLEAR, CAUTION, WARNING, NONE = "water", "clear", "caution", "warning", "none"
RGB = {(0, 0, 1): WATER, (0, 1, 0): CLEAR, (1, 1, 0): CAUTION, (1, 0, 0): WARNING}
RGB255 = {tuple(255 * c for c in rgb): name for rgb, name in RGB.items()}
# OpenLayers 6 draws a layer's opacity into its canvas, so every overlay pixel
# carries TERRAIN_OPACITY (map.js) as alpha: the base map shows through.
ALPHA = round(0.4 * 255)

# The Europe grid (web/settings/elevations.json) covers 37-47 N, 4-19 E at
# 0.01 deg; every scenario below sits inside it. A coarser or different grid
# would make the named points meaningless, so that fails up front.
DEM_LAT, DEM_LON, DEM_STEP = (37.0, 47.0), (4.0, 19.0), 0.011

# (name, lat, lon, altitude ft, {named point: (lat, lon, expected)}, extra check)
SCENARIOS = [
    ("alps_fl100", 45.74, 7.32, 10000, {
        "Mont Blanc": (45.8326, 6.8652, WARNING),
        "Gran Paradiso": (45.517, 7.267, WARNING),
        "Aosta": (45.737, 7.320, CLEAR)}, "all_three"),
    ("alps_fl160", 45.74, 7.32, 16000, {
        "Mont Blanc": (45.8326, 6.8652, CLEAR),
        "Aosta": (45.737, 7.320, CLEAR)}, "nothing_ahead"),
    ("genoa_3000", 44.41, 8.93, 3000, {
        "sea off Genoa": (44.30, 8.95, WATER),
        "Monte Antola": (44.5906, 9.1411, WARNING),
        "Monte Beigua": (44.435, 8.582, WARNING)}, "sea_and_ridges"),
    ("po_plain_2000", 45.07, 11.14, 2000, {
        "Ostiglia": (45.07, 11.14, CLEAR),
        "Mantova": (45.16, 10.79, CLEAR)}, "clear_around"),
    ("north_edge", 46.85, 9.00, 12000, {}, "edge"),
]

SCOPE = "angular.element(document.getElementById('map_display')).scope()"
TERRAIN_SHOWN = "%s.map.getLayers().getArray().find(l => l.get('title') === 'Terrain')?.getVisible() === true" % SCOPE
TERRAIN_SAVED = "localStorage.getItem('stratux.map.layers.Terrain.visible')"
# map.js adds the tileset layers and then restores the saved visibilities in the
# same callback, so once this layer exists the Terrain choice has been restored.
LAYERS_RESTORED = "%s.map.getLayers().getArray().some(l => l.get('title') === 'Aircraft symbols')" % SCOPE
SWITCHER_OPEN = "document.querySelector('.layer-switcher').classList.contains('shown')"
SHARED = "window.globalTerrainGrid"     # js/global.js: the window every screen uses
CUT_AT = "(w => w && [w.latitude, w.longitude])(%s.data)" % SHARED

PROBE = """((step) => {
    const sc = %s, map = sc.map;
    map.renderSync();
    const canvas = document.querySelector('.map-terrain canvas');
    if (!canvas) return null;
    const size = map.getSize();
    const sx = canvas.width / size[0], sy = canvas.height / size[1];
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const at = (x, y) => {
        const p = (Math.floor(y * sy) * canvas.width + Math.floor(x * sx)) * 4;
        return [data[p], data[p + 1], data[p + 2], data[p + 3]];
    };
    // Staggered, not a regular lattice: at a fixed spacing whole rows of probes
    // alias onto cell edges and cannot be called.
    const probes = [];
    for (let r = 0, y; (y = r * step + (r * 7) %% step) < size[1]; r++) {
        for (let c = 0, x; (x = c * step + (c * 5) %% step) < size[0]; c++) {
            const ll = ol.proj.toLonLat(map.getCoordinateFromPixel([x + 0.5, y + 0.5]));
            probes.push([ll[0], ll[1]].concat(at(x + 0.5, y + 0.5)));
        }
    }
    const points = %s.map(([lat, lon]) => {
        const px = map.getPixelFromCoordinate(ol.proj.fromLonLat([lon, lat]));
        return at(px[0], px[1]);
    });
    return {probes: probes, points: points, altitude: sc.terrainAltitude};
})(%d)"""

TERRAIN_MESHES = """(() => {
    const s = window.__rbScene; if (!s) return [];
    const meshes = [];
    s.traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry'
                           && o.geometry.attributes.color) meshes.push(o); });
    return meshes;
})()"""

MESH = """((meshes) => {
    if (!meshes.length) return null;
    const mesh = meshes[0], p = mesh.geometry.parameters;
    const pos = mesh.geometry.attributes.position.array;
    const col = mesh.geometry.attributes.color.array;
    const vertices = [];
    for (let v = 0; v < pos.length / 3; v++)
        vertices.push([pos[v * 3 + 2], col[v * 3], col[v * 3 + 1], col[v * 3 + 2]]);
    return {count: meshes.length, uuid: mesh.uuid, x: mesh.position.x, y: mesh.position.y,
            z: mesh.position.z, cols: p.widthSegments + 1, rows: p.heightSegments + 1,
            width: p.width, vertices: vertices};
})(%s)""" % TERRAIN_MESHES

MESH_IDS = "%s.map(m => m.uuid)" % TERRAIN_MESHES

# Every point of interest stands on a vertical tube (generateTubeVertical in
# synthview.js) as tall as the marker's height: [x, z, height] of each.
TUBES = """(() => {
    const s = window.__rbScene; if (!s) return [];
    const out = [];
    s.traverse(o => { if (o.isMesh && o.geometry.type === 'CylinderGeometry'
                           && o.geometry.parameters.radiusTop === 5)
        out.push([o.position.x, o.position.z, o.geometry.parameters.height]); });
    return out;
})()"""


def terrain_class(elevation, altitude):
    """globalTerrainColor (js/global.js), written again so the test does not trust it."""
    if elevation <= 0:
        return WATER
    if elevation > 50:
        if elevation > altitude:
            return WARNING
        if elevation > altitude - CAUTION_M:
            return CAUTION
    return CLEAR


class Grid:
    """The grid the browser loaded, read as docs/terrain-elevations.md describes:
    row 0 is the south edge, `end` is exclusive, a position falls in the cell
    at or south-west of it."""

    def __init__(self, data, url):
        self.data, self.url = data, url
        self.cells = data["terrainData"]
        self.rows, self.cols = len(self.cells), len(self.cells[0])
        start, end = data["planimetry"]["start"], data["planimetry"]["end"]
        self.lat0, self.lon0, self.lat1, self.lon1 = start["lat"], start["lon"], end["lat"], end["lon"]
        self.dlat = (end["lat"] - start["lat"]) / self.rows
        self.dlon = (end["lon"] - start["lon"]) / self.cols

    def locate(self, lat, lon):
        """(row, column, True when too close to a cell edge to call)."""
        fi, fj = (lat - self.lat0) / self.dlat, (lon - self.lon0) / self.dlon
        edge = min(abs(fi - round(fi)), abs(fj - round(fj))) < EDGE
        return math.floor(fi), math.floor(fj), edge

    def lookup(self, lat, lon):
        """(elevation, or None off the grid; True when too close to a cell edge to call)."""
        i, j, edge = self.locate(lat, lon)
        if 0 <= i < self.rows and 0 <= j < self.cols:
            return self.cells[i][j], edge
        return None, edge

    def expected(self, lat, lon, altitude, window):
        """What the overlay should show there: nothing outside the window."""
        i, j, edge = self.locate(lat, lon)
        if not window.holds(i, j):
            return NONE, None, edge
        return terrain_class(self.cells[i][j], altitude), self.cells[i][j], edge


class Window:
    """The part of the grid the display keeps around (lat, lon), cut the way
    globalTerrainCut (js/global.js) should: whole cells within WINDOW degrees of
    it, clipped to the grid."""

    def __init__(self, grid, lat, lon):
        def cell(degrees, first, step, count):
            return min(max(math.floor((degrees - first) / step), 0), count)
        self.grid, self.lat, self.lon = grid, lat, lon
        self.i0 = cell(lat - WINDOW, grid.lat0, grid.dlat, grid.rows)
        self.i1 = cell(lat + WINDOW, grid.lat0, grid.dlat, grid.rows)
        self.j0 = cell(lon - WINDOW, grid.lon0, grid.dlon, grid.cols)
        self.j1 = cell(lon + WINDOW, grid.lon0, grid.dlon, grid.cols)
        self.rows, self.cols = self.i1 - self.i0, self.j1 - self.j0
        self.south, self.north = grid.lat0 + self.i0 * grid.dlat, grid.lat0 + self.i1 * grid.dlat
        self.west, self.east = grid.lon0 + self.j0 * grid.dlon, grid.lon0 + self.j1 * grid.dlon
        self.centre = ((self.south + self.north) / 2, (self.west + self.east) / 2)

    def holds(self, i, j):
        return self.i0 <= i < self.i1 and self.j0 <= j < self.j1

    def covers(self, lat, lon):
        """Strictly inside, as synthview.js picks the airfields of a window."""
        return self.south < lat < self.north and self.west < lon < self.east

    def cell(self, row, col):
        """Elevation at the window's own row (0 south) and column."""
        return self.grid.cells[self.i0 + row][self.j0 + col]


def drawn(rgba):
    if not rgba[3]:
        return NONE
    return RGB255.get(tuple(rgba[:3]), "rgb%s" % (tuple(rgba[:3]),))


def get_json(srv, path):
    with urllib.request.urlopen(srv.url + path, timeout=30) as resp:
        return json.loads(resp.read())


def load_grid(srv):
    """Fetch the grid the way the display does: synthview.json names it."""
    url = get_json(srv, "/settings/synthview.json")["elevationUrl"]
    return Grid(get_json(srv, url), url)


class Downloads:
    """Serves the grid in place of the file and counts how often the display
    downloads it. Install before the first plate that could ask for it."""

    def __init__(self, srv, grid):
        self.grid, self.count = grid, 0
        srv.rest[grid.url] = self

    def __call__(self):
        self.count += 1
        return self.grid.data


def fly(d, lat, lon, alt_ft, fix=2):
    d.fly(frames=3, interval=0.3, GPSLatitude=lat, GPSLongitude=lon,
          GPSAltitudeMSL=float(alt_ft), GPSFixQuality=fix)


def look_at(d, lat, lon):
    """The map centres itself on the first fix only; after that the pilot pans."""
    d.page.eval("%s.map.getView().setCenter(ol.proj.fromLonLat([%r, %r]))" % (SCOPE, lon, lat))


def wait_window(d, lat, lon, timeout=30):
    """Wait until the map draws the shared window cut around (lat, lon)."""
    try:
        d.page.wait("(w => w && w.latitude === %r && w.longitude === %r && %s.terrainGrid === w)(%s.data)"
                    % (lat, lon, SCOPE, SHARED), timeout=timeout,
                    label="terrain window at %s, %s" % (lat, lon))
        return True
    except TimeoutError:
        return False


def shot(d, name):
    """Screenshot once the base map has drawn, if it does: its tiles come from the
    internet, so this waits a little and then takes the picture anyway. Nothing
    asserts on it; the overlay is read from its own canvas."""
    d.page.eval("window.__rbMapDrawn = false; %s.map.once('rendercomplete', "
                "() => { window.__rbMapDrawn = true; }); %s.map.render()" % (SCOPE, SCOPE))
    try:
        d.page.wait("window.__rbMapDrawn", timeout=6, label="base map")
    except TimeoutError:
        pass
    d.shot("map_terrain_%s" % name)


def probe(d, points=()):
    return d.page.eval(PROBE % (SCOPE, json.dumps([[p[0], p[1]] for p in points]), PROBE_STEP))


def compare(grid, probes, altitude, window):
    """Every probe against the oracle: (classes drawn, mismatches, probes compared)."""
    seen, bad, compared = {}, [], 0
    for lon, lat, *rgba in probes:
        want, elevation, edge = grid.expected(lat, lon, altitude, window)
        got = drawn(rgba)
        if edge:
            continue
        compared += 1
        seen.setdefault(got, []).append((lat, lon))
        if got != want:
            bad.append("%.4fN %.4fE elev %s: drew %s, want %s" % (lat, lon, elevation, got, want))
    return seen, bad, compared


def matches(probes, bad, compared):
    return bool(probes) and not bad and compared > 0.85 * len(probes)


def mismatch_note(bad, compared):
    return "%d compared, %d wrong%s" % (compared, len(bad), (": " + bad[0]) if bad else "")


def scenario(d, res, grid, name, lat, lon, alt_ft, points, extra):
    altitude = alt_ft * FT
    fly(d, lat, lon, alt_ft)
    look_at(d, lat, lon)
    tag = "%-13s" % name
    res.check(wait_window(d, lat, lon), "%s the map draws a window cut around the aircraft" % tag,
              d.page.eval(CUT_AT))
    try:
        d.page.wait("Math.abs(%s.terrainAltitude - %r) < 1e-6" % (SCOPE, altitude),
                    timeout=10, label="overlay at %d ft" % alt_ft)
    except TimeoutError:
        pass                            # reported just below, with the value it has
    shown = d.page.eval("%s.terrainAltitude" % SCOPE)
    res.check(shown is not None and abs(shown - altitude) < 1e-6,
              "%s coloured for %d ft (%.0f m)" % (tag, alt_ft, altitude), shown)
    got = probe(d, list(points.values()))
    shot(d, name)

    seen, bad, compared = compare(grid, got["probes"], altitude, Window(grid, lat, lon))
    res.check(matches(got["probes"], bad, compared),
              "%s every probe matches the grid at %d ft" % (tag, alt_ft), mismatch_note(bad, compared))
    counts = {k: len(v) for k, v in seen.items()}

    for (label, (plat, plon, want)), rgba in zip(points.items(), got["points"]):
        elevation, _ = grid.lookup(plat, plon)
        res.check(drawn(rgba) == want, "%s %s (%s m) is %s" % (tag, label, elevation, want),
                  drawn(rgba))

    if extra == "all_three":
        res.check(all(counts.get(k) for k in (WARNING, CAUTION, CLEAR)),
                  "%s red, yellow and green all in view" % tag, counts)
    elif extra == "nothing_ahead":
        res.check(not counts.get(WARNING) and not counts.get(CAUTION),
                  "%s no red or yellow anywhere" % tag, counts)
    elif extra == "sea_and_ridges":
        res.check(counts.get(WATER) and counts.get(WARNING) and counts.get(CAUTION),
                  "%s sea blue, ridges red and yellow" % tag, counts)
    elif extra == "clear_around":
        near = [drawn(rgba) for plon, plat, *rgba in got["probes"]
                if abs(plat - lat) < 0.15 and abs(plon - lon) < 0.15]
        res.check(near and all(c == CLEAR for c in near),
                  "%s green within 0.15 deg of the aircraft" % tag,
                  "%d probes: %s" % (len(near), sorted(set(near))))
    elif extra == "edge":
        north = [drawn(rgba) for plon, plat, *rgba in got["probes"] if plat > grid.lat1 + 0.02]
        south = [drawn(rgba) for plon, plat, *rgba in got["probes"] if plat < grid.lat1 - 0.02]
        res.check(north and all(c == NONE for c in north),
                  "%s nothing drawn north of %.2f N" % (tag, grid.lat1),
                  "%d probes: %s" % (len(north), sorted(set(north))))
        res.check(south and all(c != NONE for c in south),
                  "%s everything drawn south of it" % tag,
                  "%d probes: %s" % (len(south), sorted(set(south))))
    return got


def window_only(d, res, grid, lat, lon, alt_ft):
    """Zoomed out past the window: only the cells kept in memory are drawn."""
    tag = "%-13s" % "window"
    win = Window(grid, lat, lon)
    fly(d, lat, lon, alt_ft)
    look_at(d, lat, lon)
    wait_window(d, lat, lon)
    zoom = d.page.eval("%s.map.getView().getZoom()" % SCOPE)
    d.page.eval("%s.map.getView().setZoom(8)" % SCOPE)
    got = probe(d)
    shot(d, "window")
    d.page.eval("%s.map.getView().setZoom(%r)" % (SCOPE, zoom))

    probes = got["probes"] if got else []
    seen, bad, compared = compare(grid, probes, alt_ft * FT, win)
    outside = len(seen.get(NONE, []))
    res.check(matches(probes, bad, compared) and compared - outside > 100 and outside > 100,
              "%s zoomed out, only the window around the aircraft is drawn" % tag,
              "%d inside, %d outside; %s" % (compared - outside, outside, mismatch_note(bad, compared)))
    shape = d.page.eval("(w => [w.terrainData.length, w.terrainData[0].length])(%s.data)" % SHARED)
    res.check(shape == [win.rows, win.cols],
              "%s memory holds its %d x %d cells, not the %d x %d grid"
              % (tag, win.rows, win.cols, grid.rows, grid.cols), shape)


def map_follows(d, res, grid, downloads, lat, lon, alt_ft):
    """Flying east from where the window was cut: 40% of the way to its edge the
    map keeps it; past half way it downloads the grid and cuts a new one."""
    tag = "%-13s" % "map follows"
    before = downloads.count
    fly(d, lat, lon + 0.4 * WINDOW, alt_ft)
    cut = d.page.eval(CUT_AT)
    res.check(downloads.count == before and cut == [lat, lon],
              "%s 40%% of the way to the edge: the same window" % tag,
              "%d downloads, cut at %s" % (downloads.count - before, cut))

    far = lon + 0.6 * WINDOW
    fly(d, lat, far, alt_ft)
    look_at(d, lat, far)
    moved = wait_window(d, lat, far)
    res.check(moved and downloads.count == before + 1,
              "%s past half way: one download, a new window around the aircraft" % tag,
              "%d downloads, cut at %s" % (downloads.count - before, d.page.eval(CUT_AT)))
    got = probe(d)
    probes = got["probes"] if got else []
    _, bad, compared = compare(grid, probes, alt_ft * FT, Window(grid, lat, far))
    res.check(matches(probes, bad, compared), "%s the map draws the new window" % tag,
              mismatch_note(bad, compared))
    shot(d, "follows")


def tap_terrain(d):
    """Tap Terrain in the layer switcher with the mouse, opening the switcher first
    if it is closed. Returns whether the box showed ticked before the tap, or None
    if there is no Terrain entry to tap."""
    if not d.page.eval(SWITCHER_OPEN):
        d.page.click(".layer-switcher button")
        d.page.pump(0.3)
    # The panel is rebuilt each time it opens, so find the entry only now. A
    # closed panel has no size, and a click there would land on the map.
    n = d.page.eval("[...document.querySelectorAll('.layer-switcher .panel > ul > li')]"
                    ".findIndex(li => li.textContent.trim() === 'Terrain')")
    if n is None or n < 0 or not d.page.eval(SWITCHER_OPEN):
        return None
    entry = ".layer-switcher .panel > ul > li:nth-child(%d) input" % (n + 1)
    ticked = d.page.eval("document.querySelector(%s).checked" % json.dumps(entry))
    d.page.click(entry)
    d.page.pump(0.5)
    return ticked


def nothing_drawn(d):
    got = probe(d)
    shown = {drawn(p[2:]) for p in got["probes"]} if got else {NONE}
    return shown == {NONE}, sorted(shown)


def layer_switcher(d, res, grid, lat, lon, alt_ft, climb_ft):
    """Terrain in the layer switcher turns the overlay off and on, the overlay
    keeps following the altitude while it is off, and the map remembers the
    choice when the pilot comes back to it."""
    tag = "%-13s" % "switcher"
    win = Window(grid, lat, lon)

    def wait_altitude(feet):
        try:
            d.page.wait("Math.abs(%s.terrainAltitude - %r) < 1e-6" % (SCOPE, feet * FT),
                        timeout=10, label="overlay at %d ft" % feet)
        except TimeoutError:
            pass                        # the checks below then say what is drawn

    fly(d, lat, lon, alt_ft)
    look_at(d, lat, lon)
    wait_window(d, lat, lon)
    wait_altitude(alt_ft)
    ticked = tap_terrain(d)
    res.check(ticked is True, "%s Terrain is listed and ticked" % tag, ticked)
    empty, shown = nothing_drawn(d)
    res.check(not d.page.eval(TERRAIN_SHOWN) and empty,
              "%s one tap hides the overlay" % tag, shown)
    res.check(d.page.eval(TERRAIN_SAVED) == "false", "%s the map saves it as off" % tag,
              d.page.eval(TERRAIN_SAVED))

    # Climb while it is off: switched back on it must draw for the new altitude,
    # not the picture it had when it was hidden.
    fly(d, lat, lon, climb_ft)
    wait_altitude(climb_ft)
    ticked = tap_terrain(d)
    got = probe(d)
    probes = got["probes"] if got else []
    _, bad, compared = compare(grid, probes, climb_ft * FT, win)
    res.check(ticked is False and d.page.eval(TERRAIN_SHOWN) and matches(probes, bad, compared),
              "%s tapped again it shows, coloured for %d ft" % (tag, climb_ft),
              "was ticked: %s, %s" % (ticked, mismatch_note(bad, compared)))
    res.check(d.page.eval(TERRAIN_SAVED) == "true", "%s the map saves it as on" % tag,
              d.page.eval(TERRAIN_SAVED))

    # Off, away to another plate and back: still off, and shown unticked.
    tap_terrain(d)
    d.show("speed", timeout=25)
    d.show("map", "#map_display", timeout=25)
    d.page.wait(LAYERS_RESTORED, timeout=15, label="map layers restored")
    fly(d, lat, lon, alt_ft)
    wait_altitude(alt_ft)
    empty, shown = nothing_drawn(d)
    res.check(not d.page.eval(TERRAIN_SHOWN) and empty,
              "%s still off on the next visit to the map" % tag, shown)
    ticked = tap_terrain(d)
    got = probe(d)
    counts = {k: len(v) for k, v in compare(grid, got["probes"], alt_ft * FT, win)[0].items()} if got else {}
    res.check(ticked is False and d.page.eval(TERRAIN_SHOWN)
              and all(counts.get(k) for k in (WARNING, CAUTION, CLEAR)),
              "%s shown unticked, and one tap brings it back" % tag,
              "was ticked: %s, %s" % (ticked, counts))
    shot(d, "switcher")


def shared_rule(d, res):
    """globalTerrainColor at the band edges, against the oracle."""
    cases = [(e, a) for a in (0.0, 914.4, 3048.0)
             for e in (-13, 0, 1, 50, 51, a - 201, a - 200, a - 199, a, a + 1, 4808)]
    got = d.page.eval("%s.map(c => globalTerrainColor(c[0], c[1]))" % json.dumps(cases))
    bad = ["%s m at %s m: %s, want %s" % (e, a, RGB.get(tuple(g)), terrain_class(e, a))
           for (e, a), g in zip(cases, got or []) if RGB.get(tuple(g)) != terrain_class(e, a)]
    res.check(got and not bad, "globalTerrainColor matches the rule at every band edge",
              bad[:2] or "%d cases" % len(cases))


def check_mesh(res, tag, mesh, win, origin, alt_ft):
    """The scene's one terrain mesh holds exactly the window's cells, laid where
    the window is relative to the scene's origin (the centre of the first window,
    synthview.js), each vertex coloured by the rule. Returns the colour counts."""
    res.check(mesh and mesh["count"] == 1, "%s one terrain mesh in the scene" % tag,
              mesh and mesh["count"])
    if not mesh:
        return {}
    grid = win.grid
    bad = []
    if (mesh["rows"], mesh["cols"]) != (win.rows, win.cols):
        bad.append("%d x %d cells, want %d x %d" % (mesh["rows"], mesh["cols"], win.rows, win.cols))
    else:
        for v, (z, *_) in enumerate(mesh["vertices"]):
            row, col = win.rows - 1 - v // win.cols, v % win.cols     # vertices run from the north
            if z != win.cell(row, col):
                bad.append("row %d col %d: %s m, want %s" % (row, col, z, win.cell(row, col)))
    res.check(not bad, "%s the mesh holds the window around %.3fN %.3fE" % (tag, win.lat, win.lon),
              bad[:1] or "%d x %d cells" % (win.rows, win.cols))

    cell = mesh["width"] / mesh["cols"]
    want = ((win.centre[1] - origin[1]) / grid.dlon * cell, (origin[0] - win.centre[0]) / grid.dlat * cell)
    res.check(abs(mesh["x"] - want[0]) < 0.01 and abs(mesh["z"] - want[1]) < 0.01 and mesh["y"] == 0,
              "%s laid at its place in the scene" % tag,
              "at x %.2f z %.2f, want %.2f %.2f" % (mesh["x"], mesh["z"], want[0], want[1]))

    altitude = alt_ft * FT
    counts, wrong = {}, []
    for z, r, g, b in mesh["vertices"]:
        got, want_class = RGB.get((round(r), round(g), round(b))), terrain_class(z, altitude)
        counts[got] = counts.get(got, 0) + 1
        if got != want_class:
            wrong.append("vertex at %s m: %s, want %s" % (z, got, want_class))
    res.check(mesh["vertices"] and not wrong, "%s coloured by the same rule at %d ft" % (tag, alt_ft),
              "%d vertices, %d wrong %s" % (len(mesh["vertices"]), len(wrong), wrong[:1] or counts))
    return counts


def synthview_agrees(d, res, grid, downloads, lat, lon, alt_ft):
    """The 3D view lays the shared window as its terrain. Returns that window,
    whose centre is the scene's origin."""
    tag = "%-13s" % "3D view"
    before = downloads.count
    # The terrain loads around the first position the plate sees, so be there
    # before entering; and instrument first, the scene is built on entry.
    fly(d, lat, lon, alt_ft)
    d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
    d.instrument_three()
    d.show("synthview", "#synthviewFrame", timeout=25)
    fly(d, lat, lon, alt_ft)
    d.page.wait("(%s) !== null" % MESH, timeout=30, label="terrain mesh")
    fly(d, lat, lon, alt_ft)
    cut = d.page.eval(CUT_AT)
    win = Window(grid, *cut)
    res.check(downloads.count == before and abs(cut[0] - lat) <= 0.5 * WINDOW
              and abs(cut[1] - lon) <= 0.5 * WINDOW,
              "%s uses the window the map has: no download" % tag,
              "%d downloads, cut at %s" % (downloads.count - before, cut))
    counts = check_mesh(res, tag, d.page.eval(MESH), win, win.centre, alt_ft)
    res.check(all(counts.get(k) for k in (WARNING, CAUTION, CLEAR)),
              "%s Alps show red, yellow and green" % tag, counts)
    d.shot("map_terrain_synthview")
    return win


def synthview_follows(d, res, grid, downloads, first, airfields, lat, lon, alt_ft):
    """Flying east from where the 3D view's window was cut: 40% of the way to its
    edge the terrain stays; past half way the mesh is replaced by a new window,
    laid around the same origin, and the airfields under it come in."""
    tag = "%-13s" % "3D follows"
    before = downloads.count
    ids = d.page.eval(MESH_IDS)
    fly(d, lat, lon + 0.4 * WINDOW, alt_ft)
    res.check(d.page.eval(MESH_IDS) == ids and downloads.count == before,
              "%s 40%% of the way to the edge: the terrain stays" % tag,
              "%d downloads" % (downloads.count - before))

    far = lon + 0.6 * WINDOW
    fly(d, lat, far, alt_ft)
    try:
        d.page.wait("(ids => ids.length === 1 && ids[0] !== %s)(%s)" % (json.dumps(ids[0]), MESH_IDS),
                    timeout=30, label="new terrain mesh")
    except TimeoutError:
        pass                            # reported below
    fly(d, lat, far, alt_ft)
    res.check(downloads.count == before + 1 and d.page.eval(CUT_AT) == [lat, far],
              "%s past half way: one download, a new window around the aircraft" % tag,
              "%d downloads, cut at %s" % (downloads.count - before, d.page.eval(CUT_AT)))
    win = Window(grid, lat, far)
    check_mesh(res, tag, d.page.eval(MESH), win, first.centre, alt_ft)

    # Every airfield of either window stands where plan() puts it from the
    # scene's origin, on the terrain it was imported over.
    cell = d.page.eval("(%s)[0].geometry.parameters.width" % TERRAIN_MESHES) / win.cols
    wanted = []
    for a in airfields:
        if first.covers(a["Lat"], a["Lon"]) or win.covers(a["Lat"], a["Lon"]):
            x = (a["Lon"] - first.centre[1]) / grid.dlon * cell
            z = (first.centre[0] - a["Lat"]) / grid.dlat * cell
            elevation, edge = grid.lookup(a["Lat"], a["Lon"])
            wanted.append((a.get("name"), x, z, None if edge else elevation + POI_ABOVE_GROUND))
    new = sum(1 for a in airfields if win.covers(a["Lat"], a["Lon"]) and not first.covers(a["Lat"], a["Lon"]))

    def missing():
        tubes = d.page.eval(TUBES) or []
        out = []
        for name, x, z, height in wanted:
            hit = [t for t in tubes if abs(t[0] - x) < 0.01 and abs(t[1] - z) < 0.01]
            if not hit or (height is not None and all(t[2] != height for t in hit)):
                out.append("%s at %.0f, %.0f: %s" % (name, x, z, hit[:1] or "none"))
        return out

    deadline = time.time() + 30         # each marker loads its model first
    lost = missing()
    while lost and time.time() < deadline:
        d.page.pump(1.0)
        lost = missing()
    res.check(new and not lost,
              "%s all %d airfields of both windows in place, %d of them new" % (tag, len(wanted), new),
              lost[:1] or "%d markers" % len(d.page.eval(TUBES) or []))
    d.shot("map_terrain_synthview_follows")


def on_request(res, grid, lat, lon, alt_ft):
    """A fresh session with the overlay saved off: the map downloads nothing, the
    3D view downloads the grid, and the map, turned on, draws from its window."""
    tag = "%-13s" % "on request"
    with Display(situation={"GPSFixQuality": 0}) as d:
        downloads = Downloads(d.srv, grid)
        d.page.eval("localStorage.setItem('stratux.map.layers.Terrain.visible', 'false')")
        d.show("map", "#map_display", timeout=25)
        fly(d, lat, lon, alt_ft)
        d.page.wait(LAYERS_RESTORED, timeout=15, label="map layers restored")
        d.page.pump(1.0)
        res.check(downloads.count == 0 and d.page.eval(SHARED + ".data === null")
                  and not d.page.eval(TERRAIN_SHOWN),
                  "%s overlay off: the map downloads no terrain" % tag,
                  "%d downloads" % downloads.count)

        fly(d, lat, lon, alt_ft)
        d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
        d.instrument_three()
        d.show("synthview", "#synthviewFrame", timeout=25)
        fly(d, lat, lon, alt_ft)
        try:
            d.page.wait("(%s) !== null" % MESH, timeout=30, label="terrain mesh")
        except TimeoutError:
            pass                        # reported just below
        res.check(downloads.count == 1 and d.page.eval("(%s) !== null" % MESH),
                  "%s the 3D view downloads it and builds its terrain" % tag,
                  "%d downloads" % downloads.count)

        d.show("map", "#map_display", timeout=25)
        d.page.wait(LAYERS_RESTORED, timeout=15, label="map layers restored")
        fly(d, lat, lon, alt_ft)
        look_at(d, lat, lon)
        tap_terrain(d)
        wait_window(d, lat, lon, timeout=10)
        got = probe(d)
        probes = got["probes"] if got else []
        _, bad, compared = compare(grid, probes, alt_ft * FT, Window(grid, lat, lon))
        res.check(d.page.eval("%s.terrainGrid === %s.data" % (SCOPE, SHARED))
                  and matches(probes, bad, compared),
                  "%s turned on, the map draws the 3D view's window" % tag,
                  mismatch_note(bad, compared))
        res.check(downloads.count == 1, "%s and does not download it again" % tag,
                  "%d downloads" % downloads.count)
        res.check(not d.js_errors(), "%s no JS errors" % tag, d.js_errors()[:1])


def main():
    res = Result()
    with Display(situation={"GPSFixQuality": 0}) as d:
        grid = load_grid(d.srv)
        res.check(grid.lat0 <= DEM_LAT[0] and grid.lat1 >= DEM_LAT[1]
                  and grid.lon0 <= DEM_LON[0] and grid.lon1 >= DEM_LON[1]
                  and grid.dlat < DEM_STEP and grid.dlon < DEM_STEP,
                  "the served grid is the Europe grid",
                  "%s..%s N %s..%s E, %.4f x %.4f deg"
                  % (grid.lat0, grid.lat1, grid.lon0, grid.lon1, grid.dlat, grid.dlon))
        if res.failed:
            return 1
        downloads = Downloads(d.srv, grid)
        airfields = get_json(d.srv, "/settings/db.airfields.json")

        d.show("map", "#map_display", timeout=25)
        res.check(d.page.eval("%s.map.getLayers().getArray().some("
                              "l => l.get('title') === 'Terrain' && l.getVisible())" % SCOPE),
                  "map has a visible Terrain layer")

        # -- no fix: no position to cut a window around ------------------------
        fly(d, 45.74, 7.32, 10000, fix=0)
        empty, shown = nothing_drawn(d)
        res.check(empty and downloads.count == 0, "no fix: nothing downloaded, nothing drawn",
                  "%d downloads, %s" % (downloads.count, shown))

        # -- across Europe -------------------------------------------------------
        for name, lat, lon, alt_ft, points, extra in SCENARIOS:
            got = scenario(d, res, grid, name, lat, lon, alt_ft, points, extra)
        res.check(d.page.eval("%s.terrainGrid === %s.data" % (SCOPE, SHARED)),
                  "the map draws the shared window (globalTerrainGrid)")
        alphas = sorted({p[5] for p in got["probes"] if p[5]})
        res.check(alphas == [ALPHA], "overlay is translucent over the base map", alphas)

        # Altitude noise must not repaint the whole overlay on every frame
        before = d.page.eval("%s.terrainAltitude" % SCOPE)
        fly(d, 46.85, 9.00, 12030)
        res.check(d.page.eval("%s.terrainAltitude" % SCOPE) == before,
                  "a 30 ft change does not recolour", before)

        # -- the window around the aircraft, and moving it -----------------------
        window_only(d, res, grid, 45.74, 7.32, 10000)
        map_follows(d, res, grid, downloads, 45.74, 7.32, 10000)

        # -- the layer switcher --------------------------------------------------
        layer_switcher(d, res, grid, 45.74, 7.32, 10000, 16000)

        shared_rule(d, res)
        res.check(not d.js_errors(), "no JS errors on the map", d.js_errors()[:1])

        # -- the 3D view agrees, and follows ---------------------------------
        first = synthview_agrees(d, res, grid, downloads, 45.74, 7.32, 10000)
        synthview_follows(d, res, grid, downloads, first, airfields, 45.74, 7.32, 10000)
        res.check(not d.js_errors(), "no JS errors on the synthetic view", d.js_errors()[:1])
        res.check(not d.srv.missing, "no missing assets", sorted(set(d.srv.missing))[:3])

    on_request(res, grid, 45.74, 7.32, 10000)

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
