// Package sensors provides a stratux interface to sensors used for AHRS calculations.
package sensors

import (
	"time"

	"github.com/kidoman/embd"
)

type GY85 struct {
	Bus  *embd.I2CBus
	Addr byte

	lastRead time.Time

	accelScale float64 // m/s² per LSB
	gyroScale  float64 // °/s per LSB

	lastGyroX, lastGyroY, lastGyroZ    float64
	lastAccelX, lastAccelY, lastAccelZ float64
	lastTemp                           float64
}

func NewGY85(i2cbus *embd.I2CBus) (*GY85, error) {
	m := &GY85{
		Bus:      i2cbus,
		Addr:     0,
		lastRead: time.Now(),
	}

	return m, nil
}

// Read returns average time since last read (ns), gyro (dps), accel (m/s²), mag unused.
func (m *GY85) Read() (T int64, G1, G2, G3, A1, A2, A3, M1, M2, M3 float64, GAError, MagError error) {

	return 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, nil, nil
}

// ReadOne returns current timestamp (ns) and current gyro/accel.
func (m *GY85) ReadOne() (T int64, G1, G2, G3, A1, A2, A3, M1, M2, M3 float64, GAError, MagError error) {

	return T, 0, 0, 0, 0, 0, 0, 0, 0, 0, nil, nil
}

// Close: bus is managed externally.
func (m *GY85) Close() {}
