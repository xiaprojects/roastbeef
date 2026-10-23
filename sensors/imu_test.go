package sensors

import (
	"testing"

	"github.com/xiaprojects/goflying/icm20948"
	"github.com/xiaprojects/goflying/mpu9250"
	"github.com/xiaprojects/roastbeef/sensors/bmx160"
)

// A Read or ReadOne that races Close - the AHRS goroutine waiting on the driver
// while the web UI closes the IMU - gets errIMUClosed on both error returns,
// instead of dereferencing the nil sample that a closed channel yields.
func TestReadAfterClose(t *testing.T) {
	cMPU := make(chan *mpu9250.MPUData)
	close(cMPU)
	cICM := make(chan *icm20948.MPUData)
	close(cICM)
	cBMX := make(chan *bmx160.BMX160Data)
	close(cBMX)
	readers := map[string]IMUReader{
		"MPU9250":  &MPU9250{mpu: &mpu9250.MPU9250{C: cMPU, CAvg: cMPU}},
		"ICM20948": &ICM20948{mpu: &icm20948.ICM20948{C: cICM, CAvg: cICM}},
		"BMX160":   &BMX160{dev: &bmx160.BMX160{C: cBMX, CAvg: cBMX}},
	}
	for name, r := range readers {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if p := recover(); p != nil {
					t.Fatalf("panics: %v", p)
				}
			}()
			if _, _, _, _, _, _, _, _, _, _, ga, mag := r.Read(); ga != errIMUClosed || mag != errIMUClosed {
				t.Errorf("Read: errors %v, %v; want errIMUClosed for both", ga, mag)
			}
			if _, _, _, _, _, _, _, _, _, _, ga, mag := r.ReadOne(); ga != errIMUClosed || mag != errIMUClosed {
				t.Errorf("ReadOne: errors %v, %v; want errIMUClosed for both", ga, mag)
			}
		})
	}
}
