/*
	ems_internal_test.go: the probes the daemon publishes from its own I2C sensors
	(ENS160 air quality, the icing loop; main/ems.go publishInternal,
	withdrawInternal) and the rules web/settings/rbvoice-aircraft-rules.json sets on
	them. The shipped rules file is loaded, so its thresholds are under test too.
*/

package main

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// withShippedRules is withEMS with the rules of web/settings/rbvoice-aircraft-rules.json
// added after the test rules T (probe a) and U (probe b), and the shipped alertsMapping.json
// loaded, which alertTypeFor looks EVENT_TYPE_<rule name>_<COLOR> up in.
func withShippedRules(t *testing.T) {
	withEMS(t)
	saved := EventLanguages
	t.Cleanup(func() { EventLanguages = saved })
	raw, err := os.ReadFile("../web/settings/" + ALERT_MAPPING_JSON_NAME)
	if err != nil {
		t.Fatal(err)
	}
	EventLanguages = nil
	if err := json.Unmarshal(raw, &EventLanguages); err != nil {
		t.Fatal(err)
	}
	test := ems.rules
	if !ems.loadRules("../web/settings/rbvoice-aircraft-rules.json") {
		t.Fatal("the shipped rules file does not load")
	}
	ems.rules = append(test, ems.rules...)
}

func findRule(t *testing.T, name string) EMSRule {
	t.Helper()
	for _, r := range ems.rules {
		if r.Name == name {
			return r
		}
	}
	t.Fatalf("rule %s is not in the rules file", name)
	return EMSRule{}
}

// The shipped bands: AQI 4 is yellow and 5 red, only CABINAIR raises alerts, and it
// raises the cabin air types rather than "engine parameter".
func TestShippedCabinRules(t *testing.T) {
	withShippedRules(t)
	air := findRule(t, "CABINAIR")
	for aqi, want := range map[float32]string{1: "green", 3: "green", 4: "yellow", 5: "red"} {
		if got := ruleColor(air, aqi); got != want {
			t.Errorf("CABINAIR at AQI %v is %q, want %q", aqi, got, want)
		}
	}
	if !air.raisesAlerts() || air.alertTypeFor("yellow") != EVENT_TYPE_CABINAIR_YELLOW || air.alertTypeFor("red") != EVENT_TYPE_CABINAIR_RED {
		t.Errorf("CABINAIR alert types: %+v", air)
	}
	for name, cases := range map[string]map[float32]string{
		"ECO2": {450: "green", 1200: "yellow", 1800: "red"},
		"TVOC": {100: "green", 1000: "yellow", 3000: "red"},
	} {
		r := findRule(t, name)
		if r.raisesAlerts() {
			t.Errorf("%s raises alerts: it is meant for rbvoice answers and the gauge only", name)
		}
		for v, want := range cases {
			if got := ruleColor(r, v); got != want {
				t.Errorf("%s at %v is %q, want %q", name, v, got, want)
			}
		}
	}
	if (EMSRule{}).alertTypeFor("red") != EVENT_TYPE_EMS_RULE_RED {
		t.Error("a rule with no name must keep the engine types")
	}
	if (EMSRule{Name: "CHT"}).alertTypeFor("yellow") != EVENT_TYPE_EMS_RULE_YELLOW {
		t.Error("a rule with no EVENT_TYPE_<name>_<COLOR> row must fall back to the engine type")
	}
}

// AQI 4 then 5 raises the cabin air yellow then red alert, typed as such through
// pushEventByIdent; eCO2 and TVOC in red raise nothing of their own.
func TestPublishedAirQualityRaisesCabinAirAlerts(t *testing.T) {
	withShippedRules(t)
	ems.publishInternal(map[string]float32{PROBE_AIRQUALITY_AQI: 2, PROBE_AIRQUALITY_ECO2: 600, PROBE_AIRQUALITY_TVOC: 100})
	if got := queued(); len(got) != 0 {
		t.Fatalf("green air raised %+v", got)
	}
	ems.publishInternal(map[string]float32{PROBE_AIRQUALITY_AQI: 4, PROBE_AIRQUALITY_ECO2: 1800, PROBE_AIRQUALITY_TVOC: 3000})
	got := queued()
	if len(got) != 1 || got[0].Type != EVENT_TYPE_CABINAIR_YELLOW || !got[0].Active {
		t.Fatalf("AQI 4: want one active cabin air yellow alert, got %+v", got)
	}
	ems.publishInternal(map[string]float32{PROBE_AIRQUALITY_AQI: 5})
	got = queued()
	if len(got) != 2 || got[0].Active || got[1].Type != EVENT_TYPE_CABINAIR_RED || !got[1].Active {
		t.Errorf("AQI 5: want the yellow closed and a red one active, got %+v", got)
	}
	if v := ems.emsData[PROBE_AIRQUALITY_ECO2]; v != 1800 || !ems.emsReceived[PROBE_AIRQUALITY_ECO2] {
		t.Errorf("eCO2 probe not in the EMS data for /getEMS: %v %v", v, ems.emsReceived[PROBE_AIRQUALITY_ECO2])
	}
}

