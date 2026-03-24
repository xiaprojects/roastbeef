# Stratux HTTP & WebSocket API Reference

Stratux exposes a set of HTTP JSON endpoints and WebSocket streams accessible on the Stratux IP address (default `192.168.10.1`). These are used by the web UI and can also be used by external tools, EFBs, or custom integrations.

---

## HTTP JSON Endpoints

### Status & Telemetry

#### `GET /getStatus`
Returns the current Stratux system status as JSON, including software version, connected devices, message counts, GPS status, CPU temperature, and error list.

Example fields: `Version`, `GPS_connected`, `GPS_satellites_locked`, `UAT_messages_last_minute`, `ES_messages_last_minute`, `CPUTemp`, `Errors`

#### `GET /getSituation`
Returns the current GPS/AHRS situation: position, altitude, track, speed, vertical speed, and attitude (pitch/roll/slip-skid) if AHRS is connected.

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
Sets the region. Accepts JSON: `{"Region": "US"}` or `{"Region": "EU"}`.

---

### Logs & Data

#### `GET /logs/`
Browse and download log files via HTTP. Useful for remote diagnostics without SSH access.

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
Toggles Developer Mode (equivalent to tapping the version number in the web UI Settings page).

#### `POST /roPartitionRebuild`
Rebuilds the read-only filesystem partition. Use with caution — intended for recovery scenarios.

---

### AHRS Calibration

#### `POST /orientAHRS`
Triggers AHRS orientation detection.

#### `POST /calibrateAHRS`
Runs the AHRS calibration routine.

#### `POST /cageAHRS`
Cages the AHRS to the current attitude (sets current orientation as level reference). The resulting quaternion is saved to `SensorQuaternion` in settings.

#### `POST /resetGMeter`
Resets the G-meter min/max values.

---

### OTA Update

#### `POST /updateUpload`
Upload a `.deb` OTA update package directly via HTTP POST (multipart form).

#### `POST /updatePong`
Upload firmware for the Pong ADS-B receiver.

---

### Map Data

#### `GET /tiles/tilesets`
Returns available offline map tilesets.

#### `GET /tiles/{tileset}/{z}/{x}/{y}`
Serves individual map tiles from offline tilesets.

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
| `GpsManualChip` | string | Chip type: `ublox`, `ublox8`, `ublox9` |
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
| `DeveloperMode` | bool | Enables additional SDR diagnostics. Toggle via `/develmodetoggle` or by tapping the version number in Settings |

---

## Notes

- All endpoints are HTTP (not HTTPS). Stratux operates on a local Wi-Fi network.
- No authentication is required.
- The default Stratux IP is `192.168.10.1` in AP mode, or the DHCP-assigned address in client mode.
- `Content-Type: application/json` is returned on all JSON endpoints.
- WebSocket connections remain open until the client disconnects.
