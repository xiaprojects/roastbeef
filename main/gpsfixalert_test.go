/*
	gpsfixalert_test.go: the danger alert raised when the GPS fix drops to zero
	(main/gpsfixalert.go).
*/

package main

import (
	"testing"
	"time"
)

func withGPSFixAlert(t *testing.T) {
	withAlerts(t)
	saved := gpsFixAlert
	t.Cleanup(func() { gpsFixAlert = saved })
	gpsFixAlert = GPSFixAlert{}
}

func TestGPSFixLostRaisesOneDangerAlertAndClosesIt(t *testing.T) {
	withGPSFixAlert(t)
	start := time.Now()
	gpsFixAlert.check(true, start)
	gpsFixAlert.check(false, start.Add(time.Second))
	if got := queued(); len(got) != 0 {
		t.Fatalf("raised before GPS_FIX_LOST_DELAY: %v", got)
	}

	gpsFixAlert.check(false, start.Add(GPS_FIX_LOST_DELAY))
	time.Sleep(5 * time.Millisecond)
	gpsFixAlert.check(false, start.Add(GPS_FIX_LOST_DELAY+time.Second))
	got := queued()
	if len(got) != 1 {
		t.Fatalf("%d alerts, want one for the fix lost", len(got))
	}
	lost := got[0]
	if lost.Type != EVENT_TYPE_GPS_NOT_FIXED || lost.Title != "GPS fix lost" || !lost.Active {
		t.Errorf("the fix lost alert: %+v", lost)
	}
	if !lost.TimestampEnd.After(lost.Timestamp) {
		t.Errorf("the fix lost alert does not follow the outage: %+v", lost)
	}
	if msgs := sent(t); len(msgs) != 1 {
		t.Errorf("sent %d frames, want the fix lost once", len(msgs))
	}

	gpsFixAlert.check(true, start.Add(GPS_FIX_LOST_DELAY+2*time.Second))
	if got := queued(); got[0].Active {
		t.Errorf("the fix lost alert stayed active with the fix back: %+v", got[0])
	}

	// A second outage is a new alert
	gpsFixAlert.check(false, start.Add(2*GPS_FIX_LOST_DELAY+2*time.Second))
	if got := queued(); len(got) != 2 || !got[1].Active {
		t.Errorf("a second outage: %v", got)
	}
}

func TestGPSFixAlertIsQuietBeforeTheFirstFix(t *testing.T) {
	withGPSFixAlert(t)
	start := time.Now()
	for i := 0; i < 10; i++ {
		gpsFixAlert.check(false, start.Add(time.Duration(i)*time.Second))
	}
	if got := queued(); len(got) != 0 {
		t.Errorf("no fix since power on raised: %v", got)
	}
}
