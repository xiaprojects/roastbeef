/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	export-kml.go: Store Track in KML

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
)


type ExportKMLStratuxPlugin struct {
	SessionName    string
	FilePath    string
}

func (exportKMLInstance *ExportKMLStratuxPlugin) readAndTrailFile() string {
	content, err := ioutil.ReadFile(exportKMLInstance.FilePath)
	if err != nil {
		log.Println(err)
		return ""
	}

	ret := fmt.Sprintf("%s%s", content, exportKMLInstance.generateTrailer())
	return ret
}

func (exportKMLInstance *ExportKMLStratuxPlugin) appendStringToFile(String string) bool {
	f, err := os.OpenFile(exportKMLInstance.FilePath,
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


func (exportKMLInstance *ExportKMLStratuxPlugin) generateHeaderByData(name string) string {
	a := fmt.Sprintf("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")
	b := fmt.Sprintf("<kml xmlns=\"http://www.opengis.net/kml/2.2\" xmlns:gx=\"http://www.google.com/kml/ext/2.2\" xmlns:kml=\"http://www.opengis.net/kml/2.2\" xmlns:atom=\"http://www.w3.org/2005/Atom\">")
	c := fmt.Sprintf("<Document>")
	d := fmt.Sprintf("<name>%s</name>\n<Style id=\"trackStyle\">\n<IconStyle>\n<scale>1.3</scale>\n<Icon><href>http://www.google.com/mapfiles/ms/micons/plane.png</href></Icon>\n</IconStyle>\n<LineStyle><color>7f0000ff</color><width>5</width></LineStyle>\n<PolyStyle><color>7f000000</color></PolyStyle>\n</Style>\n<Placemark id=\"track\"><visibility>1</visibility>\n<name>%s</name><description></description><open>1</open><styleUrl>#trackStyle</styleUrl>\n<LineString>\n<gx:altitudeMode>relativeToSeaFloor</gx:altitudeMode>\n<extrude>1</extrude>\n<tessellate>0</tessellate>\n<coordinates>",
	name,
	name)
	ret := fmt.Sprintf("%s\n%s\n%s\n%s\n", a, b, c, d)
	return ret
}

func (exportKMLInstance *ExportKMLStratuxPlugin) generateHeader() string {
	return exportKMLInstance.generateHeaderByData(exportKMLInstance.SessionName)
}

func (exportKMLInstance *ExportKMLStratuxPlugin) generateTrailer() string {
	c := fmt.Sprintf("</coordinates>\n</LineString>\n</Placemark>\n</Document>")
	ret := fmt.Sprintf("%s\n</kml>\n", c)
	return ret
}

func (exportKMLInstance *ExportKMLStratuxPlugin) generatePointBySamples(samples ChartDataExport) string {
	buffer := ""
	for index := 0; index < len(samples.Epoch); index++ {
		sample := chartsSamplesByIndexToSample(index,samples)
		buffer = buffer + exportKMLInstance.generatePointBySample(sample)
	}
	return buffer
}

func (exportKMLInstance *ExportKMLStratuxPlugin) generatePointBySample(sample ChartDataCurrent) string {
	ret := fmt.Sprintf("%.6f,%.6f,%.0f\n",
		sample.GPSLongitude,
		sample.GPSLatitude,
		sample.Alt/3.33)
	return ret

}
