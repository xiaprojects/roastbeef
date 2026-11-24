# GPS / GNSS Receivers

GPS handling is in `main/gps.go`. Stratux can autodetect a receiver via udev symlinks or use
a manually configured serial device. Most receivers are **u-blox**-based, but a SiRF receiver,
a Raspberry Pi UART GPS, network GPS, and serial trackers are also supported.

## Autodetected receivers

Detection prefers the stable udev symlinks created by `debian/10-stratux.rules`:

| Receiver / chip | Symlink | Internal type | Notes |
|---|---|---|---|
| u-blox 9 | `/dev/ublox9` | `GPS_TYPE_UBX9` | |
| u-blox 8 (RY83xAI, GPYes 2.0) | `/dev/ublox8` | `GPS_TYPE_UBX8` | 80 ms PPS offset |
| u-blox 7 (VK-172, VK-162 rev 2, GPYes, RY725AI) | `/dev/ublox7` | `GPS_TYPE_UBX6or7` | |
| u-blox 6 (VK-162 rev 1) | `/dev/ublox6` | `GPS_TYPE_UBX6or7` | |
| SiRFstar IV — **BU-353-S4** (Prolific PL2303) | `/dev/prolific0` | `GPS_TYPE_PROLIFIC` | |
| Generic u-blox on the Pi UART (GPIO 8/10) | `/dev/serial0` | `GPS_TYPE_UBX_GEN` | |
| Serial-in tracker (OGN-Tracker / SoftRF) | `/dev/serialin` | `GPS_TYPE_SERIAL` | see [ogn-ais-receivers.md](ogn-ais-receivers.md) |
| SoftRF dongle (TTGO dongle, STM VCP) | `/dev/softrf_dongle` | `GPS_TYPE_SOFTRF_DONGLE` | |

GPS can also come from the **network** (`GPS_TYPE_NETWORK`) rather than a local device — e.g.
NMEA over TCP from an external source.

## Manual configuration

Set `GpsManualConfig: true` and the manual fields (see
[settings-reference.md](../settings-reference.md)):

- `GpsManualDevice` — serial path (default `/dev/ttyAMA0`)
- `GpsManualChip` — `ublox6`, `ublox7`, `ublox8`, `ublox9`, `ublox10`, or `ublox` (generic).
  Any other/empty value leaves the chip unconfigured (`GPS_TYPE_ANY`, no reconfig).
- `GpsManualTargetBaud` — target baud after reconfiguration (default `115200`)

## Baud detection & autoconfiguration

`detectOpenSerialPort()` probes candidate baud rates, validates the NMEA checksum, and keeps
the working rate:

- Auto-detect first tries `9600`.
- Manual/serial tries `115200, 38400, 9600, 230400, 500000, 1000000, 2000000`.
- SiRF tries `4800, 38400, 9600`.

For u-blox chips, Stratux sends `CFG-GNSS` to enable constellations (GPS, SBAS, Galileo,
BeiDou, QZSS, GLONASS) and sets an **airborne <2g dynamic model**, NMEA 4.0 output, and the
desired nav rate (1/2/5/10 Hz). Per-chip routines exist for u-blox 8 and 9, with a generic
path for others. The GPS time-pulse LED is disabled via UBX-CFG-TP5.

The detected receiver type is reported as `GPS_detected_type` in `/getStatus`.

## Required NMEA sentences: RMC and GGA

RB-01 needs a receiver that sends **RMC and GGA** every fix. Without one of them there is
no usable GPS:

| Sentence | Gives | Required |
|---|---|---|
| RMC | UTC time and date (sets the system clock), valid flag, position, ground speed, true track | yes |
| GGA | fix quality, satellites, altitude, geoid separation | yes |
| GSA, GSV, GST | DOP, satellites in view, accuracy (NACp) | optional |
| VTG | ground speed and track, which RMC already gives | **not parsed** |

VTG was dropped on 2026-11-23. It has no time stamp, so it can't be tied to a fix. When the
parser took speed and track from both RMC and VTG, each fix stamped
`GPSLastGroundTrackTime` twice. Whenever the 50 ms AHRS tick fell between the two stamps,
the AHRS saw a second GPS sample with no change in velocity. In steady turns the Simple
engine then showed about 0.75 of the bank (flight of 2026-11-20). The u-blox `CFG-MSG`
setup and the SiRF setup (`main/gps.go`, `test/sirf_config.sh`) now turn VTG off, and a
VTG from any other source, such as a manually configured receiver or NMEA in over TCP
`:30011`, is ignored. A receiver that sends only GGA and VTG is not supported. Configure
it to send RMC.

