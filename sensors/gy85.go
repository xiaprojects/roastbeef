// Package sensors provides a stratux interface to sensors used for AHRS calculations.
package sensors

import (
	"fmt"
	"time"

	"github.com/kidoman/embd"
)

const (
	// ITG-3200 Gyroscope
	ITG3200_ADDR       = 0x68
	ITG3200_PWR_MGMT   = 0x3D
	ITG3200_GYRO_XOUT  = 0x1D
	ITG3200_TEMP_OUT   = 0x1B
	ITG3200_DLPF_FS    = 0x16
	ITG3200_SMPLRT_DIV = 0x15
	ITG3200_WHO_AM_I   = 0x00
	ITG3200_ID         = 0x69

	// ADXL345 Accelerometer
	ADXL345_ADDR        = 0x53
	ADXL345_POWER_CTL   = 0x2D
	ADXL345_DATA_FORMAT = 0x31
	ADXL345_DATAX0      = 0x32
	ADXL345_BW_RATE     = 0x2C
	ADXL345_DEVID       = 0x00
	ADXL345_DEVID_VAL   = 0xE5

	// Gyro sensitivity: 14.375 LSB/deg/s
	GYRO_SENSITIVITY = 14.375

	// Accel sensitivity: 3.9 mg/LSB (at ±16g range)
	ACCEL_SENSITIVITY = 0.0039

	// Mag sensitivity: varies by range, using default 0.92 mGauss/LSB
	MAG_SENSITIVITY = 0.92
)

// Magnetometer (QMC5883P / HP5883 clone on many "HMC5883L" boards)
const (
	HMC5883L_ADDR = 0x2C

	// QMC5883P registers
	QMC5883P_CHIP_ID    = 0x00
	QMC5883P_DATA_X_LSB = 0x01 // 0x01..0x06 are data registers
	QMC5883P_STATUS     = 0x09 // bit0 DRDY
	QMC5883P_CONTROL_1  = 0x0A
	QMC5883P_CONTROL_2  = 0x0B
	QMC5883P_SIGN_DEF   = 0x29

	QMC5883P_CHIP_ID_VAL = 0x80
)

// --- Tuning parameters (reliability/quality over raw Hz) ---
const (
	// ITG-3200: choose a conservative bandwidth and output rate.
	// DLPF_CFG=3 => 42Hz LPF and internal sampling 1kHz.
	// FS_SEL=3 (±2000 deg/s) is kept.
	ITG3200_DLPF_FS_42HZ_FS2000 = 0x1B

	// Output rate = 1000Hz/(div+1) when DLPF_CFG != 0.
	ITG3200_SMPLRT_DIV_100HZ = 9 // 100 Hz
	// ITG3200_SMPLRT_DIV_50HZ  = 19 // 50 Hz

	// ADXL345 output data rate (BW_RATE, LOW_POWER=0)
	ADXL345_BW_RATE_100HZ = 0x0A
	// ADXL345_BW_RATE_50HZ  = 0x09
)

type GY85 struct {
	Bus *embd.I2CBus

	lastGyroX, lastGyroY, lastGyroZ    float64
	lastAccelX, lastAccelY, lastAccelZ float64
	lastMagX, lastMagY, lastMagZ       float64
	lastTemp                           float64
	lastRead                           time.Time
}

