/*
	equations_test.go: requirements-style unit tests for the aviation and
	statistics helpers in equations.go.

	Each test names the behaviour it pins down in its comment. Where a
	robustness case documents current behaviour that a caller must guard
	against (rather than behaviour that was chosen), the comment says so;
	those are candidates for derived requirements (docs/certification/roadmap.md,
	Step 4).
*/

package common

import (
	"math"
	"testing"
)

const (
	metersPerArcMinute = 6371008.8 * math.Pi / (180 * 60) // ~1853.25 m with the mean radius used here
	metersPerDegree    = 6371008.8 * math.Pi / 180        // ~111195 m
)

func near(a, b, tol float64) bool {
	return math.Abs(a-b) <= tol
}

// LinReg recovers slope and intercept of an exact line, and rejects
// mismatched, short and vertical inputs with valid == false.
func TestLinReg(t *testing.T) {
	x := []float64{0, 1, 2, 3, 4}
	y := []float64{1, 3, 5, 7, 9} // y = 2x + 1
	slope, intercept, valid := LinReg(x, y)
	if !valid || !near(slope, 2, 1e-12) || !near(intercept, 1, 1e-12) {
		t.Fatalf("LinReg(exact line) = %v, %v, %v; want 2, 1, true", slope, intercept, valid)
	}

	cases := map[string][2][]float64{
		"mismatched lengths": {{0, 1, 2}, {0, 1}},
		"single point":       {{1}, {1}},
		"empty":              {{}, {}},
		"vertical line":      {{3, 3, 3}, {1, 2, 3}},
	}
	for name, c := range cases {
		s, i, v := LinReg(c[0], c[1])
		if v || !math.IsNaN(s) || !math.IsNaN(i) {
			t.Errorf("LinReg(%s) = %v, %v, %v; want NaN, NaN, false", name, s, i, v)
		}
	}
}

// LinRegWeighted with equal weights equals LinReg, and a zero weight sum
// is rejected.
func TestLinRegWeighted(t *testing.T) {
	x := []float64{0, 1, 2, 3}
	y := []float64{0.5, 2.4, 4.6, 6.5}
	w := []float64{1, 1, 1, 1}
	s1, i1, v1 := LinReg(x, y)
	s2, i2, v2 := LinRegWeighted(x, y, w)
	if !v1 || !v2 || !near(s1, s2, 1e-12) || !near(i1, i2, 1e-12) {
		t.Fatalf("LinRegWeighted(equal weights) = %v, %v; LinReg = %v, %v", s2, i2, s1, i1)
	}

	// A point with weight 0 must not influence the fit.
	s3, i3, v3 := LinRegWeighted([]float64{0, 1, 2, 100}, []float64{1, 3, 5, -999}, []float64{1, 1, 1, 0})
	if !v3 || !near(s3, 2, 1e-9) || !near(i3, 1, 1e-9) {
		t.Errorf("LinRegWeighted(ignored outlier) = %v, %v, %v; want 2, 1, true", s3, i3, v3)
	}

	if _, _, v := LinRegWeighted(x, y, []float64{0, 0, 0, 0}); v {
		t.Errorf("LinRegWeighted(zero weights) valid = true; want false")
	}
	if _, _, v := LinRegWeighted(x, y, []float64{1, 1}); v {
		t.Errorf("LinRegWeighted(short weights) valid = true; want false")
	}
}

// The tricube kernel is 1 at the centre, symmetric, and exactly 0 at and
// beyond one half-width.
func TestTriCubeWeight(t *testing.T) {
	if w := TriCubeWeight(10, 5, 10); w != 1 {
		t.Errorf("TriCubeWeight(centre) = %v; want 1", w)
	}
	if l, r := TriCubeWeight(10, 5, 8), TriCubeWeight(10, 5, 12); !near(l, r, 1e-15) || l <= 0 || l >= 1 {
		t.Errorf("TriCubeWeight not symmetric/in (0,1): left=%v right=%v", l, r)
	}
	for _, x := range []float64{5, 15, 0, 100, -100} {
		if w := TriCubeWeight(10, 5, x); w != 0 {
			t.Errorf("TriCubeWeight(%v) = %v; want 0 outside the half-width", x, w)
		}
	}
}

