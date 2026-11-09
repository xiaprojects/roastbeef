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

var RADIO_DRIVER_SDR = "SDR";
// What a radio can tune, in whole MHz. Only the SDR also receives the VOR band
var RADIO_BAND_MIN_MHZ = 118;
var RADIO_BAND_MIN_SDR_MHZ = 108;
var RADIO_BAND_MAX_MHZ = 136;
var RADIO_NAV_MAX_MHZ = 117;
var RADIO_NAV_GRID_KHZ = 50;
// Each POST of a level is also a write of stratux.conf, so a drag sends only where it stops
var RADIO_LEVEL_DEBOUNCE_MS = 250;
// Long enough for the daemon's reply to the last change, so that nothing older moves the slider
var RADIO_LEVEL_HOLD_MS = 1500;
// The sliders, in steps. The daemon takes 0 to 100 for both, but this is the useful range of
// a squelch. Level is the name in POST /radio, active is the daemon's reply on the bridge
var RADIO_LEVELS = {
    "volume": { "max": 100, "step": 10, "level": "VolumeLevel", "active": "sdrradiovolumeactive" },
    "squelch": { "max": 10, "step": 1, "level": "SquelchLevel", "active": "sdrradiosquelchactive" }
};
// What the plate reads from the float bridge, which also carries every other addon's keys
var RADIO_BRIDGE_KEYS = ["sdrradiofreqactive", "sdrradiosecondaryactive", "sdrradiofreqheard",
    "sdrradiovolumeactive", "sdrradiosquelchactive"];
