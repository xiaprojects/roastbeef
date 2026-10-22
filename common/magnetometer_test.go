/*
	magnetometer_test.go: requirements-style unit tests for BodyFieldFromMag,
	the calibrated body-frame field RB-01 hands to an external display
	(SituationData.MagBody, forwarded to the EFIS by mag-can-bridge).

	The vector must describe the same field RB-01's own compass uses, so its
	tilt-compensated heading has to equal HeadingFromMagQ's for every sample.
*/

package common

import (
	"math"
	"testing"
)

// The GY-85 envelope and mounting quaternion of the aircraft flown on
// 2026-10-17 (stratux.conf), so the tests run on a real, tilted mounting.
var (
	testMin  = [3]float64{-530, -323, -611}
	testMax  = [3]float64{307, 632, 294}
	testQuat = [4]float64{0.6858026628560556, 0.15056825579080194, 0.13906365800965972, 0.6983302993488335}
)

func testSamples() [][3]float64 {
	var s [][3]float64
	for _, x := range []float64{-450, -110, 250} {
		for _, y := range []float64{-250, 150, 560} {
			for _, z := range []float64{-560, -160, 230} {
				s = append(s, [3]float64{x, y, z})
			}
		}
	}
	return s
}

// The exported vector, tilt-compensated at any attitude, gives exactly the
// heading RB-01's own compass computes (no smoothing, no offset).
func TestBodyFieldFromMagMatchesHeading(t *testing.T) {
	for _, m := range testSamples() {
		bx, by, bz, ok := BodyFieldFromMag(m[0], m[1], m[2],
			testMin[0], testMax[0], testMin[1], testMax[1], testMin[2], testMax[2], testQuat, 46.7)
		if !ok {
			t.Fatalf("BodyFieldFromMag(%v) ok = false with a valid calibration", m)
		}
		for _, att := range [][2]float64{{0, 0}, {8.6, -0.5}, {-5, 30}, {15, -45}} {
			want := HeadingFromMagQ(att[0], att[1], m[0], m[1], m[2],
				testMin[0], testMax[0], testMin[1], testMax[1], testMin[2], testMax[2],
				0, testQuat, true, 1.0, math.NaN())
			got := NormalizeHeadingDeg(MagneticHeadingDeg(att[0], att[1], bx, by, bz))
			if d := math.Abs(HeadingDiffDeg(got, want)); d > 1e-9 {
				t.Errorf("sample %v pitch/roll %v: heading of the vector %.6f, compass %.6f", m, att, got, want)
			}
		}
	}
}

// The vector is scaled to the local field: |B| equals fieldUT.
func TestBodyFieldFromMagMagnitude(t *testing.T) {
	for _, m := range testSamples() {
		bx, by, bz, _ := BodyFieldFromMag(m[0], m[1], m[2],
			testMin[0], testMax[0], testMin[1], testMax[1], testMin[2], testMax[2], testQuat, 46.7)
		if n := math.Sqrt(bx*bx + by*by + bz*bz); !near(n, 46.7, 1e-9) {
			t.Errorf("sample %v: |B| = %.9f uT, want 46.7", m, n)
		}
	}
}

// Body frame is FRD: with the identity mounting (goflying's FLU body frame),
// a field along +Y (left) comes out along -Y (right wing) and +Z (up) along -Z.
func TestBodyFieldFromMagFrame(t *testing.T) {
	ident := [4]float64{1, 0, 0, 0}
	cases := []struct{ in, want [3]float64 }{
		{[3]float64{1, 0, 0}, [3]float64{50, 0, 0}},
		{[3]float64{0, 1, 0}, [3]float64{0, -50, 0}},
		{[3]float64{0, 0, 1}, [3]float64{0, 0, -50}},
	}
	for _, c := range cases {
		x, y, z, ok := BodyFieldFromMag(c.in[0], c.in[1], c.in[2], -1, 1, -1, 1, -1, 1, ident, 50)
		if !ok || !near(x, c.want[0], 1e-12) || !near(y, c.want[1], 1e-12) || !near(z, c.want[2], 1e-12) {
			t.Errorf("BodyFieldFromMag(%v) = %v %v %v %v, want %v true", c.in, x, y, z, ok, c.want)
		}
	}
}

// No calibration, no vector: an unset quaternion (AHRS never caged) or an
// envelope that is empty on any axis (as CalibrationReset leaves it) gives
// ok == false.
func TestBodyFieldFromMagNotCalibrated(t *testing.T) {
	if _, _, _, ok := BodyFieldFromMag(1, 2, 3,
		testMin[0], testMax[0], testMin[1], testMax[1], testMin[2], testMax[2],
		[4]float64{0, 0, 0, 0}, 46.7); ok {
		t.Error("unset quaternion: ok = true, want false")
	}
	if _, _, _, ok := BodyFieldFromMag(1, 2, 3, 99999, -99999, 99999, -99999, 99999, -99999,
		testQuat, 46.7); ok {
		t.Error("reset envelope: ok = true, want false")
	}
	if _, _, _, ok := BodyFieldFromMag(1, 2, 3, -10, 10, 5, 5, -10, 10, testQuat, 46.7); ok {
		t.Error("axis that never moved: ok = true, want false")
	}
}
