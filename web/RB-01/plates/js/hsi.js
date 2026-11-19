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

    hsi.js
*/

// HSI values for the DOM in css/Hsi.css and the markup of plates/hsi.html, synthview.html,
// autopilot.html and addons/vor.html. No DOM code here: hosts keep the result on $scope.HSI
// and the markup binds it, like $scope.Altimeter. Geometry of the old SVG.js drawing: a
// viewbox of 280 units, so 1 unit = 100/280 cqw.

// Compass card: a tick every 5 degrees, long ones every 15, none under the letters
const HSI_TICKS = [];   // {deg, big}  - deg % 90 != 0
for (let deg = 0; deg < 360; deg += 5) {
    if (deg % 90 == 0) continue;
    HSI_TICKS.push({ deg: deg, big: deg % 15 == 0 });
}
// N E S W at 0/90/180/270, 3 6 12 15 21 24 30 33 on the 30 degree steps between
const HSI_LABELS = [
    { deg: 0, text: "N", cardinal: true }, { deg: 30, text: "3", cardinal: false },
    { deg: 60, text: "6", cardinal: false }, { deg: 90, text: "E", cardinal: true },
    { deg: 120, text: "12", cardinal: false }, { deg: 150, text: "15", cardinal: false },
    { deg: 180, text: "S", cardinal: true }, { deg: 210, text: "21", cardinal: false },
    { deg: 240, text: "24", cardinal: false }, { deg: 270, text: "W", cardinal: true },
    { deg: 300, text: "30", cardinal: false }, { deg: 330, text: "33", cardinal: false }
];
const HSI_UNIT_CQW = 100 / 280;

// showGs / showCdi: the VOR addon parks the GS diamonds and the CDI bar when there is no
// usable signal; the other hosts always draw them. gsActive: a glideslope signal is being
// received (only the VOR addon has a receiver), it gates the small "GS" labels
function hsiCreate(foregroundColor) {
    return { fg: foregroundColor, ticks: HSI_TICKS, labels: HSI_LABELS,
             sides: ["left", "right"], gsDots: [-4, -3, -2, -1, 0, 1, 2, 3, 4],
             courseDots: [-3, -2, -1, 0, 1, 2, 3],
             showGs: true, showCdi: true, gsActive: false,
             card: "0deg", course: "0deg", bug: "0deg", cdi: "0cqw", gs: "0cqw" };
}

// Same arguments, order and clamps as the SVG.js renderer this replaced, minus its
// unused `item`
function hsiUpdate(HSI, outer, center, vertical, radial, glideSlope) {
    const num = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
    vertical = Math.max(-6, Math.min(6, num(vertical)));
    glideSlope = Math.max(-15, Math.min(15, num(glideSlope)));
    HSI.card = (-num(outer)) + "deg";
    HSI.course = (-num(center)) + "deg";
    HSI.bug = num(radial) + "deg";
    HSI.cdi = (-vertical * 12.5 * HSI_UNIT_CQW) + "cqw";
    HSI.gs = (-glideSlope * 25 / 3 * HSI_UNIT_CQW) + "cqw";
}

angular.module('appControllers').controller('HSICtrl', HSICtrl); // get the main module controllers set
HSICtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

