/*
	radio_test.go: the SDR driver, RB-SDR-RADIO-IF v1.1.

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

		{"108.000", 108, true},     // the VOR band, on its 50 kHz grid
		{"108.050", 108.05, true},
		{"108.100", 108.1, true}, // a localiser: only audio here, so it passes
		{"109.400", 109.4, true},
		{"113.800", 113.8, true},
		{"117.950", 117.95, true}, // last navaid channel

		{"107.950", 0, false},
		{"108.005", 0, false}, // no 8.33 kHz plan below 118
		{"108.025", 0, false},
		{"117.900", 117.9, true},
		{"117.980", 0, false},
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
	channels := 0
	check := func(khz int) {
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
	for khz := RADIO_SDR_BAND_MIN_KHZ; khz <= RADIO_SDR_NAV_MAX_KHZ; khz += RADIO_SDR_NAV_GRID_KHZ {
		check(khz)
	}
	digits := []int{0, 5, 10, 15, 25, 30, 35, 40, 50, 55, 60, 65, 75, 80, 85, 90}
	for hundreds := RADIO_SDR_COM_MIN_KHZ; hundreds <= 136900; hundreds += 100 {
		for _, last := range digits {
			check(hundreds + last)
		}
	}
	if channels != 3240 { // len(freqrules.all_channels())
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

// With Dual off standby stays in RB-01, and it must accept what the 5 kHz spinner passes
// on its way, or it could never get beyond 118.015.
func TestRadioSdrStandbyIsNotSent(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	if !radio.radioSetFrequency(0, "118.020", false, "") {
		t.Error("standby refused")
	}
	if got, ok := bridgeKey(RADIO_SDR_KEY_FREQUENCY); ok {
		t.Errorf("sdrradiofreq = %v; want nothing", got)
	}
	this.FrequencyStandby = "121.500"
	postRadio(t, `{"FrequencyStandby":"121.500"}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_SECONDARY); !ok || got != 0 {
		t.Errorf("Dual off: sdrradiofreqsecondary = %v, %v; want 0", got, ok)
	}
}

// DUAL watches the standby as well, and the plate's button is the POST.
func TestRadioSdrDualSendsTheStandby(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive, this.FrequencyStandby = "118.700", "121.500"

	postRadio(t, `{"Dual":true}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 118.7 {
		t.Errorf("sdrradiofreq = %v", got)
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_SECONDARY); got != 121.5 {
		t.Errorf("sdrradiofreqsecondary = %v", got)
	}
	if !this.Dual {
		t.Error("Dual not stored")
	}
	if len(alerts.alertsData) != 0 {
		t.Errorf("alerts: %v", alerts.alertsData)
	}

	postRadio(t, `{"Dual":false}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_SECONDARY); !ok || got != 0 {
		t.Errorf("Dual off: sdrradiofreqsecondary = %v, %v; want 0", got, ok)
	}
}

func TestRadioSdrDualFollowsTheStandby(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive, this.FrequencyStandby, this.Dual = "118.700", "121.500", true
	postRadio(t, `{"FrequencyStandby":"122.800"}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_SECONDARY); got != 122.8 {
		t.Errorf("sdrradiofreqsecondary = %v", got)
	}
}

// The spinner on its way through 118.020 must not stop the radio or raise an alert: the
// daemon drops a bad primary, and a bad secondary is 0 here.
func TestRadioSdrDualThroughAStandbyThatIsNotAChannel(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive, this.FrequencyStandby, this.Dual = "118.700", "121.500", true
	postRadio(t, `{"FrequencyStandby":"118.020"}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_SECONDARY); !ok || got != 0 {
		t.Errorf("sdrradiofreqsecondary = %v, %v; want 0", got, ok)
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 118.7 {
		t.Errorf("sdrradiofreq = %v", got)
	}
	if len(alerts.alertsData) != 0 {
		t.Errorf("alerts: %v", alerts.alertsData)
	}
	if this.FrequencyStandby != "118.020" {
		t.Errorf("FrequencyStandby = %q", this.FrequencyStandby)
	}
}

// The same frequency on both is one channel, and there is nothing to hop to.
func TestRadioSdrDualOnTheSameChannelWatchesNothing(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive, this.FrequencyStandby, this.Dual = "118.700", "118.700", true
	postRadio(t, `{"Enabled":true}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_SECONDARY); !ok || got != 0 {
		t.Errorf("sdrradiofreqsecondary = %v, %v; want 0", got, ok)
	}
}

func TestRadioSdrDualSwapsWithTheChannels(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive, this.FrequencyStandby, this.Dual = "118.700", "121.500", true
	postRadio(t, `{"FrequencyActive":"121.500","FrequencyStandby":"118.700"}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 121.5 {
		t.Errorf("sdrradiofreq = %v", got)
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_SECONDARY); got != 118.7 {
		t.Errorf("sdrradiofreqsecondary = %v", got)
	}
}

// Off releases the dongle: nothing may be left asking it to watch.
func TestRadioSdrDualOffWithTheRadio(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive, this.FrequencyStandby, this.Dual = "118.700", "121.500", true
	postRadio(t, `{"Enabled":false}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_SECONDARY); !ok || got != 0 {
		t.Errorf("sdrradiofreqsecondary = %v, %v; want 0", got, ok)
	}
	if !this.Dual {
		t.Error("Dual lost: it should be there when the radio comes back on")
	}
}

// A KRT2 has its own dual watch: nothing may appear on the bridge for it.
func TestRadioDualOnTheOtherDriversWritesNothing(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_RS232)
	this.FrequencyStandby = "121.500"
	postRadio(t, `{"Dual":true}`)
	if len(addonsBridge.bridgeFloatData) != 0 {
		t.Errorf("bridge = %v", addonsBridge.bridgeFloatData)
	}
}

// A restart of RB-01 restores the watching. The daemon may have outlived it, so a radio
// saved with Dual off says so as well.
func TestRadioSdrRestoreCarriesDual(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive, this.FrequencyStandby, this.Dual = "118.700", "121.500", true
	radio.radioSdrRestore(this)
	if got, _ := bridgeKey(RADIO_SDR_KEY_SECONDARY); got != 121.5 {
		t.Errorf("sdrradiofreqsecondary = %v", got)
	}

	this = sdrRadioState(t, RADIO_DRIVER_SDR)
	radio.radioSdrRestore(this)
	if got, ok := bridgeKey(RADIO_SDR_KEY_SECONDARY); !ok || got != 0 {
		t.Errorf("Dual off: sdrradiofreqsecondary = %v, %v; want 0", got, ok)
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

// A level the body names is a command. In every stratux.conf so far the stored 0 means
// never set, with the daemon on its own default, so a slider moved to 0 would otherwise
// compare equal, send nothing, and spring back.
func TestRadioPostOfALevelEqualToTheStoredOneGoes(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	postRadio(t, `{"VolumeLevel":0}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_VOLUME); !ok || got != 0 {
		t.Errorf("sdrradiovolume = %v, %v; want 0", got, ok)
	}
	postRadio(t, `{"SquelchLevel":0}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_SQUELCH); !ok || got != 0 {
		t.Errorf("sdrradiosquelch = %v, %v; want 0", got, ok)
	}
	if this.VolumeLevel != 0 || this.SquelchLevel != 0 {
		t.Errorf("stored %v, %v", this.VolumeLevel, this.SquelchLevel)
	}
	if len(alerts.alertsData) != 0 {
		t.Errorf("alerts: %v", alerts.alertsData)
	}
}

// VOL 0 is the off position: the radio goes INACTIVE and the receiver gives the dongle back,
// keeping everything the pilot set for when it comes back.
func TestRadioSdrVolumeZeroTurnsTheRadioOff(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive, this.FrequencyStandby, this.Dual = "118.700", "121.500", true
	postRadio(t, `{"VolumeLevel":35}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 118.7 {
		t.Fatalf("on: sdrradiofreq = %v", got)
	}

	postRadio(t, `{"VolumeLevel":0}`)

	if this.Enabled {
		t.Error("still enabled at VOL 0")
	}
	if got, ok := bridgeKey(RADIO_SDR_KEY_FREQUENCY); !ok || got != 0 {
		t.Errorf("sdrradiofreq = %v, %v; want 0, which releases the SDR", got, ok)
	}
	if got, ok := bridgeKey(RADIO_SDR_KEY_SECONDARY); !ok || got != 0 {
		t.Errorf("sdrradiofreqsecondary = %v, %v; want 0", got, ok)
	}
	if got, ok := bridgeKey(RADIO_SDR_KEY_VOLUME); !ok || got != 0 {
		t.Errorf("sdrradiovolume = %v, %v; want 0", got, ok)
	}
	if this.FrequencyActive != "118.700" || this.FrequencyStandby != "121.500" || !this.Dual {
		t.Errorf("settings lost: %q, %q, %v", this.FrequencyActive, this.FrequencyStandby, this.Dual)
	}
	if len(alerts.alertsData) != 0 {
		t.Errorf("alerts: %v", alerts.alertsData)
	}
}

// One body that asks for both, as a client that posts every field would.
func TestRadioSdrVolumeZeroWinsOverEnabled(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive = "118.700"
	postRadio(t, `{"Enabled":true,"VolumeLevel":0}`)
	if this.Enabled {
		t.Error("enabled at VOL 0")
	}
	if got, ok := bridgeKey(RADIO_SDR_KEY_FREQUENCY); !ok || got != 0 {
		t.Errorf("sdrradiofreq = %v, %v; want 0", got, ok)
	}
}

// Enabled also selects between radios, so a level alone must not take the selection.
func TestRadioSdrRaisingTheVolumeDoesNotTurnItOn(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	postRadio(t, `{"VolumeLevel":0}`)
	postRadio(t, `{"VolumeLevel":40}`)
	if this.Enabled {
		t.Error("a level turned the radio on")
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 0 {
		t.Errorf("sdrradiofreq = %v", got)
	}
}

// Back on from VOL 0, on the level it was at: on and silent would not be on.
func TestRadioSdrOnFromVolumeZeroRestoresTheLevel(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.FrequencyActive = "118.700"
	postRadio(t, `{"VolumeLevel":35}`)
	postRadio(t, `{"VolumeLevel":0}`)
	addonsBridge.setFloats(map[string]float32{RADIO_SDR_KEY_VOLUME_ACTIVE: 0})

	postRadio(t, `{"Enabled":true}`)

	if !this.Enabled {
		t.Error("not enabled")
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_VOLUME); got != 35 {
		t.Errorf("sdrradiovolume = %v, want 35", got)
	}
	if this.VolumeLevel != 35 {
		t.Errorf("VolumeLevel = %v", this.VolumeLevel)
	}
	if got, _ := bridgeKey(RADIO_SDR_KEY_FREQUENCY); got != 118.7 {
		t.Errorf("sdrradiofreq = %v", got)
	}
}

// The receiver has not answered yet, or is not running, and it will read the 0 on the bridge.
func TestRadioSdrOnFromVolumeZeroBeforeTheReceiverReplies(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_SDR)
	postRadio(t, `{"VolumeLevel":35}`)
	postRadio(t, `{"VolumeLevel":0}`)
	postRadio(t, `{"Enabled":true}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_VOLUME); got != 35 {
		t.Errorf("sdrradiovolume = %v, want 35", got)
	}
}

// After a restart there is no earlier level, and a receiver that outlived it still holds 0.
func TestRadioSdrOnFromVolumeZeroWithNoEarlierLevel(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.Enabled = false
	addonsBridge.setFloats(map[string]float32{RADIO_SDR_KEY_VOLUME_ACTIVE: 0})
	postRadio(t, `{"Enabled":true}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_VOLUME); got != RADIO_SDR_VOLUME_ON {
		t.Errorf("sdrradiovolume = %v, want %v", got, RADIO_SDR_VOLUME_ON)
	}
}

// A stored 0 in a stratux.conf that never set a level must not turn anything off or send a
// level: the receiver is on its own default, and says so.
func TestRadioSdrOnLeavesTheReceiversOwnVolume(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.Enabled = false
	addonsBridge.setFloats(map[string]float32{RADIO_SDR_KEY_VOLUME_ACTIVE: 75})
	postRadio(t, `{"Enabled":true}`)
	if !this.Enabled {
		t.Error("not enabled")
	}
	if got, ok := bridgeKey(RADIO_SDR_KEY_VOLUME); ok {
		t.Errorf("sdrradiovolume = %v, want nothing sent", got)
	}
}

// With no receiver heard from yet there is nothing to go by, and nothing is sent.
func TestRadioSdrOnWithNoReceiverSendsNoVolume(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	this.Enabled = false
	postRadio(t, `{"Enabled":true}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_VOLUME); ok {
		t.Errorf("sdrradiovolume = %v, want nothing sent", got)
	}
}

// A level in the same body is the pilot's, and the last one must not replace it.
func TestRadioSdrOnWithALevelTakesThatLevel(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	postRadio(t, `{"VolumeLevel":35}`)
	postRadio(t, `{"VolumeLevel":0}`)
	addonsBridge.setFloats(map[string]float32{RADIO_SDR_KEY_VOLUME_ACTIVE: 0})
	postRadio(t, `{"Enabled":true,"VolumeLevel":60}`)
	if got, _ := bridgeKey(RADIO_SDR_KEY_VOLUME); got != 60 || this.VolumeLevel != 60 || !this.Enabled {
		t.Errorf("sdrradiovolume = %v, stored %v, enabled %v", got, this.VolumeLevel, this.Enabled)
	}
}

// An enabled radio pressed again, as every spinner press does, is not being turned on.
func TestRadioSdrOnOnlyWhenItWasOff(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_SDR)
	addonsBridge.setFloats(map[string]float32{RADIO_SDR_KEY_VOLUME_ACTIVE: 0})
	postRadio(t, `{"Enabled":true}`)
	if got, ok := bridgeKey(RADIO_SDR_KEY_VOLUME); ok {
		t.Errorf("sdrradiovolume = %v, want nothing sent", got)
	}
}

// A KRT2 has no such command: the rule must not reach it.
func TestRadioVolumeZeroOnTheOtherDriversChangesNothing(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_RS232)
	postRadio(t, `{"VolumeLevel":0}`)
	if !this.Enabled {
		t.Error("a serial radio was turned off")
	}
	if len(addonsBridge.bridgeFloatData) != 0 {
		t.Errorf("bridge = %v", addonsBridge.bridgeFloatData)
	}
}

// The stored level is the one to come back to after a restart of RB-01.
func TestRadioStartsWithTheStoredLevelToComeBackTo(t *testing.T) {
	sdrRadioState(t, RADIO_DRIVER_SDR)
	globalSettings.Radio = []RadioStatus{{Driver: RADIO_DRIVER_SDR, VolumeLevel: 35}}
	radio.InitFunc()
	defer radio.ShutdownFunc()
	if got := radio.radioData[0].volumeOn; got != 35 {
		t.Errorf("volumeOn = %v, want 35", got)
	}
}

// The levels of the slider: the extremes reach the daemon as they are, and out of range
// is refused with an alert.
func TestRadioPostOfALevelOutOfRangeIsRefused(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	postRadio(t, `{"VolumeLevel":100,"SquelchLevel":30}`)
	if volume, _ := bridgeKey(RADIO_SDR_KEY_VOLUME); volume != 100 {
		t.Errorf("sdrradiovolume = %v", volume)
	}
	postRadio(t, `{"VolumeLevel":101}`)
	if this.VolumeLevel != 100 {
		t.Errorf("VolumeLevel = %v", this.VolumeLevel)
	}
	if len(alerts.alertsData) != 1 {
		t.Errorf("%d alerts, want the refusal", len(alerts.alertsData))
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
// the squelch and turn recording off, so only the frequencies go.
func TestRadioSdrRestoreLeavesDaemonDefaults(t *testing.T) {
	this := sdrRadioState(t, RADIO_DRIVER_SDR)
	radio.radioSdrRestore(this)
	if got := addonsBridge.bridgeFloatData; len(got) != 2 || got[RADIO_SDR_KEY_FREQUENCY] != 118 || got[RADIO_SDR_KEY_SECONDARY] != 0 {
		t.Errorf("bridge = %v, want only the frequency 118, on one channel", got)
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

	// A change of the channel may be more than one frame. The last of them is the state
	until := func(done func() bool) {
		t.Helper()
		for !done() {
			if err := websocket.JSON.Receive(conn, &frame); err != nil {
				t.Fatalf("%v, last frame %v", err, frame)
			}
		}
	}

	postRadio(t, `{"FrequencyActive":"118.030"}`)
	until(func() bool { return math.Abs(frame[RADIO_SDR_KEY_FREQUENCY]*1000-118030) <= 0.05 })
	if frame["rpm"] != 2400 {
		t.Errorf("frame = %v, want the whole map", frame)
	}

	postRadio(t, `{"Enabled":false}`)
	until(func() bool { got, ok := frame[RADIO_SDR_KEY_FREQUENCY]; return ok && got == 0 })
}
