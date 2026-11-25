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
	"math"
	"sync"
	"testing"
	"time"

	"github.com/kidoman/embd"
)

// aht20Bus is a scripted AHT20 at 0x38: ReadByte answers the status byte,
// writes are recorded, and each 7 byte read hands out the next frame,
// repeating the last one.
type aht20Bus struct {
	mu     sync.Mutex
	status byte
	frames [][]byte
	n      int
	writes [][]byte
}

func (b *aht20Bus) ReadByte(addr byte) (byte, error) {
	if addr != AHT20_ADDR {
		return 0, errFakeI2C
	}
	return b.status, nil
}
func (b *aht20Bus) WriteBytes(addr byte, value []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if addr != AHT20_ADDR {
		return errFakeI2C
	}
	b.writes = append(b.writes, append([]byte(nil), value...))
	return nil
}
func (b *aht20Bus) ReadBytes(addr byte, num int) ([]byte, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if addr != AHT20_ADDR || len(b.frames) == 0 {
		return nil, errFakeI2C
	}
	i := b.n
	if i >= len(b.frames) {
		i = len(b.frames) - 1
	}
	b.n++
	out := make([]byte, num)
	copy(out, b.frames[i])
	return out, nil
}
func (b *aht20Bus) WriteByte(addr, value byte) error                  { return errFakeI2C }
func (b *aht20Bus) ReadFromReg(addr, reg byte, value []byte) error    { return errFakeI2C }
func (b *aht20Bus) ReadByteFromReg(addr, reg byte) (byte, error)      { return 0, errFakeI2C }
func (b *aht20Bus) ReadWordFromReg(addr, reg byte) (uint16, error)    { return 0, errFakeI2C }
func (b *aht20Bus) WriteToReg(addr, reg byte, value []byte) error     { return errFakeI2C }
func (b *aht20Bus) WriteByteToReg(addr, reg, value byte) error        { return errFakeI2C }
func (b *aht20Bus) WriteWordToReg(addr, reg byte, value uint16) error { return errFakeI2C }
func (b *aht20Bus) Close() error                                      { return nil }

// aht20Frame builds a measurement answer from status and raw counts, the
// inverse of aht20Decode, with a correct CRC.
func aht20Frame(status byte, h, t uint32) []byte {
	f := []byte{status, byte(h >> 12), byte(h >> 4), byte(h<<4) | byte(t>>16&0x0F), byte(t >> 8), byte(t)}
	return append(f, aht20CRC(f))
}

func noAHT20Sleep(t *testing.T) {
	saved := aht20Sleep
	aht20Sleep = func(time.Duration) {}
	t.Cleanup(func() { aht20Sleep = saved })
}

// CRC-8 with polynomial 0x31 and init 0xFF is the catalogued CRC-8/NRSC-5:
// its check value over "123456789" is 0xF7.
func TestAHT20CRC(t *testing.T) {
	if got := aht20CRC([]byte("123456789")); got != 0xF7 {
		t.Errorf("aht20CRC(123456789) = 0x%02X; want 0xF7", got)
	}
}

// The datasheet conversions: half scale is 50 %RH and 50 C, zero counts
// read 0 %RH and -50 C, full scale 100 %RH and 150 C.
func TestAHT20Decode(t *testing.T) {
	cases := []struct {
		h, t      uint32
		hum, temp float64
	}{
		{1 << 19, 1 << 19, 50, 50},
		{0, 0, 0, -50},
		{aht20Full - 1, aht20Full - 1, 100, 150},
		{0x6B851, 0x5C28F, 42.0, 21.99}, // a cabin on the ground
	}
	for _, c := range cases {
		hum, temp, err := aht20Decode(aht20Frame(0x18, c.h, c.t))
		if err != nil {
			t.Fatalf("aht20Decode(%#x, %#x): %v", c.h, c.t, err)
		}
		if math.Abs(hum-c.hum) > 0.01 || math.Abs(temp-c.temp) > 0.01 {
			t.Errorf("aht20Decode(%#x, %#x) = %.3f %%, %.3f C; want %.3f %%, %.3f C", c.h, c.t, hum, temp, c.hum, c.temp)
		}
	}
	bad := aht20Frame(0x18, 1<<19, 1<<19)
	bad[6] ^= 1
	if _, _, err := aht20Decode(bad); err != errAHT20CRC {
		t.Errorf("corrupted CRC: err %v; want %v", err, errAHT20CRC)
	}
	if _, _, err := aht20Decode(aht20Frame(0x98, 1<<19, 1<<19)); err != errAHT20Busy {
		t.Errorf("busy status: err %v; want %v", err, errAHT20Busy)
	}
	if _, _, err := aht20Decode([]byte{0x18, 0, 0, 0, 0, 0}); err == nil {
		t.Error("6 byte AHT10-style answer accepted")
	}
}

