/*
    Copyright (c) 2023 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    keypad.js: USB Keyboard and Knob Driver
    Features:
        - Websocket connects and receive pressed Keys
        - Local browser keyboard driver
        - User can use local or remote keyboard
        - Configurable Mapping Keys
        - Keypress and Long-Keypress supported
        - Background Service with Plugin: each screen can define the UX behaviour
        - Support for Multime Display: the key press is sent only if THIS Display is Enabled (default)

    Default Configuration: USB Knob composed by (+)[C][B][A]
    The Knob rotation are: <- 1 (2) 3->
*/



KeypadService.prototype = {
    constructor: KeypadService,
};

var URL_KEYPAD_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/keypad";
let KEYPAD_HOLD_TIMEOUT = 500 // Applicable to WS, in JS .repeat is used
// Knob with keys
let KEYPAD_MAPPING_PREV = "1"; //"MediaTrackNext"
let KEYPAD_MAPPING_TAP = "2";//"Enter"
let KEYPAD_MAPPING_NEXT = "3";//"MediaTrackPrevious"

// Media controller is defined here because the installation may be reversed
let KEYPAD_MAPPING_PREV_MEDIA = "MediaTrackNext"
let KEYPAD_MAPPING_TAP_MEDIA = "Enter"
let KEYPAD_MAPPING_NEXT_MEDIA = "MediaTrackPrevious"

