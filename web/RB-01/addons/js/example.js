/**
 * This file is part of RB.
 *
 * Copyright (C) 2026 XIAPROJECTS SRL
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
 * Please join Discord community
 *
 * 
 * 
 * Bridge test with:
 * curl -X POST http://localhost/bridge/float -d '{"BridgeExample":10}'
 * 
 * 
 * 
*/

angular.module('appControllers').controller('ExampleCtrl', ExampleCtrl);



function ExampleCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "example";
    const controllerName = String(name).charAt(0).toLocaleUpperCase()+String(name).slice(1) +"Ctrl";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
        removeEventListener("EMSUpdated", emsUpdated);
        removeEventListener("SituationUpdated", situationUpdateEventListener);
        removeEventListener("StatusUpdated", statusUpdateEventListener);
        removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
    };

    console.log("Controller " + name);

    // Example of scope variable
    $scope.items = {
        AHRSGyroX:0,
        AHRSGyroY:0,
        AHRSGyroZ:0,
        QNH:0,
        GPS_satellites_locked:0,
        Uptime:0,
        BridgeExample:0
    };


    // ************
    function statusUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("StatusUpdated", statusUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var status = event.detail;
        $scope.items["GPS_satellites_locked"] = status["GPS_satellites_locked"];
        $scope.items["Uptime"] = status["Uptime"];
    }
    // ************
    function situationUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("SituationUpdated", situationUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var situation = event.detail;
        $scope.items["AHRSGyroX"] = parseInt(situation["AHRSGyroX"]);
        $scope.items["AHRSGyroY"] = parseInt(situation["AHRSGyroY"]);
        $scope.items["AHRSGyroZ"] = parseInt(situation["AHRSGyroZ"]);
        $scope.items["QNH"] = situation["QNH"];
    }

    function emsUpdated(emsData) {
        if (($scope === undefined) || ($scope === null) || ($state.current.controller != controllerName)) {
            removeEventListener("EMSUpdated", emsUpdated);
            return; // we are getting called once after clicking away from the status page
        }

        var emsData = emsData.detail;
    };

    function bridgeUpdatedEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var status = event.detail;
        $scope.items["BridgeExample"] = parseInt(status["BridgeExample"]);
    }
    addEventListener("BridgeUpdated", bridgeUpdatedEventListener);
	addEventListener("EMSUpdated", emsUpdated);
    addEventListener("SituationUpdated", situationUpdateEventListener);
    addEventListener("StatusUpdated", statusUpdateEventListener);

};
