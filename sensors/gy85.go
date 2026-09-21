// Package sensors provides a stratux interface to sensors used for AHRS calculations.
package sensors

import (
	"fmt"
	"math"
	"time"

	"github.com/kidoman/embd"
)

const (
	// ITG-3200 Gyroscope
	ITG3200_ADDR       = 0x68
	ITG3200_PWR_MGMT   = 0x3E // PWR_MGM
	ITG3200_GYRO_XOUT  = 0x1D
	ITG3200_TEMP_OUT   = 0x1B
	ITG3200_DLPF_FS    = 0x16
	ITG3200_SMPLRT_DIV = 0x15
	ITG3200_WHO_AM_I   = 0x00
	ITG3200_ID         = 0x69

	// PWR_MGM: CLKSEL=1 selects the PLL with the X gyro as reference, which the
	// datasheet recommends over the internal oscillator for stability.
	ITG3200_PWR_MGMT_PLL_X = 0x01

	// ADXL345 Accelerometer
	ADXL345_ADDR        = 0x53
	ADXL345_POWER_CTL   = 0x2D
	ADXL345_DATA_FORMAT = 0x31
	ADXL345_DATAX0      = 0x32
	ADXL345_BW_RATE     = 0x2C
	ADXL345_DEVID       = 0x00
	ADXL345_DEVID_VAL   = 0xE5

	// Gyro sensitivity: 14.375 LSB/deg/s.  The ITG-3200 requires FS_SEL=3
	// (+/-2000 deg/s), so unlike the accel and mag this scale never varies.
	GYRO_SENSITIVITY = 14.375
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

	// CONTROL_1 mode field (bits 1:0): normal (continuous) measurement.
	QMC5883P_MODE_NORMAL = 0x01

	// Sign definition and set/reset mode used by the datasheet example.
	QMC5883P_SIGN_DEF_VAL = 0x06
)

// GY85Config parameterises the initialisation of the three chips on a GY-85.
//
// The guiding principle is that the sensors are polled synchronously by the
// caller, so every chip is configured to produce data at (just above) the rate
// the caller consumes it, and all averaging/anti-alias filtering is delegated
// to the chips themselves.  Running a chip faster than the poll rate would only
// alias the discarded samples into the ones that are kept.
//
// Set TargetHz to the rate at which Read() will be called and leave the rate
// fields zero to have them derived; set any individual field to override.
type GY85Config struct {
	// TargetHz is the rate at which the application calls Read().
	// main.sensorAttitudeSender polls at 20 Hz.
	TargetHz int

	// GyroLPFHz is the ITG-3200 low-pass bandwidth: 5, 10, 20, 42, 98, 188 or
	// 256 Hz.  Zero derives the widest bandwidth that still satisfies
	// Nyquist for GyroODRHz.  The gyro range is not configurable: the
	// ITG-3200 mandates FS_SEL=3 (+/-2000 deg/s).
	GyroLPFHz int
	// GyroODRHz is the gyro output rate.  It must divide the internal sample
	// rate exactly (1 kHz, or 8 kHz when GyroLPFHz is 256).  Zero uses TargetHz.
	GyroODRHz int

	// AccelRangeG is the ADXL345 full-scale range: 2, 4, 8 or 16 g.
	AccelRangeG int
	// AccelFixedRes selects the ADXL345's fixed 10-bit mode.  The default
	// (false) is FULL_RES, which holds 3.9 mg/LSB at every range and is what
	// you want unless you are chasing power.
	AccelFixedRes bool
	// AccelODRHz is the ADXL345 output rate; it must be 6.25*2^n Hz.  The part
	// has no separate low-pass, its bandwidth is always ODR/2.  Zero selects
	// the lowest available rate >= TargetHz.
	AccelODRHz float64

	// MagRangeG is the QMC5883P full-scale range in Gauss: 2, 8, 12 or 30.
	MagRangeG int
	// MagODRHz is the QMC5883P output rate: 10, 50, 100 or 200 Hz.  Zero
	// selects the lowest available rate >= TargetHz.
	MagODRHz int
	// MagOSR1 (8, 4, 2, 1) and MagOSR2 (1, 2, 4, 8) set the on-chip
	// oversampling and downsampling filters.  Higher values mean less noise
	// and more current.
	MagOSR1, MagOSR2 int

	// I2CSpeedHz is the bus clock, used to reject output rates the bus cannot
	// drain.  Zero assumes the Raspberry Pi default of 100 kHz.
	I2CSpeedHz int
}

