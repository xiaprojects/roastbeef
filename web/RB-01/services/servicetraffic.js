
TrafficService.prototype = {
    constructor: TrafficService,
};

var URL_TRAFFIC_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/traffic";
var URL_RADAR_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/radar";

/**
 * TrafficService Service Class
 * Loaded by main.js
 * This Service will connect the WebSocket and wait for events to arrive, on arrival it play sounds and lit the bell
 */
function TrafficService($scope, $http) {

    function connect($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.trafficSocket === undefined) || ($scope.trafficSocket === null)) {
            trafficSocket = new WebSocket(URL_TRAFFIC_WS);
            $scope.trafficSocket = trafficSocket; // store socket in scope for enter/exit usage
        }


        $scope.trafficSocket.onopen = function (msg) {
        };

        $scope.trafficSocket.onclose = function (msg) {
            delete $scope.trafficSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.trafficSocket.onerror = function (msg) {
        };

        $scope.trafficSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            var k = JSON.parse(msg.data);
            const proxy = new CustomEvent("TrafficUpdated", { detail: k });
            dispatchEvent(proxy);
        };
    }
    connect($scope);
}