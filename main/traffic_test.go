/*
	traffic_test.go: requirements-style unit tests for target management (traffic.go):
	UAT downlink and 1090ES decoding, the GDL90 traffic report, registration lookup,
	ownship filtering and dead-reckoning between reports.

	Each test names the behaviour it pins down in its comment. The decoders are fed
	recorded frames and checked against an independent decoder where one exists:

	  - UAT downlink frames come from test-data/cyoung-09062015-noproblem-stratux-uat.log
	    (Michigan, 2015); the expected values are what dump978's own decoder,
	    dump978/uat2text, prints for the same frame. It shares no code with
	    parseDownlinkReport.
	  - 1090 lines are dump1090's :30006 JSON as logged in the es_messages table of
	    test-data/flightlog-20260913111200.0341.sqlite (I-RVDX, central Italy).
	  - The GDL90 traffic report is the worked N825V example of the GDL 90 Data
	    Interface Specification (560-1058-00 Rev A), every field of which was
	    re-derived from the ICD's encoding rules.

	No goroutine, socket or file is involved: the stratux clock is stopped and the
	traffic table, settings and situation are swapped for fresh ones per test.
*/

package main

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xiaprojects/roastbeef/common"
)

var trafficT0 = time.Date(2026, time.September, 13, 10, 12, 0, 0, time.UTC)

// withTrafficState gives the test an empty traffic table, a stopped clock at trafficT0
// and zero settings, situation and status, and puts the previous globals back after.
func withTrafficState(t *testing.T) {
	t.Helper()
	clock, table, mu, seen := stratuxClock, traffic, trafficMutex, seenTraffic
	set, sit, stat, own, factors := globalSettings, mySituation, globalStatus, OwnshipTrafficInfo, estimatedDistFactors
	stratuxClock = &monotonic{Time: trafficT0}
	traffic = make(map[uint32]TrafficInfo)
	trafficMutex = &sync.Mutex{}
	seenTraffic = make(map[uint32]bool)
	globalSettings = settings{}
	mySituation = SituationData{}
	globalStatus = status{}
	OwnshipTrafficInfo = TrafficInfo{}
	crcInit()
	t.Cleanup(func() {
		stratuxClock, traffic, trafficMutex, seenTraffic = clock, table, mu, seen
		globalSettings, mySituation, globalStatus, OwnshipTrafficInfo, estimatedDistFactors = set, sit, stat, own, factors
	})
}

// ownshipAt gives ownship a fresh GPS fix at lat/lon and a fresh baro reading, with
// GPS MSL and pressure altitude both at altFt.
func ownshipAt(lat, lon float32, altFt float32) {
	globalStatus.GPS_connected = true
	mySituation.GPSFixQuality = 1
	mySituation.GPSLastFixLocalTime = stratuxClock.Time
	mySituation.GPSLastGPSTimeStratuxTime = stratuxClock.Time
	mySituation.GPSLatitude, mySituation.GPSLongitude = lat, lon
	mySituation.GPSHorizontalAccuracy = 5
	mySituation.GPSAltitudeMSL = altFt
	mySituation.BaroPressureAltitude = altFt
	mySituation.BaroLastMeasurementTime = stratuxClock.Time
}

// trackOf is the true track, degrees, of a velocity given as north and east components.
func trackOf(north, east float64) float64 {
	return math.Mod(common.Degrees(math.Atan2(east, north))+360, 360)
}

// angleDiff is the absolute difference between two bearings, degrees, across north.
func angleDiff(a, b float64) float64 {
	d := math.Mod(math.Abs(a-b), 360)
	return math.Min(d, 360-d)
}

// withUATByte returns a downlink line with payload byte i replaced by f(byte i).
func withUATByte(line string, i int, f func(byte) byte) string {
	payload, rest, _ := strings.Cut(line[1:], ";")
	frame, _ := hex.DecodeString(payload)
	frame[i] = f(frame[i])
	return line[:1] + hex.EncodeToString(frame) + ";" + rest
}

const (
	// TIS-B target, no callsign; the frame quoted in the header comment of traffic.go.
	uatTISB = "-0b2b48fe3aef1f88621a0856110a31c01105c4e6c4e6c40a9a820300000000000000;rs=7;"
	// ADS-B, callsign N230TX, secondary (geometric) altitude in the AUXSV element.
	uatN230TX = "-08a20a3f3c0e7588af360a79002a30207d09da12ddd4040b52a4c2a0000a60000000;rs=6;"
	// Same aircraft a few minutes later, sending its Mode 3/A code instead of a callsign.
	uatSquawk1200 = "-08a20a3f3c1bf1885b0a0a29101233005d066a0025ed2d0beaa4c0a0000a10000000;rs=4;"
	// Another aircraft (N1663H) sending a code with every digit significant.
	uatSquawk4032 = "-08a10ac13c37518919860c5901e817801c06e01335ed2d0b36a4c0a0000cc0000000;"
	// TIS-B surface target: ground speed, track and vehicle dimensions instead of velocity.
	uatGround = "-0b2b42a53c0a7d89713203e9808193900104945e3a388c0bba920300000000000000;rs=2;"
	// Basic (short, MDB type 0) frame: state vector only, no Mode Status element.
	uatBasic = "-00a10ac13c236d890e940c5901e819802800;rs=6;"
	// A Ping/Pong line: long frame with its 14 Reed-Solomon parity bytes still appended.
	uatPing = "-08A5DFDF3907E982585F029B00040080105C3AB4BC5C240700A206000000000000003A13C82F96C80A63191F05FCB231;rs=1;ss=A2;"
)

type uatWant struct {
	icao       uint32
	addrType   uint8
	targetType uint8
	tail       string
	squawk     int
	emitter    uint8
	nic, nacp  int
	lat, lng   float64
	alt        int32
	altIsGNSS  bool
	gnssDiff   int32
	onGround   bool
	speed      uint16
	track      float64
	vvel       int16
}

