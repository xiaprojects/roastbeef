/*
	slavenmeadisplay_test.go: requirements-style unit tests for the Slave NMEA
	Display plugin (slavenmeadisplay.go): the $RBATT and $RBAIR sentences, the
	loop that sends them, and its setting.

	The expected sentences are golden: written out with their checksums, computed
	apart from appendNmeaChecksum, in the layout rb-esp main/RB/RB09_Slave.c parses.
*/

package main

import (
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xiaprojects/goflying/ahrs"
)

// slaveNMEADisplayState sets up a fresh daemon state with the mutexes and the
// addons bridge the two sentences read.
func slaveNMEADisplayState(t *testing.T) {
	t.Helper()
	withTrafficState(t)
	mu, data := addonsBridge.bridgeDataMutex, addonsBridge.bridgeFloatData
	t.Cleanup(func() { addonsBridge.bridgeDataMutex, addonsBridge.bridgeFloatData = mu, data })
	addonsBridge.bridgeDataMutex = &sync.Mutex{}
	mySituation.muAttitude, mySituation.muBaro = &sync.Mutex{}, &sync.Mutex{}
}

// slaveNMEADisplayAttitude gives ownship a current IMU attitude: roll -12.34,
// pitch 5.67, heading 271.5, slip 1.2 (ball left) and 1.234 g.
func slaveNMEADisplayAttitude() {
	attitudeAt(-12.34, 5.67, 271.5)
	globalSettings.IMU_Sensor_Enabled, globalStatus.IMUConnected = true, true
}

// slaveNMEADisplayAir gives ownship current air data: 3000 ft pressure altitude
// from the board's baro, +500 ft/min, 100 kt, QNH 1013.25 hPa.
func slaveNMEADisplayAir() {
	ownshipAt(43, 12, 3000)
	mySituation.BaroSourceType = BARO_TYPE_BMP280
	mySituation.BaroVerticalSpeed = 500
	mySituation.IndicatedAirSpeed = 100
	addonsBridge.bridgeFloatData = map[string]float32{"qnh": 1013.25, "autoqnh": 0}
}

// checkSentence compares what make returned with the golden want, "" for nothing.
func checkSentence(t *testing.T, what, want string, make func() (string, bool)) {
	t.Helper()
	got, ok := make()
	switch {
	case want == "" && ok:
		t.Errorf("%s: %q; want nothing", what, got)
	case want != "" && (!ok || got != want+"\r\n"):
		t.Errorf("%s: %q, %v; want %q", what, got, ok, want+"\r\n")
	}
}

// $RBATT carries roll, pitch, minus the gyro heading, and the load factor at the
// ball angle. The display shows INOP when it stops, so there is none while the
// attitude is more than 1 s old, without a GPS fix or without the IMU, or while
// roll, pitch, slip or load factor is Invalid: those fields have no unavailable
// encoding. The heading has one, the sentinel itself, which goes out as it is
// (the Simple AHRS below taxi speed).
// Covers: RB-HLR-ATT-200, RB-HLR-ATT-210, RB-HLR-ATT-220, RB-HLR-ATT-230
func TestSlaveNMEADisplayAttitude(t *testing.T) {
	slaveNMEADisplayState(t)
	check := func(what, want string) {
		t.Helper()
		checkSentence(t, what, want, slaveNMEADisplay.makeRBATTString)
	}

	slaveNMEADisplayAttitude()
	check("current attitude", "$RBATT,-12.34,5.67,-271.50,1.234,0.026,0.000,0.00,0.00,0.00,,,,,,,,*62")

	slaveNMEADisplayAttitude()
	mySituation.AHRSSlipSkid = -1.2
	check("ball right", "$RBATT,-12.34,5.67,-271.50,1.234,-0.026,0.000,0.00,0.00,0.00,,,,,,,,*4F")

	slaveNMEADisplayAttitude()
	mySituation.AHRSSlipSkid, mySituation.AHRSGLoad = 30, 12
	check("ball and load factor past full scale", "$RBATT,-12.34,5.67,-271.50,9.388,3.417,0.000,0.00,0.00,0.00,,,,,,,,*69")

	slaveNMEADisplayAttitude()
	mySituation.AHRSGyroHeading = ahrs.Invalid
	check("heading Invalid", "$RBATT,-12.34,5.67,3276.70,1.234,0.026,0.000,0.00,0.00,0.00,,,,,,,,*79")

	for _, f := range []struct {
		name  string
		field *float64
	}{{"roll", &mySituation.AHRSRoll}, {"pitch", &mySituation.AHRSPitch},
		{"slip", &mySituation.AHRSSlipSkid}, {"load factor", &mySituation.AHRSGLoad}} {
		slaveNMEADisplayAttitude()
		*f.field = ahrs.Invalid
		check(f.name+" Invalid", "")
	}

	slaveNMEADisplayAttitude()
	mySituation.AHRSLastAttitudeTime = stratuxClock.Time.Add(-1001 * time.Millisecond)
	check("attitude 1 s old", "")

	slaveNMEADisplayAttitude()
	globalStatus.GPS_connected = false
	check("no GPS", "")

	slaveNMEADisplayAttitude()
	globalStatus.IMUConnected = false
	check("IMU disconnected", "")

	slaveNMEADisplayAttitude()
	globalSettings.IMU_Sensor_Enabled = false
	check("IMU disabled: the attitude is GPS-derived", "")
}

