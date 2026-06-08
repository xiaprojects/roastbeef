/*
This file is part of RB.

# Copyright (C) 2026 XIAPROJECTS SRL

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
package sensors

import (
	"errors"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/kidoman/embd"
	_ "github.com/kidoman/embd/host/rpi"
)

// BME680 register addresses from official Linux driver
const (
	BME680_REG_CHIP_ID    = 0xD0
	BME680_REG_SOFT_RESET = 0xE0
	BME680_CMD_SOFTRESET  = 0xB6
	BME680_CHIP_ID_VAL    = 0x61

	// Calibration registers - Temperature
	BME680_T1_LSB_REG = 0xE9
	BME680_T2_LSB_REG = 0x8A
	BME680_T3_REG     = 0x8C

	// Calibration registers - Pressure
	BME680_P1_LSB_REG = 0x8E
	BME680_P2_LSB_REG = 0x90
	BME680_P3_REG     = 0x92
	BME680_P4_LSB_REG = 0x94
	BME680_P5_LSB_REG = 0x96
	BME680_P6_REG     = 0x99
	BME680_P7_REG     = 0x98
	BME680_P8_LSB_REG = 0x9C
	BME680_P9_LSB_REG = 0x9E
	BME680_P10_REG    = 0xA0

	// Calibration registers - Humidity
	BME680_H1_MSB_REG = 0xE2
	BME680_H1_LSB_REG = 0xE3
	BME680_H2_MSB_REG = 0xE1
	BME680_H2_LSB_REG = 0xE3
	BME680_H3_REG     = 0xE4
	BME680_H4_REG     = 0xE5
	BME680_H5_REG     = 0xE6
	BME680_H6_REG     = 0xE7
	BME680_H7_REG     = 0xE8

	// Calibration registers - Gas heater
	BME680_GH1_REG     = 0xED
	BME680_GH2_LSB_REG = 0xEB
	BME680_GH3_REG     = 0xEE

	// Other calibration
	BME680_REG_RES_HEAT_RANGE = 0x02
	BME680_REG_RES_HEAT_VAL   = 0x00
	BME680_REG_RANGE_SW_ERR   = 0x04

	// Control registers
	BME680_REG_CTRL_GAS_1    = 0x71
	BME680_REG_CTRL_HUMIDITY = 0x72
	BME680_REG_CTRL_MEAS     = 0x74
	BME680_REG_CONFIG        = 0x75

	// Heater registers
	BME680_REG_RES_HEAT_0 = 0x5A
	BME680_REG_GAS_WAIT_0 = 0x64

	// Data registers
	BME680_REG_PRESS_MSB = 0x1F
	BME680_REG_TEMP_MSB  = 0x22
	BME680_REG_HUM_MSB   = 0x25
	BME680_REG_GAS_MSB   = 0x2A
	BME680_REG_GAS_R_LSB = 0x2B

	BME680_AMB_TEMP = 25 // Ambient temperature for heater calculation
)

var errBME = errors.New("BME680 Error: BME680 is not running")

// BME680 represents a BME680 sensor
type BME680 struct {
	running       bool
	i2c           *embd.I2CBus
	addr          byte
	temperature   float64
	pressure      float64
	humidity      float64
	gasResistance float64
	gasBaseline   float64

	// Temperature calibration
	parT1 uint16
	parT2 int16
	parT3 int8

	// Pressure calibration
	parP1  uint16
	parP2  int16
	parP3  int8
	parP4  int16
	parP5  int16
	parP6  int8
	parP7  int8
	parP8  int16
	parP9  int16
	parP10 uint8

	// Humidity calibration
	parH1 uint16
	parH2 uint16
	parH3 int8
	parH4 int8
	parH5 int8
	parH6 uint8
	parH7 int8

	// Gas heater calibration
	parGH1         int8
	parGH2         int16
	parGH3         int8
	resHeatRange   uint8
	resHeatVal     int8
	rangeSwitchErr int8

	tFine int32
}

// NewBME680 initializes a BME680 sensor
func NewBME680(i2cbus *embd.I2CBus, freq time.Duration) (*BME680, error) {
	addrs := []byte{0x76, 0x77}
	var addr byte
	found := false

	for _, a := range addrs {
		buf := []byte{0}
		if (*i2cbus).ReadFromReg(a, BME680_REG_CHIP_ID, buf) == nil && buf[0] == BME680_CHIP_ID_VAL {
			addr = a
			found = true
			log.Printf("BME680 found at address 0x%02X", a)
			break
		}
	}

	if !found {
		return nil, errors.New("BME680 not found on I2C bus")
	}

	b := &BME680{
		i2c:  i2cbus,
		addr: addr,
	}

	// Soft reset
	if err := b.writeReg(BME680_REG_SOFT_RESET, BME680_CMD_SOFTRESET); err != nil {
		return nil, fmt.Errorf("soft reset failed: %w", err)
	}
	time.Sleep(10 * time.Millisecond)

	// Read calibration data
	if err := b.readCalibration(); err != nil {
		return nil, fmt.Errorf("failed to read calibration: %w", err)
	}

	// Configure sensor
	if err := b.configure(); err != nil {
		return nil, fmt.Errorf("failed to configure sensor: %w", err)
	}

	go b.run(freq)
	return b, nil
}

func (b *BME680) readReg(reg byte, buf []byte) error {
	return (*b.i2c).ReadFromReg(b.addr, reg, buf)
}

func (b *BME680) writeReg(reg byte, val byte) error {
	return (*b.i2c).WriteToReg(b.addr, reg, []byte{val})
}

func (b *BME680) readCalibration() error {
	// Temperature calibration - CORRECTED addresses
	buf2 := make([]byte, 2)
	if err := b.readReg(BME680_T1_LSB_REG, buf2); err != nil {
		return err
	}
	b.parT1 = uint16(buf2[0]) | uint16(buf2[1])<<8

	if err := b.readReg(BME680_T2_LSB_REG, buf2); err != nil {
		return err
	}
	b.parT2 = int16(buf2[0]) | int16(buf2[1])<<8

	buf1 := make([]byte, 1)
	if err := b.readReg(BME680_T3_REG, buf1); err != nil {
		return err
	}
	b.parT3 = int8(buf1[0])

	// Pressure calibration
	if err := b.readReg(BME680_P1_LSB_REG, buf2); err != nil {
		return err
	}
	b.parP1 = uint16(buf2[0]) | uint16(buf2[1])<<8

	if err := b.readReg(BME680_P2_LSB_REG, buf2); err != nil {
		return err
	}
	b.parP2 = int16(buf2[0]) | int16(buf2[1])<<8

	if err := b.readReg(BME680_P3_REG, buf1); err != nil {
		return err
	}
	b.parP3 = int8(buf1[0])

	if err := b.readReg(BME680_P4_LSB_REG, buf2); err != nil {
		return err
	}
	b.parP4 = int16(buf2[0]) | int16(buf2[1])<<8

	if err := b.readReg(BME680_P5_LSB_REG, buf2); err != nil {
		return err
	}
	b.parP5 = int16(buf2[0]) | int16(buf2[1])<<8

	if err := b.readReg(BME680_P6_REG, buf1); err != nil {
		return err
	}
	b.parP6 = int8(buf1[0])

	if err := b.readReg(BME680_P7_REG, buf1); err != nil {
		return err
	}
	b.parP7 = int8(buf1[0])

	if err := b.readReg(BME680_P8_LSB_REG, buf2); err != nil {
		return err
	}
	b.parP8 = int16(buf2[0]) | int16(buf2[1])<<8

	if err := b.readReg(BME680_P9_LSB_REG, buf2); err != nil {
		return err
	}
	b.parP9 = int16(buf2[0]) | int16(buf2[1])<<8

	if err := b.readReg(BME680_P10_REG, buf1); err != nil {
		return err
	}
	b.parP10 = buf1[0]

	// Humidity calibration
	bufH := make([]byte, 1)
	if err := b.readReg(BME680_H1_MSB_REG, bufH); err != nil {
		return err
	}
	h1MSB := bufH[0]

	if err := b.readReg(BME680_H1_LSB_REG, bufH); err != nil {
		return err
	}
	b.parH1 = uint16(h1MSB)<<4 | uint16(bufH[0]&0x0F)

	if err := b.readReg(BME680_H2_MSB_REG, bufH); err != nil {
		return err
	}
	h2MSB := bufH[0]

	if err := b.readReg(BME680_H2_LSB_REG, bufH); err != nil {
		return err
	}
	b.parH2 = uint16(h2MSB)<<4 | uint16(bufH[0]>>4)

	if err := b.readReg(BME680_H3_REG, bufH); err != nil {
		return err
	}
	b.parH3 = int8(bufH[0])

	if err := b.readReg(BME680_H4_REG, bufH); err != nil {
		return err
	}
	b.parH4 = int8(bufH[0])

	if err := b.readReg(BME680_H5_REG, bufH); err != nil {
		return err
	}
	b.parH5 = int8(bufH[0])

	if err := b.readReg(BME680_H6_REG, bufH); err != nil {
		return err
	}
	b.parH6 = bufH[0]

	if err := b.readReg(BME680_H7_REG, bufH); err != nil {
		return err
	}
	b.parH7 = int8(bufH[0])

	// Gas heater calibration
	if err := b.readReg(BME680_GH1_REG, bufH); err != nil {
		return err
	}
	b.parGH1 = int8(bufH[0])

	if err := b.readReg(BME680_GH2_LSB_REG, buf2); err != nil {
		return err
	}
	b.parGH2 = int16(buf2[0]) | int16(buf2[1])<<8

	if err := b.readReg(BME680_GH3_REG, bufH); err != nil {
		return err
	}
	b.parGH3 = int8(bufH[0])

	if err := b.readReg(BME680_REG_RES_HEAT_RANGE, bufH); err != nil {
		return err
	}
	b.resHeatRange = (bufH[0] >> 4) & 0x03

	if err := b.readReg(BME680_REG_RES_HEAT_VAL, bufH); err != nil {
		return err
	}
	b.resHeatVal = int8(bufH[0])

	if err := b.readReg(BME680_REG_RANGE_SW_ERR, bufH); err != nil {
		return err
	}
	b.rangeSwitchErr = int8((bufH[0] >> 4) & 0x0F)

	log.Printf("BME680 Calibration: T1=%d T2=%d T3=%d P1=%d", b.parT1, b.parT2, b.parT3, b.parP1)
	return nil
}

func (b *BME680) configure() error {
	// Humidity oversampling x2
	if err := b.writeReg(BME680_REG_CTRL_HUMIDITY, 0x01); err != nil {
		return err
	}

	// Temperature oversampling x8, Pressure oversampling x4
	if err := b.writeReg(BME680_REG_CTRL_MEAS, 0x8C); err != nil {
		return err
	}

	// Calculate heater resistance for 320°C
	heaterRes := b.calcHeaterRes(320)
	if err := b.writeReg(BME680_REG_RES_HEAT_0, heaterRes); err != nil {
		return err
	}

	// Set heater duration to 150ms
	heaterDur := b.calcHeaterDur(150)
	if err := b.writeReg(BME680_REG_GAS_WAIT_0, heaterDur); err != nil {
		return err
	}

	// Enable gas measurement
	if err := b.writeReg(BME680_REG_CTRL_GAS_1, 0x10); err != nil {
		return err
	}

	return nil
}

func (b *BME680) calcHeaterRes(targetTemp uint16) byte {
	if targetTemp > 400 {
		targetTemp = 400
	}

	var1 := (int32(BME680_AMB_TEMP) * int32(b.parGH3)) / 1000 * 256
	var2 := (int32(b.parGH1) + 784) * (((int32(b.parGH2)+154009)*int32(targetTemp)*5)/100 + 3276800) / 10
	var3 := var1 + (var2 / 2)
	var4 := var3 / (int32(b.resHeatRange) + 4)
	var5 := (131 * int32(b.resHeatVal)) + 65536
	heaterResX100 := ((var4 / var5) - 250) * 34
	heaterRes := (heaterResX100 + 50) / 100

	return byte(heaterRes)
}

func (b *BME680) calcHeaterDur(durMs uint16) byte {
	if durMs >= 0xfc0 {
		return 0xff
	}

	factor := byte(0)
	for durMs > 0x3F {
		durMs = durMs / 4
		factor++
	}

	return byte(durMs) + (factor * 64)
}

func (b *BME680) compensateTemp(adcTemp int32) float64 {
	var1 := (adcTemp >> 3) - (int32(b.parT1) << 1)
	var2 := (var1 * int32(b.parT2)) >> 11
	var3 := ((var1 >> 1) * (var1 >> 1)) >> 12
	var3 = (var3 * (int32(b.parT3) << 4)) >> 14
	b.tFine = var2 + var3
	temp := (b.tFine*5 + 128) >> 8
	return float64(temp) / 100.0
}

func (b *BME680) compensatePressure(adcPress int32) float64 {
	var1 := (int64(b.tFine) >> 1) - 64000
	var2 := (((var1 >> 2) * (var1 >> 2)) >> 11) * int64(b.parP6)
	var2 += (var1 * int64(b.parP5)) << 1
	var2 = (var2 >> 2) + (int64(b.parP4) << 16)
	var1 = (((int64(b.parP3) * ((var1 >> 2) * (var1 >> 2) >> 13)) >> 3) + ((int64(b.parP2) * var1) >> 1)) >> 18
	var1 = ((32768 + var1) * int64(b.parP1)) >> 15

	if var1 == 0 {
		return 0
	}

	p := int64(1048576 - adcPress)
	p = ((p - (var2 >> 12)) * 3125)

	if p < 0x80000000 {
		p = (p << 1) / var1
	} else {
		p = (p / var1) * 2
	}

	var1 = (int64(b.parP9) * ((p >> 3) * (p >> 3) >> 13)) >> 12
	var2 = ((p >> 2) * int64(b.parP8)) >> 13
	var3 := ((p >> 8) * (p >> 8) * (p >> 8) * int64(b.parP10)) >> 17
	p = p + ((var1 + var2 + var3 + (int64(b.parP7) << 7)) >> 4)

	return float64(p) / 100.0
}

func (b *BME680) compensateHumidity(adcHum int32) float64 {
	tempScaled := (b.tFine*5 + 128) >> 8
	var1 := adcHum - (int32(b.parH1) << 4) - (((tempScaled * int32(b.parH3)) / 100) >> 1)
	var2 := (int32(b.parH2) *
		(((tempScaled * int32(b.parH4)) / 100) +
			(((tempScaled * ((tempScaled * int32(b.parH5)) / 100)) >> 6) / 100) + (1 << 14))) >> 10
	var3 := var1 * var2
	var4 := int32(b.parH6) << 7
	var4 = (var4 + ((tempScaled * int32(b.parH7)) / 100)) >> 4
	var5 := ((var3 >> 14) * (var3 >> 14)) >> 10
	var6 := (var4 * var5) >> 1
	h := (((var3 + var6) >> 10) * 1000) >> 12

	if h > 100000 {
		h = 100000
	} else if h < 0 {
		h = 0
	}

	return float64(h) / 1000.0
}

func (b *BME680) compensateGas(adcGas int32, gasRange byte) float64 {
	lookupTable1 := []uint32{
		2147483647, 2147483647, 2147483647, 2147483647,
		2147483647, 2126008810, 2147483647, 2130303777,
		2147483647, 2147483647, 2143188679, 2136746228,
		2147483647, 2126008810, 2147483647, 2147483647,
	}

	var1 := int64((1340+(5*int64(b.rangeSwitchErr)))*int64(lookupTable1[gasRange])) >> 16
	var2 := (int64(adcGas) << 15) - 16777216 + var1
	var3 := (int64(125000) << (15 - gasRange)) * var1 >> 9
	var3 += (var2 >> 1)

	if var2 == 0 {
		return 0
	}

	gasRes := float64(var3) / float64(var2)
	return gasRes
}

func (b *BME680) performMeasurement() {
	// Set forced mode
	b.writeReg(BME680_REG_CTRL_MEAS, 0x8D) // Temp x8, Press x4, Forced mode
	time.Sleep(250 * time.Millisecond)

	// Read temperature
	buf := make([]byte, 3)
	if err := b.readReg(BME680_REG_TEMP_MSB, buf); err != nil {
		return
	}
	adcTemp := int32(buf[0])<<12 | int32(buf[1])<<4 | int32(buf[2])>>4
	b.temperature = b.compensateTemp(adcTemp)

	// Read pressure
	if err := b.readReg(BME680_REG_PRESS_MSB, buf); err != nil {
		return
	}
	adcPress := int32(buf[0])<<12 | int32(buf[1])<<4 | int32(buf[2])>>4
	b.pressure = b.compensatePressure(adcPress)

	// Read humidity
	buf2 := make([]byte, 2)
	if err := b.readReg(BME680_REG_HUM_MSB, buf2); err != nil {
		return
	}
	adcHum := int32(buf2[0])<<8 | int32(buf2[1])
	b.humidity = b.compensateHumidity(adcHum)

	// Read gas resistance
	if err := b.readReg(BME680_REG_GAS_MSB, buf2); err != nil {
		return
	}
	buf1 := make([]byte, 1)
	if err := b.readReg(BME680_REG_GAS_R_LSB, buf1); err != nil {
		return
	}
	adcGas := int32(buf2[0])<<2 | int32(buf1[0])>>6
	gasRange := buf1[0] & 0x0F
	b.gasResistance = b.compensateGas(adcGas, gasRange)

	// Update baseline
	if b.gasBaseline == 0 {
		b.gasBaseline = b.gasResistance
	} else {
		b.gasBaseline = 0.995*b.gasBaseline + 0.005*b.gasResistance
	}

	/*
		log.Printf("BME680: T=%.2f°C P=%.2fhPa H=%.2f%% Gas=%.2fΩ Baseline=%.2fΩ",
			b.temperature, b.pressure, b.humidity, b.gasResistance, b.gasBaseline)
	*/
}

