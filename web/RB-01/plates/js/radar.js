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
 * 07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
 * 08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
*/
angular.module('appControllers').controller('RadarCtrl', RadarCtrl);           // get the main module contollers set
RadarCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval', '$timeout'];  // Inject my dependencies




const showTraces = 1;   // show traces of planes
const radarCutoff = 29;    // time in seconds how long a plane is displayed after last packet
var MaxAlarms = 5;        // number of times an alarm sound is played, if airplane enters AlarmRadius
var MaxSpeechAlarms = 1;  // number of times the aircraft is announced, MaxSpeedAlarms needs to be less than MaxAlarms

var minimalCircle = 25;  //minimal circle in pixel around center ist distance is very close
var posangle = Math.PI;  //global var for angle position of text

// Aircraft silhouette, shared by own ship and traffic (bound as ng-attr-d in radar.html).
// Its bounding box is 0.9,6.5 .. 63.1,57.6; the template uses it as the viewBox.
const RADAR_PLANE_PATH = 'm 32,6.5 0.5,0.9 0.4,1.4 5.3,0.1 -5.3,0.1 0.1,0.5 0.3,0.1 0.6,0.4 0.4,0.4 0.4,0.8 1.1,7.1 0.1,0.8 3.7,1.7 22.2,1.3 0.5,0.1 0.3,0.3 0.3,0.7 0.2,6 -0.1,0.1 -26.5,2.8 -0.3,0.1 -0.4,0.3 -0.3,0.5 -0.1,0.3 -0.9,6.3 -1.7,10.3 9.5,0 0.2,0.1 0.2,0.2 -0.1,4.6 -0.2,0.2 -8.8,0 -1.1,-2.4 -0.2,2.5 -0.3,2.5 -0.3,-2.5 -0.2,-2.5 -1.1,2.4 -8.8,0 -0.2,-0.2 -0.1,-4.6 0.2,-0.2 0.2,-0.1 9.5,0 -1.7,-10.3 -0.9,-6.3 -0.1,-0.3 -0.3,-0.5 -0.4,-0.3 -0.3,-0.1 -26.5,-2.8 -0.1,-0.1 0.2,-6 0.3,-0.7 0.3,-0.3 0.5,-0.1 22.2,-1.3 3.7,-1.7 0,-0.8 1.2,-7.1 0.4,-0.8 0.4,-0.4 0.6,-0.4 0.3,-0.1 0.1,-0.5 -5.3,-0.1 5.3,-0.1 0.4,-1.4 z';

// The radar box is 402 units wide, centred on the own ship: a position of v units is (201 + v) / 4.02 percent
function radarPct(v) {
	return ((201 + v) / 4.02).toFixed(2) + '%';
}
/*

//------------------   General Options ------------
var soundType = 3;  // speech  and sound output, 0=beep+speech (default) 1=Beep 2=Speech 3=Snd Off


// const showTraces = 0;   // do not show trace route  of planes



//-------------------------------------------------
var Lat;
var Long;

var GPSCourse = 0;
var OldGPSCourse = 0;  //old value

var GPSTime;  // general time variable for cutoff

var BaroAltitude;         // Barometric Altitude if availabe, else set to GPS Altitude, invalid is -100.000
var OldBaroAltitude = 0;  // Old Value

var $scope.DisplayRadius = 10;  // Radius in NM, below this radius targets are displayed
var $scope.OldDisplayRadius = 0;



var synth;          // global speechSynthesis variable

var AltDiffThreshold;         // in 100 feet display value
var OldAltDiffThreshold = 0;  // in 100 feet display value
*/

