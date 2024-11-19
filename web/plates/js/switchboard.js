/*
    Copyright (c) 2024 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    switchboard.js: SwitchBoard interface
*/

angular.module('appControllers').controller('SwitchBoardCtrl', SwitchBoardCtrl); // get the main module controllers set
SwitchBoardCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies


// create our controller function with all necessary logic
function SwitchBoardCtrl($rootScope, $scope, $state, $http, $interval) {


  $scope.$parent.helppage = 'plates/switchboard-help.html';


  function keypadEventListener(event) {
    if (($scope === undefined) || ($scope === null)) {
      removeEventListener("keypad", keypadEventListener);
      return; // we are getting called once after clicking away from the status page
    }

    if ($scope.keypadKnobTimerRemovePopup === undefined) {
    }
    else {
      // user is changing screen
      return;
    }

    switch (event.key) {
      case KEYPAD_MAPPING_PREV:
      case "ArrowUp":
      case "ArrowLeft":
        break;
      case "Enter":
      case " ":
      case KEYPAD_MAPPING_TAP:
        break;
      case "ArrowDown":
      case "ArrowRight":
      case KEYPAD_MAPPING_NEXT:
        break;
    }

  }
  $state.get('timers').onEnter = function () {
    // everything gets handled correctly by the controller
  };
  $state.get('switchboard').onExit = function () {
    removeEventListener("keypad", keypadEventListener);
  };
}
