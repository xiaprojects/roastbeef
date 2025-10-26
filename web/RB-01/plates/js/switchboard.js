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

    switchboard.js: SwitchBoard interface
*/

angular.module('appControllers').controller('SwitchboardCtrl', SwitchboardCtrl); // get the main module controllers set
SwitchboardCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

const SW_TYPE_NONE = 0
const SW_TYPE_URL = 1
const SW_TYPE_CMD = 2
const SW_TYPE_INTERNAL = 3
const SW_TYPE_GPIO = 4
const SW_STATUS_UNKNOWN = 0
const SW_STATUS_RUNNING = 1
const SW_STATUS_FINISH_0 = 2
const SW_STATUS_FINISH_1 = 3
const SW_STATUS_FINISH_2 = 4
const URL_SWITCHES_GET = URL_SETTINGS_GET;

const URL_SWITCH_SET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/switches";

// create our controller function with all necessary logic
function SwitchboardCtrl($rootScope, $scope, $state, $http, $interval) {

  $scope.$parent.helppage = 'plates/switchboard-help.html';
  $scope.switches = [];
  
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
/*
    switch (event.key) {
      case KEYPAD_MAPPING_PREV_MEDIA:
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
      case KEYPAD_MAPPING_NEXT_MEDIA:
      case KEYPAD_MAPPING_NEXT:
        break;
    }
*/
  }
  $state.get('switchboard').onEnter = function () {
    // everything gets handled correctly by the controller
  };
  $state.get('switchboard').onExit = function () {
    removeEventListener("keypad", keypadEventListener);
  };


  /**
  * Convert UI related JSON to Settings JSON
  * @param {*} modelItemFromAngular 
  */
  function modelItemFromAngular(angularItem) {
    return {
      "Name": angularItem.Name,
      "Type": parseInt(angularItem.Type),
      "Status": angularItem.Status,
      "Uri": angularItem.Uri,
      "UriStatus": angularItem.UriStatus,
      "EpochStart": angularItem.EpochStart,
      "EpochFinish": angularItem.EpochFinish
    };
  }


  /**
   * REST API Start a pre-edited command
   * @param {*} msg 
   */
  $scope.forkCommandInBackground = function (index) {
    $scope.switches[index].EpochStart = Math.floor(new Date() / 1000);
    $scope.switches[index].EpochFinish = $scope.switches[index].EpochStart
    $scope.switches[index].Status = SW_STATUS_RUNNING
    $http.post(URL_SWITCH_SET + "/" + index).
      then(function (response) {
        var updatedItem = angular.fromJson(response.data);
        updatedItem["Edit"] = false;
        $scope.switches[index] = updatedItem;
      }, function (response) {
      });
  }


  /**
   * REST API to Start a new Command without keep it in configuration, Warning: this is Sync so it will timeout after 2 mins!
   * @param {*} msg 
   */
  $scope.sendCommand = function (index) {
    var msg = modelItemFromAngular($scope.switches[index])
    $scope.switches[index].EpochStart = Math.floor(new Date() / 1000);
    $scope.switches[index].EpochFinish = $scope.switches[index].EpochStart
    $scope.switches[index].Status = SW_STATUS_RUNNING
    $http.put(URL_SWITCH_SET, msg).
      then(function (response) {
        var updatedItem = angular.fromJson(response.data);
        updatedItem["Edit"] = false;
        $scope.switches[index] = updatedItem;
      }, function (response) {
      });
  }

  /**
   * REST API
   * @param {*} msg 
   */
  function setSettings(msg) {
    // Simple POST request example (note: response is asynchronous)
    $http.post(URL_SETTINGS_SET, msg).
      then(function (response) {
        // Settings are modified here: no need to reload everything
        // $scope.$apply();
      }, function (response) {
      });
  }

  /**
   * New Template
   * @param {*} url 
   */
  $scope.itemCreate = function () {
    $scope.switches.push({
      "Name": "",
      "Edit": true,
      "Type": 0,
      "Status": 0,
      "Uri": "",
      "UriStatus": "",
      "EpochStart": 0,
      "EpochFinish": 0
    }
    );
  }
  /**
   * Trigger the On Save
   */
  $scope.itemEdit = function (index, item) {
    if ($scope.switches[index].Edit == true) {
      $scope.switches[index] = item;
      uploadSwitches = []
      $scope.switches.forEach(element => {
        if (element.Uri != "") {
          model = modelItemFromAngular(element)
          uploadSwitches.push(model)
        }
      });
      setSettings(angular.toJson({ "Switches": uploadSwitches }))
    }
    $scope.switches[index].Edit = !$scope.switches[index].Edit;
  }

  $scope.textByEpoch = function (seconds) {
    date = new Date(1000 * seconds);
    return textBySeconds(date.getUTCHours() * 60 * 60 + date.getUTCMinutes() * 60 + date.getUTCSeconds());
  }
  /**
 * Trigger the On Start
 */
  $scope.itemStart = function (index, item, start) {
    $scope.switches[index].Status = start;
  }

  /**
 * Restore from saved JSON information
 */
  $scope.restoreConfiguration = function () {
    $http.get(URL_SWITCHES_GET).then(function (response) {
      var status = angular.fromJson(response.data);
      $scope.switches = [];
      var newItems = [];
      if (status.hasOwnProperty("Switches")) {
        newItems = status["Switches"];
      }
      // Restore Angular Model
      for (index = 0; index < newItems.length; index++) {
        newItems[index]["Edit"] = false;
      }
      $scope.switches = newItems;

    });
  }

  // Startup
  $scope.restoreConfiguration();
  // Bridge from servicekeypad
  addEventListener("keypad", keypadEventListener);
}


SwitchboardCtrl.prototype = {
  constructor: SwitchboardCtrl,
};
