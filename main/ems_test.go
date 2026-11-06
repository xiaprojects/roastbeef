/*
	ems_test.go: unit tests for the engine rules evaluated on every EMS update
	(main/ems.go): the rule algorithms, the color bands, the alert raised when a rule
	changes color, how that alert follows the condition, and the alert raised when
	the EMS frames stop.
*/

package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func testRule(algorithm string, probes ...string) EMSRule {
	return EMSRule{Name: "T", Algorithm: algorithm, ProbeNames: probes, Colors: []EMSRuleColor{
		{"green", 500, 699}, {"yellow", 700, 749}, {"red", 749, 9999},
	}}
}

func TestRuleAlgorithms(t *testing.T) {
	data := map[string]float32{"a": 600, "b": 700, "c": 800}
	for algorithm, want := range map[string]float32{"average": 700, "max": 800, "min": 600, "averageDiff": 100} {
		if got, ok := ruleValue(testRule(algorithm, "a", "b", "c"), data); !ok || got != want {
			t.Errorf("%s = %v (%v), want %v", algorithm, got, ok, want)
		}
	}
	if got, ok := ruleValue(testRule("average", "a", "x"), data); !ok || got != 600 {
		t.Errorf("a missing probe must be skipped, got %v (%v)", got, ok)
	}
	if _, ok := ruleValue(testRule("average", "x"), data); ok {
		t.Error("a rule with no received probe must be skipped")
	}
}

func TestRuleColorBands(t *testing.T) {
	rule := testRule("max", "a")
	for value, want := range map[float32]string{499: "", 500: "green", 710: "yellow", 749: "red", 800: "red", 20000: ""} {
		if got := ruleColor(rule, value); got != want {
			t.Errorf("value %v is %q, want %q", value, got, want)
		}
	}
}

func TestARuleColorChangeRaisesAnAlertOnce(t *testing.T) {
	withAlerts(t)
	saved := ems
	t.Cleanup(func() { ems = saved })
	ems = EMSStratuxPlugin{
		emsDataMutex:   &sync.Mutex{},
		emsData:        map[string]float32{"a": 600},
		ruleColors:     map[string]string{},
		ruleAlertTimes: map[string]time.Time{},
		ruleAlertIds:   map[string]int{},
		rules:          []EMSRule{testRule("max", "a")},
	}
	step := func(value float32, wantAlerts int, wantType int) {
		t.Helper()
		ems.emsData["a"] = value
		ems.validateRules()
		got := queued()
		if len(got) != wantAlerts {
			t.Fatalf("value %v: %d alerts, want %d", value, len(got), wantAlerts)
		}
		if wantType >= 0 && got[len(got)-1].Type != wantType {
			t.Errorf("value %v: alert type %d, want %d", value, got[len(got)-1].Type, wantType)
		}
	}
	step(600, 0, -1)
	step(720, 1, EVENT_TYPE_EMS_RULE_YELLOW)
	step(730, 1, -1)
	step(800, 2, EVENT_TYPE_EMS_RULE_RED)
	step(600, 2, -1)
	// Yellow again within 5 minutes is not announced again
	step(720, 2, -1)
	step(600, 2, -1)
	ems.ruleAlertTimes["ems-T-yellow"] = time.Now().Add(-EMS_RULE_ALERT_INTERVAL)
	step(720, 3, EVENT_TYPE_EMS_RULE_YELLOW)
}

// withEMS gives the test the EMS function with rule T on probe a and rule U on probe b,
// both green, the alert function ready behind it, and puts the shared state back.
func withEMS(t *testing.T) {
	withAlerts(t)
	saved := ems
	t.Cleanup(func() { ems = saved })
	other := testRule("max", "b")
	other.Name = "U"
	ems = EMSStratuxPlugin{
		emsDataMutex:   &sync.Mutex{},
		emsData:        map[string]float32{"a": 600, "b": 600},
		emsDataMin:     map[string]float32{},
		emsDataMax:     map[string]float32{},
		ruleColors:     map[string]string{},
		ruleAlertTimes: map[string]time.Time{},
		ruleAlertIds:   map[string]int{},
		rules:          []EMSRule{testRule("max", "a"), other},
	}
	emsFrame()
}

