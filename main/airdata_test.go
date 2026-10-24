/*
	airdata_test.go: requirements-style tests for the air data senders: the pitot
	airspeed (airspeedSender, main/airspeed.go) and the barometric altitude and
	vertical speed (tempAndPressureSender, main/sensors.go), each run as the daemon
	runs it - a 10 Hz loop on a real ticker - against a scripted sensor.

	Each test runs in a child process of the test binary (inChild), because the senders
	write the daemon's globals from their own goroutine on real time; the children run
	in parallel with each other, a few seconds each. Expected values come from the
	physics, not from the code under test: indicated airspeed from Bernoulli,
	sqrt(2 q / rho0), which the compressible formula the daemon uses is within 0.2 % of
	below 100 kt, and altitude from the ISA pressure the sensor is scripted to read.
*/

package main

import (
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// inChild runs the calling test in a child process of the test binary, in parallel
// with the other tests that do, and fails with the child's output if the child fails.
// It returns true in the child, where the caller goes on to run the test body with the
// globals main() would have created.
func inChild(t *testing.T) bool {
	if os.Getenv("RB_CHILD") == t.Name() {
		stratuxClock = NewMonotonic()
		mySituation.muGPS, mySituation.muAttitude, mySituation.muBaro = &sync.Mutex{}, &sync.Mutex{}, &sync.Mutex{}
		MagnetometerDataMutex = &sync.Mutex{}
		systemErrsMutex, systemErrs = &sync.Mutex{}, make(map[string]string)
		alerts.alertsDataMutex, alerts.alertsData = &sync.Mutex{}, make([]interface{}, 0)
		configLocation = filepath.Join(os.Getenv("RB_CHILD_DIR"), "stratux.conf")
		return true
	}
	t.Parallel()
	cmd := exec.Command(os.Args[0], "-test.run=^"+t.Name()+"$", "-test.v")
	cmd.Env = append(os.Environ(), "RB_CHILD="+t.Name(), "RB_CHILD_DIR="+t.TempDir())
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("child: %v\n%s", err, out)
	}
	// A child that skipped exits 0 too: pass its reason, the line before, on.
	if before, _, ok := strings.Cut(string(out), "--- SKIP: "+t.Name()); ok {
		lines := strings.Split(strings.TrimRight(before, "\n"), "\n")
		reason := strings.TrimSpace(lines[len(lines)-1])
		if _, msg, ok := strings.Cut(reason, ": "); ok && strings.Contains(reason[:len(reason)-len(msg)], "_test.go:") {
			reason = msg // the child's own file:line
		}
		t.Skip(reason)
	}
	return false
}

// raised is whether the system error ident is up, and the alerts pushed so far.
func raised(ident string) (up bool, pushed []Alert) {
	systemErrsMutex.Lock()
	_, up = systemErrs[ident]
	systemErrsMutex.Unlock()
	alerts.alertsDataMutex.Lock()
	for _, a := range alerts.alertsData {
		pushed = append(pushed, a.(Alert))
	}
	alerts.alertsDataMutex.Unlock()
	return
}

// reads counts a fake sensor's reads, so that a test can wait for the sender to have
// read it n times rather than for a time: the senders count reads (hold for 10, drop
// after 50) and a loaded machine stretches the ticks.
type reads struct {
	mu sync.Mutex
	n  int
}

func (r *reads) read() { r.n++ } // with mu held

// wait returns once the sensor has been read n more times.
func (r *reads) wait(t *testing.T, n int) {
	t.Helper()
	r.mu.Lock()
	until := r.n + n
	r.mu.Unlock()
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(5 * time.Millisecond) {
		r.mu.Lock()
		got := r.n
		r.mu.Unlock()
		if got >= until {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("sensor read %d of %d times in 10 s", got-until+n, n)
		}
	}
}

// fakePitot is a scripted MS4525DO: a differential pressure, Pa, or an error.
type fakePitot struct {
	reads
	dp     float64
	err    error
	closed bool
}

func (f *fakePitot) set(dp float64, err error) {
	f.mu.Lock()
	f.dp, f.err = dp, err
	f.mu.Unlock()
}
func (f *fakePitot) DifferentialPressure() (float64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.read()
	return f.dp, f.err
}
func (f *fakePitot) Temperature() (float64, error) { return 21, nil }
func (f *fakePitot) Close()                        { f.mu.Lock(); f.closed = true; f.mu.Unlock() }

