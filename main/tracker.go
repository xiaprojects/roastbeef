package main

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/tarm/serial"
)

/*
	Copyright (c) 2024 Adrian Batzill
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	---
	tracker.go: Implements handling and configuration of the various tracker devices (OGN Tracker, GXAirCom, SoftRF)

	TODO: SoftRF dongle is not yet considered a tracker, since we use the Moshe-Braner SoftRF fork
*/

var typeMappingOgn2Gx = [][]int {
	{1, 4}, // (Motor)glider
	{8, 5}, // Powered
	{3, 6}, // Helicopter
	{6, 2}, // Hang glider
	{7, 1}, // Paraglider
	{11, 3}, // Balloon
	{13, 7}, // UAV

	{2, 5}, // Tow->Powered
	{4, 1}, // Parachute->Paraglider
	{5, 5}, // Drop plane->Powered
	{9, 5}, // Jet -> Powered
	{10, 0}, // Ufo -> Other
	{12, 3}, // Airship -> Balloon
	{14, 0}, // Ground support
	{15, 0}, // Static object
}

var typeMappingOgn2SoftRF = [][]int {
	{1, 1}, // (Motor)glider
	{2, 2}, // Tow
	{3, 3}, // Helicopter
	{6, 6}, // Hang glider
	{7, 7}, // Paraglider
	{8, 8}, // Powered
	{11, 11}, // Balloon
	{13, 13}, // UAV
	{14, 16}, // Ground support/winch
	{15, 15}, // Static object

	{4, 7}, // Parachute->Paraglider
	{5, 8}, // Drop plane->Powered
	{9, 8}, // Jet -> Powered
	{10, 8}, // Ufo -> Powered
	{12, 11}, // Airship -> Balloon
}

func mapAircraftType(mapping [][]int, forward bool, acType int) int {
	for _, m := range mapping {
		if forward {
			if m[0] == acType {
				return m[1]
			}
		} else {
			if m[1] == acType {
				return m[0]
			}
		}
	}
	return -1
}



// Main interface that all tracker implementations need to implement
type Tracker interface {
	initNewConnection(serialPort *serial.Port)
	onNmea(serialPort *serial.Port, nmea []string) bool
	gpsTimeOffsetPps() time.Duration
	getGpsHardwareType() uint
	isDetected() bool
	isConfigRead() bool
	// How long should we wait after a write operation until we read back data
	writeReadDelay() time.Duration
	// Done on every new connection, return true if something was written
	writeInitialConfig(serialPort *serial.Port) bool

	requestTrackerConfig(serialPort *serial.Port)
	// Done only when user hits configure button, return true if something was written
	writeConfigFromSettings(serialPort *serial.Port) bool
}

func formatOgnTrackerConfigString() string {
	msg := fmt.Sprintf("$POGNS,Address=0x%s,AddrType=%d,AcftType=%d,Pilot=%s,Reg=%s,TxPower=%d,Hard=STX,Soft=%s",
		globalSettings.OGNAddr, globalSettings.OGNAddrType, globalSettings.OGNAcftType, globalSettings.OGNPilot, globalSettings.OGNReg, globalSettings.OGNTxPower, stratuxVersion[1:])
	msg = appendNmeaChecksum(msg)
	return msg + "\r\n"
}


type OgnTracker struct {
	detected bool
	trackerConfig []string
}

type GxAirCom struct {
	detected bool
	trackerConfig []string
	// If we suspect GX, but don't know for sure, we send exactly one blind config request. If it responds, we know. Otherwise, we stop.
	blindAskedForConfig bool
}

type SoftRF struct {
	detected bool
	psrfc []string
	psrfd []string
}

func (tracker *OgnTracker) initNewConnection(serialPort *serial.Port) {
	tracker.detected = false
	tracker.trackerConfig = nil
}

