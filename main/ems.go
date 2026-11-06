/*
	This file is part of RB.

	Copyright (C) 2023 XIAPROJECTS SRL

	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, version 3.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
	GNU Affero General Public License for more details.

	You should have received a copy of the GNU Affero General Public License
	along with this program. If not, see <https://www.gnu.org/licenses/>.

	This source is part of the project RB:
	01 -> Display with Synthetic vision, Autopilot and ADSB
	02 -> Display with SixPack
	03 -> Display with Autopilot, ADSB, Radio, Flight Computer
	04 -> Display with EMS: Engine monitoring system
	05 -> Display with Stratux BLE Traffic
	06 -> Display with Android 6.25" 7" 8" 10" 10.2"

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community

	ems.go: Engine Management System Interface
*/

package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"math"
	"strings"
	"sync"
	"time"
)

type EMSStratuxPlugin struct {
	StratuxPlugin
	emsData map[string]float32
	// Added Max
	emsDataMax       map[string]float32
	emsDataMin       map[string]float32
	emsDataMutex     *sync.Mutex
	emsIsSendingData bool
	// Engine rules, shared with rbvoice
	rules      []EMSRule
	ruleColors map[string]string
	// Last alert time per rule and color, to not repeat the same alert within EMS_RULE_ALERT_INTERVAL
	ruleAlertTimes map[string]time.Time
	// Id of the latest alert per rule and color, to update it while the rule stays in that color
	ruleAlertIds map[string]int
	// Last EMS frame received, and the alert raised when the frames stop with a rule in alarm
	lastFrame   time.Time
	feedLost    bool
	feedAlertId int
}

const EMS_RULES_JSON_NAME = "rbvoice-aircraft-rules.json"
const EMS_RULE_ALERT_INTERVAL = 5 * time.Minute
const EMS_FEED_TIMEOUT = 5 * time.Second

// Engine Rules definition, same file used by rbvoice
type EMSRuleColor struct {
	Color string  `json:"color"`
	Min   float32 `json:"min"`
	Max   float32 `json:"max"`
}

type EMSRule struct {
	Name       string         `json:"name"`
	Algorithm  string         `json:"algorithm"`
	ProbeNames []string       `json:"probeNames"`
	Colors     []EMSRuleColor `json:"colors"`
}

type EMSRules struct {
	Rules []EMSRule `json:"rules"`
}

// Data Logger
type EMSDataLogger struct {
	Clock       time.Time
	SensorName  string
	SensorValue float32
}

var ems = EMSStratuxPlugin{}

func (emsInstance *EMSStratuxPlugin) InitFunc() bool {
	log.Println("Entered EMS init() ...")
	emsInstance.Name = "Unix Socket"
	log.Println("EMS Driver: ", emsInstance.Name)
	emsInstance.emsDataMutex = &sync.Mutex{}
	emsInstance.emsData = make(map[string]float32)
	emsInstance.emsDataMin = make(map[string]float32)
	emsInstance.emsDataMax = make(map[string]float32)

	// Pre-fill with default values
	defaultEMSSensors := []string{"Egt1", "Egt2", "Egt3", "Egt4", "Cht1", "Cht2", "Cht3", "Cht4", "Fuel1", "Fuel2", "Fuel", "Oilpressure", "Oiltemperature", "BatteryVoltage", "AlternatorOut", "ManifoldPressure", "EngineRpm", "Fuelpressure", "Amps", "Fuelremaining", "OutsideTemperature"}
	for _, key := range defaultEMSSensors {
		emsInstance.emsData[strings.ToLower(key)] = 0
	}
	emsInstance.emsData["coolanttemperature"] = 0.0
	emsInstance.ruleColors = make(map[string]string)
	emsInstance.ruleAlertTimes = make(map[string]time.Time)
	emsInstance.ruleAlertIds = make(map[string]int)
	emsInstance.loadRules(STRATUX_WWW_DIR + "settings/" + EMS_RULES_JSON_NAME)
	emsInstance.emsIsSendingData = true
	go emsInstance.ListenerFunc()
	return true
}

