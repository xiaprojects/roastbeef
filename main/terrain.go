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
	07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
	08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder
	09 -> Remote display SLAVE: attitude and air data from RB-Sim or RB-01 over USB

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community

	terrain.go: spoken terrain alerts, first step. The requirements (the TER-nnn of the
	comments), what this step leaves out and how it was checked are in
	docs/tech-debt/terrain-alerts.md.

	Once a second the path of the next 60 s is walked over the elevation grid that the
	synthetic view and the map draw, and a caution or a warning is due when the predicted
	height above the terrain falls below the clearance of the flight phase. It is
	advisory: silence is not proof of clearance. It reads the GPS and the baro, and has
	two outputs: the Terrain_ fields of globalStatus, and, while Terrain_Alerts_Enabled is
	on, the alerts through alerts.pushEventByIdent().
*/

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"time"

	"github.com/xiaprojects/roastbeef/common"
)

// The terrain kept in memory is the window of web/RB-01/js/global.js: the grid within
// TERRAIN_WINDOW_DEGREES of the aircraft, cut again once the aircraft is
// TERRAIN_MOVE_FRACTION of the way from its centre to its edge
const (
	TERRAIN_WINDOW_DEGREES = 75.0 / 1.86 / 45.0 // 75 NM, as the synthetic view converts it
	TERRAIN_MOVE_FRACTION  = 0.5
	TERRAIN_RETRY_INTERVAL = 30 * time.Second // after a failed read, as the browser waits
)

// The alert condition, docs/tech-debt/terrain-alerts.md "Alert condition"
const (
	TERRAIN_EVALUATION_INTERVAL       = 1 * time.Second
	TERRAIN_MIN_GROUND_SPEED_KT       = 45.0 // TER-020: below it the aircraft is on the ground, unless Terrain_Alerts_MinSpeedKmh is set
	TERRAIN_POOR_FIX_METERS           = 30.0 // TER-070: horizontal or vertical accuracy
	TERRAIN_PATH_STEP_SECONDS         = 2.0  // TER-080
	TERRAIN_CAUTION_LOOKAHEAD_SECONDS = 60.0
	TERRAIN_WARNING_LOOKAHEAD_SECONDS = 30.0
	TERRAIN_CAUTION_HORIZON_SECONDS   = 15.0 // TER-100: how long a descent is projected
	TERRAIN_WARNING_HORIZON_SECONDS   = 6.0
	TERRAIN_MIN_TURN_RATE             = 1.0 // TER-090: degrees per second, a turn is projected from it
	TERRAIN_MAX_TURN_RATE             = 6.0
	TERRAIN_DESCENDING_FPM            = -200.0 // TER-130
	TERRAIN_PHASE_RANGE_NM            = 5.0    // takeoff and landing, see terrainClearanceFt()
	TERRAIN_PHASE_HEIGHT_FT           = 1000.0
	TERRAIN_FIELD_RANGE_NM            = 2.0 // TER-200: no alert near a field
	TERRAIN_FIELD_HEIGHT_FT           = 500.0
	TERRAIN_CONFIRMATIONS             = 2                // TER-160: consecutive evaluations
	TERRAIN_SLOPE_SAMPLES             = 6                // TER-050: fixes of the GPS rate, 5 s at 1 Hz
	TERRAIN_ALERT_REOPEN_INTERVAL     = 10 * time.Second // TER-190: a condition back within it is the same alert
	TERRAIN_SPEED_SETTING_MAX_KMH     = 500              // the highest Terrain_Alerts_MinSpeedKmh that /setSettings takes
	TERRAIN_FEET_PER_METER            = 3.28084
	TERRAIN_KMH_PER_KNOT              = 1.852
)

// globalStatus.Terrain_State
const (
	TERRAIN_STATE_OFF         = "OFF"
	TERRAIN_STATE_CLEAR       = "CLEAR"
	TERRAIN_STATE_CAUTION     = "CAUTION"
	TERRAIN_STATE_WARNING     = "WARNING"
	TERRAIN_STATE_UNAVAILABLE = "UNAVAILABLE"
)

