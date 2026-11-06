#!/usr/bin/env python3
"""Regenerate the mockups in ../ALERTS-NAVIGATION-UI-PROPOSAL.md.

Boots the real RB-01 HMI against the fake backend of test/display, replays the
sample flight, forces the exact viewport (the harness `window=` argument does not
give one) and injects the proposed overlay into the empty #alertsModal of
index.html. The plates under the overlay are the real ones, so a collision with
an instrument shows up here. Nothing in web/ is changed.

    cd docs/tech-debt/alerts-navigation-ui && python3 mockups.py [scene ...]

The balloon-*.png scenes are not mockups: they push real alerts to the code as built.

Needs Chromium and Pillow.
"""

import math
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.join(REPO, "test", "display"))

from plates import Display, FLIGHT  # noqa: E402

CSS = r"""
:root { --bar: 96px; --red: #c40000; --amber: #ffc400; --adv: #10202e; --lamp: #00e000; }
html, body { background: #000 !important; }
.fabNavigation { animation: none !important; background: transparent !important; border: none !important; }
#alertsModal { position: fixed; inset: 0; z-index: 10000000; pointer-events: none; color: #fff;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
#alertsModal * { box-sizing: border-box; }
.wide .app, .wide .sidebar { height: calc(100% - var(--bar)) !important; bottom: auto !important; }
.wide .fabNorth, .wide .fabSouth { display: none !important; }

/* popup, 1280x800 */
.pop { position: absolute; left: 240px; width: 800px; bottom: calc(var(--bar) + 8px); height: 132px;
  display: flex; align-items: center; border-radius: 10px; overflow: hidden;
  box-shadow: 0 0 0 2px #000, 0 6px 22px rgba(0,0,0,.65); }
.pop.w { background: var(--red); }
.pop.c { background: var(--amber); color: #000; height: 112px; }
.pop.a { background: var(--adv); border: 2px solid #fff; width: 560px; left: 360px; height: 72px; }
.pop .tag { width: 150px; text-align: center; font-size: 24px; font-weight: 700; letter-spacing: 1px; }
.pop .txt { flex: 1; min-width: 0; }
.pop .t { font-size: 48px; font-weight: 700; line-height: 1.05; white-space: nowrap; }
.pop.c .t { font-size: 44px; }
.pop.a .t { font-size: 30px; padding-left: 28px; font-weight: 400; }
.pop .s { font-size: 24px; margin-top: 4px; }
.pop .hint { width: 150px; text-align: center; font-size: 20px; line-height: 1.2; font-weight: 700; }
.pop .more { position: absolute; top: 8px; right: 12px; font-size: 20px; font-weight: 700; }
.pop .count, .cap .count { position: absolute; left: 0; height: 8px; background: currentColor; opacity: .8; }
.pop .count { bottom: 0; }
.frame { position: absolute; inset: 0 0 var(--bar) 0; border: 6px solid var(--red); }

/* soft bar */
.softbar { position: absolute; left: 0; right: 0; bottom: 0; height: var(--bar); display: grid;
  grid-template-columns: repeat(8, 1fr); background: #000; border-top: 1px solid #444; }
.k { margin: 4px 2px; background: #1c1c1c; border: 1px solid #5c5c5c; border-radius: 6px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-size: 25px; font-weight: 700; position: relative; }
.k small { font-size: 18px; font-weight: 400; color: #c8c8c8; margin-top: 2px; }
.k.on::before { content: ""; position: absolute; left: 10px; right: 10px; top: 5px; height: 6px;
  background: var(--lamp); border-radius: 3px; }
.k.w { background: var(--red); border-color: #fff; }
.k.c { background: var(--amber); color: #000; border-color: #fff; }
.k.w small { color: #fff; }
.k.c small { color: #000; }
.k.outw { border: 3px solid var(--red); color: #ff5a5a; }
.k.outc { border: 3px solid var(--amber); color: var(--amber); }
.k.outw small { color: #ff8a8a; }
.k.outc small { color: var(--amber); }

/* round: everything lives inside the circle */
.mask { position: absolute; left: 0; top: 0; width: 480px; height: 480px; border-radius: 50%;
  box-shadow: 0 0 0 400px #000; }
.ring { position: absolute; left: 0; top: 0; width: 480px; height: 480px; border-radius: 50%; border: 9px solid var(--red); }
.ring.c { border-color: var(--amber); }
.cap { position: absolute; left: 0; right: 0; bottom: 0; text-align: center; }
.cap.w { height: 164px; background: var(--red); padding-top: 12px; }
.cap.c { height: 132px; background: var(--amber); color: #000; padding-top: 10px; }
.cap .count { top: 0; height: 6px; }
.cap .tag { font-size: 16px; font-weight: 700; letter-spacing: 2px; }
.cap .t { font-size: 36px; font-weight: 700; line-height: 1.1; white-space: nowrap; }
.cap.c .t { font-size: 32px; }
.cap .s { font-size: 20px; margin-top: 2px; }
.cap .hint { font-size: 16px; font-weight: 700; margin-top: 4px; }
.pill { position: absolute; left: 90px; top: 352px; width: 300px; height: 64px; display: flex;
  align-items: center; justify-content: center; font-size: 25px; background: var(--adv);
  border: 2px solid #fff; border-radius: 14px; }
.handle { position: absolute; left: 150px; top: 396px; width: 180px; height: 84px; display: flex;
  justify-content: center; }
.handle i { display: block; width: 56px; height: 5px; margin-top: 62px; border-radius: 3px; background: #9a9a9a; }
.chip { position: absolute; left: 165px; top: 410px; width: 150px; height: 44px; display: flex;
  align-items: center; justify-content: center; font-size: 22px; font-weight: 700; border-radius: 22px; }
.chip.w { background: var(--red); border: 2px solid #fff; }
.chip.c { background: var(--amber); color: #000; border: 2px solid #000; }

.dim { position: absolute; inset: 0; background: rgba(0,0,0,.84); }
.dot { position: absolute; width: 110px; height: 110px; border-radius: 50%; background: #1c1c1c;
  border: 1px solid #6c6c6c; display: flex; align-items: center; justify-content: center;
  font-size: 19px; font-weight: 700; }
.dot.sel { border: 4px solid #fff; }
.dot.on::before { content: ""; position: absolute; left: 34px; right: 34px; top: 9px; height: 5px;
  background: var(--lamp); border-radius: 3px; }
.dot.w { background: var(--red); border-color: #fff; }
.hub { position: absolute; left: 145px; top: 145px; width: 190px; height: 190px; border-radius: 50%;
  border: 1px solid #6c6c6c; background: #000; display: flex; flex-direction: column; align-items: center;
  justify-content: center; font-size: 24px; font-weight: 700; text-align: center; }
.hub small { font-size: 16px; font-weight: 400; color: #c8c8c8; margin-top: 6px; }

.wheel { position: absolute; left: 90px; width: 300px; display: flex; align-items: center;
  justify-content: center; border-radius: 12px; }
.wheel.mid { top: 176px; height: 128px; background: #1c1c1c; border: 4px solid #fff; font-size: 36px; font-weight: 700; }
.wheel.top { top: 62px; height: 106px; background: #111; border: 1px solid #5c5c5c; font-size: 24px; color: #c8c8c8; }
.wheel.bot { top: 312px; height: 106px; background: #111; border: 1px solid #5c5c5c; font-size: 24px; color: #c8c8c8; }

/* alert list */
.list { position: absolute; background: #000; }
.wide-list { left: 0; right: 0; top: 0; height: calc(800px - var(--bar)); padding: 14px 24px; }
.sec { font-size: 18px; font-weight: 700; letter-spacing: 2px; color: #b0b0b0; margin: 10px 0 6px; }
.row { margin: 0; display: flex; align-items: center; height: 72px; border-bottom: 1px solid #3a3a3a; }
.row b { width: 118px; height: 56px; display: flex; align-items: center; justify-content: center;
  font-size: 18px; letter-spacing: 1px; border-radius: 4px; margin-right: 20px; }
.row b.w { background: var(--red); }
.row b.c { background: var(--amber); color: #000; }
.row b.a { background: #efefef; color: #000; }
.row .n { font-size: 30px; font-weight: 700; width: 430px; }
.row .d { font-size: 22px; color: #d0d0d0; flex: 1; }
.row .st { width: 170px; font-size: 20px; font-weight: 700; text-align: right; }
.row .age { width: 130px; font-size: 24px; text-align: right; font-variant-numeric: tabular-nums; }
.row.old .n { font-weight: 400; color: #cfcfcf; }
.row.sel { outline: 3px solid #fff; outline-offset: -3px; }
.rlist { left: 0; top: 0; width: 480px; height: 480px; background: #000; }
.rhead { position: absolute; left: 0; right: 0; top: 30px; text-align: center; font-size: 22px; font-weight: 700; letter-spacing: 2px; }
.rrow { position: absolute; left: 80px; width: 320px; height: 76px; border-radius: 6px; padding: 6px 12px 0 18px;
  background: #151515; overflow: hidden; }
.rrow::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 10px; background: #efefef; }
.rrow.w::before { background: var(--red); width: 10px; }
.rrow.c::before { background: var(--amber); }
.rrow .n { font-size: 25px; font-weight: 700; white-space: nowrap; }
.rrow .d { font-size: 17px; color: #d0d0d0; margin-top: 1px; }
.rrow.sel { outline: 3px solid #fff; outline-offset: -3px; }

/* pages */
.pages { position: absolute; left: 0; right: 0; top: 0; height: calc(800px - var(--bar)); background: rgba(0,0,0,.92); padding: 14px 16px; }
.pagehead { display: flex; gap: 10px; margin-bottom: 10px; }
.pagehead div { flex: 1; height: 62px; background: #1c1c1c; border: 1px solid #5c5c5c; border-radius: 6px;
  display: flex; align-items: center; justify-content: center; font-size: 21px; font-weight: 700; position: relative; }
.pagehead div.lit::before { content: ""; position: absolute; left: 12px; top: 18px; bottom: 18px; width: 8px; background: var(--lamp); border-radius: 3px; }
.grid { display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(4, 140px); gap: 8px; }
.grid div { background: #1c1c1c; border: 1px solid #5c5c5c; border-radius: 6px; display: flex; align-items: center;
  justify-content: center; font-size: 24px; font-weight: 700; position: relative; }
.grid div.on::before { content: ""; position: absolute; left: 14px; right: 14px; top: 8px; height: 6px; background: var(--lamp); border-radius: 3px; }
.grid div.sel { border: 4px solid #fff; }

.blank { position: absolute; inset: 0; background: #0b0b0b; }
"""