// NewAHT20 triggers a measurement, accepts a valid answer and reports it;
// it sends the calibration command only when the status says uncalibrated.
func TestAHT20Detect(t *testing.T) {
	noAHT20Sleep(t)
	for _, calibrated := range []bool{true, false} {
		b := &aht20Bus{status: 0x18, frames: [][]byte{aht20Frame(0x18, 1<<19, 0x5C28F)}}
		if !calibrated {
			b.status = 0x10
		}
		var bus embd.I2CBus = b
		a, err := NewAHT20(&bus, time.Hour)
		if err != nil {
			t.Fatalf("calibrated=%v: NewAHT20: %v", calibrated, err)
		}
		hum, herr := a.Humidity()
		temp, terr := a.Temperature()
		a.Close()
		if herr != nil || terr != nil || math.Abs(hum-50) > 0.01 || math.Abs(temp-21.99) > 0.01 {
			t.Errorf("calibrated=%v: %.2f %% (%v), %.2f C (%v); want 50 %%, 21.99 C", calibrated, hum, herr, temp, terr)
		}
		want := [][]byte{{aht20CmdMeasure, 0x33, 0x00}}
		if !calibrated {
			want = append([][]byte{{aht20CmdCalibrate, 0x08, 0x00}}, want...)
		}
		if len(b.writes) != len(want) {
			t.Fatalf("calibrated=%v: writes %x; want %x", calibrated, b.writes, want)
		}
		for i := range want {
			if string(b.writes[i]) != string(want[i]) {
				t.Errorf("calibrated=%v: write %d = %x; want %x", calibrated, i, b.writes[i], want[i])
			}
		}
	}
}

// Detection refuses an empty address, a device whose answer fails the CRC
// (a touch controller at 0x38) and an implausible temperature.
func TestAHT20DetectRejects(t *testing.T) {
	noAHT20Sleep(t)
	var empty embd.I2CBus = &fakeI2C{addr: 0x28}
	if _, err := NewAHT20(&empty, 0); err == nil {
		t.Error("NewAHT20 on an empty bus succeeded")
	}
	junk := []byte{0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66}
	cold := aht20Frame(0x18, 1<<19, 0) // -50 C
	for name, frame := range map[string][]byte{"bad CRC": junk, "-50 C": cold} {
		var bus embd.I2CBus = &aht20Bus{status: 0x18, frames: [][]byte{frame}}
		if a, err := NewAHT20(&bus, 0); err == nil {
			a.Close()
			t.Errorf("%s: NewAHT20 succeeded", name)
		}
	}
}

// A failed measurement after detection is reported by both readers, and the
// next good one clears it; Close stops the readers.
func TestAHT20RunErrors(t *testing.T) {
	noAHT20Sleep(t)
	good := aht20Frame(0x18, 1<<19, 1<<19)
	b := &aht20Bus{status: 0x18, frames: [][]byte{good}}
	var bus embd.I2CBus = b
	a, err := NewAHT20(&bus, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	b.mu.Lock()
	b.frames, b.n = [][]byte{aht20Frame(0x98, 0, 0)}, 0
	b.mu.Unlock()
	h, temp, err := a.measure()
	a.mu.Lock()
	a.err = err
	a.mu.Unlock()
	if _, herr := a.Humidity(); herr != errAHT20Busy {
		t.Errorf("busy: Humidity err %v (h %.1f t %.1f); want %v", herr, h, temp, errAHT20Busy)
	}

	a.mu.Lock()
	a.err = nil
	a.mu.Unlock()
	if hum, err := a.Humidity(); err != nil || math.Abs(hum-50) > 0.01 {
		t.Errorf("recovered: Humidity = %.2f, %v; want 50, nil", hum, err)
	}
	a.Close()
	if _, err := a.Humidity(); err != errAHT20 {
		t.Errorf("closed: Humidity err %v; want %v", err, errAHT20)
	}
}
