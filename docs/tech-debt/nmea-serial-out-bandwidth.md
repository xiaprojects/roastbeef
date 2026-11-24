# NMEA serial out: what is sent, how often, how many bytes

First analysis for splitting the NMEA output channel. The data comes from the 2026-11-20 and
2026-11-21 flights of I-RVDX (`test-data/20261121/flightlog-*.sqlite`). Each sentence is
rebuilt from the flight's own values with [tools/nmea_out_budget.py](../../tools/nmea_out_budget.py),
so the byte counts are real lengths. The rates come from the code.

## 1. One channel carries everything

Every `sendNetFLARM()` call goes to every output with capability `NETWORK_FLARM_NMEA` (8). On the
aircraft that means `/dev/serialout_nmea0` (9600 baud, which links to `/dev/ttyACM1`),
`/dev/serialout_nmea1` (115200), UDP :2000 and both BLE outputs. No port can choose its sentences.

| Use case | Sentences | Rate | Source |
|---|---|---|---|
| GPS (needed by every receiver) | `$GPRMC`, `$GPGGA`, `$PGRMZ`, `$GPGSA` (a fixed string) | 1 Hz | `heartBeatSender`, gen_gdl90.go:828 |
| FLARM traffic | `$PFLAA` for **each** current target, `$PFLAU` | 1 Hz | `sendTrafficUpdates`, traffic.go:415/442 |
| EMS slave | `$RBEMS` | **5 Hz** | ems.go:173, 200 ms loop |
| | `$RBCYL` | 0.5 Hz | ems.go:175 |
| AHRS (Levil format) | `$RPYL` | **20 Hz** | `makeAHRSLevilReport`, called from the 50 ms sensor loop (sensors.go:688) |
| AHRS slave RB-09 | `$RBATT`, `$RBAIR` | 1 Hz (`SlaveNMEADisplay_SleepMs`) | slavenmeadisplay.go:115 |
| Autopilot (G5) | `$GPRMB`, `$GPAPB`, `$GPBOD`, `$GPXTE`, `$PGRMH` | 1 Hz, only while a route is active | autopilot.go:185-212 |
| Pass-through | UDP :1234 / BLE `$GPRMB`, `$PGRMH`, … | as received | autopilotudp.go:374, network.go:432 |
| Radio | `$PGRMC` | on a frequency change | radio.go:323 |

The autopilot was **not** active in either flight: the journal has no `$GPRMB`.

## 2. Measured bandwidth (airborne, GS ≥ 40 kt)

Bytes per second, sentence lengths including `*hh\r\n`. On the wire 8N1 costs 10 bits per byte,
so a port carries `baud / 10` bytes per second: **9600 baud = 960 B/s**.

| Group | Sentence | 11-21 flight 1 | 11-21 flight 2 | Example |
|---|---|---:|---:|---|
| GPS | RMC 73 + GGA 75 + PGRMZ 20 + GSA 39 | 206 | 207 | `$GPRMC,114618.00,A,4256.22116,N,01242.69173,E,41.8,171.3,211126,,,A*67` |
| FLARM | PFLAA (≈ 62 B × targets) | 248 | 581 | `$PFLAA,0,-2922,-21345,941,1,3007C0!IGDEL,14,0,70,-3.3,9*6C` |
| | PFLAU | 27 | 27 | `$PFLAU,6,1,2,1,0,,0,,,*4A` |
| EMS | RBEMS 31 B × 5 | 160 | 155 | `$RBEMS,48,0,77,0,0,15,0,0,0*6F` |
| | RBCYL 39 B × 0.5 | 20 | 20 | `$RBCYL,145,134,0,137,538,549,546,0*44` |
| AHRS | RPYL ≈ 34 B × 20 | **700** | **676** | `$RPYL,17,47,1716,43,-15,916,0*1F` |
| AHRS slave | RBATT 71 + RBAIR 37 | 108 | 107 | `$RBATT,1.66,4.74,188.38,0.913,-0.069,0.000,0.00,0.00,0.00,,,,,,,,*76` |
| **Total as flown** | | **1469** | **1772** | |
| Autopilot, if active | RMB 73 + APB 51 + BOD 32 + XTE 24 + PGRMH 49 | +229 | +229 | |
| **Total with autopilot** | | **1698** | **2001** | |

On the 2026-11-20 flight the total was 1650 B/s (1879 B/s with the autopilot).

Traffic count: 3.9, 9.3 and 7.2 `$PFLAA` per second on average across the three flights, with
peaks of 8, 13 and 11. **No range filter applies**: every current 1090ES target is sent, airliners
50 km away included (`RadarRange` filters only the radar page). Within 10 km and ±3000 ft there
were 0, 0.5 and 0 targets on average, 2 at most.

