# Integrating a professional (closed-source) performance algorithm

For developers of commercial algorithms (XIAPROJECTS or licensed partners). It covers the
two ways an algorithm plugs into the RB-01 performance page, the contract each must keep,
and how to train and test one against recorded flights.

The open reference algorithm (`rb-open`, in `web/RB-01/js/perfengine.js`) stays as it is.
A professional algorithm is added beside it: it can replace some indicators, add new ones,
or both, and the page, OVERALL, the colours and the training files are shared.

## Choosing the integration

| | A. Separate process (recommended) | B. In-browser JS plugin |
|---|---|---|
| Runs | on the RB-01, as its own program (Go, C++, Rust, Python, anything) | inside the HMI page, in Chromium |
| Code shipped as | a compiled binary | a `.js` file the browser downloads |
| Protects the IP | yes: only the binary is installed | no: JS can be read, at best obfuscated |
| Licence boundary | a process talking HTTP to the AGPL daemon | a script loaded into the AGPL page |
| Sees | the full daemon API: situation, EMS, traffic, settings, at any rate | the HMI's 1 Hz samples and steady segments |
| KPIs logged into the flight sqlite | yes, automatically (the `ems` table) | no |
| Voice and visual alerts | yes, through `rbvoice-aircraft-rules.json` | no |
| Keeps running with no display connected | yes | no |

**Use A for anything whose value is in the algorithm.** Use B only for presentation, for
light open models, or for prototyping before porting to A.

*Licensing note:* RB is AGPL-3.0 with dual commercial licensing by XIAPROJECTS. Option A
keeps the proprietary code in a separate program that only exchanges data with the daemon
over HTTP. Have the final distribution model reviewed by counsel, especially for option B
and for anything distributed together with the image.

## A. Separate process

### Contract

Once a second, the process POSTs its KPIs to the daemon:

```
POST http://<rb-01>/setEMS
Content-Type: application/json

{"perf_acme_cruise": 97.3, "perf_acme_cruise_status": 0, "perf_acme_cruise_quality": 0.9,
 "perf_acme_wb": 104.0, "perf_acme_hb": 5121}
```

| Key | Value | Rule |
|---|---|---|
| `perf_<vendor>_<kpi>` | the KPI in % | **100 = the aircraft as trained, higher is better.** Range 0–200. Post it only while it is valid. |
| `perf_<vendor>_<kpi>_status` | code (below) | Optional. Why there is no value, or a remark about it. |
| `perf_<vendor>_<kpi>_quality` | 0…1 | Optional. Confidence. |
| `perf_<vendor>_hb` | a counter | **Required.** Change it on every post. The page reads NO DATA once it stops for `staleS`. |

The status codes are indices of `PERF_EMS_STATUS` in `perfengine.js`:

| Code | Shown |
|---|---|
| 0 | (nothing) |
| 1 | UNTRAINED |
| 2 | WAIT LEVEL |
| 3 | WAIT CLIMB |
| 4 | NO DATA |
| 5 | OUT OF RANGE |
| 6 | LICENSE |

Append new codes; never renumber them.

Every value is a float (`map[string]float32` in `handleEMSSetRequest`). The EMS stream to
the HMI carries **changes only**, which is why freshness comes from the heartbeat and not
from the KPI.

To take a KPI away, post its `_status` with a non-zero code. The `ems` indicator shows the
status instead of the old value. A KPI the process stops posting stays at its last value
until the heartbeat stops.

### Data sources

Everything the HMI uses is available over HTTP and WebSocket (see
[../http-api.md](../http-api.md)):

| Data | Polled with GET | As a stream (WebSocket) |
|---|---|---|
| situation (GPS, AHRS, baro, `IndicatedAirSpeed`, `PitotPressure`, humidity) | `/getSituation` | `/situation` |
| engine and other probes (`enginerpm`, `egtN`, `chtN`, `outsidetemperature`, `icing_*`, ...) | `/getEMS` | `/ems` |
| traffic | `/getTraffic` | `/traffic` |
| settings | `/getSettings` | |
| aircraft profile (`bestGlide`, units) | `/settings/aircraft.json` | |
| this aircraft's training | `/settings/performance.json` | |

Units: speeds in kt, `BaroVerticalSpeed` in ft/min (`GPSVerticalSpeed` is 0 on RB-01),
altitudes in ft, EMS temperatures in °C. Off the aircraft, run `stratuxrun` locally (non-root,
port 8000) or replay a flight: see [../dev-setup.md](../dev-setup.md).

### Showing it on the page

Add one indicator per KPI to `performance.json`:

```json
{ "id": "acmeCruise", "label": "CRUISE+", "algorithm": "ems",
  "source": "perf_acme_cruise", "heartbeat": "perf_acme_hb", "staleS": 10, "weight": 1 },
{ "id": "acmeWB", "label": "W&B", "algorithm": "ems",
  "source": "perf_acme_wb", "heartbeat": "perf_acme_hb", "weight": 0,
  "bands": [ { "color": "green", "min": 90, "max": 110 },
             { "color": "yellow", "min": 80, "max": 120 },
             { "color": "red", "min": 0, "max": 200 } ] }
```

To replace an open KPI, delete it from the list or set `"enabled": false` on it. Use
`"weight": 0` to show a KPI without counting it in OVERALL. The bands are optional. The most
severe band wins on overlap, so nested bands like the W&B example work.

### Alerts and logging

The daemon logs every changed value into the flight log's `ems` table, so KPIs are already
in the sqlite for cloud analysis and for the next training. The heartbeat changes every
second, which costs one log row per second: about 3600 rows an hour.

