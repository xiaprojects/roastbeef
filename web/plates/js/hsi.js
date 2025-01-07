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
    $scope.overrideHSI=0;
    $scope.GPSGroundSpeedReference = 200;

    $scope.situation = { "GPSLastFixSinceMidnightUTC": 32304.2, "GPSLatitude": 43.0, "GPSLongitude": 12.0, "GPSFixQuality": 1, "GPSHeightAboveEllipsoid": 1057.4148, "GPSGeoidSep": 145.34122, "GPSSatellites": 8, "GPSSatellitesTracked": 12, "GPSSatellitesSeen": 10, "GPSHorizontalAccuracy": 5.4, "GPSNACp": 10, "GPSAltitudeMSL": 912.07355, "GPSVerticalAccuracy": 10.700001, "GPSVerticalSpeed": 0, "GPSLastFixLocalTime": "0001-01-01T00:49:25.51Z", "GPSTrueCourse": 48.3, "GPSTurnRate": 0, "GPSGroundSpeed": 0, "GPSLastGroundTrackTime": "0001-01-01T00:49:25.51Z", "GPSTime": "2023-12-31T08:58:24.3Z", "GPSLastGPSTimeStratuxTime": "0001-01-01T00:49:25.51Z", "GPSLastValidNMEAMessageTime": "0001-01-01T00:49:25.51Z", "GPSLastValidNMEAMessage": "$GPGGA,085824.20,4311.12143,N,01208.18939,E,1,08,1.08,278.0,M,44.3,M,,*51", "GPSPositionSampleRate": 9.99973784244331, "BaroTemperature": 29.04, "BaroPressureAltitude": 776.60333, "BaroVerticalSpeed": -1.2355082, "BaroLastMeasurementTime": "0001-01-01T00:49:25.52Z", "BaroSourceType": 1, "AHRSPitch": -56.752181757536206, "AHRSRoll": -77.98562991928083, "AHRSGyroHeading": 3276.7, "AHRSMagHeading": 332.9175199350767, "AHRSSlipSkid": 78.88479760867865, "AHRSTurnRate": 3276.7, "AHRSGLoad": 0.10920454632244811, "AHRSGLoadMin": 0.10626655052683534, "AHRSGLoadMax": 0.1099768285851461, "AHRSLastAttitudeTime": "0001-01-01T00:49:25.51Z", "AHRSStatus": 7 };




    $scope.autopilotLoadCurrentStatus = function () {
        // Restore Flight Plan
        $http.get(URL_AUTOPILOT_GET).then(function (response) {
            var status = angular.fromJson(response.data);
            if (status.length > 0) {
                $scope.directTo = status[status.length-1];

            }
            else {
            }
        });
        }



    /*****************************************************
     * Situation Update
     */
    function connect($scope) {
        if ($state.current.controller != 'HSICtrl') return;

        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.socket === undefined) || ($scope.socket === null)) {
            socket = new WebSocket(URL_GPS_WS);
            $scope.socket = socket; // store socket in scope for enter/exit usage
        }


        socket.onopen = function (msg) {
        };

        socket.onclose = function (msg) {
            delete $scope.socket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        socket.onerror = function (msg) {
        };

        socket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null)) {
                socket.close();
                return;
            }
            var situation = angular.fromJson(msg.data);
            // Filter to avoid blow up CPU
            const oldSituation = $scope.situation;
            const newSituation = situation;
            const ahrsThreshold = 2;
            const altitudeThreshold = 50 / 3.2808;
            const requireRefresh = globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold);
            if (requireRefresh == true) {
                $scope.situation = situation;
                loadSituationInHSI(situation);
                $scope.$apply(); // trigger any needed refreshing of data
            }
            else {
                return;
            }


        };
    }

    $scope.hsi = new HSICircleRenderer("hsi", {});
    connect($scope);
    $scope.autopilotLoadCurrentStatus();

    $state.get('hsi').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('hsi').onExit = function () {
        removeEventListener("keypad", keypadEventListener);
        removeEventListener("WaypointChanged", waypointChanged);

        $scope.noSleep.disable();
        delete $scope.noSleep;

        if (($scope.socket !== undefined) && ($scope.socket !== null)) {
            $scope.socket.close();
            $scope.socket = null;
        }
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


    function loadSituationInHSI(situation) { // mySituation
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
}

