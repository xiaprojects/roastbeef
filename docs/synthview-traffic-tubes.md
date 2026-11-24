# Traffic tubes on the synthetic view

Every aircraft in the RB-01 3D synthetic view, your own and each traffic target, carries two
dark tubes. They are drawn by `updateTubes` in `web/RB-01/plates/js/synthview.js`:

- **Vertical tube**: from sea level up to the aircraft, so you can see where it is over the
  ground. The terrain hides the part below ground.
- **Predicted path**: from the aircraft to where it will be in `projection.seconds` at its
  current ground speed, true track and vertical speed. A climbing aircraft's path points up,
  a descending one's points down. If the path meets the terrain or another aircraft's path,
  that happens within that time.

## Settings

`web/settings/synthview.json`:

```json
"projection": {
    "enabled": true,
    "seconds": 60
}
```

| Key | Meaning | Default |
|---|---|---|
| `enabled` | `false` hides every predicted path. The vertical tubes stay. | `true` |
| `seconds` | Look-ahead time, 5 to 600 s. | `60` |

The `projectionSize` key on the own aircraft in `items` is read only by the legacy Stratux UI
(`web/plates/js/synthview.js`). RB-01 ignores it.

## Data

| | Ground speed | Track | Vertical speed | Altitude |
|---|---|---|---|---|
| Own aircraft | `GPSGroundSpeed` | `GPSTrueCourse` | `GPSVerticalSpeed` (ft/s) | `GPSAltitudeMSL` |
| Traffic | `Speed`, 0 when `Speed_valid` is false | `Track` | `Vvel` (ft/min) | `Alt`, see below |

A target with no speed report has no predicted path, only the vertical tube.

`Vvel_valid` on each `/traffic` target is true when the last report carried a vertical rate.
When it is false, the path is drawn level in a lighter grey (`TUBE_COLOR_NO_VERTICAL`), so it
doesn't look like confirmed level flight. Each source sets it as follows:

| Source | `Vvel_valid` |
|---|---|
| 1090ES | true after an airborne velocity message (TC19) with a vertical rate; false after one without |
| UAT | true when the state vector's vertical rate field is not "no information" |
| FLARM PFLAA | true when ClimbRate is not empty |
| OGN, Ping | always true |
| AIS | always false (vessels) |

A daemon older than this flag doesn't send it. The display then takes `Vvel` as known, as
before.

**Traffic altitude.** The scene is in metres MSL, from your own GPS. Traffic `Alt` is
pressure altitude unless `AltIsGNSS` is set. A pressure altitude is shifted by your own
`GPSAltitudeMSL - BaroPressureAltitude` when a baro source is present (`BaroSourceType` > 0,
including the ADS-B estimate) and you have a GPS fix. Without the shift, on a 1003 hPa day
every target would be drawn about 280 ft too high compared with you. Without a baro source,
or with an offset beyond ±3000 ft, the altitude is drawn as received (standard atmosphere). A
GNSS altitude is always drawn as received.

## Scene scale

- **Horizontal.** One metre is `setup.unitsPerMeter` world units (`cellSize` over a cell's
  north-south length in metres) in both directions. The terrain grid is square in degrees, so
  `TerrainManager.eastScale()` draws a cell `cos(lat)` narrower east-west. Before this, the
  scene was 1.4 times too wide east-west at 44°N, and a 045 track pointed about 054 over the
  terrain.
- **Vertical.** Every height (terrain, aircraft, tubes, glide curtain, guidance tunnel,
  camera clearance) goes through `Rendering.sceneY(metres)`, which multiplies by
  `setup.heightScale`. The guidance tunnel still tilts its frames by the true angle
  (`tiltWithPath`).

  `"verticalExaggeration"` in `synthview.json` sets how many times taller heights are drawn
  than horizontal distances:

  | Value | Result |
  |---|---|
  | `null` or absent | One unit per metre, today's look: about 2.5× (`1 / unitsPerMeter`). |
  | `1` | True proportions. The terrain looks about 2.5× flatter. |
  | 0.5 to 10 | That ratio. A value outside this range falls back to the default. |

  Labels, runways, models and tube widths keep their size on screen at every value. Only
  heights change.

## Tests

`test/display/test_synthview_traffic.py` checks the following:

- the cell proportions and `unitsPerMeter`;
- each target sits at its true distance from your aircraft;
- the pressure-altitude shift, and GNSS altitudes drawn as received;
- the end point of each predicted path for a climb, a descent, a 000 track and your own
  aircraft;
- both tubes resize when a target changes altitude or speed;
- a target with no speed report gets no path.
