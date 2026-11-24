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

    synthview.js
*/

angular.module('appControllers').controller('SynthViewCtrl', SynthViewCtrl); // get the main module controllers set
SynthViewCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies


var URL_AIRFIELDS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/db.airfields.json";
var URL_SYNTH_SETUP = URL_HOST_PROTOCOL + URL_HOST_BASE + "/settings/synthview.json";

// POI Elevation based on current surface
// TODO: move in setup
const elevantionPOIfromSurface = 100;
const FollowMeDistance = 2;
// Brown of the ground below the horizon and of the terrain's underside
const TERRAIN_UNDERSIDE_COLOR = { r: 0.36, g: 0.25, b: 0.16 };
// The two tubes of every aircraft: down to sea level, and its predicted path
const TUBE_COLOR = 0x1c1c1c;
// A predicted path drawn level because the target sends no vertical rate
const TUBE_COLOR_NO_VERTICAL = 0x8a8a8a;
const TUBE_RADIUS = 5;
// Predicted path when synthview.json "projection" leaves it out
const PROJECTION_SECONDS = 60;
// Haze, sun and cast shadows when synthview.json leaves them out
// (docs/tech-debt/synthview-terrain-rendering.md sections 11-12)
const SYNTHVIEW_HAZE = { enabled: true, color: { r: 0.79, g: 0.86, b: 0.9 }, start: 0.2, end: 0.77 };
const SYNTHVIEW_SUN = { relativeAzimuth: 315, elevation: 15, intensity: 0.9, ambient: 0.6 };
const SYNTHVIEW_SHADOWS = { enabled: true, mapSize: 1024, range: 0.4 };


