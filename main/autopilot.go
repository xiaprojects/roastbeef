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
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"
	"strings"
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
	// Course of the leg after the active waypoint, degrees true: $PGRMH field
	// 8, so a receiver can show the turn that is coming.
	NextLegTrue float64
	HasNextLeg  bool
	// Advisory vertical guidance for $PGRMH fields 3 to 5.
	Vnav vnavResult
	// Is this the last waypoint of the plan? Decides the VNAV target, section 6.1.
	IsLastWaypoint bool
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

					// Vertical: baro vertical speed always, and the advisory
					// descent profile when it is armed and trusted. This is the
					// only sentence here that carries vertical guidance - plain
					// NMEA 0183 has no VNAV deviation of its own.
					nmeaPGRMH := makePGRMHString(pgrmhFromSolution(gprmb))
					log.Print(nmeaPGRMH)
					sendNetFLARM(nmeaPGRMH,time.Second, 0)
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

		// The leg after this one, if the plan has another waypoint.
		if nearestWaypointIndex+1 < len(autopilotInstance.waypointsData) {
			next := autopilotInstance.waypointsData[nearestWaypointIndex+1]
			_, nextCourse := common.Distance(destLat, destLon, float64(next.Lat), float64(next.Lon))
			gprmb.NextLegTrue = nextCourse
			gprmb.HasNextLeg = true
		}
		gprmb.IsLastWaypoint = gprmb.HasNextLeg == false

		// VNAV rides along with the other autopilot sentences: no switch of its
		// own, active whenever the autopilot is. The glide profile comes from
		// the aircraft, not the installation.
		glide := readGlideProfile()
		gprmb.Vnav = vnavSolution(vnavInputs{
			AltitudeFt:        float64(mySituation.GPSAltitudeMSL),
			DistNM:            gprmb.Distance,
			ClosingKt:         gprmb.Knots,
			TargetEleFt:       float64(autopilotInstance.waypointsData[nearestWaypointIndex].Ele),
			IsLastWaypoint:    gprmb.IsLastWaypoint,
			VerticalAccuracyM: float64(mySituation.GPSVerticalAccuracy),
			AngleDeg:          glide.DescentAngleDeg,
			ArrivalAglFt:      glide.ArrivalAglFt,
			ArrivalOffsetNM:   glide.ArrivalOffsetNM,
		})
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
	The aircraft's glide profile, from settings/aircraft.json.

	It lives with the aircraft rather than in stratux.conf because it describes
	the airframe, not the installation: the same RB-01 moved to another aircraft
	needs another descent angle, and the Aircraft plate already edits this file.

	The file is owned by the web UI and may be edited while flying, so it is
	re-read when its timestamp changes. A missing file, a missing "glide" block
	or a value out of range falls back to the defaults below - this is advisory
	guidance, and it is better to show a standard 3 degree path than none.
*/
const aircraftFileName = "settings/aircraft.json"

const (
	GLIDE_DEFAULT_ANGLE_DEG       = 3.0
	GLIDE_DEFAULT_ARRIVAL_AGL_FT  = 1000.0
	GLIDE_DEFAULT_ARRIVAL_OFFSET  = 2.0
	GLIDE_MIN_ANGLE_DEG           = 1.0
	GLIDE_MAX_ANGLE_DEG           = 9.0
)

// The resolved profile the autopilot flies.
type glideProfile struct {
	DescentAngleDeg float64
	ArrivalAglFt    float64
	ArrivalOffsetNM float64
}

// What the file actually carries. The pointers matter: an absent number
// unmarshals to 0, and 0 is a legitimate arrivalAglFt ("cross the threshold at
// field elevation"), so absent and zero must not look the same.
type glideFileBlock struct {
	DescentAngleDeg *float64 `json:"descentAngleDeg"`
	ArrivalAglFt    *float64 `json:"arrivalAglFt"`
	ArrivalOffsetNM *float64 `json:"arrivalOffsetNM"`
}

type aircraftFile struct {
	Glide *glideFileBlock `json:"glide"`
}

// resolve fills in a default for every field the file leaves out or sets out
// of range, so a half-written block still flies a sane path.
func (b glideFileBlock) resolve() glideProfile {
	g := glideDefaults()
	if b.DescentAngleDeg != nil && *b.DescentAngleDeg >= GLIDE_MIN_ANGLE_DEG && *b.DescentAngleDeg <= GLIDE_MAX_ANGLE_DEG {
		g.DescentAngleDeg = *b.DescentAngleDeg
	}
	if b.ArrivalAglFt != nil && *b.ArrivalAglFt >= 0 && *b.ArrivalAglFt <= 10000 {
		g.ArrivalAglFt = *b.ArrivalAglFt
	}
	if b.ArrivalOffsetNM != nil && *b.ArrivalOffsetNM >= 0 && *b.ArrivalOffsetNM <= 50 {
		g.ArrivalOffsetNM = *b.ArrivalOffsetNM
	}
	return g
}

