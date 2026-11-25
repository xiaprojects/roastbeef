# Aircraft performance KPIs: implementation

For whoever changes this code (a developer or a coding agent). It says where everything
is, how data flows, which rules the code keeps, and how to check a change. The other
documents in this folder:

| Document | For |
|---|---|
| [features.md](features.md) | the website: what the pilot gets |
| [professional-algorithms.md](professional-algorithms.md) | adding a closed-source algorithm |
| [performance-json.md](performance-json.md) | every key of `performance.json` |
| [training-from-sqlite.md](training-from-sqlite.md) | training from recorded flights, with routines |

## What it does

The page `#/addons/performance` shows a list of KPIs in %. On each one, **100 % is the
aircraft as it was trained** (`performance.json`) and lower is worse. Each KPI is drawn as
a horizontal G-meter. The open reference algorithm `rb-open` produces seven of them:

| KPI | Measured in | Compares | Sees |
|---|---|---|---|
| CRUISE | level segments | TAS against the trained TAS at this RPM (and vertical speed, MAP) | drag: dirty airframe, ice, wheel fairings, a tired engine at fixed throttle |
| ATTITUDE | level segments | pitch minus path angle against the trained pitch at this EAS | the angle of attack the wing needs: weight, CG, ice on the wing |
| CLIMB | climb segments | vertical speed against the trained one at this RPM, IAS, density altitude | weight, engine, propeller |
| ENGINE | climb segments | full-power RPM against the trained one, cubed (fixed pitch power) | power loss |
| FUEL | level and climb segments | EGT spread between cylinders, RPM and fuel pressure jitter against trained levels | dirty fuel, a fouled plug, a blocked injector |
| DENSITY | every second | engine power at today's air against standard air at the same pressure altitude | summer heat (Gagg-Ferrar) |
| ICING | every second | 100 − the icing advisories of `main/icing.go` | carburettor and airframe icing conditions |

OVERALL is the weighted geometric mean of the valid KPIs, so one poor KPI pulls it down.

## Files

| File | Role |
|---|---|
| `web/RB-01/js/perfengine.js` | The engine. It is pure: no Angular, no DOM, no clock. It holds the detector, the algorithm registry, `rb-open`, the `ems` bridge algorithm and the KPI list. It loads in the HMI (`index.html`, `simulator.html`) and in Node (`module.exports`). |
| `web/RB-01/addons/performance.html`, `.css`, `addons/js/performance.js` | The page. The JS also holds `window.performanceService`, which feeds the engine **from boot**, not only while the page is open. |
| `web/RB-01/settings/performance.json` | The shipped sample, trained on I-RVDX. |
| `web/settings/performance.json` (on an RB-01: `/boot/firmware/rb/`) | The aircraft's own training. It is optional, is read first, and survives updates. |
| `tools/performance/perf_extract.py` | Flight log (sqlite) → samples, as JSON lines. |
| `tools/performance/perfrun.js` | Runs `perfengine.js` over samples: `segments` or `kpis`. |
| `tools/performance/perf_train.py` | Extract → segments (through `perfrun.js`) → numpy fit → `performance.json`, plus `--evaluate`. |
| `tools/performance/test_perfengine.js` | Engine unit tests (Node, 43 checks). |
| `tools/performance/examples/ems_kpi_sender.py` | Skeleton of an out-of-process (closed-source) algorithm. |
| `test/display/test_performance.py` | The page in Chromium, on the 4 panel sizes (23 checks). |

## Data flow

```
daemon  ──/situation WS──▶ servicesituation.js ──"SituationUpdated"──┐
        ──/ems WS───────▶ serviceems.js ────────"EMSUpdated"─────────┤
                                                                     ▼
                      addons/js/performance.js  window.performanceService
                        perfSampleFromSituation(situation, ems, now)   at most 1 Hz
                                                                     ▼
                      perfengine.js  PerformanceEngine.observe(sample)
                        perfDerive: sigma, density altitude, TAS, EAS, 1/EAS², EGT spread
                        every algorithm.sample(sample)        DENSITY, ICING, statuses
                        PerfSteadyDetector.push → segment?    20 s, level or climb
                        every algorithm.segment(segment)      CRUISE, ATTITUDE, CLIMB, ENGINE, FUEL
                                                                     ▼
                      PerformanceCtrl, once a second: engine.kpis(now) → rows
```

Training follows the same path offline:

```
flightlog.sqlite → perf_extract.py → samples.jsonl → perfrun.js segments → perf_train.py (numpy) → performance.json
```

The live page and the trainer run the **same detector and the same KPI code**. Only the
sample builder is written twice: `perfSampleFromSituation` in JS and `perf_extract.py` in
Python. When you add a sample field, add it to both.

## Engine concepts

**Sample.** One second, normalized: speeds in kt, altitudes in ft, vertical speed in ft/min
(`BaroVerticalSpeed`; `GPSVerticalSpeed` is 0 on RB-01), temperatures in °C. An OAT outside
−60…60 °C is dropped, as in `main/icing.go`. The airspeed comes, in order, from
`IndicatedAirSpeed` ("IAS"), from the ground vector minus the HMI's wind ("WIND"), or from
the ground speed ("GS"). The trainer keeps one source (`trainedSpeedSource`). The page
prefixes a KPI measured on ground speed with `GS ·`.

**Segment.** A 20 s window (`detector.windowS`) that is airborne, wings level, without
manoeuvre, at steady speed and with no throttle movement. RPM roughness is *not* a reason
to reject a window: it is what FUEL measures. Throttle movement is measured as the change
between the first and last third of the window (`maxRpmTrend`). The window is then

