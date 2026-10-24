/*
	flarm-nmea_test.go: requirements-style unit tests for the FLARM NMEA interface
	(flarm-nmea.go): the PFLAA/PFLAU traffic sentences and the ownship sentences sent to
	glider computers and EFBs on TCP :2000 and the NMEA serial outputs, and the parsing of
	PFLAA/PFLAU from an external FLARM or OGN tracker.

	The sentence layouts are those of the FLARM data port specification (FTD-012), as
	quoted field by field in flarm-nmea.go. The checksum is checked against NMEA sentences
	published with their checksum, and every expected value is re-derived here from the
	traffic it encodes: positions from calcLocationForBearingDistance (itself checked
	against a geodesic in traffic_test.go), units from their definitions.

	As in traffic_test.go, the clock is stopped and the traffic table, settings and
	situation are swapped for fresh ones per test.
*/

package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// nmeaFields checks that s is one complete NMEA sentence - "$", body, "*", two hex
// digits of checksum, CRLF - with a correct checksum, and returns the body's fields.
func nmeaFields(t *testing.T, s string) []string {
	t.Helper()
	body, cs, ok := strings.Cut(strings.TrimPrefix(s, "$"), "*")
	if !strings.HasPrefix(s, "$") || !ok || len(cs) != 4 || !strings.HasSuffix(cs, "\r\n") {
		t.Fatalf("%q is not $<body>*<checksum>\\r\\n", s)
	}
	var x byte
	for i := 0; i < len(body); i++ {
		x ^= body[i]
	}
	if want := fmt.Sprintf("%02X", x); cs[:2] != want {
		t.Fatalf("%q: checksum %s; want %s", s, cs[:2], want)
	}
	return strings.Split(body, ",")
}

// atoi is the integer value of an NMEA field, failing the test if it isn't one.
func atoi(t *testing.T, field string) int {
	t.Helper()
	n, err := strconv.Atoi(field)
	if err != nil {
		t.Fatalf("field %q: %v", field, err)
	}
	return n
}

// nmeaDegrees converts an NMEA ddmm.mmmmm / dddmm.mmmmm field and its hemisphere to
// signed degrees.
func nmeaDegrees(t *testing.T, field, hemisphere string) float64 {
	t.Helper()
	v, err := strconv.ParseFloat(field, 64)
	if err != nil {
		t.Fatalf("coordinate %q: %v", field, err)
	}
	deg := math.Floor(v/100) + math.Mod(v, 100)/60
	if hemisphere == "S" || hemisphere == "W" {
		deg = -deg
	}
	return deg
}

// captureFlarmOutput points the FLARM NMEA outputs at a buffer and returns a function
// that reads back the sentences sent since the last call.
func captureFlarmOutput(t *testing.T) func() []string {
	netMu, conns, loopMap, loopMu := netMutex, clientConnections, avoidLoopBackMap, avoidLoopBackMutex
	t.Cleanup(func() {
		netMutex, clientConnections, avoidLoopBackMap, avoidLoopBackMutex = netMu, conns, loopMap, loopMu
	})
	netMutex = &sync.Mutex{}
	avoidLoopBackMap = make(map[string]string)
	avoidLoopBackMutex = &sync.Mutex{}
	conn := &captureConn{q: NewMessageQueue(1024)}
	clientConnections = map[string]connection{"test": conn}
	return func() (sent []string) {
		for _, d := range conn.q.GetQueueDump(false) {
			sent = append(sent, string(d.([]byte)))
		}
		conn.q = NewMessageQueue(1024)
		return sent
	}
}

// flarmIn feeds one sentence to the FLARM parser the way gps.go does: checksum checked
// and stripped, split at commas.
func flarmIn(t *testing.T, body string) {
	t.Helper()
	s, ok := validateNMEAChecksum(appendNmeaChecksum("$" + body))
	if !ok {
		t.Fatalf("%q: %s", body, s)
	}
	parseFlarmNmeaMessage(strings.Split(s, ","))
}

