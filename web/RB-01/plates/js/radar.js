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
angular.module('appControllers').controller('RadarCtrl', RadarCtrl);           // get the main module contollers set
RadarCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];  // Inject my dependencies




const showTraces = 1;   // show traces of planes
const radarCutoff = 29;    // time in seconds how long a plane is displayed after last packet
var MaxAlarms = 5;        // number of times an alarm sound is played, if airplane enters AlarmRadius
var MaxSpeechAlarms = 1;  // number of times the aircraft is announced, MaxSpeedAlarms needs to be less than MaxAlarms

var minimalCircle = 25;  //minimal circle in pixel around center ist distance is very close
var radar;               // global RadarRenderer
var posangle = Math.PI;  //global var for angle position of text
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
//var sound_alert = new Audio('alert.wav');

function RadarCtrl($rootScope, $scope, $state, $http, $interval) {
	//  basics();
	$scope.data_list = [];
	$scope.data_list_invalid = [];
	$scope.radar = null;


	$scope.Lat = 0;
	$scope.Long = 0;

	$scope.GPSCourse = 0;
	$scope.OldGPSCourse = 0;  //old value

	$scope.GPSTime = 0;  // general time variable for cutoff

	$scope.BaroAltitude = 0;         // Barometric Altitude if availabe, else set to GPS Altitude, invalid is -100.000
	$scope.OldBaroAltitude = 0;  // Old Value
	$scope.DisplayRadius = 10;  // Radius in NM, below this radius targets are displayed
	$scope.OldDisplayRadius = 0;




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

	function ownSituationUpdated(event) {

		if (($scope === undefined) || ($scope === null) || ($state.current.controller != 'RadarCtrl' && $scope.$parent.$parent.hasOwnProperty("radarSocket") == false )) {
			removeEventListener("SituationUpdated", ownSituationUpdated);
			return; // we are getting called once after clicking away from the status page
		}

		ownSituation(event.detail);
		if ($scope.radar) $scope.radar.update($scope);
	}

	// get situation data and turn radar
	function ownSituation(situation) {

		if ($scope.radar == null || $scope.radar.canvas == null) {
			$scope.radar = new RadarRenderer($scope.locationId, $scope, $http);
		}

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
		$scope.$apply();
	}
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
		var doUpdate = 0;                                             //1 if update has to be done;
		var altDiff;                                                  //difference of altitude to my altitude
		var altDiffValid = 3;                                         // 1 = valid difference 2 = absolute height 3 = u/s
		var distcirc = traffic.distance_estimated / 1852.0;
		var distx = Math.round(200 / $scope.DisplayRadius * distcirc);       // x position for circle
		var ctxt;

		if (traffic.circ) {                      //delete circle + Text
			traffic.circ.remove().forget();  // undisplay elements and clear children
			doUpdate = 1;
		}
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
				doUpdate = 1;
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
				traffic.circ = $scope.radar.allScreen.group();  //not rotated
				var circle = $scope.radar.allScreen.circle(distx * 2).cx(0).cy(0).addClass('greenCirc');
				traffic.circ.add(circle);
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
				var outtext = $scope.radar.allScreen.text(ctxt).addClass('textCOut').center(dx, dy);  //Outline
				traffic.circ.add(outtext);
				var tratext = $scope.radar.allScreen.text(ctxt).addClass('textCirc').center(dx, dy);
				traffic.circ.add(tratext);
				var tailout = $scope.radar.allScreen.text(traffic.tail).addClass('textRegOut').center(dx, dy + 18);
				traffic.circ.add(tailout);
				var tailtext = $scope.radar.allScreen.text(traffic.tail).addClass('textCircReg').center(dx, dy + 18);
				traffic.circ.add(tailtext);
			}
		}
		if (doUpdate == 1) $scope.radar.update($scope);
	}

	function checkCollisionVectorValid(traffic, $scope) {
		var radius_earth = 6371008.8;  // in meters
		//simplified from equations.go
		var avgLat, distanceLat, distanceLng;
		var doUpdate = 0;

		if (traffic.planeimg) {  //delete Images + Text
			traffic.planeimg.remove().forget();
			traffic.planetext.remove().forget();
			traffic.planetextOut.remove().forget();
			traffic.planespeed.remove().forget();
			traffic.planetail.remove().forget();
			// do not remove radar-trace
			doUpdate = 1;
		}
		var altDiff;                   //difference of altitude to my altitude
		if ($scope.BaroAltitude > -100000) {  // valid BaroAlt or valid GPSAlt
			altDiff = Math.round((traffic.altitude - $scope.BaroAltitude) / 100);
		} else {
			altDiff = traffic.altitude;  //take absolute altitude
		}
		if (Math.abs(altDiff) > $scope.AltDiffThreshold) {
			if (doUpdate == 1) $scope.radar.update($scope);
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
			doUpdate = 1;
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

			traffic.planeimg = $scope.radar.rScreen.group();
			traffic.planeimg.path('m 32,6.5 0.5,0.9 0.4,1.4 5.3,0.1 -5.3,0.1 0.1,0.5 0.3,0.1 0.6,0.4 0.4,0.4 0.4,0.8 1.1,7.1 0.1,0.8 3.7,1.7 22.2,1.3 0.5,0.1 0.3,0.3 0.3,0.7 0.2,6 -0.1,0.1 -26.5,2.8 -0.3,0.1 -0.4,0.3 -0.3,0.5 -0.1,0.3 -0.9,6.3 -1.7,10.3 9.5,0 0.2,0.1 0.2,0.2 -0.1,4.6 -0.2,0.2 -8.8,0 -1.1,-2.4 -0.2,2.5 -0.3,2.5 -0.3,-2.5 -0.2,-2.5 -1.1,2.4 -8.8,0 -0.2,-0.2 -0.1,-4.6 0.2,-0.2 0.2,-0.1 9.5,0 -1.7,-10.3 -0.9,-6.3 -0.1,-0.3 -0.3,-0.5 -0.4,-0.3 -0.3,-0.1 -26.5,-2.8 -0.1,-0.1 0.2,-6 0.3,-0.7 0.3,-0.3 0.5,-0.1 22.2,-1.3 3.7,-1.7 0,-0.8 1.2,-7.1 0.4,-0.8 0.4,-0.4 0.6,-0.4 0.3,-0.1 0.1,-0.5 -5.3,-0.1 5.3,-0.1 0.4,-1.4 z')
				.addClass('plane')
				.size(30, 30)
				.center(distx, disty + 3);
			traffic.planeimg.circle(2).center(distx, disty).addClass('planeRotationPoint');
			traffic.planeimg.rotate(heading, distx, disty);

			var vorzeichen = '+';
			if (altDiff < 0) vorzeichen = '-';
			var pfeil = '';
			if (traffic.vspeed > 0) pfeil = '\u2191';
			if (traffic.vspeed < 0) pfeil = '\u2193';
			traffic.planetextOut = $scope.radar.rScreen.text(vorzeichen + Math.abs(altDiff) + pfeil).move(distx + 17, disty - 10).rotate($scope.GPSCourse, distx, disty).addClass('textPlaneOut');
			traffic.planetext = $scope.radar.rScreen.text(vorzeichen + Math.abs(altDiff) + pfeil).move(distx + 17, disty - 10).rotate($scope.GPSCourse, distx, disty).addClass('textPlane');
			traffic.planespeed = $scope.radar.rScreen.text(traffic.nspeed + 'kts').move(distx + 17, disty).rotate($scope.GPSCourse, distx, disty).addClass('textPlaneSmall');
			traffic.planetail = $scope.radar.rScreen.text(traffic.tail).move(distx + 17, disty + 10).rotate($scope.GPSCourse, distx, disty).addClass('textPlaneReg');
			if (showTraces) {
				if (!traffic.trace) {
					traffic.trace = $scope.radar.rScreen.polyline([[distx, disty]]).addClass('trace');
				} else {
					var points = traffic.trace.attr('points');
					points += ' ' + [distx, disty];
					traffic.trace.attr('points', points);
				}
			}
		} else {                      // if airplane is outside of radarscreen
			if (traffic.trace) {  //remove trace when aircraft gets out of range
				traffic.trace.remove().forget();
				traffic.trace = '';
				doUpdate = 1;
			}
			traffic.alarms = 0;  //reset alarm counter
		}
		if (doUpdate == 1 && $scope.radar) $scope.radar.update($scope);  // only necessary if changes were done
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
			return;
		}

		if ($scope.radar == null || $scope.radar.canvas == null) {
			$scope.radar = new RadarRenderer($scope.locationId, $scope, $http);
		}


		//$scope.raw_data = angular.toJson(msg.data, true);
		if ($scope.radar == null || $scope.radar.canvas == null) {
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
			if ($scope.data_list[validIdx].planeimg) {
				$scope.data_list[validIdx].planeimg.remove().forget();    // remove plane image
				$scope.data_list[validIdx].planetext.remove().forget();   // remove plane image
				$scope.data_list[validIdx].planetextOut.remove().forget();   // remove plane image
				$scope.data_list[validIdx].planespeed.remove().forget();  // remove plane image
				$scope.data_list[validIdx].planetail.remove().forget();   // remove plane image
				if ($scope.data_list[validIdx].trace) {
					$scope.data_list[validIdx].trace.remove().forget();  // remove plane image
					$scope.data_list[validIdx].trace = '';
				}
			}
			$scope.data_list.splice(validIdx, 1);
		}

		if ((invalidIdx >= 0) && message.Position_valid) {  //known invalid aircraft now with valid position
			// Position is now valid. Remove from "invalid" table.
			if ($scope.data_list_invalid[invalidIdx].circ) {  //delete circle + Text
				$scope.data_list_invalid[invalidIdx].circ.remove().forget();
				delete $scope.data_list_invalid[invalidIdx].posangle;  //make sure angle is not used again
			}
			$scope.data_list_invalid.splice(invalidIdx, 1);
		}

		$scope.$apply();
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
		if ($scope.radar) $scope.radar.update($scope);
	}




	// perform cleanup every 10 seconds
	var clearStaleTraffic = $interval(function () {
		// remove stale aircraft = anything more than x seconds without a position update

		var cutTime = $scope.StratuxClock - radarCutoff * 1000;

		// Clean up "valid position" table.
		for (var i = $scope.data_list.length; i > 0; i--) {
			if ($scope.data_list[i - 1].Last_seen <= cutTime) {
				if ($scope.data_list[i - 1].planeimg) {
					$scope.data_list[i - 1].planeimg.remove().forget();    // remove plane image
					$scope.data_list[i - 1].planetext.remove().forget();   // remove plane image
					$scope.data_list[i - 1].planetextOut.remove().forget();   // remove plane image
					$scope.data_list[i - 1].planespeed.remove().forget();  // remove plane image
					$scope.data_list[i - 1].planetail.remove().forget();   // remove plane image
					if ($scope.data_list[i - 1].trace) {
						$scope.data_list[i - 1].trace.remove().forget();  // remove plane image
						$scope.data_list[i - 1].trace = '';
					}
				}
				$scope.data_list.splice(i - 1, 1);
			}
		}

		// Clean up "invalid position" table.
		for (var i = $scope.data_list_invalid.length; i > 0; i--) {
			if ($scope.data_list_invalid[i - 1].Last_seen <= cutTime) {
				if ($scope.data_list_invalid[i - 1].circ) {  // is displayed
					$scope.data_list_invalid[i - 1].circ.remove().forget();
				}
				$scope.data_list_invalid.splice(i - 1, 1);
			}
		}
		if ($scope.radar) $scope.radar.update($scope);
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

	$scope.init = function () {
		console.log("Init Radar loaded: " + $scope.locationId);
	}

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
		if ($scope.data_list[i - 1].planeimg) {
			$scope.data_list[i - 1].planeimg.remove().forget();    // remove plane image
			$scope.data_list[i - 1].planetext.remove().forget();   // remove plane image
			$scope.data_list[i - 1].planetextOut.remove().forget();   // remove plane image
			$scope.data_list[i - 1].planespeed.remove().forget();  // remove plane image
			$scope.data_list[i - 1].planetail.remove().forget();   // remove plane image
			$scope.data_list[i - 1].alarms = 0;                    //reset alarm counter
			if ($scope.data_list[i - 1].trace) {
				$scope.data_list[i - 1].trace.remove().forget();  // remove plane image
				$scope.data_list[i - 1].trace = '';
			}
		}
	}
	for (var i = $scope.data_list_invalid.length; i > 0; i--) {  //clear circles
		if ($scope.data_list_invalid[i - 1].circ) {          // is displayed
			$scope.data_list_invalid[i - 1].circ.remove().forget();
		}
	}
}



