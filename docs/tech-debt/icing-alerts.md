# Icing Advisories

Plan and implementation record for warning the pilot about carburettor icing and airframe icing
using the sensors RB-01 already reads. Plan written 2026-11-25, revised the same day with the
owner's decisions below.

**Status: step 1 built (2026-11-25, uncommitted).** `main/icing.go` publishes the icing probes
into the EMS pipeline, the air quality addon shows them, and the shipped rules raise icing
alerts (owner, 2026-11-25). Not yet checked against recorded flights or flown.

## Owner decisions (2026-11-25)

| # | Decision | Where |
| --- | --- | --- |
| A | `publishCabinHumidity` is removed, and `cabin_humidity` is not used at all: only `mySituation.BaroHumidity` | `main/humidity.go`, `main/sensors.go` no longer publish; the probe, its constant and the `CABINHUMIDITY` rule are gone; `main/icing.go` reads `BaroHumidity` |
| B | The icing warning applies to carburettor and injection engines alike: no `aircraft.json` setting | No engine gate in `main/icing.go` |
| C | Warnings are percentages, without RPM: a forecast of the risk if power is reduced | `icing_carb` and `icing_airframe`, 0–100 % |
| D | UI indicators in the air quality addon | Two more gauges in `web/RB-01/addons/` (`airquality.html`, `js/airquality.js`, `airquality.css`) |
| E | A 1 s loop in `icing.go` gathers its inputs and, if they are reliable, pushes values that changed into the EMS pipe | `IcingStratuxPlugin`, `ems.publishInternal` / `withdrawInternal` |
| F | Algorithms from `docs/icing/` | The chart zones of `docs/icing/licterature/map.txt` |
| G | The icing rules raise alerts | `"alert": true` with their own alert types (below) |

## What the sensors can and cannot do

| Source | Where it comes from | Use for icing |
| --- | --- | --- |
| Cabin RH | `mySituation.BaroHumidity` (AHT20/21, or BME680) | **Dew point.** Cabin air is warmed, so its RH is lower than outside, but the amount of water in it is about the same if fresh air comes in through vents, so the dew point carries over to the outside air. |
| Cabin temperature | `mySituation.BaroTemperature`, the baro on the same breakout | The temperature the RH refers to. |
| OAT | EMS `outsidetemperature` ($RBEMS, MAX31856 on I-RVDX) | **Required** for every outside value. |
| GPS altitude vs pressure altitude | | **Not used.** The difference mostly reflects QNH and the temperature of the whole air column. |

Limits:

- **Nothing here detects ice on the airframe.** A humidity sensor cannot tell humid clear air
  from the inside of a cloud, so airframe icing is "conditions favourable" only.
- The values are **advisory**. Carb heat stays in the checklist, and 0 % never means "no ice".
- With the cabin sealed (no vents, heater on) the carried-over dew point is wrong. Breath raises
  it, so the error goes towards false alarms, not missed ones.

## Step 1: built 2026-11-25

### The loop

`main/icing.go`, `IcingStratuxPlugin`, started after `ems.InitFunc()` and stopped before
`ems.ShutdownFunc()` in `main/gen_gdl90.go`. Once a second it:

1. reads its inputs and decides which are reliable:
   - humidity: `BaroHumidity` in (0, 100], from a connected AHT20, or from the BME680 with a
     baro reading under 5 s old;
   - cabin temperature: `BaroTemperature` with `BaroLastMeasurementTime` under 5 s old,
     -40 to 85 °C;
   - OAT: `ems.senderValue("outsidetemperature")`, which is ok only if a sender posted the key
     (the EMS pre-fills 0, a real icing temperature) and the EMS feed has sent a frame in the
     last 5 s, and -60 to +60 °C (outside it the thermocouple is open or broken).
2. computes the probes that its reliable inputs allow (`icingCompute`, pure, tested);
3. publishes only the ones that changed (`publishInternal`) and withdraws the ones that lost
   their inputs (`withdrawInternal`).

| Probe | Needs | Value |
| --- | --- | --- |
| `dew_point` | humidity and cabin temperature | °C, 1 °C steps, Magnus formula (Alduchov–Eskridge constants) |
| `outside_humidity` | + OAT | %RH at the OAT, 1 % steps |
| `icing_carb` | + OAT | chart zone as % (below) |
| `icing_airframe` | + OAT | 0–100 % (below) |

A dew point above the OAT is read as saturated (100 %), not as off the chart.

### Carburettor icing: `icing_carb`

The chart (`docs/icing/licterature/image0.webp`, figure 4 of the BEA study
`Synthese_etude_givrage_VF_041223.pdf` in the same folder; the same zones as UK CAA Safety
Sense 14), read on (OAT, dew point):

