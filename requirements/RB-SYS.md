# System Requirements — RB-01 Certified Core

Scope and installation assumptions are in
[`../docs/certification/fha.md`](../docs/certification/fha.md); the identifier scheme and
phrasing rules are in
[`../docs/certification/standards/requirements.md`](../docs/certification/standards/requirements.md).

These are the system-level requirements the software HLRs flow down from. They are written
against the assumption set A1–A6 of the FHA: supplemental, non-required equipment, VFR, the
aircraft's required instruments remain installed, nothing connected to a flight-control
system.

---

## Whole unit

### RB-SYS-SYS-010 — Supplemental function only

**The equipment shall perform no function on which continued safe flight and landing
depends.**

- **Parent:** none
- **Source:** FHA assumption A1; FAA PS-AIR-21.8-1602 §1.3
- **Verification:** analysis
- **Derived:** yes

The whole certification argument rests on this. Verified by analysis — the FHA itself —
rather than by test, because it is a property of the installation and the function list,
not of a behaviour.

### RB-SYS-SYS-020 — Failure is annunciated, not silent

**The equipment shall indicate to the pilot, for every displayed quantity, that the
quantity is invalid or no longer current, within 1 s of it becoming so.**

- **Parent:** none
- **Source:** FAA PS-AIR-21.8-1602 §1.5 (*"The system status (that is, operation or
  failure) should be conveyed to the pilot/flightcrew"*); FHA-ATT-3, FHA-ALT-3, FHA-TRF-2
- **Verification:** test
- **Derived:** yes

This is the requirement that keeps the failure conditions of the FHA at Minor instead of
Major, and therefore the single most important one in this file. The platform's own failure
rate (~6 × 10⁻⁵/h, `hardware/platform-assessment.md` §3.3) makes any Major condition that
depends on the equipment working unachievable; annunciated loss is the only way the
numerical case closes.

### RB-SYS-SYS-030 — No interference from non-core functions

**A failure of any function outside the certified core shall not prevent the core
functions from performing their intended function.**

- **Parent:** none
- **Source:** FAA PS-AIR-21.8-1602 §1.4 (separation, independence, protection);
  roadmap Step 7
- **Verification:** analysis
- **Derived:** yes

### RB-SYS-SYS-040 — Identification of the installed software

**The equipment shall make the version and build identifier of the installed software
available to the operator without disassembly.**

- **Parent:** none
- **Source:** DO-178C Table A-8 (software load control); `scmp.md` §5
- **Verification:** test
- **Derived:** yes

---

## Alerting

Alerting is the equipment-level annunciation path: a failure of a sensor, a subsystem or
the platform reaching the pilot. It comes before the other functions in this file because
every one of them is classified under it — `fha.md` §3 item 3 — and because its own
failure, FHA-ALR-1, inherits the worst severity of everything it mitigates.

### RB-SYS-ALR-010 — A failure that stops a core function raises an alert

**The equipment shall raise an alert when a failure prevents a core function from
performing its intended function.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-ALR-1; `main/gen_gdl90.go` `addSingleSystemErrorf()`
- **Verification:** test
- **Derived:** no

### RB-SYS-ALR-020 — An alert says what failed

**An alert shall identify the function or quantity it concerns.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-ALR-1; FAA PS-AIR-21.8-1602 §1.5
- **Verification:** test
- **Derived:** no

An alert the pilot cannot attribute to a function is not much better than no alert: the
response to a failed barometer is not the response to a failed receiver. This is the
requirement RB-HLR-ALR-150 fails today.

### RB-SYS-ALR-030 — An alert reaches the pilot without being looked for

**The equipment shall present an alert to the pilot without requiring the pilot to have
selected a particular display page or to have interacted with the display.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-ALR-1; FHA-SYS-3
- **Verification:** test
- **Derived:** no

RB-SYS-SYS-020 promises annunciation within 1 s. An indication that only appears on a page
the pilot has to choose is not an annunciation, and this is where the alert function is
furthest from what the FHA assumes — see RB-HLR-ALR-230.

### RB-SYS-ALR-040 — Alerts stay readable after they are presented