KEYS = ["PFD", "MAP", "ENGINE", "TRAFFIC", "NAV", "PAGES", "BACK", "ALERTS"]
SUBS = {"PFD": "GS 265", "ENGINE": "OIL 180", "TRAFFIC": "3 near", "NAV": "TRK 191"}

TAP = "TAP or PRESS<br>to ACK"


def softbar(current="PFD", alert="", label="ALERTS", sub="0"):
    out = ['<div class="softbar">']
    for key in KEYS:
        cls, text, small = "k", key, SUBS.get(key, "")
        if key == current:
            cls += " on"
        if key == "ALERTS":
            cls += " " + alert
            text, small = label, sub
        out.append('<div class="%s">%s<small>%s</small></div>' % (cls, text, small))
    return "".join(out) + "</div>"


def pop(level, title, sub, more=""):
    tag = {"w": "WARNING", "c": "CAUTION"}[level]
    extra = '<div class="more">%s</div>' % more if more else ""
    return ('<div class="pop %s"><div class="tag">%s</div><div class="txt"><div class="t">%s</div>'
            '<div class="s">%s</div></div><div class="hint">%s</div>%s'
            '<div class="count" style="width:62%%"></div></div>') % (level, tag, title, sub, TAP, extra)


def cap(level, title, sub):
    tag = {"w": "WARNING", "c": "CAUTION"}[level]
    hint = '<div class="hint">TAP or PRESS to ACK</div>' if level == "w" else ""
    return ('<div class="cap %s"><div class="count" style="width:62%%"></div><div class="tag">%s</div>'
            '<div class="t">%s</div><div class="s">%s</div>%s</div>') % (level, tag, title, sub, hint)


