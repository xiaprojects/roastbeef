/*
This file is part of RB.

	Copyright (C) 2026 XIAPROJECTS SRL

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

This source is part of the project RB:
01 -> Display with Synthetic vision, Autopilot and ADSB
02 -> Display with SixPack
03 -> Display with Autopilot, ADSB, Radio, Flight Computer
04 -> Display with EMS: Engine monitoring system
05 -> Display with Stratux BLE Traffic
06 -> Display with Android 6.25" 7" 8" 10" 10.2"
07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box

Community edition will be free for all builders and personal use as defined by the licensing model
Dual licensing for commercial agreement is available
Please join Discord community
*/
package main

// Pitot-static airspeed: the MS4525DO driver (sensors/ms4525do.go) is found
// on the I2C bus by pollSensors (main/sensors.go), read here at 10 Hz into
// mySituation.IndicatedAirSpeed, and zeroed on request from
// POST /calibrateAirspeed (main/managementinterface.go).

import (
	"log"
	"math"
	"time"

	"github.com/kidoman/embd"
	"github.com/xiaprojects/roastbeef/common"
	"github.com/xiaprojects/roastbeef/sensors"
)

var (
	myAirspeedReader sensors.AirspeedReader
	airspeedCal      = make(chan struct{}, 1) // zero-calibration requests for airspeedSender
)

// pollAirspeedSensor is pollSensors' 4 s probe for the pitot sensor: there
// is no enable setting, a chip that answers like an MS4525DO on either bus
// is taken into use and read until it drops out.
func pollAirspeedSensor() {
	globalStatus.AirspeedConnected = initAirspeedSensor(i2cbus) // I2C pitot-static differential pressure.
	if !globalStatus.AirspeedConnected {
		globalStatus.AirspeedConnected = initAirspeedSensor(i2cbus0)
	}
	if globalStatus.AirspeedConnected {
		removeSingleSystemError("airspeed-sensor-read")
		go airspeedSender()
	}
}

// initAirspeedSensor looks for the MS4525DO pitot-static sensor on the bus.
// Most units have none, so a miss is logged only in DEBUG.
func initAirspeedSensor(i2cbus embd.I2CBus) (ok bool) {
	ms, err := sensors.NewMS4525DO(&i2cbus, sensors.MS4525DOConfig{}, 50*time.Millisecond)
	if err != nil {
		if globalSettings.DEBUG {
			log.Printf("Airspeed Info: %s\n", err.Error())
		}
		return false
	}
	log.Printf("MS4525DO pitot sensor detected at 0x%02X\n", ms.Address())
	myAirspeedReader = ms
	return true
}

// Airspeed pipeline constants, see airspeedSender.
const (
	airspeedDt         = 0.1  // s, the sender's period
	airspeedTau        = 0.3  // s, EWMA time constant on the dynamic pressure
	airspeedDeadbandPa = 10.0 // below this (about 8 kt) the airspeed is 0: the zero offset's drift and the noise floor
	airspeedCalSamples = 20   // 2 s of samples averaged into AirspeedZeroOffset
	airspeedHoldTicks  = 10   // 1 s: the last airspeed stands through a transient read error, then it is blanked
)

// airspeedSender turns the pitot differential pressure into
// mySituation.IndicatedAirSpeed at 10 Hz. The stored zero offset comes off
// first (POST /calibrateAirspeed sets it, see the cal branch), then the
// magnitude is taken so the tube order does not matter, a light EWMA tames
// the sensor noise that the square root inflates near zero, and below
// airspeedDeadbandPa the airspeed is 0, which the HMI reads as "no airspeed
// source" and shows the ground speed for. When the sensor stops answering
// the airspeed is blanked after 1 s and the sensor dropped (for pollSensors
// to reconnect) after 5 s, never left standing (FHA-SPD-4).
func airspeedSender() {
	var (
		q           float64 // filtered dynamic pressure, Pa
		first       = true
		failNum     uint8
		calibrating bool
		calSum      float64
		calN        int
	)
	u := airspeedTau / (airspeedTau + airspeedDt)

	timer := time.NewTicker(time.Duration(1000*airspeedDt) * time.Millisecond)
	defer timer.Stop()
	for globalStatus.AirspeedConnected {
		<-timer.C

		raw, err := myAirspeedReader.DifferentialPressure()
		if err != nil {
			failNum++
			if failNum > airspeedHoldTicks {
				mySituation.IndicatedAirSpeed = 0
				mySituation.PitotPressure = 0
				mySituation.PitotLastMeasurementTime = time.Time{}
				first = true
			}
			if failNum > numRetries {
				myAirspeedReader.Close()
				globalStatus.AirspeedConnected = false // Try reconnecting a little later
				addSingleSystemErrorf("airspeed-sensor-read", "Airspeed Error: Couldn't read the pitot sensor: %s", err.Error())
				break
			}
			continue
		}
		failNum = 0

		// Zero calibration: average the raw pressure with no airflow and
		// keep it as the offset. The airspeed reads 0 meanwhile.
		select {
		case <-airspeedCal:
			calibrating, calSum, calN = true, 0, 0
			log.Printf("Airspeed Info: zeroing the pitot sensor\n")
		default:
		}
		if calibrating {
			calSum += raw
			calN++
			if calN >= airspeedCalSamples {
				globalSettings.AirspeedZeroOffset = calSum / float64(calN)
				saveSettings()
				calibrating = false
				first = true
				log.Printf("Airspeed Info: pitot zero offset %.1f Pa\n", globalSettings.AirspeedZeroOffset)
			}
			mySituation.IndicatedAirSpeed = 0
			continue
		}

		dp := math.Abs(raw - globalSettings.AirspeedZeroOffset)
		if first {
			q = dp
			first = false
		}
		q = u*q + (1-u)*dp
		ias := 0.0
		if q >= airspeedDeadbandPa {
			ias = common.CalcIndicatedAirspeed(q)
		}
		temp, _ := myAirspeedReader.Temperature()

		mySituation.IndicatedAirSpeed = float32(ias)
		mySituation.PitotPressure = float32(q)
		mySituation.PitotTemperature = float32(temp)
		mySituation.PitotLastMeasurementTime = stratuxClock.Time
	}
	mySituation.IndicatedAirSpeed = 0
	mySituation.PitotPressure = 0
	mySituation.PitotLastMeasurementTime = time.Time{}
}

// CalibrateAirspeed asks airspeedSender to take the current pitot pressure
// as the zero offset; the aircraft must be stationary in still air.
func CalibrateAirspeed() {
	select { // Only one request needs to be queued.
	case airspeedCal <- struct{}{}:
	default:
	}
}
