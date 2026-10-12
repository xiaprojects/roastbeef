package main

import (
	"math"
	"os"
	"testing"
	"time"
)

// The golden vectors from docs/integration/pgrmh-format.md section 5. They are
// the specification's own worked outputs, checksums included, so a change in
// rounding, saturation, null handling or field order shows up here rather than
// on a panel.

func ptr(v float64) *float64 { return &v }

func TestMakePGRMHStringGoldenVectors(t *testing.T) {
	cases := []struct {
		name string
		in   PGRMHData
		want string
	}{
		{"T1 VNAV active, last leg", PGRMHData{
			Valid: true, VertSpeedFpm: ptr(-500), VnavErrorFt: ptr(559.4),
			VsToTargetFpm: ptr(-686.1), VsToWptFpm: ptr(-514.6), DtkTrue: ptr(232.1)},
			"$PGRMH,A,-500,559,-686,-515,,232,*1A\r\n"},

		{"T2 lateral only, VNAV inactive", PGRMHData{
			Valid: true, VertSpeedFpm: ptr(-500), DtkTrue: ptr(232.1)},
			"$PGRMH,A,-500,,,,,232,*2A\r\n"},

		{"T3 unusable, GPS invalid", PGRMHData{Valid: false},
			"$PGRMH,V,,,,,,,*16\r\n"},

		{"T4 above profile saturates to +999", PGRMHData{
			Valid: true, VertSpeedFpm: ptr(-300), VnavErrorFt: ptr(1450),
			VsToTargetFpm: ptr(-1210.6), VsToWptFpm: ptr(-905.2), DtkTrue: ptr(232.1)},
			"$PGRMH,A,-300,999,-1211,-905,,232,*2A\r\n"},

		{"T5 below profile saturates to -999", PGRMHData{
			Valid: true, VertSpeedFpm: ptr(0), VnavErrorFt: ptr(-1200),
			VsToTargetFpm: ptr(-120), VsToWptFpm: ptr(-90), DtkTrue: ptr(232.1)},
			"$PGRMH,A,0,-999,-120,-90,,232,*2C\r\n"},

		{"T6 intermediate waypoint with next leg, no baro", PGRMHData{
			Valid: true, DtkTrue: ptr(95.4), NextLegTrue: ptr(148.0)},
			"$PGRMH,A,,,,,,95,148*30\r\n"},

		{"T7 DTK 359.6 rounds to 0 and VS -0.4 is 0, never -0", PGRMHData{
			Valid: true, VertSpeedFpm: ptr(-0.4), DtkTrue: ptr(359.6), NextLegTrue: ptr(90)},
			"$PGRMH,A,0,,,,,0,90*08\r\n"},

		{"T8 negative course normalised, 12.5 rounds away from zero", PGRMHData{
			Valid: true, VertSpeedFpm: ptr(12.5), DtkTrue: ptr(-10)},
			"$PGRMH,A,13,,,,,350,*35\r\n"},

		{"T9 height above terrain 1349 rounds down to 1300", PGRMHData{
			Valid: true, VertSpeedFpm: ptr(150), HatFt: ptr(1349), DtkTrue: ptr(341)},
			"$PGRMH,A,150,,,,1300,341,*01\r\n"},

		{"T10 vertical speed saturates", PGRMHData{
			Valid: true, VertSpeedFpm: ptr(-12000), DtkTrue: ptr(10)},
			"$PGRMH,A,-9999,,,,,10,*2D\r\n"},

		{"T11 worst-case length", PGRMHData{
			Valid: true, VertSpeedFpm: ptr(-9999), VnavErrorFt: ptr(-999),
			VsToTargetFpm: ptr(-9999), VsToWptFpm: ptr(-9999), HatFt: ptr(99900),
			DtkTrue: ptr(359), NextLegTrue: ptr(359)},
			"$PGRMH,A,-9999,-999,-9999,-9999,99900,359,359*01\r\n"},
	}

	for _, c := range cases {
		if got := makePGRMHString(c.in); got != c.want {
			t.Errorf("%s\n got %q\nwant %q", c.name, got, c.want)
		}
	}
}

