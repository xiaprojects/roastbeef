"""Shared helpers for RB-01 display tests."""

import json
import os
import time

from cdp import Chrome
from rbserver import FakeStratux

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.environ.get("RB_WEB", os.path.join(_REPO, "web"))
SHOTS = os.environ.get("RB_SHOTS", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots"))
# Three minutes of a real flight (take-off, climb, a 180 turn, ~20 targets, EMS)
# cut from a datalog.go recording - see `python3 flightlog.py info` on it.
FLIGHT = os.environ.get("RB_FLIGHT", os.path.join(_REPO, "test-data", "flightlog-sample.sqlite"))

# Errors that are environmental rather than a real display fault.
IGNORED_ERRORS = ("favicon", "net::ERR_ABORTED")


def moved_pixels(a, b, tolerance=12):
    """Count pixels that differ between two screenshots.

    Uses Pillow when it is installed (fast, C) and falls back to a small
    standard-library PNG decoder when it is not, so the suite still runs on a
    stock Pi or a bare CI runner - just slower. Chrome writes plain 8-bit
    RGB/RGBA non-interlaced PNGs, which is all the fallback needs to handle.
    """
    try:
        from PIL import Image, ImageChops
    except ImportError:
        return _moved_pixels_stdlib(a, b, tolerance)
    left, right = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if left.size != right.size:
        return -1
    diff = ImageChops.difference(left, right)
    return sum(1 for px in diff.getdata() if sum(px) > tolerance)


def _png_rgb(path):
    """Decode a PNG to (width, height, bytes of packed RGB). Standard library only."""
    import struct
    import zlib
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("%s is not a PNG" % path)
    pos, idat, width = 8, [], None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, ctype, _c, _f, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or ctype not in (2, 6) or interlace:
                raise ValueError("unsupported PNG (depth %d, colour %d, interlace %d)"
                                 % (depth, ctype, interlace))
            bpp = 4 if ctype == 6 else 3
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
    raw = zlib.decompress(b"".join(idat))
    stride = width * bpp
    prev = bytearray(stride)
    out = bytearray()
    for row in range(height):
        start = row * (stride + 1)
        ftype = raw[start]
        cur = bytearray(raw[start + 1:start + 1 + stride])
        if ftype == 1:        # Sub
            for i in range(bpp, stride):
                cur[i] = (cur[i] + cur[i - bpp]) & 0xFF
        elif ftype == 2:      # Up
            for i in range(stride):
                cur[i] = (cur[i] + prev[i]) & 0xFF
        elif ftype == 3:      # Average
            for i in range(stride):
                left = cur[i - bpp] if i >= bpp else 0
                cur[i] = (cur[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:      # Paeth
            for i in range(stride):
                a_ = cur[i - bpp] if i >= bpp else 0
                b_ = prev[i]
                c_ = prev[i - bpp] if i >= bpp else 0
                p = a_ + b_ - c_
                pa, pb, pc = abs(p - a_), abs(p - b_), abs(p - c_)
                pred = a_ if (pa <= pb and pa <= pc) else (b_ if pb <= pc else c_)
                cur[i] = (cur[i] + pred) & 0xFF
        elif ftype != 0:
            raise ValueError("bad PNG filter %d" % ftype)
        if bpp == 4:
            out += bytes(cur[i] for i in range(stride) if i % 4 != 3)   # drop alpha
        else:
            out += cur
        prev = cur
    return width, height, bytes(out)


def _moved_pixels_stdlib(a, b, tolerance):
    wa, ha, ra = _png_rgb(a)
    wb, hb, rb = _png_rgb(b)
    if (wa, ha) != (wb, hb):
        return -1
    moved = 0
    for i in range(0, len(ra), 3):
        if (abs(ra[i] - rb[i]) + abs(ra[i + 1] - rb[i + 1])
                + abs(ra[i + 2] - rb[i + 2])) > tolerance:
            moved += 1
    return moved


class Result:
    def __init__(self):
        self.checks = []

    def check(self, cond, label, extra=""):
        self.checks.append((bool(cond), label, extra))
        print("  %s %s%s" % ("PASS" if cond else "FAIL", label,
                             ("  [" + str(extra) + "]") if extra else ""))
        return bool(cond)

    @property
    def failed(self):
        return [c for c in self.checks if not c[0]]


class Display:
    """A booted RB-01 HMI with a fake backend behind it."""

    def __init__(self, port=0, window="1024,768", **backend):
        self.srv = FakeStratux(WEB, **backend)
        self.port = port
        self.window = window
        self.page = None

    def __enter__(self):
        self.srv.start()
        self.page = Chrome.launch(port=self.port, window=self.window)
        self.page.goto(self.srv.url + "/RB-01/index.html")
        self.page.wait("typeof angular !== 'undefined'", timeout=25,
                       label="angular bootstrap")
        return self

    def __exit__(self, *exc):
        if self.page:
            self.page.close()
        self.srv.stop()

    # -- navigation ----------------------------------------------------
    def show(self, plate, ready=None, timeout=25):
        """Switch to a plate and wait for its root element."""
        self.page.eval("window.location.hash = '#/%s'" % plate)
        if ready:
            self.page.wait("!!document.querySelector(%r)" % ready,
                           timeout=timeout, label="%s root (%s)" % (plate, ready))
        self.page.pump(0.4)
        return self

    def fly(self, frames=6, interval=0.3, **start):
        """Push a run of situation frames so websocket-driven plates redraw."""
        for i in range(frames):
            step = {k: (v[0] + v[1] * i if isinstance(v, tuple) else v)
                    for k, v in start.items()}
            self.srv.push_situation(**step)
            time.sleep(interval)
        self.page.pump(0.5)
        return self

    def replay(self, log=FLIGHT, start=0.0, end=None, streams=None):
        """Replay a recorded flight (a FlightLog or its path) from `start` log seconds.

        Returns the Replay, positioned but not yet running: call `step(seconds)`
        for a deterministic advance or `play(speed)` for real time. The display
        is first jumped to the flight's state at `start`, so a plate already on
        screen does not ease in from the default 45N/10E situation.
        """
        rp = self.srv.start_replay(log, start, end, streams)
        self.page.pump(0.2)
        return rp

    def shot(self, name):
        os.makedirs(SHOTS, exist_ok=True)
        path = os.path.join(SHOTS, "%s.png" % name)
        self.page.screenshot(path)
        return path

    def settle(self, timeout=15.0, quiet=200, interval=0.8, republish=None):
        """Block until the display stops changing.

        The svg.js instruments ease toward a new value over several seconds, so a
        fixed sleep either flakes or wastes time. Poll the pixels instead and
        return as soon as two consecutive frames agree.
        """
        os.makedirs(SHOTS, exist_ok=True)
        a = os.path.join(SHOTS, "_settle_a.png")
        b = os.path.join(SHOTS, "_settle_b.png")
        start = time.time()
        self.page.screenshot(a)
        while time.time() - start < timeout:
            time.sleep(interval)
            if republish:
                self.srv.push_situation(**republish)
            self.page.pump(0.2)
            self.page.screenshot(b)
            if moved_pixels(a, b) <= quiet:
                return time.time() - start
            a, b = b, a
        return time.time() - start

    # -- assertions ----------------------------------------------------
    def js_errors(self):
        return [e for e in self.page.errors
                if not any(tok in e.lower() for tok in IGNORED_ERRORS)]

    # -- interactive controls ------------------------------------------
    def controls(self):
        """Every visible ng-click control on the current plate.

        `reachable` reports whether a touch at the control's centre would
        actually land on it - on a touchscreen HMI a control covered by an
        overlay is just as broken as one that throws.
        """
        return self.page.eval("""(() => {
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;
            // The navbar, sidebars and corner FABs are shared chrome present on
            // every plate. Tagging them lets a caller test them once instead of
            // re-clicking the same buttons on all 28 screens.
            const view = document.querySelector('[ui-view]');
            // mobile-angular-ui keeps a closed sidebar laid out beneath .app
            // (it slides into view rather than being displayed), so a control
            // in it has a size and an offsetParent but cannot be touched until
            // the sidebar is opened - by design, not an overlay defect. The
            // ng-app element carries sidebar-left-in / sidebar-right-in while
            // one is open.
            const root = document.querySelector('[ng-app]') || document.body;
            const sidebarOpen = {left: root.classList.contains('sidebar-left-in'),
                                 right: root.classList.contains('sidebar-right-in')};
            return [...document.querySelectorAll('[ng-click]')].map((el, i) => {
                const r = el.getBoundingClientRect();
                const cx = r.left + r.width/2, cy = r.top + r.height/2;
                const sb = el.closest('.sidebar');
                const side = sb ? (sb.classList.contains('sidebar-left') ? 'left' : 'right') : null;
                const inClosedSidebar = !!side && !sidebarOpen[side];
                const visible = r.width > 0 && r.height > 0 && el.offsetParent !== null
                                && !inClosedSidebar;
                // Outside the viewport just means it needs scrolling to - that is
                // normal in a scrollable panel and is NOT an overlay defect.
                const onscreen = cx >= 0 && cy >= 0 && cx < vw && cy < vh;
                let hit = null, covered = false;
                if (visible && onscreen) {
                    hit = document.elementFromPoint(cx, cy);
                    covered = !(!!hit && (hit === el || el.contains(hit) || hit.contains(el)));
                }
                return {
                    index: i,
                    expr: (el.getAttribute('ng-click') || '').slice(0, 60),
                    label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
                    x: Math.round(cx), y: Math.round(cy),
                    w: Math.round(r.width), h: Math.round(r.height),
                    visible: visible, onscreen: onscreen,
                    scope: (view && view.contains(el)) ? 'plate' : 'chrome',
                    sidebar: side,
                    reachable: visible && onscreen && !covered,
                    covered: covered,
                    covering: covered && hit
                        ? (hit.tagName + (hit.id ? '#' + hit.id : '') + '.' +
                           String(hit.className || '').split(' ')[0]).slice(0, 40)
                        : null
                };
            });
        })()""") or []

    def click_control(self, index):
        """Real mouse click at the control's centre, like a finger would."""
        box = self.page.eval("""(() => {
            const el = document.querySelectorAll('[ng-click]')[%d];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: r.left + r.width/2, y: r.top + r.height/2};
        })()""" % index)
        return self._click_at(box)

    def click_expr(self, expr, nth=0):
        """Click the nth visible control whose ng-click matches `expr`.

        Indices shift whenever a click re-renders the plate, so addressing a
        control by what it does is far more reliable than by position.
        """
        box = self.page.eval("""(() => {
            const want = %s, nth = %d;
            const hits = [...document.querySelectorAll('[ng-click]')].filter(el => {
                const r = el.getBoundingClientRect();
                return (el.getAttribute('ng-click') || '').slice(0, 60) === want
                       && r.width > 0 && r.height > 0 && el.offsetParent !== null;
            });
            const el = hits[nth];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: r.left + r.width/2, y: r.top + r.height/2};
        })()""" % (json.dumps(expr), nth))
        return self._click_at(box)

    def _click_at(self, box):
        if not box:
            return False
        for kind in ("mousePressed", "mouseReleased"):
            self.page.send("Input.dispatchMouseEvent", type=kind,
                           x=box["x"], y=box["y"], button="left", clickCount=1)
        return True

    def keypad(self, key):
        """Fire a hardware-keypad event, as services/servicekeypad.js does."""
        self.page.eval("dispatchEvent(new KeyboardEvent('keypad', {key: %r}))" % key)
        self.page.pump(0.25)

    def hash(self):
        return self.page.eval("window.location.hash") or ""

    def instrument_three(self):
        """Expose the three.js scene and tag guidance-tunnel frames."""
        self.page.eval("""
            window.__rbScene = null; window.__rbTunnelGroups = 0;
            (function(){
                const add = THREE.Object3D.prototype.add;
                THREE.Object3D.prototype.add = function(o){
                    if (o && o.type === 'Group' && o.children.length &&
                        o.children[0].material &&
                        o.children[0].material.depthWrite === false &&
                        o.children[0].geometry &&
                        o.children[0].geometry.type === 'ShapeGeometry') {
                        o.children.forEach(c => c.userData.rbGuidance = true);
                        window.__rbTunnelGroups++;
                    }
                    if (this.type === 'Scene') window.__rbScene = this;
                    return add.call(this, o);
                };
            })();
        """)
        return self
