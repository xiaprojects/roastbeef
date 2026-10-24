/*
	lastposition_test.go: requirements-style unit tests for the last known position
	restored at startup (lastposition.go).

	Each test names the behaviour it pins down in its comment. The flight logs are
	written the way datalog.go writes them (WAL, synchronous off, the mySituation table
	from makeTable) in a temporary directory; a power cut is a copy of the files taken
	while the log is still open, before any checkpoint. The Hobbs log is given as
	entries, as hobbsmeter.go holds it in memory.
*/

package main

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

var lastPosT0 = time.Date(2026, time.September, 27, 9, 16, 10, 480000000, time.UTC)

// logRow is one mySituation row of a test flight log.
type logRow struct {
	fix     uint8
	lat     float32
	lon     float32
	altFt   float32
	gpsTime time.Time
}

func fixAt(second int, lat, lon float32) logRow {
	return logRow{fix: 1, lat: lat, lon: lon, altFt: 700 + float32(second), gpsTime: lastPosT0.Add(time.Duration(second) * time.Second)}
}

// writeFlightLog writes rows to a flight log at path. A clean log is closed, which
// checkpoints it and removes its -wal and -shm. With powerCut the log is copied while
// still open and never checkpointed, which is what switching off with the master
// leaves: the rows are in the -wal only.
func writeFlightLog(t *testing.T, path string, powerCut bool, rows ...logRow) {
	t.Helper()
	live := path
	if powerCut {
		live = filepath.Join(t.TempDir(), filepath.Base(path))
	}
	db, err := sql.Open("sqlite3", live)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1) // the pragmas are per connection
	for _, pragma := range []string{"PRAGMA journal_mode=WAL", "PRAGMA synchronous=OFF", "PRAGMA wal_autocheckpoint=0"} {
		if _, err := db.Exec(pragma); err != nil {
			t.Fatal(err)
		}
	}
	makeTable(SituationData{}, "mySituation", db)
	for _, r := range rows {
		if _, err := db.Exec("INSERT INTO mySituation (GPSFixQuality, GPSLatitude, GPSLongitude, GPSAltitudeMSL, GPSTime) VALUES (?, ?, ?, ?, ?)",
			r.fix, r.lat, r.lon, r.altFt, r.gpsTime.String()); err != nil {
			t.Fatal(err)
		}
	}
	if powerCut {
		for _, suffix := range []string{"", "-wal", "-shm"} {
			data, err := os.ReadFile(live + suffix)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path+suffix, data, 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}

// writtenAt sets when a log was last written to.
func writtenAt(t *testing.T, path string, at time.Time) {
	t.Helper()
	if err := os.Chtimes(path, at, at); err != nil {
		t.Fatal(err)
	}
}

// readOnlyDir stops files being created or removed in dir for the rest of the test, so
// a read that needs a side file, even one it removes again, fails. The files stay
// writable: made read-only, SQLite would fall back to reading a -shm it means to write,
// and the write would go unseen by dirState. Root ignores the mode: then only what is
// left behind can be seen.
func readOnlyDir(t *testing.T, dir string) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Log("running as root: a side file created and removed again goes unseen")
	}
	if err := os.Chmod(dir, 0555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0755) }) // before t.TempDir removes it
}

// dirState is every file in dir: name, size, modification time and content hash.
func dirState(t *testing.T, dir string) map[string]string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	state := make(map[string]string)
	for _, e := range entries {
		fi, err := e.Info()
		if err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		state[e.Name()] = fmt.Sprintf("%d %s %x", fi.Size(), fi.ModTime(), sha256.Sum256(data))
	}
	return state
}

func checkPosition(t *testing.T, p lastPosition, ok bool, lat, lon, altFt float64, at time.Time) {
	t.Helper()
	if !ok {
		t.Fatal("no position found")
	}
	const eps = 1e-4
	if d := p.Lat - lat; d > eps || d < -eps {
		t.Errorf("lat = %f, want %f", p.Lat, lat)
	}
	if d := p.Lon - lon; d > eps || d < -eps {
		t.Errorf("lon = %f, want %f", p.Lon, lon)
	}
	if d := p.AltFeet - altFt; d > 0.5 || d < -0.5 {
		t.Errorf("alt = %.1f ft, want %.1f", p.AltFeet, altFt)
	}
	if !p.Time.Equal(at) {
		t.Errorf("time = %s, want %s", p.Time, at)
	}
}

