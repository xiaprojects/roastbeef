# Software High-Level Requirements — Altimetry (`ALT`)

Function: read the static pressure, turn it into a pressure altitude and a vertical speed,
take the altimeter setting from the pilot or derive it from the GPS, and draw the
corrected altitude, the setting and the vertical speed on the RB-01 — with each of them
marked not current when it stops being true.

Recovered from `main/sensors.go` (`tempAndPressureSender()`), `main/gps.go`
(`isTempPressValid()` and the three other writers of `BaroPressureAltitude`),
`web/RB-01/services/servicesituation.js` (the AUTO altimeter setting) and
`web/RB-01/plates/js/SixPackInstruments.js` (the altimeter plate, the attitude plate's
altitude box and vertical speed strip) under DO-178C §12.1.4, against the behaviour pinned
by `main/airdata_test.go`, `common/equations_test.go`, `test/display/test_keypad_altimeter.py`
and `test/display/test_variometer.py`. Rules and field definitions:
[`../docs/certification/standards/requirements.md`](../docs/certification/standards/requirements.md).

**Read this before the requirements.** Of the fifteen requirements here six are open
findings, and they share one shape: the daemon knows more than the display uses. The
daemon stamps every barometric measurement (`BaroLastMeasurementTime`) and names its
source (`BaroSourceType`); the altimeter plate reads neither. So a barometer that stops is
drawn frozen (RB-HLR-ALT-070), an altitude estimated from other aircraft's ADS-B reports is
drawn as a barometric one (RB-HLR-ALT-130), and the attitude plate's altitude box is the
GPS altitude, printed next to the altimeter setting (RB-HLR-ALT-140). The data to fix all
three is already on the socket.

Two behaviours are specified as they are and put to the review rather than called
defects, because the intent could not be recovered from the code:

- **AUTO is selected at every start-up** (`situationByPilot.AutoQNH = true`), and the
  pilot's own setting is not kept across a restart — an owner decision of 2026-11-24.
- **AUTO re-derives the setting continuously**, every published frame while the aircraft
  is level (RB-HLR-ALT-110, RB-HLR-ALT-120). In level flight with AUTO on, the altimeter
  therefore reads the GPS altitude to within one hectopascal, about 27 ft: it can never
  disagree with the GPS, and it does not behave like an altimeter set to a QNH and left
  alone. That is a reasonable design for a VFR microlight and it is the opposite of what
  FHA-ALT-2's mitigation ("flag baro-vs-GPS disagreement") assumes. `fha.md` §5 carries it.

Code references in **Source** name the function, not a line number, so the trace survives
a refactor.

---

## Pressure altitude

### RB-HLR-ALT-010 — Pressure altitude is the ISA altitude of the static pressure

**The system shall compute the pressure altitude, in feet, as the ISA altitude of the
static pressure read, `145366.45 × (1 − (p / 1013.25 hPa)^0.190284)`, plus the
`AltitudeOffset` setting, to within 1 ft of that value at a constant pressure.**

- **Parent:** RB-SYS-ALT-010
- **Source:** `common/equations.go` `CalcAltitude()`; `main/sensors.go`
  `tempAndPressureSender()`, a 100 ms ticker
- **Verification:** test
- **Derived:** no

Within 3 ft while climbing at 600 ft/min, which is the 0.1 s between the read and the
check.

### RB-HLR-ALT-030 — An implausible altitude is not used

**The system shall not use a pressure altitude above 70 000 ft, or one more than 5000 ft
from the GPS altitude while the GPS has a valid fix, and shall then leave the last
accepted altitude and its measurement time unchanged and raise the `BaroBroken` system
error.**

- **Parent:** RB-SYS-ALT-010
- **Source:** `main/sensors.go` `tempAndPressureSender()`
- **Verification:** test
- **Derived:** no

The 5000 ft limit catches a broken sensor, not a wrong one: a barometer reading 4000 ft
wrong passes it. Nothing finer is specified because, with AUTO on, the setting absorbs any
steady disagreement (see the preamble).

### RB-HLR-ALT-035 — An impossible pressure is not used

**The system shall not use a static pressure reading that is not a finite number between
300 hPa and 1100 hPa, and shall then leave the last accepted altitude and its measurement
time unchanged.**

- **Parent:** RB-SYS-ALT-010
- **Source:** FHA-ALT-2 derived-requirement candidate (*reject pressure ≤ 0 or out of
  300–1100 hPa*); `common/equations_test.go` `TestCalcAltitude` (its robustness note)
- **Verification:** test
- **Derived:** no

**Open finding.** Only a reading of exactly 0 is refused. `TestPressureSenderRejectsAnImpossiblePressure`
measures the rest and skips: −1 hPa is published as an altitude of NaN, 2000 hPa as
−20 080 ft. The NaN is worse than it looks. `encoding/json` refuses to encode a NaN, and
`handleSituationWS()` discards the error, so from that reading on every `/situation`
frame is empty: **every instrument on the display freezes on its last value, the attitude
included, with nothing marked failed** — FHA-ATT-3 for the whole display, from one bad
barometer read. Confirmed by encoding a struct holding a NaN; not reproduced end to end.

