/*
	This file is part of RB.

	Copyright (C) 2023 XIAPROJECTS SRL

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

	radio.go: Radio Management
	Features:
	- Radio Status
	- RS232 Serial Port receiver
	- RS232 Configuration
	- Set frequency on RS232 binary protocol
	- Set frequency, volume, squelch and recording on rb-sdr-radio

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

	Standard 3 with rb-sdr-radio, RB-SDR-RADIO-IF v1.0
	An airband receiver in its own process, a client of /bridge/float/ws. Commands are
	keys of the float bridge, in the one map every addon shares:
	sdrradiofreq		// MHz, channel name as dialled. 0 is off and releases the SDR: Enabled false
	sdrradiovolume		// 0 to 100. 0 releases the ALSA device
	sdrradiosquelch		// dB above the noise. 0 holds it open
	sdrradiorecord		// 0 or 1
	The bridge lives in memory, so the commands are sent again after a restart.
*/

package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/xiaprojects/serial"
)


const (
	RADIO_DRIVER_SDR = 			"SDR"
	RADIO_DRIVER_RS232 = 		"SERIAL"
	RADIO_DRIVER_RS232_NMEA =	"NMEA"
	RADIO_DRIVER_RS232_BAUD =   9600
	RADIO_DRIVER_RS232_STX =   0x02

	RADIO_SDR_KEY_FREQUENCY = "sdrradiofreq"
	RADIO_SDR_KEY_VOLUME =    "sdrradiovolume"
	RADIO_SDR_KEY_SQUELCH =   "sdrradiosquelch"
	RADIO_SDR_KEY_RECORD =    "sdrradiorecord"
	RADIO_SDR_LEVEL_MAX =     100
	RADIO_SDR_BAND_MIN_KHZ =  118000
	RADIO_SDR_BAND_MAX_KHZ =  136990
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
	Record *bool // SDR only. nil until the pilot chooses: the daemon's own default is on
	sdrRestored bool
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
		if thisRadio.FrequencyActive == "" {
			thisRadio.FrequencyActive = "118.000"
		}
		if thisRadio.FrequencyStandby == "" {
			thisRadio.FrequencyStandby = "118.000"
		}
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
				if thisRadio.Driver == RADIO_DRIVER_SDR && thisRadio.sdrRestored == false {
					radioInstance.radioDataMutex.Lock()
					radioInstance.radioSdrRestore(thisRadio)
					thisRadio.sdrRestored = true
					radioInstance.radioDataMutex.Unlock()
				}
				if thisRadio.Path != "" && (thisRadio.Driver == RADIO_DRIVER_RS232 || thisRadio.Driver == RADIO_DRIVER_RS232_NMEA) {
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

func appendNmeaRadioChecksum(nmea string) string {
	start := 0

	if nmea[0] == '$' {
		start = 1
	}

	checksum := byte(0x00)
	for i := start; i < len(nmea); i++ {
		checksum = checksum + byte(nmea[i])
	}
	high := (checksum >> 4) & 0x07
	low := checksum & 0x07
	pack := []byte{high + 0x30, low + 0x30}
	ret := fmt.Sprintf("%s%s", nmea, string(pack))
	log.Println("Radio NMEA: ", ret)
	return ret
}

func makePGRMCRadioString(setToActive bool, frequency string, monitor bool) (string, error) {
	var charForMonitor byte = 'N'
	if monitor == true {
		charForMonitor = 'M'
	}

	var charForIndex byte = '1'
	if setToActive == true {
		charForIndex = '0'
	}

	freqSplit := strings.Split(frequency, ".")
	if len(freqSplit) != 2 {
		return "", fmt.Errorf("invalid Frequency: %s", frequency)
	}

	mhz, err1 := strconv.Atoi(freqSplit[0])
	if err1 != nil {
		return "", err1
	}
	if mhz > 137 || mhz < 118 {
		return "", fmt.Errorf("invalid Frequency: %s", frequency)
	}

	khz, err2 := strconv.Atoi(freqSplit[1])
	if err2 != nil {
		return "", err2
	}

	mhz = mhz - 0x30
	offset := ((khz % 25) / 5) + 0x30
	khz = (khz / 25) + 0x30

	pack := []byte{uint8(charForIndex), uint8(mhz), uint8(khz), charForMonitor, uint8(offset)}

	msg := fmt.Sprintf("$PGRMC0%s", string(pack))
	return msg, nil
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
	case RADIO_DRIVER_RS232_NMEA:
		if(toActive == true) {
			thisRadio.FrequencyActive = frequency
			thisRadio.LabelActive = label

		} else {
			thisRadio.FrequencyStandby = frequency
			thisRadio.LabelStandby = label
		}

		nmeaRadioUpdate, err := makePGRMCRadioString(toActive, frequency, thisRadio.Dual)
		log.Println("radioSetFrequency NMEA ", nmeaRadioUpdate)
		if err != nil {
			return false
		}
		// if the user specified a dedicated port we use it
		if(thisRadio.serialPort != nil) {
			written, err := serialPort.Write([]byte(nmeaRadioUpdate))
				if err != nil || written==0 {
				return false
			} else {
				return true
			}
		} else {
			// use existing NMEA output channel
			sendNetFLARM(appendNmeaRadioChecksum(nmeaRadioUpdate)+"\r\n", time.Second, 0)
			return true
		}
	case RADIO_DRIVER_SDR:
		// One receiver, so standby exists only here. It is not checked either: the 5 kHz
		// spinner in radio.js steps through names that are not channels, such as 118.020.
		if toActive == false {
			return true
		}
		mhz, valid := radioSdrChannelMHz(frequency)
		if valid == false {
			log.Printf("radioSetFrequency: not a COM channel [%s]\n", frequency)
			return false
		}
		// Kept for when it is enabled, see radioSdrTune
		if thisRadio.Enabled == false {
			return true
		}
		return radioInstance.radioSdrCommand(index, RADIO_SDR_KEY_FREQUENCY, mhz)
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
		if thisRadio.serialPort != nil {
			return radioSerialSetDual(thisRadio.serialPort, dual)
		}
		break
	case RADIO_DRIVER_RS232_NMEA:
		// in NMEA there is no dual command, so we rewrite the standby frequency with M enabled
		nmeaRadioUpdate, err := makePGRMCRadioString(false, thisRadio.FrequencyStandby, dual)
		log.Println("radioSetFrequency NMEA ", nmeaRadioUpdate)
		if err != nil {
			return false
		}
		// if the user specified a dedicated port we use it
		if thisRadio.serialPort != nil {
			written, err := serialPort.Write([]byte(nmeaRadioUpdate))
			if err != nil || written == 0 {
				return false
			} else {
				return true
			}
		} else {
			// use existing NMEA output channel
			sendNetFLARM(appendNmeaRadioChecksum(nmeaRadioUpdate)+"\r\n", time.Second, 0)
			return true
		}
	case RADIO_DRIVER_SDR:
		// One receiver on one channel: there is no dual watch to turn on
		return false
	}
	return false
}

func (radioInstance *RadioStratuxPlugin) radioSetVolume(index int, level int) bool {
	log.Println("radioSetVolume ",index,level)
	if level < 0 || level > RADIO_SDR_LEVEL_MAX {
		return false
	}
	if radioInstance.radioSdrCommand(index, RADIO_SDR_KEY_VOLUME, float32(level)) == false {
		return false
	}
	radioInstance.radioData[index].VolumeLevel = level
	return true
}

func (radioInstance *RadioStratuxPlugin) radioSetSquelch(index int, level int) bool {
	log.Println("radioSetSquelch ",index,level)
	if level < 0 || level > RADIO_SDR_LEVEL_MAX {
		return false
	}
	if radioInstance.radioSdrCommand(index, RADIO_SDR_KEY_SQUELCH, float32(level)) == false {
		return false
	}
	radioInstance.radioData[index].SquelchLevel = level
	return true
}

func (radioInstance *RadioStratuxPlugin) radioSetRecord(index int, record bool) bool {
	log.Println("radioSetRecord ",index,record)
	if radioInstance.radioSdrCommand(index, RADIO_SDR_KEY_RECORD, radioSdrFlag(record)) == false {
		return false
	}
	radioInstance.radioData[index].Record = &record
	return true
}

// radioSdrCommand writes one command to the float bridge, which is how rb-sdr-radio hears it.
func (radioInstance *RadioStratuxPlugin) radioSdrCommand(index int, key string, value float32) bool {
	if index >= len(radioInstance.radioData) || radioInstance.radioData[index].Driver != RADIO_DRIVER_SDR {
		return false
	}
	addonsBridge.setFloats(map[string]float32{key: value})
	return true
}

// radioSdrTune makes sdrradiofreq follow the Enabled flags: the active channel of the
// enabled SDR radio, or the empty frequency when none is. The bridge holds only numbers,
// so empty is 0, which releases the dongle. It looks at every radio because selecting one
// disables the others, and there is one receiver however many entries point at it.
func (radioInstance *RadioStratuxPlugin) radioSdrTune() {
	var mhz float32
	present, valid := false, true
	for comm := range radioInstance.radioData {
		thisRadio := &radioInstance.radioData[comm]
		if thisRadio.Driver == RADIO_DRIVER_SDR {
			present = true
			if thisRadio.Enabled {
				mhz, valid = radioSdrChannelMHz(thisRadio.FrequencyActive)
			}
		}
	}
	if present && valid {
		addonsBridge.setFloats(map[string]float32{RADIO_SDR_KEY_FREQUENCY: mhz})
	}
}

// radioSdrRestore sends what the pilot last chose: the bridge starts empty after a restart.
// A level of 0 is indistinguishable from a setting never made, as in every stratux.conf so
// far, so it leaves the daemon's default rather than muting it. The frequency goes last
// and goes even when off: the daemon may have outlived this restart, still tuned.
func (radioInstance *RadioStratuxPlugin) radioSdrRestore(thisRadio *RadioStatus) {
	commands := make(map[string]float32)
	if thisRadio.VolumeLevel > 0 {
		commands[RADIO_SDR_KEY_VOLUME] = float32(thisRadio.VolumeLevel)
	}
	if thisRadio.SquelchLevel > 0 {
		commands[RADIO_SDR_KEY_SQUELCH] = float32(thisRadio.SquelchLevel)
	}
	if thisRadio.Record != nil {
		commands[RADIO_SDR_KEY_RECORD] = radioSdrFlag(*thisRadio.Record)
	}
	addonsBridge.setFloats(commands)
	radioInstance.radioSdrTune()
}

func radioSdrFlag(on bool) float32 {
	if on {
		return 1
	}
	return 0
}

// radioSdrChannelMHz returns the value of sdrradiofreq for a frequency: the channel name
// in MHz. Anything else makes the daemon release the SDR, so it is refused here and the
// radio stays on its channel. Integer kHz throughout, as a float32 frequency must never
// be compared.
func radioSdrChannelMHz(frequency string) (float32, bool) {
	mhzString, khzString, _ := strings.Cut(frequency, ".")
	if len(khzString) > 3 {
		return 0, false // 118.0083 is a tuned frequency, not a channel name
	}
	mhz, err1 := strconv.ParseUint(mhzString, 10, 16)
	khz, err2 := strconv.ParseUint((khzString + "000")[:3], 10, 16)
	if err1 != nil || err2 != nil {
		return 0, false
	}
	name := mhz*1000 + khz
	if name < RADIO_SDR_BAND_MIN_KHZ || name > RADIO_SDR_BAND_MAX_KHZ || name%5 != 0 {
		return 0, false
	}
	switch name % 100 {
	case 20, 45, 70, 95:
		return 0, false // Not in the 25 and 8.33 kHz channel plan
	}
	return float32(name) / 1000, true
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