func (tracker *OgnTracker) onNmea(serialPort *serial.Port, nmea []string) bool {
	if nmea[0] == "POGNR" {
		tracker.detected = true
		return true
	}

	if nmea[0] == "POGNS" {
		tracker.trackerConfig = nmea

		// Tracker notified us of restart (crashed?) -> ensure we configure it again
		if len(nmea) == 2 && nmea[1] == "SysStart" {
			tracker.writeInitialConfig(serialPort)
			return true
		}
		// OGN tracker sent us its configuration
		log.Printf("Received OGN Tracker configuration: " + strings.Join(nmea, ","))
		oldAddr := globalSettings.OGNAddr
		for i := 1; i < len(nmea); i++ {
			kv := strings.SplitN(nmea[i], "=", 2);
			if len(kv) < 2 {
				continue
			}

			if kv[0] == "Address" {
				addr, _ :=  strconv.ParseUint(kv[1], 0, 32)
				globalSettings.OGNAddr = strings.ToUpper(fmt.Sprintf("%x", addr))
			} else if kv[0] == "AddrType" {
				addrtype, _ :=  strconv.ParseInt(kv[1], 0, 8)
				globalSettings.OGNAddrType = int(addrtype)
			} else if kv[0] == "AcftType" {
				acfttype, _ :=  strconv.ParseInt(kv[1], 0, 8)
				globalSettings.OGNAcftType = int(acfttype)
			} else if kv[0] == "Pilot" {
				globalSettings.OGNPilot = kv[1]
			} else if kv[0] == "Reg" {
				globalSettings.OGNReg = kv[1]
			} else if kv[0] == "TxPower" {
				pwr, _ := strconv.ParseInt(kv[1], 10, 16)
				globalSettings.OGNTxPower = int(pwr)
			}
		}
		// OGN Tracker can change its address arbitrarily. However, if it does,
		// ownship detection would fail for the old target. Therefore we remove the old one from the traffic list
		if oldAddr != globalSettings.OGNAddr && globalSettings.OGNAddrType == 0 {
			globalStatus.OGNPrevRandomAddr = oldAddr
			oldAddrInt, _ := strconv.ParseUint(oldAddr, 16, 32)
			removeTarget(uint32(oldAddrInt))
			// potentially other address type before
			removeTarget(uint32((1 << 24) | oldAddrInt))
		}
	}
	return false

}
func (tracker *OgnTracker) gpsTimeOffsetPps() time.Duration {
	return 200 * time.Millisecond
}

func (tracker *OgnTracker) getGpsHardwareType() uint {
	return GPS_TYPE_OGNTRACKER
	
}
func (tracker *OgnTracker) isDetected() bool {
	return tracker.detected
}

func (tracker *OgnTracker) isConfigRead() bool {
	return tracker.trackerConfig != nil
}

func (tracker *OgnTracker) writeReadDelay() time.Duration {
	return 1 * time.Second
}

func (tracker *OgnTracker) writeInitialConfig(serialPort *serial.Port) bool {
	serialPort.Write([]byte(appendNmeaChecksum("$POGNS,NavRate=5") + "\r\n"))
	// Configuration for OGN Tracker T-Beam is similar to normal Ublox config
	writeUblox8ConfigCommands(serialPort)
	writeUbloxGenericCommands(5, serialPort)
	return true
}

func (tracker *OgnTracker) requestTrackerConfig(serialPort *serial.Port) {
	serialPort.Write([]byte(appendNmeaChecksum("$POGNS") + "\r\n"))
}

func (tracker *OgnTracker) writeConfigFromSettings(serialPort *serial.Port) bool {
	cfg := formatOgnTrackerConfigString()
	log.Printf("Configuring OGN Tracker: " + cfg)

	serialPort.Write([]byte(cfg))
	tracker.requestTrackerConfig(serialPort) // re-read settings from tracker
	return true
}

func (tracker *GxAirCom) initNewConnection(serialPort *serial.Port) {
	tracker.detected = false
	tracker.trackerConfig = nil
	tracker.blindAskedForConfig = false
}


func (tracker *GxAirCom) onNmea(serialPort *serial.Port, nmea []string) bool {
    // Only sent by GxAirCom tracker. We use this to detect that GxAirCom tracker is connected and configure it as needed
    if (nmea[0] == "PFLAV" && nmea[4] == "GXAircom") {
		tracker.detected = true
        return true
    }
	if nmea[0] == "LK8EX1" && !tracker.blindAskedForConfig {
		// Indicates potentially GxAirCom.. send a blind tracker config request. If it responds, we know for sure
		tracker.blindAskedForConfig = true
		tracker.requestTrackerConfig(serialPort)
		return true
	}

	if nmea[0] == "PGXCF" && nmea[1] == "1" {
		// $PGXCF,<version>,<Output Serial>,<eMode>,<eOutputVario>,<output Fanet>,<output GPS>,<output FLARM>,<customGPSConfig>,<Aircraft Type (hex)>,<Address Type>,<Address (hex)>,<Pilot Name> 
		//  0      1         2               3       4              5            6              7                 8                     9              10              11             12
		log.Printf("Received GxAirCom Tracker configuration: " + strings.Join(nmea, ","))
		tracker.detected = true
		tracker.trackerConfig = nmea

		GXAcftType,_ := strconv.ParseInt(nmea[9], 16, 0)
		acftType := mapAircraftType(typeMappingOgn2Gx, false, int(GXAcftType))
		globalSettings.OGNAcftType = acftType

		GXAddrType,_ := strconv.Atoi(nmea[10])
		globalSettings.OGNAddrType = GXAddrType
		globalSettings.OGNAddr = nmea[11]
		globalSettings.OGNPilot = nmea[12]

		return true
	}

	return false

}
func (tracker *GxAirCom) gpsTimeOffsetPps() time.Duration {
	return 130 * time.Millisecond
}

