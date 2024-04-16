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
CockpitCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies


// TODO: Move into a service to store the user changes
var URL_COCKPIT_SETUP = URL_HOST_PROTOCOL + URL_HOST_BASE + "/cockpit/setup.json";

// create our controller function with all necessary logic
function CockpitCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.$parent.helppage = 'plates/cockpit-help.html';
    $scope.data_list = [];
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

        if (($scope.socket !== undefined) && ($scope.socket !== null)) {
            $scope.socket.close();
            $scope.socket = null;
        }
    };

    $scope.zoom = function (index) {
        let widgetClasses = ["col-xs-3", "col-xs-6", "col-xs-12", "col-xs-3"];
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
                    //currentItem["render"] = new RadarRenderer(currentItem.divName, $scope, $http);
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


    /*****************************************************
     * Situation Update
     */
    function connect($scope) {
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
            $scope.loadSituationInCockpit(angular.fromJson(msg.data));
            $scope.$apply(); // trigger any needed refreshing of data
        };
    }

    $scope.loadSituationInCockpit = function (situation) {

        Object.keys($scope.mapping).forEach(element => {
            if ($scope.mapping.hasOwnProperty(element)) {
                $scope.widgetsSettings[$scope.mapping[element]].value = situation[element];
                $scope.widgetsSettings[$scope.mapping[element]].render.update(
                    $scope.widgetsSettings[$scope.mapping[element]].value,
                    $scope.widgetsSettings[$scope.mapping[element]]);
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
    // Bridge from servicekeypad
    addEventListener("keypad", keypadEventListener);
}