/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	timers.go: Timers interface
	Release 1 Features:
	- Timers Count down and Chrono are supported
	- User can add/remove/start/stop Timers
	- Timer fires in both interfaces: in RPI and in Frontend
	- Alarms integration for audio and history
	- /timers/ws pushes the whole list on connect and on every change, no polling

	Roadmap:
	- Save/Restore Timers on memory or configuration
	- Timers naming, like "Left Fuel"
	- Mark the GPS Position when a timer is fired
*/

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"golang.org/x/net/websocket"
)

const (
	TIMER_STATUS_STOPPED = 0
	TIMER_STATUS_RUNNING = 1
)

type SingleTimer struct {
	Epoch     int64
	CountDown int64
	Status    bool
	Fired     bool
}

type TimersStratuxPlugin struct {
	StratuxPlugin
	timerEnabled    bool
	timersData      []SingleTimer
	timersDataMutex *sync.Mutex
}

// Shared instance
var timers = TimersStratuxPlugin{}

/*
Timers list WS - /timers/ws

	The whole list as GET /timers answers it: once on connect, then on every change
	(a timer created, deleted, started, stopped, changed, or a countdown firing).
	The display counts the seconds itself from Epoch and CountDown: nothing is sent
	while the timers only run
*/
var timersListUpdate *uibroadcaster

// One pending change wakes timersListSender, more changes meanwhile are one message
var timersListChanged = make(chan struct{}, 1)

/*
notifyTimersChanged().

	Called after every change of timersData, never blocks
*/
func notifyTimersChanged() {
	select {
	case timersListChanged <- struct{}{}:
	default:
	}
}

// The list as JSON, nil if it does not marshal
func timersListJSON() []byte {
	timers.timersDataMutex.Lock()
	defer timers.timersDataMutex.Unlock()
	statusJSON, err := json.Marshal(&timers.timersData)
	if err != nil {
		log.Printf("timers list: %s", err)
		return nil
	}
	return statusJSON
}

func timersListSender() {
	for range timersListChanged {
		if statusJSON := timersListJSON(); statusJSON != nil {
			timersListUpdate.Send(statusJSON)
		}
	}
}

func handleTimersWS(conn *websocket.Conn) {
	// Added first: a change between the two is sent twice rather than lost
	timersListUpdate.AddSocket(conn)
	if statusJSON := timersListJSON(); statusJSON != nil {
		conn.Write(statusJSON)
	}
	waitSocketClosed(conn)
}

/*
plugin.InitFunc().

	initialise the mutex and local variables
	load default configuration
	start thread in background, if any
*/
func (timersInstance *TimersStratuxPlugin) InitFunc() bool {
	log.Println("Entered TimersStratuxPlugin init() ...")
	timersInstance.Name = "Timers"
	timersInstance.timerEnabled = true
	timersInstance.timersDataMutex = &sync.Mutex{}
	timersInstance.timersData = make([]SingleTimer, 0)
	// Default Timers 2x
	timersInstance.timersData = append(timersInstance.timersData, SingleTimer{0, 20 * 60, false, false})
	timersInstance.timersData = append(timersInstance.timersData, SingleTimer{0, 20 * 60, false, false})
	timersInstance.timersData = append(timersInstance.timersData, SingleTimer{0, 0, false, false})
	timersInstance.timersData = append(timersInstance.timersData, SingleTimer{0, 0, false, false})
	// Background thread
	go timersInstance.ListenerFunc()
	return true
}

/*
fireDue().

	Marks Fired on every running countdown past its end, once.
	Returns the index of each timer it fired
*/
func (timersInstance *TimersStratuxPlugin) fireDue(now int64) []int {
	fired := make([]int, 0)
	timersInstance.timersDataMutex.Lock()
	defer timersInstance.timersDataMutex.Unlock()
	for t := range timersInstance.timersData {
		thisTimer := &timersInstance.timersData[t]
		if thisTimer.Status && thisTimer.CountDown > 0 && !thisTimer.Fired &&
			thisTimer.Epoch+thisTimer.CountDown-now < 0 {
			// To be sure user is aware, the Timer shall be disabled by the user using the interface
			thisTimer.Fired = true
			fired = append(fired, t)
		}
	}
	return fired
}

func (timersInstance *TimersStratuxPlugin) ListenerFunc() bool {
	for timersInstance.timerEnabled == true {
		fired := timersInstance.fireDue(time.Now().Unix())
		if len(fired) > 0 {
			notifyTimersChanged()
		}
		// Out of mutex warn user
		for _, t := range fired {
			alerts.pushEvent(Alert{Type: EVENT_TYPE_TIMER, Title: fmt.Sprintf("Timer %d fired", t), Timestamp: time.Now()})
		}
		time.Sleep(1 * time.Second)
	}
	return true
}

/*
plugin.ShutdownFunc().

	set halt variable status to allow thread gracefully exit, if any
*/
func (timersInstance *TimersStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered TimersStratuxPlugin shutdown() ...")
	timersInstance.timerEnabled = false
	return true
}
