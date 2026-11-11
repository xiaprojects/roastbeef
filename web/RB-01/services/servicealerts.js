/**
 * This file is part of RB.
 *
 * Copyright (C) 2024 XIAPROJECTS SRL
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
 * 07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
 * 08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
 */

AlertsService.prototype = {
    constructor: AlertsService,
};

// Alerts WebSockets
var URL_ALERTS_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/alerts";
// The whole list as /getAlerts answers it, on connect and on every change
var URL_ALERTS_LIST_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/alerts/ws";

// Every balloon closes by itself after this time
const ALERT_BALLOON_SECONDS = 10;
// A long title shrinks down to this size before the ellipsis cuts it
const ALERT_BALLOON_MIN_FONT_PX = 18;
// The Icon of the mapping by severity: a balloon never covers a more severe one
const ALERT_BALLOON_SEVERITY = ["info", "warning", "danger"];
// The alerts socket carries only new alerts: the state of an alert comes on the list socket
// A socket that closes is opened again after this time
const ALERTS_RECONNECT_SECONDS = 1;
// An alert coming back replays the alarm only if it was inactive for this long
// An engine rule at the edge of a band comes back every few seconds
var ALERT_REPLAY_CLEAR_SECONDS = 60;

/**
 * AlertsService Service Class
 * Loaded by main.js
 * This Service will connect the WebSocket and wait for events to arrive, on arrival it play sounds, lit the bell and show the balloon
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
     * alertMappingRow: the row of an event type
     * A language can be shorter than the enumeration, and the severity shall not depend on the language
     * @param {*} alertType - Enumerate, it is an array balanced with enumeration starting from 0
     * @returns The row, undefined if no language has it
     */
    function alertMappingRow(alertType) {
        var rows = $scope.alertsMapping[navigator.language || navigator.userLanguage];
        if (rows === undefined || rows[alertType] === undefined) {
            // Fallback to English
            rows = $scope.alertsMapping["en-US"];
        }
        return rows === undefined ? undefined : rows[alertType];
    }
    // The top bar colours its ALERTS lamp with the severity the balloon uses
    $scope.alertMappingRow = alertMappingRow;

    var alertBalloon = null; // The element on screen, alertsModal is in index.html
    var alertBalloonTimer = null;

    function hideAlertBalloon() {
        clearTimeout(alertBalloonTimer);
        if (alertBalloon !== null) {
            alertBalloon.remove();
            alertBalloon = null;
        }
    }

    /**
     * showAlertBalloon: one line, colored by severity in alerts.css, closed by the timer or by a click
     * @param {*} alertTitle - Title of the alert, if any
     * @param {*} row - Row of the mapping, undefined if the event type is unknown
     */
    function showAlertBalloon(alertTitle, row) {
        var severity = row !== undefined ? row.Icon : "warning";
        if (alertBalloon !== null
            && ALERT_BALLOON_SEVERITY.indexOf(alertBalloon.dataset.severity) > ALERT_BALLOON_SEVERITY.indexOf(severity)) {
            return;
        }
        hideAlertBalloon();
        alertBalloon = document.createElement("div");
        alertBalloon.className = "alertsballoon " + severity;
        alertBalloon.dataset.severity = severity;
        alertBalloon.textContent = alertTitle || (row !== undefined ? row.Text : "") || "Alert";
        alertBalloon.onclick = hideAlertBalloon;
        document.getElementById("alertsModal").appendChild(alertBalloon);

        var fontSize = parseFloat(getComputedStyle(alertBalloon).fontSize);
        while (alertBalloon.scrollWidth > alertBalloon.clientWidth && fontSize > ALERT_BALLOON_MIN_FONT_PX) {
            fontSize -= 2;
            alertBalloon.style.fontSize = fontSize + "px";
        }

        alertBalloonTimer = setTimeout(hideAlertBalloon, ALERT_BALLOON_SECONDS * 1000);
    }

    /**
     * pushAlert: System Wide Function to Push Alerts
     * @param {*} alertType - Enumerate to fetch the Audio to be played
     * @param {*} alertTitle - Title of the balloon to be displayed
     * @param {*} newUrl - Future implemetantion, if any redirect the user to the scree, useful for EMS and Dangerous things
     */
    $scope.pushAlert = function (alertType, alertTitle, newUrl) {
        var row = alertMappingRow(alertType);
        if (row !== undefined && row.Sound !== undefined && row.Sound.length > 0) {
            // AudioProxy HTML Item is in index.html

            if (document.getElementById("audioproxy") === undefined 
            || document.getElementById("audioproxy") === false
            || localDisplayGetFlag("Display_Audio_Alerts_Enabled") != "true"
            || document.getElementById("audioproxy") == null){
                // DOM is not ready or Audio in not enabled on the browser (ex.:Round display)
            }
            else {
            document.getElementById("audioproxy").autoplay = true;
            document.getElementById("audioproxy").src = "sounds/" + row.Sound + ".mp3";
            document.getElementById("audioproxy").load();
            }
        }
        // Turn on the bell
        $scope.alarmIsLit = true;

        showAlertBalloon(alertTitle, row);

        // Goto Page
        if(newUrl !== undefined && newUrl.length>0){
            document.location = newUrl;
        }
    }

    var alertStates = null; // Id to {active, clearedAt}, null until the first answer

    /**
     * followAlerts: compare the list with the previous one and replay the alarm of an alert coming back
     * The first answer only records the state, and a new Id has already been announced by the socket
     * @param {*} list - Alerts as /alerts/ws sends them, an older daemon has no Id
     */
    function followAlerts(list) {
        var now = Date.now();
        var states = {};
        list.forEach(function (alert) {
            if (alert.Id === undefined) {
                return;
            }
            var state = { active: alert.Active === true, clearedAt: now };
            var known = alertStates === null ? undefined : alertStates[alert.Id];
            if (known !== undefined && known.active === state.active) {
                state.clearedAt = known.clearedAt;
            }
            else if (known !== undefined && state.active
                && now - known.clearedAt >= ALERT_REPLAY_CLEAR_SECONDS * 1000) {
                $scope.pushAlert(alert.Type, alert.Title, "");
            }
            states[alert.Id] = state;
        });
        alertStates = states;
    }

    /**
     * connectList: the state of the alerts for every page, plates listen to AlertsUpdated
     * The daemon sends the list on connect, so a reconnection catches up by itself
     */
    function connectList() {
        var listSocket = new WebSocket(URL_ALERTS_LIST_WS);

        listSocket.onclose = function (msg) {
            setTimeout(connectList, ALERTS_RECONNECT_SECONDS * 1000);
        };

        listSocket.onmessage = function (msg) {
            var list = JSON.parse(msg.data);
            if (!Array.isArray(list)) {
                return; // a list the daemon could not marshal
            }
            // Inside this digest: a listener shall not call $apply
            $scope.$apply(function () {
                // The last list, for a top bar shown after it came
                $scope.alertsList = list;
                followAlerts(list);
                const proxy = new CustomEvent("AlertsUpdated", { detail: list });
                dispatchEvent(proxy);
            });
        };
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
    connectList();
}