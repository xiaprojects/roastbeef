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
	08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder
	09 -> Remote display SLAVE: attitude and air data from RB-Sim or RB-01 over USB

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community

	slavenmeadisplay.go: Slave NMEA Display, the attitude and air data a remote display draws
*/

package main

import (
	"fmt"
	"log"
	"math"
	"time"

	"github.com/xiaprojects/roastbeef/common"
)

/*
A slave display reads no sensor of its own: it draws what its master sends on
the NMEA outputs, here the RB-01 instead of an RB-02. The layout is the one the
RB-09 firmware parses (rb-esp main/RB/RB09_Slave.c), mapped as RB-Sim's rb09
profile does (docs/integration/slave-nmea-display-format.md). Both sentences go
out together every globalSettings.SlaveNMEADisplay_SleepMs, 0 sends neither:

$RBATT,-12.34,5.67,-271.50,1.234,0.026,0.000,0.00,0.00,0.00,,,,,,,,*hh

- -12.34, 5.67 = AHRSRoll, AHRSPitch in degrees, + right wing down, + nose up
- -271.50 = yaw, minus AHRSGyroHeading: the display's heading card shows -yaw
  and its turn needle differentiates it. While the heading is unknown (the
  Simple AHRS below taxi speed) the Invalid sentinel goes out as it is, 3276.70
- 1.234, 0.026, 0.000 = acceleration x y z in g: the load factor at the ball
  angle, x normal and y lateral (the display draws the ball at -y), so its G
  meter reads AHRSGLoad
- 0.00, 0.00, 0.00 = gyro: the display reads none
- GPS acceleration, magnetometer, compass and filter beta stay empty

$RBAIR,26.8154,29.92124,,500,185.2,,*hh

- 26.8154 = static pressure in inHg, from BaroPressureAltitude
- 29.92124 = QNH in inHg, the one the HMI posts to the bridge
- OAT empty: the baro sits inside the case
- 500 = BaroVerticalSpeed in feet/minute
- 185.2 = IndicatedAirSpeed in km/h, empty without an airspeed source
- wind empty: only the HMI estimates it

The display has no status field: a sentence that stops is how it learns the
data is gone, and RB-09 shows INOP after 1 s (attitude) or 3 s (air data).
*/

type SlaveNMEADisplayStratuxPlugin struct {
	StratuxPlugin
	enabled bool
}

// Shared instance
var slaveNMEADisplay = SlaveNMEADisplayStratuxPlugin{}

// hPa in one inHg, as RB09_Slave.c converts
const slaveNMEADisplayHPaPerInHg = 33.8639

/*
plugin.InitFunc().

	start thread in background
*/
func (slaveInstance *SlaveNMEADisplayStratuxPlugin) InitFunc() bool {
	log.Println("Entered SlaveNMEADisplay init() ...")
	slaveInstance.Name = "SlaveNMEADisplay"
	slaveInstance.enabled = true
	go slaveInstance.ListenerFunc()
	return true
}

// ListenerFunc sends $RBATT and $RBAIR, then sleeps SlaveNMEADisplay_SleepMs.
// At 0 nothing is sent and the setting is read again every second.
func (slaveInstance *SlaveNMEADisplayStratuxPlugin) ListenerFunc() bool {
	for slaveInstance.enabled == true {
		sleepMs := globalSettings.SlaveNMEADisplay_SleepMs
		if sleepMs <= 0 {
			time.Sleep(1 * time.Second)
			continue
		}
		sleep := time.Duration(sleepMs) * time.Millisecond
		// A sentence still queued when the next one is due is dropped
		if msg, ok := slaveInstance.makeRBATTString(); ok {
			sendNetFLARM(msg, sleep, 4)
		}
		if msg, ok := slaveInstance.makeRBAIRString(); ok {
			sendNetFLARM(msg, sleep, 4)
		}
		time.Sleep(sleep)
	}
	return true
}

/*
plugin.ShutdownFunc().

	set halt variable status to allow thread gracefully exit
*/
func (slaveInstance *SlaveNMEADisplayStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered SlaveNMEADisplay shutdown() ...")
	slaveInstance.enabled = false
	return true
}

// makeRBATTString is the $RBATT of the current attitude. Nothing without the
// IMU (the GPS-derived attitude never goes out), while the attitude is not
// current, or while a field without an unavailable encoding holds the Invalid
// sentinel: only the yaw has one.
func (slaveInstance *SlaveNMEADisplayStratuxPlugin) makeRBATTString() (string, bool) {
	if !(globalSettings.IMU_Sensor_Enabled && globalStatus.IMUConnected) {
		return "", false
	}
	mySituation.muAttitude.Lock()
	current := isAHRSValid()
	roll, pitch, yaw := mySituation.AHRSRoll, mySituation.AHRSPitch, mySituation.AHRSGyroHeading
	slip, g := mySituation.AHRSSlipSkid, mySituation.AHRSGLoad
	mySituation.muAttitude.Unlock()
	if !current || isAHRSInvalidValue(roll) || isAHRSInvalidValue(pitch) || isAHRSInvalidValue(slip) || isAHRSInvalidValue(g) {
		return "", false
	}
	if !isAHRSInvalidValue(yaw) {
		yaw = -math.Mod(math.Mod(yaw, 360)+360, 360)
	}
	// AHRSSlipSkid is + ball left, and the display draws the ball at -y
	ball := math.Max(-20, math.Min(20, slip)) * math.Pi / 180
	g = math.Max(-9.99, math.Min(9.99, g))
	msg := fmt.Sprintf("$RBATT,%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,,,,,,,,",
		roll, pitch, yaw,
		g*math.Cos(ball), g*math.Sin(ball), 0.0,
		0.0, 0.0, 0.0)
	return appendNmeaChecksum(msg) + "\r\n", true
}

// makeRBAIRString is the $RBAIR of the current air data. Nothing without a
// pressure altitude of our own (the $PGRMZ rule) or without a QNH in RB-09's
// 850-1100 hPa: it would show an altitude on a setting nobody made.
func (slaveInstance *SlaveNMEADisplayStratuxPlugin) makeRBAIRString() (string, bool) {
	addonsBridge.bridgeDataMutex.Lock()
	qnh, ok := addonsBridge.bridgeFloatData["qnh"]
	addonsBridge.bridgeDataMutex.Unlock()
	if !ok || !(qnh >= 850 && qnh <= 1100) {
		return "", false
	}
	mySituation.muBaro.Lock()
	valid := isTempPressValid() && mySituation.BaroSourceType != BARO_TYPE_NONE && mySituation.BaroSourceType != BARO_TYPE_ADSBESTIMATE
	alt, vs := mySituation.BaroPressureAltitude, mySituation.BaroVerticalSpeed
	mySituation.muBaro.Unlock()
	if !valid {
		return "", false
	}
	// 0 means no airspeed source, as for the HMI
	ias := ""
	if mySituation.IndicatedAirSpeed > 0 {
		ias = fmt.Sprintf("%.1f", mySituation.IndicatedAirSpeed*1.852)
	}
	// The pressure altitude carries AltitudeOffset, so the static pressure does too
	msg := fmt.Sprintf("$RBAIR,%.4f,%.5f,,%.0f,%s,,",
		common.CalcPressure(float64(alt))/slaveNMEADisplayHPaPerInHg,
		float64(qnh)/slaveNMEADisplayHPaPerInHg,
		vs, ias)
	return appendNmeaChecksum(msg) + "\r\n", true
}
