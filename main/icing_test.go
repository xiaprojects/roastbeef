/*
	icing_test.go: the icing advisories (main/icing.go): dew point and humidity against
	psychrometric tables, the carburettor icing chart zones, the airframe percentage,
	which probes are published for which inputs, publishing on change only, and the
	shipped ICINGCARB / ICINGAIRFRAME rules.
*/

package main

import (
	"math"
	"testing"
	"time"
)

func TestDewPointAgainstTables(t *testing.T) {
	for _, c := range []struct{ t, rh, dew float64 }{
		{20, 50, 9.3},
		{25, 60, 16.7},
		{10, 80, 6.7},
		{0, 100, 0},
		{30, 30, 10.5},
		{-5, 70, -9.5},
	} {
		if got := dewPointC(c.t, c.rh); math.Abs(got-c.dew) > 0.3 {
			t.Errorf("dew point at %v °C %v %%: %.2f, want %.1f", c.t, c.rh, got, c.dew)
		}
		if got := relativeHumidity(c.t, dewPointC(c.t, c.rh)); math.Abs(got-c.rh) > 0.01 {
			t.Errorf("RH round trip at %v °C %v %%: %.3f", c.t, c.rh, got)
		}
	}
	if relativeHumidity(5, 8) != 100 {
		t.Error("dew point above the temperature must read 100 %")
	}
}

// Points whose colour was sampled in docs/icing/licterature/image0.webp (axes: the
// T = 0 and dew point = 0 lines, the T = D apex at +30).
func TestCarbIcingChartZones(t *testing.T) {
	for _, c := range []struct {
		oat, dew float64
		want     float32
	}{
		{10, 8, 100},  // blue
		{15, 12, 100}, // blue
		{5, 3, 100},   // blue, cold end
		{20, 15, 75},  // green
		{25, 20, 75},  // green, warm
		{22, 10, 75},  // green below the blue
		{30, 15, 50},  // yellow
		{10, -2, 50},  // yellow below the green
		{35, 25, 25},  // orange, warm
		{5, -5, 25},   // orange, cold
		{30, 0, 0},    // dry
		{20, -10, 0},  // dry
		{40, 10, 0},   // off the chart
		{-20, -20, 0}, // off the chart, cold
	} {
		if got := carbIcingPercent(c.oat, c.dew); got != c.want {
			t.Errorf("carb icing at OAT %v dew point %v: %v %%, want %v %%", c.oat, c.dew, got, c.want)
		}
	}
	// Saturated (on the T = D line) must stay on the chart after the map.txt shift
	for _, oat := range []float64{2, 8, 14, 20, 26} {
		if carbIcingPercent(oat, oat) == 0 {
			t.Errorf("saturated air at %v °C is off the chart", oat)
		}
	}
}

func TestAirframeIcingPercent(t *testing.T) {
	for _, c := range []struct {
		oat, dew float64
		want     float32
	}{
		{-5, -5, 100},  // saturated, middle of the band
		{-5, -6, 100},  // spread 1: still full
		{-5, -7.5, 50}, // spread 2.5: half
		{-5, -9, 0},    // spread 4: dry
		{1.5, 1.5, 50}, // half way to +3
		{3, 3, 0},      // too warm
		{10, 10, 0},    // cloud, but warm
		{-15, -15, 50}, // half way to -20
		{-25, -25, 0},  // too cold
	} {
		if got := airframeIcingPercent(c.oat, c.dew); got != c.want {
			t.Errorf("airframe icing at OAT %v dew point %v: %v %%, want %v %%", c.oat, c.dew, got, c.want)
		}
	}
}

func TestIcingComputeNeedsReliableInputs(t *testing.T) {
	full := icingInput{humidity: 60, cabinTemp: 20, oat: 15, humidityOK: true, cabinTempOK: true, oatOK: true}
	keys := func(m map[string]float32) (n int) { return len(m) }

	if got := icingCompute(icingInput{}); keys(got) != 0 || got[PROBE_DEW_POINT] != 0 {
		t.Errorf("no humidity: %v", got)
	}
	in := full
	in.cabinTempOK, in.oatOK = false, false
	if got := icingCompute(in); keys(got) != 0 {
		t.Errorf("humidity without its temperature: %v", got)
	}
	in = full
	in.oatOK = false
	if got := icingCompute(in); keys(got) != 1 || got[PROBE_DEW_POINT] != 12 {
		t.Errorf("no OAT: want humidity and dew point 12, got %v", got)
	}
	got := icingCompute(full)
	if keys(got) != 4 {
		t.Fatalf("all inputs: %v", got)
	}
	// Cabin 20 °C 60 % = dew point 12 °C; outside 15 °C: 82 %, blue on the chart
	if got[PROBE_OUTSIDE_HUM] != 82 || got[PROBE_ICING_CARB] != 100 || got[PROBE_ICING_AIRFRAME] != 0 {
		t.Errorf("all inputs: %v", got)
	}
	// Cabin dew point above OAT: saturated outside, not off the chart
	in = full
	in.oat = 5
	got = icingCompute(in)
	if got[PROBE_OUTSIDE_HUM] != 100 || got[PROBE_ICING_CARB] == 0 {
		t.Errorf("dew point above OAT: %v", got)
	}
}

