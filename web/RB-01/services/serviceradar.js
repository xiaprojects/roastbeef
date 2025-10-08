
RadarService.prototype = {
    constructor: RadarService,
};


var URL_RADAR_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/radar";

/**
 * RadarService Service Class
 * Loaded by main.js
 * This Service will connect the WebSocket and wait for events to arrive, on arrival it play sounds and lit the bell
 */
function RadarService($scope, $http) {

    function connect($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.radarSocket === undefined) || ($scope.radarSocket === null)) {
            radarSocket = new WebSocket(URL_RADAR_WS);
            $scope.radarSocket = radarSocket; // store socket in scope for enter/exit usage
        }


        $scope.radarSocket.onopen = function (msg) {
        };

        $scope.radarSocket.onclose = function (msg) {
            delete $scope.radarSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.radarSocket.onerror = function (msg) {
        };

        $scope.radarSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            var k = JSON.parse(msg.data);
            const proxy = new CustomEvent("RadarChanged", { detail: k });
            dispatchEvent(proxy);
        };
    }
    connect($scope);
}