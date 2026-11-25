# Software High-Level Requirements — Heading (`HDG`)

Function: offer three headings — the GPS track, the AHRS gyro heading and the magnetic
heading — let the pilot choose which one drives the heading plate, show the other two
beside it, turn the true ones magnetic, and say "---" when the chosen one has nothing to
say.

Recovered from `main/sensors.go` (`sensorAttitudeSender()`, the gyro and magnetic
headings), `github.com/xiaprojects/goflying/ahrs` (`SimpleState.RollPitchHeading()`) and
`web/RB-01/plates/js/SixPackInstruments.js` (`SixPackInstrumentHeading`, and the heading
box of `SixPackInstrumentAttitude`) under DO-178C §12.1.4, against the behaviour pinned by
`main/sensors_test.go` and `test/display/test_heading.py`. Rules and field definitions:
[`../docs/certification/standards/requirements.md`](../docs/certification/standards/requirements.md).
The magnetometer's *alignment* is in `RB-HLR-ATT.md` (RB-HLR-ATT-280…300); its heading is
here.

**Two displays, two answers.** The heading plate does what FHA-HDG-2 asks: it names its
source, shows "---" for a GPS track below 5 kt, hands GPS over to GYRO without a fix and
says so. The heading box on the attitude plate does none of that — it shows the GPS track
whenever there is a fix, at any speed, and the gyro heading otherwise, with no label
(RB-HLR-HDG-070, RB-HLR-HDG-080). The requirements are written per display so the review
sees which one meets them.

**What the FHA feared does not happen, for a reason it did not know.** FHA-HDG-2 worries
about a silent switch to an unslaved gyro heading that drifts after the GPS is lost. The
shipped Simple AHRS has no heading of its own: it aligns its yaw to the GPS track and
reports `Invalid` the moment it has no ground track at 5 kt or more
(RB-HLR-HDG-050). So the gyro source cannot drift; it goes blank. That holds for the
Simple engine only — the Kalman engine (not selectable, RB-HLR-ATT-360) uses the
magnetometer and was not examined.

**The source that can freeze is the magnetometer.** A magnetic heading whose sensor stops
delivering usable samples is held at its last value indefinitely, and on a unit with no
magnetometer it is published as 0 — a valid-looking north (RB-HLR-HDG-060).

Code references in **Source** name the function, not a line number, so the trace survives
a refactor.

---

## The heading plate

### RB-HLR-HDG-010 — The heading plate names its source

**The system shall turn the heading plate's card to the heading of the selected source and
display the name of that source, GPS, GYRO or MAG.**

- **Parent:** RB-SYS-HDG-010
- **Source:** `SixPackInstrumentHeading` (`Heading.sourceName`, `.gyroheading-source`)
- **Verification:** test
- **Derived:** no

The other two sources are drawn on the card as marks at their own values, so a
disagreement between them is visible whichever one drives the card.

### RB-HLR-HDG-020 — GPS gives way to the gyro without a fix, and says so

**The system shall change the heading plate's selected source from GPS to GYRO, and
display GYRO, when the GPS has no fix.**

- **Parent:** RB-SYS-HDG-010
- **Source:** `SixPackInstrumentHeading` `updateSituation`
- **Verification:** test
- **Derived:** no

The change is not undone when the fix returns: the plate stays on GYRO until the pilot
selects again. That is the conservative way round — a source never changes without a
reason — and it is written down so nobody "fixes" it.

### RB-HLR-HDG-030 — A source with nothing to say reads "---"

**The system shall display "---" in place of the heading on the heading plate, and hide
that source's mark, when the selected source has no valid heading, the GPS track counting
as invalid below 5 kt of ground speed.**

- **Parent:** RB-SYS-HDG-020
- **Source:** `SixPackInstrumentHeading` `sourceHeadings()` (`TRACK_MIN_SPEED_KT`),
  `global.js` `globalAHRSValueIsValid()` (the 3276.7 sentinel)
