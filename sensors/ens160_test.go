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
	"testing"
	"time"

	"github.com/kidoman/embd"
)

// ens160Bus is a scripted ENS160: a register file at one address. Writing
// OPMODE takes effect unless stuck is set; every other transaction outside
// the register file fails like an empty bus.
type ens160Bus struct {
	addr   byte
	regs   [256]byte
	modes  []byte // values written to OPMODE, in order
	stuck  bool   // OPMODE ignores writes
	failRd bool   // reads fail (the sensor dropped off the bus)
}

func newENS160Bus(addr byte) *ens160Bus {
	b := &ens160Bus{addr: addr}
	b.regs[ens160RegPartID], b.regs[ens160RegPartID+1] = 0x60, 0x01
	return b
}

func (b *ens160Bus) ReadFromReg(addr, reg byte, value []byte) error {
	if addr != b.addr || b.failRd {
		return errFakeI2C
	}
	copy(value, b.regs[int(reg):])
	return nil
}
func (b *ens160Bus) ReadByteFromReg(addr, reg byte) (byte, error) {
	if addr != b.addr || b.failRd {
		return 0, errFakeI2C
	}
	return b.regs[reg], nil
}
func (b *ens160Bus) WriteByteToReg(addr, reg, value byte) error {
	return b.WriteToReg(addr, reg, []byte{value})
}
func (b *ens160Bus) WriteToReg(addr, reg byte, value []byte) error {
	if addr != b.addr {
		return errFakeI2C
	}
	if reg == ens160RegOpMode {
		b.modes = append(b.modes, value[0])
		if b.stuck {
			return nil
		}
	}
	copy(b.regs[int(reg):], value)
	return nil
}
func (b *ens160Bus) ReadByte(addr byte) (byte, error)                  { return 0, errFakeI2C }
func (b *ens160Bus) ReadBytes(addr byte, num int) ([]byte, error)      { return nil, errFakeI2C }
func (b *ens160Bus) WriteByte(addr, value byte) error                  { return errFakeI2C }
func (b *ens160Bus) WriteBytes(addr byte, value []byte) error          { return errFakeI2C }
func (b *ens160Bus) ReadWordFromReg(addr, reg byte) (uint16, error)    { return 0, errFakeI2C }
func (b *ens160Bus) WriteWordToReg(addr, reg byte, value uint16) error { return errFakeI2C }
func (b *ens160Bus) Close() error                                      { return nil }

// sample loads a sample into the status and data registers.
func (b *ens160Bus) sample(status, aqi byte, tvoc, eco2 uint16) {
	b.regs[ens160RegStatus] = status
	copy(b.regs[ens160RegData:], []byte{aqi, byte(tvoc), byte(tvoc >> 8), byte(eco2), byte(eco2 >> 8)})
}

func noENS160Sleep(t *testing.T) {
	saved := ens160Sleep
	ens160Sleep = func(time.Duration) {}
	t.Cleanup(func() { ens160Sleep = saved })
}

func busOf(b embd.I2CBus) *embd.I2CBus { return &b }

// NewENS160 accepts part ID 0x0160, resets the chip and leaves it in
// standard mode.
func TestENS160Detect(t *testing.T) {
	noENS160Sleep(t)
	b := newENS160Bus(ENS160_ADDR_HIGH)
	e, err := NewENS160(busOf(b), ENS160_ADDR_HIGH)
	if err != nil {
		t.Fatalf("NewENS160: %v", err)
	}
	if e.Address() != ENS160_ADDR_HIGH {
		t.Errorf("Address() = 0x%02X", e.Address())
	}
	if string(b.modes) != string([]byte{ens160OpModeReset, ens160OpModeStd}) {
		t.Errorf("OPMODE writes %x; want reset then standard", b.modes)
	}
}

