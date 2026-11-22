"""Frame cost of haze, hill shading and cast shadows on a real RB-01 (synthview-terrain-rendering.md section 8).

Not a test. Attaches to the kiosk Chromium (--remote-debugging-port=9222) through a tunnel,
    ssh -fN -L 19222:localhost:9222 pi@<rb-01>
switches the effects on the live synthetic view, renders 20 s at 10 Hz and 20 s at the
display's rate per configuration, and samples Chromium CPU (/proc) and V3D busy time
(gpu_stats) on the device. Reloads the page at the end, which removes every change.

    cd test/display && RB_SSH=./rb-ssh python3 ../../docs/tech-debt/synthview-terrain-rendering/bench.py 20 out.json
"""
import json, os, subprocess, sys, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "test", "display"))
from cdp import Chrome
RB = os.environ.get("RB_SSH", "rb-ssh")   # a script that runs its argument on the RB-01 over ssh
SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 20

def pi_sample():
    out = subprocess.check_output([RB, r'''
for p in $(pgrep -f "chromium.*--type=gpu-process"); do echo gpu $(cut -d" " -f14,15 /proc/$p/stat); done
for p in $(pgrep -f "chromium.*--type=renderer"); do echo ren $(cut -d" " -f14,15 /proc/$p/stat); done
cat /proc/stat | head -1
cat /sys/devices/platform/axi/*v3d*/gpu_stats | awk '$1=="bin"||$1=="render"{print $1,$2,$4}'
cat /sys/class/thermal/thermal_zone0/temp; vcgencmd measure_clock v3d 2>/dev/null'''], text=True)
    s = {"gpu": 0, "ren": 0, "t": time.time()}
    for line in out.splitlines():
        f = line.split()
        if f[0] in ("gpu", "ren"): s[f[0]] += int(f[1]) + int(f[2])
        elif f[0] == "cpu": s["all"] = [int(x) for x in f[1:]]
        elif f[0] in ("bin", "render"): s[f[0]] = (int(f[1]), int(f[2]))
        elif f[0].isdigit(): s["temp"] = int(f[0]) / 1000
        elif f[0].startswith("frequency"): s["v3dclk"] = int(line.split("=")[1]) // 1000000
    return s

def delta(a, b):
    dt = b["t"] - a["t"]
    tot = sum(b["all"]) - sum(a["all"]); idle = (b["all"][3] + b["all"][4]) - (a["all"][3] + a["all"][4])
    gpu_wall = b["render"][0] - a["render"][0]
    return {"gpuProc%": round((b["gpu"] - a["gpu"]) / dt, 1), "renderer%": round((b["ren"] - a["ren"]) / dt, 1),
            "system%of4": round(100 * (1 - idle / tot), 1),
            "v3dRender%": round(100 * (b["render"][1] - a["render"][1]) / gpu_wall, 1),
            "v3dBin%": round(100 * (b["bin"][1] - a["bin"][1]) / gpu_wall, 1),
            "temp": b.get("temp"), "v3dMHz": b.get("v3dclk")}

pages = json.load(urllib.request.urlopen("http://localhost:19222/json"))
page = [p for p in pages if p["type"] == "page" and "RB-01" in p["url"]][0]
c = Chrome(page["webSocketDebuggerUrl"].replace("localhost:9222", "localhost:19222").replace("127.0.0.1:9222", "localhost:19222"))
c.ws.sock.settimeout(SECS * 3 + 60)
J = lambda e, aw=False: c.eval(e, await_promise=aw)
print("url", page["url"])
print(J("""(() => { const sc = angular.element(document.querySelector('#synthviewFrame')).scope(); window.__R = sc.remote.rendering;
  const R = __R, cv = R.renderer.domElement, gl = R.renderer.getContext();
  return JSON.stringify({inner: [innerWidth, innerHeight], dpr: devicePixelRatio, canvas: [cv.width, cv.height], three: THREE.REVISION,
     webgl2: R.renderer.capabilities.isWebGL2, gpu: gl.getParameter(gl.RENDERER), terrain: !!R.terrainBrown,
     tris: R.renderer.info.render.triangles, calls: R.renderer.info.render.calls}); })()"""))

