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
angular.module('appControllers').controller('SixPackInstrumentSixpack', SixPackInstrumentSixpack);
SixPackInstrumentSixpack.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];
angular.module('appControllers').controller('SixPackInstrumentGmetergauge', SixPackInstrumentGmetergauge);
SixPackInstrumentGmetergauge.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];
angular.module('appControllers').controller('SixPackInstrumentSpeed', SixPackInstrumentSpeed);
SixPackInstrumentSpeed.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];
angular.module('appControllers').controller('SixPackInstrumentAttitude', SixPackInstrumentAttitude);
SixPackInstrumentAttitude.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];
angular.module('appControllers').controller('SixPackInstrumentAltimeter', SixPackInstrumentAltimeter);
SixPackInstrumentAltimeter.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];
angular.module('appControllers').controller('SixPackInstrumentTurnslip', SixPackInstrumentTurnslip);
SixPackInstrumentTurnslip.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];
angular.module('appControllers').controller('SixPackInstrumentHeading', SixPackInstrumentHeading);
SixPackInstrumentHeading.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];
angular.module('appControllers').controller('SixPackInstrumentVariometer', SixPackInstrumentVariometer);
SixPackInstrumentVariometer.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];

function createProgressiveTicksForRoundInstrument(maxValue = 100, minValue = 0, endDegree = 330, startDegree = 0,  numberOfTicks = 0, decimalNumber = 0, scaleMoltiplier = 1) {
  var speedTicks = [];
  const arcsArc = (endDegree - startDegree);
  if(numberOfTicks<1) {
    numberOfTicks = arcsArc / 30;
  }
  const tickSpedSlots = parseInt(arcsArc / numberOfTicks); // max is 15°
  var tickSpedSlot = startDegree;
  const tickSpeedIncrement = (maxValue - minValue) / numberOfTicks;
  for (var tickSpeed = minValue; tickSpeed <= maxValue; tickSpeed += tickSpeedIncrement) {
    const degree = tickSpedSlot - 90;
    const radians = degree * Math.PI / 180;
    const left = (45 + 40 * Math.cos(radians)) + "%";
    const top = (46 + 40 * Math.sin(radians)) + "%";
    speedTicks.push({ "degree": (tickSpedSlot), "speed": Number.parseFloat(tickSpeed * scaleMoltiplier).toFixed(decimalNumber), "top": top, "left": left });
    tickSpedSlot += tickSpedSlots;
  }
  return speedTicks;
}



// create our controller function with all necessary logic
function SixPackInstrumentGmetergauge($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "gmetergauge");



  $scope.Speed = {
    "startSpeedDegree": -180,
    "endSpeedDegree": 90,
    "label": "G-Meter",
    "unit": "G",
    "speed": 0,
    "minSpeed": -3,
    "backgroundColor":"#000000",
    "maxSpeed": 6,
    "speedDegree": "45deg",
    "arcs": [
      { "color": "#ffffff", "sizeDegree": "45deg", "startDegree": "225deg" },
      { "color": "#00ff00", "sizeDegree": "90deg", "startDegree": "270deg" },
      { "color": "#ffff00", "sizeDegree": "45deg", "startDegree": "180deg" },
      { "color": "#ffff00", "sizeDegree": "90deg", "startDegree": "0deg" },
      { "color": "#ff0000", "sizeDegree": "15deg", "startDegree": "165deg" },
      { "color": "#ff0000", "sizeDegree": "15deg", "startDegree": "90deg" }
    ],
    "speedTicks": []
  };



  $scope.Speed.speedTicks = createProgressiveTicksForRoundInstrument($scope.Speed.maxSpeed, $scope.Speed.minSpeed, $scope.Speed.endSpeedDegree, $scope.Speed.startSpeedDegree,  0, 1);


  $scope.updateSituation = (situation) => {
    const newValue = Number.parseFloat(situation.AHRSGLoad).toFixed(1);
    if($scope.Speed.speed == newValue){
      return;
    }

    $scope.Speed.speed = Number.parseFloat(situation.AHRSGLoad).toFixed(1);
    $scope.Speed.label = Number.parseFloat(situation.AHRSGLoadMax).toFixed(1)+String.fromCodePoint(9650);
    $scope.Speed.unit = Number.parseFloat(situation.AHRSGLoadMin).toFixed(1)+String.fromCodePoint(9660);

    const arcsArc = ($scope.Speed.endSpeedDegree - $scope.Speed.startSpeedDegree);
    const speedIncrement = ($scope.Speed.maxSpeed - $scope.Speed.minSpeed);
    const ratio = speedIncrement / arcsArc;

    $scope.Speed.speedDegree = ((situation.AHRSGLoad-$scope.Speed.minSpeed) / ratio + $scope.Speed.startSpeedDegree + 90) + "deg";

    if(localDisplayGetFlag("Display_Audio_GLoad_Enabled") == "true") {
      // Audio Play on Service
    }
    else {
      window.gMeterBuzzerPlayer.beepWithGLoadFactor(situation.AHRSGLoad);
    }

  };

  if(window.situation !== undefined) {
    $scope.updateSituation(window.situation);
  }
}



