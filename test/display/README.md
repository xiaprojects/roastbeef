# RB-01 display tests

Automated tests that drive the **real** RB-01 HMI in a real Chromium, with a fake
Stratux backend behind it. No GPS, no SDR, no Go daemon, no aircraft.

```sh
cd test/display
./run.py                  # every test file
./run.py synthview        # just test_synthview.py
./run.py -k               # keep going after a failure
```

Screenshots land in `test/display/shots/` (git-ignored).

## Why it is written this way

**Zero required dependencies.** Python 3 and a `chrome`/`chromium` on `PATH`,
nothing else. No node, no npm, no pip, no Selenium, no Playwright. This matches
the rest of `web/`, which deliberately has no build step, and it means the tests
run on a Pi as-is. `cdp.py` speaks just enough of the WebSocket protocol and the
Chrome DevTools Protocol to drive the browser. Pillow is *optional*: the pixel
diff uses it when present and otherwise falls back to a small standard-library
PNG decoder that gives the same count about 7x slower (`apt install python3-pil`
on a Pi if `settle()` feels sluggish).

**The HMI's only inputs are static files and the service WebSockets.** So
`rbserver.py` serves `web/` and fakes `/situation`, `/traffic`, `/autopilot` and
friends. Every scenario is therefore exact and repeatable: you say where the
aircraft is and what the flight plan is, rather than waiting for one.

**A recording carries no flight plan.** `main/datalog.go` logs mySituation,
traffic, ems, bridgefloat and status - never the autopilot - so a log holds the
path *flown* and never the route *programmed*. `test_guidance.py` closes that
gap by deriving the plan from the track itself (`flightpath.waypoints()`), which
also gives the test its sharpest assertion: the route came from this very
flight, so the aircraft must fly down the middle of its own tunnel. Douglas-
Peucker bounds how far a dropped sample sits from the chord that replaced it, so
the tolerance is a guarantee rather than a guess - on the committed track, 0.5 NM
keeps 21 waypoints and the worst error to 877 m of the 926 m allowed. Measured
offsets on the display come out at 183-369 m; displacing the plan by 4 km pushes
them to ~3500 m and the test fails, which is how it was checked.

**Tracks are committed as JSON, recordings are not.** No `.sqlite` under
`test-data/` is tracked - the useful ones are 98-133 MB - so
`python3 flightlog.py path <log.sqlite>` writes the ground track to
`fixtures/<log>.path.json` (579 samples at 5 s, 171 KB, one readable line each).
`FlightPath` replays it through the same sockets, so no test that uses it needs
a recording present.

**Real flights replay through the same sockets.** The daemon's SQLite flight
log (`main/datalog.go`) stores the very structs it broadcasts, so
`flightlog.py` reads one back and `Replay` pushes it down the fake sockets on
the log's own clock. `test-data/flightlog-sample.sqlite` is three minutes of a
real flight - take-off, climb, a 250° turn, ~20 targets, engine data.

**The REST answers come from a real aircraft.** `capture.py` GETs every
endpoint the HMI reads from an installed RB-01 and stores the answers in
`fixtures/rb01-device.json`; `rbserver.py` serves that by default. So
`/getSettings`, `/getEMS`, `/resources`, `/updates/available`, the aircraft's
own `settings/*.json` and the rest are what the plates see in the aircraft,
not hand-typed placeholders. Constructor arguments (`settings=`, `status=`,
`settings_overrides=`) still take precedence, and `device=None` turns it off.

## Files