// A recorded UAT downlink frame decodes to the same identity, position, altitude,
// velocity and accuracy that dump978's decoder reads from it. Track may differ from
// the true value by under a degree (it is truncated to whole degrees); everything
// else must match to the precision uat2text prints.
func TestUATDownlinkMatchesDump978(t *testing.T) {
	cases := []struct {
		name string
		line string
		want uatWant
	}{
		{"TIS-B airborne, no callsign", uatTISB, uatWant{
			icao: 0x2B48FE, addrType: 3, targetType: TARGET_TYPE_TISB, tail: "",
			nic: 6, nacp: 8, lat: 41.4380, lng: -84.1056, alt: 2300,
			speed: 117, track: trackOf(-65, -98), vvel: 0}},
		{"ADS-B with callsign and geometric secondary altitude", uatN230TX, uatWant{
			icao: 0xA20A3F, addrType: 0, targetType: TARGET_TYPE_ADSB, tail: "N230TX", emitter: 1,
			nic: 9, nacp: 10, lat: 42.2272, lng: -83.8938, alt: 3150, gnssDiff: 3125 - 3150,
			speed: 95, track: trackOf(9, -95), vvel: -384}},
		// No callsign in this frame: the tail is the registration looked up from the
		// address, which here agrees with the callsign the aircraft sends elsewhere.
		{"ADS-B squawking 1200", uatSquawk1200, uatWant{
			icao: 0xA20A3F, addrType: 0, targetType: TARGET_TYPE_ADSB, tail: "N230TX", squawk: 1200, emitter: 1,
			nic: 9, nacp: 10, lat: 42.2642, lng: -84.1250, alt: 3025, gnssDiff: 3000 - 3025,
			speed: 101, track: trackOf(-3, -101), vvel: 256}},
		{"ADS-B squawking 4032", uatSquawk4032, uatWant{
			icao: 0xA10AC1, addrType: 0, targetType: TARGET_TYPE_ADSB, tail: "N1663H", squawk: 4032, emitter: 1,
			nic: 9, nacp: 10, lat: 42.3394, lng: -83.6018, alt: 3900, gnssDiff: 4075 - 3900,
			speed: 129, track: trackOf(121, 46), vvel: 0}},
		{"TIS-B surface vehicle", uatGround, uatWant{
			icao: 0x2B42A5, addrType: 3, targetType: TARGET_TYPE_TISB, tail: "TCF3291",
			nic: 9, nacp: 9, lat: 42.2163, lng: -83.3610, alt: 525,
			onGround: true, speed: 31, track: 207}},
		{"basic frame, state vector only", uatBasic, uatWant{
			icao: 0xA10AC1, addrType: 0, targetType: TARGET_TYPE_ADSB, tail: "N1663H",
			nic: 9, lat: 42.2848, lng: -83.6318, alt: 3900,
			speed: 130, track: trackOf(121, 50), vvel: 64}},
		{"Ping line with parity bytes appended", uatPing, uatWant{
			icao: 0xA5DFDF, addrType: 0, targetType: TARGET_TYPE_ADSB, tail: "UAS SETS", emitter: 14,
			nic: 11, nacp: 10, lat: 40.0998, lng: -88.3510, alt: 0, altIsGNSS: true}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			withTrafficState(t)
			parseInput(c.line)
			ti, ok := traffic[c.want.icao]
			if !ok || len(traffic) != 1 {
				t.Fatalf("traffic table = %v; want exactly %06X", traffic, c.want.icao)
			}
			w := c.want
			if ti.Addr_type != w.addrType || ti.TargetType != w.targetType {
				t.Errorf("address type %d target type %d; want %d, %d", ti.Addr_type, ti.TargetType, w.addrType, w.targetType)
			}
			if ti.Tail != w.tail || ti.Squawk != w.squawk || ti.Emitter_category != w.emitter {
				t.Errorf("tail %q squawk %d emitter %d; want %q, %d, %d", ti.Tail, ti.Squawk, ti.Emitter_category, w.tail, w.squawk, w.emitter)
			}
			if ti.NIC != w.nic || ti.NACp != w.nacp {
				t.Errorf("NIC %d NACp %d; want %d, %d", ti.NIC, ti.NACp, w.nic, w.nacp)
			}
			if !ti.Position_valid || math.Abs(float64(ti.Lat)-w.lat) > 1e-4 || math.Abs(float64(ti.Lng)-w.lng) > 1e-4 {
				t.Errorf("position %v %.5f %.5f; want valid %.4f %.4f", ti.Position_valid, ti.Lat, ti.Lng, w.lat, w.lng)
			}
			if ti.Alt != w.alt || ti.AltIsGNSS != w.altIsGNSS || ti.GnssDiffFromBaroAlt != w.gnssDiff {
				t.Errorf("alt %d GNSS %v diff %d; want %d, %v, %d", ti.Alt, ti.AltIsGNSS, ti.GnssDiffFromBaroAlt, w.alt, w.altIsGNSS, w.gnssDiff)
			}
			if ti.OnGround != w.onGround || ti.Speed != w.speed || ti.Vvel != w.vvel {
				t.Errorf("on ground %v speed %d vvel %d; want %v, %d, %d", ti.OnGround, ti.Speed, ti.Vvel, w.onGround, w.speed, w.vvel)
			}
			if w.speed > 0 && angleDiff(float64(ti.Track), w.track) >= 1 {
				t.Errorf("track %.1f; want within 1 degree of %.2f", ti.Track, w.track)
			}
			if ti.Last_source != TRAFFIC_SOURCE_UAT || !ti.Last_seen.Equal(trafficT0) || !seenTraffic[w.icao] {
				t.Errorf("source %d last seen %v seen %v; want UAT, now, true", ti.Last_source, ti.Last_seen, seenTraffic[w.icao])
			}
		})
	}
}

// When the primary altitude is geometric and the AUXSV element carries a barometric
// one, the target is kept on pressure altitude (as every other source is) and the
// GNSS-minus-baro difference is recorded. uat2text, fed the N230TX frame with its
// altitude-type bit set, reads 3150 ft geometric and 3125 ft barometric.
func TestUATGeometricAltitudeSwappedForBaro(t *testing.T) {
	withTrafficState(t)
	parseInput(withUATByte(uatN230TX, 9, func(b byte) byte { return b | 0x01 }))
	ti := traffic[0xA20A3F]
	if ti.Alt != 3125 || ti.AltIsGNSS || ti.GnssDiffFromBaroAlt != 25 {
		t.Fatalf("alt %d GNSS %v diff %d; want 3125 ft baro, GNSS 25 ft above", ti.Alt, ti.AltIsGNSS, ti.GnssDiffFromBaroAlt)
	}
}

// A surface target's 9-bit track field covers the whole circle: every value h decodes
// to h*360/512 whole degrees, below 360. (It used to wrap for tracks of 128 degrees
// and more: 207 was shown as 79.)
func TestUATSurfaceTrackCoversTheCircle(t *testing.T) {
	for h := 0; h < 512; h++ {
		withTrafficState(t)
		line := withUATByte(uatGround, 14, func(byte) byte { return byte(h >> 1) })
		line = withUATByte(line, 15, func(b byte) byte { return b&0x7F | byte(h&1)<<7 })
		parseInput(line)
		if ti := traffic[0x2B42A5]; !ti.OnGround || ti.Track != float32(h*360/512) {
			t.Fatalf("track field %d: on ground %v track %.0f; want %d", h, ti.OnGround, ti.Track, h*360/512)
		}
	}
}

// The UAT address qualifier sets the target type: 0 ADS-B, 3 TIS-B, 6 ADS-R, and 2
// TIS-B with an ICAO address, which is taken as ADS-R when the target reports NIC >= 7
// and an emitter category (a rebroadcast ADS-B target rather than a radar track).
func TestUATAddressQualifierSetsTargetType(t *testing.T) {
	cases := []struct {
		name      string
		line      string
		qualifier byte
		want      uint8
	}{
		{"ADS-B", uatN230TX, 0, TARGET_TYPE_ADSB},
		{"TIS-B track file", uatTISB, 3, TARGET_TYPE_TISB},
		{"ADS-R", uatN230TX, 6, TARGET_TYPE_ADSR},
		{"ICAO-addressed, NIC 9 with emitter: ADS-R", uatN230TX, 2, TARGET_TYPE_ADSR},
		{"ICAO-addressed, NIC 6 without emitter: TIS-B", uatTISB, 2, TARGET_TYPE_TISB_S},
	}
	for _, c := range cases {
		withTrafficState(t)
		line := withUATByte(c.line, 0, func(b byte) byte { return b&^0x07 | c.qualifier })
		parseInput(line)
		if len(traffic) != 1 {
			t.Errorf("%s: %d targets; want 1", c.name, len(traffic))
		}
		for _, ti := range traffic {
			if ti.Addr_type != c.qualifier || ti.TargetType != c.want {
				t.Errorf("%s: address type %d target type %d; want %d, %d", c.name, ti.Addr_type, ti.TargetType, c.qualifier, c.want)
			}
		}
	}
}