var (
	glideCache      = glideProfile{GLIDE_DEFAULT_ANGLE_DEG, GLIDE_DEFAULT_ARRIVAL_AGL_FT, GLIDE_DEFAULT_ARRIVAL_OFFSET}
	glideCacheStamp time.Time
	glideCacheMutex sync.Mutex
	glideWarned     bool
)

// glideDefaults is what an absent or unusable file falls back to.
func glideDefaults() glideProfile {
	return glideProfile{GLIDE_DEFAULT_ANGLE_DEG, GLIDE_DEFAULT_ARRIVAL_AGL_FT, GLIDE_DEFAULT_ARRIVAL_OFFSET}
}

func readGlideProfile() glideProfile {
	path := STRATUX_WWW_DIR + aircraftFileName
	glideCacheMutex.Lock()
	defer glideCacheMutex.Unlock()

	info, err := os.Stat(path)
	if err != nil {
		return glideDefaults() // no aircraft file: standard profile
	}
	if info.ModTime().Equal(glideCacheStamp) {
		return glideCache // unchanged since the last read
	}

	parsed := glideDefaults()
	data, err := os.ReadFile(path)
	if err == nil {
		var file aircraftFile
		if err = json.Unmarshal(data, &file); err == nil {
			if file.Glide != nil {
				parsed = file.Glide.resolve()
			}
			glideWarned = false
		}
	}
	if err != nil && glideWarned == false {
		// Once per bad edit, not once a second.
		log.Printf("autopilot: can't read the glide profile from %s, using %.1f degrees: %s\n",
			path, parsed.DescentAngleDeg, err.Error())
		glideWarned = true
	}
	glideCache = parsed
	glideCacheStamp = info.ModTime()
	return parsed
}

/*
	Advisory vertical navigation, for $PGRMH fields 3 to 5.

	The model is specified in docs/integration/nmea-navigation-output.md
	section 6: a straight descent path at the aircraft glide angle rising back
	from a target point, with the aircraft's height above that path reported as
	field 3 and the vertical speeds that would reach it as fields 4 and 5.

	It is ADVISORY and DESCENT ONLY, and gives no terrain or obstacle protection
	whatsoever. It has no enable of its own: like every other autopilot
	sentence it is live whenever the autopilot is, and stays silent by sending
	null fields when a leg carries no altitude to descend to. Every gate in section 6.3 exists to keep a misleading
	cue off the panel rather than to refine one, so each returns null fields
	instead of a best guess.
*/
type vnavInputs struct {
	AltitudeFt        float64 // GPSAltitudeMSL
	DistNM            float64 // aircraft -> TO waypoint
	ClosingKt         float64 // ground speed along the bearing
	TargetEleFt       float64 // Waypoint.Ele; 0 means "no altitude", section 6.1
	IsLastWaypoint    bool
	VerticalAccuracyM float64
	AngleDeg          float64
	ArrivalAglFt      float64
	ArrivalOffsetNM   float64
}

type vnavResult struct {
	Active        bool     // fields 3 and 4 are available
	ErrorFt       *float64 // field 3, + above the profile
	VsToTargetFpm *float64 // field 4
	VsToWptFpm    *float64 // field 5, independent of the profile
}

// Minimum closing speed and worst vertical accuracy the profile is trusted at.
const (
	VNAV_MIN_CLOSING_KT = 30.0
	VNAV_MAX_VFOM_M     = 30.0
	VNAV_MIN_ABOVE_FT   = 100.0 // below this the descent is already over
	VNAV_ARM_SECONDS    = 60.0  // show the cue a minute before top of descent
	VNAV_FEET_PER_NM    = 6076.12
)

func vnavSolution(in vnavInputs) vnavResult {
	var out vnavResult
	// Section 6.1: Ele 0 is "no altitude", not sea level. A GPX point with no
	// <ele> imports as 0, and descending to it would fly into the ground. That
	// check is what keeps an always-on VNAV quiet on a plan without altitudes.
	if in.TargetEleFt == 0 {
		return out
	}
	targetAlt := in.TargetEleFt
	offsetNM := 0.0
	if in.IsLastWaypoint {
		targetAlt = targetAlt + in.ArrivalAglFt
		offsetNM = in.ArrivalOffsetNM
	}
	// Descent only.
	if in.AltitudeFt <= targetAlt+VNAV_MIN_ABOVE_FT {
		return out
	}
	if in.ClosingKt < VNAV_MIN_CLOSING_KT {
		return out
	}

	// Field 5 asks only how fast to descend to reach the target altitude at the
	// waypoint itself, so it needs no profile and survives the gates below.
	if in.DistNM > 0 {
		minutes := in.DistNM / in.ClosingKt * 60.0
		if minutes > 0 {
			vs := (targetAlt - in.AltitudeFt) / minutes
			out.VsToWptFpm = &vs
		}
	}

	if in.VerticalAccuracyM > VNAV_MAX_VFOM_M {
		return out
	}
	k := VNAV_FEET_PER_NM * math.Tan(common.Radians(in.AngleDeg))
	if k <= 0 {
		return out
	}
	distToTarget := in.DistNM - offsetNM
	if distToTarget <= 0 {
		return out // past the target point
	}
	// Section 6.3 item 3: hold the cue off until a minute before top of
	// descent, because before that the path is far overhead and the indication
	// would read "fly up" on a descent-only profile.
	distToTopOfDescent := (in.AltitudeFt - targetAlt) / k
	secondsToTopOfDescent := (distToTarget - distToTopOfDescent) / in.ClosingKt * 3600.0
	if secondsToTopOfDescent > VNAV_ARM_SECONDS {
		return out
	}

	profileAlt := targetAlt + distToTarget*k
	errorFt := in.AltitudeFt - profileAlt
	minutesToTarget := distToTarget / in.ClosingKt * 60.0
	if minutesToTarget <= 0 {
		return out
	}
	vsToTarget := (targetAlt - in.AltitudeFt) / minutesToTarget

	out.Active = true
	out.ErrorFt = &errorFt
	out.VsToTargetFpm = &vsToTarget
	return out
}

