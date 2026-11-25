# Creating `performance.json`

For whoever sets the performance page up for an aircraft: an owner, an installer or a
developer. The file holds the aircraft's trained reference (what 100 % means), the
steady-flight detector thresholds, and the list of indicators the page shows.

**Normally you do not write it by hand.** `tools/performance/perf_train.py` writes it from
recorded flights ([training-from-sqlite.md](training-from-sqlite.md)), and you then edit
the labels, weights and bands. This page explains every key, so you can read what the
trainer wrote or set the file up before you have flights.

## Where it lives

The page tries two places, in order:

1. `/settings/performance.json`: on an RB-01 that is `/boot/firmware/rb/performance.json`
   (the settings folder on the boot partition, `web/settings/` in the repository). **Put the
   aircraft's own training here.** It is kept across software updates.
2. `RB-01/settings/performance.json` (`web/RB-01/settings/` in the repository): the sample
   shipped with the software, trained on I-RVDX. An update overwrites it.

After copying a new file, reload the page (or restart the display). The engine starts again
from it, and the KPIs collect again from the next steady segment.

```sh
scp performance.json pi@192.168.10.1:/boot/firmware/rb/performance.json
```

## Smallest useful file

With no training at all, the untrained indicators read UNTRAINED, while DENSITY (OAT and
baro) and ICING (the icing probes) work from formulas:

```json
{
    "version": 1,
    "aircraft": "X-ABCD",
    "indicators": [
        { "id": "density", "label": "DENSITY" },
        { "id": "icing", "label": "ICING" },
        { "id": "cruise", "label": "CRUISE" }
    ]
}
```

## Top level

| Key | Type | Meaning |
|---|---|---|
| `version` | 1 | File format. |
| `aircraft` | text | Registration, shown in the footnote. |
| `notes` | text | Free text: what the training covers and what it does not. |
| `trainedAt`, `trainedFrom`, `trainedSpeedSource`, `engineVersion` | | Written by the trainer. `trainedAt` is shown in the footnote, and the page reads UNTRAINED there without it. |
| `detector` | object | Steady segment thresholds (below). Missing keys take the defaults. |
| `display` | object | Scale, bands, smoothing and expiry (below). |
| `overall` | object | `enabled` (default true), `label` (default "OVERALL"), `minIndicators` (default 2: valid KPIs needed for an OVERALL), `bands`. |
| `plugins` | list of paths | Extra algorithm scripts to load first (professional-algorithms.md). |
| `indicators` | list | The rows of the page, in order (below). |

## `detector`

These thresholds decide what counts as steady flight. **The trainer and the page must use
the same ones**: the trainer reads them from the file it updates, so change them there and
retrain.

| Key | Default | Meaning |
|---|---|---|
| `samplePeriodS` | 1 | Seconds between kept samples (the flight log rate). |
| `windowS` | 20 | Length of a steady segment, in seconds. |
| `minFill` | 0.7 | Fraction of the window that must hold samples. |
| `minSpeedKt` | 50 | Airborne above this. Set it above your stall speed. |
| `maxRollDeg` | 8 | Wings level. |
| `maxGDev` | 0.15 | No manoeuvre: \|G − 1\| at most this. |
| `maxSpeedStdKt` | 3 | Steady speed. |
| `maxRpmTrend` | 50 | No throttle movement: the RPM change across the window. |
| `levelVsFpm` | 150 | A level segment: \|mean vertical speed\| at most this. |
| `maxVsStdFpm` | 250 | Turbulence limit for a level segment. |
| `climbVsFpm` | 300 | A climb segment: mean vertical speed at least this. |
| `climbMinRpm` | 0 | Full power: RPM at least this (0 = not checked). **Set it for ENGINE**, a little below your full-throttle climb RPM. |
| `climbMinMapInHg` | 0 | Full power: MAP at least this (0 = not checked). |
| `emsStaleS` | 5 | Ignore an EMS value older than this (in training). |

## `display`

| Key | Default | Meaning |
|---|---|---|
| `scaleMin`, `scaleMax` | 50, 130 | The bar's ends, in %. 100 is drawn as a white line. |
| `bands` | red 0–70, yellow 70–90, green 90–200 | Colours of the strip and of the value box. Allowed colours: `green`, `yellow`, `red`, `white`. The most severe wins on overlap. |
| `smoothing` | 0.5 | Weight of a new segment in the running KPI (1 = no smoothing). |
| `fadeS` | 300 | Draw a KPI dimmed when its last measurement is older than this. |
| `holdS` | 1800 | Withdraw it (EXPIRED) when older than this. |

## `indicators`

Every entry has:

