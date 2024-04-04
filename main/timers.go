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

	Roadmap:
	- Save/Restore Timers on memory or configuration
	- Timers naming, like "Left Fuel"
	- Mark the GPS Position when a timer is fired
*/

package main

import (
	"fmt"
	"log"
	"sync"
	"time"
)

const (
	TIMER_STATUS_STOPPED = 0
	TIMER_STATUS_RUNNING = 1
)

type SingleTimer struct {
	Epoch int64
	CountDown int64
	Status bool
	Fired bool
}

type TimersStratuxPlugin struct {
    StratuxPlugin
	timerEnabled bool
	timersData []SingleTimer
	timersDataMutex *sync.Mutex
}
// Shared instance
var timers = TimersStratuxPlugin{}

/*
plugin.InitFunc().

	initialise the mutex and local variables
	load default configuration
	start thread in background, if any
*/
func (timersInstance *TimersStratuxPlugin)InitFunc() bool {
	log.Println("Entered TimersStratuxPlugin init() ...")
	timersInstance.Name = "Timers"
	timersInstance.timerEnabled = true
	timersInstance.timersDataMutex = &sync.Mutex{}
	timersInstance.timersData = make([]SingleTimer, 0)
	// Default Timers 2x
	timersInstance.timersData = append(timersInstance.timersData, SingleTimer{0,20*60,false,false})
	timersInstance.timersData = append(timersInstance.timersData, SingleTimer{0,20*60,false,false})
	timersInstance.timersData = append(timersInstance.timersData, SingleTimer{0,0,false,false})
	timersInstance.timersData = append(timersInstance.timersData, SingleTimer{0,0,false,false})
	// Background thread
	go timersInstance.ListenerFunc()
	return true
}

func (timersInstance *TimersStratuxPlugin)ListenerFunc() bool {
	for timersInstance.timerEnabled == true	{
		for t := range timersInstance.timersData {
			thisTimer := &timersInstance.timersData[t]
			if(thisTimer.Status == true){
				reconfigureAlerts := false
				timersInstance.timersDataMutex.Lock()
				if(thisTimer.CountDown > 0){
					Seconds:= thisTimer.Epoch+thisTimer.CountDown-time.Now().Unix()
					if(Seconds < 0 && thisTimer.Fired == false){
						// To be sure user is aware, the Timer shall be disabled by the user using the interface
						//thisTimer.Status = false 
						thisTimer.Fired = true
						// Assume Alerts are enabled by default
						//if(globalSettings.Alerts_Enabled == true){
							reconfigureAlerts = true
						//}
					}
				} else {
				}
				timersInstance.timersDataMutex.Unlock()
				// Out of mutex warn user
				if(reconfigureAlerts == true){
					alerts.pushEvent(Alert{EVENT_TYPE_TIMER,fmt.Sprintf("Timer %d fired",t),time.Now()})				
				}
			}
		}
		time.Sleep(1 * time.Second)
	}
	return true
}

/*
plugin.ShutdownFunc().

	set halt variable status to allow thread gracefully exit, if any
*/
func (timersInstance *TimersStratuxPlugin)ShutdownFunc() bool {
	log.Println("Entered TimersStratuxPlugin shutdown() ...")
	timersInstance.timerEnabled = false
	return true
}