function SixPackInstrumentSpeed($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "speed");



  $scope.Speed = {
    "startSpeedDegree": 0,
    "endSpeedDegree": 330,
    "label": "GPS SPEED",
    "sourceName": "GS",
    "unit": "KMH",
    "speed": 0,
    "raw": -1,
    "sensorType": "GPSGroundSpeed",
    "minSpeed": 0,
    "backgroundColor":"#000000",
    "maxSpeed": 330,
    "speedDegree": "45deg",
    "arcs": [
      { "color": "#ffffff", "sizeDegree": "90deg", "startDegree": "45deg", "backgroundColor": "#000000" },
      { "color": "#00ff00", "sizeDegree": "90deg", "startDegree": "135deg", "backgroundColor": "#00aa00" },
      { "color": "#ffff00", "sizeDegree": "75deg", "startDegree": "225deg", "backgroundColor": "#aaaa00" },
      { "color": "#ff0000", "sizeDegree": "15deg", "startDegree": "300deg", "backgroundColor": "#aa0000" }
    ],
    "speedTicks": []
  };

   $scope.Speed.speedTicks = createProgressiveTicksForRoundInstrument($scope.Speed.maxSpeed, $scope.Speed.minSpeed, $scope.Speed.endSpeedDegree, $scope.Speed.startSpeedDegree);

  // TODO: Unify this call under a service
  if(window.aircraftData !== undefined && window.aircraftData.GPSGroundSpeed !== undefined) {
      // update the scope variables
      $scope.Speed = window.aircraftData.GPSGroundSpeed;
      $scope.Speed.speedTicks = createProgressiveTicksForRoundInstrument($scope.Speed.maxSpeed, $scope.Speed.minSpeed, $scope.Speed.endSpeedDegree, $scope.Speed.startSpeedDegree);
  } else {
  $http.get(URL_AIRCRAFT_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        if (db === undefined || Object.keys(db).length == 0) {
            return;
        }
        $scope.Speed = db.GPSGroundSpeed;
        $scope.Speed.speedTicks = createProgressiveTicksForRoundInstrument($scope.Speed.maxSpeed, $scope.Speed.minSpeed, $scope.Speed.endSpeedDegree, $scope.Speed.startSpeedDegree);
        $scope.updateSituation(window.situation); // the gauge just replaced is unlabelled until then
  });
  }

  $scope.updateSituation = (situation) => {
    // SpeedKt/SpeedSource are resolved by servicesituation.js: IAS when the
    // airspeed board reports one, GPS ground speed otherwise
    const speedIsInKt = Number.parseFloat(situation.SpeedKt ?? 0).toFixed(1);
    const sourceName = situation.SpeedSource ?? "GS";
    if($scope.Speed.raw == speedIsInKt && $scope.Speed.sourceName == sourceName) {
      return;
    } else {
      $scope.Speed.raw = speedIsInKt;
      $scope.Speed.sourceName = sourceName;
    }
    $scope.Speed.pilotValue = pilotDisplayedSpeedFromKT(speedIsInKt)
    $scope.Speed.speed = parseInt($scope.Speed.pilotValue);

    const arcsArc = ($scope.Speed.endSpeedDegree - $scope.Speed.startSpeedDegree);
    const speedIncrement = ($scope.Speed.maxSpeed - $scope.Speed.minSpeed);
    const ratio = speedIncrement / arcsArc;


    if($scope.Speed.pilotValue < $scope.Speed.minSpeed) {
      $scope.Speed.speedDegree = ($scope.Speed.startSpeedDegree + 90) + "deg";
    } else {
      $scope.Speed.speedDegree = (($scope.Speed.pilotValue-$scope.Speed.minSpeed) * ratio + $scope.Speed.startSpeedDegree + 90) + "deg";
    }
  };
  if(window.situation !== undefined) {
    $scope.updateSituation(window.situation);
  }  
}
function SixPackInstrumentAttitude($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "attitude");

  $scope.ticks = {
    "speed":[],
    "altimeter":[],
    "heading":[]
  };


  for(var tickIndex = 40;tickIndex>=0;tickIndex--){
    $scope.ticks.speed.push({"label":tickIndex+"0","color":"#0000004c","value":tickIndex*10});
  }
  for(var tickIndex = -6;tickIndex<36+6;tickIndex++){
    switch(tickIndex){
      case 0:
          $scope.ticks.heading.push({"label":"N"});
        break;
      case 18:
          $scope.ticks.heading.push({"label":"S"});
        break;
      case 9:
          $scope.ticks.heading.push({"label":"E"});
        break;
      case 27:
          $scope.ticks.heading.push({"label":"W"});
        break;
      default:
          $scope.ticks.heading.push({"label":(36+tickIndex)%36});
        break;
    }
  }
  // 192 is for FL192
  // For experimental aircraft we stick to 120
  for(var tickIndex = 120;tickIndex>=0;tickIndex--){
   $scope.ticks.altimeter.push({"label":tickIndex,"labelBig":"80"});
   $scope.ticks.altimeter.push({"label":tickIndex,"labelBig":"60"});
   $scope.ticks.altimeter.push({"label":tickIndex,"labelBig":"40"});
   $scope.ticks.altimeter.push({"label":tickIndex,"labelBig":"20"});
   $scope.ticks.altimeter.push({"label":tickIndex,"labelBig":"00"});
  }

  // TODO: Unify this call under a service
  if(window.aircraftData !== undefined && window.aircraftData.GPSGroundSpeed !== undefined) {
      // update the scope variables
      $scope.Speed = window.aircraftData.GPSGroundSpeed;
      for(var tickIndex = $scope.ticks.speed.length-1;tickIndex>=0;tickIndex--){
        for(var colorIndex = $scope.Speed.arcs.length-1;colorIndex>=0;colorIndex--){
          if($scope.ticks.speed[tickIndex].value > $scope.Speed.arcs[colorIndex].threshold){
            $scope.ticks.speed[tickIndex].color = $scope.Speed.arcs[colorIndex].color;
            break;
          }
        }
      }
      
  } else {
    $http.get(URL_AIRCRAFT_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        if (db === undefined || Object.keys(db).length == 0) {
            return;
        }
        $scope.Speed = db.GPSGroundSpeed;
        for(var tickIndex = $scope.ticks.speed.length-1;tickIndex>=0;tickIndex--){
          for(var colorIndex = $scope.Speed.arcs.length-1;colorIndex>=0;colorIndex--){
            if($scope.ticks.speed[tickIndex].value > $scope.Speed.arcs[colorIndex].threshold){
              $scope.ticks.speed[tickIndex].color = $scope.Speed.arcs[colorIndex].color;
              break;
            }
          }
        }
  });
  }
  $scope.Attitude = {
    "rollDegree": "0deg",
    "pitchOrigin": "50% 0%",
    "pitchTop": "50%",
    "standalone" : true,
    "chevrons": "",
    "fail": "",
    "slipSkid": "0cqmin",
    "slipSkidValid": false
  };
  // Slip/skid. The bar travels one of its own widths at full scale, and full
  // scale is 10 degrees - the sign and the travel of the shared AHRS renderer
  // (web/plates/js/ahrs.js), so this ball and the synthetic view read alike.
  const SLIPSKID_FULL_SCALE = 10;   // degrees
  const SLIPSKID_BAR_WIDTH = 10.8;  // cqmin, the width of the roll pointer base

  function updateSlipSkid(skid) {
    $scope.Attitude.slipSkidValid = globalAHRSValueIsValid(skid);
    if($scope.Attitude.slipSkidValid == false) {
      $scope.Attitude.slipSkid = "0cqmin";
      return;
    }
    const clamped = Math.max(-SLIPSKID_FULL_SCALE, Math.min(SLIPSKID_FULL_SCALE, skid));
    // Positive slip moves the bar left, like the ball of an inclinometer
    $scope.Attitude.slipSkid = (-clamped / SLIPSKID_FULL_SCALE * SLIPSKID_BAR_WIDTH) + "cqmin";
  }
  // Unusual attitude: the thresholds and the hysteresis live in global.js, so
  // this ball and the synthetic view raise the chevrons at the same pitch
  // TODO: unify
  $scope.Speed = {
    "speed": 0,
    "sourceName": "GS",
    "unit": ""
  };
  $scope.Altimeter = {
    "altitude": 0,
    "QNH": 1013,
    "AutoQNH": true
  };
  $scope.TurnRate = {
    "valid": false,
    "left": "0cqmin",
    "width": "0cqmin",
    "pegged": false,
    "arrowClass": "attitude-turnrate-arrow-right"
  };
  $scope.Variometer = {
    "barTop": "50%",
    "barHeight": "0%",
    "tipTop": "50%",
    "value": ""
  };
  // Vertical speed strip. Full scale matches the variometer gauge, and a PFD
  // blanks the digits around zero rather than twitching them with the noise.
  const VSI_FULL_SCALE = 2000;  // fpm at either end of the strip
  const VSI_DIGITS_FROM = 100;  // fpm, below which no number is shown
  const VSI_DIGITS_STEP = 50;   // fpm the number is rounded to

  function updateVariometer(situation) {
    // BaroVerticalSpeed is feet per minute. With no baro fitted the GPS rate is
    // the only one there is, and that one is feet per second.
    var vs = situation.BaroVerticalSpeed;
    if(situation.BaroSourceType == 0 || !isFinite(vs)) {
      vs = (situation.GPSVerticalSpeed ?? 0) * 60;
    }
    if(!isFinite(vs)) {
      vs = 0;
    }
    // Half the strip is one full scale, so this is a signed percentage of it
    const half = Math.max(-VSI_FULL_SCALE, Math.min(VSI_FULL_SCALE, vs)) / VSI_FULL_SCALE * 50;
    $scope.Variometer.barTop = (half > 0 ? 50 - half : 50) + "%";
    $scope.Variometer.barHeight = Math.abs(half) + "%";
    $scope.Variometer.tipTop = (50 - half) + "%";
    $scope.Variometer.value = Math.abs(vs) < VSI_DIGITS_FROM ? ""
      : (vs > 0 ? "+" : "-") + Math.round(Math.abs(vs) / VSI_DIGITS_STEP) * VSI_DIGITS_STEP;
  }
    $scope.Heading = {
    "heading": 0
    ,
    "text": "0"
    ,
    "valid": true
    ,
    "bugValid": false
    ,
    "bugLeft": "52cqmin"
    ,
    "sourceName":"GYRO"
  };

  // Failure flags. A PFD removes the sky and ground presentation and draws a
  // red X over the attitude area when the AHRS stops supplying an attitude; the
  // daemon says so by sending ahrs.Invalid for every angle. While the IMU is
  // calibrating it is not broken, only not ready, which gets the align message
  // instead - bit 3 of AHRSStatus (main/sensors.go updateAHRSStatus).
  const AHRS_STATUS_CALIBRATING = 1 << 3;

  function updateFailures(situation) {
    const attitude = globalAHRSValueIsValid(situation.AHRSPitch)
                  && globalAHRSValueIsValid(situation.AHRSRoll);
    if(attitude == true) {
      $scope.Attitude.fail = "";
    } else {
      $scope.Attitude.fail = (situation.AHRSStatus & AHRS_STATUS_CALIBRATING) ? "align" : "fail";
    }
    // Heading has two sources and only fails when both are gone
    $scope.Heading.valid = situation.GPSFixQuality > 0
                        || globalAHRSValueIsValid(situation.AHRSGyroHeading);
  }

  // Turn rate. The compass card runs 8cqmin per 10 degrees and its labels are
  // centred in their cells, so heading H sits at 52 + 0.8H on the card and the
  // lubber line - where the card's own translation lands the current heading -
  // is 50cqmin in. The vector ends at the heading predicted in six seconds, so
  // standard rate (3 deg/s) stops it on the 18 degree tick, as on a G1000.
  const TAPE_CQMIN_PER_DEGREE = 0.8;
  const TURN_TREND_SECONDS = 6;
  const TURN_FULL_SCALE = 18;  // degrees of predicted heading change

  function updateTurnRate(situation) {
    // AHRSTurnRate is the IMU's; the GPS works it out from the ground track and
    // is what is left when there is no IMU
    var rate = globalAHRSValueIsValid(situation.AHRSTurnRate) ? situation.AHRSTurnRate
             : (globalAHRSValueIsValid(situation.GPSTurnRate) ? situation.GPSTurnRate : undefined);
    if(rate === undefined || $scope.Heading.valid == false) {
      $scope.TurnRate.valid = false;
      $scope.TurnRate.pegged = false;
      return;
    }
    const predicted = rate * TURN_TREND_SECONDS;
    const shown = Math.max(-TURN_FULL_SCALE, Math.min(TURN_FULL_SCALE, predicted));
    const width = Math.abs(shown) * TAPE_CQMIN_PER_DEGREE;
    $scope.TurnRate.valid = true;
    $scope.TurnRate.left = (shown < 0 ? -width : 0) + "cqmin";
    $scope.TurnRate.width = width + "cqmin";
    $scope.TurnRate.pegged = Math.abs(predicted) > TURN_FULL_SCALE;
    $scope.TurnRate.arrowClass = predicted < 0 ? "attitude-turnrate-arrow-left"
                                               : "attitude-turnrate-arrow-right";
  }

  // Course bug: the bearing the autopilot is steering to, placed on the card by
  // the shortest way round so it never jumps to the far side of the compass.
  // autopilotData belongs to the main scope, which every plate inherits from.
  function updateCourseBug() {
    const bearing = $scope.autopilotData?.GPRMB?.TrueBearing;
    if($scope.autopilotData?.Active != true || !isFinite(bearing)
       || $scope.Heading.valid == false) {
      $scope.Heading.bugValid = false;
      return;
    }
    const delta = ((((bearing - $scope.Heading.heading + 180) % 360) + 360) % 360) - 180;
    $scope.Heading.bugValid = true;
    $scope.Heading.bugLeft = (52 + TAPE_CQMIN_PER_DEGREE * ($scope.Heading.heading + delta)) + "cqmin";
  }
  $scope.Wind = {
    "valid": false,
    "direction": "---°",
    "speed": "--",
    "unit": "",
    "estimated": false,
    "arrowDegree": "0deg"
  };
  // Damping of the wind readout. servicesituation.js already publishes an
  // averaged or fitted wind (windestimator.js); this only eases the steps, when
  // a new fit lands or the source changes, over about five seconds. Smoothed
  // as a vector, never as an angle: the mean of 359 and 001 is north, not
  // south. arrow is the unwrapped screen angle.
  const WIND_TAU = 5000; // ms
  var windFilter = { "x": 0, "y": 0, "time": 0, "arrow": 0 };

  function updateWind(situation) {
    $scope.Wind.unit = window.aircraftData?.units?.speed ?? "KMH";
    if(situation.WindValid != true) {
      $scope.Wind.valid = false;
      $scope.Wind.direction = "---°";
      $scope.Wind.speed = "--";
      $scope.Wind.estimated = false;
      windFilter.time = 0; // the next estimate starts fresh, not out of a stale one
      return;
    }
    const now = Date.now();
    const x = situation.WindSpeed * Math.sin(toRadians(situation.WindDirection));
    const y = situation.WindSpeed * Math.cos(toRadians(situation.WindDirection));
    if(windFilter.time == 0) {
      windFilter.x = x;
      windFilter.y = y;
    } else {
      const alpha = 1 - Math.exp(-(now - windFilter.time) / WIND_TAU);
      windFilter.x += alpha * (x - windFilter.x);
      windFilter.y += alpha * (y - windFilter.y);
    }
    windFilter.time = now;
    const speedKt = Math.sqrt(windFilter.x * windFilter.x + windFilter.y * windFilter.y);
    const from = (toDegrees(Math.atan2(windFilter.x, windFilter.y)) + 360) % 360;
    // Wind from the north reads 360, like a METAR: 000 is calm, not a direction
    const degrees = Math.round(from) % 360;
    $scope.Wind.valid = true;
    $scope.Wind.direction = ("00" + (degrees == 0 ? 360 : degrees)).slice(-3) + "°";
    $scope.Wind.speed = Math.round(pilotDisplayedSpeedFromKT(speedKt));
    $scope.Wind.estimated = situation.WindSource == "gs";
    // Where the wind blows TO, relative to the nose: a headwind points down the
    // screen. The wind is true and AHRSMagHeading magnetic, so the nose is the
    // true heading. Unwrapped so crossing north turns the arrow one degree
    // instead of sending the CSS transition all the way round the other way.
    const variation = situation.MagneticVariationValid === true ? situation.MagneticVariation : 0;
    const target = from + 180 - (situation.AHRSMagHeading + variation);
    windFilter.arrow += ((((target - windFilter.arrow + 180) % 360) + 360) % 360) - 180;
    $scope.Wind.arrowDegree = windFilter.arrow.toFixed(1) + "deg";
  }

  if($scope.$parent.hasOwnProperty("$parent") 
    && $scope.$parent.$parent.hasOwnProperty("instruments")) {
    $scope.Attitude.standalone = false;
  }

  $scope.updateSituation = (situation) => {
    // Refresh filtering is already applied before invoking this method
    $scope.Attitude.pitchTop = (situation.AHRSPitch) + "%";
    $scope.Attitude.pitchOrigin = "50% " + situation.AHRSPitch + "%";
    $scope.Attitude.rollDegree = -situation.AHRSRoll + "deg";
    $scope.Attitude.chevrons = globalPitchChevrons(situation.AHRSPitch, $scope.Attitude.chevrons);
    updateSlipSkid(situation.AHRSSlipSkid);
    $scope.Altimeter.altitude = parseInt(situation.GPSAltitudeMSL);
    // The setting the altimeter is on, derived or dialled, from servicesituation.js
    $scope.Altimeter.QNH = parseInt(situation.QNH);
    $scope.Altimeter.AutoQNH = situation.AutoQNH;
    updateFailures(situation);
    updateVariometer(situation);
    // Tape and ticks are in the pilot's unit (aircraft.json) like the speed
    // gauge; the source (IAS or GS) is resolved by servicesituation.js
    $scope.Speed.speed = parseInt(pilotDisplayedSpeedFromKT(situation.SpeedKt ?? 0));
    $scope.Speed.sourceName = situation.SpeedSource ?? "GS";
    $scope.Speed.unit = window.aircraftData?.units?.speed ?? "KMH";
    if(situation.GPSFixQuality > 0) {
          $scope.Heading.heading = parseInt(situation.GPSTrueCourse);
      $scope.Heading.sourceName = "GPS";
        } else {
        $scope.Heading.heading = parseInt(situation.AHRSGyroHeading);
          $scope.Heading.sourceName = "GYRO";
    }
    $scope.Heading.text = $scope.Heading.valid == true ? String($scope.Heading.heading) : "---";
    updateTurnRate(situation);
    updateCourseBug();
    updateWind(situation);
  };
  if(window.situation !== undefined) {
    $scope.updateSituation(window.situation);
  }   
}
function SixPackInstrumentAltimeter($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "altimeter");

  $scope.Altimeter = {
    "altitude": 0,
    "AutoQNH": true,
    "altimeterDegreeM": "90deg",
    "altimeterDegreeC": "90deg",
    "BaroPressureAltitude":-1
  };

  $scope.updateSituation = (situation) => {
    const altitude1013 = situation.BaroPressureAltitude;
    if($scope.BaroPressureAltitude == altitude1013){
      return;
    }
    $scope.BaroPressureAltitude = altitude1013;
    $scope.Altimeter.AutoQNH = situation.AutoQNH;
    $scope.Altimeter.altitude = parseInt(situation.BaroPressureAltitude+27*(situation.QNH-1013.25));
    $scope.Altimeter.GPSAltitudeMSL = parseInt(situation.GPSAltitudeMSL);
    $scope.Altimeter.QNH = parseInt(situation.QNH);
    $scope.Altimeter.altimeterDegreeC = (90 + (360.0 * ($scope.Altimeter.altitude / 1000) / 10.0)) + "deg";
    $scope.Altimeter.altimeterDegreeM = (90 + (360.0 * ($scope.Altimeter.altitude % 1000) / 1000.0)) + "deg";

  };

  $scope.fabClick = (direction, item, browserEvent) => {
    console.log(direction + " " + item + " " + browserEvent);

    if (direction == "NC") {
      $scope.Altimeter.QNH++;
      const proxy = new CustomEvent("SituationUpdatedByPilot", { detail: {QNH:$scope.Altimeter.QNH,AutoQNH:false} });
      dispatchEvent(proxy);
    }
    if (direction == "SC") {
      $scope.Altimeter.QNH--;
      const proxy = new CustomEvent("SituationUpdatedByPilot", { detail: {QNH:$scope.Altimeter.QNH,AutoQNH:false} });
      dispatchEvent(proxy);
    }
    if (direction == "C") {
      const proxy = new CustomEvent("SituationUpdatedByPilot", { detail: {AutoQNH:true} });
      dispatchEvent(proxy);
    }    
  };
  if(window.situation !== undefined) {
    $scope.updateSituation(window.situation);
  }   
}
function SixPackInstrumentTurnslip($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "turnslip");

  $scope.TurnSlip = {
    "turnDegree": "0deg",
    "ballLeft": "46%",
    "AHRSSlipSkid":0,
    "ballTop": "66%"
  };

  $scope.updateSituation = (situation) => {
    if($scope.AHRSSlipSkid == situation.AHRSSlipSkid){
      return;
    }
    $scope.AHRSSlipSkid = situation.AHRSSlipSkid;
    $scope.TurnSlip.turnDegree = situation.AHRSTurnRate + "deg";
    var skid = -(situation.AHRSSlipSkid);
    if (skid > 30) {
      skid = 30;
    }
    else {
      if (skid < -30) {
        skid = -30;
      }
    }
    $scope.TurnSlip.ballLeft = (46 + 1.0 * skid) + "%";
    $scope.TurnSlip.ballTop = (66 - Math.abs(0.1 * skid)) + "%";
  };
  if(window.situation !== undefined) {
    $scope.updateSituation(window.situation);
  }   
}
function SixPackInstrumentHeading($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "heading");

  $scope.Heading = {
    "heading": 0
    ,
    "sourceName":"GYRO"
  };


  $scope.updateSituation = (situation) => {

    var newHeading = 0;
    switch ($scope.Heading.sourceName) {
      case "GPS":
        if (situation.GPSFixQuality > 0) {
          newHeading = parseInt(situation.GPSTrueCourse);
        } else {
          $scope.Heading.sourceName = "GYRO";
          newHeading = parseInt(situation.AHRSGyroHeading);
        }
        break;
      case "GYRO":
        newHeading = parseInt(situation.AHRSGyroHeading);
        break;
      case "MAG":
        newHeading = parseInt(situation.AHRSMagHeading);
        break;
      default:
        newHeading = parseInt(situation.AHRSGyroHeading);
        break;
    }
    if($scope.Heading.heading == newHeading){
      return;
    }
    $scope.Heading.heading = newHeading;
  };
  $scope.fabClick = (direction, item, browserEvent) => {
    if (direction == "C") {
      switch ($scope.Heading.sourceName) {
        case "GPS":
          $scope.Heading.sourceName = "GYRO";
          break;
        case "GYRO":
          $scope.Heading.sourceName = "MAG";
          break;
        case "MAG":
          $scope.Heading.sourceName = "GPS";
          break;
      }
    }
  };
  if(window.situation !== undefined) {
    $scope.updateSituation(window.situation);
  }   
}
function SixPackInstrumentVariometer($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "variometer");
  $scope.Variometer = {
    "BaroVerticalSpeed": 0,
    "varioDegree": "0deg"
  };

  $scope.updateSituation = (situation) => {
    if($scope.BaroVerticalSpeed == situation.BaroVerticalSpeed){
      return;
    }
    $scope.BaroVerticalSpeed = situation.BaroVerticalSpeed;
    $scope.Variometer.varioDegree = (situation.BaroVerticalSpeed) / 2000 * 180 + "deg";
  };
  if(window.situation !== undefined) {
    $scope.updateSituation(window.situation);
  }   
}

