/*
	alerts_test.go: requirements-style unit tests for the alert function
	(main/alerts.go): raising an alert, classifying a system failure by the
	identifier that raised it, the presentation mapping that the display and the
	aural annunciation are both driven from, and what the function does when it is
	asked to raise an alert before it is ready.

	The alert function has no loop of its own - it is called from whichever
	goroutine noticed the failure - so these tests call it the way the daemon does.
	The one part that needs the daemon's plumbing is the dispatch to the display:
	the tests give it a uibroadcaster with no writer goroutine, so the JSON that
	would have gone to the browser stays in the channel and sent() can read it back.

	The mapping tests read web/settings/alertsMapping.json and the asset directories
	in the tree rather than a fixture, because that file is the requirement's data:
	an event type added without its row, text, sound or icon is what they exist to
	catch. They read the EVENT_TYPE_ constants out of alerts.go for the same reason.
*/

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"testing"
	"time"
)

// withAlerts gives the test the globals the alert function needs - an initialised
// queue, somewhere for the display dispatch to go, and no audio - and puts back
// whatever the rest of the package left in them.
func withAlerts(t *testing.T) {
	savedAlerts, savedUpdate, savedLangs := alerts, alertUpdate, EventLanguages
	savedAudio, savedWWW := globalSettings.Audio_Enabled, STRATUX_WWW_DIR
	t.Cleanup(func() {
		alerts, alertUpdate, EventLanguages = savedAlerts, savedUpdate, savedLangs
		globalSettings.Audio_Enabled, STRATUX_WWW_DIR = savedAudio, savedWWW
	})
	alerts = AlertsStratuxPlugin{
		alertsDataMutex: &sync.Mutex{},
		alertsData:      make([]interface{}, 0),
	}
	// A broadcaster with no writer goroutine: nothing drains the channel, so what
	// the daemon sent to the display is still there to be read.
	alertUpdate = &uibroadcaster{sockets_mu: &sync.Mutex{}, messages: make(chan []byte, 8)}
	globalSettings.Audio_Enabled = false
}

// queued is the alerts the function has queued, in the order it queued them.
func queued() (out []Alert) {
	alerts.alertsDataMutex.Lock()
	defer alerts.alertsDataMutex.Unlock()
	for _, a := range alerts.alertsData {
		out = append(out, a.(Alert))
	}
	return
}

// sent is the alerts the function dispatched to the display, decoded from the JSON
// it handed the websocket broadcaster.
func sent(t *testing.T) (out []Alert) {
	for {
		select {
		case msg := <-alertUpdate.messages:
			var a Alert
			if err := json.Unmarshal(msg, &a); err != nil {
				t.Fatalf("the display was sent %q, which is not an Alert: %v", msg, err)
			}
			out = append(out, a)
		default:
			return
		}
	}
}

// definedEventTypes is the EVENT_TYPE_ constants read out of alerts.go, by number.
// Reading the source rather than listing them here means a new event type cannot be
// added without the mapping tests below seeing it, and it is also the collision check
// the comment above the constants asks for.
func definedEventTypes(t *testing.T) map[int]string {
	src, err := os.ReadFile("alerts.go")
	if err != nil {
		t.Fatalf("read alerts.go: %v", err)
	}
	out := map[int]string{}
	for _, m := range regexp.MustCompile(`(EVENT_TYPE_\w+)\s*=\s*(\d+)`).FindAllStringSubmatch(string(src), -1) {
		n, err := strconv.Atoi(m[2])
		if err != nil {
			t.Fatalf("%s = %q: %v", m[1], m[2], err)
		}
		if old, dup := out[n]; dup {
			t.Errorf("%s and %s are both event type %d; the identifiers must be unique", old, m[1], n)
		}
		out[n] = m[1]
	}
	if len(out) == 0 {
		t.Fatal("no EVENT_TYPE_ constants found in alerts.go")
	}
	return out
}