// Section 1: at most 82 characters including the framing, and section 5 says
// this encoding's worst case is 50.
func TestMakePGRMHStringLength(t *testing.T) {
	worst := makePGRMHString(PGRMHData{
		Valid: true, VertSpeedFpm: ptr(-9999), VnavErrorFt: ptr(-999),
		VsToTargetFpm: ptr(-9999), VsToWptFpm: ptr(-9999), HatFt: ptr(99900),
		DtkTrue: ptr(359), NextLegTrue: ptr(359)})
	if len(worst) != 50 {
		t.Errorf("worst case is %d characters, the specification says 50: %q", len(worst), worst)
	}
	if len(worst) > 82 {
		t.Errorf("sentence exceeds the NMEA 0183 limit of 82: %d", len(worst))
	}
}

// Section 3: a null field is empty but keeps its comma, so the sentence always
// carries exactly eight commas after the address whatever is populated.
func TestMakePGRMHStringAlwaysEightFields(t *testing.T) {
	for _, d := range []PGRMHData{
		{Valid: false},
		{Valid: true, DtkTrue: ptr(0)},
		{Valid: true, VertSpeedFpm: ptr(1), VnavErrorFt: ptr(2), VsToTargetFpm: ptr(3),
			VsToWptFpm: ptr(4), HatFt: ptr(500), DtkTrue: ptr(6), NextLegTrue: ptr(7)},
	} {
		s := makePGRMHString(d)
		body := s[:len(s)-2] // drop \r\n
		body = body[:strIndex(body, '*')]
		if n := countComma(body); n != 8 {
			t.Errorf("got %d commas, want 8: %q", n, s)
		}
	}
}

// Section 2.1: the encoder must never emit "-0" for a value that rounds to zero
// from below, which is what %.0f on a float would do.
func TestMakePGRMHStringNeverNegativeZero(t *testing.T) {
	for _, v := range []float64{-0.4, -0.0001, -0.49999} {
		s := makePGRMHString(PGRMHData{Valid: true, VertSpeedFpm: ptr(v), DtkTrue: ptr(0)})
		if contains(s, ",-0,") {
			t.Errorf("negative zero emitted for %v: %q", v, s)
		}
	}
}

// Section 2.2: courses normalise into [0, 360), so 360 is never sent.
func TestPgrmhDegNormalises(t *testing.T) {
	cases := map[float64]string{359.6: "0", -10: "350", 360: "0", 720.4: "0", 0: "0", 359.4: "359"}
	for in, want := range cases {
		if got := pgrmhDeg(&in); got != want {
			t.Errorf("pgrmhDeg(%v) = %q, want %q", in, got, want)
		}
	}
	if got := pgrmhDeg(nil); got != "" {
		t.Errorf("pgrmhDeg(nil) = %q, want empty", got)
	}
}

// Section 2.3: height above terrain truncates down to the next lowest 100 ft,
// and a negative height clamps to zero rather than going negative.
func TestPgrmhHatRoundsDown(t *testing.T) {
	cases := map[float64]string{1349: "1300", 1300: "1300", 99: "0", 0: "0", -50: "0", 99999: "99900"}
	for in, want := range cases {
		if got := pgrmhHat(&in); got != want {
			t.Errorf("pgrmhHat(%v) = %q, want %q", in, got, want)
		}
	}
}

// The checksum is the XOR of everything between $ and *, which the golden
// vectors already pin; this re-derives it independently so a change to
// appendNmeaChecksum cannot quietly agree with a wrong expectation.
func TestMakePGRMHStringChecksum(t *testing.T) {
	s := makePGRMHString(PGRMHData{Valid: true, VertSpeedFpm: ptr(-500), DtkTrue: ptr(232.1)})
	star := strIndex(s, '*')
	var sum byte
	for i := 1; i < star; i++ {
		sum ^= s[i]
	}
	want := "0123456789ABCDEF"[sum>>4:sum>>4+1] + "0123456789ABCDEF"[sum&0xF:sum&0xF+1]
	if got := s[star+1 : star+3]; got != want {
		t.Errorf("checksum %q, recomputed %q, in %q", got, want, s)
	}
}