| File | Role |
|---|---|
| `cdp.py` | Minimal Chrome DevTools Protocol client: launch/attach, `eval`, `wait`, `screenshot`, `click`, `key`, console + error capture |
| `rbserver.py` | Fake Stratux: static `web/`, REST stubs, and the service WebSockets with scripted pushes; `Replay` drives a recorded flight through them. Settings writes (`/setSettings`, `settings/*.json`) are applied and served back, so a form can be driven round-trip |
| `flightlog.py` | Reads a `datalog.go` SQLite flight log back as socket frames; CLI `info` and `extract` (cut a fixture out of a full flight) |
| `simulator.py` | Serves the working tree with simulated or live data behind it: `./simulator.py [log]`, `--idle`, `--device URL [--write]` |
| `simpanel.html` | The `/sim/` control page: situation sliders, replay start/step/stop, a traffic target |
| `test_simulator.py` | The `/sim` API and proxy mode, against a stand-in aircraft; no browser needed |
| `capture.py` | Snapshots the GET endpoints of a real RB-01 (default `http://192.168.10.1`) into `fixtures/rb01-device.json`; GET only, secrets blanked, identifying values listed |
| `fixtures/rb01-device.json` | The aircraft's answers: 24 REST endpoints plus the `settings/*.json` files that differ from the repo's |
| `plates.py` | `Display` (boot, navigate, `fly`, `replay`, `settle`, `shot`) and pixel diffing |
| `test_plates.py` | Every plate loads, binds live data, and logs no errors |
| `test_instruments.py` | Instruments track their data source and settle when it is constant |
| `test_controls.py` | Presses every `ng-click` control on every screen: reachable by touch, and does not throw |
| `test_keypad.py` | Drives the hardware knob on every screen, and walks the configured navigation order |
| `test_layout.py` | Every screen on all five panel geometries, checking nothing overflows |
| `test_settings.py` | The settings addon: every tab saves, and every body it posts is a key `/setSettings` knows with the type the daemon asserts |
| `test_synthview.py` | Terrain, traffic and the autopilot guidance tunnel |
| `test_map_terrain.py` | The map's terrain overlay flown over Europe (Alps, Genoa, Po plain, the grid's north edge): ~2000 probes per view read back from the layer canvas and checked against the grid at the aircraft's altitude, the Terrain box in the layer switcher tapped off and on (and remembered on the next visit), the 3D mesh holding the same window and coloured by the same rule, the shared window around the aircraft (only its cells in memory) moved on both screens once the aircraft is past half way to its edge, and the downloads counted (none at all for the map with the overlay off) |
| `test_guidance.py` | The guidance tunnel flown down a **real recorded path**: the plan is derived from the track, so the aircraft must fly inside its own tunnel |
| `flightpath.py` | A committed JSON track: replay it through the sockets, and derive a flight plan from it |
| `fixtures/*.path.json` | Ground tracks cut from a recording with `flightlog.py path` - small enough to commit, so a real flight is available on a clean clone |
| `test_replay.py` | A recorded flight replayed through attitude, hsi, ems and at 20x across the plates |
| `test_flight.py` | Integration test of one specific recording: at each checkpoint of the flight the plates must show the recorded values (`expected/<log>.json`) |
| `expected/` | What the display must show at each checkpoint of a recording, derived by `flightlog.py expect`; readable, and checked against the recording on every run |
| `known.py` | Bugs these tests found in pre-existing code — reported every run, but not failing the suite |
| `run.py` | Discovers and runs `test_*.py`, prints a summary |

## What the control test does and does not reach

`test_controls.py` clicks what a pilot could actually touch **in each plate's
default state**. Two things follow from that, and neither is a defect:

- **Most plates have no controls of their own.** attitude, hsi, speed, radar, map
  and ems are pure displays — every button on them is the shared navbar/FAB
  chrome. That chrome is identical everywhere, so it is clicked once (on the
  first screen) rather than 28 times; reachability is still checked on every
  screen, since that is cheap and does vary.
- **Controls inside collapsed panels are not clicked.** `radio.html` has 24
  `ng-click` handlers, but they live in panels that are shut on arrival, so they
  are invisible and untestable without first opening them. If you want them
  covered, drive the plate into that state first, then call `d.controls()`.
