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
 * 07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
 * 08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder
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
        - Wind estimate from the wind triangle (WindSpeed, WindDirection, WindValid, WindSource)
*/


SituationService.prototype = {
    constructor: SituationService,
};



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
            bridgeQNHReset();
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
            // RB-Addons: a knob turn is a real, pilot-set QNH; publish it without
            // waiting for the next situation frame. The AUTO button carries no QNH
            // key, so its recomputed value is published by onmessageTick instead.
            if (event.detail.hasOwnProperty("QNH")) {
                bridgeQNHValid = true;
                bridgeQNHAuto = 0;
                bridgeQNHPublish($scope.situationByPilot.QNH);
            }
            // Trigger the update
            $scope.sendSituationTimer = 0;
        }

        addEventListener("SituationUpdatedByPilot", situationUpdatedByPilot);

        $scope.sendSituationTimer = 0;
        $scope.sendSituationBusy = false;
        $scope.situationSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            var situation = angular.fromJson(msg.data);

            var now = Date.now();
            if ($scope.sendSituationBusy == false && (now - $scope.sendSituationTimer >= 100 || now - $scope.sendSituationTimer < 0)) {
                $scope.sendSituationBusy = true;
                $scope.sendSituationTimer = now;
                requestAnimationFrame(() => {
                    $scope.sendSituationBusy = false;
                    $scope.situationSocket.onmessageTick(situation);    
                });
            }
        };

        $scope.lastUpdateTime = 0;
        $scope.situationSocket.onmessageTick = function (situation) {

            // Filter to avoid blow up CPU
            const oldSituation = window.situation;
            const newSituation = situation;
            const ahrsThreshold = 1;
            const altitudeThreshold = 50 / 3.2808;
            const requireRefresh = globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold);
            var now = Date.now();
            if (requireRefresh == true || now - $scope.lastUpdateTime >= 1000) {
                $scope.lastUpdateTime = now;
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
                    var altitudeVsMillibar = 27 + situation.GPSAltitudeMSL / 1500;
                    var a = (situation.BaroPressureAltitude / altitudeVsMillibar).toFixed(0);
                    var b = (situation.GPSAltitudeMSL / altitudeVsMillibar).toFixed(0);
                    var c = (b - a);
                    situation.QNH = 1013.25 + c;
                    $scope.situationByPilot.QNH = situation.QNH;
                    bridgeQNHValid = true;
                    bridgeQNHAuto = 1;
                }
                else {
                    situation.QNH = $scope.situationByPilot.QNH;
                }
                // Wind calculation
                situationWind(situation);
                // Speed source for the plates
                situationSpeed(situation);
                situation.AutoQNH = $scope.situationByPilot.AutoQNH;
                // RB-Addons: share the QNH in use with 3rd party addons
                bridgeQNHPublish(situation.QNH);


                window.situation = situation;
                const proxy = new CustomEvent("SituationUpdated", { detail: situation });
                dispatchEvent(proxy);

            }
            // GMeter Buzzer Play
            // TODO: flight test and configuration switch
            // Temporary  moved inside the G-Meter
            if(localDisplayGetFlag("Display_Audio_GLoad_Enabled") == "true") {
                window.gMeterBuzzerPlayer.beepWithGLoadFactor(situation.AHRSGLoad);
            }
        };
    }

    // RB-Addons: publish the QNH in use on the addons bridge, so 3rd party addons
    // and external probes can read it from GET /bridge/float or /bridge/float/ws.
    // autoqnh is the provenance of the value: 1 = derived by the auto branch,
    // 0 = dialled by the pilot. It is not situationByPilot.AutoQNH, which only
    // says the pilot has not overridden.
    // One hPa of auto QNH is only ~27ft of GPS altitude, which is inside normal
    // GPS vertical noise, so the value dithers between two steps whenever it sits
    // on a rounding boundary. Every accepted POST makes the daemon re-broadcast
    // the whole bridge map to every websocket client, so a plain change detector
    // is not enough on its own.
    var BRIDGE_QNH_MIN_INTERVAL = 2000;
    var bridgeQNHValid = false;
    var bridgeQNHAuto = 0;
    var bridgeQNHSent = null;
    var bridgeQNHSentAuto = null;
    var bridgeQNHPending = null;
    var bridgeQNHPendingAuto = 0;
    var bridgeQNHLastPost = 0;
    var bridgeQNHTimer = null;

    function bridgeQNHReset() {
        // The daemon keeps the bridge map in RAM only, so a restart wipes it and
        // drops this socket: forget what we sent and republish once the altimeter
        // has a real QNH again.
        bridgeQNHValid = false;
        bridgeQNHSent = null;
        bridgeQNHSentAuto = null;
        bridgeQNHPending = null;
        if (bridgeQNHTimer !== null) {
            clearTimeout(bridgeQNHTimer);
            bridgeQNHTimer = null;
        }
    }

    function bridgeQNHPublish(qnh) {
        // Never the 1013.25 initialiser, and never a NaN: JSON.stringify writes
        // NaN as null and the daemon would decode it as a QNH of 0
        if (bridgeQNHValid == false || typeof qnh !== "number" || isFinite(qnh) == false)
            return;
        if (qnh === bridgeQNHSent && bridgeQNHAuto === bridgeQNHSentAuto) {
            bridgeQNHPending = null; // dithered back to what the daemon already has
            return;
        }
        bridgeQNHPending = qnh;
        bridgeQNHPendingAuto = bridgeQNHAuto;
        bridgeQNHFlush();
    }

    function bridgeQNHFlush() {
        if (bridgeQNHPending === null)
            return;
        var now = Date.now();
        var elapsed = now - bridgeQNHLastPost;
        if (elapsed >= 0 && elapsed < BRIDGE_QNH_MIN_INTERVAL) {
            if (bridgeQNHTimer === null) {
                bridgeQNHTimer = setTimeout(function () {
                    bridgeQNHTimer = null;
                    bridgeQNHFlush();
                }, BRIDGE_QNH_MIN_INTERVAL - elapsed);
            }
            return; // the trailing flush sends the settled value
        }
        var qnh = bridgeQNHPending;
        var auto = bridgeQNHPendingAuto;
        bridgeQNHPending = null;
        bridgeQNHSent = qnh;
        bridgeQNHSentAuto = auto;
        bridgeQNHLastPost = now;
        var msg = JSON.stringify({ "qnh": qnh, "autoqnh": auto });
        $http.post(URL_BRIDGE_FLOAT_SET, msg).
            then(function (response) {
            }, function (response) {
                // Let the next update retry, unless something newer went out already
                if (bridgeQNHSent === qnh && bridgeQNHSentAuto === auto)
                    bridgeQNHSent = null;
            });
    }

    // Wind estimate from the wind triangle: the ground vector (GPS ground speed
    // along the true course) minus the air vector (airspeed along the heading).
    // AHRSMagHeading is compared straight against GPSTrueCourse: the compass
    // offset (magnetometer addon, OFFSET FROM GPS TRACK) absorbs the declination,
    // so the 45 degrees gate is the sanity check against an uncalibrated compass,
    // a stationary aircraft with a random track, or a skidding turn.
    // IndicatedAirSpeed comes from an external board in knots, like GPSGroundSpeed:
    //   A) IAS > 0: IAS becomes TAS with the ISA density ratio at the pressure
    //      altitude, then the full triangle (WindSource "ias");
    //   B) IAS = 0 or missing: no airspeed source, the ground speed stands in
    //      for the airspeed (WindSource "gs").
    // WindDirection is where the wind blows FROM, like a METAR. The four fields
    // are written on every frame so a consumer never reads a stale estimate.
    function situationWind(situation) {
        situation.WindValid = false;
        situation.WindSpeed = 0;
        situation.WindDirection = 0;
        situation.WindSource = "";
        if (!(situation.GPSFixQuality > 0))
            return;
        var hdg = situation.AHRSMagHeading;
        var trk = situation.GPSTrueCourse;
        var gs = situation.GPSGroundSpeed;
        var ias = situation.IndicatedAirSpeed ?? 0;
        if (!isFinite(hdg) || !isFinite(trk) || !isFinite(gs) || !isFinite(ias) || ias < 0)
            return;
        var drift = ((trk - hdg + 540) % 360) - 180; // -180..180, wrap safe
        if (Math.abs(drift) >= 45)
            return;
        var tas;
        if (ias > 0) {
            var pa = situation.BaroPressureAltitude ?? situation.GPSAltitudeMSL ?? 0; // ft
            if (!isFinite(pa))
                pa = 0;
            var sigma = Math.pow(Math.max(1 - 6.8756e-6 * pa, 0.01), 4.2559);
            tas = ias / Math.sqrt(sigma);
            situation.WindSource = "ias";
        }
        else {
            tas = gs;
            situation.WindSource = "gs";
        }
        // North/east frame, bearings clockwise from north
        var wx = gs * Math.sin(toRadians(trk)) - tas * Math.sin(toRadians(hdg));
        var wy = gs * Math.cos(toRadians(trk)) - tas * Math.cos(toRadians(hdg));
        situation.WindSpeed = Math.sqrt(wx * wx + wy * wy);
        situation.WindDirection = (toDegrees(Math.atan2(-wx, -wy)) + 360) % 360;
        situation.WindValid = true;
    }

    // The speed a pilot reads, resolved once for every plate: the external
    // airspeed board when it reports one, the GPS ground speed otherwise, both
    // in knots. SpeedSource names which ("IAS" or "GS") so a plate can
    // annunciate it: ground speed read as airspeed is FHA-SPD-2. Same IAS test
    // as situationWind, so the two never disagree on the source.
    function situationSpeed(situation) {
        var gs = situation.GPSGroundSpeed;
        var ias = situation.IndicatedAirSpeed ?? 0;
        if (isFinite(ias) && ias > 0) {
            situation.SpeedKt = ias;
            situation.SpeedSource = "IAS";
        }
        else {
            situation.SpeedKt = isFinite(gs) ? gs : 0;
            situation.SpeedSource = "GS";
        }
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
            situation.GPSAltitudeMSL = Math.sin(radians) * 1000.0 + 2000;
            situation.AHRSGLoad = Math.sin(radians) * 4.0 + 1.0;
            situation.AHRSRoll = Math.sin(radians) * 90.0;
            situation.AHRSGyroHeading = Math.sin(radians) * 360.0;
            situation.GPSGroundSpeed = 180+Math.sin(radians) * 180.0;
            situation.AHRSTurnRate = Math.sin(radians) * 45.0
            situation.AHRSSlipSkid = Math.sin(radians) * 15.0
            
    
            simulatorSeed++;

            $scope.situationSocket.onmessage({data:situation})
    
        }, 100);
    }
}