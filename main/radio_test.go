/*
	radio_test.go: the SDR driver, RB-SDR-RADIO-IF v1.0.

	rb-sdr-radio is a client of the float bridge, so its contract here is the bridge
	map and the frames on /bridge/float/ws. POST /radio/{index} drives the real
	handler, the JSON decode included, and the WebSocket test is a real client.
*/

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/net/websocket"
)

// sdrRadioState gives the daemon one radio with this driver and an empty bridge. It
// points saveSettings at a scratch file, as the POST handler saves on every request.
func sdrRadioState(t *testing.T, driver string) *RadioStatus {
	t.Helper()
	radioData, radioMutex := radio.radioData, radio.radioDataMutex
	bridgeMutex, bridgeData := addonsBridge.bridgeDataMutex, addonsBridge.bridgeFloatData
	config, settings := configLocation, globalSettings.Radio
	alertsData, alertsMutex := alerts.alertsData, alerts.alertsDataMutex
	t.Cleanup(func() {
		radio.radioData, radio.radioDataMutex = radioData, radioMutex
		addonsBridge.bridgeDataMutex, addonsBridge.bridgeFloatData = bridgeMutex, bridgeData
		configLocation, globalSettings.Radio = config, settings
		alerts.alertsData, alerts.alertsDataMutex = alertsData, alertsMutex
	})

	configLocation = filepath.Join(t.TempDir(), "stratux.conf")
	alerts.alertsData, alerts.alertsDataMutex = make([]interface{}, 0), &sync.Mutex{}
	addonsBridge.bridgeDataMutex = &sync.Mutex{}
	addonsBridge.bridgeFloatData = make(map[string]float32)
	radio.radioDataMutex = &sync.Mutex{}
	radio.radioData = []RadioStatus{{Driver: driver, Enabled: true, FrequencyActive: "118.000", FrequencyStandby: "118.000"}}
	return &radio.radioData[0]
}

func postRadio(t *testing.T, body string) {
	t.Helper()
	postRadioTo(t, 0, body)
}

func postRadioTo(t *testing.T, index int, body string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/radio/%d", index), strings.NewReader(body))
	handleRadioPost(httptest.NewRecorder(), req)
}

func bridgeKey(key string) (float32, bool) {
	value, ok := addonsBridge.bridgeFloatData[key]
	return value, ok
}

// Names are the published plan, the table in rb-sdr-radio's freqrules.py, not a formula.
func TestRadioSdrChannelNames(t *testing.T) {
	cases := []struct {
		frequency string
		mhz       float32
		valid     bool
	}{
		{"118.000", 118, true},
		{"118.005", 118.005, true}, // 8.33 kHz name, tunes 118.0000
		{"118.030", 118.03, true},  // 8.33 kHz name, tunes 118.0250
		{"136.990", 136.99, true},  // last channel
		{"118.7", 118.7, true},     // digits as a person types them
		{"121", 121, true},

		{"118.020", 0, false}, // names ending 20, 45, 70, 95 do not exist
		{"118.045", 0, false},
		{"118.070", 0, false},
		{"118.095", 0, false},
		{"118.0083", 0, false}, // a tuned frequency, not its name 118.010
		{"118.001", 0, false},  // not on a 5 kHz step
		{"137.000", 0, false},  // the band edge
		{"136.995", 0, false},
		{"117.975", 0, false},
		{"", 0, false},
		{".", 0, false},
		{"0", 0, false}, // off is Enabled, not a frequency that loses the channel
		{"000.000", 0, false},
		{"118.-50", 0, false}, // radio.js below x.000
		{"-118.000", 0, false},
		{"NaN", 0, false},
		{"Inf", 0, false},
		{"118.0x0", 0, false},
		{"99999999999999999999.000", 0, false},
	}
	for _, c := range cases {
		mhz, valid := radioSdrChannelMHz(c.frequency)
		if mhz != c.mhz || valid != c.valid {
			t.Errorf("%q: %v, %v; want %v, %v", c.frequency, mhz, valid, c.mhz, c.valid)
		}
	}
}

