# RB-Cloud: rebuild the in-flight alerts from the flight log SQLite

A guide for Claude when working on the RB-Cloud flight analysis (`../rb-cloud` front end,
`../rb-cloud-php` API). The goal is one new view: **a table of every warning the pilot saw
during a flight**, rebuilt from the `flightlog-*.sqlite` that the aircraft uploads. Next to it,
the cloud should list the problems the data shows but the display never announced.

Read first: `../rb-cloud/CLAUDE.md`, `../rb-cloud-php/CLAUDE.md` and
`../rb-cloud-php/docs/API.md`. The alert code lives in this repo: [main/alerts.go](../../main/alerts.go),
[main/ems.go](../../main/ems.go), [main/gpsfixalert.go](../../main/gpsfixalert.go),
[main/terrain.go](../../main/terrain.go), `addSingleSystemErrorf` in
[main/gen_gdl90.go](../../main/gen_gdl90.go), and the display side in
[web/plates/js/radar.js](../../web/plates/js/radar.js) and [web/plates/js/gps.js](../../web/plates/js/gps.js).

Status (2026-11-24): the daemon now writes every alert to the flight log (`alerts` table, §2.1;
uncommitted). The cloud side (endpoint, page) is not built. This file is the plan, the alert
catalogue, the format of the `alerts` table and the detection algorithms, each tried on the latest
flights in `test-data/`.

---

## 1. Where the alerts come from

Until 2026-11-24 the flight log had **no record of any alert**: `alerts.pushEvent()` kept them in
memory and sent them over `/alerts/ws` only. Logs written by a newer build have an `alerts`
table (§2.1; tests in [main/alertslog_test.go](../../main/alertslog_test.go)). Older logs, and
everything already in the cloud, don't. Still not in any log:

- `globalStatus.Errors` (the `addSingleSystemErrorf` text) is a `[]string`. `makeTable()` skips
  slice fields, so the `status` table has no `Errors` column. The same failures do reach the
  `alerts` table, because `addSingleSystemErrorf` raises an alert. The exception is
  "SQLite logging is behind", which uses `addSystemError` and raises none.
- The display's own alarms (traffic tone, G-meter buzzer) run only in the browser.
- The settings and the EMS rules file (§5).

So the cloud gets the table in two ways, and every row says which (`source` column, §3):

| Track | What | Where | Confidence | Status |
|---|---|---|---|---|
| **B. Read the logged alerts** | Read the `alerts` table (§2.1) | `rb-cloud-php` | Exact: what the display was sent | daemon side done 2026-11-24, uncommitted |
| **A. Rebuild** | Re-run each alert's trigger rule over the logged raw data | `rb-cloud-php` | Exact for EMS rules; approximate for the rest (see the catalogue) | not built |

The endpoint reads the `alerts` table when it exists and falls back to the rebuild when it doesn't.
Where both are possible, use the rebuild as a check on the logged rows. The browser alarms
(`UI_TRAFFIC`, `UI_GMETER`) and the `DIAG_*` findings always come from the rebuild.

`/flights/{id}/{file}/{table}` already exports any table as CSV, so the raw table is at
`.../alerts` with no API change. The new endpoint must therefore use another name (§6).

---

## 2. What the SQLite holds, and how to read its clocks

Tables, as seen in `test-data/20261121/flightlog-20261121114456.0767.sqlite` (18 min of flight):

| Table | Rows | Rate | What matters for alerts |
|---|---|---|---|
| `mySituation` | 1,007 | ≤ 1 Hz, **only on a GPS update** (`registerSituationUpdate` → `logSituation`, throttled to 1 s) | GPS fix, accuracy, speed, track, baro, AHRS attitude, G, mag heading, IAS |
| `status` | 34 | every ~30 s (`Uptime` 30 s apart) | `GPS_connected`, `IMUConnected`, `BMPConnected`, `AirspeedConnected`, sats, `GPS_position_accuracy`, `DiskBytesFree`, `CPUTemp*`, `Terrain_*`, `Uptime`, `Version`, `Build` (not trustworthy, see below) |
| `ems` | 9,377 | per POST to `/setEMS`, partial maps (see below) | engine probes and the RB unit's own telemetry (`pmic_*`, `cpu_*`, `uptime_seconds`, `clouduploaded`) |
| `bridgefloat` | 46,422 | ~1 Hz per channel | external ADAHRS (`pitch_deg`, `roll_deg`, `ias_mps`, `tas_mps`, `oat_c`, `accel_*`, `gps_*`, `ahrs_quality_pct`, `ahrs_flags`), VOR/LOC/GS (`vorstatus`, `locstatus`, `gsstatus`, …), SDR radio (`sdrradiostatus`, `sdrradiofault`, …), `mag_tx_*`, `oat_tx_*` |
| `traffic` | 9,278 | per target update | proximity alarms (radar), own-ship filtering |
| `es_messages` | 67,220 | raw 1090 | own Mode S loopback `300A61` on I-RVDX; not needed for alerts |
| `timestamp` | 9,787 | 1 per second bucket | `StratuxClock_value`, `GPSClock_value`, `PreferredTime_value`: the link from `timestamp_id` to UTC |
| `alerts` | — | one row per raise / reopen / close | **the alerts the display was sent**, logs from 2026-11-24 on (§2.1) |
| `startup` | 1 | 1 per daemon start | **more than one row = the daemon restarted while writing this log** |
| `settings`, `messages`, `gps_attitude`, `dump1090_terminal` | 0 | — | `settings` is empty in real logs, so the alert thresholds are **not** in the log (§5) |

Clocks. Get these right before anything else:
- The Pi has **no RTC**. Until NTP or GPS sets the clock, the wall clock reads 2026-04-13. `ems.Clock`
  and `bridgefloat.Clock` are Go `time.String()` values, e.g.
  `2026-11-21 11:44:56.450160444 +0000 GMT m=+28.400435595`. **Order and measure gaps with the `m=+`
  monotonic seconds**, never with the date part.
