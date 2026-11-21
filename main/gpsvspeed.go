package main

/*
	gpsvspeed.go: GPS vertical speed from the GGA altitude.

	No sentence this fork parses carries a vertical velocity, so mySituation.GPSVerticalSpeed
	is the least-squares slope of the GGA altitude over the last gpsVSpeedWindow seconds of
	fix time. Fix time (GGA field 1), not arrival time, so serial jitter does not show up as
	climb. Over 2 s that is 20 fixes at 10 Hz and 2 or 3 at 1 Hz; the slope of 20 fixes
	smooths the decimetre altitude jitter of the u-blox without the ~4 s lag of the baro VSI.

	The estimate starts over when the fix time steps back (other than across midnight),
	jumps forward by more than gpsVSpeedMaxGap, or the fix is lost, and reads 0 until two
	fixes gpsVSpeedMinSpan apart are in. The unit is feet per second, as the field has
	always been documented (sensors.go, SixPackInstruments.js and windestimator.js read it so).
*/

const (
	gpsVSpeedWindow  = 2.0 // seconds of fix time the slope is taken over
	gpsVSpeedMinSpan = 0.5 // seconds the fixes must span before a slope is reported
	gpsVSpeedMaxGap  = 3.0 // seconds between fixes beyond which the history is dropped
	gpsVSpeedMaxFps  = 200 // ft/s (12000 fpm), anything faster is an altitude glitch
)

type gpsVSpeedSample struct {
	t   float64 // seconds of fix time, unwrapped across midnight
	alt float64 // feet
}

type gpsVSpeedEstimator struct {
	samples []gpsVSpeedSample
	lastRaw float64 // the last GGA time of day, to unwrap midnight
	dayBase float64 // seconds added for each midnight crossed
}

var gpsVSpeed gpsVSpeedEstimator

func (e *gpsVSpeedEstimator) reset() {
	e.samples = e.samples[:0]
	e.dayBase = 0
}

// add takes one fix, time of day in seconds and altitude in feet, and returns the vertical
// speed in feet per second, 0 while the history is too short.
func (e *gpsVSpeedEstimator) add(timeOfDay float64, altFt float64) float32 {
	if len(e.samples) > 0 && timeOfDay < e.lastRaw-43200 {
		e.dayBase += 86400 // 23:59:59.9 to 00:00:00.0
	}
	e.lastRaw = timeOfDay
	t := timeOfDay + e.dayBase

	if n := len(e.samples); n > 0 {
		last := e.samples[n-1].t
		if t <= last {
			if t == last {
				return e.slope() // the same fix twice (GGA and GNS, or a resend)
			}
			e.samples = e.samples[:0]
		} else if t-last > gpsVSpeedMaxGap {
			e.samples = e.samples[:0]
		}
	}
	e.samples = append(e.samples, gpsVSpeedSample{t, altFt})

	drop := 0
	for drop < len(e.samples) && t-e.samples[drop].t > gpsVSpeedWindow {
		drop++
	}
	if drop > 0 {
		e.samples = append(e.samples[:0], e.samples[drop:]...)
	}
	return e.slope()
}

func (e *gpsVSpeedEstimator) slope() float32 {
	n := len(e.samples)
	if n < 2 || e.samples[n-1].t-e.samples[0].t < gpsVSpeedMinSpan {
		return 0
	}
	// Centred on the first sample, so the sums stay small at 86399 s of day
	t0, a0 := e.samples[0].t, e.samples[0].alt
	var st, sa, stt, sta float64
	for _, s := range e.samples {
		dt, da := s.t-t0, s.alt-a0
		st += dt
		sa += da
		stt += dt * dt
		sta += dt * da
	}
	fn := float64(n)
	den := fn*stt - st*st
	if den <= 0 {
		return 0
	}
	v := (fn*sta - st*sa) / den
	if v > gpsVSpeedMaxFps || v < -gpsVSpeedMaxFps {
		return 0
	}
	return float32(v)
}