// DefaultGY85Config returns the configuration used by NewGY85: everything
// matched to the 20 Hz AHRS poll loop, with the chips doing the filtering.
func DefaultGY85Config() GY85Config {
	return GY85Config{
		TargetHz:    20,
		AccelRangeG: 8,
		MagRangeG:   8,
		MagOSR1:     8,
		MagOSR2:     2,
		I2CSpeedHz:  100000,
	}
}

// ITG-3200 DLPF_CFG: low-pass bandwidth and the resulting internal sample rate,
// widest first.
var itg3200DLPF = []struct {
	bwHz       int
	cfg        byte
	internalHz int
}{
	{256, 0, 8000},
	{188, 1, 1000},
	{98, 2, 1000},
	{42, 3, 1000},
	{20, 4, 1000},
	{10, 5, 1000},
	{5, 6, 1000},
}

// QMC5883P CONTROL_1 output data rates (bits 3:2), lowest first.
var qmc5883pODR = []struct {
	hz   int
	bits byte
}{
	{10, 0x00},
	{50, 0x01},
	{100, 0x02},
	{200, 0x03},
}

// applyDefaults derives every unset rate from TargetHz and rejects
// combinations that cannot be represented in the registers.
func (c *GY85Config) applyDefaults() error {
	if c.TargetHz <= 0 {
		return fmt.Errorf("GY85Config: TargetHz must be positive, got %d", c.TargetHz)
	}
	if c.I2CSpeedHz <= 0 {
		c.I2CSpeedHz = 100000
	}

	if c.GyroODRHz == 0 {
		c.GyroODRHz = c.TargetHz
	}
	if c.GyroLPFHz == 0 {
		// Widest bandwidth that still satisfies Nyquist at the output rate.
		for _, e := range itg3200DLPF {
			if e.bwHz*2 <= c.GyroODRHz {
				c.GyroLPFHz = e.bwHz
				break
			}
		}
		if c.GyroLPFHz == 0 {
			// Below 10 Hz output; take the narrowest filter available.
			c.GyroLPFHz = itg3200DLPF[len(itg3200DLPF)-1].bwHz
		}
	}

	if c.AccelODRHz == 0 {
		// Lowest ADXL345 rate that still delivers a fresh sample per poll.
		c.AccelODRHz = 6.25 * math.Pow(2, math.Ceil(math.Log2(float64(c.TargetHz)/6.25)))
	}
	if c.AccelRangeG == 0 {
		c.AccelRangeG = 8
	}

	if c.MagODRHz == 0 {
		for _, e := range qmc5883pODR {
			if e.hz >= c.TargetHz {
				c.MagODRHz = e.hz
				break
			}
		}
		if c.MagODRHz == 0 {
			return fmt.Errorf("GY85Config: TargetHz %d exceeds the QMC5883P maximum of 200 Hz", c.TargetHz)
		}
	}
	if c.MagRangeG == 0 {
		c.MagRangeG = 8
	}
	if c.MagOSR1 == 0 {
		c.MagOSR1 = 8
	}
	if c.MagOSR2 == 0 {
		c.MagOSR2 = 1
	}
	return nil
}

// itg3200DLPFReg returns the DLPF_FS register value (FS_SEL forced to 3, the
// only setting the ITG-3200 supports) and the internal sample rate the sample
// rate divider will be applied to.
func itg3200DLPFReg(bwHz int) (reg byte, internalHz int, err error) {
	for _, e := range itg3200DLPF {
		if e.bwHz == bwHz {
			// FS_SEL=3 (+/-2000 deg/s) in bits 4:3, DLPF_CFG in bits 2:0.
			return 0x18 | e.cfg, e.internalHz, nil
		}
	}
	return 0, 0, fmt.Errorf("gyro LPF %d Hz invalid; use 5, 10, 20, 42, 98, 188 or 256", bwHz)
}

