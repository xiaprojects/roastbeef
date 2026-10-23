/*
	magnetometer_check: validate the magnetometer heading pipeline.

	Modes:
	  -synth    synthesise a known field / attitude / mounting and check that the
	            heading is recovered. No hardware and no recorded data needed.
	  -ahrs     like -synth, but the pitch and roll come from goflying's own
	            attitude solver fed with the synthetic accelerometer, exactly as
	            the daemon does. This is the check that pins the frame and sign
	            conventions between goflying and the heading formula.
	  -migrate  round-trip the legacy MagAxisMapping matrices through the
	            quaternion conversion.
	  -csv F    replay an AHRS log (sensors_*.csv, written when AHRSLog is on)
	            and compare the heading against the logged GPS ground track.
	  -flightlog F.sqlite
	            NOTE the datalog stores mySituation.Magnetometer, which is the
	            29/30 EWMA of the raw sample (1.5 s at 20 Hz), while the live
	            heading is computed from the raw sample. Replaying a datalog
	            therefore carries a lag the running system does not have: ~15
	            deg of heading in a 10 deg/s turn, antisymmetric in roll, which
	            looks exactly like a vertical-calibration error. Level-flight
	            figures are unaffected and are the ones to trust; treat banked
	            residuals from a datalog as an upper bound. For turn behaviour
	            use an AHRSLog sensors_*.csv, which records raw samples at 20 Hz.

	            calibrate from a datalog.go recording of a flight: fit the
	            hard-iron centre and per-axis scale to the raw samples, then
	            score every axis mapping against the GPS track and print the
	            calibration JSON to PUT to /magnetometer and the Offset.
	            Needs -sensorq, the unit's SensorQuaternion at the time.

	Exits non-zero if any check fails.

	Build: make -C test
*/

package main

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"

	_ "github.com/mattn/go-sqlite3"
	"github.com/xiaprojects/goflying/ahrs"
	"github.com/xiaprojects/roastbeef/common"
)

const deg = math.Pi / 180.0

// ---------------------------------------------------------------------------
// Synthetic truth model
// ---------------------------------------------------------------------------

// fieldNED returns the earth's magnetic field in the local NED frame for a
// given dip angle: north and down, unit magnitude.
func fieldNED(dipDeg float64) [3]float64 {
	return [3]float64{math.Cos(dipDeg * deg), 0, math.Sin(dipDeg * deg)}
}

// worldToBody rotates an NED vector into the aircraft body frame for the given
// attitude, using the standard aerospace 3-2-1 sequence Rx(roll)Ry(pitch)Rz(hdg).
func worldToBody(headingDeg, pitchDeg, rollDeg float64, v [3]float64) [3]float64 {
	psi, theta, phi := headingDeg*deg, pitchDeg*deg, rollDeg*deg

	// Rz(psi)
	x := +math.Cos(psi)*v[0] + math.Sin(psi)*v[1]
	y := -math.Sin(psi)*v[0] + math.Cos(psi)*v[1]
	z := v[2]

	// Ry(theta)
	x, y, z = math.Cos(theta)*x-math.Sin(theta)*z, y, math.Sin(theta)*x+math.Cos(theta)*z

	// Rx(phi)
	x, y, z = x, math.Cos(phi)*y+math.Sin(phi)*z, -math.Sin(phi)*y+math.Cos(phi)*z

	return [3]float64{x, y, z}
}

// frdToFLU converts from the aerospace body frame the model above produces to
// goflying's body frame (X forward, Y left, Z up), which is where the AHRS
// sensor quaternion lands and what the magnetometer quaternion maps into.
func frdToFLU(v [3]float64) [3]float64 {
	return [3]float64{v[0], -v[1], -v[2]}
}

// goflyingAttitude returns the roll and pitch (degrees) goflying's SimpleAHRS
// reports for a static accelerometer reading in its body frame, identity
// sensor quaternion - the same numbers main/sensors.go hands to HeadingFromMag.
func goflyingAttitude(accFLU [3]float64) (roll, pitch float64) {
	s := ahrs.NewSimpleAHRS()
	c, d := [3]float64{0, 0, 1}, [3]float64{0, 0, 0}
	s.SetCalibrations(&c, &d)
	q := [4]float64{1, 0, 0, 0}
	s.SetSensorQuaternion(&q)
	m := ahrs.NewMeasurement()
	for i := 0; i < 600; i++ { // static fusion converges in a few hundred steps
		m.T = float64(i) * 0.05
		m.A1, m.A2, m.A3 = accFLU[0], accFLU[1], accFLU[2]
		m.SValid = true
		s.Compute(m)
	}
	r, p, _ := s.RollPitchHeading()
	return r / ahrs.Deg, p / ahrs.Deg
}

