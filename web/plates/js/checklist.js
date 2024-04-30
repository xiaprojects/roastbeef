/*
    Copyright (c) 2023 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    checklist.js: Checklist interface
*/

angular.module('appControllers').controller('CheckCtrl', CheckCtrl); // get the main module controllers set
CheckCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies


var URL_CHECKLIST_SET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/checklist/default/status";
var URL_CHECKLIST_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/checklist/default/status";
var URL_CHECKLIST_WRITE = URL_HOST_PROTOCOL + URL_HOST_BASE + "/checklist/default/status";
var URL_CHECKLIST_RESET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/checklist/default/status";

// create our controller function with all necessary logic
function CheckCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.$parent.helppage = 'plates/checklist-help.html';
    $scope.data_list = [];
    $scope.scrollItemCounter = 0;

    $scope.checklistValues = [
        { "value": "todo", "text": "CHECK" },
        { "value": "pass", "text": "PASS" },
        { "value": "skip", "text": "SKIP" },
        { "value": "fail", "text": "FAIL" },
        { "value": "test", "text": "TODO" }
    ];


    $state.get('checklist').onEnter = function () {
        // everything gets handled correctly by the controller

    };

    $state.get('checklist').onExit = function () {
        removeEventListener("keypad", keypadEventListener);

        if (($scope.socket !== undefined) && ($scope.socket !== null)) {
            $scope.socket.close();
            $scope.socket = null;
        }
    };



    $scope.updateStatusForItem = function (check) {
        check.date = new Date().toISOString()
        check.dateParsed = textBySeconds(new Date(check.date).getHours() * 60 + new Date(check.date).getMinutes());
        var msg = JSON.stringify($scope.data_list);
        $http.post(URL_CHECKLIST_SET, msg).then(function (response) {
            // do nothing
        }, function (response) {
            // do nothing
        });
        return check;
    }




    $scope.checklistSelectNext = function () {
        for (var groupId = 0; groupId < $scope.data_list.length; groupId++) {
            for (var checkId = 0; checkId < $scope.data_list[groupId].items.length; checkId++) {
                if ($scope.data_list[groupId].items[checkId].isselected == "keypadSelectedYes") {
                    if (checkId == $scope.data_list[groupId].items.length - 1) {
                        if (groupId < $scope.data_list.length - 1) {
                            $scope.data_list[groupId].items[checkId].isselected = "keypadSelectedNo";
                            $scope.data_list[groupId + 1].items[0].isselected = "keypadSelectedYes";
                            $scope.$apply();
                            $scope.scrollItemCounter = 0;
                            return;
                        }
                        else {

                        }
                    }
                    else {
                        $scope.data_list[groupId].items[checkId].isselected = "keypadSelectedNo";
                        $scope.data_list[groupId].items[checkId + 1].isselected = "keypadSelectedYes";

                        document.getElementById("status_" + (checkId + 1)).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                        $scope.$apply();
                        $scope.scrollItemCounter = 0;
                        return;
                    }
                }
            }
        }
        $scope.scrollItemCounter++;
        if ($scope.scrollItemCounter > 1) {
            const proxy = new KeyboardEvent("keypad", { key: "to" });
            dispatchEvent(proxy);
        }
    }


    $scope.checklistSelectPrev = function () {
        for (var groupId = 0; groupId < $scope.data_list.length; groupId++) {
            for (var checkId = 0; checkId < $scope.data_list[groupId].items.length; checkId++) {
                if ($scope.data_list[groupId].items[checkId].isselected == "keypadSelectedYes") {

                    if (checkId == 0) {
                        if (groupId > 0) {
                            $scope.data_list[groupId].items[checkId].isselected = "keypadSelectedNo";
                            $scope.data_list[groupId - 1].items[$scope.data_list[groupId - 1].items.length - 1].isselected = "keypadSelectedYes";
                            $scope.$apply();
                            $scope.scrollItemCounter = 0;
                            return;
                        }
                    }
                    else {


                        $scope.data_list[groupId].items[checkId].isselected = "keypadSelectedNo";
                        $scope.data_list[groupId].items[checkId - 1].isselected = "keypadSelectedYes";

                        document.getElementById("status_" + (checkId - 1)).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                        $scope.$apply();
                        $scope.scrollItemCounter = 0;
                        return;
                    }

                }
            }
        }
        $scope.scrollItemCounter--;
        if ($scope.scrollItemCounter < -1) {
            const proxy = new KeyboardEvent("keypad", { key: "from" });
            dispatchEvent(proxy);
        }
    }

    $scope.storeChoice = function (groupId, checkId, valueId) {
        var msg = angular.toJson({
            "group": groupId,
            "check": checkId,
            "value": valueId
        });
        $http.post(URL_CHECKLIST_SET, msg).then(function (response) {
            // do nothing
        }, function (response) {
            // do nothing
        });
    }


    $scope.cycleStatus = function (groupId, checkId) {
        for (var valueId = 0; valueId < $scope.checklistValues.length; valueId++) {

            if ($scope.data_list[groupId].items[checkId].value == $scope.checklistValues[valueId].value) {
                if (valueId < $scope.checklistValues.length - 1) {
                    $scope.data_list[groupId].items[checkId].value = $scope.checklistValues[valueId + 1].value
                    $scope.updateStatusForItem($scope.data_list[groupId].items[checkId]);
                    break;

                }
                else {
                    $scope.data_list[groupId].items[checkId].value = $scope.checklistValues[0].value
                    $scope.updateStatusForItem($scope.data_list[groupId].items[checkId]);
                    break;
                }

            }
        }
    }



    // Bridge from servicekeypad
    addEventListener("keypad",keypadEventListener);
    // Keypad Listener with supported keys
    function keypadEventListener(event){
        if (($scope === undefined) || ($scope === null)) {
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
            case "ArrowLeft":
            case "ArrowUp":
            case KEYPAD_MAPPING_PREV:
                $scope.checklistSelectPrev();
                break;
            case "Space":
            case "Enter":
            case KEYPAD_MAPPING_TAP:
                for (var groupId = 0; groupId < $scope.data_list.length; groupId++) {
                    for (var checkId = 0; checkId < $scope.data_list[groupId].items.length; checkId++) {
                        if ($scope.data_list[groupId].items[checkId].isselected == "keypadSelectedYes") {
                            $scope.cycleStatus(groupId, checkId);
                        }
                    }
                }
                $scope.$apply();
                break;
            case "ArrowRight":
            case "ArrowDown":
            case KEYPAD_MAPPING_NEXT:
                $scope.checklistSelectNext();
                break;
        }
    }



    $scope.refreshChecklist = function () {
        $http.get(URL_CHECKLIST_GET).then(function (response) {
            var status = angular.fromJson(response.data);
            if (status.length > 0) {
                $scope.data_list = status;
            }
            /* Future roadmap: merge the status of single check instead of passing the whole list
            for(var checkListStatusIndex = 0; checkListStatusIndex < status.length; checkListStatusIndex++)
            {
                var checkListStatus = status[checkListStatusIndex];
                if(checkListStatus.group <= $scope.data_list.length)
                {
                    if(checkListStatus.check <= $scope.data_list[checkListStatus.group].items.length)
                    {
                        $scope.data_list[checkListStatus.group].items[checkListStatus.check].value = checkListStatus.value;
                        $scope.updateStatusForItem($scope.data_list[checkListStatus.group].items[checkListStatus.check]);
                    }
                }
            }
            */
        });
    }
    $scope.refreshChecklist();
}
