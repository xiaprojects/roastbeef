/*
	Copyright (c) 2024 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	magnetometer.go:
	- Calibrate
	- Generate the /etc/mpu9250cal.json
	{"A01":0,"A02":0,"A03":0,"G01":0,"G02":0,"G03":0,"M01":0,"M02":0,"M03":0,"Ms11":1,"Ms12":0,"Ms13":0,"Ms21":0,"Ms22":1,"Ms23":0,"Ms31":0,"Ms32":0,"Ms33":1}
*/

package main



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
