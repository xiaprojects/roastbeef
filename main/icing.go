/*
This file is part of RB.

	Copyright (C) 2026 XIAPROJECTS SRL

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

This source is part of the project RB:
01 -> Display with Synthetic vision, Autopilot and ADSB
02 -> Display with SixPack
03 -> Display with Autopilot, ADSB, Radio, Flight Computer
04 -> Display with EMS: Engine monitoring system
05 -> Display with Stratux BLE Traffic
06 -> Display with Android 6.25" 7" 8" 10" 10.2"
07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box

Community edition will be free for all builders and personal use as defined by the licensing model
Dual licensing for commercial agreement is available
Please join Discord community
*/
package main

// Icing advisories (docs/tech-debt/icing-alerts.md). Once a second the loop reads the
// cabin humidity (mySituation.BaroHumidity: AHT20/21 or BME680, the only humidity it
// uses), the temperature next to it (mySituation.BaroTemperature, the baro on the same breakout) and the outside
// air temperature an EMS sender posts (outsidetemperature), and publishes as EMS
// probes, each only while its inputs are reliable and only when its value changed:
//
//	dew_point         °C, from the cabin air: a ventilated cabin holds about as much
//	                  water as the outside air, so the dew point carries over
//	outside_humidity  %RH at the outside air temperature
//	icing_carb        % induction icing risk on the carburettor icing chart, read as a
//	                  forecast for reduced power: no RPM is used, carburettor and
//	                  injection alike
//	icing_airframe    % chance of airframe icing conditions: near freezing and near
//	                  saturation. It cannot see cloud, so humid clear air reads high too
//
// A probe whose inputs go stale is withdrawn. The rules ICINGCARB and ICINGAIRFRAME in
// rbvoice-aircraft-rules.json colour them and raise the icing alerts, and the air
// quality page (addons/airquality) draws them.

import (
	"log"
	"math"
	"time"
)

const (
	ICING_EVALUATION_INTERVAL = time.Second
	icingBaroFresh            = 5 * time.Second // older baro temperature: no dew point
	icingOATMin, icingOATMax  = -60.0, 60.0     // °C; outside it the probe is broken (an open thermocouple)
	icingCabinMin             = -40.0           // °C, the AHT20/BMP280 range
	icingCabinMax             = 85.0
)

// Airframe icing conditions: OAT band (°C), full in the middle and fading to 0 at the
// edges, times a saturation factor on the OAT - dew point spread (°C).
const (
	icingAirframeWarm     = 3.0   // above: no ice
	icingAirframeFullWarm = 0.0   // [FullCold, FullWarm]: full
	icingAirframeFullCold = -10.0 //
	icingAirframeCold     = -20.0 // below: mostly ice crystals, they do not stick
	icingSpreadFull       = 1.0   // spread at or below: saturated, as in cloud
	icingSpreadNone       = 4.0   // spread at or above: dry
)

