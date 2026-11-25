# Pre-installation measurements and calibration pass criteria

Status (2026-11-24): **procedure written, limits not yet measured.** Asked by the owner on
2026-11-24 in reply to the manual questions *Pass limits* (attitude, altitude, heading,
vibration, SDR ppm) and **Q-01B-31ac4** (validated pass criteria and tolerances for the
calibration checks of RB-01-B chapter 7).

The repository has no measured tolerance for a reference RB-01. This page says **how to
measure** each value on the bench, before the unit goes into an aircraft, and which limit to
apply. **Where RB-Avionics has not published a limit, apply the datasheet of the part fitted
in the unit** (the datasheet accuracy, converted to the unit shown on the display). Record
every result in the unit's installation record; the same numbers become the reference for the
annual checks.

## 0. Before starting

- Unit powered from its final supply (or a bench supply of the same rating), with the Pi 5
  Active Cooler fitted. Run it for **15 minutes** first so the sensors reach working
  temperature; read `CPUTemp` in `GET /getStatus` and note it.
- `vcgencmd get_throttled` must read `throttled=0x0` (no under-voltage, no throttling) for the
  whole session. rb-sysmon raises an `UNDERVOLTAGE` alert if it does not (see RB-01-B 9).
- Note the datasheet of each sensor actually fitted: `GET /getStatus` gives `IMUConnected`,
  `BMPConnected`, `AirspeedConnected`; the daemon log names the chip it found.
- Tools: a digital inclinometer (0.1° resolution or better), a reference barometer or the
  current airport QNH and a known elevation, a compass rose or a surveyed line (for the
  heading), a laptop on the RB-01 Wi-Fi, `curl` and `jq`.

Read values with:

```sh
curl -s http://192.168.10.1/getSituation | jq '{AHRSRoll,AHRSPitch,AHRSGyroHeading,AHRSMagHeading,BaroPressureAltitude,IndicatedAirSpeed,PitotPressure}'
```

Take **10 readings, 1 s apart** for each point, and record the mean and the spread
(max − min). Pass = |mean error| within the limit **and** spread within the limit.

## 1. Attitude (roll, pitch)

1. Fix the unit (or the IMU board) on a flat plate. Level the plate with the inclinometer to
   0.0° in both axes.
2. Check the mounting in Settings → AHRS (`IMUMapping`, forward axis), then cage
   (Switchboard `ACC CGE`, or `POST /cageAHRS`).
3. Read roll and pitch: both must be 0 within the limit.
4. Tilt the plate to +10° and −10° in pitch, then in roll, read the inclinometer and the
   unit at each point. The error is unit − inclinometer.
5. Leave it still for 10 minutes at 0°: the drift is the change of the mean.

**Limit:** RB-01-B 7.1 recommends **1°** at the reference attitude. Where the fitted IMU
datasheet gives a larger accelerometer zero-g offset (converted: offset in g × 57.3 = degrees),
the datasheet value applies until RB-Avionics publishes a measured one. Add the inclinometer
accuracy to the limit.

## 2. Altitude (barometric)

1. At a place with known elevation, with the current QNH (airport METAR, or a reference
   barometer).
2. Reference pressure altitude = elevation + (1013.25 − QNH) × 27 ft (the 27 ft/hPa the
   display uses).
3. Read `BaroPressureAltitude` (feet). Error = unit − reference.
4. If a static source is connected, also check it does not leak: a small suction on the static
   port must give a steady altitude for 1 minute.

**Limit:** the datasheet absolute accuracy of the fitted sensor, converted at 27 ft/hPa, plus
the reference uncertainty. For example **BMP388 / BMP390 ±0.5 hPa ≈ ±14 ft**, **BMP280 ±1 hPa
≈ ±27 ft** (Bosch datasheets; check the edition and the temperature range). RB-01-B 7.4
recommends **100 ft**, which also covers a QNH that is a few hours old. A fixed error can be
removed with `AltitudeOffset`; record it.

## 3. Heading (magnetometer, if fitted)

1. Away from steel and cables (not on a workbench), on a compass rose or a surveyed line with
   known magnetic heading.
2. Calibrate first: magnetometer add-on, `CALIBRATE`, rotate the unit on every axis, then
   `STOP & STORE`. In `CALIBRATED` mode the trail must stay on the unit sphere.