| Key | Meaning |
|---|---|
| `id` | Which KPI. For `rb-open`: `cruise`, `attitude`, `climb`, `engine`, `fuel`, `density`, `icing`. |
| `label` | The row label (keep it short: about 9 characters fit on the round panel). |
| `algorithm` | `rb-open` (default), `ems` (a KPI another process posts) or a plugin's id. |
| `weight` | Weight in OVERALL (default 1; 0 = shown, not counted). |
| `enabled` | `false` hides the row without deleting it. |
| `bands` | Per-indicator bands, instead of `display.bands`. |
| `smoothing` | Per-indicator smoothing, instead of `display.smoothing`. |

### The `model` of `cruise`, `attitude`, `climb`, `engine`

A linear model of one segment field (`target`), from other segment fields (`features`):

```json
"model": {
    "target": "tasKt",
    "features": ["rpm", "vsFpm"],
    "intercept": -49.457,
    "coef": [0.0904, -0.0184],
    "range": { "rpm": [1608, 2265], "vsFpm": [-148, 150] },
    "rangeMargin": 0.15,
    "n": 65, "rmse": 4.94, "r2": 0.92, "meanTarget": 146.2
}
```

Expected value = `intercept + Σ coef[i] × feature[i]`. In the example, at 2200 rpm in level
flight: −49.46 + 0.0904 × 2200 = 149.4 kt TAS.

- `range`: the trained span of each feature. Beyond it, widened by `rangeMargin` × its
  width, the KPI reads OUT OF RANGE and gives no value.
- `n`, `rmse`, `r2`, `meanTarget` are for you: how many segments were used, and the scatter
  of a single segment around the model. `rmse / meanTarget` is roughly the noise of one
  reading in %.
- `prior` appears when the trainer could not fit and used physics instead (below).

The features a model can use are the fields of a segment: `rpm`, `mapInHg`, `vsFpm`,
`iasKt`, `easKt`, `tasKt`, `densityAltFt`, `pressureAltFt`, `oatC`, `invEas2` = (100/EAS)²,
`fuelFlow`.

| KPI | target | Default features | KPI = |
|---|---|---|---|
| `cruise` | `tasKt` | `rpm`, `vsFpm` (+ `mapInHg` when logged) | 100 × TAS / expected |
| `attitude` | `aoaPitchDeg` (pitch − path angle) | `invEas2` | 100 × aoaRef / (aoaRef + pitch − expected) |
| `climb` | `vsFpm` | `rpm`, `iasKt`, `densityAltFt` | 100 × VS / expected |
| `engine` | `rpm` | `iasKt`, `densityAltFt` | 100 × (RPM / expected)³ |

When the segments cannot support a fit, the trainer falls back on physics:

- **cruise**: a fixed-pitch propeller flies at a constant advance ratio, so TAS is
  proportional to RPM through the mean point.
- **attitude**: with too narrow a speed range the angle of attack cannot be separated from
  the AHRS mounting offset, so the trainer assumes `aoaRefDeg` at the mean speed.

### Extra keys per indicator

| Indicator | Key | Default | Meaning |
|---|---|---|---|
| `attitude` | `aoaRefDeg` | 4 | Cruise angle of attack, used when the training cannot separate it. |
| | `minAoaDeg` | 2.5 | Lower bound of aoaRef. It stops a fast cruise (small AoA) from turning 0.2° of AHRS noise into 10 %. |
| | `referenceMassKg` | none | Mass during training. With it, the row shows the estimated mass ≈ referenceMassKg × 100 / KPI. |
| `fuel` | `egtSpreadRefC`, `egtSpreadTolC` | trained | EGT spread (hottest − coldest cylinder) that is normal, and the excess over it that reads 0 %. |
| | `rpmJitterRef`, `rpmJitterTol` | trained | The same for the second-to-second RPM jitter. |
| | `fuelPressureJitterRef`, `fuelPressureJitterTol` | trained | The same for fuel pressure, when logged. |
| `icing` | `carbWeight` | 1 | Weight of the carburettor risk. Set 0 for a fuel-injected engine. |
| `ems` (any id) | `source` | | The EMS key holding the KPI. |
| | `heartbeat`, `staleS` | none, 10 | An EMS counter the process bumps every second, and NO DATA once it stops for `staleS`. |
| | `detail` | "" | Text shown under the bar. |

FUEL combines its symptoms as 100 × (1 − (2 × worst + mean) / 3), each symptom being
(value − ref) / tol clamped to 0…1. The worst symptom counts double, so one bad cylinder is
enough to turn the row yellow.

## Checking a file

```sh
node -e "const p=require('./web/RB-01/js/perfengine.js'); const c=require('./web/settings/performance.json'); \
  const e=new p.PerformanceEngine(c); console.log(e.kpis().map(k=>k.id+' '+k.status).join('\n'))"
python3 tools/performance/perf_train.py --out web/settings/performance.json --evaluate my-last-flight.sqlite
```

The first prints every indicator. An algorithm that is not installed shows NO ALGORITHM.
The second (no training logs, only `--evaluate`) runs the file over a flight and prints the
KPI medians, which should be about 100 on a normal flight.