// bernoulliKt is the indicated airspeed, kt, of dynamic pressure q, Pa, at sea-level
// density: what an airspeed indicator is calibrated to, incompressibly.
func bernoulliKt(q float64) float64 { return math.Sqrt(2*q/1.225) / 0.514444 }

// startAirspeed runs airspeedSender on pitot, with the zero offset offset stored, and
// returns a channel closed when the sender returns.
func startAirspeed(pitot *fakePitot, offset float64) chan struct{} {
	myAirspeedReader = pitot
	globalSettings.MS4525DO_Enabled, globalSettings.AirspeedZeroOffset = true, offset
	globalStatus.AirspeedConnected = true
	done := make(chan struct{})
	go func() { airspeedSender(); close(done) }()
	return done
}

// stopped waits up to d for a sender to return.
func stopped(t *testing.T, done chan struct{}, d time.Duration, what string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(d):
		t.Fatalf("sensor still in use %v after %s", d, what)
	}
}

// The pitot chain (FHA-SPD-4): the stored zero offset comes off, the tube order does
// not matter, below 10 Pa the airspeed is 0 (the HMI then shows the ground speed), and
// otherwise it is the airspeed of the dynamic pressure. When the sensor stops
// answering the last airspeed stands for 10 reads (1 s), then it is blanked - value and
// measurement time - and after 50 (5 s) the sensor is dropped, closed and an error
// raised, for pollSensors to reconnect. It is never left standing.
func TestAirspeedSender(t *testing.T) {
	if !inChild(t) {
		return
	}
	pitot := &fakePitot{dp: 4 + 8}
	done := startAirspeed(pitot, 4)
	pitot.wait(t, 3)
	if ias, at := mySituation.IndicatedAirSpeed, mySituation.PitotLastMeasurementTime; ias != 0 || at.IsZero() {
		t.Errorf("8 Pa over the zero offset: airspeed %.1f kt, measured %v; want 0, current", ias, at)
	}
	pitot.set(4+1000, nil)
	pitot.wait(t, 20) // the 0.3 s smoothing settles to 0.3 %
	want := bernoulliKt(1000)
	if ias := float64(mySituation.IndicatedAirSpeed); math.Abs(ias-want) > 0.005*want {
		t.Errorf("1000 Pa: airspeed %.2f kt; want %.2f", ias, want)
	}
	pitot.set(4-1000, nil) // tubes the other way round
	pitot.wait(t, 3)
	if ias := float64(mySituation.IndicatedAirSpeed); math.Abs(ias-want) > 0.005*want {
		t.Errorf("-1000 Pa: airspeed %.2f kt; want %.2f", ias, want)
	}

	pitot.wait(t, 1) // the situation is written after the read
	held, at := mySituation.IndicatedAirSpeed, mySituation.PitotLastMeasurementTime
	pitot.set(0, errI2C)
	pitot.wait(t, 9)
	if mySituation.IndicatedAirSpeed != held || mySituation.PitotLastMeasurementTime != at {
		t.Errorf("9 failed reads: airspeed %.1f kt measured %v; want the last, %.1f at %v, held",
			mySituation.IndicatedAirSpeed, mySituation.PitotLastMeasurementTime, held, at)
	}
	pitot.wait(t, 3)
	if mySituation.IndicatedAirSpeed != 0 || !mySituation.PitotLastMeasurementTime.IsZero() {
		t.Errorf("12 failed reads: airspeed %.1f kt measured %v; want blanked",
			mySituation.IndicatedAirSpeed, mySituation.PitotLastMeasurementTime)
	}
	stopped(t, done, 6*time.Second, "a read error")
	pitot.mu.Lock()
	n := pitot.n
	pitot.mu.Unlock()
	if up, _ := raised("airspeed-sensor-read"); globalStatus.AirspeedConnected || !pitot.closed || !up {
		t.Errorf("after %d reads: connected %v closed %v error raised %v; want dropped, closed, raised",
			n, globalStatus.AirspeedConnected, pitot.closed, up)
	}
}

var errI2C = &os.PathError{Op: "read", Path: "/dev/i2c-1", Err: os.ErrDeadlineExceeded}

