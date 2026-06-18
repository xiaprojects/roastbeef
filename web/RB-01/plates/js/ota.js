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

angular.module('appControllers').controller('OtaCtrl', OtaCtrl);

var URL_OTA_REMOTE_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/updates/available";
var URL_OTA_REMOTE_POST = URL_HOST_PROTOCOL + URL_HOST_BASE + "/updates/install";



function OtaCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "ota";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
    };

    console.log("Controller " + name);


    $scope.updates = [];
    $scope.updateAvailable = false;


    $http.get(URL_OTA_REMOTE_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        if (db === undefined || Object.keys(db).length == 0) {
            return;
        }
        $scope.updates = db;

        var updatesCount = 0;
        db.forEach(element => {
            if (element.version > element.installed) {
                updatesCount++;
            }
        });

        const key = "ota";
        if (updatesCount > 0) {
            $scope.updateAvailable = true;
        } else {
            $scope.updateAvailable = false;
        }

    });

    $scope.installUpdate = function (element) {
            if (element.version > element.installed) {
                 $http.post(URL_OTA_REMOTE_POST,JSON.stringify(element)).then(function (response) {
                    document.location = "#/";
                 })
                 return;
            }
    }
    // Addons Module Navigation
    $scope.addons = [];
    $http.get(URL_ADDONS).then(function (response) {
        var db = angular.fromJson(response.data);
        if (db === undefined) {
            return;
        }
        $scope.addons = db;
    });

    $scope.goTo = function(item) {
        if(item.hasOwnProperty("hash") == true) {
            document.location = "#" + item.hash;
        }
    }
};
