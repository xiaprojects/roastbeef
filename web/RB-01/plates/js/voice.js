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
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
*/

angular.module('appControllers').controller('VoiceCtrl', VoiceCtrl);




function VoiceCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "voice";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
        removeEventListener("voice", voiceEventListener);
    };

    console.log("Controller " + name);




    $scope.speaking = false;
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
            $scope.phrases = window.voicePhrases;
        }
        $scope.$apply();

    }

    addEventListener("voice", voiceEventListener);
    if(window.hasOwnProperty("voicePhrases")){
        $scope.phrases = window.voicePhrases;
    }
};