- **Neither are controls in a closed sidebar.** The radio and EMS widgets live
  in the sidebars, which mobile-angular-ui keeps laid out beneath the page and
  slides into view; until a sidebar is open its controls have a size but cannot
  be touched, and `controls()` reports them as not visible (`sidebar` says which
  one they are in). With the aircraft's settings a radio is configured, so this
  is what keeps the eight radio controls from being flagged on every screen.

Net effect: about 64 genuinely reachable controls across the 28 screens with
the aircraft snapshot in place (it was 28 with empty placeholders: no timers,
no resources, no radio meant nothing to press). If that number drops, coverage
regressed.

## Known issues

These tests were written after the code they exercise, and they immediately found
real bugs. Rather than leave the suite permanently red (which trains everyone to
ignore it) or silently skip them (which hides them), each one is listed in
`known.py` with the file and line, and printed on every run under **KNOWN
ISSUES**. A *new* failure still fails the suite.

**Delete the entry when you fix the bug.** A stale entry is worse than none — it
will swallow a future regression that happens to look similar.

The first sweep found six crashes — a keypad listener that kept firing on other
screens (`radio.js`, and the same missing guard in `timers.js`, `checklist.js`,
`switchboard.js`), four null dereferences on knob presses before a plate had
finished loading (`hsi.js`, `synthview.js`, `airfields.js`, `camera.js`), and an
undeclared variable that had silently disabled AHRS calibration since `3bd81f00`.
All six are fixed and their entries deleted; what remains in `known.py` is layout,
not crashes: the NW/NE corner FABs sit under the navbar, and on the timers plate
the east FAB covers a delete icon. Both need a product decision on z-order or
inset rather than a one-line fix.

## Writing a test

```python
from plates import Display, Result

res = Result()
with Display(port=9410, route=MY_ROUTE, situation={"GPSLatitude": 45.0}) as d:
    d.show("hsi", "#hsi")                 # navigate and wait for the root element
    d.fly(frames=6, GPSTrueCourse=135.0)  # push situation frames
    d.settle()                            # wait for the animation to stop
    res.check(not d.js_errors(), "hsi is error free")
    d.shot("hsi_135")
```

`Display(**backend)` forwards to `FakeStratux`, so `route=`, `traffic=`,
`situation=` and `settings_overrides=` are all available. `settings_overrides`
deep-merges over a real settings file, which is how a test varies configuration
without touching the repo:

```python
Display(settings_overrides={"/settings/synthview.json":
                            {"guidance": {"widthCells": 1.0}}})
```

## Refreshing the aircraft snapshot

```sh
./capture.py                        # aircraft on the default 192.168.10.1
./capture.py http://stratux.local   # or wherever it is
```

It only GETs, and only the endpoints listed in `capture.py` with the plate that
reads each - nothing with side effects (`/cageAHRS`, `/restart`, ...), so it is
safe against the installed aircraft. Passphrases and PINs are blanked before the
file is written; registration, pilot, Mode-S codes and addresses are kept but
printed, so whoever commits can decide. Unbounded listings (`/playback`,
`/flightlogs`) are truncated, and a settings file is stored only when it
differs from the repo's copy and is under 64 KB (`db.airfields.json` differs by
two entries but is served from `web/`). Addons the aircraft lists but this
checkout does not have are dropped from `/addons`, or the browser would 404 on
their scripts.

## Developing the HMI against the simulator

