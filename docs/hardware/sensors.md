# Barometric, IMU / AHRS & Pitot Sensors

Stratux can fuse a barometric pressure sensor and an IMU to provide pressure altitude,
attitude (AHRS), and a G-meter, and read a pitot-static sensor for indicated airspeed.
Detection and the polling loop are in `main/sensors.go`; the chip drivers live in the
`sensors/` package (the older ones built on `github.com/stratux/goflying`). Sensors sit on
**I²C bus 1** (bus 0 is tried second) and are probed every ~4 seconds.

## Barometric pressure sensors

The Bosch WHO_AM_I / chip-id register is read at I²C address `0x76`, then `0x77`:

| Chip | Detection | Driver |
|---|---|---|
| BMP388 | chip-id `0x50` | `sensors/bmp388/` |
| BMP390 | chip-id `0x60` (BMP388-compatible) | `sensors/bmp388/` |
| BMP280 | fallback for any other Bosch chip-id at `0x76`/`0x77` | `sensors/bmp280.go` |

> **Caveat:** detection falls back to the BMP280 driver for any *unrecognized* Bosch chip-id.
> So "BMP280" in the logs can mean "a Bosch baro that isn't a BMP388/390" — verify the
> physical part if behavior is off.

Enabled by `BMP_Sensor_Enabled`; reported as `BMPConnected` in `/getStatus`. Pressure
altitude appears as `BaroPressureAltitude` in `/getSituation`, offset by `AltitudeOffset`.

## IMU sensors

Probed by WHO_AM_I at I²C address `0x68`:

| Chip | WHO_AM_I | Driver |
|---|---|---|
| ICM-20948 (InvenSense) | `0xEA` (reg `0x00`) | `sensors/icm20948.go` |
| MPU-9250 | `0x71` (reg `0x75`) | `sensors/mpu9250.go` |
| MPU-9255 | `0x73` | `sensors/mpu9250.go` |
| MPU-6500 | `0x70` | `sensors/mpu9250.go` |
| MPU-6000 / 6050 / **MPU-9150** | `0x68` | `sensors/mpu9250.go` |
| Unknown MPU on some GY-91 boards | `0x75` | `sensors/mpu9250.go` |

The MPU-925x / 615x family all route through the `MPU9250` driver. The `IMUReader`,
`PressureReader` and `AirspeedReader` interfaces are defined in `sensors/imu.go`,
`sensors/pressure.go` and `sensors/airspeed.go`.

Enabled by `IMU_Sensor_Enabled`; reported as `IMUConnected` in `/getStatus`.

## Pitot-static airspeed sensor

| Chip | Detection | Driver |
|---|---|---|
| MS4525DO (TE Connectivity), ±1 psi differential, e.g. `MS4525DO-DS5AI001DP` | plain 4-byte read at I²C `0x28` (interface type I) answering with a fresh, in-range sample | `sensors/ms4525do.go` |

This is the sensor of the Pixhawk-class pitot kits: one port to the pitot tube, the other to
static. It has no registers; a 4-byte read returns 2 status bits, 14 bits of pressure and
11 bits of temperature, which the driver converts with the datasheet transfer functions
(type A output: 10–90 % of counts over the ±1 psi range). Other variants (address, range,
type B output) are a `sensors.MS4525DOConfig` away; the daemon probes the type I part only.
Detection insists on a *fresh* sample within a few reads, so a foreign chip at `0x28` (a
BNO055 answers `0xA0…`, which decodes as "stale", forever) is not taken for a pitot sensor.

`airspeedSender()` (`main/airspeed.go`) runs at 10 Hz:

1. subtracts `AirspeedZeroOffset` (Pa), the sensor's reading at zero airflow;
2. takes the magnitude, so the tube order does not matter;
3. filters the dynamic pressure with a 0.3 s EWMA (the square root inflates the sensor
   noise near zero);
4. below 10 Pa (≈ 8 kt) reports 0, otherwise `common.CalcIndicatedAirspeed()` — the
   compressible ISA sea-level relation an airspeed indicator is calibrated to.