// create our controller function with all necessary logic
function SynthViewCtrl($rootScope, $scope, $state, $http, $interval) {
    // RB-01, RB-03 using the Airfields integration we need a font, this is the default 3D font async loader
    // TODO: move this part
    if (!window.hasOwnProperty("font")) {
        const fontLoader = new THREE.FontLoader();
        fontLoader.load("synthview/helvetiker_regular.typeface.json", (font) => {
            window.font = font;
        });
    }
    $scope.$parent.helppage = 'plates/synthview-help.html';
    $scope.data_list = [];
    $scope.isHidden = false;
    /*
        $scope.noSleep = new NoSleep();
    */

    $scope.situation = {};
    $scope.scrollItemCounter = -4;

    /*****************************************************
     *  Controller routines
     */
    $state.get('synthview').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('synthview').onExit = function () {
        removeEventListener("keypad", keypadEventListener);
        removeEventListener("SituationUpdated", situationUpdateEventListener);
        removeEventListener("TrafficUpdated", trafficUpdateEventListener);
        removeEventListener("WaypointChanged", waypointChangedEventListener);
        window.clearInterval($scope.cleanupOldTrafficTimer);
        // Every visit builds a new Rendering with its own WebGL context: free the
        // old one, or each visit keeps a context, the terrain and every model
        rendering.dispose();

    };


    /*****************************************************
     *  Keypad Management
     */

    function keypadEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != 'SynthViewCtrl') {
            removeEventListener("keypad", keypadEventListener);
            return; // we are getting called once after clicking away from the status page
        }

        if ($scope.keypadKnobTimerRemovePopup === undefined) {
        }
        else {
            // user is changing screen
            return;
        }

        // A direct page: PREV / NEXT orbit the camera, TAP resets the view. Zoom and cage AHRS
        // stay touch only (docs/tech-debt/keypad-page-navigation.md 3.4). The service sends only
        // the three functions, so the raw MediaTrackNext / MediaTrackPrevious cases that called
        // synthViewSelectUp / Down (zoom) could never run and are gone
        switch (event.key) {
            case KEYPAD_MAPPING_PREV:
                $scope.synthViewSelectLeft();
                break;
            case KEYPAD_MAPPING_TAP:
                $scope.synthViewSelectTap();
                break;
            case KEYPAD_MAPPING_NEXT:
                $scope.synthViewSelectRight();
                break;
        }
    }


    $scope.cameraRotating = {};
    $scope.synthViewSelectDown = function () {
        //const proxy = new KeyboardEvent("keypad", { key: "from" });
        //dispatchEvent(proxy);
        // Nothing to orbit around until startup() and the terrain fetch have
        // populated resources.items; on a Pi that is a few seconds after entry.
        if (resources.items.length == 0) return;
        if ($scope.remote.reset == false) {
            $scope.cameraRotating = {
                pitch: resources.items[0].pitch,
                roll: resources.items[0].roll,
                x: resources.items[0].x,
                y: resources.items[0].y,
                elevation: resources.items[0].elevation,
                direction: resources.items[0].direction,
                distance: 10
            };
        }
        $scope.remote.reset = true;
        $scope.cameraRotating.distance = $scope.cameraRotating.distance + 1;
        if ($scope.cameraRotating.distance < 10) $scope.cameraRotating.distance = 10;
        rendering.cameraFollowItem($scope.cameraRotating, resources, $scope.cameraRotating.distance);
        requestAnimationFrame(animate);
    }
    $scope.synthViewSelectUp = function () {
        //const proxy = new KeyboardEvent("keypad", { key: "from" });
        //dispatchEvent(proxy);
        // Nothing to orbit around until startup() and the terrain fetch have
        // populated resources.items; on a Pi that is a few seconds after entry.
        if (resources.items.length == 0) return;
        if ($scope.remote.reset == false) {
            $scope.cameraRotating = {
                pitch: resources.items[0].pitch,
                roll: resources.items[0].roll,
                x: resources.items[0].x,
                y: resources.items[0].y,
                elevation: resources.items[0].elevation,
                direction: resources.items[0].direction,
                distance: 10
            };
        }
        $scope.remote.reset = true;
        $scope.cameraRotating.distance = $scope.cameraRotating.distance - 1;
        if ($scope.cameraRotating.distance < 10) $scope.cameraRotating.distance = 10;
        rendering.cameraFollowItem($scope.cameraRotating, resources, $scope.cameraRotating.distance);
        requestAnimationFrame(animate);
    }
    $scope.synthViewSelectLeft = function () {
        //const proxy = new KeyboardEvent("keypad", { key: "from" });
        //dispatchEvent(proxy);
        // Nothing to orbit around until startup() and the terrain fetch have
        // populated resources.items; on a Pi that is a few seconds after entry.
        if (resources.items.length == 0) return;
        if ($scope.remote.reset == false) {
            $scope.cameraRotating = {
                pitch: resources.items[0].pitch,
                roll: resources.items[0].roll,
                x: resources.items[0].x,
                y: resources.items[0].y,
                elevation: resources.items[0].elevation,
                direction: resources.items[0].direction,
                distance: 10
            };
        }
        $scope.remote.reset = true;
        $scope.cameraRotating.direction = $scope.cameraRotating.direction - 10;
        //remote.set($scope.cameraRotating.pitch, $scope.cameraRotating.roll, $scope.cameraRotating.x, $scope.cameraRotating.y, $scope.cameraRotating.elevation, $scope.cameraRotating.direction);
        rendering.cameraFollowItem($scope.cameraRotating, resources);
        requestAnimationFrame(animate);
    }
    $scope.synthViewSelectRight = function () {
        //const proxy = new KeyboardEvent("keypad", { key: "to" });
        //dispatchEvent(proxy);
        // Nothing to orbit around until startup() and the terrain fetch have
        // populated resources.items; on a Pi that is a few seconds after entry.
        if (resources.items.length == 0) return;
        if ($scope.remote.reset == false) {
            $scope.cameraRotating = {
                pitch: resources.items[0].pitch,
                roll: resources.items[0].roll,
                x: resources.items[0].x,
                y: resources.items[0].y,
                elevation: resources.items[0].elevation,
                direction: resources.items[0].direction,
                distance: 10
            };
        }
        $scope.remote.reset = true;
        $scope.cameraRotating.direction = $scope.cameraRotating.direction + 10;
        //remote.set($scope.cameraRotating.pitch, $scope.cameraRotating.roll, $scope.cameraRotating.x, $scope.cameraRotating.y, $scope.cameraRotating.elevation, $scope.cameraRotating.direction);
        rendering.cameraFollowItem($scope.cameraRotating, resources);
        requestAnimationFrame(animate);
    }

    $scope.synthViewSelectTap = function () {
        $scope.synthviewFrameReset();
    }

    /*****************************************************
     * Replicate the AHRS
     */
    // GPS/AHRS Controller tasks go here
    $scope.instruments = [
        { "url": "plates/attitude.html", "ctrl": SixPackInstrumentAttitude, pointer: null, "name": "attitude", "overlay": true }
    ];

    /*****************************************************
     * Situation Update
     */
    function trafficUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != 'SynthViewCtrl') {
            removeEventListener("TrafficUpdated", trafficUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        $scope.loadTraffics(event.detail);
        $scope.$apply(); // trigger any needed refreshing of data
    }

    // The autopilot service emits WaypointChanged without a payload, so the plan has
    // to be fetched again to know what actually changed.
    function waypointChangedEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != 'SynthViewCtrl') {
            removeEventListener("WaypointChanged", waypointChangedEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        resources.fetchRoute().then((route) => {
            if (rendering.disposed) return;
            const signature = guidanceRouteSignature(route);
            if (signature == resources.routeSignature) {
                return; // same plan, nothing to rebuild
            }
            resources.routeSignature = signature;
            // setup.elevation tracks the current altitude in metres (animate() keeps
            // it fresh) and is always a number, unlike a not-yet-received situation.
            rendering.buildGuidanceTunnel(route, resources.setup, resources.terrain, resources.setup.elevation);
            requestAnimationFrame(animate);
        });
    }

    // Unusual attitude: the recovery chevrons the attitude plate draws, over the
    // synthetic view as well - it is the attitude display when it is on screen
    $scope.Attitude = { "chevrons": "" };
    $scope.pilotGPSGroundSpeed = 0;
    $scope.pilotGPSGroundSpeedUnit = "Kt";
    $scope.pilotGPSAltitudeMSL = 0;
    $scope.pilotGPSAltitudeMSLUnit = "Meters";

    // ************
    function situationUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != 'SynthViewCtrl') {
            removeEventListener("SituationUpdated", situationUpdateEventListener);
            return; // we are getting called once after clicking away from the status page
        }
        var situation = event.detail;
        // Filter to avoid blow up CPU
        const oldSituation = $scope.situation;
        const newSituation = situation;
        const ahrsThreshold = 1;
        const altitudeThreshold = 50 / 3.2808;
        const requireRefresh = true;
        if (requireRefresh == true) {
            $scope.situation = situation;
            $scope.pilotGPSGroundSpeed = parseInt(pilotDisplayedSpeedFromKT($scope.situation.GPSGroundSpeed));
            $scope.pilotGPSGroundSpeedUnit = window.aircraftData?.units?.speed ?? "Kmh";
            $scope.pilotGPSAltitudeMSLUnit = window.aircraftData?.units?.altimeter ?? "Meters";
            $scope.pilotGPSAltitudeMSL = parseInt(pilotDisplayedAltitudeFromMeters($scope.situation.GPSAltitudeMSL/3.28084));
            $scope.Attitude.chevrons = globalPitchChevrons(situation.AHRSPitch, $scope.Attitude.chevrons);
            loadSituationInSynthView(situation);
            loadSituationInAHRS(situation);
            $scope.$apply(); // trigger any needed refreshing of data
        }
    }

    /*****************************************************
    * Init
    */

    addEventListener("keypad", keypadEventListener);
    addEventListener("SituationUpdated", situationUpdateEventListener);



    /*****************************************************
    * AHRS and GPS Helper
    */
    function loadSituationInAHRS(situation) { // mySituation
        $scope.instruments.forEach(i => { if (i.pointer != null) i.pointer.updateSituation(situation); });
    }


    $scope.AHRSCage = function () {
        if (!$scope.IsCaging) {
            $http.post(URL_AHRS_CAGE).then(function (response) {
            }, function (response) {

            });
        }
    };

    $scope.AHRSCalibrate = function () {
        if (!$scope.IsCaging) {
            $http.post(URL_AHRS_CAL).then(function (response) {
            }, function (response) {
            });
        }
    };

    $scope.AHRSCageAndCalibrate = function () {
        // Please use the switchboard 
        const requestedCage = false;
        const requestedCalibration = false;
        if(requestedCage==true){
        window.setTimeout(function () {
            $scope.AHRSCage();
        }, 5000);
        }
        if(requestedCalibration==true){
        window.setTimeout(function () {
            $scope.AHRSCalibrate();
        }, 100);
        }

        $scope.synthviewFrameReset();
    }

    $scope.synthviewFrameReset = function () {
        $scope.remote.reset = false;
    }

    $scope.goToLeft = function () {
        document.location = "#/radar"
    }


    $scope.goToRight = function () {
        document.location = "#/hsi"
    }

    $scope.displayHSI = function () {
        // iPad Mini 768x949
        // 8" display 785x1193

        return $scope.remote.reset == false && window.innerHeight > 800
            && $scope.Attitude.chevrons == "";
    }

    //
    class TerrainManager {
        constructor() {
            this.terrainData = [[0]];
            this.latitude = 0.0;
            this.longitude = 0.0;
            this.planimetry = { "start": { "lat": 37, "lon": 4 }, "end": { "lat": 47, "lon": 19 } };
            this.moltipliers = { "lat": (this.planimetry.end.lat - this.planimetry.start.lat) / this.terrainData.length, "lon": (this.planimetry.end.lon - this.planimetry.start.lon) / this.terrainData[0].length }
            // Centre of the first window loaded: the scene's (0, 0). Later windows
            // are laid around it, so nothing already in the scene has to move.
            this.origin = null;
        }

        static hasCells(data) {
            return data != null && data.terrainData.length > 0 && data.terrainData[0].length > 0;
        }

        isReady() {
            return this.terrainData.length > 1;
        }

        elevationByLatLon(lat, lon) {
            const indexIJ = this.index(lat, lon);
            return this.terrainData[indexIJ[0]][indexIJ[1]];
        }

        index(lat, lon, data = this) {
            const dlat = lat - data.planimetry.start.lat;
            const dlon = lon - data.planimetry.start.lon;
            var mlat = parseInt(dlat / data.moltipliers.lat);
            var mlon = parseInt(dlon / data.moltipliers.lon);
            if (mlat < 0) mlat = 0;
            if (mlat >= data.terrainData.length) mlat = data.terrainData.length - 1;
            if (mlon < 0) mlon = 0;
            if (mlon >= data.terrainData[mlat].length) mlon = data.terrainData[mlat].length - 1;
            return [mlat, mlon];
        }

        centre() {
            return {
                "lat": (this.planimetry.start.lat + this.planimetry.end.lat) / 2,
                "lon": (this.planimetry.start.lon + this.planimetry.end.lon) / 2
            };
        }

        // Scene position of a point, in cells east and south of the origin. A
        // cell is cellSize world units north-south; east-west it is eastScale()
        // of that, so the scene keeps true horizontal proportions.
        plan(lat, lon) {
            const origin = this.origin || this.centre();
            const dilat = (origin.lat - lat) / this.moltipliers.lat;
            const dilon = (lon - origin.lon) / this.moltipliers.lon;

            return [dilon * this.eastScale(), dilat];
        }

        // East-west ground width of a cell over its north-south length. The grid
        // is square in degrees, not in metres: 0.01 deg of longitude is 800 m at
        // 44 N, of latitude 1111 m. Drawn square, east-west distances came out
        // 1.4 times too long and a 045 track pointed 054 over the terrain. Taken
        // at the origin, so every later window lines up with the first.
        eastScale() {
            const at = this.origin || this.centre();
            return Math.cos(at.lat * Math.PI / 180) * 111320.0 * this.moltipliers.lon / (111132.0 * this.moltipliers.lat);
        }

        // North-south length of a cell in metres: one horizontal metre is
        // cellSize / metersPerCell() world units. Heights are one unit a metre,
        // so the scene stands that many times taller than it is wide.
        metersPerCell() {
            return 111132.0 * this.moltipliers.lat;
        }

        // Scene position of the window in memory, where its mesh goes
        windowPlan() {
            const centre = this.centre();
            return this.plan(centre.lat, centre.lon);
        }

        load(data) {
            this.terrainData = data.terrainData;
            this.latitude = data.latitude;
            this.longitude = data.longitude;
            this.planimetry = data.planimetry;
            this.moltipliers = data.moltipliers;
            if (this.origin === null) {
                this.origin = this.centre();
            }
        }

        // The terrain window around (lat, lon), shared with the other screens
        // and moved as the aircraft flies (globalLoadTerrainGrid, js/global.js)
        async terrainFetch(lat, lon) {
            try {
                const data = await globalLoadTerrainGrid(lat, lon);
                if (!TerrainManager.hasCells(data)) {
                    throw new Error(`No terrain at ${lat}, ${lon}`);
                }
                this.load(data);
                return data;


            } catch (error) {
                console.error('Error fetching data:', error);
                throw error;
            }
        }
    }

    class ResourceManager {
        constructor() {
            this.airfields = [];
            this.airfieldsInScene = new Set();  // "Lat,Lon" of each airfield imported
            this.terrain = new TerrainManager();
            this.items = [];
            this.itemIndexStartingTraffic = 0;
            this.setup = {};
            this.route = [];
            this.routeSignature = "";
        }


        itemTemplate() {
            return {
                "ttl": Date.now() + 1000 * 60 * 60 * 12,
                "directionModel": 0,
                "groundSpeedKt": 0,
                "verticalFpm": 0,
                "verticalKnown": true,
                "reference": null,
                "referenceTubeFront": null,
                "referenceTubeVertical": null,
                "referenceLabel": null,
                "roll": 0,
                "pitch": 0,
                "direction": 0,
                "elevation": 1000,
                "template": "",
                "name": "",
                "scale": 1,
                "color": 0,
                "x": 0,
                "y": 0
            };
        }


        getAircraftCategory(Emitter_category) {
            const category = {
                1: 'Light',
                2: 'Small',
                3: 'Large',
                4: 'VLarge',
                5: 'Heavy',
                6: 'Fight',
                7: 'Helic',
                9: 'Glide',
                10: 'Ballo',
                11: 'Parac',
                12: 'Ultrl',
                14: 'Drone',
                15: 'Space',
                16: 'VLarge',
                17: 'Vehic',
                18: 'Vehic',
                19: 'Obstc'
            };
            return category[Emitter_category] ? category[Emitter_category] : 'Light';
        }


        randomPastelColorInt() {
            /*
            var ret = 0;
            var rand = Math.floor(Math.random() * 10);
            ret = (185 - rand * 10);
            ret = (185 - rand * 5) * 256 + ret;
            ret = (215 - rand * 3) * 256 * 256 + ret;
            return ret;
            */
            return Math.floor(Math.random() * 256) * 256 * 256 + Math.floor(Math.random() * 256) * 256 + Math.floor(Math.random() * 256);
        }

        trafficTemplateMapper(item, category) {
            var copyTemplate = null;
            // Check for friends mapping:
            if (this.setup.trafficMapping.hasOwnProperty(item.name)) {
                copyTemplate = this.setup.trafficMapping[item.name];
            } else {
                // Search for the right template
                if (this.setup.trafficTemplates.hasOwnProperty(category)) {
                }
                else {
                    // Fallback
                    category = "Light";
                }
                // Pick a random model:
                copyTemplate = this.setup.trafficTemplates[category][Math.floor((Math.random() * this.setup.trafficTemplates[category].length))];
                if (copyTemplate.color != null) {
                    copyTemplate.color = this.randomPastelColorInt();
                }
            }
            if (copyTemplate != null) {
                Object.keys(copyTemplate).forEach(key => {
                    item[key] = copyTemplate[key];
                });
            }
            item.ttl = Date.now();
            return item;
        }

        convertTrafficToItem(traffic, situation) {
            if (this.setup.hasOwnProperty("trafficTemplates") == false) {
                return null;
            }
            const aXY = this.terrain.plan(traffic.Lat, traffic.Lng);
            var item = this.itemTemplate();

            // Load Traffic Mapping and friends
            item.template = this.setup.trafficTemplates['Light'][0];
            item.name = "" + traffic.Icao_addr;
            item.scale = 1;
            item = this.trafficTemplateMapper(item, this.getAircraftCategory(traffic.Emitter_category));
            applyTrafficMotion(item, traffic, situation);
            item.x = aXY[0] * this.setup.cellSize;
            item.y = aXY[1] * this.setup.cellSize;

            return item;
        }

        importAirfields(airfields) {
            let itemsToAdd = [];
            airfields.forEach(element => {
                const key = element.Lat + "," + element.Lon;
                if (
                    !this.airfieldsInScene.has(key) &&
                    element.Lat > this.terrain.planimetry.start.lat &&
                    element.Lat < this.terrain.planimetry.end.lat &&
                    element.Lon > this.terrain.planimetry.start.lon &&
                    element.Lon < this.terrain.planimetry.end.lon

                ) {
                    this.airfieldsInScene.add(key);
                    const aXY = this.terrain.plan(element.Lat, element.Lon);
                    var item = this.itemTemplate();
                    // Marks the item as an airfield: never expired as traffic,
                    // pruned when the terrain window leaves it (pruneAirfields)
                    item.airfieldKey = key;
                    item.lat = element.Lat;
                    item.lon = element.Lon;
                    // TODO: fix Airfields database with real Elevations
                    //item.elevation = element.Ele + 20;
                    item.elevation = this.terrain.elevationByLatLon(element.Lat, element.Lon) + elevantionPOIfromSurface;
                    item.template = "map_pointer_places_of_interest";

                    // Runway Threshold
                    if(item.name == "" && element.hasOwnProperty("icao_code")) item.name = element.icao_code;
                    else  if(item.name == "" && element.hasOwnProperty("local_code")) item.name = element.local_code;
                    else  if(item.name == "" && element.hasOwnProperty("name")) item.name = element.name;
                    else  if(item.name == "" && element.hasOwnProperty("gps_code")) item.name = element.gps_code;

                    if(element.hasOwnProperty("heading"))item.heading = element.heading;
                    if(element.hasOwnProperty("length_ft"))item.length_ft = element.length_ft;
                    if(element.hasOwnProperty("width_ft"))item.width_ft = element.width_ft;

                    item.scale = 100;
                    item.x = aXY[0] * this.setup.cellSize;
                    item.y = aXY[1] * this.setup.cellSize;
                    itemsToAdd.push(item);
                }
                else {

                }


            });
            return itemsToAdd;
        }

        async startup() {
            try {

                const response = await fetch(URL_SYNTH_SETUP); // Fetch the data
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                const data = await response.json(); // Parse the JSON
                this.items = data.items;
                this.setup = data;
            } catch (error) {
                console.error('Error fetching data:', error);
                throw error;
            }


            return this.setup;
        }




        async fetchAndImportAirFields() {
            try {

                const response = await fetch(URL_AIRFIELDS_GET); // Fetch the data
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                const data = await response.json(); // Parse the JSON
                this.airfields = data;
                const itemsToAdd = this.importAirfields(data);
                this.items.push(...itemsToAdd);
            } catch (error) {
                console.error('Error fetching data:', error);
                throw error;
            }


            return this.items;
        }

        // After the terrain has moved: the airfields under the new window that
        // are not in the scene yet. Those already there stay.
        importNewAirfields() {
            const itemsToAdd = this.importAirfields(this.airfields);
            this.items.push(...itemsToAdd);
            return itemsToAdd;
        }

        // Takes an item out of the list. The first airfields sit before the
        // traffic, so removing one of them moves where the traffic starts. An
        // airfield removed can be imported again when the window comes back.
        removeItem(index) {
            const item = this.items[index];
            this.items.splice(index, 1);
            if (index < this.itemIndexStartingTraffic) this.itemIndexStartingTraffic--;
            if (item != null && item.airfieldKey != null) this.airfieldsInScene.delete(item.airfieldKey);
            return item;
        }

        // After the terrain has moved: the airfields left outside the new window
        // go, or a long flight keeps every airfield it ever passed in the scene.
        // dispose frees each one's meshes (Rendering.disposeItem).
        pruneAirfields(dispose) {
            const area = this.terrain.planimetry;
            let removed = 0;
            for (let i = this.items.length - 1; i > 0; i--) {
                const item = this.items[i];
                if (item == null || item.airfieldKey == null) continue;
                if (item.lat > area.start.lat && item.lat < area.end.lat &&
                    item.lon > area.start.lon && item.lon < area.end.lon) continue;
                dispose(item);
                this.removeItem(i);
                removed++;
            }
            return removed;
        }


        // Autopilot flight plan: bare array of {Lat,Lon,Ele(feet),Status,Cmt}
        // Errors are swallowed on purpose: a missing autopilot must not break the
        // airfields/traffic startup chain this is hooked into.
        async fetchRoute() {
            try {
                const response = await fetch(URL_AUTOPILOT_GET); // Fetch the data
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                const data = await response.json(); // Parse the JSON
                this.route = Array.isArray(data) ? data : [];
            } catch (error) {
                console.error('Error fetching route:', error);
                this.route = [];
            }


            return this.route;
        }
    }
    class RemoteController {
        constructor(rendering) {
            this.reset = false;
            this.rendering = rendering;

            // Listen to the change event
            rendering.controls.addEventListener('change', () => {
                this.reset = true;
                requestAnimationFrame(animate);
            });
        }

        updateItemsBySituation(items, situation, resources) {
            const aXY = resources.terrain.plan(situation.GPSLatitude, situation.GPSLongitude);
            items[0].x = aXY[0] * resources.setup.cellSize;
            items[0].y = aXY[1] * resources.setup.cellSize;
            items[0].elevation = situation.GPSAltitudeMSL * 0.3048;
            items[0].direction = situation.GPSTrueCourse;
            items[0].groundSpeedKt = situation.GPSGroundSpeed || 0;
            items[0].verticalFpm = (situation.GPSVerticalSpeed || 0) * 60;  // ft/s
            items[0].roll = situation.AHRSRoll;
            items[0].pitch = -situation.AHRSPitch + items[0].pitchModel;

            return items;
        }

        set(pitch, roll, x, y, elevation, direction) {
            if (this.reset == false) {
                if (direction % 360 >= 270 || direction % 360 <= 90) {
                    this.rendering.camera.rotation.z = -Math.PI * 2.0 * roll / 360.0
                }
                else {
                    this.rendering.camera.rotation.z = -Math.PI * 2.0 * (roll + 180) / 360.0
                }

            }
        }
    }

    class Rendering {
        constructor(container) {
            this.disposed = false;
            this.terrainBrown = null;
            this.heightScale = 1;  // scene units per metre of height (sceneY), set by loadDEM
            // Autopilot guidance tunnel: the meshes live in guidanceGroup and are
            // rebuilt on every route change, while geometry and material are shared
            // singletons that survive rebuilds (nothing to dispose per rebuild).
            this.guidanceGroup = null;
            this.guidanceGeometry = null;
            this.guidanceMaterial = null;
            // Glide range curtain (buildGlideRange): rebuilt as the reach changes
            this.glideGroup = null;
            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(
                75,
                container.clientWidth / container.clientHeight,
                0.01,
                100000
            );
            this.camera.position.set(0, 2000, 2000);
            this.renderer = new THREE.WebGLRenderer({
                //antialias: true
            });
            /*
            renderer.toneMappingExposure = 2.3
            renderer.shadowMap.enabled = true;
            renderer.toneMappingExposure = 1;
            */

            // Add ambient and directional lighting. configureLighting() sets them
            // from synthview.json; the sun then follows the heading (updateSun).
            this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
            this.scene.add(this.ambientLight);

            this.sun = new THREE.DirectionalLight(0xffffff, 1);
            this.sun.position.set(2000, 2000, 0);
            this.scene.add(this.sun);
            this.scene.add(this.sun.target);
            this.sunSetup = SYNTHVIEW_SUN;
            this.hazeSetup = SYNTHVIEW_HAZE;
            this.shadowSetup = SYNTHVIEW_SHADOWS;

            // Add controls for navigation
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);

        }


        // Sun, haze and cast shadows from synthview.json (sun, haze, shadows), each
        // falling back to the SYNTHVIEW_* defaults. Haze and shadow distances are
        // fractions of the terrain window's half width, so they follow the grid.
        configureLighting(setup) {
            this.sunSetup = Object.assign({}, SYNTHVIEW_SUN, setup.sun || {});
            this.hazeSetup = Object.assign({}, SYNTHVIEW_HAZE, setup.haze || {});
            this.shadowSetup = Object.assign({}, SYNTHVIEW_SHADOWS, setup.shadows || {});
            this.ambientLight.intensity = this.sunSetup.ambient;
            this.sun.intensity = this.sunSetup.intensity;
            const shadows = this.shadowSetup.enabled === true;
            this.renderer.shadowMap.enabled = shadows;
            this.renderer.shadowMap.type = THREE.PCFShadowMap;
            this.sun.castShadow = shadows;
            if (shadows) {
                this.sun.shadow.mapSize.set(this.shadowSetup.mapSize, this.shadowSetup.mapSize);
                this.sun.shadow.bias = -0.0008;
                this.sun.shadow.normalBias = 20;
            }
        }

        // Haze and shadow box sized on the terrain window, called by loadDEM
        fitToTerrain(width) {
            const half = width / 2;
            const haze = this.hazeSetup;
            this.scene.fog = haze.enabled === true ?
                new THREE.Fog(new THREE.Color(haze.color.r, haze.color.g, haze.color.b), haze.start * half, haze.end * half) : null;
            if (this.sun.castShadow) {
                const box = this.sun.shadow.camera, r = this.shadowSetup.range * half;
                box.left = -r; box.right = r; box.bottom = -r; box.top = r;
                box.near = 1; box.far = half * 2;
                box.updateProjectionMatrix();
                this.sunDistance = half;
            }
        }

        // The sun stays at relativeAzimuth from the heading (front left by default),
        // elevation degrees up, so the relief is lit the same way on every heading.
        // It sits over the point the camera looks at, which the shadow box covers.
        updateSun(heading) {
            const az = (heading + this.sunSetup.relativeAzimuth) * Math.PI / 180;
            const el = this.sunSetup.elevation * Math.PI / 180;
            const target = this.controls.target;
            const d = this.sunDistance || 30000;
            this.sun.target.position.copy(target);
            this.sun.position.set(
                target.x + d * Math.cos(el) * Math.sin(az),
                target.y + d * Math.sin(el),
                target.z - d * Math.cos(el) * Math.cos(az)   // north is -Z
            );
        }

        setBackgroundColor(skyColor, groundColor = null) {
            const colorSky = 255 * skyColor.r << 16 | 255 * skyColor.g << 8 | 255 * skyColor.b;
            this.scene.background = new THREE.Color(colorSky); // Sky blue background
            if (groundColor == null) return;
            // Sky and ground dome around the camera, as on the attitude indicator:
            // sky above the eye-level horizon, brown below it. Wherever there is no
            // terrain (beyond the window edge, seen from altitude) the ground is
            // brown, not the sky colour. With haze on, sky and ground both fade into
            // the haze colour at the horizon, where the hazed terrain ends; otherwise
            // the horizon is hard. Drawn first and without depth, so everything else
            // covers it.
            if (this.dome != null) {
                this.scene.remove(this.dome);
                this.dome.geometry.dispose();
                this.dome.material.dispose();
            }
            this.dome = new THREE.Mesh(
                new THREE.SphereGeometry(this.camera.far * 0.5, 32, 16),
                new THREE.ShaderMaterial({
                    uniforms: {
                        sky: { value: new THREE.Vector3(skyColor.r, skyColor.g, skyColor.b) },
                        ground: { value: new THREE.Vector3(groundColor.r, groundColor.g, groundColor.b) },
                        haze: { value: new THREE.Vector3(this.hazeSetup.color.r, this.hazeSetup.color.g, this.hazeSetup.color.b) },
                        hazeOn: { value: this.hazeSetup.enabled === true ? 1.0 : 0.0 }
                    },
                    // vUp: the sine of the elevation of the direction drawn
                    vertexShader: 'varying float vUp; void main() { vUp = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
                    fragmentShader: 'uniform vec3 sky; uniform vec3 ground; uniform vec3 haze; uniform float hazeOn; varying float vUp; void main() {' +
                        ' vec3 c = vUp >= 0.0 ? mix(haze, sky, max(smoothstep(0.0, 0.18, vUp), 1.0 - hazeOn)) : mix(haze, ground, max(smoothstep(0.0, 0.12, -vUp), 1.0 - hazeOn));' +
                        ' gl_FragColor = vec4(c, 1.0); }',
                    side: THREE.BackSide,
                    depthTest: false,
                    depthWrite: false
                })
            );
            this.dome.renderOrder = -1000;
            this.dome.frustumCulled = false;
            // Centred on the camera on every frame: the horizon stays at eye level
            this.dome.onBeforeRender = (renderer, scene, camera) => {
                this.dome.position.copy(camera.position);
                this.dome.updateMatrixWorld();
            };
            this.scene.add(this.dome);
        }

        attachToContainer(divName) {
            const container = document.getElementById(divName);
            this.renderer.setSize(container.clientWidth, container.clientHeight);
            //this.renderer.domElement.style.width = "100cqw";
            //this.renderer.domElement.style.height = "100cqh";
            container.appendChild(this.renderer.domElement);
        }


        generateItems(items, setup) {
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (item.reference != null || item.generating != null) {
                    continue;
                }
                item.generating = true;
                // The model loads asynchronously: the callback works on the item
                // itself, never on items[i]. With a function scoped i it wrote
                // every load to the slot past the end of the array, duplicating
                // items or overwriting traffic pushed meanwhile, which then stayed
                // in the scene forever with no way to remove it.
                this.generateItem(item, setup, (itemReady) => {
                    if (this.disposed || itemReady.removed) {
                        // Plate left or traffic expired while the model loaded
                        if (itemReady.reference != null) this.disposeObject(itemReady.reference.scene);
                        return;
                    }
                    if (itemReady.reference != null) {
                        this.scene.add(itemReady.reference.scene);
                    }

                    // Tube down to sea level, and the predicted path of an
                    // aircraft (airfields stand still: no path)
                    this.generateTubeVertical(itemReady, setup);
                    this.scene.add(itemReady.referenceTubeVertical);
                    if (itemReady.airfieldKey == null) {
                        this.generateTubeProjection(itemReady, setup);
                        this.scene.add(itemReady.referenceTubeFront);
                    }
                    this.updateTubes(itemReady, setup);

                    this.generateThreshold(itemReady, setup);
                    if (itemReady.referenceThreshold != null) {
                        this.scene.add(itemReady.referenceThreshold);
                    }
                    if (itemReady.referenceLabel != null) {
                        this.scene.add(itemReady.referenceLabel);
                    }

                    requestAnimationFrame(animate);
                })
            }
        }



        cameraFollowItem(item, resources, distance = 5) {
            this.camera.position.set(
                item.x - distance * Math.sin((Math.PI * 2.0 / 360) * (item.direction + 0)) * resources.setup.cellSize / FollowMeDistance,
                this.sceneY(item.elevation),
                item.y - distance * Math.cos((Math.PI * 2.0 / 360) * (item.direction + 180)) * resources.setup.cellSize / FollowMeDistance
            );
            // The camera sits behind the aircraft at its altitude: on the ground, on
            // final or climbing out of a valley the terrain behind is higher and the
            // camera would be inside the hill. Keep it above the ground under it; it
            // then looks down at the aircraft.
            const ground = this.groundAt(this.camera.position.x, this.camera.position.z);
            if (ground != null) {
                const clearance = resources.setup.cameraClearanceMeters != null ? resources.setup.cameraClearanceMeters : 60;
                this.camera.position.y = Math.max(this.camera.position.y, ground + this.sceneY(clearance));
            }
            this.controls.target.set(
                item.x + distance * Math.sin((Math.PI * 2.0 / 360) * (item.direction + 0)) * resources.setup.cellSize / FollowMeDistance,
                this.sceneY(item.elevation),
                item.y + distance * Math.cos((Math.PI * 2.0 / 360) * (item.direction + 180)) * resources.setup.cellSize / FollowMeDistance
            );
            this.controls.update();
        }

        // Scene height of a height in metres. One unit a metre by default, which
        // stands the scene 1 / unitsPerMeter (about 2.5) times taller than wide;
        // synthview.json "verticalExaggeration" sets that ratio (heightScaleFor).
        sceneY(metres) {
            return metres * this.heightScale;
        }

        // Terrain height under a scene point, in scene units (sceneY), null off the window. The
        // highest of the four surrounding nodes: the mesh between them is never
        // above it, so a camera held at this height is never inside the surface.
        groundAt(x, z) {
            if (this.terrainBrown == null || this.terrainGrid == null) return null;
            const grid = this.terrainGrid;
            const nrows = grid.length, ncols = grid[0].length;
            const p = this.terrainBrown.geometry.parameters;
            const col = (x - this.terrainBrown.position.x + p.width / 2) / (p.width / (ncols - 1));
            const fromNorth = (z - this.terrainBrown.position.z + p.height / 2) / (p.height / (nrows - 1));
            if (!(col >= 0 && col <= ncols - 1 && fromNorth >= 0 && fromNorth <= nrows - 1)) return null;
            const c0 = Math.floor(col), c1 = Math.min(c0 + 1, ncols - 1);
            const r0 = nrows - 1 - Math.floor(fromNorth), r1 = Math.max(r0 - 1, 0);
            return this.sceneY(Math.max(grid[r0][c0], grid[r0][c1], grid[r1][c0], grid[r1][c1]));
        }

        generateItem(item, setup = {}, callback = null) {
            if (item.template != "") {
                return this.generateItemGLB(item, setup, callback);
            }
        }

        // Both tubes are one unit tall cylinders that updateTubes() stretches:
        // built once with an item, they follow its climbs, descents and speed
        // changes without new buffers. Sized at creation they kept the first
        // altitude (the vertical one floated or sank as the traffic moved) and
        // the first speed (a target first seen at 0 kt never got a path).
        generateTubeVertical(item, setup) {
            item.referenceTubeVertical = new THREE.Mesh(
                new THREE.CylinderGeometry(TUBE_RADIUS, TUBE_RADIUS, 1, 32),
                new THREE.MeshBasicMaterial({ color: TUBE_COLOR }));
            item.referenceTubeVertical.name = "tubeVertical";
            return item;
        }

        generateTubeProjection(item, setup) {
            item.referenceTubeFront = new THREE.Mesh(
                new THREE.CylinderGeometry(TUBE_RADIUS, TUBE_RADIUS, 1, 32),
                new THREE.MeshBasicMaterial({ color: TUBE_COLOR }));
            item.referenceTubeFront.name = "tubeProjection";
            return item;
        }

        // synthview.json "projection", every value checked
        projectionSetup(configured) {
            const c = configured || {};
            const seconds = c.seconds;
            return {
                "enabled": c.enabled !== false,
                "seconds": (typeof seconds === "number" && isFinite(seconds) && seconds >= 5 && seconds <= 600) ? seconds : PROJECTION_SECONDS
            };
        }

        // The vertical tube from sea level up to the item; the predicted path
        // from the item to where it will be in projection.seconds at its ground
        // speed, track and vertical speed: climbing it points up, descending
        // down. Both drawn in the scene's own scales (setup.unitsPerMeter
        // across, a unit a metre up), so a path that meets the terrain or
        // another aircraft's path does so in that time. No ground speed, no path.
        updateTubes(item, setup) {
            const vertical = item.referenceTubeVertical;
            if (vertical != null) {
                const height = Math.max(this.sceneY(item.elevation), 0);
                vertical.visible = height > 0;
                vertical.scale.y = Math.max(height, 1e-3);
                vertical.position.set(item.x, height / 2, item.y);
            }
            const path = item.referenceTubeFront;
            if (path == null) return;
            const projection = this.projectionSetup(setup.projection);
            const d = predictedPathOffset(item.groundSpeedKt || 0, item.direction || 0, item.verticalFpm || 0,
                projection.seconds, setup.unitsPerMeter || 0);
            d[1] = this.sceneY(d[1]);
            const length = Math.hypot(d[0], d[1], d[2]);
            path.visible = projection.enabled && item.groundSpeedKt > 0 && isFinite(length) && length > 1;
            if (!path.visible) return;
            path.material.color.setHex(item.verticalKnown === false ? TUBE_COLOR_NO_VERTICAL : TUBE_COLOR);
            path.scale.y = length;
            path.position.set(item.x + d[0] / 2, this.sceneY(item.elevation) + d[1] / 2, item.y + d[2] / 2);
            path.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(d[0] / length, d[1] / length, d[2] / length));
        }

        generateThreshold(item, setup) {

            var labelDisplacement = this.sceneY(item.elevation) + 120;

            if (item.hasOwnProperty("heading")) {
                if(item.heading>180) {
                    item.heading = item.heading - 180;
                }
                const container = new THREE.Object3D();
                container.position.y = this.sceneY(item.elevation - elevantionPOIfromSurface) + 10;
                labelDisplacement = container.position.y + elevantionPOIfromSurface + 130;
                container.position.x = item.x
                container.position.z = item.y
                container.rotation.y = (Math.PI * 2.0 / 360) * (-item.heading);
                item.referenceThreshold = container;

                // Meters to feet
                var runwayLength = 500 * 3.28084;
                var runwayWidth = 10 * 3.28084;
                const runwayHeight = 20;

                if (item.hasOwnProperty("length_ft") && item.length_ft>runwayLength) runwayLength = item.length_ft;
                if (item.hasOwnProperty("width_ft") && item.width_ft>runwayWidth) runwayWidth = item.width_ft;

                // Feet to DEM
                runwayLength = runwayLength / (setup.cellSize/32.8084);
                // Width will be DOUBLED!
                runwayWidth = runwayWidth / (setup.cellSize/32.8084/2);


                const runwayGeometry = new THREE.BoxGeometry(runwayWidth, runwayHeight, runwayLength);
                const runwayMaterial = new THREE.MeshBasicMaterial({ color: 0x555555 });
                const runway = new THREE.Mesh(runwayGeometry, runwayMaterial);
                container.add(runway);

                const runwayGeometryWhite = new THREE.BoxGeometry(120, 5, runwayLength+120*2);
                const runwayMaterialWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
                const runwayWhite = new THREE.Mesh(runwayGeometryWhite, runwayMaterialWhite);
                container.add(runwayWhite);

                if (window.hasOwnProperty("font")) {
                    const fontSize = 75;
                    var text1Text = "";
                    var text2Text = "";
                    if (item.heading > 180) {
                        text1Text = "" + parseInt((item.heading - 180) / 10);
                        text2Text = "" + parseInt((item.heading) / 10);
                    } else {
                        text1Text = "" + parseInt((item.heading) / 10);
                        text2Text = "" + parseInt((item.heading + 180) / 10);
                    }
                    const text1Geo = new THREE.TextGeometry(text2Text.padStart(2, "0"), {
                        font: window.font,
                        size: fontSize,
                        height: 10,
                    });
                    const text2Geo = new THREE.TextGeometry(text1Text.padStart(2, "0"), {
                        font: window.font,
                        size: fontSize,
                        height: 10,
                    });


                    const textMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
                    const text1 = new THREE.Mesh(text1Geo, textMaterial);
                    const text2 = new THREE.Mesh(text2Geo, textMaterial);

                    text1.geometry.center();
                    text2.geometry.center();
                    text1.position.z = -(runwayLength / 2 + fontSize);
                    text2.position.z = (runwayLength / 2 + fontSize);

                    text1.rotation.x = (Math.PI * 2.0 / 360) * (90)
                    text2.rotation.x = (Math.PI * 2.0 / 360) * (-90)
                    text1.rotation.y = (Math.PI * 2.0 / 360) * (180)
                    container.add(text1);
                    container.add(text2);

                    const shape = new THREE.Shape();
                    shape.moveTo(0, 0);
                    shape.lineTo(40, 0);
                    shape.lineTo(20, 40);
                    shape.closePath();

                    // Flat triangle geometry (like a painted arrow)
                    const triGeometry = new THREE.ShapeGeometry(shape);
                    const triMaterial = new THREE.MeshLambertMaterial({
                        color: 0x000000,
                        side: THREE.DoubleSide
                    });

                    // === Triangle pointing toward heading 160° ===
                    const triangleH = new THREE.Mesh(triGeometry, triMaterial);
                    triangleH.geometry.center();
                    triangleH.position.z = -(runwayLength / 2 + 20);
                    triangleH.rotation.x = (Math.PI * 2.0 / 360) * (90)
                    triangleH.rotation.y = (Math.PI * 2.0 / 360) * (180)
                    triangleH.position.y = 5;
                    container.add(triangleH);

                    const triangleL = new THREE.Mesh(triGeometry, triMaterial);
                    triangleL.geometry.center();
                    triangleL.position.z = (runwayLength / 2 + 20);
                    triangleL.rotation.x = (Math.PI * 2.0 / 360) * (-90)
                    triangleL.rotation.y = (Math.PI * 2.0 / 360) * (180)
                    triangleL.position.y = 5;
                    container.add(triangleL);

                }
            }

            if (item.hasOwnProperty("name") && item.name != "" && item.name != "ME") {
                if (window.hasOwnProperty("font")) {
                    const fontSize = 100;
                    const text = item.name.substring(0, 8);
                    const text1Geo = new THREE.TextGeometry(text, {
                        font: window.font,
                        size: fontSize,
                        height: 20,
                    });

                    const textMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
                    const label = new THREE.Mesh(text1Geo, textMaterial);
                    label.geometry.center();
                    label.position.x = item.x;
                    label.position.z = item.y;
                    label.position.y = labelDisplacement;
                    item.referenceLabel = label;
                }
            }

            return item;
        }


        /*****************************************************
         * Glide range (js/glidereach.js, docs/glide-range.md)
         *
         * The boundary of the area reachable in a best-glide descent, the one the
         * 2D map outlines, stood on the terrain as a dashed translucent curtain
         * with a solid line along its foot: a line flat on the ground disappears
         * at the grazing angles of a cockpit view, a fence does not. Magenta and
         * dashed like the map's outline unless synthview.json "glideRange" says
         * otherwise. Static in world coordinates, rebuilt when the reach changes.
         */

        // synthview.json "glideRange", every value checked
        glideRangeSetup(configured) {
            const c = configured || {};
            const number = (value, fallback, min, max) => {
                return (typeof value === "number" && isFinite(value) && value >= min && value <= max) ? value : fallback;
            };
            return {
                "enabled": c.enabled !== false,
                "color": number(c.color, 0xFF00FF, 0, 0xFFFFFF),
                "opacity": number(c.opacity, 0.55, 0.05, 1),
                "wallMeters": number(c.wallMeters, 150, 10, 2000),
                "liftMeters": number(c.liftMeters, 15, 0, 500),
                "dashCells": number(c.dashCells, 1.0, 0.1, 50),
                "gapCells": number(c.gapCells, 0.6, 0, 50)
            };
        }

        // reach: glideReach() or null; terrain: the TerrainManager (its projection)
        buildGlideRange(reach, terrain, setup) {
            this.disposeGlideRange();
            const style = this.glideRangeSetup(setup.glideRange);
            if (reach == null || !style.enabled || this.terrainBrown == null || !setup.cellSize) return;
            const cell = setup.cellSize;
            const dash = style.dashCells * cell, period = dash + style.gapCells * cell;

            // The boundary in scene units, half a cell between samples so it follows
            // the ground; a sample off the terrain mesh breaks it (null).
            const ring = reach.points.concat([reach.points[0]]);
            const samples = [];
            for (let k = 0; k + 1 < ring.length; k++) {
                const a = ring[k], b = ring[k + 1];
                const n = Math.max(1, Math.ceil(2 * Math.max(Math.abs(b[0] - a[0]) / terrain.moltipliers.lat,
                    Math.abs(b[1] - a[1]) / terrain.moltipliers.lon)));
                for (let i = (k == 0 ? 0 : 1); i <= n; i++) {
                    const t = i / n;
                    const xy = terrain.plan(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
                    const x = xy[0] * cell, z = xy[1] * cell;
                    const ground = this.groundAt(x, z);
                    samples.push(ground == null ? null : [x, Math.max(ground, 0) + this.sceneY(style.liftMeters), z]);
                }
            }

            const wall = [], lines = [];
            let along = 0;
            for (let k = 0; k + 1 < samples.length; k++) {
                const p = samples[k], q = samples[k + 1];
                if (p == null || q == null) continue;
                const top = this.sceneY(style.wallMeters);
                lines.push(p[0], p[1], p[2], q[0], q[1], q[2]);
                const length = Math.hypot(q[0] - p[0], q[2] - p[2]);
                const on = (along % period) < dash;
                along += length;
                if (!on) continue;
                wall.push(p[0], p[1], p[2], q[0], q[1], q[2], q[0], q[1] + top, q[2],
                    p[0], p[1], p[2], q[0], q[1] + top, q[2], p[0], p[1] + top, p[2]);
                lines.push(p[0], p[1] + top, p[2], q[0], q[1] + top, q[2]);
            }
            if (lines.length == 0) return;

            const group = new THREE.Group();
            group.name = "glideRange";
            const wallGeometry = new THREE.BufferGeometry();
            wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
            const curtain = new THREE.Mesh(wallGeometry, new THREE.MeshBasicMaterial({
                color: style.color, transparent: true, opacity: style.opacity,
                side: THREE.DoubleSide, depthWrite: false
            }));
            curtain.name = "glideRangeCurtain";
            group.add(curtain);
            const lineGeometry = new THREE.BufferGeometry();
            lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
            const outline = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: style.color }));
            outline.name = "glideRangeLine";
            group.add(outline);
            this.glideGroup = group;
            this.scene.add(group);
        }

        disposeGlideRange() {
            if (this.glideGroup == null) return;
            this.scene.remove(this.glideGroup);
            this.disposeObject(this.glideGroup);
            this.glideGroup = null;
        }

        /*****************************************************
         * Autopilot guidance tunnel (Highway In The Sky)
         *
         * Draws the flight plan as a row of magenta rectangular frames the pilot
         * flies through, G3X style. The tunnel is STATIC in world coordinates: it
         * is rebuilt only when the route changes, never per frame. That is what
         * keeps it correct while the pilot pans the camera with OrbitControls.
         */

        // A device may still carry a synthview.json with no guidance block, or a
        // partial one. Every knob the placement loop divides or counts by is given a
        // sane positive value here, so a bad config can never hang the display.
        guidanceSetup(guidance) {
            const configured = guidance || {};
            const positive = (value, fallback) => {
                return (typeof value === "number" && isFinite(value) && value > 0) ? value : fallback;
            };
            // Zero is a legal value for these two, unlike the divisors below
            const atLeastZero = (value, fallback) => {
                return (typeof value === "number" && isFinite(value) && value >= 0) ? value : fallback;
            };
            return {
                "enabled": configured.enabled === true,
                "color": atLeastZero(configured.color, 0xFF00FF),
                "opacity": positive(configured.opacity, 0.55),
                "widthCells": positive(configured.widthCells, 0.35),
                "aspect": positive(configured.aspect, 0.5),
                "borderRatio": positive(configured.borderRatio, 0.08),
                "spacingCells": positive(configured.spacingCells, 0.3),
                "maxLegs": positive(configured.maxLegs, 3),
                "maxBoxes": positive(configured.maxBoxes, 60),
                "maxRangeCells": positive(configured.maxRangeCells, 12),
                "minAglMeters": atLeastZero(configured.minAglMeters, 300),
                "tiltWithPath": configured.tiltWithPath === true
            };
        }

        // Shared, width-normalised frame: outer 1.0 x aspect with a hole inset by
        // borderRatio. Every mesh scales it uniformly, so the border thickness stays
        // visually even on all four edges and no shear is possible.
        generateGuidanceFrame(guidance) {
            if (this.guidanceGeometry != null) {
                return;
            }
            const aspect = guidance.aspect;
            const border = guidance.borderRatio;

            const outer = new THREE.Shape();
            outer.moveTo(-0.5, -aspect / 2);
            outer.lineTo(0.5, -aspect / 2);
            outer.lineTo(0.5, aspect / 2);
            outer.lineTo(-0.5, aspect / 2);
            outer.closePath();

            const hole = new THREE.Path();
            hole.moveTo(-0.5 + border, -aspect / 2 + border);
            hole.lineTo(0.5 - border, -aspect / 2 + border);
            hole.lineTo(0.5 - border, aspect / 2 - border);
            hole.lineTo(-0.5 + border, aspect / 2 - border);
            hole.closePath();
            outer.holes.push(hole);

            this.guidanceGeometry = new THREE.ShapeGeometry(outer);
            // Basic, not Lambert: the single directional light would otherwise make
            // the magenta dull and dependent on the leg heading.
            // depthWrite:false keeps depthTest on (terrain correctly occludes the
            // tunnel) while stopping the frames from occluding each other, so the
            // tunnel blends with depth instead of becoming a solid magenta wall.
            this.guidanceMaterial = new THREE.MeshBasicMaterial({
                color: guidance.color,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: guidance.opacity,
                depthWrite: false
            });
        }

        // Vertical profile. Ele is int32 feet and is very often 0 (GPX imports carry
        // no altitude), so gaps are interpolated by cumulative ground distance
        // between the waypoints that do have one. Everything is clamped to a terrain
        // clearance floor so the tunnel can never be drawn into a hillside.
        generateGuidanceElevations(route, guidance, terrain, fallbackElevation) {
            var elevations = [];
            var distances = [0];
            var anchors = [];

            for (var i = 0; i < route.length; i++) {
                elevations.push(route[i].Ele > 0 ? route[i].Ele * 0.3048 : null);
                if (elevations[i] != null) {
                    anchors.push(i);
                }
                if (i > 0) {
                    distances.push(distances[i - 1] + guidanceLegMeters(route[i - 1], route[i]));
                }
            }

            if (anchors.length == 0) {
                for (var i = 0; i < route.length; i++) {
                    elevations[i] = fallbackElevation;
                }
            }
            else {
                // Hold the outermost known altitudes level beyond the anchors
                for (var i = 0; i < anchors[0]; i++) {
                    elevations[i] = elevations[anchors[0]];
                }
                for (var i = anchors[anchors.length - 1] + 1; i < route.length; i++) {
                    elevations[i] = elevations[anchors[anchors.length - 1]];
                }
                // Interpolate the gaps between two known altitudes
                for (var a = 0; a < anchors.length - 1; a++) {
                    const from = anchors[a];
                    const to = anchors[a + 1];
                    const span = distances[to] - distances[from];
                    for (var i = from + 1; i < to; i++) {
                        const ratio = span > 0 ? (distances[i] - distances[from]) / span : 0;
                        elevations[i] = elevations[from] + (elevations[to] - elevations[from]) * ratio;
                    }
                }
            }

            // Terrain clearance floor. Written inverted so a NaN sneaking in from a
            // missing fallback elevation is clamped too: NaN positions would break
            // frustum culling through the bounding sphere.
            for (var i = 0; i < route.length; i++) {
                const floor = terrain.elevationByLatLon(route[i].Lat, route[i].Lon) + guidance.minAglMeters;
                if (!(elevations[i] >= floor)) {
                    elevations[i] = floor;
                }
            }
            return elevations;
        }

        buildGuidanceTunnel(route, setup, terrain, fallbackElevation) {
            this.disposeGuidance();

            const guidance = this.guidanceSetup(setup.guidance);
            if (guidance.enabled !== true) return;
            if (!terrain.isReady()) return;
            if (!setup.cellSize) return;
            if (route == null || route.length < 2) return;

            this.generateGuidanceFrame(guidance);

            // Everything below is sized in world units derived from cellSize. The
            // follow camera also sits at a multiple of cellSize (see
            // cameraFollowItem), so tying the tunnel to the same unit keeps it a
            // constant size on screen whatever the DEM resolution turns out to be.
            // Real metres are useless here: the camera is ~2.5 cells back, which is
            // tens of kilometres, and a true 180 m corridor renders under 2 pixels.
            const width = guidance.widthCells * setup.cellSize;
            const spacing = guidance.spacingCells * setup.cellSize;
            const maxRange = guidance.maxRangeCells * setup.cellSize;
            const elevations = this.generateGuidanceElevations(route, guidance, terrain, fallbackElevation);

            // Start on the leg actually being flown: the one ENTERING the active
            // target, not the one leaving it.
            var start = -1;
            for (var i = 0; i < route.length; i++) {
                if (route[i].Status == WAYPOINT_STATUS_TARGET) {
                    start = i > 0 ? i - 1 : 0;
                    break;
                }
            }
            if (start < 0) {
                for (var i = 0; i < route.length; i++) {
                    if (route[i].Status != WAYPOINT_STATUS_PAST) {
                        start = i;
                        break;
                    }
                }
            }
            if (start < 0 || start >= route.length - 1) return;

            const group = new THREE.Group();
            const lastLeg = Math.min(route.length - 2, start + guidance.maxLegs - 1);
            // Frames are spaced evenly along the whole path rather than restarting at
            // every waypoint, so turns keep a constant interval instead of showing a
            // gap on one side and a doubled frame on the other.
            var walked = 0;
            var nextFrame = 0;

            for (var leg = start; leg <= lastLeg; leg++) {
                const from = route[leg];
                const to = route[leg + 1];

                const fromXY = terrain.plan(from.Lat, from.Lon);
                const toXY = terrain.plan(to.Lat, to.Lon);
                const x0 = fromXY[0] * setup.cellSize;
                const z0 = fromXY[1] * setup.cellSize;
                const y0 = this.sceneY(elevations[leg]);
                const dx = toXY[0] * setup.cellSize - x0;
                const dz = toXY[1] * setup.cellSize - z0;
                const dyMeters = elevations[leg + 1] - elevations[leg];
                const dy = this.sceneY(dyMeters);

                const horizontal = Math.hypot(dx, dz);
                const legMeters = guidanceLegMeters(from, to);
                // Coincident waypoints would give NaN positions, which silently
                // break frustum culling through the bounding sphere.
                if (horizontal < 1e-6 || legMeters < 1.0) continue;

                const hx = dx / horizontal;
                const hz = dz / horizontal;

                // ShapeGeometry faces +Z, and Ry(yaw)*(0,0,1) == (sin yaw,0,cos yaw)
                const yaw = Math.atan2(hx, hz);
                // True flight path angle, from real metres: using the world-space dy
                // would over-tilt the frames by the vertical exaggeration.
                const tilt = guidance.tiltWithPath ? -Math.atan2(dyMeters, legMeters) : 0;

                while (nextFrame < walked + horizontal) {
                    if (group.children.length >= guidance.maxBoxes) break;
                    if (nextFrame > maxRange) break;

                    const ratio = (nextFrame - walked) / horizontal;
                    const frame = new THREE.Mesh(this.guidanceGeometry, this.guidanceMaterial);
                    frame.position.set(x0 + dx * ratio, y0 + dy * ratio, z0 + dz * ratio);
                    frame.rotation.order = 'YXZ';
                    frame.rotation.y = yaw;
                    frame.rotation.x = tilt;
                    frame.scale.set(width, width, 1);
                    frame.renderOrder = 1;
                    group.add(frame);

                    nextFrame = nextFrame + spacing;
                }

                walked = walked + horizontal;
                if (nextFrame > maxRange) break;
                if (group.children.length >= guidance.maxBoxes) break;
            }

            this.guidanceGroup = group;
            this.scene.add(group);
        }

        // Called on every rebuild: the meshes are garbage collected, while the
        // shared geometry and material are kept for the next build.
        disposeGuidance() {
            if (this.guidanceGroup != null) {
                this.scene.remove(this.guidanceGroup);
                this.guidanceGroup = null;
            }
        }

        // Frees the GPU buffers of an object and everything under it. Removing
        // a mesh from the scene alone keeps its buffers alive in the renderer.
        disposeObject(object) {
            if (object == null) return;
            if (object.parent != null) object.parent.remove(object);
            object.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    const materials = Array.isArray(o.material) ? o.material : [o.material];
                    materials.forEach((m) => {
                        Object.keys(m).forEach((key) => {
                            if (m[key] && m[key].isTexture) m[key].dispose();
                        });
                        m.dispose();
                    });
                }
            });
        }

        // An item (traffic, airfield) leaving the scene: model, tubes, threshold
        // and label. A model still loading is freed by generateItems on arrival.
        disposeItem(item) {
            item.removed = true;
            if (item.reference != null) this.disposeObject(item.reference.scene);
            this.disposeObject(item.referenceTubeFront);
            this.disposeObject(item.referenceTubeVertical);
            this.disposeObject(item.referenceThreshold);
            this.disposeObject(item.referenceLabel);
            item.reference = null;
            item.referenceTubeFront = null;
            item.referenceTubeVertical = null;
            item.referenceThreshold = null;
            item.referenceLabel = null;
        }

        // Leaving the plate: the next visit builds a new Rendering, so free the
        // scene, the controls and the WebGL context. Browsers keep only about 16
        // contexts; the oldest are lost and their memory is held until then.
        dispose() {
            if (this.disposed) return;
            this.disposed = true;
            this.disposeGuidanceResources();
            this.disposeGlideRange();
            this.disposeDEM();
            while (this.scene.children.length > 0) {
                this.disposeObject(this.scene.children[0]);
            }
            this.dome = null;
            this.controls.dispose();
            this.renderer.dispose();
            this.renderer.forceContextLoss();
            if (this.renderer.domElement.parentNode != null) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        // Called only when leaving the plate
        disposeGuidanceResources() {
            this.disposeGuidance();
            if (this.guidanceGeometry != null) {
                this.guidanceGeometry.dispose();
                this.guidanceGeometry = null;
            }
            if (this.guidanceMaterial != null) {
                this.guidanceMaterial.dispose();
                this.guidanceMaterial = null;
            }
        }

        generateItemGLB(item, setup = {}, callback = null) {
            const loader = new THREE.GLTFLoader();
            loader.load(
                setup.glbPath + item.template + '.glb',
                (gltf) => {
                    //console.log('Model loaded successfully:', gltf);

                    gltf.scene.scale.x = item.scale * setup.cellSize / 300;
                    gltf.scene.scale.y = item.scale * setup.cellSize / 300;
                    gltf.scene.scale.z = item.scale * setup.cellSize / 300;

                    gltf.scene.position.x = item.x
                    gltf.scene.position.y = this.sceneY(item.elevation)
                    gltf.scene.position.z = item.y
                    gltf.scene.rotation.x = (Math.PI * 2.0 / 360) * item.pitch // Pitch
                    gltf.scene.rotation.y = (Math.PI * 2.0 / 360) * (180 - item.direction + item.directionModel) // Yaw
                    gltf.scene.rotation.z = (Math.PI * 2.0 / 360) * item.roll // Roll

                    gltf.scene.rotation.order = "YXZ"

                    item.reference = gltf;
                    if (callback != null) {
                        callback(item, setup);
                    }
                    //scene.add(gltf.scene);
                    if (item.color != null) {
                        gltf.scene.traverse((object) => {
                            if (object.isMesh) {
                                /*
                                object.material.color.set( 0x00ccff );
                                object.castShadow = true;
                                object.receiveShadow = true;
                                */
                                const material = object.material;
                                if (material && material.isMeshStandardMaterial) {
                                    // Adjust material color (set to a brighter tone)
                                    //material.color.set(0x9999ff); // Example: Bright blue
                                    material.emissive.set(item.color); // Add subtle emissive glow
                                    material.emissiveIntensity = 0.5;
                                }
                            }
                        });
                    }
                },
                (xhr) => {
                    //console.log(`Loading model: ${(xhr.loaded / xhr.total) * 100}% loaded`);
                },
                (error) => {
                    console.error('An error occurred while loading the model', error);
                }
            );
        }


        // Vertex colours of the terrain for the aircraft altitude
        generateColors(terrainElevation, altitude) {
            const ncols = terrainElevation[0].length
            const nrows = terrainElevation.length
            const grid = terrainElevation;
            const size = ncols * nrows * 3;
            const colors = [];

            for (let i = 0, j = 0; i < size; i += 3, j++) {
                var elevation = grid[nrows - 1 - Math.floor(j / ncols)][j % ncols]; // Elevation as Z value
                // Same rule as the map overlay (js/global.js)
                colors.push(...globalTerrainColor(elevation, altitude))
            }
            return colors;
        }

        // Recolour the terrain after an altitude change. The colours are written
        // into the existing buffer: a new attribute per change left the old GPU
        // buffer behind, and a new material per change was never used.
        updateTerrainColors(terrainElevation, altitude) {
            if (this.terrainBrown == null || terrainElevation == null) return;
            const colors = this.generateColors(terrainElevation, altitude);
            const attribute = this.terrainBrown.geometry.attributes.color;
            if (attribute != null && attribute.array.length == colors.length) {
                attribute.array.set(colors);
                attribute.needsUpdate = true;
            }
        }

        generateMaterial(terrainElevation, cellSize, altitude, baseColor) {
            const colors = this.generateColors(terrainElevation, altitude);
            // Lambert: lit by the sun and shadows, with no specular glare on slopes
            const materialDynamic = new THREE.MeshLambertMaterial({
                color: baseColor, // Base color
                vertexColors: true, // Enable vertex colors
                side: THREE.FrontSide, // The underside is drawn brown by loadDEM
                wireframe: false
            });
            return [materialDynamic, colors];
        }

        // The terrain moves with the aircraft: take the old window out of the
        // scene and free its buffers before laying the new one.
        disposeDEM() {
            if (this.terrainBrown == null) return;
            this.scene.remove(this.terrainBrown);
            this.terrainBrown.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
            this.terrainBrown = null;
            this.terrainGrid = null;
        }

        // plan: the window's scene position in cells (TerrainManager.windowPlan);
        // eastScale: a cell's east-west width over its length (TerrainManager.eastScale)
        loadDEM(terrainElevation, setup, plan = [0, 0], eastScale = 1) {
            this.disposeDEM();
            this.heightScale = setup.heightScale || 1;
            const ncols = terrainElevation[0].length
            const nrows = terrainElevation.length
            const grid = terrainElevation;

            // Set vertex heights based on DEM data
            const geometryBrown = new THREE.PlaneGeometry(
                ncols * setup.cellSize * eastScale,
                nrows * setup.cellSize,
                ncols - 1,
                nrows - 1
            );
            const verticesBrown = geometryBrown.attributes.position.array;
            for (let i = 0, j = 0; i < verticesBrown.length; i += 3, j++) {
                var elevation = grid[nrows - 1 - Math.floor(j / ncols)][j % ncols]; // Elevation as Z value
                verticesBrown[i + 2] = elevation * this.heightScale
            }
            geometryBrown.computeVertexNormals();

            const materialBrownColors = this.generateMaterial(terrainElevation, setup.cellSize, setup.elevation, setup.terrainBaseColor);
            // Add the color attribute to the geometry
            geometryBrown.setAttribute('color', new THREE.Float32BufferAttribute(materialBrownColors[1], 3));



            this.terrainBrown = new THREE.Mesh(geometryBrown, materialBrownColors[0]);
            this.terrainBrown.rotation.x = -Math.PI / 2; // Rotate to lay flat
            this.terrainBrown.position.set(plan[0] * setup.cellSize, 0, plan[1] * setup.cellSize);
            // Only the terrain casts and receives shadows: the aircraft symbols are
            // drawn far above true scale and would throw huge shadows
            this.terrainBrown.castShadow = this.sun.castShadow;
            this.terrainBrown.receiveShadow = this.sun.castShadow;
            this.scene.add(this.terrainBrown);
            this.terrainGrid = grid;
            // The nearest edge, east-west now that cells keep true proportions:
            // haze and shadows end before it on every heading
            this.fitToTerrain(Math.min(ncols * eastScale, nrows) * setup.cellSize);
            // Seen from below, the terrain is solid brown, as on the attitude
            // indicator, never the sky colour or the top colours mirrored.
            const under = setup.terrainUndersideColor != null ? setup.terrainUndersideColor : TERRAIN_UNDERSIDE_COLOR;
            this.terrainBrown.add(new THREE.Mesh(geometryBrown, new THREE.MeshBasicMaterial({
                color: new THREE.Color(under.r, under.g, under.b),
                side: THREE.BackSide
            })));
            // Add Wireframe to improve readability
            var geo = new THREE.EdgesGeometry(this.terrainBrown.geometry); // or WireframeGeometry
            var mat = new THREE.LineBasicMaterial({
                color: 0x778877, transparent: true,
                opacity: 0.5
            });
            var wireframe = new THREE.LineSegments(geo, mat);
            this.terrainBrown.add(wireframe);
        }

    }

    const container = document.getElementById("synthviewFrame");
    /*
        const canvas = document.getElementById("inop");
        const ctx = canvas.getContext("2d");
        
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(container.clientWidth, container.clientHeight);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "red";
        ctx.stroke();
    */

    const rendering = new Rendering(container);
    const resources = new ResourceManager();
    const remote = new RemoteController(rendering);
    $scope.remote = remote;
    $scope.resources = resources;  // read by the display tests
    async function engageContext() {
        const setup = await resources.startup();
        if (rendering.disposed) return setup;  // plate left during the fetch
        rendering.configureLighting(setup);
        rendering.setBackgroundColor(setup.skyColor, setup.terrainUndersideColor != null ? setup.terrainUndersideColor : TERRAIN_UNDERSIDE_COLOR);
        rendering.attachToContainer("synthviewFrame");
        return setup;
    }


    var lockedInTerrainGeneration = false;


    $scope.cleanupOldTraffic = function (s) {

        if (($scope === undefined) || ($scope === null) || $state.current.controller != 'SynthViewCtrl') {
            window.clearInterval($scope.cleanupOldTrafficTimer);
            return; // we are getting called once after clicking away from the status page
        }

        // Every expired item goes, not one per tick, and its buffers are freed:
        // scene.remove() alone kept each model, tube and label on the GPU
        const now = Date.now() - 1000 * 10;
        for (var i = resources.items.length - 1; i >= resources.itemIndexStartingTraffic; i--) {
            var currentItem = resources.items[i];
            // Airfields imported after a terrain move sit among the traffic:
            // they leave with the terrain window, never on a timeout
            if (currentItem !== undefined && currentItem.airfieldKey == null && currentItem.ttl < now) {
                rendering.disposeItem(currentItem);
                resources.removeItem(i);
            }
        }
    }


    $scope.loadTraffics = function (element) {

        if (element.Position_valid == false) return;
        var founded = -1;
        // Tail will be drawn on top of the traffic
        // TODO: improve this part
        if(element.Tail != "") {
            // overwriting this will make a miss on cache and recreate a new Aircraft with Tail name
            element.Icao_addr = element.Tail;
        }
        for (var i = resources.itemIndexStartingTraffic; i < resources.items.length; i++) {
            var currentItem = resources.items[i];
            // Airfields imported after a terrain move sit among the traffic
            if(currentItem === undefined || currentItem.airfieldKey != null){
                continue;
            }
            if (currentItem.name == "" + element.Icao_addr) {
                founded = i;
                break;
            }
        }

        if (founded < 0) {
            var newItem = resources.convertTrafficToItem(element, $scope.situation);
            if (newItem == null) {
                return;
            }
            resources.items.push(newItem);
            rendering.generateItems(resources.items, resources.setup);
        }
        else {
            resources.items[founded].ttl = Date.now();

            const aXY = resources.terrain.plan(element.Lat, element.Lng);
            applyTrafficMotion(resources.items[founded], element, $scope.situation);
            resources.items[founded].x = aXY[0] * resources.setup.cellSize;
            resources.items[founded].y = aXY[1] * resources.setup.cellSize;
            const item = resources.items[founded];
            const gltf = item.reference;

            if (gltf != null && gltf.hasOwnProperty("scene")) {
                gltf.scene.position.x = item.x
                gltf.scene.position.y = rendering.sceneY(item.elevation)
                gltf.scene.position.z = item.y
                gltf.scene.rotation.x = (Math.PI * 2.0 / 360) * item.pitch // Pitch
                gltf.scene.rotation.y = (Math.PI * 2.0 / 360) * (180 - item.direction + item.directionModel) // Yaw
                gltf.scene.rotation.z = (Math.PI * 2.0 / 360) * item.roll // Roll
                rendering.updateTubes(item, resources.setup);
                if (item.referenceLabel != null) {
                    item.referenceLabel.position.y = rendering.sceneY(item.elevation) + 120;
                    item.referenceLabel.position.x = item.x
                    item.referenceLabel.position.z = item.y
                }
            }
        }
    }

    // The shared terrain window moves once the aircraft is half way to its edge
    // (globalLoadTerrainGrid, js/global.js). The scene keeps its origin, so only
    // the terrain mesh, the airfields the new window brings and the guidance
    // floors change; the aircraft, traffic and markers stay where they are.
    var terrainFollowed = null;  // the last window handed to the scene
    function followTerrain(situation) {
        globalLoadTerrainGrid(situation.GPSLatitude, situation.GPSLongitude).then((data) => {
            if (rendering.disposed) return;
            if (data === terrainFollowed) return;
            terrainFollowed = data;
            if (!TerrainManager.hasCells(data)) return;  // off the grid: keep the terrain we have
            resources.terrain.load(data);
            rendering.loadDEM(data.terrainData, resources.setup, resources.terrain.windowPlan(), resources.terrain.eastScale());
            resources.pruneAirfields((item) => rendering.disposeItem(item));
            resources.importNewAirfields();
            rendering.generateItems(resources.items, resources.setup);
            rendering.buildGuidanceTunnel(resources.route, resources.setup, resources.terrain, resources.setup.elevation);
            updateGlideRange(situation, true);
            requestAnimationFrame(animate);
        }).catch((error) => console.error('Error moving the terrain:', error));
    }

    // Glide range: recomputed at most once a second, and on every new terrain
    // window, from aircraft.json "bestGlide" (glideParameters) over the window the
    // scene draws. Nothing without a fix or below the clearance (glideReach).
    const GLIDE_RECOMPUTE_MS = 1000;
    var glideComputedAt = 0;
    $scope.glideReach = null;
    $scope.glideFor = null;
    function updateGlideRange(situation, force) {
        const now = Date.now();
        if (!force && now - glideComputedAt < GLIDE_RECOMPUTE_MS) return;
        if (rendering.disposed || !resources.terrain.isReady() || !resources.setup || !resources.setup.cellSize) return;
        glideComputedAt = now;
        const params = glideParameters(window.aircraftData);
        let reach = null;
        if (params.enabled && situation.GPSFixQuality > 0) {
            const wind = (params.useWind && situation.WindValid) ? { from: situation.WindDirection, speed: situation.WindSpeed } : null;
            reach = glideReach(resources.terrain, situation.GPSLatitude, situation.GPSLongitude, situation.GPSAltitudeMSL, params, wind);
        }
        $scope.glideReach = reach;
        $scope.glideFor = [situation.GPSLatitude, situation.GPSLongitude, situation.GPSAltitudeMSL];
        rendering.buildGlideRange(reach, resources.terrain, resources.setup);
    }

    function loadSituationInSynthView(situation) {
        if (situation.GPSLatitude == 0 || situation.GPSLongitude == 0) {
            console.log("GPS Not ready");
            return;
        }
        //"GPSLatitude": 43.0, "GPSLongitude": 12.0
        if (resources.terrain.isReady()) {
            followTerrain(situation);
            updateGlideRange(situation, false);
            requestAnimationFrame(animate);
        }
        else {
            if (lockedInTerrainGeneration == true) return;
            lockedInTerrainGeneration = true;
            console.log("Terrain Not Ready");
            engageContext().then((setup) => {
                setup.elevation = situation.GPSAltitudeMSL * 0.3048


                resources.terrain.terrainFetch(situation.GPSLatitude, situation.GPSLongitude).then((terrainElevations) => {
                    if (rendering.disposed) return;
                    terrainFollowed = terrainElevations;
                    // Automatic zoom based on the Terrain detail
                    // Example of empiric calculion is:
                    // DEM for 100 NM => 240 cols/rows considering 100 meter DB
                    // Heuristic formula: 10*feet
                    setup.cellSize = parseInt((240.0 / terrainElevations.terrainData.length) * 328.084);
                    // World units per horizontal metre: every window has the grid's step
                    setup.unitsPerMeter = setup.cellSize / resources.terrain.metersPerCell();
                    setup.heightScale = heightScaleFor(setup.verticalExaggeration, setup.unitsPerMeter);
                    rendering.loadDEM(terrainElevations.terrainData, setup, resources.terrain.windowPlan(), resources.terrain.eastScale());

                    setup.items = remote.updateItemsBySituation(setup.items, situation, resources);

                    rendering.cameraFollowItem(setup.items[0], resources);
                    remote.reset = false;
                    remote.set(resources.items[0].pitch, resources.items[0].roll, resources.items[0].x, resources.items[0].y, resources.items[0].elevation, resources.items[0].direction);


                    resources.fetchAndImportAirFields().then(() => {
                        if (rendering.disposed) return;
                        rendering.generateItems(setup.items, setup);
                        resources.itemIndexStartingTraffic = setup.items.length;
                        // Event chain
                        addEventListener("TrafficUpdated", trafficUpdateEventListener);
                        //
                        $scope.cleanupOldTrafficTimer = window.setInterval($scope.cleanupOldTraffic, 10000, $scope);
                    });

                    // Autopilot guidance tunnel: built here because the projection is
                    // only valid once cellSize has been set and the DEM is loaded.
                    // Subscribing here also guarantees the event can never fire before
                    // the terrain exists.
                    resources.fetchRoute().then((route) => {
                        if (rendering.disposed) return;
                        resources.routeSignature = guidanceRouteSignature(route);
                        rendering.buildGuidanceTunnel(route, setup, resources.terrain, setup.elevation);
                        addEventListener("WaypointChanged", waypointChangedEventListener);
                        requestAnimationFrame(animate);
                    });

                    //
                    //window.setInterval(()=>{contextUpdate()},100);
                })
            })
            return;
        }
    }




    // Render loop
    function animate() {
        // A frame or a load requested before leaving the plate
        if (rendering.disposed) return;
        const item = resources.items[0];
        if (item.reference != null) {

            remote.updateItemsBySituation(resources.items, $scope.situation, resources);

            item.reference.scene.rotation.x = (Math.PI * 2.0 / 360) * item.pitch;
            item.reference.scene.rotation.y = (Math.PI * 2.0 / 360) * (180 - item.direction + item.directionModel);
            item.reference.scene.rotation.z = (Math.PI * 2.0 / 360) * item.roll;

            item.reference.scene.position.x = item.x;
            item.reference.scene.position.z = item.y;
            item.reference.scene.position.y = rendering.sceneY(item.elevation);
            rendering.updateTubes(item, resources.setup);


            if (remote.reset == false) {
                rendering.cameraFollowItem(item, resources);
                remote.reset = false
                remote.set(item.pitch, item.roll, item.x, item.y, item.elevation, item.direction);

            }


        }


        if (resources.setup.elevation > 150 + $scope.situation.GPSAltitudeMSL * 0.3048 || resources.setup.elevation < -150 + $scope.situation.GPSAltitudeMSL * 0.3048) {
            resources.setup.elevation = $scope.situation.GPSAltitudeMSL * 0.3048
            rendering.updateTerrainColors(resources.terrain.terrainData, resources.setup.elevation);

        }

        rendering.updateSun(item.direction || 0);
        rendering.renderer.render(rendering.scene, rendering.camera);
    }

}