func (emsInstance *EMSStratuxPlugin) makeRBEMSString() string {
	msg := fmt.Sprintf("$RBEMS,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f",
		emsInstance.emsData["enginerpm"],
		emsInstance.emsData["manifoldpressure"],
		emsInstance.emsData["oiltemperature"],
		emsInstance.emsData["oilpressure"],
		emsInstance.emsData["coolanttemperature"],
		emsInstance.emsData["outsidetemperature"],
		emsInstance.emsData["fuelpressure"],
		emsInstance.emsData["fuel1"],
		emsInstance.emsData["fuel2"])
	msg = appendNmeaChecksum(msg)
	msg += "\r\n"
	return msg
}

func (emsInstance *EMSStratuxPlugin) makeRBCYLString() string {
	msg := fmt.Sprintf("$RBCYL,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f",
		emsInstance.emsData["cht1"],
		emsInstance.emsData["cht2"],
		emsInstance.emsData["cht3"],
		emsInstance.emsData["cht4"],
		emsInstance.emsData["egt1"],
		emsInstance.emsData["egt2"],
		emsInstance.emsData["egt3"],
		emsInstance.emsData["egt4"])
	msg = appendNmeaChecksum(msg)
	msg += "\r\n"
	return msg
}

func (emsInstance *EMSStratuxPlugin) ListenerFunc() bool {
	time.Sleep(1 * time.Second)
	timerForTemperatures := 10
	for emsInstance.emsIsSendingData == true {
		emsInstance.emsDataMutex.Lock()
		nmeaRBEMS := emsInstance.makeRBEMSString()
		nmeaRBCYL := emsInstance.makeRBCYLString()
		emsInstance.emsDataMutex.Unlock()
		sendNetFLARM(nmeaRBEMS, time.Second, 0)
		if timerForTemperatures < 1 {
			sendNetFLARM(nmeaRBCYL, time.Second, 0)
			timerForTemperatures = 10
		}
		timerForTemperatures = timerForTemperatures - 1
		emsInstance.checkFeed()
		time.Sleep(200 * time.Millisecond)
	}
	return true
}

func (emsInstance *EMSStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered EMS shutdown() ...")
	return true
}

// loadRules reads the engine rules definition. A missing or invalid file disables the rules.
func (emsInstance *EMSStratuxPlugin) loadRules(path string) bool {
	raw, err := ioutil.ReadFile(path)
	if err != nil {
		log.Printf("EMS rules not loaded: %s\n", err.Error())
		return false
	}
	var parsed EMSRules
	if err := json.Unmarshal(raw, &parsed); err != nil {
		log.Printf("EMS rules not valid: %s\n", err.Error())
		return false
	}
	emsInstance.rules = parsed.Rules
	return true
}

// ruleValue applies the rule algorithm to the probes available in data.
// ok is false when none of the probes has been received.
func ruleValue(rule EMSRule, data map[string]float32) (value float32, ok bool) {
	var values []float32
	for _, probe := range rule.ProbeNames {
		if v, found := data[probe]; found {
			values = append(values, v)
		}
	}
	if len(values) == 0 {
		return 0, false
	}
	var sum float32
	minimum, maximum := values[0], values[0]
	for _, v := range values {
		sum += v
		minimum = float32(math.Min(float64(minimum), float64(v)))
		maximum = float32(math.Max(float64(maximum), float64(v)))
	}
	average := sum / float32(len(values))
	switch rule.Algorithm {
	case "average":
		return average, true
	case "max":
		return maximum, true
	case "min":
		return minimum, true
	case "averageDiff":
		// Largest deviation of a probe from the average
		return float32(math.Max(float64(maximum-average), float64(average-minimum))), true
	}
	return 0, false
}

