
/*
    Copyright (c) 2023 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    camera.js: Camera interface
*/

angular.module('appControllers').controller('CameraCtrl', CameraCtrl); // get the main module controllers set
CameraCtrl.$inject = ['$rootScope', '$scope', '$state', '$http', '$interval']; // Inject my dependencies

// Same as getSettings, may be in the future this will have a dedicate JSON
var URL_CAMERA_GET = URL_SETTINGS_GET;

// create our controller function with all necessary logic
function CameraCtrl($rootScope, $scope, $state, $http, $interval) {
    $scope.$parent.helppage = 'plates/camera-help.html';
    $scope.cameras = [];

    /**
     * Camera View is based on browser capabilities
     * Are supported out of the box:
     * - HTML5 Video Streaming 
     * <video>
     * - MJPEG Camera (ex.: USB Motion Camera, WiFi MJPEG Camera)
     * <img id="camera01" class="col-xs-12" />
     * - Remote Website (ex.: Public online website, by iFrame)
     * <iframe id="camera01" frameborder="0" style="padding: 4px;width: 640px;height: 480px;" src="http://192.168.10.245/video/livemb.asp"></iframe>
     * - Android or iPhone Browser Device Camera, front or Read, to support this a HTTP(S) is required (Planned for the future)
     * Real working examples:
     * - USB Motion Camera: "http://192.168.10.1:8081/0/stream"
     * - WiFi MJPEG Camera: "http://192.168.10.245/video/livemb.asp";
     * - IMG WebCam: retrieve any http:// poiting to a jpg
     * - GoPro Streaming Camera: Configure your camera to connect to the same WiFi
     * - Website: retrieve any iframe examples on famous websites "Embed widget on page" replace the httpS to http and it will works
     * Using this with a mix of: Aircraft USB Camera, Aircraft WiFi Connected Camera, Airfield public WebCam for meteo conditions, Forecast Widgets...
     * USB Camera, today requires a Motion apt install, which supports all kind of USB Codec, in the future it is possible to write codec in GO. 
     * Roadmap:
     * 1) Enable http S support
     * 2) Enable internal Camera, like iPhone/iPad/Tablet Camera
     * 3) Add GoPro Remote Commands
     * 4) Integrate USB Camera Codecs into Go
     * 5) Add a dictionary/list of Airfields WebCamera Links to facilitate the selection
     */

    /**
     * Example of iPhone/iPad Camera
     * Working only on http S
     */
    /*
    $scope.cameraPlayLocalCamera = function (divName,facingMode) {
        var video = document.getElementById(divName);
        var useDeviceCameraWorksOnlyInHttps = false;
        if (useDeviceCameraWorksOnlyInHttps) {
            // var facingMode = "environment"; // Can be 'user' or 'environment' to access back or front camera (NEAT!)
            var constraints = {
                audio: false,
                video: {
                    facingMode: facingMode
                }
            };

            // Stream it to video element
            navigator.mediaDevices.getUserMedia(constraints).then(function
                success(stream) {
                video.srcObject = stream;
            });
        }
    }
    */

    /**
     * Search and replace the div.src, works always on the same protocol, such as http without S
     * @param {*} index 
     */
    $scope.cameraReloadDiv = function (index) {
        if (document.getElementById("img_" + index) != null) {
            document.getElementById("img_" + index).src = $scope.cameras[index].UrlImg;
        }
        if (document.getElementById("iframe_" + index) != null) {
            document.getElementById("iframe_" + index).src = $scope.cameras[index].UrliFrame;
        }
    }

    /**
     * Due to src={{URL}} is not always loading, switched to div.src
     * Also apply a local template to avoid duplicate loading
     * @param {*} index 
     * @param {*} cameras 
     * @returns 
     */
    $scope.cameraChangeUrl = function (index, cameras) {
        if (($scope === undefined) || ($scope === null)) {
            return; // we are getting called once after clicking away from the status page
        }
        switch (cameras[index].Type) {
            case 0:
                cameras[index].UrlImg = cameras[index].Url;
                cameras[index].UrliFrame = "/img/logo-transparent.png";
                break;
            case 1:
                cameras[index].UrlImg = "/img/logo-transparent.png";
                cameras[index].UrliFrame = cameras[index].Url;
                break;


        }
    }

    /**
     * Apply for ALL Div
     * Due to src={{URL}} is not always loading, switched to div.src
     */
    $scope.cameraReloadAllDiv = function () {
        for (index = 0; index < $scope.cameras.length; index++) {
            $scope.cameraReloadDiv(index);
        }
    }

    /**
     * Restore from saved JSON information
     */
    $scope.cameraRestoreConfiguration = function () {
        $http.get(URL_CAMERA_GET).then(function (response) {
            var status = angular.fromJson(response.data);
            $scope.cameras = [];
            var newCameras = [];
            if (status.hasOwnProperty("Cameras")) {
                newCameras = status["Cameras"];
            }
            // Restore Angular Model
            for (index = 0; index < newCameras.length; index++) {
                newCameras[index]["Edit"] = false;
                newCameras[index]["UrliFrame"] = "/img/logo-transparent.png";
                newCameras[index]["UrlImg"] = "/img/logo-transparent.png";
                $scope.cameraChangeUrl(index, newCameras);
            }
            $scope.cameras = newCameras;
            // Delay loading to wait for DIV Rendering
            window.setTimeout($scope.cameraReloadAllDiv, 100);
        });
    }

    /**
     * Convert UI related JSON to Settings JSON
     * @param {*} angularCamera 
     */
    function modelCameraFromAngular(angularCamera) {
        return {
            "Name": angularCamera.Name,
            "Type": parseInt(angularCamera.Type),
            "Url": angularCamera.Url
        };
    }

    /**
     * REST API
     * @param {*} msg 
     */
    function setSettings(msg) {
        // Simple POST request example (note: response is asynchronous)
        $http.post(URL_SETTINGS_SET, msg).
            then(function (response) {
                // Settings are modified here: no need to reload everything
                // $scope.$apply();
            }, function (response) {
            });
    }

    /**
     * On blur or On Save
     * @param {*} index 
     * @param {*} camera 
     */
    $scope.cameraUpdate = function (index, camera) {
        camera.Type = parseInt(camera.Type);
        $scope.cameras[index] = camera;
        if (camera.Url.length < 1) {
            // If the URL is empty the entry will be removed
            delete $scope.cameras[index];
        }
        else {
            // If Camera still exists apply new conf
            $scope.cameraChangeUrl(index, $scope.cameras);
            $scope.cameraReloadDiv(index);
        }
        // Store Configuration
        var newsettings = {
            "Cameras": []
        };
        $scope.cameras.forEach(element => {
            newsettings.Cameras.push(modelCameraFromAngular(element));
        });
        // console.log(angular.toJson(newsettings));
        setSettings(angular.toJson(newsettings));
    }

    /**
     * Trigger the On Save
     * @param {*} index 
     * @param {*} camera 
     */
    $scope.cameraEdit = function (index, camera) {
        if ($scope.cameras[index].Edit == true) {
            $scope.cameraUpdate(index, camera);
        }
        $scope.cameras[index].Edit = !$scope.cameras[index].Edit;
    }

    /**
     * New Template
     * @param {*} url 
     */
    $scope.cameraCreate = function (url) {
        $scope.cameras.push(
            {
                "Name": "Camera",
                "Type": 0,
                "Url": url,
                "UrlImg": url,
                "UrliFrame": url,
                "Edit": true
            }
        );
    }

    /**
     * Currently Selected Camera by the Keypad
     * -1 exit to prev screen
     * 0->N-1 Camera selected
     * N focus on Add new Camera
     * N+1 exit to next screen
     */
    $scope.scrollItemCounter = 0;


    // Keypad Listener with supported keys
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
            case KEYPAD_MAPPING_PREV_MEDIA:
            case KEYPAD_MAPPING_PREV:
            case "ArrowUp":
            case "ArrowLeft":
                {
                    $scope.scrollItemCounter--;
                    if ($scope.scrollItemCounter < 0) {
                        const proxy = new KeyboardEvent("keypad", { key: "from" });
                        dispatchEvent(proxy);
                        $scope.scrollItemCounter = -1;
                        return;
                    }
                }
                break;
            case "Enter":
            case " ":
            case KEYPAD_MAPPING_TAP:
                if ($scope.scrollItemCounter >= $scope.cameras.length) {
                    $scope.cameraCreate('/img/logo-transparent.png');
                }
                break;
            case "ArrowDown":
            case "ArrowRight":
            case KEYPAD_MAPPING_NEXT_MEDIA:
            case KEYPAD_MAPPING_NEXT:
                {
                    $scope.scrollItemCounter++;
                    if ($scope.scrollItemCounter > $scope.cameras.length + 1) {
                        const proxy = new KeyboardEvent("keypad", { key: "to" });
                        dispatchEvent(proxy);
                        $scope.scrollItemCounter = $scope.cameras.length;
                        return;
                    }
                }
                break;
        }

        if ($scope.scrollItemCounter >= 0 && $scope.scrollItemCounter < $scope.cameras.length) {
            document.getElementById("camera_" + $scope.scrollItemCounter).scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        }
        else if ($scope.scrollItemCounter >= $scope.cameras.length) {

            document.getElementById("camera_add").scrollIntoView({ behavior: "smooth", block: "end", inline: "end" });
        } else 
        {

        }
        $scope.$apply();
    }



    $state.get('camera').onEnter = function () {
        // everything gets handled correctly by the controller
    };

    $state.get('camera').onExit = function () {
        removeEventListener("keypad", keypadEventListener);
        // Remove all SRC to avoid continue loading in background
        for (index = 0; index < $scope.cameras.length; index++) {
            $scope.cameras[index].UrlImg = "";
            $scope.cameras[index].UrliFrame = "";
            $scope.cameraReloadDiv(index);
        }
    };


    // Startup
    $scope.cameraRestoreConfiguration();
    // Bridge from servicekeypad
    addEventListener("keypad", keypadEventListener);
}


CameraCtrl.prototype = {
    constructor: CameraCtrl,
};