HANDLE = '<div class="handle"><i></i></div>'
MASK = '<div class="mask"></div>'


def ring_panel():
    out = ['<div class="dim"></div>']
    order = KEYS  # same order as the soft bar, clockwise from half past one
    for i, key in enumerate(order):
        angle = math.radians(-45 + 45 * i)
        x, y = 240 + 168 * math.cos(angle) - 55, 240 + 168 * math.sin(angle) - 55
        cls = "dot"
        if key == "PFD":
            cls += " on sel"
        if key == "ALERTS":
            cls += " w"
        out.append('<div class="%s" style="left:%.0fpx;top:%.0fpx">%s</div>' % (cls, x, y, key))
    out.append('<div class="hub">ATTITUDE<small>CLOSE</small></div>')
    return "".join(out)


def wide_list():
    rows = [
        ("ACTIVE (2)", None),
        ("w", "OIL TEMP 262 °F", "Above red limit 248 °F", "NOT ACK", "+00:42", "sel"),
        ("c", "CHT MAX 372 °F", "Yellow above 356 °F", "ACK", "+03:10", ""),
        ("HISTORY", None),
        ("c", "Radio Freq. Set Active fail", "Cleared after 0:12", "CLEARED", "+12:40", "old"),
        ("a", "Abeam: LIRQ", "Autopilot point reached", "", "+18:05", "old"),
        ("a", "Timer 1 fired", "", "", "+24:31", "old"),
        ("a", "Startup", "System up and running", "", "+41:07", "old"),
    ]
    out = ['<div class="list wide-list">']
    tags = {"w": "WARNING", "c": "CAUTION", "a": "INFO"}
    for row in rows:
        if row[1] is None:
            out.append('<div class="sec">%s</div>' % row[0])
            continue
        lvl, name, det, state, age, cls = row
        out.append('<div class="row %s"><b class="%s">%s</b><div class="n">%s</div><div class="d">%s</div>'
                   '<div class="st">%s</div><div class="age">%s</div></div>'
                   % (cls, lvl, tags[lvl], name, det, state, age))
    return "".join(out) + "</div>"