**The equipment shall retain the alerts it has raised and make them available to the pilot
for the remainder of the flight.**

- **Parent:** none
- **Source:** `main/alerts.go` `pushEvent()`; `main/managementinterface.go` `/getAlerts`
- **Verification:** test
- **Derived:** yes

Derived: a design decision — a list, rather than a transient annunciation. It earns its
place twice over. An alert raised before the display connected is only ever seen here
(RB-HLR-ALR-010), and a list the pilot can read after landing is the only in-service
record of a failure the equipment noticed, which is what feeds the problem reporting the
configuration management plan requires. Its own failure modes are bounded by
RB-HLR-ALR-220 (growth) and RB-HLR-ALR-250 (an alert whose age cannot be read).

### RB-SYS-ALR-050 — A failure that comes back is annunciated again

**The equipment shall annunciate a failure condition on each occurrence of that
condition.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-ALR-1; `main/gen_gdl90.go` `addSingleSystemErrorf()`,
  `removeSingleSystemError()`
- **Verification:** test
- **Derived:** no

An intermittent sensor is the common case — a loose I²C connection, a pitot line that
unblocks — and it is also the one a latching annunciation hides. RB-HLR-ALR-160 is this
requirement's open finding.

### RB-SYS-ALR-060 — The alert function cannot be put out of action by the data it is given

**The alert function shall go on raising and presenting alerts when it is given an event,
a configuration file or a request that is malformed, out of range or absent.**

- **Parent:** RB-SYS-SYS-030
- **Source:** RB-SYS-TRF-030 (the same argument for the same reason);
  `main/managementinterface.go` `handleAlertsPutRequest()`
- **Verification:** test
- **Derived:** no

The alert function is reachable from the aircraft's own network — `/alert/<n>` and
`POST /alert` — and reads
a settings file that the settings pages write. Both are inputs the function does not
control, and it is the mitigation the rest of the FHA depends on, so it is the one
function where robustness is not a matter of taste. RB-HLR-ALR-210 (an undefined
event type) and RB-HLR-ALR-220 (the unbounded list) were its open findings, closed on
2026-11-10 and 2026-11-11.

---

## Attitude

Attitude here means the whole AHRS output the RB-01 draws on the artificial horizon, the
turn coordinator and the G-meter: pitch, roll, slip/skid, turn rate and load factor.
Heading has its own function code (`HDG`) because its source is selected independently.

### RB-SYS-ATT-010 — Attitude is supplemental

**The attitude indication shall be presented as supplemental information and shall not be
presented as a primary attitude reference.**

- **Parent:** RB-SYS-SYS-010
- **Source:** FHA assumptions A1, A2; FHA-ATT-2
- **Verification:** review
- **Derived:** no

The whole DAL D classification of FHA-ATT-2 rests on this sentence and on A2 (VFR). If a
customer uses the display as a primary attitude reference in IMC the condition becomes
Hazardous and the core becomes DAL C — `fha.md` §5 item 1.

### RB-SYS-ATT-020 — Stale attitude is not presented as current

**The equipment shall not present an attitude as current when the attitude has not been
updated within the last 1 s.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-ATT-3 (*frozen attitude, the insidious case*); `main/gps.go`
  `isAHRSValid()`
- **Verification:** test
- **Derived:** no

### RB-SYS-ATT-030 — Attitude accuracy in the intended manoeuvres

**The indicated pitch and roll shall be within 1° of the aircraft's attitude in
coordinated flight up to 45° of bank.**

- **Parent:** none
- **Source:** FHA-ATT-2; `main/sensors_test.go` `TestAttitudeInCoordinatedTurns`
- **Verification:** test
- **Derived:** yes

Derived: no standard or customer document fixes this number. 1° is what the Simple AHRS
achieves on simulated coordinated turns with a GPS, which makes it a statement of what the
equipment does rather than of what the function needs. It is the number to challenge in
review, together with the envelope it is claimed over — aerobatic attitudes are flown on
the development aircraft and are outside it.

### RB-SYS-ATT-040 — Loss of the attitude source is annunciated

