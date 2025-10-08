angular.module('appControllers').controller('ResourcesCtrl', ResourcesCtrl);

function ResourcesCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "resources";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
    };


    /*

    $scope.click = function (item) {
        console.log(item);
        $scope.$parent.uiSidebarBottom = false;

        if (item.hasOwnProperty("url") && item.url.length > 0) {
            document.location = item.url;
        }
    }
    $scope.items = [
        { "value": "130KMH", "color": "#00ff00", "url": "#/speed" },
        { "value": "1.4G", "color": "#5c5c5c", "url": "#/" },
        { "value": "13°C", "color": "#5c5c5c", "url": "#/" },
        { "value": "AP", "color": "#00ff00", "url": "#/autopilot" },
        { "value": "3D", "color": "#1c1c1c", "url": "#/synthview" },
        { "value": "QNH 1017", "color": "#5c5c5c", "url": "#/altimeter" }
    ];

    console.log("Controller "+name);
        $scope.resources = [];
        $http.get("resources.json").then(function (response) {
            var status = angular.fromJson(response.data);
            if (status.length > 0) {
                $scope.resources = status;
                requestAnimationFrame(applyChanges)
            }
        });
    
        function applyChanges(){
            $scope.$apply();
        }
    
        $scope.backFromZoom = function(event){
            zoomContainer.style.display="none";
            console.log("back "+ ZoneFinder(event));
            event.stopPropagation()
        }
    
        $scope.zoom = function(resource,event){
            console.log(resource);
    
            var zoomContainer = document.getElementById("zoomContainer");
            const imagePath = 'url(resources/'+encodeURI(resource.filename)+')';
            zoomContainer.style.backgroundImage = imagePath;
            zoomContainer.style.display="block";
            zoomContainer.style.width = window.innerWidth+"px";
            zoomContainer.style.height = window.innerHeight+"px";
    
    
            console.log("zoom "+ ZoneFinder(event));
            event.stopPropagation()
    
        }
            */
};
