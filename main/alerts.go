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
	"sync"
	"time"
)

// Resources
const ALERT_MAPPING_JSON_NAME = "alertsMapping.json"
const ALERT_DEFAULT_LANGUAGE = "en-US"

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
	Type      int
	Title     string
	Timestamp time.Time
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
	alertsMapping := STRATUX_WWW_DIR + "resources/" + ALERT_MAPPING_JSON_NAME
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
	alertsInstance.pushEvent(Alert{EVENT_TYPE_STARTUP_INFO, "Startup", time.Now()})
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
*/
func (alertsInstance *AlertsStratuxPlugin) pushEventByIdent(ident string, event Alert) bool {
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
	} else {
		// Fallback to system danger
		event.Type = EVENT_TYPE_SYSTEM_DANGER
	}
	return alertsInstance.pushEvent(event)
}

/*
alerts.pushEvent().

	wide generic event api to pipe info,warning,danger
*/
func (alertsInstance *AlertsStratuxPlugin) pushEvent(event Alert) bool {
	// incoming data without right InitFunc timing
	if alertsInstance.alertsData == nil {
		log.Println("Entered AlertsStratuxPlugin::pushEvent() too early")
		// Event discarded
		return false
	}
	// Dispatch event on web interface, if any
	alertUpdate.SendJSON(event)
	// Queue the Alert
	alertsInstance.alertsDataMutex.Lock()
	alertsInstance.alertsData = append(alertsInstance.alertsData, event)
	// Check for Maximum queue up to EVENT_MAX_QUEUE
	// TODO: Remove first element
	alertsInstance.alertsDataMutex.Unlock()
	// Play audio locally on RPI, if enabled
	if globalSettings.Audio_Enabled == true {
		if len(EventLanguages[ALERT_DEFAULT_LANGUAGE]) > event.Type {
			item := EventLanguages[ALERT_DEFAULT_LANGUAGE][event.Type]
			sound := item.Sound
			if len(sound) > 0 {
				// TODO: Migrate from Wav to Mp3
				soundPath := STRATUX_WWW_DIR + "sounds/" + sound + ".wav"
				// TODO: Let's customisable the player command line
				// TODO: Queue sounds in case of multiple events
				cmd := exec.Command("/usr/bin/aplay", soundPath)
				go cmd.Start()
			}
		}
	}
	// Event pushed
	return true
}
