/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	alerts.go: Alarm interface
*/

package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Resources
const ALERT_MAPPING_JSON_NAME = "alertsMapping.json"
const ALERT_DEFAULT_LANGUAGE = "en-US"
// The folder of the sounds the daemon plays, unless Audio_SoundsDir names another
const ALERT_SOUNDS_DIR = "RB-01/sounds"

// Please define a unique Id and check for collision using the keyword "EVENT_TYPE_"
const (
	EVENT_TYPE_UNKOWN_WARNING           = 0
	EVENT_TYPE_UNKOWN_INFO              = 1
	EVENT_TYPE_TIMER                    = 2
	EVENT_TYPE_SYSTEM_DANGER            = 3
	EVENT_TYPE_SYSTEM_DANGER_BAROMETER  = 4
	EVENT_TYPE_SYSTEM_DANGER_SDR        = 5
	EVENT_TYPE_SYSTEM_DANGER_SETTINGS   = 6
	EVENT_TYPE_STARTUP_INFO             = 7
	EVENT_TYPE_AUTOPILOT_ENGAGE         = 8
	EVENT_TYPE_AUTOPILOT_DISENGAGE      = 9
	EVENT_TYPE_AUTOPILOT_ABEAM          = 10
	EVENT_TYPE_AUTOPILOT_GOTO           = 11
	EVENT_TYPE_RADIO_COMMAND_NOT_OK     = 12
	EVENT_TYPE_EMS_GENERIC_FAILURE		= 13
	EVENT_TYPE_EMS_RULE_YELLOW            = 14
	EVENT_TYPE_EMS_RULE_RED               = 15
	// 16 is EVENT_TYPE_GPS_NOT_FIXED in the mapping, with no constant here
	EVENT_TYPE_TERRAIN_CAUTION            = 17
	EVENT_TYPE_TERRAIN_WARNING            = 18
	EVENT_TYPE_TERRAIN_UNAVAILABLE        = 19
)

// Maximum events in the list
const EVENT_MAX_QUEUE = 100

// Resource Parsing
type EventHolder struct {
	Text  string
	Id    string
	Icon  string
	Sound string
}

// Alerts Mapping
var EventLanguages map[string][]EventHolder

// Web Interaction
type Alert struct {
	// Raise time as HHMMSScc, 19:06:44.55 is 19064455 and 00:00:00.00 is 0
	// Unique in the list but not ordered: a flight can cross midnight and the GPS steps the clock
	Id    int
	Type  int
	Title string
	// Set on a new alert. An event without it updates the alert with that Id, see pushEvent()
	Timestamp time.Time
	// Last time the condition was seen, Timestamp until then
	TimestampEnd time.Time
	// The condition has not been seen to go. Always false for a one-shot event
	Active bool
	// Time in the condition, TimestampEnd-Timestamp also counts the gaps of a condition that came back
	ActiveSeconds float64
}

type AlertsStratuxPlugin struct {
	StratuxPlugin
	alertsData      []interface{}
	alertsDataMutex *sync.Mutex
}

// Shared instance
var alerts = AlertsStratuxPlugin{}

/*
plugin.InitFunc().

	initialise the mutex and local variables
	load default configuration
	start thread in background, if any
*/
func (alertsInstance *AlertsStratuxPlugin) InitFunc() bool {
	log.Println("Entered AlertsStratuxPlugin init() ...")
	alertsInstance.Name = "Audio"
	alertsInstance.alertsDataMutex = &sync.Mutex{}
	alertsInstance.alertsData = make([]interface{}, 0)
	alertsMapping := STRATUX_WWW_DIR + "settings/" + ALERT_MAPPING_JSON_NAME
	log.Println("AlertsStratuxPlugin Loading Sound Mapping from: ", alertsMapping)
	// Open our jsonFile
	jsonFile, err := os.Open(alertsMapping)
	// if we os.Open returns an error then handle it
	if err != nil {
		fmt.Println(err)
	}
	// defer the closing of our jsonFile so that we can parse it later on
	defer jsonFile.Close()
	// read our opened jsonFile as a byte array.
	byteValue, _ := ioutil.ReadAll(jsonFile)
	err = json.Unmarshal(byteValue, &EventLanguages)
	if err != nil {
		fmt.Println(err)
	}
	log.Println("AlertsStratuxPlugin Loadded Sound Mapping Count: ", len(EventLanguages[ALERT_DEFAULT_LANGUAGE]))
	// Push initial event to track the startup
	alertsInstance.pushEvent(Alert{Type: EVENT_TYPE_STARTUP_INFO, Title: "Startup", Timestamp: time.Now()})
	// Nothing reads the result of aplay: this is the only report of a folder gone missing
	if globalSettings.Audio_Enabled && !soundsDirExists(globalSettings.Audio_SoundsDir) {
		addSingleSystemErrorf("sounds-dir", "Sounds folder not found: %s", soundsDir(globalSettings.Audio_SoundsDir))
	}
	return true
}