// mapping is the presentation mapping as it ships, by language.
func mapping(t *testing.T) map[string][]EventHolder {
	path := filepath.Join("..", "web", "settings", ALERT_MAPPING_JSON_NAME)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var out map[string][]EventHolder
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	if _, ok := out[ALERT_DEFAULT_LANGUAGE]; !ok {
		t.Fatalf("%s has no %q, which is the only language the daemon reads",
			path, ALERT_DEFAULT_LANGUAGE)
	}
	return out
}

// An alert is queued in the order it was raised and dispatched to the display as it
// is raised, with the type, title and time the caller gave it.
// Covers: RB-HLR-ALR-010, RB-HLR-ALR-020
func TestARaisedAlertIsQueuedAndSentToTheDisplay(t *testing.T) {
	withAlerts(t)
	first := Alert{EVENT_TYPE_TIMER, "Timer 2 fired", time.Now().Add(-time.Minute)}
	second := Alert{EVENT_TYPE_RADIO_COMMAND_NOT_OK, "Radio Freq. Set Active fail", time.Now()}

	for _, a := range []Alert{first, second} {
		if !alerts.pushEvent(a) {
			t.Fatalf("pushEvent(%v) = false, want the alert to be accepted", a)
		}
	}

	for what, got := range map[string][]Alert{"queued": queued(), "sent to the display": sent(t)} {
		if len(got) != 2 {
			t.Fatalf("%s %d alerts, want 2: %v", what, len(got), got)
		}
		for i, want := range []Alert{first, second} {
			if got[i].Type != want.Type || got[i].Title != want.Title || !got[i].Timestamp.Equal(want.Timestamp) {
				t.Errorf("%s[%d] = %v, want %v", what, i, got[i], want)
			}
		}
	}
}

// An alert raised before the alert function has been initialised is discarded and
// reported as not raised, rather than queued somewhere nothing will read.
// Covers: RB-HLR-ALR-030
func TestAnAlertRaisedBeforeTheAlertFunctionIsReadyIsDiscarded(t *testing.T) {
	withAlerts(t)
	alerts.alertsData = nil

	if alerts.pushEvent(Alert{EVENT_TYPE_SYSTEM_DANGER, "too early", time.Now()}) {
		t.Error("pushEvent = true before InitFunc, want false")
	}
	if alerts.alertsData != nil {
		t.Errorf("the queue was created by the push: %v", alerts.alertsData)
	}
	if got := sent(t); len(got) != 0 {
		t.Errorf("the display was sent %v, want nothing", got)
	}
}

// Starting the alert function loads the presentation mapping and raises the startup
// alert, so that the alert list records when the equipment came up.
// Covers: RB-HLR-ALR-040, RB-HLR-ALR-050
func TestStartingTheAlertFunctionLoadsTheMappingAndRaisesTheStartupAlert(t *testing.T) {
	withAlerts(t)
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "settings"), 0o755); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join("..", "web", "settings", ALERT_MAPPING_JSON_NAME))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "settings", ALERT_MAPPING_JSON_NAME), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	STRATUX_WWW_DIR = dir + "/"
	EventLanguages = nil

	if !alerts.InitFunc() {
		t.Fatal("InitFunc = false, want the alert function to start")
	}

	for typ, name := range definedEventTypes(t) {
		if typ >= len(EventLanguages[ALERT_DEFAULT_LANGUAGE]) {
			t.Errorf("%s loaded no presentation for %s (type %d)", ALERT_DEFAULT_LANGUAGE, name, typ)
		}
	}
	got := queued()
	if len(got) != 1 || got[0].Type != EVENT_TYPE_STARTUP_INFO {
		t.Errorf("queued %v, want one EVENT_TYPE_STARTUP_INFO alert", got)
	}
}

