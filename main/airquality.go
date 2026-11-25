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

// Air quality from the ENS160 MOX gas sensor (sensors/ens160.go), usually on
// the "ENS160 + AHT21" breakout. pollSensors (main/sensors.go) probes it
// every 4 s while BMP_Sensor_Enabled; airQualitySender reads it once a
// second into mySituation.AirQuality* and, once warmed up, into the EMS probes
// airquality_aqi/_eco2/_tvoc that rbvoice-aircraft-rules.json alarms on, feeding it the AHT20/21 temperature
// and humidity (main/humidity.go) for compensation when that sensor is read.
// It is not a carbon monoxide detector.

import (
	"errors"
	"log"
	"math"
	"time"

	"github.com/kidoman/embd"
	"github.com/xiaprojects/roastbeef/sensors"
)

var (
	myAirQualityReader *sensors.ENS160
	errAirQualityStale = errors.New("no new sample for 5 s")
)

const (
	airQualityDt        = time.Second // the ENS160's standard-mode sample rate
	airQualityDropTicks = 10          // 10 s of read errors and the sensor is dropped for pollSensors to reconnect
	airQualityStaleTime = 5 * time.Second
)

// pollAirQualitySensor is pollSensors' probe for the ENS160 at both
// addresses on either bus.
func pollAirQualitySensor() {
	for _, bus := range []embd.I2CBus{i2cbus, i2cbus0} {
		for _, addr := range []byte{sensors.ENS160_ADDR_HIGH, sensors.ENS160_ADDR_LOW} {
			if initAirQualitySensor(bus, addr) {
				globalStatus.AirQualityConnected = true
				removeSingleSystemError("airquality-sensor-read")
				go airQualitySender()
				return
			}
		}
	}
}

// initAirQualitySensor looks for the ENS160 at addr. Most units have none,
// so a miss is logged only in DEBUG.
func initAirQualitySensor(i2cbus embd.I2CBus, addr byte) (ok bool) {
	ens, err := sensors.NewENS160(&i2cbus, addr)
	if err != nil {
		if globalSettings.DEBUG {
			log.Printf("Air quality Info: %s\n", err.Error())
		}
		return false
	}
	log.Printf("ENS160 air quality sensor detected at 0x%02X\n", ens.Address())
	myAirQualityReader = ens
	return true
}

// clearAirQuality blanks the air quality fields: no sensor.
func clearAirQuality() {
	mySituation.AirQualityIndex = 0
	mySituation.AirQualityTVOC = 0
	mySituation.AirQualityECO2 = 0
	mySituation.AirQualityValidity = ""
	mySituation.AirQualityLastMeasurementTime = time.Time{}
}

// airQualitySender reads the ENS160 once a second. Each tick first writes
// the AHT20/21 temperature and humidity to the sensor when that one is
// read (the chip otherwise assumes 25 C, 50 %RH), then publishes a new
// sample. A sensor that answers but produces no new sample for 5 s, or 10 s
// of read errors, blanks the fields and drops the sensor for pollSensors to
// reconnect; turning BMP_Sensor_Enabled off blanks them without the error.
func airQualitySender() {
	var failNum int
	lastNew := time.Now()
	timer := time.NewTicker(airQualityDt)
	defer timer.Stop()
	for globalSettings.BMP_Sensor_Enabled && globalStatus.AirQualityConnected {
		<-timer.C
		if globalStatus.HumidityConnected && myHumidityReader != nil {
			temp, terr := myHumidityReader.Temperature()
			hum, herr := myHumidityReader.Humidity()
			if terr == nil && herr == nil {
				_ = myAirQualityReader.SetCompensation(temp, hum)
			}
		}
		r, err := myAirQualityReader.Read()
		if err == nil && !r.New && time.Since(lastNew) > airQualityStaleTime {
			err = errAirQualityStale
		}
		if err != nil {
			failNum++
			if failNum > airQualityDropTicks || err == errAirQualityStale {
				myAirQualityReader.Close()
				globalStatus.AirQualityConnected = false // Try reconnecting a little later
				clearAirQuality()
				ems.withdrawInternal(airQualityProbes...)
				addSingleSystemErrorf("airquality-sensor-read", "Air quality Error: Couldn't read the ENS160: %s", err.Error())
				return
			}
			continue
		}
		failNum = 0
		if !r.New {
			continue
		}
		lastNew = time.Now()
		mySituation.AirQualityIndex = r.AQI
		mySituation.AirQualityTVOC = r.TVOC
		mySituation.AirQualityECO2 = r.ECO2
		mySituation.AirQualityValidity = r.Validity.String()
		mySituation.AirQualityLastMeasurementTime = stratuxClock.Time
		// The rules (rbvoice-aircraft-rules.json) only see trustworthy readings: the
		// datasheet's warm-up and start-up outputs would alarm on every power-up.
		if r.Validity == sensors.ENS160Normal {
			ems.publishInternal(map[string]float32{
				PROBE_AIRQUALITY_AQI:  float32(r.AQI),
				PROBE_AIRQUALITY_ECO2: float32(roundTo(float64(r.ECO2), 10)),
				PROBE_AIRQUALITY_TVOC: float32(roundTo(float64(r.TVOC), 10)),
			})
		} else {
			ems.withdrawInternal(airQualityProbes...)
		}
	}
	if globalStatus.AirQualityConnected {
		myAirQualityReader.Close()
		globalStatus.AirQualityConnected = false
		removeSingleSystemError("airquality-sensor-read")
	}
	clearAirQuality()
	ems.withdrawInternal(airQualityProbes...)
}

// airQualityProbes are the EMS probes the ENS160 publishes (main/ems.go).
var airQualityProbes = []string{PROBE_AIRQUALITY_AQI, PROBE_AIRQUALITY_ECO2, PROBE_AIRQUALITY_TVOC}

// roundTo rounds v to a multiple of step: eCO2 and TVOC move by a few units every second,
// and every change is a row in the flight log's ems table.
func roundTo(v, step float64) float64 {
	return math.Round(v/step) * step
}
