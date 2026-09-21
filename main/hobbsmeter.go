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

	hobbsmeter.go: GPS Hobbs meter and flight log

	- Counts the seconds the GPS ground speed is above 50 km/h
	- One entry per flight in settings/hobbsmeter.json (next to aircraft.json, so on
	  the RB boot partition), written at most every 5 minutes to spare the SD card,
	  plus once at landing and at shutdown
	- The totals are published in /getStatus (HobbsTimeMinutes, HobbsFlightMinutes) and
	  the RB-01 Aircraft plate adds them to propellerTime / engineTime of aircraft.json

	A flight opens after 5 consecutive seconds above the threshold (a GPS speed glitch on
	the apron does not open one) and closes after 60 consecutive seconds below it (a
	touch-and-go or a headwind slow-down does not split it). Seconds without a valid GPS
	fix are neither counted nor do they advance either timer.

	File format, hand-editable:
	[
	    {
	        "departureTime": "2026-09-17T10:23:45Z",
	        "departureLatitude": 41.952841,
	        "departureLongitude": 12.501970,
	        "departureAltitudeMeters": 35.0,
	        "landedTime": "2026-09-17T11:10:02Z",
	        "landedLatitude": 41.952841,
	        "landedLongitude": 12.501970,
	        "landedAltitudeMeters": 35.0,
	        "hobbsTimeMinutes": 45
	    }
	]
	The flight in progress is stored with an empty landedTime; after a power cut it
	stays in the log as it was last flushed.

	Test with:
	curl "http://localhost/settings/hobbsmeter.json"
	curl "http://localhost/getStatus" | grep Hobbs
*/

package main

import (
	"encoding/json"
	"log"
	"os"
	"sync"
	"time"
)

const (
	hobbsSpeedThresholdKmh  = 50.0
	hobbsTakeoffDebounceSec = 5
	hobbsLandingDebounceSec = 60
	hobbsSaveIntervalSec    = 5 * 60
	hobbsFileName           = "settings/hobbsmeter.json"
)

// HobbsEntry is one flight, exactly the object stored in hobbsmeter.json.
type HobbsEntry struct {
	DepartureTime           string  `json:"departureTime"`
	DepartureLatitude       float64 `json:"departureLatitude"`
	DepartureLongitude      float64 `json:"departureLongitude"`
	DepartureAltitudeMeters float64 `json:"departureAltitudeMeters"`
	LandedTime              string  `json:"landedTime"`
	LandedLatitude          float64 `json:"landedLatitude"`
	LandedLongitude         float64 `json:"landedLongitude"`
	LandedAltitudeMeters    float64 `json:"landedAltitudeMeters"`
	HobbsTimeMinutes        int     `json:"hobbsTimeMinutes"`
}

// hobbsSample is one second of GPS, already in the units the meter works with.
type hobbsSample struct {
	Valid     bool
	Time      time.Time
	SpeedKmh  float64
	Lat       float64
	Lon       float64
	AltMeters float64
}

type HobbsMeterStratuxPlugin struct {
	StratuxPlugin
	mutex      *sync.Mutex
	filePath   string
	entries    []HobbsEntry // the log; while flying the last element is the open leg
	flying     bool
	legSeconds int        // seconds above threshold in the open leg
	above      int        // consecutive seconds above threshold (takeoff debounce)
	below      int        // consecutive seconds below threshold (landing debounce)
	candidate  HobbsEntry // departure fields captured at the first crossing
	dirty      bool
	readOnly   bool // the file could not be parsed: never overwrite it
	enabled    bool
}

// Shared instance
var hobbsMeter = HobbsMeterStratuxPlugin{}

/*
plugin.InitFunc().

	initialise the mutex and local variables
	restore the flight log from settings/hobbsmeter.json
	start thread in background
*/
func (hobbsInstance *HobbsMeterStratuxPlugin) InitFunc() bool {
	log.Println("Entered HobbsMeterStratuxPlugin init() ...")
	hobbsInstance.Name = "HobbsMeter"
	hobbsInstance.mutex = &sync.Mutex{}
	hobbsInstance.filePath = STRATUX_WWW_DIR + hobbsFileName
	hobbsInstance.entries = make([]HobbsEntry, 0)
	hobbsInstance.load()
	hobbsInstance.publishStatus()
	hobbsInstance.enabled = true
	go hobbsInstance.ListenerFunc()
	return true
}

// load restores the log. A missing file is an empty log (the file is created by the
// first flight); a file that does not parse is reported and left alone, so a hand edit
// gone wrong is never silently replaced.
func (hobbsInstance *HobbsMeterStratuxPlugin) load() {
	data, err := os.ReadFile(hobbsInstance.filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("hobbsmeter: can't read %s: %s\n", hobbsInstance.filePath, err.Error())
		}
		return
	}
	var entries []HobbsEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		addSingleSystemErrorf("hobbsmeter", "can't parse %s: %s", hobbsInstance.filePath, err.Error())
		hobbsInstance.readOnly = true
		return
	}
	if entries != nil {
		hobbsInstance.entries = entries
	}
	log.Printf("hobbsmeter: %d flights, %d minutes from %s\n", len(hobbsInstance.entries), hobbsInstance.totalMinutes(), hobbsInstance.filePath)
}

// save writes the log through a temporary file and a rename, so a power cut while
// writing leaves the previous copy intact.
func (hobbsInstance *HobbsMeterStratuxPlugin) save() {
	if hobbsInstance.readOnly {
		return
	}
	data, err := json.MarshalIndent(hobbsInstance.entries, "", "    ")
	if err != nil {
		addSingleSystemErrorf("hobbsmeter", "can't encode the flight log: %s", err.Error())
		return
	}
	data = append(data, '\n')
	tmp := hobbsInstance.filePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		addSingleSystemErrorf("hobbsmeter", "can't save %s: %s", tmp, err.Error())
		return
	}
	if err := os.Rename(tmp, hobbsInstance.filePath); err != nil {
		addSingleSystemErrorf("hobbsmeter", "can't save %s: %s", hobbsInstance.filePath, err.Error())
		return
	}
	hobbsInstance.dirty = false
	log.Printf("wrote %s.\n", hobbsInstance.filePath)
}

