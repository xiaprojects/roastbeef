
AlertsService.prototype = {
    constructor: AlertsService,
};

// Alerts WebSockets
var URL_ALERTS_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/alerts";

/**
 * AlertsService Service Class
 * Loaded by main.js
 * This Service will connect the WebSocket and wait for events to arrive, on arrival it play sounds and lit the bell
 */
function AlertsService($scope, $http) {
    $scope.alertsMapping = {}; // Translations and other usefull stuff for rendering

    // Load Mapping configuration
    if ($scope.alertsMapping === undefined || Object.keys($scope.alertsMapping).length == 0) {
        $http.get(URL_ALERTSMAPPING_GET).then(function (response) {
            var mapping = angular.fromJson(response.data);
            $scope.alertsMapping = mapping;
        });
    }

    $scope.goToAlerts = function () {
        document.location="#/alerts";
    }


    /**
     * pushAlert: System Wide Function to Push Alerts
     * @param {*} alertType - Enumerate to fetch the Audio to be played
     * @param {*} alertTitle - Future implementation, title of the balloon to be displayed
     * @param {*} newUrl - Future implemetantion, if any redirect the user to the scree, useful for EMS and Dangerous things
     */
    $scope.pushAlert = function (alertType, alertTitle, newUrl) {
        var userLang = navigator.language || navigator.userLanguage;
        if ($scope.alertsMapping !== undefined && $scope.alertsMapping.hasOwnProperty(userLang)) {
            // User Language found
        }
        else {
            // Fallback to English
            userLang = "en-US";
        }
        if ($scope.alertsMapping.hasOwnProperty(userLang)) {
            // It is an array balanced with enumeration starting from 0
            if ($scope.alertsMapping[userLang].length > alertType) {
                if ($scope.alertsMapping[userLang][alertType].Sound !== undefined && $scope.alertsMapping[userLang][alertType].Sound.length > 0) {
                    // AudioProxy HTML Item is in index.html

                    if (document.getElementById("audioproxy") === undefined 
                    || document.getElementById("audioproxy") === false
                    || document.getElementById("audioproxy") == null){
                        // DOM is not ready or Audio in not enabled on the browser (ex.:Round display)
                    }
                    else {
                    document.getElementById("audioproxy").autoplay = true;
                    document.getElementById("audioproxy").src = "/sounds/" + $scope.alertsMapping[userLang][alertType].Sound + ".mp3";
                    document.getElementById("audioproxy").load();
                    }
                }
            }
        }
        // Turn on the bell
        $scope.alarmIsLit = true;

        // Goto Page
        if(newUrl !== undefined && newUrl.length>0){
            document.location = newUrl;
        }
    }

    function connect($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.alertsSocket === undefined) || ($scope.alertsSocket === null)) {
            alertsSocket = new WebSocket(URL_ALERTS_WS);
            $scope.alertsSocket = alertsSocket; // store socket in scope for enter/exit usage
        }


        $scope.alertsSocket.onopen = function (msg) {
        };

        $scope.alertsSocket.onclose = function (msg) {

            delete $scope.alertsSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.alertsSocket.onerror = function (msg) {
        };

        $scope.alertsSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            var k = JSON.parse(msg.data);
            $scope.pushAlert(k.Type, k.Title, "");
            // Angular UI Updated, due to background WebSocket
            $scope.$apply()
        };
    }

    // Service Startup...
    $scope.alarmIsLit = false;
    connect($scope);
}