function SixPackInstrument($rootScope, $scope, $state, $http, $interval, name) {

  if (!$rootScope.hasOwnProperty("test")) {
    $rootScope.test = 0;
  }
  console.log("rootScope.Test: " + $rootScope.test++);
  if (!$scope.hasOwnProperty("test")) {
    $scope.test = 0;
  }
  console.log("scope.Test: " + $scope.test++);
  /*****************************************************
   *  Controller routines
   */
  $state.get(name).onEnter = function () {
    console.log("onEnter" + name);
  };

  $state.get(name).onExit = function () {
    console.log("onExit" + name);
    removeEventListener("keypad", keypadEventListener);
    removeEventListener("SituationUpdated", situationUpdateEventListener);

  };

  console.log("Controller " + name);




  function controllerNameByName(val) {
    return "SixPackInstrument" + String(val).charAt(0).toUpperCase() + String(val).slice(1);
  }




  /*****************************************************
   *  Keypad Management
   */

  function keypadEventListener(event) {
    if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerNameByName(name)) {
      removeEventListener("keypad", keypadEventListener);
      return; // we are getting called once after clicking away from the status page
    }

    if ($scope.keypadKnobTimerRemovePopup === undefined) {
    }
    else {
      // user is changing screen
      return;
    }
  }

  $scope.situation = {};

  $scope.updateSituation = (situation) => {

  };


  // ************
  function situationUpdateEventListener(event) {
    if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerNameByName(name)) {
      console.log($state.current.controller + "!=" + controllerNameByName(name));
      removeEventListener("SituationUpdated", situationUpdateEventListener);
      return; // we are getting called once after clicking away from the status page
    }
    var situation = event.detail;
    // Filter to avoid blow up CPU
    /*
    const oldSituation = $scope.situation;
    const newSituation = situation;
    const ahrsThreshold = 1;
    const altitudeThreshold = 50 / 3.2808;
    const requireRefresh = globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold);
    */
    // Service is already protecting the update
    const requireRefresh = true;
    if (requireRefresh == true) {
      $scope.updateSituation(situation);
      $scope.situation = situation;
      $scope.$apply(); // trigger any needed refreshing of data
    }
  }



  addEventListener("keypad", keypadEventListener);
  addEventListener("SituationUpdated", situationUpdateEventListener);

  // Inject route on the parent if any

  if ($scope.hasOwnProperty("$parent") && $scope.$parent.hasOwnProperty("$parent") && $scope.$parent.$parent.hasOwnProperty("instruments")) {
    for (var index = 0; index < $scope.$parent.$parent.instruments.length; index++) {
      if ($scope.$parent.$parent.instruments[index].name == name) {
        $scope.$parent.$parent.instruments[index].pointer = $scope;
      }
    }

  }
};



function SixPackInstrumentSixpack($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "sixpack");


  $scope.instruments = [
    { "url": "plates/speed.html", "ctrl": SixPackInstrumentSpeed, pointer: null, "name": "speed" },
    { "url": "plates/attitude.html", "ctrl": SixPackInstrumentAttitude, pointer: null, "name": "attitude" },
    { "url": "plates/altimeter.html", "ctrl": SixPackInstrumentAltimeter, pointer: null, "name": "altimeter" },
    { "url": "plates/turnslip.html", "ctrl": SixPackInstrumentTurnslip, pointer: null, "name": "turnslip" },
    { "url": "plates/heading.html", "ctrl": SixPackInstrumentHeading, pointer: null, "name": "heading" },
    { "url": "plates/variometer.html", "ctrl": SixPackInstrumentVariometer, pointer: null, "name": "variometer" }
  ];

  $scope.updateSituation = (situation) => {
    $scope.instruments.forEach(element => {
      if (element.pointer != null) {
        element.pointer.updateSituation(situation);
      }
    });
  };
}