// Scene units per metre of height. Without "verticalExaggeration" one unit a
// metre, the scene as it has always been drawn: heights 1 / unitsPerMeter
// (about 2.5) times the horizontal scale. With it, heights that many times
// the horizontal scale: 1 is true proportions. Out of 0.5..10: the default.
function heightScaleFor(exaggeration, unitsPerMeter) {
    if (typeof exaggeration !== "number" || !isFinite(exaggeration) || exaggeration < 0.5 || exaggeration > 10) return 1;
    if (!(unitsPerMeter > 0)) return 1;
    return exaggeration * unitsPerMeter;
}

// Traffic altitude in metres MSL, the reference the scene draws the aircraft
// and the terrain in. Alt is pressure altitude unless AltIsGNSS: drawn as it
// came, every target sat (GPS MSL - pressure altitude) off, 280 ft too high on
// a 1003 hPa day. Shifted by that difference when a baro source or the ADS-B
// estimate gives the aircraft's own pressure altitude; as it came otherwise.
function trafficAltitudeMeters(traffic, situation) {
    var feet = traffic.Alt || 0;
    if (!traffic.AltIsGNSS && situation && situation.BaroSourceType > 0 && situation.GPSFixQuality > 0) {
        const offset = situation.GPSAltitudeMSL - situation.BaroPressureAltitude;
        // 3000 ft is 100 hPa off standard: beyond, one of the two is not valid
        if (isFinite(offset) && Math.abs(offset) < 3000) feet += offset;
    }
    return feet * 0.3048;
}