// The checksum is the XOR of every character between "$" and "*", as two upper-case hex
// digits. Checked against sentences published with their checksum: the GGA and RMC
// examples every NMEA 0183 reference reproduces, and the PFLAA example quoted in
// flarm-nmea.go.
// Covers: RB-HLR-TRF-320
func TestNmeaChecksumMatchesPublishedSentences(t *testing.T) {
	for _, s := range []string{
		"$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47",
		"$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A",
		"$PFLAA,0,-10687,-22561,-10283,1,A4F2EE,136,0,269,0.0,0*4E",
	} {
		body, _, _ := strings.Cut(s, "*")
		if got := appendNmeaChecksum(body); got != s {
			t.Errorf("appendNmeaChecksum(%q) = %q; want %q", body, got, s)
		}
		if got := appendNmeaChecksum(body[1:]); got != s[1:] {
			t.Errorf("without the $: %q; want %q", got, s[1:])
		}
	}
}

// A positioned target is sent as PFLAA with every field of the data port specification
// in order: alarm level, relative north/east/vertical in metres, ID type (1 = ICAO,
// 2 = FLARM ID for a non-ICAO address), the 6-digit hex ID with "!" and the callsign,
// true track in whole degrees, turn rate, ground speed in m/s, climb rate in m/s to one
// decimal, and the aircraft type as one hex digit.
// Covers: RB-HLR-TRF-320
func TestPFLAAEncodesAPositionedTarget(t *testing.T) {
	withTrafficState(t)
	ownshipAt(43, 12, 3000)
	// 2 km from ownship on a bearing of 330: 1732 m north, 1000 m west.
	lat, lng := calcLocationForBearingDistance(43, 12, 330, 2000/1852.0)
	ti := TrafficInfo{Icao_addr: 0x4B1A2C, Tail: "HBXYZ", Position_valid: true, Lat: float32(lat), Lng: float32(lng),
		Alt: 3500, Track: 271.6, Speed: 100, Speed_valid: true, Vvel: -500, Emitter_category: 1}
	s, valid, alarm := makeFlarmPFLAAString(ti)
	f := nmeaFields(t, s)
	if !valid || alarm != 0 || len(f) != 12 || f[0] != "PFLAA" {
		t.Fatalf("%q valid %v alarm %d; want a 12-field PFLAA, no alarm", s, valid, alarm)
	}
	if n, e := atoi(t, f[2]), atoi(t, f[3]); math.Abs(float64(n)-1732) > 2 || math.Abs(float64(e)+1000) > 2 {
		t.Errorf("relative north/east %d/%d m; want 1732/-1000", n, e)
	}
	// 500 ft above, in metres, truncated.
	if f[1] != "0" || f[4] != "152" || f[5] != "1" || f[6] != "4B1A2C!HBXYZ" {
		t.Errorf("alarm %s vertical %s ID type %s ID %s; want 0, 152, 1, 4B1A2C!HBXYZ", f[1], f[4], f[5], f[6])
	}
	// 100 kt = 51.4 m/s; -500 ft/min = -2.54 m/s; emitter category 1 (light) = 8, piston.
	if f[7] != "271" || f[8] != "0" || f[9] != "51" || f[10] != "-2.5" || f[11] != "8" {
		t.Errorf("track %s turn %s speed %s climb %s type %s; want 271, 0, 51, -2.5, 8", f[7], f[8], f[9], f[10], f[11])
	}

	ti.Addr_type, ti.Tail = 1, ""
	if f := nmeaFields(t, first(makeFlarmPFLAAString(ti))); f[5] != "2" || f[6] != "4B1A2C" {
		t.Errorf("non-ICAO address, no callsign: ID type %s ID %s; want 2, 4B1A2C", f[5], f[6])
	}
}

func first(s string, _ bool, _ uint8) string { return s }

// The turn rate is signed, positive clockwise: a target turning left is not sent as
// turning right at 65533 degrees a second (what a uint16 conversion of -3 gives on
// amd64; arm64 gives 0).
// Covers: RB-HLR-TRF-320
func TestPFLAATurnRateIsSigned(t *testing.T) {
	withTrafficState(t)
	ownshipAt(43, 12, 3000)
	ti := TrafficInfo{Icao_addr: 0x4B1A2C, Position_valid: true, Lat: 43.01, Lng: 12, Alt: 3000, Track: 90, Speed_valid: true}
	for _, rate := range []float32{-3, 3} {
		ti.TurnRate = rate
		if f := nmeaFields(t, first(makeFlarmPFLAAString(ti))); f[8] != strconv.Itoa(int(rate)) {
			t.Errorf("turn rate %.0f deg/s sent as %s", rate, f[8])
		}
	}
}

