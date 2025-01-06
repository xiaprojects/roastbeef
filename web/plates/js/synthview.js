/*
    Copyright (c) 2024 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    synthview.js
*/

angular.module('appControllers').controller('SynthViewCtrl', SynthViewCtrl); // get the main module controllers set
SynthViewCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies


var URL_AIRFIELDS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/resources/db.airfields.json";


// create our controller function with all necessary logic
function SynthViewCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.$parent.helppage = 'plates/autopilot-help.html';
    $scope.data_list = [];
    $scope.isHidden = false;
    $scope.noSleep = new NoSleep();

    $scope.situation = { "GPSLastFixSinceMidnightUTC": 32304.2, "GPSLatitude": 43.0, "GPSLongitude": 12.0, "GPSFixQuality": 1, "GPSHeightAboveEllipsoid": 1057.4148, "GPSGeoidSep": 145.34122, "GPSSatellites": 8, "GPSSatellitesTracked": 12, "GPSSatellitesSeen": 10, "GPSHorizontalAccuracy": 5.4, "GPSNACp": 10, "GPSAltitudeMSL": 912.07355, "GPSVerticalAccuracy": 10.700001, "GPSVerticalSpeed": 0, "GPSLastFixLocalTime": "0001-01-01T00:49:25.51Z", "GPSTrueCourse": 48.3, "GPSTurnRate": 0, "GPSGroundSpeed": 0, "GPSLastGroundTrackTime": "0001-01-01T00:49:25.51Z", "GPSTime": "2023-12-31T08:58:24.3Z", "GPSLastGPSTimeStratuxTime": "0001-01-01T00:49:25.51Z", "GPSLastValidNMEAMessageTime": "0001-01-01T00:49:25.51Z", "GPSLastValidNMEAMessage": "$GPGGA,085824.20,4311.12143,N,01208.18939,E,1,08,1.08,278.0,M,44.3,M,,*51", "GPSPositionSampleRate": 9.99973784244331, "BaroTemperature": 29.04, "BaroPressureAltitude": 776.60333, "BaroVerticalSpeed": -1.2355082, "BaroLastMeasurementTime": "0001-01-01T00:49:25.52Z", "BaroSourceType": 1, "AHRSPitch": -56.752181757536206, "AHRSRoll": -77.98562991928083, "AHRSGyroHeading": 3276.7, "AHRSMagHeading": 332.9175199350767, "AHRSSlipSkid": 78.88479760867865, "AHRSTurnRate": 3276.7, "AHRSGLoad": 0.10920454632244811, "AHRSGLoadMin": 0.10626655052683534, "AHRSGLoadMax": 0.1099768285851461, "AHRSLastAttitudeTime": "0001-01-01T00:49:25.51Z", "AHRSStatus": 7 };
    $scope.scrollItemCounter = -4;

    /*****************************************************
     *  Controller routines
     */
    $state.get('synthview').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('synthview').onExit = function () {
        removeEventListener("keypad", keypadEventListener);
        $scope.noSleep.disable();
        delete $scope.noSleep;

        if (($scope.socket !== undefined) && ($scope.socket !== null)) {
            $scope.socket.close();
            $scope.socket = null;
        }

        if (($scope.socketTraffic !== undefined) && ($scope.socketTraffic !== null)) {
            $scope.socketTraffic.close();
            $scope.socketTraffic = null;
        }
    };


    /*****************************************************
     *  Keypad Management
     */

    function keypadEventListener(event) {
        if (($scope === undefined) || ($scope === null)) {
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
            case KEYPAD_MAPPING_PREV:
            case "ArrowUp":
            case "ArrowLeft":
                $scope.synthViewSelectPrev();
                break;
            case "Enter":
            case " ":
            case KEYPAD_MAPPING_TAP:
                $scope.synthViewSelectTap();
                break;
            case "ArrowDown":
            case "ArrowRight":
            case KEYPAD_MAPPING_NEXT:
                $scope.synthViewSelectNext();
                break;
        }
    }



    $scope.synthViewSelectPrev = function () {
        const proxy = new KeyboardEvent("keypad", { key: "from" });
        dispatchEvent(proxy);
    }
    $scope.synthViewSelectNext = function () {
        const proxy = new KeyboardEvent("keypad", { key: "to" });
        dispatchEvent(proxy);
    }

    $scope.synthViewSelectTap = function () {
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
    function connectTraffic($scope) {
        if($state.current.controller!='SynthViewCtrl')return;

        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.socketTraffic === undefined) || ($scope.socketTraffic === null)) {
            socketTraffic = new WebSocket(URL_TRAFFIC_WS);
            $scope.socketTraffic = socketTraffic; // store socket in scope for enter/exit usage
        }
        socketTraffic.onopen = function (msg) {
        };

        socketTraffic.onclose = function (msg) {
            $scope.$apply();
            delete $scope.socketTraffic;
            setTimeout(function () { connectTraffic($scope); }, 1000);
        };

        socketTraffic.onerror = function (msg) {
            $scope.$apply();
        };

        socketTraffic.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null)) {
                socketTraffic.close();
                return;
            }
            $scope.loadTraffics(angular.fromJson(msg.data));
            $scope.$apply(); // trigger any needed refreshing of data
        };
    }


    function connect($scope) {
        console.log($state.current.controller);

        if (($scope === undefined) || ($scope === null))
            return; // we are getting called once after clicking away from the gps page

        if (($scope.socket === undefined) || ($scope.socket === null)) {
            socket = new WebSocket(URL_GPS_WS);
            $scope.socket = socket; // store socket in scope for enter/exit usage
        }

        socket.onopen = function (msg) {

        };

        socket.onclose = function (msg) {
            $scope.$apply();
            delete $scope.socket;
            setTimeout(function () { connect($scope); }, 1000);
        };

        socket.onerror = function (msg) {
            $scope.$apply();
        };


        socket.onmessage = function (msg) {
            if (($scope === undefined) || ($scope === null)) {
                socket.close();
                return;
            }
            var situation = angular.fromJson(msg.data);
            // Filter to avoid blow up CPU
            const oldSituation = $scope.situation;
            const newSituation = situation;
            const ahrsThreshold = 2;
            const altitudeThreshold = 50 / 3.2808;
            const requireRefresh = globalCompareSituationsIfNeedRefresh(oldSituation, newSituation, ahrsThreshold, altitudeThreshold);
            if (requireRefresh == true) {
                situation.AHRSPitch = 0; // Temporary disable the Pitch
                $scope.situation = situation;
                loadSituationInSynthView(situation);
                loadSituationInAHRS(situation);
                $scope.$apply(); // trigger any needed refreshing of data
            }
        };
    }

    /*****************************************************
    * Init
    */

    addEventListener("keypad", keypadEventListener);

    // GPS Controller tasks
    connect($scope); // connect - opens a socket and listens for messages

    /*****************************************************
    * AHRS and GPS Helper
    */
    function loadSituationInAHRS(situation) { // mySituation
        ahrs.update(situation.AHRSPitch, situation.AHRSRoll, situation.AHRSGyroHeading, situation.AHRSSlipSkid, situation.GPSGroundSpeed, situation.GPSAltitudeMSL);
    }

    $scope.synthviewFrameReset = function () {
        $scope.remote.reset = false;
    }

    $scope.goToHSI = function () {
        document.location = "#/autopilot"
    }

    
    $scope.goToCockpit = function () {
        document.location = "#/cockpit"
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

        async terrainFetch(lat, lon) {
            try {
                const url = "synthview/terrainData.json";
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
            this.setup = {};
        }


        itemTemplate() {
            return {
                "directionModel": 0,
                "projectionSize": 0,
                "reference": null,
                "referenceTubeFront": null,
                "referenceTubeVertical": null,
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

        convertTrafficToItem(traffic) {
            const aXY = this.terrain.plan(traffic.Lat, traffic.Lng);
            var item = this.itemTemplate();
            item.projectionSize = this.setup.cellSize * 10.0 * traffic.Speed / 60.0;
            item.direction = traffic.Track;
            item.elevation = traffic.Alt * 0.3048;
            item.template = "a319_plane";
            item.name = "" + traffic.Icao_addr;
            item.scale = 2;
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
                    item.elevation = element.Ele + 20;
                    item.template = "map_pointer_places_of_interest";
                    item.name = element.gps_code;
                    item.scale = 200;
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
                const url = "synthview/setup.json";
                const response = await fetch(url); // Fetch the data
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
            });
        }

        updateItemsBySituation(items, situation, resources) {
            const aXY = resources.terrain.plan(situation.GPSLatitude, situation.GPSLongitude);
            items[0].x = aXY[0] * resources.setup.cellSize;
            items[0].y = aXY[1] * resources.setup.cellSize;
            items[0].elevation = situation.GPSAltitudeMSL * 0.3048;
            items[0].direction = situation.GPSTrueCourse;
            items[0].roll = situation.AHRSRoll;
            items[0].pitch = -situation.AHRSPitch;

            return items;
        }

        set(pitch, roll, x, y, elevation,direction) {
            if (this.reset == false) {
                if(direction % 360 >= 270 || direction % 360 <= 90){
                    this.rendering.camera.rotation.z = -Math.PI * 2.0 * roll / 360.0
                }
                else
                {
                    this.rendering.camera.rotation.z = -Math.PI * 2.0 * (roll+180) / 360.0
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

                })
            }
        }



        cameraFollowItem(item, resources) {
            this.camera.position.set(
                item.x - 10 * Math.sin((Math.PI * 2.0 / 360) * (item.direction + 0)) * resources.setup.cellSize,
                item.elevation,
                item.y - 10 * Math.cos((Math.PI * 2.0 / 360) * (item.direction + 180)) * resources.setup.cellSize
            );
            this.controls.target.set(
                item.x + 10 * Math.sin((Math.PI * 2.0 / 360) * (item.direction + 0)) * resources.setup.cellSize,
                item.elevation,
                item.y + 10 * Math.cos((Math.PI * 2.0 / 360) * (item.direction + 180)) * resources.setup.cellSize
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
                'synthview/' + item.template + '.glb',
                (gltf) => {
                    console.log('Model loaded successfully:', gltf);

                    gltf.scene.scale.x = item.scale;
                    gltf.scene.scale.y = item.scale;
                    gltf.scene.scale.z = item.scale;

                    gltf.scene.position.x = item.x
                    gltf.scene.position.y = item.elevation
                    gltf.scene.position.z = item.y
                    gltf.scene.rotation.x = (Math.PI * 2.0 / 360) * item.pitch // Pitch
                    gltf.scene.rotation.y = (Math.PI * 2.0 / 360) * (180 - item.direction + item.directionModel) // Yaw
                    gltf.scene.rotation.z = (Math.PI * 2.0 / 360) * item.roll // Roll


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
                    console.log(`Loading model: ${(xhr.loaded / xhr.total) * 100}% loaded`);
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
        }

    }

    const container = document.getElementById("synthviewFrame");

    const canvas = document.getElementById("inop");
    const ctx = canvas.getContext("2d");
    
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(container.clientWidth, container.clientHeight);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "red";
    ctx.stroke();


    const rendering = new Rendering(container);
    const resources = new ResourceManager();
    const remote = new RemoteController(rendering);
    $scope.remote = remote;
    async function engageContext() {
        const setup = await resources.startup();
        rendering.setBackgroundColor(setup.skyColor);
        rendering.attachToContainer("synthviewFrame");

        // Handle resizing
        window.addEventListener('resize', () => {
            rendering.renderer.setSize(container.clientWidth, container.clientHeight);
            rendering.camera.aspect = container.clientWidth, container.clientHeight;
            rendering.camera.updateProjectionMatrix();
        });
        return setup;
    }


    var lockedInTerrainGeneration = false;

    $scope.loadTraffics = function (element) {
        //traffics.forEach(element => {
        if (element.Position_valid == false) return;
        var founded = -1;
        for (var i = 0; i < resources.items.length; i++) {
            var currentItem = resources.items[i];
            if (currentItem.name == "" + element.Icao_addr) {
                founded = i;
            }
        }

        if (founded < 0) {
            var newItem = resources.convertTrafficToItem(element);
            resources.items.push(newItem);

            rendering.generateItems(resources.items, resources.setup);

        }
        else {
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

            }
        }

        //});


    }

    function loadSituationInSynthView(situation) {
        if(situation.GPSLatitude==0 || situation.GPSLongitude==0){
            console.log("GPS Not ready");
            return;
        }
        //"GPSLatitude": 43.0, "GPSLongitude": 12.0
        if (resources.terrain.isReady()) {

        }
        else {
            if (lockedInTerrainGeneration == true) return;
            lockedInTerrainGeneration = true;
            console.log("Terrain Not Ready");
            engageContext().then((setup) => {
                setup.elevation = situation.GPSAltitudeMSL * 0.3048


                resources.terrain.terrainFetch(situation.GPSLatitude, situation.GPSLongitude).then((terrainElevations) => {
                    rendering.loadDEM(terrainElevations.terrainData, setup);

                    setup.items = remote.updateItemsBySituation(setup.items, situation, resources);

                    rendering.cameraFollowItem(setup.items[0], resources);
                    remote.reset = false;
                    remote.set(resources.items[0].pitch, resources.items[0].roll, resources.items[0].x, resources.items[0].y, resources.items[0].elevation, resources.items[0].direction);


                    resources.fetchAndImportAirFields().then(() => {
                        rendering.generateItems(setup.items, setup);
                        connectTraffic($scope);
                    });

                    animate();
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



        requestAnimationFrame(animate);
        //controls.update();
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
