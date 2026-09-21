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

	magcal.go: magnetometer calibration from recorded samples.

	The min/max envelope collected during a flat turn on the ground is a poor
	calibration: the Z axis never sweeps its range, the field on the apron is
	not the field in flight, and the smoothed extremes clip. Fitting an
	axis-aligned ellipsoid to samples recorded in flight - where the aircraft
	banks and pitches through the field - gives the hard-iron centre and the
	per-axis scale directly, and the fit quality (the spread of |m|) says how
	much soft iron is left over.
*/

package common

import "math"

// MagCalibration is a hard-iron centre and per-axis semi-range, the same
// model CalibrateFromMag applies: (m - Centre) / Semi.
type MagCalibration struct {
	Centre [3]float64
	Semi   [3]float64
}

// Envelope returns the calibration as the min/max pairs MagnetometerData
// stores: minX, maxX, minY, maxY, minZ, maxZ.
func (c MagCalibration) Envelope() [6]float64 {
	return [6]float64{
		c.Centre[0] - c.Semi[0], c.Centre[0] + c.Semi[0],
		c.Centre[1] - c.Semi[1], c.Centre[1] + c.Semi[1],
		c.Centre[2] - c.Semi[2], c.Centre[2] + c.Semi[2],
	}
}

// Magnitude returns |m| after applying the calibration; 1 for a perfect fit.
func (c MagCalibration) Magnitude(x, y, z float64) float64 {
	cx, cy, cz := CalibrateFromMag(x, y, z,
		c.Centre[0]-c.Semi[0], c.Centre[0]+c.Semi[0],
		c.Centre[1]-c.Semi[1], c.Centre[1]+c.Semi[1],
		c.Centre[2]-c.Semi[2], c.Centre[2]+c.Semi[2], false)
	return math.Sqrt(cx*cx + cy*cy + cz*cz)
}

// FitMagEllipsoid fits an axis-aligned ellipsoid to raw magnetometer samples
// by linear least squares on a x^2 + b y^2 + c z^2 + d x + e y + f z = 1.
//
// ok is false when the samples do not constrain all three axes (typically Z,
// when the aircraft never banked or pitched) or the fit is not an ellipsoid.
// Samples are centred and scaled before solving so the normal equations stay
// well conditioned for raw counts in the thousands.
func FitMagEllipsoid(samples [][3]float64) (cal MagCalibration, ok bool) {
	if len(samples) < 12 {
		return cal, false
	}
	var mean [3]float64
	for _, s := range samples {
		for i := range mean {
			mean[i] += s[i]
		}
	}
	for i := range mean {
		mean[i] /= float64(len(samples))
	}
	const scale = 1000.0

	var ata [6][6]float64
	var atb [6]float64
	for _, s := range samples {
		x := (s[0] - mean[0]) / scale
		y := (s[1] - mean[1]) / scale
		z := (s[2] - mean[2]) / scale
		v := [6]float64{x * x, y * y, z * z, x, y, z}
		for i := 0; i < 6; i++ {
			atb[i] += v[i]
			for j := 0; j < 6; j++ {
				ata[i][j] += v[i] * v[j]
			}
		}
	}
	p, solved := solve6(ata, atb)
	if !solved || p[0] <= 0 || p[1] <= 0 || p[2] <= 0 {
		return cal, false
	}
	a, b, c, d, e, f := p[0], p[1], p[2], p[3], p[4], p[5]
	cx, cy, cz := -d/(2*a), -e/(2*b), -f/(2*c)
	k := 1 + a*cx*cx + b*cy*cy + c*cz*cz
	if k <= 0 {
		return cal, false
	}
	cal.Centre = [3]float64{cx*scale + mean[0], cy*scale + mean[1], cz*scale + mean[2]}
	cal.Semi = [3]float64{math.Sqrt(k/a) * scale, math.Sqrt(k/b) * scale, math.Sqrt(k/c) * scale}
	return cal, true
}

// solve6 solves the 6x6 system A x = b by Gaussian elimination with partial
// pivoting. ok is false if the system is singular.
func solve6(a [6][6]float64, b [6]float64) (x [6]float64, ok bool) {
	var m [6][7]float64
	for i := 0; i < 6; i++ {
		for j := 0; j < 6; j++ {
			m[i][j] = a[i][j]
		}
		m[i][6] = b[i]
	}
	for col := 0; col < 6; col++ {
		piv := col
		for r := col + 1; r < 6; r++ {
			if math.Abs(m[r][col]) > math.Abs(m[piv][col]) {
				piv = r
			}
		}
		if math.Abs(m[piv][col]) < 1e-12 {
			return x, false
		}
		m[col], m[piv] = m[piv], m[col]
		for r := 0; r < 6; r++ {
			if r == col {
				continue
			}
			f := m[r][col] / m[col][col]
			for k := col; k < 7; k++ {
				m[r][k] -= f * m[col][k]
			}
		}
	}
	for i := 0; i < 6; i++ {
		x[i] = m[i][6] / m[i][i]
	}
	return x, true
}
