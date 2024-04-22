/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	export-gpx.go: Store Track in GPX

	Roadmap:
	- Add KML export
	- Solve all the TODO

	Example of usage:
*/

package main

import (
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"time"
)

const (
	GPX_EXTENSION        = "gpx"
	GPX_CREATOR          = "RoastBeaf"
	GPX_NAME             = "name"
	GPX_FOLER_TRK        = "trk"
	GPX_ITEM_TRK_ROUTE   = "trkseg"
	GPX_ITEM_TRK_POINT   = "trkpt"
	GPX_FOLER_ROUTE      = "rte"
	GPX_ITEM_ROUTE_ROUTE = ""
	GPX_ITEM_ROUTE_POINT = "rtept"
)

type ExportGPXStratuxPlugin struct {
	SessionName    string
	FilePath    string
}

/*
	The invokation shall not be a singleton

var exportGPX = ExportGPXStratuxPlugin{}

	func (exportGPXInstance *ExportGPXStratuxPlugin) InitFunc() bool {
		log.Println("Entered ExportGPXStratuxPlugin initFunc() ...")

		return true
	}

	func (exportGPXInstance *ExportGPXStratuxPlugin) ShutdownFunc() bool {
		log.Println("Entered ExportGPXStratuxPlugin shutdown() ...")

		return true
	}
*/
func (exportGPXInstance *ExportGPXStratuxPlugin) readAndTrailFile() string {
	content, err := ioutil.ReadFile(exportGPXInstance.FilePath)
	if err != nil {
		log.Println(err)
		return ""
	}

	ret := fmt.Sprintf("%s%s", content, exportGPXInstance.generateTrailer())
	return ret
}

func (exportGPXInstance *ExportGPXStratuxPlugin) appendStringToFile(String string) bool {
	f, err := os.OpenFile(exportGPXInstance.FilePath,
		os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Println(err)
		return false
	}
	defer f.Close()
	if _, err := f.WriteString(String); err != nil {
		log.Println(err)
		return false
	}
	return true
}


func (exportGPXInstance *ExportGPXStratuxPlugin) generateHeaderByData(name string) string {
	a := fmt.Sprintf("<?xml version=\"1.0\" encoding=\"utf-8\" ?>")
	b := fmt.Sprintf("<gpx xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xmlns=\"http://www.topografix.com/GPX/1/1\" version=\"1.1\" creator=\"%s\">", GPX_CREATOR)
	c := fmt.Sprintf("<%s>", GPX_FOLER_ROUTE)
	d := fmt.Sprintf("<%s>%s</%s>", GPX_NAME, name , GPX_NAME)
	ret := fmt.Sprintf("%s\n%s\n%s\n%s\n", a, b, c, d)
	return ret
}

func (exportGPXInstance *ExportGPXStratuxPlugin) generateHeader() string {
	return exportGPXInstance.generateHeaderByData(exportGPXInstance.SessionName)
}

func (exportGPXInstance *ExportGPXStratuxPlugin) generateTrailer() string {
	c := fmt.Sprintf("</%s>", GPX_FOLER_ROUTE)
	ret := fmt.Sprintf("%s\n</gpx>\n", c)
	return ret
}

func (exportGPXInstance *ExportGPXStratuxPlugin) generatePointBySamples(samples ChartDataExport) string {
	buffer := ""
	for index := 0; index < len(samples.Epoch); index++ {
		sample := chartsSamplesByIndexToSample(index,samples)
		buffer = buffer + exportGPXInstance.generatePointBySample(sample)
	}
	return buffer
}