// A log closed cleanly gives its last row with a fix: the rows after it without a fix
// (the GPS lost in the hangar), at 0,0 or off the globe are passed over. Nothing is
// written, not even a -wal or -shm removed again: it reads from a read-only directory.
func TestLastPositionCleanLog(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "flightlog-20260927091540.0992.sqlite")
	writeFlightLog(t, path, false,
		fixAt(0, 43.1047, 12.2512),
		fixAt(1, 43.1048, 12.2513),
		logRow{fix: 0, lat: 43.2, lon: 12.3, gpsTime: lastPosT0.Add(2 * time.Second)},
		logRow{fix: 1, lat: 0, lon: 0, gpsTime: lastPosT0.Add(3 * time.Second)},
		logRow{fix: 1, lat: 95, lon: 12.3, gpsTime: lastPosT0.Add(4 * time.Second)},
	)
	before := dirState(t, dir)
	if len(before) != 1 {
		t.Fatalf("fixture: want the log alone, got %v", before)
	}
	readOnlyDir(t, dir)

	p, ok := lastPositionFromDataLogs(dir)
	checkPosition(t, p, ok, 43.1048, 12.2513, 701, lastPosT0.Add(time.Second))
	if p.Source != path {
		t.Errorf("source = %q, want %q", p.Source, path)
	}
	if after := dirState(t, dir); !reflect.DeepEqual(after, before) {
		t.Errorf("the log directory changed:\nbefore %v\nafter  %v", before, after)
	}
}

// A log cut off by a power cut still has its rows in its -wal: they are read, whatever
// the -shm holds (after a power cut it is stale), from a read-only directory, and the
// log, its -wal and its -shm are left byte for byte as they were.
func TestLastPositionPowerCutLog(t *testing.T) {
	for _, shm := range []string{"as written", "zeroed"} {
		t.Run(shm, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "flightlog-20260927101540.0992.sqlite")
			writeFlightLog(t, path, true, fixAt(0, 43.1047, 12.2512), fixAt(1, 43.1048, 12.2513))
			if shm == "zeroed" {
				if err := os.WriteFile(path+"-shm", make([]byte, 32768), 0644); err != nil {
					t.Fatal(err)
				}
			}
			// The fixture is what a power cut leaves: the main file has no rows yet.
			db, _ := sql.Open("sqlite3", "file:"+path+"?mode=ro&immutable=1")
			var n int
			if err := db.QueryRow("SELECT COUNT(*) FROM mySituation").Scan(&n); err == nil && n > 0 {
				t.Fatalf("fixture: %d rows already checkpointed into the main file", n)
			}
			db.Close()
			before := dirState(t, dir)
			readOnlyDir(t, dir)

			p, ok := lastPositionFromDataLogs(dir)
			checkPosition(t, p, ok, 43.1048, 12.2513, 701, lastPosT0.Add(time.Second))
			if after := dirState(t, dir); !reflect.DeepEqual(after, before) {
				t.Errorf("the log directory changed:\nbefore %v\nafter  %v", before, after)
			}
		})
	}
}

// Logs are searched newest first by when they were last written to, not by name: the
// name carries the system time at the start of the log, which may be before the GPS set
// the clock. After a power cut the last write is the -wal's.
func TestLastPositionNewestLogByLastWrite(t *testing.T) {
	dir := t.TempDir()
	early := filepath.Join(dir, "flightlog-19700101000012.0001.sqlite") // clock not yet set
	late := filepath.Join(dir, "flightlog-20260927091540.0992.sqlite")
	writeFlightLog(t, late, false, fixAt(0, 44.0, 10.0))
	writeFlightLog(t, early, true, fixAt(3600, 43.0, 12.0))
	writtenAt(t, late, lastPosT0)
	writtenAt(t, early, lastPosT0.Add(-time.Hour))
	writtenAt(t, early+"-wal", lastPosT0.Add(time.Hour))

	p, ok := lastPositionFromDataLogs(dir)
	checkPosition(t, p, ok, 43.0, 12.0, 4300, lastPosT0.Add(time.Hour))
}

