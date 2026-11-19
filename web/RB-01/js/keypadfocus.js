/**
 * This file is part of RB.
 *
 * Copyright (C) 2026 XIAPROJECTS SRL
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
 *
 * keypadfocus.js: the knob inside a page, shared by the plates.
 * docs/tech-debt/keypad-page-navigation.md, 3.1 to 3.3.
 *
 * A plate marks its stops in the template and creates one KeypadFocus:
 *
 *   <button data-keypad="tap" ng-click="sendCommand($index)">       TAP = a click on it
 *   <select data-keypad="adjust" ng-model="x" ng-change="y()">      TAP = edit, PREV / NEXT = option
 *   <span data-keypad="adjust" data-keypad-name="qnh">              PREV / NEXT = options.adjust.qnh(-1 / +1)
 *
 *   new KeypadFocus($scope, $state, "switchboard", { adjust: { qnh: function (direction) {...} } });
 *
 * The page is a state name, or a list of them for a plate routed by more than one state.
 * options.direct(key), when given, sees each key first and returns true when it used it: a page
 * with a mode of its own (an image open full screen) keeps the knob there.
 *
 * Rules: PREV and NEXT move one stop in reading order (data-keypad-order first when given) and
 * stop at both ends (D2). No stop has the focus when the page opens: the first NEXT takes the
 * first stop, the first PREV the last, and a TAP with no focus does nothing, so a stray press on
 * entry runs nothing. The stops are collected at each press inside [ui-view], so ng-repeat and
 * ng-if changes need nothing and the closed copy of a plate in a sidebar is never a stop (D3).
 * The focus clears after timeoutSeconds without a key (0 = never: the 20 s of D4 is postponed
 * until every page has the knob).
 */

const KEYPAD_FOCUS_CLASS = "keypadFocus";
const KEYPAD_EDIT_CLASS = "keypadEdit";
// The part of the panel, top and bottom, where a focused stop is scrolled to the middle: on the
// round panel the circle cuts the edges of the scroll area
const KEYPAD_FOCUS_EDGE = 0.2;

