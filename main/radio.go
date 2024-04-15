/*
	Copyright (c) 2023 Stefanux
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	ems.go: Engine Management System Interface
*/

package main

import (
	"log"
	"sync"
	"time"
)


const (
	RADIO_DRIVER_SDR = 			"SDR"
	RADIO_DRIVER_RS232 = 		"SERIAL"
)

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
	radioInstance.radioData = make([]RadioStatus, 0)

	radioInstance.radioData = append(radioInstance.radioData, RadioStatus{Name: "KRT2 Remote Radio",SquelchLevel: 5,VolumeLevel: 8,FrequencyActive: "125.600",FrequencyStandby: "125.750",Enabled: false,Driver: "SERIAL",Path: ""})
	radioInstance.radioData = append(radioInstance.radioData, RadioStatus{Name: "SDR Internal Radio",SquelchLevel: 5,VolumeLevel: 8,FrequencyActive: "130.000",FrequencyStandby: "118.180",Enabled: true,Driver: "SDR",Path: ""})

	go radioInstance.radioThread()
	return true
}
func (radioInstance *RadioStratuxPlugin) radioThread() {
	for radioInstance.requestToExit == false {
		if globalSettings.Radio_Enabled == true {
		}
		time.Sleep(1 * time.Second)
	}
}

func (radioInstance *RadioStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered RadioStratuxPlugin shutdown() ...")
	radioInstance.requestToExit = true
	return true
}
