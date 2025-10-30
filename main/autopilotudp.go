/*
	This file is part of RB.

	Copyright (C) 2025 XIAPROJECTS SRL

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

	https://github.com/xiaprojects/roastbeef/issues/29
	autopilotudp.go: Forward received NMEA strings to the serial port
	Possible sources: Easy VFR4 4.6.1

	Example of received payload via UDP:

$GPRMC,184851,A,4311.1168,N,01208.2004,E,001.0,000.0,190925,004.0,E*70
$GPVTG,0.0,T,356.0,M,1.0,N,1.9,K*47
$P3IGGA,43.185280,12.136674,1100,0,1,20250919,184852,1,*21
$GPRMB,A,8.77,L,LIQQ,LIPE,4431.8501,N,01117.8167,E,88.5,336.1,1.0,V*18
$GPAPB,A,A,8.77,L,N,V,V,342,M,LIPE,336,M,336,M*38
$PGRMH,A,0,-999,0,0,1300,341,0*21
$GPGGA,184851,4311.1168,N,01208.2004,E,3,0,0.0,335.3,M,0.0,M,,*43


	To avoid the conflict with existing Stratux RS232 messages, we added a whitelist prefixes.

	Roadmap:
	1) Add COMM Radio commands
	2) Receive complete path
	3) Other Avionics informations managed by foreigns
	4) Parse the NMEA messages into autopilot.go

	Example of radio commands:
	$PGRMC,119.000,125.600,Valdera,Perugia - Umbria*5B

	SL40 Compact version:
$PMRRC00G4N29
$PMRRC01G4N29
$PMRRC00H2N29
$PGRMC01KFM2
$PGRMC01N<004
$PGRMC00Q70149
$PGRMC06130005
$PGRMC01MS0061
$PGRMC01V4014<
$PGRMC01N<004
$PGRMC01V4014<
$PGRMC01MS0061

	How to test the UDP Command:
	1) Enable UDP on a specific port
	2) Using NetCat: echo "NMEA..." | nc -u 192.168.10.1 1234
*/

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"time"
)

// parseLatLon converts ddmm.mmmm or dddmm.mmmm format to decimal degrees
func parseLatLon(value, hemisphere string, isLatitude bool) (float64, error) {
	if len(value) < 4 {
		return 0, fmt.Errorf("invalid coordinate format: %s", value)
	}

	// Latitude: ddmm.mmmm, Longitude: dddmm.mmmm
	degLen := 2
	if !isLatitude {
		degLen = 3
	}

	degPart := value[:degLen]
	minPart := value[degLen:]

	deg, err1 := strconv.ParseFloat(degPart, 64)
	min, err2 := strconv.ParseFloat(minPart, 64)
	if err1 != nil || err2 != nil {
		return 0, fmt.Errorf("invalid lat/lon number: %v, %v", err1, err2)
	}

	decimal := deg + min/60.0
	if hemisphere == "S" || hemisphere == "W" {
		decimal *= -1
	}
	return decimal, nil
}

func ParseGPRMB(nmea string) (*GPRMBData, error) {
	if !strings.HasPrefix(nmea, "$GPRMB") {
		return nil, fmt.Errorf("not a GPRMB sentence")
	}

	// Split off checksum
	parts := strings.SplitN(nmea, "*", 2)
	data := strings.Split(parts[0], ",")
	if len(data) < 14 {
		return nil, fmt.Errorf("invalid GPRMB field count")
	}

	xte, _ := strconv.ParseFloat(data[2], 64)
	rng, _ := strconv.ParseFloat(data[10], 64)
	brg, _ := strconv.ParseFloat(data[11], 64)
	vel, _ := strconv.ParseFloat(data[12], 64)
	lat, _ := parseLatLon(data[6], data[7], true)
	lon, _ := parseLatLon(data[8], data[9], false)

	return &GPRMBData{
		Status:        data[1],
		XTRKDistance:  xte,
		Steer:         data[3],
		WaypointStart: data[4],
		WaypointDest:  data[5],
		Lat:           float32(lat),
		Lon:           float32(lon),
		Distance:      rng,
		TrueBearing:   brg,
		Knots:         vel,
		Arrived:       data[13]}, nil
}