function KeypadFocus($scope, $state, page, options) {
    const self = this;
    options = options || {};
    self.pages = [].concat(page);
    self.page = self.pages[0];
    self.adjust = options.adjust || {};
    self.direct = options.direct || null;
    self.timeoutSeconds = options.timeoutSeconds || 0;
    self.element = null;    // the focused stop
    self.index = -1;        // its place among the stops at the last press
    self.edit = false;
    self.timer = null;

    function visible(element) {
        if (element.offsetParent === null || element.disabled || element.hasAttribute("disabled")) {
            return false;
        }
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
    }

    self.stops = function () {
        const view = document.querySelector("[ui-view]");
        if (view === null) {
            return [];
        }
        const stops = Array.prototype.filter.call(view.querySelectorAll("[data-keypad]"), visible);
        const ordered = stops.map(function (element, n) {
            const order = parseFloat(element.getAttribute("data-keypad-order"));
            return { element: element, order: isNaN(order) ? n : order, n: n };
        });
        ordered.sort(function (a, b) { return (a.order - b.order) || (a.n - b.n); });
        return ordered.map(function (stop) { return stop.element; });
    };

    function nameOf(element) {
        return element.getAttribute("data-keypad-name") || element.textContent.replace(/\s+/g, " ").trim();
    }

    // The focused stop among these. A stop a redraw replaced (a list reloaded, a tile redrawn
    // with the daemon's answer) hands the focus to the stop of the same name nearest its place.
    // A stop gone with no such heir, or still there but hidden, means the page changed view (a
    // list opened or closed): the knob starts afresh with no focus, as on a new page
    function find(stops) {
        if (self.element === null) {
            return -1;
        }
        var here = stops.indexOf(self.element);
        if (here < 0 && !self.element.isConnected) {
            var name = self.name;
            var best = -1;
            stops.forEach(function (stop, n) {
                if (nameOf(stop) == name && (best < 0 || Math.abs(n - self.index) < Math.abs(best - self.index))) {
                    best = n;
                }
            });
            if (best >= 0) {
                self.element = stops[best];
                here = best;
            }
        }
        if (here < 0) {
            self.element.classList.remove(KEYPAD_FOCUS_CLASS, KEYPAD_EDIT_CLASS);
            self.element = null;
            self.index = -1;
            self.edit = false;
            return -1;
        }
        self.index = here;
        self.name = nameOf(self.element);
        return here;
    }

    function draw() {
        document.querySelectorAll("[ui-view] ." + KEYPAD_FOCUS_CLASS + ", [ui-view] ." + KEYPAD_EDIT_CLASS).forEach(function (element) {
            if (element !== self.element) {
                element.classList.remove(KEYPAD_FOCUS_CLASS, KEYPAD_EDIT_CLASS);
            }
        });
        if (self.element === null) {
            return;
        }
        self.element.classList.toggle(KEYPAD_FOCUS_CLASS, !self.edit);
        self.element.classList.toggle(KEYPAD_EDIT_CLASS, self.edit);
    }

    function show() {
        if (self.element === null) {
            return;
        }
        const box = self.element.getBoundingClientRect();
        const margin = window.innerHeight * KEYPAD_FOCUS_EDGE;
        // On a square panel, which is round, a stop in a corner is off the glass even inside
        // the band: its middle must be inside the circle
        var offGlass = false;
        if (whichKeywordIsForThisDisplay() == "Square") {
            const radius = Math.min(window.innerWidth, window.innerHeight) / 2;
            const dx = (box.left + box.right) / 2 - window.innerWidth / 2;
            const dy = (box.top + box.bottom) / 2 - window.innerHeight / 2;
            offGlass = Math.sqrt(dx * dx + dy * dy) > radius * 0.9;
        }
        if (offGlass || box.top < margin || box.bottom > window.innerHeight - margin) {
            self.element.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
        }
    }

    self.clear = function () {
        self.element = null;
        self.index = -1;
        self.edit = false;
        draw();
    };

    function restartTimer() {
        clearTimeout(self.timer);
        if (self.timeoutSeconds > 0) {
            self.timer = setTimeout(self.clear, self.timeoutSeconds * 1000);
        }
    }

    function change(element, direction) {
        if (element.tagName == "SELECT") {
            const next = element.selectedIndex + direction;
            if (next >= 0 && next < element.options.length) {
                element.selectedIndex = next;
                element.dispatchEvent(new Event("change"));
            }
        } else if (element.tagName == "INPUT" && element.type == "range") {
            if (direction > 0) {
                element.stepUp();
            } else {
                element.stepDown();
            }
            element.dispatchEvent(new Event("input"));
            element.dispatchEvent(new Event("change"));
        } else {
            const name = element.getAttribute("data-keypad-name");
            if (self.adjust.hasOwnProperty(name)) {
                $scope.$apply(function () { self.adjust[name](direction); });
            }
        }
    }

    self.move = function (direction) {
        const stops = self.stops();
        const here = find(stops);
        if (stops.length == 0) {
            return;
        }
        if (self.edit && here >= 0) {
            change(self.element, direction);
            return;
        }
        var next;
        if (here < 0) {
            next = direction > 0 ? 0 : stops.length - 1;
        } else {
            next = Math.min(stops.length - 1, Math.max(0, here + direction));
        }
        self.element = stops[next];
        self.index = next;
        self.name = nameOf(self.element);
        self.edit = false;
        draw();
        show();
    };

    // Puts the focus on this stop, in browse mode: a page whose action leads to another stop (the
    // autopilot after a direct-to lands on the HSI). A stop that is not one now changes nothing
    self.select = function (element) {
        const stops = self.stops();
        const here = stops.indexOf(element);
        if (here < 0) {
            return;
        }
        self.element = element;
        self.index = here;
        self.name = nameOf(element);
        self.edit = false;
        draw();
        show();
        restartTimer();
    };

    self.isEditing = function (element) {
        return self.edit && self.element !== null && self.element === element;
    };

    self.tap = function () {
        const stops = self.stops();
        const here = find(stops);
        if (here < 0) {
            draw();
            return; // nothing has the focus: a stray TAP runs nothing
        }
        if (self.element.getAttribute("data-keypad") == "adjust") {
            self.edit = !self.edit;
            draw();
            $scope.$applyAsync();    // for a template showing the edit mode (the autopilot's radial label)
            return;
        }
        // The same event a finger gives: ng-click runs its own digest
        self.element.click();
    };

    function keypadEventListener(event) {
        if (self.pages.indexOf($state.current.name) < 0) {
            return;
        }
        if (self.direct !== null) {
            var used = false;
            $scope.$apply(function () { used = self.direct(event.key) === true; });
            if (used) {
                restartTimer();
                return;
            }
        }
        switch (event.key) {
            case KEYPAD_MAPPING_PREV:
                self.move(-1);
                break;
            case KEYPAD_MAPPING_TAP:
                self.tap();
                break;
            case KEYPAD_MAPPING_NEXT:
                self.move(1);
                break;
            default:
                return;
        }
        restartTimer();
    }

    // A redrawn list drops the class with the element it was on: put it back after each digest
    var redrawQueued = false;
    $scope.$watch(function () {
        if (!redrawQueued && self.element !== null) {
            redrawQueued = true;
            // After the digest and the DOM work it queued (ng-show applies its class late)
            $scope.$$postDigest(function () {
                setTimeout(function () {
                    redrawQueued = false;
                    if (self.element !== null && (!self.element.isConnected || !visible(self.element))) {
                        find(self.stops());
                        draw();
                    }
                }, 0);
            });
        }
    });

    addEventListener("keypad", keypadEventListener);
    KeypadFocus.current = self;
    $scope.$on("$destroy", function () {
        removeEventListener("keypad", keypadEventListener);
        clearTimeout(self.timer);
        if (KeypadFocus.current === self) {
            KeypadFocus.current = null;
        }
    });
}

KeypadFocus.current = null;

// For the display tests: where the knob is on the routed plate
window.keypadFocusState = function () {
    const focus = KeypadFocus.current;
    if (focus === null) {
        return null;
    }
    const stops = focus.stops();
    return {
        page: focus.page,
        index: focus.element === null ? -1 : stops.indexOf(focus.element),
        count: stops.length,
        mode: focus.element === null ? "none" : (focus.edit ? "edit" : "browse"),
        name: focus.element === null ? null : (focus.element.getAttribute("data-keypad-name") || focus.element.textContent.trim().slice(0, 40))
    };
};
