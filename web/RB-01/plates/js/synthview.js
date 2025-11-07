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


// create our controller function with all necessary logic
function SynthViewCtrl($rootScope, $scope, $state, $http, $interval) {
    // RB-01, RB-03 using the Airfields integration we need a font, this is the default 3D font async loader
    // TODO: move this part
    const fontLoader = new THREE.FontLoader();
    fontLoader.load("/synthview/helvetiker_regular.typeface.json", (font) => {
        window.font = font;
    });
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

        switch (event.key) {
            case "MediaTrackNext":
                $scope.synthViewSelectUp();
                break;
            case KEYPAD_MAPPING_PREV:
                $scope.synthViewSelectLeft();
                break;
            case KEYPAD_MAPPING_TAP:
                $scope.synthViewSelectTap();
                break;
            case "MediaTrackPrevious":
                $scope.synthViewSelectDown();
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
    var ahrs = new AHRSRenderer("ahrs_display", true, "transparent", "transparent", "transparent", "transparent");
    ahrs.turn_on();

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
        const requireRefresh = globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold);
        if (requireRefresh == true) {
            $scope.situation = situation;
            $scope.situation.GPSGroundSpeed = parseInt($scope.situation.GPSGroundSpeed);
            $scope.situation.GPSAltitudeMSL = parseInt($scope.situation.GPSAltitudeMSL);
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
        ahrs.update(situation.AHRSPitch, situation.AHRSRoll, situation.AHRSGyroHeading, situation.AHRSSlipSkid, 0 /*situation.GPSGroundSpeed*/, /*situation.GPSAltitudeMSL*/);
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
        window.setTimeout(function () {
            $scope.AHRSCage();
        }, 5000);
        window.setTimeout(function () {
            $scope.AHRSCalibrate();
        }, 100);

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

        return $scope.remote.reset == false && window.innerHeight > 800;
    }

    //
    class TerrainManager {
        constructor() {
            this.terrainData = [[0]];
            this.latitude = 0.0;
            this.longitude = 0.0;
            this.planimetry = { "start": { "lat": 37, "lon": 4 }, "end": { "lat": 47, "lon": 19 } };
            this.moltipliers = { "lat": (this.planimetry.end.lat - this.planimetry.start.lat) / this.terrainData.length, "lon": (this.planimetry.end.lon - this.planimetry.start.lon) / this.terrainData[0].length }
        }

        isReady() {
            return this.terrainData.length > 1;
        }

        elevationByLatLon(lat, lon) {
            const indexIJ = this.index(lat, lon);
            return this.terrainData[indexIJ[0]][indexIJ[1]];
        }

        trimTerrainByDistance(data, lat, lon, nm) {
            return this.trimTerrainBySquare(data,
                lat - nm / 1.86 / 45,
                lon - nm / 1.86 / 45,
                lat + nm / 1.86 / 45,
                lon + nm / 1.86 / 45
            );
        }

        trimTerrainBySquare(data, startLat, startLon, endLat, endLon) {

            const indexLatLonStart = this.index(startLat, startLon, data);
            const indexLatLonEnd = this.index(endLat, endLon, data);

            var terrainTrimmedData = {
                "terrainData":
                    [],
                "latitude": (endLat + startLat) / 2.0,
                "longitude": (endLon + endLat) / 2.0,
                "planimetry": { "start": { "lat": startLat, "lon": startLon }, "end": { "lat": endLat, "lon": endLon } }
            }
                ;

            for (var i = indexLatLonStart[0]; i < indexLatLonEnd[0]; i++) {
                var terrainLine = [];
                for (var j = indexLatLonStart[1]; j < indexLatLonEnd[1]; j++) {
                    terrainLine.push(data.terrainData[i][j]);
                }
                terrainTrimmedData.terrainData.push(terrainLine);
            }
            return terrainTrimmedData;
        }

        index(lat, lon, data = this) {
            const dlat = lat - data.planimetry.start.lat;
            const dlon = lon - data.planimetry.start.lon;
            var mlat = parseInt(dlat / data.moltipliers.lat);
            var mlon = parseInt(dlon / data.moltipliers.lon);
            if (mlat < 0) mlat = 0;
            if (mlat > data.terrainData.length) mlat = data.terrainData.length - 1;
            if (mlon < 0) mlon = 0;
            if (mlon > data.terrainData[mlat].length) mlon = data.terrainData[mlat].length - 1;
            return [mlat, mlon];
        }


        plan(lat, lon) {
            const dlat = lat - this.planimetry.start.lat;
            const dlon = lon - this.planimetry.start.lon;
            const mlat = dlat / this.moltipliers.lat;
            const mlon = dlon / this.moltipliers.lon;
            const dilat = -mlat + this.terrainData.length / 2;
            const dilon = mlon - this.terrainData[0].length / 2;

            return [dilon, dilat];
        }

        async terrainFetch(lat, lon, url) {
            try {
                const response = await fetch(url); // Fetch the data
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }


                var data = await response.json(); // Parse the JSON
                data.moltipliers = { "lat": (data.planimetry.end.lat - data.planimetry.start.lat) / data.terrainData.length, "lon": (data.planimetry.end.lon - data.planimetry.start.lon) / data.terrainData[0].length }
                data = this.trimTerrainByDistance(data, lat, lon, 100);
                data.moltipliers = { "lat": (data.planimetry.end.lat - data.planimetry.start.lat) / data.terrainData.length, "lon": (data.planimetry.end.lon - data.planimetry.start.lon) / data.terrainData[0].length }
                this.terrainData = data.terrainData;
                this.latitude = data.latitude;
                this.longitude = data.longitude;
                this.planimetry = data.planimetry;
                this.moltipliers = data.moltipliers;
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
            this.terrain = new TerrainManager();
            this.items = [];
            this.itemIndexStartingTraffic = 0;
            this.setup = {};
        }


        itemTemplate() {
            return {
                "ttl": Date.now() + 1000 * 60 * 60 * 12,
                "directionModel": 0,
                "projectionSize": 0,
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

        convertTrafficToItem(traffic) {
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
            // item
            item.projectionSize = this.setup.cellSize * 10.0 * traffic.Speed / 60.0;
            item.direction = traffic.Track;
            item.elevation = traffic.Alt * 0.3048;
            item.x = aXY[0] * this.setup.cellSize;
            item.y = aXY[1] * this.setup.cellSize;

            return item;
        }

        importAirfields(airfields) {
            let itemsToAdd = [];
            airfields.forEach(element => {
                if (
                    element.Lat > this.terrain.planimetry.start.lat &&
                    element.Lat < this.terrain.planimetry.end.lat &&
                    element.Lon > this.terrain.planimetry.start.lon &&
                    element.Lon < this.terrain.planimetry.end.lon

                ) {
                    const aXY = this.terrain.plan(element.Lat, element.Lon);
                    var item = this.itemTemplate();
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
                const itemsToAdd = this.importAirfields(data);
                this.items.push(...itemsToAdd);
            } catch (error) {
                console.error('Error fetching data:', error);
                throw error;
            }


            return this.items;
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
            this.terrainBrown = null;
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

            // Add ambient and directional lighting
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
            this.scene.add(ambientLight);

            const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
            directionalLight.position.set(2000, 2000, 0);
            //directionalLight.castShadow = true;
            this.scene.add(directionalLight);

            // Add controls for navigation
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);

        }


        setBackgroundColor(skyColor) {
            const colorSky = 255 * skyColor.r << 16 | 255 * skyColor.g << 8 | 255 * skyColor.b;
            this.scene.background = new THREE.Color(colorSky); // Sky blue background
        }

        attachToContainer(divName) {
            const container = document.getElementById(divName);
            this.renderer.setSize(container.clientWidth, container.clientHeight);
            this.renderer.domElement.style.width = "100cqw";
            this.renderer.domElement.style.height = "100cqh";
            container.appendChild(this.renderer.domElement);
        }


        generateItems(items, setup) {
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (item.reference != null || item.generating != null) {
                    continue;
                }
                items[i].generating = true;
                this.generateItem(item, setup, (itemReady) => {
                    items[i] = itemReady;
                    if (items[i].reference != null) {
                        this.scene.add(items[i].reference.scene);
                    }

                    // Generate Vertical Tube
                    items[i] = this.generateTubeVertical(itemReady, setup);
                    if (items[i].referenceTubeVertical != null) {
                        this.scene.add(items[i].referenceTubeVertical);
                    }

                    items[i] = this.generateThreshold(itemReady, setup);
                    if (items[i].referenceThreshold != null) {
                        this.scene.add(items[i].referenceThreshold);
                    }
                    if (items[i].referenceLabel != null) {
                        this.scene.add(items[i].referenceLabel);
                    }

                    // TODO: unify the code heading/direction (that shall be "projection")
                    if (items[i].direction == 0) {

                    }
                    else {

                        // Generate H Tube
                        if (itemReady.projectionSize > 0) {
                            items[i] = this.generateTubeProjection(itemReady, setup);
                            if (items[i].referenceTubeFront != null) {
                                this.scene.add(items[i].referenceTubeFront);
                            }
                        }
                    }
                    requestAnimationFrame(animate);
                })
            }
        }



        cameraFollowItem(item, resources, distance = 10) {
            this.camera.position.set(
                item.x - distance * Math.sin((Math.PI * 2.0 / 360) * (item.direction + 0)) * resources.setup.cellSize / FollowMeDistance,
                item.elevation,
                item.y - distance * Math.cos((Math.PI * 2.0 / 360) * (item.direction + 180)) * resources.setup.cellSize / FollowMeDistance
            );
            this.controls.target.set(
                item.x + distance * Math.sin((Math.PI * 2.0 / 360) * (item.direction + 0)) * resources.setup.cellSize / FollowMeDistance,
                item.elevation,
                item.y + distance * Math.cos((Math.PI * 2.0 / 360) * (item.direction + 180)) * resources.setup.cellSize / FollowMeDistance
            );
            this.controls.update();
        }

        generateItem(item, setup = {}, callback = null) {
            if (item.template != "") {
                return this.generateItemGLB(item, setup, callback);
            }
        }

        generateTubeVertical(item, setup) {
            const geometryConeVertical = new THREE.CylinderGeometry(5, 5, item.elevation, 32)
            const materialConeVertical = new THREE.MeshBasicMaterial({ color: 0x1c1c1c });
            const coneConeVertical = new THREE.Mesh(geometryConeVertical, materialConeVertical);
            coneConeVertical.position.y = item.elevation / 2.0
            coneConeVertical.position.x = item.x
            coneConeVertical.position.z = item.y
            item.referenceTubeVertical = coneConeVertical;
            return item;
        }

        generateThreshold(item, setup) {

            var labelDisplacement = item.elevation + 120;

            if (item.hasOwnProperty("heading")) {
                if(item.heading>180) {
                    item.heading = item.heading - 180;
                }
                const container = new THREE.Object3D();
                container.position.y = item.elevation - elevantionPOIfromSurface + 10;
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

        generateTubeProjection(item, setup) {

            const geometry2 = new THREE.CylinderGeometry(5, 5, item.projectionSize, 32)
            const material2 = new THREE.MeshBasicMaterial({ color: 0x1c1c1c });
            const cone = new THREE.Mesh(geometry2, material2);
            cone.position.x = item.x + item.projectionSize / 2 * Math.cos((Math.PI * 2.0 / 360) * (item.direction + 180 + 90))
            cone.position.y = item.elevation
            cone.position.z = item.y + item.projectionSize / 2 * Math.sin((Math.PI * 2.0 / 360) * (item.direction + 180 + 90))

            cone.rotation.z = (Math.PI * 2.0 / 360) * (180 + item.direction)
            cone.rotation.x = (Math.PI * 2.0 / 360) * (90)

            item.referenceTubeFront = cone;
            return item;
        }

        generateItemGLB(item, setup = {}, callback = null) {
            const loader = new THREE.GLTFLoader();
            loader.load(
                setup.glbPath + item.template + '.glb',
                (gltf) => {
                    //console.log('Model loaded successfully:', gltf);

                    gltf.scene.scale.x = item.scale;
                    gltf.scene.scale.y = item.scale;
                    gltf.scene.scale.z = item.scale;

                    gltf.scene.position.x = item.x
                    gltf.scene.position.y = item.elevation
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


        generateMaterial(terrainElevation, cellSize, elevationMapping, baseColor) {

            const ncols = terrainElevation[0].length
            const nrows = terrainElevation.length
            const grid = terrainElevation;
            const size = ncols * nrows * 3;
            const colors = [];

            var lastColor = [0, 0, 0]
            for (let i = 0, j = 0; i < size; i += 3, j++) {
                lastColor = [0, 1, 0];
                var elevation = grid[nrows - 1 - Math.floor(j / ncols)][j % ncols]; // Elevation as Z value
                if (elevation <= 0) {
                    lastColor = [0, 0, 1];
                } else {
                    if (elevation <= 50) {


                    } else {
                        for (var c = 0; c < elevationMapping.length; c++) {
                            if (elevation > elevationMapping[c].maxElevation) {
                                lastColor = elevationMapping[c].color;
                                break;
                            }
                        }
                    }
                }

                colors.push(...lastColor)

            }
            const materialDynamic = new THREE.MeshPhongMaterial({
                color: baseColor, // Base color
                shininess: 50, // Adjust shininess for specular highlights
                vertexColors: true, // Enable vertex colors
                side: THREE.DoubleSide, // Make the material visible on both sides
                wireframe: false
            });
            return [materialDynamic, colors];
        }

        loadDEM(terrainElevation, setup) {
            const ncols = terrainElevation[0].length
            const nrows = terrainElevation.length
            const grid = terrainElevation;

            // Set vertex heights based on DEM data
            const geometryBrown = new THREE.PlaneGeometry(
                ncols * setup.cellSize,
                nrows * setup.cellSize,
                ncols - 1,
                nrows - 1
            );
            const verticesBrown = geometryBrown.attributes.position.array;
            for (let i = 0, j = 0; i < verticesBrown.length; i += 3, j++) {
                var elevation = grid[nrows - 1 - Math.floor(j / ncols)][j % ncols]; // Elevation as Z value
                verticesBrown[i + 2] = elevation
            }
            geometryBrown.computeVertexNormals();

            const materialBrownColors = this.generateMaterial(terrainElevation, setup.cellSize, [
                {
                    "maxElevation": setup.elevation - 0,
                    "color": [1, 0, 0]
                },
                {
                    "maxElevation": setup.elevation - 200,
                    "color": [1, 1, 0]
                },
                {
                    "maxElevation": setup.elevation - 500,
                    "color": [0, 1, 0]
                },
            ], setup.terrainBaseColor);
            // Add the color attribute to the geometry
            geometryBrown.setAttribute('color', new THREE.Float32BufferAttribute(materialBrownColors[1], 3));



            this.terrainBrown = new THREE.Mesh(geometryBrown, materialBrownColors[0]);
            this.terrainBrown.rotation.x = -Math.PI / 2; // Rotate to lay flat
            this.scene.add(this.terrainBrown);
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
    async function engageContext() {
        const setup = await resources.startup();
        rendering.setBackgroundColor(setup.skyColor);
        rendering.attachToContainer("synthviewFrame");
        return setup;
    }


    var lockedInTerrainGeneration = false;


    $scope.cleanupOldTraffic = function (s) {

        if (($scope === undefined) || ($scope === null) || $state.current.controller != 'SynthViewCtrl') {
            window.clearInterval($scope.cleanupOldTrafficTimer);
            return; // we are getting called once after clicking away from the status page
        }

        const now = Date.now() - 1000 * 10;
        for (var i = resources.itemIndexStartingTraffic; i < resources.items.length; i++) {
            var currentItem = resources.items[i];
            if (currentItem.ttl < now) {
                rendering.scene.remove(currentItem.referenceTubeFront);
                rendering.scene.remove(currentItem.referenceTubeVertical);
                if(currentItem.referenceLabel != null)rendering.scene.remove(currentItem.referenceLabel);
                rendering.scene.remove(currentItem.reference.scene);

                resources.items.splice(i, 1);
                delete currentItem;
                break;
            }
            else {
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
            if (currentItem.name == "" + element.Icao_addr) {
                founded = i;
                break;
            }
        }

        if (founded < 0) {
            var newItem = resources.convertTrafficToItem(element);
            if (newItem == null) {
                return;
            }
            resources.items.push(newItem);
            rendering.generateItems(resources.items, resources.setup);
        }
        else {
            resources.items[founded].ttl = Date.now();

            const aXY = resources.terrain.plan(element.Lat, element.Lng);
            resources.items[founded].direction = element.Track;
            resources.items[founded].elevation = element.Alt * 0.3048;
            resources.items[founded].x = aXY[0] * resources.setup.cellSize;
            resources.items[founded].y = aXY[1] * resources.setup.cellSize;
            const item = resources.items[founded];
            const gltf = item.reference;

            if (gltf != null && gltf.hasOwnProperty("scene")) {
                gltf.scene.position.x = item.x
                gltf.scene.position.y = item.elevation
                gltf.scene.position.z = item.y
                gltf.scene.rotation.x = (Math.PI * 2.0 / 360) * item.pitch // Pitch
                gltf.scene.rotation.y = (Math.PI * 2.0 / 360) * (180 - item.direction + item.directionModel) // Yaw
                gltf.scene.rotation.z = (Math.PI * 2.0 / 360) * item.roll // Roll
                //
                if (item.referenceTubeVertical != null) {
                    item.referenceTubeVertical.position.y = item.elevation / 2.0
                    item.referenceTubeVertical.position.x = item.x
                    item.referenceTubeVertical.position.z = item.y
                }
                if (item.referenceTubeFront != null) {
                    item.referenceTubeFront.position.x = item.x + item.projectionSize / 2 * Math.cos((Math.PI * 2.0 / 360) * (item.direction + 180 + 90))
                    item.referenceTubeFront.position.y = item.elevation
                    item.referenceTubeFront.position.z = item.y + item.projectionSize / 2 * Math.sin((Math.PI * 2.0 / 360) * (item.direction + 180 + 90))
                    item.referenceTubeFront.rotation.z = (Math.PI * 2.0 / 360) * (180 + item.direction)
                    item.referenceTubeFront.rotation.x = (Math.PI * 2.0 / 360) * (90)
                }
                if (item.referenceLabel != null) {
                    item.referenceLabel.position.y = item.elevation + 120;
                    item.referenceLabel.position.x = item.x
                    item.referenceLabel.position.z = item.y
                }
            }
        }
    }

    function loadSituationInSynthView(situation) {
        if (situation.GPSLatitude == 0 || situation.GPSLongitude == 0) {
            console.log("GPS Not ready");
            return;
        }
        //"GPSLatitude": 43.0, "GPSLongitude": 12.0
        if (resources.terrain.isReady()) {
            requestAnimationFrame(animate);
        }
        else {
            if (lockedInTerrainGeneration == true) return;
            lockedInTerrainGeneration = true;
            console.log("Terrain Not Ready");
            engageContext().then((setup) => {
                setup.elevation = situation.GPSAltitudeMSL * 0.3048


                resources.terrain.terrainFetch(situation.GPSLatitude, situation.GPSLongitude, setup.elevationUrl).then((terrainElevations) => {
                    // Automatic zoom based on the Terrain detail
                    // Example of empiric calculion is:
                    // DEM for 100 NM => 240 cols/rows considering 100 meter DB
                    // Heuristic formula: 10*feet
                    setup.cellSize = parseInt((240.0 / terrainElevations.terrainData.length) * 328.084);
                    rendering.loadDEM(terrainElevations.terrainData, setup);

                    setup.items = remote.updateItemsBySituation(setup.items, situation, resources);

                    rendering.cameraFollowItem(setup.items[0], resources);
                    remote.reset = false;
                    remote.set(resources.items[0].pitch, resources.items[0].roll, resources.items[0].x, resources.items[0].y, resources.items[0].elevation, resources.items[0].direction);


                    resources.fetchAndImportAirFields().then(() => {
                        rendering.generateItems(setup.items, setup);
                        resources.itemIndexStartingTraffic = setup.items.length + 1;
                        // Event chain
                        addEventListener("TrafficUpdated", trafficUpdateEventListener);
                        //
                        $scope.cleanupOldTrafficTimer = window.setInterval($scope.cleanupOldTraffic, 10000, $scope);
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
        const item = resources.items[0];
        if (item.reference != null) {

            remote.updateItemsBySituation(resources.items, $scope.situation, resources);

            item.reference.scene.rotation.x = (Math.PI * 2.0 / 360) * item.pitch;
            item.reference.scene.rotation.y = (Math.PI * 2.0 / 360) * (180 - item.direction + item.directionModel);
            item.reference.scene.rotation.z = (Math.PI * 2.0 / 360) * item.roll;

            item.reference.scene.position.x = item.x;
            item.reference.scene.position.z = item.y;
            item.reference.scene.position.y = item.elevation;
            if (item.referenceTubeVertical != null) {
                item.referenceTubeVertical.position.y = item.elevation / 2.0
                item.referenceTubeVertical.position.x = item.x
                item.referenceTubeVertical.position.z = item.y
            }
            if (item.referenceTubeFront != null) {
                item.referenceTubeFront.position.x = item.x + item.projectionSize / 2 * Math.cos((Math.PI * 2.0 / 360) * (item.direction + 180 + 90))
                item.referenceTubeFront.position.y = item.elevation
                item.referenceTubeFront.position.z = item.y + item.projectionSize / 2 * Math.sin((Math.PI * 2.0 / 360) * (item.direction + 180 + 90))
                item.referenceTubeFront.rotation.z = (Math.PI * 2.0 / 360) * (180 + item.direction)
                item.referenceTubeFront.rotation.x = (Math.PI * 2.0 / 360) * (90)
            }


            if (remote.reset == false) {
                rendering.cameraFollowItem(item, resources);
                remote.reset = false
                remote.set(item.pitch, item.roll, item.x, item.y, item.elevation, item.direction);

            }


        }


        if (resources.setup.elevation > 150 + $scope.situation.GPSAltitudeMSL * 0.3048 || resources.setup.elevation < -150 + $scope.situation.GPSAltitudeMSL * 0.3048) {
            resources.setup.elevation = $scope.situation.GPSAltitudeMSL * 0.3048
            const material = rendering.generateMaterial(resources.terrain.terrainData, resources.setup.cellSize, [
                {
                    "maxElevation": resources.setup.elevation - 0,
                    "color": [1, 0, 0]
                },
                {
                    "maxElevation": resources.setup.elevation - 200,
                    "color": [1, 1, 0]
                },
                {
                    "maxElevation": resources.setup.elevation - 500,
                    "color": [0, 1, 0]
                },
            ], resources.setup.terrainBaseColor);

            if (rendering.terrainBrown != null) {
                rendering.terrainBrown.geometry.setAttribute('color', new THREE.Float32BufferAttribute(material[1], 3));

            }

        }

        rendering.renderer.render(rendering.scene, rendering.camera);
    }

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
