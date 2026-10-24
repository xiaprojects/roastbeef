# Software High-Level Requirements — Traffic (`TRF`)

Function: receive traffic from the 978 UAT, 1090 ES, OGN/FLARM and AIS sources; fuse them
into one target table; age and dead-reckon the targets; present them to EFB clients, to the
radar display and to the web UI.

Recovered from `main/traffic.go`, `main/gen_gdl90.go` and `main/flarm-nmea.go` under
DO-178C §12.1.4, against the GDL 90 Data Interface Specification (560-1058-00 Rev A) and
the behaviour pinned by `main/traffic_test.go`. Rules and field definitions:
[`../docs/certification/standards/requirements.md`](../docs/certification/standards/requirements.md).

Code references in **Source** name the function, not a line number, so the trace survives
a refactor.

---

## Reception and decoding

### RB-HLR-TRF-010 — UAT downlink decoding fidelity

**The system shall decode from a 978 MHz UAT downlink frame the target's address, address
qualifier, latitude, longitude, altitude, altitude type, ground speed, track, vertical
speed, emitter category, callsign, NIC and NACp, with no field differing from an
independent decode of the same frame by more than the resolution of that field.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/traffic.go` `parseDownlinkReport()`; verified against `dump978/uat2text`
- **Verification:** test
- **Derived:** no

Track is truncated to whole degrees, so a sub-degree difference is within the field's
resolution and is not a failure.

### RB-HLR-TRF-020 — Barometric altitude is preferred for UAT targets

**The system shall present a UAT target on pressure altitude when the frame's primary
altitude is geometric and an AUXSV element carries a barometric altitude, and shall record
the difference between the geometric and barometric values.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/traffic.go` `parseDownlinkReport()`; DO-282B AUXSV
- **Verification:** test
- **Derived:** no

Every other source reports pressure altitude; mixing altitude references in one target
table would make relative altitude meaningless.

### RB-HLR-TRF-030 — Surface track decoding covers the full circle

**The system shall decode a UAT surface target's 9-bit track field as `h × 360 / 512`
degrees truncated to whole degrees, for all 512 values, yielding a track of 0° to 359°.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/traffic.go` `parseDownlinkReport()`; DO-282B surface state vector
- **Verification:** test
- **Derived:** no

Reverse-engineered after a defect: tracks of 128° and above wrapped, so 207° was presented
as 79°.

### RB-HLR-TRF-040 — Address qualifier determines target type

**The system shall set the target type from the UAT address qualifier as: 0 → ADS-B,
2 → ADS-R when the target reports NIC ≥ 7 and an emitter category and TIS-B otherwise,
3 → TIS-B, 6 → ADS-R.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/traffic.go` `parseDownlinkReport()`; DO-282B §2.2.4.5.1.2
- **Verification:** test
- **Derived:** no

Qualifier 2 is ambiguous in the wild; NIC and emitter category are used to separate a
rebroadcast ADS-B target from a radar track. This is a design decision, not a flow-down
from the standard — see the FHA entry for the derived requirements of this function.

### RB-HLR-TRF-050 — Malformed UAT input is discarded

**The system shall discard a UAT input line that is not a complete frame, shall create no
target from it, and shall not terminate.**

- **Parent:** RB-SYS-TRF-030
- **Source:** `main/traffic.go` `parseInput()`
- **Verification:** test
- **Derived:** no

Noise, a truncated or merged line on the Ping/Pong serial link, or an edited replay log.
The daemon is one process, so a panic here takes the attitude display with it.

### RB-HLR-TRF-060 — 1090 ES messages fuse into one target

**The system shall maintain one target per 1090 ES address, each field holding the most
recent value received for that field, across identity, airborne position, Mode S altitude
reply, identity reply, airborne velocity and operational status messages.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/traffic.go` `esListen()`; DO-260B
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-070 — Mode S targets without position are tracked by altitude

**The system shall track a 1090 ES target that reports no position using its altitude
replies alone, shall leave its position invalid, shall advance its last-seen time on each
altitude reply, and shall estimate its distance from received signal level.**

- **Parent:** RB-SYS-TRF-010
- **Source:** `main/traffic.go` `esListen()`, `estimateDistance()`
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-080 — Receiver heartbeat and non-ICAO addresses

**The system shall not create a target from the 1090 ES receiver's heartbeat address
0x07FFFFFF, and shall clear bit 24 of a received address before using it.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/traffic.go` `esListen()`; bit 24 marks a TIS-B track number
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-090 — Malformed 1090 ES input is discarded

