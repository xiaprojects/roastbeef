# Training `performance.json` from recorded flights

For owners and developers who train the performance reference of an aircraft from its
RB-01 flight logs. It covers what a log holds, how to choose flights, the training command,
and routines for looking at the data yourself. Every output shown below is real: I-RVDX,
autumn 2026, the logs in `test-data/`.

Requirements: Python 3 with numpy, and Node.js (the trainer runs the HMI's own engine,
`web/RB-01/js/perfengine.js`, through `tools/performance/perfrun.js`).

## 1. What a flight log holds

RB-01 records every flight into an sqlite file: `flightlog-<date>.sqlite` on the unit, and
in the RB-Cloud upload. The performance tools read three tables:

| Table | Rows | Used columns |
|---|---|---|
| `timestamp` | one per 0.1–0.2 s | `id`, `StratuxClock_value` (the daemon clock: monotonic, never jumps with the GPS) |
| `mySituation` | about one per second | `timestamp_id`, `IndicatedAirSpeed` (kt, 0 = no airspeed board), `GPSGroundSpeed` (kt), `GPSTrueCourse`, `AHRSPitch`, `AHRSRoll`, `AHRSGLoad`, `BaroVerticalSpeed` (ft/min), `BaroPressureAltitude` (ft) |
| `ems` | one per changed value | `timestamp_id`, `SensorName`, `SensorValue`: long format, one row per probe. `enginerpm`, `egt1..`, `cht1..`, `outsidetemperature`, `manifoldpressure`, `fuelpressure`, `fuelflow`, `icing_carb`, `icing_airframe`, and any `perf_*` KPI an algorithm posted |

`timestamp_id` links the tables. An EMS value holds until its next row, so a situation row
takes the latest EMS row at or before its own `timestamp_id`.

**A quick look in plain SQL** (cruise speed per RPM band, level flight):

```python
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
rows = db.execute("""
WITH rpm AS (
  SELECT timestamp_id AS tid, SensorValue AS rpm FROM ems WHERE SensorName = 'enginerpm'
)
SELECT s.timestamp_id,
       s.IndicatedAirSpeed  AS ias_kt,
       s.AHRSPitch          AS pitch_deg,
       s.BaroVerticalSpeed  AS vs_fpm,
       s.BaroPressureAltitude AS pa_ft,
       (SELECT rpm FROM rpm WHERE rpm.tid <= s.timestamp_id ORDER BY rpm.tid DESC LIMIT 1) AS rpm
FROM mySituation s
WHERE s.IndicatedAirSpeed > 60
  AND ABS(s.BaroVerticalSpeed) < 100
  AND ABS(s.AHRSRoll) < 5
""").fetchall()
print(len(rows), "level seconds")
by = {}
for _, ias, pitch, vs, pa, rpm in rows:
    if rpm:
        by.setdefault(int(rpm // 50 * 50), []).append(ias)
for k in sorted(by):
    v = by[k]
    if len(v) >= 10:
        print("%4d rpm  IAS %5.1f kt  (%d s)" % (k, sum(v) / len(v), len(v)))
```

```
$ python3 quicklook.py test-data/flightlog-20261025101548.0171.sqlite
628 level seconds
2100 rpm  IAS 139.8 kt  (24 s)
2150 rpm  IAS 142.3 kt  (447 s)
2200 rpm  IAS 145.0 kt  (150 s)
```

This is good for a first look, not for training. Single seconds are noisy, and the query
does not check that the speed and power were steady. The trainer works on 20 s steady
segments instead.

## 2. Choosing flights

Train on flights that are **normal for this aircraft**: usual load, clean airframe,
healthy engine, no icing. They become the 100 %. Check what each log contains:

