//go:build kalmanahrs

// Wires the AHRSProvider adapter for the Kalman filter into
// ahrs_kalman_replay -provider.  Only compiles against a goflying carrying
// notes/goflying-kalman-mag.patch, hence the build tag.
package main

import "github.com/xiaprojects/goflying/ahrs"

type kalmanProviderAdapter struct{ *ahrs.KalmanAHRS }

func (p kalmanProviderAdapter) KalmanState() *ahrs.KalmanState { return &p.KalmanAHRS.KalmanState }

func init() {
	newKalmanProvider = func(cfg map[string]float64, c, d *[3]float64, f *[4]float64) kalmanProvider {
		k := ahrs.NewKalmanAHRS()
		k.SetCalibrations(c, d)
		k.SetSensorQuaternion(f)
		k.SetConfig(cfg)
		return kalmanProviderAdapter{k}
	}
}
