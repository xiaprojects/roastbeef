/*
	uisockets_test.go: the two sockets that replaced polling on the display.

	/alerts/ws carries the whole alert list, once on connect and again on every
	change, and /playback/ws does the same for the recordings in the playback
	folder. Both are driven through the real handlers by a real WebSocket client.
	The goroutines that pace them (alertsListSender, playbackWatcher) run forever
	on the package globals, so each test does their one step itself instead.
*/

package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/websocket"
)

// dialSocket serves handler, connects to it and waits until the broadcaster has the socket
func dialSocket(t *testing.T, handler func(*websocket.Conn), broadcaster *uibroadcaster) *websocket.Conn {
	t.Helper()
	server := httptest.NewServer(websocket.Server{Handler: websocket.Handler(handler)})
	t.Cleanup(server.Close)
	conn, err := websocket.Dial("ws"+strings.TrimPrefix(server.URL, "http"), "", "http://localhost/")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	for deadline := time.Now().Add(2 * time.Second); !broadcaster.HasSockets(); time.Sleep(time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("socket never subscribed")
		}
	}
	return conn
}

// receiveJSON reads the next message into v, failing the test after two seconds
func receiveJSON(t *testing.T, conn *websocket.Conn, v interface{}) {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var text string
	if err := websocket.Message.Receive(conn, &text); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(text), v); err != nil {
		t.Fatalf("%q: %s", text, err)
	}
}

// drainAlertsListChanged empties the pending change, as alertsListSender would; true if there was one
func drainAlertsListChanged() bool {
	select {
	case <-alertsListChanged:
		return true
	default:
		return false
	}
}

// What alertsListSender does on a change, without its pacing
func sendAlertsListStep(t *testing.T) {
	t.Helper()
	if !drainAlertsListChanged() {
		t.Fatal("the change did not wake the sender")
	}
	alertsListUpdate.Send(alertsListJSON())
}

// The list on connect, then a new alert, an alert going inactive, and nothing for no change.
func TestAlertsListSocketFollowsTheList(t *testing.T) {
	withAlerts(t)
	saved := alertsListUpdate
	t.Cleanup(func() { alertsListUpdate = saved })
	alertsListUpdate = NewUIBroadcaster()
	drainAlertsListChanged()

	conn := dialSocket(t, handleAlertsListWS, alertsListUpdate)
	var list []Alert
	receiveJSON(t, conn, &list)
	if len(list) != 0 {
		t.Fatalf("on connect: %v, want the empty list", list)
	}

	id := alerts.pushEvent(Alert{Type: EVENT_TYPE_EMS_RULE_RED, Title: "Oil", Timestamp: time.Now(), Active: true})
	sendAlertsListStep(t)
	receiveJSON(t, conn, &list)
	if len(list) != 1 || list[0].Id != id || !list[0].Active || list[0].Title != "Oil" {
		t.Fatalf("after pushEvent: %+v", list)
	}

	alerts.pushEvent(Alert{Id: id, Active: false})
	sendAlertsListStep(t)
	receiveJSON(t, conn, &list)
	if len(list) != 1 || list[0].Active {
		t.Fatalf("after going inactive: %+v", list)
	}

	alerts.pushEvent(Alert{Id: id, Active: false})
	if drainAlertsListChanged() {
		t.Error("an inactive alert staying inactive woke the sender")
	}
	alerts.pushEvent(Alert{Id: 1, Active: true}) // no such alert
	if drainAlertsListChanged() {
		t.Error("an update of an unknown Id woke the sender")
	}
}

// /getAlerts answers what /alerts/ws carries.
func TestAlertsRequestMatchesTheSocket(t *testing.T) {
	withAlerts(t)
	alerts.pushEvent(Alert{Type: EVENT_TYPE_EMS_RULE_YELLOW, Title: "CHT", Timestamp: time.Now()})
	recorder := httptest.NewRecorder()
	handleAlertsRequest(recorder, httptest.NewRequest("GET", "/getAlerts", nil))
	if got, want := strings.TrimSpace(recorder.Body.String()), string(alertsListJSON()); got != want {
		t.Errorf("/getAlerts %s, socket %s", got, want)
	}
}

// The folder on connect, then a recording appearing, growing and going; nothing when it holds still.
func TestPlaybackSocketFollowsTheFolder(t *testing.T) {
	savedDir, savedUpdate := STRATUX_WWW_DIR, playbackUpdate
	t.Cleanup(func() { STRATUX_WWW_DIR, playbackUpdate = savedDir, savedUpdate })
	STRATUX_WWW_DIR = t.TempDir() + "/"
	folder := filepath.Join(STRATUX_WWW_DIR, "playback")
	if err := os.Mkdir(folder, 0755); err != nil {
		t.Fatal(err)
	}
	playbackUpdate = NewUIBroadcaster()
	if playbackWatchStep(nil) != nil {
		t.Error("the folder was read with no display connected")
	}

	conn := dialSocket(t, handlePlaybackWS, playbackUpdate)
	var list []RadioPlayback
	receiveJSON(t, conn, &list)
	if len(list) != 0 {
		t.Fatalf("on connect: %v, want the empty list", list)
	}
	last := playbackWatchStep(nil) // the first read sends even if nothing changed
	receiveJSON(t, conn, &list)

	recording := filepath.Join(folder, "radio_20261110_101500_122500000.mp3")
	if err := os.WriteFile(recording, []byte("ID3"), 0644); err != nil {
		t.Fatal(err)
	}
	last = playbackWatchStep(last)
	receiveJSON(t, conn, &list)
	if len(list) != 1 || list[0].Path != "/playback/radio_20261110_101500_122500000.mp3" || list[0].Size != 3 {
		t.Fatalf("after a recording: %+v", list)
	}

	if err := os.WriteFile(recording, []byte("ID3 and more"), 0644); err != nil {
		t.Fatal(err)
	}
	last = playbackWatchStep(last)
	receiveJSON(t, conn, &list)
	if len(list) != 1 || list[0].Size != 12 {
		t.Fatalf("after the recording grew: %+v", list)
	}

	// Nothing changed: no message, so the next one received is the removal
	last = playbackWatchStep(last)
	os.Remove(recording)
	playbackWatchStep(last)
	receiveJSON(t, conn, &list)
	if len(list) != 0 {
		t.Fatalf("after the removal: %+v", list)
	}
}

// A missing folder is the empty list on the socket, as on /playback.
func TestPlaybackSocketWithoutFolder(t *testing.T) {
	savedDir, savedUpdate := STRATUX_WWW_DIR, playbackUpdate
	t.Cleanup(func() { STRATUX_WWW_DIR, playbackUpdate = savedDir, savedUpdate })
	STRATUX_WWW_DIR = t.TempDir() + "/"
	playbackUpdate = NewUIBroadcaster()

	conn := dialSocket(t, handlePlaybackWS, playbackUpdate)
	var list []RadioPlayback
	receiveJSON(t, conn, &list)
	if list == nil || len(list) != 0 {
		t.Fatalf("%v, want []", list)
	}
	recorder := httptest.NewRecorder()
	handlePlaybackGet(recorder, httptest.NewRequest("GET", "/playback", nil))
	if got := strings.TrimSpace(recorder.Body.String()); got != "[]" {
		t.Errorf("/playback answered %q", got)
	}
}
