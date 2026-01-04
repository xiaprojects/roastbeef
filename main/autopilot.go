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

	Autopilot sentence
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
	Add CDI Indicator sentence for new Avionics integration
	$GPAPB,A,A,0.10,R,N,V,V,011,M,DEST,011,M,011,M*82
			Status V = LORAN-C Blink or SNR warning flag A = OK or not used
			Status V = Loran-C Cycle Lock warning flag A = OK or not used
			Cross Track Error Magnitude
			Direction to steer, L or R
			Cross Track Units, N = Nautical Miles
			Status A = Arrival Circle Entered
			Status A = Perpendicular passed at waypoint
			Bearing origin to destination
			M = Magnetic, T = True
			Destination Waypoint ID
			Bearing, present position to Destination
			M = Magnetic, T = True
			Heading to steer to destination waypoint
			M = Magnetic, T = True
*/

package main

import (
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/xiaprojects/roastbeef/common"
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

const (
	GPRMB_STATUS_OK         = "A"
	GPRMB_STATUS_WARNING    = "V"
	GPRMB_STEER_LEFT        = "L"
	GPRMB_STEER_RIGHT       = "R"
	GPRMB_ARRIVED_YES       = "A"
	GPRMB_ARRIVED_NOT_YET   = "V"
	GPRMB_STATUS_ACTIVE     = "A"
)

type GPRMBData struct {
	Status        string
	XTRKDistance  float64
	Steer         string
	WaypointStart string
	WaypointDest  string
	Lat           float32
	Lon           float32
	Distance      float64
	TrueBearing   float64
	Knots         float64
	Arrived       string
}

type AutopilotStatus struct {
	Active           bool
	To               Waypoint
	GPRMB            GPRMBData
	// TODO: Future feature, inject the start location for pre-calculation
	/*
	Lat              float32
	Lon              float32
	*/
}

type AutopilotStratuxPlugin struct {
	StratuxPlugin
	waypointsData      []Waypoint
	waypointsDataMutex *sync.Mutex
	requestToExit      bool
	status             AutopilotStatus
}

var autopilot = AutopilotStratuxPlugin{}

func (autopilotInstance *AutopilotStratuxPlugin) InitFunc() bool {
	log.Println("Entered AutopilotStratuxPlugin init() ...")
	autopilotInstance.Name = "Autopilot RS232 $GPRMB"
	autopilotInstance.waypointsDataMutex = &sync.Mutex{}
	autopilotInstance.requestToExit = false
	autopilotInstance.status.Active = false
	autopilotInstance.waypointsData = make([]Waypoint, 0)
	go autopilotInstance.autopilot()
	return true
}

func (autopilotInstance *AutopilotStratuxPlugin) autopilot() {
	for autopilotInstance.requestToExit == false {
		if globalSettings.Autopilot_Enabled == true {
			if autopilotInstance.status.Active == true {
				if isGPSValid() {
					// Work on a copy of the waypoints and wait for events
					autopilotInstance.waypointsDataMutex.Lock()
					var waypointsDataCopy = autopilotInstance.waypointsData
					autopilotInstance.waypointsDataMutex.Unlock()
					gprmb := autopilotInstance.autopilotRoutine(waypointsDataCopy)
					autopilotInstance.status.GPRMB = gprmb
					nmeaGPRMB := makeGPRMBString(gprmb)
					log.Print(nmeaGPRMB)
					// NMEA Serial output for $GPRMB Autopilot feature
					sendNetFLARM(nmeaGPRMB,time.Second, 0)

					// Added CDI
					nmeaGPAPB := makeGPAPBString(gprmb)
					log.Print(nmeaGPAPB)
					// NMEA Serial output for $GPRMB Autopilot feature
					sendNetFLARM(nmeaGPAPB,time.Second, 0)
				}
			}
			autopilotUpdate.SendJSON(autopilotInstance.status)
		}
		time.Sleep(1 * time.Second)
	}
}

func (autopilotInstance *AutopilotStratuxPlugin) autopilotEventAbeamPoint(waypointIndex int) {
	autopilotInstance.waypointsDataMutex.Lock()
	var waypoint = &autopilotInstance.waypointsData[waypointIndex]
	autopilotInstance.waypointsData[waypointIndex].Status = WAYPOINT_STATUS_PAST
	if(len(autopilotInstance.waypointsData)>waypointIndex+2){
		autopilotInstance.waypointsData[waypointIndex+1].Status = WAYPOINT_STATUS_TARGET
	}
	autopilotInstance.waypointsDataMutex.Unlock()
	// Emit Signal
	alerts.pushEvent(Alert{EVENT_TYPE_AUTOPILOT_ABEAM, fmt.Sprintf("Abeam: %s",waypoint.Cmt), time.Now()})
}

func (autopilotInstance *AutopilotStratuxPlugin) autopilotEventGoTo(waypointIndex int, bearing float64, distance float64) {
	autopilotInstance.waypointsDataMutex.Lock()
	autopilotInstance.waypointsData[waypointIndex].Status = WAYPOINT_STATUS_TARGET
	var waypoint = &autopilotInstance.waypointsData[waypointIndex]
	autopilotInstance.status.To = autopilotInstance.waypointsData[waypointIndex]
	autopilotInstance.waypointsDataMutex.Unlock()
	// Emit Signal
	alerts.pushEvent(Alert{EVENT_TYPE_AUTOPILOT_GOTO, fmt.Sprintf("To: %.0f° %.1fN %s", bearing, distance * 0.539957 / 1000.0, waypoint.Cmt), time.Now()})
}

func (autopilotInstance *AutopilotStratuxPlugin) autopilotRoutine(waypointsDataCopy []Waypoint) GPRMBData{
	// GPRMB by default in Warning and Arrived
	gprmb := GPRMBData{Status: GPRMB_STATUS_WARNING,XTRKDistance: 0,Steer: GPRMB_STEER_LEFT,WaypointStart: "Current",WaypointDest: "",Lat: 0,Lon: 0,Distance: 0,TrueBearing: 0,Knots: 0,Arrived: GPRMB_ARRIVED_YES}
	var nearestWaypointDistance float64
	var nearestWaypointBearing float64
	var nearestWaypointIndex int
	nearestWaypointIndex = -1
	nearestWaypointDistance = 999999
	nearestWaypointBearing = 0

	// Check if there is an existing Target
	for waypointIndex := range waypointsDataCopy {
		waypoint := &waypointsDataCopy[waypointIndex]
		if waypoint.Status == WAYPOINT_STATUS_PAST {
			continue
		}
		if waypoint.Status == WAYPOINT_STATUS_TARGET {

			var waypointDistance float64
			var waypointBearing float64
			lat := float64(mySituation.GPSLatitude)
			lng := float64(mySituation.GPSLongitude)
			//lat = float64(autopilotInstance.status.Lat)
			//lng = float64(autopilotInstance.status.Lon)
			waypointDistance, waypointBearing = common.Distance(float64(lat), float64(lng), float64(waypoint.Lat), float64(waypoint.Lon))
	
			nearestWaypointBearing = waypointBearing
			nearestWaypointDistance = waypointDistance
			nearestWaypointIndex = waypointIndex
		}
	}

	// There is no waypoint selected by the User, search for nearby
	if(nearestWaypointIndex==-1){
	for waypointIndex := range waypointsDataCopy {
		waypoint := &waypointsDataCopy[waypointIndex]
		//
		if waypoint.Status == WAYPOINT_STATUS_PAST {
			continue
		}
		var waypointDistance float64
		var waypointBearing float64
		lat := float64(mySituation.GPSLatitude)
		lng := float64(mySituation.GPSLongitude)

		//lat = float64(autopilotInstance.status.Lat)
		//lng = float64(autopilotInstance.status.Lon)

		waypointDistance, waypointBearing = common.Distance(float64(lat), float64(lng), float64(waypoint.Lat), float64(waypoint.Lon))

		// Check if we are abeam (500 meters)
		if waypointDistance < 500 {
			//waypoint.Status = WAYPOINT_STATUS_PAST
			//autopilotInstance.autopilotEventAbeamPoint(waypointIndex)
			continue
		}
		if waypointDistance < nearestWaypointDistance {
			// Found a nearest Waypoint to go
			nearestWaypointBearing = waypointBearing
			nearestWaypointDistance = waypointDistance
			nearestWaypointIndex = waypointIndex

			//waypoint.Status = WAYPOINT_STATUS_TARGET
			//autopilotInstance.autopilotEventGoTo(waypointIndex, nearestWaypointBearing, nearestWaypointDistance)
		}
	}
	}
	// Autopilot has a target
	if nearestWaypointIndex >= 0 {

		if(autopilotInstance.status.To.Lat != autopilotInstance.waypointsData[nearestWaypointIndex].Lat &&
			autopilotInstance.status.To.Lon != autopilotInstance.waypointsData[nearestWaypointIndex].Lon){
			autopilotInstance.autopilotEventGoTo(nearestWaypointIndex, nearestWaypointBearing, nearestWaypointDistance)
		}

		// Enable Autopilot Directions
		gprmb.Status = GPRMB_STATUS_OK
		gprmb.Arrived = GPRMB_STATUS_ACTIVE
		/*
		// TODO: escape, GPRMB Support for Waypoints string naming
		if nearestWaypointIndex > 0 {
			gprmb.WaypointStart = autopilotInstance.waypointsData[nearestWaypointIndex-1].Cmt
		}
		gprmb.WaypointDest = autopilotInstance.waypointsData[nearestWaypointIndex].Cmt
		*/
		gprmb.WaypointDest = fmt.Sprintf("%03d",nearestWaypointIndex+1)
		gprmb.WaypointStart = fmt.Sprintf("%03d",nearestWaypointIndex)
		gprmb.Lat = autopilotInstance.waypointsData[nearestWaypointIndex].Lat
		gprmb.Lon = autopilotInstance.waypointsData[nearestWaypointIndex].Lon
		gprmb.Distance = nearestWaypointDistance * 0.539957 / 1000.0
		gprmb.Knots = mySituation.GPSGroundSpeed * 0.539957
		gprmb.TrueBearing = nearestWaypointBearing
		gprmb.XTRKDistance = gprmb.Distance * math.Tan(common.Radians(nearestWaypointBearing-float64(mySituation.GPSTrueCourse)));

		if(gprmb.XTRKDistance<0){
			gprmb.Steer = GPRMB_STEER_LEFT
			gprmb.XTRKDistance = -gprmb.XTRKDistance
		} else {
			gprmb.Steer = GPRMB_STEER_RIGHT
		}

		if(nearestWaypointDistance<500){
			autopilotInstance.autopilotEventAbeamPoint(nearestWaypointIndex)
		}


		/*
		if nearestWaypointBearing > 5+float64(mySituation.GPSTrueCourse) {
			
		}
		if nearestWaypointBearing < float64(mySituation.GPSTrueCourse)-5 {
			
		}
		*/
	}
	return gprmb
}

func (autopilotInstance *AutopilotStratuxPlugin) stop() bool {
	log.Println("Entered AutopilotStratuxPlugin stop() ...")
	autopilotInstance.waypointsDataMutex.Lock()
	autopilotInstance.status.Active = false
	autopilotInstance.waypointsDataMutex.Unlock()
	return autopilotInstance.status.Active
}

func (autopilotInstance *AutopilotStratuxPlugin) start() bool {
	log.Println("Entered AutopilotStratuxPlugin start() ...")
	autopilotInstance.waypointsDataMutex.Lock()
	if len(autopilotInstance.waypointsData) > 0 {
		autopilotInstance.status.Active = true
	}
	autopilotInstance.waypointsDataMutex.Unlock()
	return autopilotInstance.status.Active
}

func (autopilotInstance *AutopilotStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered AutopilotStratuxPlugin shutdown() ...")
	autopilotInstance.requestToExit = true
	return true
}


/*
	NMEA Sentence Generator
	$GPRMB - Recommended minimum navigation info
	Navigation information (Used by Autopilot)
*/
func makeGPRMBString(data GPRMBData) string {

	// Conversion from float to degree
	lat := float64(data.Lat)
	ns := "N"
	if lat < 0 {
		lat = -lat
		ns = "S"
	}

	deg := math.Floor(lat)
	min := (lat - deg) * 60
	lat = deg*100 + min

	ew := "E"
	lng := float64(data.Lon)
	if lng < 0 {
		lng = -lng
		ew = "W"
	}

	deg = math.Floor(lng)
	min = (lng - deg) * 60
	lng = deg*100 + min

	XTRKDistance := data.XTRKDistance
	if(XTRKDistance>9.99){
		XTRKDistance=9.99
	}

	// Format Message GPRMB Recommended minimum navigation info
	msg := fmt.Sprintf("$GPRMB,%s,%.2f,%s,%s,%s,%.2f,%s,%.2f,%s,%.1f,%.1f,%.1f,%s",
	data.Status,
	XTRKDistance,
	data.Steer,
	data.WaypointStart,
	data.WaypointDest,
	lat,
	ns,
	lng,
	ew,
	data.Distance,
	data.TrueBearing,
	data.Knots,
	data.Arrived)
	msg = appendNmeaChecksum(msg)
	msg += "\r\n"
	return msg
}

/*
	NMEA Sentence Generator
	$GPAPB - Autopilot Sentence "B"
	CDI Information  (Used by Autopilot)
*/
func makeGPAPBString(data GPRMBData) string {
	XTRKDistance := data.XTRKDistance
	if(XTRKDistance>9.99){
		XTRKDistance=9.99
	}

	// Format Message GPRMB Recommended minimum navigation info
	msg := fmt.Sprintf("$GPAPB,A,A,%.2f,%s,N,V,V,%03.0f,M,%s,%03.0f,M,%03.0f",
	XTRKDistance,
	data.Steer,
	data.TrueBearing,
	data.WaypointDest,
	data.TrueBearing,
	data.TrueBearing)
	msg = appendNmeaChecksum(msg)
	msg += "\r\n"
	return msg
}