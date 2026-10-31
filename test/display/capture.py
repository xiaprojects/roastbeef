#!/usr/bin/env python3
"""Snapshot the GET endpoints of a real RB-01 into the fake backend's fixture.

    ./capture.py                       # http://192.168.10.1 -> fixtures/rb01-device.json
    ./capture.py http://stratux.local  # another device

GET only, and only the endpoints the RB-01 HMI reads (each is listed below with
the plate or service that reads it), so nothing on the aircraft changes. The
result is what `rbserver.py` serves by default, so the fake backend answers the
plates the way the aircraft does - real settings, real gauge limits, real
resources - instead of the empty placeholders it started with.

Rerun it after a firmware update, or after changing the aircraft's settings, and
commit the new fixture. Passwords are blanked before writing, and identifying
values (registration, pilot, Mode-S codes, addresses) are listed on stdout so
you can decide whether they belong in the repo.
"""

import datetime
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(os.path.dirname(HERE)), "web")
FIXTURE = os.path.join(HERE, "fixtures", "rb01-device.json")
DEFAULT_HOST = "http://192.168.10.1"

# Go-served REST endpoints the HMI GETs, with who reads them. Endpoints with
# side effects (/cageAHRS, /calibrateAHRS, /restart, ...) are deliberately not
# here - do not add them.
GET_PATHS = [
    ("/getSettings", "every plate, via SettingsService"),
    ("/getStatus", "status/ota plates"),
    ("/getSituation", "REST snapshot of the situation (legacy UI)"),
    ("/getEMS", "ems plate seed"),
    ("/getEMSMin", "ems plate min markers"),
    ("/getEMSMax", "ems plate max markers"),
    ("/autopilot", "autopilot/hsi/synthview route"),
    ("/getAlerts", "alerts plate"),
    ("/timers", "timers plate"),
    ("/resources", "resources plate"),
    ("/radio", "radio plate"),
    ("/playback", "radio plate recordings"),
    ("/addons", "main.js addon loader"),
    ("/updates/available", "ota plate"),
    ("/tiles/tilesets", "map plate"),
    ("/checklist/default/status", "checklist plate"),
    ("/charts/view/live", "charts plate"),
    ("/flightlogs", "resources/charts plates"),
    ("/magnetometer", "legacy UI magnetometer page"),
    ("/getTraffic", "REST snapshot of traffic (legacy UI)"),
    ("/getClients", "legacy UI clients page"),
    ("/getRegion", "legacy UI"),
    ("/getSatellites", "legacy UI GPS page"),
    ("/getTowers", "legacy UI"),
]

# Static settings files the HMI reads. The aircraft's copies can differ from
# the repo's (its own aircraft.json, tuned gauges); only the ones that do are
# stored, the rest are served from web/ as before.
FILE_PATHS = [
    "/settings/aircraft.json", "/settings/ems.json", "/settings/synthview.json",
    "/settings/keypad.json", "/settings/navigation.json", "/settings/alertsMapping.json",
    "/settings/db.airfields.json", "/settings/db.frequencies.json",
]

# Listings that grow without bound on a flying aircraft; keep enough for the
# plate to render, not the whole history.
TRUNCATE = {"/playback": 10, "/flightlogs": 10}
FILE_SIZE_LIMIT = 64 * 1024

# Blanked before writing. Substrings of the lower-cased key, plus the exact
# WiFiDirectPin ("pin" alone would also hit LastPingResponse).
SECRET_KEYS = ("passphrase", "password", "secret", "token")
SECRET_EXACT = {"wifidirectpin", "pin"}
# Not blanked, but reported so the person committing can decide (exact keys,
# lower-cased; "name" only inside aircraft.json).
IDENTIFYING_KEYS = {"ownshipmodes", "wifissid", "ognaddr", "ognreg", "ognpilot",
                    "pilot", "ip", "wifiipaddress", "staticips"}


def fetch(host, path, timeout=6.0):
    with urllib.request.urlopen(host + path, timeout=timeout) as resp:
        return json.loads(resp.read())


def scrub(obj, found, path=""):
    """Blank secrets in place; collect identifying (path, value) pairs."""
    if isinstance(obj, dict):
        for key, value in list(obj.items()):
            lower = key.lower()
            if isinstance(value, str) and value and (
                    lower in SECRET_EXACT or any(s in lower for s in SECRET_KEYS)):
                obj[key] = ""
                found.append((path + "/" + key, "<blanked>"))
            elif isinstance(value, (dict, list)):
                scrub(value, found, path + "/" + key)
            elif value not in ("", 0, None, False, "[]") and (
                    lower in IDENTIFYING_KEYS
                    or (lower == "name" and path.startswith("/settings/aircraft.json"))):
                found.append((path + "/" + key, value))
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            scrub(value, found, "%s[%d]" % (path, i))


def main(argv):
    host = argv[0].rstrip("/") if argv else DEFAULT_HOST
    out = {"host": host,
           "captured": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "device": {}, "get": {}, "files": {}, "skipped": {}}
    flagged = []

    print("GET %s" % host)
    for path, reader in GET_PATHS:
        try:
            data = fetch(host, path)
        except (urllib.error.URLError, ValueError, OSError) as exc:
            out["skipped"][path] = "failed: %s" % exc
            print("  %-28s FAILED %s" % (path, exc))
            continue
        if path in TRUNCATE and isinstance(data, list) and len(data) > TRUNCATE[path]:
            out["skipped"][path] = "truncated to %d of %d entries" % (TRUNCATE[path], len(data))
            data = data[:TRUNCATE[path]]
        scrub(data, flagged, path)
        out["get"][path] = data
        size = len(data) if isinstance(data, (list, dict)) else 1
        print("  %-28s %-5s %4d  %s" % (path, type(data).__name__, size, reader))

    status = out["get"].get("/getStatus", {})
    out["device"] = {k: status.get(k) for k in ("Version", "Build", "HardwareBuild")}

    print("files")
    for path in FILE_PATHS:
        try:
            data = fetch(host, path)
        except (urllib.error.URLError, ValueError, OSError) as exc:
            out["skipped"][path] = "failed: %s" % exc
            print("  %-28s FAILED %s" % (path, exc))
            continue
        try:
            with open(os.path.join(WEB, path.lstrip("/"))) as fh:
                same = json.load(fh) == data
        except (OSError, ValueError):
            same = False
        blob = json.dumps(data)
        if same:
            out["skipped"][path] = "identical to the repo copy"
            print("  %-28s same as web%s" % (path, path))
        elif len(blob) > FILE_SIZE_LIMIT:
            out["skipped"][path] = "differs from the repo copy but is %d bytes; served from web/" % len(blob)
            print("  %-28s DIFFERS but %d bytes - not stored" % (path, len(blob)))
        else:
            scrub(data, flagged, path)
            out["files"][path] = data
            print("  %-28s differs - stored (%d bytes)" % (path, len(blob)))

    os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
    with open(FIXTURE, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print("\nwrote %s (%d bytes) from %s %s" % (
        os.path.relpath(FIXTURE), os.path.getsize(FIXTURE),
        out["device"].get("HardwareBuild"), out["device"].get("Version")))
    if flagged:
        print("\nidentifying values in the fixture - decide before committing:")
        for where, value in flagged:
            print("  %-45s %r" % (where, value))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
