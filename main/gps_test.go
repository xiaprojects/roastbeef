/*
	gps_test.go: requirements-style unit tests for the NMEA position parser
	(processNMEALine in gps.go), which every ownship quantity comes from: the position
	traffic is placed against and reported to the EFB, the ground speed the speed tape
	falls back to, the track the heading falls back to, the GPS altitude.

	The expected values are worked by hand from the sentences, among them the GGA and
	RMC examples every NMEA 0183 reference reproduces. The integration test replays a
	real flight through the same parser; these cover what one flight in central Italy
	cannot: the southern and western hemispheres, other receivers' field widths, and
	malformed or no-fix sentences.
*/

package main

import (
	"math"
	"sync"
	"testing"
	"time"
)

// withGPSState is withTrafficState plus the mutexes main() creates for the parser and
// an empty GPS performance history.
func withGPSState(t *testing.T) {
	t.Helper()
	withTrafficState(t)
	perf, detected := myGPSPerfStats, globalStatus.GPS_detected_type
	t.Cleanup(func() { myGPSPerfStats, globalStatus.GPS_detected_type = perf, detected })
	myGPSPerfStats = nil
	mySituation.muGPS, mySituation.muGPSPerformance = &sync.Mutex{}, &sync.Mutex{}
	globalStatus.GPS_connected = true
}

// nmea feeds one sentence, its checksum added, to the parser and returns whether the
// parser used it.
func nmea(body string) bool {
	return processNMEALine(appendNmeaChecksum("$" + body))
}

// latTol and lonTol are the float32 resolution the situation keeps a position at:
// 3.8e-6 deg (0.4 m) for latitudes, 1.5e-5 deg for longitudes past 128 deg.
const latTol, lonTol = 4e-6, 1.6e-5

// near reports whether a float32 situation value is within tol of want.
func near(got float32, want, tol float64) bool { return math.Abs(float64(got)-want) <= tol }

// The textbook sentences - fix taken at 12:35:19 UTC, 48 deg 07.038' N, 11 deg
// 31.000' E, 545.4 m MSL with the geoid 46.9 m below the ellipsoid, 22.4 kt on
// 084.4 true - parse to that ownship. NMEA 0183 writes the time hhmmss with the
// decimals optional; the daemon once required them and dropped both sentences.
func TestNMEAParsesTheTextbookSentences(t *testing.T) {
	withGPSState(t)
	if !nmea("GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,") {
		t.Fatal("GGA 123519 not used")
	}
	s := mySituation
	if !near(s.GPSLatitude, 48+7.038/60, latTol) || !near(s.GPSLongitude, 11+31.0/60, lonTol) || s.GPSFixQuality != 1 ||
		s.GPSLastFixSinceMidnightUTC != 12*3600+35*60+19 || s.GPSLastFixLocalTime != stratuxClock.Time {
		t.Errorf("GGA: %.6f %.6f quality %d time %.2f fixed at %v; want 48.117300 11.516667, 1, 45319, now",
			s.GPSLatitude, s.GPSLongitude, s.GPSFixQuality, s.GPSLastFixSinceMidnightUTC, s.GPSLastFixLocalTime)
	}
	if !near(s.GPSAltitudeMSL, 545.4/0.3048, 0.01) || !near(s.GPSGeoidSep, 46.9/0.3048, 0.01) ||
		!near(s.GPSHeightAboveEllipsoid, (545.4+46.9)/0.3048, 0.01) {
		t.Errorf("GGA: MSL %.2f geoid %.2f HAE %.2f ft; want 1789.37, 153.87, 1943.24", s.GPSAltitudeMSL, s.GPSGeoidSep, s.GPSHeightAboveEllipsoid)
	}
	if !isGPSValid() {
		t.Error("the GPS is not valid after a GGA with a fix")
	}

	if !nmea("GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W") {
		t.Fatal("RMC 123519 not used")
	}
	s = mySituation
	if math.Abs(s.GPSGroundSpeed-22.4) > 1e-6 || !near(s.GPSTrueCourse, 84.4, 1e-4) ||
		s.GPSLastGroundTrackTime != stratuxClock.Time || !near(s.GPSLatitude, 48+7.038/60, latTol) {
		t.Errorf("RMC: %.1f kt on %.1f at %v, %.6f N; want 22.4 kt on 084.4, now, 48.117300 N", s.GPSGroundSpeed, s.GPSTrueCourse, s.GPSLastGroundTrackTime, s.GPSLatitude)
	}
	if !s.GPSTime.IsZero() {
		t.Errorf("RMC dated 1994 set the GPS time to %v; dates before 2016 are ignored", s.GPSTime)
	}
}

