/*
    Copyright (c) 2023 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    cockpit.js: Cockpit interface
    Features:
    - Zoom
    - Keypad navigation
    - Different Widgets are supported
    - Ranges with Colors
    - Dark and White Colors

    Roadmap:
    - Integrate Radar, GPS, MAP, HSI, Attitude
    - Enable User to configure and sort
    - Store using configuration file
    - Customise colors and ranges
    - Store the setup by Airplane name
    - Add alarms and popup
    - Translations
    - Improve UI
    - Add Themes: round, square, more digital
*/
angular.module('appControllers').controller('CockpitCtrl', CockpitCtrl); // get the main module controllers set
CockpitCtrl.$inject = ['$rootScope', '$scope', '$state', '$http']; // Inject my dependencies


// TODO: Move into a service to store the user changes
var URL_COCKPIT_SETUP = URL_HOST_PROTOCOL + URL_HOST_BASE + "/cockpit/setup.json";

// create our controller function with all necessary logic
function CockpitCtrl($rootScope, $scope, $state, $http) {
    $scope.$parent.helppage = 'plates/cockpit-help.html';
    $scope.noSleep = new NoSleep();
    $scope.mapping = {};
    $scope.widgetsSettings = [];

    $state.get('cockpit').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('cockpit').onExit = function () {
        removeEventListener("keypad", keypadEventListener);

        $scope.noSleep.disable();
        delete $scope.noSleep;
        if (($scope.socketEMS !== undefined) && ($scope.socketEMS !== null)) {
            $scope.socketEMS.close();
            $scope.socketEMS = null;
        }
        if (($scope.socketTraffic !== undefined) && ($scope.socketTraffic !== null)) {
            $scope.socketTraffic.close();
            $scope.socketTraffic = null;
        }
        if (($scope.socket !== undefined) && ($scope.socket !== null)) {
            $scope.socket.close();
            $scope.socket = null;
        }
    };

    $scope.zoom = function (index) {
        let widgetClasses = ["col-xs-4", "col-xs-6", "col-xs-12", "col-xs-3", "col-xs-4"];
        $scope.widgetsSettings[index].class = widgetClasses[1 + widgetClasses.indexOf($scope.widgetsSettings[index].class)];
    }

    $scope.reloadDiv = function (index) {
        let currentItem = $scope.widgetsSettings[index];
        currentItem.divName = "CockpitWidget" + index;
        if (document.getElementById(currentItem.divName) != null) {
            switch (currentItem.uiModel) {
                case "":
                    //var canvas = document.getElementById(currentItem.divName);
                    SVG(currentItem.divName).viewbox(-200, -200, 400, 400).group().addClass('CockpitWhite');
                    break;
                case "GMeter":
                    //currentItem["render"] = new GMeterRenderer(currentItem.divName, -2, +4, null);
                    break;
                case "Radar":
                    currentItem["render"] = new RadarRenderer(currentItem.divName,$scope,$http, currentItem);
                    radar = currentItem["render"];
                    break;
                case "HSI":
                    currentItem["render"] = new HSICircleRenderer(currentItem.divName, currentItem);
                    break;
                case "Direction":
                    currentItem["render"] = new DirectionCircleRenderer(currentItem.divName, currentItem);
                    break;
                case "TRK":
                    currentItem["render"] = new HeadingCircleRenderer(currentItem.divName, currentItem);
                    break;
                case "Settings":
                    currentItem["render"] = new SettingsRenderer(currentItem.divName, currentItem);
                    break;
                case "ALT\n\nfeet":
                    currentItem["render"] = new AltimeterCircleRenderer(currentItem.divName, currentItem);
                    break;    
                case "EGT":
                    currentItem["render"] = new Bar4Renderer(currentItem.divName, currentItem);
                break;
                case "CHT":
                    currentItem["render"] = new Bar4Renderer(currentItem.divName, currentItem);
                break;
                case "AHRSExtendedRenderer":
                    currentItem["render"] = new AHRSRenderer(currentItem.divName);
                    currentItem["render"].turn_on();
                    var defs= currentItem["render"].ai.defs();
                    var circleClip=defs.circle(380).cx(0).cy(0);
                    currentItem["render"].ai.clipWith(circleClip)

                    currentItem["render"].updateAHRS = currentItem["render"].update
                    currentItem["render"].update = function(value, item, situation) {
                        currentItem["render"].updateAHRS(situation.AHRSPitch, situation.AHRSRoll, situation.AHRSGyroHeading, situation.AHRSSlipSkid, situation.GPSGroundSpeed, situation.GPSAltitudeMSL);
                    }
                break;

                case "SixPackAttitude":
                    SVG(currentItem.divName).viewbox(-200, -200, 400, 400).group().addClass('CockpitWhite');
                    currentItem["render"] = new SixPackAttitude(currentItem.divName, currentItem);
                break;
                case "SixPackAltimeter":
                    SVG(currentItem.divName).viewbox(-200, -200, 400, 400).group().addClass('CockpitWhite');
                    currentItem["render"] = new SixPackAltimeter(currentItem.divName, currentItem);
                break;
                case "SixPackTurnIndicator":
                    SVG(currentItem.divName).viewbox(-200, -200, 400, 400).group().addClass('CockpitWhite');
                    currentItem["render"] = new SixPackTurnIndicator(currentItem.divName, currentItem);
                break;
                case "SixPackVariometer":
                    SVG(currentItem.divName).viewbox(-200, -200, 400, 400).group().addClass('CockpitWhite');
                    currentItem["render"] = new SixPackVariometer(currentItem.divName, currentItem);
                break;
                case "SixPackHeading":
                    SVG(currentItem.divName).viewbox(-200, -200, 400, 400).group().addClass('CockpitWhite');
                    currentItem["render"] = new SixPackHeading(currentItem.divName, currentItem);
                break;
                  default:
                    currentItem["render"] = new EMSGenericCircleRenderer(currentItem.divName, currentItem);
                    break;
            }
        }
    }


    $scope.reloadAllDiv = function () {
        for (index = 0; index < $scope.widgetsSettings.length; index++) {
            $scope.mapping[$scope.widgetsSettings[index]["sensorType"]] = index;
            $scope.reloadDiv(index);
        }
    }

    /**
     * Restore Widgets from RPI
     */
    $scope.InitFunc = function () {
        $http.get(URL_COCKPIT_SETUP).then(function (response) {
            var setup = angular.fromJson(response.data);
            if (setup.length > 0) {
                $scope.widgetsSettings = setup;
            }
            // Delay loading to wait for DIV Rendering
            window.setTimeout($scope.reloadAllDiv, 100);
        });
    }

    $scope.situation = { "GPSLastFixSinceMidnightUTC": 32304.2, "GPSLatitude": 43.0, "GPSLongitude": 12.0, "GPSFixQuality": 1, "GPSHeightAboveEllipsoid": 1057.4148, "GPSGeoidSep": 145.34122, "GPSSatellites": 8, "GPSSatellitesTracked": 12, "GPSSatellitesSeen": 10, "GPSHorizontalAccuracy": 5.4, "GPSNACp": 10, "GPSAltitudeMSL": 912.07355, "GPSVerticalAccuracy": 10.700001, "GPSVerticalSpeed": 0, "GPSLastFixLocalTime": "0001-01-01T00:49:25.51Z", "GPSTrueCourse": 48.3, "GPSTurnRate": 0, "GPSGroundSpeed": 0, "GPSLastGroundTrackTime": "0001-01-01T00:49:25.51Z", "GPSTime": "2023-12-31T08:58:24.3Z", "GPSLastGPSTimeStratuxTime": "0001-01-01T00:49:25.51Z", "GPSLastValidNMEAMessageTime": "0001-01-01T00:49:25.51Z", "GPSLastValidNMEAMessage": "$GPGGA,085824.20,4311.12143,N,01208.18939,E,1,08,1.08,278.0,M,44.3,M,,*51", "GPSPositionSampleRate": 9.99973784244331, "BaroTemperature": 29.04, "BaroPressureAltitude": 776.60333, "BaroVerticalSpeed": -1.2355082, "BaroLastMeasurementTime": "0001-01-01T00:49:25.52Z", "BaroSourceType": 1, "AHRSPitch": -56.752181757536206, "AHRSRoll": -77.98562991928083, "AHRSGyroHeading": 3276.7, "AHRSMagHeading": 332.9175199350767, "AHRSSlipSkid": 78.88479760867865, "AHRSTurnRate": 3276.7, "AHRSGLoad": 0.10920454632244811, "AHRSGLoadMin": 0.10626655052683534, "AHRSGLoadMax": 0.1099768285851461, "AHRSLastAttitudeTime": "0001-01-01T00:49:25.51Z", "AHRSStatus": 7 };


    /*****************************************************
     * Situation Update
     */
    function connect($scope) {
        if($state.current.controller!='CockpitCtrl')return;

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
            $scope.$apply();
        };

        socket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null)) {
                socket.close();
                return;
            }
            const situation = angular.fromJson(msg.data);
            // Filter to avoid blow up CPU
            const oldSituation = $scope.situation;
            const newSituation = situation;
            const ahrsThreshold = 2;
            const altitudeThreshold = 50 / 3.2808;
            const requireRefresh = globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold);
            if (requireRefresh == true) {
                $scope.situation = situation;
                $scope.loadSituationInCockpit(situation);
                $scope.$apply(); // trigger any needed refreshing of data
            }
            else
            {
                return;
            }
        };
    }

    function connectTraffic($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.socketTraffic === undefined) || ($scope.socketTraffic === null)) {
            socketTraffic = new WebSocket(URL_TRAFFIC_WS);
            $scope.socketTraffic = socketTraffic; // store socket in scope for enter/exit usage
        }
        socketTraffic.onopen = function (msg) {
        };

        socketTraffic.onclose = function (msg) {
            $scope.$apply();
            delete $scope.socketTraffic;
            setTimeout(function () { connectTraffic($scope); }, 1000);
        };

        socketTraffic.onerror = function (msg) {
            $scope.$apply();
        };

        socketTraffic.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null)) {
                socketTraffic.close();
                return;
            }
            // $scope.loadTraffics(angular.fromJson(msg.data)); // Traffic is an optional feature not pushed today
            //$scope.$apply(); // trigger any needed refreshing of data
        };
    }

    /*****************************************************
     * EMS Update
     */
    function connectEMS($scope) {
        if($state.current.controller!='CockpitCtrl')return;

        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.socketEMS === undefined) || ($scope.socketEMS === null)) {
            socketEMS = new WebSocket(URL_EMS_WS);
            $scope.socketEMS = socketEMS; // store socket in scope for enter/exit usage
        }
        socketEMS.onopen = function (msg) {
        };

        socketEMS.onclose = function (msg) {
            $scope.$apply();
            delete $scope.socketEMS;
            setTimeout(function () { connectEMS($scope); }, 1000);
        };

        socketEMS.onerror = function (msg) {
            $scope.$apply();
        };

        socketEMS.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null)) {
                socketEMS.close();
                return;
            }
            $scope.loadSituationInCockpit(angular.fromJson(msg.data));
            $scope.$apply(); // trigger any needed refreshing of data
        };
    }

    $scope.loadSituationInCockpit = function (situation) {

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



        // $scope.myRadarOwnSituation(situation); Traffic is an optional not pushed today
        // if (radar) radar.update();
       


        // Magnetometer Calibration
        /*
        if (situation.hasOwnProperty("Magnetometer")) {

            avgX = (situation.Magnetometer.MagMaxX+situation.Magnetometer.MagMinX)/2;
            avgY = (situation.Magnetometer.MagMaxY+situation.Magnetometer.MagMinY)/2;
            avgZ = (situation.Magnetometer.MagMaxZ+situation.Magnetometer.MagMinZ)/2;
            diffX = situation.Magnetometer.MagMaxX-situation.Magnetometer.MagMinX/2;
            diffY = situation.Magnetometer.MagMaxY-situation.Magnetometer.MagMinY/2;
            diffZ = situation.Magnetometer.MagMaxZ-situation.Magnetometer.MagMinZ/2;
            MX = (situation.Magnetometer.X-avgX)/diffX;
            MY = (situation.Magnetometer.Y-avgY)/diffY;
            MZ = (situation.Magnetometer.Z-avgZ)/diffZ;



            situation.Compass = Math.atan2(MX, MY) * (180 / Math.PI);
            situation.MagnetometerPercentageX = MX * 180;
            situation.MagnetometerPercentageY = MY * 180;
            situation.MagnetometerPercentageZ = MZ * 180;

            
            console.log(
                MX.toFixed(2)
                +","+
                MY.toFixed(2)
                +","+
                MZ.toFixed(2)
                );

        }
        else {
            situation.MagnetometerPercentageX = 0;
            situation.MagnetometerPercentageY = 0;
            situation.MagnetometerPercentageZ = 0;
        }
        */


        Object.keys($scope.mapping).forEach(element => {
            if (situation.hasOwnProperty(element)) {
                $scope.widgetsSettings[$scope.mapping[element]].value = situation[element];
                $scope.widgetsSettings[$scope.mapping[element]].render.update(
                    $scope.widgetsSettings[$scope.mapping[element]].value,
                    $scope.widgetsSettings[$scope.mapping[element]],situation);
            }
        });
    }


    $scope.scrollItemCounter = 0;
    // Keypad Listener with supported keys
    function keypadEventListener(event) {
        if (($scope === undefined) || ($scope === null)) {
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
            case "ArrowUp":
            case "ArrowLeft":
                {
                    $scope.scrollItemCounter--;
                    if ($scope.scrollItemCounter < 0) {
                        const proxy = new KeyboardEvent("keypad", { key: "from" });
                        dispatchEvent(proxy);
                        $scope.scrollItemCounter = 0;
                        return;
                    }
                }
                break;
            case "Enter":
            case " ":
            case KEYPAD_MAPPING_TAP:
                if ($scope.scrollItemCounter>=0 && $scope.scrollItemCounter < $scope.widgetsSettings.length) {
                    $scope.zoom($scope.scrollItemCounter);
                }
                break;
            case "ArrowDown":
            case "ArrowRight":
            case KEYPAD_MAPPING_NEXT:
                {
                    $scope.scrollItemCounter++;
                    if ($scope.scrollItemCounter >= $scope.widgetsSettings.length) {
                        const proxy = new KeyboardEvent("keypad", { key: "to" });
                        dispatchEvent(proxy);
                        $scope.scrollItemCounter = $scope.widgetsSettings.length-1;
                        return;
                    }
                }
                break;
        }

        if ($scope.scrollItemCounter >= 0 && $scope.scrollItemCounter < $scope.widgetsSettings.length) {
            document.getElementById($scope.widgetsSettings[$scope.scrollItemCounter].divName).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        }

        $scope.$apply();
    }


    $scope.InitFunc();
    connect($scope);
    connectEMS($scope);
    connectTraffic($scope);
    // Bridge from servicekeypad
    addEventListener("keypad", keypadEventListener);
}