```python
import glob, sqlite3

def count(db, sql):
    try:
        return db.execute(sql).fetchone()[0]
    except sqlite3.OperationalError:      # an older log without the column
        return 0

for path in sorted(glob.glob("test-data/flightlog-2026*.sqlite")):
    db = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    airborne = count(db, "select count(*) from mySituation where GPSGroundSpeed > 50")
    if airborne < 300:
        continue                           # under 5 airborne minutes: skip
    ias = count(db, "select count(*) from mySituation where IndicatedAirSpeed > 50")
    rpm = count(db, "select count(*) from ems where SensorName = 'enginerpm' and SensorValue > 1500")
    oat = count(db, "select count(*) from ems where SensorName = 'outsidetemperature' and SensorValue between -40 and 50")
    egt = count(db, "select count(distinct SensorName) from ems where SensorName like 'egt%'")
    print("%-40s %5d s airborne  IAS %-3s RPM %-3s OAT %-3s EGT x%d" % (
        path.split("/")[-1], airborne, "yes" if ias > 0.5 * airborne else "no",
        "yes" if rpm else "no", "yes" if oat else "no", egt))
```

```
flightlog-20260905080041.0478.sqlite      3482 s airborne  IAS no  RPM yes OAT yes EGT x3
flightlog-20260905161524.0768.sqlite      3957 s airborne  IAS no  RPM yes OAT yes EGT x3
flightlog-20260913111200.0341.sqlite      2429 s airborne  IAS no  RPM yes OAT yes EGT x3
flightlog-20260927175640.0159.sqlite       512 s airborne  IAS yes RPM yes OAT yes EGT x3
flightlog-20261017161040.0001.sqlite       841 s airborne  IAS yes RPM yes OAT yes EGT x3
flightlog-20261017165832.0128.sqlite      1007 s airborne  IAS yes RPM yes OAT yes EGT x3
flightlog-20261025101548.0171.sqlite      2020 s airborne  IAS yes RPM yes OAT yes EGT x3
flightlog-20261025133703.0927.sqlite      2191 s airborne  IAS yes RPM yes OAT yes EGT x3
```

Rules of thumb:

- **One airspeed source.** The September logs predate the airspeed board: their speed is
  ground speed, biased by the wind. The trainer keeps the most common source (here IAS) and
  says what it dropped. Without an airspeed board at all, fly out-and-back legs so the wind
  averages out.
- **Keep one flight out** to check the result on (`--evaluate`). Here: the 10-25 afternoon
  flight.
- **The flight should vary what the models use.** Cruise at two or three power settings,
  and some steady climbs. For ENGINE, include full-throttle climbs of at least 30 s each.
- **The configuration must not change** within the training set: the same propeller, the
  same AHRS mounting and calibration, the same airspeed calibration. A recalibrated AHRS
  shifts every pitch reading, so retrain after one.

## 3. Training

```sh
python3 tools/performance/perf_train.py \
    --aircraft I-RVDX \
    --out web/RB-01/settings/performance.json \
    --segments-out segments.jsonl \
    test-data/flightlog-20260927175640.0159.sqlite \
    test-data/flightlog-20261017161040.0001.sqlite \
    test-data/flightlog-20261017165832.0128.sqlite \
    test-data/flightlog-20261025101548.0171.sqlite \
    --evaluate test-data/flightlog-20261025133703.0927.sqlite test-data/flightlog-20261025101548.0171.sqlite
```

```
extracting steady segments:
  flightlog-20260927175640.0159.sqlite: 2 segments
  flightlog-20261017161040.0001.sqlite: 11 segments
  flightlog-20261017165832.0128.sqlite: 8 segments
  flightlog-20261025101548.0171.sqlite: 54 segments
training on 63 level and 12 climb segments
  cruise    tasKt ~ rpm + vsFpm, n=61 (2 outliers left out), rmse=1.0457, r2=0.9875, one segment ±0.7 %
  attitude  aoaPitchDeg ~ invEas2, n=63 (0 outliers left out), rmse=0.5944, r2=0.2152, one segment ±13.5 %
  climb     vsFpm ~ rpm + iasKt, n=12 (0 outliers left out), rmse=155.5608, r2=0.6447, one segment ±26.4 %
  engine    rpm ~ iasKt + densityAltFt, n=12 (0 outliers left out), rmse=25.0999, r2=0.8284, one segment ±1.2 %
  fuel      EGT spread ref 14.906 tol 40.0, RPM jitter ref 4.796 tol 30.0, fuel pressure not logged
wrote web/RB-01/settings/performance.json
evaluate flightlog-20261025133703.0927.sqlite (41 segments):
  density   median  100  (min 99, max 101, 84 readings)
  overall   median   92  (min 82, max 97, 71 readings)
  cruise    median  102  (min 99, max 102, 71 readings)
  attitude  median   85  (min 51, max 100, 71 readings)
  fuel      median   99  (min 90, max 100, 71 readings)
  climb     median   84  (min 59, max 89, 64 readings)
  engine    median  103  (min 94, max 103, 64 readings)
evaluate flightlog-20261025101548.0171.sqlite (54 segments):
  ...
  cruise    median  100  (min 99, max 101, 62 readings)
```