// Min, max, range, mean and sample standard deviation on a known set, and
// their behaviour on empty / too-short input.
func TestStatistics(t *testing.T) {
	x := []float64{2, 4, 4, 4, 5, 5, 7, 9}

	if v, ok := ArrayMin(x); !ok || v != 2 {
		t.Errorf("ArrayMin = %v, %v; want 2, true", v, ok)
	}
	if v, ok := ArrayMax(x); !ok || v != 9 {
		t.Errorf("ArrayMax = %v, %v; want 9, true", v, ok)
	}
	if v, ok := ArrayRange(x); !ok || v != 7 {
		t.Errorf("ArrayRange = %v, %v; want 7, true", v, ok)
	}
	if v, ok := Mean(x); !ok || v != 5 {
		t.Errorf("Mean = %v, %v; want 5, true", v, ok)
	}
	// Sample (n-1) standard deviation of this set is sqrt(32/7).
	if v, ok := Stdev(x); !ok || !near(v, math.Sqrt(32.0/7.0), 1e-12) {
		t.Errorf("Stdev = %v, %v; want %v, true", v, ok, math.Sqrt(32.0/7.0))
	}

	empty := []float64{}
	if v, ok := ArrayMin(empty); ok || !math.IsNaN(v) {
		t.Errorf("ArrayMin(empty) = %v, %v; want NaN, false", v, ok)
	}
	if v, ok := ArrayMax(empty); ok || !math.IsNaN(v) {
		t.Errorf("ArrayMax(empty) = %v, %v; want NaN, false", v, ok)
	}
	if v, ok := ArrayRange(empty); ok || !math.IsNaN(v) {
		t.Errorf("ArrayRange(empty) = %v, %v; want NaN, false", v, ok)
	}
	if v, ok := Mean(empty); ok || !math.IsNaN(v) {
		t.Errorf("Mean(empty) = %v, %v; want NaN, false", v, ok)
	}
	if v, ok := Stdev([]float64{1}); ok || !math.IsNaN(v) {
		t.Errorf("Stdev(one sample) = %v, %v; want NaN, false", v, ok)
	}
}

// Degree/radian conversions and the wrapping variants land in their
// documented ranges: RadiansRel in (-π, π], DegreesRel in (-180, 180],
// DegreesHdg in [0, 360).
func TestAngleConversions(t *testing.T) {
	if !near(Radians(180), math.Pi, 1e-15) || !near(Degrees(math.Pi/2), 90, 1e-12) {
		t.Errorf("Radians/Degrees round trip broken")
	}
	if !near(RadiansRel(270), -math.Pi/2, 1e-12) || !near(RadiansRel(-270), math.Pi/2, 1e-12) || !near(RadiansRel(720), 0, 1e-12) {
		t.Errorf("RadiansRel does not wrap into (-π, π]: %v %v %v", RadiansRel(270), RadiansRel(-270), RadiansRel(720))
	}
	if !near(DegreesRel(3*math.Pi/2), -90, 1e-12) || !near(DegreesRel(-3*math.Pi/2), 90, 1e-12) {
		t.Errorf("DegreesRel does not wrap into (-180, 180]: %v %v", DegreesRel(3*math.Pi/2), DegreesRel(-3*math.Pi/2))
	}
	if !near(DegreesHdg(-math.Pi/2), 270, 1e-12) || !near(DegreesHdg(0), 0, 1e-12) || !near(DegreesHdg(math.Pi), 180, 1e-12) {
		t.Errorf("DegreesHdg does not map into [0, 360): %v %v %v", DegreesHdg(-math.Pi/2), DegreesHdg(0), DegreesHdg(math.Pi))
	}
}

// RoundToInt16 rounds half away from zero rather than truncating.
func TestRoundToInt16(t *testing.T) {
	cases := map[float64]int16{0: 0, 0.49: 0, 0.5: 1, 1.5: 2, -0.49: 0, -0.5: -1, -1.5: -2, 32766.6: 32767, -32767.6: -32768}
	for in, want := range cases {
		if got := RoundToInt16(in); got != want {
			t.Errorf("RoundToInt16(%v) = %d; want %d", in, got, want)
		}
	}
}

