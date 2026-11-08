/*
	terrain_test.go: requirements-style unit tests for the terrain function
	(main/terrain.go). The ids are the TER-nnn of docs/tech-debt/terrain-alerts.md.
	They carry no Covers: tag: RB-HLR-TER is not in requirements/ yet, and
	scripts/trace.py refuses a tag that names no requirement.

	The grid is a synthetic one in a temporary web folder, found the way the real
	one is (settings/synthview.json, elevationUrl): 0.01° cells from 42 N 11 E to
	44 N 13 E, at sea level except for the terrain a test puts on it. The situation
	is set field by field, one fix a second on a clock that does not run by itself,
	and each evaluation is called directly. The alert function is the real one,
	with the broadcaster of alerts_test.go.
*/

package main

import (
	"fmt"
	"math"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// terrainRig is a test's terrain function, situation and clock
type terrainRig struct {
	t   *testing.T
	now time.Time
}

// terrainCells is the elevation of a cell of the test grid from its centre
type terrainCells func(lat, lon float64) int16

// flat is a grid at sea level
func flat(lat, lon float64) int16 { return 0 }

// band raises the cells whose centre is between two latitudes to metres
func band(fromLat, toLat float64, metres int16) terrainCells {
	return func(lat, lon float64) int16 {
		if lat >= fromLat && lat <= toLat {
			return metres
		}
		return 0
	}
}

// newTerrainRig gives the test a fresh terrain function, switched on with its alerts,
// over the grid of cells and the airfields given as the JSON of db.airfields.json
func newTerrainRig(t *testing.T, cells terrainCells, airfields string) *terrainRig {
	withAlerts(t)
	alertUpdate.messages = make(chan []byte, 1000)
	savedSituation, savedClock, savedStatus, savedSettings, savedTerrain := mySituation, stratuxClock, globalStatus, globalSettings, terrain
	t.Cleanup(func() {
		mySituation, stratuxClock, globalStatus, globalSettings, terrain = savedSituation, savedClock, savedStatus, savedSettings, savedTerrain
	})
	mySituation = SituationData{muGPS: &sync.Mutex{}, muBaro: &sync.Mutex{}}
	stratuxClock = &monotonic{Time: time.Date(2026, 11, 8, 10, 0, 0, 0, time.UTC)}
	terrain = TerrainStratuxPlugin{}
	globalSettings.Terrain_Enabled, globalSettings.Terrain_Alerts_Enabled = true, true
	globalSettings.Terrain_Alerts_MinSpeedKmh = 0 // the default, 45 kt
	globalStatus.GPS_connected = true
	STRATUX_WWW_DIR = t.TempDir() + "/"
	writeTerrainFile(t, "settings/synthview.json", `{"elevationUrl": "/settings/terrain.json", "glbPath": "/settings/glb/"}`)
	writeTerrainGrid(t, cells, false)
	writeTerrainFile(t, "settings/db.airfields.json", airfields)
	return &terrainRig{t: t, now: stratuxClock.Time}
}

func writeTerrainFile(t *testing.T, name, content string) {
	path := filepath.Join(STRATUX_WWW_DIR, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

// writeTerrainGrid writes the 200 × 200 test grid, the planimetry after the rows as in
// the Europe grid, or before them as in the worldwide sample
func writeTerrainGrid(t *testing.T, cells terrainCells, planimetryFirst bool) {
	planimetry := `"planimetry": {"start": {"lat": 42, "lon": 11}, "end": {"lat": 44, "lon": 13}}`
	var b strings.Builder
	b.WriteString("{")
	if planimetryFirst {
		b.WriteString(planimetry + ", ")
	}
	b.WriteString(`"latitude": 0, "terrainData": [`)
	for i := 0; i < 200; i++ {
		row := make([]string, 200)
		for j := range row {
			row[j] = fmt.Sprint(cells(42+(float64(i)+0.5)*0.01, 11+(float64(j)+0.5)*0.01))
		}
		if i > 0 {
			b.WriteString(",\n")
		}
		b.WriteString("[" + strings.Join(row, ",") + "]")
	}
	b.WriteString("]")
	if !planimetryFirst {
		b.WriteString(", " + planimetry)
	}
	b.WriteString("}")
	writeTerrainFile(t, "settings/terrain.json", b.String())
}

// fix is a GPS fix one second after the last, with the baro rate of the internal sensor
func (r *terrainRig) fix(lat, lon, altitudeFt, speedKt, trackDeg, verticalFpm float64) {
	r.now = r.now.Add(time.Second)
	stratuxClock.Time = r.now
	mySituation.GPSFixQuality = 1
	mySituation.GPSLatitude, mySituation.GPSLongitude = float32(lat), float32(lon)
	mySituation.GPSAltitudeMSL = float32(altitudeFt)
	mySituation.GPSGroundSpeed, mySituation.GPSTrueCourse = speedKt, float32(trackDeg)
	mySituation.GPSHorizontalAccuracy, mySituation.GPSVerticalAccuracy = 5, 7
	mySituation.GPSLastFixLocalTime = r.now
	mySituation.BaroSourceType, mySituation.BaroLastMeasurementTime = BARO_TYPE_BMP280, r.now
	mySituation.BaroVerticalSpeed = float32(verticalFpm)
}

// fly is a fix and one evaluation of it
func (r *terrainRig) fly(lat, lon, altitudeFt, speedKt, trackDeg, verticalFpm float64) {
	r.fix(lat, lon, altitudeFt, speedKt, trackDeg, verticalFpm)
	terrain.evaluate(r.now)
}

func (r *terrainRig) wantState(state, reason string) {
	r.t.Helper()
	if globalStatus.Terrain_State != state || globalStatus.Terrain_Reason != reason {
		r.t.Fatalf("state %q reason %q, want %q %q", globalStatus.Terrain_State, globalStatus.Terrain_Reason, state, reason)
	}
}

// terrainAlerts is the queued alerts of the terrain types
func terrainAlerts() (out []Alert) {
	for _, a := range queued() {
		if a.Type >= EVENT_TYPE_TERRAIN_CAUTION && a.Type <= EVENT_TYPE_TERRAIN_UNAVAILABLE {
			out = append(out, a)
		}
	}
	return out
}

// The scenarios fly north at 120 kt from 43 N 12 E, 2 NM a minute, at 1200 ft over a
// 300 m (984 ft) band: 216 ft of clearance, under the 250 ft of cruise. The caution band
// starts 1.2 NM ahead, beyond the warning's 30 s; the warning band 0.6 NM ahead.
var (
	cautionBand = band(43.021, 43.039, 300)
	warningBand = band(43.011, 43.019, 300)
)

const terrainScenarioFt = 1200

// 0.0005° north of 43 N, so that no point of the path falls on a cell edge
const terrainScenarioLat = 43.0005

// TER-030, TER-080, TER-100, TER-140, TER-160: a caution is raised when the condition
// holds on two consecutive evaluations, not on the first one.
func TestTerrainCautionNeedsTwoConsecutiveEvaluations(t *testing.T) {
	r := newTerrainRig(t, cautionBand, "[]")
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.wantState(TERRAIN_STATE_CLEAR, "")
	if globalStatus.Terrain_TimeToThreatS != 36 {
		t.Errorf("time to threat %d s, want 36 s: the band is 1.2 NM ahead at 120 kt", globalStatus.Terrain_TimeToThreatS)
	}
	if n := len(terrainAlerts()); n != 0 {
		t.Fatalf("%d alerts after one evaluation, want none", n)
	}
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.wantState(TERRAIN_STATE_CAUTION, "")
	got := terrainAlerts()
	if len(got) != 1 || got[0].Type != EVENT_TYPE_TERRAIN_CAUTION || !got[0].Active || got[0].Title != "Terrain ahead" {
		t.Fatalf("alerts %+v, want one active caution", got)
	}
	if want := 216; terrainAbs(globalStatus.Terrain_ClearanceFt-want) > 1 {
		t.Errorf("clearance %d ft, want %d", globalStatus.Terrain_ClearanceFt, want)
	}
	if globalStatus.Terrain_ThreatElevationFt != 984 || math.Abs(globalStatus.Terrain_ThreatLat-43.0205) > 1e-6 {
		t.Errorf("threat %v N, %d ft; want 43.0205 N, 984 ft", globalStatus.Terrain_ThreatLat, globalStatus.Terrain_ThreatElevationFt)
	}
	// A single evaluation with the condition, between two without, raises nothing
	r = newTerrainRig(t, cautionBand, "[]")
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.fly(terrainScenarioLat, 12, 2000, 120, 0, 0)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.wantState(TERRAIN_STATE_CLEAR, "")
	if n := len(terrainAlerts()); n != 0 {
		t.Errorf("%d alerts from a one-evaluation glitch, want none", n)
	}
}

func terrainAbs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// TER-150, TER-170, TER-450: a warning replaces the open caution in the evaluation that
// raises it, and an alert that goes on is updated, not raised again.
func TestTerrainWarningReplacesTheCautionAndGoesOnAsOneAlert(t *testing.T) {
	r := newTerrainRig(t, func(lat, lon float64) int16 { return cautionBand(lat, lon) + warningBand(lat, lon) }, "[]")
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.wantState(TERRAIN_STATE_WARNING, "")
	got := terrainAlerts()
	if len(got) != 1 || got[0].Type != EVENT_TYPE_TERRAIN_WARNING || got[0].Title != "Terrain ahead, pull up" {
		t.Fatalf("alerts %+v, want only a warning when both conditions hold at once", got)
	}

	r = newTerrainRig(t, func(lat, lon float64) int16 { return cautionBand(lat, lon) + warningBand(lat, lon) }, "[]")
	// 0.01° south of the scenario, the warning band is beyond 30 s
	r.fly(terrainScenarioLat-0.01, 12, terrainScenarioFt, 120, 0, 0)
	r.fly(terrainScenarioLat-0.01, 12, terrainScenarioFt, 120, 0, 0)
	r.wantState(TERRAIN_STATE_CAUTION, "")
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.wantState(TERRAIN_STATE_CAUTION, "") // the warning's first evaluation
	sent(t)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.wantState(TERRAIN_STATE_WARNING, "")
	got = terrainAlerts()
	if len(got) != 2 || got[0].Type != EVENT_TYPE_TERRAIN_CAUTION || got[0].Active ||
		got[1].Type != EVENT_TYPE_TERRAIN_WARNING || !got[1].Active {
		t.Fatalf("alerts %+v, want the caution closed and the warning open", got)
	}
	if s := sent(t); len(s) != 1 || s[0].Type != EVENT_TYPE_TERRAIN_WARNING {
		t.Fatalf("the display was sent %+v, want the warning alone", s)
	}
	for i := 0; i < 5; i++ {
		r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	}
	got = terrainAlerts()
	if len(got) != 2 || !got[1].Active {
		t.Fatalf("alerts %+v, want the same warning, still active", got)
	}
	if s := sent(t); len(s) != 0 {
		t.Errorf("the display was sent %+v while the warning went on, want nothing", s)
	}
}

// TER-190: a condition that ends closes its alert; back within 10 s it is the same alert,
// reopened with no new sound; back later it is a new alert.
func TestTerrainAConditionBackWithinTenSecondsIsTheSameAlert(t *testing.T) {
	r := newTerrainRig(t, cautionBand, "[]")
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	id := terrainAlerts()[0].Id
	r.fly(terrainScenarioLat, 12, 2000, 120, 0, 0)
	r.wantState(TERRAIN_STATE_CLEAR, "")
	if got := terrainAlerts(); got[0].Active {
		t.Fatalf("alert %+v still active after the condition ended", got[0])
	}
	sent(t)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	if got := terrainAlerts(); len(got) != 1 || got[0].Id != id || !got[0].Active {
		t.Fatalf("alerts %+v, want alert %d reopened", got, id)
	}
	if s := sent(t); len(s) != 0 {
		t.Errorf("the display was sent %+v for a reopened alert, want nothing", s)
	}
	r.fly(terrainScenarioLat, 12, 2000, 120, 0, 0)
	r.now = r.now.Add(10 * time.Second)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	if got := terrainAlerts(); len(got) != 2 || got[1].Id == id || !got[1].Active {
		t.Fatalf("alerts %+v, want a new caution after 10 s clear", got)
	}
}

// Terrain_Alerts_Enabled: off, the function reports the same and raises nothing, and
// switching it off closes the alert that is open.
func TestTerrainAlertsSettingOffReportsWithoutAlerts(t *testing.T) {
	r := newTerrainRig(t, cautionBand, "[]")
	globalSettings.Terrain_Alerts_Enabled = false
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.wantState(TERRAIN_STATE_CAUTION, "")
	if n := len(terrainAlerts()); n != 0 {
		t.Fatalf("%d alerts with Terrain_Alerts_Enabled off, want none", n)
	}
	globalSettings.Terrain_Alerts_Enabled = true
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	globalSettings.Terrain_Alerts_Enabled = false
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	if got := terrainAlerts(); len(got) != 1 || got[0].Active {
		t.Fatalf("alerts %+v, want the caution closed when the alerts were switched off", got)
	}
}

// Terrain_Enabled: off, the function reports OFF, keeps no terrain and closes its alert.
func TestTerrainSettingOffStopsTheFunction(t *testing.T) {
	r := newTerrainRig(t, cautionBand, "[]")
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	globalSettings.Terrain_Enabled = false
	r.fly(terrainScenarioLat, 12, terrainScenarioFt, 120, 0, 0)
	r.wantState(TERRAIN_STATE_OFF, "")
	if terrain.window != nil {
		t.Error("the window is still in memory with the function off")
	}
	if got := terrainAlerts(); len(got) != 1 || got[0].Active {
		t.Errorf("alerts %+v, want the caution closed", got)
	}
}

// The settings are off, and the minimum speed 0 (45 kt), unless stratux.conf says
// otherwise. /setSettings takes a minimum speed from 0 to 500 km/h, rounded, and refuses
// any other.
func TestTerrainSettingsDefaults(t *testing.T) {
	if !inChild(t) {
		return
	}
	for _, c := range []struct {
		conf            string
		enabled, alerts bool
		speedKmh        int
	}{
		{`{"RadarRange": 5}`, false, false, 0},
		{`{"Terrain_Enabled": true}`, true, false, 0},
		{`{"Terrain_Enabled": true, "Terrain_Alerts_Enabled": true}`, true, true, 0},
		{`{"Terrain_Alerts_MinSpeedKmh": 180}`, false, false, 180},
	} {
		if err := os.WriteFile(configLocation, []byte(c.conf), 0644); err != nil {
			t.Fatal(err)
		}
		readSettings()
		if globalSettings.Terrain_Enabled != c.enabled || globalSettings.Terrain_Alerts_Enabled != c.alerts ||
			globalSettings.Terrain_Alerts_MinSpeedKmh != c.speedKmh {
			t.Errorf("stratux.conf %s: Terrain_Enabled %v, Terrain_Alerts_Enabled %v, Terrain_Alerts_MinSpeedKmh %d; want %v, %v, %d", c.conf,
				globalSettings.Terrain_Enabled, globalSettings.Terrain_Alerts_Enabled, globalSettings.Terrain_Alerts_MinSpeedKmh,
				c.enabled, c.alerts, c.speedKmh)
		}
	}
	for _, c := range []struct {
		body string
		want int
	}{
		{`{"Terrain_Alerts_MinSpeedKmh": 150.4}`, 150},
		{`{"Terrain_Alerts_MinSpeedKmh": -1}`, 150},
		{`{"Terrain_Alerts_MinSpeedKmh": 1800}`, 150},
		{`{"Terrain_Alerts_MinSpeedKmh": "fast"}`, 150},
		{`{"Terrain_Alerts_MinSpeedKmh": 500}`, 500},
		{`{"Terrain_Alerts_MinSpeedKmh": 0}`, 0},
	} {
		handleSettingsSetRequest(httptest.NewRecorder(), httptest.NewRequest("POST", "/setSettings", strings.NewReader(c.body)))
		if globalSettings.Terrain_Alerts_MinSpeedKmh != c.want {
			t.Errorf("POST /setSettings %s: Terrain_Alerts_MinSpeedKmh %d, want %d", c.body, globalSettings.Terrain_Alerts_MinSpeedKmh, c.want)
		}
	}
	readSettings()
	if globalSettings.Terrain_Alerts_MinSpeedKmh != 0 {
		t.Errorf("stratux.conf after /setSettings: Terrain_Alerts_MinSpeedKmh %d, want the 0 saved", globalSettings.Terrain_Alerts_MinSpeedKmh)
	}
}

// TER-020: by default, below 45 kt of ground speed the aircraft is on the ground and
// nothing is raised.
func TestTerrainIsNotEvaluatedBelowTheMinimumGroundSpeed(t *testing.T) {
	r := newTerrainRig(t, band(42.99, 43.05, 1000), "[]")
	r.fly(43, 12, 500, 44, 0, 0)
	r.fly(43, 12, 500, 44, 0, 0)
	r.wantState(TERRAIN_STATE_CLEAR, "")
	if n := len(terrainAlerts()); n != 0 {
		t.Errorf("%d alerts at 44 kt, want none", n)
	}
	r.fly(43, 12, 500, 45, 0, 0)
	r.fly(43, 12, 500, 45, 0, 0)
	r.wantState(TERRAIN_STATE_WARNING, "")
}

// TER-020, Terrain_Alerts_MinSpeedKmh: the minimum ground speed is the setting's, in km/h,
// and 45 kt while the setting is below 1. Below it nothing is evaluated: no alert, the
// unavailable one included, and slowing below it closes the alert that is open.
func TestTerrainMinimumGroundSpeedIsTheSetting(t *testing.T) {
	// 500 ft over 1000 m: a warning at any speed
	r := newTerrainRig(t, band(42.99, 43.05, 1000), "[]")
	for _, c := range []struct {
		kmh  int
		want float64
	}{{0, 45}, {-5, 45}, {1, 1 / 1.852}, {180, 180 / 1.852}} {
		globalSettings.Terrain_Alerts_MinSpeedKmh = c.kmh
		if got := terrainMinGroundSpeedKt(); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("Terrain_Alerts_MinSpeedKmh %d: %v kt, want %v", c.kmh, got, c.want)
		}
	}
	globalSettings.Terrain_Alerts_MinSpeedKmh = 180 // 97.19 kt
	r.fly(43, 12, 500, 97, 0, 0)
	r.fly(43, 12, 500, 97, 0, 0)
	r.wantState(TERRAIN_STATE_CLEAR, "")
	if n := len(terrainAlerts()); n != 0 || globalStatus.Terrain_ClearanceFt != 0 {
		t.Fatalf("%d alerts, clearance %d ft at 97 kt, under 180 km/h; want nothing evaluated", n, globalStatus.Terrain_ClearanceFt)
	}
	r.fly(43, 12, 500, 98, 0, 0)
	r.wantState(TERRAIN_STATE_CLEAR, "") // the first evaluation of two
	r.fly(43, 12, 500, 98, 0, 0)
	r.wantState(TERRAIN_STATE_WARNING, "")
	if got := terrainAlerts(); len(got) != 1 || got[0].Type != EVENT_TYPE_TERRAIN_WARNING || !got[0].Active {
		t.Fatalf("alerts %+v at 98 kt, want the warning", got)
	}
	r.fly(43, 12, 500, 97, 0, 0)
	r.wantState(TERRAIN_STATE_CLEAR, "")
	if got := terrainAlerts(); len(got) != 1 || got[0].Active {
		t.Fatalf("alerts %+v back at 97 kt, want the warning closed", got)
	}

	// The unavailable alert waits for the speed too
	r = newTerrainRig(t, flat, "[]")
	globalSettings.Terrain_Alerts_MinSpeedKmh = 180
	poor := func(speedKt float64) {
		r.fix(43, 12, 3000, speedKt, 0, 0)
		mySituation.GPSVerticalAccuracy = 40
		terrain.evaluate(r.now)
	}
	poor(90)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_POOR_FIX)
	if n := len(terrainAlerts()); n != 0 {
		t.Fatalf("%d alerts unavailable at 90 kt, want none", n)
	}
	poor(120)
	if got := terrainAlerts(); len(got) != 1 || got[0].Type != EVENT_TYPE_TERRAIN_UNAVAILABLE {
		t.Fatalf("alerts %+v unavailable at 120 kt, want the unavailable alert", got)
	}
}

// TER-120, TER-200, TER-360: within 2 NM of a field and below 500 ft above it no alert
// is raised, while the evaluation goes on. The field's elevation is the list's, or the
// grid's for a row without one. Near a field and low, the phase is landing or takeoff.
func TestTerrainNearAFieldAlertsAreSuppressed(t *testing.T) {
	// A field on the 300 m band 1.2 NM ahead, flown over at 66 ft: under the 100 ft of
	// the landing phase, within 2 NM and below 500 ft above the field
	for _, field := range []string{`[{"Lat": 43.025, "Lon": 12.005, "Ele": 300}]`, `[{"Lat": 43.025, "Lon": 12.005}]`} {
		r := newTerrainRig(t, cautionBand, field)
		r.fly(terrainScenarioLat, 12, 1050, 120, 0, 0)
		r.fly(terrainScenarioLat, 12, 1050, 120, 0, 0)
		r.wantState(TERRAIN_STATE_CLEAR, "")
		if !globalStatus.Terrain_Suppressed || globalStatus.Terrain_TimeToThreatS != 36 || globalStatus.Terrain_ClearanceFt != 66 {
			t.Errorf("field %s: suppressed %v, threat in %d s, clearance %d; want suppressed with the condition held, 36 s, 66 ft",
				field, globalStatus.Terrain_Suppressed, globalStatus.Terrain_TimeToThreatS, globalStatus.Terrain_ClearanceFt)
		}
		if n := len(terrainAlerts()); n != 0 {
			t.Errorf("field %s: %d alerts in the field box, want none", field, n)
		}
	}
	// Approaching the field below 1000 ft above it is landing, leaving it is takeoff
	r := newTerrainRig(t, flat, `[{"Lat": 43.05, "Lon": 12, "Ele": 0}]`)
	r.fly(43, 12, 900, 90, 0, 0)
	r.fly(43.001, 12, 900, 90, 0, 0)
	if globalStatus.Terrain_Phase != TERRAIN_PHASE_LANDING {
		t.Errorf("phase %q closing in on the field, want LANDING", globalStatus.Terrain_Phase)
	}
	r.fly(42.999, 12, 900, 90, 180, 0)
	if globalStatus.Terrain_Phase != TERRAIN_PHASE_TAKEOFF {
		t.Errorf("phase %q leaving the field, want TAKEOFF", globalStatus.Terrain_Phase)
	}
	r.fly(42.999, 12, 1100, 90, 180, 0)
	if globalStatus.Terrain_Phase != TERRAIN_PHASE_CRUISE {
		t.Errorf("phase %q 1100 ft above the field, want CRUISE", globalStatus.Terrain_Phase)
	}
}

// TSO-C151c Class C, Tables A, B and E: the descending heights at which the warning and
// the caution fire, at 100, 150 and 200 kt over level terrain. The warning is on before
// the TSO minimum and the caution off above the TSO maximum.
func TestTerrainAlertHeightsMeetTheTSOTables(t *testing.T) {
	w := terrainUniformWindow(100)
	ground := 100 * TERRAIN_FEET_PER_METER
	for _, c := range []struct {
		name                string
		phase               string
		rateFpm             float64
		warningFt, tsoMinFt float64
		cautionFt, tsoMaxFt float64
	}{
		{"cruise, Table A", TERRAIN_PHASE_CRUISE, 500, 250, 226, 325, 550},
		{"cruise, Table A", TERRAIN_PHASE_CRUISE, 1000, 300, 254, 450, 600},
		{"cruise, Table A", TERRAIN_PHASE_CRUISE, 2000, 400, 317, 700, 800},
		{"approach, Table E", TERRAIN_PHASE_LANDING, 500, 150, 109, 225, 300},
		{"approach, Table E", TERRAIN_PHASE_LANDING, 750, 175, 114, 287.5, 325},
		{"approach, Table E", TERRAIN_PHASE_LANDING, 1000, 200, 121, 350, 350},
	} {
		for _, speed := range []float64{100, 150, 200} {
			at := func(heightFt float64) terrainPath {
				in := terrainInput{lat: 43, lon: 12, altitudeFt: ground + heightFt, groundSpeedKt: speed, verticalFpm: -c.rateFpm}
				p, ok := w.walk(in, terrainClearanceFt(c.phase, in.verticalFpm))
				if !ok {
					t.Fatal("the path left the window")
				}
				return p
			}
			name := fmt.Sprintf("%s, %.0f ft/min, %.0f kt", c.name, c.rateFpm, speed)
			if !at(c.warningFt-1).warning || at(c.warningFt+1).warning {
				t.Errorf("%s: the warning does not fire at %.0f ft", name, c.warningFt)
			}
			if !at(c.tsoMinFt + 1).warning {
				t.Errorf("%s: no warning at %.0f ft, the TSO minimum", name, c.tsoMinFt+1)
			}
			if !at(c.cautionFt-1).caution || at(c.cautionFt+1).caution {
				t.Errorf("%s: the caution does not fire at %.1f ft", name, c.cautionFt)
			}
			if at(c.tsoMaxFt + 1).caution {
				t.Errorf("%s: a caution at %.0f ft, above the TSO maximum", name, c.tsoMaxFt+1)
			}
		}
	}
	// Table B, level flight: no alert at 340 ft above the terrain, an alert at 240 ft
	level := func(heightFt float64) terrainPath {
		in := terrainInput{lat: 43, lon: 12, altitudeFt: ground + heightFt, groundSpeedKt: 150}
		p, _ := w.walk(in, terrainClearanceFt(TERRAIN_PHASE_CRUISE, 0))
		return p
	}
	if level(340).caution || !level(240).caution || !level(240).warning {
		t.Errorf("level at 340 ft: %+v; at 240 ft: %+v; want no alert, then both", level(340), level(240))
	}
}

// terrainUniformWindow is a window of level terrain around 43 N 12 E
func terrainUniformWindow(metres int16) *terrainWindow {
	w := &terrainWindow{rows: 100, cols: 100, startLat: 42.5, startLon: 11.5, stepLat: 0.01, stepLon: 0.01, lat: 43, lon: 12}
	w.elevations = make([]int16, w.rows*w.cols)
	for i := range w.elevations {
		w.elevations[i] = metres
	}
	return w
}

// TER-100: a climb counts as level flight.
func TestTerrainAClimbCountsAsLevel(t *testing.T) {
	w := terrainUniformWindow(0)
	for _, c := range []struct {
		heightFt float64
		caution  bool
	}{{260, false}, {240, true}} {
		in := terrainInput{lat: 43, lon: 12, altitudeFt: c.heightFt, groundSpeedKt: 120, verticalFpm: 2000}
		if p, _ := w.walk(in, terrainClearanceFt(TERRAIN_PHASE_CRUISE, in.verticalFpm)); p.caution != c.caution {
			t.Errorf("climbing at %.0f ft: caution %v, want %v", c.heightFt, p.caution, c.caution)
		}
	}
}

// TER-090: from 1°/s of track rate the path turns, up to 6°/s. The rate comes from the
// last two fixes, across north too.
func TestTerrainAConstantRateTurnIsProjected(t *testing.T) {
	// A wall east of 12.01 E: flying north it is never reached, turning right it is
	w := terrainUniformWindow(0)
	for i := 0; i < w.rows; i++ {
		for j := 51; j < w.cols; j++ {
			w.elevations[i*w.cols+j] = 1000
		}
	}
	walk := func(rate float64) terrainPath {
		p, _ := w.walk(terrainInput{lat: 43, lon: 12, altitudeFt: 2000, groundSpeedKt: 120, turnRate: rate}, 250)
		return p
	}
	if walk(0).caution || walk(0.9).caution {
		t.Error("a caution flying straight, or at 0.9°/s, past the wall")
	}
	if !walk(3).caution || walk(-3).caution {
		t.Error("turning right at 3°/s does not reach the wall, or turning left does")
	}
	if walk(20) != walk(6) {
		t.Errorf("20°/s gives %+v, 6°/s %+v: want the same, limited to 6°/s", walk(20), walk(6))
	}
	r := newTerrainRig(t, flat, "[]")
	r.fly(43, 12, 3000, 120, 359, 0)
	r.fly(43, 12, 3000, 120, 2, 0)
	if rate := terrain.turnRate(); math.Abs(rate-3) > 1e-4 {
		t.Errorf("track 359° then 2° a second later: %v°/s, want 3", rate)
	}
}

// TER-040, TER-050: the rate is the baro's while the internal sensor gives it, otherwise
// the slope of the GPS altitude over the last 6 fixes. The ADS-B estimate and $PGRMZ set
// no rate, so they are not used. Without either the function is unavailable: NO_RATE.
func TestTerrainVerticalRateSource(t *testing.T) {
	r := newTerrainRig(t, flat, "[]")
	r.fly(43, 12, 3000, 120, 0, -700)
	if in, _ := terrain.readSituation(); in.verticalFpm != -700 || !in.hasVertical {
		t.Errorf("internal baro: rate %v %v, want -700", in.verticalFpm, in.hasVertical)
	}
	r = newTerrainRig(t, flat, "[]")
	for i := 0; i < TERRAIN_SLOPE_SAMPLES; i++ {
		r.fix(43, 12, 3000-float64(i)*1000.0/60, 120, 0, 0)
		mySituation.BaroSourceType = BARO_TYPE_ADSBESTIMATE // a stale BaroVerticalSpeed of 0
		terrain.evaluate(r.now)
		if i < TERRAIN_SLOPE_SAMPLES-1 {
			r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_NO_RATE)
		}
	}
	r.wantState(TERRAIN_STATE_CLEAR, "")
	if in, _ := terrain.readSituation(); math.Abs(in.verticalFpm+1000) > 1e-3 {
		t.Errorf("ADS-B estimated baro: rate %v, want the GPS slope, -1000 ft/min", in.verticalFpm)
	}
}

