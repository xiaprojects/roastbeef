# Spoken Terrain Alerts

Requirements and implementation record for rank 3 of the agreed priorities
(`docs/product/competitor-features.md`): RB-01 speaks a warning when the predicted path
will reach terrain. On 2026-11-08 the requirements reference written in Claude Docs on
2026-11-07 moved here unchanged. Only its three diagrams did not carry over.

**Status: step 1 built, not released.** `main/terrain.go` evaluates once a second and can
raise alerts, behind two settings that are both off by default. It still uses the display
grid, which reads summits up to 755 ft low, and its nuisance rates are above the release
targets. Do not turn the alerts on for pilots yet.

## Implementation, step 1 (2026-11-08)

This is the smallest version that runs the alert condition in the daemon and raises alerts
through the existing pipeline. In the delivery order below it is step 2, shadow mode, plus
the switch that lets the same code speak. Step 1 of that order, the audio arbiter, was
skipped.

| Asked | Where |
| --- | --- |
| The requirements as a Markdown document | This file |
| `main/terrain.go`: a 1 s loop that raises alerts through `alerts.pushEventByIdent()` | `TerrainStratuxPlugin`, started in `main()` and stopped in `gracefulShutdown()` |
| Only the terrain near the aircraft in memory, cut as the map and the synthetic view cut it | `windowAround()` and `terrainCut()`, which follow `globalLoadTerrainGrid()` and `globalTerrainCut()` in `web/RB-01/js/global.js` |
| Terrain information in `globalStatus` | The `Terrain_*` fields below |
| The height above ground at the aircraft, in `globalStatus` | `Terrain_AglFt`, with `Terrain_AglValid` |
| On/off for the function | `Terrain_Enabled`, default off |
| On/off for the alerts | `Terrain_Alerts_Enabled`, default off |
| The minimum ground speed `TERRAIN_MIN_GROUND_SPEED_KT` configurable, in km/h, 45 kt below 1 | `Terrain_Alerts_MinSpeedKmh`, default 0 |

### How it works

1. **Every second**, the loop reads the GPS fix and the vertical rate, makes sure the window
   covers the aircraft and classifies the flight phase. It then walks the predicted path
   (60 s, 2 s steps, the turn included), counts the evaluations in a row that met the
   condition, publishes the result and raises or updates the alert.
2. **Terrain window.** The grid is the file named by `elevationUrl` in
   `settings/synthview.json`, which the synthetic view and the map draw too. The window is
   ±0.896° around the aircraft (75 NM as the synthetic view converts it). On the Europe grid
   that is 179 × 179 cells, 64 KB as `int16`. A new window is cut when the aircraft is half
   way to the edge, 27 NM north–south at 45 N. A failed read keeps the old window and waits
   30 s. All of this is as in the browser.
3. **Reading the file** is the one difference. The daemon streams the file and keeps one row
   at a time besides the window. It takes two passes, because the Europe grid puts
   `planimetry` after the rows. Cutting a window allocates 0.4 MB in total and takes 0.24 s
   on the x86 dev machine. Decoding the whole grid, as the browser does, holds 15.1 MB.
4. **Airfields.** The rows of `settings/db.airfields.json` inside the window are loaded
   with it, at the listed elevation (metres) or, for a row without one, the grid's.
5. **Alerts** go out through `alerts.pushEventByIdent()`. That means one alert per episode,
   updated while it lasts and closed when it ends. A condition back within 10 s reopens the
   same alert, with no sound. A warning closes the caution in the same evaluation.
6. **Minimum speed.** Below `Terrain_Alerts_MinSpeedKmh` of GPS ground speed the aircraft
   counts as on the ground (TER-020). Nothing is evaluated or announced, the unavailable
   alert included, the confirmation count starts again and an open alert is closed. The
   setting is in km/h. Below 1, the default, the limit is the constant
   `TERRAIN_MIN_GROUND_SPEED_KT`, 45 kt.

| Ident | Event type | Title | Sound, en-US / it-IT |
| --- | --- | --- | --- |
| `terrain-caution` | `EVENT_TYPE_TERRAIN_CAUTION` (17) | Terrain ahead | `EVENT_TYPE_TERRAIN_CAUTION`, `_IT` |
| `terrain-warning` | `EVENT_TYPE_TERRAIN_WARNING` (18) | Terrain ahead, pull up | `EVENT_TYPE_TERRAIN_WARNING`, `_IT` |
| `terrain-unavailable` | `EVENT_TYPE_TERRAIN_UNAVAILABLE` (19) | Terrain alerts unavailable | `EVENT_TYPE_TERRAIN_UNAVAILABLE`, `_IT` |

`/getStatus`, its socket and the flight log's `status` table carry these fields, written
once a second:

| Field | Meaning |
| --- | --- |
| `Terrain_State` | `OFF`, `CLEAR`, `CAUTION`, `WARNING`, `UNAVAILABLE`. `CLEAR` on the ground with a fix. |
| `Terrain_Reason` | Why `UNAVAILABLE`: `NO_FIX`, `POOR_FIX`, `NO_RATE`, `OFF_GRID`, `GRID_BAD` (grid or airfield list unreadable) |
| `Terrain_Phase` | `CRUISE`, `TAKEOFF`, `LANDING`, or empty if not classified |
| `Terrain_Suppressed` | Inside the field box (2 NM, 500 ft): no alert, but the evaluation goes on |
| `Terrain_ClearanceFt` | Lowest predicted height above the terrain in the next 60 s; 0 if not evaluated (on the ground, `OFF`, `UNAVAILABLE`) |
| `Terrain_TimeToThreatS`, `Terrain_ThreatLat`, `Terrain_ThreatLon`, `Terrain_ThreatElevationFt` | Where the alert condition first holds on the path, the warning's if any; 0 when it does not hold |
| `Terrain_AglFt`, `Terrain_AglValid` | GPS altitude above the grid cell under the aircraft, in whole feet, negative when the GPS is below the cell. Valid on any usable fix over the grid, on the ground and below the minimum speed too, and with `NO_RATE` or a path off the grid. Not valid, and 0, with no fix, a poor fix, no grid, the aircraft off the grid, or the function off |

### Where it departs from the requirements