The result is `IndicatedAirSpeed` (knots) in `/getSituation`, with `PitotPressure` (Pa,
filtered, after the offset), `PitotTemperature` (°C) and `PitotLastMeasurementTime`. 0 means
"no airspeed source": the RB-01 HMI then shows ground speed labelled `GS` instead of `IAS`
(`web/RB-01/services/servicesituation.js`). While the sensor is connected it owns the field;
the external-board `ias_mps` key of `POST /bridge/float` is ignored. When the sensor stops
answering (I²C errors, a fault status, or the ASIC stops converting and reports stale data
for 1 s) the last airspeed stands for 1 s, then is zeroed rather than left standing; after
5 s the sensor is dropped and the probe loop reconnects it.

**Zero it before flight.** The offset of the ±1 psi part is up to ±0.25 % of span (±34 Pa,
≈ 15 kt of spurious airspeed), so `AirspeedZeroOffset` must be measured on the installed
unit: `POST /calibrateAirspeed` with the aircraft stationary in still air and the pitot cover
off averages 2 s of samples into the setting (`409` if no sensor is connected or the GPS says
the aircraft is moving). The GPS/AHRS page of the legacy UI has a *Zero Airspeed* button and
shows IAS / pitot pressure / temperature; the RB-01 HMI can call the endpoint from an addon.
The offset drifts a few Pa with temperature, which the deadband absorbs on the ground and is
negligible in flight (15 Pa at 100 kt ≈ 0.2 kt).

There is no enable setting: `pollSensors()` probes for the chip every ~4 s while none is
connected (a miss is logged only in `DEBUG`) and takes it into use as soon as it answers like
one; reported as `AirspeedConnected` in `/getStatus`. To stop using a fitted sensor, unplug
it.

## AHRS calibration & orientation

The IMU-to-aircraft mapping and zero-bias are stored in settings (see
[settings-reference.md](../settings-reference.md)): `IMUMapping`, `SensorQuaternion`, and the
accel/gyro bias vectors `C`/`D`. The HTTP endpoints `POST /orientAHRS`, `/calibrateAHRS`,
`/cageAHRS`, and `/resetGMeter` drive the calibration flow (see [http-api.md](../http-api.md)).

Attitude output appears in `/getSituation` as `AHRSPitch`, `AHRSRoll`, `AHRSGyroHeading`,
`AHRSMagHeading`, `AHRSSlipSkid`, `AHRSTurnRate`, and `AHRSGLoad`, with `3276.7` used as the
"invalid" sentinel value. `AHRSStatus` is a bitmask computed by `updateAHRSStatus()`.

## Magnetometer alignment

`AHRSMagHeading` is tilt-compensated using `AHRSPitch`/`AHRSRoll`, which are in the aircraft
body frame. The raw magnetometer sample is not: the die is rarely aligned with the
accelerometer die, and the board is rarely aligned with the aircraft. Both rotations are
folded into one quaternion, `MagSensorQuaternion`:

```
MagSensorQuaternion = SensorQuaternion (x) qAxis

  qAxis             magnetometer die -> accelerometer die
  SensorQuaternion  accelerometer die -> aircraft body
```

It is rebuilt by `makeMagOrientationQuaternion()` (`main/sensors.go`) whenever the AHRS is
caged, so `POST /cageAHRS` realigns the compass as well as the attitude. `qAxis` is the
`MagAxisMapping{X,Y,Z}` rows - the persistent alignment input, a signed permutation or any
proper rotation (see the flight fit below); `MagSensorQuaternion` is only ever derived.

Two things worth knowing when comparing against older behaviour:

- Tilt compensation used to be disabled on a fresh install, because
  `MagRollPitchInterference` defaulted to `{0,0}` and so zeroed the pitch and roll fed into
  the tilt correction. The heading was a flat-compass heading. At 30° of bank that is worth
  roughly 20° of error at 30° of magnetic dip and 80° at 60° dip — see
  `test/magnetometer_check -synth`.
