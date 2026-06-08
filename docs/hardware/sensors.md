# Barometric & IMU / AHRS Sensors

Stratux can fuse a barometric pressure sensor and an IMU to provide pressure altitude,
attitude (AHRS), and a G-meter. Detection and the polling loop are in `main/sensors.go`; the
chip drivers live in the `sensors/` package (built on `github.com/stratux/goflying`). Sensors
sit on **I²C bus 1** and are probed every ~4 seconds.

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

The MPU-925x / 615x family all route through the `MPU9250` driver. The `IMUReader` and
`PressureReader` interfaces are defined in `sensors/imu.go` and `sensors/pressure.go`.

Enabled by `IMU_Sensor_Enabled`; reported as `IMUConnected` in `/getStatus`.

## AHRS calibration & orientation

The IMU-to-aircraft mapping and zero-bias are stored in settings (see
[settings-reference.md](../settings-reference.md)): `IMUMapping`, `SensorQuaternion`, and the
accel/gyro bias vectors `C`/`D`. The HTTP endpoints `POST /orientAHRS`, `/calibrateAHRS`,
`/cageAHRS`, and `/resetGMeter` drive the calibration flow (see [http-api.md](../http-api.md)).

Attitude output appears in `/getSituation` as `AHRSPitch`, `AHRSRoll`, `AHRSGyroHeading`,
`AHRSMagHeading`, `AHRSSlipSkid`, `AHRSTurnRate`, and `AHRSGLoad`, with `3276.7` used as the
"invalid" sentinel value. `AHRSStatus` is a bitmask computed by `updateAHRSStatus()`.
