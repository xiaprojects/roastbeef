/*
	bridge_test.go: the /bridge/float POST keys that feed the situation.

	Drives handleBridgeFloatSetRequest through httptest, so the JSON decode,
	the bridge cache and the situation write are the real ones; the WebSocket
	broadcaster is nil (Send is nil-safe) and the flight log is off.
*/

package main

import (
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func postBridgeFloat(t *testing.T, body string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/bridge/float", strings.NewReader(body))
	handleBridgeFloatSetRequest(httptest.NewRecorder(), req)
}

// "ias_mps" is propagated to mySituation.IndicatedAirSpeed converted to knots,
// on the first reading, on a change, and back to 0 when the board reports none.
func TestBridgeFloatIasMpsFeedsIndicatedAirSpeed(t *testing.T) {
	addonsBridge.InitFunc()
	mySituation.IndicatedAirSpeed = 0

	cases := []struct {
		body string
		kt   float32
	}{
		{`{"ias_mps": 30}`, 58.3152},               // first reading
		{`{"ias_mps": 30}`, 58.3152},               // unchanged: still there
		{`{"ias_mps": 51.44, "rpm": 2400}`, 100.0}, // changed, other keys ignored
		{`{"ias_mps": 0}`, 0},                      // no airspeed source
	}
	for _, c := range cases {
		postBridgeFloat(t, c.body)
		if got := mySituation.IndicatedAirSpeed; math.Abs(float64(got-c.kt)) > 0.01 {
			t.Errorf("%s: IndicatedAirSpeed = %v kt, want %v", c.body, got, c.kt)
		}
	}
}

// Other bridge keys leave the airspeed alone.
func TestBridgeFloatOtherKeysDoNotTouchIndicatedAirSpeed(t *testing.T) {
	addonsBridge.InitFunc()
	mySituation.IndicatedAirSpeed = 42
	postBridgeFloat(t, `{"rpm": 2400, "oil_temp": 80}`)
	if mySituation.IndicatedAirSpeed != 42 {
		t.Errorf("IndicatedAirSpeed = %v, want 42 untouched", mySituation.IndicatedAirSpeed)
	}
}
