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
 *
 * Workflow is:  vorfreq -> vorfreqactive -> vorradial
 * To turn off the VOR set vorfreq to 0
 * 
 * Bridge test with:
 * curl "http://localhost/bridge/float" -X POST -d '{"vorfreq":109.4}'
 * The Driver will reply with this:
 * curl "http://localhost/bridge/float"
 * {"voram":0,"vorfreq":109.4,"vorfreqactive":109400,"vorradial":0,"vorsnr":0,"vorstatus":1,"vorsub":19}
 * vorstatus 0=idle/off, 1=no-signal, 2=tuning, 3=acquiring, 4=degraded, 5=tracked
 * {
    "voram": 26,
    "vorfreqactive": 109400,
    "vorradial": 202,
    "vorsnr": 22,
    "vorstatus": 3,
    "vorsub": 23
}
 *
*/

angular.module('appControllers').controller('VorCtrl', VorCtrl);



function VorCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.foregroundColor = "#ffffff";

    const name = "vor";
    const controllerName = String(name).charAt(0).toLocaleUpperCase() + String(name).slice(1) + "Ctrl";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
        removeEventListener("SituationUpdated", situationUpdateEventListener);
        removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
    };

    console.log("Controller " + name);

    // Example of scope variable
    $scope.items = {
        GPSLatitude: 0,
        GPSLongitude: 0,
        GPSTrueCourse: 0,
        voram: 0,
        vorfreq: 0,
        vorname: "",
        vorto:0,
        vorfreqactive: 0,
        vorradial: 0,
        vorsnr: 0,
        vorstatus: 0,
        vorsub: 0,
        slope: 0,
        overrideHSI: 0,
        vertical: 0,
        searchEnabled: false
    };

    $scope.vorList = [
        { "name": "Albenga", "id": "ALB", "type": "VOR-DME", "freq": 116.95 },
        { "name": "Alghero", "id": "ALG", "type": "VORTAC", "freq": 113.80 },
        { "name": "Ancona", "id": "ANC", "type": "VOR-DME", "freq": 110.65 },
        { "name": "Bari", "id": "BAR", "type": "VOR-DME", "freq": 116.40 },
        { "name": "Bergamo", "id": "BEG", "type": "VOR-DME", "freq": 115.00 },
        { "name": "Biella Cerrione", "id": "BLA", "type": "VOR-DME", "freq": 116.10 },
        { "name": "Bologna", "id": "BOA", "type": "VOR-DME", "freq": 117.10 },
        { "name": "Bolsena", "id": "BOL", "type": "VORTAC", "freq": 114.40 },
        { "name": "Bolzano", "id": "OZE", "type": "VOR-DME", "freq": 117.05 },
        { "name": "Brindisi", "id": "BRD", "type": "VORTAC", "freq": 113.20 },
        { "name": "Cagliari", "id": "CAG", "type": "VOR-DME", "freq": 113.40 },
        { "name": "Campagnano", "id": "CMP", "type": "VOR-DME", "freq": 111.40 },
        { "name": "Caraffa", "id": "CDC", "type": "VORTAC", "freq": 117.30 },
        { "name": "Carbonara", "id": "CAR", "type": "VOR-DME", "freq": 115.10 },
        { "name": "Caselle", "id": "CSL", "type": "VOR-DME", "freq": 116.75 },
        { "name": "Catania", "id": "CAT", "type": "VOR-DME", "freq": 112.10 },
        { "name": "Catania Fontanarossa", "id": "CTF", "type": "VOR-DME", "freq": 116.25 },
        { "name": "Cervia", "id": "CEV", "type": "TACAN", "freq": 113.60 },
        { "name": "Chioggia", "id": "CHI", "type": "VOR-DME", "freq": 114.10 },
        { "name": "Crotone", "id": "CRN", "type": "VOR-DME", "freq": 117.10 },
        { "name": "Elba", "id": "ELB", "type": "VORTAC", "freq": 114.70 },
        { "name": "Firenze", "id": "FRZ", "type": "VORTAC", "freq": 115.20 },
        { "name": "Grosseto", "id": "GRO", "type": "TACAN", "freq": 109.10 },
        { "name": "Palermo", "id": "PAL", "type": "VOR-DME", "freq": 112.30 },
        { "name": "Pantelleria", "id": "PAN", "type": "VOR-DME", "freq": 116.10 },
        { "name": "Peretola", "id": "PRT", "type": "VOR-DME", "freq": 112.50 },
        { "name": "Perugia", "id": "PRU", "type": "VOR-DME", "freq": 109.40 },
        { "name": "Pescara", "id": "PES", "type": "VOR-DME", "freq": 115.90 },
        { "name": "Pisa", "id": "PIS", "type": "VOR-DME", "freq": 112.10 },
        { "name": "Pomigliano", "id": "POM", "type": "VOR-DME", "freq": 117.85 },
        { "name": "Ponza", "id": "PNZ", "type": "VORTAC", "freq": 114.60 },
        { "name": "Raisi", "id": "PRS", "type": "VOR-DME", "freq": 113.00 },
        { "name": "Reggio Calabria", "id": "RCA", "type": "VOR-DME", "freq": 111.00 },
        { "name": "Rimini", "id": "RIM", "type": "VORTAC", "freq": 116.20 },
        { "name": "Rivolto", "id": "RIV", "type": "TACAN", "freq": 110.00 },
        { "name": "Roma", "id": "ROM", "type": "VOR-DME", "freq": 110.80 },
        { "name": "Ronchi", "id": "RCH", "type": "VOR-DME", "freq": 114.20 },
        { "name": "Saronno", "id": "SRN", "type": "VOR-DME", "freq": 113.70 },
        { "name": "Sarzana", "id": "SAZ", "type": "TACAN", "freq": 111.10 },
        { "name": "Siena", "id": "SIE", "type": "VOR-DME", "freq": 110.20 },
        { "name": "Sigonella", "id": "SIG", "type": "TACAN", "freq": 111.60 },
        { "name": "Sorrento", "id": "SOR", "type": "VOR-DME", "freq": 112.20 },
        { "name": "Tarquinia", "id": "TAQ", "type": "VOR-DME", "freq": 111.80 },
        { "name": "Teano", "id": "TEA", "type": "VOR-DME", "freq": 112.90 },
        { "name": "Tessera", "id": "TES", "type": "VOR-DME", "freq": 115.30 },
        { "name": "Torino", "id": "TOP", "type": "VOR-DME", "freq": 114.50 }
    ]

    $scope.vorNameByFreq = function(freq) {
        if (freq > 100000) {
            freq = freq / 1000;
        }
        for (var i = 0; i < $scope.vorList.length; i++) {
            if ($scope.vorList[i].freq == freq) {
                return $scope.vorList[i].name;
            }
        }
        return "";
    }

    $scope.switchToFrom = function() {
        if ($scope.items.vorto == 1) {
            $scope.items.vorto = 0;
        } else {
            $scope.items.vorto = 1;
        }


         if ($scope.vorHSI == null) {
            $scope.vorHSI = new HSICircleRenderer("vorHSI", {}, $scope.foregroundColor);
        }

        $scope.vorHSI.update(
            $scope.items.GPSTrueCourse,
            {},
            $scope.items.vorradial + $scope.items.vorto * 180,
            $scope.items.vertical,
            $scope.items.overrideHSI,
            $scope.items.slope
        );
    }

    $scope.enableSearchVor = function() {
        $scope.items.searchEnabled = true;
    };

    $scope.setFrequency = function(freq, name) {
        $scope.items.vorfreq = freq;
        $scope.items.vorname = name;
        $scope.items.searchEnabled = false;
        var msg = JSON.stringify({ "vorfreq": freq });
        $http.post("/bridge/float", msg).
            then(function (response) {
            }, function (response) {
            });
    }

    // ************
    function situationUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("SituationUpdated", situationUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var situation = event.detail;
        $scope.items["GPSLatitude"] = (situation["GPSLatitude"]);
        $scope.items["GPSLongitude"] = (situation["GPSLongitude"]);
        $scope.items["GPSTrueCourse"] = (situation["GPSTrueCourse"]);


        if ($scope.vorHSI == null) {
            $scope.vorHSI = new HSICircleRenderer("vorHSI", {}, $scope.foregroundColor);
        }

        $scope.vorHSI.update(
            $scope.items.GPSTrueCourse,
            {},
            $scope.items.vorradial + $scope.items.vorto * 180,
            $scope.items.vertical,
            $scope.items.overrideHSI,
            $scope.items.slope
        );
    }

    function bridgeUpdatedEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("BridgeUpdated", bridgeUpdatedEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var status = event.detail;
        $scope.items["voram"] = parseFloat(status["voram"]);
        $scope.items["vorfreq"] = parseFloat(status["vorfreq"]);
        $scope.items["vorfreqactive"] = parseFloat(status["vorfreqactive"]);
        $scope.items["vorname"] = $scope.vorNameByFreq($scope.items["vorfreqactive"]);
        $scope.items["vorradial"] = parseInt(status["vorradial"]);
        $scope.items["vorsnr"] = parseFloat(status["vorsnr"]);
        $scope.items["vorstatus"] = parseInt(status["vorstatus"]);
        $scope.items["vorsub"] = parseFloat(status["vorsub"]);


        if ($scope.vorHSI == null) {
            $scope.vorHSI = new HSICircleRenderer("vorHSI", {}, $scope.foregroundColor);
        }

        $scope.vorHSI.update(
            $scope.items.GPSTrueCourse,
            {},
            $scope.items.vorradial + $scope.items.vorto * 180,
            $scope.items.vertical,
            $scope.items.overrideHSI,
            $scope.items.slope
        );
    }
    $scope.vorHSI = null;
    addEventListener("BridgeUpdated", bridgeUpdatedEventListener);
    addEventListener("SituationUpdated", situationUpdateEventListener);
};