// itg3200Divider returns SMPLRT_DIV for the requested output rate.
func itg3200Divider(odrHz, internalHz int) (byte, error) {
	if odrHz <= 0 || internalHz%odrHz != 0 {
		return 0, fmt.Errorf("gyro ODR %d Hz does not divide the %d Hz internal rate exactly", odrHz, internalHz)
	}
	div := internalHz/odrHz - 1
	if div > 255 {
		return 0, fmt.Errorf("gyro ODR %d Hz too low for the %d Hz internal rate (divider %d > 255)", odrHz, internalHz, div)
	}
	return byte(div), nil
}

// adxl345Format returns DATA_FORMAT and the resulting scale in g per LSB.
func adxl345Format(rangeG int, fixedRes bool) (reg byte, gPerLSB float64, err error) {
	switch rangeG {
	case 2:
		reg = 0x00
	case 4:
		reg = 0x01
	case 8:
		reg = 0x02
	case 16:
		reg = 0x03
	default:
		return 0, 0, fmt.Errorf("accel range +/-%dg invalid; use 2, 4, 8 or 16", rangeG)
	}
	if fixedRes {
		// 10 bits spread over the full +/-range.
		gPerLSB = float64(rangeG) / 512.0
	} else {
		// FULL_RES holds the scale at 3.9 mg/LSB and grows the word length.
		reg |= 0x08
		gPerLSB = 0.0039
	}
	return reg, gPerLSB, nil
}

// adxl345RateCode returns the BW_RATE rate code for an output rate of
// 6.25*2^n Hz, with LOW_POWER left clear.
func adxl345RateCode(odrHz float64, i2cSpeedHz int) (byte, error) {
	if odrHz <= 0 {
		return 0, fmt.Errorf("accel ODR must be positive, got %g Hz", odrHz)
	}
	exp := math.Log2(odrHz / 6.25)
	n := math.Round(exp)
	if math.Abs(exp-n) > 1e-6 {
		return 0, fmt.Errorf("accel ODR %g Hz is not an ADXL345 rate; use 6.25*2^n (12.5, 25, 50, 100, 200, ...)", odrHz)
	}
	code := int(n) + 6
	if code < 0 || code > 15 {
		return 0, fmt.Errorf("accel ODR %g Hz out of range (0.1 .. 3200 Hz)", odrHz)
	}
	// The datasheet caps the usable output rate by bus bandwidth: roughly
	// 200 Hz on a 100 kHz bus, 800 Hz on a 400 kHz bus.
	if maxODR := float64(i2cSpeedHz) / 500.0; odrHz > maxODR {
		return 0, fmt.Errorf("accel ODR %g Hz exceeds the %.0f Hz usable on a %d Hz I2C bus", odrHz, maxODR, i2cSpeedHz)
	}
	return byte(code), nil
}

// qmc5883pCtrl2 returns CONTROL_2 and the resulting scale in mGauss per LSB.
func qmc5883pCtrl2(rangeG int) (reg byte, mGaussPerLSB float64, err error) {
	// RNG occupies bits 3:2; the counts per Gauss come from the datasheet.
	switch rangeG {
	case 30:
		reg, mGaussPerLSB = 0x00, 1000.0/1000.0
	case 12:
		reg, mGaussPerLSB = 0x04, 1000.0/2500.0
	case 8:
		reg, mGaussPerLSB = 0x08, 1000.0/3750.0
	case 2:
		reg, mGaussPerLSB = 0x0C, 1000.0/15000.0
	default:
		return 0, 0, fmt.Errorf("mag range %dG invalid; use 2, 8, 12 or 30", rangeG)
	}
	return reg, mGaussPerLSB, nil
}

// qmc5883pCtrl1 builds CONTROL_1:
// [OSR2 7:6] [OSR1 5:4] [ODR 3:2] [MODE 1:0]
func qmc5883pCtrl1(odrHz, osr1, osr2 int) (byte, error) {
	var reg byte

	found := false
	for _, e := range qmc5883pODR {
		if e.hz == odrHz {
			reg |= e.bits << 2
			found = true
			break
		}
	}
	if !found {
		return 0, fmt.Errorf("mag ODR %d Hz invalid; use 10, 50, 100 or 200", odrHz)
	}

	switch osr1 {
	case 8:
		reg |= 0x00 << 4
	case 4:
		reg |= 0x01 << 4
	case 2:
		reg |= 0x02 << 4
	case 1:
		reg |= 0x03 << 4
	default:
		return 0, fmt.Errorf("mag OSR1 %d invalid; use 8, 4, 2 or 1", osr1)
	}

	switch osr2 {
	case 1:
		reg |= 0x00 << 6
	case 2:
		reg |= 0x01 << 6
	case 4:
		reg |= 0x02 << 6
	case 8:
		reg |= 0x03 << 6
	default:
		return 0, fmt.Errorf("mag OSR2 %d invalid; use 1, 2, 4 or 8", osr2)
	}

	return reg | QMC5883P_MODE_NORMAL, nil
}