function displaySoundStatus(speech, soundMode) {
	switch (soundMode) {
		case 0:
			if (synth) {
				var utterOn = new SpeechSynthesisUtterance('Beep and Speech on');
				utterOn.lang = 'en-US';
				synth.speak(utterOn);
			}
			speech.get(0).removeClass('zoom').addClass('zoomInvert');
			speech.get(1).removeClass('tSmall').addClass('tSmallInvert').text('BpSp').cx(16).cy(0);
			break;
		case 1:
			if (synth) {
				var utterOn = new SpeechSynthesisUtterance('Beep only');
				utterOn.lang = 'en-US';
				synth.speak(utterOn);
			}
			speech.get(0).removeClass('zoom').addClass('zoomInvert');
			speech.get(1).removeClass('tSmall').addClass('tSmallInvert').text('Beep').cx(16).cy(0);
			break;
		case 2:
			if (synth) {
				var utterOn = new SpeechSynthesisUtterance('Speech only');
				utterOn.lang = 'en-US';
				synth.speak(utterOn);
			}
			speech.get(0).removeClass('zoom').addClass('zoomInvert');
			speech.get(1).removeClass('tSmall').addClass('tSmallInvert').text('Spch').cx(16).cy(0);
			break;
		default:
			if (synth) {
				var utterOn = new SpeechSynthesisUtterance('Sound off');
				utterOn.lang = 'en-US';
				synth.speak(utterOn);
			}
			speech.get(0).removeClass('zoomInvert').addClass('zoom');
			speech.get(1).removeClass('tSmallInvert').addClass('tSmall').text('SnOff').cx(18).cy(0);
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

function RadarRenderer(locationId, $scope, $http) {
	this.width = -1;
	this.height = -1;
	this.canvas = document.getElementById(locationId);
	if (this.canvas == null) {
		return;
	}
	this.resize();

	$scope.AltDiffThreshold = 20;
	$scope.DisplayRadius = 10;

	// Draw the radar using the svg.js library
	var radarAll = SVG(locationId).viewbox(-201, -201, 402, 402).group().addClass('radar');
	//var background = radarAll.rect(402, 402).radius(5).x(-201).y(-201).addClass('blackRect');
	var card = radarAll.group().addClass('card');
	card.circle(400).cx(0).cy(0).addClass('circle');
	card.circle(200).cx(0).cy(0).addClass('circle');
	this.displayText = radarAll.text($scope.DisplayRadius + ' nm').addClass('textOutside').x(-200).cy(-158);               //not rotated
	this.altText = radarAll.text('\xB1' + $scope.AltDiffThreshold + '00ft').addClass('textOutsideRight').x(200).cy(-158);  //not rotated
	this.fl = radarAll.text('FL' + Math.round($scope.BaroAltitude / 100)).addClass('textSmall').move(7, 5);
	card.text('N').addClass('textDir').center(0, -190);
	card.text('S').addClass('textDir').center(0, 190);
	card.text('W').addClass('textDir').center(-190, 0);
	card.text('E').addClass('textDir').center(190, 0);

	var middle = radarAll.path('m 32,6.5 0.5,0.9 0.4,1.4 5.3,0.1 -5.3,0.1 0.1,0.5 0.3,0.1 0.6,0.4 0.4,0.4 0.4,0.8 1.1,7.1 0.1,0.8 3.7,1.7 22.2,1.3 0.5,0.1 0.3,0.3 0.3,0.7 0.2,6 -0.1,0.1 -26.5,2.8 -0.3,0.1 -0.4,0.3 -0.3,0.5 -0.1,0.3 -0.9,6.3 -1.7,10.3 9.5,0 0.2,0.1 0.2,0.2 -0.1,4.6 -0.2,0.2 -8.8,0 -1.1,-2.4 -0.2,2.5 -0.3,2.5 -0.3,-2.5 -0.2,-2.5 -1.1,2.4 -8.8,0 -0.2,-0.2 -0.1,-4.6 0.2,-0.2 0.2,-0.1 9.5,0 -1.7,-10.3 -0.9,-6.3 -0.1,-0.3 -0.3,-0.5 -0.4,-0.3 -0.3,-0.1 -26.5,-2.8 -0.1,-0.1 0.2,-6 0.3,-0.7 0.3,-0.3 0.5,-0.1 22.2,-1.3 3.7,-1.7 0,-0.8 1.2,-7.1 0.4,-0.8 0.4,-0.4 0.6,-0.4 0.3,-0.1 0.1,-0.5 -5.3,-0.1 5.3,-0.1 0.4,-1.4 z');
	middle.size(25, 25).center(0, 3).addClass('centerplane');
	radarAll.circle(2).center(0, 0).addClass('planeRotationPoint');

	var zoomin = radarAll.group().cx(-120).cy(-190).addClass('zoom');
	zoomin.circle(45).cx(0).cy(0).addClass('zoom');
	zoomin.text('Ra-').cx(12).cy(2).addClass('textZoom');
	zoomin.on('click', function () {
		var animateTime = 200;
		var newval = $scope.DisplayRadius;
		switch ($scope.DisplayRadius) {
			case 40:
				newval = 20;
				break;
			case 20:
				newval = 10;
				break;
			case 10:
				newval = 5;
				break;
			case 5:
				newval = 2;
				break;
			default:  // keep 2
				animateTime = 20;
		}
		communicateLimits(100 * $scope.AltDiffThreshold, newval, $http, $scope);
		zoomin.animate(animateTime).rotate(90, 0, 0);
		zoomin.animate(animateTime).rotate(0, 0, 0);
	}, this);

	var zoomout = radarAll.group().cx(-177).cy(-190).addClass('zoom');
	zoomout.circle(45).cx(0).cy(0).addClass('zoom');
	zoomout.text('Ra+').cx(12).cy(2).addClass('textZoom');
	zoomout.on('click', function () {
		var animateTime = 200;
		var newval = $scope.DisplayRadius;
		switch ($scope.DisplayRadius) {
			case 2:
				newval = 5;
				break;
			case 5:
				newval = 10;
				break;
			case 10:
				newval = 20;
				break;
			case 20:
				newval = 40;
				break;
			default:  // keep 40
				animateTime = 20;
		}
		communicateLimits(100 * $scope.AltDiffThreshold, newval, $http, $scope);
		zoomout.animate(animateTime).rotate(90, 0, 0);
		zoomout.animate(animateTime).rotate(0, 0, 0);
	}, this);

	var altmore = radarAll.group().cx(120).cy(-190).addClass('zoom');
	altmore.circle(45).cx(0).cy(0).addClass('zoom');
	altmore.text('Alt+').cx(12).cy(2).addClass('textZoom');
	altmore.on('click', function () {
		var newval = $scope.AltDiffThreshold;
		var animateTime = 200;
		switch ($scope.AltDiffThreshold) {
			case 5:
				newval = 10;
				break;
			case 10:
				newval = 20;
				break;
			case 20:
				newval = 50;
				break;
			case 50:
				newval = 100;
				break;
			case 100:
				newval = 500;
				break;
			default:
				animateTime = 20;
		}
		communicateLimits(100 * newval, $scope.DisplayRadius, $http, $scope);
		altmore.animate(animateTime).rotate(90, 0, 0);
		altmore.animate(animateTime).rotate(0, 0, 0);
	}, this);

	var altless = radarAll.group().cx(177).cy(-190).addClass('zoom');
	altless.circle(45).cx(0).cy(0).addClass('zoom');
	altless.text('Alt-').cx(12).cy(2).addClass('textZoom');
	altless.on('click', function () {
		var newval = $scope.AltDiffThreshold;
		var animateTime = 200;
		switch ($scope.AltDiffThreshold) {
			case 500:
				newval = 100;
				break;
			case 100:
				newval = 50;
				break;
			case 50:
				newval = 20;
				break;
			case 20:
				newval = 10;
				break;
			case 10:
				newval = 5;
				break;
			default:  //5 stays 5
				animateTime = 20;
		}
		communicateLimits(100 * newval, $scope.DisplayRadius, $http, $scope);
		altless.animate(animateTime).rotate(90, 0, 0);
		altless.animate(animateTime).rotate(0, 0, 0);
	}, this);

	/*
	var fullscreen = radarAll.group().cx(185).cy(-125).addClass('zoom');
	fullscreen.rect(40, 35).radius(10).cx(0).cy(0).addClass('zoom');
	fullscreen.text('F/S').cx(10).cy(2).addClass('textZoom');
	fullscreen.on('click', function () {
		var elem = this.canvas;
		var isInFullScreen = (document.fullScreenElement && document.fullScreenElement !== null) || (document.mozFullScreen || document.webkitIsFullScreen);

		if (isInFullScreen) {
			fullscreen.get(0).removeClass('zoomInvert').addClass('zoom');
			fullscreen.get(1).removeClass('textZoomInvert').addClass('textZoom');
			cancelFullScreen(document);
		} else {
			fullscreen.get(0).removeClass('zoom').addClass('zoomInvert');
			fullscreen.get(1).removeClass('textZoom').addClass('textZoomInvert');
			requestFullScreen(elem);
		}
	}, this);
*/
	/*
		var speech = radarAll.group().cx(-185).cy(-125);
		speech.rect(40, 35).radius(10).cx(0).cy(0).addClass('zoom');
		speech.text('Undef').cx(16).cy(0).addClass('tSmall');
	
		//displaySoundStatus(speech, soundType);  //first time activation without synth speak
		synth = window.speechSynthesis;
		if (!synth) soundType = 1;  // speech function not working, default now beep
	
		speech.on('click', function () {
			switch (soundType) {
				case 0:                 //speech and beep
					soundType = 1;  // beep only
					break;
				case 1:  //beep only
					if (synth) {
						soundType = 2;
					} else {
						soundType = 3
					};
					break;
				case 2:                 //speech only
					soundType = 3;  //Sound off
					break;
				default:
					soundType = 0;  //speech and beep
			}
			displaySoundStatus(speech, soundType);
		}, this);
	
	*/

	this.allScreen = radarAll;
	this.rScreen = card;
}

RadarRenderer.prototype = {
	constructor: RadarRenderer,

	resize: function () {
		if (this.canvas == null) {
			return;
		}
		var canvasWidth = this.canvas.parentElement.offsetWidth - 12;

		if (canvasWidth !== this.width) {
			this.width = canvasWidth;
			this.height = canvasWidth * 0.5;

			this.canvas.width = this.width;
			this.canvas.height = this.height;
		}
	},

	update: function ($scope) {
		if (this.canvas == null) {
			return;
		}
		if ($scope.BaroAltitude !== $scope.OldBaroAltitude) {
			this.fl.text('FL' + Math.round($scope.BaroAltitude / 100));  // just update text
			$scope.OldBaroAltitude = $scope.BaroAltitude;
		}
		if ($scope.AltDiffThreshold !== $scope.OldAltDiffThreshold) {
			this.altText.text('\xB1' + $scope.AltDiffThreshold + '00ft');
			clearRadarTraces($scope);
			$scope.OldAltDiffThreshold = $scope.AltDiffThreshold;
		}
		if ($scope.DisplayRadius !== $scope.OldDisplayRadius) {
			this.displayText.text($scope.DisplayRadius + ' nm');
			clearRadarTraces($scope);
			$scope.OldDisplayRadius = $scope.DisplayRadius;
		}
		if ($scope.GPSCourse !== $scope.OldGPSCourse) {
			this.rScreen.rotate(-$scope.GPSCourse, 0, 0);  // rotate conforming to GPSCourse
			$scope.OldGPSCourse = $scope.GPSCourse;
		}
	}
};