// TER-060, TER-070, TER-350: the reasons the function is unavailable.
func TestTerrainUnavailableReasons(t *testing.T) {
	r := newTerrainRig(t, flat, "[]")
	r.fly(43, 12, 3000, 120, 0, 0)
	r.wantState(TERRAIN_STATE_CLEAR, "")
	mySituation.GPSLastFixLocalTime = r.now.Add(-3 * time.Second)
	terrain.evaluate(r.now)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_NO_FIX)
	r.fix(43, 12, 3000, 120, 0, 0)
	mySituation.GPSVerticalAccuracy = 30
	terrain.evaluate(r.now)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_POOR_FIX)
	r.fix(43, 12, 3000, 120, 0, 0)
	mySituation.GPSHorizontalAccuracy = 30
	terrain.evaluate(r.now)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_POOR_FIX)
	// Near the north edge of the grid, the 60 s path leaves it: never clear
	r.fly(43.98, 12, 3000, 120, 0, 0)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_OFF_GRID)
	// No grid file
	r = newTerrainRig(t, flat, "[]")
	writeTerrainFile(t, "settings/synthview.json", `{"elevationUrl": "/settings/none.json"}`)
	r.fly(43, 12, 3000, 120, 0, 0)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_GRID_BAD)
}

// Terrain_AglFt: the GPS altitude above the cell under the aircraft, on every usable fix
// over the grid, whether the prediction runs or not: on the ground, below the cell, with no
// rate, with the path off the grid. With no usable fix, off the grid, with no grid or with
// the function off it is not valid and reads 0.
func TestTerrainHeightAboveTheGroundUnderTheAircraft(t *testing.T) {
	want := func(ft int, valid bool, what string) {
		t.Helper()
		if globalStatus.Terrain_AglFt != ft || globalStatus.Terrain_AglValid != valid {
			t.Errorf("%s: %d ft valid %v, want %d ft valid %v", what, globalStatus.Terrain_AglFt, globalStatus.Terrain_AglValid, ft, valid)
		}
	}
	// A 300 m band, 984.25 ft
	r := newTerrainRig(t, band(42.99, 43.05, 300), "[]")
	r.fly(43, 12, 1000, 10, 0, 0)
	want(16, true, "taxiing at 1000 ft")
	r.fly(43, 12, 950, 10, 0, 0)
	want(-34, true, "parked with the GPS 950 ft, under the cell")
	r.fly(43, 12, 3000, 120, 0, 0)
	want(2016, true, "flying at 3000 ft")
	r.fly(43.1, 12, 3000, 120, 0, 0)
	want(3000, true, "flying at 3000 ft past the band")
	r.fix(43, 12, 3000, 120, 0, 0)
	mySituation.BaroSourceType = BARO_TYPE_ADSBESTIMATE
	terrain.evaluate(r.now)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_NO_RATE)
	want(2016, true, "no rate")
	mySituation.GPSLastFixLocalTime = r.now.Add(-3 * time.Second)
	terrain.evaluate(r.now)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_NO_FIX)
	want(0, false, "no fix")
	r.fix(43, 12, 3000, 120, 0, 0)
	mySituation.GPSVerticalAccuracy = 30
	terrain.evaluate(r.now)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_POOR_FIX)
	want(0, false, "poor fix")
	globalSettings.Terrain_Enabled = false
	r.fly(43, 12, 3000, 120, 0, 0)
	want(0, false, "function off")

	// The path leaves the grid, the aircraft is still on it
	r = newTerrainRig(t, flat, "[]")
	r.fly(43.98, 12, 3000, 120, 0, 0)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_OFF_GRID)
	want(3000, true, "path off the grid")
	r = newTerrainRig(t, flat, "[]")
	r.fly(44.5, 12, 3000, 120, 0, 0)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_OFF_GRID)
	want(0, false, "off the grid")
	r = newTerrainRig(t, flat, "[]")
	writeTerrainFile(t, "settings/synthview.json", `{"elevationUrl": "/settings/none.json"}`)
	r.fly(43, 12, 3000, 120, 0, 0)
	r.wantState(TERRAIN_STATE_UNAVAILABLE, TERRAIN_GRID_BAD)
	want(0, false, "no grid")
}

