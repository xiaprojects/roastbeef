#!/usr/bin/env python3
"""Replay a recorded flight's receiver input through the real stratuxrun.

A flight log (main/datalog.go) holds both sides of the daemon: every line dump1090
sent it (es_messages) and the traffic and ownship state it worked out from them
(traffic, mySituation). `make` cuts a window of a log into two fixtures:

  <name>.trace.csv.gz      what `stratuxrun -trace` replays natively - gzipped CSV of
                           (stratux clock, input context, raw line), the format the
                           daemon itself writes when TraceLog is on
  <name>.expected.json.gz  what the aircraft's daemon logged for the same window

and `run()` plays the trace through a stratuxrun built from this checkout while
recording everything it sends on its WebSockets. test_daemon.py compares the two.

The log keeps no raw NMEA, only the fix the daemon parsed from it, one mySituation
row per fix. GGA, RMC and GST sentences are rebuilt from those rows, every number
written as the shortest decimal that gps.go's own parsing turns back into the
recorded float32, so the replayed ownship is bit-identical to the recorded one.

    python3 replay.py make 20260913111200 --from 1740 --to 1860   # -> fixtures/
    python3 replay.py info fixtures/<name>.trace.csv.gz

Python 3 and Go only; no pip.
"""

import base64
import csv
import gzip
import io
import json
import math
import os
import re
import shutil
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
FIXTURES = os.path.join(HERE, "fixtures")
TEST_DATA = os.path.join(REPO, "test-data")

YEAR1 = datetime(1, 1, 1)
LEAD = 5.0      # trace seconds before the first line, for the daemon to start up
WARMUP = 30.0   # input replayed before the checked window: longer than the 25 s a
                # target is kept alive by extrapolation, so every target the aircraft
                # had at the start of the window is rebuilt from messages in the trace

# The aircraft's settings that change what the traffic outputs contain
# (test-data/20261017/stratux.conf). Everything else stays at the daemon's defaults.
SETTINGS = {
    "OwnshipModeS": "300A61,D885A8",
    "RadarLimits": 50000,
    "RadarRange": 40,
    "EstimateBearinglessDist": False,
    "DisplayTrafficSource": False,
    "ES_Enabled": True,
    "GPS_Enabled": True,
    "DEBUG": False,
    "ReplayLog": False,
    "TraceLog": False,
}

# Recorded TrafficInfo fields kept in the expectations.
TRAFFIC_FIELDS = (
    "Icao_addr", "Tail", "Squawk", "Emitter_category", "OnGround", "Addr_type", "TargetType",
    "NIC", "NACp", "Position_valid", "Lat", "Lng", "Alt", "AltIsGNSS", "GnssDiffFromBaroAlt",
    "Track", "Speed", "Speed_valid", "Vvel", "SignalLevel", "ExtrapolatedPosition",
    "Lat_fix", "Lng_fix", "Alt_fix", "Age", "AgeExtrapolation", "BearingDist_valid",
    "Distance", "Bearing", "ReceivedMsgs",
)
SITUATION_FIELDS = (
    "GPSLatitude", "GPSLongitude", "GPSFixQuality", "GPSAltitudeMSL", "GPSGeoidSep",
    "GPSHeightAboveEllipsoid", "GPSGroundSpeed", "GPSTrueCourse", "GPSHorizontalAccuracy",
    "GPSVerticalAccuracy", "GPSNACp", "GPSLastFixSinceMidnightUTC",
)


# -- clocks ----------------------------------------------------------------------

# Go time.Time.String(), as the log stores times: "0001-01-01 00:29:00.5 +0000 UTC"
_GO_TIME = re.compile(r"^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d+))? \+0000 UTC")


def go_time(text):
    """A UTC time as the log stores it -> datetime (year 1 for the stratux clock)."""
    m = _GO_TIME.match(text)
    if not m:
        raise ValueError("not a UTC Go time: %r" % text)
    y, mo, d, h, mi, s, frac = m.groups()
    return datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), int((frac or "0").ljust(6, "0")[:6]))


def clock(text):
    """A stratux-clock time as the log stores it -> seconds since the daemon started."""
    return (go_time(text) - YEAR1).total_seconds()


def find_log(name):
    """A recording by path, or by any unique part of its file name in test-data/."""
    if os.path.exists(name):
        return name
    hits = [os.path.join(TEST_DATA, f) for f in sorted(os.listdir(TEST_DATA))
            if f.endswith(".sqlite") and name in f]
    if len(hits) != 1:
        raise SystemExit("%r matches %d recordings in test-data/" % (name, len(hits)))
    return hits[0]


