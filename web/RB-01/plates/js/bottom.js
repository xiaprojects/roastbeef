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
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
*/
angular.module('appControllers').controller('BottomCtrl', BottomCtrl);

function BottomCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.click = function (item) {
        console.log(item);
        $scope.$parent.$parent.uiSidebarBottom = false;
        $scope.$parent.$parent.uiSidebarTop = false;


        if (item.hasOwnProperty("url") && item.url.length > 0) {
            document.location = item.url;
        }
        if (item.hasOwnProperty("action") && item.action.length > 0) {
            switch (item.action) {
                case "FS":
                    body.requestFullscreen();
                    window.scrollTo(0, 1);
                    break;
                case "LP":
                    $scope.$parent.$parent.Ui.toggle('uiSidebarLeft');
                    break;
                case "RP":
                    $scope.$parent.$parent.Ui.toggle('uiSidebarRight');
                    break;
            }
        }
    }


    $scope.mappingData = {
        "GPSTrueCourse": { "section": "bottom", "row": 3, "prefix": "AP: ", "postfix": "°", "roundInt": 0 },
        "GPSGroundSpeed": { "section": "bottom", "row": 0, "prefix": "", "postfix": " KMH", "roundInt": 0 },
        "AHRSGLoad": { "section": "bottom", "row": 1, "prefix": "", "postfix": " G", "roundInt": 1 },
        "QNH": { "section": "bottom", "row": 5, "prefix": "QNH ", "postfix": "", "roundInt": 0 },


    };


    $scope.applyNewData = function (newData) {
        Object.keys(newData).forEach(key => {
            if ($scope.mappingData.hasOwnProperty(key) == true) {
                var v = $scope.mappingData[key].prefix + newData[key] + $scope.mappingData[key].postfix;
                if ($scope.mappingData[key].roundInt >= 0) {
                    const i = newData[key].toFixed($scope.mappingData[key].roundInt);
                    v = $scope.mappingData[key].prefix + i + $scope.mappingData[key].postfix;
                }
                else {

                }

                $scope.itemsByPosition[$scope.mappingData[key].section][$scope.mappingData[key].row].value = v;

            }
        });
    }


    function situationUpdated(event) {

        if (($scope === undefined) || ($scope === null)) {
            removeEventListener("SituationUpdated", situationUpdated);
            return; // we are getting called once after clicking away from the status page
        }


        $scope.applyNewData(event.detail);

    }


    $scope.init = function (position) {
        $scope.position = position;
        $scope.items = $scope.itemsByPosition[$scope.position];
        addEventListener("SituationUpdated", situationUpdated);
    }

    $scope.itemsByPosition = {
        "top": [
            { "value": "T:12", "color": "#ffaa00", "url": "#/radar", "action": "" },
            { "value": "LP", "color": "#5c5c5c", "url": "", "action": "LP" },
            { "value": "RP", "color": "#5c5c5c", "url": "", "action": "RP" },
            { "value": "AL:5", "color": "#ffaa00", "url": "#/alerts", "action": "" },
            { "value": "FS", "color": "#5c5c5c", "url": "", "action": "FS" },
            { "value": "PANIC", "color": "#FF0000", "url": "" }
        ], "bottom": [
            { "value": "---", "color": "#00ff00", "url": "#/speed" },
            { "value": "---", "color": "#5c5c5c", "url": "#/" },
            { "value": "OIL 85°C", "color": "#00ff00", "url": "#/ems" },
            { "value": "AP: 145°", "color": "#00ff00", "url": "#/autopilot" },
            { "value": "3D", "color": "#1c1c1c", "url": "#/synthview" },
            { "value": "QNH ---", "color": "#5c5c5c", "url": "#/altimeter" }
        ]
    };

    $scope.position = "bottom";
    $scope.items = $scope.itemsByPosition[$scope.position];

    $scope.$on('$destroy', function () {
        console.log('Controller is being destroyed BOTTOM');
        // cleanup code here (remove listeners, cancel intervals, etc.)
        removeEventListener("SituationUpdated", situationUpdated);
    });

};