// A target without a position is sent as the specification's bearingless PFLAA: the
// estimated distance in the relative-north field, relative east empty, and no track,
// turn rate or speed.
// Covers: RB-HLR-TRF-230, RB-HLR-TRF-320
func TestPFLAAEncodesABearinglessTarget(t *testing.T) {
	withTrafficState(t)
	ownshipAt(43, 12, 3000)
	ti := TrafficInfo{Icao_addr: 0x3003E3, Alt: 3200, DistanceEstimated: 3000.7, Emitter_category: 7}
	f := nmeaFields(t, first(makeFlarmPFLAAString(ti)))
	want := []string{"PFLAA", "0", "3000", "", "60", "1", "3003E3", "", "", "", "0.0", "3"}
	if strings.Join(f, ",") != strings.Join(want, ",") {
		t.Errorf("bearingless PFLAA %q; want %q", strings.Join(f, ","), strings.Join(want, ","))
	}
}

// The alarm level is derived from distance and height difference: level 3 inside
// 0.5 NM (926 m) and 500 ft (152 m), level 2 inside 1 NM (1852 m) and 1000 ft (304 m),
// none otherwise. The FLARM specification defines the levels by time to impact; this is
// the daemon's distance-based approximation of it, pinned here as implemented.
func TestFlarmAlarmLevels(t *testing.T) {
	for _, c := range []struct {
		dist float64
		vert int32
		want uint8
	}{
		{0, 0, 3}, {925, 151, 3}, {925, -151, 3},
		{926, 0, 2}, {0, 152, 2}, {0, -152, 2}, {1851, 303, 2}, {1851, -303, 2},
		{1852, 0, 0}, {0, 304, 0}, {0, -304, 0},
	} {
		if got := computeAlarmLevel(c.dist, c.vert); got != c.want {
			t.Errorf("alarm level at %.0f m, %d m vertical = %d; want %d", c.dist, c.vert, got, c.want)
		}
	}
}

// Each cycle ends with one PFLAU describing the most threatening target: number of
// targets received, transmit and power OK, GPS status 2 (3D fix), alarm level, bearing
// relative to own ground track in -180..180, alarm type 2 (aircraft), relative vertical
// and distance in metres, and the target's ID. With no alarm the bearing, vertical,
// distance and ID are empty.
// Covers: RB-HLR-TRF-320
func TestPFLAUReportsTheMostThreateningTarget(t *testing.T) {
	run := trafficCycleAt(t)
	mySituation.GPSTrueCourse = 90
	heard(0x4B1A2C, 0, 0.4, 3200) // 741 m north, 200 ft above: alarm 3
	heard(0x4B1A2D, 0, 0.8, 3000) // 1482 m north, level: alarm 2
	heard(0x4B1A2E, 0, 5.0, 3000) // no alarm
	pflau := func(c trafficCycle) []string {
		t.Helper()
		var f []string
		for _, s := range c.flarm {
			if strings.HasPrefix(s, "$PFLAU,") {
				if f != nil {
					t.Fatalf("more than one PFLAU in a cycle: %q", c.flarm)
				}
				f = nmeaFields(t, s)
			}
		}
		if len(f) != 11 {
			t.Fatalf("PFLAU fields %q; want 11", f)
		}
		return f
	}
	f := pflau(run())
	if got := strings.Join(f[:8], ","); got != "PFLAU,3,1,2,1,3,-90,2" {
		t.Errorf("PFLAU %q; want PFLAU,3,1,2,1,3,-90,2 (target due north, own track east)", strings.Join(f, ","))
	}
	if f[8] != "60" || math.Abs(float64(atoi(t, f[9]))-741) > 2 || f[10] != "4B1A2C" {
		t.Errorf("vertical %s distance %s ID %s; want 60, 741, 4B1A2C", f[8], f[9], f[10])
	}

	delete(traffic, 0x4B1A2C)
	delete(traffic, 0x4B1A2D)
	if f := pflau(run()); strings.Join(f, ",") != "PFLAU,1,1,2,1,0,,0,,," {
		t.Errorf("no alarm: PFLAU %q; want PFLAU,1,1,2,1,0,,0,,,", strings.Join(f, ","))
	}

	// The relative bearing wraps into -180..180 either side of north (whole degrees,
	// truncated).
	for _, c := range []struct{ track, bearing, want float32 }{{10, 350, -20}, {350, 10, 20}, {0, 175, 175}, {0, 185, -175}, {185, 0, 175}, {270, 60, 150}} {
		mySituation.GPSTrueCourse = c.track
		lat, lng := calcLocationForBearingDistance(43, 12, float64(c.bearing), 0.3)
		f := nmeaFields(t, makeFlarmPFLAUString(TrafficInfo{Lat: float32(lat), Lng: float32(lng), Alt: 3000}))
		if got := atoi(t, f[6]); math.Abs(float64(got)-float64(c.want)) > 1 {
			t.Errorf("own track %.0f, target at %.0f: relative bearing %d; want %.0f", c.track, c.bearing, got, c.want)
		}
	}

	globalStatus.GPS_connected = false
	if f := nmeaFields(t, makeFlarmPFLAUString(TrafficInfo{})); f[3] != "0" {
		t.Errorf("no GPS: GPS status %s; want 0", f[3])
	}
}

