# Software High-Level Requirements — Speed (`SPD`)

Function: read the pitot-static differential pressure, turn it into an indicated airspeed,
let the installer zero and scale it, drop it the moment the sensor stops being believable,
and on the display present whichever speed there is — airspeed or GPS ground speed — under
a label that says which.

Recovered from `main/airspeed.go` (`airspeedSender()`, `CalibrateAirspeed()`),
`main/managementinterface.go` (`handleCalibrateAirspeed()`, the `AirspeedScale` branch of
`handleSettingsSetRequest()`), `sensors/ms4525do.go`,
`web/RB-01/services/servicesituation.js` (`situationSpeed()`) and the speed gauge, the
attitude plate's speed tape and the top bar under DO-178C §12.1.4, against the behaviour
pinned by `main/airdata_test.go`, `common/equations_test.go`, `sensors/ms4525do_test.go` and
`test/display/test_speed_source.py`. Rules and field definitions:
[`../docs/certification/standards/requirements.md`](../docs/certification/standards/requirements.md).

The function comes out well. Of fifteen requirements, fourteen are met and traced; the
pitot chain was rebuilt in October and November 2026 with FHA-SPD-4 in hand, and it
shows. The one open finding is the one `fha.md` §5 item 2 already asks about: **the colour
arcs are drawn on a ground speed** (RB-HLR-SPD-220). The label says GS; the arcs say
airspeed.