// DistRect: one arc-minute of latitude is one (mean-radius) nautical mile
// due north; one arc-minute of longitude on the equator is the same due
// east; the N/E components carry sign.
func TestDistRect(t *testing.T) {
	const tol = 0.01 // metres
	d, b, n, e := DistRect(45, 9, 45+1.0/60, 9)
	if !near(d, metersPerArcMinute, tol) || !near(b, 0, 1e-9) || !near(n, metersPerArcMinute, tol) || !near(e, 0, tol) {
		t.Errorf("DistRect(1' north) = %v m, %v°, N=%v, E=%v", d, b, n, e)
	}
	d, b, n, e = DistRect(0, 0, 0, 1.0/60)
	if !near(d, metersPerArcMinute, tol) || !near(b, 90, 1e-9) || !near(n, 0, tol) || !near(e, metersPerArcMinute, tol) {
		t.Errorf("DistRect(1' east on the equator) = %v m, %v°, N=%v, E=%v", d, b, n, e)
	}
	// Target south-west: bearing in the 180–270 quadrant, both components negative.
	d, b, n, e = DistRect(45, 9, 45-1.0/60, 9-1.0/60)
	if b <= 180 || b >= 270 || n >= 0 || e >= 0 || d <= 0 {
		t.Errorf("DistRect(south-west) = %v m, %v°, N=%v, E=%v", d, b, n, e)
	}
	// East-west distance shrinks with cos(latitude); at 60°N it is half.
	if e60 := DistRectEast(60, 0, 60, 1); !near(e60, metersPerDegree/2, 1) {
		t.Errorf("DistRectEast at 60°N = %v; want %v", e60, metersPerDegree/2)
	}
	if n := DistRectNorth(10, 11); !near(n, metersPerDegree, 1e-6) {
		t.Errorf("DistRectNorth(1°) = %v; want %v", n, metersPerDegree)
	}
	// Same point: zero distance, no NaN.
	if d, _, _, _ := DistRect(45.123456, 9.654321, 45.123456, 9.654321); d != 0 {
		t.Errorf("DistRect(same point) = %v; want 0", d)
	}
}

// Distance (great circle): known values, and — the robustness case — an
// identical or antipodal pair must never produce NaN from rounding inside
// the acos argument.
func TestDistance(t *testing.T) {
	d, b := Distance(0, 0, 0, 1)
	if !near(d, metersPerDegree, 0.5) || !near(b, 90, 1e-9) {
		t.Errorf("Distance(1° east on the equator) = %v m, %v°", d, b)
	}
	d, b = Distance(45, 9, 45+1.0/60, 9)
	if !near(d, metersPerArcMinute, 0.01) || !near(b, 0, 1e-9) {
		t.Errorf("Distance(1' north) = %v m, %v°", d, b)
	}
	// The law of cosines is ill-conditioned below a few metres (acos near 1),
	// so an identical pair is only required to be finite and under 1 m — use
	// DistRect for short-range work, as traffic.go does.
	for _, p := range [][2]float64{{45.5, 9.2}, {0, 0}, {45.123456, 9.654321}, {-33.8688, 151.2093}} {
		d, b = Distance(p[0], p[1], p[0], p[1])
		if math.IsNaN(d) || d < 0 || d >= 1 || math.IsNaN(b) {
			t.Errorf("Distance(same point %v) = %v m, %v°; want finite and < 1 m", p, d, b)
		}
	}
	d, _ = Distance(0, 0, 0, 180) // antipodal: half the circumference
	if math.IsNaN(d) || !near(d, math.Pi*6371008.8, 1) {
		t.Errorf("Distance(antipodal) = %v; want %v", d, math.Pi*6371008.8)
	}
}