SETUP = r"""(() => { const R = __R, S = R.scene;
  const light = S.children.find(o => o.isDirectionalLight);
  const all = () => S.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
  window.__orig = window.__orig || { mat: R.terrainBrown.material, lightPos: light.position.clone() };
  window.__cfg = {
    base() { S.fog = null; R.renderer.shadowMap.enabled = false; light.castShadow = false; R.terrainBrown.material = __orig.mat;
             R.terrainBrown.castShadow = R.terrainBrown.receiveShadow = false; light.position.copy(__orig.lightPos); light.target.position.set(0,0,0);
             R.terrainBrown.children.forEach(o => { if (o.isLineSegments) o.visible = true; }); window.__follow = null; all(); },
    haze() { S.fog = new THREE.Fog(0xc9dbe6, 8000, 30000); all(); },
    lambert() { R.terrainBrown.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }); all(); },
    shadows() { R.renderer.shadowMap.enabled = true; R.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      light.castShadow = true; light.shadow.mapSize.set(2048, 2048);
      const sc = light.shadow.camera; sc.left = sc.bottom = -20000; sc.right = sc.top = 20000; sc.near = 1; sc.far = 60000; sc.updateProjectionMatrix();
      S.add(light.target); R.terrainBrown.castShadow = R.terrainBrown.receiveShadow = true;
      S.traverse(o => { if (o.isMesh && o !== R.terrainBrown) o.castShadow = true; });
      window.__follow = () => { const t = R.controls.target; light.target.position.copy(t); light.position.set(t.x - 15000, t.y + 20000, t.z - 15000); };
      all(); },
    unlitB() { R.terrainBrown.children.forEach(o => { if (o.isLineSegments) o.visible = false; });
      R.terrainBrown.material = new THREE.ShaderMaterial({ uniforms: { alt: { value: 300 } }, side: THREE.FrontSide, extensions: { derivatives: true },
        vertexShader: 'varying float vE; void main(){ vE = position.z; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform float alt; varying float vE; void main(){ float e=vE; vec3 c = e<=0.0?vec3(0.,.25,1.): e>alt?vec3(1.,0.,0.): e>alt-200.?vec3(1.,1.,0.):vec3(0.,.7,0.);' +
          'float q=e/100.,w=max(fwidth(q),1e-4); float k=(1.-clamp(abs(fract(q-.5)-.5)/w-.5,0.,1.))*(1.-smoothstep(.2,.45,w)); c=mix(c,c*.35,k);' +
          'float fw=max(fwidth(e),1e-3); float d=min(abs(e-alt),abs(e-(alt-200.)))/fw; c=mix(c,vec3(0.),1.-clamp(d-1.5,0.,1.)); gl_FragColor=vec4(c,1.);}' }); }
  };
  window.__frame = () => { if (__follow) __follow(); R.renderer.render(S, R.camera); };
  window.__run = (secs, hz) => new Promise(done => {
    let n = 0, cpu = 0; const t0 = performance.now();
    const one = () => { const a = performance.now(); __frame(); cpu += performance.now() - a; n++; };
    if (hz === 0) { const loop = () => { one(); if (performance.now() - t0 < secs * 1000) requestAnimationFrame(loop); else done({ frames: n, fps: +(n / secs).toFixed(1), jsMsPerFrame: +(cpu / n).toFixed(2) }); }; requestAnimationFrame(loop); }
    else { const id = setInterval(() => { one(); if (performance.now() - t0 >= secs * 1000) { clearInterval(id); done({ frames: n, fps: +(n / secs).toFixed(1), jsMsPerFrame: +(cpu / n).toFixed(2) }); } }, 1000 / hz); }
  });
  window.__finish = (n) => { const gl = R.renderer.getContext(); __frame(); gl.finish(); const t = []; for (let i = 0; i < n; i++) { const a = performance.now(); __frame(); gl.finish(); t.push(performance.now() - a); } t.sort((x, y) => x - y); return { medianFinishMs: +t[n >> 1].toFixed(2), p90: +t[Math.floor(n * 0.9)].toFixed(2) }; };
  return 'ok'; })()"""
print(J(SETUP))
CONFIGS = [("baseline (dome, Phong, wireframe)", ["base"]), ("+ haze (fog)", ["base", "haze"]),
           ("smooth hill shading (Lambert)", ["base", "lambert"]), ("+ cast shadows (2048 PCF soft)", ["base", "shadows"]),
           ("+ haze + shadows", ["base", "haze", "shadows"]), ("unlit strong colours (variant B)", ["base", "unlitB"]), ("baseline again", ["base"])]
a = pi_sample(); time.sleep(SECS); print("IDLE (page as is, no bench loop)", json.dumps(delta(a, pi_sample())))
results = []
for name, steps in CONFIGS:
    J("(() => { %s; return 1; })()" % "; ".join("__cfg.%s()" % s for s in steps))
    J("__frame(), 1"); time.sleep(1)
    fin = J("__finish(40)")
    row = {"config": name, "finish": fin, "scene": J("(() => { const i = __R.renderer.info.render; return [i.triangles, i.calls]; })()")}
    for hz in (10, 0):
        a = pi_sample(); r = J("__run(%g, %d)" % (SECS, hz), True); b = pi_sample()
        row["10Hz" if hz else "max"] = dict(r, **delta(a, b))
    print(json.dumps(row)); results.append(row)
    J("(() => { const R = __R; return R.renderer.info.render.triangles; })()")
json.dump(results, open(sys.argv[2] if len(sys.argv) > 2 else "/dev/null", "w"), indent=1)
J("__cfg.base(), location.reload(), 1")
print("restored (page reloaded)")
