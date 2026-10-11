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

const (
	// Radius within which the waypoint counts as reached. The same figure
	// sequences the leg below, so the arrival flag the panel sees and the leg
	// change it makes happen together.
	AUTOPILOT_ARRIVAL_RADIUS_METERS = 500.0
	// Largest cross-track an NMEA receiver will take: the field tops out at
	// 9.9 NM, beyond which the needle is simply pegged.
	AUTOPILOT_XTRK_MAX_NM = 9.99
	METERS_TO_NM          = 0.000539956803
	EARTH_RADIUS_METERS   = 6371008.8 // mean radius, as common.Distance uses
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
	// Course of the leg itself, origin to destination, degrees true. The CDI
	// needs this: TrueBearing points at the waypoint from wherever the
	// aircraft happens to be, which is a different angle as soon as it is off
	// track, and steering to that alone never regains the course line.
	LegCourse float64
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
	// Where the aircraft was when the current leg became active. A leg needs
	// two ends to have a course line, and the first waypoint of a plan has no
	// predecessor, so on a direct-to this stands in as the origin.
	legOriginLat   float64
	legOriginLon   float64
	legOriginValid bool
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
	time.Sleep(1 * time.Second)
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

					// The leg course, so the receiver can set its course
					// pointer from the line instead of from the bearing to
					// the waypoint.
					nmeaGPBOD := makeGPBODString(gprmb)
					log.Print(nmeaGPBOD)
					sendNetFLARM(nmeaGPBOD,time.Second, 0)

					// The deviation on its own, for receivers that take it
					// only from $GPXTE.
					nmeaGPXTE := makeGPXTEString(gprmb)
					log.Print(nmeaGPXTE)
					sendNetFLARM(nmeaGPXTE,time.Second, 0)
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
	// A new leg: the direct-to origin is wherever the aircraft is now, and is
	// captured on the next pass rather than here so it uses the same fix the
	// cross-track is computed from.
	autopilotInstance.legOriginValid = false
	// Emit Signal
	alerts.pushEvent(Alert{EVENT_TYPE_AUTOPILOT_GOTO, fmt.Sprintf("To: %.0f° %.1fN %s", bearing, distance * 0.539957 / 1000.0, waypoint.Cmt), time.Now()})
}

