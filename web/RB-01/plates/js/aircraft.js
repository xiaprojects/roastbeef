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
        removeEventListener("SituationUpdated", situationUpdateEventListener);
        removeEventListener("StatusUpdated", statusUpdateEventListener);
        removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
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
        "Cloud":{ "section": 1, "row": 6 },
        "FLARM":{ "section": 1, "row": 8 },
        "GPS_satellites_locked":{ "section": 1, "row": 11 },
        "RADIO":{ "section": 1, "row": 10 },
        "CHECKLIST":{ "section": 0, "row": 11 }
    };

    // Tiles fed by the EMS map, same rule as the gear lights in emsUpdated: the key
    // must be present and changed since the previous frame. 0 is "no reading" on the
    // fuel and electrical tiles, like a gear light at 0.
    $scope.emsTiles = {
        "fuel1":          { "section": 0, "row": 2,  "decimals": 0, "zeroIsAlarm": true },
        "fuel2":          { "section": 1, "row": 2,  "decimals": 0, "zeroIsAlarm": true },
        "flaps":          { "section": 0, "row": 6,  "decimals": 0, "zeroIsAlarm": false },
        "trim":           { "section": 0, "row": 7,  "decimals": 0, "zeroIsAlarm": false },
        "alternatorout":  { "section": 0, "row": 9,  "decimals": 1, "zeroIsAlarm": true },
        "batteryvoltage": { "section": 0, "row": 10, "decimals": 1, "zeroIsAlarm": true }
    };

    $scope.gearnoseBackgroundColor = "#4444ff";
    $scope.gearrightBackgroundColor = "#4444ff";
    $scope.gearleftBackgroundColor = "#4444ff";


    $scope.items = [[
        { "label": "Propeller", "value": "", "color": "#4444ff", "href":"#/logbook","unit":"m" },
        { "label": "Engine", "value": "", "color": "#4444ff", "href":"#/logbook","unit":"m" },
        { "label": "Fuel L", "value": "0L", "color": "#ff0000", "href":"#/ems","unit":"L" },
        { "label": "", "value": null, "color": "transparent","unit":"" },
        { "label": "", "value": "", "color": "#00000000","unit":"" },
        { "label": "", "value": "", "color": "#00000000","unit":"" },
        { "label": "Flaps", "value": "0%", "color": "#007c00", "href":"#/switchboard","unit":"%" },
        { "label": "Trim", "value": "--", "color": "#ff7c00", "href":"#/switchboard","unit":"" },

        { "label": "EMS", "value": "KO", "color": "#ff0000", "href":"#/ems","unit":"" },
        { "label": "VP-X", "value": "--.- V", "color": "#ff7c00", "href":"#/switchboard","unit":"V" },
        { "label": "BATT", "value": "--.- V", "color": "#ff7c00", "href":"#/ems","unit":"V" },
        { "label": "CHECK", "value": "TODO", "color": "#ff7c00", "href":"#/checklist","unit":"" },
    ], [
        { "label": "Pilot", "value": "", "color": "#007c00","unit":"" },
        { "label": "CPU", "value": "---", "color": "#007c00", "href":"#/charts","unit":"°C" },
        { "label": "Fuel R", "value": "0L", "color": "#ff0000", "href":"#/ems","unit":"L" },
        { "label": "", "value": null, "color": "transparent","unit":"" },
        { "label": "", "value": "", "color": "#00000000","unit":"" },
        { "label": "", "value": "", "color": "#00000000","unit":"" },
        { "label": "Cloud", "value": "OFFLINE", "color": "#ff0000","unit":"" },
        { "label": "Update", "value": "OFFLINE", "color": "#7c7c7c", "href":"#/ota","unit":"" },


        { "label": "FLARM", "value": "KO", "color": "#ff0000", "href":"#/radar","unit":"" },
        { "label": "ADS-B", "value": "OFF", "color": "#7c7c7c", "href":"#/radar","unit":""  },
        { "label": "RADIO", "value": "---", "color": "#7c7c7c", "href":"#/radio","unit":"" },
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

    // The knob makes the home page a launcher: each tile that opens a page is a stop, TAP
    // opens it as a touch does, left column then right (docs/tech-debt/keypad-page-navigation.md)
    $scope.keypadFocus = new KeypadFocus($scope, $state, ["home", "aircraft"]);

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
        requiredRefresh += $scope.applyFlarmTile(status);
        // Hobbs meter (main/hobbsmeter.go): minutes flown above 50 km/h, added to the
        // base values the pilot set in aircraft.json.
        const hobbs = Number(status.HobbsTimeMinutes) || 0;
        const base = $scope.aircraftData || {};
        requiredRefresh += $scope.applyNewData({
            "propellerTime": (Number(base.propellerTime) || 0) + hobbs,
            "engineTime": (Number(base.engineTime) || 0) + hobbs
        });
        if(requiredRefresh > 0){
        $scope.$apply(); // trigger any needed refreshing of data
        }
    };

    // FLARM serial-in (main/gps.go flarmSerialReader): red when the device is not
    // connected or silent for 10 s, amber when it hears nobody, green with the count
    // of aircraft it reports receiving ($PFLAU RX).
    $scope.applyFlarmTile = function (status) {
        const key = "FLARM";
        const item = $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row];
        const prevValue = item.value;
        const prevColor = item.color;
        const targets = Number(status.FLARM_In_targets) || 0;
        if (!status.FLARM_In_connected || !status.FLARM_In_receiving) {
            item.value = "KO";
            item.color = "#ff0000";
        } else if (targets == 0) {
            item.value = "0";
            item.color = "#ff7c00";
        } else {
            item.value = String(targets);
            item.color = "#007c00";
        }
        return (prevValue != item.value || prevColor != item.color) ? 1 : 0;
    }
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

        var requiredRefresh = 0;
        if (emsData.detail.hasOwnProperty("gearnose") && emsData.detail["gearnose"] != $scope.emsData["gearnose"]) {
            requiredRefresh++;
            if (emsData.detail["gearnose"] == 0) {
                $scope.gearnoseBackgroundColor = "#ff0000";
            } else {
                $scope.gearnoseBackgroundColor = "#007c00";
            }
        }

        if (emsData.detail.hasOwnProperty("gearleft") && emsData.detail["gearleft"] != $scope.emsData["gearleft"]) {
            requiredRefresh++;
            if (emsData.detail["gearleft"] == 0) {
                $scope.gearleftBackgroundColor = "#ff0000";
            } else {
                $scope.gearleftBackgroundColor = "#007c00";
            }
        }        

        if (emsData.detail.hasOwnProperty("gearright") && emsData.detail["gearright"] != $scope.emsData["gearright"]) {
            requiredRefresh++;
            if (emsData.detail["gearright"] == 0) {
                $scope.gearrightBackgroundColor = "#ff0000";
            } else {
                $scope.gearrightBackgroundColor = "#007c00";
            }
        }

        Object.keys($scope.emsTiles).forEach(key => {
            requiredRefresh += applyEmsTile(emsData.detail, key);
        });

        if (emsData.detail.hasOwnProperty("clouduploaded") && emsData.detail["clouduploaded"] != $scope.emsData["clouduploaded"]) {
            const key = "Cloud";
            requiredRefresh++;

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
            requiredRefresh++;
        }
        $scope.emsData = emsData.detail;
        if(requiredRefresh > 0){
            $scope.$apply(); // trigger any needed refreshing of data
        }
    };

    // One EMS key -> one tile (see $scope.emsTiles). Returns 1 when the tile changed.
    function applyEmsTile(detail, key) {
        if (detail.hasOwnProperty(key) == false || detail[key] == $scope.emsData[key]) {
            return 0;
        }
        const tileMap = $scope.emsTiles[key];
        const tile = $scope.items[tileMap.section][tileMap.row];
        tile.value = Number(detail[key]).toFixed(tileMap.decimals) + tile.unit;
        if (tileMap.zeroIsAlarm && detail[key] == 0) {
            tile.color = "#ff0000";
        } else {
            tile.color = "#007c00";
        }
        return 1;
    }

    /*****************************************************
     *  Checklist tile: completed/total, green when every check is completed.
     *  The list comes from the checklist REST, then CHECKLIST_{SECTION}_{INDEX}
     *  keys on the bridge (posted by checklist.js) keep it live.
     */
    $scope.checklistStatus = []; // [section][index] = value string, see CHECKLIST_BRIDGE_VALUES

    $scope.refreshChecklistTile = function () {
        var total = 0;
        var completed = 0;
        $scope.checklistStatus.forEach(section => {
            section.forEach(value => {
                total++;
                if (CHECKLIST_COMPLETED_VALUES.indexOf(value) >= 0) {
                    completed++;
                }
            });
        });
        const key = "CHECKLIST";
        const item = $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row];
        const prevValue = item.value;
        const prevColor = item.color;
        if (total == 0) {
            item.value = "TODO";
            item.color = "#ff7c00";
        } else {
            item.value = completed + "/" + total;
            item.color = (completed == total) ? "#007c00" : "#ff7c00";
        }
        return (prevValue != item.value || prevColor != item.color) ? 1 : 0;
    }

    $scope.applyChecklistBridge = function (bridge) {
        var requiredRefresh = 0;
        Object.keys(bridge).forEach(key => {
            const parts = key.split("_");
            if (parts.length != 3 || parts[0] != "CHECKLIST") {
                return;
            }
            const section = $scope.checklistStatus[parseInt(parts[1])];
            const index = parseInt(parts[2]);
            if (section === undefined || index < 0 || index >= section.length) {
                return; // not in the loaded checklist
            }
            const value = CHECKLIST_BRIDGE_VALUES[Math.round(bridge[key])];
            if (value !== undefined && section[index] != value) {
                section[index] = value;
                requiredRefresh++;
            }
        });
        if (requiredRefresh > 0) {
            requiredRefresh = $scope.refreshChecklistTile();
        }
        return requiredRefresh;
    }

    function bridgeUpdatedEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "AircraftCtrl") {
            removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        if ($scope.applyChecklistBridge(event.detail) > 0) {
            $scope.$apply();
        }
    }

    $http.get(URL_CHECKLIST_GET).then(function (response) {
        var list = angular.fromJson(response.data);
        if (!Array.isArray(list)) {
            return;
        }
        $scope.checklistStatus = list.map(group => (group && Array.isArray(group.items)) ? group.items.map(check => check.value) : []);
        $scope.refreshChecklistTile();
    });

	addEventListener("EMSUpdated", emsUpdated);
    addEventListener("BridgeUpdated", bridgeUpdatedEventListener);
    addEventListener("SituationUpdated", situationUpdateEventListener);
    addEventListener("StatusUpdated", statusUpdateEventListener);

    if(window.aircraftData !== undefined) {
        $scope.aircraftData = window.aircraftData;
        // update the scope variables
        $scope.applyNewData(window.aircraftData);
        $scope.name = window.aircraftData.name;
    }


    $http.get(URL_RADIO_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        // [] or null when no radio is configured: the first active radio, --- when none is active
        const active = Array.isArray(db) ? db.find(r => r && r.Enabled) : undefined;
        const key = "RADIO";
        const item = $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row];
        item.value = active ? (active.Name || "---") : "---";
        item.color = active ? "#007c00" : "#7c7c7c";
    });

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