func TestIcingPublishesOnChangeAndWithdraws(t *testing.T) {
	withShippedRules(t)
	p := IcingStratuxPlugin{published: map[string]float32{}}
	full := icingCompute(icingInput{humidity: 60, cabinTemp: 20, oat: 15, humidityOK: true, cabinTempOK: true, oatOK: true})
	p.publish(full)
	for k, v := range full {
		if ems.emsData[k] != v || !ems.emsReceived[k] {
			t.Errorf("%s not published: %v", k, ems.emsData[k])
		}
	}
	// Change only the probe values that moved; a value set aside in the EMS shows a re-send
	ems.emsDataMutex.Lock()
	ems.emsData[PROBE_DEW_POINT] = -99
	ems.emsDataMutex.Unlock()
	p.publish(full)
	if ems.emsData[PROBE_DEW_POINT] != -99 {
		t.Error("an unchanged value was published again")
	}
	// OAT lost: the outside probes are withdrawn, the dew point stays
	p.publish(map[string]float32{PROBE_DEW_POINT: 12})
	for _, k := range []string{PROBE_OUTSIDE_HUM, PROBE_ICING_CARB, PROBE_ICING_AIRFRAME} {
		if _, ok := ems.emsData[k]; ok || ems.emsReceived[k] {
			t.Errorf("%s still in the EMS data after the OAT went", k)
		}
	}
	if _, ok := ems.emsData[PROBE_DEW_POINT]; !ok {
		t.Error("dew point withdrawn with the OAT")
	}
	if _, ok := ems.emsData["cabin_humidity"]; ok {
		t.Error("cabin_humidity published: the loop uses BaroHumidity only")
	}
}

// OAT is read only when an EMS sender posted it and the feed is alive.
func TestSenderValueNeedsALiveFeed(t *testing.T) {
	withEMS(t)
	if _, ok := ems.senderValue("outsidetemperature"); ok {
		t.Error("the pre-filled 0 was taken as an OAT")
	}
	ems.emsDataMutex.Lock()
	ems.emsData["outsidetemperature"] = -3
	ems.markReceived("outsidetemperature")
	ems.lastFrame = time.Time{} // withEMS sent a frame
	ems.emsDataMutex.Unlock()
	if _, ok := ems.senderValue("outsidetemperature"); ok {
		t.Error("an OAT with no EMS frame ever was taken")
	}
	emsFrame()
	if v, ok := ems.senderValue("outsidetemperature"); !ok || v != -3 {
		t.Errorf("live OAT: %v %v", v, ok)
	}
}

func TestShippedIcingRules(t *testing.T) {
	withShippedRules(t)
	for name, types := range map[string][2]int{
		"ICINGCARB":     {EVENT_TYPE_ICINGCARB_YELLOW, EVENT_TYPE_ICINGCARB_RED},
		"ICINGAIRFRAME": {EVENT_TYPE_ICINGAIRFRAME_YELLOW, EVENT_TYPE_ICINGAIRFRAME_RED},
	} {
		r := findRule(t, name)
		if !r.raisesAlerts() || r.alertTypeFor("yellow") != types[0] || r.alertTypeFor("red") != types[1] {
			t.Errorf("%s must raise its own icing alerts: %+v", name, r)
		}
		for v, want := range map[float32]string{0: "green", 25: "yellow", 50: "yellow", 75: "red", 100: "red"} {
			if got := ruleColor(r, v); got != want {
				t.Errorf("%s at %v is %q, want %q", name, v, got, want)
			}
		}
	}
}

// Carb icing 50 % then 100 % raises the icing yellow then red alert, typed by the rule's
// name (EVENT_TYPE_ICINGCARB_*), not as engine alerts.
func TestIcingProbesRaiseIcingAlerts(t *testing.T) {
	withShippedRules(t)
	ems.publishInternal(map[string]float32{PROBE_ICING_CARB: 0, PROBE_ICING_AIRFRAME: 0})
	if got := queued(); len(got) != 0 {
		t.Fatalf("0 %% raised %+v", got)
	}
	ems.publishInternal(map[string]float32{PROBE_ICING_CARB: 50})
	got := queued()
	if len(got) != 1 || got[0].Type != EVENT_TYPE_ICINGCARB_YELLOW || !got[0].Active {
		t.Fatalf("carb 50 %%: want one active carb icing yellow alert, got %+v", got)
	}
	ems.publishInternal(map[string]float32{PROBE_ICING_CARB: 100, PROBE_ICING_AIRFRAME: 75})
	types := map[int]bool{}
	for _, a := range queued() {
		if a.Active {
			types[a.Type] = true
		}
	}
	if !types[EVENT_TYPE_ICINGCARB_RED] || !types[EVENT_TYPE_ICINGAIRFRAME_RED] || types[EVENT_TYPE_ICINGCARB_YELLOW] {
		t.Errorf("carb 100 %%, airframe 75 %%: want both red active and the yellow closed, got %+v", queued())
	}
}