/*
	$PGRMH - Aviation Height and VNAV Data.

	Wire format, rounding, saturation and null rules are specified in
	docs/integration/pgrmh-format.md; this is that file's reference encoder, and
	the golden vectors in its section 5 are the unit tests in autopilot_test.go.

	A nil pointer is a null field, which means "not available" and is NOT the
	same as zero: 0 is level flight in field 2, on-profile in field 3 and north
	in field 7.
*/
type PGRMHData struct {
	Valid         bool     // field 1
	VertSpeedFpm  *float64 // field 2
	VnavErrorFt   *float64 // field 3
	VsToTargetFpm *float64 // field 4
	VsToWptFpm    *float64 // field 5
	HatFt         *float64 // field 6
	DtkTrue       *float64 // field 7
	NextLegTrue   *float64 // field 8
}

// Round half away from zero, saturate, then int: never "-0", which is what
// formatting a float with %.0f would produce from -0.4.
func pgrmhInt(v *float64, limit float64) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(int(math.Max(-limit, math.Min(limit, math.Round(*v)))))
}

// Whole degrees in [0, 360): 359.6 -> 0, -10 -> 350. 360 is never sent.
func pgrmhDeg(v *float64) string {
	if v == nil {
		return ""
	}
	d := int(math.Round(*v)) % 360
	if d < 0 {
		d += 360
	}
	return strconv.Itoa(d)
}

// Rounded down to the next lowest 100 ft.
func pgrmhHat(v *float64) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(int(math.Floor(math.Max(0, *v)/100) * 100))
}

/*
	Turn the navigation solution into the $PGRMH fields.

	Null means "not available" and is never a stand-in for zero, so each source
	is checked before its pointer is set: docs/integration/pgrmh-format.md
	section 3, and section 5.1 of the navigation-output document for the source
	of each field.
*/
func pgrmhFromSolution(data GPRMBData) PGRMHData {
	out := PGRMHData{Valid: data.Status == GPRMB_STATUS_OK}
	if out.Valid == false {
		return out // status V: every other field stays null
	}

	// Field 2. GPSVerticalSpeed is never assigned in this fork, so the baro is
	// the only vertical speed source, and only while the sensor is valid.
	if isTempPressValid() {
		vs := float64(mySituation.BaroVerticalSpeed)
		out.VertSpeedFpm = &vs
	}

	// Fields 3 to 5 from the advisory profile. Field 3 null implies field 4
	// null, which vnavSolution already guarantees by setting them together.
	out.VnavErrorFt = data.Vnav.ErrorFt
	out.VsToTargetFpm = data.Vnav.VsToTargetFpm
	out.VsToWptFpm = data.Vnav.VsToWptFpm

	// Field 6 is always null: there is no terrain model in the daemon.

	// Field 7 is the desired track, and must agree with $GPBOD field 1 of the
	// same burst - both read LegCourse.
	dtk := data.LegCourse
	out.DtkTrue = &dtk

	// Field 8 only exists while a leg follows the active waypoint.
	if data.HasNextLeg {
		next := data.NextLegTrue
		out.NextLegTrue = &next
	}
	return out
}

func makePGRMHString(d PGRMHData) string {
	// Status V means the whole sentence is unusable, so every other field is
	// null - the commas stay, trailing ones included.
	msg := "$PGRMH,V,,,,,,,"
	if d.Valid {
		msg = "$PGRMH,A," + strings.Join([]string{
			pgrmhInt(d.VertSpeedFpm, 9999),
			pgrmhInt(d.VnavErrorFt, 999),
			pgrmhInt(d.VsToTargetFpm, 9999),
			pgrmhInt(d.VsToWptFpm, 9999),
			pgrmhHat(d.HatFt),
			pgrmhDeg(d.DtkTrue),
			pgrmhDeg(d.NextLegTrue),
		}, ",")
	}
	return appendNmeaChecksum(msg) + "\r\n"
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