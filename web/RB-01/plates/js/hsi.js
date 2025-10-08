/*
    Copyright (c) 2025 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    hsi.js
*/

angular.module('appControllers').controller('HSICtrl', HSICtrl); // get the main module controllers set
HSICtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

// create our controller function with all necessary logic
function HSICtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.name="HSICtrl";
    $scope.controllerName = $scope.name;
    $scope.foregroundColor = "#ffffff"
    $scope.init = function (controllerName,foregroundColor) {
        $scope.controllerName = controllerName;
        $scope.foregroundColor = foregroundColor;
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
    function SituationUpdated(event) {
        if (($scope === undefined) || ($scope === null) || ($state.current.controller != $scope.controllerName)) {
            removeEventListener("SituationUpdated", SituationUpdated);
            return; // we are getting called once after clicking away from the status page
        }

        $scope.loadSituationInHSI(event.detail)
    }


    $scope.hsi = null;

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

if($scope.hsi==null){
        $scope.hsi = new HSICircleRenderer("hsi", {}, $scope.foregroundColor);
}

        $scope.situation = situation;
        $scope.tickForRouting();
        $scope.hsi.update(
            $scope.situation.GPSTrueCourse,
            {},
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

        $scope.hsi.update(
            $scope.situation.GPSTrueCourse,
            {},
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