/*
plugin.ShutdownFunc().

	set halt variable status to allow thread gracefully exit, if any
*/
func (alertsInstance *AlertsStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered AlertsStratuxPlugin shutdown() ...")
	return true
}

/*
alerts.pushEventByIdent().

	wide event for System to pipe alerts
	returns the Id as pushEvent()
*/
func (alertsInstance *AlertsStratuxPlugin) pushEventByIdent(ident string, event Alert) int {
	// System wide alert signal mapping
	if(ident=="save-settings" || 
		ident=="disk-space" ||
		ident=="partition-rebuild" ||
		ident=="fs-write"){
			event.Type = EVENT_TYPE_SYSTEM_DANGER_SETTINGS

	} else if (ident=="pressure-sensor-temp-read" ||
	ident=="pressure-sensor-pressure-read" ||
	ident=="BaroBroken"){
		event.Type = EVENT_TYPE_SYSTEM_DANGER_BAROMETER
	} else if (ident=="sdrconfig" ||
	ident=="ping-missing"){
		event.Type = EVENT_TYPE_SYSTEM_DANGER_SDR
	} else if ident == "ems-feed" {
		event.Type = EVENT_TYPE_EMS_GENERIC_FAILURE
	} else if strings.HasPrefix(ident, "ems-") && strings.HasSuffix(ident, "-yellow") {
		event.Type = EVENT_TYPE_EMS_RULE_YELLOW
	} else if strings.HasPrefix(ident, "ems-") && strings.HasSuffix(ident, "-red") {
		event.Type = EVENT_TYPE_EMS_RULE_RED
	} else if ident == "terrain-caution" {
		event.Type = EVENT_TYPE_TERRAIN_CAUTION
	} else if ident == "terrain-warning" {
		event.Type = EVENT_TYPE_TERRAIN_WARNING
	} else if ident == "terrain-unavailable" {
		event.Type = EVENT_TYPE_TERRAIN_UNAVAILABLE
	} else {
		// Fallback to system danger
		event.Type = EVENT_TYPE_SYSTEM_DANGER
	}
	return alertsInstance.pushEvent(event)
}

/*
alerts.pushEvent().

	wide generic event api to pipe info,warning,danger
	An event with a Timestamp is a new alert
	An event without one updates the alert with that Id, if found: see updateEvent()
	Timestamp tells them apart and not Id, because 0 is the Id of the alert of 00:00:00.00
	Returns the Id, the caller can keep it to update the alert, -1 if nothing was raised or found
*/
func (alertsInstance *AlertsStratuxPlugin) pushEvent(event Alert) int {
	// incoming data without right InitFunc timing
	if alertsInstance.alertsData == nil {
		log.Println("Entered AlertsStratuxPlugin::pushEvent() too early")
		// Event discarded
		return -1
	}
	if event.Timestamp.IsZero() {
		return alertsInstance.updateEvent(event)
	}
	// Queue the Alert
	alertsInstance.alertsDataMutex.Lock()
	event.Id = alertsInstance.newEventId(event.Timestamp)
	event.TimestampEnd = event.Timestamp
	alertsInstance.alertsData = append(alertsInstance.alertsData, event)
	// Check for Maximum queue up to EVENT_MAX_QUEUE
	// TODO: Remove first element
	alertsInstance.alertsDataMutex.Unlock()
	// Dispatch event on web interface, if any
	alertUpdate.SendJSON(event)
	// Play audio locally on RPI, if enabled
	if globalSettings.Audio_Enabled == true {
		if len(EventLanguages[ALERT_DEFAULT_LANGUAGE]) > event.Type {
			item := EventLanguages[ALERT_DEFAULT_LANGUAGE][event.Type]
			sound := item.Sound
			if len(sound) > 0 {
				// TODO: Migrate from Wav to Mp3
				soundPath := soundFile(sound)
				// TODO: Let's customisable the player command line
				// TODO: Queue sounds in case of multiple events
				cmd := exec.Command("/usr/bin/aplay", soundPath)
				go startAndWaitCmd(cmd)
			}
		}
	}
	// Event pushed
	return event.Id
}

