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
angular.module('appControllers').controller('EMSCtrl', EMSCtrl);

function EMSCtrl($rootScope, $scope, $state, $http, $interval) {

	const name = "ems";

	$state.get(name).onEnter = function () {
		console.log("onEnter" + name);
	};

	$state.get(name).onExit = function () {
		console.log("onExit" + name);
		removeEventListener("EMSUpdated", emsUpdated);
	};


	$scope.updateChart = function (indexOut, keyIn, emsDataMap) {
		//
		if (!emsDataMap.hasOwnProperty(keyIn)) {
			emsDataMap[keyIn] = 0;
		}
		//
		var degreeOut = (
			(
				(emsDataMap[keyIn] - $scope.EMS[indexOut].minSpeed) / ($scope.EMS[indexOut].maxSpeed - $scope.EMS[indexOut].minSpeed)
			)
			*
			($scope.EMS[indexOut].endSpeedDegree - $scope.EMS[indexOut].startSpeedDegree)
			+ $scope.EMS[indexOut].startSpeedDegree
		);
		$scope.EMS[indexOut].speed = parseInt(emsDataMap[keyIn]);
		$scope.EMS[indexOut].speedDegree = (degreeOut + 90) + "deg";
		return degreeOut;
	}


	function emsUpdated(emsData) {

		if (($scope === undefined) || ($scope === null) || $state.current.controller != 'EMSCtrl') {
			removeEventListener("EMSUpdated", emsUpdated);
			return; // we are getting called once after clicking away from the status page
		}

		const OILTEMP = 0;
		const OILPRES = 1;
		const RPM = 2;
		const MAP = 3;

		$scope.updateChart(RPM, "rpm", emsData.detail);
		$scope.updateChart(OILTEMP, "oiltemperature", emsData.detail);
		$scope.updateChart(OILPRES, "oilpressure", emsData.detail);
		$scope.updateChart(MAP, "map", emsData.detail);

		$scope.$apply();

	};

	addEventListener("EMSUpdated", emsUpdated);

};