// The unavailable alert is announced once in a flight, and not on the ground.
func TestTerrainUnavailableIsAnnouncedOnceInAFlight(t *testing.T) {
	r := newTerrainRig(t, flat, `[{"Lat": 43, "Lon": 12, "Ele": 0}]`)
	unavailable := func() int {
		n := 0
		for _, a := range terrainAlerts() {
			if a.Type == EVENT_TYPE_TERRAIN_UNAVAILABLE {
				n++
			}
		}
		return n
	}
	poor := func(speedKt float64) {
		r.fix(43.1, 12, 3000, speedKt, 0, 0)
		mySituation.GPSVerticalAccuracy = 40
		terrain.evaluate(r.now)
	}
	r.fly(43, 12, 0, 10, 0, 0)
	poor(10)
	if n := unavailable(); n != 0 {
		t.Fatalf("%d unavailable alerts on the ground, want none", n)
	}
	r.fly(43.1, 12, 3000, 120, 0, 0)
	poor(120)
	r.fly(43.1, 12, 3000, 120, 0, 0)
	r.now = r.now.Add(time.Minute)
	poor(120)
	if n := unavailable(); n != 1 {
		t.Fatalf("%d unavailable alerts for two episodes in one flight, want 1", n)
	}
	// Slow away from a field, the top of a vertical figure, is still the same flight
	r.fly(43.1, 12, 3000, 20, 0, 0)
	r.fly(43.1, 12, 3000, 120, 0, 0)
	r.now = r.now.Add(time.Minute)
	poor(120)
	if n := unavailable(); n != 1 {
		t.Fatalf("%d unavailable alerts after a slow moment in flight, want 1", n)
	}
	// Landed at the field: the next flight announces it again
	r.fly(43, 12, 0, 10, 0, 0)
	r.fly(43.1, 12, 3000, 120, 0, 0)
	r.now = r.now.Add(time.Minute)
	poor(120)
	if n := unavailable(); n != 2 {
		t.Fatalf("%d unavailable alerts after a landing and a new flight, want 2", n)
	}
}