/*
	Radio parsing in case we need to switch from NMEA UDP Input to TQ KRT2 Binary protocol
*/

// ParsePMRRCCompact parses a $PMRRC compact message (e.g. $PMRRC00G4N0)
func ParsePMRRCCompact(sentence string, currentStatus RadioStatus) (*RadioStatus, error) {
	hasOffset := false
	requestedLen := 5
	if strings.HasPrefix(sentence, "$PMRRC0") {
	} else {
		if strings.HasPrefix(sentence, "$PGRMC0") {

			hasOffset = true
			requestedLen = 6

		} else {
			return nil, errors.New("unsupported sentence type")
		}
	}
	body := strings.TrimPrefix(strings.TrimPrefix(sentence, "$PGRMC"), "$PMRRC")
	if len(body) < requestedLen {
		return nil, fmt.Errorf("invalid compact sentence: %s", sentence)
	}
	// Extract MsgID (first 2 digits)
	msgID, err := strconv.Atoi(body[0:2])
	if err != nil {
		return nil, fmt.Errorf("invalid MsgID: %v", err)
	}
	indexMhz := 2
	indexKhz := 3
	indexChangeType := 4
	indexOffset := 5
	// Extract characters
	mhz := rune(body[indexMhz]) + 0x30
	khz := rune(body[indexKhz]) - 0x30
	changeType := rune(body[indexChangeType])
	offset := 0
	if hasOffset == true {
		offsetStr := string(body[indexOffset])
		offsetIn, err := strconv.Atoi(offsetStr)
		if err == nil {
			offset = offsetIn
		}

	}
	switch changeType {
	case 'N':
		currentStatus.Dual = false
		break
	case 'M':
		currentStatus.Dual = true
		break
	}
	switch msgID {
	case 0:
		currentStatus.FrequencyActive = fmt.Sprintf("%d.%03d", mhz, 25*khz+rune(offset)*5)
		break
	case 1:
		currentStatus.FrequencyStandby = fmt.Sprintf("%d.%03d", mhz, 25*khz+rune(offset)*5)
		break
	}
	return &currentStatus, nil
}

// ParseNMEA parses a $PMRRC or $PGRMC sentence
func ParseRadioNMEA(sentence string) (*RadioStatus, error) {
	sentence = strings.TrimSpace(sentence)
	if !(strings.HasPrefix(sentence, "$PMRRC,") || strings.HasPrefix(sentence, "$PGRMC,")) {
		return nil, errors.New("unsupported sentence type")
	}

	parts := strings.SplitN(sentence[1:], "*", 2)
	// Skip checksum in this version
	/*
		if len(parts) != 2 {
			return nil, errors.New("invalid sentence format (missing checksum)")
		}
	*/
	data := parts[0]
	/*
		rawChecksum := strings.TrimSpace(parts[1])
		calculated := parseChecksum(data)
		valid := strings.EqualFold(calculated, rawChecksum)
	*/

	fields := strings.Split(data, ",")
	msgType := fields[0]
	msg := &RadioStatus{
		serialPort:       nil,
		Name:             "",
		SquelchLevel:     0,
		VolumeLevel:      0,
		FrequencyActive:  "",
		FrequencyStandby: "",
		Enabled:          true,
		Dual:             false,
		Driver:           RADIO_DRIVER_RS232_NMEA,
		Path:             "",
		LabelActive:      "",
		LabelStandby:     "",
	}

	switch msgType {
	case "PMRRC":
		if len(fields) < 4 {
			return nil, errors.New("invalid PMRRC field count")
		}
		msg.Name = fields[1]
		msg.FrequencyActive = fields[2]
		msg.FrequencyStandby = fields[3]

		// optional labels
		if len(fields) >= 5 {
			msg.LabelActive = strings.TrimRight(fields[4], " ")
		}
		if len(fields) >= 6 {
			msg.LabelStandby = strings.TrimRight(fields[5], " ")
		}

	case "PGRMC":
		if len(fields) < 3 {
			return nil, errors.New("invalid PGRMC field count")
		}
		msg.FrequencyActive = fields[1]
		msg.FrequencyStandby = fields[2]

		if len(fields) >= 4 {
			msg.LabelActive = strings.TrimRight(fields[3], " ")
		}
		if len(fields) >= 5 {
			msg.LabelStandby = strings.TrimRight(fields[4], " ")
		}
	}

	return msg, nil
}