// bodyToMag is the inverse of the mounting rotation: given the field in
// goflying's body frame, what the magnetometer die actually reads.
func bodyToMag(q [4]float64, v [3]float64) [3]float64 {
	r := common.QuaternionToRotationMatrix(common.QuaternionUnit(q))
	// transpose, since q maps mag -> body
	return [3]float64{
		r[0][0]*v[0] + r[1][0]*v[1] + r[2][0]*v[2],
		r[0][1]*v[0] + r[1][1]*v[1] + r[2][1]*v[2],
		r[0][2]*v[0] + r[1][2]*v[1] + r[2][2]*v[2],
	}
}

// small rotation helpers for the orientation refinement
func rotX(a float64) [3][3]float64 {
	c, s := math.Cos(a*deg), math.Sin(a*deg)
	return [3][3]float64{{1, 0, 0}, {0, c, -s}, {0, s, c}}
}
func rotY(a float64) [3][3]float64 {
	c, s := math.Cos(a*deg), math.Sin(a*deg)
	return [3][3]float64{{c, 0, s}, {0, 1, 0}, {-s, 0, c}}
}
func rotZ(a float64) [3][3]float64 {
	c, s := math.Cos(a*deg), math.Sin(a*deg)
	return [3][3]float64{{c, -s, 0}, {s, c, 0}, {0, 0, 1}}
}
func matMul(a, b [3][3]float64) (c [3][3]float64) {
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			for k := 0; k < 3; k++ {
				c[i][j] += a[i][k] * b[k][j]
			}
		}
	}
	return
}
func matT(m [3][3]float64) (t [3][3]float64) {
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			t[i][j] = m[j][i]
		}
	}
	return
}

// quatFromAxisAngle builds a quaternion from an axis and an angle in degrees.
func quatFromAxisAngle(ax, ay, az, angleDeg float64) [4]float64 {
	n := math.Sqrt(ax*ax + ay*ay + az*az)
	if n == 0 {
		return [4]float64{1, 0, 0, 0}
	}
	h := angleDeg * deg / 2
	s := math.Sin(h) / n
	return [4]float64{math.Cos(h), ax * s, ay * s, az * s}
}

// mountings are the mag-die orientations exercised by -synth.
var mountings = []struct {
	name string
	q    [4]float64
}{
	{"identity", [4]float64{1, 0, 0, 0}},
	{"yaw +90", quatFromAxisAngle(0, 0, 1, 90)},
	{"yaw 180", quatFromAxisAngle(0, 0, 1, 180)},
	{"yaw -90", quatFromAxisAngle(0, 0, 1, -90)},
	{"roll 180", quatFromAxisAngle(1, 0, 0, 180)},
	{"skew 7deg", quatFromAxisAngle(0.3, 0.8, 0.5, 7)},
}

var attitudes = []struct{ pitch, roll float64 }{
	{0, 0},
	{0, 10}, {0, -10},
	{0, 20}, {0, -20},
	{0, 30}, {0, -30},
	{10, 0}, {-10, 0},
	{10, 20}, {-10, -20},
}

// path selects which heading pipeline runSynth exercises.
type path int

const (
	pathQuat   path = iota // quaternion alignment + true pitch/roll
	pathAHRS               // quaternion alignment + pitch/roll from goflying's solver
	pathNoTilt             // quaternion alignment, pitch/roll forced to 0
	pathLegacy             // the pre-quaternion Euler-fudge path
)