def round_list():
    rows = [("w", "OIL TEMP 262 °F", "ACTIVE · NOT ACK · +00:42", "sel"),
            ("c", "CHT MAX 372 °F", "ACTIVE · ACK · +03:10", ""),
            ("c", "Radio Freq. Set fail", "CLEARED · +12:40", ""),
            ("a", "Abeam: LIRQ", "+18:05", "")]
    out = ['<div class="list rlist"><div class="rhead">ALERTS 2 ACTIVE</div>']
    for i, (lvl, name, det, cls) in enumerate(rows):
        out.append('<div class="rrow %s %s" style="top:%dpx"><div class="n">%s</div><div class="d">%s</div></div>'
                   % (lvl, cls, 66 + i * 82, name, det))
    return "".join(out) + "</div>"


def wheel():
    return ('<div class="dim" style="background:rgba(0,0,0,.92)"></div>'
            '<div class="wheel top">SPEED</div><div class="wheel mid">ATTITUDE</div>'
            '<div class="wheel bot">ALTIMETER</div>')


def pages():
    names = ["AIRCRAFT", "RESOURCES", "SIX PACK", "G METER", "SYNTH VIEW", "AIRFIELDS", "AUTOPILOT",
             "TIMERS", "ENGINE", "EGT / CHT", "RADIO", "CAMERA", "CHECKLIST", "ALERTS", "CHARTS",
             "SWITCHBOARD", "VOICE", "MAP", "RADAR"]
    cells = "".join('<div class="%s">%s</div>' % ("on sel" if n == "SIX PACK" else "", n) for n in names)
    head = ('<div class="pagehead"><div class="lit">LEFT PANEL</div><div>RIGHT PANEL</div>'
            '<div>FULL SCREEN</div></div>')
    return '<div class="pages">%s<div class="grid">%s</div></div>' % (head, cells)


ROUND = {
    "round-warning": ("attitude", cap("w", "OIL TEMP 262 °F", "Above red limit 248 °F") + '<div class="ring"></div>'),
    "round-caution": ("emsegt", cap("c", "CHT MAX 372 °F", "Yellow above 356 °F") + '<div class="ring c"></div>'),
    "round-advisory": ("hsi", '<div class="pill">Timer 1 fired</div>' + HANDLE),
    "round-annunciator": ("speed", '<div class="ring"></div><div class="chip w">OIL TEMP</div>'),
    "round-panel": ("attitude", ring_panel()),
    "round-pages": ("attitude", wheel()),
    "round-list": ("attitude", round_list() + HANDLE),
}

WIDE = {
    "wide-warning": ("sixpack", True, pop("w", "OIL TEMP 262 °F", "Above red limit 248 °F") + '<div class="frame"></div>'
                     + softbar("PFD", "w", "ACK", "1 warning")),
    "wide-caution": ("synthview", False, pop("c", "CHT MAX 372 °F", "Yellow above 356 °F", "+2 more")
                     + softbar("PFD", "c", "ACK", "3 caution")),
    "wide-advisory": ("map", False, '<div class="pop a"><div class="txt"><div class="t">Abeam: LIRQ</div></div></div>'
                      + softbar("MAP")),
    "wide-annunciator": ("sixpack", False, softbar("PFD", "outw", "ALERTS", "OIL TEMP")),
    "wide-list": ("sixpack", False, wide_list() + softbar("ALERTS", "outw", "ALERTS", "2 active")),
    "wide-pages": ("sixpack", False, pages() + softbar("PAGES")),
}


# The balloon as built: a real alert down the real socket, nothing injected
BALLOONS = {
    "balloon-round-danger": (480, "attitude", 15, "OILAVG red 125"),
    "balloon-round-warning": (480, "emsegt", 14, "CHTMAX yellow 190"),
    "balloon-round-info": (480, "hsi", 2, "Timer 1 fired"),
    "balloon-wide-danger": (1280, "sixpack", 15, "OILAVG red 125"),
    "balloon-wide-info": (1280, "map", 10, "Abeam: LIRQ"),
}