// The carburettor icing chart (docs/icing/licterature/image0.webp, as in the UK CAA
// Safety Sense 14 and the BEA study Synthese_etude_givrage_VF_041223.pdf, figure 4),
// zones as (temperature °C, dew point °C) outlines from docs/icing/licterature/map.txt.
// Checked against the image's axes, map.txt's outlines sit 1 °C warm and 1.5 °C dry
// (its saturation edge is 2 °C below T = D); carbChartShift takes that back off. Then
// 90 % of a 0.5 °C grid lands on the image's colour, and the rest is under 1 °C from an
// edge or on a grid line or label. Checked in this order: a point in an earlier zone is
// in that zone, so an outline drawn as a ring or as the whole area reads the same.
var carbChartZones = []struct {
	name    string
	percent float32
	outline [][2]float64
}{
	// Blue: serious icing at any power
	{"serious", 100, [][2]float64{{17.1, 14.3}, {16.7, 14.7}, {0.7, -1.3}, {7.7, 1.1}, {14.5, 5.0}, {17.9, 10.2}}},
	// Green: moderate icing at cruise power, serious at descent power
	{"moderate", 75, [][2]float64{{27.2, 20.3}, {25.0, 22.8}, {16.8, 14.9}, {18.0, 12.2}, {18.0, 10.4}, {16.6, 7.3},
		{14.3, 4.7}, {7.5, 0.8}, {0.7, -1.4}, {2.0, 0.2}, {-3.5, -5.4}, {10.8, -1.0}, {21.2, 5.5}, {27.1, 12.6}, {27.8, 15.5}}},
	// Yellow: serious icing at descent power
	{"descent", 50, [][2]float64{{33.5, 22.5}, {29.0, 27.5}, {-7.4, -8.9}, {0.5, -7.5}, {10.8, -3.8}, {19.0, 0.2},
		{26.3, 5.3}, {30.5, 9.2}, {33.4, 13.6}, {34.3, 17.7}}},
	// Orange: light icing at cruise and descent power
	{"light", 25, [][2]float64{{38.3, 21.0}, {35.7, 26.0}, {31.4, 29.7}, {29.2, 27.5}, {33.3, 23.0}, {34.3, 18.0},
		{33.3, 13.4}, {30.1, 8.7}, {21.1, 1.4}, {5.6, -6.2}, {-7.2, -8.9}, {-13.4, -15.1}, {-7.1, -14.3}, {3.8, -10.4},
		{13.8, -5.8}, {25.5, 1.2}, {31.9, 6.3}, {37.3, 13.1}, {38.6, 16.2}}},
}

var carbChartShift = [2]float64{1.0, -1.5} // map.txt = chart + shift, °C (temperature, dew point)

// icingProbes are the EMS probes the loop owns, in publishing order.
var icingProbes = []string{PROBE_DEW_POINT, PROBE_OUTSIDE_HUM, PROBE_ICING_CARB, PROBE_ICING_AIRFRAME}

type IcingStratuxPlugin struct {
	Name      string
	enabled   bool
	published map[string]float32 // what the EMS holds now from this loop
}

// Shared instance
var icing = IcingStratuxPlugin{}

func (icingInstance *IcingStratuxPlugin) InitFunc() bool {
	log.Println("Entered Icing init() ...")
	icingInstance.Name = "Icing"
	icingInstance.enabled = true
	icingInstance.published = make(map[string]float32)
	go icingInstance.ListenerFunc()
	return true
}

func (icingInstance *IcingStratuxPlugin) ListenerFunc() bool {
	ticker := time.NewTicker(ICING_EVALUATION_INTERVAL)
	defer ticker.Stop()
	for icingInstance.enabled {
		<-ticker.C
		icingInstance.publish(icingCompute(readIcingInput()))
	}
	return true
}

func (icingInstance *IcingStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered Icing shutdown() ...")
	icingInstance.enabled = false
	return true
}

// publish hands the EMS the probes that changed, and withdraws the ones that have no
// reliable value any more.
func (icingInstance *IcingStratuxPlugin) publish(values map[string]float32) {
	changed := make(map[string]float32)
	var gone []string
	for _, key := range icingProbes {
		v, ok := values[key]
		old, had := icingInstance.published[key]
		switch {
		case ok && (!had || old != v):
			changed[key] = v
			icingInstance.published[key] = v
		case !ok && had:
			gone = append(gone, key)
			delete(icingInstance.published, key)
		}
	}
	if len(changed) > 0 {
		ems.publishInternal(changed)
	}
	if len(gone) > 0 {
		ems.withdrawInternal(gone...)
	}
}

// icingInput is what one evaluation reads; each value comes with whether it is reliable.
type icingInput struct {
	humidity, cabinTemp, oat       float64
	humidityOK, cabinTempOK, oatOK bool
}

