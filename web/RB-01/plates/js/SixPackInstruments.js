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
    $scope.Speed.speed = Number.parseFloat(situation.AHRSGLoad).toFixed(1);
    $scope.Speed.label = Number.parseFloat(situation.AHRSGLoadMax).toFixed(1)+String.fromCodePoint(9650);
    $scope.Speed.unit = Number.parseFloat(situation.AHRSGLoadMin).toFixed(1)+String.fromCodePoint(9660);

    const arcsArc = ($scope.Speed.endSpeedDegree - $scope.Speed.startSpeedDegree);
    const speedIncrement = ($scope.Speed.maxSpeed - $scope.Speed.minSpeed);
    const ratio = speedIncrement / arcsArc;

    $scope.Speed.speedDegree = ((situation.AHRSGLoad-$scope.Speed.minSpeed) / ratio + $scope.Speed.startSpeedDegree + 90) + "deg";

    if(true) {
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
  });
  }

  $scope.updateSituation = (situation) => {
    const GPSGroundSpeedIsInKt = situation[$scope.Speed.sensorType];
    if($scope.Speed.raw == GPSGroundSpeedIsInKt) {
      return;
    } else {
      $scope.Speed.raw = GPSGroundSpeedIsInKt;
    }
    $scope.Speed.pilotValue = pilotDisplayedSpeedFromKT(GPSGroundSpeedIsInKt)
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
    "standalone" : true
  };
  // TODO: unify
  $scope.Speed = {
    "speed": 0
  };
  $scope.Altimeter = {
    "altitude": 0
  };
    $scope.Heading = {
    "heading": 0
    ,
    "sourceName":"GYRO"
  };

  if($scope.$parent.hasOwnProperty("$parent") 
    && $scope.$parent.$parent.hasOwnProperty("instruments")) {
    $scope.Attitude.standalone = false;
  }

  $scope.updateSituation = (situation) => {
    $scope.Attitude.pitchTop = (situation.AHRSPitch) + "%";
    $scope.Attitude.pitchOrigin = "50% " + situation.AHRSPitch + "%";
    $scope.Attitude.rollDegree = -situation.AHRSRoll + "deg";
    $scope.Altimeter.altitude = parseInt(situation.GPSAltitudeMSL);
    $scope.Speed.speed = parseInt(situation.GPSGroundSpeed);
    if(situation.GPSFixQuality > 0) {
          $scope.Heading.heading = parseInt(situation.GPSTrueCourse);
      $scope.Heading.sourceName = "GPS";
        } else {
        $scope.Heading.heading = parseInt(situation.AHRSGyroHeading);
          $scope.Heading.sourceName = "GYRO";
    }
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
  };

  $scope.updateSituation = (situation) => {
    const altitude1013 = situation.BaroPressureAltitude;
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
    "ballTop": "66%"
  };

  $scope.updateSituation = (situation) => {
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
    switch ($scope.Heading.sourceName) {
      case "GPS":
        if (situation.GPSFixQuality > 0) {
          $scope.Heading.heading = parseInt(situation.GPSTrueCourse);
        } else {
          $scope.Heading.sourceName = "GYRO";
          $scope.Heading.heading = parseInt(situation.AHRSGyroHeading);
        }
        break;
      case "GYRO":
        $scope.Heading.heading = parseInt(situation.AHRSGyroHeading);
        break;
      case "MAG":
        $scope.Heading.heading = parseInt(situation.AHRSMagHeading);
        break;
      default:
        $scope.Heading.heading = parseInt(situation.AHRSGyroHeading);
        break;
    }
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
    "varioDegree": "0deg"
  };

  $scope.updateSituation = (situation) => {
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
      $scope.situation = situation;
      $scope.updateSituation(situation);
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