# `$RBATT` / `$RBAIR` — Slave NMEA Display: Format Specification

**Status:** implemented, 2026-10-30 (`main/slavenmeadisplay.go`, tests in
`main/slavenmeadisplay_test.go`).

**What this file covers.** The two sentences RB-01 sends so that a slave display can draw
RB-01's attitude and air data. The display has no sensors of its own. Today that display is
the RB-09, whose firmware (rb-esp `main/RB/RB09_Slave.c`, `RB09_Slave_ParseData()`) defines
the layout: the one an RB-02 master prints with its NMEA output on. RB-01 follows the
mapping of RB-Sim's `rb09` profile (rbsimulator `docs/protocol.md` §4.4, RB-SIM-ESP-090,
decision D24). Its signs were checked on an RB-09 screen.

**Not RB-SIM-IF's `$RBATT`.** RB-Sim also specifies a 7-field `$RBATT` (RB-SIM-ESP-020) for
a future SIM firmware. Same name, different layout: RB-09 rejects it.

## 1. Transport and rate

Both sentences go to every output with the FLARM/NMEA capability (`NETWORK_FLARM_NMEA`):
UDP and TCP `:2000`, the `/dev/serialout_nmea*` serial ports and BLE. On the RB image a
display on USB is `/dev/ttyACM1`, which `rc.local` links to `/dev/serialout_nmea0`. Other
NMEA consumers ignore the two sentences.

The Slave NMEA Display plugin (`slaveNMEADisplay`, started by `InitFunc()` and stopped by
`ShutdownFunc()` from `main/gen_gdl90.go`) runs one loop. It sends `$RBATT` and `$RBAIR`
together, each only if it has data (§2, §3), then sleeps for **`SlaveNMEADisplay_SleepMs`**
(`stratux.conf`, `/setSettings`):

| `SlaveNMEADisplay_SleepMs` | Effect |
|---|---|
| `1000` (default, also for a `stratux.conf` written before the setting existed) | both sentences once a second, 1 Hz |
| `n` > 0 | both every `n` ms |
| `0` (or negative) | neither is sent; the loop checks the setting again every second |

A sentence still queued when the next pair is due is dropped: the queue's max age is the
sleep. The priority is 4, behind traffic and position, as for `$RPYL`.

**RB-09's timeouts.** RB-09 firmware up to 1.8.0 shows attitude INOP 1 s after the last
`$RBATT`, and air data INOP 3 s after the last `$RBAIR`. At the default 1000 ms, each
`$RBATT` arrives just over 1 s after the previous one, so the attitude can flag INOP
briefly between sentences, and the horizon moves once a second. An RB-02 master sends at
10 Hz, `100` here.

| Element | Rule |
|---|---|
| Framing | `$` … `*hh\r\n`, `hh` = two uppercase hex digits, the XOR of every byte between `$` and `*`. **Mandatory**: RB-09 drops a sentence without it |
| Numbers | optional `-`, digits, at most one `.`; no exponent, no `+`. At most 7 integer digits |
| Empty field | not known. Only the optional fields may be empty: RB-09 drops a sentence with an empty mandatory field |
| All or nothing | RB-09 uses a sentence whole or not at all, and has no status field. **A sentence that stops is the only "invalid"** |

## 2. `$RBATT` — attitude

```
$RBATT,<roll>,<pitch>,<yaw>,<ax>,<ay>,<az>,<gx>,<gy>,<gz>,,,,,,,,*hh<CR><LF>
```

| # | Field | From | Unit, sign | Format |
|---|---|---|---|---|
| 1 | roll | `AHRSRoll` | deg, + right wing down | `%.2f` |
| 2 | pitch | `AHRSPitch` | deg, + nose up | `%.2f` |
| 3 | yaw | −`AHRSGyroHeading` | deg, 0 … −360: the display's heading card shows −yaw and its turn needle differentiates it. **`3276.70` (the Invalid sentinel, not negated) while the heading is unknown** | `%.2f` |
| 4 | accel x | G·cos(slip) | g, normal axis | `%.3f` |
| 5 | accel y | G·sin(slip) | g, lateral: the display draws the ball at −y, and `AHRSSlipSkid` is + ball left | `%.3f` |
| 6 | accel z | 0 | g | `%.3f` |
| 7–9 | gyro x y z | 0 | deg/s: RB-09 reads none | `%.2f` |
| 10–17 | GPS acceleration, magnetometer, compass, filter beta | — | optional, RB-09 uses none | empty |

