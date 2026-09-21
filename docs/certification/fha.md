# Preliminary Functional Hazard Assessment (FHA) — RB-01

Roadmap Step 3 (`docs/certification/roadmap.md`). ARP4761-style, aircraft-level effects.
**Preliminary**: written by the developers from the code as it is; to be reviewed with a
DER/CVE before it is used to fix DALs. The six PFD instruments and the G-meter are filled
in; the remaining functions have skeleton rows.

Status: draft 2026-09-14.

## 1. Installation assumptions

The classifications below hold only under these assumptions. They become limitations in
the installation manual (roadmap Step 10.4).

| # | Assumption |
|---|---|
| A1 | RB-01 is **supplemental, non-required** equipment. The aircraft's required flight, navigation and engine instruments remain installed and are the primary reference. |
| A2 | Day/night **VFR** operation. The RB-01 is not an approved reference for flight in IMC. |
| A3 | Aircraft class: microlight / ultralight, experimental, or CS-23 / Part 23 Level 1–2 (small, low-speed, single-pilot). |
| A4 | The pilot receives a briefing (manual) on what each display shows — in particular that **"speed" is GPS ground speed, not indicated airspeed**. |
| A5 | No output of the RB-01 is connected to a flight-control system (autopilot servos) or to aircraft electrical loads in the certified configuration (GPIO switchboard and autopilot guidance disabled — roadmap Step 3.2). |
| A6 | Traffic and weather information is advisory ("see and avoid" remains the pilot's responsibility). |

Severity scale (AC 23.1309-1E / AMC 23.1309): **No safety effect · Minor · Major ·
Hazardous · Catastrophic**. Proposed DAL per AC 23.1309-1E Class I–II mapping:
Major → D, Hazardous → C, Catastrophic → C (Class I) / B (Class III).

Failure-condition types used: **Loss** (blank, frozen with an indication, red X);
**HMI** = hazardously misleading information (wrong value, no indication); **Frozen**
(stale value with no indication — a subtype of HMI); **Delayed** (latency above what the
pilot can perceive as current).

## 2. Functional hazard table — PFD instruments

Sources (from `web/RB-01/plates/js/SixPackInstruments.js` and `main/sensors.go`):

| Instrument | Displayed quantity | Sensor / source |
|---|---|---|
| Attitude | `AHRSPitch`, `AHRSRoll` | IMU (ICM-20948 / MPU-9250 family) via AHRS fusion |
| Speed | `IndicatedAirSpeed` labelled `IAS` when a pitot sensor reports one (> 0), else `GPSGroundSpeed` labelled `GS`, on an airspeed-style gauge with per-aircraft colour arcs | MS4525DO pitot-static sensor (zeroed by `POST /calibrateAirspeed`), GPS |
| Altimeter | `BaroPressureAltitude + 27·(QNH − 1013.25)`; `AutoQNH` derives QNH from GPS altitude; `GPSAltitudeMSL` also shown | Baro (BMP388/280) + pilot QNH or GPS |
| Variometer | `BaroVerticalSpeed` | Baro, differentiated |
| Turn / slip | `AHRSTurnRate`, `AHRSSlipSkid` | IMU gyro + accelerometer |
| Heading | `GPSTrueCourse` while `GPSFixQuality > 0`, else `AHRSGyroHeading`; `AHRSMagHeading` optional | GPS, gyro, magnetometer |
| G-meter | `AHRSGLoad` (+ min/max) | IMU accelerometer |

| ID | Function | Failure condition | Phase | Effect on aircraft / crew | Severity | Rationale and mitigations | DAL | Derived requirement candidates |
|---|---|---|---|---|---|---|---|---|
| FHA-ATT-1 | Attitude | Loss (blank / red X) | all | Pilot reverts to required instruments or outside horizon (A1, A2). Slight increase in workload. | Minor | Annunciated loss; VFR. | E→D | Loss shall be annunciated within 1 s (no stale picture). |
| FHA-ATT-2 | Attitude | HMI: wrong pitch/roll, no indication | all, worst in reduced visibility | Pilot may follow a wrong horizon; in VMC contradicted by the outside view and the required instruments; in marginal VMC / night could induce an unusual attitude. | **Major** (Hazardous if A2 is violated) | Under A1/A2 the pilot has an independent reference. Mitigation: IMU self-test, plausibility check vs GPS track rate and vs gravity vector, sensor-invalid sentinel (`3276.7`) rendered as a flag, not as 3276°. | **D** (C if used in IMC) | AHRS invalid sentinel → red X. Roll/pitch plausibility monitor. Attitude update ≥ 10 Hz, latency ≤ 200 ms. |
| FHA-ATT-3 | Attitude | Frozen (stale value) | all | As ATT-2 but more insidious: the picture looks valid. | **Major** | HMI today keeps the last frame with no timeout. Mitigation: stale-data flag when no `/situation` frame for > 1 s; watchdog on the sensor loop. | D | Stale-data flag ≤ 1 s end-to-end (sensor → daemon → HMI). |
| FHA-SPD-1 | Speed | Loss | all | Pilot uses the required ASI. | Minor | — | E→D | Loss annunciated. |
| FHA-SPD-2 | Speed | HMI: ground speed read as airspeed (by design) | approach, slow flight, strong wind | With a 20 kt headwind the gauge under-reads IAS by 20 kt; with a tailwind it over-reads — a pilot flying the coloured arcs on approach could stall. | **Major** | The colour arcs invite an IAS reading. Mitigation: label the gauge **GS** unambiguously; do not draw Vs/Vso arcs unless an airspeed source exists; briefing (A4). | D | Gauge shall be labelled "GS"; arcs disabled unless `sensorType` is an airspeed. |
| FHA-SPD-3 | Speed | HMI: wrong GPS speed, no indication | all | As SPD-2, less likely (GPS speed is robust). | Major | GPS fix quality gating; stale flag. | D | Speed blanked when `GPSFixQuality == 0` or fix age > 2 s. |
| FHA-SPD-4 | Speed | HMI: wrong or frozen IAS from the pitot sensor (unzeroed or drifted offset, blocked/iced pitot or static line, sensor hung on stale data, reboot in flight) | approach, slow flight | As SPD-2 but labelled `IAS`, which the pilot trusts more: a 34 Pa unzeroed offset reads 15 kt on the ground and ~0.5 kt at 100 kt; a blocked pitot freezes or decays the reading; a hung sensor freezes it. | **Major** | The daemon zeroes the airspeed (→ `GS` fallback, annunciated) 1 s after the sensor stops answering (I²C errors, a fault status, or 1 s of stale data), and takes the magnitude so a reversed tube cannot read 0 in flight. The zero offset is persisted, set only at a GPS standstill, and a 10 Pa deadband absorbs its drift. No plausibility check against ground speed yet. | D | IAS blanked (0) within 2 s of sensor loss; zero offset only settable stationary; flag IAS vs GS disagreement > 30 kt outside a plausible wind (derived-requirement candidate). |
| FHA-ALT-1 | Altimeter | Loss | all | Pilot uses the required altimeter. | Minor | — | E→D | Loss annunciated. |
| FHA-ALT-2 | Altimeter | HMI: wrong altitude, no indication (baro fault, wrong QNH, AutoQNH from a poor GPS fix) | cruise, approach, in controlled airspace | Pilot may fly a wrong level; airspace infringement, terrain margin reduced at night. Required altimeter remains (A1). | **Major** | AutoQNH silently replaces the pilot's setting with a GPS-derived one; the source in use must be visible. Baro range/rate plausibility; compare with GPS altitude and flag > 300 ft disagreement. | D | Show QNH source (SET / AUTO); flag baro-vs-GPS disagreement; reject pressure ≤ 0 or out of 300–1100 hPa (see `CalcAltitude` test note). |
| FHA-ALT-3 | Altimeter | Frozen | all | As ALT-2. | Major | Stale flag. | D | Stale-data flag ≤ 1 s. |
| FHA-VSI-1 | Variometer | Loss / HMI | climb, descent, approach | Pilot uses the required VSI; trend misread is a workload issue. | Minor | Cross-checked by altimeter trend. | E→D | — |
| FHA-TRN-1 | Turn / slip | Loss / HMI | turns, all | Uncoordinated flight not shown; a wrong turn indicator in reduced visibility contributes to disorientation. | Minor (Major under A2 violation) | Required turn coordinator/ball remains. | E→D | Invalid sentinel → flag. |
| FHA-HDG-1 | Heading | Loss | all | Pilot uses the required compass. | Minor | — | E→D | Loss annunciated. |
| FHA-HDG-2 | Heading | HMI: source substitution without indication (GPS track ↔ gyro heading ↔ mag heading) | all; worst in crosswind or stationary | Track and heading differ by the drift angle; on the ground GPS track is meaningless. A silent switch to gyro heading (unslaved, drifts) after GPS loss gives a slowly wrong heading. | **Major** | The HMI shows `sourceName` (GPS/GYRO) — keep it prominent; gyro-only heading must be time-limited and flagged. | D | Heading source always displayed; gyro-only heading flagged after 60 s; on the ground (GS < 5 kt) show "---" for GPS track. |
| FHA-G-1 | G-meter | Loss / HMI | manoeuvring | Structural limit exceedance not shown or falsely shown. | Minor | Advisory; pilot feels G. | E | — |

## 3. Functional hazard table — other functions (skeleton)

| ID | Function | Failure condition | Severity (expected) | DAL | Notes |
|---|---|---|---|---|---|
| FHA-ALR-1 | Alerts (stale data, sensor loss, limits, traffic) | Alert missing / false / late | Major / Minor | D | The alert function is what turns several HMI rows above from Major into Minor; it inherits their DAL. Audio path (`alert.wav`, voice) included. |
| FHA-TRF-1 | Traffic display | Missing target | Minor (A6) | D | See-and-avoid remains; TSO-C195b class of function if ever ETSO'd. |
| FHA-TRF-2 | Traffic display | Ghost / wrong position / wrong altitude target | Minor–Major | D | Evasive manoeuvre against a ghost; Mode-S distance estimation is a known approximation. |
| FHA-EMS-1 | Engine display (supplemental) | HMI on a parameter the pilot acts on (CHT, oil pressure, fuel) | Major (Minor if required engine instruments remain, A1) | D | Data arrives from an external probe over `/bridge`; the source's own assurance matters. |
| FHA-SVS-1 | Synthetic vision | Misleading terrain | Major | D | Depends on terrain data quality (DO-200B/DO-276, roadmap Step 9.2). Second baseline. |
| FHA-NAV-1 | HSI / VOR / map | Wrong course guidance | Minor–Major | D | Advisory VFR navigation; second baseline. |
| FHA-WX-1 | Weather (FIS-B) | Stale or wrong product | Minor | D/E | Advisory; product age must be shown. |
| FHA-AP-1 | Autopilot guidance out (`$GPRMB`) | Wrong steering command to a coupled autopilot | Major (Hazardous with a full-authority AP) | C/D | **Scoped out** of the first baseline (A5). |
| FHA-SW-1 | GPIO switchboard | Uncommanded switching of an aircraft load | Major | C/D | **Scoped out** (A5). |
| FHA-SYS-1 | Whole unit | Loss of all functions (power, SD card, crash, reboot) | Minor | — | Required instruments remain; boot time and behaviour on power interruption are derived requirements. |
| FHA-SYS-2 | Whole unit | Interference with other aircraft systems (RF emission, Wi-Fi, power transients) | Major | — | DO-160 §16/§17/§21, roadmap Step 8. |
| FHA-SYS-3 | Whole unit | Distraction / excessive workload (unreadable display, spurious alerts) | Minor | — | Human-factors review of alerts and night mode. |
| FHA-E-1 | Checklist, timers, camera, voice, radio remote, OTA UI, addons, X-Plane, CoT, charts, export | Any | No safety effect | E | Must be shown not to interfere with the core (partitioning, roadmap Step 7). |

## 4. Items to resolve in the review

1. Confirm A2 (VFR only) is acceptable to the target market; if any customer will use the
   attitude display in IMC, FHA-ATT-2/3 become Hazardous and the core becomes DAL C.
2. Decide whether FHA-SPD-2 is mitigated by labelling alone or by removing the airspeed
   look (arcs) from a ground-speed gauge.
3. The alert function (FHA-ALR-1) is the linchpin of most mitigations; it must be inside
   the core and have its own requirements first (roadmap Step 4).
4. Agree the DAL mapping table with the DER/CVE (Class I/II vs the post-2017 Part 23
   Level 1–4 / ASTM F3230 language).