func (exportGPXInstance *ExportGPXStratuxPlugin) generatePointBySample(sample ChartDataCurrent) string {
	// TODO: use only sample without issuing mySituation or other variables which may not be locked
	// TODO: this will work today because it is invoked by an existing lock
	// TODO: this may be a standlone code without instance
	speedms := sample.GPSGroundSpeed * 1000 / 60 / 60
	dateISO := time.Unix(sample.Epoch, 0).Format(time.RFC3339)

	line00 := fmt.Sprintf("<rtept lat=\"%.6f\" lon=\"%.6f\">",
		sample.GPSLatitude,
		sample.GPSLongitude)
	line01 := fmt.Sprintf("    <ele>%.0f</ele>", sample.Alt/3.33)
	line02 := fmt.Sprintf("    <%s></%s>", GPX_NAME, GPX_NAME)
	line03 := fmt.Sprintf("    <cmt></cmt>")
	line04 := fmt.Sprintf("	<desc></desc>")
	line05 := fmt.Sprintf("	<sym>Waypoint</sym>")
	line06 := fmt.Sprintf("	<time>%s</time>", dateISO)
	line07 := fmt.Sprintf("	<speed>%.1f</speed>", speedms)
	line08 := fmt.Sprintf("	<extensions>")
	line09 := fmt.Sprintf("")
	line10 := fmt.Sprintf("			<orient x=\"%.1f\" y=\"%.1f\" z=\"%.1f\"></orient>",
		sample.AHRSPitch,
		sample.AHRSRoll,
		sample.AHRSTurnRate)
	line11 := fmt.Sprintf("			<accel x=\"%.1f\" y=\"%.1f\" z=\"%.1f\"></accel>",
		0.0,
		0.0,
		0.0)
	line12 := fmt.Sprintf("")
	line13 := fmt.Sprintf("")
	line14 := fmt.Sprintf("")
	line15 := fmt.Sprintf("		<baro_ele>%.0f</baro_ele>", sample.BaroPressureAltitude/3.33)
	line16 := fmt.Sprintf("		<ele_diff>%.0f</ele_diff>", (sample.Alt-sample.BaroPressureAltitude)/3.33)
	line17 := fmt.Sprintf("		<gps_head>%.0f</gps_head>", sample.GPSTrueCourse)
	line18 := fmt.Sprintf("		<compass_head>%.0f</compass_head>", sample.AHRSMagHeading)
	line19 := fmt.Sprintf("		<head_diff>%d</head_diff>", 0)
	line20 := fmt.Sprintf("		<gps_err_hor>%.0f</gps_err_hor>", 0.0)
	line21 := fmt.Sprintf("		<gps_err_ver>%.0f</gps_err_ver>", 0.0)
	line22 := fmt.Sprintf("		<gps_err_sph>%d</gps_err_sph>", sample.GPS_satellites_locked)
	line23 := fmt.Sprintf("		<autopilot enabled=\"false\">")
	line24 := ""
	line25 := ""
	/*
		line24 := fmt.Sprintf("			<name></name>")
		line25 := fmt.Sprintf("			<waypoint lat=\"%.6f\" lon=\"%.6f\" ele=\"%.0f\" />",
			0.0,
			0.0,
			0.0)
	*/
	line26 := fmt.Sprintf("		</autopilot>")
	line27 := fmt.Sprintf("		<status>")
	line28 := fmt.Sprintf("			<cputemp>%.1f</cputemp>", sample.CPUTemp)
	line29 := fmt.Sprintf("			<barotemp>%.1f</barotemp>", sample.BaroTemperature)
	line30 := fmt.Sprintf("			<gload>%.1f</gload>", sample.AHRSGLoad)
	line31 := fmt.Sprintf("			<gloadmax>%.1f</gloadmax>", sample.AHRSGLoadMax)
	line32 := fmt.Sprintf("			<gloadmin>%.1f</gloadmin>", sample.AHRSGLoadMin)
	line33 := fmt.Sprintf("		</status>")
	line34 := fmt.Sprintf("		<traffic count=\"%d\">", sample.TrafficCount)
	//line35 := fmt.Sprintf("			<t callsign=\"I-1234\" speed=\"123\" track=\"180\" ele=\"4000\" dist=\"15\" /> ")
	line35 := ""
	line36 := fmt.Sprintf("		</traffic>")
	line37 := fmt.Sprintf("   </extensions>")
	line38 := fmt.Sprintf("</rtept>")

	ret := fmt.Sprintf("%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n",
		line00,
		line01,
		line02,
		line03,
		line04,
		line05,
		line06,
		line07,
		line08,
		line09,
		line10,
		line11,
		line12,
		line13,
		line14,
		line15,
		line16,
		line17,
		line18,
		line19,
		line20,
		line21,
		line22,
		line23,
		line24,
		line25,
		line26,
		line27,
		line28,
		line29,
		line30,
		line31,
		line32,
		line33,
		line34,
		line35,
		line36,
		line37,
		line38)
	return ret

}