// Robustness: a UAT line that is not a whole frame - noise or a truncated or merged
// line on the Ping/Pong serial link, or a hand-edited replay log - is dropped. It
// creates no target and never panics, since a panic takes the whole daemon down.
func TestUATMalformedLinesAreDropped(t *testing.T) {
	payload := strings.SplitN(uatTISB, ";", 2)[0][1:]
	cases := map[string]string{
		"sign only":                    "-;",
		"header only":                  "-" + payload[:8] + ";",
		"long frame cut to 18 bytes":   "-" + payload[:36] + ";",
		"long frame missing AUXSV":     "-" + payload[:58] + ";",
		"odd hex length":               "-" + payload[:len(payload)-1] + ";",
		"not hex":                      "-" + strings.Repeat("zz", 34) + ";",
		"two downlinks run together":   "-" + strings.Repeat(payload, 15) + ";",
		"uplink longer than an uplink": "+" + strings.Repeat("00", UPLINK_FRAME_DATA_BYTES+1) + ";",
	}
	for name, line := range cases {
		withTrafficState(t)
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("%s: parseInput panicked: %v", name, r)
				}
			}()
			parseInput(line)
		}()
		if len(traffic) != 0 {
			t.Errorf("%s: created %d targets; want none", name, len(traffic))
		}
	}
}

// One airliner (DLH8PK) as dump1090 reported it, in the order received: identity,
// airborne position, a Mode S altitude reply, an identity reply, airborne velocity
// and operational status. The messages fuse into one target carrying the latest of
// each field; the position message sets NIC 8 (type code 11, no supplement bit) and
// the operational status message the NACp.
func TestES1090MessagesFuseIntoOneTarget(t *testing.T) {
	withTrafficState(t)
	ownshipAt(43.0, 12.0, 3000)
	for _, line := range []string{
		`{"Icao_addr":3957933,"DF":17,"CA":5,"TypeCode":4,"SubtypeCode":3,"SignalLevel":0.000947,"Gain":37.200000,"IsMlat":false,"Tail":"DLH8PK  ","Alt":null,"AltIsGNSS":false,"GnssDiffFromBaroAlt":1275,"Speed_valid":false,"Speed":null,"Track":null,"Lat":null,"Lng":null,"Position_valid":false,"Vvel":null,"Squawk":null,"OnGround":false,"NACp":null,"Emitter_category":3,"Timestamp":"2026-09-13T10:12:06.156Z"}`,
		`{"Icao_addr":3957933,"DF":17,"CA":5,"TypeCode":11,"SubtypeCode":0,"SignalLevel":0.000654,"Gain":37.200000,"IsMlat":false,"Tail":null,"Alt":20550,"AltIsGNSS":false,"GnssDiffFromBaroAlt":1275,"Speed_valid":false,"Speed":null,"Track":null,"Lat":43.063473,"Lng":12.082868,"Position_valid":true,"Vvel":null,"Squawk":null,"OnGround":false,"NACp":null,"Emitter_category":null,"Timestamp":"2026-09-13T10:12:06.200Z"}`,
		`{"Icao_addr":3957933,"DF":20,"CA":0,"TypeCode":0,"SubtypeCode":0,"SignalLevel":0.001022,"Gain":37.200000,"IsMlat":false,"Tail":null,"Alt":20525,"AltIsGNSS":false,"GnssDiffFromBaroAlt":1275,"Speed_valid":false,"Speed":null,"Track":null,"Lat":null,"Lng":null,"Position_valid":false,"Vvel":null,"Squawk":null,"OnGround":null,"NACp":null,"Emitter_category":null,"Timestamp":"2026-09-13T10:12:06.641Z"}`,
		`{"Icao_addr":3957933,"DF":21,"CA":0,"TypeCode":0,"SubtypeCode":0,"SignalLevel":0.001348,"Gain":37.200000,"IsMlat":false,"Tail":null,"Alt":null,"AltIsGNSS":false,"GnssDiffFromBaroAlt":1275,"Speed_valid":false,"Speed":null,"Track":null,"Lat":null,"Lng":null,"Position_valid":false,"Vvel":-2432,"Squawk":1000,"OnGround":null,"NACp":null,"Emitter_category":null,"Timestamp":"2026-09-13T10:12:06.656Z"}`,
		`{"Icao_addr":3957933,"DF":17,"CA":5,"TypeCode":19,"SubtypeCode":1,"SignalLevel":0.001227,"Gain":37.200000,"IsMlat":false,"Tail":null,"Alt":null,"AltIsGNSS":false,"GnssDiffFromBaroAlt":1250,"Speed_valid":true,"Speed":457,"Track":171,"Lat":null,"Lng":null,"Position_valid":false,"Vvel":-2624,"Squawk":null,"OnGround":false,"NACp":null,"Emitter_category":null,"Timestamp":"2026-09-13T10:12:06.742Z"}`,
		`{"Icao_addr":3957933,"DF":17,"CA":5,"TypeCode":29,"SubtypeCode":1,"SignalLevel":0.000226,"Gain":37.200000,"IsMlat":false,"Tail":null,"Alt":null,"AltIsGNSS":false,"GnssDiffFromBaroAlt":1250,"Speed_valid":false,"Speed":null,"Track":null,"Lat":null,"Lng":null,"Position_valid":false,"Vvel":null,"Squawk":null,"OnGround":false,"NACp":9,"Emitter_category":null,"Timestamp":"2026-09-13T10:12:08.966Z"}`,
	} {
		parseDump1090Message(line)
	}
	ti, ok := traffic[0x3C64AD]
	if !ok || len(traffic) != 1 {
		t.Fatalf("traffic table = %v; want exactly 3C64AD", traffic)
	}
	if ti.Tail != "DLH8PK" || ti.Squawk != 1000 || ti.Emitter_category != 3 || ti.Reg != "" {
		t.Errorf("tail %q squawk %d emitter %d reg %q; want DLH8PK, 1000, 3, none", ti.Tail, ti.Squawk, ti.Emitter_category, ti.Reg)
	}
	if !ti.Position_valid || ti.Lat != float32(43.063473) || ti.Lng != float32(12.082868) || ti.Alt != 20525 || ti.AltIsGNSS {
		t.Errorf("position %v %f %f alt %d GNSS %v; want 43.063473 12.082868 at 20525 ft baro", ti.Position_valid, ti.Lat, ti.Lng, ti.Alt, ti.AltIsGNSS)
	}
	if !ti.Speed_valid || ti.Speed != 457 || ti.Track != 171 || ti.Vvel != -2624 || ti.OnGround {
		t.Errorf("speed %v %d track %.0f vvel %d ground %v; want 457 kt, 171, -2624 fpm, airborne", ti.Speed_valid, ti.Speed, ti.Track, ti.Vvel, ti.OnGround)
	}
	if ti.NIC != 8 || ti.NACp != 9 || ti.GnssDiffFromBaroAlt != 1250 {
		t.Errorf("NIC %d NACp %d GNSS diff %d; want 8, 9, 1250", ti.NIC, ti.NACp, ti.GnssDiffFromBaroAlt)
	}
	if ti.TargetType != TARGET_TYPE_ADSB || ti.Addr_type != 0 || ti.Last_source != TRAFFIC_SOURCE_1090ES {
		t.Errorf("type %d address type %d source %d; want ADS-B, 0, 1090ES", ti.TargetType, ti.Addr_type, ti.Last_source)
	}
	// About 9.8 km north-east of ownship.
	wantDist, wantBrg := common.Distance(43.0, 12.0, float64(ti.Lat), float64(ti.Lng))
	if !ti.BearingDist_valid || math.Abs(ti.Distance-wantDist) > 1 || math.Abs(ti.Bearing-wantBrg) > 0.01 {
		t.Errorf("bearing/distance %v %.1f m %.2f; want %.1f m %.2f", ti.BearingDist_valid, ti.Distance, ti.Bearing, wantDist, wantBrg)
	}
	if ti.ReceivedMsgs != 6 {
		t.Errorf("received messages %d; want 6", ti.ReceivedMsgs)
	}
}