The numbers are the FHA candidate's. The BMP388's datasheet range is 300–1250 hPa; 1100
is the highest QNH the pilot can set (RB-HLR-ALT-100). To confirm at review.

### RB-HLR-ALT-040 — Vertical speed from the pressure altitude

**The system shall compute the barometric vertical speed, in ft/min, as the rate of change
of successive pressure altitudes smoothed by an exponential average with a 5 s time
constant.**

- **Parent:** none
- **Source:** `main/sensors.go` `tempAndPressureSender()` (`u = 5 / (5 + dt)`)
- **Verification:** test
- **Derived:** yes

Derived: the 5 s is a design choice ("slightly faster than typical VSI", in the code),
and it is a lag the pilot sees — 20 reads into a climb the indication shows a third of the
rate. Fed back in `fha.md` §4.

### RB-HLR-ALT-050 — A sensor that stops answering is dropped and looked for again

**The system shall close the barometric sensor and return it to the sensor search after
50 consecutive failed reads, and shall not count a failed read that is followed by a
successful one towards that limit.**

- **Parent:** none
- **Source:** `main/sensors.go` `tempAndPressureSender()` (`numRetries`), `pollSensors()`
- **Verification:** test
- **Derived:** yes

Derived: a recovery strategy. A reading of 0 counts as a failed read.

### RB-HLR-ALT-060 — Each loss of the barometer is alerted

**The system shall raise an alert each time the barometric sensor is closed after failing
to answer.**

- **Parent:** RB-SYS-ALR-050
- **Source:** `main/sensors.go` `tempAndPressureSender()`; `main/airspeed.go`
  `airspeedSender()` (which does it this way)
- **Verification:** test
- **Derived:** no

**Open finding.** The barometer raises its system error on the *first* failed read — a
single glitch — and never clears it, and a system error is raised once per name. So after
any glitch since start-up the real loss of the sensor raises nothing.
`TestPressureSenderAlertsTheLoss` measures it and skips. The pitot does it right: it
raises its error when it drops the sensor and clears it on reconnect. Same finding family
as RB-HLR-ALR-160.

## Presentation

### RB-HLR-ALT-070 — A barometer that has stopped is not drawn as current

**The system shall mark the altimeter indication and the barometric vertical speed
indication not current when the barometric altitude was last measured more than 1 s
earlier.**

- **Parent:** RB-SYS-ALT-020
- **Source:** FHA-ALT-3; `main/gps.go` `isTempPressValid()`
- **Verification:** test
- **Derived:** no

**Open finding.** No plate reads `BaroLastMeasurementTime`. When the sensor stops, the
daemon stops updating the altitude but leaves the last value, and leaves `BaroSourceType`
saying BMP, so the altimeter, the attitude plate's vertical speed strip and the needle
freeze where they were. The daemon's own validity window (`isTempPressValid`) is 15 s,
which the GDL90 and FLARM outputs use; that is fifteen times RB-SYS-SYS-020's 1 s. A
rejected altitude (RB-HLR-ALT-030) freezes the indication the same way.

### RB-HLR-ALT-080 — The altimeter setting is applied as a barometric altimeter applies it

**The system shall correct the pressure altitude for the altimeter setting by the pressure
altitude difference between 1013.25 hPa and the setting, to within 20 ft for any setting
from 950 hPa to 1050 hPa.**

- **Parent:** RB-SYS-ALT-010
- **Source:** `web/RB-01/plates/js/SixPackInstruments.js` `SixPackInstrumentAltimeter`
  (`BaroPressureAltitude + 27 × (QNH − 1013.25)`); ISA
- **Verification:** test
- **Derived:** no

**Open finding.** The display uses a constant 27 ft/hPa. That is right near 1013 hPa and
drifts away from it: the altimeter reads 22 ft high at a setting of 980 hPa, 64 ft high at
950 hPa, and 371 ft high at 850 hPa, the lowest setting the pilot can dial — always high,
which is the direction that eats terrain clearance. `CalcAltitude()` already computes the
exact correction. The 20 ft tolerance is a TSO-C10b-class figure chosen by the author, not
taken from a requirement; to confirm at review.

### RB-HLR-ALT-090 — The setting and its origin are shown

**The system shall display the altimeter setting in use, in whole hectopascals, on every
plate that shows the barometric altitude, with an AUTO indication lit while the setting is
derived by the equipment and unlit while it was entered by the pilot.**

- **Parent:** RB-SYS-ALT-030
- **Source:** `web/RB-01/plates/altimeter.html`, `attitude.html` (`.altimeter-qnh-auto`,
  `.attitude-qnh-auto`)
- **Verification:** test
- **Derived:** no