// emsFrame is one EMS frame carrying the given value of probe a, or no change.
func emsFrame(value ...float32) {
	if len(value) > 0 {
		ems.emsData["a"] = value[0]
	}
	ems.validateRules()
}

// A rule still in the same color moves the end of its alert, under the same identifier
// and with no new alert: nothing on the list and nothing on the socket, so no sound. An
// alert of another rule stays as it is.
// Covers: RB-HLR-ALR-280, RB-HLR-ALR-290
func TestARuleStayingInItsColorMovesTheEndOfItsAlert(t *testing.T) {
	withEMS(t)
	ems.emsData["b"] = 720
	emsFrame(720)
	ems.emsData["b"] = 600
	emsFrame()
	first := queued()
	if len(first) != 2 {
		t.Fatalf("%d alerts, want one per rule", len(first))
	}
	sent(t)

	time.Sleep(20 * time.Millisecond)
	emsFrame(730)

	got := queued()
	if len(got) != 2 {
		t.Fatalf("the rule staying yellow changed the list to %d alerts", len(got))
	}
	if got[0].Id != first[0].Id || !got[0].TimestampEnd.After(first[0].TimestampEnd) {
		t.Errorf("end did not move: was %+v, is %+v", first[0], got[0])
	}
	if !got[0].Active || got[0].ActiveSeconds < 0.015 {
		t.Errorf("active state: %+v", got[0])
	}
	if got[1] != first[1] {
		t.Errorf("the alert of the other rule changed: was %+v, is %+v", first[1], got[1])
	}
	if msgs := sent(t); len(msgs) != 0 {
		t.Errorf("the display was told again: %v", msgs)
	}
}

// Leaving the color closes the alert at once, and yellow to red leaves one active alert.
// Covers: RB-HLR-ALR-300
func TestLeavingAColorClosesItsAlert(t *testing.T) {
	withEMS(t)
	emsFrame(720)
	if got := queued(); len(got) != 1 || !got[0].Active {
		t.Fatalf("after yellow: %v", got)
	}
	emsFrame(800)
	got := queued()
	if len(got) != 2 || got[0].Active || !got[1].Active || got[1].Type != EVENT_TYPE_EMS_RULE_RED {
		t.Fatalf("after red, want yellow closed and red active: %+v", got)
	}
	emsFrame(600)
	for _, a := range queued() {
		if a.Active {
			t.Errorf("active after green: %+v", a)
		}
	}
}

// Back in the color within the interval is the same alert: same identifier, active
// again, nothing raised or sent, and the display decides if to replay the alarm. The
// span counts the gap and the time in the condition does not. After the interval it is
// a new alert.
// Covers: RB-HLR-ALR-280, RB-HLR-ALR-300
func TestAColorComingBackReopensItsAlert(t *testing.T) {
	withEMS(t)
	emsFrame(720)
	time.Sleep(5 * time.Millisecond)
	emsFrame(725)
	emsFrame(600)
	raised := queued()[0]
	sent(t)

	const gap = 60 * time.Millisecond
	time.Sleep(gap)
	emsFrame(720)
	time.Sleep(5 * time.Millisecond)
	emsFrame(725)

	got := queued()
	if len(got) != 1 {
		t.Fatalf("%d alerts, want the same one reopened", len(got))
	}
	a := got[0]
	if a.Id != raised.Id || !a.Active {
		t.Errorf("not reopened: was %+v, is %+v", raised, a)
	}
	span := a.TimestampEnd.Sub(a.Timestamp)
	if span < gap {
		t.Errorf("span %v does not count the gap of %v", span, gap)
	}
	if inCondition := time.Duration(a.ActiveSeconds * float64(time.Second)); inCondition >= span-gap/2 {
		t.Errorf("time in the condition %v counts the gap, span %v", inCondition, span)
	}
	if msgs := sent(t); len(msgs) != 0 {
		t.Errorf("the display was told again: %v", msgs)
	}

	emsFrame(600)
	ems.ruleAlertTimes["ems-T-yellow"] = time.Now().Add(-EMS_RULE_ALERT_INTERVAL)
	emsFrame(720)
	got = queued()
	if len(got) != 2 || got[1].Id == a.Id || got[0].Active || !got[1].Active {
		t.Errorf("after the interval, want the old alert closed and a new one active: %+v", got)
	}
}

