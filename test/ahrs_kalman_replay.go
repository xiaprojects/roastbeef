/*
	ahrs_kalman_replay: run a recorded flight through goflying's Kalman AHRS
	(ahrs.KalmanAHRS, as newAHRS("kalman") would build it) and the Simple AHRS
	the daemon uses today, and score both against the GPS track and, when the
	datalog has one, the external attitude unit (bridgefloat pitch_deg and
	roll_deg).

	  -flightlog F.sqlite   a datalog.go recording (1 Hz mySituation rows):
	                        raw gyro (before the AHRS offset D), raw accel,
	                        the smoothed magnetometer sample and its
	                        calibration envelope, GPS track/speed/position,
	                        baro vertical speed; and the external unit.
	  -sensorlog S.csv      the same flight's 20 Hz AHRSLog (sensors_*.csv),
	                        recorded with the Simple engine: replayed instead
	                        of the 1 Hz rows.  The datalog still gives the
	                        magnetometer envelope, the compass and the
	                        external unit; the CSV's T is the stratux clock,
	                        so the two line up exactly.
	  -settings S.json      the unit's settings at the time (GET /getSettings
	                        or stratux.conf), which the datalog does not
	                        record: SensorQuaternion, MagSensorQuaternion, C,
	                        D, AccelGain/AccelOffset (applied to the 1 Hz raw
	                        accel as accelCorrect does) and MagField/MagDip.
	                        Without it the flag defaults, I-RVDX's before
	                        2026-10-23, and no accel correction.
	  -sensorq w,x,y,z      SensorQuaternion, over -settings
	  -magq w,x,y,z         MagSensorQuaternion, over -settings
	  -c x,y,z  -d x,y,z    accel and gyro calibration C and D, over -settings
	  -mag none|free|pinned magnetometer use in the Kalman filter:
	                        none    MValid=false
	                        free    the earth field N is a state,
	                                initialised from the first sample
	                        pinned  (default, as the daemon) N set to the
	                                local field (-field, -dip) and held there
	  -field uT -dip deg    local geomagnetic field magnitude and inclination;
	                        default MagField/MagDip from -settings, else the
	                        centred dipole at the flight's mean GPS position,
	                        as kalmanField does
	  -decl deg             declination, added to magnetic headings so they
	                        compare with the GPS (true) track
	  -magenv a,b,c,d,e,f   replace the logged mag calibration envelope (min/max
	                        per axis) and -magoffset its compass Offset, e.g.
	                        with the fit from magnetometer_check
	  -magbias uT           Kalman prior sd of the mag bias L (default 3, the
	                        daemon's kalmanMagBiasSigma); -wind kt and
	                        -windnoise kt/sqrt(s) the wind prior and process
	                        noise; -maxsigma deg the roll/pitch sigma above
	                        which the attitude is invalid (default 10, as
	                        kalmanConfig)
	  -gyrosigma deg/s  -magsigma uT  -aoasigma kt
	                        KalmanAHRS GyroSigma, MagSigma and
	                        AngleOfAttackSigma: negative keeps goflying's
	                        default, 0 is the filter as written
	  -engine kalman|ins    the engine scored against Simple: KalmanAHRS
	                        (default) or INSAHRS, the GPS-aided inertial
	                        filter (no magnetometer); -cfg Key=value,... is
	                        handed to its SetConfig last
	  -vs baro|fast         the vertical speed the AHRS gets: baro (default)
	                        is the daemon's BaroVerticalSpeed, a 5 s average
	                        for the VSI that lags a zoom by about 4 s; fast is
	                        the pressure altitude's rate over the last second
	  -provider             (default) drive the filter through its
	                        AHRSProvider adapter ahrs.KalmanAHRS with the
	                        daemon's own C, D and SensorQuaternion, exactly as
	                        newAHRS("kalman") does.  -provider=false drives
	                        the bare KalmanState instead, for experiments: it
	                        loads C as the filter's bias state, which it is
	                        not (it is the reading at level), and F
	                        unconjugated, so its attitude is not the daemon's.
	  -accelsign +1|-1      with -provider=false only: sign applied to the
	                        accelerometer (the filter predicts -1 g on the up
	                        axis at rest; the drivers report +1)
	  -csv out.csv          per-sample dump for plotting
	  -mingps kt            ground speed above which heading and attitude are
	                        scored (default 40)

	Against the external unit the attitude is scored in steady flight and
	while rolling (the unit's roll rate under or over 3 deg/s), and through
	each aerobatic figure (its roll past 90 deg or pitch past 45): the worst
	tilt, the tilt 5, 30 and 60 s after it, and how long the Kalman engine
	called the attitude valid while more than -maxsigma off.

	NOTE: the datalog is 1 Hz and the daemon runs the filter at 20 Hz, so a
	-flightlog replay sees 1/20th of the updates, each a single gyro sample
	standing for the whole second.  Heading and pitch hold up; roll lags in
	turns and is lost through aerobatic figures, and the recovery after them
	is the replay's, not the filter's.  Judge those on -sensorlog.

	Build: make -C test
*/