type GY85 struct {
	Bus *embd.I2CBus

	cfg GY85Config

	// Scale factors derived from cfg at initialisation.
	gyroSens  float64 // LSB per deg/s
	accelSens float64 // g per LSB
	magSens   float64 // mGauss per LSB

	lastGyroX, lastGyroY, lastGyroZ    float64
	lastAccelX, lastAccelY, lastAccelZ float64
	lastMagX, lastMagY, lastMagZ       float64
	lastTemp                           float64
	lastRead                           time.Time
}

// NewGY85 initialises a GY-85 with DefaultGY85Config.
func NewGY85(i2cbus *embd.I2CBus) (*GY85, error) {
	return NewGY85WithConfig(i2cbus, DefaultGY85Config())
}

// NewGY85WithConfig initialises a GY-85 from cfg, deriving every register value
// and scale factor from it.  Any combination that cannot be represented in the
// hardware is rejected here rather than silently producing wrong readings.
func NewGY85WithConfig(i2cbus *embd.I2CBus, cfg GY85Config) (*GY85, error) {
	if err := cfg.applyDefaults(); err != nil {
		return nil, err
	}

	// Encode everything before touching the bus, so a bad configuration fails
	// without leaving the chips half-programmed.
	gyroDLPF, gyroInternalHz, err := itg3200DLPFReg(cfg.GyroLPFHz)
	if err != nil {
		return nil, err
	}
	gyroDiv, err := itg3200Divider(cfg.GyroODRHz, gyroInternalHz)
	if err != nil {
		return nil, err
	}
	if cfg.GyroLPFHz*2 > cfg.GyroODRHz {
		return nil, fmt.Errorf("gyro LPF %d Hz aliases at a %d Hz output rate; use a bandwidth <= %d Hz",
			cfg.GyroLPFHz, cfg.GyroODRHz, cfg.GyroODRHz/2)
	}

	accelFormat, accelSens, err := adxl345Format(cfg.AccelRangeG, cfg.AccelFixedRes)
	if err != nil {
		return nil, err
	}
	accelRate, err := adxl345RateCode(cfg.AccelODRHz, cfg.I2CSpeedHz)
	if err != nil {
		return nil, err
	}

	magCtrl2, magSens, err := qmc5883pCtrl2(cfg.MagRangeG)
	if err != nil {
		return nil, err
	}
	magCtrl1, err := qmc5883pCtrl1(cfg.MagODRHz, cfg.MagOSR1, cfg.MagOSR2)
	if err != nil {
		return nil, err
	}

	m := GY85{
		Bus:       i2cbus,
		cfg:       cfg,
		gyroSens:  GYRO_SENSITIVITY,
		accelSens: accelSens,
		magSens:   magSens,
		lastRead:  time.Now(),
	}

	// --- Gyroscope (ITG-3200) ---
	// Identify before configuring, so a foreign device at this address is not
	// written to.
	gyroID, err := (*i2cbus).ReadByteFromReg(ITG3200_ADDR, ITG3200_WHO_AM_I)
	if err != nil {
		return nil, fmt.Errorf("failed to read gyro chip ID: %w", err)
	}
	if gyroID != ITG3200_ID {
		return nil, fmt.Errorf("gyro chip ID mismatch: got 0x%02x, expected 0x%02x", gyroID, ITG3200_ID)
	}

	// Clear sleep and run off the X gyro PLL rather than the internal oscillator.
	if err := (*i2cbus).WriteToReg(ITG3200_ADDR, ITG3200_PWR_MGMT, []byte{ITG3200_PWR_MGMT_PLL_X}); err != nil {
		return nil, fmt.Errorf("failed to wake gyro: %w", err)
	}
	time.Sleep(100 * time.Millisecond)

	// Full scale (+/-2000 deg/s, mandatory) and low-pass bandwidth.
	if err := (*i2cbus).WriteToReg(ITG3200_ADDR, ITG3200_DLPF_FS, []byte{gyroDLPF}); err != nil {
		return nil, fmt.Errorf("failed to configure gyro DLPF/FS: %w", err)
	}

	// Output rate = internal rate / (divider + 1).
	if err := (*i2cbus).WriteToReg(ITG3200_ADDR, ITG3200_SMPLRT_DIV, []byte{gyroDiv}); err != nil {
		return nil, fmt.Errorf("failed to configure gyro sample rate: %w", err)
	}

	// --- Accelerometer (ADXL345) ---
	accelID, err := (*i2cbus).ReadByteFromReg(ADXL345_ADDR, ADXL345_DEVID)
	if err != nil {
		return nil, fmt.Errorf("failed to read accel chip ID: %w", err)
	}
	if accelID != ADXL345_DEVID_VAL {
		return nil, fmt.Errorf("accel chip ID mismatch: got 0x%02x, expected 0x%02x", accelID, ADXL345_DEVID_VAL)
	}

	if err := (*i2cbus).WriteToReg(ADXL345_ADDR, ADXL345_DATA_FORMAT, []byte{accelFormat}); err != nil {
		return nil, fmt.Errorf("failed to configure accel data format: %w", err)
	}

	// Output rate; bandwidth follows at ODR/2 (LOW_POWER=0).
	if err := (*i2cbus).WriteToReg(ADXL345_ADDR, ADXL345_BW_RATE, []byte{accelRate}); err != nil {
		return nil, fmt.Errorf("failed to configure accel BW_RATE: %w", err)
	}

	// Enable measurement mode
	if err := (*i2cbus).WriteToReg(ADXL345_ADDR, ADXL345_POWER_CTL, []byte{0x08}); err != nil {
		return nil, fmt.Errorf("failed to enable accel measurement: %w", err)
	}
	time.Sleep(100 * time.Millisecond)

	// --- Magnetometer (QMC5883P/HP5883) ---
	chipID, err := (*i2cbus).ReadByteFromReg(HMC5883L_ADDR, QMC5883P_CHIP_ID)
	if err != nil {
		return nil, fmt.Errorf("failed to read mag chip ID: %w", err)
	}
	if chipID != QMC5883P_CHIP_ID_VAL {
		return nil, fmt.Errorf("mag chip ID mismatch: got 0x%02x, expected 0x%02x", chipID, QMC5883P_CHIP_ID_VAL)
	}

	if err := (*i2cbus).WriteToReg(HMC5883L_ADDR, QMC5883P_SIGN_DEF, []byte{QMC5883P_SIGN_DEF_VAL}); err != nil {
		return nil, fmt.Errorf("failed to configure mag sign def: %w", err)
	}

	if err := (*i2cbus).WriteToReg(HMC5883L_ADDR, QMC5883P_CONTROL_2, []byte{magCtrl2}); err != nil {
		return nil, fmt.Errorf("failed to configure mag control2: %w", err)
	}

	if err := (*i2cbus).WriteToReg(HMC5883L_ADDR, QMC5883P_CONTROL_1, []byte{magCtrl1}); err != nil {
		return nil, fmt.Errorf("failed to configure mag control1: %w", err)
	}

	time.Sleep(20 * time.Millisecond)

	return &m, nil
}