| Requirement | Built | Why |
| --- | --- | --- |
| TER-040: the baro rate while `isTempPressValid()` | The baro rate only from the internal sensor or an OGN tracker, otherwise the GPS slope (TER-050) | The `$PGRMZ` and ADS-B estimate sources refresh the altitude but leave `BaroVerticalSpeed` as it was. As written, the requirement would take a frozen rate and miss a descent without any sign. A daemon without a baro switches to the ADS-B estimate about 2 min into a replay. |
| TER-090: the track rate | Taken from the last two GPS fixes | `GPSTurnRate` is computed only while no IMU is connected. It reads 0 in all 1227 rows of the 2026-06-14 11:22 flight. |
| TER-110: a corridor around the path | The cell under each path point, no corridor | This is the replay's proposed logic. The corridor width is an open question for the alerting grid. |
| TER-020: setting `Terrain_MinGroundSpeedKt`, default 45 | Setting `Terrain_Alerts_MinSpeedKmh`, in km/h. Below 1, the default, the constant `TERRAIN_MIN_GROUND_SPEED_KT`, 45 kt | The owner chose the name and the unit on 2026-11-08. A default of 0 keeps 45 kt exact, where 83 km/h would be 44.8 kt. |
| Delivery step 2: the reader's step fixed at 0.01° | A grid whose rows, with the last row on `end.lat`, are spaced like its columns is read at that step | This puts the Europe grid on 0.01° without editing the file, and leaves other grids on the browser's step, for example the worldwide sample that `elevations.json` holds at HEAD. The map and the synthetic view still draw the rows up to one cell north at the Alps. |
| Unavailable: "once, if it happens in flight" | Once per flight. Later episodes reopen the same alert with no sound. A flight ends below 45 kt within 2 NM and 500 ft of a field | Below 45 kt on its own also happens at the top of a vertical figure. In the 2026-06-14 10:19 flight that rule alone gave three announcements in 100 s. |
| Terrain state message: `/terrain`, `/getTerrain` | The `Terrain_*` fields of `globalStatus` | Step 4 asked for it this way. The flight log's `status` table then gives shadow-mode records without the `terrain` table of TER-690. |
| `State` values | `OFF` added, `INHIBITED` left out | There is no manual inhibit yet. |
| Defaults: alerts on at release | Both settings off | This is step 1, before the alerting grid. Off by default matches `EMS_Enabled` and `Audio_Enabled`. |

The plugin also starts in a `-trace` replay, so recorded flights can drive it through the
real daemon. With `Terrain_Enabled` off, the default, it reports `OFF` and does nothing.

### Not built yet

- **TER-210 to TER-230, TER-250, TER-260, TER-490**: no manual inhibit, status chip, threat
  marker or annunciator. The HMI ignores the new fields, and a terrain alert shows as the
  usual balloon that closes after 10 s.
- **TER-300 to TER-350**: no alerting grid and no hash. Today `GRID_BAD` means a file that
  cannot be read.
- **TER-400 to TER-440**: no audio arbiter and no repeats. Each alert plays its sound once
  through `aplay`, and the display plays it once through the browser.
- **TER-500 to TER-520**: the display is not silenced while `Audio_Enabled` is on, and
  there is no `NO_AUDIO`.
- **TER-650, TER-660**: no fault containment and no `STALLED`. A panic in `terrain.go`
  stops the daemon, as a panic in any other plugin does.
- **TER-670, TER-680, TER-690, TER-710**: no start-up checks, audio test, `terrain` table
  or test offset. The `status` table records the fields once a second.
- **TER-600, TER-630**: measured on the x86 dev machine only (below), not on the target
  board.

### Verification

- **Unit tests.** `main/terrain_test.go` holds 19 tests, run by `make check` on a synthetic
  grid. They cover two-in-a-row confirmation, the warning replacing the caution, one alert
  per episode, reopening within 10 s and both settings. They also cover the minimum speed
  setting: 45 kt below 1 km/h, at 180 km/h nothing evaluated at 97 kt and a warning at
  98 kt, the unavailable alert waiting for it too, the default and the `/setSettings`
  bounds. One covers `Terrain_AglFt`: kept on the ground, below the cell, with `NO_RATE`
  and with the path off the grid. It is lost with no fix, a poor fix, no grid, off the grid
  and with the function off. Four breaks of it each failed: lost while unavailable, lost
  on the ground, a stale value kept, metres read as feet. Also the default minimum speed, the field
  box and the phases, and the TSO Tables A, B and E at 100, 150 and 200 kt. Also climbs
  counted as level, the turn and its 6°/s limit, the rate sources, the five unavailable
  reasons and "once per flight". The window tests check the browser's numbers, the re-cut,
  the retry and the Europe step. Six deliberate breaks of the code each failed at least one
  test: one confirmation, no Europe step, the ADS-B rate used, descent projected over the
  whole look-ahead, no field box, and unavailable announced every time. So did five breaks
  of the minimum speed setting: no 45 kt below 1, the setting ignored, km/h read as knots,
  a default of 180, no bound. The tests carry no
  `// Covers:` tags, since RB-HLR-TER is not in `requirements/` yet. They leave out the TSO
  nuisance level-offs, because the reference does not record the profile its simulation
  flew.
- **Replay of recorded flights through the real code.** These are the 2026 recordings under
  `~/Desktop` and `test-data/`, de-duplicated by name and split at clock steps: 29 segments,
  14.95 h at 45 kt or more. That is not the reference's set of 37 recordings and 9.4 h.
  Each fix went through `evaluate()` with the alert function running.

| | Reference replay, proposed logic | `terrain.go`, default (45 kt) | `terrain.go`, 150 km/h | `terrain.go`, 180 km/h |
| --- | --- | --- | --- | --- |
| Cautions per hour, outside aerobatics | 5.86 | 4.95 (74) | 4.28 (64) | 4.15 (62) |
| Warnings per hour, outside aerobatics | 1.17 | 1.14 (17) | 0.87 (13) | 0.87 (13) |
| During aerobatics | 11 cautions, 0 warnings | 8 cautions, 0 warnings | 8 cautions, 0 warnings | 8 cautions, 0 warnings |
| Unavailable announcements | not counted | 4, one per flight, all `POOR_FIX` on vertical accuracy | 4 | 3 |

Of the 17 warnings, 12 came within 2 NM of a field at 517 to 763 ft above it, the pattern
the reference found. A minimum speed of 180 km/h silences only the 4 of them flown at 54 to
73 kt. The other 8 were flown at 106 to 132 kt ground speed, on the climb-out and in the
circuit. On this aircraft speed does not separate the circuit from cruise, which has a
median of 139 kt. The 5 warnings away from fields were at 128 to 170 kt and all still
sound. Of the 14.95 h at 45 kt or more, 1.9 h (13 %) is below 180 km/h and is not
evaluated, 1.6 h of it in the takeoff and landing phases. One evaluation took 14 µs at
the median and 21 µs at the 99th percentile, and 0.26 s when it cut a window.

