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
angular.module('appControllers').controller('ResourcesCtrl', ResourcesCtrl);

var URL_RESOURCES_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/resources";

function ResourcesCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "resources";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
    };


    $scope.resources = [];
    $http.get(URL_RESOURCES_GET).then(function (response) {
        var status = angular.fromJson(response.data);
        if (status.length > 0) {
            $scope.resources = status;
            // Automatically display the first item
            $scope.zoom($scope.resources[0],null);
        }
    });

    $scope.zoom = function (resource, event) {
        var zoomContainer = document.getElementById("zoomContainer");
        const imagePath = 'url(' + encodeURI(resource.Path) + ')';
        zoomContainer.style.backgroundImage = imagePath;
        zoomContainer.style.display = "block";
        zoomContainer.style.width = window.innerWidth + "px";
        zoomContainer.style.height = window.innerHeight + "px";
        if(event != null) {
            event.stopPropagation()
        }
    }
    $scope.backFromZoom = function (event) {
        zoomContainer.style.display = "none";
        event.stopPropagation()
    }
};