// A Mode S target that never sends a position (Mode S without ADS-B, here an Italian
// GA aircraft at 3000 ft) is tracked by altitude only: no position, "last seen" moves
// with the altitude replies, and its distance is estimated from signal strength so it
// can be shown as bearingless traffic.
func TestES1090ModeSOnlyTargetIsBearingless(t *testing.T) {
	withTrafficState(t)
	parseDump1090Message(`{"Icao_addr":3146723,"DF":0,"CA":0,"TypeCode":0,"SubtypeCode":0,"SignalLevel":0.000357,"Gain":37.200000,"IsMlat":false,"Tail":null,"Alt":3000,"AltIsGNSS":false,"GnssDiffFromBaroAlt":null,"Speed_valid":false,"Speed":null,"Track":null,"Lat":null,"Lng":null,"Position_valid":false,"Vvel":null,"Squawk":null,"OnGround":null,"NACp":null,"Emitter_category":null,"Timestamp":"2026-09-13T10:25:57.774Z"}`)
	ti := traffic[0x3003E3]
	if ti.Position_valid || ti.Alt != 3000 || ti.TargetType != TARGET_TYPE_MODE_S || ti.Tail != "" {
		t.Errorf("position %v alt %d type %d tail %q; want none, 3000, Mode S, none", ti.Position_valid, ti.Alt, ti.TargetType, ti.Tail)
	}
	if !ti.Last_seen.Equal(ti.Last_alt) || !ti.Last_alt.Equal(trafficT0) {
		t.Errorf("last seen %v last alt %v; want both now", ti.Last_seen, ti.Last_alt)
	}
	if want := 10 * math.Log10(0.000357); math.Abs(ti.SignalLevel-want) > 1e-9 {
		t.Errorf("signal %.2f dB; want %.2f", ti.SignalLevel, want)
	}
	// 6 dB weaker is twice as far, scaled by the learned factor for targets below 5000 ft
	// (2500 m at start-up, so about 136 km for this -34.5 dB reply).
	if want := math.Pow(2, -ti.SignalLevel/6) * estimatedDistFactors[0]; math.Abs(ti.DistanceEstimated-want) > 1 {
		t.Errorf("estimated distance %.0f m; want %.0f", ti.DistanceEstimated, want)
	}
}

// dump1090's heartbeat (address 0x07FFFFFF) is not a target, and the non-ICAO flag
// (bit 24, set for TIS-B track numbers) is stripped from the address.
func TestES1090HeartbeatAndNonICAOAddress(t *testing.T) {
	withTrafficState(t)
	parseDump1090Message(`{"Icao_addr":134217727,"DF":0}`)
	if len(traffic) != 0 {
		t.Errorf("heartbeat created %d targets", len(traffic))
	}
	parseDump1090Message(`{"Icao_addr":16777217,"DF":18,"CA":5,"Alt":4500}`)
	if ti, ok := traffic[0x000001]; !ok || len(traffic) != 1 || ti.TargetType != TARGET_TYPE_TISB || ti.Addr_type != 3 {
		t.Errorf("traffic table = %v; want TIS-B target 000001", traffic)
	}
}

// Robustness: a line from dump1090 that is not a message object is logged and
// dropped. It creates no target and never panics.
func TestES1090MalformedLinesAreDropped(t *testing.T) {
	for _, line := range []string{"", "{", "null", "[]", "42", `"text"`, `{"Icao_addr":"4D2516"}`, `{"Icao_addr":-1}`} {
		withTrafficState(t)
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("%q: parseDump1090Message panicked: %v", line, r)
				}
			}()
			parseDump1090Message(line)
		}()
		if len(traffic) != 0 {
			t.Errorf("%q: created %d targets; want none", line, len(traffic))
		}
	}
}

// The worked Traffic Report example of the GDL90 ICD: N825V, ICAO 52642511 octal,
// 44.90708 -122.99488, 5000 ft pressure altitude, airborne, true track, NIC 10 NACp 9,
// 123 kt on 45 degrees climbing 64 fpm, light aircraft, no alert, no emergency.
func TestTrafficReportMatchesGDL90Example(t *testing.T) {
	withTrafficState(t)
	ti := TrafficInfo{
		Icao_addr: 0xAB4549, Addr_type: 0, Lat: 44.90708, Lng: -122.99488, Alt: 5000,
		NIC: 10, NACp: 9, Speed: 123, Speed_valid: true, Vvel: 64, Track: 45,
		Emitter_category: 1, Tail: "N825V", BearingDist_valid: true, Distance: 10000,
	}
	want := []byte{0x14, 0x00, 0xAB, 0x45, 0x49, 0x1F, 0xEF, 0x15, 0xA8, 0x89, 0x78, 0x0F, 0x09, 0xA9,
		0x07, 0xB0, 0x01, 0x20, 0x01, 0x4E, 0x38, 0x32, 0x35, 0x56, 0x20, 0x20, 0x20, 0x00}
	got := gdl90Payload(t, makeTrafficReportMsg(ti))
	// The ICD truncates -122.99488 to A88978; float32 division rounds it to the nearer
	// A88977. Either is within the field's resolution (2.1e-5 degrees, under 2 m).
	for _, at := range []int{5, 8} {
		g := int(got[at])<<16 | int(got[at+1])<<8 | int(got[at+2])
		w := int(want[at])<<16 | int(want[at+1])<<8 | int(want[at+2])
		if g-w >= -1 && g-w <= 1 {
			copy(got[at:at+3], want[at:at+3])
		}
	}
	// Accepted deviation: the ICD pads a short callsign with spaces; Stratux has always
	// left the unused bytes 0x00 (the ownship report too) and EFBs accept both.
	for i := 19 + len(ti.Tail); i < 27; i++ {
		if got[i] == 0x00 {
			got[i] = 0x20
		}
	}
	if string(got) != string(want) {
		t.Fatalf("payload\n % X\nwant\n % X", got, want)
	}
}

// Pressure altitude is sent in 25 ft steps offset by 1000 ft, as the ICD tabulates;
// outside -1000..101350 ft it is sent as 0xFFF, "invalid or unavailable".
func TestTrafficReportAltitudeEncoding(t *testing.T) {
	withTrafficState(t)
	for alt, want := range map[int32]int{-1000: 0x000, 0: 0x028, 1000: 0x050, 5000: 0x0F0, 101350: 0xFFE, -1025: 0xFFF, 101375: 0xFFF} {
		p := gdl90Payload(t, makeTrafficReportMsg(TrafficInfo{Alt: alt}))
		if got := int(p[11])<<4 | int(p[12])>>4; got != want {
			t.Errorf("altitude %d ft encoded %03X; want %03X", alt, got, want)
		}
	}
}

// A target that reports GNSS height (above the WGS-84 ellipsoid) is sent at the
// pressure altitude ownship's own baro/GNSS offset gives it: height minus geoid
// separation is MSL, shifted by ownship's (pressure altitude - GPS MSL).
func TestTrafficReportConvertsGNSSHeightToPressureAltitude(t *testing.T) {
	withTrafficState(t)
	ownshipAt(45, 9, 3000)
	mySituation.BaroPressureAltitude = 2800 // pressure altitude 200 ft below GPS MSL
	mySituation.GPSGeoidSep = 150           // ellipsoid height 150 ft above MSL
	p := gdl90Payload(t, makeTrafficReportMsg(TrafficInfo{Alt: 4150, AltIsGNSS: true}))
	if got := int(p[11])<<4 | int(p[12])>>4; got != (3800/25)+40 {
		t.Fatalf("encoded %03X; want 3800 ft (%03X)", got, (3800/25)+40)
	}
}

