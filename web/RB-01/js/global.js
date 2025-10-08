// application constants
var URL_HOST_BASE = window.location.hostname + (window.location.port ? ':' + window.location.port : '');
var URL_HOST_PROTOCOL = window.location.protocol + "//";

// Migration from HTTP to HTTPS, all WS shall be upgraded to WSS
var WS_HOST_PROTOCOL = "ws://";
if (URL_HOST_PROTOCOL === 'https://') {
  WS_HOST_PROTOCOL = "wss://";
}


var URL_GPS_WS = WS_HOST_PROTOCOL + URL_HOST_BASE + "/situation";
var URL_SETTINGS_GET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/getSettings";
var URL_SETTINGS_SET = URL_HOST_PROTOCOL + URL_HOST_BASE + "/setSettings";
var URL_AHRS_CAGE           = URL_HOST_PROTOCOL + URL_HOST_BASE + "/cageAHRS";
var URL_AHRS_CAL            = URL_HOST_PROTOCOL + URL_HOST_BASE + "/calibrateAHRS";

let TRAFFIC_MAX_AGE_SECONDS = 59;
let TRAFFIC_AIS_MAX_AGE_SECONDS = 60 * 15;
let TARGET_TYPE_AIS = 5;

// Shared Routines
function textBySeconds(seconds) {
  seconds = seconds.toFixed(0);
  var h = Math.floor(seconds / 60 / 60);
  var m = Math.floor(seconds / 60) % 60;
  var mm = m;
  var s = seconds % 60;
  var ss = s;

  var r = "";
  if (h > 0) {
    r = h + ":";
  }
  if (m < 10) {
    mm = "0" + m;
  }
  r = r + mm + ":";
  if (s < 10) {
    ss = "0" + s;
  }
  r = r + ss;
  return r;
}

function whichKeywordIsForThisDisplay() {
  var ret = "";
  if (window.innerWidth > 0 && window.innerHeight > 0) {
    if (window.innerWidth > window.innerHeight * 1.1) {
      ret = "Landscape";
    } else {
      if (window.innerHeight > window.innerWidth * 1.1) {
        ret = "Portrait";
      } else {
        ret = "Square";
      }
    }
  }
  console.log("This display is: " + ret);
  return ret;
}


//
window.situation = {};
    // { "GPSLastFixSinceMidnightUTC": 32304.2, "GPSLatitude": 43.0, "GPSLongitude": 12.0, "GPSFixQuality": 1, "GPSHeightAboveEllipsoid": 1057.4148, "GPSGeoidSep": 145.34122, "GPSSatellites": 8, "GPSSatellitesTracked": 12, "GPSSatellitesSeen": 10, "GPSHorizontalAccuracy": 5.4, "GPSNACp": 10, "GPSAltitudeMSL": 912.07355, "GPSVerticalAccuracy": 10.700001, "GPSVerticalSpeed": 0, "GPSLastFixLocalTime": "0001-01-01T00:49:25.51Z", "GPSTrueCourse": 48.3, "GPSTurnRate": 0, "GPSGroundSpeed": 0, "GPSLastGroundTrackTime": "0001-01-01T00:49:25.51Z", "GPSTime": "2023-12-31T08:58:24.3Z", "GPSLastGPSTimeStratuxTime": "0001-01-01T00:49:25.51Z", "GPSLastValidNMEAMessageTime": "0001-01-01T00:49:25.51Z", "GPSLastValidNMEAMessage": "$GPGGA,085824.20,4311.12143,N,01208.18939,E,1,08,1.08,278.0,M,44.3,M,,*51", "GPSPositionSampleRate": 9.99973784244331, "BaroTemperature": 29.04, "BaroPressureAltitude": 776.60333, "BaroVerticalSpeed": -1.2355082, "BaroLastMeasurementTime": "0001-01-01T00:49:25.52Z", "BaroSourceType": 1, "AHRSPitch": -56.752181757536206, "AHRSRoll": -77.98562991928083, "AHRSGyroHeading": 3276.7, "AHRSMagHeading": 332.9175199350767, "AHRSSlipSkid": 78.88479760867865, "AHRSTurnRate": 3276.7, "AHRSGLoad": 0.10920454632244811, "AHRSGLoadMin": 0.10626655052683534, "AHRSGLoadMax": 0.1099768285851461, "AHRSLastAttitudeTime": "0001-01-01T00:49:25.51Z", "AHRSStatus": 7 }