function RadarCtrl($rootScope, $scope, $state, $http, $interval, $timeout) {
	//  basics();
	$scope.data_list = [];
	$scope.data_list_invalid = [];
	$scope.planePath = RADAR_PLANE_PATH;
	// values bound by radar.html: card = rotation of the compass card, counter = upright labels, fl = FL text, spin = button animating
	$scope.Radar = { card: '0deg', counter: '0deg', fl: 0, spin: '', knob: 'range', knobShown: false };

	// the listeners are not called from a digest: apply, unless one is running
	function applyScope() {
		if (!$scope.$root.$$phase) $scope.$apply();
	}


	$scope.Lat = 0;
	$scope.Long = 0;

	$scope.GPSCourse = 0;
	$scope.OldGPSCourse = 0;  //old value

	$scope.GPSTime = 0;  // general time variable for cutoff

	$scope.BaroAltitude = 0;         // Barometric Altitude if availabe, else set to GPS Altitude, invalid is -100.000
	$scope.OldBaroAltitude = 0;  // Old Value
	$scope.DisplayRadius = 10;  // Radius in NM, below this radius targets are displayed
	$scope.OldDisplayRadius = 0;
	$scope.AltDiffThreshold = 20;  // in 100 feet display value
	$scope.OldAltDiffThreshold = 0;




	function utcTimeString(epoc) {
		var time = '';
		var val;
		var d = new Date(epoc);
		val = d.getUTCHours();
		time += (val < 10 ? '0' + val : '' + val);
		val = d.getUTCMinutes();
		time += ':' + (val < 10 ? '0' + val : '' + val);
		val = d.getUTCSeconds();
		time += ':' + (val < 10 ? '0' + val : '' + val);
		time += 'Z';
		return time;
	}

	function radiansRel(angle) {  //adopted from equations.go
		if (angle > 180) angle = angle - 360;
		if (angle <= -180) angle = angle + 360;
		return angle * Math.PI / 180;
	}

	$scope.radarUpdatedRequest = 0;

	function ownSituationUpdated(event) {

		if (($scope === undefined) || ($scope === null) || ($state.current.controller != 'RadarCtrl' && $scope.$parent.$parent.hasOwnProperty("radarSocket") == false )) {
			removeEventListener("SituationUpdated", ownSituationUpdated);
			return; // we are getting called once after clicking away from the status page
		}

		var now = Date.now();
		if (now - $scope.radarUpdatedRequest >= 1000) {
			$scope.radarUpdatedRequest = now;
		ownSituation(event.detail);
		}

	}

	// get situation data and turn radar
	function ownSituation(situation) {

		// consider using angular.extend()
		$scope.raw_data = situation;
		$scope.GPSTime = Date.parse(situation.GPSTime);       //set global time variable
		$scope.Lat = situation.GPSLatitude;
		$scope.Long = situation.GPSLongitude;
		$scope.GPSCourse = situation.GPSTrueCourse;
		var press_time = Date.parse(situation.BaroLastMeasurementTime);
		var gps_time = Date.parse(situation.GPSLastGPSTimeStratuxTime);
		if (gps_time - press_time < 1000) {  //pressure is ok
			$scope.BaroAltitude = Math.round(situation.BaroPressureAltitude.toFixed(0));
			if (situation.BaroSourceType != 4) {   //not estimated, but from valid source 
				$scope.BaroAltValid = 'Baro';
			} else {				// adsb estimated
				$scope.BaroAltValid = 'AdsbEstimated';
			}
		} else {
			var gps_horizontal_accuracy = situation.GPSHorizontalAccuracy.toFixed(1);
			if (gps_horizontal_accuracy > 19999) {  //no valid gps signal
				$scope.BaroAltValid = 'Invalid';
				$scope.BaroAltitude = -100000;  // marks invalid value
			} else {
				if (situation.BaroSourceType == 4) {   //no pressure, but ADSB estimated
					$scope.BaroAltValid = 'AdsbEstimated';
					$scope.BaroAltitude = Math.round(situation.BaroPressureAltitude.toFixed(0));
				} else {
					$scope.BaroAltValid = 'GPS';
					$scope.BaroAltitude = situation.GPSAltitudeMSL.toFixed(1);
				}
			}
		}
		var gps_horizontal_accuracy = situation.GPSHorizontalAccuracy.toFixed(1);
		if (gps_horizontal_accuracy > 19999) {  //no valid gps signal
			$scope.GPSValid = 'Invalid';
		} else {
			$scope.GPSValid = 'Valid';
		}
		radarRefresh($scope);
		applyScope();
	}

	// refresh of the bound values: the texts and the card are bound in radar.html, only the traces need a reset
	function radarRefresh($scope) {
		$scope.OldBaroAltitude = $scope.BaroAltitude;
		$scope.Radar.fl = Math.round($scope.BaroAltitude / 100);
		if ($scope.AltDiffThreshold !== $scope.OldAltDiffThreshold) {
			clearRadarTraces($scope);
			$scope.OldAltDiffThreshold = $scope.AltDiffThreshold;
		}
		if ($scope.DisplayRadius !== $scope.OldDisplayRadius) {
			clearRadarTraces($scope);
			$scope.OldDisplayRadius = $scope.DisplayRadius;
		}
		$scope.OldGPSCourse = $scope.GPSCourse;
		$scope.Radar.card = (-$scope.GPSCourse) + 'deg';  // the card turns opposite to the course
		$scope.Radar.counter = $scope.GPSCourse + 'deg';  // the labels turn back to stay upright
	}

	// press animation of the four buttons
	function spinButton(name, ms) {
		$scope.Radar.spin = name;
		$timeout(function () { if ($scope.Radar.spin == name) $scope.Radar.spin = ''; }, ms);
	}

	$scope.radarZoomIn = function () {  // Ra-
		var newval = $scope.DisplayRadius;
		var animateTime = 400;
		switch ($scope.DisplayRadius) {
			case 40: newval = 20; break;
			case 20: newval = 10; break;
			case 10: newval = 5; break;
			case 5: newval = 2; break;
			default: animateTime = 0;  // keep 2
		}
		communicateLimits(100 * $scope.AltDiffThreshold, newval, $http, $scope);
		radarRefresh($scope);
		if (animateTime) spinButton('zoomin', animateTime);
	};

	$scope.radarZoomOut = function () {  // Ra+
		var newval = $scope.DisplayRadius;
		var animateTime = 400;
		switch ($scope.DisplayRadius) {
			case 2: newval = 5; break;
			case 5: newval = 10; break;
			case 10: newval = 20; break;
			case 20: newval = 40; break;
			default: animateTime = 0;  // keep 40
		}
		communicateLimits(100 * $scope.AltDiffThreshold, newval, $http, $scope);
		radarRefresh($scope);
		if (animateTime) spinButton('zoomout', animateTime);
	};

	$scope.radarAltMore = function () {  // Alt+
		var newval = $scope.AltDiffThreshold;
		var animateTime = 400;
		switch ($scope.AltDiffThreshold) {
			case 5: newval = 10; break;
			case 10: newval = 20; break;
			case 20: newval = 50; break;
			case 50: newval = 100; break;
			case 100: newval = 500; break;
			default: animateTime = 0;
		}
		communicateLimits(100 * newval, $scope.DisplayRadius, $http, $scope);
		radarRefresh($scope);
		if (animateTime) spinButton('altmore', animateTime);
	};

	$scope.radarAltLess = function () {  // Alt-
		var newval = $scope.AltDiffThreshold;
		var animateTime = 400;
		switch ($scope.AltDiffThreshold) {
			case 500: newval = 100; break;
			case 100: newval = 50; break;
			case 50: newval = 20; break;
			case 20: newval = 10; break;
			case 10: newval = 5; break;
			default: animateTime = 0;  //5 stays 5
		}
		communicateLimits(100 * newval, $scope.DisplayRadius, $http, $scope);
		radarRefresh($scope);
		if (animateTime) spinButton('altless', animateTime);
	};
	/*
		function speaktraffic(altitudeDiff, direction) {
			if ((soundType == 0) || (soundType == 2)) {
				var feet = altitudeDiff * 100;
				var sign = 'plus';
				if (altitudeDiff < 0) sign = 'minus';
				var txt = 'Traffic ';
				if (direction) txt += direction + ' o\'clock ';
				txt += sign + ' ' + Math.abs(feet) + ' feet';
				var utterOn = new SpeechSynthesisUtterance(txt);
				utterOn.lang = 'en-US';
				utterOn.rate = 1.1;
				synth.speak(utterOn);
			}
		}
	*/
	function checkCollisionVector(traffic, $scope) {
		var altDiff;                                                  //difference of altitude to my altitude
		var altDiffValid = 3;                                         // 1 = valid difference 2 = absolute height 3 = u/s
		var distcirc = traffic.distance_estimated / 1852.0;
		var distx = Math.round(200 / $scope.DisplayRadius * distcirc);       // x position for circle
		var ctxt;

		traffic.circleShown = false;  // hide the ring, it is shown again below if the target is still relevant
		//console.log("Mode S %d traffic. Distance %f nm Distx %d \n", traffic.icao_int, distcirc, distx);
		if (distx < minimalCircle) distx = minimalCircle;
		if ($scope.BaroAltitude > -100000) {  // valid BaroAlt or valid GPSAlt
			altDiff = Math.round((traffic.altitude - $scope.BaroAltitude) / 100);
			altDiffValid = 1;
		} else {
			altDiffValid = 2;  //altDiff is absolute height
		}
		if (traffic.altitude == 0) altDiffValid = 3;  //set height to unspecified, nothing displayed for now
		if (distx <= 200) {
			if (((altDiffValid == 1) && (Math.abs(altDiff) <= $scope.AltDiffThreshold)) || (altDiffValid == 2)) {
				if (distcirc <= ($scope.DisplayRadius / 2)) {
					if (!traffic.alarms) traffic.alarms = 0;
					if ((traffic.alarms < MaxSpeechAlarms) && (altDiffValid == 1)) {
						//speaktraffic(altDiff, null);
					}
					if ((traffic.alarms < MaxAlarms) /*&& ((soundType == 0) || (soundType == 1))*/) {
						//sound_alert.play();  // play alarmtone max times
					}
					traffic.alarms = traffic.alarms + 1;
				} else {
					if (distcirc >= ($scope.DisplayRadius * 0.75)) {  // implement hysteresis, play tone again only if 3/4 of $scope.DisplayRadius outside
						traffic.alarms = 0;                // reset alarm counter, to play again
					}
				}
				if (!traffic.posangle) {  //not yet with position for text
					traffic.posangle = posangle;
					posangle = posangle + 3 * Math.PI / 16;
					if (posangle > (2 * Math.PI)) posangle = Math.PI;  // make sure only upper half is used
				}
				if (altDiffValid == 1) {
					var vorzeichen = '+';
					if (altDiff < 0) vorzeichen = '-';
					var pfeil = '';
					if (traffic.vspeed > 0) pfeil = '\u2191';
					if (traffic.vspeed < 0) pfeil = '\u2193';
					var ctxt = vorzeichen + Math.abs(altDiff) + pfeil;
				} else if (altDiffValid == 2) {
					ctxt = traffic.altitude;
				} else {
					ctxt = 'u/s';
				}
				var dx = Math.round(distx * Math.cos(traffic.posangle));
				var dy = Math.round(distx * Math.sin(traffic.posangle));
				traffic.circleSize = (distx * 2 / 4.02).toFixed(2) + '%';
				traffic.labelX = radarPct(dx);
				traffic.labelY = radarPct(dy);
				traffic.altText = ctxt;
				traffic.circleShown = true;
			}
		}
	}

	function checkCollisionVectorValid(traffic, $scope) {
		var radius_earth = 6371008.8;  // in meters
		//simplified from equations.go
		var avgLat, distanceLat, distanceLng;

		traffic.shown = false;  // hide the plane + texts, shown again below if still in range (the trace stays)
		var altDiff;                   //difference of altitude to my altitude
		if ($scope.BaroAltitude > -100000) {  // valid BaroAlt or valid GPSAlt
			altDiff = Math.round((traffic.altitude - $scope.BaroAltitude) / 100);
		} else {
			altDiff = traffic.altitude;  //take absolute altitude
		}
		if (Math.abs(altDiff) > $scope.AltDiffThreshold) {
			return;  //finished
		}

		avgLat = radiansRel(($scope.Lat + traffic.lat) / 2);
		distanceLat = (radiansRel(traffic.lat - $scope.Lat) * radius_earth) / 1852;
		distanceLng = ((radiansRel(traffic.lon - $scope.Long) * radius_earth) / 1852) * Math.abs(Math.cos(avgLat));

		var distx = Math.round(200 / $scope.DisplayRadius * distanceLng);
		var disty = -Math.round(200 / $scope.DisplayRadius * distanceLat);
		var distradius = Math.sqrt((distanceLat * distanceLat) + (distanceLng * distanceLng));  // pythagoras
		//console.log("Alt %f Long %f Lat %f DistanceLong %f DistLat %f Heading %f dx %d dy %d\n", traffic.altitude, traffic.lon, traffic.lat, distanceLat, distanceLng, traffic.heading, distx, disty);
		if (distradius <= $scope.DisplayRadius) {
			if (distradius <= ($scope.DisplayRadius / 2)) {
				if (!traffic.alarms) traffic.alarms = 0;
				if (/*((soundType == 0) || (soundType == 2)) &&*/ (traffic.alarms < MaxSpeechAlarms)) {
					var alpha = 0;
					if (disty >= 0) {
						alpha = Math.PI - Math.atan(distx / disty);
					} else {
						alpha = -Math.atan(distx / disty);
					}
					alpha = alpha * 360 / (2 * Math.PI);  // convert to angle
					alpha = alpha - $scope.GPSCourse;            // substract own GPSCourse
					if (alpha < 0) alpha += 360;
					var oclock = Math.round(alpha / 30);
					if (oclock <= 0) oclock += 12;
					//console.log("Distx %d Disty %d GPSCourse %f alpha-Course %f oclock %f\n", distx, disty, GPSCourse, alpha, oclock);
					//speaktraffic(altDiff, oclock);
				}
				if ((traffic.alarms < MaxAlarms) /*&& ((soundType == 0) || (soundType == 1))*/) {
					// sound_alert.play();  // play alarmtone max times
				}
				traffic.alarms = traffic.alarms + 1;
			} else {
				traffic.alarms = 0;  // reset counter ones outside alarm circle
			}
			var heading = 0;
			if (traffic.heading != '---') heading = traffic.heading;  //sometimes heading is missing, then set to zero

			var vorzeichen = '+';
			if (altDiff < 0) vorzeichen = '-';
			var pfeil = '';
			if (traffic.vspeed > 0) pfeil = '\u2191';
			if (traffic.vspeed < 0) pfeil = '\u2193';
			traffic.x = radarPct(distx);
			traffic.y = radarPct(disty);
			traffic.headingDeg = heading + 'deg';
			traffic.altText = vorzeichen + Math.abs(altDiff) + pfeil;
			traffic.speedText = traffic.nspeed + 'kts';
			traffic.shown = true;
			if (showTraces) {
				if (!traffic.tracePoints) {
					traffic.tracePoints = distx + ',' + disty;
				} else {
					traffic.tracePoints += ' ' + distx + ',' + disty;
				}
			}
		} else {                      // if airplane is outside of radarscreen
			traffic.tracePoints = '';  //remove trace when aircraft gets out of range
			traffic.alarms = 0;  //reset alarm counter
		}
	}

	function setAircraft(obj, new_traffic) {
		new_traffic.icao_int = obj.Icao_addr;
		new_traffic.targettype = obj.TargetType;
		var timestamp = Date.parse(obj.Timestamp);
		var timeLack = -1;
		if (new_traffic.timeVal > 0 && timestamp) {
			timeLack = timestamp - new_traffic.timeVal;
		}
		new_traffic.timeVal = timestamp;
		new_traffic.time = utcTimeString(timestamp);
		new_traffic.signal = obj.SignalLevel;
		new_traffic.distance_estimated = obj.DistanceEstimated;

		new_traffic.lat = obj.Lat;
		new_traffic.lon = obj.Lng;
		var n = Math.round(obj.Alt / 25) * 25;
		new_traffic.altitude = n;

		if (obj.Speed_valid) {
			new_traffic.nspeed = Math.round(obj.Speed / 5) * 5;
			new_traffic.heading = Math.round(obj.Track / 5) * 5;
		} else {
			new_traffic.nspeed = '-';
			new_traffic.heading = '---';
		}
		new_traffic.vspeed = Math.round(obj.Vvel / 100) * 100


		new_traffic.Last_seen = Date.parse(obj.Last_seen);
		new_traffic.Last_alt = Date.parse(obj.Last_alt);
		new_traffic.dist = (obj.Distance / 1852);
		new_traffic.tail = obj.Tail;  //registration No
	}

	function onMessageNew(msg) {
		if (($scope === undefined) || ($scope === null) || ($state.current.controller != 'RadarCtrl' && $scope.$parent.$parent.hasOwnProperty("radarSocket") == false )) {
			removeEventListener("RadarChanged", onMessageNew);
			return; // we are getting called once after clicking away from the status page
		}
		var message = msg.detail;
		if ('RadarLimits' in message || 'RadarRange' in message) {
			onSettingsMessage(message, $scope);
			radarRefresh($scope);
			applyScope();
			return;
		}

		// we need to use an array so AngularJS can perform sorting; it also means we need to loop to find an aircraft in the traffic set
		// only aircraft in possible display position are stored
		var validIdx = -1;
		var invalidIdx = -1;
		var altDiffValid = false;
		var altDiff;
		if (($scope.BaroAltitude > -100000) && (message.Alt > 0)) {  // valid BaroAlt or valid GPSAlt and valid altitude
			altDiff = Math.round((message.Alt - $scope.BaroAltitude) / 100);
			altDiffValid = true;
		}
		for (var i = 0, len = $scope.data_list.length; i < len; i++) {
			if ($scope.data_list[i].icao_int === message.Icao_addr) {
				setAircraft(message, $scope.data_list[i]);
				if (message.Position_valid) checkCollisionVectorValid($scope.data_list[i], $scope);
				validIdx = i;
				break;  // break in anycase, if once found
			}
		}

		if (validIdx < 0) {  // not yet found
			for (var i = 0, len = $scope.data_list_invalid.length; i < len; i++) {
				if ($scope.data_list_invalid[i].icao_int === message.Icao_addr) {
					setAircraft(message, $scope.data_list_invalid[i]);
					if (!message.Position_valid) checkCollisionVector($scope.data_list_invalid[i], $scope);
					//console.log($scope.data_list_invalid[i]);
					invalidIdx = i;
					break;
				}
			}
		}
		var new_traffic = {};

		if ((validIdx < 0) && (message.Position_valid)) {  //new aircraft with valid position
			if (altDiffValid && (Math.abs(altDiff) <= $scope.AltDiffThreshold)) {
				// optimization: only store ADSB aircraft if inside altDiff
				setAircraft(message, new_traffic);
				checkCollisionVectorValid(new_traffic, $scope);
				$scope.data_list.unshift(new_traffic);  // add to start of valid array.
			}                                               // else not added in list, since not relevant
		}

		if ((invalidIdx < 0) && (!message.Position_valid)) {  // new aircraft without position
			if (altDiffValid && (Math.abs(altDiff) <= $scope.AltDiffThreshold)) {
				setAircraft(message, new_traffic);
				checkCollisionVector(new_traffic, $scope);
				$scope.data_list_invalid.unshift(new_traffic);  // add to start of invalid array.
			}                                                       // else not added in list, since not relevant
		}

		// Handle the negative cases of those above - where an aircraft moves from "valid" to "invalid" or vice-versa.
		if ((validIdx >= 0) && !message.Position_valid) {
			// Position is not valid any more or outside Threshold. Remove from "valid" table.
			$scope.data_list.splice(validIdx, 1);
		}

		if ((invalidIdx >= 0) && message.Position_valid) {  //known invalid aircraft now with valid position
			// Position is now valid. Remove from "invalid" table.
			delete $scope.data_list_invalid[invalidIdx].posangle;  //make sure angle is not used again
			$scope.data_list_invalid.splice(invalidIdx, 1);
		}

		applyScope();
	}


	function statusUpdated(event) {
		if (($scope === undefined) || ($scope === null) || ($state.current.controller != 'RadarCtrl' && $scope.$parent.$parent.hasOwnProperty("radarSocket") == false )) {
			removeEventListener("RadarChanged", onMessageNew);
			return; // we are getting called once after clicking away from the status page
		}
		var globalStatus = event.detail;

		var tempUptimeClock = new Date(Date.parse(globalStatus.UptimeClock));
		var uptimeClockString = tempUptimeClock.toUTCString();
		$scope.UptimeClock = uptimeClockString;
		$scope.StratuxClock = Date.parse(globalStatus.UptimeClock);

		var tempLocalClock = new Date;
		$scope.LocalClock = tempLocalClock.toUTCString();

		$scope.GPS_connected = globalStatus.GPS_connected;
		var boardtemp = globalStatus.CPUTemp;
		if (boardtemp != undefined) {
			$scope.CPUTemp = boardtemp.toFixed(1);
		}
		radarRefresh($scope);
		applyScope();
	}




	// perform cleanup every 10 seconds
	var clearStaleTraffic = $interval(function () {
		// remove stale aircraft = anything more than x seconds without a position update

		var cutTime = $scope.StratuxClock - radarCutoff * 1000;

		// Clean up "valid position" table.
		for (var i = $scope.data_list.length; i > 0; i--) {
			if ($scope.data_list[i - 1].Last_seen <= cutTime) {
				$scope.data_list.splice(i - 1, 1);
			}
		}

		// Clean up "invalid position" table.
		for (var i = $scope.data_list_invalid.length; i > 0; i--) {
			if ($scope.data_list_invalid[i - 1].Last_seen <= cutTime) {
				$scope.data_list_invalid.splice(i - 1, 1);
			}
		}
		radarRefresh($scope);
		applyScope();
	}, (1000 * 10), 0, false);


	$state.get('radar').onEnter = function () {
		$scope.data_list = [];
		$scope.data_list_invalid = [];
		//reset OldRotatingValue
		$scope.OldGPSCourse = 0;
		$scope.OldBaroAltitude = 0;
		$scope.OldAltDiffThreshold = 0;
		$scope.OldDisplayRadius = 0;
		// everything gets handled correctly by the controller
	};

	$state.get('radar').onExit = function () {
		removeEventListener("SituationUpdated", ownSituationUpdated);
		removeEventListener("StatusUpdated", statusUpdated);
		removeEventListener("RadarChanged", onMessageNew);



		// disconnect from the socket
		//console.log("OnExit\n");
		/*
		if (($scope.rsocket !== undefined) && ($scope.rsocket !== null)) {
			//console.log("Closing rsocket\n");
			$scope.rsocket.close();
			$scope.rsocket = null;
		}
		if (($scope.sit_socket !== undefined) && ($scope.sit_socket !== null)) {
			//console.log("Closing sit_socket\n");
			$scope.sit_socket.close();
			$scope.sit_socket = null;
		}
			*/
		// stop stale traffic cleanup
		$interval.cancel(clearStaleTraffic);
		//$interval.cancel(getClock);
	};

	$scope.locationId = 'radar_display' + (Date.now());

	// index.html calls init({isSidebar: true}) on the copy in the right sidebar; radar.html
	// calls init() again on both copies, which must not undo it
	$scope.isSidebar = false;
	$scope.init = function (params) {
		if (params && params.isSidebar) {
			$scope.isSidebar = true;
		}
		console.log("Init Radar loaded: " + $scope.locationId);
	}

	// The knob turns one of the two filters: the range (PREV = Ra-, NEXT = Ra+, 2 to 40 NM) or the
	// altitude band (PREV = Alt-, NEXT = Alt+, 500 to 50000 ft). TAP switches between them; the
	// label it turns is outlined from the first knob key on. Every entry starts on the range. The
	// routed plate only: the sidebar copy must not move with it (docs/tech-debt/keypad-page-navigation.md)
	function keypadEventListener(event) {
		if ($scope.isSidebar || $state.current.name != 'radar') {
			return;
		}
		var alt = $scope.Radar.knob == 'alt';
		var turn = null;
		if (event.key == KEYPAD_MAPPING_PREV) turn = alt ? $scope.radarAltLess : $scope.radarZoomIn;
		if (event.key == KEYPAD_MAPPING_NEXT) turn = alt ? $scope.radarAltMore : $scope.radarZoomOut;
		if (event.key == KEYPAD_MAPPING_TAP) {
			turn = function () { $scope.Radar.knob = alt ? 'range' : 'alt'; };
		}
		if (turn !== null) {
			$scope.$apply(function () {
				$scope.Radar.knobShown = true;
				turn();
			});
		}
	}
	addEventListener("keypad", keypadEventListener);
	$scope.$on('$destroy', function () {
		removeEventListener("keypad", keypadEventListener);
	});

	$scope.$on('$includeContentLoaded', function (event, tempalteUrl) {
		console.log("DOM Radar loaded: " + $scope.locationId);
	});


	// Radar Controller tasks
	//connect($scope);  // connect - opens a socket and listens for messages
	addEventListener("SituationUpdated", ownSituationUpdated);
	addEventListener("StatusUpdated", statusUpdated);
	addEventListener("RadarChanged", onMessageNew);

}

function clearRadarTraces($scope) {
	for (var i = $scope.data_list.length; i > 0; i--) {
		var t = $scope.data_list[i - 1];
		t.shown = false;       // hide plane + texts until the next packet
		t.alarms = 0;          //reset alarm counter
		t.tracePoints = '';
	}
	for (var i = $scope.data_list_invalid.length; i > 0; i--) {  //clear circles
		$scope.data_list_invalid[i - 1].circleShown = false;
	}
}

function communicateLimits(threshold, radarrange, $http, $scope) {  //tell raspi the limits for callback
	$scope.AltDiffThreshold = threshold / 100;
	$scope.DisplayRadius = radarrange;
	var newsettings = {
		'RadarLimits': threshold,
		'RadarRange': radarrange
	};
	msg = angular.toJson(newsettings);
	// Simple POST request example (note: response is asynchronous)
	$http.post(URL_SETTINGS_SET, msg).then(function (response) {
		// do nothing
	}, function (response) {
		// do nothing
	});
}

function onSettingsMessage(message, $scope) {
	$scope.AltDiffThreshold = message.RadarLimits / 100;
	$scope.DisplayRadius = message.RadarRange;
}