// The alert function starts, and goes on raising alerts, when the presentation
// mapping is missing: the mapping is how an alert is presented, not whether it is
// raised, and the display carries its own copy.
// Covers: RB-HLR-ALR-060
func TestTheAlertFunctionStartsWithNoPresentationMapping(t *testing.T) {
	withAlerts(t)
	STRATUX_WWW_DIR = t.TempDir() + "/"
	EventLanguages = nil
	// Audio on, with nothing to look the sound up in: the lookup must not take the
	// function down, which is the whole point of this test.
	globalSettings.Audio_Enabled = true

	if !alerts.InitFunc() {
		t.Fatal("InitFunc = false with no mapping file, want the alert function to start")
	}
	if !alerts.pushEvent(Alert{EVENT_TYPE_SYSTEM_DANGER_BAROMETER, "BaroBroken", time.Now()}) {
		t.Fatal("pushEvent = false with no mapping file, want the alert to be raised")
	}
	if got := queued(); len(got) != 2 {
		t.Errorf("queued %v, want the startup alert and the barometer alert", got)
	}
}

// A system failure is classified by the identifier that raised it, so that the
// display and the aural annunciation can tell the pilot which part failed. An
// identifier with no classification of its own is raised as a general system
// failure; RB-HLR-ALR-150 is the open finding that two core functions use it.
// Covers: RB-HLR-ALR-100, RB-HLR-ALR-110, RB-HLR-ALR-120, RB-HLR-ALR-130
func TestASystemFailureIsClassifiedByTheIdentifierThatRaisedIt(t *testing.T) {
	for _, c := range []struct {
		ident string
		want  int
	}{
		{"save-settings", EVENT_TYPE_SYSTEM_DANGER_SETTINGS},
		{"disk-space", EVENT_TYPE_SYSTEM_DANGER_SETTINGS},
		{"partition-rebuild", EVENT_TYPE_SYSTEM_DANGER_SETTINGS},
		{"fs-write", EVENT_TYPE_SYSTEM_DANGER_SETTINGS},
		{"pressure-sensor-temp-read", EVENT_TYPE_SYSTEM_DANGER_BAROMETER},
		{"pressure-sensor-pressure-read", EVENT_TYPE_SYSTEM_DANGER_BAROMETER},
		{"BaroBroken", EVENT_TYPE_SYSTEM_DANGER_BAROMETER},
		{"sdrconfig", EVENT_TYPE_SYSTEM_DANGER_SDR},
		{"ping-missing", EVENT_TYPE_SYSTEM_DANGER_SDR},
		// The rest of the identifiers the daemon raises, all unclassified.
		{"ahrs-web-start", EVENT_TYPE_SYSTEM_DANGER},
		{"airspeed-sensor-read", EVENT_TYPE_SYSTEM_DANGER},
		{"BLE", EVENT_TYPE_SYSTEM_DANGER},
		{"hobbsmeter", EVENT_TYPE_SYSTEM_DANGER},
		{"restart-warn", EVENT_TYPE_SYSTEM_DANGER},
		{"settings-file", EVENT_TYPE_SYSTEM_DANGER},
		{"", EVENT_TYPE_SYSTEM_DANGER},
	} {
		name := c.ident
		if name == "" {
			name = "no identifier"
		}
		t.Run(name, func(t *testing.T) {
			withAlerts(t)
			// The caller's own type is always replaced by the classification: every
			// caller in the daemon passes EVENT_TYPE_UNKOWN_WARNING.
			raised := Alert{EVENT_TYPE_UNKOWN_WARNING, "sensor " + name + " failed", time.Now()}
			if !alerts.pushEventByIdent(c.ident, raised) {
				t.Fatal("pushEventByIdent = false, want the alert to be raised")
			}
			got := queued()
			if len(got) != 1 {
				t.Fatalf("queued %v, want one alert", got)
			}
			if got[0].Type != c.want {
				t.Errorf("%q raised type %d, want %d", c.ident, got[0].Type, c.want)
			}
			if got[0].Title != raised.Title {
				t.Errorf("title %q, want the caller's %q", got[0].Title, raised.Title)
			}
		})
	}
}