// ruleColor returns the band containing value, or "" when no band matches.
// Bands overlap on their bounds, so the most severe one wins.
func ruleColor(rule EMSRule, value float32) string {
	for _, color := range []string{"red", "yellow", "green"} {
		for _, band := range rule.Colors {
			if band.Color == color && value >= band.Min && value <= band.Max {
				return color
			}
		}
	}
	return ""
}

// validateRules evaluates every engine rule against the current EMS data, on every EMS frame.
// A rule entering yellow or red raises an alert, and while it stays in that color the alert is
// updated, which moves its end. Leaving the color closes the alert, and green raises nothing.
// A value outside every band neither confirms nor clears.
// The same alert is not raised again within EMS_RULE_ALERT_INTERVAL: it is reopened with the same
// Id, nothing is sent to the display and the display decides if to replay the alarm from Active.
// It takes emsDataMutex itself, do not call it with the mutex held. The alerts are pushed with the
// mutex held, so that an Id is stored before the next frame reads it. alerts never takes it.
func (emsInstance *EMSStratuxPlugin) validateRules() {
	emsInstance.emsDataMutex.Lock()
	defer emsInstance.emsDataMutex.Unlock()
	emsInstance.lastFrame = time.Now()
	for _, rule := range emsInstance.rules {
		value, ok := ruleValue(rule, emsInstance.emsData)
		if !ok {
			continue
		}
		color := ruleColor(rule, value)
		if color == "" {
			continue
		}
		old := emsInstance.ruleColors[rule.Name]
		emsInstance.ruleColors[rule.Name] = color
		// The old color first: a rule never shows two active alerts
		if color != old && (old == "yellow" || old == "red") {
			alerts.pushEvent(Alert{Id: emsInstance.ruleAlertIds["ems-"+rule.Name+"-"+old], Active: false})
		}
		if color == "green" {
			continue
		}
		ident := "ems-" + rule.Name + "-" + color
		if color != old && time.Since(emsInstance.ruleAlertTimes[ident]) >= EMS_RULE_ALERT_INTERVAL {
			emsInstance.ruleAlertTimes[ident] = time.Now()
			emsInstance.ruleAlertIds[ident] = alerts.pushEventByIdent(ident, Alert{Type: EVENT_TYPE_EMS_RULE_YELLOW, Title: fmt.Sprintf("%s %s %.0f", rule.Name, color, value), Timestamp: time.Now(), Active: true})
		} else {
			alerts.pushEvent(Alert{Id: emsInstance.ruleAlertIds[ident], Active: true})
		}
	}
}

// checkFeed raises one alert when the EMS frames stop with a rule in alarm, and closes it when they
// return. Silence does not clear an alarm: it stays active with its end at the last frame, and this
// alert is how the pilot tells that from an alarm that has gone.
// It stays quiet before the first frame, so an aircraft without EMS never sees it.
func (emsInstance *EMSStratuxPlugin) checkFeed() {
	emsInstance.emsDataMutex.Lock()
	defer emsInstance.emsDataMutex.Unlock()
	silent := !emsInstance.lastFrame.IsZero() && time.Since(emsInstance.lastFrame) >= EMS_FEED_TIMEOUT
	if silent && emsInstance.feedLost {
		alerts.pushEvent(Alert{Id: emsInstance.feedAlertId, Active: true})
	} else if silent && emsInstance.ruleInAlarm() {
		emsInstance.feedLost = true
		emsInstance.feedAlertId = alerts.pushEventByIdent("ems-feed", Alert{Title: "EMS data lost", Timestamp: time.Now(), Active: true})
	} else if !silent && emsInstance.feedLost {
		emsInstance.feedLost = false
		alerts.pushEvent(Alert{Id: emsInstance.feedAlertId, Active: false})
	}
}

// ruleInAlarm tells if any rule is yellow or red. Call it with emsDataMutex held.
func (emsInstance *EMSStratuxPlugin) ruleInAlarm() bool {
	for _, color := range emsInstance.ruleColors {
		if color == "yellow" || color == "red" {
			return true
		}
	}
	return false
}
