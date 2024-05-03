
AutopilotService.prototype = {
    constructor: AutopilotService,
};

// Autopilot WebSockets
var URL_AUTOPILOT_WS = "ws://" + URL_HOST_BASE + "/autopilot";

/**
 * AutopilotService Service Class
 * Loaded by main.js
 * This Service will connect the WebSocket and wait for events to arrive, on arrival it play sounds and lit the bell
 */
function AutopilotService($scope, $http) {

    $scope.goToAutopilot = function () {
        document.location="#/autopilot";
    }


    function connect($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.autopilotSocket === undefined) || ($scope.autopilotSocket === null)) {
            autopilotSocket = new WebSocket(URL_AUTOPILOT_WS);
            $scope.autopilotSocket = autopilotSocket; // store socket in scope for enter/exit usage
        }


        $scope.autopilotSocket.onopen = function (msg) {
        };

        $scope.autopilotSocket.onclose = function (msg) {
            $scope.autopilotClass = "label-danger"
            $scope.autopilotText = "A";
            delete $scope.autopilotSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.autopilotSocket.onerror = function (msg) {
            $scope.autopilotClass = "label-danger"
            $scope.autopilotText = "A";
        };

        $scope.autopilotSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            var k = JSON.parse(msg.data);
            console.log(k);
            if(k.hasOwnProperty("Active") && k["Active"]==true){
                $scope.autopilotClass = "label-success"
                if(k["GPRMB"]["Steer"]=="R"){
                    $scope.autopilotText = "\u{25BA}";
                }
                else {
                    $scope.autopilotText = "\u{25C4}";
                }
            } else {
                $scope.autopilotClass = "label-default"
                $scope.autopilotText = "A";
            }
            if($scope.autopilotData["To"]["Lat"] != k["To"]["Lat"] || $scope.autopilotData["To"]["Lon"] != k["To"]["Lon"]){
                // Emit Waypoint change
                const proxy = new Event("WaypointChanged", k["To"]);
                dispatchEvent(proxy);
            }
            $scope.autopilotData = k;
            // Angular UI Updated, due to background WebSocket
            $scope.$apply()
        };
    }
    // Service Startup...
    $scope.autopilotClass = "label-default";
    $scope.autopilotText = "A";
    $scope.autopilotData = {Active:false,To:{Lat:0,Lon:0,Ele:0,Cmt:""}};
    connect($scope);
}