def trace_time(seconds):
    """Seconds since the daemon started -> the year-1 RFC 3339 time of a trace line."""
    t = YEAR1 + timedelta(seconds=seconds)
    return "%04d-%02d-%02dT%02d:%02d:%02d.%06dZ" % (
        t.year, t.month, t.day, t.hour, t.minute, t.second, t.microsecond)


def rfc3339_clock(text):
    """A year-1 time as encoding/json writes it -> seconds since the daemon started."""
    day, _, rest = text.rstrip("Z").partition("T")
    h, m, s = rest.split(":")
    return (int(day[8:10]) - 1) * 86400 + int(h) * 3600 + int(m) * 60 + float(s)


# -- NMEA rebuilt from a parsed fix ----------------------------------------------

def f32(x):
    """x rounded to float32, as Go's float32(x) and ParseFloat(s, 32) do."""
    return struct.unpack("<f", struct.pack("<f", x))[0]


def shortest(value, forward, guess, int_digits=1, decimals=0):
    """The shortest decimal string s, with at least `decimals` places, near `guess`, for
    which forward(float(s)) is the float32 `value`. The log stores float32s as 10-digit
    decimals, which round back to exactly one float32. The minimum places are the
    receiver's own: a u-blox writes 104200.00, not 104200, and the fixtures keep that."""
    value = f32(value)
    for d in range(decimals, 11):
        step = 10.0 ** -d
        for cand in (round(guess, d), round(guess, d) - step, round(guess, d) + step):
            if cand < 0:
                continue
            s = "%0*.*f" % (int_digits + (d + 1 if d else 0), d, cand)
            if forward(float(s)) == value:
                return s
    raise ValueError("no decimal parses back to %r" % value)


def nmea_coord(value, deg_digits):
    """ddmm.mmmmm / dddmm.mmmmm and hemisphere for a float32 latitude/longitude,
    as gps.go parses it: float32(deg) + float32(ParseFloat(minutes, 32) / 60)."""
    v = abs(value)
    deg = int(v)
    minutes = shortest(v, lambda m: f32(deg + f32(f32(m) / 60.0)), (v - deg) * 60, 2, 5)
    return "%0*d%s" % (deg_digits, deg, minutes)


