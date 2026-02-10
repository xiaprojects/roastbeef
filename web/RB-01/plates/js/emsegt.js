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

angular.module('appControllers').controller('EmsegtCtrl', EmsegtCtrl);

function EmsegtCtrl($rootScope, $scope, $state, $http, $interval) {

	const name = "emsegt";

	$scope.locationId = name + (Date.now());

	$scope.init = function () {
		console.log(name + " Init() id=" + $scope.locationId);
	}


	$state.get(name).onEnter = function () {
		console.log("onEnter" + name);
	};

	$state.get(name).onExit = function () {
		console.log("onExit" + name);
		removeEventListener("EMSUpdated", emsUpdated);
	};

	const templateCHT = {
		"displace": "90%",
		"displaceMax": "90%",
		"direction":"-",
		"format": "---°",
		"value": 0,
		"valueMax": 0,
		"valueAvg": 0,
		"name": "CHT1",
		"sensor": "cht1",
		"ranges": [
			{ "colorOff": "#000048", "colorOn": "#0000ff", "min": 40, "max": 60 },
			{ "colorOff": "#000048", "colorOn": "#0000ff", "min": 60, "max": 80 },
			{ "colorOff": "#004800", "colorOn": "#00ff00", "min": 80, "max": 100 },
			{ "colorOff": "#004800", "colorOn": "#00ff00", "min": 100, "max": 120 },
			{ "colorOff": "#004800", "colorOn": "#00ff00", "min": 120, "max": 140 },
			{ "colorOff": "#004800", "colorOn": "#00ff00", "min": 140, "max": 160 },
			{ "colorOff": "#484800", "colorOn": "#ffff00", "min": 160, "max": 180 },
			{ "colorOff": "#480000", "colorOn": "#ff0000", "min": 180, "max": 200 }
		]
	};

	const templateEGT = {
		"displace": "90%",
		"displaceMax": "90%",
		"direction":"-",
		"format": "---°",
		"value": 0,
		"valueMax": 0,
		"valueAvg": 0,
		"name": "CHT1",
		"sensor": "cht1",
		"ranges": [
			{ "colorOff": "#000048", "colorOn": "#0000ff", "min": 400, "max": 450 },
			{ "colorOff": "#000048", "colorOn": "#0000ff", "min": 450, "max": 500 },
			{ "colorOff": "#004800", "colorOn": "#00ff00", "min": 500, "max": 550 },
			{ "colorOff": "#004800", "colorOn": "#00ff00", "min": 550, "max": 600 },
			{ "colorOff": "#004800", "colorOn": "#00ff00", "min": 600, "max": 650 },
			{ "colorOff": "#004800", "colorOn": "#00ff00", "min": 650, "max": 700 },
			{ "colorOff": "#484800", "colorOn": "#ffff00", "min": 700, "max": 750 },
			{ "colorOff": "#480000", "colorOn": "#ff0000", "min": 750, "max": 800 }
		]
	};

	$scope.bars = [
	];

	$scope.oilTemperature = 0;
	$scope.engineRpm = 0;
	$scope.outsideTemperature = 0;

	for (var index = 1; index <= 4; index++) {
		var item = JSON.parse(JSON.stringify(templateCHT));
		item.ranges = item.ranges.reverse();
		for (var r = 0; r < item.ranges.length; r++) {
			item.ranges[r].color = item.ranges[r].colorOff;
		}
		item.name = "Cht" + index;
		item.sensor = "cht" + index;
		$scope.bars.push(item);
		item = JSON.parse(JSON.stringify(templateEGT));
		item.ranges = item.ranges.reverse();
		item.name = "Egt" + index;
		item.sensor = "egt" + index;
		for (var r = 0; r < item.ranges.length; r++) {
			item.ranges[r].color = item.ranges[r].colorOff;
		}
		$scope.bars.push(item);
	}

	function barApplyValue(index, newValue) {
		if (newValue != $scope.bars[index].value) {
			$scope.bars[index].valueAvg = ($scope.bars[index].valueAvg * 9.0 + newValue) / 10.0;
			if($scope.bars[index].valueAvg < newValue - 1){
				$scope.bars[index].direction = String.fromCharCode(9650);
			} else {
				if($scope.bars[index].valueAvg > newValue + 1) {
					$scope.bars[index].direction = String.fromCharCode(9660);
				} else {
					$scope.bars[index].direction = "=";
				}
			}
			$scope.bars[index].value = newValue;
			var isNewMax = false;
			if ($scope.bars[index].valueMax < newValue) {
				$scope.bars[index].valueMax = newValue;
				isNewMax = true;
			}
			$scope.bars[index].format = parseInt(pilotDisplayedTemperaturesFromCelsius(newValue)) + "°";
			// Linear range
			var max = $scope.bars[index].ranges[0].max;
			var min = $scope.bars[index].ranges[$scope.bars[index].ranges.length - 1].min;

			if (newValue < min) {
				$scope.bars[index].displace = "90%";

			} else {
				if (newValue > max) {
					$scope.bars[index].displace = "5%";

				} else {
					var diff = max - min;
					$scope.bars[index].displace = (90 - 85.0 * (newValue - min) / diff) + "%";
					var lastColor = null;

				}
			}

			if(isNewMax == true) {
				$scope.bars[index].displaceMax = $scope.bars[index].displace;
			}


			for (var r = 0; r < $scope.bars[index].ranges.length; r++) {
				if ($scope.bars[index].ranges[r].min < newValue) {
					if (lastColor == null) {
						lastColor = $scope.bars[index].ranges[r].colorOn
					}
					$scope.bars[index].ranges[r].color = lastColor;
				}
				else {
					$scope.bars[index].ranges[r].color = $scope.bars[index].ranges[r].colorOff;

				}
			}
			return 1;
		}
		return 0;
	}

	function emsUpdated(emsData) {
		if (($scope === undefined) || ($scope === null) || ($state.current.controller != 'EmsegtCtrl' && $scope.$parent.$parent.hasOwnProperty("radarSocket") == false)) {
			removeEventListener("EMSUpdated", emsUpdated);
			return; // we are getting called once after clicking away from the status page
		}

		var changed = 0;
		for (var index = 0; index < $scope.bars.length; index++) {
			if (emsData.detail.hasOwnProperty($scope.bars[index].sensor)) {
				var newValue = emsData.detail[$scope.bars[index].sensor];
				changed += barApplyValue(index, newValue);
			}
		}
		if (changed > 0) {
			$scope.$apply();
		}

		if (emsData.detail.hasOwnProperty("oiltemperature")) {
			$scope.oilTemperature = parseInt(pilotDisplayedTemperaturesFromCelsius(emsData.detail["oiltemperature"]));
		}
		if (emsData.detail.hasOwnProperty("outsidetemperature")) {
			$scope.outsideTemperature = parseInt(pilotDisplayedTemperaturesFromCelsius(emsData.detail["outsidetemperature"]));
		}
		if (emsData.detail.hasOwnProperty("enginerpm")) {
			$scope.engineRpm = parseInt(emsData.detail["enginerpm"]);
		}
	};

	addEventListener("EMSUpdated", emsUpdated);
};


