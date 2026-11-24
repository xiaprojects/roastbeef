"""The Logbook plate: the Hobbs meter's flight log (main/hobbsmeter.go, GET /settings/hobbsmeter.json).

- the Propeller and Engine tiles of the Aircraft plate open it, by touch;
- one row per flight, newest first, the total of hobbsTimeMinutes in the heading;
- a flight is named by the airfield of settings/db.airfields.json it opened or closed at, else
  by its coordinates; a flight still open shows IN FLIGHT;
- an entry the hand edit broke (no time, no position) is still a row, nothing throws;
- only the newest flight without a landing is IN FLIGHT, an older one a power cut left open
  says NO LANDING;
- a touch, or a TAP on the knob, opens a row's details; the knob walks the rows;
- a change of HobbsTimeMinutes in /status reads the log again (a landing shows up live);
- every row is on the glass of the round panel, and an empty log says so.
"""

import json
import sys

import keypadtest as kt
from plates import Result

LOG = "/settings/hobbsmeter.json"
READY = "[ui-view] .logbook"
ROWS = """[...document.querySelectorAll('[ui-view] tr.logbook-row')].map(e =>
    [...e.querySelectorAll('td')].map(td => td.textContent.replace(/\\s+/g, ' ').trim()))"""
TOTALS = "document.querySelector('[ui-view] .logbook-totals').textContent.replace(/\\s+/g, ' ').trim()"
DETAILS = "[...document.querySelectorAll('[ui-view] tr.logbook-detail')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())"
EMPTY = "(document.querySelector('[ui-view] .logbook-empty') || {}).textContent"

# Pisa LIRP (43.6839, 10.3927) and Perugia LIRZ (43.0959, 12.5132) are in db.airfields.json
FLIGHTS = [
    {"departureTime": "2026-10-25T13:40:37Z", "departureLatitude": 43.6850, "departureLongitude": 10.3950,
     "departureAltitudeMeters": 2.0, "landedTime": "2026-10-25T14:58:24Z", "landedLatitude": 43.0965,
     "landedLongitude": 12.5120, "landedAltitudeMeters": 211.0, "hobbsTimeMinutes": 75},
    {"departureTime": "2026-11-02T09:05:00Z", "departureLatitude": 43.0960, "departureLongitude": 12.5130,
     "departureAltitudeMeters": 211.0, "landedTime": "2026-11-02T09:47:00Z", "landedLatitude": 42.5,
     "landedLongitude": 11.0, "landedAltitudeMeters": 300.0, "hobbsTimeMinutes": 40},
    {"departureTime": "", "hobbsTimeMinutes": 3},
]
OPEN = {"departureTime": "2026-11-20T15:00:00Z", "departureLatitude": 42.5, "departureLongitude": 11.0,
        "departureAltitudeMeters": 300.0, "landedTime": "", "hobbsTimeMinutes": 12}


def push_hobbs(d, minutes):
    d.srv.status["HobbsTimeMinutes"] = minutes
    d.srv.push("/status", d.srv.status)


