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
    const newLabel = Number.parseFloat(situation.AHRSGLoadMax).toFixed(1)+String.fromCodePoint(9650);
    const newUnit = Number.parseFloat(situation.AHRSGLoadMin).toFixed(1)+String.fromCodePoint(9660);
    // Max/Min also change alone, after a reset at steady G
    if($scope.Speed.speed == newValue && $scope.Speed.label == newLabel && $scope.Speed.unit == newUnit){
      return;
    }

    $scope.Speed.speed = newValue;
    $scope.Speed.label = newLabel;
    $scope.Speed.unit = newUnit;

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

  // Reset Max-Min: the daemon starts them again from the G now
  $scope.gmeterReset = () => {
    $http.post(URL_GMETER_RESET).then(function (response) {
      // do nothing
    }, function (response) {
      // do nothing
    });
  };

  $scope.fabClick = (direction, item, browserEvent) => {
    if (direction == "C") {
      $scope.gmeterReset();
    }
  };

  // The knob: TAP resets Max-Min, as the centre touch zone does. PREV and NEXT have nothing to
  // change here (docs/tech-debt/keypad-page-navigation.md 3.4, a direct page)
  $scope.knob = (key) => {
    if (key == KEYPAD_MAPPING_TAP) {
      $scope.gmeterReset();
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
    "overlay": false,
    "chevrons": "",
    "fail": "",
    "slipSkid": "0cqmin",
    "slipSkidValid": false
  };
  // Slip/skid. The bar travels one of its own widths at full scale, and full
  // scale is 10 degrees - the sign and the travel of the legacy Stratux AHRS
  // renderer (web/plates/js/ahrs.js), so this ball and the synthetic view read alike.
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
    "text": "---",
    "valid": false,
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
    "valid": true,
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
    // The barometric rate while the barometer is current, else the GPS rate, else
    // none: the strip empties and reads --- in red (RB-HLR-ALT-200)
    const vs = globalVerticalSpeedFpm(situation);
    $scope.Variometer.valid = vs !== undefined;
    if($scope.Variometer.valid == false) {
      $scope.Variometer.barTop = "50%";
      $scope.Variometer.barHeight = "0%";
      $scope.Variometer.tipTop = "50%";
      $scope.Variometer.value = "---";
      return;
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
    "sourceName":"TRK"
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
    // The heading box is the GPS track, and fails with the fix (RB-HLR-HDG-070)
    $scope.Heading.valid = situation.GPSFixQuality > 0 && isFinite(situation.GPSTrueCourse);
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
  // The readout is damped by createWindFilter(); arrow is the unwrapped screen angle
  const windFilter = createWindFilter();
  var windArrow = 0;

  function updateWind(situation) {
    $scope.Wind.unit = window.aircraftData?.units?.speed ?? "KMH";
    const wind = windFilter(situation);
    if(wind.valid != true) {
      $scope.Wind.valid = false;
      $scope.Wind.direction = "---°";
      $scope.Wind.speed = "--";
      $scope.Wind.estimated = false;
      return;
    }
    const from = wind.from;
    $scope.Wind.valid = true;
    $scope.Wind.direction = headingReadout(from) + "°";
    $scope.Wind.speed = Math.round(pilotDisplayedSpeedFromKT(wind.speedKt));
    $scope.Wind.estimated = wind.estimated;
    // Where the wind blows TO, relative to the nose: a headwind points down the
    // screen. The wind is true and AHRSMagHeading magnetic, so the nose is the
    // true heading. Unwrapped so crossing north turns the arrow one degree
    // instead of sending the CSS transition all the way round the other way.
    const variation = situation.MagneticVariationValid === true ? situation.MagneticVariation : 0;
    const target = from + 180 - (situation.AHRSMagHeading + variation);
    windArrow += ((((target - windArrow + 180) % 360) + 360) % 360) - 180;
    $scope.Wind.arrowDegree = windArrow.toFixed(1) + "deg";
  }

  if($scope.$parent.hasOwnProperty("$parent") 
    && $scope.$parent.$parent.hasOwnProperty("instruments")) {
    $scope.Attitude.standalone = false;
    // Transparent marks-only mode over the synthetic view (host entry: overlay: true)
    $scope.Attitude.overlay = $scope.instrument?.overlay === true;
  }

  $scope.updateSituation = (situation) => {
    // Refresh filtering is already applied before invoking this method
    $scope.Attitude.pitchTop = (situation.AHRSPitch) + "%";
    $scope.Attitude.pitchOrigin = "50% " + situation.AHRSPitch + "%";
    $scope.Attitude.rollDegree = -situation.AHRSRoll + "deg";
    $scope.Attitude.chevrons = globalPitchChevrons(situation.AHRSPitch, $scope.Attitude.chevrons);
    updateSlipSkid(situation.AHRSSlipSkid);
    // The setting the altimeter is on, derived or dialled, from servicesituation.js
    $scope.Altimeter.QNH = parseInt(situation.QNH);
    // The altitude box beside it: the barometric altitude on that setting, never the
    // GPS one (RB-HLR-ALT-140), and --- in red while the barometer is not current
    // (RB-HLR-ALT-070); the tape holds where it was
    $scope.Altimeter.valid = situation.BaroValid === true;
    if($scope.Altimeter.valid) {
      $scope.Altimeter.altitude = parseInt(situation.BaroPressureAltitude + 27 * (situation.QNH - 1013.25));
      $scope.Altimeter.text = String($scope.Altimeter.altitude);
    }
    else {
      $scope.Altimeter.text = "---";
    }
    $scope.Altimeter.AutoQNH = situation.AutoQNH;
    updateFailures(situation);
    updateVariometer(situation);
    // Tape and ticks are in the pilot's unit (aircraft.json) like the speed
    // gauge; the source (IAS or GS) is resolved by servicesituation.js
    $scope.Speed.speed = parseInt(pilotDisplayedSpeedFromKT(situation.SpeedKt ?? 0));
    $scope.Speed.sourceName = situation.SpeedSource ?? "GS";
    $scope.Speed.unit = window.aircraftData?.units?.speed ?? "KMH";
    // The GPS track and nothing else, labelled TRK, so there is no change of source
    // to hide (RB-HLR-HDG-070). Below 3 kt the daemon holds the last track
    // (RB-HLR-SIT-050), and it is shown held: owner decision of 2026-11-25.
    $scope.Heading.sourceName = "TRK";
    if($scope.Heading.valid) {
      $scope.Heading.heading = parseInt(situation.GPSTrueCourse);
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
    "BaroPressureAltitude":-1,
    "fail": ""
  };

  $scope.updateSituation = (situation) => {
    // A new QNH or AUTO redraws too: on the ground the baro altitude does not change, and the
    // needle and the AUTO label would wait for a climb
    const drawn = situation.BaroPressureAltitude + "|" + situation.QNH + "|" + situation.AutoQNH + "|" + situation.BaroStatus;
    if($scope.altimeterDrawn == drawn){
      return;
    }
    $scope.altimeterDrawn = drawn;
    // A barometer that has stopped is crossed out BARO FAIL, a unit with none - or
    // with only the ADS-B estimate - NO BARO; the needles hold and the GPS altitude
    // under them stays (RB-HLR-ALT-070, RB-HLR-ALT-130)
    $scope.Altimeter.fail = situation.BaroStatus == "ok" ? ""
                          : (situation.BaroStatus == "stale" ? "BARO FAIL" : "NO BARO");
    $scope.Altimeter.AutoQNH = situation.AutoQNH;
    $scope.Altimeter.GPSAltitudeMSL = parseInt(situation.GPSAltitudeMSL);
    $scope.Altimeter.QNH = parseInt(situation.QNH);
    if($scope.Altimeter.fail != "") {
      return;
    }
    $scope.BaroPressureAltitude = situation.BaroPressureAltitude;
    $scope.Altimeter.altitude = parseInt(situation.BaroPressureAltitude+27*(situation.QNH-1013.25));
    $scope.Altimeter.altimeterDegreeC = (90 + (360.0 * ($scope.Altimeter.altitude / 1000) / 10.0)) + "deg";
    $scope.Altimeter.altimeterDegreeM = (90 + (360.0 * ($scope.Altimeter.altitude % 1000) / 1000.0)) + "deg";

  };

  // The pilot's QNH, one hPa a step; it holds until AUTO again.
  // The pilot cannot dial outside QNH_MIN..QNH_MAX hPa: a step past a limit stays on the
  // limit, and a step from an AUTO value outside the range lands on the nearest limit.
  // Same window as RB-09 ($RBAIR, main/slavenmeadisplay.go), so a pilot QNH always reaches it.
  const QNH_MIN = 850;
  const QNH_MAX = 1100;
  $scope.qnhStep = (direction) => {
    $scope.Altimeter.QNH = Math.min(QNH_MAX, Math.max(QNH_MIN, $scope.Altimeter.QNH + direction));
    $scope.Altimeter.AutoQNH = false;
    const proxy = new CustomEvent("SituationUpdatedByPilot", { detail: {QNH:$scope.Altimeter.QNH,AutoQNH:false} });
    dispatchEvent(proxy);
  };

  // AUTO: services/servicesituation.js derives the QNH from the GPS while level
  $scope.qnhAuto = () => {
    const proxy = new CustomEvent("SituationUpdatedByPilot", { detail: {AutoQNH:true} });
    dispatchEvent(proxy);
  };

  $scope.fabClick = (direction, item, browserEvent) => {
    console.log(direction + " " + item + " " + browserEvent);

    if (direction == "NC") {
      $scope.qnhStep(1);
    }
    if (direction == "SC") {
      $scope.qnhStep(-1);
    }
    if (direction == "C") {
      $scope.qnhAuto();
    }
  };

  // The knob, the same three actions: PREV -1 hPa, NEXT +1 hPa, TAP AUTO
  // (docs/tech-debt/keypad-page-navigation.md 3.4, a direct page)
  $scope.knob = (key) => {
    switch (key) {
      case KEYPAD_MAPPING_PREV:
        $scope.qnhStep(-1);
        break;
      case KEYPAD_MAPPING_NEXT:
        $scope.qnhStep(1);
        break;
      case KEYPAD_MAPPING_TAP:
        $scope.qnhAuto();
        break;
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
// Damping of the wind readout, shared by the attitude and heading plates.
// servicesituation.js already publishes an averaged or fitted wind
// (windestimator.js); this only eases the steps, when a new fit lands or the
// source changes, over about five seconds. Smoothed as a vector, never as an
// angle: the mean of 359 and 001 is north, not south. Returns a function of
// the situation giving {valid, from (true, degrees), speedKt, estimated}; an
// invalid wind resets it, so the next estimate starts fresh, not out of a
// stale one.
function createWindFilter(tau = 5000 /* ms */) {
  var state = { "x": 0, "y": 0, "time": 0 };
  return function (situation) {
    if(situation.WindValid != true) {
      state.time = 0;
      return { "valid": false };
    }
    const now = Date.now();
    const x = situation.WindSpeed * Math.sin(toRadians(situation.WindDirection));
    const y = situation.WindSpeed * Math.cos(toRadians(situation.WindDirection));
    if(state.time == 0) {
      state.x = x;
      state.y = y;
    } else {
      const alpha = 1 - Math.exp(-(now - state.time) / tau);
      state.x += alpha * (x - state.x);
      state.y += alpha * (y - state.y);
    }
    state.time = now;
    return {
      "valid": true,
      "from": (toDegrees(Math.atan2(state.x, state.y)) + 360) % 360,
      "speedKt": Math.sqrt(state.x * state.x + state.y * state.y),
      "estimated": situation.WindSource == "gs"
    };
  };
}

// A direction as a pilot reads it, three digits. North reads 360, like a
// METAR or a runway: 000 is calm, not a direction.
function headingReadout(degrees) {
  const d = Math.round(((degrees % 360) + 360) % 360) % 360;
  return ("00" + (d == 0 ? 360 : d)).slice(-3);
}

// The directional gyro plate. A magnetic compass card turned by the selected
// source (TAP or the centre zone cycles GPS > GYRO > MAG), with every source
// shown on it at once as a coloured mark, as a G5 shows the GPS track as a
// magenta diamond:
//   MAG   white triangle on the rim   AHRSMagHeading, already magnetic
//   GYRO  cyan triangle on the rim    AHRSGyroHeading, aligned to the GPS track: true
//   TRK   magenta diamond inside      GPSTrueCourse, true
// The two true ones are turned magnetic with the variation from
// /settings/deviation.json (variation.js, East positive: magnetic = true -
// variation), which the plate shows as VAR. Outside the grid there is none:
// the magnetometer addon's OFFSET FROM GPS TRACK then makes the compass a true
// one, so the card stays one reference and says TRUE.
// The wind arrow sits on the rim where the wind comes from and points at the
// aircraft, turning with the card; the readout gives it magnetic, like a
// tower, with its head/tail and cross components against the nose.
function SixPackInstrumentHeading($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "heading");

  // Below this the GPS track is noise: a G5 drops its track diamond too
  const TRACK_MIN_SPEED_KT = 5;
  const SOURCES = ["GPS", "GYRO", "MAG"];

  function mark() {
    return { "valid": false, "deg": "0deg" };
  }
  $scope.Heading = {
    "heading": 0,       // magnetic (or true, see reference), what the card shows
    "card": "0deg",
    "text": "---",
    "valid": false,
    "sourceName": "GYRO",
    "reference": "MAG", // "TRUE" without a variation
    "marks": { "GPS": mark(), "GYRO": mark(), "MAG": mark() }
  };
  $scope.Variation = { "valid": false, "text": "VAR ---" };
  $scope.Wind = {
    "valid": false,
    "direction": "---°",
    "speed": "--",
    "unit": "",
    "estimated": false,
    "arrowDegree": "0deg",
    "showArrow": false,
    "head": "",
    "cross": ""
  };
  const windFilter = createWindFilter();

  function wrap360(a) {
    return ((a % 360) + 360) % 360;
  }
  // An angle off the lubber line, the short way round
  function offLubber(a) {
    return (wrap360(a - $scope.Heading.heading + 180) - 180).toFixed(1) + "deg";
  }
  // A wind component with the arrow it pushes along, none when there is none
  function component(value, positive, negative) {
    return value == 0 ? "0" : (value > 0 ? positive : negative) + Math.abs(value);
  }

  // Every source on the card's reference, undefined when it has nothing to say
  function sourceHeadings(situation, variation) {
    const track = situation.GPSFixQuality > 0 && situation.GPSGroundSpeed >= TRACK_MIN_SPEED_KT
               && isFinite(situation.GPSTrueCourse);
    return {
      "MAG": globalAHRSValueIsValid(situation.AHRSMagHeading)
        ? wrap360(situation.AHRSMagHeading) : undefined,
      "GYRO": globalAHRSValueIsValid(situation.AHRSGyroHeading)
        ? wrap360(situation.AHRSGyroHeading - variation) : undefined,
      "GPS": track ? wrap360(situation.GPSTrueCourse - variation) : undefined
    };
  }

  function updateVariation(situation) {
    $scope.Variation.valid = situation.MagneticVariationValid === true;
    $scope.Heading.reference = $scope.Variation.valid ? "MAG" : "TRUE";
    if($scope.Variation.valid == false) {
      $scope.Variation.text = "VAR --- TRUE";
      return 0;
    }
    const v = situation.MagneticVariation;
    const shown = Math.round(Math.abs(v));
    $scope.Variation.text = "VAR " + shown + "°" + (shown == 0 ? "" : (v > 0 ? "E" : "W"));
    return v;
  }

  function updateWind(situation, variation, nose) {
    $scope.Wind.unit = window.aircraftData?.units?.speed ?? "KMH";
    const wind = windFilter(situation);
    if(wind.valid != true) {
      $scope.Wind.valid = false;
      $scope.Wind.showArrow = false;
      return;
    }
    const from = wrap360(wind.from - variation);
    const speed = Math.round(pilotDisplayedSpeedFromKT(wind.speedKt));
    $scope.Wind.valid = true;
    $scope.Wind.direction = headingReadout(from) + "°";
    $scope.Wind.speed = speed;
    $scope.Wind.estimated = wind.estimated;
    // Calm has no direction to point at
    $scope.Wind.showArrow = speed > 0;
    $scope.Wind.arrowDegree = offLubber(from);
    if(nose === undefined) {
      $scope.Wind.head = "";
      $scope.Wind.cross = "";
      return;
    }
    // Arrows the way each component pushes the aircraft: a headwind down
    // the screen, a wind from the right to the left
    const off = toRadians(from - nose);
    const head = Math.round(pilotDisplayedSpeedFromKT(wind.speedKt * Math.cos(off)));
    const cross = Math.round(pilotDisplayedSpeedFromKT(wind.speedKt * Math.sin(off)));
    $scope.Wind.head = component(head, "▼", "▲");
    $scope.Wind.cross = component(cross, "◀", "▶");
  }

  $scope.updateSituation = (situation) => {
    // Without a fix there is no track, as before: GPS gives way to the gyro
    if($scope.Heading.sourceName == "GPS" && !(situation.GPSFixQuality > 0)) {
      $scope.Heading.sourceName = "GYRO";
    }
    const variation = updateVariation(situation);
    const headings = sourceHeadings(situation, variation);
    const primary = headings[$scope.Heading.sourceName];
    $scope.Heading.valid = primary !== undefined;
    if($scope.Heading.valid) {
      $scope.Heading.heading = primary;
      $scope.Heading.card = (-primary).toFixed(1) + "deg";
      $scope.Heading.text = headingReadout(primary);
    } else {
      // The card holds where it was; the digits say it is not current
      $scope.Heading.text = "---";
    }
    SOURCES.forEach(name => {
      const m = $scope.Heading.marks[name];
      m.valid = headings[name] !== undefined;
      if(m.valid) {
        m.deg = offLubber(headings[name]);
      }
    });
    // The nose for the wind components: the compass, else the gyro, else the track
    const nose = headings.MAG ?? headings.GYRO ?? headings.GPS;
    updateWind(situation, variation, nose);
  };
  $scope.fabClick = (direction, item, browserEvent) => {
    if (direction == "C") {
      const i = SOURCES.indexOf($scope.Heading.sourceName);
      $scope.Heading.sourceName = SOURCES[(i + 1) % SOURCES.length];
    }
  };

  // The knob: TAP cycles the heading source, as the centre touch zone does. No heading bug
  // exists to turn, so PREV and NEXT stay inert (docs/tech-debt/keypad-page-navigation.md 3.4)
  $scope.knob = (key) => {
    if (key == KEYPAD_MAPPING_TAP) {
      $scope.fabClick("C");
    }
  };
  if(window.situation !== undefined) {
    $scope.updateSituation(window.situation);
  }
}
function SixPackInstrumentVariometer($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "variometer");
  $scope.Variometer = {
    "valid": true,
    "varioDegree": "0deg"
  };

  // The same source as the attitude plate's strip (RB-HLR-ALT-200): the barometric
  // rate while the barometer is current, else the GPS rate; with neither the needle
  // holds and the gauge is crossed out
  $scope.updateSituation = (situation) => {
    const vs = globalVerticalSpeedFpm(situation);
    $scope.Variometer.valid = vs !== undefined;
    if($scope.Variometer.valid) {
      $scope.Variometer.varioDegree = vs / 2000 * 180 + "deg";
    }
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
    // A plate with something to operate defines $scope.knob(key); the others leave the keys
    // inert. Only the routed plate gets here: the copy inside the sixpack fails the check above
    if (typeof $scope.knob === "function") {
      $scope.$apply(() => $scope.knob(event.key));
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
      $scope.gpsNoFix = !(situation.GPSFixQuality > 0);
      $scope.updateSituation(situation);
      $scope.situation = situation;
      $scope.$apply(); // trigger any needed refreshing of data
    }
  }



  $scope.gpsNoFix = !(window.situation?.GPSFixQuality > 0);
  addEventListener("keypad", keypadEventListener);
  addEventListener("SituationUpdated", situationUpdateEventListener);
  $scope.$on("$destroy", function () {
    removeEventListener("keypad", keypadEventListener);
  });

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