// GDL90 emitter categories map to the nearest FLARM aircraft type, and back. The FLARM
// types without a GDL90 equivalent (tow plane, drop plane) come back as light aircraft.
func TestEmitterCategoryMapsToFlarmAircraftType(t *testing.T) {
	for cat, want := range map[uint8]string{
		0: "0", 1: "8", 2: "9", 3: "9", 4: "9", 5: "9", 6: "8", 7: "3", 8: "0", 9: "1", 10: "B",
		11: "4", 12: "7", 13: "0", 14: "D", 15: "0", 16: "0", 17: "E", 18: "E", 19: "F", 20: "0", 21: "0",
	} {
		if got := gdl90EmitterCatToNMEA(cat); got != want {
			t.Errorf("emitter category %d -> FLARM type %s; want %s", cat, got, want)
		}
	}
	for typ, want := range map[string]uint8{
		"0": 0, "1": 9, "2": 1, "3": 7, "4": 11, "5": 1, "6": 12, "7": 12, "8": 1, "9": 3,
		"A": 0, "B": 10, "C": 10, "D": 14, "E": 18, "F": 19, "": 0, "X": 0,
	} {
		if got := nmeaAircraftTypeToGdl90(typ); got != want {
			t.Errorf("FLARM type %q -> emitter category %d; want %d", typ, got, want)
		}
	}
}

// The ownship sentences carry the current fix: RMC with time, status, position in
// ddmm.mmmmm, ground speed (kt) and true course; GGA with fix quality, satellites and
// altitude and geoid separation in metres; PGRMZ with pressure altitude in feet. Without
// a fix RMC says V (void) and GGA quality 0, with no position.
func TestOwnshipNMEACarriesTheFix(t *testing.T) {
	withTrafficState(t)
	send := captureFlarmOutput(t)
	ownshipAt(43.123456, -12.5, 3000)
	mySituation.GPSLastFixSinceMidnightUTC = 10*3600 + 30*60 + 15.25
	mySituation.GPSGroundSpeed, mySituation.GPSTrueCourse = 105, 271
	mySituation.GPSSatellites, mySituation.GPSGeoidSep = 9, 157.48
	mySituation.BaroPressureAltitude = 3012

	rmc := nmeaFields(t, makeGPRMCString())
	if len(rmc) != 13 || rmc[0] != "GPRMC" || rmc[1] != "103015.25" || rmc[2] != "A" || rmc[12] != "A" {
		t.Fatalf("RMC %q; want 13 fields, 103015.25, A ... A", rmc)
	}
	if lat, lng := nmeaDegrees(t, rmc[3], rmc[4]), nmeaDegrees(t, rmc[5], rmc[6]); math.Abs(lat-float64(float32(43.123456))) > 2e-7 || lng != -12.5 {
		t.Errorf("RMC position %s %s %s %s = %.7f %.7f; want 43.123456 -12.5", rmc[3], rmc[4], rmc[5], rmc[6], lat, lng)
	}
	if rmc[7] != "105.0" || rmc[8] != "271.0" || rmc[9] != time.Now().UTC().Format("020106") {
		t.Errorf("RMC speed %s course %s date %s; want 105.0, 271.0, today", rmc[7], rmc[8], rmc[9])
	}

	gga := nmeaFields(t, makeGPGGAString())
	if len(gga) != 15 || gga[0] != "GPGGA" || gga[1] != "103015.25" || gga[6] != "1" || gga[7] != "9" {
		t.Fatalf("GGA %q; want 15 fields, 103015.25, quality 1, 9 satellites", gga)
	}
	if lat, lng := nmeaDegrees(t, gga[2], gga[3]), nmeaDegrees(t, gga[4], gga[5]); math.Abs(lat-float64(float32(43.123456))) > 2e-7 || lng != -12.5 {
		t.Errorf("GGA position = %.7f %.7f; want 43.123456 -12.5", lat, lng)
	}
	// 3000 ft = 914.4 m; 157.48 ft = 48.0 m.
	if gga[9] != "914.4" || gga[10] != "M" || gga[11] != "48.0" || gga[12] != "M" {
		t.Errorf("GGA altitude %s %s separation %s %s; want 914.4 M, 48.0 M", gga[9], gga[10], gga[11], gga[12])
	}

	if f := nmeaFields(t, makePGRMZString()); strings.Join(f, ",") != "PGRMZ,3012,f,3" {
		t.Errorf("PGRMZ %q; want PGRMZ,3012,f,3", f)
	}

	globalStatus.GPS_connected = false
	rmc = nmeaFields(t, makeGPRMCString())
	if len(rmc) != 13 || rmc[2] != "V" || rmc[3] != "" || rmc[5] != "" || rmc[7] != "" {
		t.Errorf("no fix: RMC %q; want status V and no position or speed", rmc)
	}
	gga = nmeaFields(t, makeGPGGAString())
	if len(gga) != 15 || gga[2] != "" || gga[6] != "0" {
		t.Errorf("no fix: GGA %q; want quality 0 and no position", gga)
	}
	if sent := send(); len(sent) != 0 {
		t.Errorf("the make functions sent %q; they only build the sentence", sent)
	}
}