// sampleSituation is the only place that reads the GPS: knots to km/h, feet to meters,
// GPS time when the GPS clock is trusted, else the system clock (set from GPS anyway).
func (hobbsInstance *HobbsMeterStratuxPlugin) sampleSituation() hobbsSample {
	s := hobbsSample{Valid: isGPSValid()}
	if !s.Valid {
		return s
	}
	if isGPSClockValid() {
		s.Time = mySituation.GPSTime.UTC()
	} else {
		s.Time = time.Now().UTC()
	}
	s.SpeedKmh = mySituation.GPSGroundSpeed * 1.852
	s.Lat = float64(mySituation.GPSLatitude)
	s.Lon = float64(mySituation.GPSLongitude)
	s.AltMeters = float64(mySituation.GPSAltitudeMSL) * 0.3048
	return s
}

// update feeds one second of GPS into the flight state machine. It touches no globals
// so it can be driven by the unit test. Returns true when a flight has just closed,
// so the caller can save without waiting for the periodic flush.
func (hobbsInstance *HobbsMeterStratuxPlugin) update(s hobbsSample) bool {
	if !s.Valid {
		return false
	}
	if s.SpeedKmh > hobbsSpeedThresholdKmh {
		hobbsInstance.below = 0
		hobbsInstance.above++
		if !hobbsInstance.flying {
			if hobbsInstance.above == 1 {
				hobbsInstance.candidate = HobbsEntry{
					DepartureTime:           s.Time.Format(time.RFC3339),
					DepartureLatitude:       s.Lat,
					DepartureLongitude:      s.Lon,
					DepartureAltitudeMeters: s.AltMeters,
				}
			}
			if hobbsInstance.above < hobbsTakeoffDebounceSec {
				return false
			}
			// Takeoff: the debounce seconds count, they were flown too.
			hobbsInstance.flying = true
			hobbsInstance.entries = append(hobbsInstance.entries, hobbsInstance.candidate)
			hobbsInstance.legSeconds = hobbsInstance.above - 1
		}
		hobbsInstance.legSeconds++
		hobbsInstance.entries[len(hobbsInstance.entries)-1].HobbsTimeMinutes = hobbsInstance.legSeconds / 60
		hobbsInstance.dirty = true
		return false
	}

	hobbsInstance.above = 0
	if !hobbsInstance.flying {
		return false
	}
	hobbsInstance.below++
	if hobbsInstance.below == 1 {
		// Every new drop below the threshold overwrites these, so the last one wins.
		leg := &hobbsInstance.entries[len(hobbsInstance.entries)-1]
		leg.LandedTime = s.Time.Format(time.RFC3339)
		leg.LandedLatitude = s.Lat
		leg.LandedLongitude = s.Lon
		leg.LandedAltitudeMeters = s.AltMeters
		hobbsInstance.dirty = true
	}
	if hobbsInstance.below < hobbsLandingDebounceSec {
		return false
	}
	// Landed.
	hobbsInstance.flying = false
	hobbsInstance.below = 0
	hobbsInstance.legSeconds = 0
	hobbsInstance.dirty = true
	return true
}

// totalMinutes is the whole log, the flight in progress included.
func (hobbsInstance *HobbsMeterStratuxPlugin) totalMinutes() int {
	total := 0
	for i := range hobbsInstance.entries {
		total += hobbsInstance.entries[i].HobbsTimeMinutes
	}
	return total
}

func (hobbsInstance *HobbsMeterStratuxPlugin) publishStatus() {
	globalStatus.HobbsTimeMinutes = int64(hobbsInstance.totalMinutes())
	globalStatus.HobbsFlightMinutes = int64(hobbsInstance.legSeconds / 60)
}

// getEntries returns a copy of the log for the REST interface.
func (hobbsInstance *HobbsMeterStratuxPlugin) getEntries() []HobbsEntry {
	hobbsInstance.mutex.Lock()
	defer hobbsInstance.mutex.Unlock()
	entries := make([]HobbsEntry, len(hobbsInstance.entries))
	copy(entries, hobbsInstance.entries)
	return entries
}

func (hobbsInstance *HobbsMeterStratuxPlugin) ListenerFunc() bool {
	sinceSave := 0
	for hobbsInstance.enabled == true {
		time.Sleep(1 * time.Second)
		sinceSave++
		hobbsInstance.mutex.Lock()
		landed := hobbsInstance.update(hobbsInstance.sampleSituation())
		hobbsInstance.publishStatus()
		if landed || (sinceSave >= hobbsSaveIntervalSec && hobbsInstance.dirty) {
			hobbsInstance.save()
		}
		if sinceSave >= hobbsSaveIntervalSec {
			sinceSave = 0
		}
		hobbsInstance.mutex.Unlock()
	}
	return true
}

/*
plugin.ShutdownFunc().

	set halt variable status to allow thread gracefully exit
	flush the flight log if it changed since the last write
*/
func (hobbsInstance *HobbsMeterStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered HobbsMeterStratuxPlugin shutdown() ...")
	hobbsInstance.enabled = false
	if hobbsInstance.mutex == nil { // never started (trace replay)
		return true
	}
	hobbsInstance.mutex.Lock()
	if hobbsInstance.dirty {
		hobbsInstance.save()
	}
	hobbsInstance.mutex.Unlock()
	return true
}
