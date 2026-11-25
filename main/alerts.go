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
	EVENT_TYPE_GPS_NOT_FIXED              = 16
	EVENT_TYPE_TERRAIN_CAUTION            = 17
	EVENT_TYPE_TERRAIN_WARNING            = 18
	EVENT_TYPE_TERRAIN_UNAVAILABLE        = 19
	EVENT_TYPE_CABINAIR_YELLOW           = 20 // EMS rule CABINAIR (rbvoice-aircraft-rules.json, main/ems.go alertTypeFor)
	EVENT_TYPE_CABINAIR_RED              = 21
	EVENT_TYPE_ICINGCARB_YELLOW          = 22 // EMS rule ICINGCARB, main/icing.go probes
	EVENT_TYPE_ICINGCARB_RED             = 23
	EVENT_TYPE_ICINGAIRFRAME_YELLOW      = 24 // EMS rule ICINGAIRFRAME
	EVENT_TYPE_ICINGAIRFRAME_RED         = 25
	// The defined types when the mapping did not load: keep it one past the last constant
	EVENT_TYPE_COUNT = EVENT_TYPE_ICINGAIRFRAME_RED + 1
)

// Maximum events in the list
const EVENT_MAX_QUEUE = 100

// How far behind the last Id the clock may be and still be a burst, see newEventId()
const ALERT_ID_BURST_WINDOW = time.Minute

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

// Kinds of row in the flight log's alerts table, see logAlertEvent()
const (
	ALERT_LOG_RAISE  = "raise"  // a new alert, Active false for a one-shot event
	ALERT_LOG_REOPEN = "reopen" // a closed alert is active again, same AlertId
	ALERT_LOG_CLOSE  = "close"  // the condition went, TimestampEnd is its last sight
)

// One row of the flight log's alerts table. Alert cannot be logged as it is: its Id
// column would clash with the table's own id, as SQLite column names ignore case
type AlertDataLogger struct {
	Clock         time.Time // when the row was written, with the m=+ of the other tables
	Event         string    // ALERT_LOG_*
	AlertId       int
	Type          int
	Title         string
	Active        bool
	Timestamp     time.Time
	TimestampEnd  time.Time
	ActiveSeconds float64
}

/*
logAlertEvent().

	Writes an alert to the flight log: its raise and every change of Active. The moves of
	the end of an alert that stays active are not written, the close row carries the end.
	Call it without alertsDataMutex: a full log queue blocks
*/
func logAlertEvent(event string, a Alert) {
	logAlert(AlertDataLogger{
		Clock:         time.Now(),
		Event:         event,
		AlertId:       a.Id,
		Type:          a.Type,
		Title:         a.Title,
		Active:        a.Active,
		Timestamp:     a.Timestamp,
		TimestampEnd:  a.TimestampEnd,
		ActiveSeconds: a.ActiveSeconds,
	})
}