// create our controller function with all necessary logic
function HSICtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.name="HSICtrl";
    $scope.controllerName = $scope.name;
    $scope.foregroundColor = "#ffffff"
    $scope.HSI = hsiCreate($scope.foregroundColor);
    $scope.init = function (controllerName,foregroundColor) {
        $scope.controllerName = controllerName;
        $scope.foregroundColor = foregroundColor;
        $scope.HSI.fg = foregroundColor;
    }
    $scope.directTo = {
        "Lat": 0,
        "Lon": 0,
        "Ele": 0,
        "Cmt": ""
    };

    $scope.to = {
        trk: 0.0,
        Ele: 0.0,
        slope: 0.0,
        ata: "--:--",
        ete: "--:--",
        xtrk: 0.0,
        dele: 0.0,
        dist: 0.0
    };
    $scope.overrideHSI = 0;


    $scope.autopilotLoadCurrentStatus = function () {
        // Restore Flight Plan
        $http.get(URL_AUTOPILOT_GET).then(function (response) {
            var status = angular.fromJson(response.data);
            if (status.length > 0) {
                $scope.directTo = status[status.length - 1];

            }
            else {
            }
        });
    }



    /*****************************************************
     * Situation Update
     */

    addEventListener("SituationUpdated", SituationUpdated);
    $scope.hsiDataRequestedRefresh = 0;
    function SituationUpdated(event) {
        if (($scope === undefined) || ($scope === null) || ($state.current.controller != $scope.controllerName)) {
            removeEventListener("SituationUpdated", SituationUpdated);
            return; // we are getting called once after clicking away from the status page
        }

        if($scope.situation.GPSTrueCourse == event.detail.GPSTrueCourse) {
            return;
        }
        var now = Date.now();
        if (now - $scope.hsiDataRequestedRefresh < 1000) {
            return;
        }
        $scope.hsiDataRequestedRefresh = now;

        $scope.loadSituationInHSI(event.detail);
        if (!$scope.$root.$$phase) $scope.$apply(); // the DOM is bound: digest
    }


    $scope.autopilotLoadCurrentStatus();

    $state.get('hsi').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('hsi').onExit = function () {
        removeEventListener("keypad", keypadEventListener);
        removeEventListener("WaypointChanged", waypointChanged);
        removeEventListener("SituationUpdated", SituationUpdated);
    };







    /*****************************************************
     * XTRK Routines
     */

    // Converts from degrees to radians.
    function toRadians(degrees) {
        return degrees * Math.PI / 180;
    };

    // Converts from radians to degrees.
    function toDegrees(radians) {
        return radians * 180 / Math.PI;
    }

    function bearing(startLng, startLat, destLng, destLat) {
        startLat = toRadians(startLat);
        startLng = toRadians(startLng);
        destLat = toRadians(destLat);
        destLng = toRadians(destLng);

        y = Math.sin(destLng - startLng) * Math.cos(destLat);
        x = Math.cos(startLat) * Math.sin(destLat) - Math.sin(startLat) * Math.cos(destLat) * Math.cos(destLng - startLng);
        brng = Math.atan2(y, x);
        brng = toDegrees(brng);
        return (brng + 360) % 360;
    }

    function distance(lon1, lat1, lon2, lat2) {
        var R = 6371; // Radius of the earth in km
        var dLat = toRadians(lat2 - lat1);  // deg2rad below
        var dLon = toRadians(lon2 - lon1);
        var a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
            ;
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        var d = R * c; // Distance in km
        return d;
    }



    $scope.calcRouting = function (currentTrk, currentAltitude, destElevantion, lat1, lon1, lat2, lon2) {
        var trk = bearing(lon1, lat1, lon2, lat2)
        var newTo = {
            Lon: lon1,
            Lat: lat1,
            trk: trk,
            Ele: destElevantion,
            xtrk: currentTrk - trk,
            hsi: 0,
            dele: destElevantion - currentAltitude,
            dist: distance(lon1, lat1, lon2, lat2) / 1.852
        };
        newTo.hsi = newTo.dist * Math.tan(toRadians(newTo.xtrk));
        if (newTo.dist == 0 || newTo.dele == 0) {
            newTo.slope = 0;
        }
        else {
            // 1925
            var delemeters = (newTo.dele / 32.8084);
            var distmeters = (1.852 * newTo.dist);
            newTo.slope = delemeters / distmeters;
        }
        if (newTo.slope > 99) {
            newTo.slope = 99;
        }
        else
            if (newTo.slope < -99) {
                newTo.slope = -99;
            }


        if (newTo.xtrk > 180) {
            newTo.xtrk = newTo.xtrk - 360;
        }
        if (newTo.xtrk < -180) {
            newTo.xtrk = newTo.xtrk + 360;
        }


        newTo.time = 60.0 * newTo.dist * 1.852 / $scope.GPSGroundSpeedReference;
        newTo.ete = textBySeconds(newTo.time);
        newTo.ata = textBySeconds(newTo.time + new Date().getHours() * 60 + new Date().getMinutes())



        return newTo;
    }


    $scope.tickForRouting = function () {
        var point = $scope.directTo;
        var to = $scope.calcRouting(
            $scope.situation.GPSTrueCourse - $scope.overrideHSI,
            $scope.situation.BaroPressureAltitude,
            point.Ele,
            $scope.situation.GPSLatitude,
            $scope.situation.GPSLongitude,
            point.Lat,
            point.Lon
        );
        $scope.to = to;
    }

    $scope.situation = {};
    $scope.loadSituationInHSI = function (situation) { // mySituation

        $scope.situation = situation;
        $scope.tickForRouting();
        hsiUpdate($scope.HSI,
            $scope.situation.GPSTrueCourse,
            $scope.to.xtrk,
            $scope.to.hsi,
            $scope.overrideHSI,
            $scope.to.slope
        );
    }



    // Keypad Listener with supported keys
    function keypadEventListener(event) {
        if (($scope === undefined) || ($scope === null) || ($state.current.controller != $scope.controllerName)) {
            removeEventListener("keypad", keypadEventListener);
            return; // we are getting called once after clicking away from the status page
        }

        // TODO: Keypad mixing with other screen to add a flag
        if($scope.name !=  $scope.controllerName)
        {
            removeEventListener("keypad", keypadEventListener);
            return; // we are getting called once after clicking away from the status page
        }


        if ($scope.keypadKnobTimerRemovePopup === undefined) {
        }
        else {
            // user is changing screen
            return;
        }

        switch (event.key) {

            case KEYPAD_MAPPING_PREV:

                $scope.overrideHSI = $scope.overrideHSI - 5;
                break;
            case KEYPAD_MAPPING_TAP:
                $scope.overrideHSI = 0;
                break;
            case KEYPAD_MAPPING_NEXT:
                $scope.overrideHSI = $scope.overrideHSI + 5;
                break;
        }
        $scope.tickForRouting();

        hsiUpdate($scope.HSI,
            $scope.situation.GPSTrueCourse,
            $scope.to.xtrk,
            $scope.to.hsi,
            $scope.overrideHSI,
            $scope.to.slope
        );
        $scope.$apply();
    }

    addEventListener("keypad", keypadEventListener);
    addEventListener("WaypointChanged", waypointChanged);

    function waypointChanged(event) {
        if (($scope === undefined) || ($scope === null)) {
            removeEventListener("WaypointChanged", waypointChanged);
            return; // we are getting called once after clicking away from the status page
        }
        console.log(event);
        $scope.autopilotLoadCurrentStatus();
    }
}