- **`Terrain_AglFt` on the recordings.** It was valid on 99.98 % of the fixes at 45 kt or
  more. Parked (below 2 kt, 10 440 fixes) it read −30 to +123 ft from the 5th to the 95th
  percentile, median +24 ft, against the −19 to +71 ft measured at 6 fields. In flight it
  went below 0 on 111 fixes, down to −262 ft. All were takeoff and landing rolls at 45 to
  67 kt within 0.7 NM of a field, where the cell reads above the runway, for example 1007 ft
  against 920 ft by GPS at 43.356 N 12.220 E. Near a field, a height for callouts should
  come from the field elevation, not from this value.
- **Daemon end to end.** A `stratuxrun` built from this tree ran non-root, fed NMEA on TCP
  :30011, flying north at 120 kt at the Corno Grande cell (2800 m). At 2500 ft above it the
  state was `CLEAR`. At 300 ft below it went to `WARNING`, and `aplay` played
  `EVENT_TYPE_TERRAIN_WARNING.wav` and exited 0. Then came the caution, and after the climb
  `CLEAR` with both alerts closed. After `POST /setSettings {"Terrain_Alerts_Enabled": false}`
  the state still reached `WARNING` and nothing played. After
  `{"Terrain_Enabled": false}` it was `OFF`.

### Known limits found

- At the top of a vertical figure the ground speed drops below 45 kt (7 kt in the
  2026-06-14 10:19 flight), and nothing is evaluated there. TER-020's ground speed is a weak
  test of "on the ground".
- A warning that falls back to a caution raises the caution with its sound, unless a
  caution was open in the last 10 s.
- After a restart in flight with no baro, the first 5 s are `NO_RATE`, and the unavailable
  alert is announced.
- The minimum speed is GPS ground speed. At 180 km/h, a 115 kt cruise into a 20 kt headwind
  is 95 kt over the ground and is not evaluated. Neither is slow flight low in a valley in
  poor weather, which is the classic case for terrain alerts. No competitor found uses a
  limit that high (below).
- Around the minimum speed an alert closes and comes back, two evaluations later, as the
  speed crosses it. It comes back silent only within 10 s.
- Set high, the minimum speed also moves "landed": slow within 2 NM and 500 ft of a field
  re-arms the once-per-flight unavailable alert, so a slow circuit counts as a landing.
- With `Terrain_Alerts_Enabled` on in a `-trace` replay, each push logs "too early",
  because the alert function does not start in that mode.
- The 12 sound files `web/RB-01/sounds/EVENT_TYPE_TERRAIN_*` must be committed together with
  the mapping rows, or `TestEverySoundAndIconTheMappingNamesExists` fails in CI. The
  Italian wording ("cabra") and the licence of the Italian voice are still open.

### How competitors keep quiet on the ground and near a field (2026-11-08)

Dynon and MGL use a speed or flight detector only to tell flight from ground, at around
20 kt. Garmin publishes no speed rule and suppresses alerts by geometry around the
runway. None was found to gate on a cruise-like speed.

| Product | On the ground | Takeoff and landing | Source |
| --- | --- | --- | --- |
| Garmin AXIS for experimental aircraft (190-03123-21 Rev B) | No speed rule published | Alerts off when the aircraft is within 5 NM of an airport and its predicted position falls in a box of the runway plus 1 NM beyond each threshold and 0.75 NM each side. Off below 125 ft above the airport over the runway, within half a runway length of the centreline. On ILS, LPV and LNAV/VNAV final approach paths, even with no approach loaded. For user airports, off within 0.5 NM and 200 ft, or 1 NM and 125 ft, flying towards the airport. Manual inhibit, `TER INHIB` | Garmin web manual, pages below |
| Garmin G3X Touch (190-01754-00) | Not stated in the pages read | Manual inhibit from the Terrain page menu, or from a discrete input added in a later software release. The public pages give no numbers for automatic suppression | manualslib copy, page 177 |
| Garmin G950 / G1000 TAWS-B | — | Off below 200 ft above the destination runway within 0.5 NM of it, or between its ends | manualslib copy |
| Dynon SkyView, from v10.0 | Terrain alerts hidden until the generic in-flight detector fires: GPS ground speed or airspeed of about 20 kt, built to err towards "on the ground". Users see it switch at about 12 kt. Not adjustable | Not found | Dynon support on the Dynon forum |
| MGL G2 EFIS (Odyssey, Voyager) | AGL warning needs a GPS fix | Off for a set time after the automatic takeoff detection, or after "starting an active flight". Can follow a digital input, for example a gear-down switch | MGL setup guide |
| MGL iEFIS, Kanardia | Not found | Not found | — |

The comparison favours geometry: a smaller field box than ours, around the runway, plus
the approach path. That is the open question of the field box height in "Decisions
needed" below. With the minimum speed at 180 km/h, 8 of the 13 warnings left are within
2 NM of a field, 517 to 763 ft above it.

### Next

- **Shadow flights:** turn on `Terrain_Enabled` only, and read the `Terrain_*` columns of
  the flight log's `status` table.
- **Before any spoken release:** build the audio arbiter (TER-400 to TER-440) and the
  alerting grid, then rerun the replay on that grid, as the delivery order below says.

---

The sections below are the requirements reference as written on 2026-11-07, before
step 1. "Current state" describes the code as it was then.

## Purpose and scope

RB-01 must speak a warning when the predicted flight path will reach terrain. Today it only colours terrain on synthetic vision and the map, so a pilot who is not looking gets nothing. This is rank 3 of the priorities agreed on 2026-10-31, built after voice callouts and glide help.

This document fixes what the function shall do, the numbers it uses and how it is proven. Requirements carry ids in the repository's scheme so they can move into `requirements/`, keeping their numbers.

| In scope | Out of scope |
| --- | --- |
| Forward-looking check of the predicted path against the terrain grid | Obstacles such as masts, lines and cranes: these stay with the partner app |
| Spoken caution and warning, with matching text and visual alert | Airspace alerts: partner app |
| Inhibits near a field, manual inhibit, and failure annunciation | Escape guidance, or any steering command to an autopilot |
| Terrain data checks at load | TSO-C151 compliance or any TAWS claim |

The function is advisory. RB-01 is supplemental, non-required equipment (FHA assumption A1), so an alert informs the pilot and never replaces outside view or charted minimum altitudes. Silence must never be read as proof of clearance.

## Current state

RB-01 has the inputs, but not in one place: terrain lives in the browser, while GPS, alerts and dependable audio live in the daemon. Most of the work is closing that gap and fixing the data, not the prediction itself.

