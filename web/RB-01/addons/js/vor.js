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
 *
 * ILS localizer (RB-VOR-IF v2.3, rb-vor with loc.enabled): a localizer is picked by
 * posting its frequency to the same vorfreq. rb-vor then publishes, in the same POST,
 * every vor* field 0 and
 *   locstatus      same codes as vorstatus, >= 4 usable
 *   locdev         deviation in % of full scale (DDM 0.155 = 100), + = 150 Hz
 *                  predominates = aircraft right of the front course = FLY LEFT;
 *                  0 unless locstatus >= 4
 *   locddm, locsdm, locsnr, locfreqactive
 * The plate is in LOC mode while locfreqactive is non-zero. The deviation bar is
 * drawn ONLY while locstatus >= 4: noise decodes as a centred needle, so a bar on
 * anything less would look like an approach on no signal. Supplemental equipment,
 * not approach guidance; the plate says so wherever LOC appears.
 *
 * HSICircleRenderer.update(outer, item, center, vertical, ...) as the HSI plate
 * (plates/js/hsi.js) uses it: `center` is track - course, so the course pointer is
 * drawn at (course - track) clockwise; `vertical` moves the bar by -vertical*12.5 in
 * the pointer's frame, with dots 25 apart, so `vertical` is in half-dots, clamped at
 * +/-6 = the third dot, and POSITIVE MOVES THE BAR LEFT of the pointer: the HSI plate
 * feeds dist*tan(track - bearing), positive when the course is to the left. A
 * positive locdev (course to the left, fly left) is therefore vertical = +locdev *
 * 6 / 100: full scale reaches the last dot.
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
        searchEnabled: false,
        // RB-VOR-IF v2.3 localizer fields; absent (0) from a receiver without loc.enabled
        locstatus: 0,
        locdev: 0,
        locddm: 0,
        locsdm: 0,
        locsnr: 0,
        locfreqactive: 0,
        locname: "",
        loccourse: null,
        locKnown: false
    };

    // Generated from web/settings/db.vor.json (open community data, not for navigation:
    // check the current AIP Italia). VOR, VOR-DME, VORTAC, TACAN, ILS and LOC only; NDB
    // and DME-only stations cannot be received here. Latina ILS 12 is left out: its
    // 110.20 is not a localizer channel. null = not in the database.
    $scope.vorList = [
        {"name": "Albenga", "icao": null, "id": "ALB", "type": "VOR-DME", "freq": 116.95, "lat": 44.04817, "lon": 8.12761, "elevation_ft": 118, "runway": null, "magvar": 4, "range_nm": 40},
        {"name": "Albenga LOC 27", "icao": "LIMG", "id": "LBN", "type": "LOC", "freq": 108.9, "lat": 44.0489, "lon": 8.11972, "elevation_ft": 149, "runway": "27", "magvar": 3.2, "range_nm": 18, "course": 260.3},
        {"name": "Alghero", "icao": null, "id": "AHO", "type": "TACAN", "freq": 109.3, "lat": 40.636111, "lon": 8.289444, "elevation_ft": 121, "runway": null, "magvar": 3.0, "range_nm": 40},
        {"name": "Alghero", "icao": null, "id": "AEA", "type": "VOR-DME", "freq": 111.65, "lat": 40.638056, "lon": 8.291667, "elevation_ft": 102, "runway": null, "magvar": 2.8, "range_nm": 40},
        {"name": "Alghero", "icao": null, "id": "ALG", "type": "VORTAC", "freq": 113.8, "lat": 40.62805, "lon": 8.243889, "elevation_ft": 1453, "runway": null, "magvar": 2.8, "range_nm": 150},
        {"name": "Alghero ILS 20", "icao": "LIEA", "id": "IALF", "type": "ILS", "freq": 110.15, "lat": 40.6185, "lon": 8.28257, "elevation_ft": 72, "runway": "20", "magvar": 3.1, "range_nm": 18, "course": 201.3},
        {"name": "Amendola", "icao": "LIBA", "id": "MNL", "type": "TACAN", "freq": 115.25, "lat": 41.537899, "lon": 15.71, "elevation_ft": 185, "runway": null, "magvar": 2.2, "range_nm": null},
        {"name": "Ancona", "icao": null, "id": "ANC", "type": "VOR-DME", "freq": 110.65, "lat": 43.58638, "lon": 13.47111, "elevation_ft": 896, "runway": null, "magvar": 3.9, "range_nm": 100},
        {"name": "Ancona ILS 22", "icao": "LIPY", "id": "IFA", "type": "ILS", "freq": 111.9, "lat": 43.6258, "lon": 13.3753, "elevation_ft": 48, "runway": "22", "magvar": 4.3, "range_nm": 18, "course": 220.5},
        {"name": "Aosta", "icao": null, "id": "SCS", "type": "VOR-DME", "freq": 109.25, "lat": 45.745556, "lon": 7.338611, "elevation_ft": 2365, "runway": null, "magvar": 2.7, "range_nm": null},
        {"name": "Aosta ILS 27", "icao": "LIMW", "id": "IAOS", "type": "ILS", "freq": 109.75, "lat": 45.738, "lon": 7.35915, "elevation_ft": 1797, "runway": "27", "magvar": 3.1, "range_nm": 18, "course": 261.6},
        {"name": "Aviano", "icao": null, "id": "AVI", "type": "TACAN", "freq": 116.4, "lat": 46.027778, "lon": 12.586944, "elevation_ft": 400, "runway": null, "magvar": 4.2, "range_nm": null},
        {"name": "Aviano LOC 05", "icao": "LIPA", "id": "IAVI", "type": "LOC", "freq": 109.5, "lat": 46.0417, "lon": 12.6133, "elevation_ft": 410, "runway": "05", "magvar": 4.3, "range_nm": 18, "course": 43.8},
        {"name": "Bari", "icao": "LIBD", "id": "BAR", "type": "VOR-DME", "freq": 116.4, "lat": 41.144299, "lon": 16.7764, "elevation_ft": 108, "runway": null, "magvar": 2.3, "range_nm": null},
        {"name": "Bari ILS 07", "icao": "LIBD", "id": "BAP", "type": "ILS", "freq": 111.35, "lat": 41.1329, "lon": 16.7406, "elevation_ft": 175, "runway": "07", "magvar": 4.6, "range_nm": 18, "course": 64.7},
        {"name": "Bergamo", "icao": null, "id": "BEG", "type": "VOR-DME", "freq": 114.95, "lat": 45.669444, "lon": 9.709167, "elevation_ft": 810, "runway": null, "magvar": 3.3, "range_nm": 25},
        {"name": "Bergamo ILS 28", "icao": "LIME", "id": "BRM", "type": "ILS", "freq": 108.7, "lat": 45.6717, "lon": 9.68694, "elevation_ft": 779, "runway": "28", "magvar": 3.6, "range_nm": 18, "course": 281.5},
        {"name": "Biella Cerrione", "icao": "LILE", "id": "BLA", "type": "VOR-DME", "freq": 116.1, "lat": 45.494202, "lon": 8.10058, "elevation_ft": 921, "runway": null, "magvar": 0.5, "range_nm": null},
        {"name": "Bologna", "icao": null, "id": "BOA", "type": "VOR-DME", "freq": 117.1, "lat": 44.53702, "lon": 11.29066, "elevation_ft": 141, "runway": null, "magvar": 3.6, "range_nm": 50},
        {"name": "Bologna ILS 12", "icao": "LIPE", "id": "BLN", "type": "ILS", "freq": 108.9, "lat": 44.5292, "lon": 11.3059, "elevation_ft": 123, "runway": "12", "magvar": 3.9, "range_nm": 18, "course": 112.9},
        {"name": "Bologna ILS 30", "icao": "LIPE", "id": "IBBP", "type": "ILS", "freq": 109.75, "lat": 44.5421, "lon": 11.2702, "elevation_ft": 123, "runway": "30", "magvar": 3.9, "range_nm": 18, "course": 292.8},
        {"name": "Bolsena", "icao": null, "id": "BOL", "type": "VORTAC", "freq": 114.4, "lat": 42.618301, "lon": 12.0486, "elevation_ft": 2082, "runway": null, "magvar": 1.4, "range_nm": null},
        {"name": "Bolzano", "icao": null, "id": "OZE", "type": "VOR-DME", "freq": 117.05, "lat": 46.405278, "lon": 11.292222, "elevation_ft": 2136, "runway": null, "magvar": 3.6, "range_nm": 40},
        {"name": "Bolzano LOC 01", "icao": "LIPB", "id": "IBZ", "type": "LOC", "freq": 109.1, "lat": 46.4533, "lon": 11.3246, "elevation_ft": 789, "runway": "01", "magvar": 4.0, "range_nm": 18, "course": 6.2},
        {"name": "Brescia", "icao": null, "id": "BSM", "type": "VOR-DME", "freq": 115.65, "lat": 45.438056, "lon": 10.316111, "elevation_ft": 374, "runway": null, "magvar": 3.8, "range_nm": 40},
        {"name": "Brescia ILS 32", "icao": "LIPO", "id": "IBS", "type": "ILS", "freq": 110.55, "lat": 45.4191, "lon": 10.3448, "elevation_ft": 357, "runway": "32", "magvar": 3.8, "range_nm": 18, "course": 311.3},
        {"name": "Brindisi", "icao": null, "id": "BRD", "type": "VORTAC", "freq": 113.2, "lat": 40.61086, "lon": 18.00286, "elevation_ft": 85, "runway": null, "magvar": 4.4, "range_nm": null},
        {"name": "Brindisi ILS 31", "icao": "LIBR", "id": "IBN", "type": "ILS", "freq": 109.5, "lat": 40.6555, "lon": 17.9504, "elevation_ft": 46, "runway": "31", "magvar": 4.8, "range_nm": 18, "course": 312.4},
        {"name": "Brindisi", "icao": null, "id": "BCS", "type": "VOR-DME", "freq": 113.55, "lat": 40.658611, "lon": 17.951944, "elevation_ft": 49, "runway": null, "magvar": 4.4, "range_nm": 40},
        {"name": "Cagliari", "icao": null, "id": "CAG", "type": "VOR-DME", "freq": 113.4, "lat": 39.249, "lon": 9.054083, "elevation_ft": 43, "runway": null, "magvar": 2.9, "range_nm": 25},
        {"name": "Cagliari / Elmas ILS 32", "icao": "LIEE", "id": "IEL", "type": "ILS", "freq": 109.5, "lat": 39.2421, "lon": 9.06518, "elevation_ft": 13, "runway": "32", "magvar": 3.2, "range_nm": 18, "course": 314.9},
        {"name": "Cameri", "icao": null, "id": "CAM", "type": "TACAN", "freq": 115.0, "lat": 45.570278, "lon": 8.6575, "elevation_ft": 702, "runway": null, "magvar": 3.3, "range_nm": 40},
        {"name": "Campagnano", "icao": null, "id": "CMP", "type": "VOR-DME", "freq": 111.4, "lat": 42.123889, "lon": 12.381389, "elevation_ft": 1434, "runway": null, "magvar": 3.6, "range_nm": 25},
        {"name": "Caraffa Di Catanzaro", "icao": null, "id": "CDC", "type": "VORTAC", "freq": 117.3, "lat": 38.755833, "lon": 16.369167, "elevation_ft": 3274, "runway": null, "magvar": 4.0, "range_nm": 200},
        {"name": "Carbonara", "icao": null, "id": "CAR", "type": "VOR-DME", "freq": 115.1, "lat": 39.111389, "lon": 9.508056, "elevation_ft": 171, "runway": null, "magvar": 3.0, "range_nm": 80},
        {"name": "Caselle", "icao": null, "id": "CAS", "type": "TACAN", "freq": 109.5, "lat": 45.193889, "lon": 7.652778, "elevation_ft": 981, "runway": null, "magvar": 3.1, "range_nm": null},
        {"name": "Caselle", "icao": null, "id": "CSL", "type": "VOR-DME", "freq": 116.75, "lat": 45.219722, "lon": 7.649444, "elevation_ft": 1027, "runway": null, "magvar": 2.8, "range_nm": 25},
        {"name": "Catania", "icao": "LICZ", "id": "CAT", "type": "VOR-DME", "freq": 112.1, "lat": 37.4562, "lon": 14.9693, "elevation_ft": 217, "runway": null, "magvar": 2.0, "range_nm": null},
        {"name": "Catania", "icao": null, "id": "CTF", "type": "VOR-DME", "freq": 116.25, "lat": 37.46444, "lon": 15.06228, "elevation_ft": 46, "runway": null, "magvar": 4, "range_nm": null},
        {"name": "Catania ILS 08", "icao": "LICC", "id": "CTN", "type": "ILS", "freq": 109.9, "lat": 37.4656, "lon": 15.0527, "elevation_ft": 39, "runway": "08", "magvar": 4.1, "range_nm": 18, "course": 79.9},
        {"name": "Cervia", "icao": null, "id": "CEV", "type": "TACAN", "freq": 113.6, "lat": 44.206389, "lon": 12.357222, "elevation_ft": 56, "runway": null, "magvar": 4.0, "range_nm": 40},
        {"name": "Cervia ILS 11", "icao": "LIPC", "id": "CER", "type": "ILS", "freq": 110.35, "lat": 44.2174, "lon": 12.3266, "elevation_ft": 12, "runway": "11", "magvar": 4.1, "range_nm": 18, "course": 112.2},
        {"name": "Chioggia", "icao": null, "id": "CHI", "type": "VOR-DME", "freq": 114.1, "lat": 45.071111, "lon": 12.281389, "elevation_ft": 43, "runway": null, "magvar": 3.8, "range_nm": 50},
        {"name": "Comiso", "icao": null, "id": "COM", "type": "VOR-DME", "freq": 113.45, "lat": 36.985, "lon": 14.594722, "elevation_ft": 666, "runway": null, "magvar": 3.6, "range_nm": 25},
        {"name": "Crotone", "icao": null, "id": "CRN", "type": "VOR-DME", "freq": 117.1, "lat": 38.99611, "lon": 17.08306, "elevation_ft": 495, "runway": null, "magvar": 5, "range_nm": 150},
        {"name": "Cuneo / Levaldigi ILS 21", "icao": "LIMZ", "id": "LEV", "type": "ILS", "freq": 110.95, "lat": 44.5368, "lon": 7.61367, "elevation_ft": 1267, "runway": "21", "magvar": 3.1, "range_nm": 18, "course": 209.4},
        {"name": "Decimomannu", "icao": null, "id": "DEC", "type": "TACAN", "freq": 108.2, "lat": 39.381111, "lon": 8.965556, "elevation_ft": 194, "runway": null, "magvar": 3.1, "range_nm": null},
        {"name": "Elba", "icao": null, "id": "ELB", "type": "VORTAC", "freq": 114.7, "lat": 42.730556, "lon": 10.395833, "elevation_ft": 1388, "runway": null, "magvar": 3.3, "range_nm": 200},
        {"name": "Falconara", "icao": null, "id": "FAL", "type": "TACAN", "freq": 109.8, "lat": 43.576944, "lon": 13.299444, "elevation_ft": 220, "runway": null, "magvar": 4.1, "range_nm": null},
        {"name": "Firenze", "icao": null, "id": "FRZ", "type": "VORTAC", "freq": 115.2, "lat": 44.027199, "lon": 11.0033, "elevation_ft": 4438, "runway": null, "magvar": 1.3, "range_nm": null},
        {"name": "Firenze / Peretola ILS 05", "icao": "LIRQ", "id": "IFZ", "type": "ILS", "freq": 110.3, "lat": 43.8156, "lon": 11.2137, "elevation_ft": 131, "runway": "05", "magvar": 3.9, "range_nm": 18, "course": 44.2},
        {"name": "Foggia", "icao": "LIBF", "id": "FOG", "type": "VOR", "freq": 114.2, "lat": 41.429501, "lon": 15.5314, "elevation_ft": 266, "runway": null, "magvar": 2.2, "range_nm": null},
        {"name": "Foggia", "icao": null, "id": "FGG", "type": "VOR-DME", "freq": 115.8, "lat": 41.429444, "lon": 15.531389, "elevation_ft": 285, "runway": null, "magvar": 4.1, "range_nm": 25},
        {"name": "Forli", "icao": null, "id": "FOL", "type": "VOR-DME", "freq": 115.75, "lat": 44.193611, "lon": 12.067778, "elevation_ft": 112, "runway": null, "magvar": 3.7, "range_nm": 40},
        {"name": "Forli ILS 12", "icao": "LIPK", "id": "FOR", "type": "ILS", "freq": 109.7, "lat": 44.2001, "lon": 12.0563, "elevation_ft": 97, "runway": "12", "magvar": 4.0, "range_nm": 18, "course": 112.9},
        {"name": "Frosinone", "icao": null, "id": "FRS", "type": "VOR-DME", "freq": 115.6, "lat": 41.6425, "lon": 13.292222, "elevation_ft": 620, "runway": null, "magvar": 3.8, "range_nm": 15},
        {"name": "Genova", "icao": null, "id": "GEN", "type": "VOR-DME", "freq": 112.8, "lat": 44.424444, "lon": 9.082222, "elevation_ft": 2930, "runway": null, "magvar": 3.1, "range_nm": null},
        {"name": "Genova / Sestri ILS 28", "icao": "LIMJ", "id": "GSE", "type": "ILS", "freq": 109.3, "lat": 44.4085, "lon": 8.85956, "elevation_ft": 9, "runway": "28", "magvar": 3.4, "range_nm": 18, "course": 282.0},
        {"name": "Ghedi", "icao": null, "id": "GHE", "type": "TACAN", "freq": 110.9, "lat": 45.440278, "lon": 10.263889, "elevation_ft": 335, "runway": null, "magvar": 3.6, "range_nm": 150},
        {"name": "Gioia Del Colle", "icao": null, "id": "GIO", "type": "TACAN", "freq": 117.8, "lat": 40.801389, "lon": 16.901389, "elevation_ft": 1270, "runway": null, "magvar": 4.5, "range_nm": 150},
        {"name": "Grazzanise", "icao": null, "id": "GRA", "type": "TACAN", "freq": 117.5, "lat": 41.06, "lon": 14.088611, "elevation_ft": 85, "runway": null, "magvar": 4.1, "range_nm": 200},
        {"name": "Grosseto", "icao": null, "id": "GRO", "type": "VORTAC", "freq": 109.85, "lat": 42.760278, "lon": 11.0775, "elevation_ft": 75, "runway": null, "magvar": 3.7, "range_nm": 40},
        {"name": "Grottaglie", "icao": null, "id": "GRT", "type": "TACAN", "freq": 116.8, "lat": 40.489167, "lon": 17.410833, "elevation_ft": 243, "runway": null, "magvar": 4.5, "range_nm": 40},
        {"name": "Istrana", "icao": null, "id": "ISA", "type": "TACAN", "freq": 111.7, "lat": 45.6875, "lon": 12.116944, "elevation_ft": 190, "runway": null, "magvar": 4.0, "range_nm": 220},
        {"name": "Lamezia Terme", "icao": null, "id": "LMT", "type": "VOR-DME", "freq": 112.5, "lat": 38.904444, "lon": 16.265556, "elevation_ft": 79, "runway": null, "magvar": 4.0, "range_nm": 25},
        {"name": "Lamezia Terme ILS 28", "icao": "LICA", "id": "LAM", "type": "ILS", "freq": 110.3, "lat": 38.9038, "lon": 16.2559, "elevation_ft": 39, "runway": "28", "magvar": 4.4, "range_nm": 18, "course": 274.2},
        {"name": "Lampedusa", "icao": null, "id": "LPD", "type": "VOR-DME", "freq": 108.6, "lat": 35.499722, "lon": 12.630833, "elevation_ft": 89, "runway": null, "magvar": 3.2, "range_nm": null},
        {"name": "Lampedusa ILS 26", "icao": "LICD", "id": "ILMA", "type": "ILS", "freq": 111.3, "lat": 35.4993, "lon": 12.6279, "elevation_ft": 65, "runway": "26", "magvar": 3.5, "range_nm": 18, "course": 257.0},
        {"name": "Latina", "icao": null, "id": "LAT", "type": "VOR-DME", "freq": 111.2, "lat": 41.541111, "lon": 12.918056, "elevation_ft": 79, "runway": null, "magvar": 3.7, "range_nm": 60},
        {"name": "Lecce", "icao": null, "id": "LCC", "type": "VORTAC", "freq": 112.8, "lat": 40.247222, "lon": 18.130833, "elevation_ft": 233, "runway": null, "magvar": 4.4, "range_nm": 40},
        {"name": "Lecce/galatina ILS 32", "icao": "LIBN", "id": "GAL", "type": "ILS", "freq": 111.75, "lat": 40.248, "lon": 18.125, "elevation_ft": 162, "runway": "32", "magvar": 4.8, "range_nm": 18, "course": 321.1},
        {"name": "Linate", "icao": "LIML", "id": "LIN", "type": "VOR-DME", "freq": 112.25, "lat": 45.461201, "lon": 9.27532, "elevation_ft": 386, "runway": null, "magvar": 1.1, "range_nm": null},
        {"name": "Malpensa", "icao": "LIMC", "id": "MAL", "type": "VOR-DME", "freq": 111.2, "lat": 45.6427, "lon": 8.73456, "elevation_ft": 768, "runway": null, "magvar": 0.6, "range_nm": null},
        {"name": "Malpensa", "icao": null, "id": "MMP", "type": "VOR-DME", "freq": 113.35, "lat": 45.640833, "lon": 8.734722, "elevation_ft": 764, "runway": null, "magvar": 3.1, "range_nm": 25},
        {"name": "Milano / Linate ILS 36", "icao": "LIML", "id": "ILNT", "type": "ILS", "freq": 109.55, "lat": 45.4343, "lon": 9.27823, "elevation_ft": 353, "runway": "36", "magvar": 3.5, "range_nm": 18, "course": 352.2},
        {"name": "Milano / Malpensa ILS 17L", "icao": "LIMC", "id": "IMSL", "type": "ILS", "freq": 110.75, "lat": 45.6504, "lon": 8.72793, "elevation_ft": 697, "runway": "17L", "magvar": 3.4, "range_nm": 18, "course": 165.6},
        {"name": "Milano / Malpensa ILS 35L", "icao": "LIMC", "id": "IMA", "type": "ILS", "freq": 109.1, "lat": 45.6108, "lon": 8.7283, "elevation_ft": 767, "runway": "35L", "magvar": 3.4, "range_nm": 18, "course": 345.7},
        {"name": "Milano / Malpensa ILS 35R", "icao": "LIMC", "id": "MLP", "type": "ILS", "freq": 109.9, "lat": 45.6158, "lon": 8.7375, "elevation_ft": 780, "runway": "35R", "magvar": 3.4, "range_nm": 18, "course": 345.7},
        {"name": "Montichiari", "icao": "LIPO", "id": "BSA", "type": "VOR-DME", "freq": 117.7, "lat": 45.438, "lon": 10.316, "elevation_ft": 332, "runway": null, "magvar": 1.2, "range_nm": null},
        {"name": "Napoli / Capodichino ILS 24", "icao": "LIRN", "id": "INP", "type": "ILS", "freq": 109.5, "lat": 40.8923, "lon": 14.3041, "elevation_ft": 292, "runway": "24", "magvar": 4.2, "range_nm": 18, "course": 233.9},
        {"name": "Napoli / Capodichino LOC 06", "icao": "LIRN", "id": "NPC", "type": "LOC", "freq": 110.15, "lat": 40.8798, "lon": 14.2776, "elevation_ft": 292, "runway": "06", "magvar": 4.2, "range_nm": 18, "course": 53.9},
        {"name": "Navy Sigonella", "icao": "LICZ", "id": "NSY", "type": "TACAN", "freq": 111.2, "lat": 37.400299, "lon": 14.9215, "elevation_ft": 81, "runway": null, "magvar": 2.0, "range_nm": null},
        {"name": "Olbia / Costa Smeralda ILS 05", "icao": "LIEO", "id": "ISM", "type": "ILS", "freq": 109.9, "lat": 40.8924, "lon": 9.5057, "elevation_ft": 37, "runway": "05", "magvar": 3.4, "range_nm": 18, "course": 51.9},
        {"name": "Olbia / Costa Smeralda ILS 23", "icao": "LIEO", "id": "IOL", "type": "ILS", "freq": 111.3, "lat": 40.9049, "lon": 9.52963, "elevation_ft": 37, "runway": "23", "magvar": 3.4, "range_nm": 18, "course": 231.9},
        {"name": "Ortanova", "icao": null, "id": "ORT", "type": "TACAN", "freq": 114.3, "lat": 41.3997, "lon": 15.7842, "elevation_ft": 86, "runway": null, "magvar": 2.2, "range_nm": null},
        {"name": "Ostia", "icao": null, "id": "OST", "type": "VOR-DME", "freq": 114.9, "lat": 41.803889, "lon": 12.2375, "elevation_ft": 36, "runway": null, "magvar": 3.6, "range_nm": 80},
        {"name": "Padova ILS 04", "icao": "LIPU", "id": "PDV", "type": "ILS", "freq": 111.3, "lat": 45.3992, "lon": 11.8528, "elevation_ft": 44, "runway": "04", "magvar": 4.1, "range_nm": 18, "course": 39.7},
        {"name": "Palermo", "icao": null, "id": "PAL", "type": "VOR-DME", "freq": 112.3, "lat": 38.033611, "lon": 13.1775, "elevation_ft": 3885, "runway": null, "magvar": 3.5, "range_nm": 40},
        {"name": "Palermo / Punta Raisi ILS 20", "icao": "LICJ", "id": "ITO", "type": "ILS", "freq": 110.55, "lat": 38.1833, "lon": 13.0953, "elevation_ft": 64, "runway": "20", "magvar": 3.8, "range_nm": 18, "course": 200.1},
        {"name": "Palermo / Punta Raisi ILS 25", "icao": "LICJ", "id": "RAI", "type": "ILS", "freq": 109.5, "lat": 38.1861, "lon": 13.1215, "elevation_ft": 64, "runway": "25", "magvar": 3.8, "range_nm": 18, "course": 243.0},
        {"name": "Pantelleria", "icao": "LICG", "id": "PAN", "type": "VOR-DME", "freq": 116.1, "lat": 36.814201, "lon": 11.9652, "elevation_ft": 604, "runway": null, "magvar": 1.3, "range_nm": null},
        {"name": "Pantelleria LOC 26", "icao": "LICG", "id": "IPTL", "type": "LOC", "freq": 110.9, "lat": 36.8138, "lon": 11.9551, "elevation_ft": 635, "runway": "26", "magvar": 3.5, "range_nm": 18, "course": 252.8},
        {"name": "Parma ILS 20", "icao": "LIMP", "id": "IPR", "type": "ILS", "freq": 110.5, "lat": 44.8156, "lon": 10.2922, "elevation_ft": 163, "runway": "20", "magvar": 3.7, "range_nm": 18, "course": 193.7},
        {"name": "Perdasdefogu", "icao": null, "id": "PED", "type": "TACAN", "freq": 109.0, "lat": 39.669167, "lon": 9.443333, "elevation_ft": 2064, "runway": null, "magvar": 3.2, "range_nm": null},
        {"name": "Peretola", "icao": null, "id": "PRT", "type": "VOR-DME", "freq": 112.5, "lat": 43.809722, "lon": 11.200556, "elevation_ft": 121, "runway": null, "magvar": 3.5, "range_nm": 25},
        {"name": "Perugia", "icao": null, "id": "PRU", "type": "VOR-DME", "freq": 109.4, "lat": 43.101667, "lon": 12.511944, "elevation_ft": 709, "runway": null, "magvar": 3.7, "range_nm": 50},
        {"name": "Perugia ILS 01", "icao": "LIRZ", "id": "IPE", "type": "ILS", "freq": 110.95, "lat": 43.0885, "lon": 12.5106, "elevation_ft": 695, "runway": "01", "magvar": 4.1, "range_nm": 18, "course": 10.2},
        {"name": "Pescara", "icao": null, "id": "PES", "type": "VOR-DME", "freq": 115.9, "lat": 42.435833, "lon": 14.184167, "elevation_ft": 33, "runway": null, "magvar": 4.0, "range_nm": 25},
        {"name": "Pescara ILS 22", "icao": "LIBP", "id": "IPS", "type": "ILS", "freq": 110.7, "lat": 42.4215, "lon": 14.1729, "elevation_ft": 48, "runway": "22", "magvar": 4.3, "range_nm": 18, "course": 213.1},
        {"name": "Piacenza", "icao": "LIMS", "id": "PIA", "type": "TACAN", "freq": 117.4, "lat": 44.917198, "lon": 9.72056, "elevation_ft": 484, "runway": null, "magvar": 1.1, "range_nm": null},
        {"name": "Pisa", "icao": null, "id": "PIN", "type": "TACAN", "freq": 108.3, "lat": 43.720278, "lon": 10.432222, "elevation_ft": 75, "runway": null, "magvar": 3.6, "range_nm": 40},
        {"name": "Pisa", "icao": null, "id": "PIS", "type": "VOR-DME", "freq": 112.1, "lat": 43.676667, "lon": 10.391667, "elevation_ft": 33, "runway": null, "magvar": 3.3, "range_nm": null},
        {"name": "Pisa ILS 04R", "icao": "LIRP", "id": "IPI", "type": "ILS", "freq": 109.7, "lat": 43.6973, "lon": 10.4083, "elevation_ft": 7, "runway": "04R", "magvar": 3.7, "range_nm": 18, "course": 33.1},
        {"name": "Pomigliano", "icao": "LIRN", "id": "POM", "type": "VOR-DME", "freq": 117.85, "lat": 40.9282, "lon": 14.3836, "elevation_ft": 109, "runway": null, "magvar": 2.1, "range_nm": null},
        {"name": "Pontecagnano", "icao": null, "id": "PTC", "type": "VOR-DME", "freq": 110.45, "lat": 40.62, "lon": 14.908333, "elevation_ft": 135, "runway": null, "magvar": 3.9, "range_nm": 40},
        {"name": "Ponza", "icao": null, "id": "PNZ", "type": "VORTAC", "freq": 114.6, "lat": 40.911944, "lon": 12.9575, "elevation_ft": 636, "runway": null, "magvar": 3.6, "range_nm": 40},
        {"name": "Pratica Di Mare", "icao": null, "id": "TPR", "type": "TACAN", "freq": 108.7, "lat": 41.621667, "lon": 12.493889, "elevation_ft": 135, "runway": null, "magvar": 3.8, "range_nm": 40},
        {"name": "Pratica Di Mare ILS 31", "icao": "LIRE", "id": "PRA", "type": "ILS", "freq": 109.55, "lat": 41.663436, "lon": 12.429081, "elevation_ft": 39, "runway": "31", "magvar": 3.8, "range_nm": 18, "course": 306.2},
        {"name": "Punta Raisi", "icao": null, "id": "PRS", "type": "VOR-DME", "freq": 113.0, "lat": 38.171944, "lon": 13.079722, "elevation_ft": 39, "runway": null, "magvar": 3.5, "range_nm": 25},
        {"name": "Reggio Calabria", "icao": null, "id": "RCA", "type": "VOR-DME", "freq": 111.0, "lat": 38.07639, "lon": 15.64528, "elevation_ft": 85, "runway": null, "magvar": 4, "range_nm": null},
        {"name": "Reggio Calabria LOC 33", "icao": "LICR", "id": "REG", "type": "LOC", "freq": 109.3, "lat": 38.0457, "lon": 15.6645, "elevation_ft": 95, "runway": "33", "magvar": 4.2, "range_nm": 18, "course": 15.0},
        {"name": "Rimini", "icao": null, "id": "RIM", "type": "VOR-DME", "freq": 116.2, "lat": 44.015167, "lon": 12.616667, "elevation_ft": 36, "runway": null, "magvar": 4, "range_nm": null},
        {"name": "Rimini ILS 31", "icao": "LIPR", "id": "MIR", "type": "ILS", "freq": 109.3, "lat": 44.0309, "lon": 12.5927, "elevation_ft": 41, "runway": "31", "magvar": 4.1, "range_nm": 18, "course": 303.6},
        {"name": "Rivolto", "icao": "LIPI", "id": "RIV", "type": "TACAN", "freq": 110.0, "lat": 45.995701, "lon": 13.0884, "elevation_ft": 267, "runway": null, "magvar": 1.6, "range_nm": null},
        {"name": "Roma", "icao": null, "id": "RMC", "type": "VOR-DME", "freq": 110.8, "lat": 41.804722, "lon": 12.588056, "elevation_ft": 348, "runway": null, "magvar": 4, "range_nm": null},
        {"name": "Roma", "icao": "LIRA", "id": "ROM", "type": "VOR-DME", "freq": 110.8, "lat": 41.8046, "lon": 12.5881, "elevation_ft": 426, "runway": null, "magvar": 1.5, "range_nm": null},
        {"name": "Roma / Ciampino ILS 15", "icao": "LIRA", "id": "CIA", "type": "ILS", "freq": 109.9, "lat": 41.808, "lon": 12.5889, "elevation_ft": 425, "runway": "15", "magvar": 4.0, "range_nm": 18, "course": 148.8},
        {"name": "Roma / Fiumicino ILS 16L", "icao": "LIRF", "id": "IFLL", "type": "ILS", "freq": 108.1, "lat": 41.846, "lon": 12.2615, "elevation_ft": 13, "runway": "16L", "magvar": 3.9, "range_nm": 18, "course": 158.8},
        {"name": "Roma / Fiumicino ILS 16R", "icao": "LIRF", "id": "IFRR", "type": "ILS", "freq": 109.75, "lat": 41.8155, "lon": 12.2264, "elevation_ft": 13, "runway": "16R", "magvar": 3.9, "range_nm": 18, "course": 158.7},
        {"name": "Roma / Fiumicino ILS 25", "icao": "LIRF", "id": "FEE", "type": "ILS", "freq": 110.15, "lat": 41.8097, "lon": 12.2696, "elevation_ft": 13, "runway": "25", "magvar": 3.9, "range_nm": 18, "course": 245.8},
        {"name": "Roma / Fiumicino ILS 34L", "icao": "LIRF", "id": "IFSW", "type": "ILS", "freq": 108.9, "lat": 41.782, "lon": 12.2404, "elevation_ft": 13, "runway": "34L", "magvar": 3.9, "range_nm": 18, "course": 338.7},
        {"name": "Roma / Fiumicino ILS 34R", "icao": "LIRF", "id": "FSS", "type": "ILS", "freq": 111.55, "lat": 41.8125, "lon": 12.2755, "elevation_ft": 13, "runway": "34R", "magvar": 3.9, "range_nm": 18, "course": 338.8},
        {"name": "Ronchi Dei Legionari", "icao": null, "id": "RCH", "type": "VOR-DME", "freq": 114.2, "lat": 45.829722, "lon": 13.480278, "elevation_ft": 69, "runway": null, "magvar": 4.1, "range_nm": 40},
        {"name": "Saronno", "icao": null, "id": "SRN", "type": "VOR-DME", "freq": 113.7, "lat": 45.646111, "lon": 9.021667, "elevation_ft": 787, "runway": null, "magvar": 3.1, "range_nm": null},
        {"name": "Sarzana", "icao": "LIQW", "id": "SAZ", "type": "TACAN", "freq": 111.1, "lat": 44.0756, "lon": 9.93889, "elevation_ft": 1147, "runway": null, "magvar": 1.2, "range_nm": null},
        {"name": "Sestri", "icao": null, "id": "SES", "type": "VOR-DME", "freq": 108.6, "lat": 44.417222, "lon": 8.823611, "elevation_ft": 33, "runway": null, "magvar": 3.0, "range_nm": 40},
        {"name": "Siena", "icao": "LIQS", "id": "SIE", "type": "VOR-DME", "freq": 110.2, "lat": 43.2528, "lon": 11.2531, "elevation_ft": 638, "runway": null, "magvar": 1.3, "range_nm": null},
        {"name": "Sigonella", "icao": null, "id": "SIG", "type": "TACAN", "freq": 111.6, "lat": 37.395833, "lon": 14.971111, "elevation_ft": 121, "runway": null, "magvar": 3.9, "range_nm": 40},
        {"name": "Smeralda", "icao": null, "id": "SME", "type": "VOR-DME", "freq": 113.9, "lat": 40.89, "lon": 9.501389, "elevation_ft": 59, "runway": null, "magvar": 3.0, "range_nm": 25},
        {"name": "Sorrento", "icao": null, "id": "SOR", "type": "VOR-DME", "freq": 112.2, "lat": 40.5825, "lon": 14.335, "elevation_ft": 1647, "runway": null, "magvar": 3.9, "range_nm": 60},
        {"name": "Taranto", "icao": null, "id": "TAG", "type": "VOR-DME", "freq": 110.2, "lat": 40.509722, "lon": 17.408056, "elevation_ft": 230, "runway": null, "magvar": 4.3, "range_nm": 25},
        {"name": "Taranto ILS 35", "icao": "LIBG", "id": "ITGT", "type": "ILS", "freq": 108.35, "lat": 40.5325, "lon": 17.3993, "elevation_ft": 215, "runway": "35", "magvar": 4.7, "range_nm": 18, "course": 344.0},
        {"name": "Tarquinia", "icao": null, "id": "TAQ", "type": "VOR-DME", "freq": 111.8, "lat": 42.215, "lon": 11.7325, "elevation_ft": 75, "runway": null, "magvar": 3.5, "range_nm": 40},
        {"name": "Teano", "icao": null, "id": "TEA", "type": "VOR-DME", "freq": 112.9, "lat": 41.296667, "lon": 13.970556, "elevation_ft": 3301, "runway": null, "magvar": 3.8, "range_nm": null},
        {"name": "Tessera", "icao": null, "id": "TES", "type": "VOR-DME", "freq": 115.3, "lat": 45.519167, "lon": 12.368333, "elevation_ft": 30, "runway": null, "magvar": 3.8, "range_nm": 40},
        {"name": "Torino", "icao": "LIMF", "id": "TOP", "type": "VOR-DME", "freq": 114.5, "lat": 44.9254, "lon": 7.86166, "elevation_ft": 866, "runway": null, "magvar": 0.5, "range_nm": null},
        {"name": "Torino ILS 36", "icao": "LIMF", "id": "ITOC", "type": "ILS", "freq": 108.7, "lat": 45.219417, "lon": 7.650814, "elevation_ft": 989, "runway": "36", "magvar": 3.2, "range_nm": 18, "course": 359.4},
        {"name": "Trapani", "icao": null, "id": "TRP", "type": "VORTAC", "freq": 108.8, "lat": 37.896111, "lon": 12.513333, "elevation_ft": 141, "runway": null, "magvar": 3.4, "range_nm": 50},
        {"name": "Trapani ILS 31L", "icao": "LICT", "id": "TRA", "type": "ILS", "freq": 110.95, "lat": 37.9045, "lon": 12.4992, "elevation_ft": 24, "runway": "31L", "magvar": 3.7, "range_nm": 18, "course": 304.1},
        {"name": "Trento", "icao": null, "id": "TNT", "type": "VOR-DME", "freq": 115.35, "lat": 46.020278, "lon": 11.14, "elevation_ft": 971, "runway": null, "magvar": 3.6, "range_nm": 25},
        {"name": "Treviso ILS 07", "icao": "LIPH", "id": "TRE", "type": "ILS", "freq": 109.3, "lat": 45.6531, "lon": 12.2114, "elevation_ft": 51, "runway": "07", "magvar": 4.2, "range_nm": 18, "course": 65.0},
        {"name": "Trezzo", "icao": null, "id": "TZO", "type": "VOR-DME", "freq": 117.25, "lat": 45.559167, "lon": 9.506944, "elevation_ft": 525, "runway": null, "magvar": 3.2, "range_nm": null},
        {"name": "Trieste ILS 09", "icao": "LIPQ", "id": "RNC", "type": "ILS", "freq": 110.75, "lat": 45.8277, "lon": 13.4911, "elevation_ft": 43, "runway": "09", "magvar": 4.4, "range_nm": 18, "course": 86.0},
        {"name": "Venezia ILS 04R", "icao": "LIPZ", "id": "VTS", "type": "ILS", "freq": 109.95, "lat": 45.4941, "lon": 12.3377, "elevation_ft": 4, "runway": "04R", "magvar": 4.2, "range_nm": 18, "course": 37.9},
        {"name": "Verona Villafranca ILS 04", "icao": "LIPX", "id": "IVF", "type": "ILS", "freq": 110.1, "lat": 45.3873, "lon": 10.8763, "elevation_ft": 237, "runway": "04", "magvar": 3.9, "range_nm": 18, "course": 41.7},
        {"name": "Vicenza", "icao": null, "id": "VIC", "type": "VOR-DME", "freq": 113.4, "lat": 45.637222, "lon": 11.676389, "elevation_ft": 157, "runway": null, "magvar": 3.7, "range_nm": 50},
        {"name": "Vieste", "icao": null, "id": "VIE", "type": "VOR-DME", "freq": 112.6, "lat": 41.912778, "lon": 16.049167, "elevation_ft": 951, "runway": null, "magvar": 4.2, "range_nm": 80},
        {"name": "Villafranca", "icao": null, "id": "VIL", "type": "VORTAC", "freq": 115.8, "lat": 45.407778, "lon": 10.906111, "elevation_ft": 269, "runway": null, "magvar": 3.5, "range_nm": 60},
        {"name": "Voghera", "icao": null, "id": "VOG", "type": "VOR-DME", "freq": 110.45, "lat": 44.964722, "lon": 8.970278, "elevation_ft": 374, "runway": null, "magvar": 3.1, "range_nm": null}
    ]

    // ILS and LOC entries also carry "course": the localizer's front course, degrees
    // magnetic (the database's course_true - magvar).
    $scope.isLocalizer = function(entry) {
        return !!entry && (entry.type == "ILS" || entry.type == "LOC");
    };

    $scope.hasLocalizers = function() {
        return $scope.vorList.some($scope.isLocalizer);
    };

    $scope.stationByFreq = function(freq) {
        if (freq > 100000) {
            freq = freq / 1000;
        }
        for (var i = 0; i < $scope.vorList.length; i++) {
            if ($scope.vorList[i].freq == freq) {
                return $scope.vorList[i];
            }
        }
        return null;
    };

    // A localizer channel by the channel plan: 108.10-111.95 MHz, odd 100 kHz digit
    $scope.isLocChannel = function(mhz) {
        var khz = Math.round(mhz * 1000);
        return khz >= 108100 && khz <= 111950 && khz % 50 == 0 && Math.floor(khz / 100) % 2 == 1;
    };

    $scope.locMode = function() {
        return $scope.items.locfreqactive > 0 && !($scope.items.vorfreqactive > 0);
    };

    // The only condition under which the deviation bar is drawn
    $scope.locUsable = function() {
        return $scope.locMode() && $scope.items.locstatus >= 4;
    };

    // A localizer was asked for and the receiver does not decode localizers
    $scope.locUnavailable = function() {
        return !$scope.locMode() && !$scope.items.locKnown && !($scope.items.vorfreqactive > 0)
            && $scope.isLocChannel($scope.items.vorfreq);
    };

    function num(v) {
        var x = parseFloat(v);
        return isFinite(x) ? x : 0;
    }

    // One drawing path. VOR mode calls the renderer exactly as this plate always has;
    // LOC mode follows the renderer's contract as the HSI plate uses it.
    $scope.renderHSI = function() {
        if ($scope.vorHSI == null) {
            $scope.vorHSI = new HSICircleRenderer("vorHSI", {}, $scope.foregroundColor);
        }
        if ($scope.locMode()) {
            var course = $scope.items.loccourse;
            $scope.vorHSI.update(
                $scope.items.GPSTrueCourse,
                {},
                course === null ? 0 : $scope.items.GPSTrueCourse - course,
                $scope.locUsable() ? $scope.items.locdev * 6 / 100 : 0,
                $scope.items.overrideHSI,
                $scope.items.slope
            );
        } else {
            $scope.vorHSI.update(
                $scope.items.GPSTrueCourse,
                {},
                $scope.items.vorradial + $scope.items.vorto * 180,
                $scope.items.vertical,
                $scope.items.overrideHSI,
                $scope.items.slope
            );
        }
        // Parked = not drawn. The VOR mode never computes a deviation (vertical is a
        // constant 0), so a bar there would only ever be a centred needle.
        if ($scope.locUsable()) {
            $scope.vorHSI.verticalLineDirection.show();
        } else {
            $scope.vorHSI.verticalLineDirection.hide();
        }
    };

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


        $scope.renderHSI();
    }

    // Last GPS position with a fix; null until the first one
    $scope.lastPosition = null;

    // Great-circle distance in NM
    $scope.distanceNm = function(lat1, lon1, lat2, lon2) {
        var r = Math.PI / 180;
        var dLat = (lat2 - lat1) * r;
        var dLon = (lon2 - lon1) * r;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(a)));
    };

    // Nearest first from the last GPS position; the list's own order without one.
    // Stable on ties, and stationByFreq then finds the nearest of a shared frequency.
    $scope.sortByDistance = function() {
        var pos = $scope.lastPosition;
        if (pos == null) {
            return;
        }
        var keyed = $scope.vorList.map(function(entry, i) {
            var d = $scope.distanceNm(pos.lat, pos.lon, parseFloat(entry.lat), parseFloat(entry.lon));
            // an entry without a position goes last
            return { entry: entry, i: i, d: isFinite(d) ? d : Number.MAX_VALUE };
        });
        keyed.sort(function(a, b) { return (a.d - b.d) || (a.i - b.i); });
        for (var i = 0; i < keyed.length; i++) {
            $scope.vorList[i] = keyed[i].entry;
        }
    };

    $scope.enableSearchVor = function() {
        $scope.sortByDistance();
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
        var lat = parseFloat(situation["GPSLatitude"]);
        var lon = parseFloat(situation["GPSLongitude"]);
        if (isFinite(lat) && isFinite(lon) && !(lat == 0 && lon == 0)) {
            $scope.lastPosition = { lat: lat, lon: lon };
        }


        $scope.renderHSI();
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
        // v2.3: present only from a receiver with loc.enabled, then on every frame
        $scope.items.locKnown = ("locstatus" in status);
        $scope.items.locstatus = num(status["locstatus"]);
        $scope.items.locdev = num(status["locdev"]);
        $scope.items.locddm = num(status["locddm"]);
        $scope.items.locsdm = num(status["locsdm"]);
        $scope.items.locsnr = num(status["locsnr"]);
        $scope.items.locfreqactive = num(status["locfreqactive"]);
        var station = $scope.stationByFreq($scope.items.locfreqactive);
        $scope.items.locname = station ? station.name : "";
        $scope.items.loccourse = (station && $scope.isLocalizer(station)
                                  && isFinite(parseFloat(station.course)))
                                 ? parseFloat(station.course) : null;


        // In the same digest as the labels: the bar and the status word beside it change
        // together. Drawn straight from the event, the bar showed LOC tracking while the
        // label still said LOC ACQUIRING until the next digest (found on the real plate,
        // test_vor_radio.py). Applies to the VOR mode too, which only moves its needle
        // draw by one tick and brings its labels up to date sooner.
        $scope.$applyAsync($scope.renderHSI);
    }
    $scope.vorHSI = null;
    addEventListener("BridgeUpdated", bridgeUpdatedEventListener);
    addEventListener("SituationUpdated", situationUpdateEventListener);
};
