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
	"log"
	"strings"
	"sync"
)

type EMSStratuxPlugin struct {
    StratuxPlugin
	emsData map[string] float32
	// Added Max
	emsDataMax map[string] float32
	emsDataMin map[string] float32
	emsDataMutex *sync.Mutex
}

var ems = EMSStratuxPlugin{}


func (emsInstance *EMSStratuxPlugin)InitFunc() bool {
	log.Println("Entered EMS init() ...")
	emsInstance.Name = "Unix Socket"
	log.Println("EMS Driver: ",emsInstance.Name)
	emsInstance.emsDataMutex = &sync.Mutex{}
	emsInstance.emsData = make(map[string]float32)
	emsInstance.emsDataMin = make(map[string]float32)
	emsInstance.emsDataMax = make(map[string]float32)

	// Pre-fill with default values
	defaultEMSSensors := []string{"Egt1","Egt2","Egt3","Egt4","Cht1","Cht2","Cht3","Cht4","Fuel1","Fuel2","Fuel","Oilpressure","Oiltemperature","BatteryVoltage","AlternatorOut","ManifoldPressure","EngineRpm","Fuelpressure","Amps","Fuelremaining","OutsideTemperature"}
	for _,key := range defaultEMSSensors {
		emsInstance.emsData[strings.ToLower(key)] = 0
	}

	go emsInstance.ListenerFunc()
	return true
}

func (emsInstance *EMSStratuxPlugin)ListenerFunc() bool {
	return true
}


func (emsInstance *EMSStratuxPlugin)ShutdownFunc() bool {
	log.Println("Entered EMS shutdown() ...")
	return true
}
