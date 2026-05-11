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
angular.module('appControllers').controller('BottomCtrl', BottomCtrl);

function BottomCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.click = function (item) {
        console.log(item);

        if (item.hasOwnProperty("url") && item.url.length > 0) {
            document.location = item.url;
        }
        if (item.hasOwnProperty("action") && item.action.length > 0) {
            switch (item.action) {
                case "FS":
                    body.requestFullscreen();
                    window.scrollTo(0, 1);
                    $scope.$parent.$parent.uiSidebarBottom = false;
                    $scope.$parent.$parent.uiSidebarTop = false;
                    window.localStorage.setItem("uiSidebarTop", $scope.$parent.$parent.uiSidebarTop);
                    window.localStorage.setItem("uiSidebarBottom", $scope.$parent.$parent.uiSidebarBottom);
                    break;
                case "LP":
                    $scope.$parent.$parent.Ui.toggle('uiSidebarLeft');
                    window.localStorage.setItem('uiSidebarLeft', $scope.$parent.$parent.Ui.get('uiSidebarLeft') == 'true' || $scope.$parent.$parent.Ui.get('uiSidebarLeft') == true);
                    break;
                case "RP":
                    $scope.$parent.$parent.Ui.toggle('uiSidebarRight');
                    window.localStorage.setItem('uiSidebarRight', $scope.$parent.$parent.Ui.get('uiSidebarRight') == 'true' || $scope.$parent.$parent.Ui.get('uiSidebarRight') == true);
                    break;
            }
        }
        if ($scope.$parent.$parent.Ui.get('uiSidebarLeft')) {
            $scope.itemsByPosition["top"][1].color = "#00ff00";
        } else {
            $scope.itemsByPosition["top"][1].color = "#5c5c5c";
        }
        if ($scope.$parent.$parent.Ui.get('uiSidebarRight')) {
            $scope.itemsByPosition["top"][2].color = "#00ff00";
        } else {
            $scope.itemsByPosition["top"][2].color = "#5c5c5c";
        }
    }


    $scope.mappingData = {

        "GPSTrueCourse": { "section": "bottom", "row": 2, "prefix": "", "postfix": "°", "roundInt": 0, "value": 0 },
        "GPSGroundSpeed": { "section": "bottom", "row": 0, "prefix": "", "postfix": "", "roundInt": 0, "value": 0 },
        "AHRSGLoadMax": { "section": "bottom", "row": 1, "prefix": "", "postfix": "", "roundInt": 1, "value": 0 },
        "QNH": { "section": "bottom", "row": 3, "prefix": "", "postfix": "", "roundInt": 0, "value": 0 },
        "AlertsCount": { "section": "top", "row": 3, "prefix": "", "postfix": "", "roundInt": 0, "value": 0 },
        /*
        "oiltemperature": { "section": "bottom", "row": 2, "prefix": "", "postfix": "", "roundInt": 0, "value": 0 },
        */
        "trafficCount": { "section": "top", "row": 0, "prefix": "", "postfix": "", "roundInt": 0, "value": 0 },
    };

    $scope.colorByKeyValue = function (key, value) {
        return "#5c5c5c"
    }


    $scope.applyNewData = function (newData) {
        Object.keys($scope.mappingData).forEach(key => {
            if (newData.hasOwnProperty(key) == true && newData[key] != $scope.mappingData[key].value) {
                var v = $scope.mappingData[key].prefix + newData[key] + $scope.mappingData[key].postfix;
                if ($scope.mappingData[key].roundInt >= 0) {
                    const i = newData[key].toFixed($scope.mappingData[key].roundInt);
                    v = $scope.mappingData[key].prefix + i + $scope.mappingData[key].postfix;
                }
                else {

                }

                $scope.itemsByPosition[$scope.mappingData[key].section][$scope.mappingData[key].row].value = v;
                $scope.itemsByPosition[$scope.mappingData[key].section][$scope.mappingData[key].row].color = $scope.colorByKeyValue(key, v);

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

    function emsUpdated(emsData) {
        if (($scope === undefined) || ($scope === null)) {
            removeEventListener("EMSUpdated", emsUpdated);
            return; // we are getting called once after clicking away from the status page
        }

        $scope.applyNewData(emsData.detail);

    };

    $scope.trafficHash = {};

    function cleanupTrafficHash() {
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60000);

        Object.keys($scope.trafficHash).forEach(function (key) {
            if ($scope.trafficHash[key] < oneMinuteAgo) {
                delete $scope.trafficHash[key];
            }
        });

        $scope.applyNewData({ "trafficCount": Object.keys($scope.trafficHash).length });
    }

    function onMessageNew(msg) {
        if (($scope === undefined) || ($scope === null)) {
            removeEventListener("RadarChanged", onMessageNew);
            return; // we are getting called once after clicking away from the status page
        }

        $scope.trafficHash[msg.detail.Icao_addr] = new Date();
        cleanupTrafficHash();

        $scope.applyNewData({ "trafficCount": Object.keys($scope.trafficHash).length });
    }


      // Download Alerts list, up to MAX which shall be 100 items
  $scope.refreshAlertsAsync = function() {
    $http.get(URL_ALERTS_GET).then(function (response) {
      var status = angular.fromJson(response.data);
      $scope.applyNewData({AlertsCount:status.length});

    });
  }



    $scope.init = function (position) {
        $scope.position = position;
        $scope.items = $scope.itemsByPosition[$scope.position];
        addEventListener("SituationUpdated", situationUpdated);
        addEventListener("EMSUpdated", emsUpdated);
        addEventListener("RadarChanged", onMessageNew);

        $scope.refreshAlertsAsync();
    }

    $scope.itemsByPosition = {
        "top": [
            { "value": "X", "color": "#5c5c5c", "url": "#/radar", "action": "", "title": "TRAF\nNEAR" },
            { "value": "", "color": "#5c5c5c", "url": "", "action": "LP", "title": "LEFT\nPNL" },
            { "value": "", "color": "#5c5c5c", "url": "", "action": "RP", "title": "RIGHT\nPNL" },
            { "value": "X", "color": "#5c5c5c", "url": "#/alerts", "action": "", "title": "AL\nRM" },
            { "value": "+", "color": "#5c5c5c", "url": "", "action": "FS", "title": "" },
        ], "bottom": [
            { "value": "X", "color": "#5c5c5c", "url": "#/speed", "title": "IAS\nKMH" },
            { "value": "X", "color": "#5c5c5c", "url": "#/gmetergauge", "title": "MAX\nG" },
            /*
            { "value": "X", "color": "#5c5c5c", "url": "#/ems", "title": "OIL\n°C" },
            */
            { "value": "X", "color": "#5c5c5c", "url": "#/autopilot", "title": "TRK\nDEG" },
            { "value": "X", "color": "#5c5c5c", "url": "#/altimeter", "title": "QNH\nhPa" }
        ]
    };


    if (localDisplayGetFlag('uiSidebarLeft') == "true") {
        $scope.itemsByPosition["top"][1].color = "#00ff00";
    } else {
        $scope.itemsByPosition["top"][1].color = "#5c5c5c";
    }
    if (localDisplayGetFlag('uiSidebarRight') == "true") {
        $scope.itemsByPosition["top"][2].color = "#00ff00";
    } else {
        $scope.itemsByPosition["top"][2].color = "#5c5c5c";
    }

    $scope.position = "bottom";
    $scope.items = $scope.itemsByPosition[$scope.position];

    $scope.$on('$destroy', function () {
        console.log('Controller is being destroyed BOTTOM');
        // cleanup code here (remove listeners, cancel intervals, etc.)
        removeEventListener("SituationUpdated", situationUpdated);
        removeEventListener("RadarChanged", onMessageNew);
        removeEventListener("EMSUpdated", emsUpdated);
    });

};