// The window is globalTerrainCut()'s: ±0.896° of whole cells around the aircraft, on the
// grid's own cell edges, smaller at the grid's edge and empty off it. Only the window is
// kept, and the planimetry may stand before or after the rows.
func TestTerrainWindowIsCutLikeTheBrowser(t *testing.T) {
	code := func(lat, lon float64) int16 {
		return int16(math.Floor((lat-42)/0.01)*160 + math.Mod(math.Floor((lon-11)/0.01), 160))
	}
	for _, first := range []bool{false, true} {
		newTerrainRig(t, code, "[]")
		writeTerrainGrid(t, code, first)
		w, err := terrainReadWindow(43, 12)
		if err != nil {
			t.Fatal(err)
		}
		// floor((43 - 0.896 - 42) / 0.01) = 10, floor((43 + 0.896 - 42) / 0.01) = 189
		if w.rows != 179 || w.cols != 179 || math.Abs(w.startLat-42.1) > 1e-9 || math.Abs(w.startLon-11.1) > 1e-9 {
			t.Fatalf("planimetry first %v: window %d × %d from %v N %v E, want 179 × 179 from 42.1 N 11.1 E",
				first, w.rows, w.cols, w.startLat, w.startLon)
		}
		if len(w.elevations) != 179*179 {
			t.Errorf("%d elevations kept, want the window's %d", len(w.elevations), 179*179)
		}
		for _, p := range [][2]float64{{42.105, 11.105}, {43.004, 12.009}, {43.885, 12.505}} {
			if got, ok := w.elevation(p[0], p[1]); !ok || got != code(p[0], p[1]) {
				t.Errorf("elevation at %v: %d %v, want cell %d", p, got, ok, code(p[0], p[1]))
			}
		}
	}
	w, err := terrainReadWindow(42.05, 11.05)
	if err != nil || w.rows != 94 || w.cols != 94 || w.startLat != 42 {
		t.Errorf("at the grid's corner: %+v %v, want 94 × 94 from 42 N", w, err)
	}
	if w, err := terrainReadWindow(50, 20); err != nil || w.rows != 0 || w.cols != 0 {
		t.Errorf("off the grid: %+v %v, want an empty window", w, err)
	}
}

