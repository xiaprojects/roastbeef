/*
    Copyright (c) 2023 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    radio.js: Radio interface

    Feature:
    - Support a list of Radio
    - Streaming Radio
    - Initial support for Radio DB

    Roadmap:
    - Verify streaming on http or httpS
    - Import Radio database
    - Picker
    - Search
*/
angular.module('appControllers').controller('RadioCtrl', RadioCtrl); // get the main module controllers set
RadioCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

var URL_RADIO_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/radio";
var URL_RADIO_SET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/radio";
var URL_PLAYBACK_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/playback";
var URL_RADIO_DB_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/resources/db.frequencies.json";


// create our controller function with all necessary logic
function RadioCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.$parent.helppage = 'plates/radio-help.html';
/*
    $scope.noSleep = new NoSleep();
*/
    $scope.scrollItemCounter = 0;
    $scope.scrollItemSelected = 0;
    $scope.scrollItemRight = 0;
    $scope.replayList = [];
    // Frequency DB
        /*
    {
    "global": // Future roadmap: "Country"
    {
        "130.000":{ // Frequency
            "gps":{
                "lat":43.0,
                "lon":12.0,
                "range":500000 // Applicable Range, in meters, 0 => 
            },
            "name":"Local Frequency"
        }
    }
    */
    $scope.db = {"global":{}};

    $scope.radioList = [];

    $state.get('radio').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $scope.radioApply = function(index){
        var item = {
            "FrequencyActive": $scope.radioList[index].active,
            "FrequencyStandby": $scope.radioList[index].standby,
            "Dual": $scope.radioList[index].dual
        };
        let msg = JSON.stringify(item);
        $http.post(URL_RADIO_SET+"/"+index, msg).
             then(function(response) {
                $scope.radioRefresh();
             }, function(response) {
               // called asynchronously if an error occurs
               // or server returns response with an error status.
               // TODO: Manage Radio Synth Errors
             });
    }


    // Restore status
    $scope.radioRefresh = function(){
    $http.get(URL_RADIO_GET).then(function (response) {
        var status = angular.fromJson(response.data);
        var radioList = $scope.radioList;
        for(var index=0;index<status.length;index++){
            var template = { "className": "keypadSelectedNo", "classStandByLeft": "btn-default", "classStandByRight": "btn-default", "name": "", "active": "000.000", "standby": "000.000", "dual": false, "index": 0 };
            if(index<radioList.length){
                template = radioList[index];
            } else {
                radioList.push(template);
            }
            template.name = status[index]["Name"];
            template.active = status[index]["FrequencyActive"];
            template.standby = status[index]["FrequencyStandby"];
            template.dual = status[index]["Dual"];
            template.index = index;
        }
        // Auto select the first Radio only the first time
        if(radioList.length>0 && $scope.radioList.length==0){
            radioList[0].className = "keypadSelectedYes";
            radioList[0].classStandByLeft= "btn-danger";
        }
        $scope.radioList = radioList;
        $scope.radioSelectByIndex($scope.scrollItemCounter, $scope.scrollItemRight, $scope.scrollItemSelected);
    });
    }
    $scope.radioRefresh();

    $scope.switchFreq = function (radio) {
        var standby = radio.standby;
        var standbyMem = radio.standbyMem;
        $scope.radioList[radio.index].standby = radio.active;
        $scope.radioList[radio.index].standbyMem = radio.activeMem;
        $scope.radioList[radio.index].active = standby;
        $scope.radioList[radio.index].activeMem = standbyMem;

        $scope.radioApply(radio.index);
    }

    $scope.dualFreq = function (radio, dual) {
        $scope.radioList[radio.index].dual = dual;

        $scope.radioApply(radio.index);
    }

    $scope.increaseFreq = function (radio, increase) {
        increase = parseInt(increase);
        var mhz = $scope.radioList[radio.index].standby.split(".")[0];
        var khz = $scope.radioList[radio.index].standby.split(".")[1];
        var mhzFinal = mhz;
        if (increase >= 1000 || increase <= -1000) {
            mhzFinal = parseInt(mhz) + increase / 1000;
        }
        var khzFinal = (parseInt(khz) + increase % 1000) % 1000;
        $scope.radioList[radio.index].standby = mhzFinal + "." + khzFinal;

        $scope.radioApply(radio.index);
    }

    $state.get('radio').onEnter = function () {
        // everything gets handled correctly by the controller

    };

    $state.get('radio').onExit = function () {
        clearInterval($scope.tickerPlayback);
        delete $scope.tickerPlayback;
        removeEventListener("keypad", keypadEventListener);
/*
        $scope.noSleep.disable();
        delete $scope.noSleep;
*/
    };



    // Key pad management
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
            case KEYPAD_MAPPING_PREV_MEDIA:
            case KEYPAD_MAPPING_PREV:
            case "ArrowUp":
            case "ArrowLeft":
                $scope.radioSelectPrev();
                break;
            case "Enter":
            case " ":
            case KEYPAD_MAPPING_TAP:
                $scope.radioSelectTap();
                break;
            case "ArrowDown":
            case "ArrowRight":
            case KEYPAD_MAPPING_NEXT_MEDIA:
            case KEYPAD_MAPPING_NEXT:
                $scope.radioSelectNext();
                break;
        }
    }

    $scope.playlistSelectByIndex = function (index) {
        for (var x = 0; x < $scope.replayList.length; x++) {
            if (x == index) {
                $scope.replayList[x].className = "keypadSelectedYes";
            }
            else {
                $scope.replayList[x].className = "keypadSelectedNo";
            }
        }
        var off = "btn-default";
        for (var x = 0; x < $scope.radioList.length; x++) {
                $scope.radioList[x].className = "keypadSelectedNo";
                $scope.radioList[x].classStandByLeft = off;
                $scope.radioList[x].classStandByRight = off;
        }
        $scope.$apply();
    }

    $scope.radioSelectByIndex = function (index, right, selected) {
        var off = "btn-default";
        var on = "btn-danger";
        var sel = "btn-success";

        if (selected) {
            on = sel;
        }
        for (var x = 0; x < $scope.radioList.length; x++) {
            if (x == index) {
                $scope.radioList[x].className = "keypadSelectedYes";
                if (right > 0) {
                    $scope.radioList[x].classStandByLeft = off;
                    $scope.radioList[x].classStandByRight = on;
                }
                else {
                    $scope.radioList[x].classStandByLeft = on;
                    $scope.radioList[x].classStandByRight = off;
                }

            }
            else {
                $scope.radioList[x].className = "keypadSelectedNo";
                $scope.radioList[x].classStandByLeft = off;
                $scope.radioList[x].classStandByRight = off;
            }
        }
        for (var x = 0; x < $scope.replayList.length; x++) {
                $scope.replayList[x].className = "keypadSelectedNo";
        }
    }

    $scope.radioSelectTap = function () {
        var availableItems = $scope.radioList.length;
        if ($scope.scrollItemCounter < availableItems) {
        $scope.scrollItemSelected = !$scope.scrollItemSelected;
        $scope.radioSelectByIndex($scope.scrollItemCounter, $scope.scrollItemRight, $scope.scrollItemSelected);
        } else {
            var playBackItemSelected = $scope.scrollItemCounter - availableItems + $scope.scrollItemRight;
            $scope.playAudio($scope.replayList[playBackItemSelected].Path);
        }
        $scope.$apply();
    }

    $scope.radioSelectNext = function () {
        if ($scope.scrollItemSelected) {
            var val = ($scope.scrollItemRight == 1 ? 5 : 1000) * 1;
            $scope.increaseFreq($scope.radioList[$scope.scrollItemCounter], val);
            $scope.$apply();
        }
        else {
            if ($scope.scrollItemRight > 0) {
                $scope.scrollItemCounter++;
                $scope.scrollItemRight = 0;
            }
            else {
                $scope.scrollItemRight++;
            }
            var availableItems = $scope.radioList.length;


            if ($scope.scrollItemCounter >= availableItems) {
                var playBackItemSelected = ($scope.scrollItemCounter - availableItems)*2 + $scope.scrollItemRight;
                if(playBackItemSelected >= $scope.replayList.length){

                $scope.scrollItemCounter = availableItems - 1;
                $scope.scrollItemRight = 1;
                const proxy = new KeyboardEvent("keypad", { key: "to" });
                dispatchEvent(proxy);
                
                } else {
                    $scope.playlistSelectByIndex(playBackItemSelected);
                }
            }
            else {
                $scope.radioSelectByIndex($scope.scrollItemCounter, $scope.scrollItemRight, $scope.scrollItemSelected);
                $scope.$apply();
            }
        }


    }

    $scope.radioSelectPrev = function () {
        if ($scope.scrollItemSelected) {
            var val = ($scope.scrollItemRight == 1 ? 5 : 1000) * (-1);
            $scope.increaseFreq($scope.radioList[$scope.scrollItemCounter], val);
            $scope.$apply();

        }
        else {
            if ($scope.scrollItemRight < 1) {
                $scope.scrollItemCounter--;
                $scope.scrollItemRight = 1;
            }
            else {
                $scope.scrollItemRight--;
            }
            var availableItems = $scope.radioList.length;
            if ($scope.scrollItemCounter >= availableItems) {
                var playBackItemSelected = ($scope.scrollItemCounter - availableItems)*2 + $scope.scrollItemRight;
                if(playBackItemSelected < $scope.replayList.length) {
                    $scope.playlistSelectByIndex(playBackItemSelected);
                }
            } else {
            if ($scope.scrollItemCounter < 0) {
                $scope.scrollItemCounter = 0;
                $scope.scrollItemRight = 0;
                const proxy = new KeyboardEvent("keypad", { key: "to" });
                dispatchEvent(proxy);
            }
            else {
                $scope.radioSelectByIndex($scope.scrollItemCounter, $scope.scrollItemRight, $scope.scrollItemSelected);
                $scope.$apply();
            }
            }
        }

    }

    // Display Frequency Name
    $scope.radioFindFrequency = function (frequency) {
        if($scope.db["global"].hasOwnProperty(frequency)){
        return $scope.db["global"][frequency]["name"];
        }
        return "";
    }
    $scope.radioDisplayNameByFrequency = function (frequency) {
        if($scope.db["global"].hasOwnProperty(frequency)){
        return $scope.db["global"][frequency]["name"];
        }
        return "---";
    }

    addEventListener("keypad", keypadEventListener);

    $scope.radioDBReload = function(){
    // Load the Radio DB, format:
    $http.get(URL_RADIO_DB_GET).then(function (response) {
        var db = angular.fromJson(response.data);
        if(db === undefined || Object.keys(db).length == 0)
        {
            return;
        }
        $scope.db = db;
        $scope.playbackReload();
        if (($scope.tickerPlayback === undefined) || ($scope.tickerPlayback === null)) {
            $scope.tickerPlayback = window.setInterval($scope.playbackReload, 5000);
        }    
    });
    }
    $scope.radioDBReload();
    // TODO: Add WebSocket to avoid Polling
    $scope.playbackReload = function() {
    // Load the Playback:
    $http.get(URL_PLAYBACK_GET).then(function (response) {
        var list = angular.fromJson(response.data);
        if(list === undefined || list.length == 0)
        {
            return;
        }
        // {"Name":"radio_20240607_051225_130000000.mp3","Source":"RTL","Path":"/playback/radio_20240607_051225_130000000.mp3","Size":12380,"ModTime":"2024-06-07T06:12:30.20311712+01:00","Frequency":""}
        var listParsed = [];
        for (var i = list.length - 1; i >= 0; i--) {
            var p = list[i];
            p.Duration = parseInt(p.Size / 3000);
            if(p.Duration<2)continue;
            
            if (p.Frequency == "") {
                var fr = (p.Path.split("_").pop().split(".")[0]).slice(0,6);
                var f = fr.slice(0,3) + "." + fr.slice(3,6);
                var fn = $scope.radioFindFrequency(f);
                if (fn == "") {
                    p.Frequency = f;
                }
                else {
                    p.Frequency = fn;
                }
            }

            if(listParsed.length%2 == 0){
                p.style = "background-color:lightgray;";
            }
            p.className = "keypadSelectedNo";
            listParsed.push(p);
        }
        var availableItems = $scope.radioList.length;
        if ($scope.scrollItemCounter >= availableItems) {
            var playBackItemSelected = ($scope.scrollItemCounter - availableItems)*2 + $scope.scrollItemRight;
            if(playBackItemSelected < listParsed.length) {
                listParsed[playBackItemSelected].className = "keypadSelectedYes";
            }
        }

        $scope.replayList = listParsed;
    });
    }
    $scope.elapsed = function (dateISO) {
        return textBySeconds(new Date(dateISO).getHours() * 60 + new Date(dateISO).getMinutes())
    }
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
      $scope.shareAudio = function (url) {
        window.open(url,'_blank');
      }
      
}



