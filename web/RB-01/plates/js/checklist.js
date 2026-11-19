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

    checklist.js: Checklist interface
*/

angular.module('appControllers').controller('CheckCtrl', CheckCtrl); // get the main module controllers set

// Check values in bridge order: CHECKLIST_{SECTION}_{INDEX} carries the position in this list
var CHECKLIST_BRIDGE_VALUES = ["todo", "pass", "skip", "fail", "test"];
// A check counts as completed when PASS or SKIP
var CHECKLIST_COMPLETED_VALUES = ["pass", "skip"];

function checklistValueIndex(value) {
    return CHECKLIST_BRIDGE_VALUES.indexOf(value);
}
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



    $scope.updateStatusForItem = function (check, groupId, checkId) {
        check.date = new Date().toISOString()
        check.dateParsed = textBySeconds(new Date(check.date).getHours() * 60 + new Date(check.date).getMinutes());
        var msg = JSON.stringify($scope.data_list);
        $http.post(URL_CHECKLIST_SET, msg).then(function (response) {
            // do nothing
        }, function (response) {
            // do nothing
        });
        $scope.postBridgeValue(check, groupId, checkId);
        return check;
    }

    // Publish one check on the bridge: "CHECKLIST_{SECTION}_{INDEX}" = position of the
    // value in checklistValues (0 todo, 1 pass, 2 skip, 3 fail, 4 test).
    // The aircraft page counts the completed checks from these keys.
    $scope.postBridgeValue = function (check, groupId, checkId) {
        if (groupId === undefined || checkId === undefined) {
            return;
        }
        var valueId = checklistValueIndex(check.value);
        if (valueId < 0) {
            return;
        }
        var msg = {};
        msg["CHECKLIST_" + groupId + "_" + checkId] = valueId;
        $http.post(URL_BRIDGE_FLOAT_SET, JSON.stringify(msg)).then(function (response) {
            // do nothing
        }, function (response) {
            // do nothing
        });
    }




    // The knob's place: a row of the checklist, {group, item}. Kept here and not in the checks'
    // own isselected, which is saved with the checklist: the place would go to the daemon on
    // every TAP, be shared by every display, light several rows, or none on a checklist saved
    // without one. On the root scope, so that the pilot comes back to the row they left.
    // docs/tech-debt/keypad-page-navigation.md
    $rootScope.checklistKnob = $rootScope.checklistKnob || { group: 0, item: 0 };

    // Every row the knob stops at, in reading order
    function checklistKnobStops() {
        var stops = [];
        for (var groupId = 0; groupId < $scope.data_list.length; groupId++) {
            var items = $scope.data_list[groupId].items || [];
            for (var checkId = 0; checkId < items.length; checkId++) {
                stops.push({ group: groupId, item: checkId });
            }
        }
        return stops;
    }

    // Where the knob is in the list; a checklist that changed under it keeps it on a row
    function checklistKnobIndex(stops) {
        var knob = $rootScope.checklistKnob;
        var here = stops.findIndex(function (stop) {
            return stop.group == knob.group && stop.item == knob.item;
        });
        if (here < 0 && stops.length > 0) {
            here = stops.length - 1;
            $rootScope.checklistKnob = { group: stops[here].group, item: stops[here].item };
        }
        return here;
    }

    $scope.knobClass = function (groupId, checkId) {
        var knob = $rootScope.checklistKnob;
        return (knob.group == groupId && knob.item == checkId) ? "keypadSelectedYes" : "keypadSelectedNo";
    }

    // One row per press, and stop at both ends (D2): a knob turned too far changes nothing
    function checklistKnobMove(direction) {
        var stops = checklistKnobStops();
        var here = checklistKnobIndex(stops);
        if (here < 0) {
            return;
        }
        var next = Math.min(stops.length - 1, Math.max(0, here + direction));
        $rootScope.checklistKnob = { group: stops[next].group, item: stops[next].item };
    }

    // The knob's row on the glass, centred when near or past an edge: the round panel cuts
    // the top and the bottom of the scroll area
    function checklistShowKnob() {
        var knob = $rootScope.checklistKnob;
        var row = document.querySelector("[ui-view] #check_" + knob.group + "_" + knob.item);
        if (row === null) {
            return;
        }
        var box = row.getBoundingClientRect();
        var margin = window.innerHeight * 0.2;
        if (box.top < margin || box.bottom > window.innerHeight - margin) {
            row.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
        }
    }

    $scope.checklistSelectNext = function () {
        checklistKnobMove(1);
    }

    $scope.checklistSelectPrev = function () {
        checklistKnobMove(-1);
    }

    // TAP: the next status of the knob's row, as choosing it in the row's list does
    $scope.checklistSelectTap = function () {
        var stops = checklistKnobStops();
        var here = checklistKnobIndex(stops);
        if (here >= 0) {
            $scope.cycleStatus(stops[here].group, stops[here].item);
        }
    }

    // A list a finger opened keeps the focus after the choice, and a focused list takes no
    // keypad key (servicekeypad.js, F2): give the knob its keys back
    $scope.statusChosen = function (check, groupId, checkId) {
        $rootScope.checklistKnob = { group: groupId, item: checkId };
        $scope.updateStatusForItem(check, groupId, checkId);
        if (document.activeElement && document.activeElement.tagName == "SELECT") {
            document.activeElement.blur();
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
                    $scope.updateStatusForItem($scope.data_list[groupId].items[checkId], groupId, checkId);
                    break;

                }
                else {
                    $scope.data_list[groupId].items[checkId].value = $scope.checklistValues[0].value
                    $scope.updateStatusForItem($scope.data_list[groupId].items[checkId], groupId, checkId);
                    break;
                }

            }
        }
    }



    // Bridge from servicekeypad
    addEventListener("keypad", keypadEventListener);
    // Keypad Listener with supported keys
    function keypadEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != 'CheckCtrl') {
            return; // not the routed plate: $destroy removes this listener
        }
        if ($scope.keypadKnobTimerRemovePopup !== undefined) {
            return; // user is changing screen
        }
        var turn = function () {
            switch (event.key) {
                case KEYPAD_MAPPING_PREV:
                    $scope.checklistSelectPrev();
                    break;
                case KEYPAD_MAPPING_TAP:
                    $scope.checklistSelectTap();
                    break;
                case KEYPAD_MAPPING_NEXT:
                    $scope.checklistSelectNext();
                    break;
            }
        };
        if ($scope.$root.$$phase) {
            turn();
        } else {
            $scope.$apply(turn);
        }
        checklistShowKnob();
    }

    // A left plate must not hear the knob: on a return its stale list would be posted back
    $scope.$on('$destroy', function () {
        removeEventListener("keypad", keypadEventListener);
    });

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
