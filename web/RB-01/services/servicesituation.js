/**
 * This file is part of RB.
 *
 * Copyright (C) 2024 XIAPROJECTS SRL
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
    servicesituation.js: spread situation across screens without websocket subscription everytime
    Features:
        - Websocket connects and receive
        - Max, Min
        - Threshold to avoid cpu consumption
*/


SituationService.prototype = {
    constructor: SituationService,
};


let SERVICE_SITUATION_MAX_COUNT = 10

/**
 * SituationService Service Class
 * Loaded by main.js
 * This Service will connect the WebSocket and wait for events to arrive, spreads if threshold
 */
function SituationService($scope, $http) {
    function connect($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.situationSocket === undefined) || ($scope.situationSocket === null)) {
            situationSocket = new WebSocket(URL_GPS_WS);
            $scope.situationSocket = situationSocket; // store socket in scope for enter/exit usage
        }


        $scope.situationSocket.onopen = function (msg) {
        };

        $scope.situationSocket.onclose = function (msg) {

            delete $scope.situationSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.situationSocket.onerror = function (msg) {
        };

        $scope.situationByPilot = {
            QNH: 1013.25,
            AutoQNH: true
        };

        function situationUpdatedByPilot(event) {
            Object.keys(event.detail).forEach(element => {
                $scope.situationByPilot[element] = event.detail[element];
            });
            // Trigger the update
            $scope.sendSituationTimer = SERVICE_SITUATION_MAX_COUNT;
        }

        addEventListener("SituationUpdatedByPilot", situationUpdatedByPilot);

        $scope.sendSituationTimer = 0;
        $scope.situationSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            var situation = angular.fromJson(msg.data);
            $scope.sendSituationTimer++;
            // Filter to avoid blow up CPU
            const oldSituation = window.situation;
            const newSituation = situation;
            const ahrsThreshold = 1;
            const altitudeThreshold = 50 / 3.2808;
            const requireRefresh = SERVICE_SITUATION_MAX_COUNT < $scope.sendSituationTimer || globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold);
            if (requireRefresh == true) {
                $scope.sendSituationTimer = 0;

                // RB-Addons
                if (
                    situation.hasOwnProperty("BaroPressureAltitude")
                    &&
                    situation.GPSFixQuality > 0
                    &&
                    $scope.situationByPilot.AutoQNH == true
                    &&
                    situation.hasOwnProperty("BaroVerticalSpeed") && Math.abs(situation.BaroVerticalSpeed) < 200
                ) {
                    var altitudeVsMillibar = 8 / 0.3048;
                    var a = (situation.BaroPressureAltitude / altitudeVsMillibar).toFixed(0);
                    var b = (situation.GPSAltitudeMSL / altitudeVsMillibar).toFixed(0);
                    var c = (b - a);
                    situation.QNH = 1013.25 + c;
                    $scope.situationByPilot.QNH = situation.QNH;
                }
                else {
                    situation.QNH = $scope.situationByPilot.QNH;
                }
                situation.AutoQNH = $scope.situationByPilot.AutoQNH;


                window.situation = situation;
                const proxy = new CustomEvent("SituationUpdated", { detail: situation });
                dispatchEvent(proxy);

            }
            // GMeter Buzzer Play
            // TODO: flight test and configuration switch
            // Temporary  moved inside the G-Meter
            if(false) {
                window.gMeterBuzzerPlayer.beepWithGLoadFactor(situation.AHRSGLoad);
            }
        };
    }

    // Last Situation, shared out-of-angular to avoid angular triggers
    // Moved in global.js window.situation = {};
    connect($scope);
    if(false){
        var simulatorSeed = 0;
        // Demo purposes
        window.setInterval(() => {
            var situation = {
                "GPSLastFixSinceMidnightUTC": 32304.2,
                "GPSLatitude": 43.0,
                "GPSLongitude": 12.0,
                "GPSFixQuality": 1,
                "GPSHeightAboveEllipsoid": 1057.4148,
                "GPSGeoidSep": 145.34122,
                "GPSSatellites": 8,
                "GPSSatellitesTracked": 12,
                "GPSSatellitesSeen": 10,
                "GPSHorizontalAccuracy": 5.4,
                "GPSNACp": 10,
                "GPSAltitudeMSL": 912.07355,
                "GPSVerticalAccuracy": 10.700001,
                "GPSVerticalSpeed": 0,
                "GPSLastFixLocalTime": "0001-01-01T00:49:25.51Z",
                "GPSTrueCourse": 48.3,
                "GPSTurnRate": 0,
                "GPSGroundSpeed": 0,
                "GPSLastGroundTrackTime": "0001-01-01T00:49:25.51Z",
                "GPSTime": "2023-12-31T08:58:24.3Z",
                "GPSLastGPSTimeStratuxTime": "0001-01-01T00:49:25.51Z",
                "GPSLastValidNMEAMessageTime": "0001-01-01T00:49:25.51Z",
                "GPSLastValidNMEAMessage": "$GPGGA,085824.20,4311.12143,N,01208.18939,E,1,08,1.08,278.0,M,44.3,M,,*51",
                "GPSPositionSampleRate": 9.99973784244331,
                "BaroTemperature": 29.04,
                "BaroPressureAltitude": 776.60333,
                "BaroVerticalSpeed": -1.2355082,
                "BaroLastMeasurementTime": "0001-01-01T00:49:25.52Z",
                "BaroSourceType": 1,
                "AHRSPitch": 0,
                "AHRSRoll": 0,
                "AHRSGyroHeading": 3276.7,
                "AHRSMagHeading": 332.9175199350767,
                "AHRSSlipSkid": 78.88479760867865,
                "AHRSTurnRate": 3276.7,
                "AHRSGLoad": 0.10920454632244811,
                "AHRSGLoadMin": 0.10626655052683534,
                "AHRSGLoadMax": 0.1099768285851461,
                "AHRSLastAttitudeTime": "0001-01-01T00:49:25.51Z",
                "AHRSStatus": 7,
                "QNH": 1013
            };
    
    
             if (situation.hasOwnProperty("BaroPressureAltitude")) {
                var altitudeVsMillibar = 8 / 0.3048;
                var a = (situation.BaroPressureAltitude / altitudeVsMillibar).toFixed(0);
                var b = (situation.GPSAltitudeMSL / altitudeVsMillibar).toFixed(0);
                var c = (b - a);
                situation.QNH = 1013 + c;
            }
            else {
                situation.QNH = 1013;
            }
    
    
            const radians = simulatorSeed * Math.PI / 180;
    
            situation.BaroVerticalSpeed = Math.sin(radians) * 2000.0;
            //situation.GPSAltitudeMSL = 5000 + Math.sin(radians) * 5000.0;
            situation.GPSAltitudeMSL = 2000;
            situation.AHRSRoll = Math.sin(radians) * 90.0;
            situation.AHRSGyroHeading = Math.sin(radians) * 360.0;
            situation.GPSGroundSpeed = 180+Math.sin(radians) * 180.0;
            situation.AHRSTurnRate = Math.sin(radians) * 45.0
    
            simulatorSeed++;
    
    
            const proxy = new CustomEvent("SituationUpdated", { detail: situation });
            dispatchEvent(proxy);
        }, 100);
    }
}