| Building block | Today | Gap for this function |
| --- | --- | --- |
| Terrain grid | `web/settings/elevations.json`: 1001 × 1500 integer metres, 0.01° step, 37–47 N, 4–19 E | Point samples, so summits read low (Mont Blanc 4578 m against 4808 m). The declared bound shifts rows by up to about 1 km at the Alps. No hash at load (task AT-14). |
| Terrain in software | Browser only: `globalLoadTerrainGrid` in `web/RB-01/js/global.js`, asked for by the 3D view and the map overlay | No daemon copy (`main/autopilot.go`: "there is no terrain model in the daemon"). No grid is loaded while other plates are open. |
| Terrain colouring | `globalTerrainColor`: red if `e > alt`, yellow within 200 m below `alt` | Uses current altitude only, with no path or time. The water rule runs first, so water near aircraft altitude never turns red or yellow. |
| Position | `mySituation` in `main/gps.go`: `GPSAltitudeMSL` (ft), `GPSTrueCourse`, `GPSGroundSpeed`, `Baro``VerticalSpeed`. `isGPSValid()` goes false 3 s after the last fix | Position is about 1 Hz in recordings. GPSVerticalSpeed is never assigned in this fork and reads 0 in every log, so the vertical rate must come from the baro or from GPS altitude. |
| Alert pipeline | `pushEvent()` and `updateEvent()` in `main/alerts.go`; `main/ems.go` shows the active-alert pattern | No severity or priority in the daemon. Next free event type is 17: row 16, `GPS_NOT_FIXED`, is in the mapping with no Go constant. |
| Daemon audio | `aplay` started in a goroutine; `Audio_Enabled` defaults to false | No queue or pre-emption, so sounds can overlap. Language is fixed to en-US. RB-HLR-ALR-190 and -200 are open. |
| Display audio | Browser `<audio>` element, per-display flag `Display_Audio_Alerts_Enabled` | Blocked until the first touch after boot, so it cannot carry a warning alone. |
| Visual alert | Balloon that closes after 10 s (decided 2026-11-04, tech debt TD1) | A terrain alert has to stay up while the condition lasts. |
| Airfields | `web/settings/db.airfields.json`: 667 rows, 649 of them in Italy | 109 rows have no elevation, 330 no QFU, 332 no length. Almost nothing outside Italy. |
| Voice callouts | Rank 1 of the priorities, to be built first | Not built. The Italian callout texts the priorities table cites left `alertsMapping.json` in commit `ad26f670`; each language now has 17 rows. |
| Requirements | `requirements/` traced by `scripts/trace.py` | No function code for terrain: `TER` must be added to `docs/certification/standards/requirements.md` §3. |

## Operational concept

The pilot hears a caution about 60 s before a predicted conflict and a warning about 30 s before it, on any plate and without touching the display. The design follows FAA TSO-C151c Class C, the class written for small aircraft flying visually, as an engineering reference and not as a compliance claim.

### What the pilot gets

| Level | Meaning | Spoken | Visual | Repeat |
| --- | --- | --- | --- | --- |
| Caution | Clearance falls below the required value within 60 s | "Terrain ahead, terrain ahead" | Amber TERRAIN on every plate | Every 7 s while active |
| Warning | Clearance falls below the required value within 30 s, or terrain is above the aircraft on the path | "Terrain ahead, pull up; terrain ahead, pull up" | Red TERRAIN on every plate | Continuous until resolved, not cancelled by an acknowledgement |
| Inhibited | The pilot switched alerts off | Nothing | TER INH chip | None |
| Unavailable | No valid position, no grid, off the grid, or a failed check | Once, if it happens in flight | TER N/A chip, amber | None |

The wording is the standard TSO-C151c Class A and B set, and matches the "terrain ahead" and "pull up" phrases agreed in the priorities. Repeat rates come from the TSO's example prioritisation table (7 s for an FLTA caution, continuous for a pull-up warning).

### Flight phases

Required terrain clearance depends on the phase, using the TSO's Class C definitions and its Alternate Table 3.1.1.

| Phase | Definition | Clearance, level (ft) | Clearance, descending (ft) |
| --- | --- | --- | --- |
| Cruise | Anything that is not takeoff or landing | 250 | 200 |
| Takeoff | Within 5 NM of the nearest field, range increasing, below 1000 ft above it | 100 | 100 |
| Landing | Within 5 NM of the nearest field, range decreasing, below 1000 ft above it | 150 | 100 |

The TSO sets the 1000 ft height. It leaves the traffic area undefined, so 5 NM is taken from its statement that aeroplanes routinely fly the pattern within 5 NM of the airport.

### Pilot actions

1. Before flight, the pilot sees the TER status chip go green at the first valid fix.
2. On a caution, the pilot checks position and altitude against the terrain shown on the map or synthetic vision.
3. On a warning, the pilot climbs or turns away using outside references. RB-01 gives no escape guidance.
4. For a known nuisance area, such as a valley or an unlisted strip, the pilot inhibits alerts with one action and sees TER INH until they turn alerts back on or the unit restarts.

## Functional requirements

The function is a new daemon plugin, `main/terrain.go`, that compares a predicted path with the alerting grid once per second. It lives in the daemon, not in the browser services the priorities table names for rank 1, for three reasons: most plates load no grid, browser audio is blocked until a touch, and each connected display would raise its own alert.

Short ids expand to `RB-HLR-TER-nnn` and stay `Status: planned` until their tests exist. A row joining two behaviours is split when it moves, under the standard's one-shall rule. Numbers are start values, and their measured effect is under Verification.

One plugin reads the existing inputs and the new grid, then drives four outputs. Displays only consume, so an alert still sounds with no display connected.

### Alert condition

An alert is due when, at any look-ahead time t up to T, predicted height above the terrain on the path is below the required clearance.

```latex
h(t) = h_{GPS} + \min(V_z, 0) \cdot \min(t, \tau)
```

```latex
h(t) - E(t) < RTC
```

Here h is GPS altitude, V is the vertical rate, E is the highest terrain at that point of the path and RTC is the required clearance for the phase. A climb counts as level.

| Parameter | Caution | Warning | Basis |
| --- | --- | --- | --- |
| Look-ahead T | 60 s | 30 s | 2.3 and 1.2 NM at the recorded median of 139 kt |
| Descent horizon τ | 15 s | 6 s | Keeps alert heights inside the TSO Class C limits, below |
| Required clearance RTC | By phase | By phase | TSO Alternate Table 3.1.1 |

The descent horizon is the key design choice. Lateral look-ahead asks whether terrain is on the way, while the descent horizon asks how far the aircraft will sink before the pilot reacts. Applying the descent to the whole look-ahead fires on normal circuit descents, and took warnings during aerobatics from 4 to 31 in the recordings. The TSO points the same way: its ceiling for a caution is based on 10–15 % of the vertical rate, which is a horizon of seconds.

The alert height is the clearance plus the rate times τ, and every Class C descent test case falls inside the TSO's limits.