What it does:

1. `perf_extract.py` turns each log into one sample per second: the same object the HMI
   builds live.
2. `perfrun.js segments` runs the samples through the HMI's detector and prints the steady
   segments. The trainer uses the `detector` thresholds of the file it updates (`--out`, or
   `--base`).
3. numpy fits each model by least squares, then once more without the segments more than 3
   robust σ off. A model drops features from the end of its list when there are fewer than
   4 segments per parameter, and falls back on physics when it cannot fit at all (see
   performance-json.md).
4. Everything else in the file is kept: labels, weights, bands, `referenceMassKg`, notes.
   Retraining never loses your edits.

**Reading the report:**

- **One segment ±x %** is the noise of a single reading. A KPI moves by its smoothing per
  segment, so the displayed value is steadier.
- **CRUISE ±0.7 %** with r² 0.99: TAS ≈ 3.3 + 0.0665 × RPM. The intercept is close to zero,
  which is the constant advance ratio of a fixed-pitch propeller. The data agrees with the
  physics.
- **ATTITUDE ±13.5 %, r² 0.22**: the AHRS pitch scatters 0.6° from segment to segment on
  this unit (internal AHRS), and the speed range above 70 kt is narrow. This indicator gets
  better with a better attitude source and with slower level segments (clean, above the
  flap speed).
- **CLIMB and ENGINE, 12 segments**: too few, and nothing says the climbs were at full
  throttle. They are kept, but treat them as low confidence until you train on proper
  climbs with `detector.climbMinRpm` set.
- **The held-out flight**: CRUISE 102 and FUEL 99 (normal), but ATTITUDE 85 and CLIMB 84. A
  heavier aircraft reads exactly like that: more angle of attack, less climb, cruise speed
  almost unchanged. So does a different AHRS offset after a reboot. The logs cannot tell
  which, because the takeoff mass is not recorded. This is why `referenceMassKg` and a
  logged loading matter.

## 4. Looking at the segments yourself

`--segments-out` writes every steady segment as JSON lines. Each holds the means and
spreads the models use (`tasKt`, `easKt`, `rpm`, `rpmJitter`, `aoaPitchDeg`, `invEas2`,
`vsFpm`, `densityAltFt`, `egtSpreadC`, ...) and the `log` it came from.

```python
import json
import numpy as np

segs = [json.loads(l) for l in open("segments.jsonl")]
level = [s for s in segs if s["phase"] == "level" and s["rpm"]]

# Cruise speed per 100 rpm band
bands = {}
for s in level:
    bands.setdefault(int(s["rpm"] // 100 * 100), []).append(s["tasKt"])
for rpm in sorted(bands):
    v = np.array(bands[rpm])
    print("%d-%d rpm  TAS %5.1f kt ± %.1f  (%d segments)" % (rpm, rpm + 99, v.mean(), v.std(), len(v)))

# Pitch against speed: the attitude model in two numbers
x = np.array([s["invEas2"] for s in level])
y = np.array([s["aoaPitchDeg"] for s in level])
b, a = np.polyfit(x, y, 1)
print("pitch - path = %.2f + %.2f x (100/EAS)^2   -> AoA term at 140 kt: %.2f deg" % (a, b, b * (100 / 140) ** 2))

# Normal EGT spread and RPM roughness
print("EGT spread p50 %.0f p90 %.0f C" % tuple(np.percentile([s["egtSpreadC"] for s in segs if s["egtSpreadC"]], [50, 90])))
print("RPM jitter p50 %.1f p90 %.1f rpm" % tuple(np.percentile([s["rpmJitter"] for s in segs if s["rpmJitter"]], [50, 90])))
```