// With a valid attitude, the Levil AHRS sentence $RPYL goes to the NMEA outputs: roll,
// pitch, heading, slip/skid (sign inverted) and turn rate in tenths of a degree, load
// factor in thousandths of a g, and error code 0 - with a checksum, without which a
// receiver that verifies NMEA checksums discards it. (The checksum was computed and
// thrown away; the sentence went out bare.)
func TestLevilAHRSReportCarriesAChecksum(t *testing.T) {
	withTrafficState(t)
	send := captureFlarmOutput(t)
	ownshipAt(43, 12, 3000)
	globalStatus.IMUConnected = true
	mySituation.AHRSLastAttitudeTime = stratuxClock.Time
	mySituation.AHRSRoll, mySituation.AHRSPitch, mySituation.AHRSGyroHeading = -12.34, 5.67, 271.5
	mySituation.AHRSSlipSkid, mySituation.AHRSTurnRate, mySituation.AHRSGLoad = 1.2, -3.04, 1.234
	makeAHRSLevilReport()
	sent := send()
	if len(sent) != 1 {
		t.Fatalf("sent %q; want one RPYL", sent)
	}
	if f := nmeaFields(t, sent[0]); strings.Join(f, ",") != "RPYL,-123,57,2715,-12,-30,1234,0" {
		t.Errorf("RPYL %q; want RPYL,-123,57,2715,-12,-30,1234,0", strings.Join(f, ","))
	}

	mySituation.AHRSLastAttitudeTime = stratuxClock.Time.Add(-time.Second)
	if makeAHRSLevilReport(); len(send()) != 0 {
		t.Error("an attitude 1 s old was sent")
	}
}