// The alert bit is set for traffic within 2 NM, and for traffic whose distance cannot
// be computed, so a target of unknown range is never presented as harmless.
func TestTrafficReportAlertWithinTwoNM(t *testing.T) {
	withTrafficState(t)
	cases := []struct {
		ti   TrafficInfo
		want bool
	}{
		{TrafficInfo{BearingDist_valid: true, Distance: 3703}, true},
		{TrafficInfo{BearingDist_valid: true, Distance: 3705}, false},
		{TrafficInfo{BearingDist_valid: false}, true},
	}
	for _, c := range cases {
		p := gdl90Payload(t, makeTrafficReportMsg(c.ti))
		if got := p[1]&0x10 != 0; got != c.want {
			t.Errorf("valid %v distance %.0f m: alert %v; want %v", c.ti.BearingDist_valid, c.ti.Distance, got, c.want)
		}
	}
}

// The "m" nibble flags an extrapolated report and an on-ground target; vertical speed
// is a signed 12-bit count of 64 fpm; the priority code fills the high nibble of the
// last byte; and the callsign is cut to 8 characters, anything but digits, capitals
// and space (and the source-prefix letters e u a r t) becoming a space.
func TestTrafficReportFlagsVerticalSpeedAndCallsign(t *testing.T) {
	withTrafficState(t)
	p := gdl90Payload(t, makeTrafficReportMsg(TrafficInfo{
		ExtrapolatedPosition: true, OnGround: true, Vvel: -640, PriorityStatus: 4, Tail: "D-EDAD/x.123"}))
	if m := p[12] & 0x0F; m != 0x04 {
		t.Errorf("m nibble %X; want 4 (extrapolated, on ground, no track)", m)
	}
	if v := int(p[15]&0x0F)<<8 | int(p[16]); v != 0xFF6 {
		t.Errorf("vertical velocity %03X; want FF6 (-10 x 64 fpm)", v)
	}
	if p[27] != 0x40 {
		t.Errorf("priority byte %02X; want 40", p[27])
	}
	if cs := string(p[19:27]); cs != "D EDAD  " {
		t.Errorf("callsign %q; want %q", cs, "D EDAD  ")
	}
}

// A UAT frame as heard reaches the EFB with the same identity, position, altitude
// and velocity: the decoded target, re-encoded as a GDL90 traffic report, carries
// dump978's values to the resolution of the GDL90 fields.
func TestUATFrameToTrafficReport(t *testing.T) {
	withTrafficState(t)
	parseInput(uatTISB)
	p := gdl90Payload(t, makeTrafficReportMsg(traffic[0x2B48FE]))
	if p[1]&0x0F != 3 || p[2] != 0x2B || p[3] != 0x48 || p[4] != 0xFE {
		t.Errorf("address type/address % X; want 3, 2B48FE", p[1:5])
	}
	if lat, lng := gdl90LatLng(p[5:8]), gdl90LatLng(p[8:11]); math.Abs(lat-41.4380) > 1e-4 || math.Abs(lng+84.1056) > 1e-4 {
		t.Errorf("position %.5f %.5f; want 41.4380 -84.1056", lat, lng)
	}
	if alt := (int(p[11])<<4|int(p[12])>>4)*25 - 1000; alt != 2300 {
		t.Errorf("altitude %d; want 2300", alt)
	}
	if p[13] != 0x68 {
		t.Errorf("NIC/NACp %02X; want 68", p[13])
	}
	if speed := int(p[14])<<4 | int(p[15])>>4; speed != 117 {
		t.Errorf("speed %d; want 117", speed)
	}
	if trk := float64(p[17]) * 360 / 256; angleDiff(trk, trackOf(-65, -98)) > 360.0/256+1 {
		t.Errorf("track %.1f; want %.1f to one step", trk, trackOf(-65, -98))
	}
}

// faaNNumbers lists every civil N-number in the order the FAA assigns Mode S
// addresses from A00001: each prefix of digits is followed by its letter suffixes
// (one letter, or two while the total stays within five characters; I and O are
// not used) and then by its ten digit extensions. Written from that rule, not from
// icao2reg's arithmetic.
func faaNNumbers() []string {
	const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
	var out []string
	var walk func(prefix string)
	walk = func(prefix string) {
		out = append(out, "N"+prefix)
		if len(prefix) == 5 {
			return
		}
		for _, l1 := range letters {
			out = append(out, "N"+prefix+string(l1))
			if len(prefix) <= 3 {
				for _, l2 := range letters {
					out = append(out, "N"+prefix+string(l1)+string(l2))
				}
			}
		}
		for d := '0'; d <= '9'; d++ {
			walk(prefix + string(d))
		}
	}
	for d := '1'; d <= '9'; d++ {
		walk(string(d))
	}
	return out
}

// Every US civil address A00001..ADF7C7 maps to the N-number the FAA assigned it,
// and the registry ends exactly at ADF7C7 = N99999.
func TestIcao2RegCoversTheFAARegistry(t *testing.T) {
	all := faaNNumbers()
	if last := uint32(0xA00001 + len(all) - 1); last != 0xADF7C7 || all[len(all)-1] != "N99999" {
		t.Fatalf("registry ends at %06X %s; want ADF7C7 N99999", last, all[len(all)-1])
	}
	bad := 0
	for i, want := range all {
		icao := uint32(0xA00001 + i)
		if got, ok := icao2reg(icao); got != want || !ok {
			if bad++; bad <= 10 {
				t.Errorf("icao2reg(%06X) = %q, %v; want %q", icao, got, ok, want)
			}
		}
	}
	if bad > 10 {
		t.Errorf("... %d addresses wrong in all", bad)
	}
}

// Real aircraft that broadcast their registration as callsign: two GA aircraft in the
// 2015 Michigan UAT log and three US business jets over Italy in the I-RVDX 1090 log.
func TestIcao2RegMatchesBroadcastRegistrations(t *testing.T) {
	for icao, want := range map[uint32]string{
		0xA10AC1: "N1663H", 0xA20A3F: "N230TX",
		0xA55A2A: "N444HB", 0xA9A7C8: "N721FH", 0xA88CBE: "N650AD",
	} {
		if got, ok := icao2reg(icao); got != want || !ok {
			t.Errorf("icao2reg(%06X) = %q, %v; want %q", icao, got, ok, want)
		}
	}
}

// Addresses outside the US and Canadian civil blocks yield no registration: other
// states (here Italy and Germany), US non-civil, and Canadian non-civil. The first
// and last Canadian civil addresses are C-FAAA and C-IZZZ.
func TestIcao2RegOutsideCivilBlocks(t *testing.T) {
	cases := []struct {
		icao uint32
		want string
		ok   bool
	}{
		{0x3003E3, "OTHER", false}, {0x3C64AD, "OTHER", false}, {0xA00000, "OTHER", false},
		{0xADF7C8, "US-MIL", false}, {0xAFFFFF, "US-MIL", false},
		{0xC00001, "C-FAAA", true}, {0xC0CDF8, "C-IZZZ", true}, {0xC0CDF9, "CA-MIL", false},
		{0x7C0000 + 26*36*36, "OTHER", false}, {0x7C0000 + 26*36, "OTHER", false},
	}
	for _, c := range cases {
		if got, ok := icao2reg(c.icao); got != c.want || ok != c.ok {
			t.Errorf("icao2reg(%06X) = %q, %v; want %q, %v", c.icao, got, ok, c.want, c.ok)
		}
	}
}