func (autopilotInstance *AutopilotStratuxPlugin) autopilotRoutine(waypointsDataCopy []Waypoint) GPRMBData{
	// GPRMB by default in Warning and Arrived
	gprmb := GPRMBData{Status: GPRMB_STATUS_WARNING,XTRKDistance: 0,Steer: GPRMB_STEER_LEFT,WaypointStart: "Current",WaypointDest: "",Lat: 0,Lon: 0,Distance: 0,TrueBearing: 0,Knots: 0,Arrived: GPRMB_ARRIVED_NOT_YET,LegCourse: 0}
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

		// Enable Autopilot Directions. Arrival stays "not yet" until the
		// aircraft is actually inside the circle below - RMB field 13 is an
		// arrival alarm, and announcing it on every sentence told the panel it
		// was over the waypoint for the whole leg.
		gprmb.Status = GPRMB_STATUS_OK
		gprmb.Arrived = GPRMB_ARRIVED_NOT_YET
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
		gprmb.Distance = nearestWaypointDistance * METERS_TO_NM
		// Field 12 is the closing speed on the waypoint, not the ground speed:
		// only the component along the bearing shortens the remaining distance.
		// GPSGroundSpeed is already knots (gps.go parses VTG field 5 as knots).
		gprmb.Knots = mySituation.GPSGroundSpeed *
			math.Cos(common.Radians(nearestWaypointBearing-float64(mySituation.GPSTrueCourse)))
		gprmb.TrueBearing = nearestWaypointBearing

		// The leg being flown. Its origin is the waypoint before this one;
		// on a direct-to there is none, so the position where the leg became
		// active is used, which is what a panel GPS does.
		aircraftLat := float64(mySituation.GPSLatitude)
		aircraftLon := float64(mySituation.GPSLongitude)
		destLat := float64(autopilotInstance.waypointsData[nearestWaypointIndex].Lat)
		destLon := float64(autopilotInstance.waypointsData[nearestWaypointIndex].Lon)
		var originLat, originLon float64
		if nearestWaypointIndex > 0 {
			originLat = float64(autopilotInstance.waypointsData[nearestWaypointIndex-1].Lat)
			originLon = float64(autopilotInstance.waypointsData[nearestWaypointIndex-1].Lon)
		} else {
			if autopilotInstance.legOriginValid == false {
				autopilotInstance.legOriginLat = aircraftLat
				autopilotInstance.legOriginLon = aircraftLon
				autopilotInstance.legOriginValid = true
			}
			originLat = autopilotInstance.legOriginLat
			originLon = autopilotInstance.legOriginLon
		}
		_, legCourse := common.Distance(originLat, originLon, destLat, destLon)
		gprmb.LegCourse = legCourse
		gprmb.XTRKDistance = crossTrackNM(aircraftLat, aircraftLon, originLat, originLon, destLat, destLon)

		// Right of course means steer left to regain it.
		if gprmb.XTRKDistance < 0 {
			gprmb.Steer = GPRMB_STEER_RIGHT
			gprmb.XTRKDistance = -gprmb.XTRKDistance
		} else {
			gprmb.Steer = GPRMB_STEER_LEFT
		}

		if nearestWaypointDistance < AUTOPILOT_ARRIVAL_RADIUS_METERS {
			gprmb.Arrived = GPRMB_ARRIVED_YES
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
	How far the aircraft is from the course line it is supposed to be on.

	This is the quantity a CDI shows and an autopilot steers on: the
	perpendicular distance from the great circle running origin -> destination,
	NOT the distance to the waypoint resolved through the current heading. The
	two only agree when the aircraft is already established on the leg; off it,
	the heading-based figure falls to zero as soon as the nose is pointed at the
	waypoint, which would centre the needle while the aircraft is still miles
	off course.

	Positive is right of course, so the pilot steers left to regain it.
*/
func crossTrackNM(aircraftLat, aircraftLon, originLat, originLon, destLat, destLon float64) float64 {
	originToAircraftMeters, originToAircraftBearing := common.Distance(originLat, originLon, aircraftLat, aircraftLon)
	_, legBearing := common.Distance(originLat, originLon, destLat, destLon)
	offCourse := common.Radians(originToAircraftBearing - legBearing)
	crossTrackMeters := math.Asin(
		math.Sin(originToAircraftMeters/EARTH_RADIUS_METERS)*math.Sin(offCourse)) * EARTH_RADIUS_METERS
	return crossTrackMeters * METERS_TO_NM
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
	if XTRKDistance > AUTOPILOT_XTRK_MAX_NM {
		XTRKDistance = AUTOPILOT_XTRK_MAX_NM
	}

	// Format Message GPRMB Recommended minimum navigation info.
	// Latitude is llll.ll and longitude yyyyy.yy - zero padded, or a receiver
	// reads 1151.48 as 11 deg 51.48 min instead of 011 deg 51.48 min. Every
	// longitude below 100 deg and every latitude below 10 deg needs the pad,
	// which is most of Europe. makeGPRMCString uses the same widths.
	msg := fmt.Sprintf("$GPRMB,%s,%.2f,%s,%s,%s,%09.4f,%s,%010.4f,%s,%.1f,%.1f,%.1f,%s",
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
	if XTRKDistance > AUTOPILOT_XTRK_MAX_NM {
		XTRKDistance = AUTOPILOT_XTRK_MAX_NM
	}
	perpendicularPassed := GPRMB_STATUS_WARNING
	if data.Arrived == GPRMB_ARRIVED_YES {
		perpendicularPassed = GPRMB_STATUS_OK
	}

	// $GPAPB has fourteen fields and the last one is the T/M of the heading to
	// steer; without it the sentence is truncated and a strict parser drops it.
	//
	// Every angle here is true, so each is tagged T. They used to be tagged M
	// while carrying true values, which offset the CDI by the local magnetic
	// variation - and nothing in this build knows the variation (makeGPRMCString
	// leaves its magnetic field empty), so T is what can honestly be claimed.
	//
	// Field 8 is the course of the leg, origin to destination. It used to repeat
	// the bearing to the waypoint, which is a different angle whenever the
	// aircraft is off track - exactly when the CDI matters.
	msg := fmt.Sprintf("$GPAPB,A,A,%.2f,%s,N,%s,%s,%03.0f,T,%s,%03.0f,T,%03.0f,T",
	XTRKDistance,
	data.Steer,
	data.Arrived,
	perpendicularPassed,
	data.LegCourse,
	data.WaypointDest,
	data.TrueBearing,
	data.TrueBearing)
	msg = appendNmeaChecksum(msg)
	msg += "\r\n"
	return msg
}

/*
	NMEA Sentence Generator
	$GPBOD - Bearing Origin to Destination
	The course of the leg itself. An autopilot sets its course pointer from
	this and drives the deviation bar from the cross-track, which is what
	makes it fly the line rather than chase the waypoint.
*/
func makeGPBODString(data GPRMBData) string {
	// Magnetic is left null: no magnetic variation is available here, and an
	// empty field is honest where a copy of the true bearing would not be.
	msg := fmt.Sprintf("$GPBOD,%.1f,T,,M,%s,%s",
	data.LegCourse,
	data.WaypointDest,
	data.WaypointStart)
	msg = appendNmeaChecksum(msg)
	msg += "\r\n"
	return msg
}

/*
	NMEA Sentence Generator
	$GPXTE - Cross-Track Error, Measured
	The same deviation RMB carries, on its own. Some autopilots take it only
	from here, and it costs one short sentence a second to cover them.
*/
func makeGPXTEString(data GPRMBData) string {
	XTRKDistance := data.XTRKDistance
	if XTRKDistance > AUTOPILOT_XTRK_MAX_NM {
		XTRKDistance = AUTOPILOT_XTRK_MAX_NM
	}
	msg := fmt.Sprintf("$GPXTE,A,A,%.2f,%s,N",
	XTRKDistance,
	data.Steer)
	msg = appendNmeaChecksum(msg)
	msg += "\r\n"
	return msg
}