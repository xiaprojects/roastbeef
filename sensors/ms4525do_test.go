/*
	ms4525do_test.go: requirements-style unit tests for the MS4525DO driver
	against a scripted I2C bus. Each test names the behaviour it pins down.
*/

package sensors

import (
	"errors"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/kidoman/embd"
)

// fakeI2C answers ReadBytes with the scripted frames in turn, repeating the
// last one, and rejects every other transaction like a bus with only a
// registerless device on it.
type fakeI2C struct {
	mu     sync.Mutex
	addr   byte
	frames [][]byte
	n      int
}

var errFakeI2C = errors.New("fake i2c: no such device")

func (f *fakeI2C) ReadBytes(addr byte, num int) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if addr != f.addr || len(f.frames) == 0 {
		return []byte{0}, errFakeI2C
	}
	i := f.n
	if i >= len(f.frames) {
		i = len(f.frames) - 1
	}
	f.n++
	out := make([]byte, num)
	copy(out, f.frames[i])
	return out, nil
}

// reads returns how many frames the driver has fetched so far.
func (f *fakeI2C) reads() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.n
}

// script replaces the answers and restarts from the first one.
func (f *fakeI2C) script(frames ...[]byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.frames, f.n = frames, 0
}
func (f *fakeI2C) ReadByte(addr byte) (byte, error)                  { return 0, errFakeI2C }
func (f *fakeI2C) WriteByte(addr, value byte) error                  { return errFakeI2C }
func (f *fakeI2C) WriteBytes(addr byte, value []byte) error          { return errFakeI2C }
func (f *fakeI2C) ReadFromReg(addr, reg byte, value []byte) error    { return errFakeI2C }
func (f *fakeI2C) ReadByteFromReg(addr, reg byte) (byte, error)      { return 0, errFakeI2C }
func (f *fakeI2C) ReadWordFromReg(addr, reg byte) (uint16, error)    { return 0, errFakeI2C }
func (f *fakeI2C) WriteToReg(addr, reg byte, value []byte) error     { return errFakeI2C }
func (f *fakeI2C) WriteByteToReg(addr, reg, value byte) error        { return errFakeI2C }
func (f *fakeI2C) WriteWordToReg(addr, reg byte, value uint16) error { return errFakeI2C }
func (f *fakeI2C) Close() error                                      { return nil }

func newFakeBus(addr byte, frames ...[]byte) *embd.I2CBus {
	var bus embd.I2CBus = &fakeI2C{addr: addr, frames: frames}
	return &bus
}

// ms4525doFrame builds a Read_DF4 answer from status, pressure and
// temperature counts, the inverse of readSample's unpacking.
func ms4525doFrame(status byte, p, t int) []byte {
	return []byte{status<<6 | byte(p>>8&0x3F), byte(p), byte(t >> 3), byte(t&0x07) << 5}
}

// The datasheet transfer functions: mid-scale counts (8192) of the type A
// +-1 psi part read 0 psi within a count, 10 % of counts is -1 psi, 90 % is
// +1 psi; temperature counts 800 read 28.2 C, 0 reads -50 C and 2047 reads
// +150 C. The sign is the datasheet's, port 1 above port 2 positive.
func TestMS4525DOTransferFunction(t *testing.T) {
	m := &MS4525DO{cfg: MS4525DOConfig{Address: MS4525DO_ADDR_I, PMinPSI: -1, PMaxPSI: 1}}
	m.outMin, m.outMax = 0.1*ms4525doCountsMax, 0.9*ms4525doCountsMax
	cases := []struct {
		p, t      int
		pa, tempC float64
	}{
		{8192, 800, 0, 28.16},
		{1638, 0, -ms4525doPsiToPa, -50},
		{14745, 2047, ms4525doPsiToPa, 150},
		{11468, 1024, 0.5 * ms4525doPsiToPa, 50.02},
	}
	for _, c := range cases {
		bus := newFakeBus(MS4525DO_ADDR_I, ms4525doFrame(ms4525doStatusOK, c.p, c.t))
		m.i2c = bus
		pa, temp, status, err := m.readSample()
		if err != nil || status != ms4525doStatusOK {
			t.Fatalf("readSample(%d, %d) status %d err %v", c.p, c.t, status, err)
		}
		if math.Abs(pa-c.pa) > 1.0 || math.Abs(temp-c.tempC) > 0.05 {
			t.Errorf("readSample(%d, %d) = %.2f Pa, %.2f C; want %.2f Pa, %.2f C", c.p, c.t, pa, temp, c.pa, c.tempC)
		}
	}
	// Type B spans 5..95 % of counts: 819 counts is -1 psi there.
	mb := &MS4525DO{cfg: MS4525DOConfig{Address: MS4525DO_ADDR_I, PMinPSI: -1, PMaxPSI: 1, OutputB: true}}
	mb.outMin, mb.outMax = 0.05*ms4525doCountsMax, 0.95*ms4525doCountsMax
	mb.i2c = newFakeBus(MS4525DO_ADDR_I, ms4525doFrame(ms4525doStatusOK, 819, 800))
	if pa, _, _, _ := mb.readSample(); math.Abs(pa+ms4525doPsiToPa) > 1.0 {
		t.Errorf("type B readSample(819) = %.2f Pa; want %.2f", pa, -ms4525doPsiToPa)
	}
}

