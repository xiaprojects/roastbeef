# Daemon integration test

Replays a recorded flight's receiver input through a `stratuxrun` built from this
checkout and checks that its outputs match what the daemon on the aircraft
produced from the same input.

```sh
cd test/integration
python3 test_daemon.py                         # build, replay (~2.5 min), check
RB_REPLAY_KEEP=/tmp/r python3 test_daemon.py   # also keep the daemon's log and HOME
```

Needs Go (with `libdump978.so` built, as for `make`) and Python 3. Nothing else, and
no root. The daemon runs in a scratch `HOME` on a free port (`-port` is honoured
when not root), so it can run next to `test/display/simulator.py`. The FLARM NMEA
port is fixed at 2000: if something already listens there (another `stratuxrun`),
the FLARM checks print SKIP rather than read the other daemon.

The replay runs in real time and the checks pair outputs by when they arrived, so run
it on an otherwise idle machine: a `go vet` compiling in parallel once delayed a
cycle enough to fail the geometry and currency checks.

## How it works

A flight log (`main/datalog.go`) holds both sides of the daemon:
- **Input:** every line dump1090 sent it (`es_messages`).
- **Output:** the traffic and ownship state it derived from those lines (`traffic`, `mySituation`).

`replay.py make` cuts a window of a log into two fixtures:

| File | Contents |
|---|---|
| `fixtures/<log>.<from>-<to>.trace.csv.gz` | The input, in the daemon's own trace format (`stratuxrun -trace`): stratux-clock time, context, raw line. Starts 30 s before the window, to warm the daemon up. |
| `fixtures/<log>.<from>-<to>.expected.json.gz` | The recorded output for the window: the target state at each 1 Hz cycle, and the GPS fixes. |

The daemon replays the trace through the same parsers the live receivers use.
The test reads its `/traffic`, `/radar`, `/gdl90` and `/situation` sockets.

Three details make an exact comparison possible:

- **The GPS is rebuilt bit for bit.** The log keeps no raw NMEA, only the parsed
  fix. `replay.py` writes GGA, RMC and GST sentences, using for each number the
  shortest decimal that `gps.go`'s own parsing turns back into the recorded
  float32.
- **States are matched by message count, not by clock.** `ReceivedMsgs` counts the
  messages fused into a target, and `/traffic` sends the state after every
  message. So "the aircraft's state after k messages" can be compared with "the
  replay's state after the same k messages". It is identical, bit for bit.
- **A field is compared only once the trace has delivered its source.** A
  callsign the aircraft learnt before the window began can't be in the replay.

## What it checks

| Area | Requirement |
|---|---|
| Daemon | Replays the whole trace, exits 0, no panic in the log |
| Ownship | Every GPS fix settles to the recorded situation, float32 for float32 |
| Fusion | Identity, position, altitude, velocity, NIC/NACp and signal level match in ~1300 target states |
| Geometry | Distance and bearing agree, to within ownship's movement between the fixes the log kept (the receiver ran faster than the log's one fix a second) |
| Currency | Each cycle sends exactly the targets the aircraft did, except within 1.5 s of the 6 s and 25 s age limits |
| GDL90 | Every CRC valid; a heartbeat a second with the GPS flag; an ownship report every second, on a GPS fix, at the daemon's pressure altitude or the GPS's while it has none; a geometric altitude every second, a fix's height above the ellipsoid; no traffic report at a position its target never transmitted |
| FLARM NMEA | On TCP :2000: every sentence well-formed with a valid checksum; RMC and GGA every second at a GPS fix; one PFLAU a second; each cycle's PFLAA name exactly the targets its GDL90 reports do, at the same place relative to ownship (5 m) and the same height (one 25 ft GDL90 step) |

The 6 s limit for targets without velocity isn't exercised here, because every
target in this window has a velocity and is dead-reckoned before 6 s.
`main/traffic_test.go` covers it.

It was checked by mutation. Rounding the GDL90 lat/lon instead of truncating it,
or a wrong feet-per-metre factor in the GGA parser, each fails it.

## What it found

The recording is ground truth for the aircraft's behaviour, and two of the
differences were defects in the daemon. Both are fixed, with unit tests:

- **Targets missing for a second.** Dead-reckoned targets dropped out of the
  output for one second at a time: 299 times in the 49-minute flight. The
  extrapolator decided on the age cached by the last output cycle (see
  `extrapolateStaleTraffic` in `main/traffic.go`). The test still accepts these
  one-cycle gaps in the recording.
- **Ownship report at 0°N 0°E.** For the first 10 s after start-up, an ownship
  report went out at 0°N 0°E, 0 ft, flagged airborne (`isDetectedOwnshipValid` in
  `main/gen_gdl90.go`).

## Another window

```sh
python3 replay.py make 20260913111200 --from 1740 --to 1860   # log clock seconds
python3 replay.py info fixtures/<name>.trace.csv.gz
```

The log is named by path or by any unique part of its file name in `test-data/`.
Two minutes of traffic is about 340 KB of fixtures. Point `NAME` in
`test_daemon.py` at a new pair, or add a loop over several.
