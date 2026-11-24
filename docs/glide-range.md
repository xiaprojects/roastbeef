# Glide range on the map and the synthetic view

The RB-01 shows the area the aircraft can still reach if the engine stops now, taking into
account the terrain under each glide path and the estimated wind:

- **2D map:** a translucent magenta polygon with a dashed outline around the aircraft, the
  **Glide range** layer in the map's layer switcher.
- **3D synthetic view:** the same boundary stood on the terrain as a dashed translucent magenta
  curtain, with a solid line along its foot. A line flat on the ground disappears at the grazing
  angles of a cockpit view, a fence does not.

Both draw the same area: one calculation, over the terrain window the two screens share.

Code: `web/RB-01/js/glidereach.js` (the calculation, pure), `web/RB-01/plates/js/map.js` (the
layer), `web/RB-01/plates/js/synthview.js` (`buildGlideRange`, the curtain). Tests:
`test/display/test_map_glide.py`, `test/display/test_synthview_glide.py`.

## Parameters: `aircraft.json` → `bestGlide`

```json
"bestGlide": {
    "enabled": true,
    "glideRatio": 9,
    "speedKt": 75,
    "clearanceAglFt": 500,
    "useWind": true
}
```

| Key | Type | Default | Valid range | Meaning |
|---|---|---|---|---|
| `enabled` | bool | `true` | | `false` draws nothing |
| `glideRatio` | number | 9 | 2–60 | still-air glide ratio at best-glide speed, engine out (POH, or measured) |
| `speedKt` | number | 75 | 20–300 | best-glide **indicated** airspeed, knots. Turned into TAS at the current altitude (ISA) for the wind correction |
| `clearanceAglFt` | number | 500 | 0–5000 | the glide path must stay at least this high above the terrain everywhere along it |
| `useWind` | bool | `true` | | correct each direction for the wind estimate (`WindValid`, `WindSpeed`, `WindDirection` from `services/windestimator.js`); still air when `false` or when no wind is valid |

The pilot edits them on the display: **Settings → Aircraft → Best Glide** (the settings addon,
`web/RB-01/addons/settings.html`). The panel shows the defaults for keys the file lacks, repeats
the speed and the clearance in the pilot's units when those are not knots and feet, and blocks
Save, giving the reason, while a value is outside the ranges below. Saved values apply at once,
with no reload.

When the file is edited by hand, a missing block, a missing key, a value out of range or of the
wrong type takes the default
(`glideParameters`). The block is separate from `glide`, which describes the planned descent
for the autopilot output (`docs/integration/nmea-navigation-output.md`). The map reads
`window.aircraftData` each time it recomputes, so a profile saved from the settings addon applies
at once.

## How the area is computed

From the aircraft, 120 ground tracks fan out, one every 3°. Along each one the aircraft glides at
best-glide speed:

- the ground speed along that track comes from the wind triangle,
  `GS = √(TAS² − crosswind²) + tailwind`;
- the aircraft loses `TAS / (glideRatio · GS)` metres of height for every metre over the ground;
- it steps outwards half a terrain cell at a time over the terrain window that the synthetic
  view and the terrain overlay already share (`globalTerrainGrid`, `docs/terrain-elevations.md`).
  Sea and ground below sea level count as 0 m.

The track ends at the first of:

| Limit | Meaning |
|---|---|
| `terrain` | the glide path comes down to `clearanceAglFt` above the ground. The first ridge it cannot clear stops it, and any valley beyond that ridge does not count as reachable |
| `wind` | the crosswind is at least the airspeed, or the headwind leaves no ground speed |
| `edge` | the terrain data ends. Unknown ground does not count as reachable |

The ends of the tracks, joined in order, make the polygon. Altitude is `GPSAltitudeMSL`, as for
the terrain overlay. The area is recomputed at most once a second, and again when a new terrain
window arrives.

Nothing is drawn with no GPS fix, before the terrain window is in, when the aircraft is already
below `clearanceAglFt` over the ground under it (on the ground, for instance), or with the layer off.
With the Glide range layer on, the map downloads the terrain grid even while the Terrain overlay is
off.

## The 3D curtain: `synthview.json` → `glideRange`

How the curtain looks. What it encloses comes from `bestGlide` above.

```json
"glideRange": {
    "enabled": true,
    "color": 16711935,
    "opacity": 0.55,
    "wallMeters": 150,
    "liftMeters": 15,
    "dashCells": 1.0,
    "gapCells": 0.6
}
```

| Key | Default | Valid range | Meaning |
|---|---|---|---|
| `enabled` | `true` | | `false` hides the curtain on the synthetic view only |
| `color` | `0xFF00FF` (16711935) | 0–0xFFFFFF | curtain and outline colour, magenta like the map |
| `opacity` | 0.55 | 0.05–1 | curtain opacity; the outline is opaque |
| `wallMeters` | 150 | 10–2000 | curtain height |
| `liftMeters` | 15 | 0–500 | foot above the terrain mesh (the highest of the four nodes around each point), so the terrain does not cover it |
| `dashCells` / `gapCells` | 1.0 / 0.6 | 0.1–50 / 0–50 | dash and gap length along the boundary, in terrain cells; a gap of 0 gives a solid curtain |

The foot line runs the whole boundary, and the curtain stands only on the dashes. The boundary
is sampled every half cell, so it follows the ground between the radials. Like the map, the
curtain is rebuilt at most once a second and again on a new terrain window. It disappears below
the clearance, with no fix, or with `bestGlide.enabled` set to `false`.

## Not modelled

Cover these with `clearanceAglFt`:

- the turn onto the track and the time to set up the glide;
- wind that changes with height (the estimate is the wind at the current altitude);
- a windmilling or stopped propeller, flap or gear changing the ratio;
- the ratio changing with weight. Best-glide speed does change with weight, but the ratio
  barely does.

It shows where you can glide to, not where you can land: no airfields or landable fields are
picked out yet. The rest of the competitor item (best field in reach, one-tap direct-to) is in `docs/product/competitor-features.md`, rank 2.