For a spoken and visual alert, add a rule to `settings/rbvoice-aircraft-rules.json`. It
works like `ICINGCARB` (the rule format is `EMSRule` in `main/ems.go`):

```json
{ "name": "PERFCRUISE", "algorithm": "max", "probeNames": ["perf_acme_cruise"],
  "colors": [ { "color": "red", "min": 0, "max": 80 },
              { "color": "yellow", "min": 80, "max": 90 },
              { "color": "green", "min": 90, "max": 200 } ],
  "alert": true }
```

It raises the engine rule alert family unless `alertsMapping.json` has rows
`EVENT_TYPE_<rule name>_YELLOW` / `_RED`. A dedicated performance family
needs those rows in `alertsMapping.json` (with the matching `EVENT_TYPE_` constants) and its
sounds (open work).

### Packaging

Ship the process as a systemd service next to `stratux.service`, the way `rb-ems-go` and
`rb-vor` run. Start it after the daemon and restart it on failure. Licensing (the LICENSE
status) is the process's own business: post status 6 with no value when the licence is
missing.

A working skeleton is in `tools/performance/examples/ems_kpi_sender.py`. Point it at a
running daemon to see the indicator appear and go NO DATA when the skeleton is stopped.

## B. In-browser JS plugin

### Contract

A script registers an algorithm with the engine's registry:

```js
PerformanceAlgorithms.register({
    id: "acme-js",            // what performance.json "algorithm" names
    version: "1.0.0",
    kpis: ["wb"],             // the KPI ids it can produce
    create: function (indicators, ctx) {
        // indicators: the performance.json entries with "algorithm": "acme-js",
        //             including any keys you add (your model coefficients)
        // ctx: { config (detector, display, overall, indicators), display, engine }
        const ind = indicators[0];
        let last = null;
        return {
            sample: function (s) {
                // every kept second: s.t (s), s.iasKt, s.gsKt, s.pitchDeg, s.rollDeg, s.gload,
                // s.vsFpm, s.pressureAltFt, s.oatC, s.rpm, s.mapInHg, s.egt[], s.cht[],
                // s.icingCarb, s.icingAirframe, s.ems (the whole EMS map),
                // s.d (derived: sigma, densityAltFt, tasKt, easKt, speedSource, invEas2, egtSpreadC)
            },
            segment: function (seg) {
                // every steady segment: seg.phase "level" | "climb", seg.t, and the means
                // (easKt, tasKt, rpm, aoaPitchDeg, vsFpm, densityAltFt, egtSpreadC, rpmJitter...)
                if (seg.phase === "level") last = { value: 100 * ind.k / seg.aoaPitchDeg, t: seg.t };
            },
            results: function (now) {
                // { kpiId: { value: % | null, status, detail, quality, t } }
                return last ? { [ind.id]: { value: last.value, t: last.t, detail: "acme" } }
                            : { [ind.id]: { value: null, status: "WAIT LEVEL" } };
            }
        };
    }
});
```

The rules are the same as for the open algorithm (implementation.md, "Rules the code
keeps"): 100 = as trained, a reason for every missing value, `t` set to the time of the
measurement (it drives fading and expiry), and no clock, DOM or network access inside the
algorithm.

### Loading it

List the script in `performance.json`; the page loads it before it starts the engine:

```json
"plugins": ["addons/js/pro/acme-js.js"],
"indicators": [ { "id": "wb", "label": "W&B", "algorithm": "acme-js", "k": 3.1 } ]
```

The path is relative to `RB-01/index.html`. A plugin that fails to load makes its
indicators read NO ALGORITHM, and the rest of the page keeps working.

## Training and testing against recorded flights

- **JS plugins** run offline in the same harness as the open algorithm:

  ```sh
  python3 tools/performance/perf_extract.py flight.sqlite > samples.jsonl
  node tools/performance/perfrun.js segments performance.json --require acme-js.js < samples.jsonl
  node tools/performance/perfrun.js kpis performance.json --require acme-js.js --every 30 < samples.jsonl
  ```

- **Separate processes** get the same samples from `perf_extract.samples(path)` (Python) or
  the JSON lines above. For a full end-to-end check, run the process against `stratuxrun`
  replaying a trace (`test/integration/replay.py`).
- **Ground truth** from the logs: `ems` holds every engine probe, `mySituation` the flight
  state, and `bridgefloat` the external air data unit (an independent pitch and IAS on
  I-RVDX). For icing, weight and fuel models, record the truth too: the actual takeoff mass
  and fuel on board. A log alone does not hold it.
- Write unit tests in the style of `tools/performance/test_perfengine.js`: one behaviour per
  check, the trained case giving 100, each degradation giving its expected %.

## Ideas the open algorithm leaves to professional ones

- **Icing from performance:** CRUISE dropping, ATTITUDE dropping and climb lost together,
  while `icing_airframe` > 0. That is accretion, not a forecast.
- **Weight and balance:** estimating mass and CG from the ATTITUDE trend, elevator trim
  (when logged) and climb, against a declared loading.
- **Engine health trends** across flights: per-cylinder EGT/CHT drift and power at the same
  density altitude.
- **Fuel contamination:** fuel pressure and flow spectra, and the EGT pattern of one
  cylinder at a time.
- **Constant-speed propellers and turbocharged engines:** power from MAP, RPM, fuel flow and
  OAT.
- **Fleet:** comparing an aircraft with its type across the RB-Cloud flight logs.
