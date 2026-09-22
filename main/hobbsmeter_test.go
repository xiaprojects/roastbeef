/*
	hobbsmeter_test.go: requirements-style unit tests for the GPS Hobbs meter
	state machine and its flight log file (hobbsmeter.go).

	Each test names the behaviour it pins down in its comment. The state machine
	is driven with synthetic 1 Hz samples, so no GPS, clock or file is involved
	except in the persistence tests, which use a temporary directory.
*/

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"
)

var hobbsT0 = time.Date(2026, time.September, 17, 10, 0, 0, 0, time.UTC)

// hobbsFlight feeds samples to a meter one second apart, starting at hobbsT0.
type hobbsFlight struct {
	meter  *HobbsMeterStratuxPlugin
	second int
	landed int // how many times update() reported a landing
}

func newHobbsFlight() *hobbsFlight {
	return &hobbsFlight{meter: &HobbsMeterStratuxPlugin{entries: make([]HobbsEntry, 0)}}
}

func (f *hobbsFlight) at() time.Time {
	return hobbsT0.Add(time.Duration(f.second) * time.Second)
}

// run feeds `seconds` samples at the given speed; lat/lon/alt encode the second so a
// test can tell which sample a field was taken from.
func (f *hobbsFlight) run(seconds int, speedKmh float64, valid bool) {
	for i := 0; i < seconds; i++ {
		s := hobbsSample{
			Valid:     valid,
			Time:      f.at(),
			SpeedKmh:  speedKmh,
			Lat:       45 + float64(f.second)/1e6,
			Lon:       9 + float64(f.second)/1e6,
			AltMeters: float64(f.second),
		}
		if f.meter.update(s) {
			f.landed++
		}
		f.second++
	}
}

func hobbsStamp(second int) string {
	return hobbsT0.Add(time.Duration(second) * time.Second).Format(time.RFC3339)
}

// Taxiing below the threshold never opens a flight and counts nothing.
func TestHobbsTaxiCountsNothing(t *testing.T) {
	f := newHobbsFlight()
	f.run(600, 20, true)
	if len(f.meter.entries) != 0 || f.meter.flying || f.meter.totalMinutes() != 0 {
		t.Fatalf("taxi produced entries=%d flying=%v minutes=%d", len(f.meter.entries), f.meter.flying, f.meter.totalMinutes())
	}
}

// A speed spike shorter than the takeoff debounce (a GPS glitch on the apron) does
// not open a flight.
func TestHobbsShortSpikeIsNotATakeoff(t *testing.T) {
	f := newHobbsFlight()
	f.run(10, 20, true)
	f.run(hobbsTakeoffDebounceSec-1, 80, true)
	f.run(10, 20, true)
	if len(f.meter.entries) != 0 || f.meter.flying {
		t.Fatalf("spike opened a flight: entries=%d flying=%v", len(f.meter.entries), f.meter.flying)
	}
}

// Takeoff, cruise and landing give one entry whose departure fields come from the
// first fast second, whose landed fields come from the first slow second of the final
// roll-out, and whose minutes are the seconds above the threshold, debounce included.
func TestHobbsOneFlight(t *testing.T) {
	f := newHobbsFlight()
	f.run(30, 20, true) // taxi: seconds 0-29
	takeoff := f.second
	f.run(600, 150, true) // 10 minutes above the threshold: seconds 30-629
	landing := f.second
	f.run(hobbsLandingDebounceSec, 20, true) // roll-out and taxi
	f.run(120, 0, true)                      // parked

	if f.landed != 1 {
		t.Fatalf("landing reported %d times, want 1", f.landed)
	}
	if len(f.meter.entries) != 1 || f.meter.flying {
		t.Fatalf("entries=%d flying=%v, want one closed flight", len(f.meter.entries), f.meter.flying)
	}
	want := HobbsEntry{
		DepartureTime:           hobbsStamp(takeoff),
		DepartureLatitude:       45 + float64(takeoff)/1e6,
		DepartureLongitude:      9 + float64(takeoff)/1e6,
		DepartureAltitudeMeters: float64(takeoff),
		LandedTime:              hobbsStamp(landing),
		LandedLatitude:          45 + float64(landing)/1e6,
		LandedLongitude:         9 + float64(landing)/1e6,
		LandedAltitudeMeters:    float64(landing),
		HobbsTimeMinutes:        10,
	}
	if got := f.meter.entries[0]; got != want {
		t.Fatalf("entry:\n got %+v\nwant %+v", got, want)
	}
	if f.meter.totalMinutes() != 10 {
		t.Fatalf("totalMinutes=%d, want 10", f.meter.totalMinutes())
	}
}

