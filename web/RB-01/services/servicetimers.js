/**
 * This file is part of RB.
 *
 * Copyright (C) 2023 XIAPROJECTS SRL
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
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
    servicetimers.js: the timers of the daemon, without polling

    /timers/ws sends the whole list as GET /timers answers it: on connect and on every
    change (create, delete, start, stop, a countdown firing). The list is kept in
    $scope.timersList for a plate opened after it came, and published as the
    "TimersUpdated" event. The seconds are counted by the plates from Epoch and
    CountDown: nothing comes while the timers only run.
*/

var URL_TIMERS_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/timers/ws";

// A socket that closes is opened again after this time
const TIMERS_RECONNECT_SECONDS = 1;

/**
 * TimersService Service Class
 * Loaded by main.js
 */
function TimersService($scope, $http) {
    function publish(list) {
        // The last list, for a plate or a bar shown after it came
        $scope.timersList = list;
        dispatchEvent(new CustomEvent("TimersUpdated", { detail: list }));
    }

    function connect() {
        var socket = new WebSocket(URL_TIMERS_WS);

        socket.onclose = function (msg) {
            // The daemon is gone: its timers with it, until the list comes again
            if ($scope.timersList !== undefined) {
                publish(undefined);
            }
            setTimeout(connect, TIMERS_RECONNECT_SECONDS * 1000);
        };

        socket.onmessage = function (msg) {
            var list = JSON.parse(msg.data);
            if (!Array.isArray(list)) {
                return; // a list the daemon could not marshal
            }
            publish(list);
        };
    }
    connect();
}