// The ownship filter: a report from one of the configured ownship codes is taken as
// ownship only when it is where ownship is; a target using the code somewhere else
// (another aircraft the pilot also flies, airborne now) stays visible as traffic. A
// report that cannot be checked is hidden but not used as ownship.
func TestOwnshipFilter(t *testing.T) {
	near := TrafficInfo{Icao_addr: 0x3003E3, Position_valid: true, Lat: 43.0, Lng: 12.0, Alt: 3000}
	far := near
	far.Lat = 43.2 // 22 km north
	above := near
	above.Alt = 4000
	noPos := TrafficInfo{Icao_addr: 0x3003E3, Alt: 3000}
	other := near
	other.Icao_addr = 0x3C64AD
	cases := []struct {
		name        string
		codes       string
		baro        bool
		ti          TrafficInfo
		own, ignore bool
	}{
		{"not an ownship code", "3003E3", true, other, false, false},
		{"ownship code, here", "3003E3", true, near, true, true},
		{"one of several codes, spaced", "4B1A24, 3003e3", true, near, true, true},
		{"ownship code, 22 km away", "3003E3", true, far, false, false},
		{"ownship code, 1000 ft above", "3003E3", true, above, false, false},
		{"ownship code, no position", "3003E3", true, noPos, false, true},
		{"ownship code, no baro to compare", "3003E3", false, near, false, true},
	}
	for _, c := range cases {
		withTrafficState(t)
		ownshipAt(43.0, 12.0, 3000)
		mySituation.GPSGroundSpeed = 90
		if !c.baro {
			mySituation.BaroLastMeasurementTime = stratuxClock.Time.Add(-time.Minute)
		}
		globalSettings.OwnshipModeS = c.codes
		if own, ignore := isOwnshipTrafficInfo(c.ti); own != c.own || ignore != c.ignore {
			t.Errorf("%s: ownship %v ignore %v; want %v, %v", c.name, own, ignore, c.own, c.ignore)
		}
	}
}

// Dead reckoning: a target not heard for 30 s at 120 kt on 090 is moved 1 NM east and
// by 30 s of its vertical speed; the last real fix is kept, and the next step starts
// from the previous extrapolation rather than the fix, so nothing is counted twice.
func TestExtrapolateTraffic(t *testing.T) {
	withTrafficState(t)
	ti := TrafficInfo{Position_valid: true, Lat: 45, Lng: 9, Alt: 3000, Vvel: 500, Speed: 120, Speed_valid: true,
		Track: 90, Last_seen: trafficT0.Add(-30 * time.Second)}
	extrapolateTraffic(&ti)
	dist, brg := common.Distance(45, 9, float64(ti.Lat), float64(ti.Lng))
	if math.Abs(dist-1852) > 5 || math.Abs(brg-90) > 0.1 || ti.Alt != 3250 {
		t.Errorf("moved %.0f m on %.1f to %d ft; want 1852 m on 090 to 3250 ft", dist, brg, ti.Alt)
	}
	if !ti.ExtrapolatedPosition || ti.Lat_fix != 45 || ti.Lng_fix != 9 || ti.Alt_fix != 3000 || !ti.Last_extrapolation.Equal(trafficT0) {
		t.Errorf("extrapolated %v fix %v %v %d at %v; want true, the original fix, now", ti.ExtrapolatedPosition, ti.Lat_fix, ti.Lng_fix, ti.Alt_fix, ti.Last_extrapolation)
	}
	stratuxClock.Time = trafficT0.Add(30 * time.Second)
	extrapolateTraffic(&ti)
	if dist, _ := common.Distance(45, 9, float64(ti.Lat), float64(ti.Lng)); math.Abs(dist-2*1852) > 10 || ti.Alt != 3500 {
		t.Errorf("after 60 s: %.0f m, %d ft; want 3704 m, 3500 ft", dist, ti.Alt)
	}
}

// A turning target keeps turning at its last turn rate, and its track stays in 0..360.
func TestExtrapolateTrafficTurnWrapsTrack(t *testing.T) {
	withTrafficState(t)
	for _, c := range []struct{ track, rate, want float32 }{{350, 3, 80}, {10, -3, 280}} {
		ti := TrafficInfo{Position_valid: true, Lat: 45, Lng: 9, Speed: 100, Track: c.track, TurnRate: c.rate,
			Last_seen: trafficT0.Add(-30 * time.Second)}
		extrapolateTraffic(&ti)
		if ti.Track != c.want {
			t.Errorf("track %.0f turning %.0f deg/s for 30 s: %.0f; want %.0f", c.track, c.rate, ti.Track, c.want)
		}
	}
}

// The destination point at a bearing and distance agrees with the great-circle
// distance and bearing back to it, and longitude wraps across the antimeridian.
func TestCalcLocationForBearingDistance(t *testing.T) {
	for _, c := range []struct{ lat, lon, brg, nm float64 }{{43, 12, 45, 10}, {-33.9, 151.2, 200, 50}, {60, -150, 300, 120}} {
		lat, lon := calcLocationForBearingDistance(c.lat, c.lon, c.brg, c.nm)
		dist, brg := common.Distance(c.lat, c.lon, lat, lon)
		if math.Abs(dist-c.nm*1852) > c.nm*1852*0.005 || angleDiff(brg, c.brg) > 0.5 {
			t.Errorf("%v: got %.0f m on %.1f; want %.0f m on %.0f", c, dist, brg, c.nm*1852, c.brg)
		}
	}
	if _, lon := calcLocationForBearingDistance(0, 179.9, 90, 30); lon < -180 || lon > -179 {
		t.Errorf("30 NM east of 179.9E: longitude %.3f; want about -179.6", lon)
	}
}

// captureConn is a client connection that keeps every message sent to it.
type captureConn struct{ q *MessageQueue }

func (c *captureConn) GetConnectionKey() string    { return "test" }
func (c *captureConn) MessageQueue() *MessageQueue { return c.q }
func (c *captureConn) Writer() io.Writer           { return io.Discard }
func (c *captureConn) IsThrottled() bool           { return false }
func (c *captureConn) IsSleeping() bool            { return false }
func (c *captureConn) Capabilities() uint8         { return NETWORK_FLARM_NMEA }
func (c *captureConn) GetDesiredPacketSize() int   { return 0 }
func (c *captureConn) OnError(error)               {}
func (c *captureConn) Close()                      {}

// trafficCycle is what one sendTrafficUpdates() run sent: GDL90 traffic reports and
// targets pushed to the radar and web sockets, by address, and the FLARM sentences.
type trafficCycle struct {
	gdl90 map[uint32][]byte
	radar map[uint32]TrafficInfo
	web   map[uint32]TrafficInfo
	flarm []string
}

// pflaa returns the PFLAA sentence for the given ID, or "".
func (c trafficCycle) pflaa(id string) string {
	for _, s := range c.flarm {
		if strings.HasPrefix(s, "$PFLAA,") && strings.Split(s, ",")[6] == id {
			return s
		}
	}
	return ""
}