// A traffic report onto its scene item: track, ground speed, vertical speed
// and altitude. No speed report, no ground speed, so no predicted path; no
// vertical rate, a level path in TUBE_COLOR_NO_VERTICAL.
function applyTrafficMotion(item, traffic, situation) {
    item.direction = traffic.Track || 0;
    item.groundSpeedKt = traffic.Speed_valid === false ? 0 : (traffic.Speed || 0);
    // Vvel_valid false: the source sends no vertical rate. Absent (an older
    // daemon): taken as known, as before
    item.verticalKnown = traffic.Vvel_valid !== false;
    item.verticalFpm = item.verticalKnown ? (traffic.Vvel || 0) : 0;
    item.elevation = trafficAltitudeMeters(traffic, situation);
    return item;
}

// Where an aircraft will be in `seconds` at its ground speed (kt), true track
// and vertical speed (ft/min), as a scene offset [east, up, south]: horizontal
// metres through unitsPerMeter, vertical one unit a metre like the terrain.
function predictedPathOffset(groundSpeedKt, trackDeg, verticalFpm, seconds, unitsPerMeter) {
    const across = groundSpeedKt * 1852.0 / 3600.0 * seconds * unitsPerMeter;
    const track = trackDeg * Math.PI / 180;
    return [across * Math.sin(track), verticalFpm * 0.3048 / 60.0 * seconds, -across * Math.cos(track)];
}