// The window stays while the aircraft is within half of it; past that a new one is cut
// around the aircraft. A failed read keeps the old window and is not tried again for 30 s.
func TestTerrainWindowIsCutAgainPastHalfWay(t *testing.T) {
	r := newTerrainRig(t, flat, "[]")
	first := terrain.windowAround(43, 12, r.now)
	if first == nil || terrain.windowAround(43.44, 12.44, r.now) != first {
		t.Fatal("a new window within half of the first")
	}
	second := terrain.windowAround(43.46, 12, r.now)
	if second == first || second == nil || second.lat != 43.46 {
		t.Fatalf("past half way: %+v, want a new window cut around 43.46 N", second)
	}
	if err := os.Remove(filepath.Join(STRATUX_WWW_DIR, "settings", "terrain.json")); err != nil {
		t.Fatal(err)
	}
	if w := terrain.windowAround(43, 12, r.now); w != second {
		t.Fatal("a failed read did not keep the window in memory")
	}
	writeTerrainGrid(t, flat, false)
	if w := terrain.windowAround(43, 12, r.now.Add(29*time.Second)); w != second {
		t.Error("read again within 30 s of a failure")
	}
	if w := terrain.windowAround(43, 12, r.now.Add(30*time.Second)); w == second || w.lat != 43 {
		t.Error("not read again 30 s after a failure")
	}
}

