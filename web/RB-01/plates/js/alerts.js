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
angular.module('appControllers').controller('AlertsCtrl', AlertsCtrl); // get the main module controllers set
AlertsCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

var URL_ALERTS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/getAlerts";
var URL_ALERTSMAPPING_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/resources/alertsMapping.json";

// Shared Routines
function textBySeconds(seconds) {
  seconds = seconds.toFixed(0);
  var h = Math.floor(seconds / 60 / 60);
  var m = Math.floor(seconds / 60) % 60;
  var mm = m;
  var s = seconds % 60;
  var ss = s;

  var r = "";
  if (h > 0) {
    r = h + ":";
  }
  if (m < 10) {
    mm = "0" + m;
  }
  r = r + mm + ":";
  if (s < 10) {
    ss = "0" + s;
  }
  r = r + ss;
  return r;
}


// create our controller function with all necessary logic
function AlertsCtrl($rootScope, $scope, $state, $http, $interval) {
  $scope.$parent.helppage = 'plates/alerts-help.html';
  $scope.data_list = []; // Items to be displayed
  $scope.alertsMapping = {}; // Translations and other usefull stuff for rendering

  $state.get('alerts').onEnter = function () {
    // everything gets handled correctly by the controller
  };

  $state.get('alerts').onExit = function () {
    // Websocket is not here, it is shared inherited in the main.js
  };

  // Download Alerts list, up to MAX which shall be 100 items
  function refreshAlertsAsync($scope) {
    $http.get(URL_ALERTS_GET).then(function (response) {
      var status = angular.fromJson(response.data);
      $scope.data_list = [];
      for (var index = 0; index < status.length; index++) {
        $scope.data_list.unshift(generateAlertRow($scope, status[index]));
      }
    });
  }

  // Download voices, text, mappings for multi language
  function refreshMappingsAndAlertsAsync($scope) {
    $http.get(URL_ALERTSMAPPING_GET).then(function (response) {
      var mapping = angular.fromJson(response.data);
      $scope.alertsMapping = mapping;
      refreshAlertsAsync($scope);
    });
  }


  // Audio Player using alerts.html hidden component
  // Warning: the audio will play only if the user touched the screen, in case of Keypad, at least 1 touch on the screen shall be done
  $scope.playAudio = function (url) {
    if (document.getElementById("audioproxy") === undefined 
    || document.getElementById("audioproxy") === false
    || document.getElementById("audioproxy") == null){
        // DOM is not ready or Audio in not enabled on the browser (ex.:Round display)
    }
    else {
    document.getElementById("audioproxy").autoplay = true;
    document.getElementById("audioproxy").src = url;
    document.getElementById("audioproxy").load();
    }
  }

  /**
   * generateAlertRow
   *  Convert JSON item to Angular UI Presentation
   * @param {*} $scope 
   * @param {*} alert 
   * @returns Angular UI Redering Temple
   */
  function generateAlertRow($scope, alert) {
    // TODO: missing Keyboard navigator
    var template = { "barclass": "barinfo", "icon": "/img/info.svg", "id": 0, "type": "info", "date": "", "text": "", "sound": "sounds/notify.mp3" };
    // Load translations from Mapping
    var userLang = navigator.language || navigator.userLanguage;
    if ($scope.alertsMapping.hasOwnProperty(userLang)) {
      // User Language found
    }
    else {
      // Fallback to English
      userLang = "en-US";
    }
    if ($scope.alertsMapping.hasOwnProperty(userLang)) {
      // It is an array balanced with enumeration starting from 0
      if ($scope.alertsMapping[userLang].length > alert.Type) {
        if ($scope.alertsMapping[userLang][alert.Type].Sound !== undefined && $scope.alertsMapping[userLang][alert.Type].Sound.length > 0) {
          template.sound = "/sounds/" + $scope.alertsMapping[userLang][alert.Type].Sound + ".mp3";
        }
        template.type = $scope.alertsMapping[userLang][alert.Type].Icon;
        template.text = $scope.alertsMapping[userLang][alert.Type].Text;
        template.icon = "/img/" + $scope.alertsMapping[userLang][alert.Type].Icon + ".svg";
        // alerts.css contains the colors attributes using the Type info,warning and danger
        template.barclass = "bar" + $scope.alertsMapping[userLang][alert.Type].Icon;
      }
    }
    // TODO: Find the best display between voices[userLang].Title;
    if(alert.Title.length>0){
    template.text = alert.Title;
    }
    // Enumeration
    template.id = alert.Type;
    // Time "Elapsed"
    template.date = textBySeconds(new Date(alert.Timestamp).getHours() * 60 + new Date(alert.Timestamp).getMinutes());

    return template;
  }

  // Alerts Screen Load, check for mapping preloaded
  if ($scope.alertsMapping===undefined || Object.keys($scope.alertsMapping).length == 0) {
    refreshMappingsAndAlertsAsync($scope);
  }
  else {
    refreshAlertsAsync($scope);
  }
}