// captureTrafficOutputs points the GDL90, FLARM, radar and web outputs at buffers and
// returns a function that runs one sendTrafficUpdates() cycle and reads them back.
func captureTrafficOutputs(t *testing.T) func() trafficCycle {
	gdlChan, netMu, conns, loopMap, loopMu, radar, web := networkGDL90Chan, netMutex, clientConnections, avoidLoopBackMap, avoidLoopBackMutex, radarUpdate, trafficUpdate
	t.Cleanup(func() {
		networkGDL90Chan, netMutex, clientConnections, avoidLoopBackMap, avoidLoopBackMutex, radarUpdate, trafficUpdate = gdlChan, netMu, conns, loopMap, loopMu, radar, web
	})
	networkGDL90Chan = make(chan []byte, 1024)
	netMutex = &sync.Mutex{}
	avoidLoopBackMap = make(map[string]string)
	avoidLoopBackMutex = &sync.Mutex{}
	radarUpdate = &uibroadcaster{sockets_mu: &sync.Mutex{}, messages: make(chan []byte, 1024)}
	trafficUpdate = &uibroadcaster{sockets_mu: &sync.Mutex{}, messages: make(chan []byte, 1024)}
	targets := func(ch chan []byte) map[uint32]TrafficInfo {
		m := make(map[uint32]TrafficInfo)
		for len(ch) > 0 {
			var ti TrafficInfo
			if err := json.Unmarshal(<-ch, &ti); err != nil {
				t.Fatal(err)
			}
			m[ti.Icao_addr] = ti
		}
		return m
	}
	return func() trafficCycle {
		conn := &captureConn{q: NewMessageQueue(1024)}
		clientConnections = map[string]connection{"test": conn}
		sendTrafficUpdates()
		c := trafficCycle{gdl90: make(map[uint32][]byte), radar: targets(radarUpdate.messages), web: targets(trafficUpdate.messages)}
		for len(networkGDL90Chan) > 0 {
			for _, p := range gdl90Frames(t, <-networkGDL90Chan) {
				if p[0] == 0x14 {
					c.gdl90[uint32(p[2])<<16|uint32(p[3])<<8|uint32(p[4])] = p
				}
			}
		}
		for _, d := range conn.q.GetQueueDump(false) {
			c.flarm = append(c.flarm, string(d.([]byte)))
		}
		return c
	}
}

// heard puts a 1090 ADS-B target in the table whose last position report is `ago`
// old, `north` NM north of ownship (43N 12E, from trafficCycleAt), at alt feet.
func heard(icao uint32, ago time.Duration, north float64, alt int32) TrafficInfo {
	lat, lng := calcLocationForBearingDistance(43, 12, 0, north)
	at := stratuxClock.Time.Add(-ago)
	ti := TrafficInfo{Icao_addr: icao, Position_valid: true, Lat: float32(lat), Lng: float32(lng), Alt: alt,
		Speed: 100, Speed_valid: true, Track: 180, TargetType: TARGET_TYPE_ADSB, Last_source: TRAFFIC_SOURCE_1090ES,
		Last_seen: at, Last_alt: at}
	traffic[icao] = ti
	return ti
}

// heardModeS puts a position-less Mode S target in the table, last heard `ago`, with a
// distance estimated from its signal strength.
func heardModeS(icao uint32, ago time.Duration, estimatedMeters float64, alt int32) {
	at := stratuxClock.Time.Add(-ago)
	traffic[icao] = TrafficInfo{Icao_addr: icao, Alt: alt, DistanceEstimated: estimatedMeters,
		Last_source: TRAFFIC_SOURCE_1090ES, Last_seen: at, Last_alt: at}
}

// trafficCycleAt sets up a sendTrafficUpdates() test: ownship at 43N 12E, 3000 ft
// baro and GPS, with the default radar limits (2000 ft, 10 NM).
func trafficCycleAt(t *testing.T) func() trafficCycle {
	withTrafficState(t)
	run := captureTrafficOutputs(t)
	ownshipAt(43, 12, 3000)
	globalSettings.RadarLimits = 2000
	globalSettings.RadarRange = 10
	return run
}

// Stale data is not presented as current: a position report under 6 s old goes to the
// EFB (GDL90 and FLARM) and the radar; at 6 s it goes to neither, though the target
// stays in the table and the web UI is sent its growing age.
func TestTrafficCycleDropsReportsOlderThanSixSeconds(t *testing.T) {
	run := trafficCycleAt(t)
	heard(0x4D2516, 5900*time.Millisecond, 3, 3000)
	heard(0x3C64AD, 6*time.Second, 3, 3000)
	c := run()
	if _, ok := c.gdl90[0x4D2516]; !ok || c.pflaa("4D2516") == "" {
		t.Errorf("5.9 s old report not sent to the EFB: GDL90 %v, FLARM %q", ok, c.flarm)
	}
	if _, ok := c.radar[0x4D2516]; !ok {
		t.Errorf("5.9 s old report not sent to the radar")
	}
	if _, ok := c.gdl90[0x3C64AD]; ok || c.pflaa("3C64AD") != "" {
		t.Errorf("6 s old report sent to the EFB")
	}
	if _, ok := c.radar[0x3C64AD]; ok {
		t.Errorf("6 s old report sent to the radar")
	}
	if ti, ok := c.web[0x3C64AD]; !ok || ti.Age != 6 {
		t.Errorf("web UI got %v age %.1f; want the stale target at age 6", ok, ti.Age)
	}
	if _, ok := traffic[0x3C64AD]; !ok {
		t.Errorf("stale target removed from the table")
	}
}

// A dead-reckoned target is sent, flagged as extrapolated, while the extrapolator keeps
// it fresh (under 2 s) and its last real report is under 25 s old; past either limit
// it is not sent.
func TestTrafficCycleExtrapolatedTargetLimits(t *testing.T) {
	run := trafficCycleAt(t)
	for icao, ages := range map[uint32][2]time.Duration{
		0x000001: {20 * time.Second, time.Second},     // report 20 s, extrapolated 1 s ago
		0x000002: {25 * time.Second, time.Second},     // report too old
		0x000003: {10 * time.Second, 2 * time.Second}, // extrapolator stalled
	} {
		ti := heard(icao, ages[0], 3, 3000)
		ti.ExtrapolatedPosition = true
		ti.Last_extrapolation = stratuxClock.Time.Add(-ages[1])
		traffic[icao] = ti
	}
	c := run()
	if p, ok := c.gdl90[0x000001]; !ok || p[12]&0x04 == 0 {
		t.Errorf("fresh extrapolation: sent %v; want sent with the extrapolated flag", ok)
	}
	for _, icao := range []uint32{0x000002, 0x000003} {
		if _, ok := c.gdl90[icao]; ok {
			t.Errorf("%06X sent; want dropped", icao)
		}
	}
}

// Targets leave the table 60 s after they were last heard, keeping identity across
// short gaps; AIS vessels, which report far less often, are kept for 15 minutes.
func TestTrafficCycleExpiresTargets(t *testing.T) {
	run := trafficCycleAt(t)
	heard(0x000001, 59*time.Second, 3, 3000)
	heard(0x000002, 61*time.Second, 3, 3000)
	for icao, ago := range map[uint32]time.Duration{0x000003: 61 * time.Second, 0x000004: 15*time.Minute + time.Second} {
		ti := heard(icao, ago, 3, 0)
		ti.Last_source = TRAFFIC_SOURCE_AIS
		traffic[icao] = ti
	}
	run()
	for icao, want := range map[uint32]bool{1: true, 2: false, 3: true, 4: false} {
		if _, ok := traffic[icao]; ok != want {
			t.Errorf("%06X in table %v; want %v", icao, ok, want)
		}
	}
}