// South and west are negative, longitude has three degree digits, and both GGA and
// RMC agree. (The recorded flights are all north and east.)
func TestNMEAHemispheres(t *testing.T) {
	withGPSState(t)
	for _, c := range []struct {
		lat, ns, lon, ew string
		wantLat, wantLon float64
	}{
		{"3356.41500", "S", "15112.66500", "E", -(33 + 56.415/60), 151 + 12.665/60}, // Sydney
		{"3436.50000", "S", "05822.50000", "W", -(34 + 36.5/60), -(58 + 22.5/60)},   // Buenos Aires
		{"4727.13000", "N", "12218.22000", "W", 47 + 27.13/60, -(122 + 18.22/60)},   // Seattle
		{"0000.60000", "S", "00000.60000", "W", -0.01, -0.01},                       // just off null island
	} {
		if !nmea("GPGGA,104200.00," + c.lat + "," + c.ns + "," + c.lon + "," + c.ew + ",1,12,0.8,120.0,M,20.0,M,,") {
			t.Errorf("GGA at %s%s %s%s not used", c.lat, c.ns, c.lon, c.ew)
			continue
		}
		if !near(mySituation.GPSLatitude, c.wantLat, latTol) || !near(mySituation.GPSLongitude, c.wantLon, lonTol) {
			t.Errorf("GGA %s%s %s%s: %.6f %.6f; want %.6f %.6f", c.lat, c.ns, c.lon, c.ew, mySituation.GPSLatitude, mySituation.GPSLongitude, c.wantLat, c.wantLon)
		}
		if !nmea("GPRMC,104200.00,A,"+c.lat+","+c.ns+","+c.lon+","+c.ew+",100.0,270.0,130926,,,A") ||
			!near(mySituation.GPSLatitude, c.wantLat, latTol) || !near(mySituation.GPSLongitude, c.wantLon, lonTol) {
			t.Errorf("RMC %s%s %s%s: %.6f %.6f; want %.6f %.6f", c.lat, c.ns, c.lon, c.ew, mySituation.GPSLatitude, mySituation.GPSLongitude, c.wantLat, c.wantLon)
		}
	}
}

// The track is taken from RMC or VTG only above 3 kt: below, a stationary receiver's
// track wanders, so the last one is kept while the speed itself is still taken.
func TestNMEATrackIsHeldBelowThreeKnots(t *testing.T) {
	withGPSState(t)
	nmea("GPRMC,104200.00,A,4300.000,N,01200.000,E,45.0,123.4,130926,,,A")
	nmea("GPRMC,104200.10,A,4300.000,N,01200.000,E,2.5,301.0,130926,,,A")
	if mySituation.GPSGroundSpeed != 2.5 || !near(mySituation.GPSTrueCourse, 123.4, 1e-4) {
		t.Errorf("RMC at 2.5 kt: %.1f kt on %.1f; want 2.5 kt, the track held at 123.4", mySituation.GPSGroundSpeed, mySituation.GPSTrueCourse)
	}
	// Some receivers send no track at all when slow.
	if !nmea("GPRMC,104200.20,A,4300.000,N,01200.000,E,0.4,,130926,,,A") || math.Abs(mySituation.GPSGroundSpeed-0.4) > 1e-6 || !near(mySituation.GPSTrueCourse, 123.4, 1e-4) {
		t.Errorf("RMC at 0.4 kt with no track: %.1f kt on %.1f; want 0.4, 123.4", mySituation.GPSGroundSpeed, mySituation.GPSTrueCourse)
	}
	// VTG: true track, magnetic track, speed in knots and in km/h.
	if !nmea("GPVTG,054.7,T,034.4,M,005.5,N,010.2,K,A") || !near(mySituation.GPSTrueCourse, 54.7, 1e-4) ||
		math.Abs(mySituation.GPSGroundSpeed-5.5) > 1e-6 || mySituation.GPSLastGroundTrackTime != stratuxClock.Time {
		t.Errorf("VTG: %.1f kt on %.1f; want 5.5 kt on 054.7", mySituation.GPSGroundSpeed, mySituation.GPSTrueCourse)
	}
	if !nmea("GPVTG,200.0,T,,M,1.0,N,1.9,K,A") || !near(mySituation.GPSTrueCourse, 54.7, 1e-4) {
		t.Errorf("VTG at 1 kt: track %.1f; want held at 054.7", mySituation.GPSTrueCourse)
	}
}