| Test case | Rate (ft/min) | Warning fires at (ft) | TSO minimum (ft) | Caution fires at (ft) | TSO maximum (ft) |
| --- | --- | --- | --- | --- | --- |
| Cruise, Table A | 500 | 250 | 226 | 325 | 550 |
| Cruise, Table A | 1000 | 300 | 254 | 450 | 600 |
| Cruise, Table A | 2000 | 400 | 317 | 700 | 800 |
| Approach, Table E | 500 | 150 | 109 | 225 | 300 |
| Approach, Table E | 750 | 175 | 114 | 288 | 325 |
| Approach, Table E | 1000 | 200 | 121 | 350 | 350 |

In level flight the 250 ft clearance also meets Table B: no alert at 340 ft above a terrain cell, and an alert at 240 ft. The TSO's nuisance level-offs stay silent too in simulation: 4000 ft/min to 1000 ft, 2000 ft/min to 500 ft and 1000 ft/min to 250 ft, each led by 20 % of the rate, with a tightest margin of 58 ft.

### Inputs and availability

| Id | The system shall | Source | Verification |
| --- | --- | --- | --- |
| TER-010 | Run the terrain function in the daemon with no display connected | RB-SYS-ALR-030 | Test |
| TER-020 | Evaluate only while ground speed is at or above `Terrain_MinGroundSpeedKt` | No weight-on-wheels input | Test |
| TER-030 | Use GPS altitude MSL, not QNH-corrected pressure altitude, as aircraft height | TSO App. 3 §1.2 | Test |
| TER-040 | Use `BaroVerticalSpeed` as vertical rate while `isTempPressValid()` is true | `main/autopilot.go`: `GPSVerticalSpeed` is never assigned | Test |
| TER-050 | Use the slope of GPS altitude over 5 s as vertical rate while the baro is invalid | TSO App. 1 §5.6 | Test |
| TER-060 | Stop alerting and report `NO_FIX` while `isGPSValid()` is false | TSO App. 1 §5.6 | Test |
| TER-070 | Stop alerting and report `POOR_FIX` while horizontal accuracy is 30 m or worse, or vertical accuracy 30 m or worse | TSO App. 1 §5.6; `isGPSGroundTrackValid()` | Test |

### Prediction

| Id | The system shall | Source | Verification |
| --- | --- | --- | --- |
| TER-080 | Project the lateral path along GPS track at ground speed, at steps of 2 s or less, out to 60 s | TSO App. 1 §3.1 | Test |
| TER-090 | Project a constant-rate turn, limited to 6°/s, while track rate is 1°/s or more | TSO App. 1 §3.1.3 | Test |
| TER-100 | Predict altitude with the alert condition above, with a climb counted as level | Alert condition | Test |
| TER-110 | Take E(t) as the highest terrain in a corridor around the path, its half-width a named constant | TSO App. 1 §3.1 | Test |
| TER-120 | Classify the flight phase on every evaluation, with the definitions under Flight phases | TSO App. 3 §1.1 | Test |
| TER-130 | Apply the descending clearance while the rate is below -200 ft/min, and the level clearance otherwise | TSO App. 3 §1.3 | Test |

### Alerts

| Id | The system shall | Source | Verification |
| --- | --- | --- | --- |
| TER-140 | Raise a caution when the alert condition holds with the caution values | TSO App. 1 §3.1.1 | Test |
| TER-150 | Raise a warning when the alert condition holds with the warning values | TSO App. 1 §3.1.1, §3.1.2 | Test |
| TER-160 | Raise an alert only after its condition holds on two consecutive evaluations | Single-fix glitches | Test |
| TER-170 | Replace an active caution with a warning in the same evaluation that raises it | TSO §4.10.b | Test |
| TER-180 | Stop the spoken alert in the first evaluation where its condition is false | TSO §4.4 | Test |
| TER-190 | Hold the visual alert for 10 s after its condition ends, so that a returning condition stays one alert | Band-edge chatter | Test |

The voice stops as soon as the condition is false (TER-180). The 10 s applies to the visual alert, so a condition that returns stays one alert.

### Inhibits and indications

| Id | The system shall | Source | Verification |
| --- | --- | --- | --- |
| TER-200 | Suppress alerts within 2 NM of the nearest field and below 500 ft above it | TSO App. 1 table 3.1.1 note 3 | Test |
| TER-210 | Offer a manual inhibit of spoken and visual alerts, one action away on every plate | TSO App. 1 §9.1; App. 3 §1.3 | Test |
| TER-220 | Show TER INH on every plate while the manual inhibit is on | TSO App. 1 §9.1 | Test |
| TER-230 | Clear the manual inhibit at restart | Avoids a forgotten inhibit | Test |
| TER-240 | Keep evaluating and logging while inhibited or suppressed | Needed to tune nuisance rates | Test |
| TER-250 | Show a TER status chip on every plate, stating available, inhibited or unavailable | TSO App. 1 §7.0 | Test |
| TER-260 | Mark the threat position on the map and synthetic vision during an alert | TSO App. 1 §3.5.e | Test |

### Class C functions left out

These four keep the function short of Class C, so it must not be described as equivalent.

| Function | Spoken | Why not now |
| --- | --- | --- |
| Premature descent alert | "Too low; too low" | Needs runway data, and about half the rows have no QFU or length |
| Excessive descent rate | "Sink rate", "Pull up" | First candidate after release, but must be reconciled with aerobatics |
| Altitude loss after takeoff | "Don't sink" | Needs a dependable takeoff detector |
| 500 ft callout | "Five hundred" | Belongs to rank 1 voice callouts, on the same height input |

## Data requirements

Alerting needs its own highest-in-cell grid, because the point-sampled display grid reads summits up to 755 ft low, three times the 250 ft cruise clearance. GPS altitude is not the limiting factor: it holds about 14 ft at 95 % in flight. The existing grid can be used to tune the logic, but not for release.

### Vertical error budget