// globalStatus.Terrain_Reason, why the state is UNAVAILABLE
const (
	TERRAIN_NO_FIX   = "NO_FIX"
	TERRAIN_POOR_FIX = "POOR_FIX"
	TERRAIN_NO_RATE  = "NO_RATE"
	TERRAIN_OFF_GRID = "OFF_GRID"
	TERRAIN_GRID_BAD = "GRID_BAD"
)

// globalStatus.Terrain_Phase
const (
	TERRAIN_PHASE_CRUISE  = "CRUISE"
	TERRAIN_PHASE_TAKEOFF = "TAKEOFF"
	TERRAIN_PHASE_LANDING = "LANDING"
)

// The alerts, by kind. The ident gives pushEventByIdent() the event type
const (
	terrainNoAlert = iota - 1
	terrainCaution
	terrainWarning
	terrainUnavailable
	terrainAlertKinds
)

var terrainAlertIdents = [terrainAlertKinds]string{"terrain-caution", "terrain-warning", "terrain-unavailable"}
var terrainAlertTitles = [terrainAlertKinds]string{"Terrain ahead", "Terrain ahead, pull up", "Terrain alerts unavailable"}

// terrainWindow is the part of the grid around the aircraft, as globalTerrainCut() cuts it
type terrainWindow struct {
	elevations         []int16 // metres, rows × cols, row 0 the south edge
	rows, cols         int
	startLat, startLon float64 // the south-west corner of the first cell, on the grid's own cell edges
	stepLat, stepLon   float64 // degrees per row and per column, the grid's step
	lat, lon           float64 // the position it was cut around
	fields             []terrainField
}

// terrainField is an airfield within the window
type terrainField struct {
	lat, lon, elevationFt float64
}

// terrainPlanimetry is the "planimetry" of the grid file: the south-west corner of the
// first cell and the north-east bound, exclusive (docs/terrain-elevations.md)
type terrainPlanimetry struct {
	Start, End struct{ Lat, Lon float64 }
}

// terrainInput is what one evaluation reads of the situation
type terrainInput struct {
	lat, lon      float64
	altitudeFt    float64 // GPS altitude MSL, TER-030
	groundSpeedKt float64
	trackDeg      float64
	turnRate      float64 // degrees per second, + right
	verticalFpm   float64
	hasVertical   bool
}

// terrainSample is a GPS fix kept for the rates the situation does not carry
type terrainSample struct {
	at                   time.Time
	altitudeFt, trackDeg float64
}

// terrainPath is what one walk of the predicted path found
type terrainPath struct {
	caution, warning bool
	clearanceFt      float64 // the lowest predicted height above the terrain, with the caution horizon
	// Where the alert condition first holds, the warning's if there is one. Zero if it never does
	threatSeconds, threatLat, threatLon, threatElevationFt float64
}

// terrainReport is one evaluation, as globalStatus shows it
type terrainReport struct {
	state, reason, phase string
	suppressed           bool
	path                 terrainPath
	aglFt                float64 // GPS altitude above the cell under the aircraft, while aglValid
	aglValid             bool
}

// terrainAlert is the alert of one kind: its Id, and when it was last closed
type terrainAlert struct {
	id     int
	open   bool
	closed time.Time
}

type TerrainStratuxPlugin struct {
	StratuxPlugin
	enabled            bool
	window             *terrainWindow // nil until the first cut, dropped while the function is off
	failedAt           time.Time      // the last read that failed
	samples            []terrainSample
	lastRangeNM        float64 // to the nearest field, at the last evaluation
	cautions, warnings int     // consecutive evaluations in which the condition held
	flying             bool    // at or above terrainMinGroundSpeedKt() at the last fix
	alerts             [terrainAlertKinds]terrainAlert
	unavailableTold    bool // the unavailable alert was raised in this flight
}

// Shared instance
var terrain = TerrainStratuxPlugin{}

/*
plugin.InitFunc().

	start thread in background
*/
func (terrainInstance *TerrainStratuxPlugin) InitFunc() bool {
	log.Println("Entered Terrain init() ...")
	terrainInstance.Name = "Terrain"
	terrainInstance.enabled = true
	terrainPublish(terrainReport{state: TERRAIN_STATE_OFF})
	go terrainInstance.ListenerFunc()
	return true
}

