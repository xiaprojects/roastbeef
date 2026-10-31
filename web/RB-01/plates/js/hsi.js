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

// Standalone version from cockpit_widget.js
// TODO: convert to the new Sixpack div format
/**
 * HSI
 * @param {*} div 
 * @param {*} item 
 */
function HSICircleRenderer(div, item,foregroundColor="#000000") {
    var hsiSettings = {
        "middleCircleSize": 5,
        "middleCircleDistance": 25,
        "horizontalLine": { "w": 10, "h": 100, "color": "orange" },
        "h": 140
    };

    var image = SVG(div).viewbox(-hsiSettings.h, -hsiSettings.h, 2 * hsiSettings.h, 2 * hsiSettings.h);


    /*****************/
    var slopeTextLeft = image.text("GS").style('font-size', '10px');
    slopeTextLeft.cx(-hsiSettings.h + 8);
    slopeTextLeft.cy(-hsiSettings.middleCircleDistance * 4 - 10);
    var slopeLeft = image.polygon('0,0 -5,5 -5,10 5,10 5,5 0,0 -5,-5 -5,-10 5,-10 5,-5');
    slopeLeft.style("fill", hsiSettings.horizontalLine.color);
    slopeLeft.cx(-hsiSettings.h + 8);
    slopeLeft.cy(0);
    /*****************/
    var slopeTextRight = image.text("GS").style('font-size', '10px');
    slopeTextRight.cx(+hsiSettings.h - 8);
    slopeTextRight.cy(-hsiSettings.middleCircleDistance * 4 - 10);
    var slopeRight = image.polygon('0,0 -5,5 -5,10 5,10 5,5 0,0 -5,-5 -5,-10 5,-10 5,-5');
    slopeRight.style("fill", hsiSettings.horizontalLine.color);
    slopeRight.cx(hsiSettings.h - 8);
    slopeRight.cy(0);

    for (var hsiIndex = -4; hsiIndex < 5; hsiIndex++) {
        var cl = image.circle(hsiSettings.middleCircleSize);
        cl.cx(-hsiSettings.h + 8).cy(hsiSettings.middleCircleDistance * hsiIndex);
        var cr = image.circle(hsiSettings.middleCircleSize);
        cr.cx(hsiSettings.h - 8).cy(hsiSettings.middleCircleDistance * hsiIndex);

        if (hsiIndex == 0) {
            cl.style('fill', "red");
            cr.style('fill', "red");
        }
        else
        {
            cl.style("fill", foregroundColor);
            cr.style("fill", foregroundColor);
        }
    }
    /*****************/
    var containerOuter = image.group();
    containerOuter.text("N").style('font-size', '32px').style("fill", "#ff0000").style("stroke", "#ff0000")
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.2);
    containerOuter.text("E").style('font-size', '32px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.2)
        .transform({ rotation: 90, cx: 0, cy: 0, relative: false });
    containerOuter.text("S").style('font-size', '32px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.2)
        .transform({ rotation: 180, cx: 0, cy: 0, relative: false });
    containerOuter.text("W").style('font-size', '32px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.2)
        .transform({ rotation: 270, cx: 0, cy: 0, relative: false });

    containerOuter.text("3").style('font-size', '24px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 30, cx: 0, cy: 0, relative: false });
    containerOuter.text("6").style('font-size', '24px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 60, cx: 0, cy: 0, relative: false });
    containerOuter.text("12").style('font-size', '24px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 120, cx: 0, cy: 0, relative: false });
    containerOuter.text("15").style('font-size', '24px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 150, cx: 0, cy: 0, relative: false });
    containerOuter.text("21").style('font-size', '24px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 210, cx: 0, cy: 0, relative: false });
    containerOuter.text("24").style('font-size', '24px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 240, cx: 0, cy: 0, relative: false });
    containerOuter.text("30").style('font-size', '24px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 300, cx: 0, cy: 0, relative: false });
    containerOuter.text("33").style('font-size', '24px').style("fill", foregroundColor)
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 330, cx: 0, cy: 0, relative: false });


    for (var degree = 0; degree < 360; degree += 5) {
        if (degree % 90 == 0) continue;
        var h = 10;
        if (degree % 15 == 0) h = 20;
        var miniline = containerOuter.rect(h / 5, h);
        miniline.cx(0).cy(-hsiSettings.horizontalLine.h * 1.05);
        miniline.transform({ rotation: degree, cx: 0, cy: 0, relative: false });
        miniline.style("fill", "gray");
    }

    /*****************/
    var containerCenter = image.group();
    var containerCenterCircle = containerCenter.circle(hsiSettings.horizontalLine.h * 2.0);
    containerCenterCircle.cx(0).cy(0);
    containerCenterCircle.style('fill', "transparent");
    containerCenterCircle.style('stroke', foregroundColor);
    containerCenterCircle.style('stroke-width', hsiSettings.horizontalLine.h * 0.01);

    var verticalLineDirection = containerCenter.rect(hsiSettings.horizontalLine.w, hsiSettings.horizontalLine.h);
    verticalLineDirection.cx(0).cy(0);
    verticalLineDirection.style("fill", hsiSettings.horizontalLine.color);

    for (var hsiIndex = -3; hsiIndex < 4; hsiIndex++) {
        var c = containerCenter.circle(hsiSettings.middleCircleSize);
        c.style("fill", foregroundColor);
        c.cx(hsiSettings.middleCircleDistance * hsiIndex).cy(0);
    }
    /*****************/
    var arrow = containerCenter.polygon('0,0 10,20 5,20 5,40 -5,40 -5,20 -10,20').style("fill", foregroundColor);
    arrow.cy(-hsiSettings.horizontalLine.h * 0.8);
    containerCenter.rect(10, 40).cx(0).cy(hsiSettings.horizontalLine.h * 0.8).style("fill", foregroundColor);

    /*****************/
    var radial = containerCenter.polygon('0,0 -10,-15 -5,-15 -1,-5 1,-5 5,-15 10,-15 ').style("fill", foregroundColor);
    radial.cy(-hsiSettings.horizontalLine.h * 1.08);
    radial.style("fill", hsiSettings.horizontalLine.color);

    /*****************/
    var centerLine = image.rect(5, 50);
    centerLine.cx(0);
    centerLine.cy(-hsiSettings.horizontalLine.h * 1.2);
    centerLine.style("fill", hsiSettings.horizontalLine.color);

    image.rect(2, 30).style("fill", foregroundColor).cx(0).cy(5);
    image.rect(10, 2).style("fill", foregroundColor).cx(0).cy(15);
    image.rect(30, 2).style("fill", foregroundColor).cx(0).cy(0);

    /*****************/
    this.containerOuter = containerOuter;
    this.containerCenter = containerCenter;
    this.slopeLeft = slopeLeft;
    this.slopeRight = slopeRight;
    this.radial = radial;
    this.verticalLineDirection = verticalLineDirection;
    this.canvas = document.getElementById(this.locationId);
    this.width = -1;
    this.height = -1;
}


HSICircleRenderer.prototype = {
    constructor: HSICircleRenderer,
    resize: function () {
        var canvasWidth = this.canvas.parentElement.offsetWidth;

        if (canvasWidth !== this.width) {
            this.width = canvasWidth;
            this.height = canvasWidth * 0.5;

            this.canvas.width = this.width;
            this.canvas.height = this.height;
        }
    },
    update: function (outer, item, center, vertical, radial, glideSlope) {
        this.containerOuter.transform({ rotation: -outer, cx: 0, cy: 0, relative: false });
        this.radial.transform({ rotation: radial, cx: 0, cy: 0, relative: false });
        this.containerCenter.transform({ rotation: -center, cx: 0, cy: 0, relative: false });
        if (vertical > 6) vertical = 6;
        if (vertical < -6) vertical = -6;
        this.verticalLineDirection.cx(-vertical * 25 / 2);
        if (glideSlope > 15) glideSlope = 15;
        if (glideSlope < -15) glideSlope = -15;
        this.slopeLeft.cy(-glideSlope * 25 / 3);
        this.slopeRight.cy(-glideSlope * 25 / 3);
    }
};
// End of copy

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

        // The renderer is built asynchronously after the plate renders; a knob
        // press in that window has nothing to draw on yet.
        if ($scope.hsi == null) return;
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