**The equipment shall indicate that the attitude is unavailable within 1 s of the attitude
source ceasing to deliver usable samples.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-ATT-1; `main/sensors.go` `sensorAttitudeSender()`
- **Verification:** test
- **Derived:** no

### RB-SYS-ATT-050 — The installation orientation is established on the aircraft

**The equipment shall allow the installer to establish the orientation at which the sensor
is mounted, and the aircraft attitude at which that orientation was established, without
modifying the software.**

- **Parent:** none
- **Source:** FHA-ATT-2 (a wrong mounting is a wrong attitude); `main/sensors.go`
  `CageAHRSAt()`, `makeOrientationQuaternion()`
- **Verification:** test
- **Derived:** yes

Derived: the cage is a design decision, not a flow-down. It is also the mitigation that
keeps a mis-mounted board from becoming FHA-ATT-2 in flight, which is why it belongs in
the safety assessment.

### RB-SYS-ATT-060 — An invalid quantity is never transmitted as a measurement

**The equipment shall transmit no quantity whose value is the internal invalid sentinel as
if it were a measurement.**

- **Parent:** RB-SYS-SYS-020
- **Source:** `goflying/ahrs` `Invalid` = 3276.7; FHA-ATT-2
- **Verification:** test
- **Derived:** no

The sentinel is a number in the same units as the measurement. An EFB that receives 3276.7
and wraps it draws 36.7° of pitch; one that scales it draws the horizon off the screen.
Either way the failure presents as data, which is the definition of hazardously misleading
information.

### RB-SYS-ATT-070 — Conformance to the attitude output interfaces

**Attitude output shall conform to the message definitions of the interfaces it is
transmitted on.**

- **Parent:** none
- **Source:** GDL 90 Data Interface Specification 560-1058-00 Rev A and the Stratux and
  ForeFlight AHRS message extensions to it; `docs/integration/`
- **Verification:** test
- **Derived:** yes

---

## Traffic

### RB-SYS-TRF-010 — Traffic is advisory

**Traffic information shall be presented as advisory only and shall not be presented as a
resolution advisory or a manoeuvre command.**

- **Parent:** RB-SYS-SYS-010
- **Source:** FHA assumption A6; FHA-TRF-1
- **Verification:** review
- **Derived:** no

### RB-SYS-TRF-020 — Stale traffic is not presented as current

**The equipment shall not present a traffic target position as current when the position
is older than the currency limit defined for its source.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-TRF-2; `main/traffic.go` `trafficCycle()`
- **Verification:** test
- **Derived:** no

### RB-SYS-TRF-030 — Received data cannot crash the equipment

**The equipment shall continue to perform its core functions when any received radio or
network message is malformed, truncated, out of range, or hostile.**

- **Parent:** RB-SYS-SYS-030
- **Source:** FHA-TRF-2; DO-178C robustness objectives (Table A-6 obj. 2);
  `docs/tech-debt/modernization.md` (the `dump978` `strcpy` finding)
- **Verification:** test
- **Derived:** no

All traffic input is attacker-influenced in the sense that matters: it arrives over the air
from uncontrolled transmitters. Robustness here is not defensive programming taste, it is
the requirement that keeps a single bad frame from taking out the attitude display that
shares the process.

### RB-SYS-TRF-040 — Ownship is not presented as traffic

**The equipment shall not present the aircraft in which it is installed as a traffic
target.**

- **Parent:** RB-SYS-TRF-010
- **Source:** `main/traffic.go` `isOwnshipTrafficInfo()`; GDL90 ICD ownship handling
- **Verification:** test
- **Derived:** no

### RB-SYS-TRF-050 — Conformance to the output interface specification

**Traffic output shall conform to the GDL90 Data Interface Specification for message
encoding, and to the FLARM NMEA definition for PFLAA/PFLAU sentences.**

- **Parent:** none
- **Source:** GDL 90 Data Interface Specification 560-1058-00 Rev A; `docs/integration/`
- **Verification:** test
- **Derived:** yes

---

## Altimetry

Barometric altitude, the altimeter setting it is referenced to, and the vertical speed.
The altimeter is the instrument the pilot uses for airspace and terrain clearance, so the
failure the FHA ranks highest is not loss but a believable wrong number (FHA-ALT-2), and
the frozen one (FHA-ALT-3).

