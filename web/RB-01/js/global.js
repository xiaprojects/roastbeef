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

// The temperature unit the pilot picked (aircraft.json units), "°C" until the
// profile has loaded.
function pilotTemperatureUnit() {
  return window.aircraftData?.units?.temperatures ?? "°C";
}

// What the temperature conversion currently is, as one comparable value: the
// label alone is not enough, because the settings addon also lets the factor
// and the offset be typed in under an unchanged label.
function pilotTemperatureSignature() {
  const c = window.aircraftData?.units?.temperatureConversionFromC;
  return pilotTemperatureUnit() + "|" + (c?.multiply ?? 1) + "|" + (c?.sum ?? 0);
}

// The EMS probe keys that carry a temperature. The daemon publishes what the
// probe reports (main/ems.go) and ems.json authors its gauge scales to match,
// both in °C, so these are the readings that follow the pilot's temperature
// unit; pressures, volts, litres and rpm are left alone.
const EMS_TEMPERATURE_SOURCES = [
  "oiltemperature", "coolanttemperature", "outsidetemperature",
  "cht1", "cht2", "cht3", "cht4",
  "egt1", "egt2", "egt3", "egt4"
];

function emsSourceIsTemperature(source) {
  return EMS_TEMPERATURE_SOURCES.indexOf(String(source).toLowerCase()) >= 0;
}

// One EMS reading in the pilot's unit: a temperature converted from the °C the
// probe reports, anything else unchanged.
function emsPilotValueFromSource(source, value) {
  if (!emsSourceIsTemperature(source) || !isFinite(value)) {
    return value;
  }
  return pilotDisplayedTemperaturesFromCelsius(value);
}

// Puts the EMS gauge definitions into the pilot's temperature unit - the whole
// dial, not just the number, so the needle, the arc colours and the tick labels
// go on agreeing with it. The conversion is affine, so scaling minSpeed,
// maxSpeed and the arc thresholds leaves every angle exactly where it was: the
// dial is relabelled and the colours still change at the same temperature.
//
// The °C scale is kept aside as the baseline and each pass recomputes from it,
// so this is idempotent and a unit change at runtime lands correctly (the
// settings addon swaps window.aircraftData live, and aircraft.json may arrive
// after ems.json has already been drawn). Only this in-memory copy is touched;
// ems.json on disk stays in °C.
function emsApplyPilotUnits(widgets) {
  if (!Array.isArray(widgets)) {
    return widgets;
  }
  const unit = pilotTemperatureUnit();
  const signature = pilotTemperatureSignature();
  widgets.forEach(function (widget) {
    if (widget === null || typeof widget !== "object" || !emsSourceIsTemperature(widget.source)) {
      return;
    }
    if (widget.celsiusScale === undefined) {
      widget.celsiusScale = {
        minSpeed: widget.minSpeed,
        maxSpeed: widget.maxSpeed,
        thresholds: (widget.arcs ?? []).map(function (arc) { return arc.threshold; })
      };
    } else if (widget.pilotUnitApplied === signature) {
      return; // already drawn in this unit
    }
    const base = widget.celsiusScale;
    widget.minSpeed = pilotDisplayedTemperaturesFromCelsius(base.minSpeed);
    widget.maxSpeed = pilotDisplayedTemperaturesFromCelsius(base.maxSpeed);
    (widget.arcs ?? []).forEach(function (arc, index) {
      if (index < base.thresholds.length) {
        arc.threshold = pilotDisplayedTemperaturesFromCelsius(base.thresholds[index]);
      }
    });
    widget.unit = unit;
    widget.pilotUnitApplied = signature;
    if (typeof createProgressiveTicksForRoundInstrument === "function") {
      widget.speedTicks = createProgressiveTicksForRoundInstrument(widget.maxSpeed, widget.minSpeed,
        widget.endSpeedDegree, widget.startSpeedDegree, 9, widget.ceil, widget.scale);
    }
  });
  return widgets;
}

/*****************************************************
 * Attitude
 */

// The AHRS reports 3276.7 (ahrs.Invalid, 2**15-1 in tenths of a degree) for
// every angle once it has lost its solution. Treating that as a number pegs an
// indicator hard over or trips a warning, so the attitude cues check it first.
const AHRS_INVALID = 3276.7;

function globalAHRSValueIsValid(value) {
  return isFinite(value) && Math.abs(value - AHRS_INVALID) >= 0.01;
}


// Which way the recovery chevrons point for this pitch, "" when it is not
// dangerous: "down" nose high (push), "up" nose low (pull), always towards the
// horizon. Garmin's experimental-aircraft EFIS raises them "when the pitch
// attitude exceeds 50 degrees nose up or 30 degrees nose down" (G3X Pilot's
// Guide), which is also where the RB-01 attitude ball runs out of travel.
// Shared by every plate that draws an attitude, so the limit is one number.
const PITCH_CHEVRON_UP = 50;
const PITCH_CHEVRON_DOWN = -30;
// Pitch noise sits on the order of a degree, so a bare threshold would blink
// the warning on and off while the aircraft hangs at the limit. `shown` is what
// is on screen now, and widens the band that keeps it there.
const PITCH_CHEVRON_HYSTERESIS = 2;

function globalPitchChevrons(pitch, shown) {
  if (!globalAHRSValueIsValid(pitch)) {
    return ""; // no attitude solution: no pitch to warn about
  }
  const up = shown == "down" ? PITCH_CHEVRON_UP - PITCH_CHEVRON_HYSTERESIS : PITCH_CHEVRON_UP;
  const down = shown == "up" ? PITCH_CHEVRON_DOWN + PITCH_CHEVRON_HYSTERESIS : PITCH_CHEVRON_DOWN;
  if (pitch > up) {
    return "down"; // nose high: push, the horizon is below
  }
  if (pitch < down) {
    return "up";   // nose low: pull, the horizon is above
  }
  return "";
}

function localDisplayGetFlag(flagName) {
  if (window.localStorage.getItem(flagName) === undefined || window.localStorage.getItem(flagName) === false || window.localStorage.getItem(flagName) == null) {
  }
  else {
      return window.localStorage.getItem(flagName);
  }
  return false;
}