- To get UTC, map `m=+` (daemon uptime) to UTC with one pair of points: the first `mySituation.GPSTime`
  and its `timestamp_id` row, or the first `timestamp` row with `Time_type_preference = 1`. A
  `timestamp_id` join gives UTC to 1 s for `status`, `ems`, `bridgefloat` and `traffic`.
- One file can hold several segments. Split at backward fix times (most logs have one at the start).
  The same basename can sit in two `test-data` folders (`20261120/` and `20261121/` both hold
  `flightlog-20261120075803.0931.sqlite`): dedupe by basename.

Sentinels and quirks:
- `GPSHorizontalAccuracy = 999999` means unknown, not 999 km.
- `ems` senders (rb-ems-go) post **partial maps**: `ems-chtegt` every ~1 s, `ems-adc` and `rb-sysmon`
  only on change, `ems-rpm` on change or every 3 s. Widest gap between two frames: 2.28 s. A steady
  probe can go a long time without a row of its own. Carry the last value forward and judge it per
  frame (§4.1), not per probe.
- `bridgefloat` `heading_deg`, `mag_tx_heading_deg` and `mag_tx_x/y/z` **are the RB magnetometer**
  passed to the EFIS through mag-can-bridge. They are not an independent heading reference.
- `bridgefloat` `oat_c` and the TAS and density altitude derived from it follow the RB OAT probe,
  glitches included.
- `status.Build` has been seen stale (it read `6e608922`/2.1.1 on a binary that was newer). Use it
  as a hint only.
- `AHRSGLoad` from the GY-85 on I-RVDX overstates G by about 8 % (`AHRSGLoad ≈ 1.081·n − 0.089`).
  For the G buzzer rebuild, also report the external unit's `accel_norm_mps2 / 9.81`.
- The aircraft flies aerobatics. Extreme attitude that the accelerometer, the vertical speed and the
  IAS bleed all agree on is real, not an AHRS fault (§4.6).

### 2.1 The `alerts` table

Written by `logAlertEvent()` in [main/alerts.go](../../main/alerts.go) through `logAlert()` in
[main/datalog.go](../../main/datalog.go). The row type is `AlertDataLogger`. The `Alert` struct itself
can't be a table, because its `Id` would clash with the table's `id`: SQLite column names ignore case.

```sql
CREATE TABLE alerts (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, Clock STRING, Event TEXT,
  AlertId INTEGER, Type INTEGER, Title TEXT, Active INTEGER, Timestamp STRING, TimestampEnd STRING,
  ActiveSeconds REAL, timestamp_id INTEGER);
```

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER | row order. **Order by `id`**, not by a time column |
| `Clock` | STRING | when the row was written, Go `time.String()` with `m=+`, the same format as `ems.Clock` and `bridgefloat.Clock` |
| `Event` | TEXT | `raise`, `reopen` or `close` (below) |
| `AlertId` | INTEGER | the alert's Id, `HHMMSScc` of the raise time on the device clock (`19064455` = 19:06:44.55; `0` is a valid Id). The same on every row of one alert |
| `Type` | INTEGER | the `EVENT_TYPE_*` number (table below). It is the type **after** `pushEventByIdent()`, so an EMS red alert is 15 even though `ems.go` passes 14 |
| `Title` | TEXT | the text the display showed, e.g. `CHTMAX yellow 212`, `GPS fix lost`, `Terrain ahead, pull up`, `Barometric altitude 71234' out of expected range…`. Can be empty (an alert posted with no title): then show the mapping's text for the type |
| `Active` | INTEGER 0/1 | the alert's state after this row |
| `Timestamp` | STRING | raise time, `time.String()`. The same on every row of one alert |
| `TimestampEnd` | STRING | the last time the condition was seen. On a `raise` row it equals `Timestamp` |
| `ActiveSeconds` | REAL | seconds spent in the condition so far, without the gaps of an alert that closed and reopened. Rises only between updates of an active alert |
| `timestamp_id` | INTEGER | → `timestamp.id`, for UTC (§2, Clocks) |

Rows (`Event`):

| Event | Written when | `Active` |
|---|---|---|
| `raise` | a new alert is pushed (`pushEvent` with a `Timestamp`) | 1 for a condition (EMS rule, GPS fix, terrain, EMS data lost); **0 for a one-shot event** (timer, autopilot, radio command failure, system errors from `addSingleSystemErrorf`), which never gets another row |
| `reopen` | a closed alert becomes active again, same `AlertId`. EMS does this when the same rule and colour come back within 5 min (`EMS_RULE_ALERT_INTERVAL`) | 1 |
| `close` | an active alert goes inactive. `TimestampEnd` and `ActiveSeconds` are final | 0 |

What is **not** written:
- the updates that only move `TimestampEnd` of an alert that stays active (about one a second for
  GPS, terrain and EMS). The `close` row carries the end.
- updates of an alert the daemon has dropped from its list (more than 100 alerts, the oldest go)
  or doesn't know.
- anything while the replay log is off. The "Startup" alert is raised before the log opens, so
  use the `startup` table for boots.

Edge cases the PHP must handle:
- **`raise` with no `close`**: the alert was still active when the log ended (landing and switch-off
  with an alarm on, a power cut, or more than 100 later alerts pushed it out of the list). Show it as
  open until the end of the log: take the last `m=+` of the log (largest `Clock` in `ems`,
  `bridgefloat` or `alerts`) as "at least until".
- **`close` or `reopen` with no `raise`**: the replay log was switched on, or a new log file started,
  while the alert was open. The row still carries `Type`, `Title` and `Timestamp`, so build the
  episode from it and mark the start as "before the log".
- **Rows are written in batches every 10 s**, and the uploader sends every 5 min. A log uploaded
  mid-flight, or cut by power loss, can miss its last ~10 s of rows.
- **`AlertId` is not unique over a whole log.** It is time-of-day, and the GPS steps the clock at
  boot. Pair a `reopen`/`close` with the latest earlier `raise` row (by `id`) that has the same
  `AlertId`, not with any row of that Id.
