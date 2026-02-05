/**
 * This file is part of RB.
 *
 * Copyright (C) 2024 XIAPROJECTS SRL
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
 */
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
var URL_AHRS_CAGE = URL_HOST_PROTOCOL + URL_HOST_BASE + "/cageAHRS";
var URL_AHRS_CAL = URL_HOST_PROTOCOL + URL_HOST_BASE + "/calibrateAHRS";

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


// Last Situation, shared out-of-angular to avoid angular triggers
window.situation = { "GPSLastFixSinceMidnightUTC": 0, "GPSLatitude": 0, "GPSLongitude":0, "GPSFixQuality": 0, "GPSHeightAboveEllipsoid": 0, "GPSGeoidSep": 0, "GPSSatellites": 0, "GPSSatellitesTracked": 0, "GPSSatellitesSeen": 0, "GPSHorizontalAccuracy": 0, "GPSNACp": 0, "GPSAltitudeMSL": 0, "GPSVerticalAccuracy": 0, "GPSVerticalSpeed": 0, "GPSLastFixLocalTime": "", "GPSTrueCourse": 0, "GPSTurnRate": 0, "GPSGroundSpeed": 0, "GPSLastGroundTrackTime": "", "GPSTime": "", "GPSLastGPSTimeStratuxTime": "", "GPSLastValidNMEAMessageTime": "", "GPSLastValidNMEAMessage": "", "GPSPositionSampleRate": 0, "BaroTemperature": 0, "BaroPressureAltitude": 0, "BaroVerticalSpeed": 0, "BaroLastMeasurementTime": "", "BaroSourceType": 0, "AHRSPitch": 0, "AHRSRoll": 0, "AHRSGyroHeading": 0, "AHRSMagHeading": 0, "AHRSSlipSkid": 0, "AHRSTurnRate": 0, "AHRSGLoad": 0, "AHRSGLoadMin": 0, "AHRSGLoadMax": 0, "AHRSLastAttitudeTime": "0", "AHRSStatus": 0 }

function loadJSONSynchronous(url) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);  // `false` makes it synchronous
  xhr.send();
  
  if (xhr.status === 200) {
    return JSON.parse(xhr.responseText);
  } else {
    console.error("Failed to load JSON");
    return null;
  }
}

/*****************************************************
 * XTRK Routines
 */

// Converts from degrees to radians.
function toRadians(degrees) {
  return degrees * Math.PI / 180;
};

// Converts from radians to degrees.
function toDegrees(radians) {
  return radians * 180 / Math.PI;
}

function bearing(startLng, startLat, destLng, destLat) {
  startLat = toRadians(startLat);
  startLng = toRadians(startLng);
  destLat = toRadians(destLat);
  destLng = toRadians(destLng);

  y = Math.sin(destLng - startLng) * Math.cos(destLat);
  x = Math.cos(startLat) * Math.sin(destLat) - Math.sin(startLat) * Math.cos(destLat) * Math.cos(destLng - startLng);
  brng = Math.atan2(y, x);
  brng = toDegrees(brng);
  return (brng + 360) % 360;
}

function distance(lon1, lat1, lon2, lat2) {
  var R = 6371; // Radius of the earth in km
  var dLat = toRadians(lat2 - lat1);  // deg2rad below
  var dLon = toRadians(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
    ;
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in km
  return d;
}


function pilotDisplayedSpeedFromKT(GPSGroundSpeedIsInKt) {
  const kmh = GPSGroundSpeedIsInKt * 1.852;
  const ratio = window.aircraftData?.units?.speedConversionFromKmh?.multiply ?? 1;
  return kmh*ratio;
}

function pilotDisplayedAltitudeFromMeters(GPSAltitudeMSL) {
  const ratio = window.aircraftData?.units?.altimeterConversionFromMeters?.multiply ?? 1;
  return GPSAltitudeMSL*ratio;
}


function pilotDisplayedTemperaturesFromCelsius(TemperatureIsCelsius) {
  const ratio = window.aircraftData?.units?.temperatureConversionFromC?.multiply ?? 1;
  const offset = window.aircraftData?.units?.temperatureConversionFromC?.sum ?? 0;
  return TemperatureIsCelsius * ratio + offset;
}