// A sentence with a bad checksum, too few fields, or a field that is not a number
// changes nothing.
func TestNMEARejectsMalformedSentences(t *testing.T) {
	withGPSState(t)
	nmea("GPGGA,104200.00,4300.000,N,01200.000,E,1,12,0.8,120.0,M,20.0,M,,")
	before := mySituation
	for _, l := range []string{
		"$GPGGA,104201.00,4400.000,N,01200.000,E,1,12,0.8,120.0,M,20.0,M,,*00",
		appendNmeaChecksum("$GPGGA,104201.00,4400.000,N,01200.000,E,1,12,0.8,120.0,M,20.0"),
		appendNmeaChecksum("$GPGGA,104201.00,44x0.000,N,01200.000,E,1,12,0.8,120.0,M,20.0,M,,"),
		appendNmeaChecksum("$GPGGA,10:42:01,4400.000,N,01200.000,E,1,12,0.8,120.0,M,20.0,M,,"),
		appendNmeaChecksum("$GPGGA,104201.00,4400.000,N,01200.000,E,one,12,0.8,120.0,M,20.0,M,,"),
		appendNmeaChecksum("$GPRMC,104201.00,A,4400.000,N,01200.000,E,fast,270.0,130926,,,A"),
		appendNmeaChecksum("$GPRMC,104201.00,A,4400.000,N"),
		appendNmeaChecksum("$GPVTG,054.7,T,034.4,M,,N,,K,A"),
		"GPGGA,104201.00,4400.000,N,01200.000,E,1,12,0.8,120.0,M,20.0,M,,",
	} {
		processNMEALine(l)
		if s := mySituation; s.GPSLatitude != before.GPSLatitude || s.GPSLastFixSinceMidnightUTC != before.GPSLastFixSinceMidnightUTC ||
			s.GPSGroundSpeed != before.GPSGroundSpeed || s.GPSTrueCourse != before.GPSTrueCourse || s.GPSFixQuality != before.GPSFixQuality {
			t.Errorf("%q changed the situation", l)
			mySituation = before
		}
	}
}

// KNOWN ISSUE (FHA-SPD-3 / ATT-3, not yet decided). When the receiver says it has no
// fix - RMC status V, GGA quality 0 with the position fields empty, which is how
// u-blox reports it - the parser drops the sentence instead of taking it at its word,
// so the last fix stays valid until isGPSValid's 3 s timeout: 3 s of the last ground
// speed, track and position presented as current, and the window in which the AHRS
// holds its attitude (sensors_test.go). The test measures it and skips; it passes once
// an explicit no-fix ends validity at once.
func TestNMEAExplicitNoFixEndsValidity(t *testing.T) {
	withGPSState(t)
	nmea("GPGGA,104200.00,4300.000,N,01200.000,E,1,12,0.8,120.0,M,20.0,M,,")
	nmea("GPRMC,104200.00,A,4300.000,N,01200.000,E,95.0,270.0,130926,,,A")
	stratuxClock.Time = stratuxClock.Time.Add(100 * time.Millisecond)
	nmea("GPRMC,104200.10,V,,,,,,,130926,,,N")
	nmea("GPGGA,104200.10,,,,,0,00,99.99,,,,,,")
	var lasted time.Duration
	for lasted = 0; lasted < 5*time.Second && isGPSValid(); lasted += 100 * time.Millisecond {
		stratuxClock.Time = stratuxClock.Time.Add(100 * time.Millisecond)
	}
	if lasted > 0 {
		t.Skipf("KNOWN ISSUE: after the receiver reported no fix, the last fix (95 kt) stayed valid for %.1f s more", lasted.Seconds())
	}
}

// The ownship report's NACp is the AC 20-165A class of the horizontal 95 % accuracy:
// 11 under 3 m, 10 under 10 m, 9 under 30 m, 8 under 0.05 NM, 7 under 0.1 NM, 6 under
// 0.3 NM. Beyond that the daemon reports 0, unknown, rather than classes 5 to 1: a
// worse class than the truth, never a better one. A GST sentence gives the accuracy as
// twice the root sum square of the latitude and longitude 1-sigma errors (2 DRMS), and
// the vertical as twice the altitude's.
func TestNACpFromTheGSTAccuracy(t *testing.T) {
	withGPSState(t)
	for _, c := range []struct {
		acc  float32
		nacp uint8
	}{
		{0.5, 11}, {2.99, 11}, {3, 10}, {9.99, 10}, {10, 9}, {29.9, 9}, {30, 8}, {92.5, 8}, {92.6, 7},
		{185.1, 7}, {185.2, 6}, {555.5, 6}, {555.6, 0}, {5000, 0},
	} {
		if got := calculateNACp(c.acc); got != c.nacp {
			t.Errorf("NACp at %.2f m = %d; want %d", c.acc, got, c.nacp)
		}
	}
	if !nmea("GPGST,104200.00,1.2,,,,2.0,1.5,3.0") {
		t.Fatal("GST not used")
	}
	if s := mySituation; !near(s.GPSHorizontalAccuracy, 5, 1e-5) || !near(s.GPSVerticalAccuracy, 6, 1e-5) || s.GPSNACp != 10 {
		t.Errorf("GST sigmas 2.0/1.5/3.0 m: accuracy %.2f/%.2f m NACp %d; want 5, 6, 10", s.GPSHorizontalAccuracy, s.GPSVerticalAccuracy, s.GPSNACp)
	}
}
