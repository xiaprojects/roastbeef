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
// Load frequencies from airfields
var URL_RADIO_DB_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/db.frequencies.json";


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
        for (var i = 0; i < $scope.radioList.length; i++) {
            $scope.radioList[i].enabled = (i == index);
        }

        var item = {
            "Enabled": $scope.radioList[index].enabled,
            "FrequencyActive": $scope.radioList[index].active,
            "FrequencyStandby": $scope.radioList[index].standby,
            "LabelActive": $scope.radioList[index].label,
            "LabelStandby": $scope.radioList[index].standbyLabel,
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
        if(status === undefined || status === null){
            return;
        }
                $scope.radioReceivedNewStatus(status);
    });
    }
    $scope.radioReceivedNewStatus = function(status) {
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
            template.enabled = status[index]["Enabled"];
            template.index = index;
            // Check for valid data
            if(template.active.length<1)template.active="118.000";
            if(template.standby.length<1)template.standby="118.000";

            template.label = $scope.radioFindFrequency(template.active);
            template.standbyLabel = $scope.radioFindFrequency(template.standby);
        }
        // Auto select the first Radio only the first time
        if(radioList.length>0 && $scope.radioList.length==0){
            radioList[0].className = "keypadSelectedYes";
            radioList[0].classStandByLeft= "btn-danger";
        }
        $scope.radioList = radioList;
        $scope.radioSelectByIndex($scope.scrollItemCounter, $scope.scrollItemRight, $scope.scrollItemSelected);
    }
    $scope.radioRefresh();

    $scope.switchFreq = function (radio) {
        var standby = radio.standby;
        var standbyMem = radio.standbyMem;
        $scope.radioList[radio.index].standby = radio.active;
        $scope.radioList[radio.index].standbyMem = radio.activeMem;
        $scope.radioList[radio.index].active = standby;
        $scope.radioList[radio.index].activeMem = standbyMem;
        var label = radio.label;
        $scope.radioList[radio.index].label = radio.standbyLabel;
        $scope.radioList[radio.index].standbyLabel = label;

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
        if (Number.isNaN(parseInt(mhz))) mhz = 118;
        if (Number.isNaN(parseInt(khz))) khz = 0;
        if (parseInt(mhz) < 118) mhz = 118;
        var mhzFinal = mhz;
        if (increase >= 1000 || increase <= -1000) {
            mhzFinal = parseInt(mhz) + increase / 1000;
        }
        var khzFinal = (""+(parseInt(khz) + increase % 1000) % 1000).padEnd(3,"0");
        $scope.radioList[radio.index].standby = mhzFinal + "." + khzFinal;
        $scope.radioList[radio.index].standbyLabel = $scope.radioFindFrequency($scope.radioList[radio.index].standby);

        $scope.radioApply(radio.index);
    }

    $state.get('radio').onEnter = function () {
        // everything gets handled correctly by the controller

    };

    $state.get('radio').onExit = function () {
        removeEventListener("RadioUpdated", radioUpdateEventListener);
        clearInterval($scope.tickerPlayback);
        delete $scope.tickerPlayback;
        removeEventListener("keypad", keypadEventListener);
/*
        $scope.noSleep.disable();
        delete $scope.noSleep;
*/
    };

    addEventListener("RadioUpdated", radioUpdateEventListener);
    function radioUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) ) {
            removeEventListener("RadioUpdated", radioUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        $scope.radioReceivedNewStatus(event.detail);
        $scope.$apply(); // trigger any needed refreshing of data
    }

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

            case KEYPAD_MAPPING_PREV:

                $scope.radioSelectPrev();
                break;

            case KEYPAD_MAPPING_TAP:
                $scope.radioSelectTap();
                break;
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
        return "---";
    }

    addEventListener("keypad", keypadEventListener);
    /**
     * Keypad composer
     */
    $scope.toggleKeypad = function (radio) {
        $scope.radioList[radio.index].keypadVisible = !$scope.radioList[radio.index].keypadVisible;
        if ($scope.radioList[radio.index].keypadVisible == true) {
            $scope.radioList[radio.index].keypadDigitIndex = 1;
            $scope.radioList[radio.index].standby = "1--.---";
            // ng-if div is not present
            //if(true) {
            window.setTimeout(() => {
                var div = document.getElementById("radio_keypad_" + radio.index);
                if (div !== undefined && div != null) {
                    /*
                    div.parentElement.parentElement.parentElement.parentElement.scrollTo({
                        top: div.getBoundingClientRect().top,
                        left: div.getBoundingClientRect().left,
                        behavior: "smooth",
                    });
                    */
                    div.scrollIntoView({ behavior: "instant", block: "end", inline: "nearest" });
                }
            }
            , 10);
        }
    }

    $scope.digitKeypad = function (radio, digit) {

        if ($scope.radioList[radio.index].keypadVisible == true) {
            switch ($scope.radioList[radio.index].keypadDigitIndex) {
                case 1:
                    if (digit != 1 && digit != 2 && digit != 3) {
                        return;
                    }
                    break;
                case 6:
                    if (digit != 0 && digit != 5) {
                        return;
                    }
                    break;

            }


            if ($scope.radioList[radio.index].keypadDigitIndex < 7) {
                if ($scope.radioList[radio.index].keypadDigitIndex == 1) {
                    $scope.radioList[radio.index].standby = "1--.---";
                }
                $scope.radioList[radio.index].standby =
                    $scope.radioList[radio.index].standby.slice(0, $scope.radioList[radio.index].keypadDigitIndex)
                    + digit +
                    $scope.radioList[radio.index].standby.slice($scope.radioList[radio.index].keypadDigitIndex + 1)
                    ;
                $scope.radioList[radio.index].keypadDigitIndex++;
                if ($scope.radioList[radio.index].keypadDigitIndex == 3) {
                    $scope.radioList[radio.index].keypadDigitIndex++;
                }
            }
            if ($scope.radioList[radio.index].keypadDigitIndex > 6) {
                $scope.radioList[radio.index].standbyLabel = $scope.radioFindFrequency($scope.radioList[radio.index].standby);
                $scope.radioList[radio.index].keypadDigitIndex = 1;
                $scope.radioApply(radio.index);
            }
        }
    }

    /**
     * Nearby and Search
     */
    $scope.nearby = [];

    $scope.search = function(radio) {
        $scope.radioList[radio.index].searchEnabled = !$scope.radioList[radio.index].searchEnabled;
    }

    $scope.setFrequency = function(radio,frequency,label) {
        $scope.radioList[radio.index].standby = frequency;
        $scope.radioList[radio.index].standbyLabel = label;
        $scope.radioApply(radio.index);
    }

    function convertAirFieldDBToAirFrequencies(airfieldDataset,frequencyDB) {
        const orig = {
            Lat: $scope.situation.GPSLatitude,
            Lon: $scope.situation.GPSLongitude
        }

        var airfieldDatasetSorted = [];
        for (var index = 0; index < airfieldDataset.length; index++) {
            if (airfieldDataset[index].hasOwnProperty("freq") && airfieldDataset[index]["freq"].length > 0) {
                var pointDistance = $scope.calcDistance(
                    orig.Lat,
                    orig.Lon,
                    airfieldDataset[index].Lat,
                    airfieldDataset[index].Lon
                )

                airfieldDataset[index].dist = parseInt(pointDistance);
                if (pointDistance < 200) {
                    airfieldDatasetSorted.push(airfieldDataset[index]);
                }
            }
        }
        airfieldDatasetSorted.sort((a, b) => a.dist - b.dist);
        airfieldDataset = airfieldDatasetSorted;
        $scope.nearby = [];
        var nearbyDictionary = {};
        for (var index = 0; index < airfieldDataset.length; index++) {
            if (nearbyDictionary.hasOwnProperty(airfieldDataset[index].freq)) {
                continue;
            }
            $scope.nearby.push(airfieldDataset[index]);
            nearbyDictionary[airfieldDataset[index].freq] = true;
            if ($scope.nearby.length > 10) {
                break;
            }
        }

        // TODO: db.frequencies.json shall be changed from dictionary to array
        var frequencyDBFreqs = Object.keys(frequencyDB.global);
        for (var f = 0; f < frequencyDBFreqs.length; f++) {
            var freq = frequencyDBFreqs[f];
            var item = frequencyDB.global[freq];
            var pointDistance = $scope.calcDistance(
                    orig.Lat,
                    orig.Lon,
                    item.gps.lat,
                    item.gps.lon
                )

                item.dist = parseInt(pointDistance);
                if (pointDistance < 200) {
                    item.freq=freq;
                    $scope.nearby.push(item);
                }
        }

        $scope.nearby .sort((a, b) => a.dist - b.dist);

        airfieldDataset.forEach((airfield) => {
            if (airfield.hasOwnProperty("freq") && airfield["freq"].length > 0) {
                // TODO: use the GPS position to match the nearest
                var comps = airfield["freq"].split(".");
                var freq =  airfield["freq"].padEnd(7, "0");
                if(comps == 1){
                    // bad cases where input frequency is "118"
                    freq =  (airfield["freq"]+".").padEnd(7, "0");
                }
                // skip duplicates since we already sorted it
                if(frequencyDB.global.hasOwnProperty(freq)){
                    return;
                }
                frequencyDB.global[freq] = {
                    "gps": {
                        "lat": airfield["Lat"],
                        "lon": airfield["Lon"],
                        "dist": airfield["dist"],
                        "range": 50000
                    },
                    "name": airfield["name"]
                };
            }
        });
        return frequencyDB;
    }

    // TODO: unify the code with Airfields
    $scope.calcDistance = function (lat1, lon1, lat2, lon2) {
        return distance(lon1, lat1, lon2, lat2) / 1.852;
    }

    $scope.situation = {GPSLatitude:0,GPSLongitude:0};

    $scope.calculateDistanceFromAirfields = function () {
            for (var y = 0; y < $scope.db.length; y++) {
                var orig = {
                    Lat:$scope.situation.GPSLatitude,
                    Lon:$scope.situation.GPSLongitude
                }
                var point = $scope.db[y];
                var pointDistance = $scope.calcDistance(
                    orig.Lat,
                    orig.Lon,
                    point.Lat,
                    point.Lon
                )

                $scope.db[y].dist = pointDistance;
            }
    }


    $scope.refreshLabels = function () {

        for(var index=0;index<$scope.radioList.length;index++){
           $scope.radioList[index].standbyLabel = $scope.radioFindFrequency($scope.radioList[index].standby);
           $scope.radioList[index].label = $scope.radioFindFrequency($scope.radioList[index].active);
        }
    }
    // Try to wait for situation update, this will allow to calculate also the first point
    function situationUpdated(event) {

		if (($scope === undefined) || ($scope === null)) {
			removeEventListener("SituationUpdated", situationUpdated);
			return; // we are getting called once after clicking away from the status page
		}
        $scope.situation = event.detail;
        if($scope.situation.GPSLatitude != 0 && $scope.situation.GPSLongitude != 0 ) {
        // when database is ready we load labels
            $scope.radioDBReload();
            removeEventListener("SituationUpdated", situationUpdated);
        }
	}

    addEventListener("SituationUpdated", situationUpdated);    

    $scope.radioDBReload = function () {
        // Load the Radio DB, format:
        $http.get(URL_RADIO_DB_GET).then(function (response) {
            var db = angular.fromJson(response.data);
            if (db === undefined || Object.keys(db).length == 0) {
                return;
            }
            $scope.db = db;
            $http.get(URL_AIRFIELDS_GET).then(function (response) {
                var airfields = angular.fromJson(response.data);
                if (airfields === undefined || Object.keys(airfields).length == 0) {

                }
                else {
                    if($scope.situation.GPSLatitude==0){
                        // too early the GPS is not ready, check for the window
                        if(window.situation !== undefined){
                            $scope.situation = window.situation;
                        }

                    }
                    $scope.db=convertAirFieldDBToAirFrequencies(airfields,$scope.db);
                    $scope.calculateDistanceFromAirfields();
                    // when database is ready we load labels
                    $scope.refreshLabels();
                }
            });
            $scope.playbackReload();
        });
    }

    $scope.playbackCacheCount = 0;

    // TODO: Add WebSocket to avoid Polling
    $scope.playbackReload = function() {
    // Load the Playback:
    $http.get(URL_PLAYBACK_GET).then(function (response) {
        var list = angular.fromJson(response.data);
        if(list === undefined || list.length == 0 || list.length == $scope.playbackCacheCount)
        {
            return;
        }
        $scope.playbackCacheCount = list.length;
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
                if (fn == null || fn == "" || fn == "---") {
                    p.Frequency = f;
                }
                else {
                    p.Frequency = fn;
                }
                // 202060215 Force Frequency for small displays and this does not really help the Pilot
                p.Frequency = f;
            }

            if(listParsed.length%2 == 0){
                p.style = "background-color:#ffffff1a;";
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
      
    if (($scope.tickerPlayback === undefined) || ($scope.tickerPlayback === null)) {
        // TODO: Add a switch on the global configuration
        if (true) {
            $scope.tickerPlayback = window.setInterval($scope.playbackReload, 5000);
        }
    }
}



