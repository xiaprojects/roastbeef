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

// MS4525DO is the TE Connectivity (Measurement Specialties) digital pressure
// sensor: I2C, 14 bit pressure and 11 bit temperature, converting
// continuously. The +-1 psi differential part (MS4525DO-DS5AI001DP) is the
// pitot-static airspeed sensor of the Pixhawk-class pitot kits: one port to
// the pitot, the other to static. It has no registers: a plain 4 byte read
// (the datasheet's Read_DF4) returns
//
//	byte 0  S1 S0 P13..P8   status, pressure MSB
//	byte 1  P7..P0          pressure LSB
//	byte 2  T10..T3         temperature MSB
//	byte 3  T2..T0 x x x x x
//
// with the pressure counts spanning PMin..PMax over 10..90 % of 2^14 (output
// type A; 5..95 % for type B) and the temperature counts -50..+150 C.
type MS4525DO struct {
	i2c    *embd.I2CBus
	cfg    MS4525DOConfig
	outMin float64 // counts at PMinPSI
	outMax float64 // counts at PMaxPSI

	mu          sync.Mutex
	pressure    float64 // Pa, last fresh measurement
	temperature float64 // degrees C, last fresh measurement
	staleCount  int     // consecutive fetches the sensor reported stale
	err         error   // why the last fetch gave no measurement, nil if it did
	running     bool
}

// MS4525DO I2C addresses, one per interface type (the letter after the output
// type in the part number: I, J, K, then 0..9 at 0x48..0x51). Type I is the
// airspeed part sold with pitot kits.
const (
	MS4525DO_ADDR_I = 0x28
	MS4525DO_ADDR_J = 0x36
	MS4525DO_ADDR_K = 0x46
)

// Status, bits 7:6 of the first byte of a reading.
const (
	ms4525doStatusOK      = 0 // fresh measurement
	ms4525doStatusCommand = 1 // reserved (command mode)
	ms4525doStatusStale   = 2 // already fetched since the last measurement
	ms4525doStatusFault   = 3 // diagnostic fault
)

const (
	ms4525doCountsMax     = 16383.0 // 14 bit pressure output
	ms4525doTempCountsMax = 2047.0  // 11 bit temperature output
	ms4525doPsiToPa       = 6894.757
	// The sensor converts continuously (about 1 kHz), so a measurement still
	// reported stale after this many consecutive fetches means the ASIC has
	// stopped and the last value must not be trusted.
	ms4525doStaleLimit = 20
	// Detection: the part is accepted only once it has produced a fresh
	// sample within this many reads, so a foreign device at the same
	// address that answers a plain read with constant bytes (a BNO055 at
	// 0x28 reads 0xA0, "stale", forever) is not taken for a pitot sensor.
	ms4525doDetectReads = 5
)

var (
	errMS4525DO        = errors.New("MS4525DO Error: MS4525DO is not running")
	errMS4525DOFault   = errors.New("MS4525DO Error: sensor reports a fault")
	errMS4525DOCommand = errors.New("MS4525DO Error: sensor is in command mode")
	errMS4525DOStale   = errors.New("MS4525DO Error: sensor stopped measuring (stale data)")
)

// MS4525DOConfig selects the part variant. The zero value reads as the
// +-1 psi, output type A, interface I part (MS4525DO-DS5AI001DP).
type MS4525DOConfig struct {
	Address byte    // I2C address of the interface type; 0 = MS4525DO_ADDR_I
	PMinPSI float64 // pressure range printed on the part; both 0 = -1..+1 psi
	PMaxPSI float64
	OutputB bool // output type B (5..95 % of counts) instead of A (10..90 %)
}

func (c *MS4525DOConfig) applyDefaults() error {
	if c.Address == 0 {
		c.Address = MS4525DO_ADDR_I
	}
	if c.PMinPSI == 0 && c.PMaxPSI == 0 {
		c.PMinPSI, c.PMaxPSI = -1, 1
	}
	if c.PMaxPSI <= c.PMinPSI {
		return fmt.Errorf("MS4525DOConfig: pressure range %g..%g psi is empty", c.PMinPSI, c.PMaxPSI)
	}
	return nil
}

