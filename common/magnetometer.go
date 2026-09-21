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

	magnetometer.go: pure magnetometer math, shared between the daemon
	(main/magnetometer.go) and the diagnostic tools in test/.

	Frames
	------
	  mag chip   the raw axes of the magnetometer die, as the driver reports them
	  accel chip the raw axes of the accelerometer die
	  body       goflying's aircraft frame: X nose / Y LEFT wing / Z UP. This is
	             the frame SensorQuaternion maps into and AHRSPitch/AHRSRoll
	             are expressed in.
	  FRD        the aerospace frame the tilt-compensation formula uses:
	             X nose / Y right wing / Z down. See BodyFLUToFRD.

	The AHRS already maps accel chip -> body with globalSettings.SensorQuaternion
	(see main/sensors.go, makeOrientationQuaternion). The magnetometer needs the
	same treatment, one step earlier in the chain:

	  q_mag = q_sensor (x) q_axis

	  q_axis   mag chip -> accel chip (the mounting of the magnetometer die)
	  q_sensor accel chip -> body     (the mounting of the board in the aircraft)

	Quaternions are [4]float64 in scalar-first order (w, x, y, z) and the rotation
	matrix convention matches goflying's ahrs.QuaternionToRotationMatrix, so a
	quaternion computed here can be handed straight to the AHRS and vice versa.
	The rotation is written out here rather than imported from goflying because
	this package is also linked into fancontrol.
*/

package common

import "math"

// AHRSInvalid mirrors ahrs.Invalid in goflying: the sentinel written into the
// attitude fields when the AHRS has no valid solution. It is a finite number,
// not NaN, so it never trips a math.IsNaN guard and has to be tested for.
const AHRSInvalid float64 = 3276.7 // 2**15-1

// IsAHRSInvalid reports whether v is the AHRS "no solution" sentinel.
func IsAHRSInvalid(v float64) bool {
	return math.Abs(v-AHRSInvalid) < 0.01
}

// quatEps is the tolerance used when deciding whether a matrix is a rotation
// and whether a quaternion is usable. Generous: these values come from a
// hand-edited config file, not from a calculation.
const quatEps = 1e-6

// QuaternionNorm2 returns the squared norm of q.
func QuaternionNorm2(q [4]float64) float64 {
	return q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]
}

// QuaternionIsSet reports whether q carries an actual rotation. A zero-norm
// quaternion is the "not derived yet" sentinel used for both SensorQuaternion
// and MagSensorQuaternion in the settings.
func QuaternionIsSet(q [4]float64) bool {
	return QuaternionNorm2(q) > quatEps
}

// QuaternionUnit re-scales q to unit norm. A zero-norm quaternion is returned
// as the identity, so callers cannot end up rotating by NaN.
func QuaternionUnit(q [4]float64) [4]float64 {
	n := math.Sqrt(QuaternionNorm2(q))
	if n < quatEps {
		return [4]float64{1, 0, 0, 0}
	}
	return [4]float64{q[0] / n, q[1] / n, q[2] / n, q[3] / n}
}

// QuaternionConjugate returns the inverse rotation of a unit quaternion.
func QuaternionConjugate(q [4]float64) [4]float64 {
	return [4]float64{q[0], -q[1], -q[2], -q[3]}
}

// QuaternionProduct returns the Hamilton product a (x) b, which composes the
// two rotations: applying the result is applying b first, then a.
func QuaternionProduct(a, b [4]float64) [4]float64 {
	return [4]float64{
		a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3],
		a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
		a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1],
		a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0],
	}
}

// QuaternionToRotationMatrix returns the rotation matrix for q, in the same
// convention as goflying's ahrs.QuaternionToRotationMatrix: row-major, and
// applied as v_out = R * v_in.
func QuaternionToRotationMatrix(q [4]float64) [3][3]float64 {
	q0, q1, q2, q3 := q[0], q[1], q[2], q[3]
	return [3][3]float64{
		{+q0*q0 + q1*q1 - q2*q2 - q3*q3, 2 * (-q0*q3 + q1*q2), 2 * (+q0*q2 + q1*q3)},
		{2 * (+q0*q3 + q1*q2), +q0*q0 - q1*q1 + q2*q2 - q3*q3, 2 * (-q0*q1 + q2*q3)},
		{2 * (-q0*q2 + q1*q3), 2 * (+q0*q1 + q2*q3), +q0*q0 - q1*q1 - q2*q2 + q3*q3},
	}
}

