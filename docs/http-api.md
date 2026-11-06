# Stratux HTTP & WebSocket API Reference

Stratux exposes a set of HTTP JSON endpoints and WebSocket streams accessible on the Stratux IP address (default `192.168.10.1`). These are used by the web UI and can also be used by external tools, EFBs, or custom integrations.

---

## HTTP JSON Endpoints

### Status & Telemetry

#### `GET /getStatus`
Returns the current Stratux system status as JSON, including software version, connected devices, message counts, GPS status, CPU temperature, and error list.

Example fields: `Version`, `GPS_connected`, `GPS_satellites_locked`, `UAT_messages_last_minute`, `ES_messages_last_minute`, `CPUTemp`, `Errors`

Also carries the GPS Hobbs meter (`main/hobbsmeter.go`): `HobbsTimeMinutes` (the whole flight log, flight in progress included) and `HobbsFlightMinutes` (the flight in progress, 0 on the ground). Both are live; the RB-01 Aircraft plate adds `HobbsTimeMinutes` to the `propellerTime` / `engineTime` base values of `settings/aircraft.json`.

#### `GET /getSituation`
Returns the current GPS/AHRS situation: position, altitude, track, speed, vertical speed, and attitude (pitch/roll/slip-skid) if AHRS is connected.

`IndicatedAirSpeed` (knots, 0 = no airspeed source) comes from the MS4525DO pitot-static sensor when one is recognised on the I²C bus (`main/airspeed.go`, `airspeedSender`; see [hardware/sensors.md](hardware/sensors.md)), together with `PitotPressure` (Pa, after the zero offset and filter), `PitotTemperature` (°C) and `PitotLastMeasurementTime`. Without one, an external airspeed board feeds it with `POST /bridge/float` and the JSON body `{"ias_mps": <m/s>}` (`main/managementinterface.go`, `handleBridgeFloatSetRequest`), which converts to knots; that key is ignored while the pitot sensor is connected. The RB-01 HMI shows it in place of `GPSGroundSpeed` on the speed gauge, the attitude tape and the bottom bar whenever it is above 0, labelled `IAS`, and falls back to ground speed labelled `GS` otherwise (`web/RB-01/services/servicesituation.js`).

#### `GET /getTowers`
Returns all ADS-B ground towers that have been received, as a JSON object keyed by `"(lat,lng)"`. Each entry includes:
- `Lat`, `Lng` — tower coordinates
- `Signal_strength_last_minute`, `Signal_strength_max`
- `Messages_last_minute`, `Messages_total`

Useful for coverage mapping and signal analysis.

#### `GET /getSatellites`
Returns all GNSS satellites currently being tracked, with signal levels and fix status per satellite.

#### `GET /getClients`
Returns all currently connected GDL90 clients (EFBs, apps) with their IP addresses and connection metadata.

#### `GET /getRegion`
Returns the currently selected region as JSON: `{"IsSet": true, "Region": "US"}` or `{"IsSet": false}`. Region values: `US`, `EU`.

---

### Settings

