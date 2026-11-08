# Competitor Feature Comparison and Implementation Priorities

Status: 2026-10-31, with partner coverage and the agreed next features. Owner: xiaprojects.
The RB-01 column is checked against this repository; competitor cells come from the sources at
the end, and cells marked **?** could not be confirmed. Re-check a competitor cell against that
vendor's current pilot's guide before using it in marketing.

**Question this answers:** which features do pilots get from the EFIS products RB-01 competes
with that RB-01 lacks, who covers each one, and in what order should we build the ones that
fall to RB-01?

The website review of 2026-10-11 (`www.rbavionics.com` project: legal footer, prices,
downloads, spec tables) compared the *sites*. This file compares the *products*.

## Competitors

| Column | Product | Why it is here |
|---|---|---|
| **G3X** | Garmin G3X Touch | The market reference for experimental and light-sport panels. |
| **SkyView** | Dynon SkyView HDX | The other big integrated system. Advanced Flight Systems, in the website review, sells SkyView-based panels and is covered here. |
| **MGL** | MGL Avionics iEFIS | Integrated EFIS/EMS/autopilot, strong in Europe and the ultralight class. |
| **Kanardia** | Kanardia Nesis | European ultralight EFIS/EMS, the closest peer in price and class. |
| **Stratux** | Stratux (upstream) | Open-source baseline that RB-01 forks; a traffic receiver for EFB apps, not a display. |

GRT (HXr, Horizon) was in the website review but is left out: GRT sells for experimental
aircraft only, mainly in the US, and its current feature set could not be confirmed.

## Parity: what RB-01 already matches

RB-01 already offers what the EFIS competitors list as their core, so these are not gaps:
attitude, airspeed, altimeter, VSI and turn-slip instruments with AHRS failure flags, turn-rate
trend, QNH readout and heading bug (`web/RB-01/plates/attitude.html`); synthetic vision with
TAWS colouring and a magenta pathway (`synthview`); HSI; moving map with a terrain-colour
overlay (`map`); GPX routes, direct-to and nearest with VNAV guidance to an external autopilot
(`main/autopilot.go`, `$GPRMB` / `$PGRMH`); wind and magnetic variation
(`services/windestimator.js`, `services/variation.js`); EMS and EGT pages (`ems`, `emsegt`,
`main/ems.go`); com radio control (`main/radio.go`, KRT2-compatible `$PMRRC`); checklists,
timers, Hobbs meter; camera page; switchboard for actuators; slave displays (RB-09 via
`$RBATT`/`$RBAIR`, RB-02); flight data logging with GPX/KML/CSV export; OTA updates.

## How each gap is covered

RB-01 does not build every gap itself. Each one falls to one of these:

- **Partner app.** RB-01 is a partner of EasyVFR 4, and any Android navigator that implements
  the features can take the same role. The partner app covers airspace alerts, offline
  airspace, aeronautical map data, the obstacle database, weight and balance, flight plan and
  EFB, and IFR coupled approaches. RB-01 feeds the app over GDL90 and NMEA (position, pressure
  altitude, attitude, traffic) and follows its route through `$GPRMB` over UDP
  (`main/autopilotudp.go`).
- **Autopilot integration.** Autopilots are supported through Garmin (CAN or NMEA) and
  Dynon. RB-01 already sends route and VNAV guidance as `$GPRMB` / `$PGRMH`.
