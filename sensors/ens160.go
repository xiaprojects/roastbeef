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
	"math"
	"time"

	"github.com/kidoman/embd"
)

// ENS160 is the ScioSense digital metal-oxide multi-gas sensor: I2C at 0x53
// (ADDR pin high, most breakouts) or 0x52, four heated MOX elements and an
// on-chip algorithm that outputs, once a second in standard mode,
//
//	AQI   air quality index 1..5 (German UBA scale: 1 excellent, 5 unhealthy)
//	TVOC  total volatile organic compounds, ppb
//	eCO2  equivalent CO2, ppm (400..65000), estimated from the VOCs
//
// It does not measure CO or CO2: eCO2 tracks human presence in a closed
// room, not combustion gases, so it is no carbon monoxide detector.
//
// Its readings drift with temperature and humidity; the host writes the
// ambient values to TEMP_IN / RH_IN (SetCompensation), typically from the
// AHT21 sold on the same "ENS160 + AHT21" breakout. Without them the chip
// assumes 25 C and 50 %RH.
type ENS160 struct {
	i2c  *embd.I2CBus
	addr byte
}

// ENS160 I2C addresses.
const (
	ENS160_ADDR_HIGH = 0x53 // ADDR pin high, the breakouts' default
	ENS160_ADDR_LOW  = 0x52
)

// Registers and values from the ENS160 datasheet (SC-001224-DS).
const (
	ens160RegPartID    = 0x00 // 2 bytes, little endian
	ens160RegOpMode    = 0x10
	ens160RegTempIn    = 0x13 // 2 bytes LE, Kelvin * 64; RH_IN follows at 0x15
	ens160RegStatus    = 0x20
	ens160RegData      = 0x21 // AQI, then TVOC (2 bytes LE) and eCO2 (2 bytes LE)
	ens160PartID       = 0x0160
	ens160OpModeReset  = 0xF0
	ens160OpModeStd    = 0x02
	ens160StatusError  = 0x40 // STATER: invalid operating mode
	ens160StatusNewDat = 0x02 // NEWDAT: new data in the data registers
	ens160ResetTime    = 10 * time.Millisecond
)

// ENS160Validity is the VALIDITY field of DEVICE_STATUS.
type ENS160Validity uint8

const (
	ENS160Normal   ENS160Validity = 0 // readings are good
	ENS160WarmUp   ENS160Validity = 1 // first 3 minutes after power-on
	ENS160StartUp  ENS160Validity = 2 // first hour of the sensor's very first operation
	ENS160NoOutput ENS160Validity = 3 // no valid output
)

// String names the validity for the JSON situation.
func (v ENS160Validity) String() string {
	switch v {
	case ENS160Normal:
		return "normal"
	case ENS160WarmUp:
		return "warm-up"
	case ENS160StartUp:
		return "start-up"
	}
	return "invalid"
}

// ENS160Reading is one output of the on-chip algorithm.
type ENS160Reading struct {
	AQI      uint8 // 1..5
	TVOC     uint16
	ECO2     uint16
	Validity ENS160Validity
	New      bool // the chip produced it since the previous Read
}

var (
	errENS160Mode  = errors.New("ENS160 Error: sensor reports an invalid operating mode")
	errENS160Range = errors.New("ENS160 Error: reading outside the sensor's output range")
)

// ens160Sleep is time.Sleep, replaced by the tests.
var ens160Sleep = time.Sleep

// NewENS160 looks for an ENS160 at addr by its part ID (so the ADXL345 a
// GY-85 puts at 0x53 is left alone: nothing is written before the ID
// matches), resets it and starts standard gas sensing.
func NewENS160(i2cbus *embd.I2CBus, addr byte) (*ENS160, error) {
	e := &ENS160{i2c: i2cbus, addr: addr}
	id := make([]byte, 2)
	if err := (*i2cbus).ReadFromReg(addr, ens160RegPartID, id); err != nil {
		return nil, fmt.Errorf("ENS160 not found at 0x%02X: %w", addr, err)
	}
	if got := uint16(id[0]) | uint16(id[1])<<8; got != ens160PartID {
		return nil, fmt.Errorf("ENS160 not found at 0x%02X: part ID 0x%04X", addr, got)
	}
	if err := (*i2cbus).WriteByteToReg(addr, ens160RegOpMode, ens160OpModeReset); err != nil {
		return nil, fmt.Errorf("ENS160 at 0x%02X: reset: %w", addr, err)
	}
	ens160Sleep(ens160ResetTime)
	if err := (*i2cbus).WriteByteToReg(addr, ens160RegOpMode, ens160OpModeStd); err != nil {
		return nil, fmt.Errorf("ENS160 at 0x%02X: standard mode: %w", addr, err)
	}
	ens160Sleep(ens160ResetTime)
	mode, err := (*i2cbus).ReadByteFromReg(addr, ens160RegOpMode)
	if err != nil {
		return nil, fmt.Errorf("ENS160 at 0x%02X: %w", addr, err)
	}
	if mode != ens160OpModeStd {
		return nil, fmt.Errorf("ENS160 at 0x%02X: operating mode 0x%02X after start", addr, mode)
	}
	return e, nil
}

// Address returns the I2C address the sensor was found at.
func (e *ENS160) Address() byte {
	return e.addr
}

// SetCompensation writes the ambient temperature (degrees C) and relative
// humidity (%) the gas algorithm corrects for.
func (e *ENS160) SetCompensation(tempC, rh float64) error {
	t := uint16(math.Round(math.Max(0, math.Min(tempC+273.15, 1023)) * 64))
	h := uint16(math.Round(math.Max(0, math.Min(rh, 100)) * 512))
	return (*e.i2c).WriteToReg(e.addr, ens160RegTempIn, []byte{byte(t), byte(t >> 8), byte(h), byte(h >> 8)})
}

// Read returns the latest output of the sensor. New is false when the chip
// has not produced a sample since the previous Read: the data registers
// then still hold the previous one.
func (e *ENS160) Read() (ENS160Reading, error) {
	status, err := (*e.i2c).ReadByteFromReg(e.addr, ens160RegStatus)
	if err != nil {
		return ENS160Reading{}, err
	}
	if status&ens160StatusError != 0 {
		return ENS160Reading{}, errENS160Mode
	}
	data := make([]byte, 5)
	if err := (*e.i2c).ReadFromReg(e.addr, ens160RegData, data); err != nil {
		return ENS160Reading{}, err
	}
	return ens160Decode(status, data)
}

// ens160Decode unpacks DEVICE_STATUS and the 5 data bytes.
func ens160Decode(status byte, data []byte) (ENS160Reading, error) {
	r := ENS160Reading{
		AQI:      data[0] & 0x07,
		TVOC:     uint16(data[1]) | uint16(data[2])<<8,
		ECO2:     uint16(data[3]) | uint16(data[4])<<8,
		Validity: ENS160Validity(status >> 2 & 0x03),
		New:      status&ens160StatusNewDat != 0,
	}
	// Before the first sample the registers read 0: nothing to hand out
	// yet. Afterwards the AQI is 1..5 and eCO2 never below 400 ppm.
	if r.AQI == 0 && r.TVOC == 0 && r.ECO2 == 0 {
		r.New = false
		return r, nil
	}
	if r.Validity != ENS160NoOutput && (r.AQI < 1 || r.AQI > 5 || r.ECO2 < 400) {
		return r, errENS160Range
	}
	return r, nil
}

// Close puts the sensor back to deep sleep; the heaters draw about 30 mW.
func (e *ENS160) Close() {
	_ = (*e.i2c).WriteByteToReg(e.addr, ens160RegOpMode, 0x00)
}