Output from the I-RVDX segments, run before the 70 kt floor was set:

```
1300-1399 rpm  TAS  56.9 kt ± 0.0  (1 segments)
1400-1499 rpm  TAS 101.4 kt ± 0.9  (2 segments)
1500-1599 rpm  TAS  62.7 kt ± 0.0  (1 segments)
2100-2199 rpm  TAS 147.6 kt ± 2.5  (42 segments)
2200-2299 rpm  TAS 152.5 kt ± 2.7  (17 segments)
2300-2399 rpm  TAS 162.0 kt ± 0.1  (2 segments)
pitch - path = -5.88 + 2.96 x (100/EAS)^2   -> AoA term at 140 kt: 1.51 deg
EGT spread p50 13 p90 18 C
RPM jitter p50 4.4 p90 5.8 rpm
```

The 57 and 63 kt "level" segments at 1300–1500 rpm are slow flight, probably with flaps:
different drag and different pitch. That is why the sample now sets
`detector.minSpeedKt: 70`, and why the trainer leaves outliers out. **Look at the segments
before trusting a fit.**

## 5. The KPIs over a whole flight

```sh
python3 tools/performance/perf_extract.py test-data/flightlog-20261025133703.0927.sqlite > samples.jsonl
node tools/performance/perfrun.js kpis web/RB-01/settings/performance.json --every 300 < samples.jsonl
```

This prints one JSON line every 300 s of flight, with each KPI's value or its status
(WAIT LEVEL, OUT OF RANGE...), then a summary line with min, median and max. Load the lines
into a spreadsheet or pandas to plot a flight.

## 6. Recipes

**Set `climbMinRpm` from the data** (for ENGINE). Look at the RPM of your strongest climbs:

```python
import json, numpy as np
climbs = [json.loads(l) for l in open("segments.jsonl")]
climbs = [s for s in climbs if s["phase"] == "climb" and s["vsFpm"] > 600 and s["rpm"]]
print("full power climbs: rpm p10 %.0f, median %.0f" % tuple(np.percentile([s["rpm"] for s in climbs], [10, 50])))
```

Put about the p10 value into `detector.climbMinRpm` and retrain.

**Reference mass.** Write the training flights' mass into the attitude indicator:
`"referenceMassKg": 720`. The ATTITUDE row then shows the estimated mass of today's flight.

**After maintenance** (a new propeller, an engine overhaul, re-rigging): train again on
flights after the work. Keep the old file to compare: run `--evaluate` with the old file on
a new flight to see what changed, in %.

**No airspeed board.** Train with `--speed-source GS` on flights with legs in opposite
directions. The rows show `GS ·` when they were measured on ground speed.

**Fuel injection.** Set `"carbWeight": 0` on ICING. Fuel pressure jitter is trained as soon
as `fuelpressure` is in the logs.

**Constant-speed propeller.** CRUISE needs `mapInHg`. The trainer adds it when the log has
`manifoldpressure`, and without it the cruise model cannot work.

## 7. Pitfalls seen in real logs

- **Broken OAT probe**: I-RVDX logs hold `outsidetemperature` values up to 950 °C (an open
  thermocouple). Values outside −60…60 °C are dropped, so DENSITY reads NO OAT then.
- **Airspeed calibration changes**: a re-zeroed or rescaled pitot moves every IAS. Do not
  mix flights from before and after.
- **The AHRS pitch offset**: the internal AHRS of I-RVDX reads about 4° nose-low in cruise.
  Training absorbs a constant offset, but not one that changes between flights.
- **`GPSVerticalSpeed` is 0** on RB-01 logs. The tools use `BaroVerticalSpeed`.
- **Restarts inside a log**: the daemon clock starts again, and the extractor starts its
  EMS memory again with it.