- **RB-01.** Everything else is built in RB-01 and ranked under
  [Implementation priorities](#implementation-priorities).

## Feature matrix: gaps and differentiators

✓ has it · ◐ partial, or needs an extra module · ✗ does not have it · ? not confirmed

### Where RB-01 is behind

| Feature | G3X | SkyView | MGL | Kanardia | Stratux | RB-01 today | Covered by |
|---|---|---|---|---|---|---|---|
| Voice callouts (altitude, bank, speed arcs, engine limits) | ✓ | ✓ | ✓ | ? | ✗ | ◐ 68 Italian callout texts in `web/settings/alertsMapping.json`; five have an Id (`stall`, `speed_white`, `bank_angle_60`, …) and no code raises any of them. The English table has only system, timer, autopilot, radio and EMS-failure events | **RB-01** |
| Engine limit alerts | ✓ | ✓ | ✓ | ? | ✗ | ◐ gauges colour their arcs; one alert, `EMS_GENERIC_FAILURE` | **RB-01** |
| Engine-out glide help (glide range ring, best field in reach) | ✓ Smart Glide, ring accounts for terrain | ? | ? | ? | ✗ | ✗ nearest and direct-to exist; nothing works out what is reachable | **RB-01** |
| Spoken terrain alerts ("terrain ahead") | ✓ | ? | ✓ TAWS | ? | ✗ | ✗ terrain is coloured on synthetic vision and the 2D map, never announced | **RB-01** |
| Flight path marker | ✓ | ✓ | ? | ? | ✗ | ✗ drift angle (wind code) and flight path angle (VS / GS) are both available | **RB-01** |
| Airspeed and altitude trend vectors | ✓ | ✓ | ? | ? | ✗ | ◐ turn-rate trend only | **RB-01** |
| Selected altitude bug and altitude alerting | ✓ | ✓ | ? | ? | ✗ | ✗ | **RB-01** |
| Fuel computer (flow, endurance, range ring) | ✓ | ✓ | ✓ | ? | ✗ | ✗ the EMS data has fuel level and pressure but no fuel flow | **RB-01** |
| AOA indication and stall warning | ✓ | ✓ | ✓ | ? | ✗ | ✗ no AOA sensor; a "Stallo" callout text exists | **RB-01** (needs an AOA probe) |
| Airspace alerts (proximity, penetration) | ✓ | ? | ? | ? | ✗ | ✗ | **Partner app** |
| Offline airspace and aeronautical map data | ✓ | ✓ | ✓ | ✓ | ✗ | ◐ openAIP map tiles fetched online; MBTiles layers work offline | **Partner app** |
| Obstacle database | ✓ | ? | ? | ? | ✗ | ✗ | **Partner app** |
| Weight and balance | ✓ | ? | ? | ? | ✗ | ✗ | **Partner app** |
| Flight plan and EFB | ✓ Garmin Pilot | ? | ? | ? | — | ◐ GPX import; follows an EFB's `$GPRMB` over UDP (`main/autopilotudp.go`) | **Partner app** |
| IFR coupled approaches | ✓ with IFR navigator | ✓ | ? | ? | ✗ | ✗ | **Partner app** |
| Autopilot servos with level button and envelope protection | ✓ ESP | ✓ | ✓ built-in, MGL servos | ◐ separate product | ✗ | ◐ guidance to an external autopilot | **Autopilot integration:** Garmin (CAN / NMEA), Dynon |
| ADS-B Out / transponder control | ✓ | ✓ | ? | ? | ✗ | ✗ OGN transmit via T-Beam only | Out of scope |

### Where RB-01 is ahead

| Feature | G3X | SkyView | MGL | Kanardia | Stratux | RB-01 today |
|---|---|---|---|---|---|---|
| ADS-B 1090 and UAT receivers built in | ◐ separate module | ◐ SV-ADSB-472 module | ? | ? | ✓ | ✓ |
| FLARM / OGN traffic built in | ◐ via FLARM's TIS adapter | ? | ? | ? | ✓ | ✓ `ogn-rx-eu`, OGN transmit via T-Beam |
| AIS vessel traffic | ✗ | ✗ | ? | ? | ✓ | ✓ `rtl-ais` |
| Any browser or tablet as a display, GDL90 to EFB apps | ◐ via Garmin Pilot | ? | ? | ? | ✓ | ✓ |
| Open source (AGPL-3 and commercial), price | ✗ | ✗ | ✗ | ✗ | ✓ free | ✓ RB-01 €2,500 |

## Implementation priorities

Only the gaps that fall to RB-01. Ranking rule, in order: **safety value** for a supplemental
display (RB-SYS-SYS-010/020: the pilot is told, not left to notice); **market expectation**
(every EFIS competitor has it); **cost**, lowest when the data and assets are already in
RB-01; **no new hardware**.

| Rank | Feature | Why | Already in RB-01 | Work | Effort | Priority |
|---|---|---|---|---|---|---|
| 1 | **Voice callouts wired to events**, engine limit alerts included | Standard on G3X, SkyView and MGL. RB-01's alerts today are almost all system failures; none tell the pilot about the aircraft. Ranks 2 and 3 speak through it. | 68 Italian callout texts; `services/servicealerts.js`, `servicebuzzer.js`, `servicevoice.js`; all inputs (AGL from the terrain grid, bank, IAS vs arcs in `aircraft.json`, EMS limits in `ems.json`, traffic) | Trigger logic with hysteresis in `services/servicesituation.js` / `serviceems.js`; event Ids; English texts; a setting to mute each group | S | **P1** |
| 2 | **Engine-out glide help** | Garmin's headline safety feature (Smart Glide, a glide ring that accounts for terrain); none of the EU peers is confirmed to have it. | `db.airfields.json`, the elevations grid, `directToNearest`, wind estimator, `$GPRMB` guidance | Best-glide speed and ratio in `aircraft.json`; reach corrected for wind and terrain; glide ring on map and SV; "best field" list; one-tap direct-to | M | **P1** |
| 3 | **Spoken terrain alerts** | G3X and MGL (TAWS) announce terrain; RB-01 only colours it. | Elevations grid, SV TAWS colour logic, 2D overlay clearance logic | Forward-looking clearance check along the predicted path; "terrain ahead" / "pull up" through rank 1; inhibit near the destination field. Obstacle alerts stay with the partner app | M | **P1** |
| 4 | Flight path marker | Standard on G3X and SkyView; the Oct 3 attitude gap list. | Drift angle, VS and GS | Draw on attitude and SV | S | P2 |
| 5 | Selected altitude bug and altitude alerting | Standard; pairs with the QNH readout already shipped. | Autopilot target altitude | Bug on the altitude tape, ±200 ft alert through rank 1 | S | P2 |
| 6 | Airspeed and altitude trend vectors | Standard; same pattern as the turn-rate trend. | `SixPackInstruments.js` turn trend | Two 6-second trend bars | S | P2 |
| 7 | Fuel computer | Every competitor with an EMS has one; range ring is a planning safety net. | Fuel level and pressure from the EMS | Fuel flow in `$RBEMS` (rb-ems-go, cross-repo), totaliser, endurance, range ring, fuel at destination | M | P2 |
| 8 | AOA and stall warning | G3X, SkyView, MGL. | Differential pressure sensor path in `main/airspeed.go` | Needs an AOA probe and a second pressure port: hardware first | L | P3 |

**Out of scope for now:** ADS-B Out and transponder control (a hardware product, not RB-01
software work).

**Not in this table:** internal quality work that is already under way, such as integrating
the INS AHRS engine.

## Decision

Agreed 2026-10-31: build **rank 1, voice callouts** first (engine limit alerts come with
them), then **rank 2, glide help** and **rank 3, terrain warnings**. Airspace alerts are not
built in RB-01: the partner app provides them.

## Sources

- Garmin G3X Touch Pilot's Guide 190-01754-00 (terrain alerts, glide range ring, weight and
  balance): <https://static.garmin.com/pumac/190-01754-00_y.pdf>
- Garmin Smart Glide on G3X Touch: <https://www.asdnews.com/news/aviation/2022/01/12/garmin-smart-glide-now-available-g3x-touch-flight-display-g5-electronic-flight-instrument-certified-aircraft>
- Garmin ESP-X for G3X: <https://www.kitplanes.com/garmin-brings-esp-x-to-experimental-and-light-sport-aircraft/>
- FLARM Garmin TIS interface: <https://shop.flarm.com/shop/garmin-tis-interface>
- Dynon order form 04/2026 (autopilot, ADS-B Out): <https://dynonavionics.com/downloads/order_form-042026.pdf>
- Dynon SkyView HDX IFR package: <https://avweb.com/aviation-news/dynon-expands-skyview-hdx-ifr-package/>
- MGL iEFIS (synthetic vision, TAWS, AOA, voice alerts, autopilot, video): <https://www.mglavionics.co.za/iEFIS.htm>
- Kanardia Nesis: <https://www.kanardia.eu/>, <https://www.airframer.com/product/1052-nesis>
- GRT, experimental only: <https://www.kitplanes.com/grand-rapids-hxr-debuts-at-snf/>
