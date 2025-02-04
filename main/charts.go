/*
	Copyright (c) 2023 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	chart.go: Track in Memory the Chart data
	The idea is to have an usable Chart data to be exported directly on Tablet/Smartphone until you poweroff the Stratux
	The recordind data is sampled every second but stored every minute, MAX(sample) is applied, so Load Factor or speed are traced
*/

package main

import (
	"log"
	"sync"
	"time"
)

const (
	CHARTS_SAMPLING = 60
)

type ChartDataCurrent struct {
	Epoch int64
	// Attitude GPS
	GPSGroundSpeed float64
	GPSTrueCourse  float32
	Alt            float32
	//Vv                      float32
	GpsTurnRate float64
	//GPSHeightAboveEllipsoid float32

	// Attitude EFIS Situation
	// From pressure sensor.
	BaroTemperature      float32
	BaroPressureAltitude float32
	BaroVerticalSpeed    float32

	// From AHRS source.
	AHRSPitch       float64
	AHRSRoll        float64
	AHRSGyroHeading float64
	AHRSMagHeading  float64
	AHRSSlipSkid    float64
	AHRSTurnRate    float64
	AHRSGLoad       float64

	// Status
	//Devices                                    uint32
	//Connected_Users                            uint
	GPS_satellites_locked uint16
	CPUTemp               float32

	// Traffic
	TrafficCount int
	GPSLatitude  float32
	GPSLongitude float32
	AHRSGLoadMin float64
	AHRSGLoadMax float64
	// Magnetometer
	Magnetometer MagnetometerData
}
type ChartDataExport struct {
	GPSGroundSpeed []float64
	GPSTrueCourse  []float32
	Alt            []float32
	//Vv                      []float32
	GpsTurnRate []float64
	//GPSHeightAboveEllipsoid []float32

	BaroTemperature      []float32
	BaroPressureAltitude []float32
	BaroVerticalSpeed    []float32

	// From AHRS source.
	AHRSPitch       []float64
	AHRSRoll        []float64
	AHRSGyroHeading []float64
	AHRSMagHeading  []float64
	AHRSSlipSkid    []float64
	AHRSTurnRate    []float64
	AHRSGLoad       []float64

	// Status
	//Devices                                    []uint32
	//Connected_Users                            []uint
	GPS_satellites_locked []uint16
	CPUTemp               []float32
	// Traffic
	TrafficCount []int

	Epoch        []int64
	GPSLatitude  []float32
	GPSLongitude []float32
	AHRSGLoadMin []float64
	AHRSGLoadMax []float64
	// Magnetometer
	MagMaxX		[]float64
	MagMaxY		[]float64
	MagMaxZ		[]float64
	MagMinX		[]float64
	MagMinY		[]float64
	MagMinZ		[]float64
	MagX		[]float64
	MagY		[]float64
	MagZ		[]float64
}

type ChartsStratuxPlugin struct {
	StratuxPlugin
	last            ChartDataCurrent
	export          ChartDataExport
	chartsDataMutex *sync.Mutex
}

var charts = ChartsStratuxPlugin{}

