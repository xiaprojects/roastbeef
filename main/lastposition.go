/*
	This file is part of RB.

	Copyright (C) 2026 XIAPROJECTS SRL

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, version 3.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program. If not, see <https://www.gnu.org/licenses/>.

	This source is part of the project RB:
	01 -> Display with Synthetic vision, Autopilot and ADSB
	02 -> Display with SixPack
	03 -> Display with Autopilot, ADSB, Radio, Flight Computer
	04 -> Display with EMS: Engine monitoring system
	05 -> Display with Stratux BLE Traffic
	06 -> Display with Android 6.25" 7" 8" 10" 10.2"

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community

	lastposition.go: start from the last known position until the GPS has a fix

	Until the first fix the position is 0,0, so the map and the synthetic vision open in
	the Gulf of Guinea. The aircraft is almost always where it was switched off, and that
	position is already on the card, so it is read back and nothing new is written:

	- the flight logs (datalog.go, flightlog-*.sqlite in ReplayLogPath): the last row of
	  mySituation with a fix in the newest log that has one, a second or so before the
	  power went off
	- the Hobbs meter log (hobbsmeter.go, already in memory): where the newest flight of
	  a minute or more landed, or where it departed if it never closed

	whichever is more recent. Only latitude, longitude and GPS MSL altitude are set. The
	fix quality stays 0, so isGPSValid() is false and everything gated on it (the GDL90
	and NMEA validity flags, traffic distances, the autopilot) behaves as after a GPS loss
	in flight, which leaves the last position in place the same way. The first fix
	overwrites it.

	Reading a flight log without writing to the card needs care. The logs are in WAL
	mode and the RB is normally switched off with the master, so the last minutes of the
	session (all of it, for a short one) are still in the -wal file beside it. A plain
	open checkpoints that into the log and deletes it; even mode=ro rewrites the -shm
	index. So, checked with strace against go-sqlite3:
	- -wal and -shm left behind: mode=ro&readonly_shm=1. SQLite opens both read-only and
	  rebuilds the index in memory from the WAL, whatever the -shm holds.
	- otherwise (closed cleanly, nothing pending): immutable=1, no lock, no side file.
	  A -wal without its -shm would need one created, so it is read this way too, and
	  what is in that WAL is not seen.

	Test with:
	grep lastposition /var/log/stratux.log
	curl "http://localhost/getSituation"
*/

package main