// Every channel, the way the daemon reads it: float32 on the bridge, JSON on the socket,
// a float64 within 0.05 kHz of the name in freqrules.parse_channel.
func TestRadioSdrEveryChannelSurvivesTheBridge(t *testing.T) {
	digits := []int{0, 5, 10, 15, 25, 30, 35, 40, 50, 55, 60, 65, 75, 80, 85, 90}
	channels := 0
	for hundreds := 118000; hundreds <= 136900; hundreds += 100 {
		for _, last := range digits {
			khz := hundreds + last
			frequency := fmt.Sprintf("%d.%03d", khz/1000, khz%1000)
			mhz, valid := radioSdrChannelMHz(frequency)
			if !valid {
				t.Fatalf("%s refused", frequency)
			}
			frame, _ := json.Marshal(map[string]float32{RADIO_SDR_KEY_FREQUENCY: mhz})
			var decoded map[string]float64
			if err := json.Unmarshal(frame, &decoded); err != nil {
				t.Fatal(err)
			}
			received := decoded[RADIO_SDR_KEY_FREQUENCY] * 1000
			if math.Abs(received-float64(khz)) > 0.05 {
				t.Errorf("%s reaches the daemon as %v kHz", frequency, received)
			}
			channels++
		}
	}
	if channels != 3040 { // len(freqrules.all_channels())
		t.Errorf("%d channels", channels)
	}
}

func TestRadioSdrActiveFrequencyIsACommand(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_SDR)
	if !radio.radioSetFrequency(0, "121.500", true, "Guard") {
		t.Fatal("refused")
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("sdrradiofreq = %v", got)
	}
}

// Off is the Enabled flag. The bridge holds only numbers, so the empty frequency is 0,
// which releases the dongle, and the channel stays to come back to.
func TestRadioSdrDisabledSendsAnEmptyFrequency(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive = "121.500"
	postRadio(t, `{"Enabled":true}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("enabled: sdrradiofreq = %v", got)
	}

	postRadio(t, `{"Enabled":false}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_FREQUENCY); !ok || got != 0 {
		t.Errorf("disabled: sdrradiofreq = %v, %v; want 0", got, ok)
	}
	if this.Enabled || this.FrequencyActive != "121.500" {
		t.Errorf("stored %v, %q", this.Enabled, this.FrequencyActive)
	}

	postRadio(t, `{"Enabled":true}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("enabled again: sdrradiofreq = %v", got)
	}
	if len(alerts.alertsData) != 0 {
		t.Errorf("alerts: %v", alerts.alertsData)
	}
}

// A channel set while off waits, whether it comes from the screen or from the UDP path,
// which calls radioSetFrequency directly. It is still checked when it is set.
func TestRadioSdrDisabledKeepsTheChannelForLater(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.Enabled = false
	if !radio.radioSetFrequency(0, "119.000", true, "") {
		t.Error("refused while disabled")
	}
	if got, ok := bridgeKey(RADIO_SDR_KEY_FREQUENCY); ok {
		t.Errorf("sdrradiofreq = %v; a disabled radio must not tune", got)
	}
	if radio.radioSetFrequency(0, "118.020", true, "") {
		t.Error("not a channel, accepted while disabled")
	}

	postRadio(t, `{"FrequencyActive":"121.500"}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 0 {
		t.Errorf("disabled: sdrradiofreq = %v", got)
	}
	if this.FrequencyActive != "121.500" {
		t.Errorf("FrequencyActive = %q", this.FrequencyActive)
	}
	postRadio(t, `{"Enabled":true}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("enabled: sdrradiofreq = %v", got)
	}
}

// One POST that both enables and changes the channel: radio.js on a disabled radio.
func TestRadioSdrEnabledWithANewChannel(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.Enabled = false
	postRadio(t, `{"Enabled":true,"FrequencyActive":"121.500"}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("sdrradiofreq = %v", got)
	}
}

// Enabled is also the selection: choosing another radio disables the SDR, and choosing
// the SDR again brings it back.
func TestRadioSelectingAnotherRadioDisablesTheSdr(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_SDR)
	radio.radioData[0].FrequencyActive = "121.500"
	radio.radioData = append(radio.radioData, RadioStatus{Driver: RADIO_DRIVER_RS232_NMEA, FrequencyActive: "118.000", FrequencyStandby: "118.000"})

	postRadioTo(t, 1, `{"Enabled":true}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_FREQUENCY); !ok || got != 0 {
		t.Errorf("other radio selected: sdrradiofreq = %v, %v; want 0", got, ok)
	}
	postRadioTo(t, 0, `{"Enabled":true}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("SDR selected: sdrradiofreq = %v", got)
	}
	if radio.radioData[1].Enabled {
		t.Error("the other radio is still enabled")
	}
}

