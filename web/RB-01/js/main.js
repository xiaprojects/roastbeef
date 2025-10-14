var app = angular.module('bobby', ['ui.router', 'mobile-angular-ui', 'appControllers']);

var appControllers = angular.module('appControllers', []);

app.config(function ($stateProvider, $urlRouterProvider) {
	$stateProvider
		.state('home', {
			url: '/',
			templateUrl: globalInterfaceSettings.HomePage,
			controller: globalInterfaceSettings.HomePageController,
			reloadOnSearch: false
		})
		.state('speed', {
			url: '/speed',
			templateUrl: 'plates/speed.html',
			controller: 'SixPackInstrumentSpeed',
			reloadOnSearch: false
		})
		.state('attitude', {
			url: '/attitude',
			templateUrl: 'plates/attitude.html',
			controller: 'SixPackInstrumentAttitude',
			reloadOnSearch: false
		})
		.state('altimeter', {
			url: '/altimeter',
			templateUrl: 'plates/altimeter.html',
			controller: 'SixPackInstrumentAltimeter',
			reloadOnSearch: false
		})
		.state('turnslip', {
			url: '/turnslip',
			templateUrl: 'plates/turnslip.html',
			controller: 'SixPackInstrumentTurnslip',
			reloadOnSearch: false
		})
		.state('heading', {
			url: '/heading',
			templateUrl: 'plates/heading.html',
			controller: 'SixPackInstrumentHeading',
			reloadOnSearch: false
		})
		.state('autopilot', {
			url: '/autopilot',
			templateUrl: 'plates/autopilot.html',
			controller: 'AutopilotCtrl',
			reloadOnSearch: false
		})
		.state('charts', {
			url: '/charts',
			templateUrl: 'plates/charts.html',
			controller: 'ChartsCtrl',
			reloadOnSearch: false
		})
		.state('checklist', {
			url: '/checklist',
			templateUrl: 'plates/checklist.html',
			controller: 'CheckCtrl',
			reloadOnSearch: false
		})
		.state('camera', {
			url: '/camera',
			templateUrl: 'plates/camera.html',
			controller: 'CameraCtrl',
			reloadOnSearch: false
		})
		.state('variometer', {
			url: '/variometer',
			templateUrl: 'plates/variometer.html',
			controller: 'SixPackInstrumentVariometer',
			reloadOnSearch: false
		})
		.state('radio', {
			url: '/radio',
			templateUrl: 'plates/radio.html',
			controller: 'RadioCtrl',
			reloadOnSearch: false
		})
		.state('radar', {
			url: '/radar',
			templateUrl: 'plates/radar.html',
			controller: 'RadarCtrl',
			reloadOnSearch: false
		})
		.state('synthview', {
			url: '/synthview',
			templateUrl: 'plates/synthview.html',
			controller: 'SynthViewCtrl',
			reloadOnSearch: false
		})
		.state('airfields', {
			url: '/airfields',
			templateUrl: 'plates/airfields.html',
			controller: 'AirfieldsCtrl',
			reloadOnSearch: false
		})
		.state('hsi', {
			url: '/hsi',
			templateUrl: 'plates/hsi.html',
			controller: 'HSICtrl',
			reloadOnSearch: false
		})
		.state('timers', {
			url: '/timers',
			templateUrl: 'plates/timers.html',
			controller: 'TimersCtrl',
			reloadOnSearch: false
		})
		.state('alerts', {
			url: '/alerts',
			templateUrl: 'plates/alerts.html',
			controller: 'AlertsCtrl',
			reloadOnSearch: false
		})
		.state('switchboard', {
			url: '/switchboard',
			templateUrl: 'plates/switchboard.html',
			controller: 'SwitchboardCtrl',
			reloadOnSearch: false
		})
		.state('map', {
			url: '/map',
			templateUrl: 'plates/map.html',
			controller: 'MapCtrl',
			reloadOnSearch: false
		})
		.state('ems', {
			url: '/ems',
			templateUrl: 'plates/ems.html',
			controller: 'EMSCtrl',
			reloadOnSearch: false
		})
		.state('sixpack', {
			url: '/sixpack',
			templateUrl: 'plates/sixpack.html',
			controller: 'SixPackInstrumentSixpack',
			reloadOnSearch: false
		})
		.state('aircraft', {
			url: '/aircraft',
			templateUrl: 'plates/aircraft.html',
			controller: 'AircraftCtrl',
			reloadOnSearch: false
		})
		.state('resources', {
			url: '/resources',
			templateUrl: 'plates/resources.html',
			controller: 'ResourcesCtrl',
			reloadOnSearch: false
		})
		;
	$urlRouterProvider.otherwise('/');
});

