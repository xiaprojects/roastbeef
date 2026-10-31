#!/usr/bin/env python3
"""The RB-01 synthetic-vision video for www.rbavionics.com, autopilot engaged.

Not a test. It drives the real HMI the way test_guidance.py does - a flight
plan derived from the recorded track, the autopilot engaged on it - and
captures a 24 s, 25 fps flight on the 1280x800 rectangular display while the
camera circles the aircraft.

    RB_SHOTS=/some/dir ./marketing_synthview.py [--preview]

Frames land in $RB_SHOTS/synthview/f00000.png ... (--preview: one per second).
Encode them for the site (assets/video/ in the website repo):

    # WebM / VP9, two-pass, ~1.1 Mbit/s
    ffmpeg -framerate 25 -i f%05d.png -c:v libvpx-vp9 -b:v 1100k -minrate 500k -maxrate 1800k \\
        -row-mt 1 -tile-columns 2 -deadline good -cpu-used 1 -g 100 -pix_fmt yuv420p -pass 1 -an -f null /dev/null
    ffmpeg -framerate 25 -i f%05d.png -c:v libvpx-vp9 -b:v 1100k -minrate 500k -maxrate 1800k \\
        -row-mt 1 -tile-columns 2 -deadline good -cpu-used 1 -g 100 -pix_fmt yuv420p -pass 2 -an rb-01-synthview.webm
    # MP4 / H.264 fallback, 960x600, two-pass (same two commands with):
    #   -vf scale=960:600:flags=lanczos -c:v libx264 -preset slow -b:v 1200k -maxrate 2000k -bufsize 3000k
    #   -tune animation -profile:v high -level 4.0 -pix_fmt yuv420p ... -movflags +faststart rb-01-synthview.mp4

(No ffmpeg on the machine: `pip install imageio-ffmpeg` in a venv ships a static
one; gst-launch-1.0 with vp9enc/webmmux also works for the WebM.)

Two things differ from the aircraft, both deliberate:
- the situation service only redraws on a 1 deg / 50 ft change or once a
  second, which is right for the display but stutters at 25 fps, so each frame
  dispatches SituationUpdated itself with a situation interpolated between the
  recorded samples;
- the chase camera is rebound on the live instance to one that can orbit (the
  pilot can orbit too, by dragging on the display). The product code is untouched.
"""

import bisect
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("RB_SHOTS", os.path.join(HERE, "shots", "marketing"))

from flightlog import FlightLog          # noqa: E402
from flightpath import FlightPath        # noqa: E402
from plates import Display, SHOTS        # noqa: E402

NAME = os.environ.get("RB_FLIGHT_LOG", "flightlog-20260913111200.0341")
FPS = 25
DURATION = 24.0             # seconds of video
T0 = 588.0                  # log seconds: cruise north at ~2600 ft, turning onto 335
SPEED = 4.0                 # time-lapse factor
WIDTH, HEIGHT = 1280, 800   # rectangular RB-01 display

# Camera keyframes: video time, orbit (deg from behind), distance (follow
# units), rise (m above the aircraft), bank (share of the aircraft's roll the
# camera follows), lead (look this far ahead). The world is exaggerated
# horizontally, so a useful elevation angle needs a rise of a few hundred.
KEYS = [
    (0.0, 0, 5.0, 0, 1.0, 0.0),        # the RB-01's own chase view
    (3.0, 0, 5.0, 0, 1.0, 0.0),
    (6.5, 12, 6.5, 380, 0.2, 3.0),     # up behind, looking down the tunnel
    (10.0, 120, 7.0, 120, 0.0, 0.0),   # right-front quarter
    (14.0, 185, 7.0, 90, 0.0, 0.0),    # head-on, tunnel towards the camera
    (17.5, 250, 7.0, 160, 0.0, 0.0),   # left-front quarter
    (21.0, 340, 6.5, 300, 0.2, 3.0),   # up behind on the left
    (24.0, 360, 5.0, 0, 1.0, 0.0),     # back to the chase view
]

CAMERA_HOOK = """(() => {
    const sc = angular.element(document.querySelector('#synthviewFrame')).scope();
    if (!sc || !sc.remote || !sc.remote.rendering) return 'no scope';
    const R = sc.remote.rendering;
    window.__rbCam = window.__rbCam || {orbit: 0, dist: 5, rise: 0, bank: 1, lead: 0, lookUp: 0};
    R.cameraFollowItem = function (item, resources) {
        const c = window.__rbCam, u = resources.setup.cellSize / FollowMeDistance;
        const h = item.direction * Math.PI / 180, a = (item.direction + c.orbit) * Math.PI / 180;
        this.camera.position.set(item.x - c.dist * u * Math.sin(a), item.elevation + c.rise,
                                 item.y + c.dist * u * Math.cos(a));
        this.controls.target.set(item.x + c.lead * u * Math.sin(h), item.elevation + c.lookUp,
                                 item.y - c.lead * u * Math.cos(h));
        this.controls.update();
        this.camera.rotateZ(-(item.roll || 0) * Math.PI / 180 * c.bank);
    };
    sc.remote.set = function () {};
    return 'hooked';
})()"""

