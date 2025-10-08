angular.module('appControllers').controller('AircraftCtrl', AircraftCtrl);


var URL_AIRCRAFT_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/RB-01/settings/aircraft.json";

function AircraftCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "aircraft";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
    };

    console.log("Controller " + name);


    $http.get(URL_AIRCRAFT_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        if (db === undefined || Object.keys(db).length == 0) {
            return;
        }
        $scope.aircraftData = db;
        // update the scope variables
        $scope.applyNewData(db);
        $scope.name = db.name;
    });

    $scope.mappingData = {
        "pilot": { "section": 1, "row": 0 },
        "propellerTime": { "section": 0, "row": 0 },
        "engineTime": { "section": 0, "row": 1 },
        "CPUTemp":{ "section": 1, "row": 1 },
        "ES_messages_last_minute":{ "section": 1, "row": 9 },
        "GPS_satellites_locked":{ "section": 1, "row": 11 }
    };


    $scope.items = [[
        { "label": "Propeller", "value": "", "color": "#4444ff" },
        { "label": "Engine", "value": "", "color": "#4444ff" },
        { "label": "Fuel L", "value": "35L", "color": "#ff7c00" },
        { "label": "", "value": null, "color": "transparent" },
        { "label": "Flaps", "value": "0%", "color": "#007c00" },
        { "label": "", "value": "", "color": "#00000000" },
        { "label": "", "value": "", "color": "#00000000" },
        { "label": "", "value": "", "color": "#00000000" },

        { "label": "EMS", "value": "OK", "color": "#007c00" },
        { "label": "VP-X", "value": "14.4 V", "color": "#007c00" },
        { "label": "BATT", "value": "11.9 V", "color": "#ff7c00" },
        { "label": "CHECK", "value": "TODO", "color": "#ff7c00" },
    ], [
        { "label": "Pilot", "value": "", "color": "#007c00" },
        { "label": "CPU Temp", "value": "---", "color": "#007c00" },
        { "label": "Fuel R", "value": "90L", "color": "#007c00" },
        { "label": "", "value": null, "color": "transparent" },
        { "label": "Trim", "value": "TO", "color": "#ff7c00" },
        { "label": "", "value": "", "color": "#00000000" },
        { "label": "", "value": "", "color": "#00000000" },
        { "label": "", "value": "", "color": "#00000000" },


        { "label": "Internet", "value": "OFFLINE", "color": "#ff0000" },
        { "label": "ADS-B", "value": "OFF", "color": "#7c7c7c" },
        { "label": "RADIO", "value": "KRT2", "color": "#007c00" },
        { "label": "GPS", "value": "---", "color": "#007c00" },
    ]
    ];


    $scope.applyNewData = function(newData){
        Object.keys(newData).forEach(key => {
            if($scope.mappingData.hasOwnProperty(key)==true){
                $scope.items[$scope.mappingData[key].section][$scope.mappingData[key].row].value=newData[key];
            }
        });
    }

    /*****************************************************
     *  Keypad Management
     */

    function keypadEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "AircraftCtrl") {
            removeEventListener("keypad", keypadEventListener);
            return; // we are getting called once after clicking away from the status page
        }

        if ($scope.keypadKnobTimerRemovePopup === undefined) {
        }
        else {
            // user is changing screen
            return;
        }
    }

    $scope.situation = {};
    $scope.updateSituation = (situation) => {
        $scope.$apply(); // trigger any needed refreshing of data
    };

    $scope.status = {};
    $scope.updateStatus = (status) => {

        $scope.status = status;
        $scope.applyNewData(status);
        $scope.$apply(); // trigger any needed refreshing of data
    };
    // ************
    function statusUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "AircraftCtrl") {
            removeEventListener("StatusUpdated", statusUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var status = event.detail;
        $scope.status = status;
        $scope.updateStatus(status);
    }
    // ************
    function situationUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != "AircraftCtrl") {
            removeEventListener("SituationUpdated", situationUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var situation = event.detail;
        $scope.situation = situation;
        $scope.updateSituation(situation);
    }
    addEventListener("keypad", keypadEventListener);
    addEventListener("SituationUpdated", situationUpdateEventListener);
    addEventListener("StatusUpdated", statusUpdateEventListener);

};
