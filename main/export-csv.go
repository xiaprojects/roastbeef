/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	export-csv.go: Store Track in CSV

	Roadmap:
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

type ExportCSVStratuxPlugin struct {
	SessionName string
	FilePath    string
}

func (exportCSVInstance *ExportCSVStratuxPlugin) readAndTrailFile() string {
	content, err := ioutil.ReadFile(exportCSVInstance.FilePath)
	if err != nil {
		log.Println(err)
		return ""
	}

	ret := fmt.Sprintf("%s%s", content, exportCSVInstance.generateTrailer())
	return ret
}

func (exportCSVInstance *ExportCSVStratuxPlugin) appendStringToFile(String string) bool {
	f, err := os.OpenFile(exportCSVInstance.FilePath,
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

func (exportCSVInstance *ExportCSVStratuxPlugin) generateHeaderByData(name string) string {
	ret := fmt.Sprintf("Epoch,Time,GPSLatitude,GPSLongitude,GPSGroundSpeed,GPSTrueCourse,Alt,BaroPressureAltitude,AHRSPitch,AHRSRoll,AHRSGLoad,BaroTemperature,BaroVerticalSpeed,GPS_satellites_locked,TrafficCount,CPUTemp,AHRSMagHeading,MagX,MagY,MagZ\n")
	return ret
}

func (exportCSVInstance *ExportCSVStratuxPlugin) generateHeader() string {
	return exportCSVInstance.generateHeaderByData(exportCSVInstance.SessionName)
}

func (exportCSVInstance *ExportCSVStratuxPlugin) generateTrailer() string {
	return ""
}

func (exportCSVInstance *ExportCSVStratuxPlugin) generatePointBySamples(samples ChartDataExport) string {
	buffer := ""
	for index := 0; index < len(samples.Epoch); index++ {
		sample := chartsSamplesByIndexToSample(index, samples)
		buffer = buffer + exportCSVInstance.generatePointBySample(sample)
	}
	return buffer
}

func (exportCSVInstance *ExportCSVStratuxPlugin) generatePointBySample(sample ChartDataCurrent) string {
	ret := fmt.Sprintf("%d,%s,%.6f,%.6f,%.0f,%.0f,%.0f,%.0f,%.1f,%.1f,%.1f,%.1f,%.1f,%d,%d,%.1f\n",
		sample.Epoch,
		time.Unix(sample.Epoch, 0).Format(time.RFC3339),
		sample.GPSLatitude,
		sample.GPSLongitude,
		sample.GPSGroundSpeed,
		sample.GPSTrueCourse,
		sample.Alt/3.33,
		sample.BaroPressureAltitude/3.33,
		sample.AHRSPitch,
		sample.AHRSRoll,
		sample.AHRSGLoad,
		sample.BaroTemperature,
		sample.BaroVerticalSpeed,
		sample.GPS_satellites_locked,
		sample.TrafficCount,
		sample.CPUTemp,
		sample.AHRSMagHeading,
		sample.Magnetometer.X,
		sample.Magnetometer.Y,
		sample.Magnetometer.Z)
	return ret

}
