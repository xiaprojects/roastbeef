/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	autopilot.go: Autopilot interface
	Features:
	- Import/Export GPX
	- Tracking
	- Autopilot using $GPRMB
	- Glide 3%
	Roadmap:
	- Favourites plan
	- Storage of file Plan
	- Pre-loaded Airfields with search
	- Fuel calculation
	- GoTo Home

	$GPRMB,A,4.32,L,FROM,TO,5109.7578000,N,11409.0960000,W,4.6,279.2,0.0,V,D*4A
	eg1. $GPRMB,A,0.66,L,003,004,4917.24,N,12309.57,W,001.3,052.5,000.5,V*0B
	          A            Data status A = OK, V = warning
	          0.66,L       Cross-track error (nautical miles, 9.9 max.),
	                               steer Left to correct (or R = right)
	          003          Origin waypoint ID
	          004          Destination waypoint ID
	          4917.24,N    Destination waypoint latitude 49 deg. 17.24 min. N
	          12309.57,W   Destination waypoint longitude 123 deg. 09.57 min. W
	          001.3        Range to destination, nautical miles
	          052.5        True bearing to destination
	          000.5        Velocity towards destination, knots
	          V            Arrival alarm  A = arrived, V = not arrived
	          *0B          mandatory checksum
*/

package main

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/b3nn0/stratux/common"
)

const (
	WAYPOINT_STATUS_PATH   = 0 // On the way
	WAYPOINT_STATUS_TARGET = 1 // Next target
	WAYPOINT_STATUS_PAST   = 2 // Past
)

type Waypoint struct {
	Lat    float32 // decimal common.Degrees, north positive
	Lon    float32 // decimal common.Degrees, east positive
	Ele    int32   // Pressure altitude, feet
	Status int32   // Target on sight
	Cmt    string  // GPX comment
}

type AutopilotStratuxPlugin struct {
	StratuxPlugin
	waypointsData      []Waypoint
	waypointsDataMutex *sync.Mutex
	requestToExit      bool
	isActive           bool
}

var autopilot = AutopilotStratuxPlugin{}

func (autopilotInstance *AutopilotStratuxPlugin) InitFunc() bool {
	log.Println("Entered AutopilotStratuxPlugin init() ...")
	autopilotInstance.Name = "Autopilot RS232 $GPRMB"
	autopilotInstance.waypointsDataMutex = &sync.Mutex{}
	autopilotInstance.requestToExit = false
	autopilotInstance.isActive = false
	autopilotInstance.waypointsData = make([]Waypoint, 0)
	go autopilotInstance.autopilot()
	return true
}

func (autopilotInstance *AutopilotStratuxPlugin) autopilot() {
	for autopilotInstance.requestToExit == false {
		if globalSettings.Autopilot_Enabled == true {
			if autopilotInstance.isActive == true {
				if isGPSValid() {
					// Work on a copy of the waypoints and wait for events
					autopilotInstance.waypointsDataMutex.Lock()
					var waypointsDataCopy = autopilotInstance.waypointsData
					autopilotInstance.waypointsDataMutex.Unlock()
					autopilotInstance.autopilotRoutine(waypointsDataCopy)
				}
			}
		}
		time.Sleep(1 * time.Second)
	}
}

func (autopilotInstance *AutopilotStratuxPlugin) autopilotEventAbeamPoint(waypointIndex int) {
	autopilotInstance.waypointsDataMutex.Lock()
	autopilotInstance.waypointsData[waypointIndex].Status = WAYPOINT_STATUS_PAST
	autopilotInstance.waypointsDataMutex.Unlock()
	// Emit Signal
	alerts.pushEvent(Alert{EVENT_TYPE_AUTOPILOT_ABEAM, "Waypoint abeam", time.Now()})
}

func (autopilotInstance *AutopilotStratuxPlugin) autopilotEventGoTo(waypointIndex int, bearing float64, distance float64) {
	autopilotInstance.waypointsDataMutex.Lock()
	autopilotInstance.waypointsData[waypointIndex].Status = WAYPOINT_STATUS_TARGET
	var waypoint = &autopilotInstance.waypointsData[waypointIndex]
	autopilotInstance.waypointsDataMutex.Unlock()
	// Emit Signal
	alerts.pushEvent(Alert{EVENT_TYPE_AUTOPILOT_GOTO, fmt.Sprintf("GoTo: %.0f %.0f %s", bearing, distance, waypoint.Cmt), time.Now()})
}

func (autopilotInstance *AutopilotStratuxPlugin) autopilotRoutine(waypointsDataCopy []Waypoint) {
	var nearestWaypointDistance float64
	var nearestWaypointBearing float64
	var nearestWaypointIndex int
	nearestWaypointIndex = -1
	nearestWaypointDistance = 999999
	nearestWaypointBearing = 0
	for waypointIndex := range waypointsDataCopy {
		waypoint := &waypointsDataCopy[waypointIndex]
		if waypoint.Status == WAYPOINT_STATUS_PAST {
			continue
		}
		var waypointDistance float64
		var waypointBearing float64
		lat := float64(mySituation.GPSLatitude)
		lng := float64(mySituation.GPSLongitude)
		waypointDistance, waypointBearing = common.Distance(float64(lat), float64(lng), float64(waypoint.Lat), float64(waypoint.Lon))

		// Check if we are abeam (500 meters)
		if waypointDistance < 500 {
			//waypoint.Status = WAYPOINT_STATUS_PAST
			autopilotInstance.autopilotEventAbeamPoint(waypointIndex)
			continue
		}
		if waypointDistance < nearestWaypointDistance {
			// Found a nearest Waypoint to go
			nearestWaypointBearing = waypointBearing
			nearestWaypointDistance = waypointDistance
			nearestWaypointIndex = waypointIndex

			//waypoint.Status = WAYPOINT_STATUS_TARGET
			autopilotInstance.autopilotEventGoTo(waypointIndex, nearestWaypointBearing, nearestWaypointDistance)
		}
	}

	// Autopilot has a target
	if nearestWaypointIndex >= 0 {
		if nearestWaypointBearing > 5+float64(mySituation.GPSTrueCourse) {
			log.Println("Autpilot Turn Left")
		}
		if nearestWaypointBearing < float64(mySituation.GPSTrueCourse)-5 {
			log.Println("Autpilot Turn Right")
		}
	}
	return
}

func (autopilotInstance *AutopilotStratuxPlugin) stop() bool {
	log.Println("Entered AutopilotStratuxPlugin stop() ...")
	autopilotInstance.waypointsDataMutex.Lock()
	autopilotInstance.isActive = false
	autopilotInstance.waypointsDataMutex.Unlock()
	return autopilotInstance.isActive
}

func (autopilotInstance *AutopilotStratuxPlugin) start() bool {
	log.Println("Entered AutopilotStratuxPlugin start() ...")
	autopilotInstance.waypointsDataMutex.Lock()
	if len(autopilotInstance.waypointsData) > 0 {
		autopilotInstance.isActive = true
	}
	autopilotInstance.waypointsDataMutex.Unlock()
	return autopilotInstance.isActive
}

func (autopilotInstance *AutopilotStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered AutopilotStratuxPlugin shutdown() ...")
	autopilotInstance.requestToExit = true
	return true
}
