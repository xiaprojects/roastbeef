# Software High-Level Requirements — Attitude (`ATT`)

Function: read the IMU, remove its calibration, fuse the samples into an aircraft
attitude, and publish pitch, roll, slip/skid, turn rate and load factor to the RB-01
display and to the EFB interfaces — with every one of them marked invalid the moment it
stops being true.

Recovered from `main/sensors.go` (`sensorAttitudeSender()` and the cage), `main/gps.go`
(`makeAHRSGDL90Report()`, `isAHRSValid()`) and `github.com/xiaprojects/goflying/ahrs`
under DO-178C §12.1.4, against the behaviour pinned by `main/sensors_test.go`. Rules and
field definitions:
[`../docs/certification/standards/requirements.md`](../docs/certification/standards/requirements.md).

Magnetic **heading** is not here: its source is selected independently of the attitude
(GPS track, gyro heading or magnetic heading) and it has its own function code, `HDG`.
What is here is the magnetometer's *alignment*, because it hangs off the same cage as the
accelerometer and is part of the installation.

Code references in **Source** name the function, not a line number, so the trace survives
a refactor.

---

## Sampling and output rate

### RB-HLR-ATT-010 — Attitude update rate

**The system shall compute a new attitude from a new IMU sample at a rate of at least
20 Hz while the IMU is enabled and connected.**

- **Parent:** RB-SYS-ATT-020
- **Source:** `main/sensors.go` `sensorAttitudeSender()`, a 50 ms ticker; FHA-ATT-2
  (*attitude update ≥ 10 Hz, latency ≤ 200 ms*)
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-020 — One attitude message per sample on every enabled output

**The system shall transmit the attitude once per computed sample to each enabled
attitude output interface.**

- **Parent:** RB-SYS-ATT-020
- **Source:** `main/sensors.go` `sensorAttitudeSender()` calling `makeAHRSGDL90Report()`,
  `makeAHRSSimReport()` and `makeAHRSLevilReport()`
- **Verification:** test
- **Derived:** no

The rate is a currency requirement, not a bandwidth one: an EFB that stops receiving
attitude messages is how the loss of RB-HLR-ATT-240 reaches the client.

### RB-HLR-ATT-025 — Raw samples are recorded as the driver delivers them

**The system shall record the accelerometer and gyro sample of each IMU read as the
driver delivered it, before the calibration is applied, whether or not the resulting
attitude is valid.**

- **Parent:** none
- **Source:** `main/sensors.go` `sensorAttitudeSender()`, `AHRSAccX`/`AHRSGyroX` and
  siblings
- **Verification:** test
- **Derived:** yes

Derived: it exists so that a calibration can be refitted from a recorded flight, which no
safety requirement asks for. It earns its place in the attitude function because the
samples are kept precisely when the attitude is *not* valid, which is when the recording
is worth having.

### RB-HLR-ATT-030 — GPS-derived attitude only without an IMU

**The system shall derive the attitude from GPS track and speed changes only while the
IMU is not enabled or not connected.**

- **Parent:** none
- **Source:** `main/gps.go` `gpsAttitudeSender()`, whose inner loop runs only while
  `!(IMU_Sensor_Enabled && IMUConnected)`
- **Verification:** analysis
- **Derived:** yes

Verified by analysis: `gpsAttitudeSender()` is a 10 Hz loop over package globals with no
seam a unit test can drive, and the guard is a single condition on its inner loop that
code review can check. The requirement is here because the substitution is invisible on
the interface — a GPS-derived pitch and roll are published in the same fields as the IMU's,
and only bit 1 of `AHRSStatus` (RB-HLR-ATT-340) says which one the display is drawing.

## The cage: calibration and mounting

### RB-HLR-ATT-040 — Gyro zero bias is removed

**The system shall subtract the stored per-axis gyro zero bias from every gyro sample
before the sample reaches the attitude computation.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors.go` `sensorAttitudeSender()` via `SetCalibrations`; settings
  field `D`
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-050 — Accelerometer calibration is applied

**The system shall correct every accelerometer sample to `(raw − offset) / gain` per axis
before the sample reaches the attitude computation, and shall treat a stored gain of zero
as a gain of one.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors.go` `accelCorrect()`, `accelGain()`
- **Verification:** test
- **Derived:** no

The zero-reads-as-one rule is what keeps a `stratux.conf` written before the gain setting
existed from multiplying every acceleration by infinity.

### RB-HLR-ATT-060 — Caging establishes the mounting orientation

