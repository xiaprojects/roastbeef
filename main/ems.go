/*
	This file is part of RB.

	Copyright (C) 2023 XIAPROJECTS SRL

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

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community

	ems.go: Engine Management System Interface
*/

package main

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

type EMSStratuxPlugin struct {
	StratuxPlugin
	emsData map[string]float32
	// Added Max
	emsDataMax       map[string]float32
	emsDataMin       map[string]float32
	emsDataMutex     *sync.Mutex
	emsIsSendingData bool
}

// Data Logger
type EMSDataLogger struct {
	Clock       time.Time
	SensorName  string
	SensorValue float32
}

var ems = EMSStratuxPlugin{}

func (emsInstance *EMSStratuxPlugin) InitFunc() bool {
	log.Println("Entered EMS init() ...")
	emsInstance.Name = "Unix Socket"
	log.Println("EMS Driver: ", emsInstance.Name)
	emsInstance.emsDataMutex = &sync.Mutex{}
	emsInstance.emsData = make(map[string]float32)
	emsInstance.emsDataMin = make(map[string]float32)
	emsInstance.emsDataMax = make(map[string]float32)

	// Pre-fill with default values
	defaultEMSSensors := []string{"Egt1", "Egt2", "Egt3", "Egt4", "Cht1", "Cht2", "Cht3", "Cht4", "Fuel1", "Fuel2", "Fuel", "Oilpressure", "Oiltemperature", "BatteryVoltage", "AlternatorOut", "ManifoldPressure", "EngineRpm", "Fuelpressure", "Amps", "Fuelremaining", "OutsideTemperature"}
	for _, key := range defaultEMSSensors {
		emsInstance.emsData[strings.ToLower(key)] = 0
	}
	emsInstance.emsData["coolanttemperature"] = 0.0
	emsInstance.emsIsSendingData = true
	go emsInstance.ListenerFunc()
	return true
}

func (emsInstance *EMSStratuxPlugin) makeRBEMSString() string {
	msg := fmt.Sprintf("$RBEMS,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f",
		emsInstance.emsData["enginerpm"],
		emsInstance.emsData["manifoldpressure"],
		emsInstance.emsData["oiltemperature"],
		emsInstance.emsData["oilpressure"],
		emsInstance.emsData["coolanttemperature"],
		emsInstance.emsData["outsidetemperature"],
		emsInstance.emsData["fuelpressure"],
		emsInstance.emsData["fuel1"],
		emsInstance.emsData["fuel2"])
	msg = appendNmeaChecksum(msg)
	msg += "\r\n"
	return msg
}

func (emsInstance *EMSStratuxPlugin) makeRBCYLString() string {
	msg := fmt.Sprintf("$RBCYL,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f",
		emsInstance.emsData["cht1"],
		emsInstance.emsData["cht2"],
		emsInstance.emsData["cht3"],
		emsInstance.emsData["cht4"],
		emsInstance.emsData["egt1"],
		emsInstance.emsData["egt2"],
		emsInstance.emsData["egt3"],
		emsInstance.emsData["egt4"])
	msg = appendNmeaChecksum(msg)
	msg += "\r\n"
	return msg
}

func (emsInstance *EMSStratuxPlugin) ListenerFunc() bool {
	time.Sleep(1 * time.Second)
	timerForTemperatures := 10
	for emsInstance.emsIsSendingData == true {
		emsInstance.emsDataMutex.Lock()
		nmeaRBEMS := emsInstance.makeRBEMSString()
		nmeaRBCYL := emsInstance.makeRBCYLString()
		emsInstance.emsDataMutex.Unlock()
		sendNetFLARM(nmeaRBEMS, time.Second, 0)
		if timerForTemperatures < 1 {
			sendNetFLARM(nmeaRBCYL, time.Second, 0)
			timerForTemperatures = 10
		}
		timerForTemperatures = timerForTemperatures - 1
		time.Sleep(200 * time.Millisecond)
	}
	return true
}

func (emsInstance *EMSStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered EMS shutdown() ...")
	return true
}
