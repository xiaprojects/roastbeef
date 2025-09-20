/*
	Copyright (c) 2025 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

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
*/

package main

import (
	"log"
	"net"
	"strings"
	"time"
)

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