**The system shall derive from the accelerometer reading taken at rest a sensor
orientation such that the computed attitude equals the attitude the aircraft was at when
the reading was taken, for any mounting of the sensor board.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `makeOrientationQuaternion()`, `CageAHRSAt()`
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-070 — Caging at a commanded ground attitude

**The system shall accept the pitch and roll, in degrees, at which the aircraft stands
when it is caged, and shall treat that attitude rather than level as the reference.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `CageAHRSAt()`, the `level <pitch> <roll>` request
- **Verification:** test
- **Derived:** no

A tailwheel aircraft stands nose-up in the hangar. Without this the horizon sits at the
ground attitude for the whole flight.

### RB-HLR-ATT-080 — The orientation is a unit quaternion for every mounting

**The orientation derived by caging shall be a quaternion of unit length for every
mounting of the sensor board, including one requiring a rotation of 180°.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `makeOrientationQuaternion()`, which uses
  `common.RotationMatrixToQuaternion` rather than `ahrs.RotationMatrixToQuaternion`
- **Verification:** test
- **Derived:** no

Recovered from a defect, and the reason the test sweeps all 24 square mountings: the
goflying conversion divides by `sqrt(1+trace)/2`, which is zero for the half turn a flat
board with the default forward axis needs. It returned NaN, and a NaN attitude is drawn as
a blank or a frozen horizon, not as a failure.

### RB-HLR-ATT-090 — The gravity-axis zero offset is re-solved at each cage

**The system shall, when caging, re-solve the zero offset of the accelerometer axis
carrying gravity so that the corrected reading at rest has a magnitude of 1 g, holding the
gains and the other two offsets.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `accelRestOffset()`
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-100 — A reading that cannot be 1 g at rest is refused

**The system shall not update the accelerometer offset from a reading whose other two
axes already account for 1 g or more, or that would require an offset of more than 0.3 g
on the gravity axis, and shall leave the stored calibration unchanged in both cases.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `accelRestOffset()`, `restOffsetLimit`
- **Verification:** test
- **Derived:** no

Either condition means the aircraft is not at rest or the stored gains are wrong. Both
produce an offset that would tilt the horizon permanently, so refusing is the safe action
and the previous calibration stays in force.

### RB-HLR-ATT-110 — Calibration rests on an averaged window

**The system shall average the IMU over a window of 5 s, requiring at least half of the
samples the window can hold, before it updates any stored calibration from it.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors.go` `calSample()`, `calWindow`
- **Verification:** analysis
- **Derived:** no

Verified by analysis: `calSample()` paces itself on the caller's 20 Hz ticker over a 5 s
wall-clock deadline, so a unit test of it costs five seconds of test time for one case.
The averaging matters — a single GY-85 gyro sample scatters by 2–2.5 °/s with the engine
running, which is more than the zero bias being measured.

### RB-HLR-ATT-120 — Implausible calibration samples are rejected

**The system shall reject an averaged calibration sample whose accelerometer magnitude
differs from 1 g by more than 0.20 g or whose gyro magnitude exceeds 15 °/s, and shall
make no more than four attempts.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `sensorAttitudeSender()`, `calCLimit`, `calDLimit`,
  `calMaxTries`
- **Verification:** analysis
- **Derived:** no

Verified by analysis for the same reason as RB-HLR-ATT-110: the gates sit inside the
calibration branch of the attitude loop, which a test can only reach through a 5 s window
per attempt.

### RB-HLR-ATT-130 — The orientation step names a signed axis

**The system shall report, for the installer's orientation step, the accelerometer axis
reading the largest magnitude together with its sign, and shall report an error rather
than choose when two axes read the same magnitude.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `getMinAccelDirection()`
- **Verification:** test
- **Derived:** no

## Attitude, load factor and turn rate

### RB-HLR-ATT-140 — Pitch and roll accuracy in coordinated flight

**The computed pitch and roll shall be within 1° of the aircraft's attitude in
coordinated flight up to 45° of bank, with a GPS ground track available.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors_test.go` `TestAttitudeInCoordinatedTurns`; `goflying/ahrs`
  Simple AHRS
- **Verification:** test
- **Derived:** no

The qualifier is not decoration: without the GPS the same manoeuvre produces
RB-HLR-ATT-350, the known hazard at the end of this file.

### RB-HLR-ATT-150 — Load factor