package main

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/xiaprojects/goflying/ahrs"
	"github.com/xiaprojects/roastbeef/common"
)

type row struct {
	t, tw      float64 // seconds on the stratux clock: the sample, the GPS fix
	g, a       [3]float64
	mag        [3]float64
	env        [6]float64 // minX,maxX,minY,maxY,minZ,maxZ
	magCal     bool       // a compass calibration was running: env is being built
	magOffset  float64
	gs, trk    float64
	gpsVS      float64 // ft/min
	baroVS     float64 // ft/min
	w3         float64 // kt, the vertical speed the daemon hands the AHRS
	baroAlt    float64 // ft, pressure altitude
	fix        int
	hacc       float64
	wValid     bool // isGPSGroundTrackValid, as the daemon judged it
	lat, lon   float64
	roll       float64 // as logged by the daemon
	pitch      float64
	gyroHdg    float64
	magHdg     float64
	compassHdg float64
}

// parseClock reads a datalog stratux clock, "0001-01-01 00:00:52.13 +0000
// UTC", as seconds since it started.
func parseClock(clock string) (float64, error) {
	tm, err := time.Parse("2006-01-02 15:04:05.99 -0700 MST", clock)
	if err != nil {
		return 0, fmt.Errorf("clock %q: %v", clock, err)
	}
	return float64(tm.Sub(time.Time{})) / 1e9, nil
}

type magJSON struct {
	MagMaxX, MagMaxY, MagMaxZ float64
	MagMinX, MagMinY, MagMinZ float64
	X, Y, Z                   float64
	Heading, Offset           float64
	Calibrating               bool
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
		s.GPSFixQuality, s.GPSHorizontalAccuracy, s.AHRSRoll, s.AHRSPitch, s.AHRSGyroHeading, s.AHRSMagHeading,
		s.GPSLatitude, s.GPSLongitude, s.BaroPressureAltitude
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
			&r.roll, &r.pitch, &r.gyroHdg, &r.magHdg, &r.lat, &r.lon, &r.baroAlt); err != nil {
			return nil, err
		}
		var err error
		if r.t, err = parseClock(clock); err != nil {
			return nil, err
		}
		r.tw = r.t
		r.w3 = r.baroVS * 60 / 6076.12
		r.wValid = r.fix > 0 && r.hacc < 30
		var mj magJSON
		if err := json.Unmarshal([]byte(mag), &mj); err != nil {
			return nil, fmt.Errorf("magnetometer %q: %v", mag, err)
		}
		r.mag = [3]float64{mj.X, mj.Y, mj.Z}
		r.env = [6]float64{mj.MagMinX, mj.MagMaxX, mj.MagMinY, mj.MagMaxY, mj.MagMinZ, mj.MagMaxZ}
		r.magCal = mj.Calibrating
		r.magOffset = mj.Offset
		r.compassHdg = mj.Heading
		out = append(out, r)
	}
	return out, rows.Err()
}

// clockBase is the stratux clock's zero as an AHRSLog's T column carries it:
// sensorAttitudeSender takes UnixNano of a time.Time counted up from Go's zero
// time, which overflows int64, but by the same amount for every sample.
var clockBase = float64(time.Time{}.UnixNano()/1000) / 1e6

