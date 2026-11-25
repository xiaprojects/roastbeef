package main

import (
	"testing"
	"time"
)

// 9600 baud = 960 B/s: 240 bytes is the full 250 ms backlog.
func TestSerialPacing(t *testing.T) {
	conn := &serialConnection{Baud: 9600, outqFd: -1}
	if conn.IsThrottled() {
		t.Fatal("idle port must not be throttled")
	}
	conn.OnWritten(100) // ~104 ms
	if conn.IsThrottled() {
		t.Fatal("104 ms backlog must not throttle (limit 125 ms)")
	}
	conn.OnWritten(100) // ~208 ms
	if !conn.IsThrottled() {
		t.Fatal("208 ms backlog must throttle")
	}
	conn.OnWritten(192) // ~408 ms total
	start := time.Now()
	conn.WaitForTxRoom()
	waited := time.Since(start)
	if waited < 120*time.Millisecond || waited > 300*time.Millisecond {
		t.Fatalf("expected to wait ~158 ms for the backlog to drop under 250 ms, waited %v", waited)
	}
	if b := conn.backlog(); b > serialMaxBacklog {
		t.Fatalf("backlog %v still above limit", b)
	}
}