type AlertsStratuxPlugin struct {
	StratuxPlugin
	alertsData      []interface{}
	alertsDataMutex *sync.Mutex
	// The time the last Id was taken from, after newEventId() walked it
	lastIdTime time.Time
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
	} else if strings.HasPrefix(ident, "ems-") {
		// An EMS rule alert: the rule typed it (main/ems.go alertTypeFor)
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
	// The type can come from the network, see handleAlertPost(): RB-HLR-ALR-210
	if !alertTypeDefined(event.Type) {
		log.Printf("AlertsStratuxPlugin::pushEvent() undefined event type %d discarded", event.Type)
		return -1
	}
	// Queue the Alert
	alertsInstance.alertsDataMutex.Lock()
	event.Id = alertsInstance.newEventId(event.Timestamp)
	event.TimestampEnd = event.Timestamp
	alertsInstance.alertsData = append(alertsInstance.alertsData, event)
	// The list is in the order raised: past EVENT_MAX_QUEUE the oldest go, active or not
	// (RB-HLR-ALR-220). An update of a dropped alert finds nothing and returns -1
	if count := len(alertsInstance.alertsData); count > EVENT_MAX_QUEUE {
		copy(alertsInstance.alertsData, alertsInstance.alertsData[count-EVENT_MAX_QUEUE:])
		alertsInstance.alertsData = alertsInstance.alertsData[:EVENT_MAX_QUEUE]
	}
	alertsInstance.alertsDataMutex.Unlock()
	logAlertEvent(ALERT_LOG_RAISE, event)
	// Dispatch event on web interface, if any
	alertUpdate.SendJSON(event)
	notifyAlertsListChanged()
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
alertTypeDefined().

	A type is defined if the mapping has a row for it, so a new type needs only its row.
	Without a mapping alerts are still raised (RB-HLR-ALR-060), up to the last constant
*/
// alertTypeByName is the event type whose alertsMapping.json row has Id name, -1 for an
// empty name or one the mapping does not have (or no mapping loaded).
func alertTypeByName(name string) int {
	if name == "" {
		return -1
	}
	for i, row := range EventLanguages[ALERT_DEFAULT_LANGUAGE] {
		if row.Id == name {
			return i
		}
	}
	return -1
}

func alertTypeDefined(alertType int) bool {
	count := len(EventLanguages[ALERT_DEFAULT_LANGUAGE])
	if count == 0 {
		count = EVENT_TYPE_COUNT
	}
	return alertType >= 0 && alertType < count
}

/*
alerts.updateEvent().

	Copy Active on the alert with the Id of event and, while it is active, move its end to now
	/alerts is not told: every message on it is a new alert, with its sound and balloon.
	The display reads the state from /alerts/ws and decides by itself if to replay the alarm
	A change of Active is written to the flight log, see logAlertEvent()
*/
func (alertsInstance *AlertsStratuxPlugin) updateEvent(event Alert) int {
	alertsInstance.alertsDataMutex.Lock()
	id, logEvent, logged := alertsInstance.updateEventLocked(event)
	alertsInstance.alertsDataMutex.Unlock()
	if logEvent != "" {
		logAlertEvent(logEvent, logged)
	}
	return id
}

// updateEventLocked is updateEvent() with alertsDataMutex held. It returns the Id, and
// the flight log row to write once the mutex is released, "" for none
func (alertsInstance *AlertsStratuxPlugin) updateEventLocked(event Alert) (int, string, Alert) {
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
		// Inactive staying inactive changes nothing
		changed := event.Active || found.Active
		logEvent := ""
		if event.Active && !found.Active {
			logEvent = ALERT_LOG_REOPEN
		} else if !event.Active && found.Active {
			logEvent = ALERT_LOG_CLOSE
		}
		found.Active = event.Active
		alertsInstance.alertsData[i] = found
		if changed {
			notifyAlertsListChanged()
		}
		return found.Id, logEvent, found
	}
	return -1, "", Alert{}
}

/*
alerts.newEventId().

	The time as HHMMSScc, alone it separates the alerts of a flight which is less than 24 hours
	An Id already in the list takes the next free centisecond, or one alert could not be updated
	A burst walks the Ids ahead of the clock, so a new Id starts past the last one: starting
	from the clock, it could take the Id of an alert the list has dropped (RB-HLR-ALR-220),
	and a late update of that alert would change this one. The Id is then later than the
	raise time, which Timestamp keeps. A clock further behind than ALERT_ID_BURST_WINDOW
	has been stepped back, by the GPS or a new day in a test, and the Id follows it again:
	a dropped Id can come back only if both happen together
	Call it with alertsDataMutex held
*/
func (alertsInstance *AlertsStratuxPlugin) newEventId(t time.Time) int {
	if behind := alertsInstance.lastIdTime.Sub(t); behind >= 0 && behind < ALERT_ID_BURST_WINDOW {
		t = alertsInstance.lastIdTime.Add(10 * time.Millisecond)
	}
	for {
		id := t.Hour()*1000000 + t.Minute()*10000 + t.Second()*100 + t.Nanosecond()/10000000
		if !alertsInstance.hasEventId(id) {
			alertsInstance.lastIdTime = t
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