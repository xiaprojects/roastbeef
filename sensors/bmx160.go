// Package sensors provides a stratux interface to sensors used for AHRS calculations.
package sensors

import (
	"github.com/kidoman/embd"
	"github.com/stratux/stratux/sensors/bmx160"
)

const (
	bmx160GyroRange  = 125 // bmx160GyroRange is the default range to use for the Gyro.
	bmx160AccelRange = 4   // bmx160AccelRange is the default range to use for the Accel.
	bmx160UpdateFreq = 200 // bmx160UpdateFreq is the rate at which to update the sensor values.
)

// BMX160 is a Bosch BMX160 attached to the I2C bus and satisfies
// the IMUReader interface.
type BMX160 struct {
	dev *bmx160.BMX160
}

// NewBMX160 returns an instance of the BMX160 IMUReader, connected to a
// BMX160 attached on the I2C bus.
func NewBMX160(i2cbus *embd.I2CBus) (*BMX160, error) {
	dev, err := bmx160.NewBMX160(i2cbus, bmx160GyroRange, bmx160AccelRange, bmx160UpdateFreq, false, false)
	if err != nil {
		return nil, err
	}

	return &BMX160{dev: dev}, nil
}

// Read returns the average (since last reading) time, Gyro X-Y-Z, Accel X-Y-Z, Mag X-Y-Z,
// error reading Gyro/Accel, and error reading Mag.
func (m *BMX160) Read() (T int64, G1, G2, G3, A1, A2, A3, M1, M2, M3 float64, GAError, MAGError error) {
	var i int8
	data := new(bmx160.BMX160Data)

	for data.N == 0 && i < 5 {
		data = <-m.dev.CAvg
		T = data.T.UnixNano()
		G1 = data.G1
		G2 = data.G2
		G3 = data.G3
		A1 = data.A1
		A2 = data.A2
		A3 = data.A3
		M1 = data.M1
		M2 = data.M2
		M3 = data.M3
		GAError = data.GAError
		MAGError = data.MagError
		i++
	}
	return
}

// ReadOne returns the most recent time, Gyro X-Y-Z, Accel X-Y-Z, Mag X-Y-Z,
// error reading Gyro/Accel, and error reading Mag.
func (m *BMX160) ReadOne() (T int64, G1, G2, G3, A1, A2, A3, M1, M2, M3 float64, GAError, MAGError error) {
	data := <-m.dev.C
	T = data.T.UnixNano()
	G1 = data.G1
	G2 = data.G2
	G3 = data.G3
	A1 = data.A1
	A2 = data.A2
	A3 = data.A3
	M1 = data.M1
	M2 = data.M2
	M3 = data.M3
	GAError = data.GAError
	MAGError = data.MagError
	return
}

// Close stops reading the BMX160.
func (m *BMX160) Close() {
	m.dev.Close()
}