// The radar shows traffic within 1.3 x RadarLimits of ownship altitude and within
// 1.3 x RadarRange; a Mode S target without position passes the range limit. The
// limits apply to the radar only: the EFB still gets every current target.
func TestTrafficCycleRadarLimits(t *testing.T) {
	run := trafficCycleAt(t)
	heard(0x000001, time.Second, 3, 3000+2590)
	heard(0x000002, time.Second, 3, 3000+2610)
	heard(0x000003, time.Second, 3, 3000-2610)
	heard(0x000004, time.Second, 12.9, 3000)
	heard(0x000005, time.Second, 13.1, 3000)
	heardModeS(0x000006, time.Second, 40000, 3500)
	c := run()
	for icao, want := range map[uint32]bool{1: true, 2: false, 3: false, 4: true, 5: false, 6: true} {
		if _, ok := c.radar[icao]; ok != want {
			t.Errorf("%06X on radar %v; want %v", icao, ok, want)
		}
	}
	for icao := uint32(1); icao <= 5; icao++ {
		if _, ok := c.gdl90[icao]; !ok {
			t.Errorf("%06X not sent to the EFB", icao)
		}
	}
}

// Without a current baro reading the radar's altitude band is centred on GPS altitude:
// both when there has never been a pressure sensor (pressure altitude reads 0) and
// when it stopped a minute ago (pressure altitude frozen at its last value).
func TestTrafficCycleRadarFallsBackToGPSAltitude(t *testing.T) {
	for name, c := range map[string]struct {
		frozen float32
		last   time.Duration // since the last pressure reading; 0: never
	}{"no pressure sensor": {0, 0}, "pressure sensor lost": {1000, time.Minute}} {
		run := trafficCycleAt(t)
		mySituation.GPSAltitudeMSL = 5000
		mySituation.BaroPressureAltitude = c.frozen
		mySituation.BaroLastMeasurementTime = time.Time{}
		if c.last > 0 {
			mySituation.BaroLastMeasurementTime = stratuxClock.Time.Add(-c.last)
		}
		heard(0x000001, time.Second, 3, 5000)
		heard(0x000002, time.Second, 3, int32(c.frozen))
		out := run()
		if _, ok := out.radar[1]; !ok {
			t.Errorf("%s: co-altitude target (5000 ft) not on radar", name)
		}
		if _, ok := out.radar[2]; ok {
			t.Errorf("%s: target at the stale pressure altitude (%.0f ft) on radar", name, c.frozen)
		}
	}
}

// Ownship's own transponder, received while in range, is not shown as traffic; it is
// kept as the ownship report instead. A report under an ownship code that is close,
// but not close enough to be trusted as ownship (here 200 m off, against 107 m), is
// not shown as traffic either, nor used as ownship.
func TestTrafficCycleOwnshipIsNotTraffic(t *testing.T) {
	run := trafficCycleAt(t)
	globalSettings.OwnshipModeS = "3003E3,3003E4"
	heard(0x3003E3, 0, 0, 3000)
	heard(0x3003E4, 0, 200.0/1852, 3000)
	c := run()
	for _, icao := range []uint32{0x3003E3, 0x3003E4} {
		_, gdl := c.gdl90[icao]
		_, radar := c.radar[icao]
		if gdl || radar || len(c.flarm) != 1 { // the PFLAU status sentence only
			t.Errorf("%06X sent as traffic: GDL90 %v radar %v FLARM %q", icao, gdl, radar, c.flarm)
		}
	}
	if OwnshipTrafficInfo.Icao_addr != 0x3003E3 {
		t.Errorf("ownship report %06X; want 3003E3", OwnshipTrafficInfo.Icao_addr)
	}
}

// Bearingless traffic: of the position-less Mode S targets within 2000 ft, the nearest
// by estimated distance (if under 15 km) is sent as a FLARM PFLAA with the distance
// and no bearing, and - with EstimateBearinglessDist - as eight GDL90 targets "MODE S"
// on a circle of that radius, for EFBs that cannot show a range ring.
func TestTrafficCycleBearinglessNearestModeS(t *testing.T) {
	run := trafficCycleAt(t)
	globalSettings.EstimateBearinglessDist = true
	heardModeS(0x3003E3, time.Second, 3000, 3500)
	heardModeS(0x3003E4, time.Second, 5000, 3000)
	heardModeS(0x3003E5, time.Second, 1000, 5500) // nearer, but 2500 ft above
	c := run()
	if s := c.pflaa("3003E3"); !strings.HasPrefix(s, "$PFLAA,0,3000,,152,1,3003E3,") {
		t.Errorf("PFLAA %q; want 3000 m, no bearing, 152 m above", s)
	}
	if c.pflaa("3003E4") != "" || c.pflaa("3003E5") != "" {
		t.Errorf("FLARM %q; want only the nearest co-altitude target", c.flarm)
	}
	for i := uint32(0); i < 8; i++ {
		p, ok := c.gdl90[i]
		if !ok {
			t.Errorf("ring target %d missing", i)
			continue
		}
		dist, brg := common.Distance(43, 12, gdl90LatLng(p[5:8]), gdl90LatLng(p[8:11]))
		if math.Abs(dist-3000) > 5 || angleDiff(brg, float64(i)*45) > 0.1 || strings.TrimRight(string(p[19:27]), "\x00 ") != "MODE S" {
			t.Errorf("ring target %d at %.0f m on %.1f called %q; want 3000 m on %d, MODE S", i, dist, brg, p[19:27], i*45)
		}
	}

	traffic[0x3003E3] = TrafficInfo{Icao_addr: 0x3003E3, Alt: 3500, DistanceEstimated: 15000, Last_seen: stratuxClock.Time, Last_alt: stratuxClock.Time}
	delete(traffic, 0x3003E4)
	if c := run(); c.pflaa("3003E3") != "" || len(c.gdl90) != 0 {
		t.Errorf("15 km estimate sent: FLARM %q GDL90 %d", c.flarm, len(c.gdl90))
	}
}

// Distance and bearing are recomputed every cycle from ownship's current position, so
// the alert bit follows ownship: a target 5 NM ahead raises it once ownship is on top
// of it, and keeps it raised (distance unknown) when the GPS fix is lost.
func TestTrafficCycleGeometryFollowsOwnship(t *testing.T) {
	run := trafficCycleAt(t)
	heard(0x000001, 0, 5, 3000)
	if c := run(); c.gdl90[1][1]&0x10 != 0 || math.Abs(traffic[1].Distance-5*1852) > 10 {
		t.Errorf("5 NM away: alert %v distance %.0f m", c.gdl90[1][1]&0x10 != 0, traffic[1].Distance)
	}
	lat, _ := calcLocationForBearingDistance(43, 12, 0, 5)
	mySituation.GPSLatitude = float32(lat)
	if c := run(); c.gdl90[1][1]&0x10 == 0 || traffic[1].Distance > 10 {
		t.Errorf("overhead: alert %v distance %.0f m; want alert at 0 m", c.gdl90[1][1]&0x10 != 0, traffic[1].Distance)
	}
	mySituation.GPSLastFixLocalTime = stratuxClock.Time.Add(-time.Minute)
	if c := run(); c.gdl90[1] == nil || c.gdl90[1][1]&0x10 == 0 || traffic[1].BearingDist_valid {
		t.Errorf("no GPS: report %v; want still sent, alert set, distance invalid", c.gdl90[1] != nil)
	}
}

// The status page counts the targets tracked from each receiver.
func TestTrafficCycleCountsTargetsBySource(t *testing.T) {
	run := trafficCycleAt(t)
	heard(0x000001, 0, 3, 3000)
	heard(0x000002, 0, 3, 3000)
	ti := heard(0x000003, 0, 3, 3000)
	ti.Last_source = TRAFFIC_SOURCE_UAT
	traffic[3] = ti
	run()
	if globalStatus.ES_traffic_targets_tracking != 2 || globalStatus.UAT_traffic_targets_tracking != 1 {
		t.Errorf("tracking ES %d UAT %d; want 2, 1", globalStatus.ES_traffic_targets_tracking, globalStatus.UAT_traffic_targets_tracking)
	}
}
