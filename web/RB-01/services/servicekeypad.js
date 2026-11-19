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
 * 06 -> Display with Android 6.25" 7" 8" 10" 10.2"
 * 07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
 * 08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder
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
var URL_KEYPAD_SETTINGS_GET = "/settings/keypad.json";
var URL_KEYPAD_NAVIGATION_GET = "/settings/navigation.json";

const KEYPAD_MAPPING_PREV = "KEYPAD_MAPPING_PREV";
const KEYPAD_MAPPING_TAP = "KEYPAD_MAPPING_TAP";
const KEYPAD_MAPPING_NEXT = "KEYPAD_MAPPING_NEXT";
const SwipeLeft = "SwipeLeft";
const SwipeRight = "SwipeRight";

function KeypadService($scope, $http, $state) {
    $scope.keypadSettings = {
        "directKey": {
        }
    };
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


    // A key typed into a field is text, not a keypad key (F2). A slider, a check box and a
    // button take no text: the knob keeps its keys there
    const KEYPAD_NOT_TEXT_INPUTS = ["range", "checkbox", "radio", "button", "submit", "reset"];
    function keypadIsTextEntry(target) {
        if (target === undefined || target === null || target.tagName === undefined) {
            return false;
        }
        if (target.isContentEditable) {
            return true;
        }
        switch (target.tagName) {
            case "TEXTAREA":
            case "SELECT":
                return true;
            case "INPUT":
                return KEYPAD_NOT_TEXT_INPUTS.indexOf(String(target.type).toLowerCase()) < 0;
        }
        return false;
    }

    // A page made for typing (the settings addon) turns the keypad off while it is on screen
    // (docs/tech-debt/keypad-page-navigation.md, F10). No key from Chromium or from the Pi
    // reaches the keypad: no knob, no swipe, no direct key, no hold. Every key keeps its
    // browser meaning. Touch, including the navigation FABs, still works and is the way out.
    // The keypad comes back when that page's scope is destroyed, when the pilot leaves it
    var keypadDisabledBy = null;
    $scope.keypadDisable = function (pageScope) {
        keypadDisabledBy = pageScope;
        $scope.lastKey = null;
        pageScope.$on("$destroy", function () {
            if (keypadDisabledBy === pageScope) {
                keypadDisabledBy = null;
            }
        });
    };
    function keypadIsDisabled() {
        return keypadDisabledBy !== null;
    }

    // A key the keypad uses does only that: no page scroll on an arrow, no click on Enter (F3).
    // Every other key keeps its browser meaning
    function keypadIsMapped(key) {
        return directKeyHref(key) !== null || keyToFunction(key) !== undefined;
    }

    // Driver to match the Key HOLD and Key Press
    function fromKeyboardDownToKeypad(event) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page
        if (keypadIsDisabled() || keypadIsTextEntry(event.target)) {
            return;
        }
        if (keypadIsMapped(event.key)) {
            event.preventDefault();
        }
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
        if (keypadIsDisabled() || keypadIsTextEntry(event.target)) {
            return;
        }
        if (keypadIsMapped(event.key)) {
            event.preventDefault();
        }
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
            window.removeEventListener("keydown", fromKeyboardDownToKeypad);
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
            // Adding Remote Keypad and Voice Recognition
            if(k.hasOwnProperty("source") && k.source == "voice")
            {
                const proxy = new CustomEvent("voice", { detail: k });
                dispatchEvent(proxy);
            }
            if (keypadIsDisabled()) {
                return; // a page made for typing has the keypad off (F10)
            }
            if(k.hasOwnProperty("target") && k.target !="" && localDisplayGetFlag("displayName")!=false)
            {
                if(k.target!=localDisplayGetFlag("displayName")){
                    console.log("Remote command is not for this display");
                    return;
                }
                else
                {

                }
            }
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




    // The table from key name to function, built again when the settings object is replaced
    // (the settings addon assigns a new one after a save). A list missing from keypad.json
    // maps nothing rather than throwing on every key
    var keypadFunctionsFor = null;
    var keypadFunctions = {};
    function keyToFunction(key) {
        if (keypadFunctionsFor !== $scope.keypadSettings) {
            keypadFunctionsFor = $scope.keypadSettings;
            keypadFunctions = {};
            [KEYPAD_MAPPING_PREV, KEYPAD_MAPPING_TAP, KEYPAD_MAPPING_NEXT, SwipeLeft, SwipeRight].forEach(fun => {
                const list = ($scope.keypadSettings || {})[fun];
                if (Array.isArray(list)) {
                    list.forEach(element => {
                        keypadFunctions[element] = fun;
                    });
                }
            });
        }
        return keypadFunctions.hasOwnProperty(key) ? keypadFunctions[key] : undefined;
    }

    // The page a direct key opens, the one for this display's shape first; null if none
    function directKeyHref(key) {
        const settings = $scope.keypadSettings || {};
        const generic = settings.directKey || {};
        if (!generic.hasOwnProperty(key)) {
            return null;
        }
        const shaped = settings["directKey" + whichKeywordIsForThisDisplay()];
        if (shaped !== undefined && shaped.hasOwnProperty(key) && shaped[key].hasOwnProperty("href") && shaped[key].href.length > 0) {
            return shaped[key].href;
        }
        if (generic[key].hasOwnProperty("href") && generic[key].href.length > 0) {
            return generic[key].href;
        }
        return null;
    }

    function keypadSwipe(f) {
        const list = $scope.keypadSettingsNavigation;
        if (!Array.isArray(list) || list.length == 0) {
            return;
        }
        const indexOf = list.indexOf(document.location.hash.split("?")[0]);
        var nextIndex = 0; // outside the list a swipe starts it from the first page
        if (indexOf >= 0) {
            if (f == SwipeLeft) {
                nextIndex = indexOf > 0 ? indexOf - 1 : list.length - 1;
            } else {
                nextIndex = indexOf < list.length - 1 ? indexOf + 1 : 0;
            }
        }
        if (nextIndex != indexOf) {
            console.log("Swipe direct to:" + list[nextIndex]);
            document.location = list[nextIndex];
        }
    }

    // Who owns a key, first match wins (docs/tech-debt/keypad-page-navigation.md 3.5):
    // 1. an alert popup on screen: TAP acknowledges (ALERTS-NAVIGATION-UI-PROPOSAL.md 4.4, not built,
    //    its hook goes here); 2. a direct key opens its page; 3. a swipe walks the navigation list;
    // 4. PREV, TAP and NEXT go to the routed plate, whether or not it is in the list.
    // A key mapped to nothing does nothing (D1)
    window.addEventListener("key", (event) => {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page
        console.log(event);

        const href = directKeyHref(event.key);
        if (href !== null) {
            document.location = href;
            return false;
        }
        const f = keyToFunction(event.key);
        console.log("function: " + f);
        switch (f) {
            case SwipeLeft:
            case SwipeRight:
                keypadSwipe(f);
                return false;
            case KEYPAD_MAPPING_PREV:
            case KEYPAD_MAPPING_TAP:
            case KEYPAD_MAPPING_NEXT:
                dispatchEvent(new KeyboardEvent("keypad", { key: f }));
                return false;
        }
        return false;
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
