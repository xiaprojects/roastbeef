var URL_EMS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/getEMS";
var URL_EMS_WS           = WS_HOST_PROTOCOL + URL_HOST_BASE + "/ems"


EMSService.prototype = {
    constructor: EMSService,
};



function EMSService($scope, $http) {


    function connect($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.emsSocket === undefined) || ($scope.emsSocket === null)) {
            emsSocket = new WebSocket(URL_EMS_WS);
            $scope.emsSocket = emsSocket; // store socket in scope for enter/exit usage
        }


        $scope.emsSocket.onopen = function (msg) {
        };

        $scope.emsSocket.onclose = function (msg) {
            delete $scope.emsSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.emsSocket.onerror = function (msg) {
        };

        $scope.emsSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            var k = JSON.parse(msg.data);
            const proxy = new CustomEvent("EMSUpdated", { detail: k });
            dispatchEvent(proxy);
        };
    }
    connect($scope);



    var simulatorSeed = 0;
    // Demo purposes
    window.setInterval(() => {
        var ems = {


            "fuel1": 0,
            "fuel2": 0,
            "fuel": 0,
            "oilpressure": 0,
            "oiltemperature": 0,
            "cht1": 0,
            "cht2": 0,
            "cht3": 0,
            "cht4": 0,
            "egt1": 0,
            "egt2": 0,
            "egt3": 0,
            "egt4": 0,
            "volt": 0,
            "map": 0,
            "rpm": 0,
            "fuelpressure": 0,
            "amps": 0,
            "fuelremaining": 0,
            "termalcouple": 0
        };

        const radians = simulatorSeed * Math.PI / 180;
        ems.rpm = 3000 + Math.sin(radians) * 3000.0;
        ems.map = 15 + Math.cos(radians) * 15.0;
        ems.oilpressure = 4 + Math.cos(radians) * 4.0;
        ems.oiltemperature = 75 + Math.cos(radians) * 75.0;

        simulatorSeed++;


        const proxy = new CustomEvent("EMSUpdated", { detail: ems });
        dispatchEvent(proxy);
    }, 100);
}