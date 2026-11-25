# Software High-Level Requirements — Situation (`SIT`)

Function: parse the GPS receiver's NMEA sentences into the ownship position, altitude,
ground speed, track, accuracy and fix validity; derive the GPS vertical speed; age the fix
out; and raise an alert when it is lost. Every other function reads the result: the
attitude takes the track and speed, the speed indication falls back to the ground speed,
the heading to the track, the vertical speed indication to the GPS rate, and the traffic
function places targets against the position.

Recovered from `main/gps.go` (`processNMEALine()`, `isGPSValid()`,
`isGPSGroundTrackValid()`, `calculateNACp()`), `main/gpsvspeed.go`, `main/gpsfixalert.go`
and `main/lastposition.go` under DO-178C §12.1.4, against the behaviour pinned by
`main/gps_test.go`, `main/gpsvspeed_test.go`, `main/gpsfixalert_test.go` and
`main/lastposition_test.go`. Rules and field definitions:
[`../docs/certification/standards/requirements.md`](../docs/certification/standards/requirements.md).

Scope: the sentences an RB-01 receiver sends — GGA, RMC and GST — through the generic NMEA
path. The u-blox UBX binary protocol, the receiver configuration and baud detection, and
the OGN, FLARM and `$PGRMZ` sentences that arrive on the same port are not specified here.

**The currency limit is 3 s, and RB-SYS-SYS-020 says 1 s.** A fix is current for 3 s from
the GGA that reported it (RB-HLR-SIT-070). That is three missed sentences at 1 Hz, which a
1 Hz receiver needs; at the RB-01's 10 Hz it is thirty. RB-SYS-SIT-020 is written, as
RB-SYS-TRF-020 is, against "the currency limit defined for it", so there is no
contradiction in the tree, but the number is the one to challenge: it is also the window in
which the AHRS holds its attitude through a GPS outage (`RB-HLR-ATT.md`), and it is three
times the end-to-end figure the whole safety case rests on.

**And a receiver that says it has no fix is not believed** (RB-HLR-SIT-080). An RMC with
status V and a GGA with quality 0 are dropped as malformed rather than taken at their word,
so the last fix stays current for the rest of its 3 s.

Code references in **Source** name the function, not a line number, so the trace survives
a refactor.

---

## Parsing

### RB-HLR-SIT-010 — Position, fix quality and fix time from GGA

**The system shall take from each valid GGA sentence the latitude and longitude in degrees,
the fix quality and the UTC time of the fix, with the time's decimal seconds optional, and
shall stamp the fix with the time it was received.**

- **Parent:** RB-SYS-SIT-010
- **Source:** `main/gps.go` `processNMEALine()` (GGA branch); NMEA 0183
- **Verification:** test
- **Derived:** no

The position is kept to float32 resolution: 0.4 m of latitude, 1.7 m of longitude past
128°.

### RB-HLR-SIT-020 — Altitudes from GGA

**The system shall take from each valid GGA sentence the altitude above mean sea level and
the geoid separation, converted from metres to feet, and shall set the height above the
ellipsoid to their sum.**

- **Parent:** RB-SYS-SIT-010
- **Source:** `main/gps.go` `processNMEALine()` (GGA branch)
- **Verification:** test
- **Derived:** no

### RB-HLR-SIT-030 — Ground speed and track from RMC

**The system shall take from each valid RMC sentence the ground speed in knots and the true
track in degrees, and shall stamp the ground track with the time it was received.**

- **Parent:** RB-SYS-SIT-010
- **Source:** `main/gps.go` `processNMEALine()` (RMC branch)
- **Verification:** test
- **Derived:** no

The stamp is what the AHRS reads as "a new GPS velocity sample"; RB-HLR-SIT-110 is why
there must be one per fix.

### RB-HLR-SIT-040 — South and west are negative

**The system shall give southern latitudes and western longitudes as negative degrees, and
shall read a longitude with three degree digits, identically from GGA and RMC.**

- **Parent:** RB-SYS-SIT-010
- **Source:** `main/gps.go` `processNMEALine()`
- **Verification:** test
- **Derived:** no

Every recorded flight is north and east, so only this test exercises the other three
quadrants.

### RB-HLR-SIT-050 — The track is held below 3 kt

**The system shall update the true track from an RMC sentence only when its ground speed is
above 3 kt, keeping the previous track otherwise, and shall take the ground speed from every
valid RMC sentence.**

- **Parent:** none
- **Source:** `main/gps.go` `processNMEALine()` (RMC branch)
- **Verification:** test
- **Derived:** yes

Derived: a stationary receiver's track wanders through all 360°, and some receivers send
none. The hold has a cost the heading function inherits — on the ground the "track" is the
direction the aircraft last moved in (RB-HLR-HDG-080).

### RB-HLR-SIT-060 — A malformed sentence changes nothing

**The system shall leave the position, fix time, fix quality, ground speed and track
unchanged on a sentence that fails its checksum, lacks its leading `$`, has too few fields,
or carries a non-numeric value in a numeric field.**

- **Parent:** RB-SYS-SIT-030
- **Source:** `main/gps.go` `processNMEALine()`, `validateNMEAChecksum()`
- **Verification:** test
- **Derived:** no

