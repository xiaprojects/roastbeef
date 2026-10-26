# NMEA Navigation Output (HSI / glide over RS-232) — Implementation Spec

**Status:** proposed, 2026-10-12. Builds on commit `b69d6263` (#141), which made cross-track
leg-based and added `$GPBOD`/`$GPXTE`.
**Code:** `main/autopilot.go` (nav solution + sentence builders), `main/autopilotudp.go`
(external passthrough), `main/network.go` `sendNetFLARM()` (all `NETWORK_FLARM_NMEA` outputs:
serial, TCP/UDP `:2000`, BLE — see [other-transports.md](other-transports.md)).

Requirements are numbered **N1…N8** so commits and tests can reference them.

## 1. Purpose and receivers

RB-01's internal autopilot / direct-to flies a waypoint list (`/autopilot`, `Waypoint{Lat, Lon,
Ele, Status, Cmt}`). This spec makes the NMEA it emits a complete GPS-navigator feed for an
external HSI: course pointer, lateral deviation, waypoint, distance, and a VNAV (glide)
deviation.

The primary receiver is a **Garmin G5** with *RS-232 Input Format = NMEA*. Its NMEA input
recognises exactly three sentences — **`$GPBOD`, `$GPRMB`, `$PGRMH`** (observed in G5
software 8.60). Autopilots and EFBs on the same stream also read `$GPAPB` and `$GPXTE`, so those
stay.

| Sentence | Expected use by the G5 (confirm on the bench, §10) |
|---|---|
| `$GPRMB` | lateral deviation (CDI), TO waypoint ident, distance, bearing, arrival |
| `$GPBOD` | course pointer (leg course) |
| `$PGRMH` | vertical deviation (glide indicator), desired track |

## 2. Current state (b69d6263)

| Sentence | Today | Gap |
|---|---|---|
| `$GPRMB` | 1 Hz; leg XTK, closing speed, zero-padded lat/lon | IDs are indexes (`"%03d"`); nothing is sent on GPS loss |
| `$GPBOD` | leg course, true; magnetic null | IDs are indexes |
| `$GPAPB` | all angles tagged `T` | field 7 (perpendicular passed) just mirrors arrival |
| `$GPXTE` | yes | no invalid state |
| `$PGRMH` | **passthrough only** (from an external navigator over UDP, `autopilotudp.go`) | never generated from RB-01's own plan |
| `$GPRMC` | magnetic-variation fields empty | no variation source |

## 3. Requirements

| Id | Requirement | Section |
|---|---|---|
| **N1** | Generate `$PGRMH` from the internal plan, including VNAV deviation | §5.1, §6 |
| **N2** | Waypoint identifiers derived from names, not indexes | §4.3 |
| **N3** | Explicit invalid state on GPS loss (status `V`), not silence | §4.5 |
| **N4** | Leg sequencing on arrival radius **or** passing abeam; fix the off-by-one | §4.4, §8 |
| **N5** | Configurable nav output rate 1–5 Hz, stale bursts dropped | §7 |
| **N6** | One nav solution per cycle; every sentence formats from it | §4 |
| **N7** | (optional) Magnetic variation (WMM) for `$GPBOD` / `$GPRMC` | §5.5 |
| **N8** | Unit tests + G5 bench procedure | §10 |

## 4. Navigation solution (N6)

Compute once per cycle, then format every sentence from the result. Extend `GPRMBData` (or
replace it) to carry at least these fields:

| Field | Meaning |
|---|---|
| `Valid` | `isGPSValid()` and an active leg exists |
| `FromID`, `ToID` | §4.3 |
| `ToLat`, `ToLon`, `DistNM`, `BrgTrue` | aircraft → TO, great circle (exists) |
| `XtkNM` | signed, **+ = right of course** (exists: `crossTrackNM`) |
| `LegNM`, `AlongNM` | origin → TO length; along-track distance from the origin |
| `DtkTrue` | desired track at the aircraft's abeam point (§4.2) |
| `ClosingKt` | GS component along the bearing (exists) |
| `NextLegTrue`, `HasNextLeg` | course TO → next waypoint, if there is one |
| `InsideArrival`, `PassedAbeam` | §4.4 |
| `Vnav` | §6 |

### 4.1 Inputs (`mySituation`)

| Field | Units / note |
|---|---|
| `GPSLatitude`, `GPSLongitude` | decimal degrees |
| `GPSTrueCourse` | degrees true; frozen below 3 kt |
| `GPSGroundSpeed` | knots |
| `GPSAltitudeMSL` | feet; VNAV altitude source, §6 |
| `GPSVerticalAccuracy` | metres |
| `BaroVerticalSpeed` | ft/min, valid when `isTempPressValid()`. `GPSVerticalSpeed` is never assigned in this fork, so it must not be used |

### 4.2 Leg and desired track

The origin is the previous waypoint. On a direct-to it is the position where the leg became
active (`legOrigin*`) — this already exists.

`LegCourse` today is the **initial** great-circle course at the origin. DTK **should** be the
course at the aircraft's abeam point:

```
along   = R·acos( cos(d13/R) / cos(xtk/R) )       d13 = origin→aircraft distance
abeam   = destination point from origin, initial course θ12, distance along
DtkTrue = initial bearing abeam → TO
```

For legs under 100 NM the two differ by about 1° at most, so `LegCourse` is acceptable as a
first step. `AlongNM` is needed anyway for §4.4 and §6.

### 4.3 Waypoint identifiers (N2)

Derive the identifier from `Cmt`, which the GPX import fills from `<cmt>`, else `<name>`:

1. Take the first token, splitting at a space or comma: `"LIQQ Serristori, 866ft"` → `LIQQ`.
2. Uppercase it.
3. If the token contains `-`, keep the part after the last `-`: `"LIRS-RSNE1"` → `RSNE1`. This
   is the AIRPORT-POINT form of VFR reporting points.
4. Drop every character outside `[A-Z0-9]`.
5. Truncate to `Autopilot_WaypointIdLen` characters (default 6).
6. If the result is empty, use `WP%03d` (1-based plan index).

The result must never contain the NMEA-reserved characters `$ * , ! \ ^ ~` or CR/LF. The same IDs
go into `$GPRMB` fields 4/5, `$GPBOD` fields 5/6 and `$GPAPB` field 10. Whether the G5 shows 5 or
6 characters is a bench check (B5).

### 4.4 Sequencing (N4)

- `InsideArrival` = `DistNM` below `AUTOPILOT_ARRIVAL_RADIUS_METERS` (500 m, exists).
- `PassedAbeam` = `AlongNM ≥ LegNM`, i.e. the aircraft has crossed the perpendicular through
  TO. Without it, a leg whose 500 m circle is missed never sequences.
- **Sequence** to the next waypoint on `InsideArrival || PassedAbeam`.
  - `$GPRMB` field 13 = `A` while either is true.
  - `$GPAPB` field 6 = `InsideArrival`; field 7 = `PassedAbeam`.
- After the last waypoint is reached, the solution becomes invalid (status `V`), as today.
- Turn anticipation is not required.

### 4.5 Validity (N3)

While the autopilot is `Active` with a non-empty plan:

| Condition | Output |
|---|---|
| `isGPSValid()` and an active leg | normal sentences, status `A` |
| GPS invalid or stale | every cycle: `$GPRMB`, `$GPAPB`, `$GPXTE` and `$PGRMH` with status **`V`**. The last waypoint fields are kept so the receiver keeps the ident; values are unusable by definition of `V`. `$GPBOD` is omitted, since it has no status field |
| no leg (plan finished, or no target) | `$GPRMB` status `V`, as today |

The receiver must flag within one output period, instead of waiting for its own timeout.

## 5. Sentences

All sentences are built with `appendNmeaChecksum()` and end in `\r\n`. Every example below is
the §6.4 scenario, with checksums verified.

### 5.1 `$PGRMH` — Aviation height and VNAV data (N1, new)

Field definitions from Garmin *Proprietary NMEA 0183 Sentences — Technical Specifications*,
190-00684-00 Rev. C, §2.2.4.

**The wire format is in [pgrmh-format.md](pgrmh-format.md):** encoding, rounding, saturation,
null rules, test vectors and a reference encoder. That file is authoritative for encoding; this
section only maps each field to its RB-01 source.

| # | Garmin definition | RB-01 source | Format / range | Null when |
|---|---|---|---|---|
| 1 | Data status: `A` valid, `V` unusable | solution `Valid` | `A`/`V` | — |
| 2 | Vertical speed, ft/min (− down, + up) | `BaroVerticalSpeed` | integer, clamp ±9999 | baro invalid |
| 3 | **VNAV profile error, ft: −999 (below profile) … +999 (above profile)** | §6: aircraft alt − profile alt | integer, **clamp ±999** | VNAV inactive |
| 4 | Vertical speed to VNAV target, ft/min | §6 | integer, clamp ±9999 | VNAV inactive |
| 5 | Vertical speed to next waypoint, ft/min | §6 | integer, clamp ±9999 | no TO target altitude |
| 6 | Approx. height above terrain, ft (rounded down to 100 ft) | none (no terrain model in the Go daemon) | — | always |
| 7 | Desired track, degrees true | `DtkTrue` | `%.0f`, normalised to [0, 360) after rounding | invalid |
| 8 | Course of next route leg after the active waypoint, degrees true | `NextLegTrue` | as field 7 | no next leg |

Examples:

```
$PGRMH,A,-500,559,-686,-515,,232,*1A     VNAV active: 559 ft above a 3° profile, last leg
$PGRMH,A,-500,,,,,232,*2A                lateral only: VNAV inactive, fields 3-5 null
$PGRMH,V,,,,,,,*16                       GPS invalid
```

For comparison, an external navigator seen on UDP (the `autopilotudp.go` header, checksum
verified) sends `$PGRMH,A,0,-999,0,0,1300,341,0*21`. It encodes "no profile" as a pegged −999
and zeros, instead of nulls.

**Bench decision B3 (safety-relevant).** A null field 3 should hide the G5's glide indicator.
If instead the G5 draws it **centred** (on path), that is misleading. In that case, send status
`V` in field 1 whenever VNAV is inactive. The G5 still gets the course from `$GPBOD`.
Record the result in this document.

### 5.2 `$GPRMB` — changes only

- Fields 4/5: IDs per §4.3 (N2).
- Field 13: arrival per §4.4.
- Status `V` per §4.5.

```
$GPRMB,A,0.00,L,PIOMBI,LIRJ,4245.6667,N,01014.3833,E,8.0,232.1,100.0,V*39
```

### 5.3 `$GPBOD` — changes only

- Field 1 from `DtkTrue` (§4.2).
- IDs per §4.3.
- Fields 3/4 (magnetic) stay null unless N7 is enabled.
- Omitted while invalid.

```
$GPBOD,232.1,T,,M,LIRJ,PIOMBI*66           no variation source
$GPBOD,232.1,T,228.5,M,LIRJ,PIOMBI*45      with N7 (3.6°E)
```

### 5.4 `$GPAPB` / `$GPXTE` — changes only

- `$GPAPB` fields 6/7 per §4.4, ID per §4.3.
- Both sentences: fields 1/2 = `V,V` while invalid (§4.5).
- Angles stay tagged `T`.

### 5.5 Magnetic variation (N7, optional)

There is no variation source in the daemon today. The G5 holds its own magnetic model, so it is
not expected to need one; confirm on the bench (B1). Other receivers, such as autopilots that
steer a magnetic course, benefit from it.

- **Implement with WMM2025** (NOAA, public domain, valid 2025–2030).
  - Evaluate it at the aircraft position at ≤ 0.1 Hz.
  - Implementation: either an existing Go WMM package (check its licence against AGPL-3.0
    before adding it), or a small spherical-harmonic evaluator with the coefficients embedded.
- **Use it in:**
  - `$GPBOD` fields 3/4;
  - `$GPRMC` fields 10/11 (`makeGPRMCString`, `flarm-nmea.go`).
- **Gate:** `Autopilot_MagVarEnabled` (default `false`).

## 6. VNAV model (`$PGRMH` fields 3–5)

VNAV is **advisory and descent-only**, with no enable of its own (§9). It gives
**no terrain or obstacle protection**, and the settings UI and user docs must say so.

### 6.1 Target altitude per waypoint

`Waypoint.Ele` is treated as **feet MSL**. The GPX import stores `<ele>` metres × 3.28084: that
is the planned altitude for en-route points and the field elevation for airports.

| TO waypoint | Target altitude | Target point |
|---|---|---|
| intermediate | `Ele` | the waypoint |
| last of the plan (destination) | `Ele + glide.arrivalAglFt` (default 1000) | `glide.arrivalOffsetNM` (default 2.0) before the waypoint, along the leg |

**`Ele == 0` means "no altitude"** (fail-safe): VNAV is inactive on that leg. A GPX point without
`<ele>` imports as 0, and a target of 0 ft MSL (or 1000 ft MSL at a high field) would command a
descent into terrain.

### 6.2 Geometry

Let `γ = glide.descentAngleDeg` (default 3.0) and `k = 6076.12 · tan γ` feet per NM (318.4 at
3°).

```
alt     = GPSAltitudeMSL
dTgt    = DistNM − offset                     along-track NM to the target point
profile = targetAlt + dTgt · k
field3  = clamp( round(alt − profile), −999, +999 )        + = above the profile
dTOD    = (alt − targetAlt) / k                            top-of-descent, NM before the target point
field4  = (targetAlt − alt) / (dTgt / ClosingKt · 60)       ft/min
field5  = (targetAlt − alt) / (DistNM / ClosingKt · 60)     ft/min, to the waypoint itself
```

### 6.3 Active window (fields 3/4 non-null only when all hold)

1. The solution is valid and the TO target altitude is known (§6.1). There is no enable to
   check: an absent altitude is what keeps VNAV quiet on a plan that has none.
2. `alt > targetAlt + 100` (descent-only; no climb profiles).
3. `0 < dTgt` (before the target point) and `(dTgt − dTOD) / ClosingKt · 3600 ≤ 60` seconds
   (negative once past top-of-descent). This shows the
   indicator from one minute before top-of-descent, as panel GPS VNAV does. Before that, the path
   is far above the aircraft and the cue would be a misleading "fly up".
4. `ClosingKt ≥ 30` and `GPSVerticalAccuracy ≤ 30 m` (constant `VNAV_MAX_VFOM_M`).

Field 5 needs only items 1, 2 and the `ClosingKt` check.

### 6.4 Worked example (use as a unit test)

| Input | Value |
|---|---|
| Leg | PIOMBI (42.925499, 10.528200) → LIRJ (42.761112, 10.239722), course 232.2° |
| LIRJ | last waypoint, `Ele` 30 ft |
| Settings | defaults: 3°, +1000 ft, 2.0 NM |
| Aircraft | on the leg 8.0 NM before LIRJ, 3500 ft MSL, closing 100 kt, baro VS −500 ft/min |

| Quantity | Value |
|---|---|
| target | 1030 ft at 2.0 NM before LIRJ → `dTgt` = 6.0 NM |
| `k` | 318.44 ft/NM → profile 2940.6 ft → **field 3 = +559** (above) |
| `dTOD` | 7.76 NM > `dTgt` → past top-of-descent, active |
| field 4 | (1030 − 3500) / 3.6 min = **−686** |
| field 5 | (1030 − 3500) / 4.8 min = **−515** |
| result | `$PGRMH,A,-500,559,-686,-515,,232,*1A` |

For reference, the on-path vertical speed at 100 kt on 3° is −531 ft/min.

## 7. Output timing (N5)

- **Burst order** per cycle: `$GPRMB`, `$GPBOD`, `$GPAPB`, `$GPXTE`, `$PGRMH`, sent
  contiguously.
- **Rate:** `Autopilot_NavRateHz` (1–5, default 1) replaces the loop's `time.Sleep(1s)` with a
  ticker. `autopilotUpdate.SendJSON` (web UI) stays at 1 Hz.
- **Freshness:** pass `maxAge = 1/rate` to `sendNetFLARM()` (today `time.Second`), so a delayed
  burst is dropped instead of queued behind a newer one.
- **Bandwidth.** A nav burst is about 245 characters. The rest of the 1 Hz NMEA stream (RMC,
  GGA, GSA, PGRMZ, PFLAU) is about 290, plus about 60 per `$PFLAA` traffic target. Keep the total
  below 70 % of `baud/10` characters per second:

| Port speed | Budget (70 %) | Nav rate that fits with ~5 traffic targets |
|---|---|---|
| 9600 | 670 char/s | none with traffic (1 Hz is ~835 char/s); 1 Hz only with no traffic on that port (~535) — prefer a faster port |
| 38400 (RB-01 serial default) | 2690 char/s | up to 5 Hz |

  Set the G5's *RS-232 Baud Rate* to the RB-01 port's rate.
- **Source arbitration** stays as it is. An external `$GPRMB` received on UDP/BLE stops the
  internal autopilot (`parseAndManageGPRMB` clears `Active`), so internal and passed-through
  `$PGRMH`/`$GPRMB` never interleave. The internal generator emits only while `Active`.

## 8. Fixes in the existing code path

1. **`autopilotEventAbeamPoint`:** `len(waypointsData) > waypointIndex+2` must be `+1`. Today
   the last waypoint is never promoted to TARGET; it is only reached through the nearest-waypoint
   fallback.
2. **`autopilotRoutine`:** the GoTo trigger compares `To.Lat != … && To.Lon != …`; it must be
   `||`. A new TO on the same latitude **or** longitude as the previous one never fires
   `autopilotEventGoTo`, so `legOriginValid` is not reset for a direct-to.
3. **`Waypoint.Ele`:**
   - the struct comment says "Pressure altitude", but the GPX import stores MSL feet; make the
     comment read "feet MSL (target altitude; 0 = none)";
   - the UI's "Current Position" waypoints use `BaroPressureAltitude` (`autopilot.js`); use
     `GPSAltitudeMSL` for consistency.

## 9. Settings

New fields go in the settings struct and defaults (`gen_gdl90.go`, next to `Autopilot_*`), in
[settings-reference.md](../settings-reference.md) (the existing `Autopilot_*` fields are missing
there too), and in the settings UI.

| Setting | Type | Default | Range |
|---|---|---|---|
| `Autopilot_NavRateHz` | int | 1 | 1–5 |
| `Autopilot_WaypointIdLen` | int | 6 | 3–10 |
| `Autopilot_MagVarEnabled` | bool | false | (N7) |

VNAV has **no setting of its own**: like every other autopilot sentence it is live whenever
`Autopilot_Enabled` is, and goes quiet by sending null fields when the leg has no altitude to
descend to. Its glide profile describes the airframe, not the installation, so it lives in
`settings/aircraft.json` beside `units` — the same RB-01 moved to another aircraft needs
another angle, and the Aircraft plate already edits that file:

| `glide` key | Type | Default | Accepted | Falls back when |
|---|---|---|---|---|
| `descentAngleDeg` | float | 3.0 | 1.0–9.0 | absent or out of range |
| `arrivalAglFt` | float | 1000 | 0–10000 | absent or out of range |
| `arrivalOffsetNM` | float | 2.0 | 0–50 | absent or out of range |

```json
"glide": { "descentAngleDeg": 3.0, "arrivalAglFt": 1000, "arrivalOffsetNM": 2.0 }
```

Each key falls back on its own, so a partial block still flies. **Absent is not zero**: an
omitted `arrivalAglFt` takes the 1000 ft default, while an explicit `0` is honoured as "cross
the threshold at field elevation". The file is re-read when its timestamp changes, so an edit
reaches the next sentence without a restart; a missing file or unparseable JSON falls back to a
standard 3° path and logs once.

## 10. Verification (N8)

### Unit tests (`main/autopilot_test.go`, run by `make check`)

- **Golden sentences:** every example in §5, checksums included.
- **XTK sign:** an aircraft right of a north-bound leg gives `XtkNM > 0` and RMB steer `L`.
- **DTK at abeam:** within 0.1° of a reference great-circle calculation.
- **Sequencing:**
  - inside the 500 m radius;
  - passing abeam 1 NM wide of TO;
  - the last waypoint gets promoted (fix 8.1);
  - a same-latitude TO fires GoTo (fix 8.2).
- **VNAV:**
  - the §6.4 example exactly;
  - null before TOD − 60 s, past the target point, below the target, and with `Ele == 0`;
  - ±999 clamp;
  - `ClosingKt < 30` → null.
- **ID sanitiser:** `"LIQQ Serristori, 866ft"` → `LIQQ`, `"LIRS-RSNE1 Monticiano"` →
  `RSNE1`, `"Piombino"` → `PIOMBI`, `""` (3rd waypoint) → `WP003`, reserved characters
  stripped.
- **GPS invalid:** status `V` in RMB/APB/XTE/PGRMH, BOD absent.

### G5 bench procedure

Setup: G5 *RS-232 Input Format = NMEA*, matching baud, CDI source = GPS. Fly with a simulated
GPS track, or the replay tooling in `test-data/`.

| # | Action | Expected |
|---|---|---|
| B1 | Fly 1 NM right of a leg, heading parallel | course pointer = leg DTK (not the bearing to TO); CDI needle **left** of centre; true/magnetic offset on the pointer is ≈ 0, otherwise enable N7 |
| B2 | Cross the course line | needle passes centre with the right sense; deflection scale noted here |
| B3 | VNAV: aircraft +300 ft above the profile, then VNAV inactive | glide indicator **below** centre ("fly down"); with field 3 null the indicator is **hidden**, otherwise apply the §5.1 fallback |
| B4 | Remove the GPS fix | nav flag within one output period |
| B5 | Plan with a 6-character ident | ident shown; record the G5's display length |
| B6 | Run at 1 Hz and at the highest rate the port budget allows | no "Not receiving RS-232 data", no dropped or garbled sentences |

Record the results (and the G5 software version) in this section when they are run.

## 11. Out of scope

- GPS steering (GPSS) and approach modes or CDI scaling (en-route behaviour only).
- `$PGRMH` field 6 (no terrain model in the daemon).
- Route transfer (`$GPWPL`/`$GPRTE`): the G5 does not read it.
- ARINC 429.

## References

- Garmin, *Garmin Proprietary NMEA 0183 Sentences — Technical Specifications*, 190-00684-00
  Rev. C, §2.2.4 (`$PGRMH`), §2.2.8 (`$PGRMZ`).
- NMEA 0183: `RMB`, `BOD`, `APB`, `XTE`, `RMC`.
- NOAA World Magnetic Model WMM2025.