- **The wall-clock date can be wrong** (no RTC, §2): before the clock is set it reads 2026-04-13.
  Use `m=+` to order and measure, and `timestamp_id` → `timestamp.PreferredTime_value` (or the
  `m=+` → UTC mapping of §2) for UTC. `m=+` can be missing from a time string: then fall back to
  `timestamp_id`.

Grouping into the episodes of §3 (one row per alert, the way the display lists it):

```sql
-- PHP: SQLite3 in read-only mode, then group in PHP by the latest raise of each AlertId
SELECT a.id, a.Clock, a.Event, a.AlertId, a.Type, a.Title, a.Active,
       a.Timestamp, a.TimestampEnd, a.ActiveSeconds, t.PreferredTime_value AS utc
FROM alerts a LEFT JOIN timestamp t ON t.id = a.timestamp_id
ORDER BY a.id;
```

For each row, in `id` order:
- `raise`: open a new episode, keyed by `AlertId`. `start` = `utc` of this row, `title`, `type`,
  `count` = 0, `end` = null (or `start` for a one-shot event, `Active` = 0).
- `reopen`: find the open episode with this `AlertId` (or create one marked "before the log").
  `count` += 1. Reset `end` to null.
- `close`: same lookup. `end` = this row's `TimestampEnd` as UTC: add
  (`m=+` of `TimestampEnd` − `m=+` of `Clock`) to this row's `utc`. `activeSeconds` = `ActiveSeconds`.

`durationS` = `end − start`. Keep `activeSeconds` as well: for a flapping EMS alert it is the real
time in the band, while `durationS` also counts the gaps.

Presentation, for the HTML. The type numbers are fixed constants in
[main/alerts.go](../../main/alerts.go); the display gets its texts, icons and sounds from
[web/settings/alertsMapping.json](../../web/settings/alertsMapping.json) (row index = `Type`, languages
`en-US` and `it-IT`). The cloud doesn't have the device's mapping, so keep a copy of this table in
the front end:

| Type | Name | Icon / severity | Text (en-US) | Shown as |
|---|---|---|---|---|
| 0 | `EVENT_TYPE_UNKOWN_WARNING` | warning | Warning | one-shot |
| 1 | `EVENT_TYPE_UNKOWN_INFO` | info | Info | one-shot |
| 2 | `EVENT_TYPE_TIMER` | info | Timer fired | one-shot |
| 3 | `EVENT_TYPE_SYSTEM_DANGER` | danger | Danger | one-shot (`addSingleSystemErrorf`: once per boot until cleared) |
| 4 | `EVENT_TYPE_SYSTEM_DANGER_BAROMETER` | danger | Error on barometer | one-shot |
| 5 | `EVENT_TYPE_SYSTEM_DANGER_SDR` | danger | Error on the SDR receiver | one-shot |
| 6 | `EVENT_TYPE_SYSTEM_DANGER_SETTINGS` | danger | (no text yet: the mapping repeats the name; show "System storage or settings error") | one-shot |
| 7 | `EVENT_TYPE_STARTUP_INFO` | info | System up and running | one-shot, usually not logged |
| 8 | `EVENT_TYPE_AUTOPILOT_ENGAGE` | info | Autopilot engaged | one-shot |
| 9 | `EVENT_TYPE_AUTOPILOT_DISENGAGE` | info | Autopilot disengaged | one-shot |
| 10 | `EVENT_TYPE_AUTOPILOT_ABEAM` | info | Autopilot point reached | one-shot |
| 11 | `EVENT_TYPE_AUTOPILOT_GOTO` | info | Autopilot new destination set | one-shot |
| 12 | `EVENT_TYPE_RADIO_COMMAND_NOT_OK` | info | Error, the radio is not responding to commands | one-shot |
| 13 | `EVENT_TYPE_EMS_GENERIC_FAILURE` | danger | Engine Generic Error (title `EMS data lost`) | condition |
| 14 | `EVENT_TYPE_EMS_RULE_YELLOW` | warning | Engine parameter in yellow range | condition |
| 15 | `EVENT_TYPE_EMS_RULE_RED` | danger | Engine parameter in red range | condition |
| 16 | `EVENT_TYPE_GPS_NOT_FIXED` | danger | GPS not fixed | condition |
| 17 | `EVENT_TYPE_TERRAIN_CAUTION` | warning | Terrain ahead | condition |
| 18 | `EVENT_TYPE_TERRAIN_WARNING` | danger | Terrain ahead, pull up | condition |
| 19 | `EVENT_TYPE_TERRAIN_UNAVAILABLE` | warning | Terrain alerts unavailable | condition |

A `Type` outside this table comes from a newer daemon: show it as "Alert type N" with the warning
icon, never drop it. Show the severity as an icon **and** a colour (danger red, warning amber, info
blue/grey), never colour alone. Main text = `Title`, the mapping's text in a smaller line. EMS titles
read `<RULE> <colour> <value>`: the rule names and units are in §4.1.

Illustrative rows (not from a real log; the format is from the code and tests):

| id | Event | AlertId | Type | Title | Active | Timestamp | TimestampEnd | ActiveSeconds |
|---|---|---|---|---|---|---|---|---|
| 1 | raise | 11501234 | 15 | EGTDIFF red 74 | 1 | `2026-11-21 11:50:12.34… +0000 GMT m=+333.29` | same | 0 |
| 2 | close | 11501234 | 15 | EGTDIFF red 74 | 0 | same | `… 11:50:20.36… m=+341.31` | 8.02 |
| 3 | reopen | 11501234 | 15 | EGTDIFF red 74 | 1 | same | `… 11:53:02.11… m=+503.06` | 8.02 |
| 4 | raise | 11531540 | 2 | Timer 1 fired | 0 | `… 11:53:15.40… m=+516.35` | same | 0 |

---

---

## 3. The target table

One row per alert episode (raise → close), sorted by start. This is what the page shows and what
the endpoint returns.

