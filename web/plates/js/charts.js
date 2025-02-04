/*
    Copyright (c) 2023 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    charts.js: Charts interface
*/

angular.module('appControllers').controller('ChartsCtrl', ChartsCtrl); // get the main module controllers set
ChartsCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

var URL_CHARTS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/charts/view/";
var URL_CHARTS_DOWNLOAD = URL_HOST_PROTOCOL + URL_HOST_BASE + "/charts/export/";

// create our controller function with all necessary logic
function ChartsCtrl($rootScope, $scope, $state, $http, $interval) {

  // Render Engine
  $scope.charts = {};
  $scope.Charts_Enabled = false;
  // Data
  $scope.chartConfig = {};
  // Charts Group, usefull to avoid creating too many charts
  const chart_field_mapping = {
    "GPSGroundSpeed": "Performance",
    "BaroPressureAltitude": "Performance",
    "GPSTrueCourse": "Attitude",
    "Alt": "Performance",
    "AHRSPitch": "Attitude",
    "AHRSRoll": "Attitude",
    "AHRSGyroHeading": "Attitude",
    "AHRSMagHeading": "Magnetometer",
    "AHRSSlipSkid": "Attitude",
    "AHRSTurnRate": "Attitude",
    "AHRSGLoad": "Load Factor",
    "AHRSGLoadMax": "Load Factor",
    "AHRSGLoadMin": "Load Factor",
    "GPSLatitude": null,
    "GPSLongitude": null,
    "Epoch": null,
    "BaroVerticalSpeed": "Variometers",
    "GpsTurnRate": "Attitude",
    "GPSHeightAboveEllipsoid": "Performance",
    "TrafficCount": "System",
    "Connected_Users": "System",
    "GPS_satellites_locked": "System",
    "CPUTemp": "System",
    "MagX":"Magnetometer",
    "MagY":"Magnetometer",
    "MagZ":"Magnetometer",
    "MagMaxX":"Magnetometer",
    "MagMaxY":"Magnetometer",
    "MagMaxZ":"Magnetometer",
    "MagMinX":"Magnetometer",
    "MagMinY":"Magnetometer",
    "MagMinZ":"Magnetometer",
    "BaroTemperature": "System"
  };
  const chart_field_axis = {
    "GPSGroundSpeed": "y",
    "BaroPressureAltitude": "y1",
    "GPSTrueCourse": "y1",
    "Alt": "y1",
    "AHRSPitch": "y",
    "AHRSRoll": "y",
    "AHRSGyroHeading": "y1",
    "AHRSMagHeading": "y1",
    "AHRSSlipSkid": "y",
    "AHRSTurnRate": "y",
    "AHRSGLoad": "y",
    "BaroVerticalSpeed": "y",
    "GpsTurnRate": "y",
    "GPSHeightAboveEllipsoid": "y1",
    "Magnetometer":"y",
    "TrafficCount": "y",
    "Connected_Users": "y",
    "GPS_satellites_locked": "y",
    "CPUTemp": "y1",
    "BaroTemperature": "y1"
  };


  // Rendering Template
  const chartTemplate = {
    type: 'line',
    data: {
      labels: [],
      datasets: [

      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: false,
          text: ''
        },
      },
      interaction: {
        intersect: false,
      },
      scales: {
        x: {
          display: true,
          title: {
            display: false,
            text: "Timeline"
          }
        },
        y: {
          display: true,
          title: {
            display: false,
            text: ''
          },
          suggestedMin: 0
        }
        ,
        y1: {
          display: true,
          position: "right",
          title: {
            display: false,
            text: ''
          },
          suggestedMin: 0
        }

      }
    }
  };

  $scope.$parent.helppage = 'plates/charts-help.html';
  // ChartSelect will be "live" or filename.kml found in USB-Storage
  $scope.ChartSelect = "live";
  $scope.files = [{ "Name": "live", "Label": "Live recording" }];


  
    /*****************************************************
     *  Controller routines
     */
    $state.get('charts').onEnter = function () {
      // everything gets handled correctly by the controller
  };

  $state.get('charts').onExit = function () {
    removeEventListener("keypad", keypadEventListener);
  };

  
  function keypadEventListener(event) {
    if (($scope === undefined) || ($scope === null)) {
        removeEventListener("keypad", keypadEventListener);
        return; // we are getting called once after clicking away from the status page
    }

    if ($scope.keypadKnobTimerRemovePopup === undefined) {
    }
    else
    {
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



  /**
   * Refresh the chart downloading new data
   */
  $scope.reloadCharts = function () {
    var currentChartUrl = URL_CHARTS_GET + "/" + $scope.ChartSelect;
    $http.get(currentChartUrl).then(function (response) {
      var status = angular.fromJson(response.data);
      $scope.refreshCharts(status);
    });
  }

  /**
   * Refresh existing charts
   * @param {*} updateData 
   */
  $scope.refreshCharts = function (updateData) {
    var labels = [];
    if (updateData.hasOwnProperty("Epoch")) {
      DATA_COUNT = updateData["Epoch"].length;
      date = new Date;
      var epoc = date.getUTCHours() * 60 + date.getUTCMinutes();
      for (let i = 0; i < DATA_COUNT; ++i) {
        labels.push(textBySeconds(epoc - (DATA_COUNT) + i));
      }
    }

    Object.keys(updateData).forEach(function (key) {
        $scope.refreshChart(updateData, key, labels)
    });
    // Ready to render the charts, wait for Angular to apply the div
    setTimeout(function () {

      Object.keys($scope.charts).forEach(function (groupName) {

        // Time to create the div
        $scope.charts[groupName] = new Chart(document.getElementById('chart_' + groupName), $scope.chartConfig[groupName]);
      });


    }, 50 + 50 * Object.keys($scope.charts).length);
  }

  $scope.refreshChart = function (updateData, key, labels) {


    // by default each unknown chart will be standalone
    var groupName = key;
    let enabledGroup = chart_field_mapping;
    if (enabledGroup.hasOwnProperty(key)) {
      groupName = enabledGroup[key];
    }

    // null is for skipping items, like Epoch, GPSLatitude...
    if(groupName==null){
      return;
    }

    //
    var chart = JSON.parse(JSON.stringify(chartTemplate));
    // Chart grouping
    if ($scope.chartConfig.hasOwnProperty(groupName) == false) {
      $scope.chartConfig[groupName] = chart;
    }

    var yAxisID = 'y';
    if(chart_field_axis.hasOwnProperty(key)){
      yAxisID = chart_field_axis[key];
    }

    $scope.chartConfig[groupName].data.datasets.push(
      {
        label: key,
        fill: false,
        cubicInterpolationMode: 'monotone',
        tension: 0.4, yAxisID: yAxisID,
        data: updateData[key]
      }
    );
    $scope.chartConfig[groupName].data.labels = labels;

    // Angular will create the div
    if ($scope.charts.hasOwnProperty(groupName) && $scope.charts[groupName] != null) {
      // Render engine already drawn, update the data
      $scope.charts[groupName].update();
    }
    else {
      // Somebody later will create the div and the chart
      $scope.charts[groupName] = null;
    }
  }

// Reload Settings
$http.get(URL_SETTINGS_GET).
then(function (response) {
  settings = angular.fromJson(response.data);
  $scope.Charts_Enabled = settings.Charts_Enabled;
});


  $scope.reloadCharts();
  // PNG Export
  $scope.downloadChart = function (chartName) {
    var a = document.createElement('a');
    a.href = $scope.charts[chartName].toBase64Image();
    date = new Date;
    a.download = "Chart_" + chartName + "_" + textBySeconds(date.getUTCHours() * 60 * 60 + date.getUTCMinutes() * 60 + date.getUTCSeconds()) + ".png";
    a.click();
  }
  // GPX,KML,CSV Export
  $scope.downloadByExt = function (ext) {
    document.location = URL_CHARTS_DOWNLOAD + "/" + $scope.ChartSelect + "."+ext;
  }
}