// The external navigator in the autopilotudp.go header encodes "no profile" as
// a pegged -999 and zeros rather than nulls. Section 3 says RB-01 passes such
// sentences through untouched, and section 7 says -999 is a real pegged value,
// not a no-data marker - so this is a decoding expectation, not an encoding one.
func TestExternalSenderVectorIsWellFormed(t *testing.T) {
	const external = "$PGRMH,A,0,-999,0,0,1300,341,0*21"
	star := strIndex(external, '*')
	var sum byte
	for i := 1; i < star; i++ {
		sum ^= external[i]
	}
	if got := int(sum); got != 0x21 {
		t.Errorf("external vector checksum is %02X, the captured sentence says 21", got)
	}
	if n := countComma(external[:star]); n != 8 {
		t.Errorf("external vector has %d commas, want 8", n)
	}
}

func TestVnavWorkedExample(t *testing.T) {
	// docs/integration/nmea-navigation-output.md section 6.4: 8.0 NM before
	// LIRJ at 3500 ft, closing 100 kt, last waypoint Ele 30 ft, defaults.
	v := vnavSolution(vnavInputs{
		AltitudeFt: 3500, DistNM: 8.0, ClosingKt: 100,
		TargetEleFt: 30, IsLastWaypoint: true, VerticalAccuracyM: 5,
		AngleDeg: 3.0, ArrivalAglFt: 1000, ArrivalOffsetNM: 2.0})

	if !v.Active {
		t.Fatalf("the worked example is past top of descent and must be active: %+v", v)
	}
	for _, c := range []struct {
		name string
		got  *float64
		want float64
	}{
		{"field 3 VNAV error", v.ErrorFt, 559},
		{"field 4 VS to target", v.VsToTargetFpm, -686},
		{"field 5 VS to waypoint", v.VsToWptFpm, -515},
	} {
		if c.got == nil {
			t.Errorf("%s is null, want %v", c.name, c.want)
			continue
		}
		if math.Abs(math.Round(*c.got)-c.want) > 0 {
			t.Errorf("%s = %.2f, want %v", c.name, *c.got, c.want)
		}
	}

	// And the sentence the example prints.
	got := makePGRMHString(PGRMHData{
		Valid: true, VertSpeedFpm: ptr(-500), VnavErrorFt: v.ErrorFt,
		VsToTargetFpm: v.VsToTargetFpm, VsToWptFpm: v.VsToWptFpm, DtkTrue: ptr(232.1)})
	if want := "$PGRMH,A,-500,559,-686,-515,,232,*1A\r\n"; got != want {
		t.Errorf("worked example\n got %q\nwant %q", got, want)
	}
}

func TestVnavInactiveCases(t *testing.T) {
	base := vnavInputs{
		AltitudeFt: 3500, DistNM: 8.0, ClosingKt: 100,
		TargetEleFt: 30, IsLastWaypoint: true, VerticalAccuracyM: 5,
		AngleDeg: 3.0, ArrivalAglFt: 1000, ArrivalOffsetNM: 2.0}

	cases := []struct {
		name  string
		patch func(*vnavInputs)
	}{
		// Section 6.1: Ele 0 means "no altitude", and descending to 0 ft MSL
		// or to 1000 ft MSL at a high field would fly into terrain.
		{"no target altitude", func(i *vnavInputs) { i.TargetEleFt = 0 }},
		// Section 6.3 item 2: descent only, never a climb profile.
		{"below the target", func(i *vnavInputs) { i.AltitudeFt = 500 }},
		{"barely above the target", func(i *vnavInputs) { i.AltitudeFt = 1030 + 50 }},
		// Section 6.3 item 3: more than a minute before top of descent.
		{"far before top of descent", func(i *vnavInputs) { i.DistNM = 40 }},
		// Section 6.3 item 3: past the target point.
		{"past the target point", func(i *vnavInputs) { i.DistNM = 1.0 }},
		// Section 6.3 item 4.
		{"too slow", func(i *vnavInputs) { i.ClosingKt = 20 }},
		{"vertical accuracy too poor", func(i *vnavInputs) { i.VerticalAccuracyM = 40 }},
	}
	for _, c := range cases {
		in := base
		c.patch(&in)
		v := vnavSolution(in)
		if v.Active || v.ErrorFt != nil || v.VsToTargetFpm != nil {
			t.Errorf("%s: want inactive with null fields 3 and 4, got %+v", c.name, v)
		}
	}
}

