/**
 * This file is part of RB.
 *
 * Copyright (C) 2025 XIAPROJECTS SRL
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.

 * This source is part of the project RB:
 * 01 -> Display with Synthetic vision, Autopilot and ADSB
 * 02 -> Display with SixPack
 * 03 -> Display with Autopilot, ADSB, Radio, Flight Computer
 * 04 -> Display with EMS: Engine monitoring system
 * 05 -> Display with Stratux BLE Traffic
 * 06 -> Display with Android 6.25" 7" 8" 10" 10.2"
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
 * Features:
 * - Radio update service
 */


RadioService.prototype = {
    constructor: RadioService,
};

var URL_RADIO_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/radioStatus";

/**
 * RadioService Service Class
 * Loaded by main.js
 * This Service will connect the WebSocket and wait for events to arrive, spreads if threshold
 */
function RadioService($scope, $http) {
    function connect($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.radioSocket === undefined) || ($scope.radioSocket === null)) {
            radioSocket = new WebSocket(URL_RADIO_WS);
            $scope.radioSocket = radioSocket; // store socket in scope for enter/exit usage
        }


        $scope.radioSocket.onopen = function (msg) {
        };

        $scope.radioSocket.onclose = function (msg) {

            delete $scope.radioSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.radioSocket.onerror = function (msg) {
        };

        $scope.sendSituationTimer = 0;
        $scope.radioSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            var radioStatus = angular.fromJson(msg.data);
            const proxy = new CustomEvent("RadioUpdated", { detail: radioStatus });
            dispatchEvent(proxy);

        };
    }
    connect($scope);
}