func (chartsInstance *ChartsStratuxPlugin) InitFunc() bool {
	log.Println("Entered ChartStratuxPlugin init() ...")
	chartsInstance.Name = "Chart"
	chartsInstance.chartsDataMutex = &sync.Mutex{}
	//chartsInstance.export = make([]ChartDataCurrent, 0)
	chartsInstance.export.Epoch = make([]int64, 0)
	chartsInstance.export.GPSGroundSpeed = make([]float64, 0)
	chartsInstance.export.GPSTrueCourse = make([]float32, 0)
	chartsInstance.export.Alt = make([]float32, 0)
	//chartsInstance.export.Vv = make([]float32, 0)
	chartsInstance.export.GpsTurnRate = make([]float64, 0)
	chartsInstance.export.GPSLatitude = make([]float32, 0)
	chartsInstance.export.GPSLongitude = make([]float32, 0)
	chartsInstance.export.AHRSGLoadMax = make([]float64, 0)
	chartsInstance.export.AHRSGLoadMin = make([]float64, 0)
	//chartsInstance.export.GPSHeightAboveEllipsoid = make([]float32, 0)

	chartsInstance.export.BaroTemperature = make([]float32, 0)
	chartsInstance.export.BaroPressureAltitude = make([]float32, 0)
	chartsInstance.export.BaroVerticalSpeed = make([]float32, 0)

	chartsInstance.export.AHRSPitch = make([]float64, 0)
	chartsInstance.export.AHRSRoll = make([]float64, 0)
	chartsInstance.export.AHRSGyroHeading = make([]float64, 0)
	chartsInstance.export.AHRSMagHeading = make([]float64, 0)
	chartsInstance.export.AHRSSlipSkid = make([]float64, 0)
	chartsInstance.export.AHRSTurnRate = make([]float64, 0)
	chartsInstance.export.AHRSGLoad = make([]float64, 0)

	//chartsInstance.export.Devices = make([]uint32, 0)
	//chartsInstance.export.Connected_Users = make([]uint, 0)
	chartsInstance.export.GPS_satellites_locked = make([]uint16, 0)
	chartsInstance.export.CPUTemp = make([]float32, 0)

	// Traffic
	chartsInstance.export.TrafficCount = make([]int, 0)

	// Magnetometer
	chartsInstance.export.MagMaxX	= make([]float64, 0)
	chartsInstance.export.MagMaxY	= make([]float64, 0)
	chartsInstance.export.MagMaxZ	= make([]float64, 0)
	chartsInstance.export.MagMinX	= make([]float64, 0)
	chartsInstance.export.MagMinY	= make([]float64, 0)
	chartsInstance.export.MagMinZ	= make([]float64, 0)
	chartsInstance.export.MagX	= make([]float64, 0)
	chartsInstance.export.MagY	= make([]float64, 0)
	chartsInstance.export.MagZ	= make([]float64, 0)

	// Start File system recording:
	exportGPX := ExportGPXStratuxPlugin{SessionName: time.Now().UTC().Format(time.RFC3339), FilePath: "/tmp/" + time.Now().UTC().Format(time.RFC3339) + ".gpx"}
	exportGPX.generateHeader()

	go chartsInstance.ListenerFunc()
	return true
}

/***
 * Aerobatic, turbolence or other on demand to store POI
 * On demand can be user requrest or when there are some error indicators
 */
func (chartsInstance *ChartsStratuxPlugin) IsTimeToStoreSample(elapsed int) bool {
	// First step: check for user request

	// Second step: error event trap

	// 3rd step: automation based on situation rules


	// 4th step: Time based
	if(elapsed < 1) {
		return true
	} else {
	}
	return false
}