// The Europe grid declares end.lat = 47 with 1001 rows: its rows are read 0.01° apart, as
// its columns are, and not at the browser's 10/1001°. Other grids keep the browser's step.
func TestTerrainEuropeGridRowsAreReadAtItsStep(t *testing.T) {
	var p terrainPlanimetry
	p.Start.Lat, p.Start.Lon, p.End.Lat, p.End.Lon = 37, 4, 47, 19
	w, _, _, err := terrainCut(p, 1001, 1500, 43, 12)
	if err != nil || math.Abs(w.stepLat-0.01) > 1e-12 || math.Abs(w.stepLon-0.01) > 1e-12 {
		t.Errorf("Europe grid: step %v × %v %v, want 0.01°", w.stepLat, w.stepLon, err)
	}
	p.End.Lat = 47.01
	if w, _, _, _ := terrainCut(p, 1001, 1500, 43, 12); math.Abs(w.stepLat-0.01) > 1e-12 {
		t.Errorf("Europe grid with end.lat 47.01: step %v, want 0.01°", w.stepLat)
	}
	p.Start.Lat, p.Start.Lon, p.End.Lat, p.End.Lon = 35, -168, 71, 35
	if w, _, _, _ := terrainCut(p, 148, 816, 43, 12); w.stepLat != 36.0/148 || w.stepLon != 203.0/816 {
		t.Errorf("worldwide sample: step %v × %v, want the browser's 36/148 × 203/816", w.stepLat, w.stepLon)
	}
}