import (
	"database/sql"
	"errors"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const (
	lastPositionLogPattern = "flightlog-*.sqlite"
	lastPositionMaxLogs    = 5 // newest flight logs searched for a fix
	// time.Time.String(), how datalog.go stores a time.Time column.
	lastPositionTimeLayout = "2006-01-02 15:04:05.999999999 -0700 MST"
)

// lastPosition is a position found on the card, and when it was valid.
type lastPosition struct {
	Lat     float64
	Lon     float64
	AltFeet float64 // GPS MSL
	Time    time.Time
	Source  string
}

var errNoFix = errors.New("no fix in mySituation")

// restoreLastPosition seeds mySituation with the newest position on the card. Call it
// after hobbsMeter.InitFunc(), which loads the Hobbs log, and before initDataLog(), so
// that this session's own log is not one of the candidates.
func restoreLastPosition() {
	var entries []HobbsEntry
	if hobbsMeter.mutex != nil {
		entries = hobbsMeter.getEntries()
	}
	p, ok := findLastPosition(globalSettings.ReplayLogPath, entries)
	if !ok {
		log.Printf("lastposition: no position on the card, waiting for the GPS\n")
		return
	}
	if !applyLastPosition(p) {
		return
	}
	log.Printf("lastposition: %.6f %.6f %.0f ft MSL of %s from %s\n",
		p.Lat, p.Lon, p.AltFeet, p.Time.UTC().Format(time.RFC3339), p.Source)
}

// findLastPosition is the more recent of the flight logs' and the Hobbs log's.
func findLastPosition(logDir string, hobbs []HobbsEntry) (lastPosition, bool) {
	best, found := lastPositionFromDataLogs(logDir)
	if p, ok := lastPositionFromHobbs(hobbs); ok && (!found || p.Time.After(best.Time)) {
		best, found = p, true
	}
	return best, found
}

// applyLastPosition sets the position, unless the GPS got there first.
func applyLastPosition(p lastPosition) bool {
	mySituation.muGPS.Lock()
	defer mySituation.muGPS.Unlock()
	if mySituation.GPSFixQuality > 0 || mySituation.GPSLatitude != 0 || mySituation.GPSLongitude != 0 {
		return false
	}
	mySituation.GPSLatitude = float32(p.Lat)
	mySituation.GPSLongitude = float32(p.Lon)
	mySituation.GPSAltitudeMSL = float32(p.AltFeet)
	return true
}

// lastPositionFromHobbs is where the newest flight ended: its landed fields, or its
// departure fields while it has none (a power cut before the landing was flushed). The
// file is hand-editable, so the newest entry is searched for, not assumed last. Under a
// minute is not a flight: hobbsmeter.go drops such a leg, but a log written before it
// did may still hold one (I-RVDX 2026-10-17 16:49Z, a hangar power-up "landed" at
// 2492 m).
func lastPositionFromHobbs(entries []HobbsEntry) (lastPosition, bool) {
	var best lastPosition
	found := false
	for _, e := range entries {
		if e.HobbsTimeMinutes*60 < hobbsMinimumLegSec {
			continue
		}
		stamp := e.LandedTime
		p := lastPosition{Lat: e.LandedLatitude, Lon: e.LandedLongitude, AltFeet: e.LandedAltitudeMeters / 0.3048}
		if stamp == "" {
			stamp = e.DepartureTime
			p = lastPosition{Lat: e.DepartureLatitude, Lon: e.DepartureLongitude, AltFeet: e.DepartureAltitudeMeters / 0.3048}
		}
		t, err := time.Parse(time.RFC3339, stamp)
		if err != nil || p.Lat < -90 || p.Lat > 90 || p.Lon < -180 || p.Lon > 180 || (p.Lat == 0 && p.Lon == 0) {
			continue
		}
		if !found || t.After(best.Time) {
			p.Time, p.Source = t, hobbsFileName
			best, found = p, true
		}
	}
	return best, found
}

// lastPositionFromDataLogs searches the newest flight logs in dir, newest first by when
// they were last written to, for the last fix. A log name carries the system time at
// its start, which may be before the GPS set the clock, so it is not used to order them.
// A log without a fix (broken, or cut off before its first write) gives way to the one
// before it.
func lastPositionFromDataLogs(dir string) (lastPosition, bool) {
	if dir == "" {
		return lastPosition{}, false
	}
	paths, _ := filepath.Glob(filepath.Join(dir, lastPositionLogPattern))
	written := make(map[string]time.Time, len(paths))
	for _, path := range paths {
		written[path] = dataLogWrittenTime(path)
	}
	sort.Slice(paths, func(i, j int) bool { return written[paths[i]].After(written[paths[j]]) })
	if len(paths) > lastPositionMaxLogs {
		paths = paths[:lastPositionMaxLogs]
	}
	for _, path := range paths {
		p, err := lastPositionFromDataLog(path)
		if err != nil {
			log.Printf("lastposition: %s: %s\n", path, err.Error())
			continue
		}
		if p.Time.IsZero() { // fix without GPS time
			p.Time = written[path]
		}
		return p, true
	}
	return lastPosition{}, false
}

// dataLogWrittenTime is when a log was last written to: after a power cut, its -wal.
func dataLogWrittenTime(path string) time.Time {
	var t time.Time
	for _, name := range []string{path, path + "-wal"} {
		if fi, err := os.Stat(name); err == nil && fi.ModTime().After(t) {
			t = fi.ModTime()
		}
	}
	return t
}

// lastPositionFromDataLog is the last row of a flight log with a fix and a plausible
// position. Time is zero when that row has no GPS time.
func lastPositionFromDataLog(path string) (lastPosition, error) {
	db, err := sql.Open("sqlite3", dataLogReadOnlyDSN(path))
	if err != nil {
		return lastPosition{}, err
	}
	defer db.Close()
	p := lastPosition{Source: path}
	var gpsTime string
	err = db.QueryRow(`SELECT GPSLatitude, GPSLongitude, IFNULL(GPSAltitudeMSL, 0), IFNULL(GPSTime, '')
		FROM mySituation
		WHERE GPSFixQuality > 0
		AND GPSLatitude BETWEEN -90 AND 90 AND GPSLongitude BETWEEN -180 AND 180
		AND NOT (GPSLatitude = 0 AND GPSLongitude = 0)
		ORDER BY id DESC LIMIT 1`).Scan(&p.Lat, &p.Lon, &p.AltFeet, &gpsTime)
	if err == sql.ErrNoRows {
		return lastPosition{}, errNoFix
	}
	if err != nil {
		return lastPosition{}, err
	}
	if t, err := time.Parse(lastPositionTimeLayout, gpsTime); err == nil && !t.IsZero() {
		p.Time = t
	}
	return p, nil
}

// dataLogReadOnlyDSN opens a flight log without writing beside it: readonly_shm for
// what a power cut left in the WAL, immutable for a log closed cleanly (see the top of
// this file).
func dataLogReadOnlyDSN(path string) string {
	dsn := "file:" + (&url.URL{Path: path}).EscapedPath() + "?mode=ro"
	_, errWal := os.Stat(path + "-wal")
	_, errShm := os.Stat(path + "-shm")
	if errWal == nil && errShm == nil {
		return dsn + "&readonly_shm=1"
	}
	return dsn + "&immutable=1"
}