func (chartsInstance *ChartsStratuxPlugin) ListenerFunc() {
	var EveryMinute int
	EveryMinute = CHARTS_SAMPLING
	for {
		time.Sleep(1 * time.Second)
		if globalSettings.Charts_Enabled == false {
			continue
		}
		if chartsInstance.IsTimeToStoreSample(EveryMinute) == true {
			chartsInstance.chartsDataMutex.Lock()
			chartsInstance.export.GPSGroundSpeed = append(chartsInstance.export.GPSGroundSpeed, chartsInstance.last.GPSGroundSpeed)
			chartsInstance.export.Alt = append(chartsInstance.export.Alt, chartsInstance.last.Alt)
			chartsInstance.export.GPSTrueCourse = append(chartsInstance.export.GPSTrueCourse, chartsInstance.last.GPSTrueCourse)
			//chartsInstance.export.Vv = append(chartsInstance.export.Vv, chartsInstance.last.Vv)
			chartsInstance.export.GpsTurnRate = append(chartsInstance.export.GpsTurnRate, chartsInstance.last.GpsTurnRate)
			chartsInstance.export.GPSLatitude = append(chartsInstance.export.GPSLatitude, chartsInstance.last.GPSLatitude)
			chartsInstance.export.GPSLongitude = append(chartsInstance.export.GPSLongitude, chartsInstance.last.GPSLongitude)
			chartsInstance.export.AHRSGLoadMax = append(chartsInstance.export.AHRSGLoadMax, chartsInstance.last.AHRSGLoadMax)
			chartsInstance.export.AHRSGLoadMin = append(chartsInstance.export.AHRSGLoadMin, chartsInstance.last.AHRSGLoadMin)
			//chartsInstance.export.GPSHeightAboveEllipsoid = append(chartsInstance.export.GPSHeightAboveEllipsoid, chartsInstance.last.GPSHeightAboveEllipsoid)

			chartsInstance.export.GPS_satellites_locked = append(chartsInstance.export.GPS_satellites_locked, chartsInstance.last.GPS_satellites_locked)
			chartsInstance.export.CPUTemp = append(chartsInstance.export.CPUTemp, chartsInstance.last.CPUTemp)

			chartsInstance.export.TrafficCount = append(chartsInstance.export.TrafficCount, chartsInstance.last.TrafficCount)
			chartsInstance.export.Epoch = append(chartsInstance.export.Epoch, time.Now().Unix())

			chartsInstance.export.BaroTemperature = append(chartsInstance.export.BaroTemperature, chartsInstance.last.BaroTemperature)
			chartsInstance.export.BaroPressureAltitude = append(chartsInstance.export.BaroPressureAltitude, chartsInstance.last.BaroPressureAltitude)
			chartsInstance.export.BaroVerticalSpeed = append(chartsInstance.export.BaroVerticalSpeed, chartsInstance.last.BaroVerticalSpeed)

			chartsInstance.export.AHRSPitch = append(chartsInstance.export.AHRSPitch, chartsInstance.last.AHRSPitch)
			chartsInstance.export.AHRSRoll = append(chartsInstance.export.AHRSRoll, chartsInstance.last.AHRSRoll)
			chartsInstance.export.AHRSGyroHeading = append(chartsInstance.export.AHRSGyroHeading, chartsInstance.last.AHRSGyroHeading)
			chartsInstance.export.AHRSMagHeading = append(chartsInstance.export.AHRSMagHeading, chartsInstance.last.AHRSMagHeading)
			chartsInstance.export.AHRSSlipSkid = append(chartsInstance.export.AHRSSlipSkid, chartsInstance.last.AHRSSlipSkid)
			chartsInstance.export.AHRSTurnRate = append(chartsInstance.export.AHRSTurnRate, chartsInstance.last.AHRSTurnRate)
			chartsInstance.export.AHRSGLoad = append(chartsInstance.export.AHRSGLoad, chartsInstance.last.AHRSGLoad)

			chartsInstance.export.MagMaxX	= append(chartsInstance.export.MagMaxX, chartsInstance.last.Magnetometer.MagMaxX)
			chartsInstance.export.MagMaxY	= append(chartsInstance.export.MagMaxY, chartsInstance.last.Magnetometer.MagMaxY)
			chartsInstance.export.MagMaxZ	= append(chartsInstance.export.MagMaxZ, chartsInstance.last.Magnetometer.MagMaxZ)
			chartsInstance.export.MagMinX	= append(chartsInstance.export.MagMinX, chartsInstance.last.Magnetometer.MagMinX)
			chartsInstance.export.MagMinY	= append(chartsInstance.export.MagMinY, chartsInstance.last.Magnetometer.MagMinY)
			chartsInstance.export.MagMinZ	= append(chartsInstance.export.MagMinZ, chartsInstance.last.Magnetometer.MagMinZ)
			chartsInstance.export.MagX	= append(chartsInstance.export.MagX, chartsInstance.last.Magnetometer.X)
			chartsInstance.export.MagY	= append(chartsInstance.export.MagY, chartsInstance.last.Magnetometer.Y)
			chartsInstance.export.MagZ	= append(chartsInstance.export.MagZ, chartsInstance.last.Magnetometer.Z)

			// Store the retrieved data by a stream on the storage
			// TODO:
			// - Let's the user decide the storage location, in case of USB
			// - Let's the user decide the format CSV, KML, GPX, Waypoints, Route...
			//log.Println(exportGPX.generateHeader("Session Name"))
			//log.Println(exportGPX.generatePointBySample(chartsInstance.last))
			//log.Println(exportGPX.generateTrailerBySample())

			// Digest
			chartsInstance.last.AHRSPitch = 0
			chartsInstance.last.AHRSRoll = 0
			chartsInstance.last.AHRSGyroHeading = 0
			chartsInstance.last.AHRSMagHeading = 0
			chartsInstance.last.AHRSSlipSkid = 0
			chartsInstance.last.AHRSTurnRate = 0
			chartsInstance.last.AHRSGLoad = 1
			chartsInstance.last.Alt = 0

			chartsInstance.last.GPSTrueCourse = 0
			chartsInstance.last.GpsTurnRate = 0
			chartsInstance.last.GPSGroundSpeed = 0

			//
			chartsInstance.chartsDataMutex.Unlock()
			EveryMinute = CHARTS_SAMPLING
		}
		EveryMinute = EveryMinute - 1
	}

	log.Println("Entered ChartsStratuxPlugin done() ...")
}

