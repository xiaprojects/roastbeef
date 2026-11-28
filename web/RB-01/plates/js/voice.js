/**
 * This file is part of RB.
 *
 * Copyright (C) 2023 XIAPROJECTS SRL
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
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
*/

angular.module('appControllers').controller('VoiceCtrl', VoiceCtrl);

// Bridge keys owned by rbvoice (bridge.py)
var VOICE_WAKEWORD_KEY = "voice_wakeword";
var VOICE_TRIGGER_KEY = "voice_trigger";
// The utterances rbvoice understands, listed at the end of the page
var VOICE_CASES_URL = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/rbvoice-cases.it.json";

/**
 * voiceUtterances: one list per component of rbvoice-cases, keeping only the first keyword of each value
 * @param {Object} cases the rbvoice-cases JSON, components: { name: { keywords: { "phrase": "value" } } }
 * @returns [{ name, keywords: ["phrase", ...] }] in the file order; [] when the file has no components
 */
function voiceUtterances(cases) {
    var list = [];
    if (cases === undefined || cases === null || cases.components === undefined || cases.components === null) {
        return list;
    }
    for (var name in cases.components) {
        var keywords = cases.components[name].keywords || {};
        var seen = {};
        var phrases = [];
        for (var phrase in keywords) {
            var value = keywords[phrase];
            if (!seen.hasOwnProperty(value)) {
                seen[value] = true;
                phrases.push(phrase);
            }
        }
        list.push({ name: name, keywords: phrases });
    }
    return list;
}




function VoiceCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "voice";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
        removeEventListener("voice", voiceEventListener);
        removeEventListener("BridgeUpdated", voiceBridgeUpdatedEventListener);
    };

    console.log("Controller " + name);




    $scope.speaking = false;
    // rb-llm is preparing an answer (THINKING of rbvoice)
    $scope.thinking = false;
    $scope.phrases = [
    ];

    $scope.enableAudio = function () {
        window.localStorage.setItem("Display_Audio_Enabled", true);
        window.localStorage.setItem("Display_Audio_GLoad_Enabled", true);
    }

    $scope.setName = function (displayName) {
        window.localStorage.setItem("displayName", displayName);
    }

    /*****************************************************
     *  Voice control on the addons bridge (rbvoice bridge.py)
     *  voice_wakeword: 1 = rbvoice answers after a wake word, 0 = only after a trigger.
     *                  rbvoice publishes its default at startup, so a change lasts until it restarts.
     *  voice_trigger:  1 = listen now without a wake word; rbvoice writes 0 back when it stops listening.
     */
    $scope.voiceWakeWord = true;
    $scope.voiceListening = false;

    function voiceBridgeReceived(bridge) {
        if (bridge === undefined || bridge === null) {
            return false;
        }
        var changed = false;
        if (bridge.hasOwnProperty(VOICE_WAKEWORD_KEY) && (bridge[VOICE_WAKEWORD_KEY] >= 0.5) != $scope.voiceWakeWord) {
            $scope.voiceWakeWord = bridge[VOICE_WAKEWORD_KEY] >= 0.5;
            changed = true;
        }
        if (bridge.hasOwnProperty(VOICE_TRIGGER_KEY) && (bridge[VOICE_TRIGGER_KEY] >= 0.5) != $scope.voiceListening) {
            $scope.voiceListening = bridge[VOICE_TRIGGER_KEY] >= 0.5;
            changed = true;
        }
        return changed;
    }

    function voiceBridgePost(msg) {
        $http.post(URL_BRIDGE_FLOAT_SET, JSON.stringify(msg)).then(function (response) {
            // the socket brings the new values back
        }, function (response) {
            // do nothing
        });
    }

    $scope.voiceTrigger = function () {
        var msg = {};
        msg[VOICE_TRIGGER_KEY] = 1;
        voiceBridgePost(msg);
    }

    $scope.voiceToggleWakeWord = function () {
        var msg = {};
        msg[VOICE_WAKEWORD_KEY] = $scope.voiceWakeWord ? 0 : 1;
        voiceBridgePost(msg);
    }

    function voiceBridgeUpdatedEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "VoiceCtrl") {
            removeEventListener("BridgeUpdated", voiceBridgeUpdatedEventListener);
            return; // we are getting called once after clicking away from the page
        }
        if (voiceBridgeReceived(event.detail)) {
            $scope.$apply();
        }
    }

    // The socket says nothing on connect, only after a change
    $http.get(URL_BRIDGE_FLOAT_SET).then(function (response) {
        voiceBridgeReceived(angular.fromJson(response.data));
    });
    addEventListener("BridgeUpdated", voiceBridgeUpdatedEventListener);

    // Supported utterances: one table per component, the first phrase of each value
    $scope.utterances = [];
    $http.get(VOICE_CASES_URL).then(function (response) {
        $scope.utterances = voiceUtterances(angular.fromJson(response.data));
    }, function (response) {
        $scope.utterances = [];
    });

    // The knob: PUSH TO TALK, WAKE WORD, PRIMARIO, SECONDARIO, DISPLAY, Enable Audio; TAP is a touch on the button
    // (docs/tech-debt/keypad-page-navigation.md 3.4)
    $scope.keypadFocus = new KeypadFocus($scope, $state, name);
    /*****************************************************
     *  Keypad Management
     */

    function voiceEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "VoiceCtrl") {
            removeEventListener("voice", voiceEventListener);
            return; // we are getting called once after clicking away from the status page
        }

        if (event.detail.key == "SPEAKING") {
            $scope.speaking = event.detail.status;
        } else {
            // THINKING and VOICE: servicevoice.js has updated the list and the state first
            $scope.thinking = window.voiceThinking === true;
            $scope.phrases = window.voicePhrases;
        }
        $scope.$apply();

    }

    addEventListener("voice", voiceEventListener);
    if(window.hasOwnProperty("voicePhrases")){
        $scope.phrases = window.voicePhrases;
    }
    $scope.thinking = window.voiceThinking === true;
};
