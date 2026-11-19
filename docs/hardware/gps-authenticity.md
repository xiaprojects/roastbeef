# Checking a u-blox receiver for a clone chip

Many cheap "u-blox" GPS boards carry clone chips or old remarked parts. Clones look genuine
at first: they send normal NMEA and even answer some UBX commands. They differ in what they
cannot do: no Galileo, no flash for saving settings, poor sensitivity, and commands they
answer wrongly. This page explains how to identify the receiver in an RB-01 and recognise a
likely clone. It ends with the receiver found in the RB-01 reference unit as a worked
example.

The test uses only UBX **poll** requests. It does not change or save anything in the
receiver.

## What you need

- SSH access to the RB-01 (default `ssh pi@192.168.10.1`).
- [`scripts/ublox_probe.py`](../../scripts/ublox_probe.py) from this repository. It needs
  pyserial, which is already on the RB-01 image (`python3-serial`).
- The receiver device. On the RB-01 that is `/dev/ublox8` (a link to the GPIO UART
  `/dev/ttyAMA0`, see [gps.md](gps.md#tips)). For a USB receiver use its `/dev/ubloxN` link.
- For the satellite part of the result: the antenna should see open sky. Indoors or in a
  hangar every receiver looks bad.

## Running the test

The daemon must not hold the serial port while the probe runs:

```sh
scp scripts/ublox_probe.py pi@192.168.10.1:/tmp/
ssh pi@192.168.10.1
sudo systemctl stop stratux
python3 /tmp/ublox_probe.py /dev/ublox8
sudo systemctl start stratux
```

The script:

1. Tries the usual baud rates until NMEA or a UBX reply comes back.
2. Polls `MON-VER`, `MON-GNSS`, `SEC-UNIQID`, `CFG-PRT`, `MON-HW`, `NAV-PVT` and `NAV-SAT`.
3. Prints a **Red flags** list at the end.

Run it twice a few minutes apart. Some faults, like the baud mismatch in the example below,
show up only on one run.

## Reading the result

### Firmware and hardware version (`UBX-MON-VER`)

This is the most useful check. `HW` gives the chip generation and `SW` the firmware.

| `HW` | Generation | What a genuine part reports |
|---|---|---|
| `00040007` | u-blox 6 | `7.03 (45969)`, protocol 14 |
| `00070000` | u-blox 7 | `1.00 (59842)`, protocol 14 |
| `00080000` | u-blox M8 | `ROM CORE 3.01 (107888)`, protocol 18 or later. A module with flash (e.g. NEO-M8N) adds an `FWVER=SPG 3.01` line |
| `00190000` | u-blox M9 | `ROM SPG 4.04`, protocol 32 |
| `000A0000` | u-blox M10 | `ROM SPG 5.10`, protocol 34 |

Warning signs:

- **`HW 00080000` with `SW 2.01 (75331)` and `PROTVER 15.00`.** This is the first M8 ROM,
  from 2014–15. Clone M8 chips report exactly this. A board made in recent years with this
  version is very likely a clone.
- **No `FWVER` line** on a module sold as NEO-M8N. The genuine NEO-M8N has flash, so it
  reports its flash firmware.
- **No reply to `MON-VER` at all.** Every genuine u-blox 6 or later answers it. Clones built
  on other chips (e.g. AT6558) often speak NMEA only.

### Constellations (`UBX-MON-GNSS`)

Genuine M8 with ROM 3.01 supports GPS, GLONASS, BeiDou and Galileo. ROM 2.01 has no Galileo.
In that case the stratux Galileo setting does nothing.

### Unique chip ID (`UBX-SEC-UNIQID`)

Genuine firmware with protocol 18 or later returns a 5-byte ID. If the receiver claims
protocol 18+ but gives no ID, it is a red flag. With protocol 15 no reply is normal.

### Port configuration (`UBX-CFG-PRT`)

The baud rate the receiver reports must match the rate the script is actually talking at.
A genuine receiver applies a baud change immediately. If it reports one rate while talking
at another, its firmware does not follow the u-blox protocol.

### Antenna and signal (`UBX-MON-HW`, `UBX-NAV-SAT`)

These rate the installation as much as the chip, so judge them only with open sky:

- Antenna `OK` and power `ON` for an active antenna. `SHORT` or `OPEN` is a wiring fault.
- Jamming indicator: below about 50 of 255 is quiet; above 100 something is interfering.
- C/N0: with open sky, satellites above 30° elevation should be at **40–50 dB-Hz**. Readings
  that stay below about 30 dB-Hz, or satellites high in the sky that show 0, mean a poor
  receiver, a poor antenna or a blocked view.

### What the test cannot prove

A good clone can pass every check, and a genuine 2014 chip fails the version check as well.
The result tells you how far to trust the part. To settle it, look at the module:

- The laser marking on the shield or chip: a genuine module has a sharp u-blox logo, the
  full type code (e.g. `NEO-M8N-0-10`) and a 2D code. Clone markings are often blurry or
  printed with ink.
- A NEO-M8N needs a separate SPI flash chip next to the u-blox chip. If there is none, the
  module is not a NEO-M8N.
- Board names that are sold at very low prices (e.g. "GPYes", "RY83xAI") should be treated
  as suspect until checked.

## Example: suspected clone in the RB-01 reference unit (2026-11-18)

The u-blox 8 on the GPIO UART of the RB-01 bench unit, probed with stratux stopped:

```
== UBX-MON-VER (firmware and hardware version)
  SW  2.01 (75331)
  HW  00080000
  EXT PROTVER 15.00
  EXT GPS;SBAS;GLO;BDS;QZSS
  (no FWVER line: running from ROM, no flash)

== UBX-MON-GNSS (supported constellations)
  supported: GPS, GLONASS, BeiDou
  enabled:   GPS, GLONASS
  (no Galileo support)

== UBX-SEC-UNIQID (unique chip ID, protocol 18 and later)
  no reply

== UBX-CFG-PRT (port configuration as the receiver reports it)
  UART1: portID 1 baud 115200 inProto 0x3 outProto 0x2

== UBX-MON-HW (antenna, noise, jamming)
  antenna OK, power ON, noise 85, AGC 2808/8191, jamming indicator 49/255

== UBX-NAV-PVT (fix)
  fix type 3, satellites used 7, UTC 2026-11-18 18:28:44

== UBX-NAV-SAT (satellites)
  27 satellites
    GPS      sv  18  C/N0  0 dBHz  elev   78  used 0
    GPS      sv  28  C/N0 30 dBHz  elev   26  used 1
    GPS      sv  31  C/N0 30 dBHz  elev   40  used 1
    GLONASS  sv  17  C/N0  0 dBHz  elev   62  used 0
    ...
```

What it shows:

| Finding | Why it matters |
|---|---|
| ROM 2.01 (75331), protocol 15.00 | The M8 version that clones copy. Genuine M8 parts made in recent years report ROM 3.01 |
| No flash | Settings cannot be saved to flash, so stratux must configure the receiver again at every power-up |
| No Galileo | One constellation fewer than a genuine current M8, so fewer satellites |
| **Reported 115200 baud while talking at 9600** | On the first run the receiver answered at 9600 baud but `CFG-PRT` said 115200. About 2 minutes later it switched to 115200 by itself, with no command sent to it. A genuine receiver never does this |
| Best signal 30 dB-Hz; satellites at 78° and 62° elevation received at 0 | With open sky they should be at 40–50 dB-Hz. The unit may not have had a clear sky view, so this point needs a repeat outdoors before blaming the chip |
| 4 satellites and no fix on the first run, 45 min after power-up | Same caveat about sky view; it matches the "receiver alive but only a few satellites" symptom in [gps.md](gps.md#symptom-receiver-alive-but-only-a-few-satellites) |

**Verdict:** a poor receiver and a probable clone. The version, the missing flash and the
missing Galileo match the clone fingerprint. The baud mismatch shows firmware that does not
follow the u-blox protocol. The physical marking has not been checked yet.

Consequences for the RB-01:

- The delayed baud switch can confuse stratux autodetection, which runs only once at start
  (see the race described in [gps.md](gps.md#tips)). If the receiver is still at 9600 when
  stratux probes it, the session can be configured wrongly.
- Do not expect Galileo or a chip ID from this part.
- For replacement hardware, ask for a genuine NEO-M8N (ROM CORE 3.01, `FWVER=SPG 3.01`) or a
  u-blox M9/M10 module, and run this test when it arrives.