// ListenerFunc evaluates once a second (TER-610). Cutting a new window delays the next
// evaluation by the read, a fraction of a second every 10 minutes or more.
func (terrainInstance *TerrainStratuxPlugin) ListenerFunc() bool {
	ticker := time.NewTicker(TERRAIN_EVALUATION_INTERVAL)
	defer ticker.Stop()
	for terrainInstance.enabled {
		<-ticker.C
		terrainInstance.evaluate(time.Now())
	}
	return true
}

/*
plugin.ShutdownFunc().

	set halt variable status to allow thread gracefully exit
*/
func (terrainInstance *TerrainStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered Terrain shutdown() ...")
	terrainInstance.enabled = false
	return true
}

// evaluate is one evaluation: the report into globalStatus, and the alert it calls for.
// While Terrain_Alerts_Enabled is off the report is the same and no alert is raised.
func (terrainInstance *TerrainStratuxPlugin) evaluate(now time.Time) {
	if !globalSettings.Terrain_Enabled {
		// Nothing is kept, and an alert left open would stay active for ever
		terrainInstance.window, terrainInstance.samples = nil, nil
		terrainInstance.cautions, terrainInstance.warnings = 0, 0
		terrainInstance.flying = false
		terrainInstance.announce(terrainNoAlert, now)
		terrainPublish(terrainReport{state: TERRAIN_STATE_OFF})
		return
	}
	report := terrainInstance.assess(now)
	kind := terrainNoAlert
	switch {
	case !globalSettings.Terrain_Alerts_Enabled:
	case report.state == TERRAIN_STATE_WARNING:
		kind = terrainWarning
	case report.state == TERRAIN_STATE_CAUTION:
		kind = terrainCaution
	case report.state == TERRAIN_STATE_UNAVAILABLE && terrainInstance.flying:
		// Announced in flight only: on the ground the status is enough
		kind = terrainUnavailable
	}
	terrainInstance.announce(kind, now)
	terrainPublish(report)
}

// assess evaluates the situation against the terrain, TER-010 to TER-200. The height above
// the terrain under the aircraft comes with any report made on a usable fix over the grid,
// on the ground and while the prediction is unavailable too.
func (terrainInstance *TerrainStratuxPlugin) assess(now time.Time) terrainReport {
	in, reason := terrainInstance.readSituation()
	if reason != TERRAIN_NO_FIX {
		terrainInstance.flying = in.groundSpeedKt >= terrainMinGroundSpeedKt()
	}
	if reason != "" {
		return terrainInstance.unavailable(reason)
	}
	window := terrainInstance.windowAround(in.lat, in.lon, now)
	if window == nil {
		return terrainInstance.unavailable(TERRAIN_GRID_BAD)
	}
	report := terrainInstance.predict(window, in)
	if elevation, ok := window.elevation(in.lat, in.lon); ok {
		report.aglFt, report.aglValid = in.altitudeFt-float64(elevation)*TERRAIN_FEET_PER_METER, true
	}
	return report
}

// predict classifies the phase and walks the predicted path, with the confirmations
func (terrainInstance *TerrainStratuxPlugin) predict(window *terrainWindow, in terrainInput) terrainReport {
	report := terrainReport{state: TERRAIN_STATE_CLEAR}
	report.phase, report.suppressed = terrainInstance.classify(window, in)
	if !terrainInstance.flying {
		terrainInstance.cautions, terrainInstance.warnings = 0, 0
		// Landed: slow at a field. Slow elsewhere is the top of a vertical figure
		if report.suppressed {
			terrainInstance.unavailableTold = false
		}
		return report
	}
	if !in.hasVertical {
		return terrainInstance.unavailable(TERRAIN_NO_RATE)
	}
	path, onGrid := window.walk(in, terrainClearanceFt(report.phase, in.verticalFpm))
	if !onGrid {
		return terrainInstance.unavailable(TERRAIN_OFF_GRID)
	}
	report.path = path
	// Suppressed near a field, the evaluation still goes on and shows (TER-240)
	terrainInstance.cautions = terrainCount(terrainInstance.cautions, path.caution && !report.suppressed)
	terrainInstance.warnings = terrainCount(terrainInstance.warnings, path.warning && !report.suppressed)
	if terrainInstance.warnings >= TERRAIN_CONFIRMATIONS {
		report.state = TERRAIN_STATE_WARNING
	} else if terrainInstance.cautions >= TERRAIN_CONFIRMATIONS {
		report.state = TERRAIN_STATE_CAUTION
	}
	return report
}