def nmea_sentences(fix, date):
    """GGA, RMC and GST that gps.go parses back into exactly this mySituation row."""
    def checksum(body):
        cs = 0
        for ch in body:
            cs ^= ord(ch)
        return "$%s*%02X" % (body, cs)

    v = fix["GPSLastFixSinceMidnightUTC"]
    hr, mn = int(v // 3600), int(v % 3600 // 60)
    sec = shortest(v, lambda s: f32(f32(3600 * hr + 60 * mn) + f32(s)), v - 3600 * hr - 60 * mn, 2, 2)
    hhmmss = "%02d%02d%s" % (hr, mn, sec)
    lat, lon = fix["GPSLatitude"], fix["GPSLongitude"]
    pos = "%s,%s,%s,%s" % (nmea_coord(lat, 2), "S" if lat < 0 else "N",
                           nmea_coord(lon, 3), "W" if lon < 0 else "E")
    feet = lambda m: f32(f32(m) * 3.28084)  # noqa: E731 - GGA altitude and separation, metres -> feet
    alt = shortest(fix["GPSAltitudeMSL"], feet, fix["GPSAltitudeMSL"] / 3.28084, 1, 1)
    sep = shortest(fix["GPSGeoidSep"], feet, fix["GPSGeoidSep"] / 3.28084, 1, 1)
    gs = shortest(fix["GPSGroundSpeed"], f32, fix["GPSGroundSpeed"], 1, 3)
    course = shortest(fix["GPSTrueCourse"], f32, fix["GPSTrueCourse"], 1, 2)
    # GST carries 1-sigma latitude/longitude/altitude errors; gps.go takes
    # 2*sqrt(lat^2 + lon^2) and 2*alt as the 95 % accuracies. With the whole horizontal
    # error put in latitude both are exact doublings, so any recorded value is reachable.
    hacc, vacc = fix["GPSHorizontalAccuracy"], fix["GPSVerticalAccuracy"]
    sd = shortest(hacc, lambda s: f32(2 * math.sqrt(f32(s) ** 2)), hacc / 2, 1, 2)
    sd_alt = shortest(vacc, lambda s: f32(2 * f32(s)), vacc / 2, 1, 2)
    return [
        checksum("GNGGA,%s,%s,%d,12,0.66,%s,M,%s,M,," % (hhmmss, pos, fix["GPSFixQuality"], alt, sep)),
        checksum("GNRMC,%s,A,%s,%s,%s,%s,,,A" % (hhmmss, pos, gs, course, date)),
        checksum("GNGST,%s,1.0,0.0,0.0,0.0,%s,0,%s" % (hhmmss, sd, sd_alt)),
    ]


# -- making fixtures from a log ----------------------------------------------------

def make(log_name, start, end, out_dir=FIXTURES, warmup=WARMUP):
    """Write <log>.<start>-<end>.trace.csv.gz and .expected.json.gz; return their paths.

    start/end are seconds of the log's stratux clock (its `es_messages.TimeReceived`).
    """
    path = find_log(log_name)
    db = sqlite3.connect("file:%s?mode=ro&immutable=1" % path, uri=True)
    db.row_factory = sqlite3.Row
    first = start - warmup
    offset = first - LEAD   # trace clock = log clock - offset

    lines = []  # (log clock, context, data)
    for row in db.execute("SELECT TimeReceived, Data FROM es_messages ORDER BY id"):
        t = clock(row["TimeReceived"])
        if first <= t <= end:
            lines.append((t, "dump1090", row["Data"]))

    fixes, seen = [], set()
    for row in db.execute("SELECT * FROM mySituation ORDER BY id"):
        t = clock(row["GPSLastFixLocalTime"])
        if not first <= t <= end or t in seen or not row["GPSFixQuality"]:
            continue
        seen.add(t)
        fix = {k: row[k] for k in SITUATION_FIELDS}
        fix["t"] = t
        fixes.append(fix)
        date = go_time(row["GPSTime"]).strftime("%d%m%y")
        for sentence in nmea_sentences(fix, date):
            lines.append((t, "nmea", sentence))
    lines.sort(key=lambda l: l[0])  # stable: a fix's GGA, RMC, GST stay in order

    traffic = []
    columns = {r[1] for r in db.execute("PRAGMA table_info(traffic)")}
    for row in db.execute("SELECT * FROM traffic ORDER BY id"):
        cycle = clock(row["Last_seen"]) + row["Age"]   # Age = clock - Last_seen at that cycle
        if start <= cycle <= end:
            rec = {k: row[k] for k in TRAFFIC_FIELDS if k in columns}
            rec["cycle"] = round(cycle, 3)
            rec["Last_seen"] = clock(row["Last_seen"])
            traffic.append(rec)

    name = "%s.%d-%d" % (os.path.basename(path)[:-len(".sqlite")], start, end)
    trace_path = os.path.join(out_dir, name + ".trace.csv.gz")
    expected_path = os.path.join(out_dir, name + ".expected.json.gz")
    os.makedirs(out_dir, exist_ok=True)
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    for t, context, data in lines:
        writer.writerow([trace_time(t - offset), context, data])
    with open(trace_path, "wb") as fp:   # mtime=0: the same window gives the same bytes
        fp.write(gzip.compress(buf.getvalue().encode(), 9, mtime=0))
    expected = {
        "log": os.path.basename(path), "start": start, "end": end, "offset": offset,
        "settings": SETTINGS, "situation": fixes, "traffic": traffic,
    }
    with open(expected_path, "wb") as fp:
        fp.write(gzip.compress(json.dumps(expected, indent=0, sort_keys=True).encode(), 9, mtime=0))
    return trace_path, expected_path


def read_trace(path):
    """[(trace clock seconds, context, data)] of a trace file."""
    with gzip.open(path, "rt", newline="") as fp:
        return [(rfc3339_clock(t), ctx, data) for t, ctx, data in csv.reader(fp)]


def read_expected(path):
    with gzip.open(path, "rt") as fp:
        return json.load(fp)


# -- GDL90 ---------------------------------------------------------------------------

def _crc_table():
    table = []
    for i in range(256):
        crc = i << 8
        for _ in range(8):
            crc = ((crc << 1) ^ (0x1021 if crc & 0x8000 else 0)) & 0xFFFF
        table.append(crc)
    return table


CRC_TABLE = _crc_table()


def gdl90_crc(data):
    crc = 0
    for b in data:
        crc = (CRC_TABLE[crc >> 8] ^ (crc << 8) ^ b) & 0xFFFF
    return crc


def gdl90_messages(stream):
    """Split a buffer of framed GDL90 messages into payloads; None for a bad CRC."""
    out, i = [], 0
    while i < len(stream):
        if stream[i] != 0x7E:
            raise ValueError("expected a flag at %d: %s" % (i, stream[i:i + 8].hex()))
        j = stream.index(0x7E, i + 1)
        raw, k, body = stream[i + 1:j], 0, bytearray()
        while k < len(raw):
            if raw[k] == 0x7D:
                k += 1
                body.append(raw[k] ^ 0x20)
            else:
                body.append(raw[k])
            k += 1
        payload, crc = bytes(body[:-2]), body[-2] | body[-1] << 8
        out.append(payload if gdl90_crc(payload) == crc else None)
        i = j + 1
    return out


def gdl90_latlng(b):
    v = int.from_bytes(b[:3], "big")
    return (v - (1 << 24) if v & 0x800000 else v) * 180.0 / (1 << 23)


def gdl90_report(p):
    """Traffic (0x14) or ownship (0x0A) report payload -> dict."""
    alt = (p[11] << 4 | p[12] >> 4)
    return {
        "type": p[0], "alert": bool(p[1] & 0x10), "addr_type": p[1] & 0x0F,
        "icao": int.from_bytes(p[2:5], "big"), "lat": gdl90_latlng(p[5:8]),
        "lng": gdl90_latlng(p[8:11]), "alt": None if alt == 0xFFF else alt * 25 - 1000,
        "misc": p[12] & 0x0F, "nic": p[13] >> 4, "nacp": p[13] & 0x0F,
        "speed": p[14] << 4 | p[15] >> 4, "track": p[17] * 360.0 / 256,
        "emitter": p[18], "callsign": p[19:27].rstrip(b"\x00 ").decode("ascii", "replace"),
    }


# -- running the daemon ----------------------------------------------------------------

class SocketReader(threading.Thread):
    """Reads one daemon WebSocket into `frames` [(wall time, payload bytes)] until it
    closes. The daemon drops a socket that blocks for a second, so it gets a thread."""

    def __init__(self, port, path):
        super().__init__(daemon=True)
        self.frames = []
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((
            "GET %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\n"
            "Connection: Upgrade\r\nOrigin: http://127.0.0.1\r\nSec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n" % (path, port, key)).encode())
        self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            self.buf += self.sock.recv(4096)
        head, _, self.buf = self.buf.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise RuntimeError("%s: websocket handshake failed: %r" % (path, head[:80]))
        self.sock.settimeout(None)
        self.start()

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def run(self):
        parts = []
        try:
            while True:
                b0, b1 = self._read(2)
                n = b1 & 0x7F
                if n == 126:
                    n = struct.unpack(">H", self._read(2))[0]
                elif n == 127:
                    n = struct.unpack(">Q", self._read(8))[0]
                data = self._read(n)
                opcode = b0 & 0x0F
                if opcode == 0x8:
                    return
                if opcode in (0x0, 0x1, 0x2):
                    parts.append(data)
                    if b0 & 0x80:
                        self.frames.append((time.monotonic(), b"".join(parts)))
                        parts = []
        except (EOFError, OSError):
            return


NMEA_PORT = 2000   # tcpNMEAOutListener: the FLARM NMEA output, a fixed port


class LineReader(threading.Thread):
    """Reads the daemon's NMEA TCP output into `lines` [(wall time, line with its line
    ending)] until it closes."""

    def __init__(self, port, wait=3.0):
        super().__init__(daemon=True)
        self.lines = []
        deadline = time.monotonic() + wait
        while True:
            try:
                self.sock = socket.create_connection(("127.0.0.1", port), timeout=1)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.1)
        self.sock.settimeout(None)
        self.start()

    def run(self):
        buf = b""
        try:
            while True:
                chunk = self.sock.recv(65536)
                if not chunk:
                    return
                now = time.monotonic()
                *done, buf = (buf + chunk).split(b"\n")
                self.lines.extend((now, l.decode("ascii", "replace") + "\n") for l in done)
        except OSError:
            return


