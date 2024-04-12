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
    $scope.noSleep = new NoSleep();


    $scope.timers = [];
    $scope.timerTemplate = { "className": "keypadSelectedNo", "name": "", "text": "00:00", timerId: 0, CountDown: 0, Epoch: 0, Status: false, triggered: "", Fired:false};

    $scope.timerCreate = function () {
        $http.put(URL_TIMERS_SET).then(function (response) {
            // do nothing
            console.log(response);
            $scope.refreshTimers();
        }, function (response) {
            // do nothing
        });
    }
    $scope.dropTimer = function (timerId) {
        $http.delete(URL_TIMERS_DEL + "/" + timerId).then(function (response) {
            // do nothing
            console.log(response);
            $scope.refreshTimers();
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
        // play some feedback for the user interaction
        // audioproxy is in index.html
        document.getElementById("audioproxy").autoplay=true;
        document.getElementById("audioproxy").src = "alert.wav";
        document.getElementById("audioproxy").load();
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
        if(timer.Status != TIMER_STATUS_STOPPED)
        {
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
    $scope.timerCountdownIncrease = function (timer,increase) {
        if(timer.CountDown + increase*60 <=0)
        {
            return;
        }
        timer.CountDown += increase*60;
        
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

        /**
         * Currently Selected Timer by the Keypad
         * -2 exit to prev screen
         * -1 focus on clock
         * 0->N-1 Timer selected
         * N focus on Add new Timer
         * N+1 exit to next screen
         */
    $scope.scrollItemCounter = 0;
    // Keypad Navigation
    $scope.timerSelectNext = function () {
        for (var timerId = 0; timerId < $scope.timers.length; timerId++) {
            if ($scope.timers[timerId].className == "keypadSelectedYes") {
                $scope.timers[timerId].className = "keypadSelectedNo";
                if(timerId < $scope.timers.length-1){
                    $scope.timers[timerId + 1].className = "keypadSelectedYes";
                    for (var timerId2 = timerId + 2; timerId2 < $scope.timers.length; timerId2++) {
                        $scope.timers[timerId].className = "keypadSelectedNo";
                    }
                    document.getElementById("timer_" + (timerId + 1)).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                    $scope.$apply();
                    $scope.scrollItemCounter = 0;
                    return;
                }
            }
        }
        $scope.scrollItemCounter++;

        document.getElementById("timer_create").scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        $scope.$apply();

        if ($scope.scrollItemCounter > 2) {
            const proxy = new KeyboardEvent("keypad", { key: "to" });
            dispatchEvent(proxy);
        }

    }

    // Keypad Navigation
    $scope.timerSelectPrev = function () {
        if($scope.scrollItemCounter>0 && $scope.timers.length>0)
        {
            $scope.timers[$scope.timers.length - 1].className = "keypadSelectedYes";
            $scope.$apply();
            $scope.scrollItemCounter = 0;
            return;
        }
        for (var timerId = 1; timerId < $scope.timers.length; timerId++) {
            if ($scope.timers[timerId].className == "keypadSelectedYes") {
                $scope.timers[timerId].className = "keypadSelectedNo";
                if (timerId < 1) {
                    $scope.timers[$scope.timers.length - 1].className == "keypadSelectedYes";
                }
                else {
                    $scope.timers[timerId - 1].className = "keypadSelectedYes";
                    for (var timerId2 = timerId; timerId2 < $scope.timers.length; timerId2++) {
                        $scope.timers[timerId].className = "keypadSelectedNo";
                    }
                    document.getElementById("timer_" + (timerId - 1)).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                    $scope.$apply();
                    $scope.scrollItemCounter = 0;
                    return;
                }
            }
        }
        // if we are here, scroll to Clock
        document.getElementById("timer_clock").scrollIntoView({ behavior: "smooth", block: "end", inline: "end" });
        $scope.scrollItemCounter--;
        if ($scope.scrollItemCounter < -1) {
            const proxy = new KeyboardEvent("keypad", { key: "from" });
            dispatchEvent(proxy);
        }
    }

    // Bridge from servicekeypad
    addEventListener("keypad",keypadEventListener);
    // Keypad Listener with supported keys
    function keypadEventListener(event){
        if (($scope === undefined) || ($scope === null)) {
            removeEventListener("keypad", keypadEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        if (($scope.ticker === undefined) || ($scope.ticker === null)) {
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
                $scope.timerSelectPrev();
                break;
            case "Enter":
            case " ":
            case KEYPAD_MAPPING_TAP:
                if($scope.scrollItemCounter==0)
                {
                for (var timerId = 0; timerId < $scope.timers.length; timerId++) {
                    if ($scope.timers[timerId].className == "keypadSelectedYes") {
                        $scope.timerStart($scope.timers[timerId]);
                    }
                }
            }
            if($scope.scrollItemCounter>0)
            {
                $scope.timerCreate();
            }

                break;
            case "ArrowDown":
            case "ArrowRight":
            case KEYPAD_MAPPING_NEXT:
                $scope.timerSelectNext();
                break;
        }
    }

    /**
     * Timers Business logic
     * @param {*} timerId 
     */
    $scope.timerElaborate = function (timerId) {
        if($scope.timers[timerId].Fired == true)
        {
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
                    if($scope.timers[timerId].Fired == false)
                    {
                        /* This code is commented because servicealerts.js will play the sound
                        // audioproxy is in index.html
                        document.getElementById("audioproxy").autoplay=true;
                        document.getElementById("audioproxy").src = "alert.wav";
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
        $scope.noSleep.disable();
        delete $scope.noSleep;
        clearInterval($scope.ticker);
        delete $scope.ticker;
        removeEventListener("keypad", keypadEventListener);
    };

    /**
     * Restore Timers from RPI
     */
    $scope.refreshTimers = function () {
        $http.get(URL_TIMERS_GET).then(function (response) {
            var status = angular.fromJson(response.data);
            for (var timerId = 0; timerId < status.length; timerId++) {
                if ($scope.timers.length <= timerId) {
                    $scope.timers.push(JSON.parse(JSON.stringify($scope.timerTemplate)));
                }
                if (timerId == 0) {
                    $scope.timers[timerId].className = "keypadSelectedYes";
                }

                $scope.timers[timerId].name = "Timer " + (timerId + 1);
                $scope.timers[timerId].timerId = timerId;
                if (status[timerId].hasOwnProperty("CountDown")) $scope.timers[timerId].CountDown = status[timerId].CountDown;
                if (status[timerId].hasOwnProperty("Epoch")) $scope.timers[timerId].Epoch = status[timerId].Epoch;
                if (status[timerId].hasOwnProperty("Status")) $scope.timers[timerId].Status = status[timerId].Status;
                if (status[timerId].hasOwnProperty("Fired")) $scope.timers[timerId].Fired = status[timerId].Fired;
                $scope.timerElaborate(timerId);
            }
            for (var timerId = $scope.timers.length - 1; timerId >= status.length; timerId--) {
                delete $scope.timers[timerId];
                $scope.timers.splice(timerId, 1);
            }
            $scope.scrollItemCounter=0;
        });
        if (($scope.ticker === undefined) || ($scope.ticker === null)) {

            $scope.ticker = window.setInterval($scope.tick, 1000);
        }
    }
    // Timer init
    $scope.updateClock();
    $scope.refreshTimers();
}
