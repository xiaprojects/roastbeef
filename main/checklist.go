/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	checklist.go: Checklist interface

	Features:
	- Restore from: "/boot/firmware/checklist/{{aircraft}}.json"
	- Memory Storage current checklist status
	- Update the checklist
	- Multiple Aircraft supported

	Roadmap:
	- Checklist editor
	- Alarm in case of missing checklist
	- Archive into USB Storage the checklist execution
	- Autofill the checklist (such as EMS Temperatures)
	- Text to Speach
	- Maintenance Checklist
	- PDF Export
*/

/*
The Checklist is composed by []Parent->[]Item

Example format:
[
  {
    "isselected": "",
    "value": "todo",
    "id": 0,
    "name": "PRE-FLIGHT",
    "text": "DOLIST",
    "date": "",
    "dateParsed": "__:__",
    "items": [
      {
        "isselected": "",
        "value": "todo",
        "id": 0,
        "date": "",
        "dateParsed": "__:__",
        "name": "SEATBELT",
        "name": "",
        "text": "FASTEN"
      }
    ]
  }
]
*/

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
)

type CheckStratuxPlugin struct {
    StratuxPlugin
	checklistDataMutex *sync.Mutex
	checklistData []interface{}
}

var checklist = CheckStratuxPlugin{}

func (checklistInstance *CheckStratuxPlugin)InitFunc() bool {
	log.Println("Entered CheckStratuxPlugin init() ...")
	checklistInstance.Name = "Memory"
	checklistInstance.checklistDataMutex = &sync.Mutex{}
	log.Println("Checklist Driver: ",checklistInstance.Name)
	checklistInstance.checklistData = make([]interface{}, 0)
	// Load Specified Aircraft Checklist
	// TODO: delay this and put into a map
	checklistByAircraft := "/boot/firmware/checklist/default.json"
	log.Println("Checklist loading: ", checklistByAircraft)
	byteValue, _ := os.ReadFile(checklistByAircraft)
	err := json.Unmarshal(byteValue, &checklist.checklistData)
	if err != nil {
		fmt.Println(err)
	}
	return true
}


func (checklistInstance *CheckStratuxPlugin)ShutdownFunc() bool {
	log.Println("Entered CheckStratuxPlugin shutdown() ...")
	return true
}
