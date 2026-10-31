#!/usr/bin/env python3
"""Run the RB-01 HMI from the working tree, against simulated or live data.

    ./simulator.py                                   # sample flight, real time
    ./simulator.py --list                            # the recordings in test-data/
    ./simulator.py 20260913111200 --speed 4 --from 600    # one of them, by (part of) its name
    ./simulator.py ~/flightlog-20260614112243.0361.sqlite # or any path
    ./simulator.py --idle                            # no flight: drive it from /sim/
    ./simulator.py --device http://192.168.10.1      # live data from the aircraft
    ./simulator.py --device http://192.168.10.1 --write   # ...and forward writes too

Serves web/ from this checkout on a local port, so an edit to web/RB-01/ shows
on the next reload of /RB-01/ - no copying to the aircraft. Behind it:

  simulated   the fake backend (rbserver.py) answering REST with the aircraft
              snapshot in fixtures/, and a recorded flight (flightlog.py)
              playing down the service sockets on the log's own clock.
  --device    the aircraft itself: every GET and every WebSocket the working
              tree does not answer is bridged to it. Writes (POST/PUT/DELETE)
              are refused with 403 until --write is given.

/sim/ is a control page (sliders, replay, a traffic target) and /sim a JSON
API for the same - see FakeStratux._sim in rbserver.py.
"""

import argparse
import sys
import time
import webbrowser

from flightlog import FlightLog, TEST_DATA, available, summary
from plates import FLIGHT, WEB
from rbserver import FakeStratux


def hold(srv):
    """Keep the display fed while nothing is playing: the daemon re-sends the
    situation at every GPS fix and every live target once a second even when
    nothing changes, and plates opened later rely on that."""
    while True:
        rp = srv.replay_current
        if not (rp and rp.playing):
            srv.push("/situation", srv.situation)
            for target in srv.traffic:
                srv.push("/traffic", target)
        time.sleep(1)


def follow(srv, rp):
    """Print progress while a replay plays; returns when it stops."""
    last = -1
    while not rp.wait(0.5):
        if int(rp.position) // 10 != last:
            last = int(rp.position) // 10
            sit = srv.situation
            print("  t=%5.0f s  %6.1f kt  %5.0f ft  trk %3.0f  roll %+5.1f  %d frames"
                  % (rp.position, sit.get("GPSGroundSpeed", 0), sit.get("GPSAltitudeMSL", 0),
                     sit.get("GPSTrueCourse", 0), sit.get("AHRSRoll", 0), rp.pushed))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("log", nargs="?", default=FLIGHT,
                    help="a datalog.go SQLite flight log: a path, or the name (or a unique "
                         "part of it) of one in test-data/ - see --list")
    ap.add_argument("--list", action="store_true", help="list the flight logs in test-data/ and exit")
    ap.add_argument("--speed", type=float, default=1.0, help="playback speed multiplier")
    ap.add_argument("--from", dest="start", type=float, default=0.0,
                    help="log seconds to start at")
    ap.add_argument("--to", dest="end", type=float, default=None,
                    help="log seconds to stop at")
    ap.add_argument("--port", type=int, default=8000, help="HTTP port (0 = any free)")
    ap.add_argument("--loop", action="store_true", help="restart when the flight ends")
    ap.add_argument("--idle", action="store_true",
                    help="no flight: the snapshot and a level situation, driven from /sim/")
    ap.add_argument("--device", metavar="URL",
                    help="proxy the live aircraft (e.g. http://192.168.10.1) instead of simulating")
    ap.add_argument("--write", action="store_true",
                    help="with --device: forward POST/PUT/DELETE to the aircraft")
    ap.add_argument("--open", action="store_true", help="open the HMI in a browser")
    args = ap.parse_args(argv)

    if args.list:
        logs = available()
        print("flight logs in %s:" % TEST_DATA if logs else "no flight logs in %s" % TEST_DATA)
        for _name, path in logs:
            info = summary(path)
            print("  %-34s %s" % (info["name"], info.get("error") or "%5.0f s  %3d targets  %s" % (
                info["duration"], info["targets"], info["started"] or "no GPS time")))
        return 0

    if args.device:
        srv = FakeStratux(WEB, port=args.port, upstream=args.device,
                          allow_writes=args.write).start()
        print("RB-01 at %s/RB-01/   working tree %s" % (srv.url, WEB))
        print("live data from %s - %s" % (
            args.device, "writes forwarded" if args.write else "writes blocked (add --write)"))
        print("control page %s/sim/   Ctrl-C to stop" % srv.url)
        if args.open:
            webbrowser.open(srv.url + "/RB-01/")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            srv.stop()
        return 0

    srv = FakeStratux(WEB, port=args.port).start()
    print("RB-01 at %s/RB-01/   working tree %s" % (srv.url, WEB))
    print("control page %s/sim/   Ctrl-C to stop" % srv.url)
    if args.open:
        webbrowser.open(srv.url + "/RB-01/")
    try:
        if args.idle:
            print("idle: level flight at the default position - move it from /sim/")
            hold(srv)
        log = FlightLog(args.log)
        print(log.info())
        print("playing at %gx from t=%.0f s" % (args.speed, args.start))
        while True:
            rp = srv.start_replay(log, start=args.start, end=args.end)
            rp.play(speed=args.speed, until=args.end)
            follow(srv, rp)
            if not args.loop:
                print("flight over - holding the last state (Ctrl-C to quit)")
                hold(srv)
            print("restarting from t=%.0f s" % args.start)
    except KeyboardInterrupt:
        pass
    finally:
        srv.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