// CalcAltitude follows the ISA pressure-altitude formula: 0 ft at
// 1013.25 hPa, ~10 000 ft at 696.82 hPa, ~36 089 ft at 226.32 hPa, and the
// offset is added linearly.
func TestCalcAltitude(t *testing.T) {
	if a := CalcAltitude(1013.25, 0); !near(a, 0, 1e-9) {
		t.Errorf("CalcAltitude(1013.25) = %v; want 0", a)
	}
	if a := CalcAltitude(1013.25, 250); !near(a, 250, 1e-9) {
		t.Errorf("CalcAltitude(1013.25, +250) = %v; want 250", a)
	}
	if a := CalcAltitude(696.82, 0); !near(a, 10000, 10) {
		t.Errorf("CalcAltitude(696.82) = %v; want ~10000", a)
	}
	if a := CalcAltitude(226.32, 0); !near(a, 36089, 20) {
		t.Errorf("CalcAltitude(226.32) = %v; want ~36089", a)
	}
	// Robustness, current behaviour: a non-positive pressure is not rejected.
	// 0 hPa yields the formula's ceiling; a negative pressure yields NaN. Callers
	// must validate the sensor reading before use (derived-requirement candidate).
	if a := CalcAltitude(0, 0); !near(a, 145366.45, 1e-6) {
		t.Errorf("CalcAltitude(0) = %v; want 145366.45", a)
	}
	if a := CalcAltitude(-1, 0); !math.IsNaN(a) {
		t.Errorf("CalcAltitude(-1) = %v; want NaN (documented current behaviour)", a)
	}
}

// CalcIndicatedAirspeed inverts the ISA compressible pitot equation: the
// impact pressure of Mach M at sea level, P0*((1 + 0.2 M^2)^3.5 - 1), reads
// back as M*a0 knots; at low speed it agrees with the incompressible
// sqrt(2 qc / rho0) to 0.2 %; no airflow or a negative (reversed tube)
// pressure is 0 knots.
func TestCalcIndicatedAirspeed(t *testing.T) {
	const a0, p0, rho0 = 661.4786, 101325.0, 1.225
	for _, mach := range []float64{0.05, 0.1, 0.15, 0.2, 0.3} {
		qc := p0 * (math.Pow(1+0.2*mach*mach, 3.5) - 1)
		if v := CalcIndicatedAirspeed(qc); !near(v, mach*a0, 1e-6) {
			t.Errorf("CalcIndicatedAirspeed(%.2f Pa, Mach %.2f) = %v; want %v", qc, mach, v, mach*a0)
		}
	}
	// Reference point: 1000 Pa reads 78.4 kt (78.55 incompressible).
	if v := CalcIndicatedAirspeed(1000); !near(v, 78.41, 0.05) {
		t.Errorf("CalcIndicatedAirspeed(1000) = %v; want ~78.41", v)
	}
	for _, qc := range []float64{50, 200, 800} {
		incompressible := math.Sqrt(2*qc/rho0) * 3600 / 1852
		if v := CalcIndicatedAirspeed(qc); !near(v, incompressible, 0.002*incompressible) || v > incompressible {
			t.Errorf("CalcIndicatedAirspeed(%v) = %v; want just under the incompressible %v", qc, v, incompressible)
		}
	}
	if v := CalcIndicatedAirspeed(0); v != 0 {
		t.Errorf("CalcIndicatedAirspeed(0) = %v; want 0", v)
	}
	if v := CalcIndicatedAirspeed(-30); v != 0 {
		t.Errorf("CalcIndicatedAirspeed(-30) = %v; want 0", v)
	}
	// Monotonic: more pressure never reads slower.
	prev := 0.0
	for qc := 1.0; qc < 20000; qc *= 1.5 {
		if v := CalcIndicatedAirspeed(qc); v <= prev {
			t.Fatalf("CalcIndicatedAirspeed(%v) = %v is not above %v", qc, v, prev)
		} else {
			prev = v
		}
	}
}

func TestIMinIMax(t *testing.T) {
	if IMin(3, -2) != -2 || IMin(-2, 3) != -2 || IMax(3, -2) != 3 || IMax(-2, 3) != 3 || IMin(7, 7) != 7 || IMax(7, 7) != 7 {
		t.Errorf("IMin/IMax wrong")
	}
}