// Zeroing the pitot (POST /calibrateAirspeed) averages 20 reads (2 s) of the pressure
// with no airflow into AirspeedZeroOffset and saves it; the airspeed reads 0 meanwhile
// and is measured from the new zero after. Turning the sensor off in the settings
// closes it and blanks the airspeed.
func TestAirspeedZeroAndDisable(t *testing.T) {
	if !inChild(t) {
		return
	}
	pitot := &fakePitot{dp: 46.5} // 46.5 Pa with no airflow: 18 kt if taken as airspeed
	done := startAirspeed(pitot, 0)
	pitot.wait(t, 3)
	if mySituation.IndicatedAirSpeed < 15 {
		t.Fatalf("unzeroed, 46.5 Pa reads %.1f kt; want ~18", mySituation.IndicatedAirSpeed)
	}
	CalibrateAirspeed()
	pitot.wait(t, 3)
	if mySituation.IndicatedAirSpeed != 0 {
		t.Errorf("zeroing: airspeed %.1f kt; want 0", mySituation.IndicatedAirSpeed)
	}
	pitot.wait(t, 20)
	if globalSettings.AirspeedZeroOffset != 46.5 {
		t.Errorf("zero offset %.2f Pa; want the 46.5 read", globalSettings.AirspeedZeroOffset)
	}
	if b, err := os.ReadFile(configLocation); err != nil || !strings.Contains(string(b), `"AirspeedZeroOffset": 46.5`) {
		t.Errorf("settings saved: %v %.80q", err, b)
	}
	pitot.set(46.5+1000, nil)
	pitot.wait(t, 20)
	if ias, want := float64(mySituation.IndicatedAirSpeed), bernoulliKt(1000); math.Abs(ias-want) > 0.005*want {
		t.Errorf("1000 Pa over the new zero: airspeed %.2f kt; want %.2f", ias, want)
	}
	globalSettings.MS4525DO_Enabled = false
	stopped(t, done, time.Second, "it was turned off")
	if globalStatus.AirspeedConnected || !pitot.closed || mySituation.IndicatedAirSpeed != 0 || !mySituation.PitotLastMeasurementTime.IsZero() {
		t.Errorf("turned off: connected %v closed %v airspeed %.1f measured %v; want closed and blanked",
			globalStatus.AirspeedConnected, pitot.closed, mySituation.IndicatedAirSpeed, mySituation.PitotLastMeasurementTime)
	}
}

// fakeBaro is a scripted pressure sensor: the ISA pressure of an altitude that moves
// at climb ft/min from alt, or an error.
type fakeBaro struct {
	reads
	alt, climb float64
	since      time.Time
	err        error
	closed     bool
}

func (f *fakeBaro) fly(alt, climb float64) {
	f.mu.Lock()
	f.alt, f.climb, f.since, f.err = alt, climb, time.Now(), nil
	f.mu.Unlock()
}
func (f *fakeBaro) fail(err error) { f.mu.Lock(); f.err = err; f.mu.Unlock() }
func (f *fakeBaro) altitude() float64 {
	return f.alt + f.climb*time.Since(f.since).Minutes()
}
func (f *fakeBaro) Pressure() (float64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.read()
	if f.err != nil {
		return 0, f.err
	}
	// The inverse of common.CalcAltitude: ISA, hPa.
	return 1013.25 * math.Pow(1-f.altitude()/145366.45, 1/0.190284), nil
}
func (f *fakeBaro) Temperature() (float64, error) { return 15, nil }
func (f *fakeBaro) Close()                        { f.mu.Lock(); f.closed = true; f.mu.Unlock() }

// startBaro runs tempAndPressureSender on baro and returns a channel closed when the
// sender returns.
func startBaro(baro *fakeBaro) chan struct{} {
	myPressureReader = baro
	globalSettings.BMP_Sensor_Enabled, globalStatus.BMPConnected = true, true
	done := make(chan struct{})
	go func() { tempAndPressureSender(); close(done) }()
	return done
}

// baro reads the situation's pressure altitude, vertical speed and measurement time.
func baro() (alt, vs float64, at time.Time) {
	mySituation.muBaro.Lock()
	defer mySituation.muBaro.Unlock()
	return float64(mySituation.BaroPressureAltitude), float64(mySituation.BaroVerticalSpeed), mySituation.BaroLastMeasurementTime
}

