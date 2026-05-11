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
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
*/

angular.module('appControllers').controller('AircraftCtrl', AircraftCtrl);


var URL_AIRCRAFT_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/aircraft.json";

function AircraftCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "aircraft";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
        removeEventListener("EMSUpdated", emsUpdated);
        removeEventListener("keypad", keypadEventListener);
        removeEventListener("SituationUpdated", situationUpdateEventListener);
        removeEventListener("StatusUpdated", statusUpdateEventListener);
    };

    console.log("Controller " + name);


    $http.get(URL_AIRCRAFT_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        if (db === undefined || Object.keys(db).length == 0) {
            return;
        }
        $scope.aircraftData = db;
        // update the scope variables
        $scope.applyNewData(db);
        $scope.name = db.name;
    });

    $scope.mappingData = {
        "ota": { "section": 1, "row": 7 },
        "pilot": { "section": 1, "row": 0 },
        "propellerTime": { "section": 0, "row": 0 },
        "engineTime": { "section": 0, "row": 1 },
        "CPUTemp":{ "section": 1, "row": 1 },
        "ES_messages_last_minute":{ "section": 1, "row": 9 },
        "EMS":{ "section": 0, "row": 8 },
        "Cloud":{ "section": 1, "row": 8 },
        "GPS_satellites_locked":{ "section": 1, "row": 11 }
    };

    $scope.gearnoseBackgroundColor = "#4444ff";
    $scope.gearrightBackgroundColor = "#4444ff";
    $scope.gearleftBackgroundColor = "#4444ff";


    $scope.items = [[
        { "label": "Propeller", "value": "", "color": "#4444ff","unit":"m" },
        { "label": "Engine", "value": "", "color": "#4444ff","unit":"m" },
        { "label": "Fuel L", "value": "0L", "color": "#ff0000", "href":"#/ems","unit":"L" },
        { "label": "", "value": null, "color": "transparent","unit":"" },
        { "label": "", "value": "", "color": "#00000000","unit":"" },
        { "label": "", "value": "", "color": "#00000000","unit":"" },
        { "label": "Flaps", "value": "0%", "color": "#007c00", "href":"#/switchboard","unit":"" },
        { "label": "", "value": "", "color": "#00000000","unit":"" },

        { "label": "EMS", "value": "KO", "color": "#ff0000", "href":"#/ems","unit":"" },
        { "label": "VP-X", "value": "--.- V", "color": "#ff7c00", "href":"#/switchboard","unit":"" },
        { "label": "BATT", "value": "--.- V", "color": "#ff7c00", "href":"#/ems","unit":"" },
        { "label": "CHECK", "value": "TODO", "color": "#ff7c00", "href":"#/checklist","unit":"" },
    ], [
        { "label": "Pilot", "value": "", "color": "#007c00","unit":"" },
        { "label": "CPU", "value": "---", "color": "#007c00", "href":"#/charts","unit":"°C" },
        { "label": "Fuel R", "value": "0L", "color": "#ff0000", "href":"#/ems","unit":"L" },
        { "label": "", "value": null, "color": "transparent","unit":"" },
        { "label": "", "value": "", "color": "#00000000","unit":"" },
        { "label": "", "value": "", "color": "#00000000","unit":"" },
        { "label": "Trim", "value": "--", "color": "#ff7c00", "href":"#/switchboard","unit":"" },
        { "label": "Update", "value": "OFFLINE", "color": "#7c7c7c", "href":"#/ota","unit":"" },


        { "label": "Cloud", "value": "OFFLINE", "color": "#ff0000","unit":"" },
        { "label": "ADS-B", "value": "OFF", "color": "#7c7c7c", "href":"#/radar","unit":""  },
        { "label": "RADIO", "value": "KRT2", "color": "#007c00", "href":"#/radio","unit":"" },
        { "label": "GPS", "value": "---", "color": "#007c00","unit":""  },
    ]
    ];


    $scope.applyNewData = function(newData){
        var requiredRefresh = 0;
        Object.keys(newData).forEach(key => {
            if($scope.mappingData.hasOwnProperty(key)==true){
                const prevValue =  $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].value;
                const newValue = newData[key] + $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].unit;
                if(prevValue != newValue){
                    requiredRefresh++;
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].value=newValue;
                }
            }
        });
        return requiredRefresh;
    }

    /*****************************************************
     *  Keypad Management
     */

    function keypadEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "AircraftCtrl") {
            removeEventListener("keypad", keypadEventListener);
            return; // we are getting called once after clicking away from the status page
        }

        if ($scope.keypadKnobTimerRemovePopup === undefined) {
        }
        else {
            // user is changing screen
            return;
        }
    }

    $scope.situation = {};
    $scope.updateSituation = (situation) => {
        const requiredRefresh = false;
        if(requiredRefresh == true){
        $scope.$apply(); // trigger any needed refreshing of data
        }
    };

    $scope.status = {};
    $scope.updateStatus = (status) => {
        var requiredRefresh = $scope.applyNewData(status);
        // TODO: move from status.Uptime to EMS Engine Status
        const newValue = Number.parseFloat((status.Uptime/60000)).toFixed(0);
        if($scope.status["propellerTime"] != newValue){
        $scope.status["propellerTime"] = newValue;
        $scope.status["engineTime"] = Number.parseFloat((status.Uptime/60000)).toFixed(0);
            requiredRefresh++;
        }
        if(requiredRefresh > 0){
        $scope.$apply(); // trigger any needed refreshing of data
        }
    };
    // ************
    function statusUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "AircraftCtrl") {
            removeEventListener("StatusUpdated", statusUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var status = event.detail;
        $scope.updateStatus(status);
    }
    // ************
    function situationUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "AircraftCtrl") {
            removeEventListener("SituationUpdated", situationUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var situation = event.detail;
        $scope.updateSituation(situation);
        $scope.situation = situation;
    }

    $scope.goTo = function(item) {
        if(item.hasOwnProperty("href") == true) {
            document.location = item.href;
        }
    }

    $scope.emsData = {};
    $scope.emsDataHasArrived = 0;
    function emsUpdated(emsData) {
        if (($scope === undefined) || ($scope === null) || ($state.current.controller != 'AircraftCtrl')) {
            removeEventListener("EMSUpdated", emsUpdated);
            return; // we are getting called once after clicking away from the status page
        }

        if (emsData.detail.hasOwnProperty("gearnose") && emsData.detail["gearnose"] != $scope.emsData["gearnose"]) {
            if (emsData.detail["gearnose"] == 0) {
                $scope.gearnoseBackgroundColor = "#ff0000";
            } else {
                $scope.gearnoseBackgroundColor = "#007c00";
            }
        }

        if (emsData.detail.hasOwnProperty("gearleft") && emsData.detail["gearnose"] != $scope.emsData["gearleft"]) {
            if (emsData.detail["gearleft"] == 0) {
                $scope.gearleftBackgroundColor = "#ff0000";
            } else {
                $scope.gearleftBackgroundColor = "#007c00";
            }
        }        

        if (emsData.detail.hasOwnProperty("gearright") && emsData.detail["gearnose"] != $scope.emsData["gearright"]) {
            if (emsData.detail["gearright"] == 0) {
                $scope.gearrightBackgroundColor = "#ff0000";
            } else {
                $scope.gearrightBackgroundColor = "#007c00";
            }
        }

        if (emsData.detail.hasOwnProperty("clouduploaded") && emsData.detail["gearnose"] != $scope.emsData["clouduploaded"]) {
            const key = "Cloud";

            if (emsData.detail["clouduploaded"] > 0) {
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].value = "OK";
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].color = "#007c00";
            } else {
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].value = "OFFLINE";
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].color = "#ff0000";
            }
        }
        if($scope.emsDataHasArrived == 0){
            const key = "EMS";
            $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].value = "OK";
            $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].color = "#007c00";
            $scope.emsDataHasArrived = 1;
        }
        $scope.emsData = emsData.detail;
    };

	addEventListener("EMSUpdated", emsUpdated);
    addEventListener("keypad", keypadEventListener);
    addEventListener("SituationUpdated", situationUpdateEventListener);
    addEventListener("StatusUpdated", statusUpdateEventListener);

    if(window.aircraftData !== undefined) {
        $scope.aircraftData = window.aircraftData;
        // update the scope variables
        $scope.applyNewData(window.aircraftData);
        $scope.name = window.aircraftData.name;
    }


    $http.get(URL_OTA_REMOTE_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        if (db === undefined || Object.keys(db).length == 0) {
            return;
        }
        var updatesCount = 0;
        db.forEach(element => {
            if(element.version>element.installed){
                updatesCount++;
            }
        });

        const key = "ota";
        if(updatesCount>0){
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].value = "INSTALL";
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].color = "#ff7c00";
        } else {
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].value = "LATEST";
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].color = "#007c00";
        }

    });

};
