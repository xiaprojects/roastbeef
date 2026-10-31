"""The simulator's development features, without a browser.

Two things a developer relies on when working on the HMI against this server:

- the /sim control API (what simpanel.html and a shell use) actually drives the
  sockets: a field pushed to /sim/situation reaches a connected client, a
  replay can be started, stepped and stopped;
- proxy mode serves the working tree first and bridges everything else - REST,
  unknown paths, WebSockets in both directions - to the aircraft, and refuses
  writes unless asked. The "aircraft" here is a second FakeStratux with a
  different web/ tree, so the test can tell which side answered.
"""

import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

from cdp import WebSocket
from plates import FLIGHT, WEB, Result
from rbserver import FakeStratux


def call(url, body=None, method=None):
    """(status, content-type, bytes); a 4xx/5xx is returned, not raised."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status, resp.headers.get("Content-Type"), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers.get("Content-Type"), exc.read()


def ws_url(srv, path):
    return srv.url.replace("http", "ws", 1) + path


def drain(ws, quiet=0.5):
    """Every frame queued on a socket, until it has been quiet for `quiet` s."""
    frames = []
    ws.sock.settimeout(quiet)
    try:
        while True:
            frames.append(json.loads(ws.recv()))
    except Exception:
        pass
    return frames


def control_api_test(res):
    srv = FakeStratux(WEB).start()
    u = srv.url
    try:
        with urllib.request.urlopen(u + "/RB-01/index.html") as resp:
            cache = resp.headers.get("Cache-Control")
        res.check(cache == "no-store", "working-tree files are served with no-store", cache)
        status, ctype, body = call(u + "/sim/")
        res.check(status == 200 and "text/html" in (ctype or "") and b"/sim/situation" in body,
                  "/sim/ serves the control page")

        ws = WebSocket(ws_url(srv, "/situation"), timeout=5)
        ws.recv()                                        # the seed
        status, _, body = call(u + "/sim/situation", {"AHRSRoll": 25.5})
        frame = json.loads(ws.recv())
        res.check(status == 200 and frame["AHRSRoll"] == 25.5 and frame["GPSLatitude"] == 45.0,
                  "/sim/situation merges a field and pushes the whole situation",
                  "roll %s lat %s" % (frame.get("AHRSRoll"), frame.get("GPSLatitude")))

        tws = WebSocket(ws_url(srv, "/traffic"), timeout=5)
        target = {"Icao_addr": 1, "Tail": "T1", "Position_valid": True, "Lat": 45.0, "Lng": 10.0}
        status, _, body = call(u + "/sim/push/traffic", target)
        got = drain(tws)
        res.check(status == 200 and got and got[-1]["Tail"] == "T1" and srv.traffic == [target],
                  "/sim/push/traffic reaches the socket and the seed set")
        tws.close()

        status, _, body = call(u + "/sim/logs")
        logs = {entry["name"]: entry for entry in json.loads(body)}
        res.check(status == 200 and 175 < logs.get("flightlog-sample", {}).get("duration", 0) < 185,
                  "/sim/logs lists the recordings in test-data/ with their duration",
                  "%d logs" % len(logs))
        status, _, body = call(u + "/sim/replay", {"log": "no-such-log", "speed": 0})
        res.check(status == 400 and "no flight log" in json.loads(body)["error"],
                  "an unknown log name is a clear 400", json.loads(body).get("error", "")[:50])
        status, _, body = call(u + "/sim/replay", {"log": "flightlog-sample", "start": 150, "speed": 0})
        started = json.loads(body)
        res.check(status == 200 and started["position"] == 150 and not started["playing"]
                  and started["log"] == FLIGHT,
                  "/sim/replay takes a test-data/ name and starts a stepped replay", started)
        status, _, body = call(u + "/sim/replay/step", {"seconds": 10.4})
        last = drain(ws)[-1]
        res.check(status == 200 and abs(last["AHRSRoll"] + 64.0) < 0.5 and round(last["GPSTrueCourse"]) == 103,
                  "/sim/replay/step lands the HMI on the stepped-to state",
                  "roll %.1f track %.0f" % (last["AHRSRoll"], last["GPSTrueCourse"]))

        status, _, body = call(u + "/sim/replay", {"start": 0, "speed": 30})
        time.sleep(1.0)
        state = json.loads(call(u + "/sim")[2])
        res.check(state["replay"]["playing"] and state["replay"]["position"] > 10,
                  "/sim/replay plays in the background", "position %.0f" % state["replay"]["position"])
        status, _, body = call(u + "/sim/replay/stop", {})
        res.check(status == 200 and not srv.replay_current.playing, "/sim/replay/stop stops it")
        status, _, _ = call(u + "/sim/nothing", {})
        res.check(status == 404, "an unknown /sim endpoint is a 404")
        ws.close()
    finally:
        srv.stop()


def proxy_test(res):
    # The stand-in aircraft has its own web/ so the two sides can be told apart
    tree = tempfile.mkdtemp(prefix="rb01-aircraft-")
    os.makedirs(os.path.join(tree, "RB-01", "addons", "js"))
    with open(os.path.join(tree, "RB-01", "addons", "js", "vhfdf.js"), "w") as fh:
        fh.write("// from the aircraft\n")
    aircraft = FakeStratux(tree).start()
    proxy = FakeStratux(WEB, upstream=aircraft.url).start()
    u = proxy.url
    try:
        status, ctype, body = call(u + "/getStatus")
        res.check(status == 200 and json.loads(body).get("Version") == aircraft.status.get("Version"),
                  "REST GETs are answered by the aircraft")
        with open(os.path.join(WEB, "RB-01", "index.html"), "rb") as fh:
            local = fh.read()
        res.check(call(u + "/RB-01/index.html")[2] == local,
                  "files in the working tree are served from here")
        status, _, body = call(u + "/RB-01/addons/js/vhfdf.js")
        res.check(status == 200 and b"from the aircraft" in body,
                  "files missing here come from the aircraft")
        res.check(call(u + "/no/such/thing")[0] == 404, "the aircraft's 404 passes through")

        status, _, body = call(u + "/timers", {"name": "SIM"})
        res.check(status == 403 and proxy.blocked == [("POST", "/timers")] and not aircraft.posted,
                  "writes are refused and never reach the aircraft", status)
        res.check(call(u + "/timers/1", method="DELETE")[0] == 403, "DELETE is refused too")

        ws = WebSocket(ws_url(proxy, "/situation"), timeout=10)
        seed = json.loads(ws.recv())
        aircraft.push_situation(AHRSRoll=17.0)
        frame = json.loads(ws.recv())
        res.check(seed["GPSLatitude"] == 45.0 and frame["AHRSRoll"] == 17.0,
                  "a WebSocket is bridged aircraft -> browser")
        ws.send(json.dumps({"from": "browser"}))
        time.sleep(0.3)
        aircraft.push_situation(AHRSRoll=18.0)
        res.check(json.loads(ws.recv())["AHRSRoll"] == 18.0,
                  "the bridge survives browser -> aircraft traffic")
        ws.close()

        writer = FakeStratux(WEB, upstream=aircraft.url, allow_writes=True).start()
        status, _, _ = call(writer.url + "/timers", {"name": "SIM"})
        res.check(status == 200 and aircraft.posted and aircraft.posted[-1][0] == "/timers",
                  "with allow_writes a POST reaches the aircraft")
        writer.stop()
    finally:
        proxy.stop()
        aircraft.stop()


def main():
    res = Result()
    control_api_test(res)
    proxy_test(res)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