// terrainMinGroundSpeedKt is the ground speed below which the aircraft is on the ground and
// nothing is evaluated or announced (TER-020): Terrain_Alerts_MinSpeedKmh, or
// TERRAIN_MIN_GROUND_SPEED_KT while that setting is below 1 km/h
func terrainMinGroundSpeedKt() float64 {
	if kmh := globalSettings.Terrain_Alerts_MinSpeedKmh; kmh >= 1 {
		return float64(kmh) / TERRAIN_KMH_PER_KNOT
	}
	return TERRAIN_MIN_GROUND_SPEED_KT
}

func terrainCount(count int, holds bool) int {
	if holds {
		return count + 1
	}
	return 0
}

func (terrainInstance *TerrainStratuxPlugin) unavailable(reason string) terrainReport {
	terrainInstance.cautions, terrainInstance.warnings = 0, 0
	return terrainReport{state: TERRAIN_STATE_UNAVAILABLE, reason: reason}
}

// readSituation reads the GPS and the baro, and keeps the fix for the rates. reason is
// not empty when the fix cannot be used: NO_FIX (TER-060) or POOR_FIX (TER-070).
func (terrainInstance *TerrainStratuxPlugin) readSituation() (in terrainInput, reason string) {
	mySituation.muGPS.Lock()
	valid := isGPSValid()
	good := isGPSGroundTrackValid() && mySituation.GPSVerticalAccuracy < TERRAIN_POOR_FIX_METERS
	in.lat, in.lon = float64(mySituation.GPSLatitude), float64(mySituation.GPSLongitude)
	in.altitudeFt = float64(mySituation.GPSAltitudeMSL)
	in.groundSpeedKt = mySituation.GPSGroundSpeed
	in.trackDeg = float64(mySituation.GPSTrueCourse)
	fix := mySituation.GPSLastFixLocalTime
	mySituation.muGPS.Unlock()
	if !valid || !good {
		terrainInstance.samples = nil
		if !valid {
			return in, TERRAIN_NO_FIX
		}
		return in, TERRAIN_POOR_FIX
	}
	if n := len(terrainInstance.samples); n == 0 || !terrainInstance.samples[n-1].at.Equal(fix) {
		terrainInstance.samples = append(terrainInstance.samples, terrainSample{fix, in.altitudeFt, in.trackDeg})
		if len(terrainInstance.samples) > TERRAIN_SLOPE_SAMPLES {
			terrainInstance.samples = append(terrainInstance.samples[:0], terrainInstance.samples[1:]...)
		}
	}
	in.turnRate = terrainInstance.turnRate()
	// TER-040, narrowed: only the internal sensor and an OGN tracker give a rate. The $PGRMZ
	// and ADS-B estimate sources set a fresh altitude and leave BaroVerticalSpeed as it was
	mySituation.muBaro.Lock()
	source := mySituation.BaroSourceType
	baro := isTempPressValid() && (source == BARO_TYPE_BMP280 || source == BARO_TYPE_OGNTRACKER)
	baroFpm := float64(mySituation.BaroVerticalSpeed)
	mySituation.muBaro.Unlock()
	if baro {
		in.verticalFpm, in.hasVertical = baroFpm, true
	} else {
		in.verticalFpm, in.hasVertical = terrainInstance.gpsVerticalRate()
	}
	return in, ""
}

// turnRate is the track rate between the last two fixes. The situation's GPSTurnRate is
// worked out only while no IMU is connected, and reads 0 in the recordings.
func (terrainInstance *TerrainStratuxPlugin) turnRate() float64 {
	n := len(terrainInstance.samples)
	if n < 2 {
		return 0
	}
	a, b := terrainInstance.samples[n-2], terrainInstance.samples[n-1]
	dt := b.at.Sub(a.at).Seconds()
	if dt <= 0 {
		return 0
	}
	return math.Remainder(b.trackDeg-a.trackDeg, 360) / dt
}