// runSynth sweeps heading x attitude x mounting and reports the worst error.
func runSynth(dipDeg float64, p path, verbose bool) (worst float64, worstDesc string) {
	field := fieldNED(dipDeg)

	for _, mt := range mountings {
		for _, at := range attitudes {
			for hdg := 0.0; hdg < 360.0; hdg += 15.0 {
				mBody := frdToFLU(worldToBody(hdg, at.pitch, at.roll, field))
				mMag := bodyToMag(mt.q, mBody)

				var got float64
				switch p {
				case pathLegacy:
					got = legacyHeading(at.pitch, at.roll, mMag)
				case pathAHRS:
					// Attitude as goflying would report it for this aircraft,
					// from the accelerometer alone (gravity reaction points up).
					accFLU := frdToFLU(worldToBody(hdg, at.pitch, at.roll, [3]float64{0, 0, -1}))
					gr, gp := goflyingAttitude(accFLU)
					got = common.HeadingFromMagQ(
						gp, gr,
						mMag[0], mMag[1], mMag[2],
						-1, 1, -1, 1, -1, 1,
						0, mt.q, true, 1.0, math.NaN())
				case pathNoTilt:
					// The pre-quaternion default (pitch and roll zeroed): the
					// alignment is right but the aircraft is assumed level.
					got = common.HeadingFromMagQ(
						0, 0,
						mMag[0], mMag[1], mMag[2],
						-1, 1, -1, 1, -1, 1,
						0, mt.q, true, 1.0, math.NaN())
				default:
					got = common.HeadingFromMagQ(
						at.pitch, at.roll,
						mMag[0], mMag[1], mMag[2],
						-1, 1, -1, 1, -1, 1, // unit min/max: no iron distortion
						0,    // offset
						mt.q, // mounting
						true, // normalize
						1.0,  // no smoothing
						math.NaN(),
					)
				}

				err := math.Abs(common.HeadingDiffDeg(got, hdg))
				if err > worst {
					worst = err
					worstDesc = fmt.Sprintf("mounting %q pitch %+.0f roll %+.0f heading %.0f -> %.2f (err %.2f)",
						mt.name, at.pitch, at.roll, hdg, got, err)
				}
				if verbose {
					fmt.Printf("  %-10s p%+4.0f r%+4.0f  hdg %5.1f  got %6.2f  err %6.2f\n",
						mt.name, at.pitch, at.roll, hdg, got, err)
				}
			}
		}
	}
	return
}

// legacyHeading reproduces the pre-quaternion path: the shipped MagAxisMapping
// matrix, and pitch/roll zeroed by that code's default fudge factors.
func legacyHeading(pitchDeg, rollDeg float64, m [3]float64) float64 {
	cx, cy, cz := common.CalibrateFromMag(m[0], m[1], m[2], -1, 1, -1, 1, -1, 1, true)

	// gen_gdl90.go defaults: interference {0,0}, offset {0,0}
	pitchAligned := 0*pitchDeg + 0
	rollAligned := 0*rollDeg + 0

	// MagAxisMappingX/Y/Z = {0,-1,0} {1,0,0} {0,0,1}
	ax := -cy
	ay := +cx
	az := +cz

	return common.MagneticHeadingDeg(pitchAligned, rollAligned, ax, ay, az)
}

// ---------------------------------------------------------------------------
// Legacy mapping migration
// ---------------------------------------------------------------------------

func runMigrate() (failures int) {
	type tc struct {
		name       string
		mx, my, mz [3]float64
		wantOK     bool
	}

	cases := []tc{
		{"identity", [3]float64{1, 0, 0}, [3]float64{0, 1, 0}, [3]float64{0, 0, 1}, true},
		{"shipped default (yaw 90)", [3]float64{0, -1, 0}, [3]float64{1, 0, 0}, [3]float64{0, 0, 1}, true},
		{"yaw 180", [3]float64{-1, 0, 0}, [3]float64{0, -1, 0}, [3]float64{0, 0, 1}, true},
		{"roll 180", [3]float64{1, 0, 0}, [3]float64{0, -1, 0}, [3]float64{0, 0, -1}, true},
		{"pitch 180", [3]float64{-1, 0, 0}, [3]float64{0, 1, 0}, [3]float64{0, 0, -1}, true},
		{"swap XY, negate Z (AK8963)", [3]float64{0, 1, 0}, [3]float64{1, 0, 0}, [3]float64{0, 0, -1}, true},
		{"reflection (single sign flip)", [3]float64{-1, 0, 0}, [3]float64{0, 1, 0}, [3]float64{0, 0, 1}, false},
		{"not orthonormal", [3]float64{2, 0, 0}, [3]float64{0, 1, 0}, [3]float64{0, 0, 1}, false},
	}

	for _, c := range cases {
		q, ok := common.MagAxisMappingToQuaternion(c.mx, c.my, c.mz)
		if ok != c.wantOK {
			fmt.Printf("FAIL %-30s accepted=%v want %v\n", c.name, ok, c.wantOK)
			failures++
			continue
		}
		if !ok {
			fmt.Printf("ok   %-30s correctly rejected\n", c.name)
			continue
		}
		if math.IsNaN(q[0]) || math.IsNaN(q[1]) || math.IsNaN(q[2]) || math.IsNaN(q[3]) {
			fmt.Printf("FAIL %-30s produced NaN: %v\n", c.name, q)
			failures++
			continue
		}

		// Round-trip: the quaternion must reproduce the matrix.
		r := common.QuaternionToRotationMatrix(q)
		want := [3][3]float64{c.mx, c.my, c.mz}
		maxErr := 0.0
		for i := 0; i < 3; i++ {
			for j := 0; j < 3; j++ {
				if e := math.Abs(r[i][j] - want[i][j]); e > maxErr {
					maxErr = e
				}
			}
		}
		if maxErr > 1e-9 {
			fmt.Printf("FAIL %-30s round-trip error %.3g\n  q=%v\n  got %v\n  want %v\n",
				c.name, maxErr, q, r, want)
			failures++
			continue
		}
		fmt.Printf("ok   %-30s q=[%+.4f %+.4f %+.4f %+.4f]\n", c.name, q[0], q[1], q[2], q[3])
	}
	return
}