// RotationMatrixToQuaternion inverts QuaternionToRotationMatrix.
//
// Unlike goflying's ahrs.RotationMatrixToQuaternion, which always divides by
// q0 = sqrt(1+trace)/2, this uses the branch-on-largest-diagonal form. That
// matters here: a 180 degree mounting such as diag(-1,-1,1) has trace -1, so
// the divide-by-q0 form returns NaN for exactly the axis mappings a builder is
// most likely to configure.
func RotationMatrixToQuaternion(r [3][3]float64) [4]float64 {
	var q [4]float64
	trace := r[0][0] + r[1][1] + r[2][2]

	switch {
	case trace > 0:
		s := math.Sqrt(1+trace) * 2 // s = 4*q0
		q[0] = s / 4
		q[1] = (r[2][1] - r[1][2]) / s
		q[2] = (r[0][2] - r[2][0]) / s
		q[3] = (r[1][0] - r[0][1]) / s
	case r[0][0] > r[1][1] && r[0][0] > r[2][2]:
		s := math.Sqrt(1+r[0][0]-r[1][1]-r[2][2]) * 2 // s = 4*q1
		q[0] = (r[2][1] - r[1][2]) / s
		q[1] = s / 4
		q[2] = (r[0][1] + r[1][0]) / s
		q[3] = (r[0][2] + r[2][0]) / s
	case r[1][1] > r[2][2]:
		s := math.Sqrt(1+r[1][1]-r[0][0]-r[2][2]) * 2 // s = 4*q2
		q[0] = (r[0][2] - r[2][0]) / s
		q[1] = (r[0][1] + r[1][0]) / s
		q[2] = s / 4
		q[3] = (r[1][2] + r[2][1]) / s
	default:
		s := math.Sqrt(1+r[2][2]-r[0][0]-r[1][1]) * 2 // s = 4*q3
		q[0] = (r[1][0] - r[0][1]) / s
		q[1] = (r[0][2] + r[2][0]) / s
		q[2] = (r[1][2] + r[2][1]) / s
		q[3] = s / 4
	}

	return QuaternionUnit(q)
}

// QuaternionRotateVector rotates (x, y, z) by q.
func QuaternionRotateVector(q [4]float64, x, y, z float64) (float64, float64, float64) {
	r := QuaternionToRotationMatrix(QuaternionUnit(q))
	return r[0][0]*x + r[0][1]*y + r[0][2]*z,
		r[1][0]*x + r[1][1]*y + r[1][2]*z,
		r[2][0]*x + r[2][1]*y + r[2][2]*z
}

// rotationTolerance is how far the rows of a mapping may be from orthonormal
// and still be accepted. Rows come from a config file or a fit printed with a
// handful of decimals, so 1e-9 would reject every non-trivial rotation; 1e-2
// admits five-decimal rounding comfortably while still catching a scale, a
// typo, or rows that are not a rotation at all.
const rotationTolerance = 1e-2

// IsRotationMatrix reports whether r is a proper rotation to within
// rotationTolerance: orthonormal rows with determinant +1.
func IsRotationMatrix(r [3][3]float64) bool {
	for i := 0; i < 3; i++ {
		for j := i; j < 3; j++ {
			dot := r[i][0]*r[j][0] + r[i][1]*r[j][1] + r[i][2]*r[j][2]
			want := 0.0
			if i == j {
				want = 1.0
			}
			if math.Abs(dot-want) > rotationTolerance {
				return false
			}
		}
	}

	det := r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1]) -
		r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0]) +
		r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0])

	return math.Abs(det-1) <= rotationTolerance
}

// orthonormalize re-orthonormalizes the rows of an almost-rotation matrix
// (Gram-Schmidt), so that rounding in a config file does not turn into a
// slightly non-unit quaternion.
func orthonormalize(r [3][3]float64) [3][3]float64 {
	unit := func(v [3]float64) [3]float64 {
		n := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
		return [3]float64{v[0] / n, v[1] / n, v[2] / n}
	}
	x := unit(r[0])
	d := r[1][0]*x[0] + r[1][1]*x[1] + r[1][2]*x[2]
	y := unit([3]float64{r[1][0] - d*x[0], r[1][1] - d*x[1], r[1][2] - d*x[2]})
	z := [3]float64{x[1]*y[2] - x[2]*y[1], x[2]*y[0] - x[0]*y[2], x[0]*y[1] - x[1]*y[0]}
	return [3][3]float64{x, y, z}
}