// gpsVerticalRate is the slope of the GPS altitude over the fixes kept, TER-050.
// GPSVerticalSpeed is never assigned in this fork.
func (terrainInstance *TerrainStratuxPlugin) gpsVerticalRate() (float64, bool) {
	n := len(terrainInstance.samples)
	if n < TERRAIN_SLOPE_SAMPLES {
		return 0, false
	}
	a, b := terrainInstance.samples[0], terrainInstance.samples[n-1]
	dt := b.at.Sub(a.at).Seconds()
	if dt <= 0 {
		return 0, false
	}
	return (b.altitudeFt - a.altitudeFt) / dt * 60, true
}

// classify is the flight phase (TER-120) and whether the field box holds (TER-200).
// Takeoff and landing are within TERRAIN_PHASE_RANGE_NM of the nearest field and below
// TERRAIN_PHASE_HEIGHT_FT above it, with the range growing or not; anything else is cruise.
func (terrainInstance *TerrainStratuxPlugin) classify(window *terrainWindow, in terrainInput) (phase string, suppressed bool) {
	field, rangeNM, ok := window.nearestField(in.lat, in.lon)
	if !ok {
		return TERRAIN_PHASE_CRUISE, false
	}
	heightFt := in.altitudeFt - field.elevationFt
	phase = TERRAIN_PHASE_CRUISE
	if rangeNM <= TERRAIN_PHASE_RANGE_NM && heightFt < TERRAIN_PHASE_HEIGHT_FT {
		phase = TERRAIN_PHASE_LANDING
		if rangeNM > terrainInstance.lastRangeNM {
			phase = TERRAIN_PHASE_TAKEOFF
		}
	}
	terrainInstance.lastRangeNM = rangeNM
	return phase, rangeNM <= TERRAIN_FIELD_RANGE_NM && heightFt < TERRAIN_FIELD_HEIGHT_FT
}

// terrainClearanceFt is the required terrain clearance of a phase: TSO-C151c Class C,
// Alternate Table 3.1.1, the descending value below TERRAIN_DESCENDING_FPM (TER-130)
func terrainClearanceFt(phase string, verticalFpm float64) float64 {
	descending := verticalFpm < TERRAIN_DESCENDING_FPM
	switch {
	case phase == TERRAIN_PHASE_TAKEOFF:
		return 100
	case phase == TERRAIN_PHASE_LANDING && descending:
		return 100
	case phase == TERRAIN_PHASE_LANDING:
		return 150
	case descending:
		return 200
	}
	return 250
}

// walk follows the predicted path every TERRAIN_PATH_STEP_SECONDS from the aircraft out
// to the caution look-ahead, straight along the track or on a constant-rate turn (TER-080,
// TER-090). The descent is projected for the horizon only, and a climb counts as level
// (TER-100). The terrain is the cell under each point: TER-110 with no corridor, as in
// the replay of the proposed logic. onGrid is false if a point has no terrain (TER-350).
func (w *terrainWindow) walk(in terrainInput, requiredFt float64) (path terrainPath, onGrid bool) {
	turn := 0.0
	if math.Abs(in.turnRate) >= TERRAIN_MIN_TURN_RATE {
		turn = math.Max(-TERRAIN_MAX_TURN_RATE, math.Min(TERRAIN_MAX_TURN_RATE, in.turnRate))
	}
	sinkFps := math.Min(in.verticalFpm, 0) / 60
	stepNM := in.groundSpeedKt * TERRAIN_PATH_STEP_SECONDS / 3600
	cosLat := math.Cos(common.Radians(in.lat))
	lat, lon := in.lat, in.lon
	path.clearanceFt = math.Inf(1)
	for t := 0.0; t <= TERRAIN_CAUTION_LOOKAHEAD_SECONDS; t += TERRAIN_PATH_STEP_SECONDS {
		elevation, ok := w.elevation(lat, lon)
		if !ok {
			return terrainPath{}, false
		}
		terrainFt := float64(elevation) * TERRAIN_FEET_PER_METER
		cautionFt := in.altitudeFt + sinkFps*math.Min(t, TERRAIN_CAUTION_HORIZON_SECONDS) - terrainFt
		warningFt := in.altitudeFt + sinkFps*math.Min(t, TERRAIN_WARNING_HORIZON_SECONDS) - terrainFt
		caution := cautionFt < requiredFt
		warning := t <= TERRAIN_WARNING_LOOKAHEAD_SECONDS && warningFt < requiredFt
		// A warning point is always a caution point, so the warning's comes last
		if (warning && !path.warning) || (caution && !path.caution) {
			path.threatSeconds, path.threatLat, path.threatLon, path.threatElevationFt = t, lat, lon, terrainFt
		}
		path.caution = path.caution || caution
		path.warning = path.warning || warning
		path.clearanceFt = math.Min(path.clearanceFt, cautionFt)
		heading := common.Radians(in.trackDeg + turn*(t+TERRAIN_PATH_STEP_SECONDS/2))
		lat += stepNM * math.Cos(heading) / 60
		lon += stepNM * math.Sin(heading) / 60 / cosLat
	}
	return path, true
}