## Currency

### RB-HLR-SIT-070 — A fix is current for 3 s

**The system shall treat the GPS as valid only while the last fix is under 3 s old, and
when it is not shall publish a fix quality of 0, no satellites, an accuracy of 999 999 m,
a GPS vertical speed of 0 and a NACp of 0.**

- **Parent:** RB-SYS-SIT-020
- **Source:** `main/gps.go` `isGPSValid()`
- **Verification:** test
- **Derived:** no

The position, ground speed and track keep their last values; it is the fix quality of 0
that the plates read as "no fix" (RB-HLR-SPD-230, RB-HLR-HDG-020). See the preamble for
the number.

### RB-HLR-SIT-080 — A receiver that reports no fix is believed at once

**The system shall treat the GPS as invalid from the first RMC sentence with status V, or
GGA sentence with fix quality 0, that the receiver sends.**

- **Parent:** RB-SYS-SIT-020
- **Source:** `main/gps.go` `processNMEALine()`; NMEA 0183 (RMC status, GGA quality);
  FHA-SPD-3
- **Verification:** test
- **Derived:** no

**Open finding.** Both sentences are dropped as if malformed, so the last fix stays valid
until RB-HLR-SIT-070's 3 s run out: 3 s of the last ground speed, track and position
presented as current after the receiver has said they are not.
`TestNMEAExplicitNoFixEndsValidity` measures it and skips.

### RB-HLR-SIT-140 — A restored position is not a fix

**The system shall restore the last known position at start-up without marking it a fix,
and shall not overwrite a position or a fix already present.**

- **Parent:** RB-SYS-SIT-020
- **Source:** `main/lastposition.go` `restoreLastPosition()`, `applyLastPosition()`
- **Verification:** test
- **Derived:** no

The restored position exists so that the map and the terrain can draw something before
the first fix; it must never be mistaken for one by the functions that check validity.

## Accuracy

### RB-HLR-SIT-090 — NACp is never better than the accuracy

**The system shall report as NACp the DO-260B category of the horizontal 95 % accuracy —
11 under 3 m, 10 under 10 m, 9 under 30 m, 8 under 92.6 m, 7 under 185.2 m, 6 under
555.6 m — and 0, unknown, for any worse accuracy.**

- **Parent:** RB-SYS-SIT-040
- **Source:** `main/gps.go` `calculateNACp()`
- **Verification:** test
- **Derived:** no

Categories 5 to 1 are not used: an accuracy past 0.3 NM reports "unknown", which is a worse
category than the truth, never a better one.

### RB-HLR-SIT-100 — Accuracy from GST

**The system shall take the horizontal accuracy from a valid GST sentence as twice the root
sum square of the latitude and longitude standard deviations, and the vertical accuracy as
twice the altitude standard deviation.**

- **Parent:** RB-SYS-SIT-040
- **Source:** `main/gps.go` `processNMEALine()` (GST branch)
- **Verification:** test
- **Derived:** no

2 DRMS is a 95–98 % radius, the confidence NACp is defined at.

## Derived quantities

### RB-HLR-SIT-110 — VTG is not used

**The system shall not change the ground speed, the track or the ground track time on a VTG
sentence.**

- **Parent:** none
- **Source:** `main/gps.go` `processNMEALine()`; flight of 2026-11-20
- **Verification:** test
- **Derived:** yes

Derived, from a flight finding: VTG carries no time stamp, so it cannot be tied to a fix,
and a second ground-track stamp per fix reached the AHRS as a sample with no change of
velocity. The Simple engine then showed 0.75 of the bank and 0.63 of the turn rate in
steady turns. RMC alone gives the velocity.

### RB-HLR-SIT-120 — GPS vertical speed

**The system shall compute the GPS vertical speed, in ft/s, as the least-squares slope of
the GGA altitude over the last 2 s of fix time, shall report 0 until the fixes span 0.5 s
and for an altitude step faster than 200 ft/s, shall start over when the fix time steps
back or jumps forward by more than 3 s, and shall ignore a repeated fix time.**

- **Parent:** none
- **Source:** `main/gpsvspeed.go`
- **Verification:** test
- **Derived:** yes

Derived: no sentence the RB-01 parses carries a vertical velocity, so the equipment makes
one. Fix time, not arrival time, so serial jitter does not show up as climb, and 23:59:59
to 00:00:00 is the next fix, not a step back. It drives the vertical speed indication on a
unit with no barometer (RB-HLR-ALT-200) and the AHRS's vertical velocity in that case.

### RB-HLR-SIT-130 — Loss of the fix raises one alert, and closes it

**The system shall raise one danger alert when the GPS has been invalid for 3 s after
having had a fix since power-on, close it when the fix returns, and raise a new one for
each later loss.**

- **Parent:** RB-SYS-SIT-050
- **Source:** `main/gpsfixalert.go` (`GPS_FIX_LOST_DELAY`), checked once per second from
  `updateStatus()`
- **Verification:** test
- **Derived:** no

The 3 s are counted from the GPS turning invalid, which is itself 3 s after the last fix:
6 s from the last fix to the alert. Before the first fix there is no alert — a unit
powered up in a hangar is not failing.