Load per port speed (flight 2, the busiest):

| Baud | B/s | Load as flown | With autopilot |
|---:|---:|---:|---:|
| 4800 | 480 | 369 % | 417 % |
| **9600** | **960** | **185 %** | **208 %** |
| 19200 | 1920 | 92 % | 104 % |
| 38400 | 3840 | 46 % | 52 % |
| 115200 | 11520 | 15 % | 17 % |

`$RPYL` alone uses 73 % of a 9600 port. The budget in
[nmea-navigation-output.md §7](../integration/nmea-navigation-output.md) left out `$RPYL`,
`$RBEMS`/`$RBCYL` and `$RBATT`/`$RBAIR`. It counted about 835 char/s, while about 2000 actually
go out.

## 3. What saturation does: the data arrives about 20 s late

The `MessageQueue` was built to cope with a slow link. It sends by priority (`$GPRMC` −1, then 0,
traffic by distance, `$RPYL`/`$RBATT` 4) and drops a sentence once its `maxAge` (100 ms to 1 s)
has passed. On a serial port that logic never runs while it matters:

1. `connectionWriter` takes about 128 B from the queue (`GetDesiredPacketSize`) and calls
   `Write()`. The kernel accepts it at once into the tty/USB driver buffer.
2. The queue is therefore always empty, and nothing in it ever expires or loses to a higher
   priority. Every sentence goes into the kernel FIFO in arrival order.
3. The FIFO fills at about 1.8 kB/s and drains at 0.96 kB/s. `Write()` blocks once it is full.
   Only then does the queue start dropping, and by that point every byte on the wire is as old
   as the FIFO is long.

`ttyACM1` is a cdc-acm device. That driver buffers 16 URBs × 20 × wMaxPacketSize, which is
20 KB with 64-byte packets: **about 21 s at 9600 baud**. That matches the 18–20 s stratux stop
seen whenever the GPS has a fix (the kernel drains this buffer on close, see the 2026-11-21
findings). With no fix there are no traffic positions and RMC/GGA are short, so the stream stays
under 960 B/s, the FIFO stays nearly empty and the stop takes 0–3 s. The packet size of this CH9102 has not been read on the device yet: check it with
`lsusb -v -d 1a86:55d4` and `ioctl TIOCOUTQ` in flight.

What follows for each receiver at 9600:

- **G5 / autopilot**: position and the steering sentences are about 20 s old. The G5 still
  receives valid sentences, so it raises no flag, but the guidance is wrong.
- **FLARM display**: the traffic picture is about 20 s old, which is worse than none.
- **Slave displays**: the attitude lags 20 s. RB-09 reports INOP after 1 s without `$RBATT`.
  At 1 Hz with jitter the margin is already zero, even without the backlog.

The FLARM serial input (`FlarmSerialInDevice`) opens the same `/dev/ttyACM1` at 38400. The port
speed is whichever opened last.

## 4. What each use case needs on its own port

| Port profile | Sentences | B/s | Load at 9600 |
|---|---|---:|---:|
| Autopilot (G5) | RMC, GGA, GSA + RMB, APB, BOD, XTE, PGRMH @ 1 Hz | ≈ 415 | 43 % |
| Autopilot, minimum | RMC, GGA + RMB, APB | ≈ 270 | 28 % |
| FLARM traffic | RMC, GGA, PGRMZ + PFLAU + PFLAA within range (FLARM-like ≤ 10 km / ±3000 ft or the N closest, e.g. 5) | 195 + 62 × N, ≈ 505 with N = 5 | 53 % |
| EMS slave | RBEMS @ 5 Hz + RBCYL @ 0.5 Hz | 175 | 18 % |
| EMS slave @ 2 Hz | | 82 | 9 % |
| AHRS slave, Levil `$RPYL` @ 20 Hz | | 700 | 73 % |
| AHRS slave `$RPYL` @ 10 Hz / 5 Hz | | 350 / 175 | 36 % / 18 % |
| AHRS slave RB-09 `$RBATT` @ 5 Hz + `$RBAIR` @ 1 Hz | | 390 | 41 % |

Each profile fits into 9600 on its own. All of them together never will, and a dual-purpose
port (G5 plus anything else) is the case that breaks today.

## 5. Directions to evaluate

Ordered by what it buys:

1. **Pace serial writes to the baud rate** (a token bucket in `serialConnection`, or wait until
   `TIOCOUTQ` drops below about 100 B before `Write()`). The kernel then holds at most a fraction
   of a second, and the existing priority and expiry queue does its job: when a port is
   overloaded it loses the oldest, least important sentences instead of delaying all of them
   by 20 s. This is the one change that makes any overload safe.
