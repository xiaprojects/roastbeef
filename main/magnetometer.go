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


	Airworthiness:
	1) You shall repeat this procedure everything you change something in the aircraft
	2) You shall repeat this procedure during winter and during summer
	3) You shall validate your calibration everytime you start a new flight

	How to calibrate:
	1) Reset calibration values:
	curl -X DELETE http://localhost/magnetometer
	2) Check values are stable: Max~Min~Value
	curl -X GET http://localhost/magnetometer
	3) Rotate the aircraft for 360° (if you have convetional tailwheel you shall apply the alternative procedure)
	curl -X GET http://localhost/magnetometer
	4) If the compass is not working well you need the alternative procedure
	5) Once you find the right calibration data you can test them with
	curl -X POST http://localhost/magnetometer  -H "Accept: application/json" -d '{"MagMaxX": 1180,"MagMaxY": 7290,"MagMaxZ": 396,"MagMinX": -4051,"MagMinY": 2401,"MagMinZ": -2242,"X": -454,"Y": 2781,"Z": -595,"Heading": 333,"Offset": 180, "Calibrating": false}'
	6) Store these data
	curl -X PUT http://localhost/magnetometer  -H "Accept: application/json" -d '{"MagMaxX": 1180,"MagMaxY": 7290,"MagMaxZ": 396,"MagMinX": -4051,"MagMinY": 2401,"MagMinZ": -2242,"X": -454,"Y": 2781,"Z": -595,"Heading": 333,"Offset": 180, "Calibrating": false}'

	TODO: Axis mapping if the install does not meet the original chip axis
*/

package main

import (
	"encoding/json"
	"math"
	"sync"
)

var MagnetometerDataMutex *sync.Mutex

// SmoothHeadingAlpha is the exponential smoothing factor applied to
// magnetic heading updates (0..1). Lower values produce smoother output.
const SmoothHeadingAlpha float64 = 0.05

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
	Heading		float64
	Offset		float64
	Calibrating bool
}


func (p MagnetometerData) String() string {
	data, err := json.Marshal(p)
	if err != nil {
		return "{}" // or handle error as needed
	}
	return string(data)
}

func (p *MagnetometerData)CalibrationReset() {
	MagnetometerDataMutex.Lock()
	p.MagMaxX = -99999	// Magnetic Field Range
	p.MagMaxY = -99999	// Magnetic Field Range
	p.MagMaxZ = -99999	// Magnetic Field Range
	p.MagMinX = 99999	// Magnetic Field Range
	p.MagMinY = 99999	// Magnetic Field Range
	p.MagMinZ = 99999	// Magnetic Field Range
	MagnetometerDataMutex.Unlock()
}

func MagApplyCalibration(
	pitchDeg float64,
	rollDeg float64,

	magX float64,
	magY float64,
	magZ float64,

	minX float64, maxX float64,
	minY float64, maxY float64,
	minZ float64, maxZ float64,
	offset float64,
	softIronEnabled bool,
) (float64, float64, float64) {
	// ----------------------------------------------------
	// 1. Hard-iron offsets
	// ----------------------------------------------------
	offX := (maxX - minX)
	offY := (maxY - minY)
	offZ := (maxZ - minZ)

	x := (magX-minX)/offX - 0.5
	y := (magY-minY)/offY - 0.5
	z := (magZ-minZ)/offZ - 0.5

	// ----------------------------------------------------
	// 2. Soft-iron scale normalization (optional but good)
	// ----------------------------------------------------

	if softIronEnabled == true {
	}

	return x, y, z
}

