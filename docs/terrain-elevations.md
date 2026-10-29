# Terrain elevation grid (`elevations.json`)

The synthetic vision plate draws its 3D terrain from one JSON file: a regular latitude /
longitude grid of elevations in metres. The same grid gives the height of points of
interest, the terrain floor under the guidance boxes, and the terrain overlay on the map
plate. This page describes the file as the code reads it today (`globalLoadTerrainGrid` and
`globalTerrainCut` in `web/RB-01/js/global.js`, `TerrainManager` and `generateMaterial`/`loadDEM` in
`web/RB-01/plates/js/synthview.js`, `drawTerrain` in `web/RB-01/plates/js/map.js`;
`web/plates/js/synthview.js` carries an older copy of the 3D code), what the Europe grid
contains, and the known gaps. The last
section is a proposed water layer, not implemented.

## Files

| File | Content |
|---|---|
| `web/settings/elevations.json` | The grid the device loads. Served at `/settings/elevations.json`, named by `elevationUrl` in `web/settings/synthview.json`. |
| `web/settings/databases/elevations/worldwide-sample.json` | Coarse worldwide sample: 148 × 816 cells, about 0.25°, 35–71 N, 168 W–35 E. Carries an extra `"increment": 1` that the code ignores. |
| `web/synthview/terrainData.json` | Byte-identical copy of the Europe grid. Nothing references it. |

The Europe grid is generated outside this repository; its source DEM and generator are not
recorded yet (see `docs/certification/provenance.md`, "To be documented (SRTM-derived)").

## Format

```json
{
    "terrainData": [
        [0, 0, 0, ...],
        ...
        [..., 145, 163, 172]
    ],
    "latitude": 0,
    "longitude": 0,
    "planimetry": { "start": { "lat": 37, "lon": 4 }, "end": { "lat": 47, "lon": 19 } }
}
```

| Key | Type | Meaning |
|---|---|---|
| `terrainData` | array of rows, each an array of integers | Elevation in metres above mean sea level. Every row has the same length. |
| `planimetry.start` | `{lat, lon}`, degrees | South-west corner: the position of `terrainData[0][0]`. |
| `planimetry.end` | `{lat, lon}`, degrees | North-east bound. **Exclusive**: see "Grid geometry". |
| `latitude`, `longitude` | number | Not read. The loader overwrites them with the centre of the trimmed window. |

Unknown keys are ignored, so new optional keys can be added without breaking older
builds. The file is written one grid row per line, so a diff shows which rows moved.

### Grid geometry

- **Row 0 is the south edge**, rows go north. **Column 0 is the west edge**, columns go
  east.
- The code derives the step from the bounds and the array size, with `end` treated as
  exclusive:

  ```
  step.lat = (end.lat - start.lat) / rows        cell i, j  is at
  step.lon = (end.lon - start.lon) / cols        lat = start.lat + i * step.lat
                                                 lon = start.lon + j * step.lon
  ```

- A position is looked up by truncation (`parseInt`), so it reads the node at or south-west
  of it; there is no interpolation.
- To be read correctly, a grid with step `s` must have `end = start + N * s`, where N is
  the number of rows (or columns).

### Values

- Integer metres AMSL. The open sea is `0`.
- Lakes are flat: every cell of a lake holds the same value, its surface level
  (Geneva 371, Garda 61, Balaton 100, Trasimeno 251). This is how SRTM-style DEMs store
  water bodies.
- Negative values occur on reclaimed land below sea level (Po delta and Polesine down to
  -8, Fiumicino/Maccarese, the Pontine plain). They also occur on some coastal lagoons
  (Étang de Berre, Lesina, Varano, Orbetello) and as noise over the sea. The minimum in
  the Europe grid is -13, in the Hvar channel.
- Values are point samples at the node, not the highest point of the cell, so summits
  read low: Mont Blanc is 4578 in the grid against 4808 real, Monte Rosa 4445 against
  4634.

## The Europe grid