// MagAxisMappingToQuaternion converts the MagAxisMappingX/Y/Z rows into the
// equivalent quaternion. The rows may be a signed axis permutation (the die's
// orientation on the board) or any proper rotation, for instance one fitted
// from a flight; they are re-orthonormalized to absorb rounding.
//
// ok is false when the rows are not a proper rotation. A reflection (det -1)
// has no quaternion representation at all, so a hand-edited mapping with an
// odd number of sign flips has to be reported rather than silently mangled.
func MagAxisMappingToQuaternion(mx, my, mz [3]float64) (q [4]float64, ok bool) {
	r := [3][3]float64{mx, my, mz}
	if !IsRotationMatrix(r) {
		return [4]float64{0, 0, 0, 0}, false
	}
	return RotationMatrixToQuaternion(orthonormalize(r)), true
}

// NormalizeHeadingDeg folds a into [0, 360).
func NormalizeHeadingDeg(a float64) float64 {
	a = math.Mod(a, 360.0)
	if a < 0 {
		a += 360.0
	}
	return a
}

// HeadingDiffDeg returns the shortest angular difference a-b, in (-180, 180].
func HeadingDiffDeg(a, b float64) float64 {
	d := math.Mod(a-b, 360.0)
	if d > 180.0 {
		d -= 360.0
	} else if d <= -180.0 {
		d += 360.0
	}
	return d
}

// CalibrateFromMag applies the hard-iron offset and the diagonal soft-iron
// scale derived from the min/max envelope collected during the calibration
// turn. With normalize set the result is scaled to unit length, which makes the
// field magnitude comparable between samples.
func CalibrateFromMag(
	magX, magY, magZ float64,
	minX, maxX float64,
	minY, maxY float64,
	minZ, maxZ float64,
	normalize bool,
) (float64, float64, float64) {

	// Hard-iron offset: centre of the range on each axis.
	offX := (maxX + minX) * 0.5
	offY := (maxY + minY) * 0.5
	offZ := (maxZ + minZ) * 0.5

	// Semi-range per axis, used as a raw scale factor.
	rngX := (maxX - minX) * 0.5
	rngY := (maxY - minY) * 0.5
	rngZ := (maxZ - minZ) * 0.5

	// Guard against a degenerate range: an axis that never moved.
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

	cx := (magX - offX) / rngX
	cy := (magY - offY) / rngY
	cz := (magZ - offZ) / rngZ

	if normalize {
		n := math.Sqrt(cx*cx + cy*cy + cz*cz)
		if n > eps {
			cx /= n
			cy /= n
			cz /= n
		}
	}

	return cx, cy, cz
}

// MagneticHeadingDeg computes a tilt-compensated magnetic heading (0..360 deg).
//
// magX/magY/magZ must already be in the BODY frame, i.e. the same frame as
// pitchDeg and rollDeg: rollDeg about +X (nose), pitchDeg about +Y (right
// wing), Z down.
//
// fwd and right are the field components resolved onto the aircraft's own
// forward and right-wing axes after the tilt is removed, i.e.
// Ry(-pitch)*Rx(-roll)*mag. The angle from the nose round to magnetic north is
// atan2(right, fwd), so the heading - north round to the nose - is its
// negation: atan2(-right, fwd).
//
// That negation is the difference from the pre-quaternion implementation in
// main/magnetometer.go, which effectively computed atan2(right, fwd) and so
// returned 360-heading: the compass ran backwards, E and W swapped. The comment
// there offered both branches ("if your heading is mirrored...") and the
// mirrored one had been left in place. No mounting quaternion can correct it,
// because a rotation cannot flip handedness - only the atan2 can.
func MagneticHeadingDeg(pitchDeg, rollDeg, magX, magY, magZ float64) float64 {
	phi := rollDeg * math.Pi / 180.0    // roll  (rad)
	theta := pitchDeg * math.Pi / 180.0 // pitch (rad)

	sinPhi := math.Sin(phi)
	cosPhi := math.Cos(phi)
	sinTheta := math.Sin(theta)
	cosTheta := math.Cos(theta)

	fwd := magX*cosTheta + magY*sinTheta*sinPhi + magZ*sinTheta*cosPhi
	right := magY*cosPhi - magZ*sinPhi

	return NormalizeHeadingDeg(math.Atan2(-right, fwd) * 180.0 / math.Pi)
}