- The heading was also mirrored: the tilt-compensation `atan2` used the branch that returns
  `360 - heading`, so E and W were swapped and the compass ran backwards. No choice of
  mapping or quaternion can correct that, because a rotation cannot flip handedness. Both
  are fixed, so **a unit upgrading from an older release must re-verify its heading against a
  known reference** before trusting it.

**GY85 / QMC5883P note.** The QMC5883P's axes are right-handed relative to the ADXL345 on
the same board; the die sits at a -90 degree yaw, `MagAxisMapping = {0,1,0},{-1,0,0},{0,0,1}`.

A revision of this driver negated magnetometer Z, on the theory that the set was left-handed.
Never do that. A sign flip on one axis is a reflection, and a reflection inverts the vertical
field component while leaving the horizontal one recoverable: the heading still looks right in
level flight, a mapping fitted against GPS track still scores well, and only the tilt
compensation - the one thing the vertical component feeds - pushes the wrong way. The symptom
is a heading that is steady on the ground and degrades with bank. It also shows up as an
`Offset` near 180 degrees, which is a sign the mapping is half a turn out rather than a real
die orientation.

**Always check the dip.** `test/magnetometer_check -flightlog` reports it. In the northern
hemisphere the vertical component is positive (down) and the dip matches the WMM value for the
location - +59 degrees in central Italy. A negative dip means a reflection somewhere in the
chain, and no rotation will fix it. Changing an axis sign in the driver also invalidates a
stored calibration envelope: the Z range must be negated and swapped with it.

**Calibrate from a flight, not from a turn on the apron.** The min/max envelope collected
while taxiing a circle is a poor calibration: Z never sweeps its range, the field next to a
hangar is not the field in flight, the smoothed extremes clip, and it silently breaks whenever
the driver's scale factor changes. Record a normal flight with the datalog on (banks and
pitch changes are what make it work), then:

```sh
./test/magnetometer_check -flightlog flightlog-YYYYMMDDhhmmss.NNNN.sqlite \
    -sensorq w,x,y,z        # SensorQuaternion from GET /getSettings
```

It fits an ellipsoid to the raw samples (`common.FitMagEllipsoid`), reports the soft-iron
residual as the spread of |m|, scores every axis mapping against the GPS track, then refines
the orientation with a small body-frame rotation on top of the best permutation, and prints
the exact `/setSettings` and `/magnetometer` JSON to apply. The refinement matters: the cage's
`SensorQuaternion` carries the accelerometer's bias into the tilt (an ADXL345 reading 0.88 g
at rest put 17° of pitch into it where the magnetometer needed ~11°), and the magnetometer
inherits that error unless it is fitted from the field itself. On the reference RB unit the
in-flight heading residual went 44° (stale calibration) → 13° (calibration) → 9.6° (refined
orientation; 7° level, 13° banked), which also beats the pre-quaternion code (11° / 7° / 17°).
`MagAxisMapping` rows may be any proper rotation, not only a permutation; they are
re-orthonormalized on load, so rounding to a few decimals is fine. Re-run the fit after a
re-cage: the refinement corrects the *current* `SensorQuaternion`.

**Live view.** The RB-01 addon `web/RB-01/addons/magnetometer.*` (reached at
`/RB-01/#/addons/magnetometer`) shows the field vector in 3D in the magnetometer's own frame,
with a fading trail, the stored calibration envelope (green: the unit sphere in CALIBRATED
mode, the ellipsoid in counts in RAW mode) and the bounds seen since the plate was opened
(yellow). A good calibration keeps the trail on the green sphere at |m| ≈ 1 at any attitude;
hard iron shows as an off-centre trail, a wrong axis scale as an ellipse. CALIBRATE / STOP &
STORE drive the daemon's min/max envelope over `/magnetometer`. It uses the Three.js already
bundled for the synthetic vision, so it works with no network.

Validate the pipeline with the standalone tool (`make -C test`):

```sh
./test/magnetometer_check -synth      # heading recovery against a synthetic truth model
./test/magnetometer_check -ahrs       # same, with pitch/roll from goflying's own solver
./test/magnetometer_check -migrate    # legacy matrix -> quaternion conversion
./test/magnetometer_check -csv sensors_20260101_120000.csv   # replay an AHRS log
```