func (chartsInstance *ChartsStratuxPlugin) ShutdownFunc() bool {
	log.Println("Entered ChartsStratuxPlugin shutdown() ...")

	return true
}

func (chartsInstance *ChartsStratuxPlugin) logSituation() {
	if globalSettings.Charts_Enabled == true {
		chartsInstance.chartsDataMutex.Lock()
		chartsInstance.last.BaroTemperature = mySituation.BaroTemperature
		chartsInstance.last.BaroPressureAltitude = mySituation.BaroPressureAltitude
		chartsInstance.last.BaroVerticalSpeed = mySituation.BaroVerticalSpeed
		if mySituation.AHRSPitch < 0 {
			if chartsInstance.last.AHRSPitch > mySituation.AHRSPitch {
				chartsInstance.last.AHRSPitch = mySituation.AHRSPitch
			}	
		} else {
		if chartsInstance.last.AHRSPitch < mySituation.AHRSPitch {
			chartsInstance.last.AHRSPitch = mySituation.AHRSPitch
		}
		}
		if mySituation.AHRSRoll < 0 {
			if chartsInstance.last.AHRSRoll > mySituation.AHRSRoll {
				chartsInstance.last.AHRSRoll = mySituation.AHRSRoll
			}
		} else {
		if chartsInstance.last.AHRSRoll < mySituation.AHRSRoll {
			chartsInstance.last.AHRSRoll = mySituation.AHRSRoll
		}
		}
		if mySituation.AHRSGyroHeading < 3276.7 {
			chartsInstance.last.AHRSGyroHeading = mySituation.AHRSGyroHeading
		}

		chartsInstance.last.AHRSMagHeading = mySituation.AHRSMagHeading
		if chartsInstance.last.AHRSSlipSkid < mySituation.AHRSSlipSkid {
			chartsInstance.last.AHRSSlipSkid = mySituation.AHRSSlipSkid
		}
		if mySituation.AHRSTurnRate < 3276.7 {
			if chartsInstance.last.AHRSTurnRate < mySituation.AHRSTurnRate {
				chartsInstance.last.AHRSTurnRate = mySituation.AHRSTurnRate
			}
		}
		// Aerobatics negative G-Loads
		if(mySituation.AHRSGLoad<1) {
			if chartsInstance.last.AHRSGLoad > mySituation.AHRSGLoad {
				chartsInstance.last.AHRSGLoad = mySituation.AHRSGLoad
			}	
		} else {
		if chartsInstance.last.AHRSGLoad < mySituation.AHRSGLoad {
			chartsInstance.last.AHRSGLoad = mySituation.AHRSGLoad
		}
		}

		if chartsInstance.last.Alt < mySituation.GPSAltitudeMSL {
			chartsInstance.last.Alt = mySituation.GPSAltitudeMSL
		}

		//chartsInstance.last.Vv = mySituation.GPSVerticalSpeed

		if chartsInstance.last.GPSTrueCourse < mySituation.GPSTrueCourse {
			chartsInstance.last.GPSTrueCourse = mySituation.GPSTrueCourse
		}
		if chartsInstance.last.GpsTurnRate < mySituation.GPSTurnRate {
			chartsInstance.last.GpsTurnRate = mySituation.GPSTurnRate
		}
		if chartsInstance.last.GPSGroundSpeed < mySituation.GPSGroundSpeed {
			chartsInstance.last.GPSGroundSpeed = mySituation.GPSGroundSpeed
		}
		/*
			if chartsInstance.last.GPSHeightAboveEllipsoid < mySituation.GPSHeightAboveEllipsoid {
				chartsInstance.last.GPSHeightAboveEllipsoid = mySituation.GPSHeightAboveEllipsoid
			}
		*/

		chartsInstance.last.GPSLatitude = mySituation.GPSLatitude
		chartsInstance.last.GPSLongitude = mySituation.GPSLongitude
		chartsInstance.last.AHRSGLoadMax = mySituation.AHRSGLoadMax
		chartsInstance.last.AHRSGLoadMin = mySituation.AHRSGLoadMin

		// Magnetometer
		chartsInstance.last.Magnetometer = mySituation.Magnetometer
		chartsInstance.last.Magnetometer.Heading = int(mySituation.AHRSMagHeading)

		chartsInstance.chartsDataMutex.Unlock()
	}
}

