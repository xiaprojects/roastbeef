/**
 * This file is part of RB.
 *
 * Copyright (C) 2023-2025 XIAPROJECTS SRL
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.

 * This source is part of the project RB:
 * 01 -> Display with Synthetic vision, Autopilot and ADSB
 * 02 -> Display with SixPack
 * 03 -> Display with Autopilot, ADSB, Radio, Flight Computer
 * 04 -> Display with EMS: Engine monitoring system
 * 05 -> Display with Stratux BLE Traffic
 * 06 -> Display with Android
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 *
 *
 * keypad.js: USB Keyboard and Knob Driver
 * Features:
 * - Websocket connects and receive pressed Keys
 * - Local browser keyboard driver
 * - User can use local or remote keyboard
 * - Configurable Mapping Keys
 * - Keypress and Long-Keypress supported
 * - Background Service with Plugin: each screen can define the UX behaviour
 * - Support for Multime Display: the key press is sent only if THIS Display is Enabled (default)
 * Default Configuration: USB Knob composed by (+)[C][B][A]
 * The Knob rotation are: <- 1 (2) 3->
 */



KeypadService.prototype = {
    constructor: KeypadService,
};

var URL_KEYPAD_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/keypad";
var URL_KEYPAD_SETTINGS_GET = "settings/keypad.json";
var URL_KEYPAD_NAVIGATION_GET = "settings/navigation.json";

const KEYPAD_MAPPING_PREV = "KEYPAD_MAPPING_PREV";
const KEYPAD_MAPPING_TAP = "KEYPAD_MAPPING_TAP";
const KEYPAD_MAPPING_NEXT = "KEYPAD_MAPPING_NEXT";
const SwipeLeft = "SwipeLeft";
const SwipeRight = "SwipeRight";

function KeypadService($scope, $http, $state) {
    $scope.keypadSettings = {};
    $scope.keypadSettingsNavigation = {};


    $http.get(URL_KEYPAD_SETTINGS_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        if (db === undefined || Object.keys(db).length == 0) {
            return;
        }
        $scope.keypadSettings = db.keypad;
    });
    $http.get(URL_KEYPAD_NAVIGATION_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        if (db === undefined || Object.keys(db).length == 0) {
            return;
        }
        $scope.keypadSettingsNavigation = db.navigationSort;
        const k=whichKeywordIsForThisDisplay();
        if(db.hasOwnProperty("navigationSort"+k)){
            $scope.keypadSettingsNavigation = db["navigationSort"+k];
        }
    });


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
                const proxy = new KeyboardEvent("key", event);
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
            if (k.key == "") return;
            switch (k.status) {
                case 0: // KeyRelease
                    // Key has being relesed
                    if ($scope.displayIsFocused == true) {
                        const proxy = new KeyboardEvent("key", k);
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
        // in this RB- we are not using multiple remote display, only locals.
    });




    function keyToFunction(key) {
        // create a cache
        if ($scope.keypadSettings.hasOwnProperty("cacheFunctions")) {

        }
        else {
            var cacheFunctions = {};
            const functionList = [
                KEYPAD_MAPPING_PREV,
                KEYPAD_MAPPING_TAP,
                KEYPAD_MAPPING_NEXT,
                SwipeLeft,
                SwipeRight];
            functionList.forEach(fun => {
                const list = $scope.keypadSettings[fun];
                list.forEach(element => {
                    cacheFunctions[element] = fun;
                });

            });

            $scope.keypadSettings["cacheFunctions"] = cacheFunctions;
        }
        return $scope.keypadSettings.cacheFunctions[key];
    }


    window.addEventListener("key", (event) => {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page
        console.log(event);

        if ($scope.keypadSettings.directKey.hasOwnProperty(event.key)) {
            if ($scope.keypadSettings.directKey[event.key].hasOwnProperty("href") && $scope.keypadSettings.directKey[event.key].length > 0) {
                document.location = $scope.keypadSettings.directKey[event.key].href;
            }
        }
        else {
            // Check for vertical navigation
            const indexOf = $scope.keypadSettingsNavigation.indexOf(document.location.hash.split("?")[0]);
            if (indexOf >= 0) {
                const f = keyToFunction(event.key);
                console.log("function: " + f);
                if (f === undefined || f == null) {
                    return false;
                }
                else {
                    var nextIndex = indexOf;
                    switch (f) {
                        case "SwipeLeft":
                            if (indexOf > 0) {
                                nextIndex--;
                            }
                            else {
                                nextIndex = $scope.keypadSettingsNavigation.length - 1;
                            }

                            break;
                        case "SwipeRight":
                            if (indexOf < $scope.keypadSettingsNavigation.length - 1) {
                                nextIndex++;
                            }
                            else {
                                nextIndex = 0;
                            }
                            break;
                        default:
                            const event = {
                                key:f
                            };
                            const proxy = new KeyboardEvent("keypad", event);
                            dispatchEvent(proxy);
                            break;
                    }
                    if (nextIndex != indexOf) {
                        const nextLocation = $scope.keypadSettingsNavigation[nextIndex];
                        console.log("Swipe direct to:" + nextLocation);
                        document.location = nextLocation;
                        return false;

                    }
                }
                /*
                if ($scope.keypadSettingsNavigation[indexOf].hasOwnProperty(event.key)) {
                    if ($scope.keypadSettingsNavigation[document.location.hash][event.key].length > 0) {
                        if ((event.key == "SwipeRight" || event.key == "SwipeLeft")) {
                            var nextLocation = $scope.keypadSettingsNavigation[document.location.hash][event.key];
                            console.log("Swipe direct to:" + nextLocation);
                            document.location = nextLocation;
                            return;
                        }
                        if ($scope.keypadSettingsNavigation[document.location.hash].hasOwnProperty("disableRotary") == false || event.key == "to" || event.key == "from" || $scope.keypadKnobTimerRemovePopup !== undefined) {
                            $scope.keypadShowRotary(event.key);
                            $scope.$apply();
                        }
                    }
                }
            */
            }
        }
    });

    function keypadHideRotary() {
        clearInterval($scope.keypadKnobTimerRemovePopup);
        delete $scope.keypadKnobTimerRemovePopup
        $scope.Ui.turnOff("keypadModal");
        //var nextLocation = $scope.keypadSettingsNavigation[document.location.hash][key];
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
        document.getElementById("keypadModalDiv").style = "";

        if ($scope.keypadSettingsNavigation.hasOwnProperty($scope.keypadKnobLastLocation)) {
            if ($scope.keypadSettingsNavigation[$scope.keypadKnobLastLocation].hasOwnProperty(key)) {
                var nextLocation = $scope.keypadSettingsNavigation[$scope.keypadKnobLastLocation][key];
                //console.log("nextLocation=" + nextLocation + " document.location.hash=" + document.location.hash + " key=" + key)
                $scope.keypadKnobLastTitle = $scope.keypadSettingsNavigation[nextLocation].title;
                $scope.keypadKnobLastDeg = $scope.keypadSettingsNavigation[nextLocation].knobDeg;
                $scope.keypadKnobLastLocation = nextLocation;
                // Using this feature many 1000 times requires a "async" to load the screen, do not apply now
                // Comment this line if Rotary is used "keypadModal" or USE this line if apply the Left Side Menu
                //document.location = nextLocation
            }
        }
        else {

        }

    }
}