// Section 6.3: field 5 needs only enable, a known target altitude and the
// closing-speed check, so it survives cases that switch fields 3 and 4 off.
func TestVnavFieldFiveIndependentOfProfile(t *testing.T) {
	v := vnavSolution(vnavInputs{
		AltitudeFt: 3500, DistNM: 40, ClosingKt: 100,
		TargetEleFt: 30, IsLastWaypoint: true, VerticalAccuracyM: 5,
		AngleDeg: 3.0, ArrivalAglFt: 1000, ArrivalOffsetNM: 2.0})
	if v.Active {
		t.Fatalf("40 NM out is before top of descent, fields 3 and 4 must be off")
	}
	if v.VsToWptFpm == nil {
		t.Fatalf("field 5 must still be available")
	}
	if want := (1030.0 - 3500.0) / (40.0 / 100.0 * 60.0); math.Abs(*v.VsToWptFpm-want) > 0.01 {
		t.Errorf("field 5 = %.2f, want %.2f", *v.VsToWptFpm, want)
	}
}


// The builder is the glue between the navigation solution and the sentence:
// it decides which fields are null. The encoder tests above cover formatting,
// these cover sourcing.
func TestPgrmhFromSolution(t *testing.T) {
	saved := mySituation
	defer func() { mySituation = saved }()
	// stratuxClock is created in main(), which a test never runs; isTempPressValid
	// reads it, so give the package one.
	if stratuxClock == nil {
		stratuxClock = NewMonotonic()
	}

	// A valid solution on the worked-example leg, baro fresh so field 2 is
	// present, and a following leg so field 8 is too.
	mySituation.BaroVerticalSpeed = -500
	mySituation.BaroLastMeasurementTime = stratuxClock.Time
	sol := GPRMBData{
		Status: GPRMB_STATUS_OK, LegCourse: 232.1,
		NextLegTrue: 148.0, HasNextLeg: true,
		Vnav: vnavResult{Active: true, ErrorFt: ptr(559.4),
			VsToTargetFpm: ptr(-686.1), VsToWptFpm: ptr(-514.6)},
	}
	got := makePGRMHString(pgrmhFromSolution(sol))
	if want := "$PGRMH,A,-500,559,-686,-515,,232,148*27\r\n"; got != want {
		t.Errorf("populated solution\n got %q\nwant %q", got, want)
	}

	// Status V must blank everything, whatever the solution carries.
	bad := sol
	bad.Status = GPRMB_STATUS_WARNING
	if got := makePGRMHString(pgrmhFromSolution(bad)); got != "$PGRMH,V,,,,,,,*16\r\n" {
		t.Errorf("invalid solution = %q", got)
	}

	// A stale baro makes field 2 null rather than reporting a frozen value.
	mySituation.BaroLastMeasurementTime = stratuxClock.Time.Add(-60 * time.Second)
	d := pgrmhFromSolution(sol)
	if d.VertSpeedFpm != nil {
		t.Errorf("stale baro must null field 2, got %v", *d.VertSpeedFpm)
	}

	// Field 6 is always null: there is no terrain model in the daemon.
	if d.HatFt != nil {
		t.Errorf("field 6 must always be null, got %v", *d.HatFt)
	}

	// No following leg means field 8 is null, not zero (zero is north).
	mySituation.BaroLastMeasurementTime = stratuxClock.Time
	last := sol
	last.HasNextLeg = false
	if d := pgrmhFromSolution(last); d.NextLegTrue != nil {
		t.Errorf("last leg must null field 8, got %v", *d.NextLegTrue)
	}

	// Field 7 must agree with $GPBOD field 1 of the same burst (format section 3.5):
	// both read LegCourse.
	bod := makeGPBODString(sol)
	if d := pgrmhFromSolution(sol); d.DtkTrue == nil || *d.DtkTrue != sol.LegCourse {
		t.Errorf("field 7 must be LegCourse, the same value $GPBOD sends: %q", bod)
	}
}

