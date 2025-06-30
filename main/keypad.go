/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	keypad.go: USB Keyboard and Knob Driver
*/

package main

import (
	"log"
	"time"

	"github.com/MarinX/keylogger"
)

/*
	Knob Conf
	<- 1 (2) 3->
	C
	B
	A
*/

type KeypadStratuxPlugin struct {
	StratuxPlugin
	device *keylogger.KeyLogger
	timer *time.Timer
}

var keypad = KeypadStratuxPlugin{}

func (keypadInstance *KeypadStratuxPlugin) InitFunc() bool {
	log.Println("Entered KeypadStratuxPlugin init() ...")
	keypadInstance.Name = "Keypad"
	keypadInstance.device = nil
	keypadInstance.timer = time.NewTimer(0)
	go keypadInstance.ListenerFunc()
	return true
}

func (keypadInstance *KeypadStratuxPlugin) isConnected() bool {
	return keypad.device == nil
}

func (keypadInstance *KeypadStratuxPlugin) ListenerFuncHoldKey(k string) {
	keypadInstance.timer = time.NewTimer(500 * time.Millisecond)
    select {
    case <-keypadInstance.timer.C:
        //if globalSettings.DEBUG {
							log.Println("[event] hold key ", k)
							//}
							msg := make(map[string]interface{})
							msg["key"]= k
							msg["status"] = 2
							keypadUpdate.SendJSON(msg)
    }
}

func (keypadInstance *KeypadStratuxPlugin) ListenerFunc() {

	for {
		time.Sleep(1 * time.Second)
		if globalSettings.Keypad_Enabled {
			log.Println("Entered KeypadStratuxPlugin ListenerFunc() ...")
			// find keyboard device, does not require a root permission
			keyboard := keylogger.FindKeyboardDevice()

			// check if we found a path to keyboard
			if len(keyboard) <= 0 {
				log.Println("No keyboard found...")
				time.Sleep(60 * time.Second)
				continue
			}
			log.Println("Found a keyboard at", keyboard)
			keypadInstance.Name = keyboard
			// init keylogger with keyboard
			k, err := keylogger.New(keyboard)
			if err != nil {
				log.Println(err)
				return
			}
			//defer k.Close() // Closed by external thread
			keypadInstance.device = k
			events := keypadInstance.device.Read()
			// range of events
			for e := range events {
				// check if the user switched enabled to disabled
				if globalSettings.Keypad_Enabled == false {
					break;
				}
				switch e.Type {
				// EvKey is used to describe state changes of keyboards, buttons, or other key-like devices.
				// check the input_event.go for more events
				case keylogger.EvKey:
					// if the state of key is pressed
					if e.KeyPress() {
						//if globalSettings.DEBUG {
							log.Println("[event] press key ", e.KeyString())
							//}
							var k string
							k = e.KeyString()
							/*
							msg := make(map[string]interface{})
							msg["key"]= k
							msg["status"] = 1
							keypadUpdate.SendJSON(msg)
							*/
							keypadInstance.timer.Stop()
							
							go keypadInstance.ListenerFuncHoldKey(k)

					}
					// if the state of key is released
					if e.KeyRelease() {

						if(keypadInstance.timer.Stop()==true){
						//if globalSettings.DEBUG {
						log.Println("[event] release key ", e.KeyString())
						//}
						msg := make(map[string]interface{})
						var k string
						k = e.KeyString()
						msg["key"]= k
						msg["status"] = 0
						keypadUpdate.SendJSON(msg)
						}
					}
					
					break
				}
			}
			// Exit the keyboard loop
			break
		}
	}

	log.Println("Entered KeypadStratuxPlugin done() ...")
}

func (keypad *KeypadStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered KeypadStratuxPlugin shutdown() ...")
	if keypad != nil {
		if keypad.isConnected() {
			if keypad.device != nil {
				keypad.device.Close()
			}
		}
	}
	return true
}