// Where the knob can be inside a radio
var RADIO_KNOB_MHZ = 0;
var RADIO_KNOB_KHZ = 1;
var RADIO_KNOB_VOLUME = 2;
var RADIO_KNOB_SQUELCH = 3;


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

    // The last map of the float bridge: what rb-sdr-radio replies. Absent until it has run
    $scope.bridge = {};

    // One cell per step, 0 included, so that every level has a place to press
    function radioLevelCells(field) {
        var cells = [];
        for (var level = 0; level <= RADIO_LEVELS[field].max; level += RADIO_LEVELS[field].step) {
            cells.push(level);
        }
        return cells;
    }
    $scope.volumeCells = radioLevelCells("volume");
    $scope.squelchCells = radioLevelCells("squelch");
    $scope.radioLevels = RADIO_LEVELS;

    // Which radios show their sliders, by index. On the root scope for the closed copy of this
    // plate in the sidebar: it hears the knob too, and would run off the end of a shorter list
    // and leave the plate while the pilot is on a slider. It also outlives leaving the plate.
    $rootScope.radioLevelsShown = $rootScope.radioLevelsShown || {};

    $state.get('radio').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $scope.radioApply = function(index){
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
            var template = { "className": "keypadSelectedNo", "classStandByLeft": "btn-default", "classStandByRight": "btn-default", "classVolume": "", "classSquelch": "", "name": "", "active": "000.000", "standby": "000.000", "dual": false, "index": 0, "levelHeldUntil": {}, "levelTimer": {} };
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
            template.sdr = status[index]["Driver"] == RADIO_DRIVER_SDR;
            template.storedLevels = { "volume": status[index]["VolumeLevel"], "squelch": status[index]["SquelchLevel"] };
            template.index = index;
            // Check for valid data
            if(template.active.length<1)template.active="118.000";
            if(template.standby.length<1)template.standby="118.000";

            template.label = $scope.radioFindFrequency(template.active);
            template.standbyLabel = $scope.radioFindFrequency(template.standby);
            radioFollowLevels(template);
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

    /**
     * The reply. As on the VOR plate, vorfreq -> vorfreqactive: what is sent is a command,
     * and what is shown is what the receiver says it is on. Only the digits follow it.
     * radio.active stays the pilot's selection, because it is what the next POST sends and
     * a reply arrives about 0.5 s behind a press.
     */
    function radioReplyKhz(radio, key) {
        if (!radio.sdr || !radio.enabled) {
            return 0;
        }
        var khz = Math.round($scope.bridge[key]);
        return khz > 0 ? khz : 0;
    }

    $scope.activeShown = function (radio) {
        var khz = radioReplyKhz(radio, "sdrradiofreqactive");
        if (khz == 0) {
            return radio.active;
        }
        return Math.floor(khz / 1000) + "." + String(khz % 1000).padStart(3, "0");
    }

    $scope.labelShown = function (radio) {
        if (radioReplyKhz(radio, "sdrradiofreqactive") == 0) {
            return radio.label;
        }
        return $scope.radioFindFrequency($scope.activeShown(radio));
    }

    // The channel the audio comes from, which with DUAL on may be the standby
    $scope.isHeard = function (radio, frequency) {
        var khz = radioReplyKhz(radio, "sdrradiofreqheard");
        return khz > 0 && Math.round(parseFloat(frequency) * 1000) == khz;
    }

    // DUAL is on and the radio is not taking turns: a standby that is not a channel, the
    // squelch held open, or a tuner that failed to hop. No key means no daemon has said so
    $scope.dualClass = function (radio) {
        if (radio.sdr && radio.enabled && $scope.bridge["sdrradiosecondaryactive"] === 0) {
            return "label-warning";
        }
        return "label-success";
    }

    /**
     * Volume and squelch. The slider shows the daemon's reply, as the stored level can be a
     * 0 that was never set, with the daemon on its own default.
     */
    function radioFollowLevels(radio) {
        if (!radio.sdr) {
            return;
        }
        Object.keys(RADIO_LEVELS).forEach(function (field) {
            var active = $scope.bridge[RADIO_LEVELS[field].active];
            if (active === radio[field]) {
                radio.levelHeldUntil[field] = 0;
            }
            if (Date.now() >= (radio.levelHeldUntil[field] || 0)) {
                radio[field] = (active === undefined) ? radio.storedLevels[field] : active;
            }
        });
    }

    $scope.toggleLevels = function (radio) {
        var shown = !$rootScope.radioLevelsShown[radio.index];
        $rootScope.radioLevelsShown[radio.index] = shown;
        if (shown) {
            // ng-if has not added them yet, and on the small panels they open below the fold
            window.setTimeout(() => {
                var levels = document.querySelector("[ui-view] #radio_levels_" + radio.index);
                if (levels !== null) {
                    levels.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
                }
            }, 10);
        }
        else {
            radioKnobStayOnAStop();
        }
    }

    $scope.levelChanged = function (radio, field) {
        radio[field] = parseInt(radio[field]);
        radio.levelHeldUntil[field] = Date.now() + RADIO_LEVEL_DEBOUNCE_MS + RADIO_LEVEL_HOLD_MS;
        clearTimeout(radio.levelTimer[field]);
        radio.levelTimer[field] = setTimeout(function () {
            var item = {};
            item[RADIO_LEVELS[field].level] = radio[field];
            $http.post(URL_RADIO_SET + "/" + radio.index, JSON.stringify(item));
        }, RADIO_LEVEL_DEBOUNCE_MS);
    }

    $scope.squelchText = function (radio) {
        return radio.squelch > 0 ? radio.squelch + " dB" : "OPEN";
    }

    function radioStepLevel(radio, field, direction) {
        var level = RADIO_LEVELS[field];
        var value = Math.round(radio[field] / level.step) * level.step + direction * level.step;
        radio[field] = Math.min(level.max, Math.max(0, value));
        $scope.levelChanged(radio, field);
    }

    function radioBridgeReceived(bridge) {
        $scope.bridge = bridge;
        $scope.radioList.forEach(radioFollowLevels);
    }

    // The socket says nothing on connect, only after a change
    $http.get(URL_BRIDGE_FLOAT_SET).then(function (response) {
        var bridge = angular.fromJson(response.data);
        if (bridge !== undefined && bridge !== null) {
            radioBridgeReceived(bridge);
        }
    });

    function bridgeUpdatedEventListener(event) {
        if (($scope === undefined) || ($scope === null)) {
            removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        // The closed copy of this plate in the sidebar is alive on every screen, and a digest
        // redraws all of them: the engine's frames must not pay for a radio nobody is reading
        if (RADIO_BRIDGE_KEYS.some((key) => event.detail[key] !== $scope.bridge[key])) {
            radioBridgeReceived(event.detail);
            $scope.$apply(); // trigger any needed refreshing of data
        }
    }
    addEventListener("BridgeUpdated", bridgeUpdatedEventListener);

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

    // Enabling one radio disables the others: the daemon does that, the refresh shows it
    $scope.enableRadio = function (radio, enabled) {
        $scope.radioList[radio.index].enabled = enabled;

        $scope.radioApply(radio.index);
    }

    $scope.increaseFreq = function (radio, increase) {
        increase = parseInt(increase);
        var mhz = $scope.radioList[radio.index].standby.split(".")[0];
        var khz = $scope.radioList[radio.index].standby.split(".")[1];
        var bandMin = radio.sdr ? RADIO_BAND_MIN_SDR_MHZ : RADIO_BAND_MIN_MHZ;
        if (Number.isNaN(parseInt(khz))) khz = 0;
        if (Number.isNaN(parseInt(mhz)) || parseInt(mhz) < bandMin) mhz = RADIO_BAND_MIN_MHZ;
        var mhzFinal = parseInt(mhz);
        var stepsMhz = increase >= 1000 || increase <= -1000;
        if (stepsMhz) {
            mhzFinal = Math.min(RADIO_BAND_MAX_MHZ, Math.max(bandMin, mhzFinal + increase / 1000));
        }
        // The digits are a fraction on the way in (118.7 is 700) and a number on the way
        // out (30 is 118.030). The kHz wrap inside the MHz, in both directions.
        var khzValue = parseInt((""+khz).padEnd(3,"0"));
        if (mhzFinal <= RADIO_NAV_MAX_MHZ) {
            // The VOR band has only the 50 kHz grid: ten presses of 5 kHz per channel
            khzValue -= khzValue % RADIO_NAV_GRID_KHZ;
            if (!stepsMhz) increase = Math.sign(increase) * RADIO_NAV_GRID_KHZ;
        }
        khzValue += increase % 1000;
        var khzFinal = String((khzValue + 1000) % 1000).padStart(3,"0");
        $scope.radioList[radio.index].standby = mhzFinal + "." + khzFinal;
        $scope.radioList[radio.index].standbyLabel = $scope.radioFindFrequency($scope.radioList[radio.index].standby);

        $scope.radioApply(radio.index);
    }

    $state.get('radio').onEnter = function () {
        // everything gets handled correctly by the controller

    };

    $state.get('radio').onExit = function () {
        removeEventListener("RadioUpdated", radioUpdateEventListener);
        removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
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
        radioKnobStayOnAStop();
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
                $scope.radioList[x].classVolume = "";
                $scope.radioList[x].classSquelch = "";
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
            $scope.radioList[x].className = (x == index) ? "keypadSelectedYes" : "keypadSelectedNo";
            var here = (x == index) ? right : -1;
            $scope.radioList[x].classStandByLeft = (here == RADIO_KNOB_MHZ) ? on : off;
            $scope.radioList[x].classStandByRight = (here == RADIO_KNOB_KHZ) ? on : off;
            $scope.radioList[x].classVolume = (here == RADIO_KNOB_VOLUME) ? on : "";
            $scope.radioList[x].classSquelch = (here == RADIO_KNOB_SQUELCH) ? on : "";
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

    // The last place the knob stops at inside an item: a playback row has two, as ever. A
    // hidden slider is not a stop: the knob would change a level nobody can see.
    function radioLastKnobStop(radio) {
        return (radio !== undefined && radio.sdr && $rootScope.radioLevelsShown[radio.index])
            ? RADIO_KNOB_SQUELCH : RADIO_KNOB_KHZ;
    }

    // For both copies of the plate: only one of them saw the button
    function radioKnobStayOnAStop() {
        var last = radioLastKnobStop($scope.radioList[$scope.scrollItemCounter]);
        if ($scope.scrollItemRight > last) {
            $scope.scrollItemRight = last;
            $scope.scrollItemSelected = false;
            $scope.radioSelectByIndex($scope.scrollItemCounter, $scope.scrollItemRight, $scope.scrollItemSelected);
        }
    }

    function radioKnobTurn(direction) {
        var radio = $scope.radioList[$scope.scrollItemCounter];
        switch ($scope.scrollItemRight) {
            case RADIO_KNOB_VOLUME:
                radioStepLevel(radio, "volume", direction);
                break;
            case RADIO_KNOB_SQUELCH:
                radioStepLevel(radio, "squelch", direction);
                break;
            default:
                $scope.increaseFreq(radio, ($scope.scrollItemRight == RADIO_KNOB_KHZ ? 5 : 1000) * direction);
        }
        $scope.$apply();
    }

    // The sliders sit below the fold on the small panels. By the routed plate, as the closed
    // sidebar holds a second copy with the same ids
    function radioShowKnobStop() {
        if ($scope.scrollItemRight >= RADIO_KNOB_VOLUME) {
            var row = document.querySelector("[ui-view] #radio_level_" + $scope.scrollItemCounter + "_" + $scope.scrollItemRight);
            if (row !== null) {
                row.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
            }
        }
    }

    $scope.radioSelectNext = function () {
        if ($scope.scrollItemSelected) {
            radioKnobTurn(1);
        }
        else {
            if ($scope.scrollItemRight >= radioLastKnobStop($scope.radioList[$scope.scrollItemCounter])) {
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
                radioShowKnobStop();
                $scope.$apply();
            }
        }


    }

    $scope.radioSelectPrev = function () {
        if ($scope.scrollItemSelected) {
            radioKnobTurn(-1);
        }
        else {
            if ($scope.scrollItemRight < 1) {
                $scope.scrollItemCounter--;
                $scope.scrollItemRight = radioLastKnobStop($scope.radioList[$scope.scrollItemCounter]);
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
                radioShowKnobStop();
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

    // What the next digit can be, from the digits typed so far: the index is a place in
    // "1--.---". An SDR also takes the VOR band, 108 to 117 on a 50 kHz grid.
    $scope.keypadAllows = function (radio, digit) {
        var entry = radio.keypadDigitIndex;
        var typed = radio.standby;
        if (entry == 1) {
            return digit == 1 || digit == 2 || digit == 3 || (digit == 0 && radio.sdr == true);
        }
        if (entry == 2 && typed[1] == "0") {
            return digit == 8 || digit == 9;
        }
        var nav = radio.sdr == true && parseInt(typed) <= RADIO_NAV_MAX_MHZ;
        if (entry == 5 && nav) {
            return digit == 0 || digit == 5;
        }
        if (entry == 6) {
            return digit == 0 || (digit == 5 && !nav);
        }
        return true;
    }

    $scope.digitKeypad = function (radio, digit) {

        if ($scope.radioList[radio.index].keypadVisible == true) {
            if (!$scope.keypadAllows($scope.radioList[radio.index], digit)) {
                return;
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
        // Performance improvements
        const MAX_PLAYBACK_ITEMS = 20;
        var shortList = [];
        for(var reverseIndex =  list.length - 1; reverseIndex>=0; reverseIndex--){
            if(list[reverseIndex].Name.startsWith("vrin") || list[reverseIndex].Name.startsWith("radio")){
                shortList.push(list[reverseIndex]);
                if(shortList.length>=MAX_PLAYBACK_ITEMS){
                    break;
                }
            }
        }
        list = shortList;

        list.sort((a, b) => new Date(a.ModTime) - new Date(b.ModTime));
        $scope.playbackCacheCount = list.length;
        // {"Name":"radio_20240607_051225_130000000.mp3","Source":"RTL","Path":"/playback/radio_20240607_051225_130000000.mp3","Size":12380,"ModTime":"2024-06-07T06:12:30.20311712+01:00","Frequency":""}
        var listParsed = [];
        for (var i = list.length - 1; i >= 0; i--) {
            var p = list[i];
            if(p.Path.split(".").pop() == "wav"){
                p.Duration = parseInt(p.Size / 30000);
            } else {
            p.Duration = parseInt(p.Size / 3000);
            }
            //if(p.Duration<2)continue;
            
            if (p.Frequency == "") {
                if(p.Path.split("_").length == 4) {
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
                } else {
                    p.Frequency = (p.Path.split("/").pop()).split("_")[0];
                }
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