func (tracker *GxAirCom) getGpsHardwareType() uint {
	return GPS_TYPE_GXAIRCOM
	
}
func (tracker *GxAirCom) isDetected() bool {
	return tracker.detected
}

func (tracker *GxAirCom) isConfigRead() bool {
	return tracker.trackerConfig != nil
}

func (tracker *GxAirCom) writeReadDelay() time.Duration {
	return 15 * time.Second
}

func (tracker *GxAirCom) writeInitialConfig(serialPort *serial.Port) bool {
	if (tracker.trackerConfig[2] != "1" || tracker.trackerConfig[5] == "0" || tracker.trackerConfig[6] == "0" || tracker.trackerConfig[7] == "0" || tracker.trackerConfig[8] == "0") {
		tracker.writeConfigFromSettings(serialPort) // force correct settings
		return true
	} else {
		log.Printf("GxAirCom tracker configuration ok!")
		return false
	}
}

func (tracker *GxAirCom) requestTrackerConfig(serialPort *serial.Port) {
	serialPort.Write([]byte(appendNmeaChecksum("$PGXCF,?") + "\r\n")) // Request configuration
}

func (tracker *GxAirCom) writeConfigFromSettings(serialPort *serial.Port) bool {
	// GX Addr type: 1=ICAO 2=FLARM
	addrType := globalSettings.OGNAddrType
	if addrType != 1 {
		addrType = 2 // all other address types to FLARM = non-ICAO
	}

	acftType := mapAircraftType(typeMappingOgn2Gx, true, globalSettings.OGNAcftType)


	// $PGXCF,<version>,<Output Serial>,<eMode>,<eOutputVario>,<output Fanet>,<output GPS>,<output FLARM>,<customGPSConfig>,<Aircraft Type (hex)>,<Address Type>,<Address (hex)>,<Pilot Name> 
	//  0      1         2               3              4              5            6              7                 8                     9              10              11      12
	requiredSentence := fmt.Sprintf("$PGXCF,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%s,%s",
		1,  // PGXCF Version
		1,  // Serial out
		0,  // Airmode
		1,  // Vario disabled // 0=noVario, 1= LK8EX1, 2=LXPW, we use it to try to identify GxAirCom
		1,  // Fanet
		1,  // GPS
		1,  // Flarm
		1,  // Stratux NMEA
		acftType,
		addrType,
		globalSettings.OGNAddr,
		globalSettings.OGNPilot)

	fullSentence := appendNmeaChecksum(requiredSentence)
	log.Printf("Configuring GxAirCom Tracker with: " + fullSentence)
	serialPort.Write([]byte(fullSentence + "\r\n")) // Set configuration
	return true
}

func (tracker *SoftRF) initNewConnection(serialPort *serial.Port) {
	tracker.detected = false
	tracker.psrfc = nil
	tracker.psrfd = nil
}


func (tracker *SoftRF) onNmea(serialPort *serial.Port, nmea []string) bool {
	if nmea[0] == "PSRFH" {
		tracker.detected = true
		return true
	}
	// PSRFC,<version>,<mode>,<rf_protocol>,<band>,<aircraft_type>,<alarm>,<txpower>,<volume>,<pointer>,<nmea_g>,<nmea_p>,<nmea_l>,<nmea_s>,<nmea_out>,<gdl90>,<d1090>,<stealth>,<no_track>,<power_save>
	// 0     1         2      3             4      5               6       7         8        9         10       11       12       13       14         15      16      17        18         19
	// PSRFD,<version>,<id_method>,<aircraft_id>,<ignore_id>,<follow_id>,<baud_rate>,<power_external>,<nmea_d>,<debug_flags>,<nmea_out2>,<nmea2_g>,<nmea2_p>,<nmea2_l>,<nmea2_s>,<nmea2_d>,<relay>,<bluetooth>,<baudrate2>,<invert2>,<nmea_e>,<nmea2_e>,<altpin0>,<voice>,<strobe>
	// 0     1         2           3             4           5           6           7                8        9             10          11        12        13        14        15        16      17          18          19        20       21        22        23      24

	if nmea[0] == "PSRFC" && nmea[1] == "1" {
		tracker.detected = true
		tracker.psrfc = nmea
		log.Printf("Received SoftRF config %s", strings.Join(nmea, ","))
		acType, _ := strconv.Atoi(nmea[5])
		acType = mapAircraftType(typeMappingOgn2SoftRF, false, acType)
		globalSettings.OGNAcftType = acType
		return true
	}
	if nmea[0] == "PSRFD" && nmea[1] == "1" {
		tracker.detected = true
		tracker.psrfd = nmea
		log.Printf("Received SoftRF config %s", strings.Join(nmea, ","))
		globalSettings.OGNAddrType, _ = strconv.Atoi(nmea[2])
		globalSettings.OGNAddr = nmea[3]
		return true
	}


	return false

}
func (tracker *SoftRF) gpsTimeOffsetPps() time.Duration {
	return 200 * time.Millisecond
}