| Zone | Chart meaning | `icing_carb` | Gauge word |
| --- | --- | --- | --- |
| blue | serious icing at any power | 100 | SEVERE |
| green | moderate at cruise power, serious at descent power | 75 | MODERATE |
| yellow | serious at descent power | 50 | LOW PWR |
| orange | light at cruise and descent power | 25 | LIGHT |
| outside | | 0 | NONE |

No RPM or MAP is read, so the value is the forecast for reduced power. At 50 % and above,
reducing power gives serious icing.

The zone outlines are those of `map.txt`. Checked against the image's axes (the black T = 0
and dew point = 0 lines, the T = D apex at +30 °C), `map.txt` sits 1 °C warm and 1.5 °C dry
(its saturation edge is 2 °C below T = D). `carbChartShift` takes that back off. After the
shift, 90 % of a 0.5 °C grid lands on the image's colour; the rest is within 1 °C of a zone
edge, or on a grid line or label. The zones are tested in order blue, green, yellow, orange,
so an outline drawn as a ring or as a whole area reads the same.

The BEA study itself warns that the published charts differ from each other and from
measured carburettors: they raise awareness and are not a certified prediction.

### Airframe icing conditions: `icing_airframe`

`100 × temperature factor × saturation factor`, rounded:

- temperature factor: 1 from 0 to -10 °C, linear to 0 at +3 °C and at -20 °C;
- saturation factor: 1 at an OAT - dew point spread of 1 °C or less, linear to 0 at 4 °C.

Gauge words: 0 NONE, below 50 POSSIBLE, 50 and above LIKELY.

### Rules and UI

- `web/settings/rbvoice-aircraft-rules.json`: `ICINGCARB` and `ICINGAIRFRAME`, green 0–20,
  yellow 20–60, red 60–100, `"alert": true`. So 25 and 50 % are yellow, 75 and 100 % red.
- Alerts: the rule names pick their own types, `EVENT_TYPE_ICINGCARB_YELLOW` / `_RED` and
  `EVENT_TYPE_ICINGAIRFRAME_YELLOW` / `_RED` (`main/alerts.go` 22–25,
  `web/settings/alertsMapping.json` en-US and it-IT); `EVENT_TYPE_<rule name>_<COLOR>` is looked up
  in the mapping, a rule without such rows raises the engine type. Carb: yellow "Carburettor icing risk
  at reduced power", red "Serious carburettor icing risk, apply carb heat". Airframe:
  "Airframe icing conditions possible" / "likely". Sounds `generic_warning` and `danger` until
  recordings exist. An icing alarm counts like any rule in alarm for "EMS data lost".
- Air quality addon: two more gauges, CARB ICE and AIRFRAME, read from the EMS stream
  (`EMSUpdated`, and `GET /getEMS` on entry because the stream sends only on change). A probe
  missing from the map reads NO DATA, dimmed. Layout: two rows of three on landscape panels, a
  3×2 block inside the circle on the round 480×480. The footnote says "icing advisory only".
- `dew_point` is in `EMS_TEMPERATURE_SOURCES` (`web/RB-01/js/global.js`), so an EMS gauge on
  it follows the pilot's temperature unit.

### Tests

- `main/icing_test.go`: dew point and RH against tables, chart points sampled in the image,
  saturated air stays on the chart, airframe percentage, which probes appear for which inputs,
  publish on change and withdraw, no `cabin_humidity`, OAT only from a live feed, the shipped
  rules and the icing alerts they raise.
- `test/display/test_airquality.py`: NO DATA, SEVERE red, LOW PWR yellow, POSSIBLE, withdrawn,
  every dial on the glass at 480×480 to 1280×800 (22/22 on 2026-11-25).

## Open steps

1. **Replay check.** Run `icingCompute` over every recorded flight that has OAT and humidity
   (`~/Desktop/win10/*.sqlite`, `test-data/`) and report how often each alert would fire. On a
   mild humid day the chart reads serious (15 °C OAT, 12 °C dew point is 100 %), so the alerts
   may fire on most flights.
2. **Alert tuning.** Thresholds, dedicated sound recordings, and how often a lasting risk is
   repeated.
3. **Pitot icing** (detective): IAS falling more than 25 % in 20 s while GPS ground speed,
   track and altitude hold steady, gated out in aerobatics. No wind estimate needed.
4. **Carburettor ice forming** (detective, research): slow RPM (fixed pitch) or MAP (constant
   speed) drop in steady flight. Needs logged flights with known events; log only at first.

## Open questions for the owner

1. Where are the humidity sensor and the OAT probe mounted? Is the sensor in moving vent air,
   away from avionics heat?
2. The OAT thermocouple is failing more and more (journal 2026-11-14): fix it first? Without
   OAT, both icing gauges read NO DATA.
3. Should the colour bands (and so the alert thresholds) stay as shipped?