| Source | Size | Evidence |
| --- | --- | --- |
| GPS altitude | 4.4 m (14 ft) at 95 %, 6.6 m (22 ft) at 99 % | `GPSVerticalAccuracy`, 9.4 h of recorded flight |
| GPS minus grid, parked | -19 to +71 ft, median +41 ft | 6 fields in central Italy, low relief only |
| Point sampling of summits | 230 m (755 ft) at Mont Blanc, 189 m (620 ft) at Monte Rosa | `docs/terrain-elevations.md` |
| Row shift from `end.lat = 47` | Up to about 1 km at the Alps, or about 1890 ft on a 30° slope | `docs/terrain-elevations.md`, slope worked out here |
| DEM vertical error | SRTM 16 m (52 ft), Copernicus under 4 m (13 ft), both 90 % | [ISPRS 2023](https://isprs-archives.copernicus.org/articles/XLVIII-4-W6-2022/355/2023/), [Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) |

Horizontal quality is not a concern on this installation: 99.87 % of in-flight fixes report better than 30 m.

### Resolution

The 0.01° grid is a 36 arc-second grid, coarser than the 30 arc-seconds the TSO recommends and far from the 15 or 6 arc-seconds it suggests near runways and in mountains. At the recorded median of 139 kt, the 30 s warning distance of 2.1 km spans only 2 to 3 cells.

### Proposed alerting grid

| Property | Value |
| --- | --- |
| Source | Copernicus DEM GLO-30, 1 arc-second, free licence with attribution and a notice on modified data |
| Surface | Surface model including buildings and trees, EGM2008 heights: conservative for clearance |
| Cell value | Highest source sample in the cell, in integer metres |
| Step | 15 arc-seconds, about 460 m north–south |
| Size | 2400 × 3600 cells at 2 bytes each, about 17 MB for today's area; memory-mapped, not parsed |
| File | `terrain-alert.bin` with a header holding bounds, step, source, version, generator commit and SHA-256 |
| Build | A script in `scripts/`, so that the grid can be regenerated and recorded in `docs/certification/provenance.md` |

### Requirements

| Id | The system shall | Source | Verification |
| --- | --- | --- | --- |
| TER-300 | Hold the highest elevation found within each alerting grid cell | TSO App. 1 §2.17 | Test |
| TER-310 | Use a grid step of 15 arc-seconds or finer | TSO App. 1 §6.3 | Inspection |
| TER-320 | Use a source DEM with a 90 % vertical error of 16 m or better | TSO App. 1 §6.3 | Review |
| TER-330 | Record the source, version, generator commit and build date in the grid header | `provenance.md`; TSO App. 1 §6.2 | Inspection |
| TER-340 | Verify the grid's SHA-256 at load and report `GRID_BAD` on a mismatch | Task AT-14 | Test |
| TER-350 | Report `OFF_GRID` when any point of the search volume is outside the grid, and never treat it as clear | TSO App. 1 §6.1 | Test |
| TER-360 | Use the listed field elevation, falling back to the grid when a row has none | `db.airfields.json`: 109 rows without `Ele` | Test |
| TER-370 | Accept a new grid or airfield list with no code change | TSO App. 1 §6.4 | Test |

Today's coverage stops at 47 N, so Innsbruck and most of the Austrian and Swiss Alps north of it are off the grid. All 9.4 h of recorded flight stayed on it, but extending to at least 48 N is a release decision, listed under open questions. `Ele` in `db.airfields.json` is in metres: Montemelino's row gives 731 ft, against 761 ft measured parked.

## Audio and alert pipeline

Terrain alerts play through the daemon, pre-empt every lower sound and never depend on a browser. `pushEvent()` cannot do this today: it starts `aplay` with no queue, no priority and no check of the result. The arbiter below is shared with rank 1, so whichever feature ships first builds it.

### Sound priority

| Priority | Sound | Behaviour |
| --- | --- | --- |
| 1 | Terrain warning | Cuts anything playing, repeats until resolved |
| 2 | Terrain caution | Cuts priorities 3 to 5, replays every 7 s |
| 3 | `EMS_RULE_RED`, `EMS_GENERIC_FAILURE`, `SYSTEM_DANGER*` | Cuts priorities 4 and 5 |
| 4 | All other alert sounds | Plays in turn |
| 5 | Voice callouts from rank 1 | Dropped if it would play late |

The TSO only requires that more critical alerts override lesser ones. Terrain sits above an engine red because the time to act is shorter, and this order needs review against the FHA.

### Requirements

| Id | The system shall | Source | Verification |
| --- | --- | --- | --- |
| TER-400 | Route every daemon alert sound through one arbiter, so that one sound plays at a time | TSO §4.10.b; `pushEvent()` TODO | Test |
| TER-410 | Stop a playing sound of lower priority within 100 ms of a higher-priority alert | TSO §4.10.b | Test |
| TER-420 | Replay an active caution every 7 s | TSO Table 4-2 | Test |
| TER-430 | Repeat an active warning with no more than 1 s of silence between phrases | TSO Table 4-2 | Test |
| TER-440 | Keep repeating a warning after an acknowledgement | Alerts UI proposal, decision 6 | Test |
| TER-450 | Raise one alert per episode and update it through `updateEvent()`, not one alert per second | `main/ems.go`; RB-HLR-ALR-220 | Test |
| TER-460 | Define `EVENT_TYPE_TERRAIN_CAUTION` (17), `_WARNING` (18) and `_UNAVAILABLE` (19), with a row in every language | RB-HLR-ALR-070 | Test |
| TER-470 | Play prerecorded `.wav` and `.mp3` files named after the event, with no speech synthesis at run time | `soundFile()`; latency and failure path | Inspection |
| TER-480 | Publish terrain state to display clients at every change, and at least once per second during an alert | TSO §4.5 | Test |
| TER-490 | Show the TERRAIN annunciator on every plate for as long as the alert is active, outside the 10 s balloon rule | TSO §4.8; tech debt TD1 | Test |
| TER-500 | Keep the display silent for terrain events while `Audio_Enabled` is on, so two voices never overlap out of step | `pushAlert()` | Test |
| TER-510 | Show TER NO AUDIO when `Audio_Enabled` is off, the sounds folder is missing or `aplay` returns an error | TSO §7.0; `startAndWaitCmd()` drops the result | Test |
| TER-520 | Sound the first alert with no prior touch of any display | RB-HLR-ALR-190 | Test |

### Terrain state message

A new `/terrain` socket and `/getTerrain` request carry the state, following the `alertUpdate` broadcaster. Both are added to `docs/http-api.md`.

```json
{
  "State": "WARNING",
  "Reason": "",
  "Phase": "CRUISE",
  "ClearanceFt": -120,
  "TimeToThreatS": 24,
  "ThreatLat": 43.120,
  "ThreatLon": 12.300,
  "ThreatElevationFt": 2450,
  "Inhibited": false,
  "GridId": "sha256:..."
}
```

`State` is one of `CLEAR`, `CAUTION`, `WARNING`, `INHIBITED`, `UNAVAILABLE`. `Reason` names why the function is unavailable: `NO_FIX`, `POOR_FIX`, `NO_RATE`, `OFF_GRID`, `GRID_BAD`, `NO_AUDIO`, `STALLED`.

## Non-functional requirements

The function must be fast enough to be irrelevant to the alert time and isolated enough that its failure touches nothing else. A stall or crash in terrain code must not affect attitude, traffic or GDL90 output, and must be annunciated within 3 s.

The worst-case path from the first fix meeting the condition to the first audio sample is 1.5 s: 1 s for the confirming fix and 0.5 s for evaluation and audio. That is 5 % of the 30 s warning time.

| Id | The system shall | Source | Verification |
| --- | --- | --- | --- |
| TER-600 | Complete one evaluation within 20 ms on the target hardware, at the 99th percentile | Budget for a 1 Hz loop beside the core | Test |
| TER-610 | Evaluate at least once per second, on a fix no older than 2 s | TSO §4.5 | Test |
| TER-620 | Start the first audio sample within 1.5 s of the first fix meeting the alert condition | Timing budget above | Test |
| TER-630 | Use no more than 32 MB of resident memory, the mapped grid included | Budget | Test |
| TER-640 | Start the daemon without waiting for the grid, reporting unavailable until the grid is checked | RB-SYS-SYS-030 | Test |
| TER-650 | Contain a fault in the terrain worker so that core functions continue, and report `STALLED` | RB-SYS-SYS-030, RB-SYS-ALR-060 | Test |
| TER-660 | Report `STALLED` when no evaluation has completed for 3 s | TSO §7.0; RB-SYS-SYS-020 | Test |
| TER-670 | Check at start the grid hash, the sound files and the presence of `aplay` | TSO §8.0 | Test |
| TER-680 | Offer an audio test in settings that plays both phrases and is refused while airborne | TSO §8.0 note | Test |
| TER-690 | Record every state change, and clearance once per second during an alert, in a `terrain` data log table | `makeTable()`; needed to replay and tune | Test |
| TER-700 | Keep clearances and times as named constants under test, with only enable, minimum speed and inhibit as settings | A pilot-editable threshold would invalidate the verification | Inspection |
| TER-710 | Offer a test offset that raises terrain by a set height, clears at restart and shows TER TEST on every plate | Flight test at a safe height | Test |

New settings go into `docs/settings-reference.md`: `Terrain_Alerts_Enabled` (default on) and `Terrain_MinGroundSpeedKt` (default 45). The manual inhibit and the test offset are not persisted.

## Verification

The best logic so far gives 1.2 warnings and 5.9 cautions per flight hour on real recordings, above the proposed release targets of 0.2 and 2. Nuisance tuning on the new grid is therefore a release gate, not a formality.

### Replay of real flights

A read-only Python replay ran each candidate over 37 recordings: 9.4 h of flight at a median of 139 kt, 32 % of it below 1000 ft above the grid, in central Italy, on the existing grid. It measures nuisance only. No recording holds a real terrain conflict, so it says nothing about detection.

Each row adds one change to the row above. An alert needs two consecutive seconds and counts as new after 10 s clear. Alerts during aerobatics, meaning within 30 s of a vertical rate beyond 3000 ft/min (4.9 % of flight time), are counted apart.

| Step | Change | Cautions per hour | Warnings per hour |
| --- | --- | --- | --- |
| 1 | Descent projected over the whole look-ahead, highest of the 3 × 3 cells around the path, field box 1 NM and 300 ft | 13.96 | 9.17 |
| 2 | Descent projected over τ only (15 s and 6 s) | 9.81 | 7.36 |
| 3 | Path cell only, no neighbours | 6.08 | 2.03 |
| 4 | Field box 2 NM and 500 ft | 4.69 | 1.07 |
| 5 | Turn projection added, as the TSO requires: **proposed logic** | 5.86 | 1.17 |

Three variations of the proposed logic show what the choices cost.

| Variation | Cautions per hour | Warnings per hour | Reading |
| --- | --- | --- | --- |
| Corridor of ±0.25 NM | 6.72 | 2.56 | Width matters more than any other value, so it is tuned last on the new grid |
| Class A and B clearances (700 and 500 ft) | 11.83 | 5.33 | 41 warnings in cruise: these clearances do not suit low VFR, which supports Class C |
| Rate from GPS slope, not baro | 6.29 | 1.28 | Similar in normal flight, but 5 warnings against 0 during aerobatics |

Under the proposed logic, aerobatics gave no warnings and 11 cautions. Of the 11 warnings outside aerobatics, 9 were within 2 NM of a field at 500–770 ft above it, which is pattern height. A flat 5 NM inhibit would not be an answer: 74.7 % of the recorded flight time and 34.3 % of the land in the area the list covers lie that close to a listed field.

### Release targets

The TSO sets nuisance test cases but no rate per hour, so the rates below are proposals.

| Measure | Target |
| --- | --- |
| Warnings outside aerobatics, on all recordings | No more than 0.2 per flight hour |
| Cautions outside aerobatics, on all recordings | No more than 2 per flight hour |
| Normal circuit at the home field | No warnings in 5 consecutive flights |
| Warning lead on seeded terrain conflicts | 25 s or more in at least 99 % of runs |
| TSO Class C cases in Tables A, B and E | All inside the limits, with the same grid as flight |

### Test levels

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `main/terrain_test.go`, run by `make check`, each test tagged `// Covers:` | Lookup, phases, prediction, state changes, inhibits, unavailable reasons |
| TSO scenarios | Same file, synthetic grid at 100, 150 and 200 kt | Alert heights against Tables A, B and E |
| Seeded detection | Replay tool, real tracks with altitude lowered onto a real ridge | Warning lead, and the detection that the replay above cannot show |
| Real-flight replay | `test/integration/`, recorded flights through `-trace` into the real daemon | Nuisance targets on the release grid |
| Audio | Bench, `strace` with a null ALSA device | Pre-emption, repeat timing, TER-410 and TER-620 |
| Display | `test/display/test_terrain.py`, local only, at 1280×800, 1024×600, 800×480 and round 480×480 | Annunciator and chips on every plate, clear of the FAB zones and inside the circle |
| Ground | On the aircraft, engine off and running | Both phrases clear through the headset at normal intercom level |
| Flight | TER-710 offset, in clear weather at a safe height | Spoken alerts and timing, with no real terrain conflict |

## Delivery order

The function ships in six steps, flying silently before it ever speaks.

1. **Audio arbiter.** Build TER-400 to TER-440 with rank 1, and settle the `Audio_Enabled` default.
2. **Shadow mode.** Add the plugin on the existing grid, with the reader's step fixed at 0.01°. It logs to the `terrain` table and says nothing, so real flights tune it safely.
3. **Alerting grid.** Build `terrain-alert.bin`, then rerun the replay, because highest-in-cell terrain will raise the counts above.
4. **Mountain data.** Collect shadow-mode flights in the Alps and Apennines, which the recordings barely cover.
5. **Spoken alerts, opt-in.** Turn on the voice and annunciators behind a default-off setting, and run the ground and flight tests.
6. **Release.** Default on once the targets are met, with `requirements/RB-HLR-TER.md`, the `TER` code, FHA rows, and `docs/http-api.md` and `docs/settings-reference.md` updated.

## Open questions, risks and regulatory notes

### Decisions needed

| Question | Recommendation |
| --- | --- |
| Should the field box rise from 500 to 800 ft? | Try it in shadow mode. 800 ft is the TSO's pattern height and would remove 9 of the 11 warnings, at the cost of protection in the pattern. Garmin uses 0.5 NM and 200 ft. |
| Are the release targets right? | Confirm 0.2 warnings and 2 cautions per hour before tuning starts. |
| What corridor half-width on the new grid? | Start at one cell (460 m, 0.25 NM) and narrow only if the targets demand it. |
| Should the grid reach 48 N? | Yes: Innsbruck and the northern Alps are otherwise off the grid, and it costs about 1.7 MB. |
| Should `Audio_Enabled` default to on? | Yes where an audio output is fitted, as the alerts UI proposal recommends. A spoken alert needs it. |
| What is the Italian wording for "pull up"? | The owner decides. Until RB-HLR-ALR-200 closes, the daemon plays the en-US row whatever the language. |
| Does terrain outrank an engine red? | Proposed yes, for review against the FHA. |
| Which board sets TER-600 and TER-630? | Name it, and measure there. No target hardware was available for this document. |
| Should the map and synthetic vision move to the alerting grid? | Yes, after release. Until then, colours and alerts come from different data and can disagree. |

The priorities table in `docs/product/competitor-features.md` also needs correcting: it still cites the 68 Italian callout texts, and places trigger logic in the browser.

### Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Highest-in-cell terrain reads higher than today's grid | Every rate in this document is likely to rise | Rerun the replay in step 3 before any spoken release |
| The recordings are one aircraft in central Italy | The logic is untested in high mountains and steep valleys | Shadow flights in step 4 |
| Silence is read as clearance | Masts, lines and unmodelled terrain give no alert | State the limits in the pilot documentation and at TER INH |
| The field box hides a real conflict | No alert below 500 ft within 2 NM of a field, about 8 % of the land | Keep the box as small as the targets allow, and log what it hides (TER-240) |
| Nuisance alerts teach the pilot to ignore or inhibit | The function loses its value | Release targets, and the inhibit clears at restart |
| Baro and GPS rates disagree | 98 ft/min at the median, 647 ft/min at 95 %, so alert timing varies in manoeuvres | Baro first, GPS slope as fallback, with both logged |

### Regulatory notes

- **No compliance claim.** TSO-C151c is a design reference. The function omits four Class C functions and uses uncertified GPS, so RB-01 must not call it TAWS. The priorities table's "TAWS colouring" label should change for the same reason.
- **Newer revision.** A search shows a TSO-C151d dated 2017 that ties Class A and B to RTCA DO-367. It was not read here, so check it before citing any revision externally.
- **Failure classification.** TSO-C151c rates hazardously misleading information as major and loss of function as minor. `docs/certification/fha.md` needs new rows for missed, false and late terrain alerts, and whether the function joins the core or the second baseline is a DER decision.
- **Requirements standard.** The `TER` code is a change to `docs/certification/standards/requirements.md` §3. Derived requirements such as TER-160 and TER-200 must be fed back to the FHA.
- **Data licence.** The Copernicus notices, including the one for modified data, must ship with the grid.

## Sources

- [TSO-C151c, Terrain Awareness and Warning System](https://skybrary.aero/sites/default/files/bookshelf/4189.pdf), FAA, 2012-06-27: appendices 1 and 3 read in full for the clauses cited.
- [Forward Looking Terrain Avoidance](https://www8.garmin.com/manuals/webhelp/GUID-1FA95EDE-BA0A-4000-B109-7E73945389F7/EN-US/GUID-DF252D12-2383-401E-BF3C-F16E29FE567E.html), Garmin pilot's guide 190-03123-21 Rev B: alert types and the inhibit figures.
- [TAWS Visual Annunciations and Voice Alerts](https://www8.garmin.com/manuals/webhelp/GUID-1FA95EDE-BA0A-4000-B109-7E73945389F7/EN-US/GUID-19BFECF4-9C05-480B-8096-E090CF2E00BC.html), Garmin: voice wording. This is a general Garmin TAWS guide, not the G3X Touch one.
- Garmin AXIS Pilot's Guide for Experimental Aircraft 190-03123-21 Rev B, FLTA suppression: [summary](https://www8.garmin.com/manuals/webhelp/GUID-1FA95EDE-BA0A-4000-B109-7E73945389F7/EN-US/GUID-19BDFA86-7EAE-403D-8875-AD10FF5307BC.html), [near runways](https://www8.garmin.com/manuals/webhelp/GUID-1FA95EDE-BA0A-4000-B109-7E73945389F7/EN-US/GUID-77F94B88-023A-455F-B26D-E862AFA93526.html), [near airports](https://www8.garmin.com/manuals/webhelp/GUID-1FA95EDE-BA0A-4000-B109-7E73945389F7/EN-US/GUID-885DF1FC-FA91-43A2-B84F-1477F98D9ED5.html), [additional](https://www8.garmin.com/manuals/webhelp/GUID-1FA95EDE-BA0A-4000-B109-7E73945389F7/EN-US/GUID-E45E83BA-807A-4101-8392-ECD5151A4610.html), [approach paths](https://www8.garmin.com/manuals/webhelp/GUID-1FA95EDE-BA0A-4000-B109-7E73945389F7/EN-US/GUID-EBA08C61-9E6B-4DBD-A8A9-4DC5EE801551.html). The guide cited above as a general Garmin TAWS guide is this one.
- [G3X Touch Pilot's Guide, Terrain Alerts](https://www.manualslib.com/manual/975522/Garmin-G3x-Touch.html?page=177), manualslib copy; [G950 FLTA inhibit](https://www.manualslib.com/manual/1881532/Garmin-G950.html?page=343), manualslib copy.
- [Is terrain airspeed adjustable?](https://forum.flydynon.com/threads/is-terrain-airspeed-adjustable.9259), Dynon forum, answers by Dynon support.
- [Using the ground proximity and flap overspeed warning system](https://www.mglavionics.co.za/Docs/G2%20Ground%20proximity%20and%20flap%20overspeed%20setup.pdf), MGL Avionics, G2 EFIS.
- [Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM), Copernicus Data Space: resolution, accuracy, datum and licence.
- [Vertical accuracy assessment for open-source DEMs](https://isprs-archives.copernicus.org/articles/XLVIII-4-W6-2022/355/2023/), Tahir and Din, ISPRS 2023: SRTM 16 m at 90 %.
- Repository: `docs/product/competitor-features.md`, `docs/terrain-elevations.md`, `docs/tech-debt/ALERTS-NAVIGATION-UI-PROPOSAL.md`, `docs/certification/fha.md`, `requirements/RB-HLR-ALR.md`, and the code cited in each section.
- Flight recordings: local SQLite data logs, replayed read-only on 2026-11-07.