// A newest log without a fix (one that is not a database, one whose rows have no fix)
// gives way to the one before it, and only the newest lastPositionMaxLogs are searched.
func TestLastPositionLogWithoutFixGivesWay(t *testing.T) {
	dir := t.TempDir()
	logAt := func(minute int, rows ...logRow) string {
		path := filepath.Join(dir, fmt.Sprintf("flightlog-202609270%03d.0001.sqlite", minute))
		writeFlightLog(t, path, false, rows...)
		writtenAt(t, path, lastPosT0.Add(time.Duration(minute)*time.Minute))
		return path
	}
	logAt(1, fixAt(0, 43.0, 12.0))
	logAt(2, logRow{fix: 0, lat: 44.0, lon: 10.0})
	notADatabase := filepath.Join(dir, "flightlog-20260927003.0001.sqlite")
	if err := os.WriteFile(notADatabase, []byte("cut off"), 0644); err != nil {
		t.Fatal(err)
	}
	writtenAt(t, notADatabase, lastPosT0.Add(3*time.Minute))

	p, ok := lastPositionFromDataLogs(dir)
	checkPosition(t, p, ok, 43.0, 12.0, 700, lastPosT0)

	for minute := 4; minute < 4+lastPositionMaxLogs-2; minute++ {
		logAt(minute, logRow{fix: 0})
	}
	if p, ok := lastPositionFromDataLogs(dir); ok {
		t.Errorf("found %+v in a log older than the newest %d", p, lastPositionMaxLogs)
	}
}

// A fix without GPS time is dated by when its log was last written to, so it can still
// be compared with the Hobbs log.
func TestLastPositionFixWithoutGPSTime(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "flightlog-20260927091540.0992.sqlite")
	writeFlightLog(t, path, false, logRow{fix: 1, lat: 43.0, lon: 12.0, altFt: 700})
	writtenAt(t, path, lastPosT0)

	p, ok := lastPositionFromDataLogs(dir)
	checkPosition(t, p, ok, 43.0, 12.0, 700, lastPosT0)
}

// The Hobbs log gives where the newest flight landed, in feet, wherever that flight is
// in the (hand-editable) file; an entry whose time does not parse is passed over.
func TestLastPositionHobbsNewestFlight(t *testing.T) {
	entries := []HobbsEntry{
		{DepartureTime: "2026-09-27T10:00:00Z", LandedTime: "2026-09-27T11:00:00Z", LandedLatitude: 43.0, LandedLongitude: 12.0, LandedAltitudeMeters: 213.36, HobbsTimeMinutes: 58},
		{DepartureTime: "2026-09-26T10:00:00Z", LandedTime: "2026-09-26T11:00:00Z", LandedLatitude: 44.0, LandedLongitude: 10.0, HobbsTimeMinutes: 58},
		{DepartureTime: "yesterday", LandedTime: "today", LandedLatitude: 45.0, LandedLongitude: 9.0, HobbsTimeMinutes: 58},
	}
	p, ok := lastPositionFromHobbs(entries)
	checkPosition(t, p, ok, 43.0, 12.0, 700, time.Date(2026, time.September, 27, 11, 0, 0, 0, time.UTC))
}

// A flight that never closed (no landed time: a power cut before the landing was
// flushed) gives where it departed.
func TestLastPositionHobbsOpenFlight(t *testing.T) {
	entries := []HobbsEntry{
		{DepartureTime: "2026-09-26T10:00:00Z", LandedTime: "2026-09-26T11:00:00Z", LandedLatitude: 44.0, LandedLongitude: 10.0, HobbsTimeMinutes: 58},
		{DepartureTime: "2026-09-27T10:00:00Z", DepartureLatitude: 43.0, DepartureLongitude: 12.0, DepartureAltitudeMeters: 213.36, HobbsTimeMinutes: 5},
	}
	p, ok := lastPositionFromHobbs(entries)
	checkPosition(t, p, ok, 43.0, 12.0, 700, time.Date(2026, time.September, 27, 10, 0, 0, 0, time.UTC))
}