`simulator.py` serves **this checkout's `web/`** (with `Cache-Control:
no-store`, so an edit shows on the next reload) and puts one of three backends
behind it:

```sh
./simulator.py --idle                        # aircraft snapshot + a level situation
./simulator.py                               # ...+ the sample flight playing, real time
./simulator.py --list                        # the recordings in test-data/
./simulator.py 20260913111200 --speed 4 --from 600 --loop   # one of them, by (part of) its name
./simulator.py ~/some/flightlog.sqlite       # or any path
./simulator.py --device http://192.168.10.1  # the live aircraft
```

Wherever a log is named - the CLI, `POST /sim/replay {"log": ...}`, the
picker on `/sim/`, `FlightLog(...)`, `Display.replay(...)` - it can be a path
or the file name of a recording in `test-data/`, with or without `.sqlite`, or
any unique part of it (`sample`, `20260913111200`). `GET /sim/logs` and
`python3 flightlog.py list` show what is there, with duration and target
count; a file that is not a flight log (the daemon leaves an empty one behind
when it stops before the first write) is listed with the reason instead.

Open `/RB-01/` and work on a plate. `/sim/` is a control page - sliders for
pitch, roll, heading, track, speed, altitude, vertical speed, slip and g;
start, stop or step a recorded flight; drop a traffic target 2 nm ahead - and
the same is a JSON API for scripts:

```sh
curl -d '{"AHRSRoll": 30, "AHRSPitch": 5}' localhost:8000/sim/situation
curl localhost:8000/sim/logs               # recordings in test-data/, by name
curl -d '{"log": "sample", "start": 150, "speed": 0}' localhost:8000/sim/replay   # speed 0: stepped
curl -d '{"seconds": 10}'                  localhost:8000/sim/replay/step
curl -d '{"Icao_addr": 1, "Tail": "T1", "Position_valid": true, "Lat": 42.9, "Lng": 12.7, "Alt": 2000}' \
                                           localhost:8000/sim/push/traffic   # any socket path
curl localhost:8000/sim                    # state: situation, traffic, replay position
```

When a flight ends the last state is held and re-sent once a second, as the
daemon would, until Ctrl-C; `--loop` restarts instead.

**`--device` is the live aircraft.** Files that exist in the working tree are
served from here; everything else - every REST GET, every service WebSocket,
even an addon script this checkout does not have - is bridged to the aircraft.
So a plate under development runs against real sensors and real traffic
without copying anything to the Pi. Writes (`POST`/`PUT`/`DELETE`) are
answered `403` and printed, so nothing on the aircraft changes by accident;
`--write` forwards them. The fixture and replay are not used in this mode.

In a test:

```python
from plates import Display, FLIGHT

with Display() as d:
    d.show("attitude", "#attitude-rollpitch")
    rp = d.replay(FLIGHT, start=135)   # jump the display to t=135 s of the log
    rp.step(25)                        # advance 25 s: the HMI now shows t=160
    d.settle(); d.shot("in_the_turn")
    rp.play(speed=20); rp.wait()       # or run the rest in real time x20
```

`FLIGHT` is `test-data/flightlog-sample.sqlite` (override with `RB_FLIGHT`);
`d.replay("20260913111200")` picks another recording from `test-data/` by
name. Any log the daemon wrote works - `flightlog-*.sqlite` from
`ReplayLogPath`, or the older multi-session `stratux.sqlite`. Recording is off
by default: enable **Replay Log** in settings (`globalSettings.ReplayLog`); the
file is created once the GPS has a fix. Full recordings run to 100+ MB; keep
the ones that tests depend on small with `extract`, and think before
committing a whole flight.

To make a fixture, cut the interesting minutes out of a full flight. The raw
`es_messages` table (most of the bytes) is dropped; `timestamp_id` links are
kept, so a row in the extract is the same row as in the original:

```sh
python3 flightlog.py info    /var/log/flightlog-20260614112243.0294.sqlite
python3 flightlog.py extract /var/log/flightlog-20260614112243.0294.sqlite \
                             ../../test-data/flightlog-sample.sqlite --from 120 --to 300