What is not here, deliberately: a plausibility check of the airspeed against the ground
speed (FHA-SPD-4's "flag IAS vs GS disagreement > 30 kt outside a plausible wind"). It is
an FHA candidate, not a decision, and no behaviour in the code to recover it from. A
blocked pitot that decays slowly is therefore detected by nothing but the pilot.

Code references in **Source** name the function, not a line number, so the trace survives
a refactor.

---

## Indicated airspeed

### RB-HLR-SPD-010 — Airspeed from the dynamic pressure

**The system shall compute the indicated airspeed, in knots, from the filtered dynamic
pressure by the ISA compressible pitot equation, to within 0.5 % at a steady pressure.**

- **Parent:** RB-SYS-SPD-010
- **Source:** `common/equations.go` `CalcIndicatedAirspeed()`; `main/airspeed.go`
  `airspeedSender()`, a 500 ms ticker with a 0.3 s exponential average on the pressure
- **Verification:** test
- **Derived:** no

The equation is the inverse of `q = P0 ((1 + 0.2 M²)^3.5 − 1)`, read as `M × a0`. Below
100 kt it agrees with the incompressible `√(2q / ρ0)` to 0.2 %, which is what the sender
test checks against, so the expected value does not come from the code under test.

### RB-HLR-SPD-020 — The zero offset comes off, and the tube order does not matter

**The system shall subtract the stored zero offset from each differential pressure reading
and use the magnitude of the result.**

- **Parent:** RB-SYS-SPD-010
- **Source:** `main/airspeed.go` `airspeedSender()` (`math.Abs(raw − AirspeedZeroOffset)`)
- **Verification:** test
- **Derived:** no

The magnitude is what stops pitot and static lines connected the wrong way round from
reading zero in flight (FHA-SPD-4).

### RB-HLR-SPD-030 — No airspeed below the deadband

**The system shall report an indicated airspeed of 0 kt while the filtered dynamic
pressure is below 10 Pa.**

- **Parent:** none
- **Source:** `main/airspeed.go` (`airspeedDeadbandPa`)
- **Verification:** test
- **Derived:** yes

Derived: 10 Pa is about 8 kt, chosen to absorb the zero offset's drift and the sensor's
noise floor, which the square root inflates near zero. An airspeed of 0 is what the display
takes for "no airspeed", so below 8 kt the speed indication shows the ground speed
(RB-HLR-SPD-200). The scale of RB-HLR-SPD-040 never lifts a reading out of the deadband.

### RB-HLR-SPD-040 — The position error correction

**The system shall multiply the indicated airspeed above the deadband by the
`AirspeedScale` setting when it is between 0.5 and 1.5, and by 1 otherwise.**

- **Parent:** RB-SYS-SPD-010
- **Source:** `main/airspeed.go` `airspeedScale()`, `validAirspeedScale()`
- **Verification:** test
- **Derived:** no

The default is 1. A stored value outside the range can only come from a hand-edited
`stratux.conf`; RB-HLR-SPD-050 keeps the settings interface from writing one.

### RB-HLR-SPD-050 — A position error correction outside the range is refused

**The system shall refuse a `POST /setSettings` that sets `AirspeedScale` to a value
outside 0.5 to 1.5 or to a non-number, keeping the previous value, and shall save an
accepted value.**

- **Parent:** RB-SYS-SPD-010
- **Source:** `main/managementinterface.go` `handleSettingsSetRequest()`
- **Verification:** test
- **Derived:** no

## The sensor failing

### RB-HLR-SPD-060 — A failed read blanks the airspeed within 1 s

**The system shall keep the last indicated airspeed through two consecutive failed reads
and shall set the indicated airspeed and its measurement time to zero on the third, 1 s
after the first.**

- **Parent:** RB-SYS-SPD-040
- **Source:** `main/airspeed.go` (`airspeedHoldTicks`)
- **Verification:** test
- **Derived:** no

The hold rides out a single I²C error without the indication flickering to GS and back.
The 1 s is measured from the first read that failed; from the last good reading it is
1.5 s.

### RB-HLR-SPD-070 — A sensor that stops answering is dropped and alerted

**The system shall close the pitot sensor, return it to the sensor search and raise the
`airspeed-sensor-read` system error after 10 consecutive failed reads.**

- **Parent:** RB-SYS-SPD-040
- **Source:** `main/airspeed.go` (`airspeedDropTicks`); `pollAirspeedSensor()` clears the
  error on reconnect
- **Verification:** test
- **Derived:** no

That is 5 s after the first failure, 4 s after the airspeed was blanked. The alert this
raises falls through to a generic "Danger" today (RB-HLR-ALR-150).

### RB-HLR-SPD-080 — Turning the sensor off blanks the airspeed

**The system shall close the pitot sensor and set the indicated airspeed and its
measurement time to zero within 1 s of the `MS4525DO_Enabled` setting being turned off.**

- **Parent:** RB-SYS-SPD-040
- **Source:** `main/airspeed.go` `airspeedSender()` (the loop condition and its exit)
- **Verification:** test
- **Derived:** no

### RB-HLR-SPD-090 — Stale or faulted sensor data is a failed read

**The system shall treat a pitot sensor reading as failed when the sensor reports a fault,
or when it has reported stale data for 20 consecutive polls.**

- **Parent:** RB-SYS-SPD-040
- **Source:** `sensors/ms4525do.go` (`ms4525doStaleLimit`, `errMS4525DOStale`,
  `errMS4525DOFault`)
- **Verification:** test
- **Derived:** no

20 polls at 20 Hz is 1 s. This is the "sensor hung on stale data" case of FHA-SPD-4: the
MS4525DO keeps answering with its last measurement and a status bit when its converter
stops, and without this rule the airspeed would freeze rather than blank.

## Zeroing

### RB-HLR-SPD-100 — Zeroing averages 2 s of readings

**The system shall, on a zeroing request, store the mean of the next 4 differential
pressure readings as the zero offset, save it to the settings, and report an indicated
airspeed of 0 kt until the mean is stored.**

- **Parent:** RB-SYS-SPD-010
- **Source:** `main/airspeed.go` `airspeedSender()` (the calibration branch,
  `airspeedCalSamples`)
- **Verification:** test
- **Derived:** no

### RB-HLR-SPD-110 — Zeroing is refused while moving

**The system shall refuse a zeroing request with HTTP 409 when no pitot sensor is
connected, or while the GPS ground track is valid and the ground speed is above 5 kt.**

- **Parent:** RB-SYS-SPD-010
- **Source:** `main/managementinterface.go` `handleCalibrateAirspeed()`; FHA-SPD-4 (*zero
  offset only settable stationary*)
- **Verification:** test
- **Derived:** no

With no valid ground track — no fix, a fix 3 s old, or one worse than 30 m — the request is
accepted, because the equipment cannot tell. That is the installer zeroing in a hangar, and
it is also a pilot zeroing in flight after losing the GPS. FHA-SPD-4 asks for "only
settable stationary"; whether "not known to be moving" is close enough is for the review.

## Presentation

### RB-HLR-SPD-200 — The speed source is resolved once for every indication

**The system shall present as the speed the indicated airspeed when it is a finite number
above 0 kt, and the GPS ground speed otherwise, and shall give every speed indication the
same source.**

- **Parent:** RB-SYS-SPD-020
- **Source:** `web/RB-01/services/servicesituation.js` `situationSpeed()` (`SpeedKt`,
  `SpeedSource`)
- **Verification:** test
- **Derived:** no

The substitution is automatic in both directions and is what makes RB-HLR-SPD-060 an
annunciation rather than a blank: the indication relabels itself GS.

### RB-HLR-SPD-210 — Every speed indication says which speed it is

**The system shall label the speed gauge, the attitude plate's speed tape and the top bar's
speed slot IAS or GS according to the speed source, with the value in the pilot's unit.**

- **Parent:** RB-SYS-SPD-020
- **Source:** `web/RB-01/plates/speed.html`, `attitude.html` (`.attitude-speed-source`),
  `plates/js/bottom.js`; `aircraft.json` `units`
- **Verification:** test
- **Derived:** no

### RB-HLR-SPD-220 — No airspeed arcs on a ground speed

**The system shall draw the speed gauge's coloured airspeed arcs only while the speed
source is the indicated airspeed.**

- **Parent:** RB-SYS-SPD-030
- **Source:** FHA-SPD-2; `SixPackInstruments.js` (the gauge's `arcs`, coloured from
  `aircraft.json` whatever the source)
- **Verification:** test
- **Derived:** no

**Open finding.** The arcs are drawn on ground speed too. `test_speed_source.py`
`check_gauge_arcs` fails on it and carries no `Covers:` tag, so the requirement stays in
the untraced budget until it passes. The label is right (RB-HLR-SPD-210); the arcs undo
it.

### RB-HLR-SPD-230 — A ground speed without a fix is marked failed

**The system shall mark the speed gauge and the attitude plate's speed tape failed while
the speed source is the ground speed and the GPS has no fix, and shall not mark an
indicated airspeed failed for the lack of a fix.**

- **Parent:** RB-SYS-SPD-050
- **Source:** `web/RB-01/plates/speed.html`, `attitude.html` (`gpsNoFix`)
- **Verification:** test
- **Derived:** no

"No fix" is `GPSFixQuality` 0 as the daemon publishes it, so this inherits the GPS currency
limit (RB-HLR-SIT-070, 3 s) and its open finding (RB-HLR-SIT-080). The top bar's slot
has no failure marking; not specified, for the review.