// Config returns the effective configuration, with every derived rate resolved.
func (m *GY85) Config() GY85Config {
	return m.cfg
}

// readGyro reads temperature and gyroscope data from the ITG-3200 in one burst.
// The register block runs TEMP_H, TEMP_L, XOUT_H, XOUT_L, YOUT_H, YOUT_L,
// ZOUT_H, ZOUT_L from TEMP_OUT (0x1B) - temperature comes first, before the
// gyro axes.
func (m *GY85) readGyro() (gx, gy, gz, temp float64, err error) {
	data := make([]byte, 8)
	if err = (*m.Bus).ReadFromReg(ITG3200_ADDR, ITG3200_TEMP_OUT, data); err != nil {
		return 0, 0, 0, 0, err
	}

	// Convert raw temperature to Celsius.
	temp = 35.0 + float64(int16(uint16(data[0])<<8|uint16(data[1]))+13200)/280.0

	// Convert raw 16-bit signed values to degrees per second.
	gx = float64(int16(uint16(data[2])<<8|uint16(data[3]))) / m.gyroSens
	gy = float64(int16(uint16(data[4])<<8|uint16(data[5]))) / m.gyroSens
	gz = float64(int16(uint16(data[6])<<8|uint16(data[7]))) / m.gyroSens

	return
}