// Minutes are the truncated count of seconds above the threshold: the flight in
// progress shows them while flying and a partial minute is dropped.
func TestHobbsMinutesTruncate(t *testing.T) {
	f := newHobbsFlight()
	f.run(179, 100, true) // 2 min 59 s
	if !f.meter.flying || f.meter.entries[0].HobbsTimeMinutes != 2 || f.meter.totalMinutes() != 2 {
		t.Fatalf("flying=%v minutes=%d total=%d, want flying with 2 minutes", f.meter.flying, f.meter.entries[0].HobbsTimeMinutes, f.meter.totalMinutes())
	}
	f.run(1, 100, true)
	if f.meter.entries[0].HobbsTimeMinutes != 3 {
		t.Fatalf("minutes=%d after 180 s, want 3", f.meter.entries[0].HobbsTimeMinutes)
	}
}

// A drop below the threshold shorter than the landing debounce (headwind, touch-and-go)
// keeps the same flight; its seconds are not counted and the landed fields are those
// of the final drop, not the first one.
func TestHobbsTouchAndGoStaysOneFlight(t *testing.T) {
	f := newHobbsFlight()
	f.run(120, 100, true) // 2 min
	f.run(30, 30, true)   // touch-and-go roll, 30 s below
	f.run(120, 100, true) // 2 more min
	landing := f.second
	f.run(hobbsLandingDebounceSec+5, 10, true)

	if len(f.meter.entries) != 1 || f.meter.flying || f.landed != 1 {
		t.Fatalf("entries=%d flying=%v landed=%d, want one closed flight", len(f.meter.entries), f.meter.flying, f.landed)
	}
	e := f.meter.entries[0]
	if e.HobbsTimeMinutes != 4 {
		t.Fatalf("minutes=%d, want 4 (the 30 s below the threshold do not count)", e.HobbsTimeMinutes)
	}
	if e.LandedTime != hobbsStamp(landing) || e.LandedAltitudeMeters != float64(landing) {
		t.Fatalf("landed fields %q/%v, want those of second %d", e.LandedTime, e.LandedAltitudeMeters, landing)
	}
}

// Two flights separated by more than the landing debounce give two entries.
func TestHobbsTwoFlights(t *testing.T) {
	f := newHobbsFlight()
	f.run(60, 100, true)
	f.run(hobbsLandingDebounceSec, 0, true)
	f.run(120, 100, true)
	f.run(hobbsLandingDebounceSec, 0, true)
	if len(f.meter.entries) != 2 || f.landed != 2 {
		t.Fatalf("entries=%d landed=%d, want 2 flights", len(f.meter.entries), f.landed)
	}
	if f.meter.entries[0].HobbsTimeMinutes != 1 || f.meter.entries[1].HobbsTimeMinutes != 2 || f.meter.totalMinutes() != 3 {
		t.Fatalf("minutes %d+%d=%d, want 1+2=3", f.meter.entries[0].HobbsTimeMinutes, f.meter.entries[1].HobbsTimeMinutes, f.meter.totalMinutes())
	}
}

// Seconds without a valid fix are ignored: they are not counted, they do not close the
// flight in progress, and they do not build up either debounce.
func TestHobbsInvalidFixIsIgnored(t *testing.T) {
	f := newHobbsFlight()
	f.run(120, 100, true)
	f.run(600, 0, false) // GPS lost for 10 minutes, whatever speed it reports
	if !f.meter.flying || f.landed != 0 {
		t.Fatalf("GPS loss closed the flight: flying=%v landed=%d", f.meter.flying, f.landed)
	}
	if f.meter.entries[0].HobbsTimeMinutes != 2 {
		t.Fatalf("minutes=%d after GPS loss, want 2", f.meter.entries[0].HobbsTimeMinutes)
	}
	f.run(60, 100, true)
	if f.meter.entries[0].HobbsTimeMinutes != 3 || len(f.meter.entries) != 1 {
		t.Fatalf("after GPS back: minutes=%d entries=%d, want 3 in the same flight", f.meter.entries[0].HobbsTimeMinutes, len(f.meter.entries))
	}

	// On the ground, invalid fast samples do not open a flight either.
	g := newHobbsFlight()
	g.run(60, 100, false)
	if len(g.meter.entries) != 0 {
		t.Fatalf("invalid samples opened a flight")
	}
}

// Landing is reported exactly once, on the tick that closes the flight, and marks the
// log dirty so the caller flushes it.
func TestHobbsLandingReportedOnce(t *testing.T) {
	f := newHobbsFlight()
	f.run(60, 100, true)
	f.meter.dirty = false
	f.run(hobbsLandingDebounceSec-1, 0, true)
	if f.landed != 0 {
		t.Fatalf("landing reported before the debounce elapsed")
	}
	f.run(1, 0, true)
	if f.landed != 1 || !f.meter.dirty {
		t.Fatalf("landed=%d dirty=%v, want 1 and dirty", f.landed, f.meter.dirty)
	}
	f.run(600, 0, true)
	if f.landed != 1 {
		t.Fatalf("landing reported again while parked: %d", f.landed)
	}
}