// One receiver: an entry that is not selected must not switch off the one that is.
func TestRadioSdrTwoEntriesFollowTheSelectedOne(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_SDR)
	radio.radioData = append(radio.radioData, RadioStatus{Driver: RADIO_DRIVER_SDR, FrequencyActive: "121.500", FrequencyStandby: "118.000"})

	postRadioTo(t, 1, `{"Enabled":true}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("sdrradiofreq = %v", got)
	}
	for comm := range radio.radioData {
		radio.radioSdrRestore(&radio.radioData[comm])
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("after restore: sdrradiofreq = %v", got)
	}

	// And with the selected entry first, so that it is not simply the last one seen
	postRadioTo(t, 0, `{"Enabled":true}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 118 {
		t.Errorf("first entry selected: sdrradiofreq = %v", got)
	}
	for comm := range radio.radioData {
		radio.radioSdrRestore(&radio.radioData[comm])
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 118 {
		t.Errorf("after restore, first entry selected: sdrradiofreq = %v", got)
	}
}

// A KRT2 owner has no rb-sdr-radio: nothing may appear on the bridge for it.
func TestRadioWithoutAnSdrWritesNoFrequency(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_RS232_NMEA)
	postRadio(t, `{"Enabled":false}`)
	postRadio(t, `{"Enabled":true}`)
	if len(addonsBridge.bridgeFloatData) != 0 {
		t.Errorf("bridge = %v", addonsBridge.bridgeFloatData)
	}
}

// One receiver: standby stays in RB-01, and must accept what the 5 kHz spinner passes on
// its way, or it could never get beyond 118.015.
func TestRadioSdrStandbyIsNotSent(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_SDR)
	if !radio.radioSetFrequency(0, "118.020", false, "") {
		t.Error("standby refused")
	}
	if got, ok := bridgeKey(RADIO_SDR_KEY_FREQUENCY); ok {
		t.Errorf("sdrradiofreq = %v; want nothing", got)
	}
}