// BodyFLUToFRD converts a vector from goflying's aircraft frame to the one
// MagneticHeadingDeg expects.
//
// goflying's cage maps the accelerometer's gravity reaction - which points up -
// onto body +Z, and the chosen forward axis onto +X; right-handed, that makes
// +Y the LEFT wing (X forward, Y left, Z up). MagneticHeadingDeg is written for
// the aerospace convention X forward, Y right, Z down. The two differ by a
// 180-degree rotation about X, i.e. negating Y and Z. The roll and pitch
// angles need no change: goflying reports nose-up and right-wing-down as
// positive, same as the formula assumes (it flips theta internally to get
// there - see goflying/ahrs/quaternions.go ToQuaternion).
//
// Feeding the FLU vector into the FRD formula unconverted does NOT merely
// offset the heading, it mirrors it (90 reads as 270). See
// test/magnetometer_check -ahrs, which drives goflying's own solver.
func BodyFLUToFRD(x, y, z float64) (float64, float64, float64) {
	return x, -y, -z
}

// HeadingFromMagQ computes the smoothed magnetic heading from a raw
// magnetometer sample.
//
// magQuat rotates the sample from the magnetometer frame into goflying's
// aircraft body frame (the frame SensorQuaternion maps into, X forward, Y
// left, Z up), so that pitchDeg and rollDeg - which arrive from the AHRS in
// that frame - describe the same frame as the field vector. An unset
// (zero-norm) quaternion is treated as the identity.
//
// smoothAlpha is the exponential smoothing factor applied to the shortest
// angular difference from lastMagHeading; pass 1 to disable smoothing.
// lastMagHeading may be NaN or the AHRS invalid sentinel, in which case the
// unsmoothed heading is returned.
func HeadingFromMagQ(
	pitchDeg, rollDeg float64,
	magX, magY, magZ float64,
	minX, maxX float64,
	minY, maxY float64,
	minZ, maxZ float64,
	offset float64,
	magQuat [4]float64,
	normalize bool,
	smoothAlpha float64,
	lastMagHeading float64,
) float64 {

	cx, cy, cz := CalibrateFromMag(magX, magY, magZ,
		minX, maxX, minY, maxY, minZ, maxZ, normalize)

	// Rotate the field into goflying's body frame, so it shares a frame with
	// the AHRS pitch and roll used for tilt compensation below, then into the
	// frame the tilt-compensation formula is written for.
	bx, by, bz := cx, cy, cz
	if QuaternionIsSet(magQuat) {
		bx, by, bz = QuaternionRotateVector(magQuat, cx, cy, cz)
	}
	bx, by, bz = BodyFLUToFRD(bx, by, bz)

	// A dropped AHRS solution leaves the sentinel in the attitude fields.
	// Fall back to a flat compass rather than tilt-compensating by 3276.7 deg.
	if IsAHRSInvalid(pitchDeg) || math.IsNaN(pitchDeg) {
		pitchDeg = 0
	}
	if IsAHRSInvalid(rollDeg) || math.IsNaN(rollDeg) {
		rollDeg = 0
	}

	heading := NormalizeHeadingDeg(MagneticHeadingDeg(pitchDeg, rollDeg, bx, by, bz) + offset)

	if math.IsNaN(lastMagHeading) || IsAHRSInvalid(lastMagHeading) || smoothAlpha >= 1.0 {
		return heading
	}

	last := NormalizeHeadingDeg(lastMagHeading)
	return NormalizeHeadingDeg(last + smoothAlpha*HeadingDiffDeg(heading, last))
}

// Centred-dipole model of the geomagnetic field (IGRF-13 epoch 2020): the
// dipole's north geomagnetic pole and the field at the geomagnetic equator.
const (
	dipolePoleLatDeg = 80.65
	dipolePoleLonDeg = -72.68
	dipoleEquatorUT  = 29.8
)

// GeomagneticDipole returns the magnitude in uT and the inclination in
// degrees (positive down) of the earth's field at a position, from the
// centred-dipole approximation.  Away from the magnetic anomalies it is
// within about 5 degrees of dip and 10% of magnitude of the real field -
// enough to reference an AHRS to when nothing better is configured.  Central
// Italy: 46.2 uT / 62 deg against 46.5 uT / 59 deg measured.
func GeomagneticDipole(latDeg, lonDeg float64) (fieldUT, dipDeg float64) {
	const d = math.Pi / 180
	// Geomagnetic latitude: the angle from the dipole equator.
	sinLatM := math.Sin(latDeg*d)*math.Sin(dipolePoleLatDeg*d) +
		math.Cos(latDeg*d)*math.Cos(dipolePoleLatDeg*d)*math.Cos((lonDeg-dipolePoleLonDeg)*d)
	latM := math.Asin(math.Max(-1, math.Min(1, sinLatM)))
	fieldUT = dipoleEquatorUT * math.Sqrt(1+3*sinLatM*sinLatM)
	dipDeg = math.Atan(2*math.Tan(latM)) / d
	return
}
