/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	radio.go: Radio Management
	Features:
	- Radio Status
	- RS232 Serial Port receiver
	- RS232 Configuration
	- Set frequency on RS232 binary protocol

	Roadmap:
	- Get frequency on RS232 binary protocol
	- Set frequency on NMEA binary protocol
	- Add new Radio
	- Receive current status

	Remote Radio Protocols:
	Standard 1 with STX = 0x02
	The remote control interface is a serial RX-TX interface with RS232
	voltage levels with 9600 baud, 8 data bits, no parity, 1 stop bit, no
	handshake.
	'U' => Set Active Frequency
	'R' => Set Standby Frequency
	'C' => Swap
	'O' => Dual ON
	'o' => Dual OFF

	Binary command to set frequency:
	struct stx_msg {
	byte start = STX;
	byte command;		// 'U' Active, 'R' Standby
	uint8_t mhz;		// frequency / 1000
	uint8_t khz;		// (frequency % 1000) / 5;
	char station[8]; // ' '
	uint8_t checksum;	// msg.mhz ^ msg.khz
	};
	Binary command to swap standby:
	struct swp_msg {
	byte start = STX;
	byte command;		// 'C'
	}

	Standard 2 with NMEA Messages
*/

package main

import (
	"errors"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tarm/serial"
)


const (
	RADIO_DRIVER_SDR = 			"SDR"
	RADIO_DRIVER_RS232 = 		"SERIAL"
	RADIO_DRIVER_RS232_NMEA =	"NMEA"
	RADIO_DRIVER_RS232_BAUD =   9600
	RADIO_DRIVER_RS232_STX =   0x02
)

type RadioPlayback struct {
	Name string
	Source string
	Path string
	Size int64
	ModTime time.Time
	Frequency string
}

type RadioStatus struct {
	Name string
	SquelchLevel int
	VolumeLevel int
	FrequencyActive string
	FrequencyStandby string
	Enabled bool
	Dual bool
	Driver string
	Path string
	serialPort *serial.Port
	LabelActive      string
	LabelStandby     string
}

type RadioStratuxPlugin struct {
	StratuxPlugin
	radioData      []RadioStatus
	radioDataMutex *sync.Mutex
	requestToExit      bool
}

var radio = RadioStratuxPlugin{}

func (radioInstance *RadioStratuxPlugin) InitFunc() bool {
	log.Println("Entered RadioStratuxPlugin init() ...")
	radioInstance.Name = "Radio"
	radioInstance.radioDataMutex = &sync.Mutex{}
	radioInstance.requestToExit = false
	radioInstance.radioData = globalSettings.Radio

	// Reset all Comms
	for comm := range radioInstance.radioData {
		thisRadio := &radioInstance.radioData[comm]
		thisRadio.serialPort = nil
	}

	go radioInstance.radioThread()
	return true
}
func (radioInstance *RadioStratuxPlugin) radioThread() {
	for radioInstance.requestToExit == false {
		if globalSettings.Radio_Enabled == true {

			// Check serial status
			// TODO: Apply config at runtime
			for comm := range radioInstance.radioData {
				thisRadio := &radioInstance.radioData[comm]
				if thisRadio.Path != "" && thisRadio.Driver == RADIO_DRIVER_RS232 {
					if thisRadio.serialPort == nil {
						// SERIAL Driver and Port is not yet opened, also Path is set
						if _, err := os.Stat(thisRadio.Path); errors.Is(err, os.ErrNotExist) {
							// Ops /dev/path is not exist
						} else {
							thisRadio.serialPort = openRadioSerial(thisRadio.Path, RADIO_DRIVER_RS232_BAUD)
							if thisRadio.serialPort != nil {
								defer thisRadio.serialPort.Close()
							}
						}
					} else {
						// Protocol requires ping-pong but due to WRITE line only connected we try to send some bytes
						// My Radio does not require the "r" to be replied in 60ms
						if(false){
							radioSerialSetDual(thisRadio.serialPort, thisRadio.Dual)
						}
					}
				}
			}
		}
		time.Sleep(1 * time.Second)
	}
}

