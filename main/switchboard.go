/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	switchboard.go: Switch interface

	Replacement for the following variables:
	-
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

