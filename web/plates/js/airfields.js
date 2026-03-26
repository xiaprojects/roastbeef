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
 */

angular.module('appControllers').controller('AirfieldsCtrl', AirfieldsCtrl); // get the main module controllers set
AirfieldsCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies


var URL_AUTOPILOT_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/autopilot";
var URL_AUTOPILOT_SET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/autopilot";
var URL_AIRFIELDS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/db.airfields.json";

var WAYPOINT_STATUS_PATH = 0;       // On the way
var WAYPOINT_STATUS_TARGET = 1;     // Next target
var WAYPOINT_STATUS_PAST = 2;       // Past

// create our controller function with all necessary logic
function AirfieldsCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.$parent.helppage = 'plates/autopilot-help.html';
    /*
    $scope.noSleep = new NoSleep();
    */

    /*****************************************************
     * Sample Data and Defaults
     */


    // Airfields management
    $scope.airfieldsSortByDistance = true;
    $scope.airfields = [
    ];

    $scope.situation = window.situation;
    $scope.scrollItemCounter = 0;
    $scope.GPSGroundSpeedReference = 200;
    $scope.gpx = { "routes": [] };


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


    $scope.directToNearest = function () {
        var minDistance = 99999999;
        var lastPoint = $scope.directTo;
        var lastTo = $scope.to;
        var lastX = 0;
        var lastY = 0;
        for (var x = 0; x < $scope.gpx.routes.length; x++) {
            for (var y = 0; y < $scope.gpx.routes[x].points.length; y++) {
                var point = $scope.gpx.routes[x].points[y];
                if (point.Status == WAYPOINT_STATUS_PAST) {
                    continue;
                }
                var to = $scope.calcRouting(
                    $scope.situation.GPSTrueCourse - $scope.overrideHSI,
                    $scope.situation.BaroPressureAltitude,
                    point.Ele,
                    $scope.situation.GPSLatitude,
                    $scope.situation.GPSLongitude,
                    point.Lat,
                    point.Lon
                );
                if (minDistance > to.dist) {
                    minDistance = to.dist;
                    lastPoint = point;
                    lastTo = to;
                    lastX = x;
                    lastY = y;
                }
            }
        }
        if (lastPoint.Lat != $scope.directTo.Lat) {
            // Uprade to new point
            $scope.directToWaypoint(lastX, lastY);
        }
    }
    $scope.calculateDistanceFromAirfields = function () {
            for (var y = 0; y < $scope.airfields.length; y++) {
                var orig = {
                    Ele:$scope.situation.GPSAltitudeMSL,
                    Lat:$scope.situation.GPSLatitude,
                    Lon:$scope.situation.GPSLongitude
                }
                var point = $scope.airfields[y];
                var routing = $scope.calcRouting(
                    0,
                    orig.Ele,
                    point.Ele,
                    orig.Lat,
                    orig.Lon,
                    point.Lat,
                    point.Lon
                )

                $scope.airfields[y].trk = routing.trk;
                $scope.airfields[y].dist = routing.dist;
                if ($scope.situation.GPSGroundSpeed > 10) {
                    $scope.GPSGroundSpeedReference = $scope.situation.GPSGroundSpeed;
                }
                else {
                }
                $scope.airfields[y].time = 60.0 * $scope.airfields[y].dist * 1.852 / $scope.GPSGroundSpeedReference;
            }
    }


    $scope.reindex = function () {
        // Calc distance and intermediate track
        for (var x = 0; x < $scope.gpx.routes.length; x++) {
            var time = 0;
            var dist = 0;
            for (var y = 0; y < $scope.gpx.routes[x].points.length; y++) {
                var orig = {
                    Ele:$scope.situation.GPSAltitudeMSL,
                    Lat:$scope.situation.GPSLatitude,
                    Lon:$scope.situation.GPSLongitude
                }
                if(y>0) {
                    orig = $scope.gpx.routes[x].points[y - 1];
                }
                var point = $scope.gpx.routes[x].points[y];
                var routing = $scope.calcRouting(
                    0,
                    orig.Ele,
                    point.Ele,
                    orig.Lat,
                    orig.Lon,
                    point.Lat,
                    point.Lon
                )

                $scope.gpx.routes[x].points[y].trk = routing.trk;
                $scope.gpx.routes[x].points[y].dist = routing.dist;
                if ($scope.situation.GPSGroundSpeed > 10) {
                    $scope.GPSGroundSpeedReference = $scope.situation.GPSGroundSpeed;
                }
                else {
                    /*
                    $scope.gpx.routes[x].points[y].time = 0;
                    $scope.gpx.routes[x].points[y].ete = 0;
                    $scope.gpx.routes[x].points[y].ata = 0;
                    */
                }
                $scope.gpx.routes[x].points[y].time = 60.0 * $scope.gpx.routes[x].points[y].dist * 1.852 / $scope.GPSGroundSpeedReference;
                $scope.gpx.routes[x].points[y].ete = textBySeconds($scope.gpx.routes[x].points[y].time);
                $scope.gpx.routes[x].points[y].ata = textBySeconds($scope.gpx.routes[x].points[y].time + new Date().getHours() * 60 + new Date().getMinutes())

                time += $scope.gpx.routes[x].points[y].time;
                dist += $scope.gpx.routes[x].points[y].dist;
            }
            $scope.gpx.routes[x].dist = dist;
            $scope.gpx.routes[x].time = time;
        }

        // Assign index for HTML
        for (var x = 0; x < $scope.gpx.routes.length; x++) {
            for (var y = 0; y < $scope.gpx.routes[x].points.length; y++) {
                $scope.gpx.routes[x].points[y].index = y;
                if ($scope.gpx.routes[x].points[y].Status == WAYPOINT_STATUS_PATH) {
                    $scope.gpx.routes[x].points[y].style = "";
                }
                if ($scope.gpx.routes[x].points[y].Status == WAYPOINT_STATUS_TARGET) {
                    $scope.gpx.routes[x].points[y].style = "background-color:#4cd964;";
                    $scope.directTo = $scope.gpx.routes[x].points[y];
                }
                if ($scope.gpx.routes[x].points[y].Status == WAYPOINT_STATUS_PAST) {
                    $scope.gpx.routes[x].points[y].style = "background-color:lightgray;";
                }
            }
            $scope.gpx.routes[x].index = x;
        }
    }
    $scope.gpxImportData = function (gpxParserInstance) {

        // Multi routing will be managed in the future: Client side is ready, Server side requires some ehancements
        $scope.gpx.routes = [];

        for (var x = 0; x < gpxParserInstance.routes.length; x++) {
            var route = {
                "points": [],
                "index": $scope.gpx.routes.length,
                "Cmt": gpxParserInstance.routes[x].cmt ? gpxParserInstance.routes[x].cmt : gpxParserInstance.routes[x].name,
                "name": gpxParserInstance.routes[x].name,
                "desc": gpxParserInstance.routes[x].desc ? gpxParserInstance.routes[x].desc : "",
                "time": 0,
                "dist": 0
            }

            for (var y = 0; y < gpxParserInstance.routes[x].points.length; y++) {
                var point = {
                    "trk": 0,
                    "dist": 0,
                    "slope": 0,
                    "ete": 0,
                    "ata": 0,
                    "className": "keypadSelectedNo",
                    "time": 0,
                    "Status": gpxParserInstance.routes[x].points[y].Status ? gpxParserInstance.routes[x].points[y].Status : 0,
                    "Lat": gpxParserInstance.routes[x].points[y].lat ? gpxParserInstance.routes[x].points[y].lat : gpxParserInstance.routes[x].points[y].Lat,
                    "Lon": gpxParserInstance.routes[x].points[y].lon ? gpxParserInstance.routes[x].points[y].lon : gpxParserInstance.routes[x].points[y].Lon,
                    "Ele": parseInt(((gpxParserInstance.routes[x].points[y].ele ? gpxParserInstance.routes[x].points[y].ele * 3.28084 : gpxParserInstance.routes[x].points[y].Ele))),
                    "Cmt": gpxParserInstance.routes[x].points[y].cmt ? gpxParserInstance.routes[x].points[y].cmt : (gpxParserInstance.routes[x].points[y].Cmt ? gpxParserInstance.routes[x].points[y].Cmt : gpxParserInstance.routes[x].points[y].name),
                    "name": gpxParserInstance.routes[x].points[y].name ? gpxParserInstance.routes[x].points[y].name : "",
                    "desc": gpxParserInstance.routes[x].points[y].desc ? gpxParserInstance.routes[x].points[y].desc : "",
                    "index": route.points.length
                }
                route.points.push(point);
            }
            $scope.gpx.routes.push(route);
        }
        $scope.reindex();
    }

    
    $scope.uploadWaypoints = function () {
        if ($scope.gpx.routes.length > 0) {
            $scope.engageAutopilot($scope.gpx.routes[0].points);        
        }
    }

    $scope.engageAutopilot = function (points) {
        if (points.length > 0) {
            var msg = JSON.stringify(points);
            $http.post(URL_AUTOPILOT_SET, msg).then(function (response) {
                // if the upload is positive, check for TARGET, if there is any, Start() navigation
                var foundTarget = -1;
                for (var x = 0; x < $scope.gpx.routes.length; x++) {
                    for (var y = 0; y < $scope.gpx.routes[x].points.length; y++) {
                        if ($scope.gpx.routes[x].points[y].Status == WAYPOINT_STATUS_TARGET) {
                            foundTarget = y;
                        }
                    }
                }
                if (foundTarget >= 0) {
                    $http.put(URL_AUTOPILOT_SET, "").then(function (response) {
                    });
                }
                else {
                    $scope.autopilotStop();
                }
            });
        }
    }

    $scope.directToAirfield = function(point) {
        point.Status = WAYPOINT_STATUS_TARGET
        $scope.gpxImportData({
            "routes": [{
                "points": [  {
                    "Lat": $scope.situation.GPSLatitude,
                    "Lon": $scope.situation.GPSLongitude,
                    "Ele": $scope.situation.BaroPressureAltitude,
                    "Status": WAYPOINT_STATUS_PAST,
                    "Cmt": "Current Position"
                 },  point],
                "index": 0,
                "Cmt": point.Cmt,
                "name": point.Cmt,
                "desc": point.Cmt,
                "time": 0,
                "dist": 0
            }]
        });
        $scope.uploadWaypoints();
        // Autoselect the HSI
        window.setTimeout(()=>{
            document.location="#/hsi"
        },500);
        

    }


    /*****************************************************
     *  Controller routines
     */
    $state.get('airfields').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('airfields').onExit = function () {
        removeEventListener("keypad", keypadEventListener);

/*
        $scope.noSleep.disable();
        delete $scope.noSleep;
*/
        if (($scope.socket !== undefined) && ($scope.socket !== null)) {
            $scope.socket.close();
            $scope.socket = null;
        }
    };


    /*****************************************************
     *  Keypad Management
     */
    $scope.redrawSelectedIndex = function () {

            for (var y = 0; y < $scope.airfields.length; y++) {
                // TODO: Add multi route scroll keypad
                if ($scope.scrollItemCounter == y) {
                    $scope.airfields[y].className = "keypadSelectedYesFull";
                    document.getElementById("line_" + 0 + "_"+ y).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });

                }
                else {
                    $scope.airfields[y].className = "keypadSelectedNo";
                }
            }
    }


    function keypadEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller!='AirfieldsCtrl'){
            removeEventListener("keypad", keypadEventListener);
            return; // we are getting called once after clicking away from the status page
        }

        if ($scope.keypadKnobTimerRemovePopup === undefined) {
        }
        else
        {
            // user is changing screen
            return;
        }

        switch (event.key) {
            case KEYPAD_MAPPING_PREV_MEDIA:
            case KEYPAD_MAPPING_PREV:
            case "ArrowUp":
            case "ArrowLeft":
                $scope.autopilotSelectPrev();
                break;
            case "Enter":
            case " ":
            case KEYPAD_MAPPING_TAP:
                $scope.autopilotSelectTap();
                break;
            case "ArrowDown":
            case "ArrowRight":
            case KEYPAD_MAPPING_NEXT_MEDIA:
            case KEYPAD_MAPPING_NEXT:
                $scope.autopilotSelectNext();
                break;
        }
    }



    $scope.autopilotSelectPrev = function () {

            $scope.scrollItemCounter--;
            if ($scope.scrollItemCounter <0) {
                $scope.scrollItemCounter = 0;
                const proxy = new KeyboardEvent("keypad", { key: "from" });
                dispatchEvent(proxy);
            }
            else {
                $scope.redrawSelectedIndex();
                $scope.$apply();
            }
        
    }
    $scope.autopilotSelectNext = function () {


            $scope.scrollItemCounter++;

            var availableItems = $scope.airfields.length;

            if ($scope.scrollItemCounter >= availableItems) {
                $scope.scrollItemCounter = availableItems -1;
                const proxy = new KeyboardEvent("keypad", { key: "to" });
                dispatchEvent(proxy);
            }
            else {
                $scope.redrawSelectedIndex();
                $scope.$apply();
            }

    }

    $scope.autopilotSelectTap = function () {
        switch ($scope.scrollItemCounter) {
            default:
                var availableItems = $scope.airfields.length;

                if ($scope.scrollItemCounter < availableItems) {
                    // TODO: support for multi routing keypad
                    $scope.directToAirfield($scope.airfields[$scope.scrollItemCounter]);
                }
                break;
        }
        $scope.$apply();
    }

    /*****************************************************
     * Replicate the AHRS
     */
    // GPS/AHRS Controller tasks go here

    /*****************************************************
     * Situation Update
     */
    function connect($scope) {
        if($state.current.controller!='AirfieldsCtrl')return;

        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.socket === undefined) || ($scope.socket === null)) {
            socket = new WebSocket(URL_GPS_WS);
            $scope.socket = socket; // store socket in scope for enter/exit usage
        }

        $scope.ConnectState = "Disconnected";

        socket.onopen = function (msg) {
            // $scope.ConnectStyle = "label-success";
            $scope.ConnectState = "Connected";
        };

        socket.onclose = function (msg) {
            // $scope.ConnectStyle = "label-danger";
            $scope.ConnectState = "Disconnected";
            $scope.$apply();
            delete $scope.socket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        socket.onerror = function (msg) {
            // $scope.ConnectStyle = "label-danger";
            $scope.ConnectState = "Error";
            resetSituation();
            $scope.$apply();
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
                loadSituationInAutopilot(situation);
                $scope.$apply(); // trigger any needed refreshing of data
            }
            else
            {
                return;
            }
    

        };
    }

    /*****************************************************
    * Init
    */

    addEventListener("keypad", keypadEventListener);

    //$scope.tickForAll();

    // GPS Controller tasks
    //connect($scope); // connect - opens a socket and listens for messages
    if(window.situation)$scope.situation = window.situation;
    





    $scope.airfieldsReload = function () {
        $http.get(URL_AIRFIELDS_GET).then(function (response) {
            var status = angular.fromJson(response.data);
            if (status.length > 0) {
                $scope.airfields = [];
                status.forEach(element => {
                    element.Cmt = (element.gps_code==""?"":element.gps_code + " - ") + (element.local_code==""?"":element.local_code+" - ") + element.name
                    element.className ="keypadSelectedNo";
                    $scope.airfields.push(element);
                });
                $scope.calculateDistanceFromAirfields();
                if($scope.airfieldsSortByDistance==true){
                    $scope.airfields.sort((a, b) => a.dist - b.dist);
                } else {
                    $scope.airfields.sort((a, b) => a.Cmt.localeCompare(b.Cmt));
                }
                for(var x=0;x<$scope.airfields.length;x++)
                {
                    //$scope.airfields[x].style =  x%2==0?"background-color:lightgray;":""
                    $scope.airfields[x].index=x;
                }
                $scope.airfields[0].className ="keypadSelectedYesFull";
                // Trim the list to the first 50 results
                if($scope.airfields.length>50){
                    $scope.airfields = $scope.airfields.slice(0, 50);
                }

            }
    });        
    }
    // Try to wait for situation update, this will allow to calculate also the first point
    window.setTimeout(()=>{    
        $scope.airfieldsReload();
    },100);

}