// A value outside every band says nothing about the condition.
// Covers: RB-HLR-ALR-300
func TestAValueOutsideEveryBandNeitherConfirmsNorClears(t *testing.T) {
	withEMS(t)
	emsFrame(720)
	before := queued()[0]
	time.Sleep(5 * time.Millisecond)
	emsFrame(20000)
	if after := queued()[0]; after != before {
		t.Errorf("was %+v, is %+v", before, after)
	}
}

// postEMS is one POST /setEMS, through the real handler.
func postEMS(t *testing.T, body string) {
	t.Helper()
	w := httptest.NewRecorder()
	handleEMSSetRequest(w, httptest.NewRequest(http.MethodPost, "/setEMS", strings.NewReader(body)))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /setEMS %s: %d", body, w.Code)
	}
}

// A steady reading is still a reading: a frame that changes nothing confirms the rule.
// Covers: RB-HLR-ALR-290
func TestAFrameWithNoChangeStillMovesTheEnd(t *testing.T) {
	withEMS(t)
	postEMS(t, `{"a":720}`)
	before := queued()[0]
	time.Sleep(5 * time.Millisecond)
	postEMS(t, `{"a":720}`)
	got := queued()
	if len(got) != 1 || !got[0].TimestampEnd.After(before.TimestampEnd) {
		t.Errorf("was %+v, is %+v", before, got)
	}
}

// When the frames stop with a rule in alarm the alarm is not cleared: it stays active
// with its end at the last frame. One alert says the data is lost, and closes when the
// frames return.
// Covers: RB-HLR-ALR-300, RB-HLR-ALR-320
func TestEMSDataLostDuringAnAlarm(t *testing.T) {
	withEMS(t)
	emsFrame(720)
	alarm := queued()[0]
	sent(t)

	ems.lastFrame = time.Now().Add(-EMS_FEED_TIMEOUT)
	ems.checkFeed()
	time.Sleep(5 * time.Millisecond)
	ems.checkFeed()

	got := queued()
	if len(got) != 2 {
		t.Fatalf("%d alerts, want the alarm and one for the data lost", len(got))
	}
	if got[0] != alarm {
		t.Errorf("silence changed the alarm: was %+v, is %+v", alarm, got[0])
	}
	lost := got[1]
	if lost.Type != EVENT_TYPE_EMS_GENERIC_FAILURE || lost.Title != "EMS data lost" || !lost.Active {
		t.Errorf("the data lost alert: %+v", lost)
	}
	if !lost.TimestampEnd.After(lost.Timestamp) {
		t.Errorf("the data lost alert does not follow the silence: %+v", lost)
	}
	if msgs := sent(t); len(msgs) != 1 {
		t.Errorf("sent %d frames, want the data lost once", len(msgs))
	}

	emsFrame(720)
	ems.checkFeed()
	got = queued()
	if got[1].Active {
		t.Errorf("the data lost alert stayed active with the frames back: %+v", got[1])
	}
	if !got[0].Active || !got[0].TimestampEnd.After(alarm.TimestampEnd) {
		t.Errorf("the alarm did not resume: %+v", got[0])
	}
}

// There is nothing to report when no EMS ever spoke, or when every rule is green.
// Covers: RB-HLR-ALR-320
func TestEMSDataLostIsQuietWithNoAlarm(t *testing.T) {
	withEMS(t)
	ems.lastFrame = time.Time{}
	ems.ruleColors["T"] = "yellow"
	ems.checkFeed()
	if got := queued(); len(got) != 0 {
		t.Errorf("before the first frame: %v", got)
	}

	ems.ruleColors["T"] = "green"
	ems.lastFrame = time.Now().Add(-EMS_FEED_TIMEOUT)
	ems.checkFeed()
	if got := queued(); len(got) != 0 {
		t.Errorf("with every rule green: %v", got)
	}
}