// A PFLAA from an external FLARM becomes a positioned target relative to ownship, and
// re-encoding that target gives back the sentence it came from, up to the metre and
// m/s truncations on the way in and out.
func TestPFLAAInputRoundTrips(t *testing.T) {
	withTrafficState(t)
	ownshipAt(43, 12, 3000)
	flarmIn(t, "PFLAA,0,1732,-1000,61,1,4B1A2C!HBXYZ,270,,51,2.5,8")
	ti, ok := traffic[0x4B1A2C]
	if !ok || len(traffic) != 1 {
		t.Fatalf("traffic table %v; want 4B1A2C", traffic)
	}
	wantLat, wantLng := calcLocationForBearingDistance(43, 12, trackOf(1732, -1000), math.Hypot(1732, -1000)/1852)
	if !ti.Position_valid || math.Abs(float64(ti.Lat)-wantLat) > 3e-5 || math.Abs(float64(ti.Lng)-wantLng) > 3e-5 {
		t.Errorf("position %v %.5f %.5f; want %.5f %.5f", ti.Position_valid, ti.Lat, ti.Lng, wantLat, wantLng)
	}
	// 61 m above 3000 ft; 51 m/s = 99 kt; 2.5 m/s = 492 ft/min; type 8 = light.
	if ti.Alt != 3200 || ti.AltIsGNSS || ti.Speed != 99 || ti.Track != 270 || ti.Vvel != 492 || ti.Emitter_category != 1 {
		t.Errorf("alt %d GNSS %v speed %d track %.0f vvel %d category %d; want 3200 baro, 99, 270, 492, 1",
			ti.Alt, ti.AltIsGNSS, ti.Speed, ti.Track, ti.Vvel, ti.Emitter_category)
	}
	if ti.Tail != "HBXYZ" || ti.Addr_type != 0 || ti.Last_source != TRAFFIC_SOURCE_OGN {
		t.Errorf("tail %q address type %d source %d; want HBXYZ, ICAO, OGN", ti.Tail, ti.Addr_type, ti.Last_source)
	}

	f := nmeaFields(t, first(makeFlarmPFLAAString(ti)))
	n, e := atoi(t, f[2]), atoi(t, f[3])
	if math.Abs(float64(n)-1732) > 3 || math.Abs(float64(e)+1000) > 3 || atoi(t, f[4])-61 < -1 || atoi(t, f[9])-51 < -1 {
		t.Errorf("re-encoded as north %d east %d vertical %s speed %s; want 1732 -1000 61 51", n, e, f[4], f[9])
	}
	if f[6] != "4B1A2C!HBXYZ" || f[7] != "270" || f[10] != "2.5" || f[11] != "8" {
		t.Errorf("re-encoded as ID %s track %s climb %s type %s; want 4B1A2C!HBXYZ 270 2.5 8", f[6], f[7], f[10], f[11])
	}

	flarmIn(t, "PFLAA,0,100,100,0,2,DD8F12!D-KXYZ,0,,0,0.0,1")
	if ti, ok := traffic[1<<24|0xDD8F12]; !ok || ti.Addr_type != 1 || ti.Emitter_category != 9 {
		t.Errorf("FLARM ID target: %v %+v; want non-ICAO glider under 1<<24|DD8F12", ok, ti)
	}
	// OGN trackers prefix the ID with its address type, and may send "OGN_<id>"-style
	// device names as the callsign; neither is kept.
	flarmIn(t, "PFLAA,0,100,100,0,2,03DD8F13!OGN_DD8F13,0,,0,0.0,1")
	if ti, ok := traffic[1<<24|0xDD8F13]; !ok || strings.Contains(ti.Tail, "_") {
		t.Errorf("OGN-style ID: %v tail %q; want 1<<24|DD8F13, no OGN_ callsign", ok, ti.Tail)
	}
}

// A bearingless PFLAA - the specification's form for a target whose direction FLARM
// does not know: estimated distance in the relative-north field, relative east empty -
// is tracked as a bearingless target at that distance. It is not drawn as a positioned
// target due north of ownship.
func TestPFLAABearinglessInputHasNoPosition(t *testing.T) {
	run := trafficCycleAt(t)
	flarmIn(t, "PFLAA,0,2500,,61,1,3003E3!IABCD,,,,0.0,9")
	ti := traffic[0x3003E3]
	if ti.Position_valid || ti.DistanceEstimated != 2500 || ti.Alt != 3200 {
		t.Fatalf("position valid %v estimated distance %.0f alt %d; want no position, 2500 m, 3200 ft",
			ti.Position_valid, ti.DistanceEstimated, ti.Alt)
	}
	c := run()
	if len(c.gdl90) != 0 {
		t.Errorf("a GDL90 traffic report was sent for a target with no bearing")
	}
	if got := c.pflaa("3003E3!IABCD"); !strings.HasPrefix(got, "$PFLAA,0,2500,,60,1,3003E3!IABCD,,,,") {
		t.Errorf("PFLAA out %q; want the bearingless form at 2500 m", got)
	}
}