| | |
|---|---|
| Size | 1001 rows × 1500 columns, 4.37 MB |
| Step | 0.01° in both directions (≈1.11 km N–S, ≈0.76–0.89 km E–W) |
| Rows | 37.00 N … 47.00 N, both ends included |
| Columns | 4.00 E … 18.99 E |
| Range | -13 … 4578 m. 841,480 cells (56 %) are ≤ 0. |

Read at a 0.01° step, summits and lakes land on the right nodes. The file, however, declares `end.lat = 47` with 1001 rows, so the code computes a
step of 10/1001 = 0.00999°. The error grows northward, to about one row (≈1 km) at the
Alps. Declaring `end.lat` as `47.01` makes the code's step exactly 0.01° without touching
the data.

Coverage stops at 47.00 N. Lake Constance, Lake Zurich, Neusiedl and Skadar are outside
the grid, and Lake Lucerne and Balaton are cut at the edge.

## How the HMI uses it

1. **A shared window that follows the aircraft.** Memory holds only a window of the
   grid around the aircraft: ±`TERRAIN_WINDOW_DEGREES` (75 NM converted as
   `75 / 1.86 / 45`, ±0.90°), about 108 × 76 NM at 45 N, 179 × 179 cells of the Europe
   grid. `globalLoadTerrainGrid` (`js/global.js`) is asked for it on every GPS fix:
   by the 3D view, and by the map while its overlay is on.
   - The first request downloads the file, `globalTerrainCut` cuts the window around
     the aircraft, and the rest of the grid is dropped. The window is kept in
     `globalTerrainGrid.data`, shared by both screens.
   - While the aircraft stays within `TERRAIN_MOVE_FRACTION` (half) of the way from the
     window's centre to its edge, on either axis, every request gets the same window.
   - Past that, the file is downloaded again and a new window is cut around the
     aircraft, so there is still about half a window of terrain ahead. Half a window
     is 0.45°: 27 NM north–south and 19 NM east–west at 45 N, so at 120 kt a new
     window every 13 minutes northbound or southbound, every 10 eastbound or westbound.
     The old window stays on screen until the new one is ready.
   - The window is cut on whole cells, so its corners sit on the grid's own cell edges
     and every window has the grid's exact step. Near the grid's edges it is
     smaller; off the grid it is empty.
   - A failed download rejects once; for 30 s after that, requests get the window
     in memory without downloading.

   The 3D view lays the first window it gets with its centre at the scene's origin,
   and keeps that origin for the session. When the window moves, the new mesh is
   placed at its offset from the origin and the old one is removed. The airfields
   under the new window are added, and the guidance tunnel is rebuilt on the new
   elevations. The aircraft, traffic and markers already in the scene do not move.
   If the first window is empty (the aircraft is off the grid), the 3D view shows no
   terrain on that visit; a later window that turns out empty leaves the last
   terrain in place.
2. **Mesh.** One vertex per cell. The vertex height is the elevation in metres, and the
   horizontal spacing is `cellSize = 240 / rows × 328.084` world units per cell (about 440
   for the Europe window). Relief is therefore drawn about 2–2.5 × steeper than the
   horizontal scale.
3. **Colour.** Per vertex, by `globalTerrainColor` in `web/RB-01/js/global.js`, the
   rule the map overlay uses too. In this order:

   | Elevation `e` (m) | Colour |
   |---|---|
   | `e ≤ 0` | blue (water) |
   | `0 < e ≤ 50` | green |
   | `e > alt` | red |
   | `alt − 200 < e ≤ alt` | yellow |
   | otherwise | green |

   `alt` is the GPS altitude MSL in metres; the caution band is `TERRAIN_CAUTION_METERS`.
   The 3D view recomputes the colours when the altitude moves by more than 150 m. The
   `terrainColor*` keys in `synthview.json` are not read; the colours are hard-coded
   in `global.js`.
4. **Lookups.** `elevationByLatLon` gives the ground height under airfield markers and
   the minimum height (`+ guidance.minAglMeters`) of the guidance boxes.
