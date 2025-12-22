/*
	This file is part of RB.

	Copyright (C) 2025 XIAPROJECTS SRL

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

	magnetometer.go:
	- Calibrate
	- Generate the /etc/mpu9250cal.json
	{"A01":0,"A02":0,"A03":0,"G01":0,"G02":0,"G03":0,"M01":0,"M02":0,"M03":0,"Ms11":1,"Ms12":0,"Ms13":0,"Ms21":0,"Ms22":1,"Ms23":0,"Ms31":0,"Ms32":0,"Ms33":1}
*/

package main

import (
	"encoding/json"
)



type MagnetometerData struct {
	MagMaxX		float64
	MagMaxY		float64
	MagMaxZ		float64
	MagMinX		float64
	MagMinY		float64
	MagMinZ		float64
	X			float64
	Y			float64
	Z			float64
	Heading		int
}


func (p MagnetometerData) String() string {
    data, err := json.Marshal(p)
    if err != nil {
        return "{}" // or handle error as needed
    }
    return string(data)
}