function KeypadService($scope,$state, settings) {
    // Default User Settings, Mapping Key->Screen
    var keypadSettings = {
        "A": {
            href: "#/"
        },
        "B": {
            href: "#/radar"
        },
        "C": {
            href: "#/airfields"
        },
        "a": {
            href: "#/"
        },
        "b": {
            href: "#/radar"
        },
        "c": {
            href: "#/airfields"
        }
    };


    // Driver to match the Key HOLD and Key Press
    function fromKeyboardDownToKeypad(event) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page
        if (event.repeat == true) {
            if ($scope.lastKey != event.key) {
                $scope.lastKey = event.key;
                const proxy = new KeyboardEvent("keypadHold", event);
                dispatchEvent(proxy);
            }
        }
        else {
            console.log(event);
            $scope.lastKeyTime = new Date();
        }
    }

    function fromKeyboardUpToKeypad(event) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page
        console.log(event);
        var elapsed = (new Date()) - $scope.lastKeyTime;
        console.log(elapsed);
        if ($scope.lastKey == event.key) {
            console.log("Key skipped due to long press");
        }
        else {
            if ($scope.displayIsFocused == true) {
                const proxy = new KeyboardEvent("keypad", event);
                dispatchEvent(proxy);
            } else {
                console.log("Display is not focused");
            }
        }
        $scope.lastKey = null;
    }

    // Websocket
    function connect($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.keypadSocket === undefined) || ($scope.keypadSocket === null)) {
            keypadSocket = new WebSocket(URL_KEYPAD_WS);
            $scope.keypadSocket = keypadSocket; // store socket in scope for enter/exit usage
            $scope.lastKeyTime = 0;
            window.removeEventListener("keyup", fromKeyboardUpToKeypad);
            window.addEventListener("keyup", fromKeyboardUpToKeypad);
            window.removeEventListener("keyup", fromKeyboardDownToKeypad);
            window.addEventListener("keydown", fromKeyboardDownToKeypad);

        }

        // TODO UI: $scope.keypadConnectState = "Disconnected";

        $scope.keypadSocket.onopen = function (msg) {
            // TODO UI: $scope.keypadConnectState = "Connected";
        };

        $scope.keypadSocket.onclose = function (msg) {
            // TODO UI: $scope.keypadConnectState = "Disconnected";
            delete $scope.keypadSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.keypadSocket.onerror = function (msg) {
            // TODO UI: $scope.keypadConnectState = "Error";
        };

        $scope.keypadSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            console.log(msg);
            var k = JSON.parse(msg.data);
            if(k.key=="")return;
            switch (k.status) {
                case 0: // KeyRelease
                    // Key has being relesed
                    if ($scope.displayIsFocused == true) {
                        const proxy = new KeyboardEvent("keypad", k);
                        dispatchEvent(proxy);
                    }
                    else {
                        console.log("Display is not focused");
                    }
                    break;
                case 1: // KeyPress
                    break;
                case 2: // KeyHold
                    // Key has being relesed
                    if ($scope.displayIsFocused == true || true) { // Always passing Hold buttons
                        const proxy = new KeyboardEvent("keypadHold", k);
                        dispatchEvent(proxy);
                    }
                    else {
                        console.log("Display is not focused");
                    }
                    break;
            }

        };
    }

    // Multi Display support
    // By default all Displays are Keypad Enabled
    $scope.displayIsFocused = true;

    connect($scope);

    window.addEventListener("keypadHold", (event) => {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page
        console.log(event);
        // Multi Display support
        if (window.localStorage.getItem("displayName") === undefined || window.localStorage.getItem("displayName") === false || window.localStorage.getItem("displayName") == null) {
            // Multi Display support Default Name
            //window.localStorage.setItem("displayName","A");
        }
        else {
            $scope.displayIsFocused = (event.key == window.localStorage.getItem("displayName"));
            $scope.$apply()
        }

    });


    $scope.onclickDom = function(event){
        const z = ZoneFinder(event);
		console.log("DOM Clicked "+ z + " Controller: "+$state.current.controller);
        const proxy = new KeyboardEvent("keypad", { key: z});
		//dispatchEvent(proxy);
		return false;
	}

	addEventListener("click", $scope.onclickDom,{passive :true});


    /**
     * User experience based on a big centered rotary on center to show the selector
     */
    // Current Rotary Status
    $scope.keypadKnobLastDeg = 0;
    $scope.keypadKnobLastTitle = "Home";
    // Current Rotary Items
    $scope.keypadKnobItems = [
        { href: "#/alerts", deg: 270, iconClass: "fa-exclamation-triangle", "color": "green" },
        { href: "#/traffic", deg: 315, iconClass: "fa-plane", "color": "gray" },
        { href: "#/radar", deg: 0, iconClass: "fa-street-view", "color": "gray" },
        { href: "#/map", deg: 45, iconClass: "fa-map", "color": "gray" },
        { href: "#/gps", deg: 90, iconClass: "fa-globe", "color": "gray" },
        { href: "#/camera", deg: 135, iconClass: "fa-camera", "color": "gray" },
        { href: "#/autopilot", deg: 180, iconClass: "fa-location-arrow", "color": "gray" },
        { href: "#/timers", deg: 225, iconClass: "fa-clock-o", "color": "gray" }
    ];
    // Current Rotary Navigation Pattern: Left Side Menu
    var keypadSettingsNavigation = {


        "#/radar": {
            "SwipeRight": "#/",
            "ArrowRight": "#/",
            "ArrowDown": "#/",
            "3": "#/",
            "to": "#/",
            "from": "#/map",
            "SwipeLeft": "#/map",
            "ArrowLeft": "#/map",
            "ArrowUp": "#/map",
            "1": "#/map",
            "knobDeg": 0,
            "title": "Radar"
        },
        "#/": {
            "disableRotary": true,
            "SwipeRight": "",
            "ArrowRight": "#/hsi",
            "ArrowDown": "#/hsi",
            "3": "#/hsi",
            "to": "#/hsi",
            "from": "#/radar",
            "SwipeLeft": "",
            "ArrowLeft": "#/radar",
            "ArrowUp": "#/",
            "1": "#/radar",
            "knobDeg": 0,
            "title": "Home"
        },
        "#/hsi": {
            "disableRotary": true,
            "SwipeRight": "#/roundviewspeed",
            "ArrowRight": "#/roundviewspeed",
            "E": "#/roundviewspeed",
            "ArrowDown": "#/roundviewspeed",
            "3": "#/roundviewspeed",
            "to": "#/roundviewspeed",
            "from": "#/",
            "SwipeLeft": "#/",
            "ArrowLeft": "#/",
            "W": "#/",
            "ArrowUp": "#/",
            "1": "#/",
            "knobDeg": 0,
            "title": "HSI"
        },
        "#/roundviewspeed": {
            "disableRotary": true,
            "SwipeRight": "#/roundviewattitude",
            "ArrowRight": "#/roundviewattitude",
            "E": "#/roundviewattitude",
            "ArrowDown": "#/roundviewattitude",
            "3": "#/roundviewattitude",
            "to": "#/roundviewattitude",
            "from": "#/hsi",
            "SwipeLeft": "#/hsi",
            "ArrowLeft": "#/hsi",
            "W": "#/hsi",
            "ArrowUp": "#/hsi",
            "1": "#/hsi",
            "knobDeg": 0,
            "title": "IAS"
        },
        "#/roundviewspeed": {
            "disableRotary": true,
            "SwipeRight": "#/roundviewattitude",
            "ArrowRight": "#/roundviewattitude",
            "E": "#/roundviewattitude",
            "ArrowDown": "#/roundviewattitude",
            "3": "#/roundviewattitude",
            "to": "#/roundviewattitude",
            "from": "#/hsi",
            "SwipeLeft": "#/hsi",
            "ArrowLeft": "#/hsi",
            "W": "#/hsi",
            "ArrowUp": "#/hsi",
            "1": "#/hsi",
            "knobDeg": 0,
            "title": "IAS"
        },
        "#/roundviewattitude": {
            "disableRotary": true,
            "SwipeRight": "#/roundviewaltimeter",
            "ArrowRight": "#/roundviewaltimeter",
            "E": "#/roundviewaltimeter",
            "ArrowDown": "#/roundviewaltimeter",
            "3": "#/roundviewaltimeter",
            "to": "#/roundviewaltimeter",
            "from": "#/roundviewspeed",
            "SwipeLeft": "#/roundviewspeed",
            "ArrowLeft": "#/roundviewspeed",
            "W": "#/roundviewspeed",
            "ArrowUp": "#/roundviewspeed",
            "1": "#/roundviewspeed",
            "knobDeg": 0,
            "title": "Attitude"
        },
        "#/roundviewaltimeter": {
            "disableRotary": true,
            "SwipeRight": "#/roundviewball",
            "ArrowRight": "#/roundviewball",
            "E": "#/roundviewball",
            "ArrowDown": "#/roundviewball",
            "3": "#/roundviewball",
            "to": "#/roundviewball",
            "from": "#/roundviewattitude",
            "SwipeLeft": "#/roundviewattitude",
            "ArrowLeft": "#/roundviewattitude",
            "W": "#/roundviewattitude",
            "ArrowUp": "#/roundviewattitude",
            "1": "#/roundviewattitude",
            "knobDeg": 0,
            "title": "Altimeter"
        },
        "#/roundviewball": {
            "disableRotary": true,
            "SwipeRight": "#/roundviewgyro",
            "ArrowRight": "#/roundviewgyro",
            "E": "#/roundviewgyro",
            "ArrowDown": "#/roundviewgyro",
            "3": "#/roundviewgyro",
            "to": "#/roundviewgyro",
            "from": "#/roundviewaltimeter",
            "SwipeLeft": "#/roundviewaltimeter",
            "ArrowLeft": "#/roundviewaltimeter",
            "W": "#/roundviewaltimeter",
            "ArrowUp": "#/roundviewaltimeter",
            "1": "#/roundviewaltimeter",
            "knobDeg": 0,
            "title": "Turn - Slip"
        },
        "#/roundviewgyro": {
            "disableRotary": true,
            "SwipeRight": "#/roundviewvariometer",
            "ArrowRight": "#/roundviewvariometer",
            "E": "#/roundviewvariometer",
            "ArrowDown": "#/roundviewvariometer",
            "3": "#/roundviewvariometer",
            "to": "#/roundviewvariometer",
            "from": "#/roundviewball",
            "SwipeLeft": "#/roundviewball",
            "ArrowLeft": "#/roundviewball",
            "W": "#/roundviewball",
            "ArrowUp": "#/roundviewball",
            "1": "#/roundviewball",
            "knobDeg": 0,
            "title": "Gyro"
        },
        "#/roundviewvariometer": {
            "disableRotary": true,
            "SwipeRight": "#/resources",
            "ArrowRight": "#/resources",
            "E": "#/resources",
            "ArrowDown": "#/resources",
            "3": "#/resources",
            "to": "#/resources",
            "from": "#/roundviewgyro",
            "SwipeLeft": "#/roundviewgyro",
            "ArrowLeft": "#/roundviewgyro",
            "W": "#/roundviewgyro",
            "ArrowUp": "#/roundviewgyro",
            "1": "#/roundviewgyro",
            "knobDeg": 0,
            "title": "Variometer"
        },
        "#/resources": {
            "disableRotary": true,
            "SwipeRight": "#/airfields",
            "ArrowRight": "#/airfields",
            "E": "#/airfields",
            "ArrowDown": "#/airfields",
            "3": "#/airfields",
            "to": "#/airfields",
            "from": "#/roundviewvariometer",
            "SwipeLeft": "#/roundviewvariometer",
            "ArrowLeft": "#/roundviewvariometer",
            "W": "#/roundviewvariometer",
            "ArrowUp": "#/roundviewvariometer",
            "1": "#/roundviewvariometer",
            "knobDeg": 0,
            "title": "Resources"
        },

        "#/airfields": {
            "disableRotary": true,
            "SwipeRight": "#/timers",
            "ArrowRight": "#/timers",
            "ArrowDown": "#/timers",
            "3": "#/timers",
            "E":"",
            "to": "#/timers",
            "from": "#/resources",
            "W":"",
            "SwipeLeft": "#/resources",
            "ArrowLeft": "#/resources",
            "ArrowUp": "#/resources",
            "1": "#/resources",
            "knobDeg": 0,
            "title": "Airfields"
        },


        "#/roundview": {
            "SwipeRight": "#/timers",
            "ArrowRight": "#/timers",
            "ArrowDown": "#/timers",
            "3": "#/timers",
            "to": "#/timers",
            "from": "#/hsi",
            "SwipeLeft": "#/hsi",
            "ArrowLeft": "#/hsi",
            "ArrowUp": "#/hsi",
            "1": "#/hsi",
            "knobDeg": 0,
            "title": "Round View"
        },


        "#/timers": {
            "disableRotary": true,
            "SwipeRight": "#/radio",
            "ArrowRight": "#/radio",
            "ArrowDown": "#/radio",
            "3": "#/radio",
            "to": "#/radio",
            "SwipeLeft": "#/airfields",
            "from": "#/airfields",
            "ArrowLeft": "#/airfields",
            "ArrowUp": "#/airfields",
            "1": "#/airfields",
            "knobDeg": 0,
            "title": "Timers"
        },
        "#/radio": {
            "disableRotary": true,
            "SwipeRight": "#/switchboard",
            "ArrowRight": "#/switchboard",
            "ArrowDown": "#/switchboard",
            "3": "#/switchboard",
            "to": "#/switchboard",
            "from": "#/timers",
            "SwipeLeft": "#/timers",
            "ArrowLeft": "#/timers",
            "ArrowUp": "#/timers",
            "1": "#/timers",
            "knobDeg": 0,
            "title": "Radio"
        },  
        "#/autopilot": {
            "disableRotary": true,
            "SwipeRight": "#/map",
            "ArrowRight": "#/map",
            "ArrowDown": "#/map",
            "3": "#/map",
            "to": "#/map",
            "from": "#/radio",
            "SwipeLeft": "#/radio",
            "ArrowLeft": "#/radio",
            "ArrowUp": "#/radio",
            "1": "#/radio",
            "knobDeg": 0,
            "title": "Autopilot"
        },
        "#/camera": {
            "disableRotary": true,
            "ArrowRight": "#/map",
            "ArrowDown": "#/map",
            "3": "#/map",
            "to": "#/map",
            "from": "#/autopilot",
            "ArrowLeft": "#/autopilot",
            "ArrowUp": "#/autopilot",
            "1": "#/autopilot",
            "knobDeg": 0,
            "title": "Camera"
        },

        "#/cockpit": {
            "disableRotary": true,
            "SwipeRight": "#/synthview",
            "ArrowRight": "#/synthview",
            "ArrowDown": "#/synthview",
            "3": "#/synthview",
            "to": "#/synthview",
            "from": "#/",
            "SwipeLeft": "#/",
            "ArrowLeft": "#/",
            "ArrowUp": "#/",
            "1": "#/",
            "knobDeg": 0,
            "title": "Cockpit"
        },
        "#/synthview": {
            "disableRotary": true,
            "ArrowRight": "#/radio",
            "ArrowDown": "#/radio",
            "3": "#/radio",
            "to": "#/radio",
            "from": "#/cockpit",
            "ArrowLeft": "#/cockpit",
            "ArrowUp": "#/cockpit",
            "1": "#/cockpit",
            "knobDeg": 0,
            "title": "SynthView"
        },

      
        "#/traffic": {
            "SwipeRight": "#/",
            "ArrowRight": "#/",
            "ArrowDown": "#/",
            "3": "#/",
            "to": "#/",
            "from": "#/",
            "SwipeLeft": "#/",
            "ArrowLeft": "#/",
            "ArrowUp": "#/",
            "1": "#/",
            "knobDeg": 0,
            "title": "Traffic"
        },
        "#/gps": {
            "SwipeRight": "#/",
            "ArrowRight": "#/",
            "ArrowDown": "#/",
            "3": "#/",
            "to": "#/",
            "from": "#/",
            "SwipeLeft": "#/",
            "ArrowLeft": "#/",
            "ArrowUp": "#/",
            "1": "#/",
            "knobDeg": 0,
            "title": "GPS"
        },

        "#/logs": {
            "ArrowRight": "#/",
            "ArrowDown": "#/",
            "3": "#/",
            "to": "#/",
            "from": "#/",
            "ArrowLeft": "#/",
            "ArrowUp": "#/",
            "1": "#/",
            "knobDeg": 0,
            "title": "Logs"
        },
        "#/settings": {
            "ArrowRight": "#/",
            "ArrowDown": "#/",
            "3": "#/",
            "to": "#/",
            "from": "#/logs",
            "ArrowLeft": "#/",
            "ArrowUp": "#/",
            "1": "#/",
            "knobDeg": 0,
            "title": "Settings"
        },

        "#/switchboard": {
            "SwipeRight": "#/radar",
            "ArrowRight": "#/radar",
            "ArrowDown": "#/radar",
            "3": "#/radar",
            "to": "#/radar",
            "SwipeLeft": "#/radio",
            "from": "#/radio",
            "ArrowLeft": "#/radio",
            "ArrowUp": "#/radio",
            "1": "#/radio",
            "knobDeg": 0,
            "title": "Switchboard"
        },

        "#/map": {
            "SwipeRight": "#/radar",
            "ArrowRight": "#/radar",
            "ArrowDown": "#/radar",
            "3": "#/radar",
            "to": "#/radar",
            "SwipeLeft": "#/switchboard",
            "from": "#/switchboard",
            "ArrowLeft": "#/switchboard",
            "ArrowUp": "#/switchboard",
            "1": "#/switchboard",
            "knobDeg": 0,
            "title": "Map"
        },

        "#/alerts": {
            "ArrowRight": "#/",
            "ArrowDown": "#/",
            "3": "#/",
            "to": "#/",
            "from": "#/",
            "ArrowLeft": "#/",
            "ArrowUp": "#/",
            "1": "#/",
            "knobDeg": 0,
            "title": "Alerts"
        },
        "#/checklist": {
            "disableRotary": true,
            "ArrowRight": "#/",
            "ArrowDown": "#/",
            "3": "#/",
            "to": "#/",
            "from": "#/",
            "ArrowLeft": "#/",
            "ArrowUp": "#/",
            "1": "#/",
            "knobDeg": 0,
            "title": "Checklist"
        },
        "#/charts": {
            "ArrowRight": "#/",
            "ArrowDown": "#/",
            "3": "#/",
            "to": "#/",
            "from": "#/",
            "ArrowLeft": "#/",
            "ArrowUp": "#/",
            "1": "#/",
            "knobDeg": 0,
            "title": "Charts"
        }

    };
    // Current Rotary Navigation Pattern: ROTARY at 8 positions, uncomment when Rotary is used
    /*
    var keypadSettingsNavigation = {
        "#/": {
            "ArrowRight": "#/alerts",
            "ArrowDown": "#/alerts",
            "3": "#/alerts",
            "knobDeg": 270,
            "title": "Home",
        },
        "#/alerts": {
            "title": "Alerts",
            "from": "#/timers",
            "to": "#/traffic",
            "ArrowRight": "#/traffic",
            "ArrowDown": "#/traffic",
            "3": "#/traffic",
            "ArrowLeft": "#/timers",
            "ArrowUp": "#/timers",
            "1": "#/timers",
            "knobDeg": 270
        },


        "#/traffic": {
            "title": "Traffic",
            "from": "#/alerts",
            "to": "#/radar",
            "ArrowRight": "#/radar",
            "ArrowDown": "#/radar",
            "3": "#/radar",
            "ArrowLeft": "#/alerts",
            "ArrowUp": "#/alerts",
            "1": "#/alerts",
            "knobDeg": 315
        },
        "#/radar": {
            "title": "Radar",
            "ArrowRight": "#/map",
            "ArrowDown": "#/map",
            "3": "#/map",
            "ArrowLeft": "#/traffic",
            "ArrowUp": "#/traffic",
            "1": "#/traffic",
            "knobDeg": 0
        },
        "#/map": {
            "title": "Map",
            "ArrowRight": "#/gps",
            "ArrowDown": "#/gps",
            "3": "#/gps",
            "ArrowLeft": "#/radar",
            "ArrowUp": "#/radar",
            "1": "#/radar",
            "knobDeg": 45
        },
        "#/gps": {
            "title": "EFIS",
            "ArrowRight": "#/camera",
            "ArrowDown": "#/camera",
            "3": "#/camera",
            "ArrowLeft": "#/map",
            "ArrowUp": "#/map",
            "1": "#/map",
            "knobDeg": 90
        },

        "#/camera": {
            "title": "Camera",
            "ArrowRight": "#/autopilot",
            "ArrowDown": "#/autopilot",
            "3": "#/autopilot",
            "ArrowLeft": "#/gps",
            "ArrowUp": "#/gps",
            "1": "#/gps",
            "knobDeg": 135
        },
        "#/autopilot": {
            "title": "Autopilot",
            "from": "#/camera",
            "to": "#/timers",
            "1": "#/camera",
            "3": "#/timers",
            "disableRotary": true,
            "knobDeg": 180
        },
        "#/timers": {
            "title": "Timers",
            "from": "#/autopilot",
            "1": "#/autopilot",
            "3": "#/alerts",
            "to": "#/alerts",
            "disableRotary": true,
            "knobDeg": 225
        }
    }
    */

    window.addEventListener("keypad", (event) => {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page
        console.log(event);

        // Joystick mapping
        switch (event.key) {
            case "MediaFastForward":
                event = {};
                event.key = "ArrowLeft";
                break;
            case "MediaRewind":
                event = {};
                event.key = "ArrowRight";
                break;
            case "ENTER":
                event = {};
                event.key = "Enter";
                break;
            case "MediaTrackNext":
                event = {};
                event.key = "ArrowUp";
                break;
            case "MediaTrackPrevious":
                event = {};
                event.key = "ArrowDown";
                break;
            case "AudioVolumeUp":
                event = {};
                event.key = "SwipeLeft";
                break;
            case "AudioVolumeDown":
                event = {};
                event.key = "SwipeRight";
                break;
            case "MediaPlayPause":
                event = {};
                event.key = "A";
                break;
        }

        if (keypadSettings.hasOwnProperty(event.key)) {
            if (keypadSettings[event.key].href.length > 0) {
                document.location = keypadSettings[event.key].href;
            }
        }
        else {
            // Check for vertical navigation
            if (keypadSettingsNavigation.hasOwnProperty(document.location.hash)) {
                if (keypadSettingsNavigation[document.location.hash].hasOwnProperty(event.key)) {
                    if (keypadSettingsNavigation[document.location.hash][event.key].length > 0) {
                        if ((event.key == "SwipeRight" || event.key == "SwipeLeft")) {
                            var nextLocation = keypadSettingsNavigation[document.location.hash][event.key];
                            console.log("Swipe direct to:"+nextLocation);
                            document.location = nextLocation;
                            return;
                        }
                        if (keypadSettingsNavigation[document.location.hash].hasOwnProperty("disableRotary") == false || event.key == "to" || event.key == "from" || $scope.keypadKnobTimerRemovePopup !== undefined) {
                            $scope.keypadShowRotary(event.key);
                            $scope.$apply();
                        }
                    }
                }
            }
        }
    });

    function keypadHideRotary() {
        clearInterval($scope.keypadKnobTimerRemovePopup);
        delete $scope.keypadKnobTimerRemovePopup
        $scope.Ui.turnOff("keypadModal");
        //var nextLocation = keypadSettingsNavigation[document.location.hash][key];
        // Using this feature many 1000 times requires a "async" to load the screen, do not apply now
        // UN-Comment this line if Rotary is used "keypadModal" or NO-USE this line if apply the Left Side Menu
        document.location = $scope.keypadKnobLastLocation
        
        // Not required because it is triggered by Angular
        //$scope.$apply(); 
    }

    $scope.keypadShowRotary = function (key) {
        if ($scope.keypadKnobTimerRemovePopup === undefined) {
            // First popup than wait for the user choice
            $scope.keypadKnobTimerRemovePopup = setInterval(keypadHideRotary, 1000);
            $scope.Ui.turnOn("keypadModal");
            $scope.keypadKnobLastLocation = document.location.hash;
            return;
        }
        else {
            clearInterval($scope.keypadKnobTimerRemovePopup);
            delete $scope.keypadKnobTimerRemovePopup
        }

        $scope.keypadKnobTimerRemovePopup = setInterval(keypadHideRotary, 1000);
        $scope.Ui.turnOn("keypadModal");
        document.getElementById("keypadModalDiv").style="";

        if (keypadSettingsNavigation.hasOwnProperty($scope.keypadKnobLastLocation)) {
            if (keypadSettingsNavigation[$scope.keypadKnobLastLocation].hasOwnProperty(key)) {
                var nextLocation = keypadSettingsNavigation[$scope.keypadKnobLastLocation][key];
                //console.log("nextLocation=" + nextLocation + " document.location.hash=" + document.location.hash + " key=" + key)
                $scope.keypadKnobLastTitle = keypadSettingsNavigation[nextLocation].title;
                $scope.keypadKnobLastDeg = keypadSettingsNavigation[nextLocation].knobDeg;
                $scope.keypadKnobLastLocation = nextLocation;
                // Using this feature many 1000 times requires a "async" to load the screen, do not apply now
                // Comment this line if Rotary is used "keypadModal" or USE this line if apply the Left Side Menu
                //document.location = nextLocation
            }
        }
        else {

        }
        for (var knobRotaryItemIndex = 0; knobRotaryItemIndex < $scope.keypadKnobItems.length; knobRotaryItemIndex++) {
            if ($scope.keypadKnobLastDeg == $scope.keypadKnobItems[knobRotaryItemIndex]["deg"]) {
                $scope.keypadKnobItems[knobRotaryItemIndex]["color"] = "red";
            }
            else {
                $scope.keypadKnobItems[knobRotaryItemIndex]["color"] = "gray";
            }
        }
    }
}




function ZoneFinder(event){
	const ZoneMapping = [
		["NW", "N", "NE"],
		["W", "C", "E"],
		["SW", "S", "SE"],
	];
	const ZoneCount = ZoneMapping.length; // Start-Center-End
	const VerticalZoneSize = window.innerHeight / ZoneCount;
	const HorizontalZoneSize = window.innerWidth / ZoneCount;
	const VerticalZone = parseInt(event.clientY / VerticalZoneSize);
	const HorizontalZone = parseInt(event.clientX / HorizontalZoneSize);
	const zone = ZoneMapping[VerticalZone][HorizontalZone];
	
	return zone;
}