// The daemon's own probes are not EMS frames: they do not stamp lastFrame and do not
// move the end of an engine alarm left by a sender that went silent.
func TestPublishingDoesNotTouchTheEngineFeed(t *testing.T) {
	withShippedRules(t)
	emsFrame(720) // engine rule T yellow
	engine := queued()
	if len(engine) != 1 {
		t.Fatalf("engine rule T: %+v", engine)
	}
	frame := ems.lastFrame
	time.Sleep(20 * time.Millisecond)
	ems.publishInternal(map[string]float32{PROBE_DEW_POINT: 12})
	if !ems.lastFrame.Equal(frame) {
		t.Error("publishing a probe of the daemon stamped lastFrame")
	}
	if got := queued(); len(got) != 1 || !got[0].TimestampEnd.Equal(engine[0].TimestampEnd) {
		t.Errorf("publishing moved the engine alert: was %+v, is %+v", engine[0], got)
	}
}

// Withdrawing the probes (sensor gone, warming up) removes them from /getEMS and closes
// the alert of the rule that has nothing left to read; the engine rules are untouched.
func TestWithdrawClosesTheAlertAndRemovesTheProbes(t *testing.T) {
	withShippedRules(t)
	emsFrame(720)
	ems.publishInternal(map[string]float32{PROBE_AIRQUALITY_AQI: 4, PROBE_AIRQUALITY_ECO2: 900, PROBE_AIRQUALITY_TVOC: 300})
	if got := queued(); len(got) != 2 {
		t.Fatalf("want the engine and the cabin alerts: %+v", got)
	}
	ems.withdrawInternal(PROBE_AIRQUALITY_AQI, PROBE_AIRQUALITY_ECO2, PROBE_AIRQUALITY_TVOC)
	got := queued()
	if !got[0].Active || got[1].Active {
		t.Errorf("want the engine alert active and the cabin one closed: %+v", got)
	}
	for _, k := range []string{PROBE_AIRQUALITY_AQI, PROBE_AIRQUALITY_ECO2, PROBE_AIRQUALITY_TVOC} {
		if _, ok := ems.emsData[k]; ok || ems.emsReceived[k] {
			t.Errorf("probe %s still published after the withdraw", k)
		}
	}
	if c := ems.ruleColors["CABINAIR"]; c != "" {
		t.Errorf("CABINAIR keeps color %q with nothing to read", c)
	}
	// Back with clean air: no alert. Back in yellow later: a new alert (the 5 minute
	// guard aside), so the colour memory really was cleared.
	ems.publishInternal(map[string]float32{PROBE_AIRQUALITY_AQI: 2})
	if n := len(queued()); n != 2 {
		t.Errorf("clean air after the withdraw changed the list to %d alerts", n)
	}
}

// A repeated identical reading is not logged again but still confirms the rule.
func TestPublishingTheSameValueKeepsTheAlertGoing(t *testing.T) {
	withShippedRules(t)
	ems.publishInternal(map[string]float32{PROBE_AIRQUALITY_AQI: 4})
	first := queued()
	time.Sleep(20 * time.Millisecond)
	ems.publishInternal(map[string]float32{PROBE_AIRQUALITY_AQI: 4})
	got := queued()
	if len(got) != 1 || !got[0].TimestampEnd.After(first[0].TimestampEnd) {
		t.Errorf("the same AQI did not move the end of its alert: was %+v, is %+v", first, got)
	}
}

// Before EMS starts (no mutex) the sensors may already publish: nothing happens.
func TestPublishBeforeEMSStarts(t *testing.T) {
	saved := ems
	t.Cleanup(func() { ems = saved })
	ems = EMSStratuxPlugin{}
	ems.publishInternal(map[string]float32{PROBE_DEW_POINT: 12})
	ems.withdrawInternal(PROBE_DEW_POINT)
}