// readSensorLog reads a 20 Hz AHRSLog recorded with the Simple engine: the
// measurement as sensorAttitudeSender handed it to the AHRS (the accel
// already corrected), the attitude the Simple AHRS made of it and the GPS.
// The magnetometer envelope and the compass come from the nearest datalog
// row in ref.
func readSensorLog(path string, ref []row) ([]row, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	rd := csv.NewReader(f)
	hdr, err := rd.Read()
	if err != nil {
		return nil, fmt.Errorf("%s: %v", path, err)
	}
	col := map[string]int{}
	for i, h := range hdr {
		col[strings.TrimSpace(h)] = i
	}
	for _, k := range []string{"T", "TW", "WValid", "W1", "W2", "W3", "A1", "A2", "A3", "B1", "B2", "B3",
		"M1", "M2", "M3", "Roll", "Pitch", "Heading", "GPSHorizontalAccuracy"} {
		if _, ok := col[k]; !ok {
			return nil, fmt.Errorf("%s: no %s column: not an AHRSLog of the Simple engine", path, k)
		}
	}
	var out []row
	last := math.Inf(-1)
	for {
		rec, err := rd.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("%s: %v", path, err)
		}
		v := func(k string) float64 {
			x, _ := strconv.ParseFloat(rec[col[k]], 64)
			return x
		}
		t := v("T") - clockBase
		if !(t > last) {
			continue // the AHRS returned before updating its log: the previous sample again
		}
		last = t
		r := nearestRow(ref, t)
		r.t, r.tw = t, v("TW")-clockBase
		r.wValid = v("WValid") != 0
		w1, w2 := v("W1"), v("W2")
		r.gs, r.trk = math.Hypot(w1, w2), common.NormalizeHeadingDeg(math.Atan2(w1, w2)/ahrs.Deg)
		r.w3 = v("W3")
		r.baroVS = r.w3 * 6076.12 / 60
		r.hacc = v("GPSHorizontalAccuracy")
		r.fix = 0
		if r.wValid {
			r.fix = 1
		}
		r.g = [3]float64{v("B1"), v("B2"), v("B3")}
		r.a = [3]float64{v("A1"), v("A2"), v("A3")}
		r.mag = [3]float64{v("M1"), v("M2"), v("M3")}
		r.roll, r.pitch, r.gyroHdg = v("Roll"), v("Pitch"), v("Heading")
		if _, ok := col["BaroPressureAltitude"]; ok {
			r.baroAlt = v("BaroPressureAltitude")
		}
		out = append(out, r)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%s: no samples", path)
	}
	return out, nil
}

// fastVS replaces the vertical speed of rs (in time order) with the pressure
// altitude's rate over the last second, kt: what the AHRS would get if the
// daemon handed it that rather than BaroVerticalSpeed, a 5 s average for the
// VSI that lags a zoom by about 4 s.
func fastVS(rs []row) {
	j := 0
	for i := range rs {
		for j+1 < i && rs[j+1].t <= rs[i].t-1 {
			j++
		}
		if dt := rs[i].t - rs[j].t; dt >= 0.5 && dt < 3 {
			rs[i].w3 = (rs[i].baroAlt - rs[j].baroAlt) / dt * 0.592484 // ft/s to kt
		}
	}
}

// nearestRow is the row of rs (in time order) nearest t.
func nearestRow(rs []row, t float64) row {
	i := sort.Search(len(rs), func(i int) bool { return rs[i].t >= t })
	switch {
	case i == len(rs):
		return rs[len(rs)-1]
	case i > 0 && t-rs[i-1].t < rs[i].t-t:
		return rs[i-1]
	}
	return rs[i]
}

// series is a time-ordered signal from the datalog.
type series struct{ t, v []float64 }

// at is the sample nearest t, if one is within maxDT.
func (s series) at(t, maxDT float64) (float64, bool) {
	i := sort.SearchFloat64s(s.t, t)
	best := -1
	for _, j := range []int{i - 1, i} {
		if j >= 0 && j < len(s.t) && math.Abs(s.t[j]-t) <= maxDT && (best < 0 || math.Abs(s.t[j]-t) < math.Abs(s.t[best]-t)) {
			best = j
		}
	}
	if best < 0 {
		return 0, false
	}
	return s.v[best], true
}

// rate is the signal's rate of change around t, per s, from the samples either
// side of it; an angle in degrees.
func (s series) rate(t float64) (float64, bool) {
	i := sort.SearchFloat64s(s.t, t)
	if i < 1 || i >= len(s.t) || s.t[i]-s.t[i-1] > 2 {
		return 0, false
	}
	return common.HeadingDiffDeg(s.v[i], s.v[i-1]) / (s.t[i] - s.t[i-1]), true
}