// NewMS4525DO accepts the part at its address after a fresh sample, whether
// or not the first reads are stale, and applies the +-1 psi / 0x28 defaults.
func TestMS4525DODetect(t *testing.T) {
	fresh := ms4525doFrame(ms4525doStatusOK, 8192, 800)
	stale := ms4525doFrame(ms4525doStatusStale, 8192, 800)
	m, err := NewMS4525DO(newFakeBus(MS4525DO_ADDR_I, stale, stale, fresh), MS4525DOConfig{}, time.Millisecond)
	if err != nil {
		t.Fatalf("NewMS4525DO(stale, stale, fresh) = %v; want a sensor", err)
	}
	defer m.Close()
	if m.Address() != MS4525DO_ADDR_I || m.cfg.PMinPSI != -1 || m.cfg.PMaxPSI != 1 {
		t.Errorf("defaults = 0x%02X %g..%g psi; want 0x28 -1..1", m.Address(), m.cfg.PMinPSI, m.cfg.PMaxPSI)
	}
	time.Sleep(20 * time.Millisecond)
	if pa, err := m.DifferentialPressure(); err != nil || math.Abs(pa) > 1 {
		t.Errorf("DifferentialPressure() = %v, %v; want ~0, nil", pa, err)
	}
	if temp, err := m.Temperature(); err != nil || math.Abs(temp-28.16) > 0.05 {
		t.Errorf("Temperature() = %v, %v; want 28.16, nil", temp, err)
	}
}

// NewMS4525DO rejects: no device at the address; a device that only ever
// answers stale (a BNO055's 0xA0 chip id at 0x28); a fault or command
// status; an all-ones or all-zeros answer; an empty pressure range.
func TestMS4525DODetectRejects(t *testing.T) {
	bno055 := []byte{0xA0, 0xFB, 0x32, 0x0F}
	cases := map[string]*embd.I2CBus{
		"absent":         newFakeBus(0x29, ms4525doFrame(ms4525doStatusOK, 8192, 800)),
		"BNO055 at 0x28": newFakeBus(MS4525DO_ADDR_I, bno055),
		"fault":          newFakeBus(MS4525DO_ADDR_I, ms4525doFrame(ms4525doStatusFault, 8192, 800)),
		"command mode":   newFakeBus(MS4525DO_ADDR_I, ms4525doFrame(ms4525doStatusCommand, 8192, 800)),
		"all ones":       newFakeBus(MS4525DO_ADDR_I, []byte{0xFF, 0xFF, 0xFF, 0xFF}),
		"all zeros":      newFakeBus(MS4525DO_ADDR_I, []byte{0, 0, 0, 0}),
	}
	for name, bus := range cases {
		if m, err := NewMS4525DO(bus, MS4525DOConfig{}, time.Millisecond); err == nil {
			m.Close()
			t.Errorf("NewMS4525DO(%s) accepted the device", name)
		}
	}
	bus := newFakeBus(MS4525DO_ADDR_I, ms4525doFrame(ms4525doStatusOK, 8192, 800))
	if m, err := NewMS4525DO(bus, MS4525DOConfig{PMinPSI: 1, PMaxPSI: 1}, time.Millisecond); err == nil {
		m.Close()
		t.Errorf("NewMS4525DO(empty range) accepted the config")
	}
}

// A running sensor keeps the last measurement through stale answers, then
// reports an error once the data has been stale for ms4525doStaleLimit
// fetches (the ASIC stopped), on a fault, and after Close.
func TestMS4525DOStaleAndFault(t *testing.T) {
	fresh := ms4525doFrame(ms4525doStatusOK, 11468, 800)
	stale := ms4525doFrame(ms4525doStatusStale, 11468, 800)
	bus := newFakeBus(MS4525DO_ADDR_I, fresh, fresh, stale)
	m, err := NewMS4525DO(bus, MS4525DOConfig{}, time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	waitFor := func(cond func() bool) bool {
		for i := 0; i < 200; i++ {
			if cond() {
				return true
			}
			time.Sleep(time.Millisecond)
		}
		return false
	}
	// Second frame is the fresh measurement; a few stale answers keep it.
	f := (*bus).(*fakeI2C)
	if !waitFor(func() bool { return f.reads() >= 5 }) {
		t.Fatal("the run loop did not poll")
	}
	if pa, err := m.DifferentialPressure(); err != nil || math.Abs(pa-0.5*ms4525doPsiToPa) > 1 {
		t.Errorf("DifferentialPressure() after a few stale reads = %v, %v; want the last fresh value", pa, err)
	}
	if !waitFor(func() bool { _, err := m.DifferentialPressure(); return err != nil }) {
		t.Errorf("DifferentialPressure() never failed after %d stale reads", ms4525doStaleLimit)
	}
	if _, err := m.DifferentialPressure(); !errors.Is(err, errMS4525DOStale) {
		t.Errorf("DifferentialPressure() = %v; want %v", err, errMS4525DOStale)
	}

	f.script(ms4525doFrame(ms4525doStatusFault, 11468, 800))
	if !waitFor(func() bool { _, err := m.DifferentialPressure(); return errors.Is(err, errMS4525DOFault) }) {
		t.Errorf("DifferentialPressure() did not report the fault")
	}

	m.Close()
	if _, err := m.DifferentialPressure(); !errors.Is(err, errMS4525DO) {
		t.Errorf("DifferentialPressure() after Close = %v; want %v", err, errMS4525DO)
	}
}