func readIcingInput() (in icingInput) {
	mySituation.muBaro.Lock()
	hum := float64(mySituation.BaroHumidity)
	temp := float64(mySituation.BaroTemperature)
	last := mySituation.BaroLastMeasurementTime
	mySituation.muBaro.Unlock()

	baroFresh := globalStatus.BMPConnected && !last.IsZero() && stratuxClock.Since(last) < icingBaroFresh
	// The AHT20 blanks the field when it fails; the BME680 path does not, so it must be fresh
	source := (globalStatus.HumidityConnected && !baroMeasuresHumidity()) || (baroMeasuresHumidity() && baroFresh)
	in.humidity, in.humidityOK = hum, source && hum > 0 && hum <= 100
	in.cabinTemp, in.cabinTempOK = temp, baroFresh && temp >= icingCabinMin && temp <= icingCabinMax

	oat, ok := ems.senderValue("outsidetemperature")
	in.oat, in.oatOK = float64(oat), ok && float64(oat) >= icingOATMin && float64(oat) <= icingOATMax
	return in
}

// icingCompute gives the probes that have a reliable value; a missing key is withdrawn.
func icingCompute(in icingInput) map[string]float32 {
	out := make(map[string]float32)
	if !in.humidityOK || !in.cabinTempOK {
		return out
	}
	dew := dewPointC(in.cabinTemp, in.humidity)
	out[PROBE_DEW_POINT] = float32(math.Round(dew))
	if !in.oatOK {
		return out
	}
	// Dew point above the outside air temperature: saturated outside (cloud, or breath in
	// the cabin), read as 100 % rather than off the chart
	dew = math.Min(dew, in.oat)
	out[PROBE_OUTSIDE_HUM] = float32(math.Round(relativeHumidity(in.oat, dew)))
	out[PROBE_ICING_CARB] = carbIcingPercent(in.oat, dew)
	out[PROBE_ICING_AIRFRAME] = airframeIcingPercent(in.oat, dew)
	return out
}

// Magnus formula over water, Alduchov and Eskridge (1996) constants: within 0.4 °C
// from -40 to 50 °C, well inside what a cabin sensor resolves.
const (
	magnusB = 17.625
	magnusC = 243.04 // °C
)

func dewPointC(tC, rh float64) float64 {
	g := math.Log(rh/100) + magnusB*tC/(magnusC+tC)
	return magnusC * g / (magnusB - g)
}

func relativeHumidity(tC, dewC float64) float64 {
	rh := 100 * math.Exp(magnusB*dewC/(magnusC+dewC)-magnusB*tC/(magnusC+tC))
	return math.Max(0, math.Min(100, rh))
}

// carbIcingPercent is the chart zone of (OAT, dew point) as a percentage: 100 serious at
// any power, 75 moderate (serious at descent power), 50 serious at descent power, 25
// light, 0 off the chart.
func carbIcingPercent(oat, dew float64) float32 {
	t, d := oat+carbChartShift[0], dew+carbChartShift[1]
	for _, z := range carbChartZones {
		if pointInPolygon(t, d, z.outline) {
			return z.percent
		}
	}
	return 0
}

// airframeIcingPercent is the temperature factor times the saturation factor, 0..100.
func airframeIcingPercent(oat, dew float64) float32 {
	var tf float64
	switch {
	case oat >= icingAirframeWarm || oat <= icingAirframeCold:
		tf = 0
	case oat > icingAirframeFullWarm:
		tf = (icingAirframeWarm - oat) / (icingAirframeWarm - icingAirframeFullWarm)
	case oat < icingAirframeFullCold:
		tf = (oat - icingAirframeCold) / (icingAirframeFullCold - icingAirframeCold)
	default:
		tf = 1
	}
	spread := oat - dew
	hf := (icingSpreadNone - spread) / (icingSpreadNone - icingSpreadFull)
	hf = math.Max(0, math.Min(1, hf))
	return float32(math.Round(100 * tf * hf))
}

// pointInPolygon: even-odd ray casting.
func pointInPolygon(x, y float64, poly [][2]float64) bool {
	in := false
	for i, j := 0, len(poly)-1; i < len(poly); j, i = i, i+1 {
		xi, yi, xj, yj := poly[i][0], poly[i][1], poly[j][0], poly[j][1]
		if (yi > y) != (yj > y) && x < xi+(y-yi)*(xj-xi)/(yj-yi) {
			in = !in
		}
	}
	return in
}
