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

// Relative humidity from the AHT20 (sensors/aht20.go), usually the second
// chip of the "AHT20 + BMP280" breakout. pollSensors (main/sensors.go) probes
// it every 4 s while BMP_Sensor_Enabled, the same switch as the baro it
// ships with; humiditySender copies it into mySituation.BaroHumidity unless
// the pressure sensor measures humidity itself (BME680), which then keeps
// the field. Either way the icing loop (main/icing.go) reads the field for
// the dew point.

import (
	"log"
	"time"

	"github.com/kidoman/embd"
	"github.com/xiaprojects/roastbeef/sensors"
)

var myHumidityReader *sensors.AHT20

const (
	humidityDt        = 2 * time.Second // the AHT20's slowest self-heating-safe rate
	humidityDropTicks = 5               // 10 s of read errors and the sensor is dropped for pollSensors to reconnect
)

// pollHumiditySensor is pollSensors' probe for the AHT20 on either bus.
func pollHumiditySensor() {
	globalStatus.HumidityConnected = initHumiditySensor(i2cbus)
	if !globalStatus.HumidityConnected {
		globalStatus.HumidityConnected = initHumiditySensor(i2cbus0)
	}
	if globalStatus.HumidityConnected {
		removeSingleSystemError("humidity-sensor-read")
		go humiditySender()
	}
}

// initHumiditySensor looks for the AHT20 on the bus. Most units have none,
// so a miss is logged only in DEBUG.
func initHumiditySensor(i2cbus embd.I2CBus) (ok bool) {
	aht, err := sensors.NewAHT20(&i2cbus, humidityDt)
	if err != nil {
		if globalSettings.DEBUG {
			log.Printf("Humidity Info: %s\n", err.Error())
		}
		return false
	}
	log.Printf("AHT20 humidity sensor detected at 0x%02X\n", sensors.AHT20_ADDR)
	myHumidityReader = aht
	return true
}

// baroMeasuresHumidity reports whether the connected pressure sensor has its
// own humidity channel (the BME680), which takes precedence.
func baroMeasuresHumidity() bool {
	if !globalStatus.BMPConnected || myPressureReader == nil {
		return false
	}
	_, ok := myPressureReader.(sensors.AirReader)
	return ok
}

// humiditySender copies the AHT20 humidity into mySituation.BaroHumidity
// every 2 s. After 10 s of read errors the field is blanked (0 = no value)
// and the sensor dropped for pollSensors to reconnect; turning
// BMP_Sensor_Enabled off does the same without the error.
func humiditySender() {
	var failNum int
	timer := time.NewTicker(humidityDt)
	defer timer.Stop()
	for globalSettings.BMP_Sensor_Enabled && globalStatus.HumidityConnected {
		<-timer.C
		hum, err := myHumidityReader.Humidity()
		if err != nil {
			failNum++
			if failNum > humidityDropTicks {
				myHumidityReader.Close()
				globalStatus.HumidityConnected = false // Try reconnecting a little later
				if !baroMeasuresHumidity() {
					mySituation.BaroHumidity = 0
				}
				addSingleSystemErrorf("humidity-sensor-read", "Humidity Error: Couldn't read the AHT20: %s", err.Error())
				return
			}
			continue
		}
		failNum = 0
		if !baroMeasuresHumidity() {
			mySituation.BaroHumidity = float32(hum)
		}
	}
	if globalStatus.HumidityConnected {
		myHumidityReader.Close()
		globalStatus.HumidityConnected = false
		removeSingleSystemError("humidity-sensor-read")
	}
	if !baroMeasuresHumidity() {
		mySituation.BaroHumidity = 0
	}
}