3. Read `AHRSMagHeading` at **8 headings** (every 45°), unit held level.
4. Error = unit − known heading at each point.

**Limit:** RB-01-B 7.5 recommends **5°** on the ground. The magnetometer datasheets give no
heading accuracy, so there is no datasheet value to apply: use the 5° until measured. For
reference only, the reference aircraft showed 7° level and 13° banked in flight (residual
9.6°), measured **installed**, where the aircraft's own field adds to the error
(`docs/hardware/sensors.md`). Repeat this check after installation, in the aircraft.

## 4. Vibration

The bench measures the **noise floor**; the limit is checked again in the aircraft with the
engine running (RB-01-B 7.3).

1. Settings: turn on `AHRSLog`. The unit writes `sensors_<time>.csv` once the GPS has a fix
   (place the GPS antenna with sky view).
2. Record 2 minutes with the unit still. In the aircraft, record 1 minute at each engine speed
   used in flight.
3. Download with `http://192.168.10.1/downloadahrslogs`, turn `AHRSLog` off, delete the files
   with `POST /deleteahrslogfiles`.
4. For each record, compute the standard deviation and the peak-to-peak of roll and pitch,
   and of the raw accelerations where the CSV has them.

**Limit:** no published limit. Use the bench record as the reference: with the engine
running, roll and pitch must stay within the attitude limit of section 1, with no drift and
no jumps. Where the fitted IMU datasheet gives a noise density, the bench noise must not
exceed it; a larger value points to a bad sensor or mounting.

## 5. SDR frequency error (ppm)

For each RTL-SDR dongle, one at a time:

1. Stop the daemon: `sudo systemctl stop stratux`.
2. Find a strong GSM base station (`kalibrate-rtl` is built into the image):
   ```sh
   kal -s GSM900            # lists channels and their power
   kal -c <channel>         # prints "average absolute error: <n> ppm"
   ```
   Where no GSM900 is left, use `GSM-R` or `EGSM`, or measure a known carrier with
   `rtl_test -p` for 10 minutes (the last value).
3. Write the value into the dongle with `sudo /opt/stratux/bin/sdr-tool.sh` (the
   `stx:<freq>:<ppm>` serial suffix), or into the `PPM` setting for a single dongle.
4. Start the daemon, check that traffic is received (`/getStatus`, message counters).

**Limit:** the dongle's oscillator datasheet: **±1 ppm** for dongles with a 1 ppm TCXO
(RTL-SDR Blog V3/V4 class). Plain-crystal dongles can be tens of ppm off and drift with
temperature: they are acceptable only with the measured ppm stored in the serial, and
re-measured warm.

## 6. Calibration checks A–E: pass criteria (Q-01B-31ac4)

How to turn the measurements above into the pass criteria of RB-01-B chapter 7. Until
RB-Avionics publishes validated values, the column **Apply** is the rule.

| Check | Measure (above) | Apply | Max attempts |
|---|---|---|---|
| A: Level offset | §1 at the reference attitude | 1° (recommendation), or the IMU datasheet zero-g offset in degrees if larger, plus the inclinometer accuracy | 3 |
| B: Vibration | §4 | Attitude within check A's limit with the engine running, no drift, no jumps; noise not above the IMU datasheet noise density | 3 |
| C: Barometric altitude | §2 | Sensor datasheet absolute accuracy at 27 ft/hPa plus the reference uncertainty; 100 ft maximum | 3 |
| D: Magnetometer | §3, installed | 5° on the ground (no datasheet value exists) | 3 |
| E: Pitot zero | Zero, then read 10 s still | `IndicatedAirSpeed` 0; `PitotPressure` within the 10 Pa dead band; otherwise the MS4525DO datasheet total error band | 3 |
| SDR (installation) | §5 | Oscillator datasheet (±1 ppm TCXO) after correction | — |

How to validate a criterion (for RB-Avionics, once per hardware revision):

1. Run sections 1–5 on at least **three units** of the same build, cold (15 min) and warm
   (1 h), and once more after a week.
2. The criterion is the largest error seen plus a margin (the reference tool's accuracy), but
   never tighter than the datasheet.
3. Publish it in RB-01-C with the hardware revision it applies to, and replace the
   recommendations in RB-01-B 7.1.

A check that fails after the maximum number of attempts makes the installation unreliable:
placard RB-01 INOP and find the cause (RB-01-B 7.1).
