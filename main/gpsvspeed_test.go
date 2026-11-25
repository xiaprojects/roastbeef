/*
	gpsvspeed_test.go: the GPS vertical speed (gpsvspeed.go), the slope of the GGA
	altitude over the last 2 s of fix time, in feet per second. Until 2026-11-20 the
	field was never assigned and read 0 in every flight log.
*/

package main

import (
	"fmt"
	"math"
	"math/rand"
	"testing"
	"time"
)

// A steady 1000 fpm climb at 10 Hz with the u-blox's decimetre altitude jitter reads
// 1000 fpm within 100 fpm once 2 s are in, and 0 before half a second is.
// Covers: RB-HLR-SIT-120
func TestGPSVSpeedSteadyClimbAt10Hz(t *testing.T) {
	var e gpsVSpeedEstimator
	rnd := rand.New(rand.NewSource(1))
	const fps = 1000.0 / 60
	for i := 0; i <= 50; i++ {
		tod := 36000 + float64(i)*0.1
		v := e.add(tod, 2000+fps*float64(i)*0.1+rnd.NormFloat64()*0.3/0.3048)
		if i < 5 && v != 0 {
			t.Errorf("fix %d: %.1f ft/s from under 0.5 s of fixes, want 0", i, v)
		}
		if i >= 20 && math.Abs(float64(v)*60-1000) > 100 {
			t.Errorf("fix %d: %.0f fpm, want 1000 ± 100", i, v*60)
		}
	}
}

// A 1 Hz receiver still gets a rate, from the 2 or 3 fixes in the window.
// Covers: RB-HLR-SIT-120
func TestGPSVSpeedAt1Hz(t *testing.T) {
	var e gpsVSpeedEstimator
	var v float32
	for i := 0; i < 5; i++ {
		v = e.add(36000+float64(i), 3000-10*float64(i)) // 600 fpm down
	}
	if math.Abs(float64(v)+10) > 1e-3 {
		t.Errorf("%.3f ft/s, want -10", v)
	}
}

// 23:59:59.x to 00:00:00.x is the next fix, not a step back.
// Covers: RB-HLR-SIT-120
func TestGPSVSpeedAcrossMidnight(t *testing.T) {
	var e gpsVSpeedEstimator
	var v float32
	for i := 0; i < 20; i++ {
		tod := math.Mod(86399+float64(i)*0.1, 86400)
		v = e.add(tod, 1000+5*float64(i)*0.1)
	}
	if math.Abs(float64(v)-5) > 1e-3 {
		t.Errorf("%.3f ft/s across midnight, want 5", v)
	}
}

// A gap longer than 3 s, or the fix time stepping back, drops the history: the slope
// across a dropout would mix two different climbs.
// Covers: RB-HLR-SIT-120
func TestGPSVSpeedRestartsAfterGapOrStepBack(t *testing.T) {
	for name, next := range map[string]float64{"gap": 36010, "step back": 35990} {
		var e gpsVSpeedEstimator
		for i := 0; i < 20; i++ {
			e.add(36000+float64(i)*0.1, 1000+20*float64(i)*0.1)
		}
		if v := e.add(next, 5000); v != 0 {
			t.Errorf("%s: %.1f ft/s from a single fix after it, want 0", name, v)
		}
	}
}

// The same fix time twice (a resent GGA) is not a second sample: no division by a zero
// time span, and the rate stays what it was.
// Covers: RB-HLR-SIT-120
func TestGPSVSpeedRepeatedFix(t *testing.T) {
	var e gpsVSpeedEstimator
	var v float32
	for i := 0; i < 10; i++ {
		v = e.add(36000+float64(i)*0.1, 1000+10*float64(i)*0.1)
	}
	if w := e.add(36000.9, 9999); w != v {
		t.Errorf("repeated fix moved the rate from %.2f to %.2f ft/s", v, w)
	}
}

// An altitude jump faster than 12000 fpm is a glitch, reported as 0 rather than as a dive.
// Covers: RB-HLR-SIT-120
func TestGPSVSpeedRejectsGlitch(t *testing.T) {
	var e gpsVSpeedEstimator
	e.add(36000, 1000)
	if v := e.add(36000.5, 1500); v != 0 {
		t.Errorf("1000 ft/s step read %.0f ft/s, want 0", v)
	}
}

// Through the parser: GGA altitudes climbing 3 m a second set GPSVerticalSpeed to
// 9.84 ft/s, a no-fix GGA zeroes it, and so does the fix going stale.
// Covers: RB-HLR-SIT-120
func TestNMEAGGASetsGPSVerticalSpeed(t *testing.T) {
	withGPSState(t)
	for i := 0; i <= 20; i++ {
		ts := 36000 + float64(i)*0.1
		hh, mm, ss := int(ts)/3600, int(ts)%3600/60, math.Mod(ts, 60)
		if !nmea(fmt.Sprintf("GPGGA,%02d%02d%05.2f,4300.000,N,01200.000,E,1,12,0.8,%.1f,M,45.0,M,,", hh, mm, ss, 300+3*float64(i)*0.1)) {
			t.Fatalf("GGA %d not used", i)
		}
		stratuxClock.Time = stratuxClock.Time.Add(100 * time.Millisecond)
	}
	if !near(mySituation.GPSVerticalSpeed, 3/0.3048, 0.05) {
		t.Errorf("GPSVerticalSpeed %.2f ft/s, want 9.84", mySituation.GPSVerticalSpeed)
	}

	stratuxClock.Time = stratuxClock.Time.Add(4 * time.Second)
	if isGPSValid() || mySituation.GPSVerticalSpeed != 0 {
		t.Errorf("stale fix left GPSVerticalSpeed at %.2f ft/s", mySituation.GPSVerticalSpeed)
	}
}