- **level** when |mean VS| ≤ `levelVsFpm`, or
- **climb** when mean VS ≥ `climbVsFpm` and RPM and MAP are at or above `climbMinRpm` and
  `climbMinMapInHg`.

Segments never overlap: the window restarts after each one, so successive segments are
independent measurements. A segment carries means and spreads, plus `gammaDeg` (path angle),
`aoaPitchDeg` (pitch − path angle), `invEas2` = (100/EAS)², `densityAltFt`, `rpmJitter`
(std of the second-to-second differences divided by √2) and `egtSpreadC`.

**Models.** Each trained KPI has a linear model, `intercept + Σ coef·feature`, whose feature
names are segment fields. `perfModelEval` returns the value and how many features fall
outside the trained `range` widened by `rangeMargin`. Outside the range the KPI says OUT OF
RANGE and gives no value. Extrapolating is how a performance monitor lies.

**Blending.** A new segment value moves the running KPI by `smoothing` (per indicator, or
`display.smoothing`). ATTITUDE uses 0.2 and CLIMB 0.3: their single segments are noisy (see
the training report). A KPI older than `display.fadeS` is drawn at half opacity, and one
older than `display.holdS` is withdrawn (EXPIRED).

**Statuses.** A KPI without a value says why. The reasons include UNTRAINED, WAIT LEVEL,
WAIT CLIMB, NO RPM, NO SPEED, NO OAT, NO DATA, OUT OF RANGE, EXPIRED and NO ALGORITHM. A
reason that comes from a segment (OUT OF RANGE, UNTRAINED) is *sticky* until the next
measurement. The others are worked out again every second.

## Rules the code keeps

1. **`perfengine.js` stays pure.** Never touch `window`, `document`, `angular`, `Date` or
   `fetch` in it. Time always comes in as `sample.t`. That is what lets the trainer, the unit
   tests and the display test drive it at any speed.
2. **One implementation of a KPI.** Never re-implement detection or a KPI in Python. The
   trainer gets segments from `perfrun.js`, and Python only extracts and fits.
3. **100 % = as trained, higher is better**, for every KPI, including those of external
   algorithms. A KPI where higher means worse (a load estimate, a risk) is shown in
   `detail`, not as the value: ATTITUDE's `≈ 745 kg` is an example.
4. **No value without a reason.** A KPI that cannot be computed returns `value: null` and a
   status. It never returns a stale value or a value extrapolated past the trained range.
5. **Advisory only.** Nothing here raises an alert by itself. Alerts on external KPIs go
   through the daemon's EMS rules (see professional-algorithms.md), where their thresholds
   are visible and tested.
6. Line endings: the new files are LF. `index.html`, `simulator.html` and
   `servicesSimulator/servicedaemon.js` are CRLF, and the edits kept them so.

## Adding a KPI to `rb-open`

1. In `PerfOpenAlgorithm`, compute it in `sample()` (continuous) or `segment()` (steady)
   and call `this.measure(id, value, t, {detail, quality})`. Set a reason with
   `this.status(id, ...)` while it has no value. Add the id to the `kpis` list of the
   `register()` call.
2. If it is trained, add its `(phase, target, features)` to `MODELS` in `perf_train.py` and
   a `put(...)` line in `train()`. Add any new segment field to `PerfSteadyDetector.push`.
3. Add the indicator to `DEFAULT_CONFIG` in `perf_train.py` and to
   `web/RB-01/settings/performance.json`, then retrain the sample (training-from-sqlite.md).
4. Unit-test it in `test_perfengine.js`: one check on the model gives 100, one degraded case
   gives the expected %, one missing input gives its status. The display test picks up the
   new row by itself.
5. Document it in the table above and in performance-json.md.

## Checking a change

```sh
node tools/performance/test_perfengine.js                 # engine, < 1 s
cd test/display && python3 test_performance.py            # the page, 4 panels, ~1 min
python3 tools/performance/perf_train.py --out /tmp/p.json \
    test-data/flightlog-20261025101548.0171.sqlite \
    --evaluate test-data/flightlog-20261025133703.0927.sqlite   # real flights
```

Neither test runs in CI: the display tests are local only (AGENTS.md), and the CI container
has no Node. For a look at the page with a moving aircraft, run
`cd test/display && ./simulator.py --idle`, open `#/addons/performance` and play a recorded
flight from `/sim/`. Steady segments need 20 s of steady flight each, so give it a few
minutes.

## Known limits of the reference algorithm

- **ATTITUDE** depends on the AHRS pitch. On I-RVDX the internal AHRS scatters about 0.5°
  between segments, while 10 % more weight moves cruise pitch by about 0.25°. One segment
  says little, and the heavy smoothing is the price. An external AHRS or a better attitude
  engine improves it directly.
- **ENGINE** assumes the climb is at full throttle. The detector cannot see the throttle:
  set `climbMinRpm` (or `climbMinMapInHg`) and train on real full-power climbs, otherwise
  part-throttle climbs read as power loss.
- **CRUISE** with a constant-speed propeller needs `mapInHg` among the features: RPM alone
  does not set the power. The trainer adds MAP when the log has it.
- **No wind in the logs.** The HMI's wind estimate is not recorded, so training without an
  airspeed board falls back to ground speed. Fly out-and-back legs so the wind averages out.
- **DENSITY** is a formula, not trained. It is the open baseline for the summer-heat
  effect.