def port_in_use(port):
    try:
        socket.create_connection(("127.0.0.1", port), timeout=0.3).close()
        return True
    except OSError:
        return False


def build(out_dir):
    """go build ./main/ as the Makefile does; return the binary's path."""
    binary = os.path.join(out_dir, "stratuxrun")
    env = dict(os.environ, LIBRARY_PATH=REPO, CGO_CFLAGS_ALLOW="-L" + REPO)
    subprocess.run(["go", "build", "-o", binary, "./main/"], cwd=REPO, env=env, check=True)
    return binary


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Run:
    """What one replay produced: the daemon's exit code and log, every frame it sent on
    /traffic, /radar, /gdl90 and /situation, and every line on its NMEA port - or None
    for `nmea` when the port was taken before the daemon started."""

    def __init__(self, returncode, log, sockets, started, nmea):
        self.returncode = returncode
        self.log = log
        self.started = started   # wall time (monotonic) the daemon was started at
        self.nmea = nmea
        self.traffic = [(w, json.loads(b)) for w, b in sockets["/traffic"].frames]
        self.radar = [(w, j) for w, j in ((w, json.loads(b)) for w, b in sockets["/radar"].frames)
                      if "Icao_addr" in j]   # the first frame is the settings
        self.situation = [(w, json.loads(b)) for w, b in sockets["/situation"].frames]
        # /gdl90 carries each sendGDL90 buffer JSON-encoded: a base64 string
        self.gdl90 = [(w, base64.b64decode(json.loads(b))) for w, b in sockets["/gdl90"].frames]


