/*
	alertsrest_test.go: alerts raised from outside the daemon, POST /alert.

	An external service raises an alert with a type and a title, keeps the Id it is
	answered, and updates the alert with it. What it raises reaches the display the
	same way as an alert raised inside: the new alert on /alerts, the list on
	/alerts/ws. The tests call the real handler with a recorder, and read what went
	to the display from the broadcaster withAlerts() gives them and from the pending
	change that wakes alertsListSender.
*/

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// postAlert sends body to the handler as method, returns the status and the decoded answer
func postAlert(t *testing.T, method, body string) (int, map[string]interface{}) {
	t.Helper()
	recorder := httptest.NewRecorder()
	handleAlertPost(recorder, httptest.NewRequest(method, "/alert", strings.NewReader(body)))
	var answer map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &answer); err != nil {
		t.Fatalf("%s %s answered %q, not JSON", method, body, recorder.Body.String())
	}
	return recorder.Code, answer
}

// A raised alert reaches both sockets, and an update by its Id reaches the list.
func TestAlertPostRaisesAndUpdates(t *testing.T) {
	withAlerts(t)
	drainAlertsListChanged()

	code, answer := postAlert(t, "POST", `{"Type": 15, "Title": "CHT red 225", "Active": true}`)
	if code != http.StatusOK || answer["Id"] == nil {
		t.Fatalf("raise: %d %v", code, answer)
	}
	id := int(answer["Id"].(float64))
	if got := sent(t); len(got) != 1 || got[0].Id != id || got[0].Type != 15 || got[0].Title != "CHT red 225" {
		t.Errorf("/alerts was sent %+v", got)
	}
	if !drainAlertsListChanged() {
		t.Error("the raise did not reach /alerts/ws")
	}
	if got := queued(); len(got) != 1 || !got[0].Active || got[0].Timestamp.IsZero() {
		t.Errorf("queued %+v, want one active alert stamped by the daemon", got)
	}

	code, answer = postAlert(t, "POST", `{"Id": `+strconv.Itoa(id)+`, "Active": false}`)
	if code != http.StatusOK || int(answer["Id"].(float64)) != id {
		t.Fatalf("update: %d %v", code, answer)
	}
	if got := sent(t); len(got) != 0 {
		t.Errorf("an update was announced as a new alert: %+v", got)
	}
	if !drainAlertsListChanged() {
		t.Error("the update did not reach /alerts/ws")
	}
	if got := queued(); len(got) != 1 || got[0].Active {
		t.Errorf("queued %+v, want the one alert inactive", got)
	}
}

// Id 0 is the alert of 00:00:00.00, so a body with "Id": 0 is an update, not a raise.
func TestAlertPostIdZeroIsAnUpdate(t *testing.T) {
	withAlerts(t)
	alerts.alertsData = append(alerts.alertsData, Alert{Id: 0, Type: EVENT_TYPE_TIMER, Timestamp: time.Now(), Active: true})
	code, answer := postAlert(t, "POST", `{"Id": 0, "Active": false}`)
	if code != http.StatusOK || answer["Id"].(float64) != 0 {
		t.Fatalf("%d %v", code, answer)
	}
	if got := queued(); len(got) != 1 || got[0].Active {
		t.Errorf("queued %+v", got)
	}
}

// Robustness: what the handler refuses, and that it raises nothing for it.
func TestAlertPostRefuses(t *testing.T) {
	withAlerts(t)
	drainAlertsListChanged()
	cases := []struct {
		method, body string
		code         int
	}{
		{"GET", ``, http.StatusMethodNotAllowed},
		{"PUT", `{"Type": 1}`, http.StatusMethodNotAllowed},
		{"POST", ``, http.StatusBadRequest},
		{"POST", `not json`, http.StatusBadRequest},
		{"POST", `{"Title": "no type"}`, http.StatusBadRequest},
		{"POST", `{"Type": -1}`, http.StatusBadRequest},
		{"POST", `{"Type": 1000}`, http.StatusBadRequest},
		{"POST", `{"Type": "15"}`, http.StatusBadRequest},
		{"POST", `{"Id": 123, "Active": false}`, http.StatusNotFound},
	}
	for _, c := range cases {
		if code, answer := postAlert(t, c.method, c.body); code != c.code || answer["Error"] == nil {
			t.Errorf("%s %q: %d %v, want %d and an Error", c.method, c.body, code, answer, c.code)
		}
	}
	if got := queued(); len(got) != 0 {
		t.Errorf("refused requests queued %+v", got)
	}
	if got := sent(t); len(got) != 0 {
		t.Errorf("refused requests reached /alerts: %+v", got)
	}
	if drainAlertsListChanged() {
		t.Error("refused requests reached /alerts/ws")
	}
}

