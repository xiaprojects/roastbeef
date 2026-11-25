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
	"sync"
	"time"

	"github.com/kidoman/embd"
)

// AHT20 is the Aosong (ASAIR) digital temperature and relative humidity
// sensor: I2C at the fixed address 0x38, 20 bit humidity and 20 bit
// temperature, +-2 %RH and +-0.3 C typical. It is sold alone and on the
// common "AHT20 + BMP280" breakout, where it adds the humidity the BMP280
// lacks. The AHT21 and AHT25 speak the same protocol.
//
// It has no register map. A measurement is triggered by the 3 byte command
// 0xAC 0x33 0x00 and read back after at least 80 ms as 7 bytes:
//
//	byte 0  status: bit 7 busy, bit 3 calibrated
//	byte 1  H19..H12
//	byte 2  H11..H4
//	byte 3  H3..H0 T19..T16
//	byte 4  T15..T8
//	byte 5  T7..T0
//	byte 6  CRC-8 (poly 0x31, init 0xFF) of bytes 0..5
//
// with RH = H / 2^20 * 100 % and T = T / 2^20 * 200 - 50 C. The older AHT10
// answers at the same address without the CRC byte and is not accepted.
type AHT20 struct {
	i2c *embd.I2CBus

	mu          sync.Mutex
	humidity    float64 // %RH, last good measurement
	temperature float64 // degrees C, last good measurement
	err         error   // why the last measurement failed, nil if it did not
	running     bool
}

// AHT20_ADDR is the only I2C address of the AHT20.
const AHT20_ADDR = 0x38

const (
	aht20CmdMeasure   = 0xAC
	aht20CmdCalibrate = 0xBE
	aht20StatusBusy   = 0x80
	aht20StatusCal    = 0x08
	aht20Full         = 1 << 20
	// The datasheet's minimum wait between the trigger and the read.
	aht20MeasureTime = 80 * time.Millisecond
	// Self-heating: the datasheet keeps the duty cycle under 10 % (one
	// measurement every 2 s or slower) to hold it below 0.1 C.
	aht20MinPeriod = 2 * time.Second
)

var (
	errAHT20     = errors.New("AHT20 Error: AHT20 is not running")
	errAHT20Busy = errors.New("AHT20 Error: measurement not ready")
	errAHT20CRC  = errors.New("AHT20 Error: CRC mismatch")
)

// aht20Sleep is time.Sleep, replaced by the tests.
var aht20Sleep = time.Sleep

// NewAHT20 looks for an AHT20 at 0x38, calibrates it if it reports it is
// not, takes one measurement to prove it is an AHT20 (a valid CRC and
// plausible values: a touch controller such as the FT6236 also lives at
// 0x38) and begins measuring every freq, at least every 2 s.
func NewAHT20(i2cbus *embd.I2CBus, freq time.Duration) (*AHT20, error) {
	a := &AHT20{i2c: i2cbus}
	status, err := (*i2cbus).ReadByte(AHT20_ADDR)
	if err != nil {
		return nil, fmt.Errorf("AHT20 not found at 0x%02X: %w", AHT20_ADDR, err)
	}
	if status&aht20StatusCal == 0 {
		if err := (*i2cbus).WriteBytes(AHT20_ADDR, []byte{aht20CmdCalibrate, 0x08, 0x00}); err != nil {
			return nil, fmt.Errorf("AHT20 at 0x%02X: calibration command: %w", AHT20_ADDR, err)
		}
		aht20Sleep(10 * time.Millisecond)
	}
	hum, temp, err := a.measure()
	if err != nil {
		return nil, fmt.Errorf("AHT20 at 0x%02X: %w", AHT20_ADDR, err)
	}
	if temp < -40 || temp > 85 {
		return nil, fmt.Errorf("AHT20 at 0x%02X: implausible temperature %.0f C", AHT20_ADDR, temp)
	}
	a.humidity, a.temperature = hum, temp

	if freq < aht20MinPeriod {
		freq = aht20MinPeriod
	}
	a.running = true
	go a.run(freq)
	return a, nil
}

// measure triggers one measurement, waits for it and converts it.
func (a *AHT20) measure() (hum, temp float64, err error) {
	if err := (*a.i2c).WriteBytes(AHT20_ADDR, []byte{aht20CmdMeasure, 0x33, 0x00}); err != nil {
		return 0, 0, err
	}
	aht20Sleep(aht20MeasureTime)
	data, err := (*a.i2c).ReadBytes(AHT20_ADDR, 7)
	if err != nil {
		return 0, 0, err
	}
	return aht20Decode(data)
}

// aht20Decode checks a 7 byte answer and applies the datasheet conversions.
func aht20Decode(data []byte) (hum, temp float64, err error) {
	if len(data) != 7 {
		return 0, 0, fmt.Errorf("AHT20: short read of %d bytes", len(data))
	}
	if aht20CRC(data[:6]) != data[6] {
		return 0, 0, errAHT20CRC
	}
	if data[0]&aht20StatusBusy != 0 {
		return 0, 0, errAHT20Busy
	}
	h := uint32(data[1])<<12 | uint32(data[2])<<4 | uint32(data[3])>>4
	t := uint32(data[3]&0x0F)<<16 | uint32(data[4])<<8 | uint32(data[5])
	hum = float64(h) * 100 / aht20Full
	temp = float64(t)*200/aht20Full - 50
	return hum, temp, nil
}

// aht20CRC is the sensor's CRC-8: polynomial x^8 + x^5 + x^4 + 1 (0x31),
// initial value 0xFF, no reflection, no final XOR.
func aht20CRC(data []byte) byte {
	crc := byte(0xFF)
	for _, b := range data {
		crc ^= b
		for i := 0; i < 8; i++ {
			if crc&0x80 != 0 {
				crc = crc<<1 ^ 0x31
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

func (a *AHT20) run(freq time.Duration) {
	ticker := time.NewTicker(freq)
	defer ticker.Stop()
	for a.isRunning() {
		<-ticker.C
		hum, temp, err := a.measure()
		a.mu.Lock()
		a.err = err
		if err == nil {
			a.humidity, a.temperature = hum, temp
		}
		a.mu.Unlock()
	}
}

func (a *AHT20) isRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}

// Humidity returns the last relative humidity measured, in %.
func (a *AHT20) Humidity() (float64, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.running {
		return 0, errAHT20
	}
	if a.err != nil {
		return 0, a.err
	}
	return a.humidity, nil
}

// Temperature returns the last temperature measured, in degrees C.
func (a *AHT20) Temperature() (float64, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.running {
		return 0, errAHT20
	}
	if a.err != nil {
		return 0, a.err
	}
	return a.temperature, nil
}

// Close stops the measurements of the AHT20.
func (a *AHT20) Close() {
	a.mu.Lock()
	a.running = false
	a.mu.Unlock()
}
