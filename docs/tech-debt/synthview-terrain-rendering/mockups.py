#!/usr/bin/env python3
"""Before/after renders for synthview-terrain-rendering.md. Not a test.

    cd test/display && env -u TMPDIR python3 ../../docs/tech-debt/synthview-terrain-rendering/mockups.py OUTDIR [proposal-patch.js]

Drives the real RB-01 synthetic view (headless Chromium, 1280x800) at log second 588
of the marketing flight, one screenshot per pose. ONLY=cruise,ground limits the poses;
VARIANT=A|B|C picks the colors-patch.js variant (S1-S3 haze-shading-patch.js);
RB_SHADOWS=1 adds cast shadows to s4-patch.js. With the patch, proposal-patch.js is
evaluated on the live page first: the proposal, with no product file changed.
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "test", "display"))
OUT = sys.argv[1]; PATCH = sys.argv[2] if len(sys.argv) > 2 else None
os.makedirs(OUT, exist_ok=True)
import marketing_synthview as M
from plates import Display
W, H = 1280, 800
POSES = {   # name: (log time, overrides, camera)
  "cruise":   (588.0, {}, None),
  "nosedown": (588.0, {"AHRSPitch": -12.0}, None),
  "bank":     (588.0, {"AHRSRoll": 40.0}, None),
  "low":      (588.0, {"GPSAltitudeMSL": 900.0}, None),
  "ground":   (588.0, {"GPSAltitudeMSL": 1720.0, "AHRSPitch": 0.0, "AHRSRoll": 0.0}, None),
  "high":     (588.0, {"GPSAltitudeMSL": 11000.0}, {"orbit": 0, "dist": 5, "rise": 0, "bank": 1, "lead": 0, "lookUp": -250}),
  "under":    (588.0, {"GPSAltitudeMSL": 900.0}, None),
  "south":    (588.0, {"GPSTrueCourse": 178.0}, None),
  "southhigh": (588.0, {"GPSAltitudeMSL": 11000.0, "GPSTrueCourse": 178.0}, {"orbit": 0, "dist": 5, "rise": 0, "bank": 1, "lead": 0, "lookUp": -250}),
  "above":    (588.0, {}, {"orbit": 20, "dist": 6.5, "rise": 400, "bank": 0.2, "lead": 3.0, "lookUp": 0}),
}
f = M.Flight()
with Display(window="%d,%d" % (W, H), situation=f.situation(588.0)) as d:
    d.page.ws.sock.settimeout(120)
    d.page.send("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=1, mobile=False)
    d.page.pump(0.5)
    d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
    d.show("synthview", "#synthviewFrame", timeout=25)
    for _ in range(150):
        d.srv.push_situation(**f.situation(588.0)); d.page.pump(0.4)
        if d.page.eval("(()=>{const s=angular.element(document.querySelector('#synthviewFrame')).scope();return !!(s&&s.remote&&s.remote.rendering.terrainBrown)})()"): break
    d.page.pump(2)
    print(d.page.eval(M.CAMERA_HOOK))
    # The orbit hook replaces cameraFollowItem: give it the product's terrain clearance back
    d.page.eval("""(() => { const R = angular.element(document.querySelector('#synthviewFrame')).scope().remote.rendering;
        const hook = R.cameraFollowItem;
        R.cameraFollowItem = function (item, res) { hook.call(this, item, res);
            const g = this.groundAt ? this.groundAt(this.camera.position.x, this.camera.position.z) : null;
            if (window.__rbNoClear || g == null || this.camera.position.y >= g + 60) return;
            this.camera.position.y = g + 60; this.camera.lookAt(this.controls.target);
            this.camera.rotateZ(-(item.roll || 0) * Math.PI / 180 * window.__rbCam.bank); }; })()""")
    if os.environ.get("RB_SHADOWS"): d.page.eval("window.__rbShadows = true")
    if os.environ.get("VARIANT"): d.page.eval("window.__rbVariant = %s" % json.dumps(os.environ["VARIANT"]))
    if PATCH: print("patch:", d.page.eval(open(PATCH).read()))
    only = os.environ.get("ONLY"); probe = os.environ.get("PROBE")
    for name, (t, ov, cam) in POSES.items():
        if only and name not in only.split(","): continue
        s = f.situation(t); s.update(ov)
        c = cam or {"orbit": 0, "dist": 5, "rise": 0, "bank": 1, "lead": 0, "lookUp": 0}
        d.page.eval("window.__rbNoClear = %s" % ("true" if name == "under" else "false"))
        for _ in range(3):
            d.page.eval(M.DISPATCH % (json.dumps(c), json.dumps(s)))
            d.page.eval("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))", await_promise=True)
        d.page.screenshot(os.path.join(OUT, name + ".png")); print(name, d.page.eval(open(probe).read()) if probe else "")
    print("errors", d.js_errors()[:3])
