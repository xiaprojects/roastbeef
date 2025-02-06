/*
    Copyright (c) 2025 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    servicesituation.js: spread situation across screens without websocket subscription everytime
    Features:
        - Websocket connects and receive
        - Max, Min
        - Threshold to avoid cpu consumption
*/


SituationService.prototype = {
    constructor: SituationService,
};


let SERVICE_SITUATION_MAX_COUNT = 50

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

            delete $scope.situationSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.situationSocket.onerror = function (msg) {
        };

        $scope.sendSituationTimer = 0;
        $scope.situationSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
                var situation = angular.fromJson(msg.data);
                $scope.sendSituationTimer++;
                // Filter to avoid blow up CPU
                const oldSituation = window.situation;
                const newSituation = situation;
                const ahrsThreshold = 1;
                const altitudeThreshold = 50 / 3.2808;
                const requireRefresh = SERVICE_SITUATION_MAX_COUNT<$scope.sendSituationTimer || globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold);
                if (requireRefresh == true) {
                    $scope.sendSituationTimer=0;
                    window.situation = situation;
                    const proxy = new CustomEvent("SituationUpdated", {detail:situation});
                    dispatchEvent(proxy);

                }
        };
    }

    // Last Situation, shared out-of-angular to avoid angular triggers
    window.situation={};
    connect($scope);
}