// A system failure is annunciated once while it is present, and again if it comes
// back after being cleared - not on every poll of the sensor that noticed it.
// Covers: RB-HLR-ALR-140
func TestASystemFailureIsAnnouncedOnceUntilItIsCleared(t *testing.T) {
	withAlerts(t)
	savedErrs, savedMutex, savedStatus := systemErrs, systemErrsMutex, globalStatus.Errors
	t.Cleanup(func() {
		systemErrs, systemErrsMutex, globalStatus.Errors = savedErrs, savedMutex, savedStatus
	})
	systemErrs, systemErrsMutex, globalStatus.Errors = make(map[string]string), &sync.Mutex{}, nil

	for i := 0; i < 3; i++ {
		addSingleSystemErrorf("sdrconfig", "SDR %d is gone", 1)
	}
	if got := queued(); len(got) != 1 {
		t.Fatalf("queued %v for one failure, want one alert", got)
	}

	removeSingleSystemError("sdrconfig")
	addSingleSystemErrorf("sdrconfig", "SDR %d is gone", 1)

	got := queued()
	if len(got) != 2 {
		t.Fatalf("queued %v after the failure came back, want a second alert", got)
	}
	if got[1].Type != EVENT_TYPE_SYSTEM_DANGER_SDR {
		t.Errorf("the second alert is type %d, want EVENT_TYPE_SYSTEM_DANGER_SDR", got[1].Type)
	}
}

// Every event type the daemon can raise has a row in the presentation mapping at the
// index of its number, in every language the file offers, naming the type so that a
// row cannot silently slide out of step with the enumeration.
// Covers: RB-HLR-ALR-070
func TestEveryEventTypeHasARowInEveryLanguage(t *testing.T) {
	types := definedEventTypes(t)
	langs := mapping(t)
	for lang, rows := range langs {
		for _, typ := range sorted(types) {
			name := types[typ]
			if typ >= len(rows) {
				t.Errorf("%s has %d rows, so nothing presents %s (type %d)", lang, len(rows), name, typ)
				continue
			}
			if rows[typ].Id != name {
				t.Errorf("%s row %d is %q, want %q: the rows are indexed by event type",
					lang, typ, rows[typ].Id, name)
			}
			if rows[typ].Text == "" {
				t.Errorf("%s row %d (%s) has no text for the pilot to read", lang, typ, name)
			}
		}
	}
}

// Every sound and icon the mapping names exists, in both the format the daemon plays
// through the aircraft's audio and the format the display plays through the browser.
// A missing file is a silent or unlabelled alert, which is the failure FHA-ALR-1
// describes.
// Covers: RB-HLR-ALR-080, RB-HLR-ALR-090
func TestEverySoundAndIconTheMappingNamesExists(t *testing.T) {
	assets := map[string][]string{} // asset -> the files it must have
	for lang, rows := range mapping(t) {
		for i, row := range rows {
			where := fmt.Sprintf("%s row %d", lang, i)
			if row.Sound != "" {
				// The daemon plays .wav through aplay, the display .mp3 through the
				// browser; both are named by the one Sound field.
				assets[where+" sound "+row.Sound] = []string{
					filepath.Join("..", "web", "sounds", row.Sound+".wav"),
					filepath.Join("..", "web", "sounds", row.Sound+".mp3"),
				}
			}
			if row.Icon != "" {
				assets[where+" icon "+row.Icon] = []string{
					filepath.Join("..", "web", "img", row.Icon+".svg"),
				}
			}
		}
	}
	if len(assets) == 0 {
		t.Fatal("the mapping names no sounds or icons at all")
	}
	for what, files := range assets {
		for _, f := range files {
			if _, err := os.Stat(f); err != nil {
				t.Errorf("%s: %s is missing", what, filepath.ToSlash(f))
			}
		}
	}
}

// sorted is the keys of an int-keyed map in order, so a failure reads in event-type
// order rather than in Go's map order.
func sorted[V any](m map[int]V) []int {
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	return keys
}