G is `AHRSGLoad` clamped to ±9.99, and slip is `AHRSSlipSkid` clamped to ±20°. |accel| is
therefore the load factor, which the display's G-meter shows. The fields are read together
under `mySituation.muAttitude`.

**Not sent** without the IMU (`IMU_Sensor_Enabled && IMUConnected`: the GPS-derived attitude
never goes out), while the attitude is not current (`isAHRSValid()`: more than 1 s old or no
GPS fix, RB-HLR-ATT-200/210), or while roll, pitch, slip or load factor holds the Invalid
sentinel (RB-HLR-ATT-230).

**The heading sentinel.** The Simple AHRS has no heading below taxi speed (static mode), while
its roll and pitch are good. The yaw field then carries `3276.70` unchanged, as the
field's unavailable value (RB-HLR-ATT-220). RB-09 firmware up to 1.8.0 rejects `|yaw| > 360`,
so it shows attitude INOP in that state until it handles the sentinel.

## 3. `$RBAIR` — air data

```
$RBAIR,<static>,<qnh>,<oat>,<vs>,<ias>,<wind>,<wind dir>*hh<CR><LF>
```

| # | Field | From | Unit | Format |
|---|---|---|---|---|
| 1 | static pressure | `common.CalcPressure(BaroPressureAltitude)` | inHg (hPa / 33.8639) | `%.4f` |
| 2 | QNH | bridge `"qnh"`, posted by the HMI (`servicesituation.js`) | inHg | `%.5f`, so a setting made in hPa comes back exact (`RB09_Slave_FormatAir()`) |
| 3 | OAT | — | °C | empty: the baro sits inside the case |
| 4 | vertical speed | `BaroVerticalSpeed` | ft/min | `%.0f` |
| 5 | indicated airspeed | `IndicatedAirSpeed` × 1.852 | km/h | `%.1f`; empty while it is 0, the "no airspeed source" value |
| 6, 7 | wind, direction | — | km/h, deg | empty: only the HMI estimates the wind |

The static pressure is the one behind the pressure altitude, so it includes the
`AltitudeOffset` correction. RB-09 adopts the QNH, because a remote display follows its
master's setting.

**Not sent** without a pressure altitude of RB-01's own (`isTempPressValid()`, and a source
other than none or the ADS-B estimate: the `$PGRMZ` rule), or without a QNH in the bridge
between 850 and 1100 hPa. That is RB-09's own window, and with no QNH it would show an
altitude on a setting nobody made. The QNH reaches the bridge only once the RB-01 HMI has
one. The daemon keeps the bridge in RAM, so after a restart `$RBAIR` waits for the HMI to
post it again.

**Altimeter on RB-09.** RB-09 turns pressure into altitude with RB-02's linear 30 ft/hPa
(`Get_BMP280()`), not the ISA formula RB-01 uses. For the same pressure and QNH it reads
about +155 ft at 3000 ft and −500 ft at 10 000 ft against RB-01, and above about 12 000 ft it
goes INOP. That is a firmware matter, and RB-01 sends the true static pressure.

## 4. Test vectors

From `main/slavenmeadisplay_test.go`. Roll −12.34°, pitch 5.67°, heading 271.5°, slip 1.2
(ball left), 1.234 g; 3000 ft pressure altitude, QNH 1013.25 hPa, +500 ft/min, 100 kt:

```
$RBATT,-12.34,5.67,-271.50,1.234,0.026,0.000,0.00,0.00,0.00,,,,,,,,*62
$RBATT,-12.34,5.67,3276.70,1.234,0.026,0.000,0.00,0.00,0.00,,,,,,,,*79
$RBAIR,26.8154,29.92124,,500,185.2,,*48
$RBAIR,26.8154,29.97292,,500,185.2,,*43
```

The second line has the heading unknown, and the last has QNH 1015 hPa.
