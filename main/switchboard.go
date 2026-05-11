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
    07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
    08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder

	Community edition will be free for all builders and personal use as defined by the licensing model
	Dual licensing for commercial agreement is available
	Please join Discord community
*/

package main

import (
	"log"
	"os/exec"
	"time"
)


const (
	SW_TYPE_NONE                        = 0
	SW_TYPE_URL                         = 1
	SW_TYPE_CMD                         = 2
	SW_TYPE_INTERNAL                    = 3
	SW_TYPE_GPIO                        = 4
	SW_TYPE_UI_CMD                      = 5
	SW_STATUS_UNKNOWN                   = 0
	SW_STATUS_RUNNING                   = 1
	SW_STATUS_FINISH_0                  = 2
	SW_STATUS_FINISH_1                  = 3
	SW_STATUS_FINISH_2                  = 4
)

// Resource Parsing
type switchModel struct {
	Name  string
	Type  int
	Status int
	Uri  string
	UriStatus string
	EpochStart int64
	EpochFinish int64
}




type SwitchBoardStratuxPlugin struct {
    StratuxPlugin
}
// Shared instance
var switchBoard = SwitchBoardStratuxPlugin{}

/*
plugin.InitFunc().

	initialise the mutex and local variables
	load default configuration
	start thread in background, if any
*/
func (switchBoard *SwitchBoardStratuxPlugin)InitFunc() bool {
	log.Println("Entered SwitchBoardStratuxPlugin init() ...")
	switchBoard.Name = "SwitchBoard"
	return true
}

/*
plugin.ShutdownFunc().

	set halt variable status to allow thread gracefully exit, if any
*/
func (switchBoard *SwitchBoardStratuxPlugin)ShutdownFunc() bool {
	log.Println("Entered SwitchBoardStratuxPlugin shutdown() ...")
	return true
}



func (switchBoard *SwitchBoardStratuxPlugin)executeCommandLine(command string) int {
	cmd := exec.Command("/usr/bin/bash","-c",command)
	if err := cmd.Run(); err != nil {
		return SW_STATUS_FINISH_2
	}
	return SW_STATUS_FINISH_0
}


func (switchBoard *SwitchBoardStratuxPlugin)forkCommand(msg switchModel, updateId int) error {
    cmd := exec.Command("/usr/bin/bash","-c", msg.Uri )
    err := cmd.Start()
    if err != nil {
        return err
    }
    //pid := cmd.Process.Pid
    // use goroutine waiting, manage process
    // this is important, otherwise the process becomes in S mode
    go func() { 
        err = cmd.Wait()
		msg.EpochFinish = time.Now().Unix()
        log.Println("Command finished with error: %v", err)
		if err != nil {
			msg.Status = SW_STATUS_FINISH_1
		} else {
			msg.Status = SW_STATUS_FINISH_0 
		}

		// TODO: Mutex
		globalSettings.Switches[updateId] = msg
		
    }()

	return nil
}