// readAccel reads accelerometer data from the ADXL345.  The six data registers
// must be read in a single burst; the datasheet warns that reading them
// individually allows the sample to update part-way through.
func (m *GY85) readAccel() (ax, ay, az float64, err error) {
	data := make([]byte, 6)
	if err = (*m.Bus).ReadFromReg(ADXL345_ADDR, ADXL345_DATAX0, data); err != nil {
		return 0, 0, 0, err
	}

	// Little-endian, right-justified with sign extension.
	ax = float64(int16(uint16(data[1])<<8|uint16(data[0]))) * m.accelSens
	ay = float64(int16(uint16(data[3])<<8|uint16(data[2]))) * m.accelSens
	az = float64(int16(uint16(data[5])<<8|uint16(data[4]))) * m.accelSens

	return
}

// readMag reads magnetometer data from QMC5883P/HP5883 (addr 0x2C), in mGauss.
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
	if err = (*m.Bus).ReadFromReg(HMC5883L_ADDR, QMC5883P_DATA_X_LSB, data); err != nil {
		return 0, 0, 0, err
	}

	x := int16(uint16(data[1])<<8 | uint16(data[0]))
	y := int16(uint16(data[3])<<8 | uint16(data[2]))
	z := int16(uint16(data[5])<<8 | uint16(data[4]))

	mx = float64(x) * m.magSens
	my = float64(y) * m.magSens
	// Z is negated: as delivered (with SIGN_DEF as configured above) the three
	// axes form a LEFT-handed set relative to the accelerometer, which no
	// rotation - and so no MagAxisMapping / MagSensorQuaternion - can express.
	// Established from a flight log plus a static sample at a known bearing:
	// every mapping consistent with both the heading sense and the field's dip
	// angle had determinant -1, and the raw Z reads a downward field as up.
	// With Z flipped the die orientation is the plain yaw of the shipped
	// default, MagAxisMapping = {0,-1,0},{1,0,0},{0,0,1}.
	mz = -float64(z) * m.magSens
	return
}

// Read returns the time elapsed since the previous call, Gyro X-Y-Z, Accel
// X-Y-Z, Mag X-Y-Z, error reading Gyro/Accel, and error reading Mag.
//
// The chips are configured to output at the caller's poll rate, with their own
// low-pass and oversampling filters doing the averaging, so this returns the
// latest sample from each rather than averaging in software.
func (m *GY85) Read() (T int64, G1, G2, G3, A1, A2, A3, M1, M2, M3 float64, GAError, MagError error) {
	now := time.Now()
	T = now.Sub(m.lastRead).Nanoseconds()

	var gx, gy, gz, temp, ax, ay, az float64

	// Read gyro and accel data
	gx, gy, gz, temp, GAError = m.readGyro()
	if GAError == nil {
		ax, ay, az, GAError = m.readAccel()
		if GAError == nil {
			G1 = gx
			G2 = gy
			G3 = gz
			A1 = ax
			A2 = ay
			A3 = az

			// Update last values
			m.lastGyroX = gx
			m.lastGyroY = gy
			m.lastGyroZ = gz
			m.lastAccelX = ax
			m.lastAccelY = ay
			m.lastAccelZ = az
			m.lastTemp = temp
		}
	}

	// Read magnetometer data
	var mx, my, mz float64
	mx, my, mz, MagError = m.readMag()
	if MagError == nil {
		M1 = mx
		M2 = my
		M3 = mz

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
	T = time.Now().UnixNano()

	var gx, gy, gz, ax, ay, az float64

	// Read gyro data
	gx, gy, gz, _, GAError = m.readGyro()
	if GAError == nil {
		// Read accel data
		ax, ay, az, GAError = m.readAccel()
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
	var mx, my, mz float64
	mx, my, mz, MagError = m.readMag()
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
