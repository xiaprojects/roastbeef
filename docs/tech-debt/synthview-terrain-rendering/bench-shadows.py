"""Frame cost of haze, hill shading and cast shadows on a real RB-01 (synthview-terrain-rendering.md section 12 (S4 cast shadows)).

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
c = Chrome(page["webSocketDebuggerUrl"].replace("localhost:9222", "localhost:19222"))
c.ws.sock.settimeout(SECS * 3 + 60)
J = lambda e, aw=False: c.eval(e, await_promise=aw)
print("url", page["url"])
print(J(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "s4-patch.js")).read()))
print(J(r"""(() => { const sc = angular.element(document.querySelector('#synthviewFrame')).scope(); const R = window.__R = sc.remote.rendering, S = R.scene;
  const light = S.children.find(o => o.isDirectionalLight);
  const all = () => S.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
  window.__cast = (size, soft) => {
    const on = size > 0; R.renderer.shadowMap.enabled = on; light.castShadow = on;
    R.renderer.shadowMap.type = soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
    if (on) { light.shadow.mapSize.set(size, size); light.shadow.bias = -0.0008; light.shadow.normalBias = 20;
      const k = light.shadow.camera; k.left = k.bottom = -16000; k.right = k.top = 16000; k.near = 100; k.far = 80000; k.updateProjectionMatrix(); }
    if (R.terrainBrown) R.terrainBrown.castShadow = R.terrainBrown.receiveShadow = on;
    all(); };
  window.__frame = () => R.renderer.render(S, R.camera);
  window.__run = (secs, hz) => new Promise(done => { let n = 0, cpu = 0; const t0 = performance.now();
    const one = () => { const a = performance.now(); __frame(); cpu += performance.now() - a; n++; };
    const fin = () => done({ frames: n, fps: +(n / secs).toFixed(1), jsMsPerFrame: +(cpu / n).toFixed(2) });
    if (hz === 0) { const loop = () => { one(); if (performance.now() - t0 < secs * 1000) requestAnimationFrame(loop); else fin(); }; requestAnimationFrame(loop); }
    else { const id = setInterval(() => { one(); if (performance.now() - t0 >= secs * 1000) { clearInterval(id); fin(); } }, 1000 / hz); } });
  window.__finish = (n) => { const gl = R.renderer.getContext(); __frame(); gl.finish(); const t = [];
    for (let i = 0; i < n; i++) { const a = performance.now(); __frame(); gl.finish(); t.push(performance.now() - a); }
    t.sort((x, y) => x - y); return { medianFinishMs: +t[n >> 1].toFixed(2), p90: +t[Math.floor(n * 0.9)].toFixed(2) }; };
  return 'ok'; })()"""))
CONFIGS = [("S4, no cast shadows", "0, false"), ("S4 + cast 2048 PCF soft", "2048, true"),
           ("S4 + cast 1024 PCF", "1024, false"), ("S4, no cast shadows again", "0, false")]
results = []
for name, arg in CONFIGS:
    J("__cast(%s), __frame(), 1" % arg); time.sleep(1)
    row = {"config": name, "finish": J("__finish(40)"),
           "scene": J("(() => { const i = __R.renderer.info.render; return [i.triangles, i.calls]; })()")}
    for hz in (10, 0):
        a = pi_sample(); r = J("__run(%g, %d)" % (SECS, hz), True); b = pi_sample()
        row["10Hz" if hz else "max"] = dict(r, **delta(a, b))
    print(json.dumps(row)); results.append(row)
json.dump(results, open(sys.argv[2] if len(sys.argv) > 2 else "/dev/null", "w"), indent=1)
J("location.reload(), 1")
print("restored (page reloaded)")