func (tracker *SoftRF) getGpsHardwareType() uint {
	return GPS_TYPE_SOFTRF
	
}
func (tracker *SoftRF) isDetected() bool {
	return tracker.detected
}

func (tracker *SoftRF) isConfigRead() bool {
	return tracker.psrfc != nil && tracker.psrfd != nil
}

func (tracker *SoftRF) writeReadDelay() time.Duration {
	return 15 * time.Second
}

func (tracker *SoftRF) writeInitialConfig(serialPort *serial.Port) bool {
	if !tracker.isConfigRead() {
		return false
	}
	if tracker.psrfc[2] != "10" {
		// NMEA extended mode
		tracker.psrfc[2] = "10"
		msg := appendNmeaChecksum("$" + strings.Join(tracker.psrfc, ",")) + "\r\n"
		log.Printf("Configure SoftRF " + msg)
		serialPort.Write([]byte(appendNmeaChecksum(msg) + "\r\n"))
		return true
	}

	return false
}

func (tracker *SoftRF) requestTrackerConfig(serialPort *serial.Port) {
	serialPort.Write([]byte(appendNmeaChecksum("$PSRFC,?") + "\r\n"))
	serialPort.Write([]byte(appendNmeaChecksum("$PSRFD,?") + "\r\n"))
}

func (tracker *SoftRF) writeConfigFromSettings(serialPort *serial.Port) bool {
	// PSRFC,<version>,<mode>,<rf_protocol>,<band>,<aircraft_type>,<alarm>,<txpower>,<volume>,<pointer>,<nmea_g>,<nmea_p>,<nmea_l>,<nmea_s>,<nmea_out>,<gdl90>,<d1090>,<stealth>,<no_track>,<power_save>
	// 0     1         2      3             4      5               6       7         8        9         10       11       12       13       14         15      16      17        18         19

	// PSRFD,<version>,<id_method>,<aircraft_id>,<ignore_id>,<follow_id>,<baud_rate>,<power_external>,<nmea_d>,<debug_flags>,<nmea_out2>,<nmea2_g>,<nmea2_p>,<nmea2_l>,<nmea2_s>,<nmea2_d>,<relay>,<bluetooth>,<baudrate2>,<invert2>,<nmea_e>,<nmea2_e>,<altpin0>,<voice>,<strobe>
	// 0     1         2           3             4           5           6           7                8        9             10          11        12        13        14        15        16      17          18          19        20       21        22        23      24

	if !tracker.isConfigRead() {
		return false
	}
	
	newc := make([]string, len(tracker.psrfc))
	newd := make([]string, len(tracker.psrfd))
	copy(newc, tracker.psrfc)
	copy(newd, tracker.psrfd)
	newc[5] = strconv.Itoa(mapAircraftType(typeMappingOgn2SoftRF, true, globalSettings.OGNAcftType))
	newd[2] = strconv.Itoa(globalSettings.OGNAddrType)
	newd[3] = globalSettings.OGNAddr

	changed := false
	if tracker.psrfc[5] != newc[5] {
		newc[1] = "0" // instructs SoftRF to not reboot yet
		msg := appendNmeaChecksum("$" + strings.Join(newc, ",")) + "\r\n"
		log.Printf("Configure SoftRF " + msg)
		serialPort.Write([]byte(msg))
		changed = true
	}
	
	if tracker.psrfd[2] != newd[2] || tracker.psrfd[3] != newd[3] {
		newd[1] = "0" // instructs SoftRF to not reboot yet
		msg := appendNmeaChecksum("$" + strings.Join(newd, ",")) + "\r\n"
		log.Printf("Configure SoftRF " + msg)
		serialPort.Write([]byte(msg))
		changed = true
	}
	if changed {
		serialPort.Write([]byte(appendNmeaChecksum("$PSRFC,SAV") + "\r\n")) // Finally reboot
	}
	
	return changed
}