| Column | Meaning |
|---|---|
| `start`, `end` | UTC, ISO 8601. `end` null if still active at the end of the log |
| `durationS` | `end − start` |
| `phase` | `ground`, `takeoff`, `cruise`, `landing`, from GS (50 km/h as in `flight_summary.php`) and `Terrain_Phase` when present |
| `severity` | `danger`, `warning`, `info`. Use the Icon from [web/settings/alertsMapping.json](../../web/settings/alertsMapping.json) (`danger`/`warning`/`info`); EMS red is danger and yellow is warning |
| `type` | the `EVENT_TYPE_*` name (stable key, §4) or `UI_TRAFFIC` / `UI_GMETER` / `DIAG_*` for the rows that are not daemon alerts |
| `title` | the text the display showed: the alert's `Title` (e.g. `CHTMAX yellow 212`), else the mapping's `Text` |
| `shownInFlight` | true for alerts the pilot saw or heard; false for `DIAG_*` findings (§4.8) |
| `value`, `peak`, `unit` | value at the raise, worst value during the episode |
| `count` | the times the alert reopened inside the episode (`reopen` rows, or EMS flapping in the rebuild, §4.1) |
| `source` | `logged` (from the `alerts` table, §2.1), `rebuilt-exact`, `rebuilt-approx`, `inferred` |
| `activeSeconds` | time in the condition without the gaps (`alerts.ActiveSeconds`); null for rebuilt rows unless the rule measures it |
| `evidence` | a short text: the rule and the table/columns used, e.g. `ems frame avg(cht1,cht2,cht4)…` |
| `lat`, `lon` | position at `start`, from the nearest `mySituation` row |

Above the table: a header line with the count per severity and per phase, and a flag when a source
needed for a rule was missing (no `ems` table, no `bridgefloat`, no fix), so that "no alert" is never
confused with "could not tell".

---

## 4. Alert catalogue: every warning, and how to find it in the SQLite

The daemon's alert types are `EVENT_TYPE_*` in [main/alerts.go](../../main/alerts.go) (0…19).
`pushEventByIdent()` maps an `addSingleSystemErrorf` ident to a type. Unknown idents become
`EVENT_TYPE_SYSTEM_DANGER`. Keep this table in step with that file: a new `EVENT_TYPE_` or a new
`addSingleSystemErrorf` ident needs a row here.

### 4.0 Summary

| Type (Id) | Title on the display | Raised by | Rebuild from SQLite | Source |
|---|---|---|---|---|
| `EMS_RULE_YELLOW` (14) / `EMS_RULE_RED` (15) | `<RULE> yellow <v>` / `<RULE> red <v>` | `validateRules`, ems.go | replay the rules over `ems` frames (§4.1) | rebuilt-exact, given the device's rules file |
| `EMS_GENERIC_FAILURE` (13) | `EMS data lost` | `checkFeed`, ems.go: no frame for ≥ 5 s **while a rule is yellow/red** | gap ≥ 5 s in `ems` `m=+` with a rule in alarm at the gap's start (§4.1) | rebuilt-exact |
| `GPS_NOT_FIXED` (16) | `GPS fix lost` | gpsfixalert.go: no valid fix for ≥ 3 s after a first fix | gap ≥ 3 s in `mySituation` rows, or `GPSFixQuality = 0`, after the first fix; `bridgefloat` / `ems` rows must continue across the gap, which proves the daemon was alive (§4.2) | rebuilt-approx (1 s resolution) |
| `TERRAIN_CAUTION` (17) / `TERRAIN_WARNING` (18) | `Terrain ahead` / `Terrain ahead, pull up` | terrain.go, only if `Terrain_Alerts_Enabled` | `status.Terrain_State` = `CAUTION`/`WARNING` (§4.3); exact edges need a replay of terrain.go over `mySituation` | rebuilt-approx (30 s status) |
| `TERRAIN_UNAVAILABLE` (19) | `Terrain alerts unavailable` | terrain.go | `status.Terrain_State = UNAVAILABLE` + `Terrain_Reason` (`NO_FIX`, `POOR_FIX`, `NO_RATE`, `OFF_GRID`, `GRID_BAD`) | rebuilt-approx |
| `SYSTEM_DANGER_BAROMETER` (4) | `Barometric altitude N' out of expected range…` / `AHRS Error: Couldn't read …` | sensors.go idents `BaroBroken`, `pressure-sensor-*` | `BaroBroken`: `BaroPressureAltitude > 70000` or `|GPSAltitudeMSL − baro| > 5000 ft` with a valid fix. Read errors: `status.BMPConnected` drops to 0, or `BaroLastMeasurementTime` stops moving | rebuilt-approx |
| `SYSTEM_DANGER` (3), ident `airspeed-sensor-read` | `Airspeed Error: Couldn't read the pitot sensor` | airspeed.go | `status.AirspeedConnected` 1 → 0, or `PitotLastMeasurementTime` frozen while the setting is on | inferred |
| `SYSTEM_DANGER_SDR` (5) | `You have enabled more protocols than you have receivers…` / `No suitable Ping device found` | sdr.go `sdrconfig`, ping.go | needs the settings (missing from the log). Hint: `status.Devices` lower than earlier in the same log | inferred |
| `SYSTEM_DANGER_SETTINGS` (6) | `can't save settings …`, `Disk bytes used = …`, `Write error on …`, `Rebuild RO Partition …` | idents `save-settings`, `disk-space`, `fs-write`, `partition-rebuild` | `disk-space`: `DiskBytesFree` below 5 % of the disk (the total is not logged; use the free bytes trend and flag below 1 GB). Others: not in the log | inferred |
| `SYSTEM_DANGER` (3), ident `restart-warn` | `System uptime N seconds. Daemon was restarted.` | sdr.go, only with `DeveloperMode` | more than one `startup` row, or `status.Uptime` going down, or the first `Uptime` far above 120 s while the log's first `uptime_seconds` (ems) is large | rebuilt-approx |
| `SYSTEM_DANGER` (3), other idents | `Sounds folder not found`, `hobbsmeter`, `BLE`, `settings-file`, log file open | various | not in the log; list them as not detectable | — |
| (none, `addSystemError`) | `WARNING! SQLite logging is behind…` | datalog.go: a write took > 10 s | appended to `Errors` without an alert. Visible in the data as a hole in **all** tables at once while `m=+` jumps | inferred |
| `RADIO_COMMAND_NOT_OK` (12) | `Radio … Set fail` | managementinterface.go, on a pilot's radio command | not in the log. Related: `bridgefloat.sdrradiofault` (§4.5) | — |
| `AUTOPILOT_*` (8–11), `TIMER` (2), `STARTUP_INFO` (7) | `Autopilot engaged`, `Abeam: …`, `Timer N fired`, `Startup` | autopilot.go, timers.go, alerts.go | info only. `STARTUP_INFO` = each `startup` row. Autopilot: `status.AutopilotUDPReceivingMessages` hints that it was in use | info / inferred |
| `UI_TRAFFIC` (browser) | traffic tone + spoken altitude difference | radar.js: target inside half the radar radius (default 10 NM → 5 NM) and within the altitude threshold (`RadarLimits`), up to 5 tones per entry | from `traffic`: horizontal distance from own position at that second, `|Alt − own baro| ≤ RadarLimits` (default from settings, use 2000 ft if unknown); exclude own-ship `300A61`/own-ship list; re-arm when the target goes beyond ¾ of the radius (§4.4) | rebuilt-approx |
| `UI_GMETER` (browser) | G-meter buzzer | gps.js `beepWithGLoadFactor`, limits `GLimits` (default `-1.76 4.4`) | `mySituation.AHRSGLoad` outside the limits (and outside the quiet range); also report `accel_norm_mps2/9.81` from `bridgefloat`, because the RB G reads ~8 % high on I-RVDX | rebuilt-approx |