func (radioInstance *RadioStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered RadioStratuxPlugin shutdown() ...")
	radioInstance.requestToExit = true
	return true
}

func (radioInstance *RadioStratuxPlugin) radioSetFrequency(index int, frequency string, toActive bool, label string) bool {
	if(index>=len(radioInstance.radioData)){
		return false
	}
	log.Println("radioSetFrequency ",frequency)
	thisRadio := &radioInstance.radioData[index]
	switch thisRadio.Driver {
	case RADIO_DRIVER_RS232:
		if(thisRadio.serialPort != nil){
			return radioSerialSetFrequency(thisRadio.serialPort, frequency, toActive, label)
		}
		break
	}
	return false
}

func (radioInstance *RadioStratuxPlugin) radioSetDual(index int, dual bool) bool {
	log.Println("radioSetDual ",index,dual)
	if(index>=len(radioInstance.radioData)){
		return false

	}
	thisRadio := &radioInstance.radioData[index]
	switch thisRadio.Driver {
	case RADIO_DRIVER_RS232:
		if(thisRadio.serialPort != nil){
			return radioSerialSetDual(thisRadio.serialPort , dual)
		}
		break
	}
	return false
}




func openRadioSerial(device string, baudrate int) *serial.Port {
	log.Printf("Using %s for Radio RS232\n", device)

	serialConfig := &serial.Config{Name: device, Baud: baudrate}
	p, err := serial.OpenPort(serialConfig)
	if err != nil {
		log.Printf("Error opening serial port: %s\n", err.Error())
		return nil
	}
	log.Printf("Radio RS232 Opened")
	return p
}

func padTo8Bytes(s string) [8]byte {
	var buf [8]byte
	copy(buf[:], s) // copy as many as fit (max 8)
	for i := len(s); i < 8 && i < len(buf); i++ {
		buf[i] = ' ' // pad with spaces
	}
	return buf
}

func radioSerialSetFrequency(serialPort *serial.Port, frequency string, toActive bool, label string) bool {
	var command byte
	var mhz byte
	var khz byte
	var checksum byte
	command = 'U'
	if(toActive==false){
		command = 'R'
	}

	mhzKhzString := strings.Split(frequency, ".")
	if(len(mhzKhzString)!=2){
		log.Printf("radioSerialSetFrequency: Frequency in wrong format [%s]\n", frequency)
		return false
	}

	mhzInt, err1 := strconv.Atoi(mhzKhzString[0])
	if(err1!=nil){
		log.Printf("radioSerialSetFrequency:error: %s\n", err1.Error())
		return false
	}
	khzString := mhzKhzString[1]


	for i:=0;len(khzString)<3;i++ {
		khzString = khzString + "0"
	}

	khzInt, err2 := strconv.Atoi(khzString)
	if(err2!=nil){
		log.Printf("radioSerialSetFrequency:error: %s\n", err2.Error())
		return false
	}
	label8byte := padTo8Bytes(label)
	mhz = byte(mhzInt)
	khz = byte((khzInt % 1000) / 5)
	checksum = mhz ^ khz
	msg := make([]byte, 13)
	msg[0] = RADIO_DRIVER_RS232_STX
	msg[1] = command
	msg[2] = mhz
	msg[3] = khz
	msg[4] = label8byte[0]
	msg[5] = label8byte[1]
	msg[6] = label8byte[2]
	msg[7] = label8byte[3]
	msg[8] = label8byte[4]
	msg[9] = label8byte[5]
	msg[10] = label8byte[6]
	msg[11] = label8byte[7]
	msg[12] = checksum

	written, err := serialPort.Write(msg)
	if err != nil || written==0 {
		return false
	}


	log.Printf("Radio %c Updated %s %d.%d\n",command,frequency,mhz,khz)

	return true
}



func radioSerialSetDual(serialPort *serial.Port, dual bool) bool {
	var command byte
	command = 'O' 
	if(dual==false){
		command = 'o'
	}
	msg := make([]byte, 2)
	msg[0] = RADIO_DRIVER_RS232_STX
	msg[1] = command

	written, err := serialPort.Write(msg)
	if err != nil || written==0 {
		return false
	}
	return true
}