def run(trace_path, settings=SETTINGS, binary=None, keep=None, timeout=None):
    """Replay trace_path through stratuxrun in a scratch HOME; return a Run.

    A non-root stratuxrun reads ~/.stratux.conf and serves the API on -port."""
    work = tempfile.mkdtemp(prefix="rb-replay-")
    try:
        if binary is None:
            binary = build(work)
        home = os.path.join(work, "home")
        os.makedirs(home)
        with open(os.path.join(home, ".stratux.conf"), "w") as fp:
            json.dump(settings, fp)
        port = free_port()
        nmea_free = not port_in_use(NMEA_PORT)
        nmea = None
        duration = read_trace(trace_path)[-1][0]
        log_path = os.path.join(work, "stratuxrun.log")
        env = dict(os.environ, HOME=home, LD_LIBRARY_PATH=REPO)
        with open(log_path, "wb") as log_fp:
            started = time.monotonic()
            proc = subprocess.Popen([binary, "-trace", os.path.abspath(trace_path), "-port", str(port)],
                                    cwd=work, env=env, stdout=log_fp, stderr=subprocess.STDOUT,
                                    start_new_session=True)
            sockets = {}
            try:
                deadline = time.monotonic() + LEAD - 1
                while True:
                    try:
                        urllib.request.urlopen("http://127.0.0.1:%d/getStatus" % port, timeout=1).read()
                        break
                    except OSError:
                        if proc.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError("stratuxrun did not serve on :%d within %.0f s"
                                               % (port, LEAD - 1))
                        time.sleep(0.1)
                for path in ("/traffic", "/radar", "/gdl90", "/situation"):
                    sockets[path] = SocketReader(port, path)
                if nmea_free:
                    nmea = LineReader(NMEA_PORT)
                returncode = proc.wait(timeout=timeout or duration * 1.5 + 30)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
        time.sleep(0.5)  # let the readers drain what was in flight
        with open(log_path, "rb") as fp:
            log = fp.read().decode("utf-8", "replace")
        return Run(returncode, log, sockets, started, nmea.lines if nmea else None)
    finally:
        if keep:
            shutil.copytree(work, keep, dirs_exist_ok=True)
        shutil.rmtree(work, ignore_errors=True)


# -- CLI ------------------------------------------------------------------------------

def main(argv):
    if len(argv) >= 2 and argv[0] == "make":
        args = argv[1:]
        start = float(args[args.index("--from") + 1])
        end = float(args[args.index("--to") + 1])
        for p in make(args[0], start, end):
            print("%s  %d bytes" % (os.path.relpath(p), os.path.getsize(p)))
        return 0
    if len(argv) == 2 and argv[0] == "info":
        lines = read_trace(argv[1])
        contexts = {}
        for _, ctx, _ in lines:
            contexts[ctx] = contexts.get(ctx, 0) + 1
        print("%d lines over %.1f s: %s" % (len(lines), lines[-1][0] - lines[0][0], contexts))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