The test reads the altimeter plate. The attitude plate shows AUTO only when it is lit,
and nothing when the pilot set the value; the six-pack altimeter is the same template.

### RB-HLR-ALT-100 — The pilot sets the setting in hectopascal steps within limits

**The system shall change the altimeter setting by 1 hPa per pilot step, within 850 hPa to
1100 hPa inclusive, shall turn AUTO off on the first step, and shall hold the pilot's
setting until the pilot selects AUTO again.**

- **Parent:** RB-SYS-ALT-010
- **Source:** `SixPackInstruments.js` (`QNH_MIN`, `QNH_MAX`, the knob and touch zones);
  `main/slavenmeadisplay.go` (the same window for RB-09)
- **Verification:** test
- **Derived:** no

A step past a limit stays on the limit; a step from an AUTO value outside the range lands
on the nearest limit.

### RB-HLR-ALT-110 — The AUTO setting

**While AUTO is selected, the system shall derive the altimeter setting as
`1013.25 + round(h_GPS / k) − round(h_P / k)` hPa, where `h_GPS` is the GPS altitude,
`h_P` the pressure altitude, both in feet, and `k = 27 + h_GPS / 1500` ft/hPa.**

- **Parent:** none
- **Source:** `web/RB-01/services/servicesituation.js` `onmessageTick`
- **Verification:** test
- **Derived:** yes

Derived, and the requirement in this file with the largest safety consequence — see the
preamble. The rounding makes the derived setting move in whole-hectopascal steps, so the
altimeter does not follow GPS altitude noise. `k` is an altitude-dependent ft/hPa that is
not the correction RB-HLR-ALT-080 applies (a constant 27), so even the derived setting
does not quite make the altimeter read the GPS altitude above sea level.

### RB-HLR-ALT-120 — AUTO derives only with a fix and while level

**While AUTO is selected, the system shall derive a new altimeter setting only while the
GPS has a fix and the barometric vertical speed is under 200 ft/min either way, and shall
otherwise keep the last derived setting.**

- **Parent:** none
- **Source:** `web/RB-01/services/servicesituation.js` `onmessageTick`
- **Verification:** test
- **Derived:** yes

The gate tests `GPSFixQuality > 0` only. It takes no account of the GPS's vertical
accuracy, which is the "AutoQNH from a poor GPS fix" case FHA-ALT-2 names; no
requirement is written for an accuracy gate because no number for it can be recovered.

### RB-HLR-ALT-130 — An estimated altitude is not drawn as barometric

**The system shall not draw a pressure altitude whose source is the ADS-B estimate as a
barometric altitude.**

- **Parent:** RB-SYS-ALT-040
- **Source:** `main/gps.go` (`BARO_TYPE_ADSBESTIMATE`, the estimate from nearby targets'
  GNSS–baro difference); `SixPackInstrumentAltimeter`
- **Verification:** test
- **Derived:** no

**Open finding.** With no barometer fitted, the daemon fills `BaroPressureAltitude` with
the GPS height less a regression of other aircraft's reported GNSS–baro differences, and
marks it `BaroSourceType = 4`. The radar plate honours the mark; the altimeter plate and
AUTO do not, so on a unit without a barometer the altimeter draws an ADS-B estimate, and
AUTO derives a setting from it. The same applies to the OGN-tracker and `$PGRMZ` sources,
which are real barometers but someone else's — not specified here, for the review.

### RB-HLR-ALT-140 — The attitude plate's altitude is the barometric altitude

**The system shall draw on the attitude plate, beside the altimeter setting, the
barometric altitude corrected for that setting and no other altitude.**

- **Parent:** RB-SYS-ALT-040
- **Source:** `SixPackInstruments.js` `SixPackInstrumentAttitude` `updateSituation`
  (`Altimeter.altitude = GPSAltitudeMSL`); `web/RB-01/plates/attitude.html`
  (`.attitude-altimeter`, `.attitude-qnh`)
- **Verification:** test
- **Derived:** no

**Open finding.** The attitude plate's altitude box is the GPS altitude above mean sea
level, drawn next to the altimeter setting with its AUTO label — so a pilot who dials a
new QNH sees the setting change and the altitude beside it stay where it was. Either the
box should show the corrected barometric altitude or it should be labelled GPS and lose
the setting. Which one is the owner's call; the requirement is written for the first
because the layout copies a PFD's altitude tape.

## Vertical speed indication

### RB-HLR-ALT-200 — Vertical speed source

**The system shall drive the vertical speed indication from the barometric vertical speed
while a barometric source is present, and from the GPS vertical speed converted from ft/s
to ft/min otherwise.**

- **Parent:** none
- **Source:** `SixPackInstruments.js` `updateVariometer()`
- **Verification:** test
- **Derived:** yes

Derived: a substitution, and it is not annunciated — the strip looks the same with either
source. The GPS rate lags the barometric one and is noisier (RB-HLR-SIT-120). Classified
under FHA-VSI-1 (Minor) in `fha.md` §4.