2. **Per-port sentence selection**: replace the single capability bit 8 with a set (GPS,
   AUTOPILOT, FLARM, EMS, AHRS_RPYL, AHRS_RB09, PASSTHRU) plus a per-port rate for the fast ones.
   The default for a 9600 port should be GPS + AUTOPILOT only.
3. **Range-filter `$PFLAA`** (FLARM's own range, or the N closest by `computeTrafficPriority`).
   On these flights that sends 0–2 targets instead of 4–13.
4. **Rate-limit `$RPYL`** (setting, default 5–10 Hz), and lower the default `$RBEMS` rate to
   1–2 Hz. Engine values change slowly.
5. **Give the FLARM serial input its own device** instead of `ttyACM1` (open since 2026-11-21).
6. Minor points: the UDP pass-through ends lines with `\n` only (autopilotudp.go:374/386), and
   `$GPGSA` is a fixed placeholder that receivers needing fix quality can misread.

Reproduce: `python3 -I tools/nmea_out_budget.py <flightlog.sqlite> [min_gs_kt]`.

## 6. Plan: make a 9600 port work

Reference load: the busiest flight (11-21 flight 2) with the autopilot active, **2001 B/s = 208 %**
of a 9600 port. Target: below 70 % (670 B/s) for every profile, and no backlog when a port
overloads anyway.

### 6.1 Global optimizations (every port, no new settings)

| # | Change | Where | Saves (B/s) | Risk |
|---|---|---|---:|---|
| O1 | Pace serial writes to `baud/10` (token bucket in `connectionWriter` for `serialConnection`, burst ≤ 0.2 s) | clientconnection.go, network.go:563 | latency 20 s → < 0.5 s | none: no other port slows down, the queue's priority and `maxAge` start working |
| O2 | `$RPYL` 20 → 5 Hz by default (send every 4th sensor tick, setting `RPYL_Hz`, 0 = off) | sensors.go:688, flarm-nmea.go:463 | 507 | Levil receivers interpolate; check the RB-09/EFIS attitude at 5 Hz |
| O3 | `$RBEMS` 5 → 1 Hz (setting `EMS_NMEA_Hz`); `$RBCYL` stays at 0.5 Hz | ems.go:173 | 124 | none: rb-ems-go itself posts some values only on change |
| O4 | Range filter for `$PFLAA`: FLARM range (10 km, ±3000 ft, settings) and at most N closest (default 5, by `computeTrafficPriority`) | traffic.go:415 | 457 typical (581 → 124), worst case 271 | none for FLARM displays: real FLARM never reports airliners 50 km away |
| O5 | `$GPBOD` only on a leg change and every 10 s (it has no status field and changes only per leg) | autopilot.go:198 | 29 | the G5 must keep the course pointer between bursts: bench test B6 |

Not worth doing: shorter lat/lon (5 → 4 decimals saves 8 B/s), trimming `$RBATT` empty fields
(8 B/s).

O1 to O4 together give **913 B/s = 95 %**: still too much for one port carrying everything. Per-port
selection is needed as well.

### 6.2 Per-port sentence groups (question 2: yes)

The filter fits in one place: `sendMsg()` already loops over every connection and checks
`Capabilities()`. Add a second check there.

1. **Groups** (bit set, `NMEA_*`):

   | Group | Sentences |
   |---|---|
   | `GPS` | `$GPRMC`, `$GPGGA`, `$PGRMZ` |
   | `GSA` | `$GPGSA` (fixed placeholder, see §5.6) |
   | `FLARM` | `$PFLAA`, `$PFLAU` |
   | `AUTOPILOT` | `$GPRMB`, `$GPBOD`, `$PGRMH` (the three the G5 reads) |
   | `AUTOPILOT_EXTRA` | `$GPAPB`, `$GPXTE` (other autopilots and EFBs) |
   | `EMS` | `$RBEMS`, `$RBCYL` |
   | `AHRS_LEVIL` | `$RPYL` |
   | `AHRS_RB09` | `$RBATT`, `$RBAIR` |
   | `RADIO` | `$PGRMC` |
   | `PASSTHRU` | everything relayed from UDP/BLE (autopilotudp.go, network.go:432) |

2. **Call sites** pass the group explicitly: `sendNMEA(group, msg, maxAge, prio)`, with
   `sendNetFLARM` kept as a wrapper. There are 22 call sites. Sorting by prefix inside `sendMsg`
   would avoid touching them, but relayed sentences can carry any prefix (`$GPRMB` from an
   external navigator must stay `PASSTHRU`), so the caller decides.
3. **Settings**: `serialConnection` gets `NMEAGroups uint32` and optional `RPYL_Hz`/`EMS_Hz`
   per port. A per-port rate becomes a "last put per group" timestamp in the connection, checked
   in `sendMsg`. **`NMEAGroups == 0` means all groups**, so existing `settings.json` files and
   TCP/UDP :2000 and BLE keep today's behaviour.
4. **UI**: under each serial port set to FLARM NMEA, one checkbox per group and a live estimate,
   e.g. "≈ 510 B/s of 960 (53 %)", from the per-group figures in §2. Show it in red above 70 %.
   The estimate uses fixed figures (5 traffic targets), not live counters.
5. **Status**: count per-port bytes written and sentences dropped by `maxAge`, and show them on the
   status page, so an overloaded port can be seen without a logic analyser.

Resulting profiles at 9600 (O1–O5 applied):

| Port use | Groups | B/s | Load |
|---|---|---:|---:|
| G5 only | GPS + AUTOPILOT | 206 + 154 = 360 | 38 % |
| G5 + FLARM display | GPS + AUTOPILOT + FLARM (2 typical / 5 worst targets) | 511 / 697 | 53 % / 73 % |
| FLARM display only | GPS + FLARM | 357 / 543 | 37 % / 57 % |
| RB-09 slave | GPS + AHRS_RB09 + EMS | 206 + 108 + 51 = 365 | 38 % |
| Levil AHRS slave | AHRS_LEVIL @ 5 Hz | 170 | 18 % |

The worst-case G5 + FLARM display sits at the 70 % line. N = 3 brings it to 573 B/s (60 %).

### 6.3 Autopilot rate (question 3: no, keep 1 Hz)

The autopilot is not what fills the port: 229 of 2001 B/s (11 %). The fixes:

- **Below 1 Hz** saves at most 115 B/s at 0.5 Hz, but the CDI and the glide indicator then move in
  2 s steps, and the G5's own "no data" timeout has not been measured. That is a bench
  question (B6), not something to change blind. `$GPRMC`/`$GPGGA` still have to be at 1 Hz
  for the G5's position anyway.
- **Fewer sentences per burst** saves the same amount with no loss of guidance: on a G5-only port,
  dropping `AUTOPILOT_EXTRA` (APB, XTE) saves 75 B/s, and O5 (`$GPBOD` on change) saves another
  29. The burst goes from 229 to 125–154 B/s.
- What really harms guidance today is the 20 s backlog, not the rate. O1 fixes that. With O1,
  the autopilot's `maxAge` of 1 s means an overloaded port drops an old burst instead of
  sending it late.

Keep `Autopilot_NavRateHz` (N5, 1–5 Hz) as specified, and make the UI estimate warn when
5 Hz does not fit the port.

### 6.4 Order of work

| Step | Content | Test |
|---|---|---|
| 1 | O1 write pacing | unit test with a fake 960 B/s writer: at 2000 B/s offered, latency stays < 0.5 s and the drops are the low-priority sentences. On the aircraft: `TIOCOUTQ` stays small, and stratux stops in < 3 s with a fix |
| 2 | O2, O3, O4 defaults | `nmea_out_budget.py` with the new rates and filter on the three flights |
| 3 | Groups, per-port settings, UI estimate, status counters | `sendMsg` filter tests; settings migration (`0` = all); display test for the checkboxes |
| 4 | O5 `$GPBOD` on change | G5 bench test B6 |
| 5 | Separate device for the FLARM serial input (§5.5) | independent, but needed before ttyACM1 is a clean output |

### 6.5 Open decisions

- **Defaults for an existing 9600 port**: keep "all" (no surprise, still overloaded but no
  backlog after O1), or migrate a 9600 NMEA port to GPS + AUTOPILOT + FLARM on first start.
- **Defaults for O2/O3**: 5 Hz `$RPYL` and 1 Hz `$RBEMS` everywhere, or only on ports ≤ 19200.
- **`$PFLAA` limit**: N = 5 or N = 3 by default.
- **`!TAIL` suffix in `$PFLAA` IDs** (flarm-nmea.go:73, 240): this is a Stratux extension, not
  FLARM. It could be a per-port option for strict FLARM displays (≈ 6 B per target).

## 7. Plan: capability `NETWORK_FLARM_NMEA_9600`

**Status 2026-11-23: implemented as below (uncommitted), tests in `main/network_test.go` (routing, `$RPYL`, `$RBEMS`/`$RBCYL`) and
`TestSlaveNMEADisplayLoop`. Not yet tried on the aircraft. §7.4 (pacing, traffic filter) is still open.**

A reduced copy of `NETWORK_FLARM_NMEA` that a serial port can pick instead of the full one.
It sends everything except the RB sentences `$RPYL`, `$RBEMS`, `$RBCYL`, `$RBATT` and `$RBAIR`. On the 11-21 flight 2 that
is **87 %** of a 9600 port as flown and **111 %** with the autopilot active. `$PFLAA` alone is
60 %.

### 7.1 Sentences

| Sentence | `NETWORK_FLARM_NMEA` (8) | `NETWORK_FLARM_NMEA_9600` (64) |
|---|---|---|
| `$GPRMC`, `$GPGGA`, `$PGRMZ`, `$GPGSA` | 1 Hz | 1 Hz |
| `$PFLAA`, `$PFLAU` | 1 Hz | 1 Hz |
| `$GPRMB`, `$GPBOD`, `$PGRMH`, `$GPAPB`, `$GPXTE` | 1 Hz | 1 Hz |
| `$PGRMC`, pass-through | as sent | as sent |
| `$RPYL` | 20 Hz | **–** |
| `$RBEMS` | 5 Hz | **–** |
| `$RBCYL` | 0.5 Hz | **–** |
| `$RBATT`, `$RBAIR` | 1 Hz | **–** |

### 7.2 Code changes

1. **network.go:47** — `NETWORK_FLARM_NMEA_9600 = 64`. The field stays `uint8` (bits 1–64 used,
   128 free).
2. **network.go:624** — the routing goes into the senders, with no per-message parsing:
   - `sendNetFLARM(msg, maxAge, prio)` sends with `NETWORK_FLARM_NMEA | NETWORK_FLARM_NMEA_9600`.
     Every sentence not listed in 7.1 keeps reaching both capabilities with no change at
     its call site.
   - New `sendNetFLARMFull(msg, maxAge, prio)` sends with `NETWORK_FLARM_NMEA` only. It shares
     the loop-back bookkeeping (`avoidLoopBackMap`) with `sendNetFLARM`.
   - `sendMsg` tests `Capabilities() & msgType != 0` once per connection, so a port that has both
     bits gets each sentence once.
3. **ems.go:174, 176** — `$RBEMS` and `$RBCYL` via `sendNetFLARMFull`.
4. **slavenmeadisplay.go:115, 118** — `$RBATT` and `$RBAIR` via `sendNetFLARMFull`.
5. **flarm-nmea.go:463** — `$RPYL` via `sendNetFLARMFull`. A Levil AHRS receiver needs a
   port with capability 8.
6. **web/plates/settings.html:274** — option `64` "FLARM NMEA 9600 (reduced)". No change in
   managementinterface.go:2257, which already stores any `uint8`.
7. **Defaults stay as they are**: new `/dev/serialout_nmea*` ports still get
   `NETWORK_FLARM_NMEA` at 38400 (network.go:173). TCP/UDP :2000 and the BLE outputs
   (gen_gdl90.go:1455–1465) keep `NETWORK_FLARM_NMEA`. The owner picks 64 for a 9600 port.

### 7.3 Tests

| Test | Checks |
|---|---|
| `sendNetFLARM` / `sendNetFLARMFull` with three capture connections (8, 64, 8 \| 64) | 64 never gets `$RPYL`, `$RBEMS`, `$RBCYL`, `$RBATT` or `$RBAIR`; 8 \| 64 gets each sentence once |
| Existing tests (`sensors_test.go:986`, `traffic_test.go:759`) | unchanged, they use bit 8 |
| Replay, port at 9600 with capability 64 | about 830 B/s as flown, 1060 B/s with the autopilot |
| Aircraft | `ttyACM1` with 64: stratux stops in < 3 s with a fix, the G5 shows guidance with no lag |

### 7.4 Limits of this capability on its own

- **With the autopilot and heavy traffic, it is still above 100 %**, so the 20 s backlog of §3 comes
  back. Combine it with the write pacing of §6.1 (O1). Then an overload loses sentences
  instead of delaying them.
- To get under 70 % the 64 capability can also apply the `$PFLAA` range filter (O4, 63 %
  typical) and drop `$GPAPB`/`$GPXTE` (55 %). These are optional extensions of the same
  capability: once the routing in 7.2 exists, `$GPAPB`/`$GPXTE` move to `sendNetFLARMFull`, and `$PFLAA` targets out of range or beyond the N closest go out through `sendNetFLARMFull` too.
- A future sentence sent with `sendNetFLARM` reaches the 9600 port automatically. A high-rate
  sentence must use `sendNetFLARMFull`. Note this at `sendNetFLARM`.