// A title that would fill the list is cut, on a character and not in the middle of one.
func TestAlertPostCutsALongTitle(t *testing.T) {
	withAlerts(t)
	long := strings.Repeat("è", ALERT_TITLE_MAX_LEN+10)
	if code, _ := postAlert(t, "POST", `{"Type": 1, "Title": "`+long+`"}`); code != http.StatusOK {
		t.Fatalf("%d", code)
	}
	if got := queued(); len(got) != 1 || got[0].Title != strings.Repeat("è", ALERT_TITLE_MAX_LEN) {
		t.Errorf("title %q", got[0].Title)
	}
}

// The function raises nothing for a type outside the mapping, whichever path it came
// from: the new handler, the legacy /alert/<n>, or a caller inside the daemon. The
// legacy path used to panic on -1. Without a mapping the constants are the bound.
//
// Covers: RB-HLR-ALR-210
func TestUndefinedEventTypeIsNotRaised(t *testing.T) {
	withAlerts(t)
	EventLanguages = map[string][]EventHolder{ALERT_DEFAULT_LANGUAGE: make([]EventHolder, 20)}
	for _, alertType := range []int{-1, -1000, 20, 1 << 30} {
		if id := alerts.pushEvent(Alert{Type: alertType, Timestamp: time.Now()}); id != -1 {
			t.Errorf("type %d raised Id %d", alertType, id)
		}
		recorder := httptest.NewRecorder()
		handleAlertsPutRequest(recorder, httptest.NewRequest("GET", "/alert/"+strconv.Itoa(alertType), nil))
	}
	if id := alerts.pushEvent(Alert{Type: 19, Timestamp: time.Now()}); id == -1 {
		t.Error("the last row of the mapping was refused")
	}

	EventLanguages = nil
	if alertTypeDefined(EVENT_TYPE_COUNT) || !alertTypeDefined(EVENT_TYPE_COUNT-1) {
		t.Error("without a mapping the bound is not the constants")
	}

	if got := queued(); len(got) != 1 || got[0].Type != 19 {
		t.Errorf("queued %+v, want only the type 19 alert", got)
	}
	if got := sent(t); len(got) != 1 {
		t.Errorf("the display was sent %+v, want only the type 19 alert", got)
	}
}

// A service posting without end holds at most EVENT_MAX_QUEUE alerts: the oldest go
// first, an update of a dropped one is a 404, and the ones kept still update.
//
// Covers: RB-HLR-ALR-220
func TestRetainedAlertListIsBounded(t *testing.T) {
	withAlerts(t)
	alertUpdate = &uibroadcaster{sockets_mu: alertUpdate.sockets_mu, messages: make(chan []byte, 2*EVENT_MAX_QUEUE)}
	raised := EVENT_MAX_QUEUE + 50
	ids := make([]int, raised)
	for n := range ids {
		code, answer := postAlert(t, "POST", `{"Type": 1, "Title": "`+strconv.Itoa(n)+`", "Active": true}`)
		if code != http.StatusOK {
			t.Fatalf("alert %d: %d %v", n, code, answer)
		}
		ids[n] = int(answer["Id"].(float64))
	}
	got := queued()
	if len(got) != EVENT_MAX_QUEUE {
		t.Fatalf("%d alerts retained, want %d", len(got), EVENT_MAX_QUEUE)
	}
	if got[0].Title != strconv.Itoa(raised-EVENT_MAX_QUEUE) || got[len(got)-1].Title != strconv.Itoa(raised-1) {
		t.Errorf("retained %q to %q, want the newest %d", got[0].Title, got[len(got)-1].Title, EVENT_MAX_QUEUE)
	}
	if code, _ := postAlert(t, "POST", `{"Id": `+strconv.Itoa(ids[0])+`, "Active": false}`); code != http.StatusNotFound {
		t.Errorf("update of a dropped alert: %d, want 404", code)
	}
	if code, _ := postAlert(t, "POST", `{"Id": `+strconv.Itoa(ids[raised-EVENT_MAX_QUEUE])+`, "Active": false}`); code != http.StatusOK {
		t.Errorf("update of the oldest retained alert: %d, want 200", code)
	}
	if len(sent(t)) != raised {
		t.Error("an alert dropped from the list was not announced when raised")
	}
}

// A burst walks the Ids ahead of the clock. Once the list drops the oldest, a new alert
// must not take the Id of a dropped one, or a late update of that alert would change it.
// Covers: RB-HLR-ALR-270
func TestABurstDoesNotReissueADroppedId(t *testing.T) {
	withAlerts(t)
	alertUpdate = &uibroadcaster{sockets_mu: alertUpdate.sockets_mu, messages: make(chan []byte, 4*EVENT_MAX_QUEUE)}
	issued := map[int]bool{}
	now := time.Now()
	for n := 0; n < 3*EVENT_MAX_QUEUE; n++ {
		id := alerts.pushEvent(Alert{Type: 1, Timestamp: now})
		if issued[id] {
			t.Fatalf("alert %d took Id %d again", n, id)
		}
		issued[id] = true
	}
}