### 4.1 EMS rules (exact rebuild)

The rule logic is in `validateRules()`, `ruleValue()`, `ruleColor()` in [main/ems.go](../../main/ems.go).
The rules file is `rbvoice-aircraft-rules.json` (`EMS_RULES_JSON_NAME`). Current I-RVDX rules
([web/settings/rbvoice-aircraft-rules.json](../../web/settings/rbvoice-aircraft-rules.json), uncommitted, 2026-11-22 review):

| Rule | Algorithm | Probes | Yellow | Red | Raises alerts |
|---|---|---|---|---|---|
| OILAVG | average | oiltemperature | 104.4–118.3 °C | > 118.3 | yes |
| EGTAVG | average | egt1-3 | 750–898.9 °C | > 898.9 | **no** (`"alert": false`) |
| EGTMAX | max | egt1-3 | 750–898.9 | > 898.9 | yes |
| CHTAVG | average | cht1,2,4 | 204.4–223.9 °C | > 223.9 | no |
| CHTMAX | max | cht1,2,4 | 204.4–223.9 | > 223.9 | yes |
| CHTMIN | min | cht1,2,4 | 204.4–223.9 | > 223.9 | no |
| CHTDIFF | averageDiff | cht1,2,4 | 20–35 °C | > 35 | yes |
| EGTDIFF | averageDiff | egt1-3 | 35–70 °C | > 70 | yes |
| RPMMAX | max | enginerpm | 2500–2700 | > 2700 | yes |
| BATTERY | average | batteryvoltage | 12.0–12.5 V and > 15.9 V | < 12.0 | yes |

Algorithm (replay it exactly; this is what the daemon does):
1. Read `ems` ordered by `id`. Time = the `m=+` seconds of `Clock`.
2. **Group rows into frames**: a new frame starts when the next row is more than 5 ms later. The
   daemon evaluates once per POST, and one POST writes its rows within microseconds.
3. Keep a map `probe → last value` across frames. Only probes that have appeared count
   (`emsReceived`): a probe never posted is not a 0.
4. After each frame, for each rule with `alert` not `false`: compute the value over the probes
   present (`average`, `max`, `min`, `averageDiff` = max(max − avg, avg − min)).
5. Colour = the first of red, yellow, green whose band holds the value (bounds inclusive, red wins).
   **A value in no band neither confirms nor clears**: skip the rule and keep its old colour. For
   example, oil at 34 °C at takeoff is below the green band, so it raises nothing.
6. Colour change from yellow/red: close the old episode. Into yellow/red: open an episode, but only
   send a new alert if the same `rule-colour` has not been raised in the last **5 min**
   (`EMS_RULE_ALERT_INTERVAL`). Otherwise reopen the previous one and increment `count`.
7. `EMS data lost`: a frame gap ≥ 5 s (`EMS_FEED_TIMEOUT`) while any rule is yellow/red; the episode
   ends at the next frame.

Do not clean glitches before this replay: the daemon does not, so a 768 °C OAT bit-flip would
reach the display if a rule used it. Glitch detection is a separate `DIAG_` row (§4.7).

Validated on the latest flights (Python replay, 2026-11-24):

| Log | Alerts raised |
|---|---|
| `20261120/flightlog-20261120075803.0931` (flight 07:58–08:19Z) | 5: `BATTERY-yellow` ×4 (16.0–16.2 V ripple, max 16.16 V), `EGTDIFF-red` ×1 |
| `20261121/flightlog-20261121104724.0447` (flight 1, aerobatics) | 0 (battery 14.14–15.48 V) |
| `20261121/flightlog-20261121114456.0767` (flight 2) | 0 (battery 13.88–15.45 V) |

These three are the golden cases for the endpoint's test (§6). Before the 2026-11-22 band review,
OILAVG was out of green 60 % of the time and EGTDIFF flapped 475 times a flight. Measure how much an
alert flaps with `count`, not by the number of rows.

### 4.2 GPS fix lost

`mySituation` is written only when the GPS updates, so a lost fix usually shows up as **missing rows**,
not as `GPSFixQuality = 0` rows (all three latest flights: 0 rows with quality 0).
- Episode: a `GPSTime` gap ≥ 3 s after the first row with a fix (`GPS_FIX_LOST_DELAY`). The alert
  also fires if the fix is older than 3 s, so a 3 s gap is the threshold, not 4 s.