// readExternal reads the external attitude unit's pitch and roll, deg, when
// the datalog has them.
func readExternal(path string) (pitch, roll series, err error) {
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return
	}
	defer db.Close()
	rows, err := db.Query(`SELECT ts.StratuxClock_value, b.SensorName, b.SensorValue
		FROM bridgefloat b JOIN timestamp ts ON ts.id = b.timestamp_id
		WHERE b.SensorName IN ('pitch_deg', 'roll_deg') ORDER BY b.timestamp_id`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			err = nil
		}
		return
	}
	defer rows.Close()
	for rows.Next() {
		var clock, name string
		var v float64
		if err = rows.Scan(&clock, &name, &v); err != nil {
			return
		}
		var t float64
		if t, err = parseClock(clock); err != nil {
			return
		}
		s := &roll
		if name == "pitch_deg" {
			s = &pitch
		}
		s.t, s.v = append(s.t, t), append(s.v, v)
	}
	err = rows.Err()
	return
}

// tiltDeg is the angle between the vertical as two attitudes (roll, pitch,
// deg) see it: an attitude error that holds through any attitude, where roll
// and pitch errors do not.
func tiltDeg(r1, p1, r2, p2 float64) float64 {
	up := func(r, p float64) [3]float64 {
		r, p = r*ahrs.Deg, p*ahrs.Deg
		return [3]float64{-math.Sin(p), math.Sin(r) * math.Cos(p), math.Cos(r) * math.Cos(p)}
	}
	a, b := up(r1, p1), up(r2, p2)
	return math.Acos(math.Max(-1, math.Min(1, a[0]*b[0]+a[1]*b[1]+a[2]*b[2]))) / ahrs.Deg
}

// errStat accumulates an angle error, deg.
type errStat struct {
	n          int
	sum, sumSq float64
}

func (e *errStat) add(d float64) {
	e.n++
	e.sum += d
	e.sumSq += d * d
}

func (e errStat) String() string {
	if e.n == 0 {
		return "         n/a        "
	}
	return fmt.Sprintf("mean %+5.1f rms %4.1f", e.sum/float64(e.n), math.Sqrt(e.sumSq/float64(e.n)))
}

// tracked is one sample the external unit saw: the tilt (deg) of the Kalman
// and the logged Simple attitude against it.
type tracked struct {
	t, kTilt, sTilt float64
	kValid          bool
}

// reportExternal prints the attitude against the external unit: by phase in
// cruise, then figure by figure.
func reportExternal(ext [2][3][2]errStat, track []tracked, extRoll, extPitch series, minGPS, maxSigma float64) {
	fmt.Printf("\nattitude vs the external unit above %.0f kt, |roll| <= 60, |pitch| <= 30, deg:\n", minGPS)
	for ph, name := range []string{"steady ", "rolling"} {
		for i, eng := range []string{"kalman           ", "simple (replayed)", "simple (logged)  "} {
			e := ext[ph][i]
			fmt.Printf("  %s %s  roll %s  pitch %s  (%d samples)\n", name, eng, e[0], e[1], e[0].n)
		}
	}

	// The figures: where the external unit rolled past 90 deg or pitched past
	// 45, joined when under 20 s apart.
	var figs [][2]float64
	for i, t := range extRoll.t {
		p, ok := extPitch.at(t, 0.6)
		if math.Abs(extRoll.v[i]) <= 90 && (!ok || math.Abs(p) <= 45) {
			continue
		}
		if n := len(figs); n > 0 && t-figs[n-1][1] < 20 {
			figs[n-1][1] = t
		} else {
			figs = append(figs, [2]float64{t, t})
		}
	}
	if len(figs) == 0 {
		return
	}
	// at is the tilt nearest t, within 1.5 s, or NaN.
	at := func(t float64, tilt func(x tracked) float64) float64 {
		i := sort.Search(len(track), func(i int) bool { return track[i].t >= t })
		for _, j := range []int{i, i - 1} {
			if j >= 0 && j < len(track) && math.Abs(track[j].t-t) <= 1.5 {
				return tilt(track[j])
			}
		}
		return math.NaN()
	}
	kTilt := func(x tracked) float64 { return x.kTilt }
	sTilt := func(x tracked) float64 { return x.sTilt }
	fmt.Printf("\naerobatic figures (the external unit past 90 deg of roll or 45 of pitch), tilt vs the unit, deg:\n")
	for _, fg := range figs {
		var kWorst, sWorst, validWrong float64
		for i, x := range track {
			if x.t < fg[0] || x.t > fg[1]+60 {
				continue
			}
			kWorst, sWorst = math.Max(kWorst, x.kTilt), math.Max(sWorst, x.sTilt)
			if x.kValid && x.kTilt > maxSigma && i+1 < len(track) {
				validWrong += math.Min(track[i+1].t-x.t, 1.5)
			}
		}
		e := fg[1]
		fmt.Printf("  %5.0f-%-5.0f s: kalman worst %5.1f, +5/+30/+60 s %5.1f %5.1f %5.1f, valid while more than %.0f off %4.1f s | simple (logged) worst %5.1f, +5/+30/+60 s %5.1f %5.1f %5.1f\n",
			fg[0], fg[1], kWorst, at(e+5, kTilt), at(e+30, kTilt), at(e+60, kTilt), maxSigma, validWrong,
			sWorst, at(e+5, sTilt), at(e+30, sTilt), at(e+60, sTilt))
	}
}

