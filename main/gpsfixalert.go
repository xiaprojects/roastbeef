/*
	Copyright (c) 2026 XIAPROJECTS SRL
	Distributable under the terms of The "BSD New" License
	that can be found in the LICENSE file, herein included
	as part of this header.

	gpsfixalert.go: danger alert when the GPS fix drops to zero

	The alert (EVENT_TYPE_GPS_NOT_FIXED) is raised once when a fix that was there
	goes, stays active with its end moving while there is no fix, and is closed
	when the fix comes back. A GPS that never had a fix since power on raises
	nothing, so a box on the bench without an antenna stays quiet.
*/

package main

import (
	"time"
)

// How long the fix must be gone before the alert, so one bad GGA sentence is not a danger
const GPS_FIX_LOST_DELAY = 3 * time.Second

type GPSFixAlert struct {
	everFixed bool      // a fix was seen since power on
	lastFix   time.Time // last check that saw a fix
	lost      bool      // the alert is open
	alertId   int
}

var gpsFixAlert = GPSFixAlert{}

/*
gpsFixAlert.check().

	Called once per second from updateStatus() with isGPSValid(): false is
	GPSFixQuality 0, or a fix older than 3 seconds, or no GPS at all.
*/
func (g *GPSFixAlert) check(fixed bool, now time.Time) {
	if fixed {
		g.everFixed = true
		g.lastFix = now
		if g.lost {
			g.lost = false
			alerts.pushEvent(Alert{Id: g.alertId, Active: false})
		}
		return
	}
	if !g.everFixed {
		return
	}
	if g.lost {
		alerts.pushEvent(Alert{Id: g.alertId, Active: true})
		return
	}
	if now.Sub(g.lastFix) >= GPS_FIX_LOST_DELAY {
		g.alertId = alerts.pushEvent(Alert{Type: EVENT_TYPE_GPS_NOT_FIXED, Title: "GPS fix lost", Timestamp: time.Now(), Active: true})
		g.lost = g.alertId >= 0
	}
}