- To show that the daemon was alive across the gap and not stopped, check that `bridgefloat` or
  `ems` rows continue (their `m=+`). If everything stops, report a `DIAG_LOGGING_GAP`, not a fix loss.
- No alert before the first fix of the boot (`everFixed`).
- Also report `DIAG_GPS_POOR` (not shown in flight): `GPSHorizontalAccuracy > 50 m` (ignore 999999),
  or `status.GPS_satellites_locked < 6`, or `Terrain_Reason = POOR_FIX`.
- Latest flights: the largest `mySituation` gap is 1.1 s in both 11-21 flights, so no fix loss, not
  even in the aerobatic sequence. Older aerobatic flights (2026-10-17) did lose the fix inverted;
  that is expected.

### 4.3 Terrain

- Shown only with `Terrain_Alerts_Enabled`. `Terrain_Enabled` alone runs the logic silently and still
  fills the `Terrain_*` columns: then the row gets `shownInFlight = false` (shadow mode). The setting
  is not in the log; let the device's settings decide (§5), and default to "shadow".
- `status` is written every ~30 s, so a caution of a few seconds can fall between two samples. For an
  exact table, replay `terrain.go` over `mySituation` (1 Hz) with the same elevation grid. That is a
  port of the Go code to PHP, so do it only after the simple version works.
- Latest flights: 11-21 flight 1: 2 `CAUTION` samples; flight 2: 1 `CAUTION` (phase `LANDING`) and
  1 `UNAVAILABLE/POOR_FIX` (first sample after boot); 11-20: 1 `UNAVAILABLE`. These agree with the
  known replay rate (4.95 cautions/h; 12 of 17 warnings at pattern height near a field,
  see [terrain-alerts.md](terrain-alerts.md)). In the table, put the cautions near a field in the
  `landing`/`takeoff` phase so the pilot can tell a circuit from cruise.

### 4.4 Traffic proximity (display)

Rebuild the radar.js rule per second: own position from `mySituation`, each `traffic` row with
`Position_valid = 1` and an age under ~10 s, distance ≤ radius/2 (5 NM by default), altitude
difference ≤ threshold, **excluding own-ship** (`Icao_addr` = `0x300A61` on I-RVDX, plus the own-ship
list in settings). One episode per target entry, re-armed only after the target goes beyond ¾ of
the radius. The radar radius and threshold are the pilot's display settings and are not logged.
Show the defaults used in `evidence`. FLARM targets: none on 11-20 and 11-21 (FLARM-in reconnects
every 4 s on a silent port).

### 4.5 Radio and navigation receivers (bridgefloat)

Not daemon alerts, but the pilot sees them on the radio/VOR plates. Rows with `shownInFlight = true`
and `severity = warning`:
- `sdrradiofault` ≠ 0, bit field from rb-sdr-radio: **2** dongle not recognised or taken by mistake
  (e.g. stratux grabbed it for ES), **4** audio device, **8** recording folder missing/read-only/full.
  11-21 flight 2 logged `sdrradiofault = 2`.
- `vorstatus`, `locstatus`, `gsstatus`: 0 idle, 1 no signal, 2 tuning, 3 acquiring, 4 degraded,
  5 tracking; **≥ 4 usable**. Report "VOR selected (`vorfreqactive` > 0) but never ≥ 4 for > 60 s".
  On 11-20, PRU 109.40 was never decoded at 8–13 NM. These channels are written on change only, so
  carry the last value forward.

### 4.6 Attitude source quality (not shown in flight, `DIAG_AHRS_*`)

