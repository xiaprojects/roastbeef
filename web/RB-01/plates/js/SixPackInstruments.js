angular.module('appControllers').controller('SixPackInstrumentSixpack', SixPackInstrumentSixpack);
SixPackInstrumentSixpack.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval'];
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
// create our controller function with all necessary logic
function SixPackInstrumentSpeed($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "speed");



  $scope.Speed = {
    "startSpeedDegree": 0,
    "endSpeedDegree": 330,
    "label": "GPS SPEED",
    "unit": "KMH",
    "speed": 0,
    "minSpeed": 0,
    "backgroundColor":"#000000",
    "maxSpeed": 330,
    "speedDegree": "45deg",
    "arcs": [
      { "color": "#ffffff", "sizeDegree": "90deg", "startDegree": "45deg" },
      { "color": "#00ff00", "sizeDegree": "90deg", "startDegree": "135deg" },
      { "color": "#ffff00", "sizeDegree": "75deg", "startDegree": "225deg" },
      { "color": "#ff0000", "sizeDegree": "15deg", "startDegree": "300deg" }
    ],
    "speedTicks": []
  };


  var speedTicks = [];
  const arcsArc = ($scope.Speed.endSpeedDegree - $scope.Speed.startSpeedDegree);
  const tickSpedSlots = parseInt(arcsArc / 15); // max is 15°
  var tickSpedSlot = $scope.Speed.startSpeedDegree;
  const tickSpeedIncrement = ($scope.Speed.maxSpeed - $scope.Speed.minSpeed) / 15;
  for (var tickSpeed = $scope.Speed.minSpeed; tickSpeed <= $scope.Speed.maxSpeed; tickSpeed += tickSpeedIncrement) {


    const degree = tickSpedSlot - 90;
    const radians = degree * Math.PI / 180;
    const left = (45 + 40 * Math.cos(radians)) + "%";
    const top = (46 + 40 * Math.sin(radians)) + "%";

    speedTicks.push({ "degree": (tickSpedSlot), "speed": tickSpeed, "top": top, "left": left });
    tickSpedSlot += tickSpedSlots;
  }
  $scope.Speed.speedTicks = speedTicks;


  $scope.updateSituation = (situation) => {
    $scope.Speed.speed = parseInt(situation.GPSGroundSpeed);

    const arcsArc = ($scope.Speed.endSpeedDegree - $scope.Speed.startSpeedDegree);
    const speedIncrement = ($scope.Speed.maxSpeed - $scope.Speed.minSpeed);
    const ratio = speedIncrement / arcsArc;

    $scope.Speed.speedDegree = (situation.GPSGroundSpeed * ratio + $scope.Speed.startSpeedDegree + 90) + "deg";

  };
}
function SixPackInstrumentAttitude($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "attitude");


  $scope.Attitude = {
    "rollDegree": "0deg",
    "pitchOrigin": "50% 0%",
    "pitchTop": "50%",
  };

  $scope.updateSituation = (situation) => {
    $scope.Attitude.pitchTop = (situation.AHRSPitch) + "%";
    $scope.Attitude.pitchOrigin = "50% " + situation.AHRSPitch + "%";
    $scope.Attitude.rollDegree = -situation.AHRSRoll + "deg";
  };
}
function SixPackInstrumentAltimeter($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "altimeter");

  $scope.Altimeter = {
    "altitude": 0,
    "altimeterDegreeM": "90deg",
    "altimeterDegreeC": "90deg",
  };

  $scope.updateSituation = (situation) => {
    $scope.Altimeter.altitude = parseInt(situation.BaroPressureAltitude);
    $scope.Altimeter.GPSAltitudeMSL = parseInt(situation.GPSAltitudeMSL);
    $scope.Altimeter.QNH = parseInt(situation.QNH);
    $scope.Altimeter.altimeterDegreeC = (90 + (360.0 * (situation.GPSAltitudeMSL / 1000) / 10.0)) + "deg";
    $scope.Altimeter.altimeterDegreeM = (90 + (360.0 * (situation.GPSAltitudeMSL % 1000) / 1000.0)) + "deg";

  };
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
}
function SixPackInstrumentHeading($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "heading");

  $scope.Heading = {
    "heading": 0
  };


  $scope.updateSituation = (situation) => {
    $scope.Heading.heading = parseInt(situation.AHRSGyroHeading);
  };
}
function SixPackInstrumentVariometer($rootScope, $scope, $state, $http, $interval) {
  SixPackInstrument($rootScope, $scope, $state, $http, $interval, "variometer");
  $scope.Variometer = {
    "varioDegree": "0deg"
  };

  $scope.updateSituation = (situation) => {
    $scope.Variometer.varioDegree = (situation.BaroVerticalSpeed) / 2000 * 180 + "deg";
  };
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
    const oldSituation = $scope.situation;
    const newSituation = situation;
    const ahrsThreshold = 1;
    const altitudeThreshold = 50 / 3.2808;
    const requireRefresh = globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold);
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