// save writes the array format of the specification with exactly its keys, and load
// reads it back, the open flight of a power cut included.
func TestHobbsSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	m := &HobbsMeterStratuxPlugin{filePath: filepath.Join(dir, "hobbsmeter.json")}
	m.entries = []HobbsEntry{
		{DepartureTime: "2026-09-17T10:00:00Z", DepartureLatitude: 45.1, DepartureLongitude: 9.2, DepartureAltitudeMeters: 100,
			LandedTime: "2026-09-17T10:45:00Z", LandedLatitude: 45.3, LandedLongitude: 9.4, LandedAltitudeMeters: 120, HobbsTimeMinutes: 45},
		{DepartureTime: "2026-09-17T12:00:00Z", DepartureLatitude: 45.3, DepartureLongitude: 9.4, DepartureAltitudeMeters: 120, HobbsTimeMinutes: 7},
	}
	m.dirty = true
	m.save()
	if m.dirty {
		t.Fatalf("save left the log dirty")
	}
	if _, err := os.Stat(m.filePath + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("temporary file left behind")
	}

	data, err := os.ReadFile(m.filePath)
	if err != nil {
		t.Fatal(err)
	}
	var raw []map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("file is not a JSON array: %s", err)
	}
	wantKeys := []string{"departureAltitudeMeters", "departureLatitude", "departureLongitude", "departureTime",
		"hobbsTimeMinutes", "landedAltitudeMeters", "landedLatitude", "landedLongitude", "landedTime"}
	for i := range raw {
		keys := make([]string, 0, len(raw[i]))
		for k := range raw[i] {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if !reflect.DeepEqual(keys, wantKeys) {
			t.Fatalf("entry %d keys %v, want %v", i, keys, wantKeys)
		}
	}
	if raw[1]["landedTime"] != "" {
		t.Fatalf("open flight landedTime %q, want empty", raw[1]["landedTime"])
	}

	back := &HobbsMeterStratuxPlugin{filePath: m.filePath, entries: make([]HobbsEntry, 0)}
	back.load()
	if !reflect.DeepEqual(back.entries, m.entries) {
		t.Fatalf("load:\n got %+v\nwant %+v", back.entries, m.entries)
	}
	if back.totalMinutes() != 52 || back.readOnly {
		t.Fatalf("total=%d readOnly=%v, want 52 and writable", back.totalMinutes(), back.readOnly)
	}
}

// A missing file is an empty log and is not created until something is written.
func TestHobbsLoadMissingFile(t *testing.T) {
	m := &HobbsMeterStratuxPlugin{filePath: filepath.Join(t.TempDir(), "hobbsmeter.json"), entries: make([]HobbsEntry, 0)}
	m.load()
	if len(m.entries) != 0 || m.readOnly {
		t.Fatalf("entries=%d readOnly=%v, want empty and writable", len(m.entries), m.readOnly)
	}
	if _, err := os.Stat(m.filePath); !os.IsNotExist(err) {
		t.Fatalf("load created the file")
	}
}

// A file that does not parse is kept: the meter runs with an empty log and refuses
// to overwrite it, so a hand edit gone wrong is never lost.
func TestHobbsCorruptFileIsNeverOverwritten(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hobbsmeter.json")
	bad := []byte("[{\"departureTime\": oops")
	if err := os.WriteFile(path, bad, 0644); err != nil {
		t.Fatal(err)
	}
	// addSingleSystemErrorf's state is set up by main(); the alerts plugin is not
	// started and discards the event by itself.
	systemErrsMutex = &sync.Mutex{}
	systemErrs = make(map[string]string)
	globalStatus.Errors = nil
	m := &HobbsMeterStratuxPlugin{filePath: path, entries: make([]HobbsEntry, 0)}
	m.load()
	if !m.readOnly || len(m.entries) != 0 {
		t.Fatalf("readOnly=%v entries=%d, want read-only and empty", m.readOnly, len(m.entries))
	}
	if len(globalStatus.Errors) == 0 {
		t.Fatalf("no system error reported for the corrupt file")
	}
	m.entries = append(m.entries, HobbsEntry{HobbsTimeMinutes: 1})
	m.dirty = true
	m.save()
	data, _ := os.ReadFile(path)
	if string(data) != string(bad) {
		t.Fatalf("corrupt file was overwritten")
	}
}