// settingsJSON is what the replay takes from the unit's settings.
type settingsJSON struct {
	SensorQuaternion, MagSensorQuaternion [4]float64
	C, D, AccelGain, AccelOffset          [3]float64
	MagField, MagDip                      float64
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
	sensorLog := flag.String("sensorlog", "", "the same flight's 20 Hz AHRSLog (sensors_*.csv, Simple engine), replayed instead of the datalog's 1 Hz rows")
	settingsS := flag.String("settings", "", "the unit's settings at the time (GET /getSettings or stratux.conf): calibrations, accel correction, local field")
	sensorqS := flag.String("sensorq", "0.0008540788764084712,0.14747589890389523,-0.005727889129517793,0.989048695022907", "SensorQuaternion w,x,y,z")
	magqS := flag.String("magq", "-0.6987591141922346,0.10023097892872197,-0.10833143741925846,0.6999669641225585", "MagSensorQuaternion w,x,y,z")
	cS := flag.String("c", "0.3081,-0.0117,1.0101", "accel calibration C")
	dS := flag.String("d", "-6.4,0.5565,-0.5565", "gyro calibration D")
	magMode := flag.String("mag", "pinned", "magnetometer use in the Kalman filter: none, free, pinned")
	field := flag.Float64("field", 0, "local field magnitude, uT (0: MagField from -settings, else the dipole at the flight's position)")
	dip := flag.Float64("dip", 0, "local field inclination, deg (positive down; 0: MagDip from -settings, else the dipole's)")
	decl := flag.Float64("decl", 3.5, "declination, deg east")
	accelSign := flag.Float64("accelsign", -1, "with -provider=false: sign applied to accel for the Kalman filter")
	magEnvS := flag.String("magenv", "", "override the logged mag calibration envelope: minX,maxX,minY,maxY,minZ,maxZ")
	magOffset := flag.Float64("magoffset", 0, "with -magenv: the compass Offset that goes with it, deg")
	magBiasSD := flag.Float64("magbias", 3, "Kalman prior sd of the mag bias L, uT (3 is the daemon's kalmanMagBiasSigma, 10 goflying's default)")
	maxSigma := flag.Float64("maxsigma", 10, "Kalman roll/pitch sigma above which the attitude is invalid, deg (10, as kalmanConfig)")
	gyroSigma := flag.Float64("gyrosigma", -1, "KalmanAHRS GyroSigma, deg/s (negative: goflying's default; 0: the filter as written)")
	magSigma := flag.Float64("magsigma", -1, "KalmanAHRS MagSigma, uT (negative: goflying's default; 0: none)")
	aoaSigma := flag.Float64("aoasigma", -1, "KalmanAHRS AngleOfAttackSigma, kt (negative: goflying's default; 0: the filter as written)")
	windSD := flag.Float64("wind", 0, "Kalman prior sd of the wind V, kt (0 keeps goflying's default)")
	windNoise := flag.Float64("windnoise", 0, "Kalman process noise of the wind V, kt per sqrt(s) (0 keeps goflying's default)")
	provider := flag.Bool("provider", true, "drive the Kalman filter through its AHRSProvider adapter exactly as the daemon does; false: the bare KalmanState, see the header")
	csvOut := flag.String("csv", "", "per-sample CSV dump")
	engine := flag.String("engine", "kalman", "the engine scored against Simple: kalman (KalmanAHRS) or ins (INSAHRS)")
	cfgS := flag.String("cfg", "", "Key=value,... handed to the engine's SetConfig after everything else")
	vsMode := flag.String("vs", "baro", "vertical speed for the AHRS: baro, what the daemon hands it (BaroVerticalSpeed, a 5 s average for the VSI); fast, the pressure altitude's rate over the last second")
	minGPS := flag.Float64("mingps", 40, "ground speed above which heading and attitude are scored, kt")
	flag.Parse()
	set := map[string]bool{}
	flag.Visit(func(f *flag.Flag) { set[f.Name] = true })

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
	var unit settingsJSON
	if *settingsS != "" {
		b, err := os.ReadFile(*settingsS)
		if err == nil {
			err = json.Unmarshal(b, &unit)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "-settings:", err)
			os.Exit(2)
		}
		if !set["sensorq"] {
			sensorQ = unit.SensorQuaternion
		}
		if !set["magq"] {
			magQ = unit.MagSensorQuaternion
		}
		if !set["c"] {
			C = unit.C
		}
		if !set["d"] {
			D = unit.D
		}
	}
	// q_mag = q_sensor (x) q_axis, so q_axis = conj(q_sensor) (x) q_mag takes
	// the magnetometer chip frame into the accelerometer chip frame, where the
	// AHRS sensor quaternion F applies to it like to the accel and gyro.
	axisQ := common.QuaternionUnit(common.QuaternionProduct(conj(sensorQ), magQ))

	rows, err := readLog(*flightlog)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if len(rows) == 0 {
		fmt.Fprintln(os.Stderr, *flightlog+": no mySituation rows")
		os.Exit(1)
	}
	// The local field as kalmanField finds it: the settings, else the
	// centred dipole at the GPS position (here the flight's mean).
	if !set["field"] && !set["dip"] {
		if unit.MagField > 0 && unit.MagDip != 0 {
			*field, *dip = unit.MagField, unit.MagDip
		} else {
			var lat, lon float64
			n := 0
			for _, r := range rows {
				if r.fix > 0 {
					lat, lon, n = lat+r.lat, lon+r.lon, n+1
				}
			}
			if n > 0 {
				*field, *dip = common.GeomagneticDipole(lat/float64(n), lon/float64(n))
			} else {
				*field, *dip = 46.5, 59
			}
		}
	}
	// The datalog's accelerometer is raw; the AHRS gets it corrected
	// (accelCorrect).  The AHRSLog's already is.
	gain := func(i int) float64 {
		if unit.AccelGain[i] == 0 {
			return 1
		}
		return unit.AccelGain[i]
	}
	for i := range rows {
		for k := 0; k < 3; k++ {
			rows[i].a[k] = (rows[i].a[k] - unit.AccelOffset[k]) / gain(k)
		}
	}
	if magEnv != nil {
		for i := range rows {
			rows[i].env = *magEnv
			rows[i].magOffset = *magOffset
		}
	}
	extPitch, extRoll, err := readExternal(*flightlog)
	if err != nil {
		fmt.Fprintln(os.Stderr, "external unit:", err)
		os.Exit(1)
	}
	src := *flightlog
	if *sensorLog != "" {
		if rows, err = readSensorLog(*sensorLog, rows); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		src = *sensorLog
	}
	switch *vsMode {
	case "baro":
	case "fast":
		fastVS(rows)
	default:
		fmt.Fprintln(os.Stderr, "-vs: baro or fast")
		os.Exit(2)
	}
	fmt.Printf("%s: %d rows, %.0f s; mag=%s field %.1f uT dip %.1f decl %+.1f; external unit %d samples\n",
		src, len(rows), rows[len(rows)-1].t-rows[0].t, *magMode, *field, *dip, *decl, len(extRoll.t))

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
			"kN1", "kN2", "kN3", "kD1", "kD2", "kD3", "kV1", "kV2", "kU1", "extRoll", "extPitch"})
	}

	// --- Simple AHRS, as the daemon runs it.
	simple := ahrs.NewSimpleAHRS()
	simple.SetCalibrations(&C, &D)
	simple.SetSensorQuaternion(&sensorQ)
	sm := ahrs.NewMeasurement()

	// --- Kalman AHRS.
	var kal *ahrs.KalmanState
	km := ahrs.NewMeasurement()
	var prov *ahrs.KalmanAHRS
	if *provider {
		cfg := map[string]float64{"MagBiasSigma": *magBiasSD, "WindSigma": *windSD, "WindNoise": *windNoise,
			"MaxAttitudeSigma": *maxSigma}
		if *magMode == "pinned" {
			cfg["MagField"], cfg["MagDip"] = *field, *dip
		}
		for k, v := range map[string]float64{"GyroSigma": *gyroSigma, "MagSigma": *magSigma, "AngleOfAttackSigma": *aoaSigma} {
			if v >= 0 {
				cfg[k] = v
			}
		}
		// The daemon's C (accelerometer at level) and D, as SetCalibrations takes them.
		prov = ahrs.NewKalmanAHRS()
		prov.SetCalibrations(&C, &D)
		prov.SetSensorQuaternion(&sensorQ)
		prov.SetConfig(cfg)
	}
	extraCfg := map[string]float64{}
	if *cfgS != "" {
		for _, kv := range strings.Split(*cfgS, ",") {
			k, v, ok := strings.Cut(kv, "=")
			x, err := strconv.ParseFloat(v, 64)
			if !ok || err != nil {
				fmt.Fprintln(os.Stderr, "-cfg: want Key=value,...:", kv)
				os.Exit(2)
			}
			extraCfg[strings.TrimSpace(k)] = x
		}
	}
	var ins *ahrs.INSAHRS
	switch *engine {
	case "kalman":
		if prov != nil {
			prov.SetConfig(extraCfg)
		}
	case "ins":
		ins = ahrs.NewINSAHRS()
		ins.SetCalibrations(&C, &D)
		ins.SetSensorQuaternion(&sensorQ)
		ins.SetConfig(map[string]float64{"MaxAttitudeSigma": *maxSigma})
		ins.SetConfig(extraCfg)
	default:
		fmt.Fprintln(os.Stderr, "-engine: kalman or ins")
		os.Exit(2)
	}

	var (
		kScore, sScore, cScore, logGyroScore, logMagScore, kVsCompass score
		kValidN, sValidN                                              int
		kRollDiff, kPitchDiff                                         float64 // vs simple, when both valid
		kCmpN                                                         int
		kdHdgSum                                                      float64
		kUpdates                                                      int
		sLogRollDiff, sLogPitchDiff                                   float64 // simple replayed vs as logged
		sLogN                                                         int
		// Against the external unit, in cruise: [steady, rolling][kalman,
		// simple replayed, simple as logged][roll, pitch].
		ext [2][3][2]errStat
		// Every sample the external unit saw: the tilt errors, for the figures.
		track []tracked
	)

	fill := func(m *ahrs.Measurement, r row, forKalman bool) {
		m.T = r.t
		m.SValid = true
		m.B1, m.B2, m.B3 = r.g[0], r.g[1], r.g[2]
		m.A1, m.A2, m.A3 = r.a[0], r.a[1], r.a[2]
		if forKalman {
			m.A1, m.A2, m.A3 = *accelSign*r.a[0], *accelSign*r.a[1], *accelSign*r.a[2]
		}
		m.WValid = r.wValid
		if m.WValid {
			m.TW = r.tw
			m.W1 = r.gs * math.Sin(r.trk*ahrs.Deg)
			m.W2 = r.gs * math.Cos(r.trk*ahrs.Deg)
			m.W3 = r.w3
		}
		// Magnetometer: the daemon hands the Simple AHRS the raw chip-frame
		// sample.  The Kalman filter wants a calibrated field, in the accel
		// chip frame, in uT.
		m.MValid = *magMode != "none"
		if forKalman {
			// As kalmanMagnetometer: no magnetometer while a calibration is
			// running or before the envelope spans every axis (an -magenv
			// override is the calibration in force throughout).
			if magEnv == nil && (r.magCal || r.env[1] <= r.env[0] || r.env[3] <= r.env[2] || r.env[5] <= r.env[4]) {
				m.MValid = false
			}
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
		var kRoll, kPitch, kHdg, kdRoll, kdPitch, kdHdg float64
		var kValid bool
		var kExtra [9]float64 // the CSV's kN, kD, kV and kU1 columns
		// The engines apply the drivers' accel sign and scale themselves.
		if ins != nil {
			km.A1, km.A2, km.A3 = r.a[0], r.a[1], r.a[2]
			km.MValid = false
			ins.Compute(km)
			kRoll, kPitch, kHdg = ins.RollPitchHeading()
			if kHdg == ahrs.Invalid {
				kHdg = math.NaN()
			}
			kRoll, kPitch, kHdg = kRoll/ahrs.Deg, kPitch/ahrs.Deg, kHdg/ahrs.Deg
			kdRoll, kdPitch, kdHdg = ins.CalcRollPitchHeadingUncertainty()
			kValid = ins.Valid()
			st := ins.GetState()
			kExtra[3], kExtra[4], kExtra[5] = st.D1, st.D2, st.D3
		} else {
			if prov != nil {
				km.A1, km.A2, km.A3 = r.a[0], r.a[1], r.a[2]
				prov.Compute(km)
				kal = &prov.KalmanState
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
			} else {
				kal.Compute(km)
			}
			kRoll, kPitch, kHdg = kal.CalcRollPitchHeading()
			kdRoll, kdPitch, kdHdg = kal.CalcRollPitchHeadingUncertainty()
			kValid = kal.Valid()
			if prov != nil {
				kValid = prov.Valid()
			}
			kExtra = [9]float64{kal.N1, kal.N2, kal.N3, kal.D1, kal.D2, kal.D3, kal.V1, kal.V2, kal.U1}
		}
		kUpdates++
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
		if sValid {
			sLogN++
			sLogRollDiff += math.Abs(common.HeadingDiffDeg(sRoll, r.roll))
			sLogPitchDiff += math.Abs(sPitch - r.pitch)
		}
		eRoll, okR := extRoll.at(r.t, 0.6)
		ePitch, okP := extPitch.at(r.t, 0.6)
		if !okR || !okP {
			eRoll, ePitch = math.NaN(), math.NaN()
		} else {
			track = append(track, tracked{r.t, tiltDeg(kRoll, kPitch, eRoll, ePitch), tiltDeg(r.roll, r.pitch, eRoll, ePitch), kValid})
			if rate, ok := extRoll.rate(r.t); ok && r.gs > *minGPS && kValid && sValid &&
				math.Abs(eRoll) <= 60 && math.Abs(ePitch) <= 30 && math.Abs(r.pitch) <= 90 {
				ph := 0
				if math.Abs(rate) >= 3 {
					ph = 1
				}
				for i, a := range [][2]float64{{kRoll, kPitch}, {sRoll, sPitch}, {r.roll, r.pitch}} {
					ext[ph][i][0].add(common.HeadingDiffDeg(a[0], eRoll))
					ext[ph][i][1].add(a[1] - ePitch)
				}
			}
		}
		if r.gs > *minGPS && r.fix > 0 {
			// Heading means nothing with the nose near the vertical, where the
			// Kalman attitude stays valid.
			if kValid && math.Abs(kPitch) <= 60 {
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
				f(kExtra[0]), f(kExtra[1]), f(kExtra[2]), f(kExtra[3]), f(kExtra[4]), f(kExtra[5]), f(kExtra[6]), f(kExtra[7]), f(kExtra[8]), f(eRoll), f(ePitch)})
		}
	}

	fmt.Printf("\nvalid: kalman %d/%d, simple %d/%d\n", kValidN, kUpdates, sValidN, len(rows))
	if kCmpN > 0 {
		fmt.Printf("kalman vs simple attitude (both valid, %d s): mean |droll| %.1f  |dpitch| %.1f deg\n", kCmpN, kRollDiff/float64(kCmpN), kPitchDiff/float64(kCmpN))
	}
	if sLogN > 0 {
		fmt.Printf("simple replayed vs as logged (%d samples): mean |droll| %.1f  |dpitch| %.1f deg\n", sLogN, sLogRollDiff/float64(sLogN), sLogPitchDiff/float64(sLogN))
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
	if len(extRoll.t) > 0 {
		reportExternal(ext, track, extRoll, extPitch, *minGPS, *maxSigma)
	}
}
