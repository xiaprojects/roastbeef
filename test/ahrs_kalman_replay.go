/*
	ahrs_kalman_replay: run a recorded flight through goflying's Kalman AHRS
	(ahrs.KalmanState) and the Simple AHRS the daemon uses today, and score
	both against the GPS track, to find out what the magnetometer buys.

	  -flightlog F.sqlite   a datalog.go recording (1 Hz mySituation rows):
	                        raw gyro (before the AHRS offset D), accel, the
	                        smoothed magnetometer sample and its calibration
	                        envelope, GPS track/speed, baro vertical speed.
	  -sensorq w,x,y,z      SensorQuaternion of the unit at the time
	  -magq w,x,y,z         MagSensorQuaternion of the unit at the time
	  -c x,y,z  -d x,y,z    accel and gyro calibration C and D
	  -mag none|free|pinned magnetometer use in the Kalman filter:
	                        none    MValid=false
	                        free    as implemented: the earth field N is a
	                                state, initialised from the first sample
	                        pinned  N set to the local field (-field, -dip)
	                                and held there
	  -field uT -dip deg    local geomagnetic field magnitude and inclination
	  -decl deg             declination, added to magnetic headings so they
	                        compare with the GPS (true) track
	  -accelsign +1|-1      sign applied to the accelerometer for the Kalman
	                        filter (its measurement model predicts -1 g on
	                        the up axis at rest; the drivers report +1)
	  -magenv a,b,c,d,e,f   replace the logged mag calibration envelope (min/max
	                        per axis) and -magoffset its compass Offset, e.g.
	                        with the fit from magnetometer_check
	  -magbias uT           Kalman prior sd of the mag bias L; -wind kt and
	                        -windnoise kt/sqrt(s) the wind prior and process noise
	  -provider             drive the filter through its AHRSProvider adapter
	                        (ahrs.KalmanAHRS) with the daemon's own C, D and
	                        SensorQuaternion, the way sensorAttitudeSender
	                        drives SimpleState.  Needs a build with
	                        -tags kalmanahrs against a goflying carrying
	                        notes/goflying-kalman-mag.patch.
	  -csv out.csv          per-sample dump for plotting
	  -mingps kt            ground speed above which heading is scored
	                        against the track (default 40)

	NOTE: in goflying as vendored (v0.0.0-20260103193118) the magnetometer
	rows of KalmanState's measurement Jacobian are commented out
	("TODO westphae: fix these"), so -mag free and pinned change nothing:
	the residual is computed but has no path into the state.
	notes/goflying-kalman-mag.patch restores them (validated against finite
	differences), fixes the attitude-sigma propagation Valid() relies on, and
	adds the AHRSProvider adapter ahrs.KalmanAHRS; build this tool against a
	goflying with that patch to see the magnetometer act.

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
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/xiaprojects/goflying/ahrs"
	"github.com/xiaprojects/roastbeef/common"
)

type row struct {
	t          float64 // seconds, monotonic
	g, a       [3]float64
	mag        [3]float64
	env        [6]float64 // minX,maxX,minY,maxY,minZ,maxZ
	magOffset  float64
	gs, trk    float64
	gpsVS      float64 // ft/min
	baroVS     float64 // ft/min
	fix        int
	hacc       float64
	roll       float64 // as logged by the daemon
	pitch      float64
	gyroHdg    float64
	magHdg     float64
	compassHdg float64
}

type magJSON struct {
	MagMaxX, MagMaxY, MagMaxZ float64
	MagMinX, MagMinY, MagMinZ float64
	X, Y, Z                   float64
	Heading, Offset           float64
}

func readLog(path string) ([]row, error) {
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`SELECT ts.StratuxClock_value,
		s.AHRSGyroX, s.AHRSGyroY, s.AHRSGyroZ, s.AHRSAccX, s.AHRSAccY, s.AHRSAccZ,
		s.Magnetometer, s.GPSGroundSpeed, s.GPSTrueCourse, s.GPSVerticalSpeed, s.BaroVerticalSpeed,
		s.GPSFixQuality, s.GPSHorizontalAccuracy, s.AHRSRoll, s.AHRSPitch, s.AHRSGyroHeading, s.AHRSMagHeading
		FROM mySituation s JOIN timestamp ts ON ts.id = s.timestamp_id ORDER BY s.timestamp_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []row
	for rows.Next() {
		var r row
		var clock, mag string
		if err := rows.Scan(&clock, &r.g[0], &r.g[1], &r.g[2], &r.a[0], &r.a[1], &r.a[2],
			&mag, &r.gs, &r.trk, &r.gpsVS, &r.baroVS, &r.fix, &r.hacc,
			&r.roll, &r.pitch, &r.gyroHdg, &r.magHdg); err != nil {
			return nil, err
		}
		// "0001-01-01 00:00:52.13 +0000 UTC"
		tm, err := time.Parse("2006-01-02 15:04:05.99 -0700 MST", clock)
		if err != nil {
			return nil, fmt.Errorf("clock %q: %v", clock, err)
		}
		r.t = float64(tm.Sub(time.Time{})) / 1e9
		var mj magJSON
		if err := json.Unmarshal([]byte(mag), &mj); err != nil {
			return nil, fmt.Errorf("magnetometer %q: %v", mag, err)
		}
		r.mag = [3]float64{mj.X, mj.Y, mj.Z}
		r.env = [6]float64{mj.MagMinX, mj.MagMaxX, mj.MagMinY, mj.MagMaxY, mj.MagMinZ, mj.MagMaxZ}
		r.magOffset = mj.Offset
		r.compassHdg = mj.Heading
		out = append(out, r)
	}
	return out, rows.Err()
}

func parseVec(s string, n int) ([]float64, error) {
	parts := strings.Split(s, ",")
	if len(parts) != n {
		return nil, fmt.Errorf("%q: want %d comma-separated numbers", s, n)
	}
	v := make([]float64, n)
	for i, p := range parts {
		f, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return nil, err
		}
		v[i] = f
	}
	return v, nil
}

func conj(q [4]float64) [4]float64 { return [4]float64{q[0], -q[1], -q[2], -q[3]} }

// kalmanProvider is the AHRSProvider adapter around the Kalman filter.  It
// only exists in a goflying carrying notes/goflying-kalman-mag.patch, so it is
// wired in by ahrs_kalman_replay_provider.go under the kalmanahrs build tag;
// without the tag -provider is refused.
type kalmanProvider interface {
	ahrs.AHRSProvider
	KalmanState() *ahrs.KalmanState
}

var newKalmanProvider func(cfg map[string]float64, c, d *[3]float64, f *[4]float64) kalmanProvider

// score accumulates heading error statistics against the GPS track.
type score struct {
	n            int
	sumSq, sumAb float64
	worst        float64
}

func (s *score) add(hdg, trk float64) {
	d := common.HeadingDiffDeg(hdg, trk)
	s.n++
	s.sumSq += d * d
	s.sumAb += d
	s.worst = math.Max(s.worst, math.Abs(d))
}

func (s score) String() string {
	if s.n == 0 {
		return "n/a"
	}
	return fmt.Sprintf("rms %5.1f  mean %+5.1f  worst %5.1f deg over %d s", math.Sqrt(s.sumSq/float64(s.n)), s.sumAb/float64(s.n), s.worst, s.n)
}

func main() {
	flightlog := flag.String("flightlog", "", "datalog .sqlite to replay")
	sensorqS := flag.String("sensorq", "0.0008540788764084712,0.14747589890389523,-0.005727889129517793,0.989048695022907", "SensorQuaternion w,x,y,z")
	magqS := flag.String("magq", "-0.6987591141922346,0.10023097892872197,-0.10833143741925846,0.6999669641225585", "MagSensorQuaternion w,x,y,z")
	cS := flag.String("c", "0.3081,-0.0117,1.0101", "accel calibration C")
	dS := flag.String("d", "-6.4,0.5565,-0.5565", "gyro calibration D")
	magMode := flag.String("mag", "free", "magnetometer use in the Kalman filter: none, free, pinned")
	field := flag.Float64("field", 46.5, "local field magnitude, uT")
	dip := flag.Float64("dip", 59, "local field inclination, deg (positive down)")
	decl := flag.Float64("decl", 3.5, "declination, deg east")
	accelSign := flag.Float64("accelsign", -1, "sign applied to accel for the Kalman filter")
	magEnvS := flag.String("magenv", "", "override the logged mag calibration envelope: minX,maxX,minY,maxY,minZ,maxZ")
	magOffset := flag.Float64("magoffset", 0, "with -magenv: the compass Offset that goes with it, deg")
	magBiasSD := flag.Float64("magbias", 10, "Kalman prior sd of the mag bias L, uT (10 is goflying's default; ~1 for a pre-calibrated mag)")
	windSD := flag.Float64("wind", 0, "Kalman prior sd of the wind V, kt (0 keeps goflying's default)")
	windNoise := flag.Float64("windnoise", 0, "Kalman process noise of the wind V, kt per sqrt(s) (0 keeps goflying's default)")
	provider := flag.Bool("provider", false, "drive the Kalman filter through its AHRSProvider adapter exactly as the daemon drives SimpleState (needs -tags kalmanahrs, see the header)")
	csvOut := flag.String("csv", "", "per-sample CSV dump")
	minGPS := flag.Float64("mingps", 40, "ground speed above which heading is scored against track, kt")
	flag.Parse()

	if *flightlog == "" {
		flag.Usage()
		os.Exit(2)
	}
	sq, err := parseVec(*sensorqS, 4)
	if err != nil {
		fmt.Fprintln(os.Stderr, "-sensorq:", err)
		os.Exit(2)
	}
	mq, err := parseVec(*magqS, 4)
	if err != nil {
		fmt.Fprintln(os.Stderr, "-magq:", err)
		os.Exit(2)
	}
	cv, err := parseVec(*cS, 3)
	if err != nil {
		fmt.Fprintln(os.Stderr, "-c:", err)
		os.Exit(2)
	}
	dv, err := parseVec(*dS, 3)
	if err != nil {
		fmt.Fprintln(os.Stderr, "-d:", err)
		os.Exit(2)
	}
	var magEnv *[6]float64
	if *magEnvS != "" {
		ev, err := parseVec(*magEnvS, 6)
		if err != nil {
			fmt.Fprintln(os.Stderr, "-magenv:", err)
			os.Exit(2)
		}
		magEnv = &[6]float64{ev[0], ev[1], ev[2], ev[3], ev[4], ev[5]}
	}
	sensorQ := [4]float64{sq[0], sq[1], sq[2], sq[3]}
	magQ := [4]float64{mq[0], mq[1], mq[2], mq[3]}
	C := [3]float64{cv[0], cv[1], cv[2]}
	D := [3]float64{dv[0], dv[1], dv[2]}
	// q_mag = q_sensor (x) q_axis, so q_axis = conj(q_sensor) (x) q_mag takes
	// the magnetometer chip frame into the accelerometer chip frame, where the
	// AHRS sensor quaternion F applies to it like to the accel and gyro.
	axisQ := common.QuaternionUnit(common.QuaternionProduct(conj(sensorQ), magQ))

	rows, err := readLog(*flightlog)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if magEnv != nil {
		for i := range rows {
			rows[i].env = *magEnv
			rows[i].magOffset = *magOffset
		}
	}
	fmt.Printf("%s: %d rows, %.0f s; mag=%s field %.1f uT dip %.0f decl %+.1f; accelsign %+.0f\n",
		*flightlog, len(rows), rows[len(rows)-1].t-rows[0].t, *magMode, *field, *dip, *decl, *accelSign)

	var w *csv.Writer
	if *csvOut != "" {
		f, err := os.Create(*csvOut)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		defer f.Close()
		w = csv.NewWriter(f)
		defer w.Flush()
		w.Write([]string{"t", "gs", "track", "kRoll", "kPitch", "kHdg", "kdRoll", "kdPitch", "kdHdg", "kValid",
			"sRoll", "sPitch", "sHdg", "sValid", "compass", "logRoll", "logPitch", "logGyroHdg", "logMagHdg",
			"kN1", "kN2", "kN3", "kD1", "kD2", "kD3", "kV1", "kV2", "kU1"})
	}

	// --- Simple AHRS, as the daemon runs it.
	simple := ahrs.NewSimpleAHRS()
	simple.SetCalibrations(&C, &D)
	simple.SetSensorQuaternion(&sensorQ)
	sm := ahrs.NewMeasurement()

	// --- Kalman AHRS.
	var kal *ahrs.KalmanState
	km := ahrs.NewMeasurement()
	var prov kalmanProvider
	if *provider {
		if newKalmanProvider == nil {
			fmt.Fprintln(os.Stderr, "-provider needs a build with -tags kalmanahrs against a patched goflying")
			os.Exit(2)
		}
		cfg := map[string]float64{"MagBiasSigma": *magBiasSD, "WindSigma": *windSD, "WindNoise": *windNoise}
		if *magMode == "pinned" {
			cfg["MagField"], cfg["MagDip"] = *field, *dip
		}
		// The daemon's C (accelerometer at level) and D, as SetCalibrations takes them.
		prov = newKalmanProvider(cfg, &C, &D, &sensorQ)
	}

	var (
		kScore, sScore, cScore, logGyroScore, logMagScore, kVsCompass score
		kValidN, sValidN                                              int
		kRollDiff, kPitchDiff                                         float64 // vs simple, when both valid
		kCmpN                                                         int
		kdHdgSum                                                      float64
		kUpdates                                                      int
	)

	fill := func(m *ahrs.Measurement, r row, forKalman bool) {
		m.T = r.t
		m.SValid = true
		m.B1, m.B2, m.B3 = r.g[0], r.g[1], r.g[2]
		m.A1, m.A2, m.A3 = r.a[0], r.a[1], r.a[2]
		if forKalman {
			m.A1, m.A2, m.A3 = *accelSign*r.a[0], *accelSign*r.a[1], *accelSign*r.a[2]
		}
		m.WValid = r.fix > 0 && r.hacc < 30
		if m.WValid {
			m.TW = r.t
			m.W1 = r.gs * math.Sin(r.trk*ahrs.Deg)
			m.W2 = r.gs * math.Cos(r.trk*ahrs.Deg)
			m.W3 = r.baroVS * 60 / 6076.12
		}
		// Magnetometer: the daemon hands the Simple AHRS the raw chip-frame
		// sample.  The Kalman filter wants a calibrated field, in the accel
		// chip frame, in uT.
		m.MValid = *magMode != "none"
		if forKalman {
			cx, cy, cz := common.CalibrateFromMag(r.mag[0], r.mag[1], r.mag[2],
				r.env[0], r.env[1], r.env[2], r.env[3], r.env[4], r.env[5], true)
			bx, by, bz := common.QuaternionRotateVector(axisQ, cx, cy, cz)
			m.M1, m.M2, m.M3 = bx**field, by**field, bz**field
		} else {
			m.M1, m.M2, m.M3 = r.mag[0], r.mag[1], r.mag[2]
		}
	}

	priors := func(s *ahrs.KalmanState) {
		for i := 29; i <= 31; i++ {
			s.M.Set(i, i, *magBiasSD**magBiasSD)
		}
		if *windSD > 0 {
			for i := 16; i <= 18; i++ {
				s.M.Set(i, i, *windSD**windSD)
			}
		}
		if *windNoise > 0 {
			for i := 16; i <= 18; i++ {
				s.N.Set(i, i, *windNoise**windNoise)
			}
		}
	}

	pin := func(s *ahrs.KalmanState) {
		// Earth frame is east, north, up; the field points to magnetic north
		// and down.  Heading then comes out magnetic.
		s.N1 = 0
		s.N2 = *field * math.Cos(*dip*ahrs.Deg)
		s.N3 = -*field * math.Sin(*dip*ahrs.Deg)
		for i := 13; i <= 15; i++ {
			s.M.Set(i, i, 0.01)
			s.N.Set(i, i, 1e-6)
		}
	}

	for _, r := range rows {
		fill(sm, r, false)
		simple.Compute(sm)
		sRoll, sPitch, sHdg := simple.RollPitchHeading()
		sValid := simple.Valid()
		if sValid {
			sValidN++
			sRoll, sPitch, sHdg = sRoll/ahrs.Deg, sPitch/ahrs.Deg, sHdg/ahrs.Deg
		}

		fill(km, r, true)
		if prov != nil {
			// The adapter applies the drivers' accel sign and scale itself.
			km.A1, km.A2, km.A3 = r.a[0], r.a[1], r.a[2]
			prov.Compute(km)
			kal = prov.KalmanState()
			if kal.M == nil {
				continue
			}
		} else if kal == nil {
			if !km.WValid {
				continue
			}
			kal = ahrs.InitializeKalman(km)
			kal.F0, kal.F1, kal.F2, kal.F3 = sensorQ[0], sensorQ[1], sensorQ[2], sensorQ[3]
			kal.C1, kal.C2, kal.C3 = *accelSign*C[0], *accelSign*C[1], *accelSign*C[2]
			kal.D1, kal.D2, kal.D3 = D[0], D[1], D[2]
			priors(kal)
			if *magMode == "pinned" {
				pin(kal)
			}
			continue
		}
		if prov == nil {
			kal.Compute(km)
		}
		kUpdates++
		kRoll, kPitch, kHdg := kal.CalcRollPitchHeading()
		kdRoll, kdPitch, kdHdg := kal.CalcRollPitchHeadingUncertainty()
		kValid := kal.Valid()
		if prov != nil {
			kValid = prov.Valid()
		}
		kHdgTrue := common.NormalizeHeadingDeg(kHdg + *decl)
		// Compass from the calibration in force here and the daemon's logged
		// attitude (the replayed Simple attitude is not faithful at 1 Hz).
		compass := common.NormalizeHeadingDeg(common.HeadingFromMagQ(r.pitch, r.roll, r.mag[0], r.mag[1], r.mag[2],
			r.env[0], r.env[1], r.env[2], r.env[3], r.env[4], r.env[5], r.magOffset, magQ, true, 1, math.NaN()) + *decl)
		if kValid {
			kValidN++
			kdHdgSum += kdHdg / ahrs.Deg
		}
		if kValid && sValid {
			kCmpN++
			kRollDiff += math.Abs(kRoll - sRoll)
			kPitchDiff += math.Abs(kPitch - sPitch)
		}
		if r.gs > *minGPS && r.fix > 0 {
			if kValid {
				kScore.add(kHdgTrue, r.trk)
			}
			kVsCompass.add(kHdgTrue, compass)
			if sValid {
				sScore.add(sHdg, r.trk)
			}
			cScore.add(compass, r.trk)
			logGyroScore.add(r.gyroHdg, r.trk)
			logMagScore.add(common.NormalizeHeadingDeg(r.magHdg+*decl), r.trk)
		}
		if w != nil {
			f := func(v float64) string { return strconv.FormatFloat(v, 'f', 3, 64) }
			b := func(v bool) string {
				if v {
					return "1"
				}
				return "0"
			}
			w.Write([]string{f(r.t), f(r.gs), f(r.trk), f(kRoll), f(kPitch), f(kHdgTrue), f(kdRoll / ahrs.Deg), f(kdPitch / ahrs.Deg), f(kdHdg / ahrs.Deg), b(kValid),
				f(sRoll), f(sPitch), f(sHdg), b(sValid), f(compass), f(r.roll), f(r.pitch), f(r.gyroHdg), f(r.magHdg),
				f(kal.N1), f(kal.N2), f(kal.N3), f(kal.D1), f(kal.D2), f(kal.D3), f(kal.V1), f(kal.V2), f(kal.U1)})
		}
	}

	fmt.Printf("\nvalid: kalman %d/%d, simple %d/%d\n", kValidN, kUpdates, sValidN, len(rows))
	if kCmpN > 0 {
		fmt.Printf("kalman vs simple attitude (both valid, %d s): mean |droll| %.1f  |dpitch| %.1f deg\n", kCmpN, kRollDiff/float64(kCmpN), kPitchDiff/float64(kCmpN))
	}
	if kValidN > 0 {
		fmt.Printf("kalman mean heading uncertainty %.1f deg\n", kdHdgSum/float64(kValidN))
	}
	if kal != nil {
		fmt.Printf("kalman final field N (E,N,U) %.1f %.1f %.1f uT, mag bias L %.1f %.1f %.1f, gyro bias D %.2f %.2f %.2f\n",
			kal.N1, kal.N2, kal.N3, kal.L1, kal.L2, kal.L3, kal.D1, kal.D2, kal.D3)
	}
	fmt.Printf("\nheading vs GPS track above %.0f kt:\n", *minGPS)
	fmt.Printf("  kalman            %s\n", kScore)
	fmt.Printf("  simple (replayed) %s\n", sScore)
	fmt.Printf("  logged gyro hdg   %s\n", logGyroScore)
	fmt.Printf("  compass (logged)  %s\n", cScore)
	fmt.Printf("  logged AHRSMagHdg %s\n", logMagScore)
	fmt.Printf("kalman heading vs compass (same calibration): %s\n", kVsCompass)
	if kal != nil {
		fmt.Printf("kalman final wind V (E,N) %.1f %.1f kt, airspeed U1 %.1f kt\n", kal.V1, kal.V2, kal.U1)
	}
}
