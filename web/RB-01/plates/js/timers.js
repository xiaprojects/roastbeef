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
    timers.js: Timers interface
    The list comes from TimersService (/timers/ws) on every change, the seconds are
    counted here: the 1 s tick only redraws, it never asks the daemon
*/
angular.module('appControllers').controller('TimersCtrl', TimersCtrl); // get the main module controllers set
TimersCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

// REST Protocol
var URL_TIMERS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/timers";
var URL_TIMERS_SET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/timers";
var URL_TIMERS_DEL = URL_HOST_PROTOCOL + URL_HOST_BASE + "/timers";

// const timers.go:30
var TIMER_STATUS_STOPPED = false;
var TIMER_STATUS_RUNNING = true;

// Shared Routines alerts.js
//function textBySeconds(seconds) {}

// create our controller function with all necessary logic
function TimersCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.$parent.helppage = 'plates/timers-help.html';
    $scope.data_list = [];
    /*
        $scope.noSleep = new NoSleep();
    */

    $scope.timers = [];
    $scope.timerTemplate = { "name": "", "text": "00:00", timerId: 0, CountDown: 0, Epoch: 0, Status: false, triggered: "", Fired: false };

    $scope.timerCreate = function () {
        // The answer is the new list, /timers/ws brings it too
        $http.put(URL_TIMERS_SET).then(function (response) {
            $scope.applyTimers(angular.fromJson(response.data));
        }, function (response) {
            // do nothing
        });
    }
    $scope.dropTimer = function (timerId) {
        $http.delete(URL_TIMERS_DEL + "/" + timerId).then(function (response) {
            $scope.applyTimers(angular.fromJson(response.data));
        }, function (response) {
            // do nothing
        });
    }

    $scope.setTimers = function (timer) {
        var msg = angular.toJson({
            [timer.timerId]: timer
        });
        $http.post(URL_TIMERS_SET, msg).then(function (response) {
            // do nothing
        }, function (response) {
            // do nothing
        });
    }

    $scope.timerStart = function (timer) {
        switch (timer.Status) {
            case TIMER_STATUS_RUNNING:
                timer.Status = TIMER_STATUS_STOPPED;
                break;
            case TIMER_STATUS_STOPPED:
                timer.Status = TIMER_STATUS_RUNNING;
                // TODO Pause? timer.Epoch = Math.floor(new Date() / 1000);
                break;
        }
        timer.triggered = "";
        timer.Epoch = Math.floor(new Date() / 1000);
        timer.Fired = false;
        $scope.timers[timer.timerId] = timer;
        $scope.setTimers(timer);
        if (document.getElementById("audioproxy") === undefined
            || document.getElementById("audioproxy") === false
            || document.getElementById("audioproxy") == null) {
            // DOM is not ready or Audio in not enabled on the browser (ex.:Round display)
        }
        else {
            // play some feedback for the user interaction
            // audioproxy is in index.html
            document.getElementById("audioproxy").autoplay = true;
            document.getElementById("audioproxy").src = "sounds/timer.mp3";
            document.getElementById("audioproxy").load();
        }
    }
    $scope.timerReset = function (timer) {
        timer.triggered = "";
        timer.Fired = false;
        timer.Epoch = 0;
        timer.Status = TIMER_STATUS_STOPPED;
        $scope.timers[timer.timerId] = timer;
        $scope.timers[timer.timerId].text = textBySeconds(0);
        $scope.setTimers(timer);
    }

    /**
     * timerSwitch between Chrono and Timer
     * @param {*} timer 
     * @returns 
     */
    $scope.timerSwitch = function (timer) {
        if (timer.Status != TIMER_STATUS_STOPPED) {
            return;
        }
        timer.Status = TIMER_STATUS_STOPPED;
        timer.Epoch = 0;
        if (timer.CountDown > 0) {
            timer.CountDown = 0;
        }
        else {
            timer.CountDown = 20 * 60;
        }
        timer.triggered = "";
        timer.Fired = false;
        timer.text = textBySeconds(timer.CountDown);
        $scope.timers[timer.timerId] = timer;
        $scope.setTimers(timer);
    }
    /**
     * +5 and -5
     * @param {*} timer 
     * @param {*} increase - minutes
     * @returns 
     */
    $scope.timerCountdownIncrease = function (timer, increase) {
        if (timer.CountDown + increase * 60 <= 0) {
            return;
        }
        timer.CountDown += increase * 60;

        timer.text = textBySeconds(timer.CountDown);
        $scope.timers[timer.timerId] = timer;
        $scope.setTimers(timer);
    }


    /*
        Keypad Services
        Knob Conf
        <- 1 (2) 3->
        C
        B
        A
    */

    // The knob: per timer START/STOP, mode, -5, +5 and last DELETE, so that NEXT, NEXT, TAP
    // by habit cannot reach it; then "Create new timer". TAP is a touch on the button. Hidden
    // and disabled buttons are not stops (docs/tech-debt/keypad-page-navigation.md 3.4)
    $scope.keypadFocus = new KeypadFocus($scope, $state, "timers");

    /**
     * Timers Business logic
     * @param {*} timerId 
     */
    $scope.timerElaborate = function (timerId) {
        if ($scope.timers[timerId].Fired == true) {
            $scope.timers[timerId].triggered = "timerTriggered";
        }
        if ($scope.timers[timerId].CountDown > 0) {
            if ($scope.timers[timerId].Epoch == 0) {
                $scope.timers[timerId].text = textBySeconds($scope.timers[timerId].CountDown);
            }
            else {
                var remaining = $scope.timers[timerId].Epoch + $scope.timers[timerId].CountDown - Math.floor(Date.now() / 1000);//$scope.timers[timerId].Seconds;
                if (remaining > 0) {
                    $scope.timers[timerId].text = textBySeconds(remaining);

                }
                else {
                    // Trigger Alert only the first time
                    if ($scope.timers[timerId].Fired == false) {
                        /* This code is commented because servicealerts.js will play the sound
                        // audioproxy is in index.html
                        document.getElementById("audioproxy").autoplay=true;
                        document.getElementById("audioproxy").src = "timer.mp3";
                        document.getElementById("audioproxy").load();
                        */

                        $scope.timers[timerId].triggered = "timerTriggered";
                        $scope.timers[timerId].Fired = true;
                    }
                    $scope.timers[timerId].text = textBySeconds($scope.timers[timerId].CountDown);
                }
            }
        }
        else {
            if ($scope.timers[timerId].Epoch == 0) {
                $scope.timers[timerId].text = "00:00";
            }
            else {
                $scope.timers[timerId].text = textBySeconds(Math.floor(Date.now() / 1000) - $scope.timers[timerId].Epoch);
            }
        }
    }

    // Current UTC Clock Angular variable
    $scope.clockText = "";
    // Generator UTC Clock
    $scope.updateClock = function () {
        date = new Date;
        $scope.clockText = textBySeconds(date.getUTCHours() * 60 * 60 + date.getUTCMinutes() * 60 + date.getUTCSeconds());
    }

    /**
     * Frontend "thread"
     * Update the clock
     * Check for "fired" timers
     */
    $scope.tick = function () {
        //console.log("Timers Tick...")
        if (($scope === undefined) || ($scope === null)) {
            console.log(this);
            return; // we are getting called once after clicking away from the status page
        }
        if (($scope.ticker === undefined) || ($scope.ticker === null)) {
            console.log(this);
            return; // we are getting called once after clicking away from the status page
        }
        //console.log("Timers Tick... active")
        for (var timerId = 0; timerId < $scope.timers.length; timerId++) {
            if ($scope.timers[timerId].Status > 0) {
                //$scope.timers[timerId].Seconds++;
                $scope.timerElaborate(timerId);
            }
        }
        $scope.updateClock();
        $scope.$apply();
    }

    $state.get('timers').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('timers').onExit = function () {
        /*
                $scope.noSleep.disable();
                delete $scope.noSleep;
        */
        clearInterval($scope.ticker);
        delete $scope.ticker;
    };

    /**
     * applyTimers: show the list of the daemon
     * @param {*} status - The list as GET /timers and /timers/ws send it; anything else is ignored
     */
    $scope.applyTimers = function (status) {
        if (!Array.isArray(status)) {
            return;
        }
        for (var timerId = 0; timerId < status.length; timerId++) {
            if ($scope.timers.length <= timerId) {
                $scope.timers.push(JSON.parse(JSON.stringify($scope.timerTemplate)));
            }
            $scope.timers[timerId].name = "Timer " + (timerId + 1);
            $scope.timers[timerId].timerId = timerId;
            if (status[timerId].hasOwnProperty("CountDown")) $scope.timers[timerId].CountDown = status[timerId].CountDown;
            if (status[timerId].hasOwnProperty("Epoch")) $scope.timers[timerId].Epoch = status[timerId].Epoch;
            if (status[timerId].hasOwnProperty("Status")) $scope.timers[timerId].Status = status[timerId].Status;
            if (status[timerId].hasOwnProperty("Fired")) $scope.timers[timerId].Fired = status[timerId].Fired;
            // A reset on another display clears the red here too
            $scope.timers[timerId].triggered = $scope.timers[timerId].Fired ? "timerTriggered" : "";
            $scope.timerElaborate(timerId);
        }
        $scope.timers.splice(status.length);
    }

    /**
     * Restore Timers from RPI, for a plate opened before the socket brought the list
     */
    $scope.refreshTimers = function () {
        $http.get(URL_TIMERS_GET).then(function (response) {
            $scope.applyTimers(angular.fromJson(response.data));
        });
    }

    // Every change of the daemon: another display, the voice, a countdown that fired
    function timersUpdated(event) {
        $scope.$evalAsync(function () {
            $scope.applyTimers(event.detail);
        });
    }
    addEventListener("TimersUpdated", timersUpdated);
    $scope.$on('$destroy', function () {
        removeEventListener("TimersUpdated", timersUpdated);
    });

    // Timer init
    $scope.updateClock();
    if (Array.isArray($scope.timersList)) {
        $scope.applyTimers($scope.timersList);
    } else {
        $scope.refreshTimers();
    }
    if (($scope.ticker === undefined) || ($scope.ticker === null)) {
        $scope.ticker = window.setInterval($scope.tick, 1000);
    }
}