// Without a GPS fix the relative geometry of a PFLAA cannot be placed: the target is
// kept at its distance, without a position, rather than placed relative to a stale or
// zero ownship position.
func TestPFLAAInputWithoutGPSHasNoPosition(t *testing.T) {
	withTrafficState(t)
	ownshipAt(43, 12, 3000)
	globalStatus.GPS_connected = false
	flarmIn(t, "PFLAA,0,1732,-1000,61,1,4B1A2C!HBXYZ,270,,51,2.5,8")
	if ti := traffic[0x4B1A2C]; ti.Position_valid || math.Abs(ti.DistanceEstimated-2000) > 1 || ti.Alt != 3200 {
		t.Errorf("position valid %v estimated distance %.0f alt %d; want no position, 2000 m, 3200 ft",
			ti.Position_valid, ti.DistanceEstimated, ti.Alt)
	}
}

// A PFLAU alarm for a target already known from PFLAA updates that target; it does not
// create a second one for the same aircraft.
func TestPFLAUInputUpdatesTheSameTarget(t *testing.T) {
	withTrafficState(t)
	ownshipAt(43, 12, 3000)
	for _, id := range []string{"1,4B1A2C!HBXYZ", "2,DD8F12!D-KXYZ"} {
		flarmIn(t, "PFLAA,2,1732,-1000,61,"+id+",270,,51,2.5,8")
		flarmIn(t, "PFLAU,2,1,2,1,2,30,2,61,2000,"+strings.Split(id, ",")[1])
	}
	if len(traffic) != 2 {
		t.Fatalf("%d targets after PFLAA and PFLAU for two aircraft: %v", len(traffic), traffic)
	}
	wantLat, wantLng := calcLocationForBearingDistance(43, 12, 30, 2000/1852.0)
	for _, key := range []uint32{0x4B1A2C, 1<<24 | 0xDD8F12} {
		if ti := traffic[key]; math.Abs(float64(ti.Lat)-wantLat) > 1e-5 || math.Abs(float64(ti.Lng)-wantLng) > 1e-5 {
			t.Errorf("%X at %.5f %.5f; want the PFLAU position %.5f %.5f", key, ti.Lat, ti.Lng, wantLat, wantLng)
		}
	}
}

// FLARM relays traffic with more delay than the 1090 receiver hears it, so a target
// heard on 1090 in the last 5 s is not moved by a PFLAA; after that, FLARM updates it.
func TestFlarmInputDefersToRecent1090(t *testing.T) {
	withTrafficState(t)
	ownshipAt(43, 12, 3000)
	ti := heard(0x4B1A2C, 0, 1, 3000)
	ti.Age = 1
	traffic[0x4B1A2C] = ti
	flarmIn(t, "PFLAA,0,1732,-1000,61,1,4B1A2C!HBXYZ,270,,51,2.5,8")
	if got := traffic[0x4B1A2C]; got.Lat != ti.Lat || got.Last_source != TRAFFIC_SOURCE_1090ES {
		t.Errorf("a PFLAA moved a target heard on 1090 1 s ago")
	}
	ti.Age = 5
	traffic[0x4B1A2C] = ti
	flarmIn(t, "PFLAA,0,1732,-1000,61,1,4B1A2C!HBXYZ,270,,51,2.5,8")
	if got := traffic[0x4B1A2C]; got.Lat == ti.Lat || got.Last_source != TRAFFIC_SOURCE_OGN {
		t.Errorf("a PFLAA did not update a target last heard on 1090 5 s ago")
	}
}

// A PFLAA or PFLAU with missing fields, or an ID that is not hex, is discarded without
// creating a target.
func TestFlarmInputMalformedIsDiscarded(t *testing.T) {
	withTrafficState(t)
	ownshipAt(43, 12, 3000)
	for _, body := range []string{
		"PFLAA,0,1732,-1000,61,1,4B1A2C,270,,51,2.5",
		"PFLAA,0,1732,-1000,61,1,ZZZZZZ,270,,51,2.5,8",
		"PFLAA,0,1732,-1000,61,1,4B1A,270,,51,2.5,8",
		"PFLAU,2,1,2,1,2,30,2,61,2000",
		"PFLAU,2,1,2,1,2,,2,61,2000,4B1A2C",
		"PFLAU,2,1,2,1,2,30,2,61,2000,4B1A2",
	} {
		flarmIn(t, body)
		if len(traffic) != 0 {
			t.Errorf("%q created %v", body, traffic)
			traffic = make(map[uint32]TrafficInfo)
		}
	}
}