// $RBAIR carries the static pressure behind the pressure altitude and the QNH the
// HMI posted to the bridge, both in inHg, the baro vertical speed and the
// indicated airspeed in km/h; the temperature and the wind stay empty, and so
// does the airspeed without a source. There is none without a pressure altitude
// of our own (stale, none, or estimated from ADS-B traffic, as for $PGRMZ) or
// without a QNH RB-09 accepts, 850 to 1100 hPa.
func TestSlaveNMEADisplayAirData(t *testing.T) {
	slaveNMEADisplayState(t)
	check := func(what, want string) {
		t.Helper()
		checkSentence(t, what, want, slaveNMEADisplay.makeRBAIRString)
	}

	slaveNMEADisplayAir()
	check("current air data", "$RBAIR,26.8154,29.92124,,500,185.2,,*48")

	slaveNMEADisplayAir()
	mySituation.IndicatedAirSpeed = 0
	check("no airspeed source", "$RBAIR,26.8154,29.92124,,500,,,*68")

	slaveNMEADisplayAir()
	addonsBridge.bridgeFloatData["qnh"] = 1015
	check("QNH set in hPa", "$RBAIR,26.8154,29.97292,,500,185.2,,*43")

	for _, source := range []uint8{BARO_TYPE_OGNTRACKER, BARO_TYPE_NMEA} {
		slaveNMEADisplayAir()
		mySituation.BaroSourceType = source
		check("external baro", "$RBAIR,26.8154,29.92124,,500,185.2,,*48")
	}

	slaveNMEADisplayAir()
	delete(addonsBridge.bridgeFloatData, "qnh")
	check("no QNH", "")
	for _, qnh := range []float32{0, 849.9, 1100.1} {
		slaveNMEADisplayAir()
		addonsBridge.bridgeFloatData["qnh"] = qnh
		check("QNH out of range", "")
	}

	for _, source := range []uint8{BARO_TYPE_NONE, BARO_TYPE_ADSBESTIMATE} {
		slaveNMEADisplayAir()
		mySituation.BaroSourceType = source
		check("no baro of our own", "")
	}

	slaveNMEADisplayAir()
	mySituation.BaroLastMeasurementTime = stratuxClock.Time.Add(-15 * time.Second)
	check("baro 15 s old", "")
}

// The plugin's loop sends $RBATT and $RBAIR together, then sleeps
// SlaveNMEADisplay_SleepMs, so the two go out at the same rate; at 0 it sends
// neither, and ShutdownFunc stops it.
//
// The loop paces itself on real sleeps, so it runs in a child process (inChild),
// about 3 s. The clock is frozen, so the data stays current throughout.
func TestSlaveNMEADisplayLoop(t *testing.T) {
	if !inChild(t) {
		return
	}
	slaveNMEADisplayState(t)
	sent := captureFlarmOutput(t)
	slaveNMEADisplayAttitude()
	slaveNMEADisplayAir()
	count := func() (rbatt, rbair, other int) {
		for _, s := range sent() {
			switch {
			case strings.HasPrefix(s, "$RBATT,"):
				rbatt++
			case strings.HasPrefix(s, "$RBAIR,"):
				rbair++
			default:
				other++
			}
		}
		return
	}

	globalSettings.SlaveNMEADisplay_SleepMs = 50
	done := make(chan struct{})
	slaveNMEADisplay.enabled = true
	go func() {
		slaveNMEADisplay.ListenerFunc()
		close(done)
	}()
	time.Sleep(time.Second)
	// Off: the last 50 ms sleep ends, then the loop waits a second at a time
	globalSettings.SlaveNMEADisplay_SleepMs = 0
	time.Sleep(200 * time.Millisecond)
	if rbatt, rbair, other := count(); rbatt != rbair || rbatt < 12 || rbatt > 21 || other != 0 {
		t.Errorf("in 1 s at 50 ms: %d $RBATT, %d $RBAIR, %d other; want the same number of each, about 20", rbatt, rbair, other)
	}

	time.Sleep(1500 * time.Millisecond)
	if rbatt, rbair, other := count(); rbatt+rbair+other != 0 {
		t.Errorf("at 0: sent %d $RBATT, %d $RBAIR, %d other; want nothing", rbatt, rbair, other)
	}

	slaveNMEADisplay.ShutdownFunc()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("the loop still runs 3 s after ShutdownFunc")
	}
}

// SlaveNMEADisplay_SleepMs defaults to 1000 ms, 1 Hz, also for a stratux.conf
// written before the setting existed; a stored value, 0 included, is kept.
func TestSlaveNMEADisplaySetting(t *testing.T) {
	if !inChild(t) {
		return
	}
	for _, c := range []struct {
		conf string
		want int
	}{
		{`{"RadarRange": 5}`, 1000},
		{`{"SlaveNMEADisplay_SleepMs": 0}`, 0},
		{`{"SlaveNMEADisplay_SleepMs": 100}`, 100},
	} {
		if err := os.WriteFile(configLocation, []byte(c.conf), 0644); err != nil {
			t.Fatal(err)
		}
		readSettings()
		if got := globalSettings.SlaveNMEADisplay_SleepMs; got != c.want {
			t.Errorf("stratux.conf %s: SlaveNMEADisplay_SleepMs %d; want %d", c.conf, got, c.want)
		}
	}
}
