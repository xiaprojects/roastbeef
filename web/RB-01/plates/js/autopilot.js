/*
    Copyright (c) 2023 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    autopilot.js
*/

angular.module('appControllers').controller('AutopilotCtrl', AutopilotCtrl); // get the main module controllers set
AutopilotCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies


var URL_AUTOPILOT_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/autopilot";
var URL_AUTOPILOT_SET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/autopilot";
var URL_AIRFIELDS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/db.airfields.json";

var WAYPOINT_STATUS_PATH = 0;       // On the way
var WAYPOINT_STATUS_TARGET = 1;     // Next target
var WAYPOINT_STATUS_PAST = 2;       // Past

// create our controller function with all necessary logic
function AutopilotCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.$parent.helppage = 'plates/autopilot-help.html';
    $scope.data_list = [];
    $scope.isHidden = false;
/*
    $scope.noSleep = new NoSleep();
*/

    /*****************************************************
     * Sample Data and Defaults
     */
    // Initial version, keep the last Flight Plan into local storage, roadmap: move into server storage and favourites routes
    if (window.localStorage.getItem("autopilotLastPlan") === undefined || window.localStorage.getItem("autopilotLastPlan") === false || window.localStorage.getItem("autopilotLastPlan") == null) {
        let sampleGpxLIQQLIRJ = '<?xml version="1.0" encoding="utf-8" ?><gpx xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="PocketFMS EasyVFR">    <rte>        <name>flightplansLIQQ Serristori to LIRJ Marina di Ca...xml</name>        <rtept lat="43.332500" lon="11.858056">            <ele>263.956800</ele>            <name>LIQQ</name>            <cmt>LIQQ Serristori, 866ft</cmt>            <desc>LIQQ Serristori, 866ft</desc>            <sym>Airport</sym>        </rtept>        <rtept lat="43.236301" lon="11.557300">            <ele>1066.800000</ele>            <name>Asciano (1), SI (IT)</name>            <cmt>Asciano</cmt>            <desc>Asciano</desc>            <sym>Waypoint</sym>        </rtept>        <rtept lat="43.137222" lon="11.173333">            <ele>1066.800000</ele>            <name>LIRS-RSNE1</name>            <cmt>LIRS-RSNE1 Monticiano</cmt>            <desc>LIRS-RSNE1 Monticiano</desc>            <sym>Waypoint</sym>        </rtept>        <rtept lat="43.054401" lon="10.887700">            <ele>1066.800000</ele>            <name>Massa Marittima (IT)</name>            <cmt>Massa Marittima</cmt>            <desc>Massa Marittima</desc>            <sym>Waypoint</sym>        </rtept>        <rtept lat="42.925499" lon="10.528200">            <ele>609.600000</ele>            <name>Piombino (IT)</name>            <cmt>Piombino</cmt>            <desc>Piombino</desc>            <sym>Waypoint</sym>        </rtept>        <rtept lat="42.761112" lon="10.239722">            <name>LIRJ</name>            <cmt>LIRJ Marina di Campo, 30ft</cmt>            <desc>LIRJ Marina di Campo, 30ft</desc>            <sym>Airport</sym>        </rtept>    </rte></gpx>';
        let sampleGpx = sampleGpxLIQQLIRJ;
        window.localStorage.setItem('autopilotLastPlan', sampleGpx);
    }
    else {
    }
    // Bring me home, by default LIRU, you can override it in settings
    $scope.Autopilot_HomeWaypoint = {
        "Lat": 41.952843,
        "Lon": 12.50197,
        "Ele": 0,
        "Status": 0,
        "Cmt": "Home"
    };

    // Airfields management
    $scope.airfieldsSortByDistance = true;
    $scope.airfields = [
    ];

    $scope.situation = window.situation;
    $scope.scrollItemCounter = -4;
    $scope.ahrsClassSelected = "keypadSelectedYes";
    $scope.hsiClassSelected = "keypadSelectedNo";
    $scope.destClassSelected = "keypadSelectedNo";
    $scope.forecastClassSelected = "keypadSelectedNo";
    $scope.QNH = 1013;
    $scope.isSelectedHSI = false;
    $scope.overrideHSI = 0;
    $scope.GPSGroundSpeedReference = 200;
    $scope.gpx = { "routes": [] };
    $scope.gmeterIcons = [
        { "value": 1, "text": "Min: 1", "name": "gmeter_min", "class": "label-default" },
        { "value": 1, "text": "1", "name": "gmeter_a", "class": "label-default" },
        { "value": 1, "text": "1", "name": "gmeter_b", "class": "label-default" },
        { "value": 1, "text": "1", "name": "gmeter_c", "class": "label-default" },
        { "value": 1, "text": "1", "name": "gmeter_d", "class": "label-default" },
        { "value": 1, "text": "1", "name": "gmeter_max", "class": "label-default" },
        { "value": 1, "text": "1", "name": "gmeter_max", "class": "label-default" },
    ];

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

    $scope.ahrs_heading = "---";
    $scope.ahrs_pitch = "---";
    $scope.ahrs_roll = "--";
    $scope.ahrs_slip_skid = "--";
    $scope.ahrs_heading_mag = "---";
    $scope.ahrs_gload = "--";
    $scope.ahrs_turn_rate = "--";

    $scope.hsi_panel = "col-xs-6";
    /*****************************************************
     * Zoom
     */
    $scope.zoom = function (target) {
        if ($scope[target] == "col-xs-6") {
            $scope[target] = "col-xs-12";
        }
        else {
            $scope[target] = "col-xs-6";
        }
    }


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

    /*****************************************************
     *  GPX Management
     */
    $scope.setUploadFile = function (files) {
        console.log(files);
        if (files.length > 0) {
            let fr = new FileReader();
            fr.onload = function () {
                $scope.gpxImport(fr.result);
            }

            fr.readAsText(files[0]);
        }

    };
    $scope.autopilotStop = function () {
        $http.delete(URL_AUTOPILOT_SET, "").then(function (response) {
        });
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

    $scope.gpxImport = function (xmlSource) {
        var gpxParserInstance = new gpxParser(); //Create gpxParser Object
        window.gpx = gpxParserInstance;
        gpxParserInstance.parse(xmlSource); //parse gpx file from string data
        // Store the XML also in local browser cache in case of reboot
        window.localStorage.setItem('autopilotLastPlan', xmlSource);
        $scope.gpxImportData(gpxParserInstance);
        $scope.uploadWaypoints();
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

    $scope.directToHome = function () {
        $scope.gpxImportData({
            "routes": [{
                "points": [  {
                    "Lat": $scope.situation.GPSLatitude,
                    "Lon": $scope.situation.GPSLongitude,
                    "Ele": $scope.situation.BaroPressureAltitude,
                    "Status": WAYPOINT_STATUS_PAST,
                    "Cmt": "Current Position"
                 },  {
                    "Lat": $scope.Autopilot_HomeWaypoint.Lat,
                    "Lon": $scope.Autopilot_HomeWaypoint.Lon,
                    "Ele": $scope.Autopilot_HomeWaypoint.Ele,
                    "Status": WAYPOINT_STATUS_TARGET,
                    "Cmt": $scope.Autopilot_HomeWaypoint.Cmt
                }],
                "index": 0,
                "Cmt": $scope.Autopilot_HomeWaypoint.Cmt,
                "name": $scope.Autopilot_HomeWaypoint.Cmt,
                "desc": $scope.Autopilot_HomeWaypoint.Cmt,
                "time": 0,
                "dist": 0
            }]
        });
        $scope.uploadWaypoints();
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
                    $scope.to = $scope.directTo;
                }
                if ($scope.gpx.routes[x].points[y].Status == WAYPOINT_STATUS_PAST) {
                    $scope.gpx.routes[x].points[y].style = "background-color:lightgray;";
                }
            }
            $scope.gpx.routes[x].index = x;
        }
    }


    $scope.dropWaypoint = function (routeIndex, waypointIndex) {
        if (routeIndex <= $scope.gpx.routes.length && waypointIndex <= $scope.gpx.routes[routeIndex].points.length) {
            $scope.gpx.routes[routeIndex].points.splice(waypointIndex, 1);
        }
        if ($scope.gpx.routes[routeIndex].points.length == 0) {
            $scope.dropWaypoints(routeIndex);
        }
        else {
            $scope.reindex();
        }
    }

    $scope.dropWaypoints = function (routeIndex) {

        if (routeIndex <= $scope.gpx.routes.length) {
            $scope.gpx.routes.splice(routeIndex, 1);
        }
        $scope.reindex();
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
        $scope.scrollItemCounter = -3;
        $scope.redrawSelectedIndex();

    }

    $scope.directToWaypoint = function (routeIndex, waypointIndex) {
        for (var x = 0; x < $scope.gpx.routes.length; x++) {
            for (var y = 0; y < $scope.gpx.routes[x].points.length; y++) {
                $scope.gpx.routes[x].points[y].style = "";
                // Remove current Target
                if ($scope.gpx.routes[x].points[y].Status == WAYPOINT_STATUS_TARGET) {
                    $scope.gpx.routes[x].points[y].Status = WAYPOINT_STATUS_PATH;
                }
            }
        }

        if (routeIndex <= $scope.gpx.routes.length && waypointIndex <= $scope.gpx.routes[routeIndex].points.length) {
            $scope.directTo = $scope.gpx.routes[routeIndex].points[waypointIndex];
            $scope.gpx.routes[routeIndex].points[waypointIndex].style = "background-color:#4cd964;";
            $scope.gpx.routes[routeIndex].points[waypointIndex].Status = WAYPOINT_STATUS_TARGET;
        }
        $scope.uploadWaypoints();
        // Autoselect the HSI
        $scope.scrollItemCounter = -3;
        $scope.redrawSelectedIndex();
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

    /*****************************************************
     *  Controller routines
     */
    $state.get('autopilot').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('autopilot').onExit = function () {
        removeEventListener("keypad", keypadEventListener);
        removeEventListener("WaypointChanged", waypointChanged);
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
        for (var x = 0; x < $scope.gpx.routes.length; x++) {
            for (var y = 0; y < $scope.gpx.routes[x].points.length; y++) {
                // TODO: Add multi route scroll keypad
                if ($scope.scrollItemCounter == y) {
                    $scope.gpx.routes[x].points[y].className = "keypadSelectedYes";
                    document.getElementById("line_" + x + "_"+ y).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });

                }
                else {
                    $scope.gpx.routes[x].points[y].className = "keypadSelectedNo";
                }
            }
        }


        switch ($scope.scrollItemCounter) {
            case -4:
                $scope.ahrsClassSelected = "keypadSelectedYes";
                $scope.hsiClassSelected = "keypadSelectedNo";
                $scope.destClassSelected = "keypadSelectedNo";
                $scope.forecastClassSelected = "keypadSelectedNo";
                document.getElementById("ahrs_panel").scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });

                break;
            case -3:
                $scope.hsiClassSelected = "keypadSelectedYes";
                $scope.ahrsClassSelected = "keypadSelectedNo";
                $scope.destClassSelected = "keypadSelectedNo";
                $scope.forecastClassSelected = "keypadSelectedNo";
                document.getElementById("hsi_panel").scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                break;
            case -2:
                $scope.hsiClassSelected = "keypadSelectedNo";
                $scope.ahrsClassSelected = "keypadSelectedNo";
                $scope.destClassSelected = "keypadSelectedYes";
                $scope.forecastClassSelected = "keypadSelectedNo";
                document.getElementById("dest_panel").scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });

                break;
            case -1:
                $scope.hsiClassSelected = "keypadSelectedNo";
                $scope.ahrsClassSelected = "keypadSelectedNo";
                $scope.destClassSelected = "keypadSelectedNo";
                $scope.forecastClassSelected = "keypadSelectedYes";
                document.getElementById("forecast_panel").scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });

                break;
            default:
                $scope.hsiClassSelected = "keypadSelectedNo";
                $scope.ahrsClassSelected = "keypadSelectedNo";
                $scope.destClassSelected = "keypadSelectedNo";
                $scope.forecastClassSelected = "keypadSelectedNo";
                break;
        }



    }


    function keypadEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller!='AutopilotCtrl'){
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
            case KEYPAD_MAPPING_PREV:
                $scope.autopilotSelectPrev();
                break;

            case KEYPAD_MAPPING_TAP:
                $scope.autopilotSelectTap();
                break;
            case KEYPAD_MAPPING_NEXT:
                $scope.autopilotSelectNext();
                break;
        }
    }



    $scope.autopilotSelectPrev = function () {
        if ($scope.isSelectedHSI == true) {
            $scope.overrideHSI = $scope.overrideHSI - 1;
            $scope.tickForRouting();
            $scope.hsi.update($scope.situation.GPSTrueCourse,
                {},
                $scope.to.xtrk,
                $scope.to.hsi,
                $scope.overrideHSI,
                $scope.to.slope
            );
            $scope.$apply();
        }
        else {
            $scope.scrollItemCounter--;
            if ($scope.scrollItemCounter <= -5) {
                $scope.scrollItemCounter = -4;
                const proxy = new KeyboardEvent("keypad", { key: "from" });
                dispatchEvent(proxy);
            }
            else {
                $scope.redrawSelectedIndex();
                $scope.$apply();
            }
        }
    }
    $scope.autopilotSelectNext = function () {
        if ($scope.isSelectedHSI == true) {
            $scope.overrideHSI = $scope.overrideHSI + 1;
            $scope.tickForRouting();
            $scope.hsi.update($scope.situation.GPSTrueCourse,
                {},
                $scope.to.xtrk,
                $scope.to.hsi,
                $scope.overrideHSI,
                $scope.to.slope
            );
            $scope.$apply();
        }
        else {

            $scope.scrollItemCounter++;

            var availableItems = 0;
            if ($scope.gpx.routes.length > 0) {
                // TODO: add multiple routings scroll
                availableItems = $scope.gpx.routes[0].points.length;
            }

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
    }

    $scope.autopilotSelectTap = function () {
        switch ($scope.scrollItemCounter) {
            case -4:
            case -3:
            case -2:
            case -1:
                $scope.isSelectedHSI = !$scope.isSelectedHSI;
                break;
            default:
                var availableItems = 0;
                if ($scope.gpx.routes.length > 0) {
                    // TODO: add multiple routings scroll
                    availableItems = $scope.gpx.routes[0].points.length;
                }
                if ($scope.scrollItemCounter < availableItems) {
                    // TODO: support for multi routing keypad
                    $scope.directToWaypoint(0, $scope.scrollItemCounter);
                }
                break;
        }
        $scope.$apply();
    }

    /*****************************************************
     * Replicate the AHRS
     */
    // GPS/AHRS Controller tasks go here
    var ahrs = new AHRSRenderer("ahrs_display");
    ahrs.turn_on();

    /*****************************************************
     * Situation Update
     */
    function connect($scope) {
        if($state.current.controller!='AutopilotCtrl')return;

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
    $scope.hsi = new HSICircleRenderer("hsi", {},"#ffffff");
    addEventListener("keypad", keypadEventListener);
    addEventListener("WaypointChanged", waypointChanged);
    //$scope.tickForAll();

    // GPS Controller tasks
    connect($scope); // connect - opens a socket and listens for messages

    /*****************************************************
    * AHRS and GPS Helper
    */
    function loadSituationInAutopilot(situation) { // mySituation

        $scope.gps_time = Date.parse(situation.GPSLastGPSTimeStratuxTime);
        $scope.ahrs_time = Date.parse(situation.AHRSLastAttitudeTime);
        if ($scope.gps_time - $scope.ahrs_time < 1000) {
            // pitch, roll and heading are in degrees
            $scope.ahrs_heading = Math.round(situation.AHRSGyroHeading.toFixed(0));
            if ($scope.ahrs_heading > 360) {
                $scope.ahrs_heading = "---";
            } else if ($scope.ahrs_heading < 0.5) {
                $scope.ahrs_heading = 360;
            }
            $scope.ahrs_pitch = situation.AHRSPitch.toFixed(1);
            if ($scope.ahrs_pitch > 360) {
                $scope.ahrs_pitch = "--";
            }
            $scope.ahrs_roll = situation.AHRSRoll.toFixed(1);
            if ($scope.ahrs_roll > 360) {
                $scope.ahrs_roll = "--";
            }
            $scope.ahrs_slip_skid = situation.AHRSSlipSkid.toFixed(1);
            if ($scope.ahrs_slip_skid > 360) {
                $scope.ahrs_slip_skid = "--";
            }
            ahrs.update(situation.AHRSPitch, situation.AHRSRoll, situation.AHRSGyroHeading, situation.AHRSSlipSkid, situation.GPSGroundSpeed, situation.GPSAltitudeMSL);

            $scope.ahrs_heading_mag = situation.AHRSMagHeading.toFixed(0);
            if ($scope.ahrs_heading_mag > 360) {
                $scope.ahrs_heading_mag = "---";
            }
            $scope.ahrs_gload = situation.AHRSGLoad.toFixed(2);
            if ($scope.ahrs_gload > 360) {
                $scope.ahrs_gload = "--";
            } else {
                /***
                 * 
                 */
                var step = (situation.AHRSGLoadMax - situation.AHRSGLoadMin) / 6;
                for (var gm = 0; gm < $scope.gmeterIcons.length; gm++) {
                    $scope.gmeterIcons[gm].value = (situation.AHRSGLoadMin + step * gm).toFixed(1);
                    $scope.gmeterIcons[gm].text = $scope.gmeterIcons[gm].value;
                    if (situation.AHRSGLoad < $scope.gmeterIcons[gm].value) {
                        $scope.gmeterIcons[gm].class = "label-default";
                    }
                    else {
                        $scope.gmeterIcons[gm].class = "label-success";
                    }
                }
                // GMeter Buzzer Play
                //window.gMeterBuzzerPlayer.beepWithGLoadFactor(situation.AHRSGLoad);

            }

            if (situation.AHRSTurnRate > 360) {
                $scope.ahrs_turn_rate = "--";
            } else if (situation.AHRSTurnRate > 0.6031) {
                $scope.ahrs_turn_rate = (6 / situation.AHRSTurnRate).toFixed(1); // minutes/turn
            } else {
                $scope.ahrs_turn_rate = '\u221e';
            }


            var altitudeVsMillibar = 8 / 0.3048;
            var a = (situation.BaroPressureAltitude / altitudeVsMillibar).toFixed(0);
            var b = (situation.GPSAltitudeMSL / altitudeVsMillibar).toFixed(0);
            var c = (b-a);
            $scope.QNH = 1013 + c;

        } else {
            $scope.ahrs_heading = "---";
            $scope.ahrs_pitch = "---";
            $scope.ahrs_roll = "--";
            $scope.ahrs_slip_skid = "--";
            $scope.ahrs_heading_mag = "---";
            $scope.ahrs_gload = "--";
            $scope.ahrs_turn_rate = "--";
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
    }

    function resetSituation() { // mySituation
        $scope.raw_data = "error getting gps / ahrs status";
        $scope.ahrs_heading = "---";
        $scope.ahrs_pitch = "--";
        $scope.ahrs_roll = "--";
        $scope.ahrs_slip_skid = "--";
        $scope.ahrs_heading_mag = "---";
        $scope.ahrs_turn_rate = "--";
        $scope.ahrs_gload = "--";
    }


    // Restore Bring Me Home Waypoint
    $http.get(URL_SETTINGS_GET).then(function (response) {
        var status = angular.fromJson(response.data);
        if (status.hasOwnProperty("Autopilot_HomeWaypoint")) {
            $scope.Autopilot_HomeWaypoint=status["Autopilot_HomeWaypoint"];
        }
        // GMeter Buzzer Setup
        if (status.GLimits === "" || status.GLimits === undefined) {
            status.GLimits = "-1.76 4.4";
        }
        var glims = status.GLimits.split(" ");
        $scope.gLimNegative = parseFloat(glims[0]);
        $scope.gLimPositive = parseFloat(glims[1]);
        //window.gMeterBuzzerPlayer.setGLimits($scope.gLimNegative,$scope.gLimPositive);
    });


    $scope.autopilotLoadCurrentStatus = function () {
    // Restore Flight Plan
    $http.get(URL_AUTOPILOT_GET).then(function (response) {
        var status = angular.fromJson(response.data);
        if (status.length > 0) {
            $scope.gpxImportData({
                "routes": [{
                    "points": status,
                    "index": 0,
                    "Cmt": "Restored",
                    "name": "Restored",
                    "desc": "Restored",
                    "time": 0,
                    "dist": 0
                }]
            });
        }
        else {
            let autopilotLastPlan=window.localStorage.getItem("autopilotLastPlan")
            $scope.gpxImport(autopilotLastPlan);
        }
    });
    }
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
                    $scope.airfields[x].style =  x%2==0?"background-color:lightgray;":""
                }
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
    $scope.autopilotLoadCurrentStatus();
    },500);

    
    function waypointChanged(event) {
        if (($scope === undefined) || ($scope === null)) {
            removeEventListener("WaypointChanged", waypointChanged);
            return; // we are getting called once after clicking away from the status page
        }
        console.log(event);
        $scope.autopilotLoadCurrentStatus();
    }
}