**The system shall discard a 1090 ES input line that is not a well-formed message object,
shall create no target from it, and shall not terminate.**

- **Parent:** RB-SYS-TRF-030
- **Source:** `main/traffic.go` `esListen()`
- **Verification:** test
- **Derived:** no

---

## Identity

### RB-HLR-TRF-100 — US civil registration lookup

**The system shall derive the registration of every ICAO address in the US civil block
A00001 to ADF7C7 as the N-number the FAA assigns to that address, and shall derive no
registration for addresses above ADF7C7.**

- **Parent:** RB-SYS-TRF-010
- **Source:** `main/traffic.go` `icao2reg()`; FAA address allocation
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-110 — Canadian civil registration lookup

**The system shall derive the registration of every ICAO address in the Canadian civil
block, the first and last of which are C-FAAA and C-IZZZ.**

- **Parent:** RB-SYS-TRF-010
- **Source:** `main/traffic.go` `icao2reg()`
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-120 — No registration outside the civil blocks

**The system shall derive no registration for an ICAO address outside the US and Canadian
civil blocks.**

- **Parent:** RB-SYS-TRF-010
- **Source:** `main/traffic.go` `icao2reg()`
- **Verification:** test
- **Derived:** no

Presenting a guessed registration for a foreign or non-civil address would be misleading
information about identity.

---

## Ownship

### RB-HLR-TRF-130 — An ownship code is accepted as ownship only when co-located

**The system shall treat a report carrying a configured ownship address as ownship only
while that report's position agrees with the current own position, shall present a report
carrying an ownship address from elsewhere as traffic, and shall present a report carrying
an ownship address whose position cannot be checked as neither ownship nor traffic.**

- **Parent:** RB-SYS-TRF-040
- **Source:** `main/traffic.go` `isOwnshipTrafficInfo()`
- **Verification:** test
- **Derived:** no

The same address can legitimately appear elsewhere — another aircraft the pilot also flies,
airborne at the same time — and must not blank the real target.

### RB-HLR-TRF-140 — Ownship is not presented as traffic

**The system shall not transmit, display on the radar, or log as traffic a report
identified as ownship, and shall retain it as the ownship report instead.**

- **Parent:** RB-SYS-TRF-040
- **Source:** `main/traffic.go` `trafficCycle()`
- **Verification:** test
- **Derived:** no

---

## Currency and ageing

### RB-HLR-TRF-150 — Currency limit for received positions

**The system shall transmit a target's position to EFB clients and to the radar display
only while the position is less than 6 s old, and shall continue to make the target's
growing age available to the web UI after that.**

- **Parent:** RB-SYS-TRF-020
- **Source:** `main/traffic.go` `trafficCycle()`
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-160 — Currency limits for dead-reckoned positions

**The system shall transmit a dead-reckoned position, flagged as extrapolated, only while
the extrapolation is less than 2 s old and the last received position is less than 25 s
old.**

- **Parent:** RB-SYS-TRF-020
- **Source:** `main/traffic.go` `trafficCycle()`
- **Verification:** test
- **Derived:** no

The 25 s limit is the point past which a dead-reckoned position is judged to carry no
useful information. The value is a design decision with no source in a standard — see the
FHA derived-requirements list.

### RB-HLR-TRF-170 — Target table retention

**The system shall retain a target in the table for 60 s after it was last heard, and an
AIS vessel for 15 minutes, and shall then delete it.**

- **Parent:** RB-SYS-TRF-020
- **Source:** `main/traffic.go` `cleanupOldEntries()`
- **Verification:** test
- **Derived:** no

Retention past the currency limit of RB-HLR-TRF-150 keeps identity — callsign,
registration, emitter category — across a short reception gap. AIS vessels report far less
often, hence the longer retention.

### RB-HLR-TRF-180 — Age is published while a target is inactive

**The system shall publish a target's age to the web UI while the target is more than 2 s
old, including while no new report is being received for it.**

- **Parent:** RB-SYS-SYS-020
- **Source:** `main/traffic.go` `trafficCycle()`
- **Verification:** test
- **Derived:** no