// elevation is the cell at or south-west of (lat, lon), as the browser looks it up
func (w *terrainWindow) elevation(lat, lon float64) (int16, bool) {
	i := int(math.Floor((lat - w.startLat) / w.stepLat))
	j := int(math.Floor((lon - w.startLon) / w.stepLon))
	if i < 0 || i >= w.rows || j < 0 || j >= w.cols {
		return 0, false
	}
	return w.elevations[i*w.cols+j], true
}

func (w *terrainWindow) nearestField(lat, lon float64) (nearest terrainField, rangeNM float64, ok bool) {
	rangeNM = math.Inf(1)
	for _, f := range w.fields {
		meters, _ := common.Distance(lat, lon, f.lat, f.lon)
		if nm := meters / 1852; nm < rangeNM {
			nearest, rangeNM, ok = f, nm, true
		}
	}
	return nearest, rangeNM, ok
}

// announce leaves kind the only open terrain alert, none for terrainNoAlert. The old alert
// is closed first, so that a warning replaces a caution in the same evaluation (TER-170).
// An open alert is updated, which moves its end (TER-450). One closed less than
// TERRAIN_ALERT_REOPEN_INTERVAL ago is reopened with the same Id, and the display is not
// told (TER-190); so is the unavailable alert after its first time in a flight, which is
// announced once. Otherwise a new alert is raised, with its sound.
func (terrainInstance *TerrainStratuxPlugin) announce(kind int, now time.Time) {
	for k := range terrainInstance.alerts {
		a := &terrainInstance.alerts[k]
		if k != kind && a.open {
			alerts.pushEvent(Alert{Id: a.id, Active: false})
			a.open, a.closed = false, now
		}
	}
	if kind == terrainNoAlert {
		return
	}
	a := &terrainInstance.alerts[kind]
	told := kind == terrainUnavailable && terrainInstance.unavailableTold
	if a.open || told || now.Sub(a.closed) < TERRAIN_ALERT_REOPEN_INTERVAL {
		alerts.pushEvent(Alert{Id: a.id, Active: true})
	} else {
		a.id = alerts.pushEventByIdent(terrainAlertIdents[kind], Alert{Title: terrainAlertTitles[kind], Timestamp: now, Active: true})
		terrainInstance.unavailableTold = terrainInstance.unavailableTold || kind == terrainUnavailable
	}
	a.open = true
}

// terrainPublish puts a report into globalStatus, which /getStatus serves and the flight
// log records once a second
func terrainPublish(r terrainReport) {
	globalStatus.Terrain_State = r.state
	globalStatus.Terrain_Reason = r.reason
	globalStatus.Terrain_Phase = r.phase
	globalStatus.Terrain_Suppressed = r.suppressed
	clearance := 0.0
	if !math.IsInf(r.path.clearanceFt, 0) {
		clearance = r.path.clearanceFt
	}
	globalStatus.Terrain_ClearanceFt = int(math.Round(clearance))
	globalStatus.Terrain_TimeToThreatS = int(r.path.threatSeconds)
	globalStatus.Terrain_ThreatLat = r.path.threatLat
	globalStatus.Terrain_ThreatLon = r.path.threatLon
	globalStatus.Terrain_ThreatElevationFt = int(math.Round(r.path.threatElevationFt))
	globalStatus.Terrain_AglFt, globalStatus.Terrain_AglValid = 0, r.aglValid
	if r.aglValid {
		globalStatus.Terrain_AglFt = int(math.Round(r.aglFt))
	}
}