func (b *BME680) run(freq time.Duration) {
	b.running = true
	interval := 2 * time.Second
	if freq > 0 {
		interval = freq
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for b.running {
		<-ticker.C
		b.performMeasurement()
	}
}

// Temperature returns the current temperature in degrees C
func (b *BME680) Temperature() (float64, error) {
	if !b.running {
		return 0, errBME
	}
	return b.temperature, nil
}

// Pressure returns the current pressure in hPa
func (b *BME680) Pressure() (float64, error) {
	if !b.running {
		return 0, errBME
	}
	return b.pressure, nil
}

// Humidity returns the current relative humidity in %
func (b *BME680) Humidity() (float64, error) {
	if !b.running {
		return 0, errBME
	}
	return b.humidity, nil
}

// GasResistance returns the current gas resistance in Ohms
func (b *BME680) GasResistance() (float64, error) {
	if !b.running {
		return 0, errBME
	}
	return b.gasResistance, nil
}

// COIndex returns a heuristic air quality index (0-100)
func (b *BME680) COIndex() (float64, error) {
	if !b.running || b.gasBaseline == 0 {
		return 0, errBME
	}

	ratio := b.gasResistance / b.gasBaseline
	if ratio > 1 {
		ratio = 1
	}

	index := (1 - ratio) * 100
	return index, nil
}

// COppmEstimate returns an estimated CO concentration in ppm (advisory only)
func (b *BME680) COppm() (float64, error) {
	if !b.running || b.gasBaseline == 0 {
		return 0, errBME
	}

	ratio := b.gasResistance / b.gasBaseline
	if ratio <= 0 {
		return 0, nil
	}

	hCorr := 1.0 + 0.01*(b.humidity-50.0)
	coIndex := -10.0 * math.Log(ratio) * hCorr
	if coIndex < 0 {
		coIndex = 0
	}

	return coIndex * 5.0, nil
}

// Close stops the sensor measurements
func (b *BME680) Close() {
	b.running = false
}