### RB-SYS-ALT-010 — Barometric altitude is the pressure altitude of the static pressure

**The indicated barometric altitude shall be the ISA pressure altitude of the measured
static pressure, corrected for the altimeter setting in use.**

- **Parent:** none
- **Source:** FHA-ALT-2; `main/sensors.go` `tempAndPressureSender()`;
  `web/RB-01/plates/js/SixPackInstruments.js` `SixPackInstrumentAltimeter`
- **Verification:** test
- **Derived:** yes

Derived: no standard fixes it for this class of equipment. It says what a correct altitude
is, which FHA-ALT-2 needs before it can say what a wrong one is. The sensor's own accuracy
is a hardware property and belongs to roadmap Step 8, not here.

### RB-SYS-ALT-020 — Stale barometric data is not presented as current

**The equipment shall not present a barometric altitude or a barometric vertical speed as
current when the static pressure has not been measured within the currency limit defined
for its source.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-ALT-3, FHA-VSI-1; `main/gps.go` `isTempPressValid()`
- **Verification:** test
- **Derived:** no

Written, like RB-SYS-SIT-020 and RB-SYS-TRF-020, against a limit per source: 1 s for the
unit's own barometer, 3 s for the 1 Hz NMEA barometers (RB-HLR-ALT-070). The 3 s is above
RB-SYS-SYS-020's 1 s and is for the review.

### RB-SYS-ALT-030 — The altimeter setting and its origin are shown

**The equipment shall display, with every barometric altitude, the altimeter setting it is
referenced to and whether that setting was entered by the pilot or derived by the
equipment.**

- **Parent:** none
- **Source:** FHA-ALT-2 (*AutoQNH silently replaces the pilot's setting with a GPS-derived
  one; the source in use must be visible*)
- **Verification:** test
- **Derived:** yes

### RB-SYS-ALT-040 — Only a barometric altitude is presented as one

**The equipment shall not present an altitude derived from the GPS, or from other
aircraft's reports, as a barometric altitude.**

- **Parent:** none
- **Source:** FHA-ALT-2; `main/gps.go` `BARO_TYPE_ADSBESTIMATE`
- **Verification:** test
- **Derived:** yes

A GPS altitude and a pressure altitude differ by the day's temperature and pressure — by
hundreds of feet — and airspace and other traffic are flown on the pressure one. An
indication that looks like an altimeter but is driven by the GPS is the wrong-altitude
failure of FHA-ALT-2 with no fault anywhere.

---

## Speed

### RB-SYS-SPD-010 — Indicated airspeed is the airspeed of the measured pitot pressure

**The indicated airspeed shall be the ISA calibrated airspeed of the measured pitot-static
differential pressure, corrected for the installation's position error.**

- **Parent:** none
- **Source:** FHA-SPD-4; `main/airspeed.go` `airspeedSender()`
- **Verification:** test
- **Derived:** yes

Derived for the same reason as RB-SYS-ALT-010.

### RB-SYS-SPD-020 — The speed source is annunciated

**The equipment shall label every displayed speed as either indicated airspeed or GPS
ground speed.**

- **Parent:** none
- **Source:** FHA-SPD-2; FHA assumption A4;
  `web/RB-01/services/servicesituation.js` `situationSpeed()`
- **Verification:** test
- **Derived:** yes

### RB-SYS-SPD-030 — Airspeed markings only on an airspeed

**The equipment shall not draw airspeed limit markings on an indication of GPS ground
speed.**

- **Parent:** none
- **Source:** FHA-SPD-2 (*do not draw Vs/Vso arcs unless an airspeed source exists*);
  `fha.md` §5 item 2
- **Verification:** test
- **Derived:** yes

`fha.md` §5 item 2 leaves open whether labelling alone mitigates FHA-SPD-2. This
requirement takes the stricter answer, because the colour arcs invite exactly the reading
the label is meant to prevent: a 20 kt headwind on approach puts the ground speed in the
white arc at an airspeed in the green. RB-HLR-SPD-220 is its open finding.

### RB-SYS-SPD-040 — Loss of the airspeed sensor is annunciated