// ---------------------------------------------------------------------------
// CSV replay
// ---------------------------------------------------------------------------

func runCSV(path string, magQuat [4]float64, dipDeg float64) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	rd := csv.NewReader(f)
	rd.TrimLeadingSpace = true
	rows, err := rd.ReadAll()
	if err != nil {
		return err
	}
	if len(rows) < 2 {
		return fmt.Errorf("%s: no data rows", path)
	}

	col := map[string]int{}
	for i, name := range rows[0] {
		col[name] = i
	}
	need := []string{"M1", "M2", "M3"}
	for _, n := range need {
		if _, ok := col[n]; !ok {
			return fmt.Errorf("%s: missing column %q (is this an AHRS log?)", path, n)
		}
	}

	get := func(row []string, name string) (float64, bool) {
		i, ok := col[name]
		if !ok || i >= len(row) {
			return 0, false
		}
		v, err := strconv.ParseFloat(row[i], 64)
		if err != nil {
			return 0, false
		}
		return v, true
	}

	// First pass: hard-iron envelope over the whole log.
	minX, minY, minZ := math.Inf(1), math.Inf(1), math.Inf(1)
	maxX, maxY, maxZ := math.Inf(-1), math.Inf(-1), math.Inf(-1)
	for _, row := range rows[1:] {
		m1, ok1 := get(row, "M1")
		m2, ok2 := get(row, "M2")
		m3, ok3 := get(row, "M3")
		if !ok1 || !ok2 || !ok3 {
			continue
		}
		minX, maxX = math.Min(minX, m1), math.Max(maxX, m1)
		minY, maxY = math.Min(minY, m2), math.Max(maxY, m2)
		minZ, maxZ = math.Min(minZ, m3), math.Max(maxZ, m3)
	}
	fmt.Printf("# envelope X[%.1f %.1f] Y[%.1f %.1f] Z[%.1f %.1f]\n",
		minX, maxX, minY, maxY, minZ, maxZ)
	fmt.Printf("# %8s %8s %8s %8s %9s\n", "pitch", "roll", "legacy", "quat", "gpstrack")

	var n, nTrack int
	var sumLegacy, sumQuat, maxLegacy, maxQuat float64
	lastLegacy, lastQuat := math.NaN(), math.NaN()

	for _, row := range rows[1:] {
		m1, ok1 := get(row, "M1")
		m2, ok2 := get(row, "M2")
		m3, ok3 := get(row, "M3")
		if !ok1 || !ok2 || !ok3 {
			continue
		}
		// Attitude columns are named by the AHRS state map; fall back to level.
		pitch, _ := get(row, "Pitch")
		roll, _ := get(row, "Roll")

		lastQuat = common.HeadingFromMagQ(pitch, roll, m1, m2, m3,
			minX, maxX, minY, maxY, minZ, maxZ,
			0, magQuat, true, 0.05, lastQuat)

		lg := legacyHeading(pitch, roll, [3]float64{m1, m2, m3})
		if math.IsNaN(lastLegacy) {
			lastLegacy = lg
		} else {
			lastLegacy = common.NormalizeHeadingDeg(
				lastLegacy + 0.05*common.HeadingDiffDeg(lg, lastLegacy))
		}

		track, hasTrack := get(row, "GPSTrueCourse")
		if hasTrack && track != 0 {
			eL := math.Abs(common.HeadingDiffDeg(lastLegacy, track))
			eQ := math.Abs(common.HeadingDiffDeg(lastQuat, track))
			sumLegacy += eL
			sumQuat += eQ
			maxLegacy = math.Max(maxLegacy, eL)
			maxQuat = math.Max(maxQuat, eQ)
			nTrack++
		}

		if n%50 == 0 {
			fmt.Printf("  %8.2f %8.2f %8.2f %8.2f %9.2f\n",
				pitch, roll, lastLegacy, lastQuat, track)
		}
		n++
	}

	fmt.Printf("\n%d samples", n)
	if nTrack > 0 {
		fmt.Printf(", %d with GPS track\n", nTrack)
		fmt.Printf("  legacy path: mean err %6.2f deg, max %6.2f deg\n", sumLegacy/float64(nTrack), maxLegacy)
		fmt.Printf("  quat   path: mean err %6.2f deg, max %6.2f deg\n", sumQuat/float64(nTrack), maxQuat)
	} else {
		fmt.Printf(", no GPS track column: cannot score accuracy\n")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Flight-log calibration
// ---------------------------------------------------------------------------

// levelFrame resolves a body-frame (FRD) vector onto the aircraft's own
// forward/right axes with the tilt removed, plus the vertical component.
func levelFrame(pitch, roll, bx, by, bz float64) (fwd, right, down float64) {
	ph, th := roll*deg, pitch*deg
	fwd = bx*math.Cos(th) + by*math.Sin(th)*math.Sin(ph) + bz*math.Sin(th)*math.Cos(ph)
	right = by*math.Cos(ph) - bz*math.Sin(ph)
	down = -bx*math.Sin(th) + by*math.Cos(th)*math.Sin(ph) + bz*math.Cos(th)*math.Cos(ph)
	return
}

// magneticDip returns the inclination the data implies, and the mean vertical
// and horizontal components, for a mapping. A reflection anywhere in the chain
// (an axis sign flipped in a driver, say) inverts the vertical while leaving
// the horizontal recoverable, so the heading can still look right while tilt
// compensation pushes the wrong way. The dip is what gives that away: it must
// be positive in the northern hemisphere and match the WMM value.
func magneticDip(data []flightSample, q [4]float64, env [6]float64) (dip, vert, horiz float64) {
	var sv, sh float64
	for _, d := range data {
		cx, cy, cz := common.CalibrateFromMag(d.raw[0], d.raw[1], d.raw[2],
			env[0], env[1], env[2], env[3], env[4], env[5], true)
		bx, by, bz := common.QuaternionRotateVector(q, cx, cy, cz)
		bx, by, bz = common.BodyFLUToFRD(bx, by, bz)
		f, r, dn := levelFrame(d.pitch, d.roll, bx, by, bz)
		sv += dn
		sh += math.Hypot(f, r)
	}
	n := float64(len(data))
	vert, horiz = sv/n, sh/n
	return math.Atan2(vert, horiz) / deg, vert, horiz
}

type flightSample struct {
	track, pitch, roll, magHeading float64
	raw                            [3]float64
}

// readFlightLog loads the moving samples of a datalog.go recording.
func readFlightLog(path string, minGS float64) ([]flightSample, error) {
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT GPSTrueCourse, GPSGroundSpeed, AHRSPitch, AHRSRoll, AHRSMagHeading, Magnetometer
		FROM mySituation WHERE GPSGroundSpeed > ? ORDER BY rowid`, minGS)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []flightSample
	for rows.Next() {
		var s flightSample
		var gs float64
		var magJSON string
		if err := rows.Scan(&s.track, &gs, &s.pitch, &s.roll, &s.magHeading, &magJSON); err != nil {
			return nil, err
		}
		var m struct{ X, Y, Z float64 }
		if err := json.Unmarshal([]byte(magJSON), &m); err != nil {
			continue
		}
		// drop AHRS-invalid rows and the occasional wild roll sample
		if common.IsAHRSInvalid(s.pitch) || common.IsAHRSInvalid(s.roll) || math.Abs(s.roll) > 70 {
			continue
		}
		s.raw = [3]float64{m.X, m.Y, m.Z}
		out = append(out, s)
	}
	return out, rows.Err()
}

// circStats returns the circular mean and standard deviation (degrees).
func circStats(res []float64) (mean, std float64) {
	var sx, sy float64
	for _, r := range res {
		sx += math.Cos(r * deg)
		sy += math.Sin(r * deg)
	}
	mean = math.Atan2(sy, sx) / deg
	var ss float64
	for _, r := range res {
		d := common.HeadingDiffDeg(r, mean)
		ss += d * d
	}
	return mean, math.Sqrt(ss / float64(len(res)))
}

// runFlightLog fits the calibration and scores every proper axis mapping.
// failedGeometry is set when the fit reports a physically impossible field.
var failedGeometry bool

func runFlightLog(path string, qSensor [4]float64) error {
	data, err := readFlightLog(path, 15)
	if err != nil {
		return err
	}
	if len(data) < 100 {
		return fmt.Errorf("%s: only %d moving samples", path, len(data))
	}
	raw := make([][3]float64, len(data))
	for i, d := range data {
		raw[i] = d.raw
	}
	cal, ok := common.FitMagEllipsoid(raw)
	if !ok {
		return fmt.Errorf("ellipsoid fit failed: the flight probably did not sweep all three axes (needs banks and pitch changes)")
	}
	var mags []float64
	for _, r := range raw {
		mags = append(mags, cal.Magnitude(r[0], r[1], r[2]))
	}
	mMean, mStd := 0.0, 0.0
	for _, m := range mags {
		mMean += m
	}
	mMean /= float64(len(mags))
	for _, m := range mags {
		mStd += (m - mMean) * (m - mMean)
	}
	mStd = math.Sqrt(mStd / float64(len(mags)))
	env := cal.Envelope()
	sweep := common.Sweep(raw, cal)
	wellSwept := common.WellSwept(raw, cal)
	fmt.Printf("%d moving samples\n", len(data))
	fmt.Printf("calibration: centre (%.0f, %.0f, %.0f)  semi-range (%.0f, %.0f, %.0f)   |m| = %.3f +/- %.3f (soft-iron residual)\n",
		cal.Centre[0], cal.Centre[1], cal.Centre[2], cal.Semi[0], cal.Semi[1], cal.Semi[2], mMean, mStd)

	var asFlown []float64
	for _, d := range data {
		asFlown = append(asFlown, common.HeadingDiffDeg(d.track, d.magHeading))
	}
	_, s0 := circStats(asFlown)
	fmt.Printf("axis sweep: X %.2f  Y %.2f  Z %.2f  of the fitted diameter (need >= %.2f each)\n",
		sweep[0], sweep[1], sweep[2], common.MinSweep)
	if !wellSwept {
		fmt.Printf("  *** UNDER-SWEPT: this flight does not determine the calibration. An ellipsoid fitted\n")
		fmt.Printf("  *** to an arc trades centre against radius along the unswept axis and still reports a\n")
		fmt.Printf("  *** small residual, so the numbers above look convincing and are not. KEEP THE\n")
		fmt.Printf("  *** EXISTING CALIBRATION and fly a recording with more bank and pitch change.\n")
		fmt.Printf("  *** The mapping ranking below is scored with this fit and is unreliable too.\n")
	}
	fmt.Printf("as flown: residual (GPS track - AHRSMagHeading) std %.1f deg\n", s0)
	var turning int
	for _, d := range data {
		if math.Abs(d.roll) > 15 {
			turning++
		}
	}
	if frac := float64(turning) / float64(len(data)); frac > 0.1 {
		fmt.Printf("  note: %.0f%% of samples are banked past 15 deg. The datalog's magnetometer is\n", 100*frac)
		fmt.Printf("  EWMA-smoothed (1.5 s), so those carry a lag the live system does not - banked\n")
		fmt.Printf("  residuals here are an upper bound. Judge the calibration on the level figures.\n")
	}
	fmt.Println()

	type result struct {
		rows           [3][3]float64
		name           string
		mean, std, lvl float64
	}
	var results []result
	axes := [][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	names := []string{"X", "Y", "Z"}
	perms := [][3]int{{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}}
	for _, p := range perms {
		for s := 0; s < 8; s++ {
			var m [3][3]float64
			name := ""
			for i := 0; i < 3; i++ {
				sign := 1.0
				if s&(1<<i) != 0 {
					sign = -1
					name += "-"
				} else {
					name += "+"
				}
				for j := 0; j < 3; j++ {
					m[i][j] = sign*axes[p[i]][j] + 0 // + 0 turns -0 into 0 for printing
				}
				name += names[p[i]]
			}
			qa, proper := common.MagAxisMappingToQuaternion(m[0], m[1], m[2])
			if !proper {
				continue
			}
			q := common.QuaternionUnit(common.QuaternionProduct(qSensor, qa))
			var res, lvl []float64
			for _, d := range data {
				h := common.HeadingFromMagQ(d.pitch, d.roll, d.raw[0], d.raw[1], d.raw[2],
					env[0], env[1], env[2], env[3], env[4], env[5], 0, q, true, 1, math.NaN())
				r := common.HeadingDiffDeg(d.track, h)
				res = append(res, r)
				if math.Abs(d.roll) < 5 {
					lvl = append(lvl, r)
				}
			}
			mean, std := circStats(res)
			_, lstd := circStats(lvl)
			results = append(results, result{m, name, mean, std, lstd})
		}
	}
	sort.Slice(results, func(i, j int) bool { return results[i].std < results[j].std })
	fmt.Printf("%-8s %9s %9s %9s\n", "mapping", "std", "level std", "Offset")
	for i, r := range results {
		if i >= 6 {
			break
		}
		fmt.Printf("%-8s %8.1f° %8.1f° %+8.1f°\n", r.name, r.std, r.lvl, r.mean)
	}
	best := results[0]

	// Refine: the die is rarely at an exact 90-degree multiple, and the cage's
	// SensorQuaternion carries the accelerometer's bias into the tilt. Search a
	// small body-frame rotation on top of the best permutation and express the
	// result as rows, which the daemon composes with SensorQuaternion as usual.
	rs := common.QuaternionToRotationMatrix(common.QuaternionUnit(qSensor))
	negYZ := [3][3]float64{{1, 0, 0}, {0, -1, 0}, {0, 0, -1}}
	rBase := matMul(negYZ, matMul(rs, best.rows)) // chip -> FRD, as the daemon computes it
	scoreRot := func(r [3][3]float64) (mean, std float64) {
		var res []float64
		for _, d := range data {
			cx, cy, cz := common.CalibrateFromMag(d.raw[0], d.raw[1], d.raw[2], env[0], env[1], env[2], env[3], env[4], env[5], true)
			bx := r[0][0]*cx + r[0][1]*cy + r[0][2]*cz
			by := r[1][0]*cx + r[1][1]*cy + r[1][2]*cz
			bz := r[2][0]*cx + r[2][1]*cy + r[2][2]*cz
			res = append(res, common.HeadingDiffDeg(d.track, common.MagneticHeadingDeg(d.pitch, d.roll, bx, by, bz)))
		}
		return circStats(res)
	}
	bestStd, bpsi, bth, bph := best.std, 0.0, 0.0, 0.0
	for _, step := range []float64{3, 0.5} {
		span := 24.0
		if step < 1 {
			span = 3
		}
		cpsi, cth, cph := bpsi, bth, bph
		for psi := cpsi - span; psi <= cpsi+span; psi += step {
			for th := cth - span; th <= cth+span; th += step {
				for ph := cph - span; ph <= cph+span; ph += step {
					_, sd := scoreRot(matMul(matMul(matMul(rotZ(psi), rotY(th)), rotX(ph)), rBase))
					if sd < bestStd {
						bestStd, bpsi, bth, bph = sd, psi, th, ph
					}
				}
			}
		}
	}
	rFit := matMul(matMul(matMul(rotZ(bpsi), rotY(bth)), rotX(bph)), rBase)
	rowsFit := matMul(matT(rs), matMul(negYZ, rFit)) // daemon: NegYZ * R_s * rows = rFit
	qFit, okFit := common.MagAxisMappingToQuaternion(rowsFit[0], rowsFit[1], rowsFit[2])
	meanFit, stdFit := scoreRot(rFit)
	fmt.Printf("\nrefined orientation: permutation %s then body yaw %+.2f pitch %+.2f roll %+.2f  ->  std %.1f (from %.1f)\n",
		best.name, bpsi, bth, bph, stdFit, best.std)
	if !okFit {
		return fmt.Errorf("refined rows are not a proper rotation - this should not happen")
	}
	qc := common.QuaternionUnit(common.QuaternionProduct(qSensor, qFit))

	dip, vert, horiz := magneticDip(data, qc, env)
	fmt.Printf("\nfield geometry with this orientation: dip %+.1f deg (vertical %+.3f, horizontal %.3f)\n", dip, vert, horiz)
	if dip < 0 {
		fmt.Printf("  *** NEGATIVE DIP: the vertical field points up. In the northern hemisphere that is\n")
		fmt.Printf("  *** a reflection in the chain - most likely an axis sign flipped in a sensor driver.\n")
		fmt.Printf("  *** No rotation can correct it. The heading may still look right when level and\n")
		fmt.Printf("  *** only degrade with bank. Fix the sign before trusting any of the numbers above.\n")
		failedGeometry = true
	} else {
		fmt.Printf("  compare with the WMM inclination for your location (central Italy: +59 deg)\n")
	}

	if !wellSwept {
		fmt.Printf("\nNO RECOMMENDATION: the fit is under-swept (see above). Keep what is on the unit.\n")
		failedGeometry = true
		return nil
	}
	fmt.Printf("\nrecommended (GPS track is TRUE: subtract the local declination from Offset for magnetic):\n")
	fmt.Printf("  POST /setSettings  {\"MagAxisMappingX\":[%.6f,%.6f,%.6f],\"MagAxisMappingY\":[%.6f,%.6f,%.6f],\"MagAxisMappingZ\":[%.6f,%.6f,%.6f]}\n",
		rowsFit[0][0], rowsFit[0][1], rowsFit[0][2], rowsFit[1][0], rowsFit[1][1], rowsFit[1][2], rowsFit[2][0], rowsFit[2][1], rowsFit[2][2])
	fmt.Printf("  -> MagSensorQuaternion [%.6f, %.6f, %.6f, %.6f]\n", qc[0], qc[1], qc[2], qc[3])
	fmt.Printf("  PUT+POST /magnetometer  {\"MagMinX\":%.0f,\"MagMaxX\":%.0f,\"MagMinY\":%.0f,\"MagMaxY\":%.0f,\"MagMinZ\":%.0f,\"MagMaxZ\":%.0f,\"X\":0,\"Y\":0,\"Z\":0,\"Heading\":0,\"Offset\":%.0f,\"Calibrating\":false}\n",
		env[0], env[1], env[2], env[3], env[4], env[5], meanFit)
	fmt.Printf("  (plain permutation alternative: rows %s, Offset %.0f, std %.1f)\n", best.name, best.mean, best.std)
	return nil
}

// ---------------------------------------------------------------------------

func main() {
	var (
		synth     = flag.Bool("synth", false, "run the synthetic heading-recovery check")
		ahrsChk   = flag.Bool("ahrs", false, "synthetic check with pitch/roll from goflying's solver (slower)")
		migrate   = flag.Bool("migrate", false, "check legacy MagAxisMapping -> quaternion conversion")
		csvPath   = flag.String("csv", "", "replay an AHRS log (sensors_*.csv)")
		flightLog = flag.String("flightlog", "", "calibrate from a datalog.go flight recording (.sqlite)")
		sensorQ   = flag.String("sensorq", "", "the unit's SensorQuaternion as w,x,y,z (for -flightlog)")
		dip       = flag.Float64("dip", 60.0, "magnetic dip angle in degrees")
		tol       = flag.Float64("tol", 0.5, "synthetic heading tolerance in degrees")
		verbose   = flag.Bool("v", false, "print every synthetic sample")
	)
	flag.Parse()

	if !*synth && !*ahrsChk && !*migrate && *csvPath == "" && *flightLog == "" {
		flag.Usage()
		os.Exit(2)
	}

	failed := false

	if *migrate {
		fmt.Println("== legacy mapping migration ==")
		if n := runMigrate(); n > 0 {
			fmt.Printf("%d migration check(s) failed\n", n)
			failed = true
		}
		fmt.Println()
	}

	if *synth {
		fmt.Printf("== synthetic heading recovery (dip %.0f deg) ==\n", *dip)

		worst, desc := runSynth(*dip, pathQuat, *verbose)
		fmt.Printf("quaternion path:  worst error %8.4f deg\n", worst)
		if worst > *tol {
			fmt.Printf("  FAIL (tolerance %.2f): %s\n", *tol, desc)
			failed = true
		} else {
			fmt.Printf("  ok (tolerance %.2f)\n", *tol)
		}

		// Contrast only, not failures. These two isolate the two defects:
		// no-tilt shows the cost of the old zeroed pitch/roll alone,
		// legacy adds the mirrored atan2 and the wrong axis mapping on top.
		ntWorst, ntDesc := runSynth(*dip, pathNoTilt, false)
		fmt.Printf("no tilt comp:     worst error %8.4f deg   (today's default)\n", ntWorst)
		fmt.Printf("  worst case: %s\n", ntDesc)

		lWorst, lDesc := runSynth(*dip, pathLegacy, false)
		fmt.Printf("legacy path:      worst error %8.4f deg\n", lWorst)
		fmt.Printf("  worst case: %s\n", lDesc)
		fmt.Println()
	}

	if *ahrsChk {
		fmt.Printf("== heading recovery with goflying attitude (dip %.0f deg) ==\n", *dip)
		worst, desc := runSynth(*dip, pathAHRS, *verbose)
		fmt.Printf("goflying + quaternion path: worst error %8.4f deg\n", worst)
		if worst > *tol {
			fmt.Printf("  FAIL (tolerance %.2f): %s\n", *tol, desc)
			failed = true
		} else {
			fmt.Printf("  ok (tolerance %.2f)\n", *tol)
		}
		fmt.Println()
	}

	if *flightLog != "" {
		fmt.Printf("== calibrate from %s ==\n", *flightLog)
		var q [4]float64
		parts := strings.Split(*sensorQ, ",")
		if len(parts) != 4 {
			fmt.Fprintln(os.Stderr, "error: -flightlog needs -sensorq w,x,y,z (from GET /getSettings on the unit)")
			os.Exit(2)
		}
		for i, p := range parts {
			q[i], _ = strconv.ParseFloat(strings.TrimSpace(p), 64)
		}
		if err := runFlightLog(*flightLog, q); err != nil {
			fmt.Fprintf(os.Stderr, "error: %s\n", err)
			failed = true
		}
		if failedGeometry {
			failed = true
		}
		fmt.Println()
	}

	if *csvPath != "" {
		fmt.Printf("== replay %s ==\n", *csvPath)
		if err := runCSV(*csvPath, [4]float64{1, 0, 0, 0}, *dip); err != nil {
			fmt.Fprintf(os.Stderr, "error: %s\n", err)
			failed = true
		}
	}

	if failed {
		os.Exit(1)
	}
}