func (chartsInstance *ChartsStratuxPlugin) logTraffic(ti TrafficInfo) {
	if globalSettings.Charts_Enabled == true {
		chartsInstance.chartsDataMutex.Lock()
		chartsInstance.last.TrafficCount = len(traffic)
		chartsInstance.chartsDataMutex.Unlock()
	}
}

func (chartsInstance *ChartsStratuxPlugin) logStatus() {
	if globalSettings.Charts_Enabled == true {
		chartsInstance.chartsDataMutex.Lock()
		chartsInstance.last.GPS_satellites_locked = globalStatus.GPS_satellites_locked
		chartsInstance.last.CPUTemp = globalStatus.CPUTemp
		chartsInstance.chartsDataMutex.Unlock()
	}
}

func chartsSamplesByIndexToSample(index int, samples ChartDataExport) ChartDataCurrent {
	ret := ChartDataCurrent{
		Epoch:                 samples.Epoch[index],
		GPSGroundSpeed:        samples.GPSGroundSpeed[index],
		GPSTrueCourse:         samples.GPSTrueCourse[index],
		Alt:                   samples.Alt[index],
		GpsTurnRate:           samples.GpsTurnRate[index],
		BaroTemperature:       samples.BaroTemperature[index],
		BaroPressureAltitude:  samples.BaroPressureAltitude[index],
		BaroVerticalSpeed:     samples.BaroVerticalSpeed[index],
		AHRSPitch:             samples.AHRSPitch[index],
		AHRSRoll:              samples.AHRSRoll[index],
		AHRSGyroHeading:       samples.AHRSGyroHeading[index],
		AHRSMagHeading:        samples.AHRSMagHeading[index],
		AHRSSlipSkid:          samples.AHRSSlipSkid[index],
		AHRSTurnRate:          samples.AHRSTurnRate[index],
		AHRSGLoad:             samples.AHRSGLoad[index],
		GPS_satellites_locked: samples.GPS_satellites_locked[index],
		CPUTemp:               samples.CPUTemp[index],
		TrafficCount:          samples.TrafficCount[index],
		GPSLatitude:           samples.GPSLatitude[index],
		GPSLongitude:          samples.GPSLongitude[index],
		AHRSGLoadMin:          samples.AHRSGLoadMin[index],
		AHRSGLoadMax:          samples.AHRSGLoadMax[index],
		Magnetometer:          MagnetometerData{MagMaxX: samples.MagMaxX[index],
			MagMaxY: samples.MagMaxY[index],
			MagMaxZ: samples.MagMaxZ[index],
			MagMinX: samples.MagMinX[index],
			MagMinY: samples.MagMinY[index],
			MagMinZ: samples.MagMinZ[index],
			X: samples.MagX[index],
			Y: samples.MagY[index],
			Z: samples.MagZ[index],
			Heading: int(samples.AHRSMagHeading[index])}}
	return ret
}