app.controller('MainCtrl', function ($scope, $http, $state) {
	if (true) {
		if (($scope.keypad === undefined) || ($scope.keypad === null)) {
			$scope.keypad = new KeypadService($scope, $http, $state);
		}
	}
	if (true) {
		if (($scope.autopilot === undefined) || ($scope.autopilot === null)) {
			$scope.autopilot = new AutopilotService($scope, $http);
		}
	}
	if (true) {
		if (($scope.keypad === undefined) || ($scope.keypad === null)) {
			$scope.alerts = new AlertsService($scope, $http, $state);
		}
	}
	if (true) {
		if (($scope.situationService === undefined) || ($scope.situationService === null)) {
			$scope.situationService = new SituationService($scope, $http, $state);
		}
	}
	if (true) {
		if (($scope.trafficService === undefined) || ($scope.trafficService === null)) {
			$scope.trafficService = new TrafficService($scope, $http, $state);
		}
	}
	if (true) {
		if (($scope.radarService === undefined) || ($scope.radarService === null)) {
			$scope.radarService = new RadarService($scope, $http, $state);
		}
	}
	if (true) {
		if (($scope.emsService === undefined) || ($scope.emsService === null)) {
			$scope.emsService = new EMSService($scope, $http, $state);
		}
	}
	if (true) {
		if (($scope.statusService === undefined) || ($scope.statusService === null)) {
			$scope.statusService = new StatusService($scope, $http, $state);
		}
	}
	// TODO: radio is optional, so we can manage this condition
	if (true) {
		if (($scope.radioService === undefined) || ($scope.radioService === null)) {
			$scope.radioService = new RadioService($scope, $http, $state);
		}
	}
	$scope.fabClick = (direction, item, browserEvent) => {
		console.log(direction + " " + item + " " + browserEvent);
		const proxy = new KeyboardEvent("key", { key: "DOM_CLICK_" + direction });

		if (direction == "N") {
			$scope.uiSidebarTop = !$scope.uiSidebarTop;
		}
		if (direction == "S") {
			$scope.uiSidebarBottom = !$scope.uiSidebarBottom;
		}

		dispatchEvent(proxy);
	};


	/*
		$scope.leftpage = 'plates/sideleft.html';
		$scope.rightpages = 'plates/sideright.html';
		$scope.bottompage = 'plates/sidebottom.html';
		$scope.toppage = 'plates/sidetop.html';
	const openSidePanels = window.innerWidth > window.innerHeight;
	if(openSidePanels){
		$scope.Ui.turnOn("uiSidebarLeft");
		$scope.Ui.turnOn("uiSidebarRight");
	}

		*/

	$scope.uiSidebarTop = false;
	$scope.uiSidebarBottom = false;



	$scope.rightpages = [
		{ "url": "plates/radio.html", "ctrl": RadioCtrl, pointer: null, "name": "radio" },
		{ "url": "plates/radar.html", "ctrl": RadarCtrl, pointer: null, "name": "radar" }

	];

	$scope.leftpages = [
		{ "url": "plates/ems.html", "ctrl": EMSCtrl, pointer: null, "name": "ems" }

	];


	$scope.COMMS = {
		"radioList": [
			{ "className": "keypadSelectedNo", "classStandByLeft": "btn-default", "classStandByRight": "btn-default", "name": "KRT2", "active": "130.000", "standby": "125.600", "dual": false, "index": 0, "label": "LOCAL AIRFIELD", "standbyLabel": "LIRZ APP" }
		]
	};
	$scope.EMS = [

		{
			"speed": 0,
			"endSpeedDegree": 495,

			"label": "OIL TEMP",
			"unit": "°C",
			"backgroundColor": "#000000",
			"startSpeedDegree": 225,
			"minSpeed": 0,
			"maxSpeed": 110,
			"speedDegree": "45deg",
			"arcs": [
				{ "color": "#ffffff", "sizeDegree": "90deg", "startDegree": "225deg", "threshold": 0, "backgroundColor": "#000000" },
				{ "color": "#00ff00", "sizeDegree": "90deg", "startDegree": "315deg", "threshold": 40, "backgroundColor": "#00aa00" },
				{ "color": "#ffff00", "sizeDegree": "75deg", "startDegree": "45deg", "threshold": 90, "backgroundColor": "#aaaa00" },
				{ "color": "#ff0000", "sizeDegree": "15deg", "startDegree": "120deg", "threshold": 120, "backgroundColor": "#aa0000" }
			],
			"speedTicks": []
		},
		{
			"speed": 0,
			"endSpeedDegree": 495,

			"label": "OIL PRES",
			"unit": "PSI",
			"backgroundColor": "#000000",
			"startSpeedDegree": 225,
			"minSpeed": 0,
			"maxSpeed": 8,
			"speedDegree": "45deg",
			"arcs": [
				{ "color": "#ffffff", "sizeDegree": "90deg", "startDegree": "225deg", "threshold": 0, "backgroundColor": "#000000" },
				{ "color": "#00ff00", "sizeDegree": "90deg", "startDegree": "315deg", "threshold": 0, "backgroundColor": "#000000" },
				{ "color": "#ffff00", "sizeDegree": "75deg", "startDegree": "45deg", "threshold": 0, "backgroundColor": "#000000" },
				{ "color": "#ff0000", "sizeDegree": "15deg", "startDegree": "120deg", "threshold": 0, "backgroundColor": "#000000" }
			],
			"speedTicks": []
		},
		{
			"speed": 0,
			"endSpeedDegree": 495,
			"label": "RPM",
			"unit": "100rpm",
			"backgroundColor": "#000000",
			"startSpeedDegree": 225,
			"minSpeed": 0,
			"maxSpeed": 6000,
			"speedDegree": "45deg",
			"arcs": [
				{ "color": "#ffffff", "sizeDegree": "90deg", "startDegree": "225deg", "threshold": 0, "backgroundColor": "#000000" },
				{ "color": "#00ff00", "sizeDegree": "90deg", "startDegree": "315deg", "threshold": 0, "backgroundColor": "#00aa00" },
				{ "color": "#ffff00", "sizeDegree": "75deg", "startDegree": "45deg", "threshold": 0, "backgroundColor": "#aaaa00" },
				{ "color": "#ff0000", "sizeDegree": "15deg", "startDegree": "120deg", "threshold": 0, "backgroundColor": "#aa0000" }
			],
			"speedTicks": []
		},
		{
			"speed": 27,
			"endSpeedDegree": 495,
			"label": "MAP",
			"unit": "mmHg",
			"backgroundColor": "#000000",
			"startSpeedDegree": 225,
			"minSpeed": 0,
			"maxSpeed": 30,
			"speedDegree": "180deg",
			"arcs": [
				{ "color": "#ffffff", "sizeDegree": "90deg", "startDegree": "225deg", "threshold": 0, "backgroundColor": "#000000" },
				{ "color": "#00ff00", "sizeDegree": "90deg", "startDegree": "315deg", "threshold": 0, "backgroundColor": "#000000" },
				{ "color": "#ffff00", "sizeDegree": "75deg", "startDegree": "45deg", "threshold": 0, "backgroundColor": "#000000" },
				{ "color": "#ff0000", "sizeDegree": "15deg", "startDegree": "120deg", "threshold": 0, "backgroundColor": "#000000" }
			],
			"speedTicks": []
		}
	];



	// Sidebar simulation to be moved

	addEventListener("EMSUpdated", (emsData) => {
		const OILTEMP = 0;
		const OILPRES = 1;
		const RPM = 2;
		const MAP = 3;

		var degreeOut = 0;


		var keyIn = "rpm";
		var indexOut = RPM;
		//
		degreeOut = (((emsData.detail[keyIn] - $scope.EMS[indexOut].minSpeed) / ($scope.EMS[indexOut].maxSpeed - $scope.EMS[indexOut].minSpeed)) * ($scope.EMS[indexOut].endSpeedDegree - $scope.EMS[indexOut].startSpeedDegree) + $scope.EMS[indexOut].startSpeedDegree);
		$scope.EMS[indexOut].speed = parseInt(emsData.detail[keyIn]);
		$scope.EMS[indexOut].speedDegree = (degreeOut + 90) + "deg";
		for(var thresholdIndex = $scope.EMS[indexOut].arcs.length-1;thresholdIndex>=0;thresholdIndex--)
		{
			if($scope.EMS[indexOut].arcs[thresholdIndex].threshold<$scope.EMS[indexOut].speed)
			{
				$scope.EMS[indexOut]["backgroundColor"] = $scope.EMS[indexOut].arcs[thresholdIndex]["backgroundColor"];
				break;
			}
		}


		//
		keyIn = "oiltemperature";
		indexOut = OILTEMP;
		degreeOut = (((emsData.detail[keyIn] - $scope.EMS[indexOut].minSpeed) / ($scope.EMS[indexOut].maxSpeed - $scope.EMS[indexOut].minSpeed)) * ($scope.EMS[indexOut].endSpeedDegree - $scope.EMS[indexOut].startSpeedDegree) + $scope.EMS[indexOut].startSpeedDegree);
		$scope.EMS[indexOut].speed = parseInt(emsData.detail[keyIn]);
		$scope.EMS[indexOut].speedDegree = (degreeOut + 90) + "deg";
		for(var thresholdIndex = $scope.EMS[indexOut].arcs.length-1;thresholdIndex>=0;thresholdIndex--)
		{
			if($scope.EMS[indexOut].arcs[thresholdIndex].threshold<$scope.EMS[indexOut].speed)
			{
				$scope.EMS[indexOut]["backgroundColor"] = $scope.EMS[indexOut].arcs[thresholdIndex]["backgroundColor"];
				break;
			}
		}



		keyIn = "oilpressure";
		indexOut = OILPRES;
		degreeOut = (((emsData.detail[keyIn] - $scope.EMS[indexOut].minSpeed) / ($scope.EMS[indexOut].maxSpeed - $scope.EMS[indexOut].minSpeed)) * ($scope.EMS[indexOut].endSpeedDegree - $scope.EMS[indexOut].startSpeedDegree) + $scope.EMS[indexOut].startSpeedDegree);
		$scope.EMS[indexOut].speed = parseInt(emsData.detail[keyIn]);
		$scope.EMS[indexOut].speedDegree = (degreeOut + 90) + "deg";
		for(var thresholdIndex = $scope.EMS[indexOut].arcs.length-1;thresholdIndex>=0;thresholdIndex--)
		{
			if($scope.EMS[indexOut].arcs[thresholdIndex].threshold<$scope.EMS[indexOut].speed)
			{
				$scope.EMS[indexOut]["backgroundColor"] = $scope.EMS[indexOut].arcs[thresholdIndex]["backgroundColor"];
				break;
			}
		}



	});




}).service('craftService', function () {
	let trafficSourceColors = {
		1: 'cornflowerblue', // ES
		2: '#FF8C00',      // UAT
		4: 'green',          // OGN
		5: '#0077be',         // AIS
		6: 'darkkhaki'     // UAT bar color
	}

	const getTrafficSourceColor = (source) => {
		if (trafficSourceColors[source] !== undefined) {
			return trafficSourceColors[source];
		} else {
			return 'gray';
		}
	}

	// THis ensures that the colors used in traffic.js and map.js for the vessels are the same
	let aircraftColors = {

		10: 'cornflowerblue',
		11: 'cornflowerblue',
		12: 'skyblue',
		13: 'skyblue',
		14: 'skyblue',

		20: 'darkorange',
		21: 'darkorange',
		22: 'orange',
		23: 'orange',
		24: 'orange',

		40: 'green',
		41: 'green',
		42: 'greenyellow',
		43: 'greenyellow',
		44: 'greenyellow'
	}

	const getAircraftColor = (aircraft) => {
		let code = aircraft.Last_source.toString() + aircraft.TargetType.toString();
		if (aircraftColors[code] === undefined) {
			return 'white';
		} else {
			return aircraftColors[code];
		}
	};

	const getVesselColor = (vessel) => {
		// https://www.navcen.uscg.gov/?pageName=AISMessagesAStatic
		firstDigit = Math.floor(vessel.SurfaceVehicleType / 10)
		secondDigit = vessel.SurfaceVehicleType - Math.floor(vessel.SurfaceVehicleType / 10) * 10;

		const categoryFirst = {
			2: 'orange',
			4: 'orange',
			5: 'orange',
			6: 'blue',
			7: 'green',
			8: 'red',
			9: 'red'
		};
		const categorySecond = {
			0: 'silver',
			1: 'cyan',
			2: 'darkblue',
			3: 'LightSkyBlue',
			4: 'LightSkyBlue',
			5: 'darkolivegreen',
			6: 'maroon',
			7: 'purple'
		};

		if (categoryFirst[firstDigit]) {
			return categoryFirst[firstDigit];
		} else if (firstDigit === 3 && categorySecond[secondDigit]) {
			return categorySecond[secondDigit];
		} else {
			return 'gray';
		}
	};

	const isTrafficAged = (aircraft, targetVar) => {
		const value = aircraft[targetVar];
		if (aircraft.TargetType === TARGET_TYPE_AIS) {
			return value > TRAFFIC_AIS_MAX_AGE_SECONDS;
		} else {
			return value > TRAFFIC_MAX_AGE_SECONDS;
		}
	};

	const getVesselCategory = (vessel) => {
		// https://www.navcen.uscg.gov/?pageName=AISMessagesAStatic
		firstDigit = Math.floor(vessel.SurfaceVehicleType / 10)
		secondDigit = vessel.SurfaceVehicleType - Math.floor(vessel.SurfaceVehicleType / 10) * 10;

		const categoryFirst = {
			2: 'Cargo',
			4: 'Cargo',
			5: 'Cargo',
			6: 'Passenger',
			7: 'Cargo',
			8: 'Tanker',
			9: 'Cargo',
		};
		const categorySecond = {
			0: 'Fishing',
			1: 'Tugs',
			2: 'Tugs',
			3: 'Dredging',
			4: 'Diving',
			5: 'Military',
			6: 'Sailing',
			7: 'Pleasure',
		};

		if (categoryFirst[firstDigit]) {
			return categoryFirst[firstDigit];
		} else if (firstDigit === 3 && categorySecond[secondDigit]) {
			return categorySecond[secondDigit];
		} else {
			return '---';
		}
	};

	const getAircraftCategory = (aircraft) => {
		const category = {
			1: 'Light',
			2: 'Small',
			3: 'Large',
			4: 'VLarge',
			5: 'Heavy',
			6: 'Fight',
			7: 'Helic',
			9: 'Glide',
			10: 'Ballo',
			11: 'Parac',
			12: 'Ultrl',
			14: 'Drone',
			15: 'Space',
			16: 'VLarge',
			17: 'Vehic',
			18: 'Vehic',
			19: 'Obstc'
		};
		return category[aircraft.Emitter_category] ? category[aircraft.Emitter_category] : '---';
	};

	return {
		getCategory: (craft) => {
			if (craft.TargetType === TARGET_TYPE_AIS) {
				return getVesselCategory(craft);
			} else {
				return getAircraftCategory(craft);
			}
		},

		getTrafficSourceColor: (source) => {
			return getTrafficSourceColor(source);
		},

		isTrafficAged: (craft) => {
			return isTrafficAged(craft, 'Age');
		},

		isTrafficAged2: (craft, targetVar) => {
			return isTrafficAged(craft, targetVar);
		},

		getTransportColor: (craft) => {
			if (craft.TargetType === TARGET_TYPE_AIS) {
				return getVesselColor(craft);
			} else {
				return getAircraftColor(craft);
			}
		}

	};

});