// windowAround is the window for an aircraft at (lat, lon), as globalLoadTerrainGrid()
// gives it: the one in memory while the aircraft is within TERRAIN_MOVE_FRACTION of its
// centre, otherwise a new one cut around (lat, lon). The old window stays when a read
// fails, and for TERRAIN_RETRY_INTERVAL after that no read is tried. nil before the first.
func (terrainInstance *TerrainStratuxPlugin) windowAround(lat, lon float64, now time.Time) *terrainWindow {
	w := terrainInstance.window
	reach := TERRAIN_MOVE_FRACTION * TERRAIN_WINDOW_DEGREES
	if w != nil && math.Abs(lat-w.lat) <= reach && math.Abs(lon-w.lon) <= reach {
		return w
	}
	if now.Sub(terrainInstance.failedAt) < TERRAIN_RETRY_INTERVAL {
		return w
	}
	fresh, err := terrainReadWindow(lat, lon)
	if err != nil {
		log.Printf("Terrain: %v\n", err)
		terrainInstance.failedAt = now
		return w
	}
	terrainInstance.window = fresh
	return fresh
}

// terrainReadWindow cuts the window around (lat, lon) out of the grid file that the browser
// draws. The file is streamed, so besides the window only one of its rows is in memory at a
// time, where globalTerrainCut() holds the whole grid for a moment. Its planimetry may come
// after the rows, so a first pass measures the grid. The airfields come with the window.
func terrainReadWindow(lat, lon float64) (*terrainWindow, error) {
	path, err := terrainGridFile()
	if err != nil {
		return nil, err
	}
	rows, cols := 0, 0
	planimetry, err := terrainStream(path, func(i int, row []int16) error {
		if i == 0 {
			cols = len(row)
		} else if len(row) != cols {
			return fmt.Errorf("row %d has %d columns, row 0 has %d", i, len(row), cols)
		}
		rows++
		return nil
	})
	if err != nil {
		return nil, err
	}
	w, i0, j0, err := terrainCut(planimetry, rows, cols, lat, lon)
	if err != nil {
		return nil, fmt.Errorf("%s: %v", path, err)
	}
	w.elevations = make([]int16, 0, w.rows*w.cols)
	_, err = terrainStream(path, func(i int, row []int16) error {
		if len(row) != cols {
			return fmt.Errorf("row %d has %d columns, row 0 has %d", i, len(row), cols)
		}
		if i >= i0 && i < i0+w.rows {
			w.elevations = append(w.elevations, row[j0:j0+w.cols]...)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(w.elevations) != w.rows*w.cols {
		return nil, fmt.Errorf("%s changed while it was read", path)
	}
	if w.fields, err = terrainReadFields(w); err != nil {
		return nil, err
	}
	return w, nil
}

// terrainCut is globalTerrainCut() on a grid of rows × cols: the cells within
// TERRAIN_WINDOW_DEGREES of (lat, lon), whole cells only so that every window keeps the
// grid's step, smaller at the grid's edges and empty off it. i0 and j0 are its first row
// and column in the grid.
// One difference: the Europe grid declares end.lat = 47 with 1001 rows, the last on 47 N,
// so the browser's step of 10/1001° drifts the rows north, up to a cell at the Alps
// (docs/terrain-elevations.md). A grid whose rows, with the last one on end.lat, are as
// far apart as its columns is read at that step: 0.01° for the Europe grid.
func terrainCut(p terrainPlanimetry, rows, cols int, lat, lon float64) (w *terrainWindow, i0, j0 int, err error) {
	if rows < 2 || cols < 1 {
		return nil, 0, 0, fmt.Errorf("terrainData is %d × %d, not a grid", rows, cols)
	}
	stepLat := (p.End.Lat - p.Start.Lat) / float64(rows)
	stepLon := (p.End.Lon - p.Start.Lon) / float64(cols)
	if !(stepLat > 0 && stepLon > 0) {
		return nil, 0, 0, fmt.Errorf("planimetry %+v does not bound the grid", p)
	}
	if inclusive := (p.End.Lat - p.Start.Lat) / float64(rows-1); math.Abs(inclusive-stepLon) < 1e-9 {
		stepLat = inclusive
	}
	cell := func(degrees, first, step float64, count int) int {
		return min(max(int(math.Floor((degrees-first)/step)), 0), count)
	}
	i0 = cell(lat-TERRAIN_WINDOW_DEGREES, p.Start.Lat, stepLat, rows)
	i1 := cell(lat+TERRAIN_WINDOW_DEGREES, p.Start.Lat, stepLat, rows)
	j0 = cell(lon-TERRAIN_WINDOW_DEGREES, p.Start.Lon, stepLon, cols)
	j1 := cell(lon+TERRAIN_WINDOW_DEGREES, p.Start.Lon, stepLon, cols)
	return &terrainWindow{
		rows:     i1 - i0,
		cols:     j1 - j0,
		startLat: p.Start.Lat + float64(i0)*stepLat,
		startLon: p.Start.Lon + float64(j0)*stepLon,
		stepLat:  stepLat,
		stepLon:  stepLon,
		lat:      lat,
		lon:      lon,
	}, i0, j0, nil
}

// terrainGridFile is the grid file named by elevationUrl in settings/synthview.json
func terrainGridFile() (string, error) {
	path := filepath.Join(STRATUX_WWW_DIR, "settings", "synthview.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var setup struct{ ElevationUrl string }
	if err := json.Unmarshal(raw, &setup); err != nil {
		return "", fmt.Errorf("%s: %v", path, err)
	}
	if setup.ElevationUrl == "" {
		return "", fmt.Errorf("%s names no elevationUrl", path)
	}
	return filepath.Join(STRATUX_WWW_DIR, setup.ElevationUrl), nil
}

// terrainStream reads the grid file and calls onRow with each row of terrainData in turn,
// in a slice reused from row to row. It returns the planimetry. Keys may come in any order.
func terrainStream(path string, onRow func(i int, row []int16) error) (terrainPlanimetry, error) {
	var p terrainPlanimetry
	fail := func(err error) (terrainPlanimetry, error) {
		return terrainPlanimetry{}, fmt.Errorf("%s: %v", path, err)
	}
	file, err := os.Open(path)
	if err != nil {
		return p, err
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	if _, err := decoder.Token(); err != nil {
		return fail(err)
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return fail(err)
		}
		switch key {
		case "terrainData":
			if _, err := decoder.Token(); err != nil {
				return fail(err)
			}
			var row []int16
			for i := 0; decoder.More(); i++ {
				if err := decoder.Decode(&row); err != nil {
					return fail(fmt.Errorf("row %d: %v", i, err))
				}
				if err := onRow(i, row); err != nil {
					return fail(err)
				}
			}
			if _, err := decoder.Token(); err != nil {
				return fail(err)
			}
		case "planimetry":
			if err := decoder.Decode(&p); err != nil {
				return fail(err)
			}
		default:
			var skip json.RawMessage
			if err := decoder.Decode(&skip); err != nil {
				return fail(err)
			}
		}
	}
	return p, nil
}

// terrainReadFields is the airfields of settings/db.airfields.json within the window, at
// the elevation of the list (metres) or, for a row without one, of the grid (TER-360)
func terrainReadFields(w *terrainWindow) ([]terrainField, error) {
	path := filepath.Join(STRATUX_WWW_DIR, "settings", "db.airfields.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Lat, Lon float64
		Ele      *float64
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, fmt.Errorf("%s: %v", path, err)
	}
	fields := make([]terrainField, 0)
	for _, r := range rows {
		if math.Abs(r.Lat-w.lat) > TERRAIN_WINDOW_DEGREES || math.Abs(r.Lon-w.lon) > TERRAIN_WINDOW_DEGREES {
			continue
		}
		f := terrainField{lat: r.Lat, lon: r.Lon}
		if r.Ele != nil {
			f.elevationFt = *r.Ele * TERRAIN_FEET_PER_METER
		} else if e, ok := w.elevation(r.Lat, r.Lon); ok {
			f.elevationFt = float64(e) * TERRAIN_FEET_PER_METER
		} else {
			continue
		}
		fields = append(fields, f)
	}
	return fields, nil
}
