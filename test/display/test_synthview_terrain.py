#!/usr/bin/env python3
"""The synthetic view never shows the sky where the terrain is.

docs/tech-debt/synthview-terrain-rendering.md P2 and P3:
- the terrain is drawn front face only, and a brown back-face copy makes the
  underside solid brown (it used to be the top colours, mirrored, over the
  cyan sky colour);
- a sky/ground dome follows the camera: sky colour above the eye-level
  horizon, terrainUndersideColor below it, so where there is no terrain
  the ground is brown (P1); with haze on, both fade into the haze colour
  at the horizon;
- the chase camera sits behind the aircraft at its altitude, so with higher
  ground behind it went inside the hill; it now keeps cameraClearanceMeters
  (synthview.json, 60 m) above the ground under it;
- sections 11-12: haze (fog from 0.2 to 0.77 of the window half width),
  terrain lit by a sun 315 deg relative to the heading and 15 deg up, which
  turns with the aircraft, and 1024 PCF cast shadows from the terrain only.

Two poses over the hills near Perugia (ground about 510-530 m): rolling at
1720 ft, where the camera used to be inside the hill, and 900 ft, the
aircraft itself below the terrain data. In both the lower half of the screen
must hold no sky colour. Same at 11,000 ft, where the terrain window ends
short of the horizon: the dome around the camera is brown below it.
"""

import os
import sys
import tempfile

from PIL import Image

from plates import Display, Result

W, H = 1280, 800
BASE = dict(GPSLatitude=43.248316, GPSLongitude=12.268159, GPSTrueCourse=358.1, GPSGroundSpeed=116,
            GPSFixQuality=1, AHRSPitch=0.0, AHRSRoll=0.0)
SKY = (133, 204, 232)     # skyColor 0.52, 0.8, 0.91 as the renderer writes it
SCOPE = "angular.element(document.querySelector('#synthviewFrame')).scope()"
CAMERA = """(() => {
    const R = %s.remote.rendering, c = R.camera.position, t = R.terrainBrown;
    const under = t ? t.children.filter(o => o.isMesh && o.material.side === THREE.BackSide) : [];
    return {y: c.y, ground: R.groundAt ? R.groundAt(c.x, c.z) : null, side: t ? t.material.side : null,
            front: THREE.FrontSide, under: under.length,
            dome: R.dome ? {inScene: R.dome.parent === R.scene, first: R.dome.renderOrder < 0, culled: R.dome.frustumCulled,
                            dx: R.dome.position.x - c.x, dz: R.dome.position.z - c.z} : null};
})()""" % SCOPE


LIGHT = """(() => {
    const R = %s.remote.rendering, t = R.terrainBrown, sun = R.sun;
    const dx = sun.position.x - sun.target.position.x, dy = sun.position.y - sun.target.position.y,
          dz = sun.position.z - sun.target.position.z, h = Math.hypot(dx, dz);
    const half = t.geometry.parameters.width / 2, f = R.scene.fog;
    return {fog: f ? [f.near / half, f.far / half] : null,
            shadowMap: R.renderer.shadowMap.enabled, pcf: R.renderer.shadowMap.type === THREE.PCFShadowMap,
            cast: sun.castShadow, map: sun.shadow.map ? sun.shadow.map.width : null,
            terrain: [t.castShadow, t.receiveShadow], material: t.material.type,
            others: R.scene.children.filter(o => o !== t && o.isMesh && o.castShadow).length,
            azimuth: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) %% 360,     // north is -Z
            elevation: Math.atan2(dy, h) * 180 / Math.PI};
})()""" % SCOPE


def angle_off(a, b):
    return abs((a - b + 540) % 360 - 180)


def sky_share(path, top=20):
    """Share of sky-coloured pixels in the lower half, below the horizon line."""
    img = Image.open(path).convert("RGB")
    box = img.crop((0, H // 2 + top, W, H - 80))       # above the heading tape
    raw = box.tobytes()
    near = sum(1 for i in range(0, len(raw), 3) if all(abs(raw[i + k] - SKY[k]) <= 6 for k in range(3)))
    return near / (len(raw) // 3)


def pose(d, altitude_ft, heading=None):
    s = dict(BASE, GPSAltitudeMSL=altitude_ft)
    if heading is not None:
        s["GPSTrueCourse"] = heading
    for _ in range(4):
        d.srv.push_situation(**s)
        d.page.pump(0.6)
    d.page.eval("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
                await_promise=True)


def main():
    res = Result()
    out = tempfile.mkdtemp(prefix="synthterrain")
    with Display(window="%d,%d" % (W, H), situation=dict(BASE, GPSAltitudeMSL=2600)) as d:
        d.page.ws.sock.settimeout(120)
        d.page.send("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=1, mobile=False)
        d.page.pump(0.5)
        d.page.wait("typeof THREE !== 'undefined'", timeout=25, label="three.js")
        d.show("synthview", "#synthviewFrame", timeout=25)
        for _ in range(150):
            d.srv.push_situation(**dict(BASE, GPSAltitudeMSL=2600))
            d.page.pump(0.4)
            if d.page.eval("!!(%s.remote.rendering.terrainBrown)" % SCOPE):
                break
        cam = d.page.eval(CAMERA)
        res.check(cam["side"] == cam["front"], "the terrain is drawn front face only", cam)
        res.check(cam["under"] == 1, "with one brown back-face copy for the underside", cam)
        dome = cam["dome"]
        res.check(dome is not None and dome["inScene"] and dome["first"] and not dome["culled"],
                  "a sky/ground dome is in the scene, drawn first, never culled", dome)
        res.check(dome is not None and abs(dome["dx"]) < 1e-6 and abs(dome["dz"]) < 1e-6,
                  "and centred on the camera", dome)
        light = d.page.eval(LIGHT)
        res.check(light["fog"] is not None and abs(light["fog"][0] - 0.2) < 1e-3 and abs(light["fog"][1] - 0.77) < 1e-3,
                  "haze from 0.2 to 0.77 of the window half width", light)
        res.check(light["shadowMap"] and light["pcf"] and light["cast"] and light["map"] == 1024,
                  "the sun casts shadows into a 1024 PCF shadow map", light)
        res.check(light["terrain"] == [True, True] and light["others"] == 0 and light["material"] == "MeshLambertMaterial",
                  "only the terrain casts and receives them, lit without specular", light)
        for heading in (358.1, 178.0):
            pose(d, 2600, heading)
            light = d.page.eval(LIGHT)
            res.check(angle_off(light["azimuth"], (heading + 315) % 360) < 0.5 and abs(light["elevation"] - 15) < 0.5,
                      "heading %.0f: the sun is 315 deg relative and 15 deg up" % heading,
                      {"azimuth": round(light["azimuth"], 1), "elevation": round(light["elevation"], 1)})
        for name, ft in (("rolling at 1720 ft", 1720), ("below the terrain data at 900 ft", 900),
                         ("at 11,000 ft, beyond the window edge", 11000)):
            pose(d, ft)
            cam = d.page.eval(CAMERA)
            res.check(cam["ground"] is not None and cam["y"] >= cam["ground"] + 60 - 0.01,
                      "%s: the camera keeps 60 m over the ground under it" % name, cam)
            path = d.page.screenshot(os.path.join(out, "%d.png" % ft))
            share = sky_share(path, 20 if ft < 5000 else 4)
            res.check(share < 0.01, "%s: no sky colour below the horizon (%.1f %%)" % (name, share * 100), path)
        errors = d.js_errors()
        res.check(not errors, "no JS error", errors[:3])
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
