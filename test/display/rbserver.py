"""Fake Stratux backend for RB-01 display tests. Standard library only.

The RB-01 HMI reads nothing but static files and the service WebSockets, so
replaying those is enough to drive any plate deterministically: no Go daemon,
no GPS, no SDR, no radio.

    srv = FakeStratux(web_dir, route=[...], situation={...})
    srv.start()
    ... drive Chromium at srv.url ...
    srv.stop()

A recorded flight (see flightlog.py) is replayed through the same sockets:

    rp = srv.start_replay(FlightLog("test-data/flightlog-sample.sqlite"), start=120)
    rp.step(30)            # push the next 30 s of the log, right now
    rp.play(speed=10)      # ...or let it run in the background at 10x

For development against the installed aircraft, `upstream=` turns the same
server into a proxy: files in the working tree are served from here, every
other GET and every WebSocket is bridged to the aircraft, and writes are
refused (403) unless `allow_writes=True`.

    srv = FakeStratux(web_dir, upstream="http://192.168.10.1")

Either way, `POST /sim/...` lets a shell or the /sim/ page drive the sockets:
see `_sim()` for the endpoints.
"""

import base64
import hashlib
import json
import os
import re
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from cdp import WebSocket

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# What a real RB-01 answered to every GET the HMI makes, captured by capture.py.
# Served by default so the plates see real settings, gauge limits and resources
# rather than empty placeholders. Constructor arguments still win over it.
HERE = os.path.dirname(os.path.abspath(__file__))
DEVICE = os.path.join(HERE, "fixtures", "rb01-device.json")
# The control page served at /sim/ (sliders and replay buttons for desk work)
SIM_PANEL = os.path.join(HERE, "simpanel.html")

# Every socket a service in web/RB-01/services/ opens. Unlisted ones make the
# services retry once a second and flood the console, which would drown the
# errors a test is actually looking for.
WS_PATHS = ("/situation", "/traffic", "/status", "/autopilot", "/alerts",
            "/radar", "/ems", "/keypad", "/radioStatus", "/bridge/float/ws",
            "/gdl90", "/weather")

DEFAULT_SITUATION = {
    "GPSLastFixSinceMidnightUTC": 43200, "GPSLatitude": 45.0, "GPSLongitude": 10.0,
    "GPSFixQuality": 2, "GPSHeightAboveEllipsoid": 3000, "GPSGeoidSep": 100,
    "GPSSatellites": 12, "GPSSatellitesTracked": 14, "GPSSatellitesSeen": 14,
    "GPSHorizontalAccuracy": 3.0, "GPSNACp": 10, "GPSAltitudeMSL": 5000.0,
    "GPSVerticalAccuracy": 4.0, "GPSVerticalSpeed": 0.0, "GPSTrueCourse": 0.0,
    "GPSTurnRate": 0.0, "GPSGroundSpeed": 110.0, "GPSLastGroundTrackTime": 0,
    "BaroTemperature": 15.0, "BaroPressureAltitude": 5000.0,
    "BaroVerticalSpeed": 0.0, "BaroSourceType": 1,
    "AHRSPitch": 0.0, "AHRSRoll": 0.0, "AHRSGyroHeading": 0.0,
    "AHRSMagHeading": 0.0, "AHRSSlipSkid": 0.0, "AHRSTurnRate": 0.0,
    "AHRSGLoad": 1.0, "AHRSGLoadMin": 1.0, "AHRSGLoadMax": 1.0, "AHRSStatus": 7,
}


def _deep_merge(base, overrides):
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


def _accept_key(key):
    digest = hashlib.sha1((key + WS_GUID).encode()).digest()
    return base64.b64encode(digest).decode()


def _frame(text):
    """Server -> client text frame: FIN + opcode 1, never masked."""
    payload = text.encode()
    n = len(payload)
    if n < 126:
        header = struct.pack(">BB", 0x81, n)
    elif n < 65536:
        header = struct.pack(">BBH", 0x81, 126, n)
    else:
        header = struct.pack(">BBQ", 0x81, 127, n)
    return header + payload


def _load_device(path):
    """The capture.py fixture, or an empty one when there is none (or None is passed)."""
    if path and os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)
    return {"get": {}, "files": {}}