**The computed load factor shall be within 0.01 g of the aircraft's load factor in
coordinated flight up to 45° of bank.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors.go` `sensorAttitudeSender()` via `GLoad()`; FHA-G-1
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-160 — Slip/skid in coordinated flight

**The computed slip/skid angle shall be within 0.5° of zero in coordinated flight up to
45° of bank.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors.go` `sensorAttitudeSender()` via `SlipSkid()`; FHA-TRN-1
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-170 — Turn rate

**The computed turn rate shall be within 0.1 °/s of the aircraft's rate of turn in
coordinated flight up to 45° of bank.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors.go` `sensorAttitudeSender()` via `RateOfTurn()`; FHA-TRN-1
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-180 — Load factor extremes are retained

**The system shall retain the smallest and largest load factor computed since the last
reset.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors.go` `sensorAttitudeSender()`, `AHRSGLoadMin`/`AHRSGLoadMax`
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-190 — Load factor extremes are resettable

**The system shall set both retained load factor extremes to the current load factor on
request.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors.go` `ResetAHRSGLoad()`; `main/managementinterface.go`
- **Verification:** test
- **Derived:** no

## Validity, staleness and annunciation

### RB-HLR-ATT-200 — Attitude is not current 1 s after its last update

**The system shall mark the attitude not current on every output interface when the
attitude has not been updated for 1 s.**

- **Parent:** RB-SYS-ATT-020
- **Source:** `main/gps.go` `isAHRSValid()`; FHA-ATT-3
- **Verification:** test
- **Derived:** no

This is the attitude half of RB-SYS-SYS-020 and the mitigation the FHA credits for keeping
a frozen horizon at Major rather than Hazardous.

### RB-HLR-ATT-210 — No attitude without a position fix

**The system shall mark the attitude not current on every output interface while no valid
GPS fix is available.**

- **Parent:** RB-SYS-ATT-020
- **Source:** `main/gps.go` `isAHRSValid()`, which requires `isGPSValid()`
- **Verification:** test
- **Derived:** no

Recovered as written, and it is stronger than the sensor needs: the IMU does not depend on
the GPS to know which way is up, yet losing the fix blanks the attitude on every EFB
interface. The reason is in RB-HLR-ATT-350 — without a ground track the fused attitude
degrades silently — so this coupling is currently a mitigation, not a defect. It should be
revisited together with that hazard, because it also means a GPS outage removes the
attitude from the EFB at the moment the pilot has fewest references.

### RB-HLR-ATT-220 — An invalid field is encoded as invalid

**The system shall encode as the interface's unavailable value every attitude field whose
computed value is the invalid sentinel, independently of the other fields.**

- **Parent:** RB-SYS-ATT-060
- **Source:** `main/gps.go` `makeAHRSGDL90Report()`, `isAHRSInvalidValue()`
- **Verification:** test
- **Derived:** no

Per field, not per message: the Simple AHRS returns a valid pitch and roll with an invalid
turn rate whenever it has no ground track, and an all-or-nothing rule would blank a good
horizon or publish a bad rate.

### RB-HLR-ATT-230 — Nothing is sent on an interface that cannot say "invalid"

**The system shall transmit no attitude on an output interface that has no encoding for an
unavailable value when any transmitted field holds the invalid sentinel.**

- **Parent:** RB-SYS-ATT-060
- **Source:** `main/gps.go` `makeAHRSSimReport()` (X-Plane `XATT`, UDP 49002)
- **Verification:** test
- **Derived:** no

Silence is the only available annunciation on that interface. Sending the sentinel instead
would put 3276.7° of pitch on the wire, which a receiver draws as 36.7°.

### RB-HLR-ATT-240 — A failed sensor read does not update the attitude

**The system shall not update the attitude, nor its time of last update, from an IMU read
that returned an error.**

- **Parent:** RB-SYS-ATT-040
- **Source:** `main/sensors.go` `sensorAttitudeSender()`
- **Verification:** test
- **Derived:** no

Together with RB-HLR-ATT-200 this is what turns a silent sensor into an annunciated loss
within 1 s instead of a frozen horizon (FHA-ATT-3).

### RB-HLR-ATT-250 — A persistently failing IMU is disconnected

**The system shall declare the IMU disconnected and release it after 51 consecutive failed
reads.**

- **Parent:** RB-SYS-ATT-040
- **Source:** `main/sensors.go` `sensorAttitudeSender()`, `numRetries`
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-260 — A disconnected IMU is retried

**The system shall attempt to reconnect to the IMU every 4 s while the IMU is enabled and
not connected.**

- **Parent:** RB-SYS-ATT-040
- **Source:** `main/sensors.go` `pollSensors()`
- **Verification:** analysis
- **Derived:** no

Verified by analysis: `pollSensors()` is a bare 4 s ticker loop started from
`initI2CSensors()`, which needs a real I2C host. The reconnect path itself —
`initIMU()` — is driven by the sensor driver tests in `sensors/`.

### RB-HLR-ATT-270 — Turn rate is invalid without a ground track

**The system shall mark the turn rate invalid while no valid GPS ground track is
available.**

- **Parent:** RB-SYS-ATT-060
- **Source:** `goflying/ahrs` `SimpleState.RateOfTurn()` in static mode;
  `main/gps.go` `isGPSGroundTrackValid()`
- **Verification:** test
- **Derived:** no

The turn rate is the one quantity the AHRS does flag when the ground track goes away. The
pitch and roll beside it do not — RB-HLR-ATT-350.

## Magnetometer alignment

The heading computed from these samples belongs to `HDG`. What follows is the part of the
magnetometer that is installation and attitude: where the die points, and which samples
are fit to use at all.

### RB-HLR-ATT-280 — Magnetometer alignment is composed from the cage

**The system shall derive the magnetometer alignment as the sensor orientation of the
cage composed with the magnetometer die's own axis mapping.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `makeMagOrientationQuaternion()`
- **Verification:** test
- **Derived:** no

Caging therefore realigns the compass as well as the horizon, and the persistent input is
the die mapping rather than the composed result.

### RB-HLR-ATT-290 — A non-rotation axis mapping falls back to identity

**The system shall use the identity mapping, and record the rejection, when the
configured magnetometer axis mapping is not a rotation.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `makeMagOrientationQuaternion()`,
  `common.MagAxisMappingToQuaternion()`
- **Verification:** test
- **Derived:** no

A reflection — an odd number of sign flips — has no quaternion. Taking the identity keeps
the compass wrong in a visible, correctable way instead of producing a mirrored heading
that looks plausible.

### RB-HLR-ATT-300 — No alignment before the cage

**The system shall leave the magnetometer alignment unset until a sensor orientation
exists for it to hang off.**

- **Parent:** RB-SYS-ATT-050
- **Source:** `main/sensors.go` `makeMagOrientationQuaternion()`
- **Verification:** test
- **Derived:** no

### RB-HLR-ATT-310 — Samples with a dead axis are rejected

**The system shall discard a magnetometer sample in which any axis reads less than 5 µT
in magnitude, and shall not fuse it into the attitude.**

- **Parent:** RB-SYS-ATT-060
- **Source:** `main/sensors.go` `magSampleUsable()`
- **Verification:** test
- **Derived:** no

A stuck or unpopulated axis does not make the heading noisy, it makes it meaningless — and
one driver (`sensors/bmi270.go`) reports an all-zero magnetometer with no error, so the
error return alone is not enough to catch it.

### RB-HLR-ATT-320 — Magnetometer conditioning for the fusion filter

**The system shall present the magnetometer to the fusion filter hard- and soft-iron
corrected, scaled to the local field magnitude, and expressed in the accelerometer's
frame.**

- **Parent:** RB-SYS-ATT-030
- **Source:** `main/sensors.go` `kalmanMagnetometer()`, `kalmanField.update()`
- **Verification:** test
- **Derived:** no

The accelerometer's frame, not the aircraft's: it is the frame the sensor orientation
applies to, so the filter can treat the magnetometer exactly as it treats the gyro.

### RB-HLR-ATT-330 — No magnetometer without a calibration

**The system shall withhold the magnetometer from the fusion filter while the compass
calibration is incomplete, in progress, or taken before the cage.**

- **Parent:** RB-SYS-ATT-060
- **Source:** `main/sensors.go` `kalmanMagnetometer()`
- **Verification:** test
- **Derived:** no

## Status

### RB-HLR-ATT-340 — Sensor status is published

**The system shall publish, at least once per second, which of the GPS ground track, the
IMU and the pressure sensor are in use, and whether a calibration is in progress.**

- **Parent:** RB-SYS-ATT-040
- **Source:** `main/sensors.go` `updateAHRSStatus()`, `AHRSStatus` bits 0–4;
  `web/RB-01/plates/js/SixPackInstruments.js`, which draws bit 3 as "align" rather than
  "fail"
- **Verification:** analysis
- **Derived:** no

Verified by analysis: `updateAHRSStatus()` is a 250 ms ticker loop with no return and no
seam; the bit assignments are a straight read of it. The display half — that the pilot
sees the difference between "calibrating" and "failed" — belongs to the HMI suite and is
the natural companion to RB-HLR-TRF-340.

## Not yet verified

The requirements below are specified but have no passing test. They are counted in
`untraced.txt`; see the README for how that budget works.

### RB-HLR-ATT-350 — The attitude survives a loss of GPS, or says it has not

**The system shall either hold the computed pitch and roll within 1° of the aircraft's
attitude for 30 s after the GPS ground track becomes unavailable, or mark the pitch and
roll not current within 1 s of it becoming unavailable.**

- **Parent:** RB-SYS-ATT-020
- **Source:** FHA-ATT-2; `main/sensors_test.go` `TestAttitudeThroughAGPSOutage`
- **Verification:** test
- **Derived:** no

**Known hazard, measured and not mitigated.** The test exists, measures the error and
skips with the numbers rather than failing, so that `make check` stays green and
`go test -v` shows it; it will pass and the skip will come out when either branch of the
"or" holds.

What happens today: goflying's Simple AHRS takes the accelerometer for gravity, and in a
turn the accelerometer points down the aircraft's own z axis. The horizon therefore
levels itself while the aircraft is banked, and nothing in `/situation` says so — only the
turn rate goes invalid (RB-HLR-ATT-270). The ground track counts as lost 3 s after the
last fix, or immediately when the fix is worse than 30 m
(`isGPSGroundTrackValid()`); while a fix under 3 s old is still held the attitude does not
move at all, and when the hold runs out the filter integrates the gyro rate of that one
instant over the whole 3 s.

The mitigation in force is RB-HLR-ATT-210: losing the fix entirely blanks the attitude on
the EFB interfaces. It does **not** cover the inaccurate-fix case, where the attitude stays
"valid" and is wrong, and it does not cover the RB-01's own display.

### RB-HLR-ATT-360 — The attitude engine is the one that was selected

**The system shall compute the attitude with the fusion engine named by the `AHRSEngine`
setting.**

- **Parent:** none
- **Source:** `main/sensors.go` `newAHRS()`
- **Verification:** test
- **Derived:** yes

**Recovered with low confidence, and the code does not implement it.** The Kalman branch
of `newAHRS()` is commented out pending flight test, so every value of `AHRSEngine`
returns the Simple AHRS. Two consequences are visible in the loop that uses it, and both
are why this is written down rather than left as a dormant setting:

- with `AHRSEngine` set to `kalman`, the magnetometer is conditioned for a filter that is
  not running (RB-HLR-ATT-320) and handed to the Simple AHRS, which uses it differently;
- the recovery branch resets the engine only when the engine is not `kalman`, so selecting
  `kalman` also disables the restart that is supposed to recover a broken arithmetic state.

Raised as a problem report rather than written as if the behaviour existed, per §9.1 of
the requirements standard. The decision needed before anything is implemented is whether
`kalman` should be rejected by the settings interface until the branch is restored.

Note also that the second consequence is currently unreachable: `SimpleState.Valid()`
returns `true` unconditionally, so the loop's invalid branch — the one that writes the
sentinel into every attitude field — never runs with the shipped engine. Loss of attitude
is detected downstream instead, by RB-HLR-ATT-200 and RB-HLR-ATT-240.

### RB-HLR-ATT-370 — The fusion filter holds the attitude through aerobatic figures

**The fusion filter shall indicate the vertical within 7° through aileron rolls, a loop,
an Immelmann and 20 s of inverted flight without GPS, within 4° from 5 s after each, and
shall not indicate a valid attitude more than 10° in error.**

- **Parent:** none
- **Source:** `main/sensors.go` `kalmanConfig()`; goflying `ahrs.KalmanAHRS`
- **Verification:** test
- **Derived:** yes

Derived: the figures are the ones flown on the development aircraft, which RB-SYS-ATT-030's
envelope leaves out, and the numbers are what the filter achieves on simulated figures with
perfect sensors (5.2°, 3.3° and none) plus a margin, not what any standard asks for. To be
reviewed together with RB-SYS-ATT-030, and confirmed in flight against an independent
attitude reference before the Kalman branch of `newAHRS()` is restored (RB-HLR-ATT-360).
The vertical, not roll and pitch: those are undefined with the nose straight up.