**The equipment shall stop presenting indicated airspeed within 1 s of the pitot sensor
ceasing to deliver valid readings.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-SPD-1, FHA-SPD-4; `main/airspeed.go` `airspeedSender()`
- **Verification:** test
- **Derived:** no

What the pilot then sees is the speed indication relabelled GS (RB-HLR-SPD-200), which is
the annunciation.

### RB-SYS-SPD-050 — Ground speed without a fix is not presented as current

**The equipment shall indicate that a displayed ground speed is not current while the GPS
has no valid fix.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-SPD-3
- **Verification:** test
- **Derived:** no

---

## Heading

### RB-SYS-HDG-010 — The heading source is annunciated

**The equipment shall display, with every heading indication, the source it is derived
from: GPS track, gyro or magnetometer.**

- **Parent:** none
- **Source:** FHA-HDG-2 (*source substitution without indication*)
- **Verification:** test
- **Derived:** yes

Track and heading differ by the drift angle, and a gyro and a compass differ by whatever
each has got wrong. The hazard of FHA-HDG-2 is a switch between them that the pilot does
not see; this requirement makes every switch visible rather than forbidding it.

### RB-SYS-HDG-020 — Loss of heading is annunciated

**The equipment shall indicate that the heading is unavailable within 1 s of the selected
heading source ceasing to provide a valid heading.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-HDG-1
- **Verification:** test
- **Derived:** no

### RB-SYS-HDG-030 — The GPS track is not a heading at low speed

**The equipment shall not present the GPS track as a heading while the ground speed is
below 5 kt.**

- **Parent:** none
- **Source:** FHA-HDG-2 (*on the ground GPS track is meaningless; at GS < 5 kt show
  "---"*)
- **Verification:** test
- **Derived:** yes

---

## Situation

The situation is the GPS half of the ownship state: position, GPS altitude, ground speed,
track, fix validity and accuracy. Every other function reads it — the attitude uses the
track and speed, the speed indication falls back to the ground speed, the heading to the
track, the traffic function places targets against the position.

### RB-SYS-SIT-010 — The situation is what the receiver reported

**The equipment shall present the position, altitude, ground speed and track reported by
the GPS receiver without altering their values beyond unit conversion.**

- **Parent:** none
- **Source:** NMEA 0183 (GGA, RMC, GST); `main/gps.go` `processNMEALine()`
- **Verification:** test
- **Derived:** yes

Derived: it defines the function rather than flowing from a hazard. The exceptions the
equipment makes on purpose — the track held at low speed, the VTG sentence ignored — are
derived HLRs below, each with its reason.

### RB-SYS-SIT-020 — Stale GPS data is not presented as current

**The equipment shall not present a GPS position, altitude, ground speed or track as
current when it is older than the currency limit defined for it, or when the receiver has
reported that it has no fix.**

- **Parent:** RB-SYS-SYS-020
- **Source:** FHA-SPD-3, FHA-ATT-3; `main/gps.go` `isGPSValid()`
- **Verification:** test
- **Derived:** no

### RB-SYS-SIT-030 — Received GPS data cannot corrupt the situation

**The equipment shall leave the situation unchanged by a received GPS sentence that is
malformed, truncated, fails its checksum or carries a non-numeric value in a numeric
field.**

- **Parent:** RB-SYS-SYS-030
- **Source:** NMEA 0183 checksum rule; RB-SYS-TRF-030 (the same argument for radio input)
- **Verification:** test
- **Derived:** no

### RB-SYS-SIT-040 — Position accuracy is never overstated

**The equipment shall not report a position accuracy better than the accuracy the receiver
reported.**

- **Parent:** none
- **Source:** DO-260B / AC 20-165 NACp categories; `main/gps.go` `calculateNACp()`
- **Verification:** test
- **Derived:** yes

### RB-SYS-SIT-050 — Loss of the GPS fix raises an alert

**The equipment shall raise an alert when the GPS fix is lost.**

- **Parent:** RB-SYS-ALR-010
- **Source:** `main/gpsfixalert.go`; FHA-SPD-3, FHA-HDG-1
- **Verification:** test
- **Derived:** no