// Detection refuses an empty address, a foreign chip without writing to it
// (the GY-85's ADXL345 answers DEVID 0xE5 at 0x53) and a chip that does not
// enter standard mode.
func TestENS160DetectRejects(t *testing.T) {
	noENS160Sleep(t)
	if _, err := NewENS160(busOf(newENS160Bus(ENS160_ADDR_HIGH)), ENS160_ADDR_LOW); err == nil {
		t.Error("NewENS160 on an empty address succeeded")
	}
	adxl := newENS160Bus(ENS160_ADDR_HIGH)
	adxl.regs[0], adxl.regs[1] = 0xE5, 0x00
	if _, err := NewENS160(busOf(adxl), ENS160_ADDR_HIGH); err == nil {
		t.Error("ADXL345 taken for an ENS160")
	}
	if len(adxl.modes) != 0 {
		t.Errorf("wrote %x to a foreign chip", adxl.modes)
	}
	stuck := newENS160Bus(ENS160_ADDR_HIGH)
	stuck.stuck = true
	if _, err := NewENS160(busOf(stuck), ENS160_ADDR_HIGH); err == nil {
		t.Error("NewENS160 accepted a chip stuck out of standard mode")
	}
}

// Read unpacks the little-endian data registers and the status fields.
func TestENS160Read(t *testing.T) {
	noENS160Sleep(t)
	b := newENS160Bus(ENS160_ADDR_HIGH)
	e, err := NewENS160(busOf(b), ENS160_ADDR_HIGH)
	if err != nil {
		t.Fatal(err)
	}

	// Registers still zero: no sample yet, not an error.
	if r, err := e.Read(); err != nil || r.New {
		t.Errorf("before the first sample: %+v, %v; want not new, nil", r, err)
	}

	b.sample(0x80|byte(ENS160WarmUp)<<2|ens160StatusNewDat, 2, 0x0123, 0x0258)
	r, err := e.Read()
	if err != nil {
		t.Fatal(err)
	}
	want := ENS160Reading{AQI: 2, TVOC: 0x0123, ECO2: 600, Validity: ENS160WarmUp, New: true}
	if r != want {
		t.Errorf("Read() = %+v; want %+v", r, want)
	}
	if r.Validity.String() != "warm-up" || ENS160Normal.String() != "normal" || ENS160NoOutput.String() != "invalid" {
		t.Errorf("validity names: %q %q %q", r.Validity, ENS160Normal, ENS160NoOutput)
	}

	b.sample(0x80, 2, 0x0123, 600)
	if r, _ := e.Read(); r.New {
		t.Error("NEWDAT clear but the reading is new")
	}

	b.sample(0x80|ens160StatusNewDat, 7, 10, 600)
	if _, err := e.Read(); err != errENS160Range {
		t.Errorf("AQI 7: err %v; want %v", err, errENS160Range)
	}
	b.sample(0x80|ens160StatusNewDat, 1, 10, 300)
	if _, err := e.Read(); err != errENS160Range {
		t.Errorf("eCO2 300: err %v; want %v", err, errENS160Range)
	}
	b.sample(ens160StatusError, 1, 10, 400)
	if _, err := e.Read(); err != errENS160Mode {
		t.Errorf("STATER: err %v; want %v", err, errENS160Mode)
	}
	b.failRd = true
	if _, err := e.Read(); err == nil {
		t.Error("Read on a dead bus succeeded")
	}
}

// SetCompensation writes Kelvin * 64 and %RH * 512, little endian, clamped.
func TestENS160Compensation(t *testing.T) {
	noENS160Sleep(t)
	b := newENS160Bus(ENS160_ADDR_HIGH)
	e, err := NewENS160(busOf(b), ENS160_ADDR_HIGH)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		temp, rh float64
		t, h     uint16
	}{
		{25, 50, 19082, 25600},  // 298.15 K * 64 = 19081.6
		{-20, 0, 16202, 0},      // 253.15 K * 64 = 16201.6
		{40, 150, 20042, 51200}, // RH clamped to 100 %
	}
	for _, c := range cases {
		if err := e.SetCompensation(c.temp, c.rh); err != nil {
			t.Fatal(err)
		}
		r := b.regs[ens160RegTempIn:]
		gt, gh := uint16(r[0])|uint16(r[1])<<8, uint16(r[2])|uint16(r[3])<<8
		if gt != c.t || gh != c.h {
			t.Errorf("SetCompensation(%g, %g) wrote T %d RH %d; want %d %d", c.temp, c.rh, gt, gh, c.t, c.h)
		}
	}
	e.Close()
	if b.regs[ens160RegOpMode] != 0x00 {
		t.Errorf("Close left OPMODE 0x%02X; want deep sleep", b.regs[ens160RegOpMode])
	}
}