// MagneticHeadingDeg computes a tilt-compensated magnetic heading (0..360 deg).
//
// Assumptions (match your “new axis” dataset):
// - magX/magY/magZ are already remapped into the same BODY frame as pitch/roll.
// - rollDeg is rotation about +X (right-hand rule / per your remap it behaves as X-axis roll).
// - pitchDeg is rotation about +Y.
// - Heading increases clockwise when rotating the body on the horizontal plane (typical compass convention).
//
// If your heading is mirrored (E/W swapped), change atan2(yh, xh) to atan2(-yh, xh) or swap axes.
func MagneticHeadingDeg(pitchDeg, rollDeg, magX, magY, magZ float64) float64 {
	phi := rollDeg * math.Pi / 180.0    // roll  (rad)
	theta := pitchDeg * math.Pi / 180.0 // pitch (rad)

	// Tilt compensation (common form)
	xh := magX*math.Cos(theta) + magZ*math.Sin(theta)
	yh := magX*math.Sin(phi)*math.Sin(theta) + magY*math.Cos(phi) - magZ*math.Sin(phi)*math.Cos(theta)

	headingRad := math.Atan2(yh, xh)
	headingDeg := headingRad * 180.0 / math.Pi

	// Normalize to [0,360)
	headingDeg = math.Mod(headingDeg+360.0, 360.0)
	return headingDeg
}

func CalibrateFromMag(
	magX float64,
	magY float64,
	magZ float64,
	minX float64, maxX float64,
	minY float64, maxY float64,
	minZ float64, maxZ float64, softIronEnabled bool) (float64, float64, float64) {

	// Hard-iron offset: centro dell'intervallo per ciascun asse
	offX := (maxX + minX) * 0.5
	offY := (maxY + minY) * 0.5
	offZ := (maxZ + minZ) * 0.5

	// Semi-range (ampiezza/2) per asse; usato come scale factor grezzo
	rngX := (maxX - minX) * 0.5
	rngY := (maxY - minY) * 0.5
	rngZ := (maxZ - minZ) * 0.5

	// Evita divisioni per zero o range degeneri
	const eps = 1e-12
	if math.Abs(rngX) < eps {
		rngX = 1.0
	}
	if math.Abs(rngY) < eps {
		rngY = 1.0
	}
	if math.Abs(rngZ) < eps {
		rngZ = 1.0
	}

	// Applica correzioni offset + scala (soft-iron diagonale)
	cx := (magX - offX) / rngX
	cy := (magY - offY) / rngY
	cz := (magZ - offZ) / rngZ
	if softIronEnabled == true {
		// Normalizza a modulo 1 (utile per heading e per confronti direzionali)
		n := math.Sqrt(cx*cx + cy*cy + cz*cz)
		if n > eps {
			cx /= n
			cy /= n
			cz /= n
		}
	}

	return cx, cy, cz
}

func HeadingFromMag(
	pitchDeg float64,
	rollDeg float64,
	magX float64,
	magY float64,
	magZ float64,
	minX float64, maxX float64,
	minY float64, maxY float64,
	minZ float64, maxZ float64,
	offset float64,
	softIronEnabled bool,
	lastMagHeading float64,
) float64 {
	cx, cy, cz := CalibrateFromMag(magX,
		magY,
		magZ,
		minX, maxX,
		minY, maxY,
		minZ, maxZ,
		softIronEnabled)
	heading := MagneticHeadingDeg(-pitchDeg, -rollDeg, -cy, -cx, cz) + offset

	// Helper to normalize angle into [0,360)
	normalize := func(a float64) float64 {
		a = math.Mod(a, 360.0)
		if a < 0 {
			a += 360.0
		}
		return a
	}

	heading = normalize(heading)

	// If lastMagHeading is not a number, or smoothing disabled (alpha==1), return raw heading
	if math.IsNaN(lastMagHeading) {
		return heading
	}

	last := normalize(lastMagHeading)

	// Compute shortest angular difference (-180,180]
	delta := heading - last
	if delta > 180.0 {
		delta -= 360.0
	} else if delta <= -180.0 {
		delta += 360.0
	}

	// Apply exponential smoothing on the angular difference, then re-normalize
	smoothed := last + SmoothHeadingAlpha*delta
	smoothed = normalize(smoothed)
	return smoothed
}