The `$GPVTG` pass-through in `main/network.go` (BLE) and `main/autopilotudp.go` (UDP)
is unrelated: it forwards an EFB's VTG to the autopilot and is still supported.

## Tips

### Is the receiver genuine?

To read the receiver's firmware version and check it for clone signs, see
[gps-authenticity.md](gps-authenticity.md). The u-blox 8 in the RB-01 reference unit is a
probable clone (ROM 2.01, no flash, no Galileo).

### RB-01 reference installation (I-RVDX)

- The u-blox 8 receiver is wired to the Raspberry Pi **GPIO TTL UART pins**, not to USB. The
  receiver sits inside the RB-01, in the instrument panel.
- The GPS antenna is in the middle of the aircraft. Its wiring was checked at the last
  inspection.
- The USB hub with the SDR dongles is in the tail and has its own dedicated power supply.

### `/dev/ublox8` on the RB-01 image comes from `rc.local`, not from udev

The udev rule in `debian/10-stratux.rules` only creates `/dev/ublox8` for a **USB** u-blox 8
(`1546:01a8`). On the RB-01 image the receiver is on the UART, so the link is made by
`image_build_rb/root/etc/rc.local`:

```sh
ln -s /dev/ttyAMA0 /dev/ublox8
```

`debian/stratux.service` is ordered only after `network.target` and `bluetooth.target`. Nothing
orders it after `rc-local.service`, so the two race at boot.

### Symptom: no GPS at all until the unit is rebooted

If the daemon starts before `rc.local` has created the link, autodetection does not find
`/dev/ublox8` and falls through to the last candidate, `/dev/serial0`, as a generic u-blox.
Detection runs once and is not repeated, so the session never recovers. This happened on two
boots on 2026-11-14 (logs in `test-data/20261114`); on that unit no NMEA arrived on
`/dev/serial0`.

How to recognise it in `stratux.log`:

| | Good boot | Boot that lost the race |
|---|---|---|
| Detection line | `GPS - chip: ublox 8, device: /dev/ublox8, baudrate: 115200` | `GPS - device detected at serial port /dev/serial0, assuming this is an ublox device, configuring as generic ublox:` |
| `successfully opened serial port ... (Valid NMEA msg received)` | about 3 s later | never |
| Satellites in the periodic stats lines | 18–24 tracked, 15–20 used | 0 seen, 0 tracked |

Other signs of a session without a fix:

- Log timestamps are wrong until the GPS sets the clock (they showed `2026/04/13` on
  2026-11-14), so order events by line number, not by time.
- No `flightlog-*.sqlite` was written for the sessions that never had a fix.
- The Garmin G5 shows a red X on heading while the RB-01 reboots, because the
  `mag-can-bridge` that feeds it runs on the RB-01.

Suspected trigger (not verified): the `rb-sdr-radio` systemd service, added recently, changes
the boot timing so that `rc.local` runs later relative to `stratux.service`.

Ways to remove the race (none applied or tested yet):

- Set `GpsManualConfig: true`, `GpsManualDevice: /dev/ttyAMA0`, `GpsManualChip: ublox8`. The
  manual path opens the UART directly and does not need the link.
- Create the link with a udev rule for `ttyAMA0` instead of `rc.local`.
- Order `stratux.service` after `rc-local.service`.
- Make the daemon repeat the detection while no valid NMEA arrives.

### Symptom: receiver alive but only a few satellites

On the same day, three other sessions found `/dev/ublox8` and received valid NMEA, yet
tracked only 1–6 satellites and used none, for up to 36 minutes. In one of them the count
jumped to 20 tracked after about 29 minutes without any daemon event. This is a different
fault from the race above and its cause is not known. The log has no per-satellite signal
strength, antenna status or jamming indicator, so it cannot separate antenna, interference
and receiver state. In the session with the jump, the FLARM serial link on `/dev/ttyACM1`
reconnected 71 times.