/*
alerts.updateEvent().

	Copy Active on the alert with the Id of event and, while it is active, move its end to now
	The display is not told: every message on the alerts socket is a new alert, with its sound
	and balloon. It reads the state from /getAlerts and decides by itself if to replay the alarm
*/
func (alertsInstance *AlertsStratuxPlugin) updateEvent(event Alert) int {
	alertsInstance.alertsDataMutex.Lock()
	defer alertsInstance.alertsDataMutex.Unlock()
	for i := len(alertsInstance.alertsData) - 1; i >= 0; i-- {
		found, ok := alertsInstance.alertsData[i].(Alert)
		if !ok || found.Id != event.Id {
			continue
		}
		if event.Active {
			now := time.Now()
			if found.Active {
				found.ActiveSeconds += now.Sub(found.TimestampEnd).Seconds()
			}
			found.TimestampEnd = now
		}
		found.Active = event.Active
		alertsInstance.alertsData[i] = found
		return found.Id
	}
	return -1
}

/*
alerts.newEventId().

	The time as HHMMSScc, alone it separates the alerts of a flight which is less than 24 hours
	An Id already in the list takes the next free centisecond, or one alert could not be updated
	Call it with alertsDataMutex held
*/
func (alertsInstance *AlertsStratuxPlugin) newEventId(t time.Time) int {
	for {
		id := t.Hour()*1000000 + t.Minute()*10000 + t.Second()*100 + t.Nanosecond()/10000000
		if !alertsInstance.hasEventId(id) {
			return id
		}
		t = t.Add(10 * time.Millisecond)
	}
}

func (alertsInstance *AlertsStratuxPlugin) hasEventId(id int) bool {
	for _, item := range alertsInstance.alertsData {
		if alert, ok := item.(Alert); ok && alert.Id == id {
			return true
		}
	}
	return false
}

/*
soundsDir().

	the folder a value of Audio_SoundsDir names: absolute, or relative to the web folder
	No value is ALERT_SOUNDS_DIR. Only the daemon reads it, the browser has its own copy
*/
func soundsDir(dir string) string {
	if dir == "" {
		dir = ALERT_SOUNDS_DIR
	}
	if filepath.IsAbs(dir) {
		return filepath.Clean(dir)
	}
	return filepath.Join(STRATUX_WWW_DIR, dir)
}

// soundFile is the file the daemon plays for a sound of the mapping
func soundFile(sound string) string {
	return filepath.Join(soundsDir(globalSettings.Audio_SoundsDir), sound+".wav")
}

func soundsDirExists(dir string) bool {
	info, err := os.Stat(soundsDir(dir))
	return err == nil && info.IsDir()
}

/*
setSoundsDir().

	change the folder of the sounds, for /setSettings
	A folder that is not there would silence every alert on the aircraft's audio
	Returns false if it is refused, the folder in use stays
*/
func setSoundsDir(dir string) bool {
	if !soundsDirExists(dir) {
		return false
	}
	globalSettings.Audio_SoundsDir = dir
	removeSingleSystemError("sounds-dir")
	return true
}

func startAndWaitCmd(cmd *exec.Cmd) {
	cmd.Start()
	cmd.Wait()
}