DISPATCH = """(() => {
    Object.assign(window.__rbCam, %s);
    const s = %s;
    window.situation = s;
    dispatchEvent(new CustomEvent('SituationUpdated', {detail: s}));
    return true;
})()"""

ANGLES = ("GPSTrueCourse", "AHRSGyroHeading", "AHRSMagHeading")
LINEAR = ("GPSLatitude", "GPSLongitude", "GPSAltitudeMSL", "GPSGroundSpeed", "AHRSRoll",
          "AHRSPitch", "GPSVerticalSpeed", "BaroPressureAltitude", "AHRSSlipSkid", "AHRSGLoad")


class Flight:
    """The recording, interpolated, and the plan derived from its track."""

    def __init__(self):
        log = FlightLog(os.path.join(os.path.dirname(os.path.dirname(HERE)), "test-data", NAME + ".sqlite"))
        self.samples = list(log.stream("mySituation", 0, None))
        self.times = [t for t, _ in self.samples]
        self.path = FlightPath(NAME)
        # Tight, so the tunnel follows the path actually flown.
        self.route = self.path.waypoints(tolerance_nm=0.1)

    def situation(self, t):
        i = max(1, min(len(self.times) - 1, bisect.bisect_left(self.times, t)))
        (t0, a), (t1, b) = self.samples[i - 1], self.samples[i]
        k = 0.0 if t1 <= t0 else max(0.0, min(1.0, (t - t0) / (t1 - t0)))
        out = dict(a)
        for key in LINEAR:
            if isinstance(a.get(key), (int, float)) and isinstance(b.get(key), (int, float)):
                out[key] = a[key] + (b[key] - a[key]) * k
        for key in ANGLES:
            if isinstance(a.get(key), (int, float)) and isinstance(b.get(key), (int, float)):
                d = ((b[key] - a[key] + 540) % 360) - 180
                out[key] = (a[key] + d * k) % 360
        return out

    def served(self):
        return [{k: v for k, v in wp.items() if not k.startswith("_")} for wp in self.route]

    def engage(self, d, t):
        """Sequence the plan for log time t and put the autopilot on it."""
        target = self.path.sequence(self.route, t)
        d.srv.route = self.served()
        wp = self.route[target]
        d.srv.push_autopilot(Active=True, To={"Lat": wp["Lat"], "Lon": wp["Lon"], "Ele": wp["Ele"], "Cmt": wp["Cmt"]})
        return target


def camera(u):
    k = 0
    while k < len(KEYS) - 2 and KEYS[k + 1][0] <= u:
        k += 1
    a, b = KEYS[k], KEYS[k + 1]
    x = 0.0 if b[0] <= a[0] else max(0.0, min(1.0, (u - a[0]) / (b[0] - a[0])))
    x = x * x * (3 - 2 * x)
    v = [a[i] + (b[i] - a[i]) * x for i in range(1, 6)]
    return {"orbit": v[0], "dist": v[1], "rise": v[2], "bank": v[3], "lead": v[4], "lookUp": 0}


def main():
    preview = "--preview" in sys.argv
    out = os.path.join(SHOTS, "synthview")
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith(".png"):
            os.remove(os.path.join(out, f))
    flight = Flight()
    started = time.time()
    with Display(window="%d,%d" % (WIDTH, HEIGHT), route=flight.served(), situation=flight.situation(T0)) as d:
        d.page.send("Emulation.setDeviceMetricsOverride", width=WIDTH, height=HEIGHT, deviceScaleFactor=1, mobile=False)
        d.page.pump(0.5)
        d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
        d.instrument_three()
        d.show("synthview", "#synthviewFrame", timeout=25)
        target = flight.engage(d, T0)
        for _ in range(400):                   # the terrain loads off the first situation
            d.srv.push_situation(**flight.situation(T0))
            d.page.pump(0.4)
            if d.page.eval("(window.__rbTunnelGroups || 0) > 0"):
                break
        print("tunnel ready after %.0fs" % (time.time() - started), d.page.eval(CAMERA_HOOK))

        frames = int(DURATION * FPS)
        for n in range(0, frames, FPS if preview else 1):
            u = n / FPS
            t = T0 + u * SPEED
            if flight.path.sequence(flight.route, t) != target:   # waypoint passed: re-plan
                groups = d.page.eval("window.__rbTunnelGroups || 0")
                target = flight.engage(d, t)
                try:
                    d.page.wait("(window.__rbTunnelGroups || 0) > %d" % groups, timeout=20, label="tunnel rebuild")
                except TimeoutError:
                    print("  tunnel not rebuilt at", t)
            d.page.eval(DISPATCH % (json.dumps(camera(u)), json.dumps(flight.situation(t))))
            d.page.eval("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
                        await_promise=True)
            d.page.screenshot(os.path.join(out, "f%05d.png" % (n // FPS if preview else n)))
            if n % 100 == 0:
                print("frame %d/%d  t=%.1f  wp=%d  %.0fs" % (n, frames, t, target, time.time() - started))
        errors = d.js_errors()
    print(out)
    if errors:
        print("JS errors:", errors[:3])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