def main():
    res = Result()
    log = {"entries": list(FLIGHTS)}

    def setup(d):
        d.srv.rest[LOG] = lambda: log["entries"]
        d.srv.status["HobbsTimeMinutes"] = 118

    d = kt.boot(setup=setup)
    try:
        # From the Aircraft plate, by touch on Propeller then on Engine
        for label in ("Propeller", "Engine"):
            kt.route(d, "aircraft", "[ui-view] .aircraft")
            d.page.eval("""[...document.querySelectorAll('[ui-view] .aircraft-item')]
                .find(e => e.textContent.trim() == '%s').click()""" % label)
            d.page.wait("location.hash == '#/logbook' && !!document.querySelector('[ui-view] tr.logbook-row')",
                        timeout=10, label="logbook from " + label)
            res.check(True, "a touch on %s opens the logbook" % label)

        rows = d.page.eval(ROWS)
        res.check(len(rows) == 3, "one row per flight (%d)" % len(rows), rows)
        res.check([r[0][:10] for r in rows[:2]] == ["2026-11-02", "2026-10-25"], "newest flight first",
                  [r[0] for r in rows])
        res.check("LIRP" in rows[1][1] and "LIRZ" in rows[1][1], "flights are named by their airfields", rows[1])
        res.check(rows[0][1].startswith("LIRZ") and "42.500N 11.000E" in rows[0][1],
                  "away from any airfield, by the coordinates", rows[0])
        res.check([r[2] for r in rows] == ["0:40", "1:15", "0:03"], "Hobbs time as h:mm", [r[2] for r in rows])
        res.check(d.page.eval(TOTALS) == "3 flights · 1:58", "the heading has the count and the total",
                  d.page.eval(TOTALS))
        res.check(rows[2][1] == "--- ---" and rows[2][0] == "---", "a broken entry is still a row, not in flight", rows[2])

        # Touch a row: its details; again: closed
        d.page.eval("document.querySelectorAll('[ui-view] tr.logbook-row')[1].click()")
        d.page.pump(0.3)
        details = d.page.eval(DETAILS)
        res.check(len(details) == 1 and "2026-10-25 13:40Z" in details[0] and "14:58Z" in details[0]
                  and "692 ft" in details[0] and "Off-on 1:18" in details[0],
                  "a touch opens the row's times, altitudes and off-on time", details)
        d.page.eval("document.querySelectorAll('[ui-view] tr.logbook-row')[1].click()")
        d.page.pump(0.3)
        res.check(d.page.eval(DETAILS) == [], "a second touch closes it", d.page.eval(DETAILS))

        # The knob
        kt.route(d, "logbook", READY, count=3)
        kt.check_entry(d, res, "logbook", lambda: len(d.page.eval(DETAILS)))
        kt.check_walk(d, res, "logbook", plate="logbook")
        kt.go_to(d, 1)
        d.key(kt.TAP, settle=0.3)
        res.check(len(d.page.eval(DETAILS)) == 1 and "LIRP" in d.page.eval(DETAILS)[0],
                  "TAP opens the lit row's details", d.page.eval(DETAILS))

        # Take off: a new open flight shows up when HobbsTimeMinutes moves; the open row stays open
        push_hobbs(d, 118)
        d.page.pump(1.3)    # servicestatus.js passes one /status frame a second
        log["entries"] = list(FLIGHTS) + [OPEN]
        push_hobbs(d, 130)
        d.page.wait("document.querySelectorAll('[ui-view] tr.logbook-row').length == 4", timeout=5,
                    label="live reload")
        rows = d.page.eval(ROWS)
        res.check("IN FLIGHT" in rows[0][1] and rows[0][2] == "0:12",
                  "a HobbsTimeMinutes change reads the log again: the flight in progress on top", rows[0])
        res.check(d.page.eval(TOTALS) == "4 flights · 2:10", "and the total follows", d.page.eval(TOTALS))

        # A power cut in flight, then a new flight: the old one shows NO LANDING, not IN FLIGHT
        d.page.pump(1.3)
        log["entries"] = list(FLIGHTS) + [OPEN, dict(OPEN, departureTime="2026-11-21T08:00:00Z")]
        push_hobbs(d, 142)
        d.page.wait("document.querySelectorAll('[ui-view] tr.logbook-row').length == 5", timeout=5,
                    label="power cut reload")
        rows = d.page.eval(ROWS)
        res.check("IN FLIGHT" in rows[0][1] and "NO LANDING" in rows[1][1] and "IN FLIGHT" not in rows[1][1],
                  "only the newest unclosed flight is in progress", rows[:2])
        res.check(len(d.page.eval(DETAILS)) == 1 and "LIRP" in d.page.eval(DETAILS)[0],
                  "a row the pilot opened stays open", d.page.eval(DETAILS))
        res.check(not kt.errors(d, "logbook"), "no JS error", kt.errors(d, "logbook")[:3])
    finally:
        kt.close(d)

    # The round panel: every row on the glass; an empty log says so
    log = {"entries": [dict(FLIGHTS[0], departureTime="2026-10-%02dT10:00:00Z" % (i + 1)) for i in range(12)]}
    d = kt.boot(size=(480, 480), setup=setup)
    try:
        kt.route(d, "logbook", READY, count=12)
        kt.check_glass(d, res, "logbook", 480, 480)
        log["entries"] = []
        d.show("emsegt", None)
        kt.route(d, "logbook", READY)
        d.page.wait("!!document.querySelector('[ui-view] .logbook-empty')", timeout=5, label="empty")
        res.check(d.page.eval(EMPTY) == "No flights recorded yet" and d.page.eval(TOTALS) == "0 flights · 0:00",
                  "an empty log says so", (d.page.eval(EMPTY), d.page.eval(TOTALS)))
        res.check(not kt.errors(d, "logbook"), "no JS error at 480x480", kt.errors(d, "logbook")[:3])
    finally:
        kt.close(d)

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