func NewGY85(i2cbus *embd.I2CBus) (*GY85, error) {
	var m GY85
	m.Bus = i2cbus
	m.lastRead = time.Now()

	// --- Initialize Gyroscope (ITG-3200) ---
	// Wake up gyro from sleep mode (clear sleep bit in PWR_MGMT register)
	if err := (*i2cbus).WriteToReg(ITG3200_ADDR, ITG3200_PWR_MGMT, []byte{0x00}); err != nil {
		return nil, fmt.Errorf("failed to wake gyro: %w", err)
	}
	time.Sleep(100 * time.Millisecond)

	// Set DLPF and full scale (±2000 deg/s) with 42 Hz LPF for cleaner data
	if err := (*i2cbus).WriteToReg(ITG3200_ADDR, ITG3200_DLPF_FS, []byte{ITG3200_DLPF_FS_42HZ_FS2000}); err != nil {
		return nil, fmt.Errorf("failed to configure gyro DLPF/FS: %w", err)
	}

	// Set sample rate divider for 100 Hz output (when DLPF_CFG != 0 internal rate is 1 kHz)
	if err := (*i2cbus).WriteToReg(ITG3200_ADDR, ITG3200_SMPLRT_DIV, []byte{ITG3200_SMPLRT_DIV_100HZ}); err != nil {
		return nil, fmt.Errorf("failed to configure gyro sample rate: %w", err)
	}

	// Check gyro chip ID
	gyroID, err := (*i2cbus).ReadByteFromReg(ITG3200_ADDR, ITG3200_WHO_AM_I)
	if err != nil {
		return nil, fmt.Errorf("failed to read gyro chip ID: %w", err)
	}
	if gyroID != ITG3200_ID {
		return nil, fmt.Errorf("gyro chip ID mismatch: got 0x%02x, expected 0x%02x", gyroID, ITG3200_ID)
	}

	// --- Initialize Accelerometer (ADXL345) ---
	// Set data format (±16g, full resolution)
	if err := (*i2cbus).WriteToReg(ADXL345_ADDR, ADXL345_DATA_FORMAT, []byte{0x0B}); err != nil {
		return nil, fmt.Errorf("failed to configure accel data format: %w", err)
	}

	// Set bandwidth / output data rate for cleaner data (LOW_POWER=0)
	if err := (*i2cbus).WriteToReg(ADXL345_ADDR, ADXL345_BW_RATE, []byte{ADXL345_BW_RATE_100HZ}); err != nil {
		return nil, fmt.Errorf("failed to configure accel BW_RATE: %w", err)
	}

	// Enable measurement mode
	if err := (*i2cbus).WriteToReg(ADXL345_ADDR, ADXL345_POWER_CTL, []byte{0x08}); err != nil {
		return nil, fmt.Errorf("failed to enable accel measurement: %w", err)
	}
	time.Sleep(100 * time.Millisecond)

	// Check accel chip ID
	accelID, err := (*i2cbus).ReadByteFromReg(ADXL345_ADDR, ADXL345_DEVID)
	if err != nil {
		return nil, fmt.Errorf("failed to read accel chip ID: %w", err)
	}
	if accelID != ADXL345_DEVID_VAL {
		return nil, fmt.Errorf("accel chip ID mismatch: got 0x%02x, expected 0x%02x", accelID, ADXL345_DEVID_VAL)
	}

	// --- Initialize Magnetometer (QMC5883P/HP5883) ---
	chipID, err := (*i2cbus).ReadByteFromReg(HMC5883L_ADDR, QMC5883P_CHIP_ID)
	if err != nil {
		return nil, fmt.Errorf("failed to read mag chip ID: %w", err)
	}
	if chipID != QMC5883P_CHIP_ID_VAL {
		return nil, fmt.Errorf("mag chip ID mismatch: got 0x%02x, expected 0x%02x", chipID, QMC5883P_CHIP_ID_VAL)
	}

	// Recommended setup from datasheet examples (keep sign definition and control2)
	if err := (*i2cbus).WriteToReg(HMC5883L_ADDR, QMC5883P_SIGN_DEF, []byte{0x06}); err != nil {
		return nil, fmt.Errorf("failed to configure mag sign def: %w", err)
	}

	if err := (*i2cbus).WriteToReg(HMC5883L_ADDR, QMC5883P_CONTROL_2, []byte{0x08}); err != nil {
		return nil, fmt.Errorf("failed to configure mag control2: %w", err)
	}

	// Build CONTROL_1 instead of using a magic literal.
	// CONTROL_1 layout (per datasheet): [OSR2(7:6)] [OSR1(5:4)] [ODR(3:2)] [MODE(1:0)]
	// Choose: OSR1=8 (00), OSR2=1 (00), ODR=50Hz (01), MODE=continuous (01)
	// => 0b00000101 = 0x05
	magControl1 := byte(0x05)
	if err := (*i2cbus).WriteToReg(HMC5883L_ADDR, QMC5883P_CONTROL_1, []byte{magControl1}); err != nil {
		return nil, fmt.Errorf("failed to configure mag control1: %w", err)
	}

	time.Sleep(20 * time.Millisecond)

	return &m, nil
}

// readGyro reads gyroscope and temperature data from ITG-3200
func (m *GY85) readGyro() (gx, gy, gz, temp float64, err error) {
	// Read 8 bytes starting from GYRO_XOUT (0x1D): XOUT_H, XOUT_L, YOUT_H, YOUT_L, ZOUT_H, ZOUT_L, TEMP_H, TEMP_L
	data := make([]byte, 8)
	for i := 0; i < 8; i++ {
		b, err := (*m.Bus).ReadByteFromReg(ITG3200_ADDR, ITG3200_GYRO_XOUT+byte(i))
		if err != nil {
			return 0, 0, 0, 0, err
		}
		data[i] = b
	}

	// Convert raw 16-bit signed values to degrees per second
	gx = float64(int16(uint16(data[0])<<8|uint16(data[1]))) / GYRO_SENSITIVITY
	gy = float64(int16(uint16(data[2])<<8|uint16(data[3]))) / GYRO_SENSITIVITY
	gz = float64(int16(uint16(data[4])<<8|uint16(data[5]))) / GYRO_SENSITIVITY

	// Convert raw temperature to Celsius (35 + (raw/280))
	temp = 35.0 + float64(int16(uint16(data[6])<<8|uint16(data[7])))/280.0

	return
}