def _read_client_frame(sock, buf):
    """Read one text message the browser sent (masked client frames), answering
    pings. Returns (message, buf); message is None when the browser closed."""
    def need(n):
        while len(buf[0]) < n:
            chunk = sock.recv(max(4096, n - len(buf[0])))
            if not chunk:
                raise ConnectionError("closed")
            buf[0] += chunk
        out, buf[0] = buf[0][:n], buf[0][n:]
        return out

    chunks = []
    while True:
        b0, b1 = need(2)
        fin, opcode, n = b0 & 0x80, b0 & 0x0F, b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", need(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", need(8))[0]
        mask = need(4) if b1 & 0x80 else None
        data = need(n)
        if mask:
            data = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
        if opcode == 0x8:
            return None, buf
        if opcode == 0x9:
            sock.sendall(b"\x8a" + bytes([len(data)]) + data)
            continue
        if opcode == 0xA:
            continue
        chunks.append(data)
        if fin:
            return b"".join(chunks).decode("utf-8", "replace"), buf


class FakeStratux:
    def __init__(self, web_dir, route=None, situation=None, settings=None,
                 status=None, traffic=None, autopilot_status=None, port=0,
                 settings_overrides=None, device=DEVICE, upstream=None,
                 allow_writes=False):
        self.web_dir = os.path.abspath(web_dir)
        # {"/settings/synthview.json": {"guidance": {...}}} -> deep-merged over the
        # real file, so a test can vary config without touching the repo.
        self.settings_overrides = settings_overrides or {}
        # Proxy mode: the aircraft answers everything the working tree does not
        # contain. The fixture would only get in the way, so it is not loaded.
        self.upstream = upstream.rstrip("/") if upstream else None
        self.allow_writes = allow_writes
        self.blocked = []           # (method, path) writes refused in proxy mode
        self.replay_current = None  # the Replay started last, for /sim
        self.device = _load_device(None if upstream else device)
        captured = self.device.get("get", {})
        # The aircraft's own settings files where they differ from the repo's
        self.files = dict(self.device.get("files", {}))
        self.route = route if route is not None else []
        self.situation = dict(DEFAULT_SITUATION)
        if situation:
            self.situation.update(situation)
        if settings is None:
            settings = captured.get("/getSettings", {})
        if status is None:
            status = captured.get("/getStatus") or {
                "Version": "test", "Devices": 0, "UAT_messages_last_minute": 0}
        self.settings = settings
        self.status = status
        self.traffic = traffic or []
        self.autopilot_status = autopilot_status or {
            "Active": False, "To": {"Lat": 0, "Lon": 0, "Ele": 0, "Cmt": ""},
            "GPRMB": {"Status": "V", "XTRKDistance": 0, "Steer": "L",
                      "WaypointStart": "000", "WaypointDest": "000",
                      "Lat": 0, "Lon": 0, "Distance": 0, "TrueBearing": 0,
                      "Knots": 0, "Arrived": "V"}}
        self._clients = {}          # path -> list of sockets
        self._lock = threading.Lock()
        self._server = None
        self._thread = None
        self._port = port
        self.posted = []            # every POST body the UI sent, for assertions
        self.missing = []           # paths that 404'd, so tests can spot dead assets
        # Plain GET endpoints the plates poll on load. Without these the browser
        # logs 404s that swamp the real errors a test is looking for.
        self.rest = {
            "/radio": {"Devices": [], "Status": "OK"},
            "/radioStatus": {"Devices": []},
            "/getEMS": {}, "/getEMSMin": {}, "/getEMSMax": {},
            "/getAlerts": [], "/getSatellites": {}, "/getTowers": {},
            "/getTraffic": {}, "/getClients": [], "/getRegion": {"Region": "EU"},
            "/getSituation": lambda: self.situation,
            "/timers": [], "/resources": [], "/switches": [], "/flightlogs": [],
            "/magnetometer": {}, "/checklist/default/status": {},
            "/updates/available": [],   # ota.js:67 does db.forEach - must be an array
            "/tiles/tilesets": [],
            # The daemon serves /playback from Go, but web/playback/ is also a real
            # directory - without this entry the static handler wins and the UI
            # tries to JSON.parse an HTML page.
            "/playback": [], "/playback/": [],
        }
        # The captured answers replace the placeholders above. The ones that
        # mirror live state stay live: situation, route, settings, status.
        self.rest.update({path: body for path, body in captured.items()
                          if path not in ("/getSituation", "/autopilot",
                                          "/getSettings", "/getStatus")})
        # main.js injects every addon listed here; the aircraft may carry
        # third-party ones that are not in this checkout, so only list those
        # whose files are actually under web/RB-01/.
        self.rest["/addons"] = [
            addon for addon in captured.get("/addons", [])
            if os.path.exists(os.path.join(self.web_dir, "RB-01", addon.get("js", "")))
            and os.path.exists(os.path.join(self.web_dir, "RB-01", addon.get("html", "")))]
        # Endpoints the real daemon serves under a path prefix
        self.rest_prefixes = {
            "/charts/view/": {}, "/charts/export/": {}, "/alert/": {},
            "/switches/": {}, "/tiles/": {}, "/logs/": {}, "/remote/": {},
            "/radio/": {},
        }

    # -- lifecycle -----------------------------------------------------
    @property
    def url(self):
        return "http://127.0.0.1:%d" % self._port

    def start(self):
        outer = self

        class Handler(SimpleHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=outer.web_dir, **kwargs)

            def log_message(self, *args):
                pass                      # keep the test output readable

            def send_error(self, code, *args, **kwargs):
                if code == 404:
                    outer.missing.append(self.path)
                return super().send_error(code, *args, **kwargs)

            def end_headers(self):
                # Edits to the working tree must show on the next reload
                self.send_header("Cache-Control", "no-store")
                super().end_headers()

            def _local(self, path):
                """Is this a file of the working tree (served from here even in
                proxy mode - that is the point of developing against the aircraft)?"""
                target = os.path.join(outer.web_dir, path.lstrip("/"))
                return os.path.isfile(target) or os.path.isfile(os.path.join(target, "index.html"))

            # -- websocket upgrade --------------------------------------
            def do_GET(self):
                # charts.js asks for /charts/view//live; Go's mux cleans the
                # double slash, so do the same
                path = re.sub("/+", "/", self.path.split("?")[0])
                if self.headers.get("Upgrade", "").lower() == "websocket":
                    if outer.upstream:
                        return outer._bridge(self, path)
                    return outer._upgrade(self, path)
                if path == "/sim" or path.startswith("/sim/"):
                    return self._sim("GET", path, b"")
                if outer.upstream and not self._local(path) and path not in outer.settings_overrides:
                    return self._proxy("GET", None)
                if path == "/autopilot":
                    return self._json(outer.route)
                if path == "/getSettings":
                    return self._json(outer.settings)
                if path == "/getStatus":
                    return self._json(outer.status)
                if path in outer.rest:
                    value = outer.rest[path]
                    return self._json(value() if callable(value) else value)
                for prefix, value in outer.rest_prefixes.items():
                    if path.startswith(prefix):
                        return self._json(value() if callable(value) else value)
                if path in outer.files or path in outer.settings_overrides:
                    if path in outer.files:
                        merged = json.loads(json.dumps(outer.files[path]))
                    else:
                        with open(os.path.join(outer.web_dir, path.lstrip("/")), "rb") as fh:
                            merged = json.loads(fh.read())
                    _deep_merge(merged, outer.settings_overrides.get(path, {}))
                    return self._json(merged)
                return super().do_GET()

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                path = re.sub("/+", "/", self.path.split("?")[0])
                if path == "/sim" or path.startswith("/sim/"):
                    return self._sim(self.command, path, body)
                if outer.upstream:
                    return self._write_upstream(body)
                outer.posted.append((self.path, body.decode("utf-8", "replace")))
                if path == "/autopilot":
                    try:
                        outer.route = json.loads(body or b"[]")
                    except ValueError:
                        pass
                # Writes that the daemon persists and serves back are applied
                # here too, so a settings form can be driven round-trip: save,
                # reload, and the values must still be there.
                if path == "/setSettings":
                    # handleSettingsSetRequest merges the posted keys into
                    # stratux.conf and answers with the whole settings object.
                    try:
                        for key, value in (json.loads(body or b"{}") or {}).items():
                            if key == "SerialOutput":   # one port per request
                                dev = value.get("DeviceString")
                                outer.settings.setdefault("SerialOutputs", {})[dev] = value
                            else:
                                outer.settings[key] = value
                    except (ValueError, AttributeError):
                        pass
                    return self._json(outer.settings)
                if path.startswith("/settings/") and path.endswith(".json"):
                    # handleSettingsFileRest writes the file under settings/.
                    try:
                        outer.files[path] = json.loads(body or b"{}")
                    except ValueError:
                        pass
                    return self._json({})
                return self._json({"ok": True})

            def do_PUT(self):
                return self.do_POST()

            def do_DELETE(self):
                if outer.upstream:
                    return self._write_upstream(b"")
                return self._json({"ok": True})

            def _json(self, payload, status=200):
                blob = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(blob)))
                self.end_headers()
                self.wfile.write(blob)

            # -- proxy mode ---------------------------------------------
            def _proxy(self, method, body):
                """Forward this request to the aircraft and relay its answer."""
                req = urllib.request.Request(outer.upstream + self.path, data=body, method=method)
                for name in ("Content-Type", "Accept"):
                    if self.headers.get(name):
                        req.add_header(name, self.headers[name])
                try:
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        status, ctype, data = resp.status, resp.headers.get("Content-Type"), resp.read()
                except urllib.error.HTTPError as exc:
                    status, ctype, data = exc.code, exc.headers.get("Content-Type"), exc.read()
                except (urllib.error.URLError, OSError) as exc:
                    return self._json({"error": "aircraft unreachable: %s" % exc}, status=502)
                self.send_response(status)
                if ctype:
                    self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _write_upstream(self, body):
                if outer.allow_writes:
                    return self._proxy(self.command, body)
                outer.blocked.append((self.command, self.path))
                print("  blocked %s %s (start with --write to forward writes to the aircraft)"
                      % (self.command, self.path))
                return self._json({"error": "write blocked: the simulator is read-only "
                                            "against the aircraft; start it with --write"},
                                  status=403)

            # -- /sim control API --------------------------------------
            def _sim(self, method, path, body):
                try:
                    payload = json.loads(body) if body else {}
                except ValueError:
                    return self._json({"error": "body is not JSON"}, status=400)
                try:
                    result = outer._sim(method, path, payload)
                except (KeyError, ValueError, TypeError, OSError) as exc:
                    return self._json({"error": str(exc)}, status=400)
                if result is None:
                    return self._json({"error": "no such /sim endpoint: %s %s" % (method, path)}, status=404)
                if result == "panel":
                    with open(SIM_PANEL, "rb") as fh:
                        blob = fh.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(blob)))
                    self.end_headers()
                    self.wfile.write(blob)
                    return
                return self._json(result)

        class Server(ThreadingHTTPServer):
            daemon_threads = True
            allow_reuse_address = True

            def handle_error(self, request, client_address):
                # The browser drops sockets constantly while navigating between
                # plates. Without this, socketserver prints a full traceback for
                # each one and buries the actual test output.
                exc = sys.exc_info()[1]
                if isinstance(exc, (ConnectionResetError, BrokenPipeError,
                                    ConnectionAbortedError, TimeoutError)):
                    return
                super().handle_error(request, client_address)

        self._server = Server(("127.0.0.1", self._port), Handler)
        self._port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self):
        with self._lock:
            for sockets in self._clients.values():
                for sock in sockets:
                    try:
                        sock.close()
                    except OSError:
                        pass
            self._clients.clear()
        if self._server:
            self._server.shutdown()
            self._server.server_close()

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()

    # -- websockets ----------------------------------------------------
    def _upgrade(self, handler, path):
        key = handler.headers.get("Sec-WebSocket-Key")
        if not key:
            handler.send_error(400, "missing websocket key")
            return
        handler.send_response(101)
        handler.send_header("Upgrade", "websocket")
        handler.send_header("Connection", "Upgrade")
        handler.send_header("Sec-WebSocket-Accept", _accept_key(key))
        handler.end_headers()
        sock = handler.connection
        with self._lock:
            self._clients.setdefault(path, []).append(sock)

        # Seed the socket so the UI has state immediately on connect
        if path == "/situation":
            self._send(sock, self.situation)
        elif path == "/autopilot":
            self._send(sock, self.autopilot_status)
        elif path == "/traffic":
            for target in self.traffic:
                self._send(sock, target)
        elif path == "/status":
            self._send(sock, self.status)

        # Hold the connection open; the UI reconnects if we return.
        try:
            while not getattr(self._server, "_BaseServer__shutdown_request", False):
                if sock.fileno() == -1:
                    break
                time.sleep(0.1)
        except OSError:
            pass

    def _send(self, sock, payload):
        try:
            sock.sendall(_frame(json.dumps(payload)))
            return True
        except OSError:
            return False

    def push(self, path, payload):
        """Push one JSON frame to every client of a stream."""
        with self._lock:
            sockets = list(self._clients.get(path, []))
        delivered = 0
        for sock in sockets:
            if self._send(sock, payload):
                delivered += 1
        return delivered

    def push_situation(self, **overrides):
        self.situation.update(overrides)
        return self.push("/situation", self.situation)

    def push_autopilot(self, **overrides):
        self.autopilot_status.update(overrides)
        return self.push("/autopilot", self.autopilot_status)

    def wait_for_client(self, path, timeout=15.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                if self._clients.get(path):
                    return True
            time.sleep(0.1)
        return False

    # -- proxy mode: bridge a browser socket to the aircraft's ------------
    def _bridge(self, handler, path):
        key = handler.headers.get("Sec-WebSocket-Key")
        if not key:
            handler.send_error(400, "missing websocket key")
            return
        try:
            # connect with a deadline (the browser retries every second, and an
            # unreachable aircraft must not pin a thread for the OS's TCP
            # timeout), then block for frames
            up = WebSocket(self.upstream.replace("http", "ws", 1) + path, timeout=5.0)
            up.sock.settimeout(None)
        except (OSError, RuntimeError) as exc:
            handler.send_error(502, "aircraft socket %s: %s" % (path, exc))
            return
        handler.send_response(101)
        handler.send_header("Upgrade", "websocket")
        handler.send_header("Connection", "Upgrade")
        handler.send_header("Sec-WebSocket-Accept", _accept_key(key))
        handler.end_headers()
        sock = handler.connection
        sock.settimeout(None)

        def downstream():                 # aircraft -> browser
            try:
                while True:
                    sock.sendall(_frame(up.recv()))
            except Exception:             # either side went away
                pass
            finally:
                up.close()
                try:                      # unblock the reader below; the handler
                    sock.shutdown(socket.SHUT_RDWR)   # framework closes the socket
                except OSError:
                    pass

        threading.Thread(target=downstream, daemon=True).start()
        buf = [b""]
        try:                              # browser -> aircraft
            while True:
                msg, buf = _read_client_frame(sock, buf)
                if msg is None:
                    break
                up.send(msg)
        except Exception:
            pass
        finally:
            up.close()
            handler.close_connection = True

    # -- recorded flights ----------------------------------------------
    def replay(self, events, position=0.0):
        """Feed (t, path, frame) events - a FlightLog.events() stream - through
        the sockets. Returns the Replay; nothing is pushed until step()/play()."""
        return Replay(self, events, position)

    def start_replay(self, log, start=0.0, end=None, streams=None):
        """Replay a FlightLog (or its path) from `start` log seconds. The display
        is first primed with the flight's state at `start`, so a plate already
        on screen does not ease in from wherever it was. Stops a running one."""
        from flightlog import FlightLog          # sibling module; import late so
        if not isinstance(log, FlightLog):       # rbserver stays usable without it
            log = FlightLog(log)
        if self.replay_current:
            self.replay_current.stop()
        rp = self.replay(log.events(start, end, streams), position=start)
        rp.log = log
        rp.prime(log.situation_at(start), log.traffic_at(start))
        self.replay_current = rp
        return rp

    # -- /sim control API ------------------------------------------------
    def _sim(self, method, path, payload):
        """Drive the sockets from a shell or the /sim/ page. Returns the JSON
        answer, "panel" for the control page, or None for an unknown endpoint.

            GET  /sim                      state: situation, traffic, replay
            GET  /sim/                     the control page
            GET  /sim/logs                 the flight logs in test-data/, by name
            POST /sim/situation {..}       merge fields into the situation and push it
            POST /sim/push/<socket> {..}   push one frame to e.g. /traffic, /ems, /alerts
            POST /sim/replay {log?, start?, end?, speed?}   start playing a flight;
                                           log is a path or a test-data/ name
            POST /sim/replay/step {seconds}                 advance a stopped replay
            POST /sim/replay/stop
        """
        rp = self.replay_current
        if method == "GET" and path == "/sim/":
            return "panel"
        if method == "GET" and path == "/sim":
            return {"situation": self.situation, "traffic": len(self.traffic),
                    "upstream": self.upstream, "blocked_writes": len(self.blocked),
                    "replay": rp and {"log": getattr(rp.log, "path", None),
                                      "position": rp.position, "playing": rp.playing,
                                      "done": rp.done, "pushed": rp.pushed,
                                      "duration": getattr(rp.log, "duration", None)}}
        if method == "GET" and path == "/sim/logs":
            from flightlog import available, summary
            return [summary(path) for _name, path in available()]
        if method != "POST":
            return None
        if path == "/sim/situation":
            self.push_situation(**payload)
            return {"ok": True, "situation": self.situation}
        if path.startswith("/sim/push/"):
            socket_path = path[len("/sim/push"):]
            if socket_path == "/traffic" and payload.get("Icao_addr") is not None:
                self.traffic = [t for t in self.traffic
                                if t.get("Icao_addr") != payload["Icao_addr"]] + [payload]
            return {"ok": True, "delivered": self.push(socket_path, payload)}
        if path == "/sim/replay":
            log = payload.get("log") or os.path.join(
                os.path.dirname(os.path.dirname(HERE)), "test-data", "flightlog-sample.sqlite")
            rp = self.start_replay(log, start=float(payload.get("start", 0.0)),
                                   end=payload.get("end"))
            if payload.get("speed", 1.0):
                rp.play(speed=float(payload.get("speed", 1.0)))
            return {"ok": True, "log": rp.log.path, "duration": rp.log.duration,
                    "position": rp.position, "playing": rp.playing}
        if path == "/sim/replay/step" and rp:
            if rp.playing:
                rp.stop()
            rp.step(float(payload.get("seconds", 1.0)))
            return {"ok": True, "position": rp.position, "done": rp.done}
        if path == "/sim/replay/stop" and rp:
            rp.stop()
            return {"ok": True, "position": rp.position}
        return None


class Replay:
    """Drives a recorded flight through a FakeStratux on the log's own clock.

    Two ways to advance, sharing one cursor:

      step(seconds)   deliver everything within the next `seconds` of log time
                      and return once the HMI has the state at the end of it.
                      Deterministic: a test can stop at a known point of the
                      flight and assert on it.
      play(speed)     background thread pacing the log against the wall clock,
                      `speed` times faster than it was flown.

    Each delivered frame also updates the server's seed state (situation, the
    live traffic set, status), so a socket that (re)connects mid-flight starts
    from where the flight is, as it would on the real daemon.
    """

    # How the HMI ingests each socket (web/RB-01/services/*.js). The snapshot
    # streams are rate-limited by wall clock, and a frame arriving inside the
    # window is dropped (situation, status) or held back (ems). The daemon never
    # sends faster than that, so a replay must not either: within one step()
    # only the last snapshot per socket is delivered, and not before the window
    # since the previous one has passed. Traffic is one frame per target and
    # the bridge is unthrottled, so those go out exactly as recorded.
    SNAPSHOT_GAP = {"/situation": 0.12, "/ems": 0.35, "/status": 1.05}

    # A target that has not been heard for this long is dropped from the seed
    # set given to a newly connected /traffic socket. The daemon's own timeout is
    # longer, but it re-sends every live target once a second anyway, so all a
    # seed has to cover is the moment before the first re-send lands.
    TRAFFIC_SEED_AGE = 5.0

    def __init__(self, srv, events, position=0.0):
        self._srv = srv
        self._events = iter(events)
        self._pending = None        # the next event, read but not yet due
        self._held = {}             # path -> (t, frame): latest snapshot not yet delivered
        self._last_wall = {}        # path -> monotonic time of the last delivery
        self._targets = {}          # Icao_addr -> (t, frame) of last valid position
        self._lock = threading.RLock()
        self._thread = None
        self._stop = threading.Event()
        self.log = None             # the FlightLog, when started via start_replay()
        self.position = position    # log seconds delivered so far
        self.pushed = 0             # frames delivered to the sockets
        self.coalesced = 0          # snapshot frames superseded before delivery
        self.done = False           # no events left

    # -- stepping ------------------------------------------------------
    def prime(self, situation=None, traffic=()):
        """Deliver a starting state (see Display.replay) as if it had been recorded."""
        with self._lock:
            if situation:
                self._deliver(self.position, "/situation", situation)
            for target in traffic:
                self._deliver(self.position, "/traffic", target)
        return self

    def step(self, seconds, flush=True):
        """Advance to position + seconds. With `flush`, block until the HMI has
        been given the final snapshot of every stream (a few hundred ms)."""
        with self._lock:
            until = self.position + seconds
            while not self.done:
                event = self._pending or self._next()
                if event is None:
                    self.done = True
                    break
                if event[0] > until:
                    self._pending = event
                    break
                self._pending = None
                t, path, frame = event
                if path in self.SNAPSHOT_GAP:
                    if path in self._held:
                        self.coalesced += 1
                    self._held[path] = (t, frame)
                else:
                    self._deliver(t, path, frame)
            self.position = until
            self._flush(wait=flush)
        return self

    def _next(self):
        try:
            return next(self._events)
        except StopIteration:
            return None

    def _flush(self, wait):
        """Deliver held snapshots whose window has passed - or wait for it."""
        due = sorted((self._last_wall.get(path, 0.0) + self.SNAPSHOT_GAP[path], path)
                     for path in self._held)
        for when, path in due:
            remaining = when - time.monotonic()
            if remaining > 0:
                if not wait:
                    continue
                time.sleep(remaining)
            t, frame = self._held.pop(path)
            self._deliver(t, path, frame)

    def _deliver(self, t, path, frame):
        srv = self._srv
        if path == "/situation":
            srv.situation = dict(frame)
        elif path == "/status":
            srv.status = dict(frame)
        elif path == "/traffic":
            if frame.get("Position_valid"):
                self._targets[frame.get("Icao_addr")] = (t, frame)
            srv.traffic = [fr for (seen, fr) in self._targets.values()
                           if t - seen <= self.TRAFFIC_SEED_AGE]
        srv.push(path, frame)
        self._last_wall[path] = time.monotonic()
        self.pushed += 1

    # -- background playback -------------------------------------------
    def play(self, speed=1.0, until=None):
        """Advance in real time x `speed` until `until` log seconds (or the end)."""
        if self._thread and self._thread.is_alive():
            raise RuntimeError("already playing")
        self._stop.clear()

        def run():
            wall0, pos0 = time.monotonic(), self.position
            while not self._stop.is_set() and not self.done:
                target = pos0 + (time.monotonic() - wall0) * speed
                if until is not None:
                    target = min(target, until)
                if target > self.position:
                    self.step(target - self.position, flush=False)
                else:
                    with self._lock:
                        self._flush(wait=False)
                if until is not None and self.position >= until:
                    break
                self._stop.wait(0.02)
            with self._lock:
                self._flush(wait=True)     # the HMI ends on the final state

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()
        return self

    def wait(self, timeout=None):
        """Block until playback stops (end of log, `until`, or stop()). True if it did."""
        if self._thread:
            self._thread.join(timeout)
            return not self._thread.is_alive()
        return True

    def stop(self):
        self._stop.set()
        return self.wait(5.0)

    @property
    def playing(self):
        return bool(self._thread and self._thread.is_alive())