// An entry of under a minute is not a flight and is passed over: the I-RVDX log of
// 2026-10-17 ends with a hangar power-up that "landed" at 2492 m, 23 minutes after the
// real landing.
func TestLastPositionHobbsLegUnderAMinute(t *testing.T) {
	entries := []HobbsEntry{
		{DepartureTime: "2026-10-17T16:00:17Z", LandedTime: "2026-10-17T16:17:51Z", LandedLatitude: 43.10318, LandedLongitude: 12.25280, LandedAltitudeMeters: 228.3, HobbsTimeMinutes: 17},
		{DepartureTime: "2026-10-17T16:49:06Z", LandedTime: "2026-10-17T16:50:19Z", LandedLatitude: 43.10675, LandedLongitude: 12.25483, LandedAltitudeMeters: 2492, HobbsTimeMinutes: 0},
	}
	p, ok := lastPositionFromHobbs(entries)
	checkPosition(t, p, ok, 43.10318, 12.25280, 749, time.Date(2026, time.October, 17, 16, 17, 51, 0, time.UTC))
}

// Of the flight logs and the Hobbs log, the more recent position is restored; either
// alone is enough, and with neither nothing is.
func TestLastPositionNewerSourceWins(t *testing.T) {
	dir := t.TempDir()
	writeFlightLog(t, filepath.Join(dir, "flightlog-20260927091540.0992.sqlite"), false, fixAt(0, 44.0, 10.0))
	hobbsAt := func(at time.Time) []HobbsEntry {
		return []HobbsEntry{{DepartureTime: at.Add(-time.Hour).Format(time.RFC3339), LandedTime: at.Format(time.RFC3339), LandedLatitude: 43.0, LandedLongitude: 12.0, HobbsTimeMinutes: 58}}
	}
	landed := lastPosT0.Add(time.Hour).Truncate(time.Second)

	p, ok := findLastPosition(dir, hobbsAt(landed))
	checkPosition(t, p, ok, 43.0, 12.0, 0, landed)
	p, ok = findLastPosition(dir, hobbsAt(lastPosT0.Add(-time.Hour).Truncate(time.Second)))
	checkPosition(t, p, ok, 44.0, 10.0, 700, lastPosT0)
	p, ok = findLastPosition(filepath.Join(dir, "missing"), hobbsAt(landed))
	checkPosition(t, p, ok, 43.0, 12.0, 0, landed)
	p, ok = findLastPosition("", nil)
	if ok {
		t.Errorf("found %+v with no log and no Hobbs entry", p)
	}
}

// At startup the position, altitude included, is set and is not a fix: the GPS stays
// invalid until it reports one. A fix or a position already there is never overwritten.
func TestLastPositionIsNotAFix(t *testing.T) {
	withGPSState(t)
	meter := hobbsMeter
	t.Cleanup(func() { hobbsMeter = meter })
	dir := t.TempDir()
	writeFlightLog(t, filepath.Join(dir, "flightlog-20260927091540.0992.sqlite"), false, fixAt(0, 43.1048, 12.2513))
	globalSettings.ReplayLogPath = dir
	hobbsMeter = HobbsMeterStratuxPlugin{mutex: &sync.Mutex{}}

	restoreLastPosition()
	if mySituation.GPSLatitude != 43.1048 || mySituation.GPSLongitude != 12.2513 || mySituation.GPSAltitudeMSL != 700 {
		t.Errorf("position = %f %f %.0f ft, want 43.1048 12.2513 700 ft", mySituation.GPSLatitude, mySituation.GPSLongitude, mySituation.GPSAltitudeMSL)
	}
	if mySituation.GPSFixQuality != 0 || isGPSValid() {
		t.Errorf("a restored position is a fix: quality %d, valid %t", mySituation.GPSFixQuality, isGPSValid())
	}

	if applyLastPosition(lastPosition{Lat: 44.0, Lon: 10.0}) || mySituation.GPSLatitude != 43.1048 {
		t.Error("a position already there was overwritten")
	}
	mySituation.GPSLatitude, mySituation.GPSLongitude, mySituation.GPSFixQuality = 0, 0, 1
	if applyLastPosition(lastPosition{Lat: 44.0, Lon: 10.0}) || mySituation.GPSLatitude != 0 {
		t.Error("a fix was overwritten")
	}
}