// NewMS4525DO looks for an MS4525DO at the configured address, checks it
// answers like one and begins reading it every freq.
func NewMS4525DO(i2cbus *embd.I2CBus, cfg MS4525DOConfig, freq time.Duration) (*MS4525DO, error) {
	if err := cfg.applyDefaults(); err != nil {
		return nil, err
	}
	m := &MS4525DO{i2c: i2cbus, cfg: cfg}
	if cfg.OutputB {
		m.outMin, m.outMax = 0.05*ms4525doCountsMax, 0.95*ms4525doCountsMax
	} else {
		m.outMin, m.outMax = 0.1*ms4525doCountsMax, 0.9*ms4525doCountsMax
	}

	fresh := false
	for i := 0; i < ms4525doDetectReads && !fresh; i++ {
		if i > 0 {
			time.Sleep(2 * time.Millisecond)
		}
		pa, temp, status, err := m.readSample()
		if err != nil {
			return nil, fmt.Errorf("MS4525DO not found at 0x%02X: %w", cfg.Address, err)
		}
		if status == ms4525doStatusFault || status == ms4525doStatusCommand {
			return nil, fmt.Errorf("MS4525DO at 0x%02X: unexpected status %d", cfg.Address, status)
		}
		// Well inside the -50..+150 C output range: the pressure alone does
		// not tell a pitot sensor from a device that answers anything.
		if temp < -40 || temp > 125 {
			return nil, fmt.Errorf("MS4525DO at 0x%02X: implausible temperature %.0f C", cfg.Address, temp)
		}
		if pa < m.cfg.PMinPSI*ms4525doPsiToPa || pa > m.cfg.PMaxPSI*ms4525doPsiToPa {
			return nil, fmt.Errorf("MS4525DO at 0x%02X: pressure %.0f Pa outside the part's range", cfg.Address, pa)
		}
		fresh = status == ms4525doStatusOK
	}
	if !fresh {
		return nil, fmt.Errorf("MS4525DO at 0x%02X: no fresh measurement in %d reads", cfg.Address, ms4525doDetectReads)
	}

	if freq <= 0 {
		freq = 50 * time.Millisecond
	}
	m.running = true
	go m.run(freq)
	return m, nil
}

// Address returns the I2C address the sensor was found at.
func (m *MS4525DO) Address() byte {
	return m.cfg.Address
}

// readSample fetches one reading (Read_DF4) and converts it with the
// datasheet transfer functions. The sign is the datasheet's: positive when
// port 1 is above port 2.
func (m *MS4525DO) readSample() (pa, temp float64, status byte, err error) {
	data, err := (*m.i2c).ReadBytes(m.cfg.Address, 4)
	if err != nil {
		return 0, 0, 0, err
	}
	if len(data) != 4 {
		return 0, 0, 0, fmt.Errorf("MS4525DO: short read of %d bytes", len(data))
	}
	status = data[0] >> 6
	pCounts := float64(int(data[0]&0x3F)<<8 | int(data[1]))
	tCounts := float64(int(data[2])<<3 | int(data[3])>>5)
	psi := (pCounts-m.outMin)*(m.cfg.PMaxPSI-m.cfg.PMinPSI)/(m.outMax-m.outMin) + m.cfg.PMinPSI
	pa = psi * ms4525doPsiToPa
	temp = tCounts*200/ms4525doTempCountsMax - 50
	return pa, temp, status, nil
}

func (m *MS4525DO) run(freq time.Duration) {
	ticker := time.NewTicker(freq)
	defer ticker.Stop()
	for m.isRunning() {
		<-ticker.C
		pa, temp, status, err := m.readSample()
		m.mu.Lock()
		switch {
		case err != nil:
			m.err = err
		case status == ms4525doStatusFault:
			m.err = errMS4525DOFault
		case status == ms4525doStatusCommand:
			m.err = errMS4525DOCommand
		case status == ms4525doStatusStale:
			// The same measurement as last time: keep it, unless it never
			// changes.
			m.staleCount++
			if m.staleCount >= ms4525doStaleLimit {
				m.err = errMS4525DOStale
			}
		default:
			m.staleCount = 0
			m.err = nil
			m.pressure = pa
			m.temperature = temp
		}
		m.mu.Unlock()
	}
}

func (m *MS4525DO) isRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

// DifferentialPressure returns the last pressure measured across the two
// ports in Pa, or the error that stands in the way of one.
func (m *MS4525DO) DifferentialPressure() (float64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.running {
		return 0, errMS4525DO
	}
	if m.err != nil {
		return 0, m.err
	}
	return m.pressure, nil
}

// Temperature returns the last temperature measured by the sensor in
// degrees C.
func (m *MS4525DO) Temperature() (float64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.running {
		return 0, errMS4525DO
	}
	if m.err != nil {
		return 0, m.err
	}
	return m.temperature, nil
}

// Close stops the measurements of the MS4525DO.
func (m *MS4525DO) Close() {
	m.mu.Lock()
	m.running = false
	m.mu.Unlock()
}
