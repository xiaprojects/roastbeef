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
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
 */

StatusService.prototype = {
    constructor: StatusService,
};

var URL_STATUS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/getStatus";
var URL_STATUS_WS           = WS_HOST_PROTOCOL + URL_HOST_BASE + "/status"

/**
 * StatusService Service Class
 */

window.globalStatus = {"Version":"Roastbeaf-1.6r1-eu032-SixPack","Build":"669898ec88f5c3cc8c0032817a6ae00e9ea36828","HardwareBuild":"","Devices":1,"Connected_Users":6,"DiskBytesFree":9859944448,"UAT_messages_last_minute":0,"UAT_messages_max":0,"UAT_messages_total":0,"ES_messages_last_minute":36,"ES_messages_max":2548,"ES_messages_total":75037,"OGN_messages_last_minute":0,"OGN_messages_max":0,"OGN_messages_total":0,"OGN_connected":false,"APRS_connected":true,"AIS_messages_last_minute":0,"AIS_messages_max":0,"AIS_messages_total":0,"AIS_connected":false,"UAT_traffic_targets_tracking":0,"ES_traffic_targets_tracking":1,"Ping_connected":false,"Pong_connected":false,"UATRadio_connected":false,"GPS_satellites_locked":10,"GPS_satellites_seen":11,"GPS_satellites_tracked":15,"GPS_position_accuracy":2.514677,"GPS_connected":true,"GPS_solution":"3D GPS + SBAS","GPS_detected_type":24,"GPS_NetworkRemoteIp":"","Uptime":6812040,"UptimeClock":"0001-01-01T01:53:32.04Z","CPUTemp":46.85,"CPUTempMin":44.65,"CPUTempMax":50.15,"NetworkDataMessagesSent":221070,"NetworkDataBytesSent":6799645,"NetworkDataMessagesSentLastSec":30,"NetworkDataBytesSentLastSec":873,"UAT_METAR_total":0,"UAT_TAF_total":0,"UAT_NEXRAD_total":0,"UAT_SIGMET_total":0,"UAT_PIREP_total":0,"UAT_NOTAM_total":0,"UAT_OTHER_total":0,"Errors":["BLE Advertising failed to start: bluetooth: could not start advertisement: Failed to register advertisement"],"Logfile_Size":2462704,"AHRS_LogFiles_Size":0,"BMPConnected":true,"IMUConnected":true,"NightMode":false,"OGN_noise_db":0,"OGN_gain_db":0,"OGN_tx_enabled":false,"OGNPrevRandomAddr":"","Pong_Heartbeats":0};


function StatusService($scope, $http) {
    /*
    POLLING
    $scope.pollingStatus = $interval(() => {
        $http.get(URL_STATUS_GET).then(function (response) {
            window.globalStatus = angular.fromJson(response.data);
        }, 1000, 0, false);
    });
    */

    function connect($scope) {
        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.statusSocket === undefined) || ($scope.statusSocket === null)) {
            statusSocket = new WebSocket(URL_STATUS_WS);
            $scope.statusSocket = statusSocket; // store socket in scope for enter/exit usage
        }


        $scope.statusSocket.onopen = function (msg) {
        };

        $scope.statusSocket.onclose = function (msg) {
            delete $scope.statusSocket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        $scope.statusSocket.onerror = function (msg) {
        };

        $scope.statusSocket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null))
                return; // we are getting called once after clicking away from the page
            var k = JSON.parse(msg.data);
            const proxy = new CustomEvent("StatusUpdated", { detail: k });
            dispatchEvent(proxy);
        };
    }
    connect($scope);
}