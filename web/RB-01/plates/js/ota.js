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
    $scope.currentVersion = "";
    $scope.currentBuild = "";

    // The installed software version, to compare with the manual: Version is the git tag,
    // Build the commit (with -dirty for a modified build). URL_STATUS_GET: services/servicestatus.js
    $http.get(URL_STATUS_GET).then(function (response) {
        var status = angular.fromJson(response.data);
        if (status === undefined || status === null) {
            return;
        }
        $scope.currentVersion = status.Version || "";
        $scope.currentBuild = status.Build || "";
    });


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

    // No install while moving: above 10 km/h GPS ground speed the INSTALL and UPDATE buttons
    // are disabled. GPSGroundSpeed is in knots. Without a fix the speed is unknown and the
    // install stays allowed (a hangar with no sky view)
    const OTA_MAX_GROUND_SPEED_KT = 10 / 1.852;
    $scope.otaMoving = false;
    $scope.otaGroundSpeedKmh = 0;
    function otaSpeedCheck(situation) {
        const moving = !!situation && situation.GPSFixQuality > 0
            && situation.GPSGroundSpeed > OTA_MAX_GROUND_SPEED_KT;
        $scope.otaGroundSpeedKmh = moving ? Math.round(situation.GPSGroundSpeed * 1.852) : 0;
        if (moving) {
            // the confirmation of a pending install is withdrawn as well
            $scope.pendingUpdate = null;
        }
        $scope.otaMoving = moving;
    }
    otaSpeedCheck(window.situation);
    function situationUpdated(event) {
        const wasMoving = $scope.otaMoving;
        const wasKmh = $scope.otaGroundSpeedKmh;
        otaSpeedCheck(event.detail);
        if (wasMoving != $scope.otaMoving || wasKmh != $scope.otaGroundSpeedKmh) {
            $scope.$applyAsync();
        }
    }
    addEventListener("SituationUpdated", situationUpdated);
    $scope.$on('$destroy', function () {
        removeEventListener("SituationUpdated", situationUpdated);
    });

    // INSTALL and UPDATE ask first: the press opens the confirmation, CONFIRM sends it
    $scope.pendingUpdate = null;
    $scope.installUpdate = function (element) {
        if ($scope.otaMoving || !(element.version > element.installed)) {
            return;
        }
        $scope.pendingUpdate = element;
    };
    $scope.cancelInstall = function () {
        $scope.pendingUpdate = null;
    };
    $scope.confirmInstall = function () {
        const element = $scope.pendingUpdate;
        $scope.pendingUpdate = null;
        if (!element || $scope.otaMoving || !(element.version > element.installed)) {
            return;
        }
        $http.post(URL_OTA_REMOTE_POST, JSON.stringify(element)).then(function (response) {
            document.location = "#/";
        });
    };
    // Addons Module Navigation, shared with the addons page: plates/js/addons.js
    addonsListLoad($scope, $http);

    // The knob: each addon row, TAP opens it as START does. INSTALL and UPDATE are not stops,
    // a stray press must not start an install. Open question for the owner in
    // docs/tech-debt/keypad-page-navigation.md (Status, ota)
    $scope.keypadFocus = new KeypadFocus($scope, $state, name);
};