5. **Map overlay.** The map plate draws the shared window (step 1) as an OpenLayers
   `ImageCanvas` layer ("Terrain" in the layer switcher, 40 % opacity) between the base
   maps and the aeronautical overlays. Each screen pixel takes the colour of the cell
   under it, with the same row/column convention and the same rule as the 3D view.
   Outside the window, and before the first GPS fix, nothing is drawn: missing data
   must not look like clear terrain. Zoomed out, the window shows as a coloured
   rectangle around the aircraft, and it moves with it as in step 1. The overlay is
   recoloured when the GPS altitude moves by 15 m or more.
   The Terrain box in the layer switcher turns it off and on. It is on by default,
   and the choice is kept in the browser (`localStorage`
   `stratux.map.layers.Terrain.visible`) like the other map layers. While it is off it
   still tracks the altitude, so it comes back with current colours. While it is off,
   the map does not download the grid.
   `test/display/test_map_terrain.py` flies it over the Alps, Genoa and the Po plain,
   taps it off and on in the layer switcher, flies the window past half way on both
   screens, and counts the downloads.

Elevation is the only input for both height and colour. A cell is blue if, and only if,
its value is ≤ 0.

## Known gaps

- **Lakes are green.** Every inland lake sits at its real surface level, above 0, so none
  of them is drawn as water. Setting lake cells to 0 to make them blue would cut a pit as
  deep as the surface level into the mesh: 371 m for Geneva, 771 m for Serre-Ponçon,
  1001 m for Lac de Joux. It would also lower the terrain floor that markers and
  guidance use. Water has to be a separate attribute (see below).
- **Reclaimed land is blue.** Land below sea level draws as sea. The largest negative
  clusters are Polesine and the Po delta (2,430 cells), the hinterland of Venice, Jesolo
  and Caorle (1,025) and the Ravenna valli (160). On the Tyrrhenian side the same happens
  at Fiumicino/Maccarese (next to LIRF), the Pontine plain and the Pisa–Massaciuccoli
  bog. These clusters mix reclaimed land with lagoons, and only a water mask can
  separate them.
- **Water hides clearance colours.** The blue rule is checked before red/yellow, so
  water at or near the aircraft's altitude never turns red or yellow.
- **Georeferencing** is off by up to one cell (see "The Europe grid", plus truncation in
  lookups). In the 3D view the mesh's vertices are spaced `ncols / (ncols − 1)` cells
  apart, slightly more than the one cell the scene's projection uses: about half a
  cell of drift at the window's edges.
- **Summits read low**, because the grid holds point samples.
- **No integrity check.** The file is not hashed at load (certification task AT-14).

## Proposed: water layer (not implemented)

An optional key, `water`, marks water cells without changing their elevation.

```json
{
    "terrainData": [ ... ],
    "planimetry": { "start": { "lat": 37, "lon": 4 }, "end": { "lat": 47.01, "lon": 19 } },
    "water": [
        [0, 1500],
        ...
        [254, 3, 260, 41],
        ...
        []
    ],
    "source": "DEM: <dataset, version>; water: <dataset, version>; generated <date> by <script>@<commit>"
}
```

- `water` has exactly one entry per `terrainData` row, in the same order.
- Each entry is a flat list of `[firstColumn, count]` pairs: the run of water cells
  `firstColumn … firstColumn + count − 1`. Pairs are sorted, do not overlap, and stay
  inside the row. An empty list means no water in that row.
- Run-length encoding keeps the Europe layer around 40 KB (13 KB gzipped). A dense 0/1
  grid would be 3 MB.
- `terrainData` keeps the true surface level: 0 for the sea, the lake level for lakes,
  the real (negative) height for reclaimed land.

Reader behaviour:

- `water` present: a cell is water if, and only if, a run covers it. A cell ≤ 0 that no
  run covers is land.
- `water` absent: fall back to today's rule, `e ≤ 0`, so older files still work.
- Colour precedence: red and yellow first, then blue, then green. A lake surface is
  terrain for clearance purposes.
- `trimTerrainBySquare` trims `water` with the same row and column range as
  `terrainData`.

Older builds ignore the key and keep drawing lakes green, which is what they do today.