// The daemon answers a bad name by releasing the SDR. Refused here, it stays on channel.
func TestRadioSdrBadChannelKeepsTheRadioTuned(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	postRadio(t, `{"FrequencyActive":"121.500"}`)
	postRadio(t, `{"FrequencyActive":"118.020"}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("sdrradiofreq = %v, want 121.5 still", got)
	}
	if this.FrequencyActive != "121.500" {
		t.Errorf("FrequencyActive = %q", this.FrequencyActive)
	}
	if len(alerts.alertsData) != 1 {
		t.Errorf("%d alerts, want the refusal", len(alerts.alertsData))
	}
}

func TestRadioSdrHasNoDual(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_SDR)
	if radio.radioSetDual(0, true) {
		t.Error("dual watch accepted on a single receiver")
	}
}

func TestRadioSdrLevels(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	if !radio.radioSetVolume(0, 40) || !radio.radioSetSquelch(0, 12) || !radio.radioSetRecord(0, false) {
		t.Fatal("refused")
	}
	if volume, _ := bridgeKey(RADIO_SDR_KEY_VOLUME); volume != 40 || this.VolumeLevel != 40 {
		t.Errorf("volume %v, stored %v", volume, this.VolumeLevel)
	}
	if squelch, _ := bridgeKey(RADIO_SDR_KEY_SQUELCH); squelch != 12 || this.SquelchLevel != 12 {
		t.Errorf("squelch %v, stored %v", squelch, this.SquelchLevel)
	}
	if record, ok := bridgeKey(RADIO_SDR_KEY_RECORD); !ok || record != 0 || *this.Record {
		t.Errorf("record %v, %v, stored %v", record, ok, *this.Record)
	}

	for _, level := range []int{-1, 101} {
		if radio.radioSetVolume(0, level) || radio.radioSetSquelch(0, level) {
			t.Errorf("level %d accepted", level)
		}
	}
	if this.VolumeLevel != 40 || this.SquelchLevel != 12 {
		t.Errorf("refused levels stored: %v, %v", this.VolumeLevel, this.SquelchLevel)
	}
}

func TestRadioSdrCommandsNeedTheDriver(t *testing.T) {
	for _, driver := range []string{RADIO_DRIVER_RS232, RADIO_DRIVER_RS232_NMEA, ""} {
		sdrRadioState(t, driver)
		if radio.radioSetVolume(0, 40) || radio.radioSetSquelch(0, 12) || radio.radioSetRecord(0, true) {
			t.Errorf("driver %q accepted an SDR command", driver)
		}
		if len(addonsBridge.bridgeFloatData) != 0 {
			t.Errorf("driver %q wrote %v", driver, addonsBridge.bridgeFloatData)
		}
	}
	sdrRadioState(t, RADIO_DRIVER_SDR)
	if radio.radioSetVolume(1, 40) {
		t.Error("no such radio, accepted")
	}
}

func TestRadioPostCarriesTheSdrCommands(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	postRadio(t, `{"Enabled":true,"FrequencyActive":"118.030","VolumeLevel":35,"SquelchLevel":8,"Record":false}`)

	want := map[string]float32{RADIO_SDR_KEY_FREQUENCY: 118.03, RADIO_SDR_KEY_VOLUME: 35, RADIO_SDR_KEY_SQUELCH: 8, RADIO_SDR_KEY_RECORD: 0}
	for key, value := range want {
		if got, ok := bridgeKey(key); !ok || got != value {
			t.Errorf("%s = %v, %v; want %v", key, got, ok, value)
		}
	}
	if len(alerts.alertsData) != 0 {
		t.Errorf("alerts: %v", alerts.alertsData)
	}
	if this.FrequencyActive != "118.030" {
		t.Errorf("FrequencyActive = %q", this.FrequencyActive)
	}
}

// radio.js posts neither level, and 0 would mute the radio and open the squelch. On the
// other drivers, which have no such command, the same body must not raise an alert.
func TestRadioPostWithoutLevelsLeavesThem(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	postRadio(t, `{"VolumeLevel":35,"SquelchLevel":8}`)
	radioJs := `{"Enabled":true,"FrequencyActive":"118.000","FrequencyStandby":"119.000","LabelActive":"","LabelStandby":"","Dual":false}`
	postRadio(t, radioJs)
	if this.VolumeLevel != 35 || this.SquelchLevel != 8 {
		t.Errorf("levels %v, %v", this.VolumeLevel, this.SquelchLevel)
	}
	if volume, _ := bridgeKey(RADIO_SDR_KEY_VOLUME); volume != 35 {
		t.Errorf("sdrradiovolume = %v", volume)
	}
	if _, ok := bridgeKey(RADIO_SDR_KEY_RECORD); ok {
		t.Error("sdrradiorecord sent, the body had none")
	}

	sdrRadioState(t, RADIO_DRIVER_RS232_NMEA)
	postRadio(t, `{"Enabled":true,"FrequencyActive":"118.000","FrequencyStandby":"118.000","Dual":false}`)
	if len(alerts.alertsData) != 0 {
		t.Errorf("alerts on NMEA: %v", alerts.alertsData)
	}
}

// A volume slider sends the volume. Read as "", the frequencies it left out would be a
// refused command with an alert, and a blank standby.
func TestRadioPostOfOneFieldLeavesTheOthers(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive, this.FrequencyStandby, this.Dual = "121.500", "119.000", true
	on := true
	this.Record = &on

	postRadio(t, `{"VolumeLevel":35}`)

	if this.FrequencyActive != "121.500" || this.FrequencyStandby != "119.000" || !this.Dual || !this.Enabled {
		t.Errorf("%q, %q, %v, %v", this.FrequencyActive, this.FrequencyStandby, this.Dual, this.Enabled)
	}
	if this.Record == nil || !*this.Record {
		t.Errorf("Record = %v", this.Record)
	}
	if this.VolumeLevel != 35 {
		t.Errorf("VolumeLevel = %v", this.VolumeLevel)
	}
	if len(alerts.alertsData) != 0 {
		t.Errorf("alerts: %v", alerts.alertsData)
	}
}

func TestRadioSdrRestore(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	record := true
	this.FrequencyActive, this.VolumeLevel, this.SquelchLevel, this.Record = "118.030", 35, 8, &record
	radio.radioSdrRestore(this)
	want := map[string]float32{RADIO_SDR_KEY_FREQUENCY: 118.03, RADIO_SDR_KEY_VOLUME: 35, RADIO_SDR_KEY_SQUELCH: 8, RADIO_SDR_KEY_RECORD: 1}
	for key, value := range want {
		if got, ok := bridgeKey(key); !ok || got != value {
			t.Errorf("%s = %v, %v; want %v", key, got, ok, value)
		}
	}
}

// What every stratux.conf holds today. Sending those zeros would silence the radio, open
// the squelch and turn recording off, so only the frequency goes.
func TestRadioSdrRestoreLeavesDaemonDefaults(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	radio.radioSdrRestore(this)
	if got := addonsBridge.bridgeFloatData; len(got) != 1 || got[RADIO_SDR_KEY_FREQUENCY] != 118 {
		t.Errorf("bridge = %v, want only sdrradiofreq 118", got)
	}

	this = sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive = "118.020"
	radio.radioSdrRestore(this)
	if len(addonsBridge.bridgeFloatData) != 0 {
		t.Errorf("bad stored channel sent: %v", addonsBridge.bridgeFloatData)
	}
}

// The daemon may outlive a restart of RB-01, tuned. An absent key is no change to it, so
// a radio saved as disabled has to say so.
func TestRadioSdrRestoreOfADisabledRadioSendsTheEmptyFrequency(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.Enabled, this.VolumeLevel = false, 35
	radio.radioSdrRestore(this)
	if got, ok := bridgeKey(RADIO_SDR_KEY_FREQUENCY); !ok || got != 0 {
		t.Errorf("sdrradiofreq = %v, %v; want 0", got, ok)
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_VOLUME); got != 35 {
		t.Errorf("sdrradiovolume = %v, want it ready for when it is enabled", got)
	}
}

// Record survives stratux.conf, including the difference between off and never set.
func TestRadioRecordRoundTripsThroughSettings(t *testing.T) {
	off := false
	saved, err := json.Marshal([]RadioStatus{{Driver: RADIO_DRIVER_SDR, Record: &off}, {Driver: RADIO_DRIVER_SDR}})
	if err != nil {
		t.Fatal(err)
	}
	var loaded []RadioStatus
	if err := json.Unmarshal(saved, &loaded); err != nil {
		t.Fatal(err)
	}
	if loaded[0].Record == nil || *loaded[0].Record != false || loaded[1].Record != nil {
		t.Errorf("loaded %v, %v", loaded[0].Record, loaded[1].Record)
	}
}

// The commands as the daemon receives them: the whole bridge map on /bridge/float/ws.
func TestRadioSdrCommandReachesTheWebSocket(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_SDR)
	broadcaster := bridgeFloatUpdate
	t.Cleanup(func() { bridgeFloatUpdate = broadcaster })
	bridgeFloatUpdate = NewUIBroadcaster()

	server := httptest.NewServer(websocket.Server{Handler: websocket.Handler(handleBridgeFloatWS)})
	defer server.Close()
	conn, err := websocket.Dial("ws"+strings.TrimPrefix(server.URL, "http"), "", "http://localhost/")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	for deadline := time.Now().Add(2 * time.Second); ; time.Sleep(time.Millisecond) {
		bridgeFloatUpdate.sockets_mu.Lock()
		subscribed := len(bridgeFloatUpdate.sockets) == 1
		bridgeFloatUpdate.sockets_mu.Unlock()
		if subscribed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("socket never subscribed")
		}
	}

	addonsBridge.setFloats(map[string]float32{"rpm": 2400}) // another addon's key, carried along
	var frame map[string]float64
	conn.SetDeadline(time.Now().Add(2 * time.Second))
	if err := websocket.JSON.Receive(conn, &frame); err != nil {
		t.Fatal(err)
	}

	postRadio(t, `{"FrequencyActive":"118.030"}`)
	if err := websocket.JSON.Receive(conn, &frame); err != nil {
		t.Fatal(err)
	}
	if got := frame[RADIO_SDR_KEY_FREQUENCY] * 1000; math.Abs(got-118030) > 0.05 {
		t.Errorf("sdrradiofreq on the socket = %v kHz", got)
	}
	if frame["rpm"] != 2400 {
		t.Errorf("frame = %v, want the whole map", frame)
	}

	postRadio(t, `{"Enabled":false}`)
	if err := websocket.JSON.Receive(conn, &frame); err != nil {
		t.Fatal(err)
	}
	if got, ok := frame[RADIO_SDR_KEY_FREQUENCY]; !ok || got != 0 {
		t.Errorf("disabled, on the socket: sdrradiofreq = %v, %v; want 0", got, ok)
	}
}
