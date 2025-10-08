angular.module('appControllers').controller('EMSCtrl', EMSCtrl);

function EMSCtrl($rootScope, $scope, $state, $http, $interval) {

    const name = "ems";

    $state.get(name).onEnter = function () {
        console.log("onEnter"+name);
    };

    $state.get(name).onExit = function () {
		console.log("onExit"+name);
                    removeEventListener("EMSUpdated",emsUpdated);
    };


    function emsUpdated(emsData){

                if (($scope === undefined) || ($scope === null) || $state.current.controller != 'EMSCtrl') {
            removeEventListener("EMSUpdated",emsUpdated);
            return; // we are getting called once after clicking away from the status page
        }

		const OILTEMP = 0;
		const OILPRES = 1;
		const RPM = 2;
		const MAP = 3;

		var degreeOut = 0;


		var keyIn = "rpm";
		var indexOut = RPM;
		//
		degreeOut = (((emsData.detail[keyIn]- $scope.EMS[indexOut].minSpeed) / ($scope.EMS[indexOut].maxSpeed - $scope.EMS[indexOut].minSpeed)) * ($scope.EMS[indexOut].endSpeedDegree - $scope.EMS[indexOut].startSpeedDegree) + $scope.EMS[indexOut].startSpeedDegree);
		$scope.EMS[indexOut].speed = parseInt(emsData.detail[keyIn]);
		$scope.EMS[indexOut].speedDegree = (degreeOut+90) + "deg";


		//
		keyIn = "oiltemperature";
		indexOut = OILTEMP;
		degreeOut = (((emsData.detail[keyIn]- $scope.EMS[indexOut].minSpeed) / ($scope.EMS[indexOut].maxSpeed - $scope.EMS[indexOut].minSpeed)) * ($scope.EMS[indexOut].endSpeedDegree - $scope.EMS[indexOut].startSpeedDegree) + $scope.EMS[indexOut].startSpeedDegree);
		$scope.EMS[indexOut].speed = parseInt(emsData.detail[keyIn]);
		$scope.EMS[indexOut].speedDegree = (degreeOut+90) + "deg";

		keyIn = "oilpressure";
		indexOut = OILPRES;
		degreeOut = (((emsData.detail[keyIn]- $scope.EMS[indexOut].minSpeed) / ($scope.EMS[indexOut].maxSpeed - $scope.EMS[indexOut].minSpeed)) * ($scope.EMS[indexOut].endSpeedDegree - $scope.EMS[indexOut].startSpeedDegree) + $scope.EMS[indexOut].startSpeedDegree);
		$scope.EMS[indexOut].speed = parseInt(emsData.detail[keyIn]);
		$scope.EMS[indexOut].speedDegree = (degreeOut+90) + "deg";

        $scope.$apply();

	};

    
	addEventListener("EMSUpdated",emsUpdated);

};