// readAccel reads accelerometer data from ADXL345
func (m *GY85) readAccel() (ax, ay, az float64, err error) {
	// Read 6 bytes starting from DATAX0 (0x32)
	data := make([]byte, 6)
	for i := 0; i < 6; i++ {
		b, err := (*m.Bus).ReadByteFromReg(ADXL345_ADDR, ADXL345_DATAX0+byte(i))
		if err != nil {
			return 0, 0, 0, err
		}
		data[i] = b
	}

	// Convert raw 16-bit signed values to g's
	ax = float64(int16(uint16(data[1])<<8|uint16(data[0]))) * ACCEL_SENSITIVITY
	ay = float64(int16(uint16(data[3])<<8|uint16(data[2]))) * ACCEL_SENSITIVITY
	az = float64(int16(uint16(data[5])<<8|uint16(data[4]))) * ACCEL_SENSITIVITY

	return
}

// readMag reads magnetometer data from QMC5883P/HP5883 (addr 0x2C)
func (m *GY85) readMag() (mx, my, mz float64, err error) {
	// Poll DRDY (status bit0). Datasheet says DRDY resets by reading status via I2C.
	st, err := (*m.Bus).ReadByteFromReg(HMC5883L_ADDR, QMC5883P_STATUS)
	if err == nil {
		// If no fresh data yet, keep last good sample (return last values, no error).
		if (st & 0x01) == 0 {
			return m.lastMagX, m.lastMagY, m.lastMagZ, nil
		}
		// If overflow bit is present/used on your chip revision, consider discarding when set.
		// (Some QMC variants use other status bits; keeping minimal logic here.)
	}

	// Read 6 bytes starting from 0x01: X_LSB,X_MSB,Y_LSB,Y_MSB,Z_LSB,Z_MSB
	data := make([]byte, 6)
	for i := 0; i < 6; i++ {
		b, err := (*m.Bus).ReadByteFromReg(HMC5883L_ADDR, QMC5883P_DATA_X_LSB+byte(i))
		if err != nil {
			return 0, 0, 0, err
		}
		data[i] = b
	}

	x := int16(uint16(data[1])<<8 | uint16(data[0]))
	y := int16(uint16(data[3])<<8 | uint16(data[2]))
	z := int16(uint16(data[5])<<8 | uint16(data[4]))

	// If you want "raw counts", set MAG_SENSITIVITY=1.0 and interpret scaling later.
	mx = float64(x) * MAG_SENSITIVITY
	my = float64(y) * MAG_SENSITIVITY
	mz = float64(z) * MAG_SENSITIVITY
	return
}

// Read returns the average (since last reading) time, Gyro X-Y-Z, Accel X-Y-Z, Mag X-Y-Z,
// error reading Gyro/Accel, and error reading Mag.
func (m *GY85) Read() (T int64, G1, G2, G3, A1, A2, A3, M1, M2, M3 float64, GAError, MagError error) {
	now := time.Now()
	elapsedNs := now.Sub(m.lastRead).Nanoseconds()
	T = elapsedNs

	// Read gyro and accel data
	gx, gy, gz, _, GAError := m.readGyro()
	if GAError == nil {
		ax, ay, az, GAError := m.readAccel()
		if GAError == nil {
			// Calculate averages
			G1 = (gx)
			G2 = (gy)
			G3 = (gz)
			A1 = (ax)
			A2 = (ay)
			A3 = (az)

			// Update last values
			m.lastGyroX = gx
			m.lastGyroY = gy
			m.lastGyroZ = gz
			m.lastAccelX = ax
			m.lastAccelY = ay
			m.lastAccelZ = az
		}
	}

	// Read magnetometer data
	mx, my, mz, MagError := m.readMag()
	if MagError == nil {
		// Calculate averages
		M1 = (mx)
		M2 = (my)
		M3 = (mz)

		// Update last values
		m.lastMagX = mx
		m.lastMagY = my
		m.lastMagZ = mz
	}

	m.lastRead = now

	return
}

// ReadOne returns the most recent time, Gyro X-Y-Z, Accel X-Y-Z, Mag X-Y-Z,
// error reading Gyro/Accel, and error reading Mag.
func (m *GY85) ReadOne() (T int64, G1, G2, G3, A1, A2, A3, M1, M2, M3 float64, GAError, MagError error) {
	now := time.Now()
	T = now.UnixNano()

	// Read gyro data
	gx, gy, gz, _, GAError := m.readGyro()
	if GAError == nil {
		// Read accel data
		ax, ay, az, GAError := m.readAccel()
		if GAError == nil {
			G1 = gx
			G2 = gy
			G3 = gz
			A1 = ax
			A2 = ay
			A3 = az
		}
	}

	// Read magnetometer data
	mx, my, mz, MagError := m.readMag()
	if MagError == nil {
		M1 = mx
		M2 = my
		M3 = mz
	}

	return
}

// Close stops reading the GY-85.
func (m *GY85) Close() {
	// I2CBus is managed externally, nothing to do here
}
