"""Minimal Chrome DevTools Protocol client, Python standard library only.

Speaks just enough WebSocket to drive Chromium: no node, no pip, no Selenium.
Works against a headless Chrome started by launch(), or against the real
Chromium on an RB-01 display started with --remote-debugging-port.
"""

import base64
import json
import os
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request


class BrowserGone(RuntimeError):
    """Chrome closed the DevTools socket: it crashed, was killed, or ran out of
    memory. Raised instead of a raw socket error so a test can tell "the
    display is broken" apart from "the browser died under me"."""


class WebSocket:
    """RFC6455 client: text frames, masking, fragmentation, ping/pong."""

    def __init__(self, url, timeout=30.0):
        _, _, rest = url.partition("://")
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)), timeout=timeout)
        self.sock.settimeout(timeout)
        self.buf = b""

        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (
            "GET /%s HTTP/1.1\r\n"
            "Host: %s\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n" % (path, hostport, key)
        )
        self.sock.sendall(handshake.encode())
        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("websocket handshake closed early")
            self.buf += chunk
        head, _, self.buf = self.buf.partition(b"\r\n\r\n")
        if b"101" not in head.split(b"\r\n")[0]:
            raise RuntimeError("websocket handshake failed: %s" % head[:120])

    def _read(self, n):
        while len(self.buf) < n:
            try:
                chunk = self.sock.recv(max(4096, n - len(self.buf)))
            except (socket.timeout, TimeoutError):
                raise                       # pump() relies on these; not a dead browser
            except OSError as exc:
                raise BrowserGone("Chrome connection lost while reading: %s" % exc) from None
            if not chunk:
                raise BrowserGone("Chrome closed the DevTools socket")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text):
        payload = text.encode()
        header = bytearray([0x81])  # FIN + text
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        try:
            self.sock.sendall(bytes(header) + masked)
        except (socket.timeout, TimeoutError):
            raise
        except OSError as exc:
            raise BrowserGone("Chrome connection lost while sending: %s" % exc) from None

    def recv(self):
        """Return one complete text message, reassembling fragments."""
        chunks = []
        while True:
            b0, b1 = self._read(2)
            fin, opcode = b0 & 0x80, b0 & 0x0F
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            if b1 & 0x80:  # server frames should not be masked, but be tolerant
                mask = self._read(4)
                data = bytes(c ^ mask[i % 4] for i, c in enumerate(self._read(n)))
            else:
                data = self._read(n)

            if opcode == 0x9:      # ping -> pong
                self.sock.sendall(b"\x8a\x80" + os.urandom(4))
                continue
            if opcode == 0xA:      # pong
                continue
            if opcode == 0x8:
                raise BrowserGone("Chrome closed the DevTools socket (close frame)")
            chunks.append(data)
            if fin:
                return b"".join(chunks).decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class Chrome:
    """A CDP session against one page target."""

    def __init__(self, ws_url, timeout=30.0):
        self.ws = WebSocket(ws_url, timeout)
        self.next_id = 0
        self.events = []
        self.console = []
        self.errors = []
        self.proc = None
        self.send("Runtime.enable")
        self.send("Page.enable")
        self.send("Log.enable")

    # -- lifecycle -----------------------------------------------------
    @classmethod
    def launch(cls, port=0, window="1280,800", extra=None, binary=None):
        """Start a headless Chrome. port=0 (the default) picks a free one, so
        concurrent or overlapping runs can never fight over the debug port or the
        profile directory keyed to it."""
        binary = binary or _find_chrome()
        if not port:
            port = _free_port()
        args = [
            binary,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu-sandbox",
            "--use-gl=swiftshader",
            "--enable-unsafe-swiftshader",
            "--hide-scrollbars",
            "--remote-debugging-port=%d" % port,
            "--remote-allow-origins=*",
            "--window-size=%s" % window,
            "--user-data-dir=%s" % _tmp_profile(port),
            "about:blank",
        ] + (extra or [])
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        session = cls.attach(port)
        session.proc = proc
        return session

    @classmethod
    def attach(cls, port=9222, timeout=25.0):
        """Attach to an already-running Chrome, e.g. the RB-01 display."""
        deadline = time.time() + timeout
        last = None
        base = "http://127.0.0.1:%d" % port
        while time.time() < deadline:
            # Prefer an existing page target; /json/new needs PUT on modern Chrome
            # and is refused outright by some builds.
            try:
                raw = urllib.request.urlopen(base + "/json/list", timeout=3).read()
                for target in json.loads(raw):
                    if target.get("type") == "page" and target.get("webSocketDebuggerUrl"):
                        return cls(target["webSocketDebuggerUrl"])
            except Exception as exc:          # noqa: BLE001 - browser still booting
                last = exc
            try:
                request = urllib.request.Request(
                    base + "/json/new?about:blank", method="PUT")
                raw = urllib.request.urlopen(request, timeout=3).read()
                return cls(json.loads(raw)["webSocketDebuggerUrl"])
            except Exception as exc:          # noqa: BLE001
                last = exc
            time.sleep(0.3)
        raise RuntimeError("could not reach Chrome on :%d (%s)" % (port, last))

    def close(self):
        """Tear down without ever raising - this runs from __exit__, on top of
        whatever the test already failed with."""
        try:
            self.ws.close()
        except Exception:                   # noqa: BLE001
            pass
        if self.proc is not None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            except OSError:
                pass
            self.proc = None

    @property
    def alive(self):
        """False once the Chrome we launched has exited."""
        return self.proc is None or self.proc.poll() is None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # -- protocol ------------------------------------------------------
    def send(self, method, **params):
        self.next_id += 1
        msg_id = self.next_id
        self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == msg_id:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})
            self._record(msg)

    def _record(self, msg):
        method = msg.get("method", "")
        self.events.append(msg)
        if method == "Runtime.consoleAPICalled":
            kind = msg["params"].get("type", "log")
            text = " ".join(str(a.get("value", a.get("description", "")))
                            for a in msg["params"].get("args", []))
            self.console.append((kind, text))
            # AngularJS traps exceptions thrown inside ng-click/$apply and hands
            # them to $exceptionHandler, which just calls console.error. Without
            # this, a broken button looks completely clean to a test.
            if kind == "error":
                self.errors.append(text)
        elif method == "Runtime.exceptionThrown":
            detail = msg["params"]["exceptionDetails"]
            self.errors.append(detail.get("exception", {}).get("description")
                               or detail.get("text", "exception"))
        elif method == "Log.entryAdded":
            entry = msg["params"]["entry"]
            if entry.get("level") == "error":
                self.errors.append(entry.get("text", ""))

    def pump(self, seconds):
        """Drain events for a while, so console/errors stay current."""
        end = time.time() + seconds
        self.ws.sock.settimeout(0.2)
        try:
            while time.time() < end:
                try:
                    self._record(json.loads(self.ws.recv()))
                except (socket.timeout, TimeoutError):
                    pass
        finally:
            self.ws.sock.settimeout(30.0)

    # -- page ----------------------------------------------------------
    def goto(self, url, wait=True):
        self.send("Page.navigate", url=url)
        if wait:
            self.wait("document.readyState === 'complete'", timeout=30)

    def eval(self, expression, await_promise=False):
        res = self.send("Runtime.evaluate", expression=expression,
                        returnByValue=True, awaitPromise=await_promise)
        if res.get("exceptionDetails"):
            raise RuntimeError("eval failed: %s" %
                               res["exceptionDetails"].get("text", expression))
        return res.get("result", {}).get("value")

    def wait(self, expression, timeout=20.0, interval=0.15, label=None):
        """Poll a JS expression until truthy. Returns its value."""
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            try:
                last = self.eval(expression)
                if last:
                    return last
            except RuntimeError as exc:
                last = str(exc)
            time.sleep(interval)
        raise TimeoutError("timed out waiting for %s (last=%r)" %
                           (label or expression, last))

    def screenshot(self, path):
        data = self.send("Page.captureScreenshot", format="png")["data"]
        with open(path, "wb") as handle:
            handle.write(base64.b64decode(data))
        return path

    def click(self, selector):
        box = self.eval("""(() => {
            const el = document.querySelector(%s);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: r.left + r.width/2, y: r.top + r.height/2};
        })()""" % json.dumps(selector))
        if not box:
            raise RuntimeError("no element matches %s" % selector)
        for kind in ("mousePressed", "mouseReleased"):
            self.send("Input.dispatchMouseEvent", type=kind, x=box["x"], y=box["y"],
                      button="left", clickCount=1)

    def key(self, key_name):
        """Send a raw key, for the RB-01 hardware keypad events."""
        for kind in ("keyDown", "keyUp"):
            self.send("Input.dispatchKeyEvent", type=kind, key=key_name)


def _find_chrome():
    for name in ("google-chrome", "chromium-browser", "chromium",
                 "google-chrome-stable"):
        for directory in os.environ.get("PATH", "").split(os.pathsep):
            candidate = os.path.join(directory, name)
            if os.access(candidate, os.X_OK):
                return candidate
    raise RuntimeError("no chrome/chromium binary found on PATH")


def _free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _tmp_profile(port):
    # Keyed by pid as well as port: a profile still locked by a dying Chrome from
    # a previous run would otherwise make the new one refuse to start.
    path = os.path.join(tempfile.gettempdir(), "rb01-cdp-%d-%d" % (os.getpid(), port))
    os.makedirs(path, exist_ok=True)
    return path