// True ground length of a flight plan leg, in metres.
// Deliberately computed from degrees and not from the rendered world units, which
// are distorted by the terrain projection.
function guidanceLegMeters(from, to) {
    const latMid = toRadians((from.Lat + to.Lat) * 0.5);
    return Math.hypot(
        (to.Lat - from.Lat) * 111132.0,
        (to.Lon - from.Lon) * 111320.0 * Math.cos(latMid)
    );
}

// Cheap change detector for the flight plan. Status must be part of it: waypoint
// sequencing has to rebuild the tunnel so the leg just flown disappears.
function guidanceRouteSignature(route) {
    if (route == null) return "";
    return route.map(function (waypoint) {
        return waypoint.Lat + "," + waypoint.Lon + "," + waypoint.Ele + "," + waypoint.Status;
    }).join("|");
}

function globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold) {

    if (
        oldSituation.AHRSPitch + ahrsThreshold > newSituation.AHRSPitch && oldSituation.AHRSPitch - ahrsThreshold < newSituation.AHRSPitch
        &&
        oldSituation.AHRSRoll + ahrsThreshold > newSituation.AHRSRoll && oldSituation.AHRSRoll - ahrsThreshold < newSituation.AHRSRoll
    ) {

    }
    else {
        return true;
    }
    if (oldSituation.BaroPressureAltitude + altitudeThreshold > newSituation.BaroPressureAltitude && oldSituation.BaroPressureAltitude - altitudeThreshold < newSituation.BaroPressureAltitude) {

    }
    else {
        return true;
    }

    return false;
}
