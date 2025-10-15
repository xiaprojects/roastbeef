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
41

	To avoid the conflict with existing Stratux RS232 messages, we added a whitelist prefixes.

	Roadmap:
	1) Add COMM Radio commands
	2) Receive complete path
	3) Other Avionics informations managed by foreigns
	4) Parse the NMEA messages into autopilot.go

	Example of radio commands:
	$PGRMC,119.000,125.600,Valdera,Perugia - Umbria*5B

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
	"strings"
	"time"
)

/*
	Radio parsing in case we need to switch from NMEA UDP Input to TQ KRT2 Binary protocol
*/

// ParseNMEA parses a $PMRRC or $PGRMC sentence
func ParseRadioNMEA(sentence string) (*RadioStatus, error) {
	sentence = strings.TrimSpace(sentence)
	if !(strings.HasPrefix(sentence, "$PMRRC") || strings.HasPrefix(sentence, "$PGRMC")) {
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
								newStatus, _ := ParseRadioNMEA(nmeaSentence)
								if newStatus != nil {
									radio.radioData[index].FrequencyActive = newStatus.FrequencyActive
									radio.radioData[index].LabelActive = newStatus.LabelActive
									radio.radioData[index].FrequencyStandby = newStatus.FrequencyStandby
									radio.radioData[index].LabelStandby = newStatus.LabelStandby
								}
							} else {
								// TODO: move the check into radio.go
								newStatus, _ := ParseRadioNMEA(nmeaSentence)
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
