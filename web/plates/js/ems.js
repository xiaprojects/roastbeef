/*
    Copyright (c) 2023 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    ems.js
*/

angular.module('appControllers').controller('EMSCtrl', EMSCtrl); // get the main module controllers set
EMSCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

var URL_EMS_WS = "ws://" + URL_HOST_BASE + "/ems";

// create our controller function with all necessary logic
function EMSCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.$parent.helppage = 'plates/ems-help.html';
    $scope.data_list = [];
    $scope.isHidden = false;
/*    
    $scope.noSleep = new NoSleep();
*/

    function connect($scope) {
        if($state.current.controller!='EMSCtrl')return;

        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.socket === undefined) || ($scope.socket === null)) {
            socket = new WebSocket(URL_EMS_WS);
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
            //resetSituation();
            $scope.$apply();
        };

        socket.onmessage = function (msg) {
            console.log(msg);
            var newEMSData = angular.fromJson(msg.data);
            Object.keys(newEMSData).forEach(element => {
                $scope.ems[element] = newEMSData[element];
            });
            $scope.reload();
            $scope.$apply(); // trigger any needed refreshing of data
        };
    }

    $scope.hideClick = function () {
        $scope.isHidden = !$scope.isHidden;
        var disp = "block";
        if ($scope.isHidden) {
            disp = "none";
/*
            $scope.noSleep.enable();
*/
        } else {
/*
            $scope.noSleep.disable();
*/
        }
        var hiders = document.querySelectorAll(".hider");

        for (var i = 0; i < hiders.length; i++) {
            hiders[i].style.display = disp;
        }
    };


    $state.get('ems').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('ems').onExit = function () {
/*
        $scope.noSleep.disable();
        delete $scope.noSleep;
*/

        if (($scope.socket !== undefined) && ($scope.socket !== null)) {
            $scope.socket.close();
            $scope.socket = null;
        }
    };

    // EMS Controller tasks
    connect($scope); // connect - opens a socket and listens for messages

    $scope.ems = {
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
        "fuelpressure":0,
        "amps":0,
        "fuelremaining":0,
        "termalcouple":0
    };


    $scope.max = {
        "amps": 20,
        "cht1": 250,
        "cht2": 250,
        "cht3": 250,
        "cht4": 250,
        "egt1": 1700,
        "egt2": 1700,
        "egt3": 1700,
        "egt4": 1700,
        "fuel": 50,
        "fuel1": 150,
        "fuel2": 150,
        "fuelpressure": 70,
        "fuelremaining": 350,
        "map": 1030,
        "oilpressure": 70,
        "oiltemperature": 150,
        "rpm": 8000,
        "termalcouple": 100,
        "volt": 150
    };


    $scope.min = {
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
        "fuelpressure":0,
        "amps":0,
        "fuelremaining":0,
        "termalcouple":0
    };


    $scope.reload = function () {

        $scope.data_list.length = 0; // clear array
        for (var item in ($scope.ems)) {
            var x = {
                "id": item,
                "text": $scope.ems[item],
                "max": $scope.max[item],
                "min": $scope.min[item],
                "icon": ""
            };
            console.log(x);
            $scope.data_list.push(x); // add to start of array
        }
    };

    $scope.Increment = function (item) {
        console.log(item);
        $scope.ems[item]++;
        $scope.reload();

        var p = JSON.stringify({ [item]: parseInt($scope.ems[item]) });
        $http.post("/setEMS", p).then(function (response) {
        }, function (response) {
        });

    };
    $scope.OnChange = function (component,item) {
        console.log(component);
        console.log(item);
        $scope.ems[item]=component;
        $scope.reload();

        var p = JSON.stringify({ [item]: parseInt($scope.ems[item]) });
        $http.post("/setEMS", p).then(function (response) {
        }, function (response) {
        });

    };

    $scope.Decrement = function (item) {
        console.log(item);
        $scope.ems[item]--;
        $scope.reload();
        var p = JSON.stringify({ [item]: parseInt($scope.ems[item]) });
        $http.post("/setEMS", p).then(function (response) {
        }, function (response) {
        });
    };
    $scope.reload();


    $http.get("/getEMS").then(function (response) {
        for (var item in (response.data)) {
            $scope.ems[item] = response.data[item];
        }
        $scope.reload();
    }, function (response) {
    });
}
