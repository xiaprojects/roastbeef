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
 * Test this module with this command:
 * curl -X POST -H 'Content-Type: application/json' -d '{"alternatorout":10,"amps":8,"batteryvoltage":13.4,"cht1":130,"cht2":110,"cht3":120,"cht4":140,"egt1":800,"egt2":700,"egt3":750,"egt4":600,"enginerpm":5200,"fuel":120,"fuel1":45,"fuel2":12,"fuelpressure":4,"fuelremaining":50,"manifoldpressure":27,"oilpressure":60,"oiltemperature":100,"outsidetemperature":24}' http://localhost/setEMS
*/
angular.module('appControllers').controller('EMSCtrl', EMSCtrl);

function EMSCtrl($rootScope, $scope, $state, $http, $interval) {

	const name = "ems";
	$scope.isSidebar = false;

	$state.get(name).onEnter = function () {
		console.log("onEnter" + name);
	};

	$state.get(name).onExit = function () {
		console.log("onExit" + name);
		removeEventListener("EMSUpdated", emsUpdated);
	};

	$scope.init = function (params) {
		console.log("New Ctrl: "+ name+ " params:"+JSON.stringify(params));
		$scope.isSidebar = params.isSidebar;
    }


	$scope.updateChart = function (indexOut, keyIn, emsDataMap) {
		//
		if (!emsDataMap.hasOwnProperty(keyIn)) {
			emsDataMap[keyIn] = 0;
		}
		var useThisValueForGauge = emsDataMap[keyIn];
		if(useThisValueForGauge>$scope.EMS[indexOut].maxSpeed) {
			useThisValueForGauge=$scope.EMS[indexOut].maxSpeed;
		}
		if(useThisValueForGauge<$scope.EMS[indexOut].minSpeed) {
			useThisValueForGauge=$scope.EMS[indexOut].minSpeed;
		}
		//
		var degreeOut = (
			(
				(useThisValueForGauge - $scope.EMS[indexOut].minSpeed) / ($scope.EMS[indexOut].maxSpeed - $scope.EMS[indexOut].minSpeed)
			)
			*
			($scope.EMS[indexOut].endSpeedDegree - $scope.EMS[indexOut].startSpeedDegree)
			+ $scope.EMS[indexOut].startSpeedDegree
		);
		$scope.EMS[indexOut].speed = parseInt(emsDataMap[keyIn]);
		$scope.EMS[indexOut].speedDegree = (degreeOut + 90) + "deg";
		// Change color by threshold
		$scope.EMS[indexOut].backgroundColor = "#000000";
		for(var thresholdIndex = $scope.EMS[indexOut].arcs.length-1; thresholdIndex >= 0;thresholdIndex--) {
			if($scope.EMS[indexOut].speed > $scope.EMS[indexOut].arcs[thresholdIndex].threshold) {
				$scope.EMS[indexOut].backgroundColor = $scope.EMS[indexOut].arcs[thresholdIndex].backgroundColor;
				break;
			}
		}
		for(var thresholdIndex = $scope.EMS[indexOut].arcs.length-1; thresholdIndex >= 0;thresholdIndex--) {
			if($scope.EMS[indexOut].speed > $scope.EMS[indexOut].arcs[thresholdIndex].threshold) {
				$scope.EMS[indexOut].arcs[thresholdIndex].color = $scope.EMS[indexOut].arcs[thresholdIndex].activeColor;
			}
			else {
				$scope.EMS[indexOut].arcs[thresholdIndex].color = $scope.EMS[indexOut].arcs[thresholdIndex].backgroundColor;
			}
		}
		return degreeOut;
	}

	$scope.emsStatusError = true;

	function emsUpdated(emsData) {
		if (($scope === undefined) || ($scope === null) || ($state.current.controller != 'EMSCtrl' && $scope.$parent.$parent.hasOwnProperty("radarSocket") == false)) {
			removeEventListener("EMSUpdated", emsUpdated);
			return; // we are getting called once after clicking away from the status page
		}

		$scope.EMS.forEach(element => {
			
		});

		for(var index=0;index<$scope.EMS.length;index++) {
			$scope.updateChart(index, $scope.EMS[index].source, emsData.detail);
		}
		$scope.emsStatusError = false;
		$scope.$apply();

	};

	addEventListener("EMSUpdated", emsUpdated);

};
