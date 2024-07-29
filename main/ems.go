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
)

type EMSStratuxPlugin struct {
    StratuxPlugin
	emsData map[string] float32
	emsDataMutex *sync.Mutex
}

var ems = EMSStratuxPlugin{}


func (emsInstance *EMSStratuxPlugin)InitFunc() bool {
	log.Println("Entered EMS init() ...")
	emsInstance.Name = "Unix Socket"
	log.Println("EMS Driver: ",emsInstance.Name)
	emsInstance.emsDataMutex = &sync.Mutex{}
	emsInstance.emsData = make(map[string]float32)
	go emsInstance.ListenerFunc()
	return true
}

func (emsInstance *EMSStratuxPlugin)ListenerFunc() bool {
	return true
}


func (emsInstance *EMSStratuxPlugin)ShutdownFunc() bool {
	log.Println("Entered EMS shutdown() ...")
	return true
}