The display never warns, but these were the main findings of the last flights:
- `bridgefloat.ahrs_quality_pct` below 90 (external unit's own figure), and `ahrs_flags` changes.
- `DIAG_AHRS_DIVERGED`: RB `AHRSRoll`/`AHRSPitch` differ from the external unit's `roll_deg`/`pitch_deg`
  by > 20° for > 2 s **and** the external unit is level-ish. On 11-21 flight 1 the RB Simple AHRS
  reached ±180° roll / 82° pitch in aerobatics, but `accel` and vertical speed agree on the
  figures, so only the part where the two units disagree counts.

### 4.7 Sensor glitches (not shown in flight, `DIAG_SENSOR_*`)

For each `ems` engine probe: values outside the physical range, and spikes more than a set amount
from the median of the 9 readings around them. This is the same rule as `analyzeEngineLog` in
`rb-cloud/plates/js/engineanalisys.js`; reuse its profiles, don't invent new limits. Specific
signatures:
- **OAT MAX31856**: exactly `0.0` (chip not driving MISO) and the bit-flip values `187.4`, `192`,
  `384`, `768` °C, plus gaps over 30 s in `outsidetemperature`. 11-21 flight 1: `187.4, 0.0, 384.0`;
  flight 2: `0.0, 768.0`; gaps of 45 s and 37 s. Airborne only, so vibration or connector.
- **Battery ripple**: `batteryvoltage` std over 10 s > 0.3 V, or a max over 15.9 V (11-20: up to 16.16 V,
  7 % of the time).
- **RB power**: `pmic_EXT5V_V` < 4.75 V (Pi 5 undervoltage area); `cpu_temp_c` > 80.

### 4.8 System health (not shown in flight, `DIAG_*`)

`DIAG_RESTART` (several `startup` rows), `DIAG_LOGGING_GAP` (all tables stop together, the SQLite
"logging is behind" case), `DIAG_SENSOR_DISCONNECTED` (`status.*Connected` 1 → 0 during the log),
`DIAG_DISK_LOW`, `DIAG_CPU_HOT` (`status.CPUTempMax` > 80 °C).

---

## 5. Thresholds: the log does not carry the settings

`settings` is empty in real logs, and `rbvoice-aircraft-rules.json`, `GLimits`, `RadarLimits`,
`Terrain_*_Enabled` live on the device. Options, in order of preference:
1. The uploader (`../rb-cloud-upload`) also sends `rbvoice-aircraft-rules.json` and a settings
   snapshot, and the server stores them next to the logs with the upload time. Pick the newest
   snapshot not later than the log's start. This changes the uploader contract, so it must be
   additive (`../rb-cloud-php/CLAUDE.md`, "Consumers").
2. Fix the daemon so it writes the `settings` row, as it now writes the `alerts` (not done).
3. Fall back to the shipped defaults. Write "default thresholds" in the header and in `evidence`.

Never present a rebuilt alert as certain when it was computed with default thresholds.

---

## 6. Implementation guide

API (`rb-cloud-php`):
- New route `GET /flights/{deviceId}/{file}/diagnostics` → `flight_alerts.php`. Add the rewrite rule
  **above** the generic `/{table}` rule, as `/kml` is. Don't call it `alerts`: that is the datalog
  table (§2.1), and the generic CSV route must keep serving it.
- First check `sqlite_master` for an `alerts` table. If it is there, build the logged episodes as in
  §2.1 (`source: "logged"`) and add only the rows the log can't hold (`UI_*`, `DIAG_*`). Without
  it, run the full rebuild. Say which in the response (`"alertsTable": true|false`).
- Open with `SQLite3(..., SQLITE3_OPEN_READONLY)` like `flight_summary.php`. Stream rows with
  `query()`/`fetchArray()`, never load a table into an array: the 357 MB DEMO log already makes the
  CSV export fail with HTTP 500 (memory). Use SQL for what SQL does well (`GROUP BY SensorName`, gap
  search with `LAG()` if the server's SQLite is ≥ 3.25), and PHP for the EMS frame state machine.
- Response: `{ "file", "segments": [...], "alertsTable": true|false, "thresholds": "device|default",
  "missing": ["ems", ...], "alerts": [ <row of §3> ] }`. Times as ISO UTC strings, as in the summary API.
- Cache: the result is valid while the file size is the same (the log grows during a flight). Same
  rule as the summary cache.
- Document the endpoint in `docs/API.md` and add it to the smoke test (`.claude/skills/smoke-test/smoke.sh`).

Front end (`rb-cloud`):
- Until the endpoint exists, the page can already read a new log's raw rows from the CSV route
  (`api/flights/<id>/<file>/alerts`, a 404 for older logs) and group them in JS with the §2.1 rules.
  `parseCSV` is fine: the daemon's titles don't hold newlines.
- A new page `/alerts` ("Flight alerts"). Follow the four steps in `rb-cloud/CLAUDE.md`. Use a
  flight selector from `FlightLogs.scan`, defaulting to the latest flight, and the §3 table with
  severity as colour **plus** an icon (never colour alone, as in the engine health grid). Add
  filters for "shown in flight" / "diagnostics" and click-through to the Charts page at that time.
- Optionally, an alerts column in the Pilot Logbook (count per severity), cached in localStorage
  with a versioned key like the others.

Tests:
- A log with an `alerts` table: none in `test-data/` yet. Record a bench run with the replay log on
  and raise alerts (`POST /alerts`, a GPS antenna pulled, an EMS value posted above a band), and keep
  it as the fixture for the `logged` path, including a `raise` without `close`.
- Golden expectations from `test-data/` (§4.1–4.5): copy the three logs of §4.1 into a local
  `storage/<device>/` and assert the counts. Keep the fixtures out of git if they are large, as in
  the existing smoke test.
- Check the Python replay below against the PHP output on the same files before trusting either.

Reference replay (used for §4.1, a starting point for the PHP port):

```python
import sqlite3, json, re
rules = json.load(open("web/settings/rbvoice-aircraft-rules.json"))["rules"]
def colour(r, v):
    for c in ("red", "yellow", "green"):
        for b in r["colors"]:
            if b["color"] == c and b["min"] <= v <= b["max"]:
                return c
    return ""
def replay(path):
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    data, state, last_raise, alerts, prev = {}, {}, {}, [], None
    def evaluate(t):
        for r in rules:
            if r.get("alert") is False:
                continue
            vals = [data[p] for p in r["probeNames"] if p in data]
            if not vals:
                continue
            avg = sum(vals) / len(vals)
            v = {"average": avg, "max": max(vals), "min": min(vals),
                 "averageDiff": max(max(vals) - avg, avg - min(vals))}[r["algorithm"]]
            c = colour(r, v)
            if not c:
                continue                      # outside every band: keep the old colour
            old, state[r["name"]] = state.get(r["name"]), c
            if c in ("yellow", "red") and c != old:
                k = r["name"] + "-" + c
                if t - last_raise.get(k, -1e9) >= 300:   # EMS_RULE_ALERT_INTERVAL
                    last_raise[k] = t
                    alerts.append((t, k, round(v, 1)))
    for clock, name, value in db.execute("select Clock, SensorName, SensorValue from ems order by id"):
        t = float(re.search(r"m=\+([\d.]+)", clock).group(1))
        if prev is not None and t - prev > 0.005:          # frame boundary
            evaluate(prev)
        data[name], prev = value, t
    if prev is not None:
        evaluate(prev)
    return alerts
```

---

## 7. Algorithms used to diagnose the latest flights (test-data, 2026-11-14 → 11-21)

These are the methods that found the open problems. Each one is a candidate `DIAG_` rule, and
each result is a regression check: run the rule on these files and expect the same verdict.

| # | Problem found | Flight(s) | Algorithm | Tables / columns | Result |
|---|---|---|---|---|---|
| 1 | **RB bank angle 0.75 × truth in steady turns** (RMC and VTG both stamped the ground track; when the AHRS tick fell between them Simple saw a zero velocity change) | 11-20 | Select steady turns: GPS track rate constant within ±1 °/s for ≥ 15 s, \|rate\| > 3 °/s, GS > 60 kt. GPS-coordinated bank = `atan(V·ω/g)` with V = GS (m/s) and ω = track rate (rad/s). Ratio `AHRSRoll / bank` and `AHRSTurnRate / ω`, median per turn. Same for the external unit's `roll_deg` | `mySituation` GPSGroundSpeed, GPSTrueCourse, AHRSRoll, AHRSTurnRate; `bridgefloat` roll_deg | 11-20: roll 0.75, turn rate 0.63 (external 1.16). 11-21: 0.95–1.03 after the fix. Signature: **both** ratios ≈ 0.62–0.67 |
| 2 | **RB pitch nose-low in cruise** | 11-20, 11-21 | Level cruise: \|vertical speed\| < 200 ft/min, \|roll\| < 5°, IAS steady for ≥ 30 s. Median of `AHRSPitch − pitch_deg` | `mySituation` AHRSPitch, AHRSRoll, GPSVerticalSpeed; `bridgefloat` pitch_deg, ias_mps | 11-20: −3.6°; 11-21: −2.3…−3.2° (ground −1.3°) |
| 3 | **Magnetic heading error** | 11-14 → 11-21 | (a) RB `AHRSMagHeading` − EFIS `heading_deg`: an offset per flight, but both come from the same magnetometer, so this only checks the bridge. (b) Truth: GPS velocity minus wind, with the wind solved by least squares from TAS (`tas_mps`, which reads ~2.7 % high) and GPS velocity over a full circle or several headings. Error = mag heading − truth heading, binned by heading | `mySituation` AHRSMagHeading; `bridgefloat` heading_deg, tas_mps, gps_vn_mps, gps_ve_mps | (a) +2.4 (11-14), +0.7 (11-20), −4.5/−7 (11-21). (b) ±10–15° depending on heading |
| 4 | **GPS vertical speed never set** (field always 0) | 11-20 | Correlation of `GPSVerticalSpeed` with the external `gps_vup_mps` and with the slope of `GPSAltitudeMSL` over 2 s. A flat zero series with a moving altitude = not computed | `mySituation`, `bridgefloat` | fixed (main/gpsvspeed.go); 11-21 correlation 0.86 / 0.985 |
| 5 | **AHRS divergence in aerobatics** | 11-21 flight 1 (10:55–11:04) | Mark aerobatic windows where `accel_norm` < 0 g or > 2.5 g, or \|roll\| > 90° agreed by both units. Inside a window, flag divergence only where the RB and the external unit disagree by > 20° | `mySituation`, `bridgefloat` accel_*, roll_deg, pitch_deg | −1.1…+3.0 g; Simple reached 148° roll / 98° pitch and recovered in seconds |
| 6 | **OAT probe failing** (MAX31856) | 11-14, 11-21 | Values exactly 0.0, values in {187.4, 192, 384, 768} ± 0.5, any value > 70 °C, gaps > 30 s in the probe's rows. Count per flight, and airborne vs ground share | `ems` outsidetemperature; `bridgefloat` oat_c, oat_tx_c | 11-14: 12–57 % bad; 11-21: 187.4/0.0/384.0 and 0.0/768.0, gaps 45 s and 37 s, airborne only |
| 7 | **EMS alerts flapping / band review** | 11-05 → 11-20 | Replay of §4.1, counting colour changes per rule and the share of engine-running time (`enginerpm` > 500) outside green | `ems` | before the review: OILAVG out of green 60 %, EGTDIFF 475 changes. After: 11-20 BATTERY ×4, EGTDIFF ×1; 11-21 none |
| 8 | **Battery overvoltage ripple** | 11-14, 11-20 | `batteryvoltage` max, share > 15.9 V, rolling 10 s std | `ems` | 11-20: 13.4–16.16 V, 7 % above 15.9 V |
| 9 | **Spurious takeoff at boot / poor fix** | all | First 30–60 s after boot: `GPSHorizontalAccuracy` > 50 m and `Terrain_Reason = POOR_FIX`. Never count a flight from a poor-fix segment (`flight_summary.php` weak spot: fake speeds while parked). Cross-check with `BaroPressureAltitude` staying within ±20 ft | `mySituation`, `status` | first status row of 11-21 flight 2: accuracy 18 m, POOR_FIX |
| 10 | **Terrain caution rate** | 11-20, 11-21 | Count `status.Terrain_State` per phase. Full method: replay terrain.go over the 1 Hz track ([terrain-alerts.md](terrain-alerts.md)) | `status` Terrain_* | 3 cautions in the 11-21 flights, all near fields |
| 11 | **VOR not decoded / SDR dongle lost** | 11-20, 11-21 | `vorfreqactive` > 0 and `vorstatus` < 4 for the whole leg; `sdrradiofault` ≠ 0; airborne only vs ground. The capture files in `rb-vor/` tell the reason (SNR, AM depth), not the SQLite | `bridgefloat` vor*, loc*, gs*, sdrradio* | 11-20: PRU 109.40 never ≥ 4 at 8–13 NM; 11-21: `sdrradiofault` 2 |
| 12 | **Daemon stop takes 18–20 s / restarts** | 11-14, 11-21 | **Not in the SQLite**: it came from the systemd journal (`20261121.txt`): the time from "Stopping" to "Stopped", and USB `-71` errors on the VOR dongle's hub port. The SQLite only shows the result: several `startup` rows, or a log that ends without a landing | journal; `startup`, `status.Uptime` | ttyACM1 shared by FLARM-in and serialout_nmea0 at 9600 |

What the SQLite cannot show (it needs the journal or the device): USB disconnects, undervoltage
events (`vcgencmd`/kernel), service failures, slow stops, `RADIO_COMMAND_NOT_OK`, settings save
errors. If the cloud should cover them, the uploader must also send a filtered journal. That is a
separate decision.

---

## 8. Open questions for the owner

1. The `alerts` table is in (§2.1, uncommitted). Log the settings and `status.Errors` too?
2. Should the uploader send `rbvoice-aircraft-rules.json` and a settings snapshot (§5)?
3. Should the `DIAG_` rows (problems not shown in flight) be on the same page, or only for the
   Professional version?
4. Journal upload for the problems in §7 #12: wanted, and with what privacy filter?