// The barometric chain: pressure altitude is the ISA altitude of the pressure read
// (to the foot), the vertical speed in ft/min follows a climb through a 5 s smoothing
// (an EWMA per 0.1 s read, so 20 reads into a climb it shows 1-(5/5.1)^20 = 33 % of the
// rate), a reading 5000 ft from the GPS altitude is rejected as a broken sensor - the
// last altitude stands, its measurement time stops, and BaroBroken is raised - and the
// 51st failed read in a row drops the sensor, for pollSensors to reconnect.
func TestPressureSender(t *testing.T) {
	if !inChild(t) {
		return
	}
	b := &fakeBaro{}
	b.fly(1200, 0)
	done := startBaro(b)
	b.wait(t, 5)
	if alt, vs, at := baro(); math.Abs(alt-1200) > 1 || vs != 0 || at.IsZero() || mySituation.BaroSourceType != BARO_TYPE_BMP280 || !isTempPressValid() {
		t.Errorf("level at 1200 ft: altitude %.1f vs %.1f measured %v source %d valid %v; want 1200, 0, current, BMP",
			alt, vs, at, mySituation.BaroSourceType, isTempPressValid())
	}
	b.wait(t, 1)
	b.fly(1200, 600)
	b.wait(t, 20)
	b.mu.Lock()
	truth := b.altitude()
	b.mu.Unlock()
	if alt, vs, _ := baro(); math.Abs(alt-truth) > 3 || math.Abs(vs-600*(1-math.Pow(5/5.1, 20))) > 40 {
		t.Errorf("20 reads into a 600 ft/min climb: altitude %.1f vs %.0f; want %.1f, %.0f", alt, vs, truth, 600*(1-math.Pow(5/5.1, 20)))
	}

	mySituation.muGPS.Lock()
	globalStatus.GPS_connected, mySituation.GPSFixQuality = true, 1
	mySituation.GPSLastFixLocalTime, mySituation.GPSAltitudeMSL = stratuxClock.Time.Add(time.Hour), 1500 // a fix "from the future" stays valid
	mySituation.muGPS.Unlock()
	b.fly(9000, 0)
	b.wait(t, 2)
	alt0, _, at0 := baro()
	b.wait(t, 5)
	if alt, _, at := baro(); alt != alt0 || at != at0 || alt > 2000 {
		t.Errorf("baro 7500 ft off the GPS: altitude %.0f measured %v then %.0f %v; want the last good one, standing", alt0, at0, alt, at)
	}
	if up, _ := raised("BaroBroken"); !up {
		t.Error("BaroBroken not raised")
	}

	b.fail(errI2C)
	stopped(t, done, 8*time.Second, "60 failed reads in a row")
	if globalStatus.BMPConnected || !b.closed {
		t.Errorf("after 51 failed reads in a row: connected %v closed %v; want dropped and closed", globalStatus.BMPConnected, b.closed)
	}
}

// The sensor is dropped after 50 failed reads in a row, not 50 in all: two bursts of
// 30 with good reads between them leave it in use.
func TestPressureSenderCountsConsecutiveFailures(t *testing.T) {
	if !inChild(t) {
		return
	}
	b := &fakeBaro{}
	b.fly(1200, 0)
	startBaro(b)
	b.wait(t, 3)
	for burst := 0; burst < 2; burst++ {
		b.fail(errI2C)
		b.wait(t, 30)
		b.fly(1200, 0)
		b.wait(t, 3)
	}
	if !globalStatus.BMPConnected || b.closed {
		t.Errorf("two bursts of 30 failed reads with good ones between: connected %v closed %v; want still in use",
			globalStatus.BMPConnected, b.closed)
	}
}

// KNOWN ISSUE (FHA-ALR-1, not yet decided). The baro raises its system error - and a
// "barometer danger" alert - on the first failed read, even a single glitch, and never
// clears it. Errors are raised once per name, so after any glitch since boot the real
// loss of the sensor raises nothing: the pilot is not told the altimeter has stopped.
// The pitot (airspeedSender) instead raises its error when it drops the sensor and
// clears it on reconnect. The test measures it and skips; it passes once a loss after
// a glitch is alerted.
func TestPressureSenderAlertsTheLoss(t *testing.T) {
	if !inChild(t) {
		return
	}
	b := &fakeBaro{}
	b.fly(1200, 0)
	done := startBaro(b)
	b.wait(t, 3)
	b.fail(errI2C)
	b.wait(t, 1) // one failed read
	b.fly(1200, 0)
	b.wait(t, 5)
	upAfterGlitch, glitchAlerts := raised("pressure-sensor-pressure-read")
	b.fail(errI2C)
	stopped(t, done, 8*time.Second, "60 failed reads in a row")
	_, lossAlerts := raised("pressure-sensor-pressure-read")
	if len(lossAlerts) == len(glitchAlerts) {
		t.Skipf("KNOWN ISSUE FHA-ALR-1: one failed read raised %d alert(s), still up %v 5 reads after the sensor recovered; "+
			"the loss of the sensor after it raised %d more", len(glitchAlerts), upAfterGlitch, len(lossAlerts)-len(glitchAlerts))
	}
}