def boot(width, height, cls):
    d = Display(window="%d,%d" % (width, height))
    d.__enter__()
    d.page.ws.sock.settimeout(120)  # capturing the WebGL synthview is slow without a GPU
    d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                deviceScaleFactor=1, mobile=False)
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
    d.page.pump(1.0)
    if cls:
        d.page.eval("(css => { const s = document.createElement('style'); s.textContent = css;"
                    " document.head.appendChild(s); document.body.classList.add(%r); })(%r)" % (cls, CSS))
    return d, d.replay(FLIGHT, start=120.0)


def snap(d, replay, plate, html, path):
    if plate:
        d.show(plate, None, timeout=15)
        replay.step(5)
        d.page.pump(2.2)
    d.page.eval("document.getElementById('alertsModal').innerHTML = %r" % html)
    d.page.pump(0.2)
    d.page.screenshot(path)


def finish_round(path):
    img = Image.open(path).convert("RGBA")
    mask = Image.new("L", (960, 960), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, 959, 959), fill=255)
    img.putalpha(mask.resize(img.size, Image.LANCZOS))
    img.quantize(colors=200, method=Image.FASTOCTREE).save(path, optimize=True)


def finish_wide(path):
    Image.open(path).convert("RGB").quantize(colors=200).save(path, optimize=True)


def key_states(path):
    """One strip of the ALERTS key in each state, cropped from a rendered bar."""
    states = [("", "ALERTS", "0"), ("w", "ACK", "1 warning"), ("outw", "ALERTS", "OIL TEMP"),
              ("c", "ACK", "1 caution"), ("outc", "ALERTS", "CHT MAX")]
    d, _ = boot(1280, 800, "wide")
    try:
        html = '<div class="blank"></div><div class="softbar">%s</div>' % "".join(
            '<div class="k %s">%s<small>%s</small></div>' % s for s in states)
        snap(d, None, None, html, path)
    finally:
        d.__exit__(None, None, None)
    Image.open(path).convert("RGB").crop((0, 704, 800, 800)).quantize(colors=64).save(path, optimize=True)


def balloons(run):
    for width, finish in ((480, finish_round), (1280, finish_wide)):
        scenes = {n: s for n, s in BALLOONS.items() if s[0] == width and run(n)}
        if not scenes:
            continue
        d, replay = boot(width, 480 if width == 480 else 800, None)
        try:
            d.page.wait("(s => !!s.alertsSocket && s.alertsSocket.readyState == 1"
                        " && Object.keys(s.alertsMapping).length > 0)"
                        "(angular.element(document.body).scope())", timeout=15, label="alerts")
            for name, (_, plate, kind, title) in scenes.items():
                d.show(plate, None, timeout=15)
                replay.step(5)
                d.page.pump(2.2)
                d.srv.push("/alerts", {"Type": kind, "Title": title,
                                       "Timestamp": "2026-11-04T10:00:00Z"})
                d.page.pump(0.3)
                path = os.path.join(HERE, name + ".png")
                d.page.screenshot(path)
                d.page.eval("(b => b && b.click())(document.querySelector('.alertsballoon'))")
                finish(path)
                print(name)
        finally:
            d.__exit__(None, None, None)


def main():
    wanted = set(sys.argv[1:])
    run = lambda name: not wanted or name in wanted
    if any(run(n) for n in ROUND):
        d, replay = boot(480, 480, "round")
        try:
            for name, (plate, html) in ROUND.items():
                if run(name):
                    path = os.path.join(HERE, name + ".png")
                    snap(d, replay, plate, html + MASK, path)
                    finish_round(path)
                    print(name)
        finally:
            d.__exit__(None, None, None)
    if any(run(n) for n in WIDE):
        d, replay = boot(1280, 800, "wide")
        try:
            for name, (plate, panels, html) in WIDE.items():
                if run(name):
                    d.page.eval("(on => { const u = angular.element(document.body).scope().Ui;"
                                " u[on ? 'turnOn' : 'turnOff']('uiSidebarLeft');"
                                " u[on ? 'turnOn' : 'turnOff']('uiSidebarRight'); })(%s)"
                                % ("true" if panels else "false"))
                    path = os.path.join(HERE, name + ".png")
                    snap(d, replay, plate, html, path)
                    finish_wide(path)
                    print(name)
        finally:
            d.__exit__(None, None, None)
    balloons(run)
    if run("alerts-key-states"):
        path = os.path.join(HERE, "alerts-key-states.png")
        key_states(path)
        print("alerts-key-states")


if __name__ == "__main__":
    main()