- **Verification:** test
- **Derived:** no

The card holds where it was; the digits are what say it is not current.

### RB-HLR-HDG-040 — The card is magnetic, or says it is true

**The system shall present the GPS track and the gyro heading on the heading plate
corrected from true to magnetic by the magnetic variation, East positive, and shall label
the card TRUE when no variation is available.**

- **Parent:** RB-SYS-HDG-010
- **Source:** `SixPackInstrumentHeading` `updateVariation()`; `servicesituation.js`
  `situationVariation()`
- **Verification:** test
- **Derived:** no

## The heading sources

### RB-HLR-HDG-050 — The gyro heading exists only with a GPS track

**The system shall report the gyro heading as invalid while the AHRS has no GPS ground
track or the smoothed ground speed is below 5 kt.**

- **Parent:** RB-SYS-HDG-020
- **Source:** `goflying/ahrs` `SimpleState` (`staticMode`, `minGS`) and
  `RollPitchHeading()`; `main/sensors.go` `sensorAttitudeSender()`
- **Verification:** test
- **Derived:** no

"Ground track" is `isGPSGroundTrackValid()`: a fix under 3 s old, accurate to under 30 m.
The test flies 100 kt straight and through a 30° turn — the gyro heading equals the true
heading — then loses the fix and taxis at 3 kt, and both give `Invalid`.

### RB-HLR-HDG-060 — A magnetometer that has stopped gives no heading

**The system shall report the magnetic heading as invalid when the magnetometer has not
delivered a usable sample within the last 1 s.**

- **Parent:** RB-SYS-HDG-020
- **Source:** `main/sensors.go` `sensorAttitudeSender()` (the magnetic heading is written
  only when `m.MValid`)
- **Verification:** test
- **Derived:** no

**Open finding**, found by reading the code and not yet reproduced by a test. A sample that
fails, or that `magSampleUsable()` rejects, leaves `AHRSMagHeading` at its previous value,
and nothing ever ages it out: a magnetometer that dies in flight leaves the MAG source
frozen and drawn as valid. On a unit whose IMU has no magnetometer — the BMI270 driver
reports an all-zero field — the magnetic heading is never written at all and is published
as its zero value, 0: a MAG mark at north, and a MAG primary reading 000. The heading is
set to `Invalid` only when the whole attitude is, which the Simple AHRS never reports
(`SimpleState.Valid()` is unconditionally true, `roadmap.md` progress log).

## The attitude plate's heading box

### RB-HLR-HDG-070 — The attitude plate's heading names its source

**The system shall display, with the heading on the attitude plate, the name of the source
it is taken from.**

- **Parent:** RB-SYS-HDG-010
- **Source:** `SixPackInstrumentAttitude` `updateSituation` (`Heading.sourceName` is set
  and not drawn); `web/RB-01/plates/attitude.html` (`.attitude-heading`)
- **Verification:** test
- **Derived:** no

**Open finding.** The box switches between the GPS track (whenever there is a fix) and the
gyro heading (otherwise) and draws neither name. This is FHA-HDG-2 as written: source
substitution without indication. With the Simple AHRS the switch is to "---" rather than
to a drifting value (RB-HLR-HDG-050), which bounds it; with any engine that has a heading
of its own it would not be.

### RB-HLR-HDG-080 — The attitude plate does not show a GPS track as heading at low speed

**The system shall not present the GPS track as the heading on the attitude plate while
the ground speed is below 5 kt.**

- **Parent:** RB-SYS-HDG-030
- **Source:** `SixPackInstrumentAttitude` `updateSituation` (`GPSFixQuality > 0`
  selects `GPSTrueCourse`)
- **Verification:** test
- **Derived:** no

**Open finding.** The box shows `GPSTrueCourse` at any speed with a fix. Below 3 kt the
daemon holds the last track (RB-HLR-SIT-050), so on the ground the attitude plate shows,
unlabelled, the direction the aircraft was last moving in — after a turn onto the
runway, the taxiway's.