```

`step()` is deterministic but not instantaneous, and that is on purpose. The
services in `web/RB-01/services/` rate-limit by wall clock - `/situation`
drops a frame that lands within 100 ms of the last one, `/ems` within 300 ms,
`/status` within 1 s - and the daemon never sends faster than that. So within a
step only the last snapshot per socket is delivered, and `step()` returns only
once each has been accepted (`Replay.SNAPSHOT_GAP`). Traffic is one frame per
target and is never throttled, so it is delivered exactly as recorded;
`rp.pushed + rp.coalesced` is the number of frames in the window.

## Verifying a specific flight

`test_flight.py` treats a recording as the ground truth of what the display
must show. `flightlog.py expect` reads the flight's own profile and picks the
moments worth checking - take-off (10 s after passing 40 kt), 60 % of the
climb, the steepest sustained bank, the top of climb, short final, and rolling
out after landing - then writes, for each, the situation, the accumulated
engine and bridge maps and the live traffic set to `expected/<log>.json`:

```sh
python3 flightlog.py expect 20260913111200      # -> expected/flightlog-20260913111200.0341.json
python3 test_flight.py                          # the default recording
RB_FLIGHT_LOG=20260905080041 python3 test_flight.py
```

At each checkpoint the test replays the five seconds leading up to it and
reads the plates back, not the sockets: the speed, altitude and heading
readouts and the bank angle on `attitude` (bound straight from the situation,
so they must match exactly), the gauges on `ems` whose sensors the flight
carries (RPM, oil temperature, OAT on this aircraft), and on `map` the ownship
position (within ~10 m) and the exact set of targets drawn - a target counts
while its recorded `Age` is within the shared 59 s limit in `js/global.js`
(the map's own 15 s constant only fades the icon). Then the take-off plays at
30x while the plates are flipped through, and nothing may throw.

The expectations file is regenerated in memory on every run and compared with
the committed one, so a fixture that changed under it is reported rather than
silently tested against. A recording with no take-off (a ground run) gets
start/middle/end checkpoints instead. If the recording itself is not in the
checkout (they are large; see the note under "Replaying a recorded flight"),
the test says so and passes vacuously, so a checkout without it stays green.

## Things worth knowing

- **Assert on pixels, not on SVG markup.** The instruments are drawn with svg.js
  and animate by setting attributes on the *root* `<svg>` (`viewBox`, transform).
  An `innerHTML` fingerprint reports "unchanged" while the needle visibly swings.
  `plates.moved_pixels()` is the reliable signal.
- **Use `settle()`, not `sleep()`.** The instruments ease toward a new value over
  a second or more. `settle()` polls the framebuffer and returns as soon as two
  consecutive frames agree.
- **three.js r136 assigns methods per instance.** `WebGLRenderer.render` and
  `OrbitControls.update` are **not** on the prototype, so patching the prototype
  silently does nothing. Wrap the constructor instead — see
  `Display.instrument_three()`.
- **Instrument before you navigate.** Plates build their scene on entry, so hooks
  must be installed while another plate is showing.
- **synthview is websocket-driven.** `animate()` renders a single frame and is
  re-armed by the `/situation` socket, so a test must keep pushing situations for
  the scene to redraw.
- **A flight log is not a trace.** `-trace` replays the daemon's raw *inputs*
  (NMEA, dump1090, APRS) through its parsers; the SQLite log holds its
  *outputs*, after fusion. Replaying it exercises the HMI, not the daemon. For
  the daemon's own pipeline use `stratuxrun -trace <file>`.

## Testing against a real RB-01

`cdp.py` can attach to the Chromium already running on a display, instead of
launching its own:

```sh
# on the Pi, start Chromium with the debug port open
chromium --remote-debugging-port=9222 --kiosk http://localhost/RB-01/

# then, from a machine that can reach it
ssh -N -L 9222:localhost:9222 pi@stratux &
python3 -c "
from cdp import Chrome
page = Chrome.attach(9222)
print(page.eval('window.location.hash'))
page.screenshot('display.png')"
```

That path uses the real daemon and real sensors, so it is a smoke test rather
than a deterministic one. The `run.py` suite always uses the fake backend.