type AutopilotUDPStratuxPlugin struct {
	StratuxPlugin
	requestToExit bool
}

var autopilotUdp = AutopilotUDPStratuxPlugin{}

func (autopilotInstance *AutopilotUDPStratuxPlugin) InitFunc() bool {
	log.Println("Entered AutopilotUDPStratuxPlugin init() ...")
	autopilotInstance.Name = "Autopilot UDP $GPRMB"
	autopilotInstance.requestToExit = false
	go autopilotInstance.autopilot()
	return true
}

func (autopilotInstance *AutopilotUDPStratuxPlugin) udpListener() {
	log.Println("Entered AutopilotUDPStratuxPlugin ENABLED on port: ", globalSettings.AutopilotUdp_Port)

	passthruePrefixesRadio := []string{
		"$PMRRC",
		"$PGRMC"}

	passthruePrefixes := []string{
		"$PGRMH",
		"$GPVTG",
		"$P3IGGA",
		"$GPRMB",
		"$GPAPB"}

	p := make([]byte, 2048)
	addr := net.UDPAddr{
		Port: globalSettings.AutopilotUdp_Port,
		IP:   net.ParseIP("0.0.0.0"),
	}
	ser, err := net.ListenUDP("udp", &addr)

	if err != nil {
		log.Printf("AutopilotUDPStratuxPlugin ERROR: %v: %s\n", err, err.Error())
		return
	}

	for autopilotInstance.requestToExit == false && globalSettings.AutopilotUdp_Enabled == true {

		// Set to 2 seconds because source is 1 second
		ser.SetReadDeadline(time.Now().Add(2 * time.Second))

		_, _, err := ser.ReadFromUDP(p)
		if err != nil {
			// Timeout cases log.Printf("AutopilotUDPStratuxPlugin ERROR: %v: %s\n", err, err.Error())
			// Todo Mutex?
			globalStatus.AutopilotUDPReceivingMessages = 0
			continue
		}
		if len(p) > 0 {
			str := string(p)
			nmeaReceivedSentences := strings.Split(str, "\n")
			for _, nmeaSentence := range nmeaReceivedSentences {

				for _, approvedSentence := range passthruePrefixes {

					if strings.HasPrefix(nmeaSentence, approvedSentence) {
						if strings.HasPrefix(nmeaSentence, "$GPRMB") {
							gprmb, error := ParseGPRMB(nmeaSentence)
							if error == nil {
								// Stop internal AP
								autopilot.waypointsDataMutex.Lock()
								autopilot.status.Active = false
								// Store current waypath to be ready to switch on internal AP in case of timeout
								var msg []Waypoint
								To := Waypoint{Lat: gprmb.Lat, Lon: gprmb.Lon, Ele: int32(mySituation.GPSAltitudeMSL), Status: WAYPOINT_STATUS_TARGET, Cmt: gprmb.WaypointDest}
								From := Waypoint{Lat: mySituation.GPSLatitude, Lon: mySituation.GPSLongitude, Ele: int32(mySituation.GPSAltitudeMSL), Status: WAYPOINT_STATUS_PAST, Cmt: gprmb.WaypointStart}
								msg = make([]Waypoint, 0)
								msg = append(msg, From)
								msg = append(msg, To)
								autopilot.waypointsData = msg
								// Store last status
								autopilot.status.GPRMB = *gprmb
								autopilot.status.To = To
								// Socket updated on Autopilot Thread
								//autopilotUpdate.SendJSON(autopilot.status)
								autopilot.waypointsDataMutex.Unlock()
							}
						}
						//fmt.Println(nmeaSentence)
						sendNetFLARM(nmeaSentence+"\n", time.Second, 0)
					}
				}

				// Received NMEA UDP command to change the radio
				for _, approvedSentence := range passthruePrefixesRadio {
					if strings.HasPrefix(nmeaSentence, approvedSentence) {
						// searching for a suitable radio
						for index, _ := range radio.radioData {
							// Check for a passtrough
							if radio.radioData[index].Path == "" && radio.radioData[index].Driver == RADIO_DRIVER_RS232_NMEA {
								fmt.Println(nmeaSentence)
								sendNetFLARM(nmeaSentence+"\n", time.Second, 0)
								// Store latest configuration
								newStatus, _ := ParsePMRRCCompact(nmeaSentence, radio.radioData[index])
								if newStatus != nil {
									radio.radioData[index].FrequencyActive = newStatus.FrequencyActive
									radio.radioData[index].LabelActive = newStatus.LabelActive
									radio.radioData[index].FrequencyStandby = newStatus.FrequencyStandby
									radio.radioData[index].LabelStandby = newStatus.LabelStandby
								}
							} else {
								// TODO: move the check into radio.go
								newStatus, _ := ParsePMRRCCompact(nmeaSentence, radio.radioData[index])
								if newStatus != nil {
									radioIsChanged := 0
									toActive := false
									frequency := ""
									label := ""
									if radio.radioData[index].FrequencyActive != newStatus.FrequencyActive {
										radio.radioData[index].FrequencyActive = newStatus.FrequencyActive
										radio.radioData[index].LabelActive = newStatus.LabelActive
										frequency = newStatus.FrequencyActive
										label = newStatus.LabelActive
										radioIsChanged++
										toActive = true
									}
									if radio.radioData[index].FrequencyStandby != newStatus.FrequencyStandby {
										radio.radioData[index].FrequencyStandby = newStatus.FrequencyStandby
										radio.radioData[index].LabelStandby = newStatus.LabelStandby
										frequency = newStatus.FrequencyStandby
										label = newStatus.LabelStandby
										radioIsChanged++
										toActive = false
									}
									switch radioIsChanged {
									case 0:
										// No changes
										break
									case 1:
										// Only one frequency has being changed
										radio.radioSetFrequency(index, frequency, toActive, label)
										break
									case 2:
										if radio.radioData[index].FrequencyActive != "" {
											radio.radioSetFrequency(index, radio.radioData[index].FrequencyActive, true, radio.radioData[index].LabelActive)
										}
										if radio.radioData[index].FrequencyStandby != "" {

											radio.radioSetFrequency(index, radio.radioData[index].FrequencyStandby, false, radio.radioData[index].LabelStandby)
										}
										break
									}
									if radio.radioData[index].Dual != newStatus.Dual {
										radio.radioData[index].Dual = newStatus.Dual
										radio.radioSetDual(index, radio.radioData[index].Dual)
									}
								}
							}
							// TODO: move mutex
							radio.radioDataMutex.Lock()
							// Store the current configuration back to facilitate the restore
							// TODO: use only one array
							globalSettings.Radio = radio.radioData
							statusJSON, _ := json.Marshal(&radio.radioData)
							radio.radioDataMutex.Unlock()
							radioUpdate.Send(statusJSON)

							// TODO: support multiple radio using NAME
							break
						}
					}
				}
			}
			// Todo Mutex?
			globalStatus.AutopilotUDPReceivingMessages = 1
		}
	}
	ser.Close()
}

func (autopilotInstance *AutopilotUDPStratuxPlugin) autopilot() {
	for autopilotInstance.requestToExit == false {
		if globalSettings.AutopilotUdp_Enabled == true {
			autopilotInstance.udpListener()
		}
		time.Sleep(1 * time.Second)
	}
}

func (autopilotInstance *AutopilotUDPStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered AutopilotUDPStratuxPlugin shutdown() ...")
	autopilotInstance.requestToExit = true
	return true
}