Without this the web UI shows a target frozen at the age it had when it stopped being
heard, which is misleading about currency.

---

## Dead reckoning

### RB-HLR-TRF-190 — Position extrapolation

**The system shall extrapolate a target's position from its last received position by its
reported ground speed, track and vertical speed, shall retain the last received position
unchanged, and shall base each extrapolation step on the previous extrapolated position.**

- **Parent:** RB-SYS-TRF-020
- **Source:** `main/traffic.go` `extrapolateTraffic()`
- **Verification:** test
- **Derived:** no

Basing each step on the previous extrapolation rather than on the fix is what stops the
same elapsed time being applied twice.

### RB-HLR-TRF-200 — Turn is carried through extrapolation

**The system shall apply a target's last reported turn rate while extrapolating, and shall
present the resulting track in the range 0° to less than 360°.**

- **Parent:** RB-SYS-TRF-020
- **Source:** `main/traffic.go` `extrapolateTraffic()`
- **Verification:** test
- **Derived:** no

---

## Presentation

### RB-HLR-TRF-210 — Radar display limits

**The system shall send to the radar display only targets whose altitude is within
1.3 × `RadarLimits` of own altitude and, when a position is available, whose distance is
within 1.3 × `RadarRange`, and shall apply these limits to the radar display only.**

- **Parent:** RB-SYS-TRF-010
- **Source:** `main/traffic.go` `trafficCycle()`; `docs/settings-reference.md`
- **Verification:** test
- **Derived:** no

The 1.3 factor keeps a target visible while it leaves the selected range, instead of
blinking out at the boundary. EFB output is unfiltered — the EFB applies its own ranges.

### RB-HLR-TRF-220 — Radar altitude band without a baro reading

**The system shall centre the radar altitude band on GPS altitude when no current pressure
altitude is available, both when no pressure sensor has ever reported and when the last
pressure reading is no longer current.**

- **Parent:** RB-SYS-SYS-020
- **Source:** `main/traffic.go` `trafficCycle()`
- **Verification:** test
- **Derived:** no

A frozen pressure altitude would silently shift the whole band; this is the traffic-side
instance of the stale-data rule.

### RB-HLR-TRF-230 — Bearingless target presentation

**The system shall select, from the targets that report no position, the one within 2000 ft
of own altitude with the smallest estimated distance under 15 km, shall transmit it as a
FLARM PFLAA sentence with distance and no bearing, and shall additionally transmit it as
eight GDL90 targets on a circle of that radius when `EstimateBearinglessDist` is enabled.**

- **Parent:** RB-SYS-TRF-010
- **Source:** `main/traffic.go` `trafficCycle()`, `sendBearinglessTraffic()`
- **Verification:** test
- **Derived:** no

The eight-point circle exists for EFBs that cannot draw a range ring. Presenting one target
as eight is a deliberate distortion of the traffic picture and is why it is behind a
setting; it is listed in the FHA derived requirements.

### RB-HLR-TRF-240 — Geometry follows own position

**The system shall recompute each target's distance and bearing from the current own
position on every cycle.**

- **Parent:** RB-SYS-TRF-020
- **Source:** `main/traffic.go` `trafficCycle()`
- **Verification:** test
- **Derived:** no

---

## GDL90 output

### RB-HLR-TRF-250 — Traffic report encoding

**The system shall encode a traffic report in the form specified by the GDL 90 Data
Interface Specification, such that the report produced for the specification's worked
example is byte-identical to the example.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/gen_gdl90.go` `makeTrafficReportMsg()`; GDL90 ICD §3.5.1.3
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-260 — Altitude field encoding

**The system shall encode altitude in 25 ft increments offset by −1000 ft, and shall encode
0xFFF when the altitude is outside −1000 ft to 101 350 ft or unavailable.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/gen_gdl90.go` `makeTrafficReportMsg()`; GDL90 ICD Table 10
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-270 — GNSS height is converted to pressure altitude

**The system shall transmit a target that reports GNSS height above the WGS-84 ellipsoid at
the pressure altitude obtained by subtracting the geoid separation and applying own
aircraft's pressure-altitude-minus-GPS-MSL offset.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/gen_gdl90.go` `makeTrafficReportMsg()`
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-280 — Traffic alert bit