#### `GET /getSettings`
Returns the full `stratux.conf` settings as JSON. All fields are returned, including those not exposed in the web UI (see [Advanced Settings](#advanced-settings) below).

#### `POST /setSettings`
Accepts a JSON body with one or more settings fields to update. Changes are applied immediately and persisted to `stratux.conf`.

Example:
```json
{ "UAT_Enabled": true, "ES_Enabled": true, "PPM": -5 }
```

#### `POST /setRegion`
Sets the region. Accepts JSON: `{"Region": "US"}` or `{"Region": "EU"}`. This applies the region change at runtime (UAT band selection, OGN behavior); note that it does **not** itself write `stratux.conf` — persistence is handled by the region-change path, not an explicit settings save in the handler.

---

### Logs & Data

#### `GET /logs/`
Browse and download log files via HTTP. Useful for remote diagnostics without SSH access. Serves `/var/log`; a `*.sqlite` name is looked up in `ReplayLogPath` first, so the links from `/flightlogs` work wherever the flight logs are kept.

#### `GET /flightlogs`
Lists the SQLite flight logs in `ReplayLogPath` (written when the `ReplayLog` setting is on) as `[{Name, Size, ModTime, Path}]`, with `Path` under `/logs/`.

#### `GET /settings/hobbsmeter.json`
The GPS Hobbs meter's flight log (`main/hobbsmeter.go`): one entry per flight, a flight being the time the GPS ground speed stays above 50 km/h (opened after 5 s above, closed after 60 s below, so a touch-and-go does not split it). Only a fix with a horizontal accuracy under 30 m counts towards opening a flight, and a leg with less than a minute above the threshold is dropped when it closes, so a GPS wandering in a hangar or a high-speed taxi leaves no entry. Read-only over HTTP; the file of the same name under `settings/` (the boot partition on RB devices) is hand-editable and is flushed at most every 5 minutes, at landing and at shutdown — this endpoint answers from memory, so it is live and returns `[]` before the first flight, when the file does not exist yet.

```json
[
  {
    "departureTime": "2026-09-17T10:23:45Z",
    "departureLatitude": 41.952841,
    "departureLongitude": 12.50197,
    "departureAltitudeMeters": 35,
    "landedTime": "2026-09-17T11:10:02Z",
    "landedLatitude": 41.952841,
    "landedLongitude": 12.50197,
    "landedAltitudeMeters": 35,
    "hobbsTimeMinutes": 45
  }
]
```

`departureTime` is the first second above the threshold, `landedTime` the last drop below it (RFC 3339 UTC, GPS time), altitudes are GPS MSL in meters, `hobbsTimeMinutes` the seconds above the threshold truncated to minutes. The flight in progress is present with an empty `landedTime`; after a power cut it stays in the log as last flushed.

#### `GET /settings/deviation.json`
Magnetic declination (variation), a static file generated from the World Magnetic Model by `scripts/gen_deviation.py`. The generator writes one grid per region under `settings/databases/deviations/` and `deviation.json` is the one in use, a copy of one of them (`europe.json` as shipped):

| File | Grid, 1° nodes | Covers |
|---|---|---|
| `europe.json` | 27°N 32°W to 72°N 45°E | Canary Islands and Azores to Moscow, Cyprus to North Cape |
| `usa.json` | 17°N 180°W to 72°N 64°W | CONUS, Alaska (Aleutians east of 180°), Hawaii, Puerto Rico |
| `canada.json` | 41°N 142°W to 84°N 52°W | All of Canada up to northern Ellesmere |

Each grid is at sea level, evaluated at `date` (decimal year) and valid from `validFrom` to `validTo`. `declination[i][j]` (degrees, East positive: magnetic = true − declination) is the value at latitude `planimetry.start.lat + i * step.lat` and longitude `planimetry.start.lon + j * step.lon`, both ends included; `annualChange[i][j]` is its rate in degrees per year. Interpolate bilinearly between the four nodes around the position and add `annualChange * (year - date)`: over the validity window this stays within 0.06° of the full model in Europe, 0.08° in the USA and 0.15° in Canada south of 78°N, well inside the model's own uncertainty (about 0.3–0.5° at mid latitudes). North of about 70°N in the Canadian Arctic the horizontal field is under 6000 nT, the WMM caution zone where the model and any magnetic compass degrade; there the grid is up to 0.8° off. Regenerate the grids when NOAA publishes the next model.

```json
{
    "model": "WMM-2025",
    "validFrom": 2025.0,
    "validTo": 2030.0,
    "date": 2027.5,
    "planimetry": {"start": {"lat": 27, "lon": -32}, "end": {"lat": 72, "lon": 45}},
    "step": {"lat": 1, "lon": 1},
    "declination": [[-9.4, -9.0, …], …],
    "annualChange": [[0.17, 0.17, …], …]
}
```

#### `GET /downloadlog`
Downloads the current debug log file.

#### `GET /downloadahrslogs`
Downloads AHRS log files as a zip archive.

#### `GET /downloaddb`
Downloads the traffic/message database.

#### `POST /deletelogfile`
Deletes the current debug log file.

#### `POST /deleteahrslogfiles`
Deletes all AHRS log files.

---

### System Control

#### `POST /reboot`
Reboots the Raspberry Pi.

#### `POST /shutdown`
Shuts down the Raspberry Pi.

#### `POST /restart`
Restarts the Stratux software without rebooting the Pi.

#### `POST /develmodetoggle`
**Enables** Developer Mode (equivalent to tapping the version number in the web UI Settings page). Despite the name this is one-way — it only ever sets `DeveloperMode` to `true`; it does not toggle it back off. To disable Developer Mode, clear it via `POST /setSettings` (`{"DeveloperMode": false}`).

#### `POST /roPartitionRebuild`
Rebuilds the read-only filesystem partition. Use with caution — intended for recovery scenarios.

---

### AHRS Calibration

#### `POST /orientAHRS`
Triggers AHRS orientation detection.

#### `POST /calibrateAHRS`
Calibrates the gyro zero (`D`): averages the IMU for 5 s at the AHRS rate. Do it at rest with the engine off; the time and IMU die temperature go to `GyroCalibrated`.

#### `POST /cageAHRS`
Cages the AHRS with the aircraft at rest: averages the IMU for 5 s, re-solves the accelerometer offset of the axis carrying gravity so the corrected reading is 1 g (`AccelOffset`), stores the corrected reading as `C`, and derives `SensorQuaternion` so that this reading is the given attitude.

Optional parameters (query or form), degrees, within ±45:
- `pitch` — nose up positive, default 0
- `roll` — right wing down positive, default 0

Without them the current attitude becomes level, as before. A tailwheel aircraft is caged on the ground at its ground attitude, e.g. `POST /cageAHRS?pitch=11&roll=0`; the AHRS then reads 11° parked and 0° in level flight. Use the attitude read from a reference (a certified attitude indicator, or an inclinometer on the longerons): an error in it becomes the same error in flight. Replies `400` when a parameter is not a number within ±45.

#### `POST /resetGMeter`
Resets the G-meter min/max values.

#### `POST /calibrateAirspeed`
Zeroes the pitot airspeed sensor: averages 2 s of differential pressure into the `AirspeedZeroOffset` setting. Do it with the aircraft stationary in still air and the pitot cover off. Replies `409` with a plain-text reason when no pitot sensor is connected or the GPS reports the aircraft moving (> 5 kt).

---

### OTA Update

#### `POST /updateUpload`
Upload a `.deb` OTA update package directly via HTTP POST (multipart form).

#### `POST /updatePong`
Upload firmware for the Pong ADS-B receiver.

---

### Radio

#### `GET /radio`
The radios of the `Radio` setting as an array, with their live state. `ws://…/radioStatus` pushes the same array on a change.

#### `POST /radio/{index}`
Changes one radio. The body holds the fields that change; what it leaves out keeps its value. A refused command raises an `EVENT_TYPE_RADIO_COMMAND_NOT_OK` alert and leaves that field as it was.

| Field | Meaning |
|---|---|
| `FrequencyActive`, `FrequencyStandby` | MHz as a string, such as `"118.030"` |
| `LabelActive`, `LabelStandby` | Station names |
| `Dual` | Dual watch. Refused on the `SDR` driver, a single receiver |
| `Enabled` | `true` selects this radio and disables the others. On the `SDR` driver `false` turns the receiver off |
| `VolumeLevel` | `SDR` only, 0 to 100. 0 releases the sound device; reception and recording carry on |
| `SquelchLevel` | `SDR` only, 0 to 100 dB above the noise. 0 holds the squelch open |
| `Record` | `SDR` only. Save received audio to the recording folder |

With `"Driver": "SDR"` these become commands to the `rb-sdr-radio` daemon, sent through the float bridge (`main/radio.go`; the contract is `docs/RB-SDR-RADIO-IF-v1.0.md` in that repository):

| Field | Bridge key |
|---|---|
| `FrequencyActive` | `sdrradiofreq`, the channel name in MHz |
| `VolumeLevel` | `sdrradiovolume` |
| `SquelchLevel` | `sdrradiosquelch` |
| `Record` | `sdrradiorecord`, 0 or 1 |

`FrequencyActive` must be a 25 or 8.33 kHz channel name from 118.000 to 136.990. Names ending 20, 45, 70 and 95 do not exist and are refused, so the radio stays on its channel. `FrequencyStandby` stays in RB-01: there is one receiver, so it takes effect when swapped to active.

`Enabled` decides whether the receiver runs. With no SDR radio enabled, `sdrradiofreq` is 0, the bridge's empty frequency, and the daemon releases the dongle and the sound device. That includes selecting another radio. `FrequencyActive` is kept and can still be changed while off; enabling the radio tunes it. Volume, squelch and `Record` keep working as settings.

The bridge is held in memory, so with `Radio_Enabled` set the levels, `Record` and the frequency are sent again at start-up, 0 if the radio is disabled. A level of 0 is not sent, because it cannot be told from a level never set, and `Record` is not sent until it has been chosen. The daemon's own defaults apply in those cases.

What the radio is really doing is on the same bridge, in the `sdrradio*` status keys of `ws://…/bridge/float/ws`.

---

### Alerts

#### `GET /getAlerts`
Every alert raised since the daemon started, oldest first, as an array.

| Field | Meaning |
|---|---|
| `Id` | The raise time as the integer `HHMMSScc`: 19:06:44.55 is `19064455`, 00:00:00.00 is `0`. Unique in the list, taking the next free centisecond if needed. Not ordered: a flight can cross midnight and the GPS steps the clock, so do not sort by it. |
| `Type` | Event type, the row of `settings/alertsMapping.json` |
| `Title` | Text of the alert, can be empty |
| `Timestamp` | When it was raised |
| `TimestampEnd` | When its condition was last seen. The same as `Timestamp` for a one-shot event. `TimestampEnd - Timestamp` is the overall duration, which counts the gaps of a condition that came back. |
| `Active` | The condition has not been seen to go. It clears when an EMS update finds the rule out of that colour, not when the updates stop. Always false for a one-shot event. |
| `ActiveSeconds` | Time actually spent in the condition, without those gaps |

Today only the alerts raised by an engine rule and "EMS data lost" have a condition to follow. The times use the system clock, so a duration spanning a GPS clock step can be off.

#### `ws://…/alerts`
One alert, with the fields above, each time an alert is raised. Nothing is sent when an alert changes: a client sounds an alarm for every frame, so a client that wants the state reads `/getAlerts`.

---

### Map Data

#### `GET /tiles/tilesets`
Returns available offline map tilesets.

#### `GET /tiles/{tileset}/{z}/{x}/{y}`
Serves individual map tiles from offline tilesets.

#### `GET /mapdata/styles/…`
Serves vector-tile map style JSON files (referenced by the `stratux_style_url` field in the `/tiles/tilesets` response). Backed by a static file server rooted at `$STRATUX_HOME/mapdata/styles`.

---

### Web UI (static)

#### `GET /`
The root path is a catch-all static file server for the web configuration UI (served from `$STRATUX_WWW_DIR`, default `/opt/stratux/www`). Responses carry a short `Cache-Control: max-age` header. Not a JSON API, but listed here for completeness since it shares the same HTTP server.

---

## WebSocket Streams

All WebSocket endpoints are at `ws://192.168.10.1/<endpoint>`.

#### `ws://…/gdl90`
Live GDL90 binary message stream. This is the same data sent over UDP port 4000 but delivered via WebSocket. Used by the web UI map and traffic display.

#### `ws://…/status`
Live status updates pushed as JSON whenever system status changes.

#### `ws://…/situation`
Live GPS/AHRS situation updates pushed as JSON.

#### `ws://…/weather`
Live FIS-B weather messages. On connect, sends the current weather buffer, then pushes updates as they arrive.

#### `ws://…/traffic`
Live traffic updates pushed as JSON.

#### `ws://…/radar`
Radar/NEXRAD data stream.

#### `ws://…/jsonio`
Live traffic as JSON objects, one per message. On connect, sends all currently tracked traffic with valid positions, then pushes updates. Alternative to GDL90 for integrations that prefer JSON.

---

## Advanced Settings

The following settings are available via `/getSettings` and `/setSettings` but are not exposed in the web UI. They are persisted to `stratux.conf`.

### Manual GPS Configuration

Useful when GPS autodetection fails or for non-standard hardware:

| Field | Type | Description |
|-------|------|-------------|
| `GpsManualConfig` | bool | Enable manual GPS config (disables autodetect) |
| `GpsManualDevice` | string | Serial device path, e.g. `/dev/ttyAMA0` |
| `GpsManualChip` | string | Chip type: `ublox6`, `ublox7`, `ublox8`, `ublox9`, `ublox10`, or `ublox` (generic). Any other/empty value leaves the chip unconfigured |
| `GpsManualTargetBaud` | int | Target baud rate, e.g. `115200` |

Example:
```json
{
  "GpsManualConfig": true,
  "GpsManualDevice": "/dev/ttyAMA0",
  "GpsManualChip": "ublox9",
  "GpsManualTargetBaud": 115200
}
```

### Other Advanced Settings

| Field | Type | Description |
|-------|------|-------------|
| `ClearLogOnStart` | bool | Wipe the debug log file on each boot |
| `NoSleep` | bool | Disable sleep mode detection for GDL90 clients. Useful for always-on panel-mount EFIS installations where the display never sleeps |
| `SensorQuaternion` | [4]float64 | AHRS calibration quaternion. Set by the calibration wizard; can be set manually for aircraft-specific alignment |
| `RegionSelected` | int | `0`=none, `1`=US, `2`=EU. Drives UAT band selection and some OGN behavior. Prefer using `/setRegion` |
| `DeveloperMode` | bool | Enables additional SDR diagnostics. Enable via `/develmodetoggle` (one-way) or by tapping the version number in Settings; disable by posting `{"DeveloperMode": false}` to `/setSettings` |

---

## Notes

- All endpoints are HTTP (not HTTPS). Stratux operates on a local Wi-Fi network.
- No authentication is required.
- The default Stratux IP is `192.168.10.1` in AP mode, or the DHCP-assigned address in client mode.
- `Content-Type: application/json` is returned on all JSON endpoints.
- WebSocket connections remain open until the client disconnects.