// The glide profile now lives in the aircraft file rather than stratux.conf.
// These cover the fallbacks, because a bad edit must degrade to a standard 3
// degree path rather than produce a wrong descent or none at all.
func TestReadGlideProfile(t *testing.T) {
	dir := t.TempDir() + "/"
	savedDir := STRATUX_WWW_DIR
	STRATUX_WWW_DIR = dir
	defer func() { STRATUX_WWW_DIR = savedDir }()
	if err := os.MkdirAll(dir+"settings", 0755); err != nil {
		t.Fatal(err)
	}
	path := dir + aircraftFileName

	write := func(body string) {
		if err := os.WriteFile(path, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
		// The cache keys on the timestamp, so move it on for each case.
		glideCacheMutex.Lock()
		glideCacheStamp = time.Time{}
		glideCacheMutex.Unlock()
	}

	d := glideDefaults()

	// No aircraft file at all.
	if got := readGlideProfile(); got != d {
		t.Errorf("missing file = %+v, want the defaults %+v", got, d)
	}

	// A file with no glide block, which is every aircraft.json written before
	// this feature existed.
	write(`{"name":"X-ABCD","units":{}}`)
	if got := readGlideProfile(); got != d {
		t.Errorf("no glide block = %+v, want the defaults %+v", got, d)
	}

	// A full block is taken as written.
	write(`{"glide":{"descentAngleDeg":4.5,"arrivalAglFt":1500,"arrivalOffsetNM":3}}`)
	if got := (readGlideProfile()); got.DescentAngleDeg != 4.5 || got.ArrivalAglFt != 1500 || got.ArrivalOffsetNM != 3 {
		t.Errorf("full block = %+v", got)
	}

	// A partial block keeps what it sets and defaults the rest.
	write(`{"glide":{"descentAngleDeg":5}}`)
	got := readGlideProfile()
	if got.DescentAngleDeg != 5 || got.ArrivalAglFt != d.ArrivalAglFt || got.ArrivalOffsetNM != d.ArrivalOffsetNM {
		t.Errorf("partial block = %+v", got)
	}

	// An explicit zero is a choice, not an omission: cross the threshold at
	// field elevation. It must survive where a missing field would default.
	write(`{"glide":{"arrivalAglFt":0}}`)
	if got := readGlideProfile(); got.ArrivalAglFt != 0 || got.DescentAngleDeg != d.DescentAngleDeg {
		t.Errorf("explicit zero = %+v, want ArrivalAglFt 0 with the other defaults", got)
	}

	// Out-of-range values fall back per field: a 45 degree "descent" is a typo,
	// not a flight path.
	write(`{"glide":{"descentAngleDeg":45,"arrivalAglFt":-500,"arrivalOffsetNM":999}}`)
	if got := readGlideProfile(); got != d {
		t.Errorf("out of range = %+v, want the defaults %+v", got, d)
	}

	// Malformed JSON, e.g. a hand edit gone wrong mid-flight.
	write(`{"glide":{`)
	if got := readGlideProfile(); got != d {
		t.Errorf("bad JSON = %+v, want the defaults %+v", got, d)
	}

	// The repo's own aircraft.json must parse and carry the shipped profile.
	shipped, err := os.ReadFile(savedDir + aircraftFileName)
	if err == nil {
		write(string(shipped))
		if got := readGlideProfile(); got.DescentAngleDeg != 3.0 {
			t.Errorf("shipped aircraft.json gives %+v, want a 3 degree path", got)
		}
	}
}

// The cache must not pin a stale profile: an edit through the Aircraft plate
// has to reach the next sentence without a restart.
func TestReadGlideProfilePicksUpEdits(t *testing.T) {
	dir := t.TempDir() + "/"
	savedDir := STRATUX_WWW_DIR
	STRATUX_WWW_DIR = dir
	defer func() { STRATUX_WWW_DIR = savedDir }()
	if err := os.MkdirAll(dir+"settings", 0755); err != nil {
		t.Fatal(err)
	}
	path := dir + aircraftFileName
	glideCacheMutex.Lock()
	glideCacheStamp = time.Time{}
	glideCacheMutex.Unlock()

	os.WriteFile(path, []byte(`{"glide":{"descentAngleDeg":3}}`), 0644)
	if got := readGlideProfile(); got.DescentAngleDeg != 3 {
		t.Fatalf("first read = %+v", got)
	}
	os.WriteFile(path, []byte(`{"glide":{"descentAngleDeg":6}}`), 0644)
	// Timestamps can share a second, so make the change visible the way the
	// filesystem would after a real edit.
	os.Chtimes(path, time.Now().Add(2*time.Second), time.Now().Add(2*time.Second))
	if got := readGlideProfile(); got.DescentAngleDeg != 6 {
		t.Errorf("after the edit = %+v, want 6 degrees", got)
	}
}

// -- small helpers, kept local so the test file has no extra imports ---------

func strIndex(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

func countComma(s string) int {
	n := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			n++
		}
	}
	return n
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