**The system shall set the traffic alert bit for a target within 2 NM, and for a target
whose distance cannot be computed.**

- **Parent:** RB-SYS-TRF-020
- **Source:** `main/gen_gdl90.go` `makeTrafficReportMsg()`
- **Verification:** test
- **Derived:** no

A target of unknown range is never presented as harmless. This is the traffic function's
instance of RB-SYS-SYS-020.

### RB-HLR-TRF-290 — Report flags, vertical speed, priority and callsign

**The system shall encode in the traffic report: a flag for an extrapolated position, a
flag for an on-ground target, vertical speed as a signed 12-bit count of 64 fpm
increments, the priority code in the high nibble of the final byte, and the callsign
truncated to 8 characters with every character other than a digit, a capital letter, a
space and the source-prefix letters `e u a r t` replaced by a space.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/gen_gdl90.go` `makeTrafficReportMsg()`; GDL90 ICD §3.5.1.3
- **Verification:** test
- **Derived:** no

### RB-HLR-TRF-300 — End-to-end reception to output

**The system shall carry a received UAT target's identity, position, altitude and velocity
through to the transmitted GDL90 traffic report to the resolution of the GDL90 fields.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/traffic.go`, `main/gen_gdl90.go`
- **Verification:** test
- **Derived:** no

---

## Status

### RB-HLR-TRF-310 — Target counts by source

**The system shall publish the number of targets being tracked from each receiver.**

- **Parent:** RB-SYS-SYS-020
- **Source:** `main/traffic.go` `trafficCycle()`; `/getStatus`
- **Verification:** test
- **Derived:** no

---

## FLARM NMEA output

### RB-HLR-TRF-320 — FLARM NMEA conformance

**The system shall encode traffic as PFLAA and PFLAU sentences conforming to the FLARM NMEA
data port specification, including the checksum.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/flarm-nmea.go`; `docs/integration/other-transports.md`
- **Verification:** test
- **Derived:** no

Verified field by field in `main/flarm-nmea_test.go`, and in `test/integration/test_daemon.py`
against the GDL90 output of a replayed flight, cycle by cycle. The specification revision is
not named here and should be: the ranges quoted in `flarm-nmea.go` (relative north and east
within ±32 767 m) are exceeded for a target more than 32.8 km away, which the daemon sends
unclamped - 1020 of the 1655 PFLAA in the replayed window, out to 169 km.

---

## Not yet verified

The requirements below are specified but have no test. They are counted in
`untraced.txt`; see the README for how that budget works.

### RB-HLR-TRF-330 — Target count limit

**The system shall limit the number of targets transmitted per cycle so that an EFB client
is not sent more messages than it can process.**

- **Parent:** none
- **Source:** `main/traffic.go` `trafficCycle()` — a code comment records that ForeFlight
  7.5 fails at roughly 1000–2000 messages, with a practical limit near 500 aircraft
- **Verification:** test
- **Derived:** yes

**Recovered with low confidence, and the code does not implement it.** The send loop in
`trafficCycle()` iterates the whole target table with no counter, cap or early exit; the
comment names the hazard without mitigating it. The only bound is implicit — a target is
transmitted while its position is under 6 s old (RB-HLR-TRF-150) — so the number of
messages per cycle is the number of distinct aircraft heard in the last 6 s, which is
precisely the dense-airspace case the comment warns about.

Raised as a problem report rather than written as if the behaviour existed, per §9.1 of the
requirements standard. Before implementing anything, the requirement needs a number: what
the limit should be, and which targets get dropped first when it bites. Dropping the
*furthest* is the obvious answer and is also the one that needs a hazard opinion, since it
means the EFB silently stops showing some traffic — FHA-TRF-1, missing target.

### RB-HLR-TRF-340 — Staleness is visible on the traffic display

**The RB-01 traffic and radar displays shall indicate to the pilot that the traffic picture
is not current within 1 s of the traffic stream stopping.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-TRF-2; FAA PS-AIR-21.8-1602 §1.5
- **Verification:** test
- **Derived:** no

The daemon side of staleness is covered (RB-HLR-TRF-150/160/180); the HMI side is not. The
`test/display/` harness can drive it — a plate's reaction to a socket going silent — but no
such test exists. Same gap as FHA-ATT-3 on the attitude display.
