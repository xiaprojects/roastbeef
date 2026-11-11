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

# VOR and radio taking turns on one dongle

`test_vor_radio.py` presses the RB-01 screen in a real Chromium and checks that `rb-vor`
and `rb-sdr-radio` take turns on one dongle. Only one program can hold a dongle, so the
two work on it only if each lets go when the screen tells it to.

```sh
cd test/integration
python3 test_vor_radio.py                         # build, then ~1 min
python3 test_vor_radio.py --dongle                # on the real dongle, see below
RB_RADIOS_KEEP=/tmp/r python3 test_vor_radio.py   # also keep the logs and dongle.log
```

Needs what `test_daemon.py` needs, a Chromium, and `../rb-vor` and `../rb-sdr-radio`
with a Python that has their dependencies (`../rb-sdr-radio/.venv` by default; `RB_VOR`,
`RB_SDR_RADIO` and `RB_RADIOS_PYTHON` move them). If those are missing it prints SKIP and
passes. It leaves any other daemon alone: scratch `HOME`, free port, every SDR service off.

| Part | In this test |
|---|---|
| HMI | Real: `web/RB-01` in Chromium, at exactly 1024x600. Every press is a real mouse event after a hit test, so a control under a navigation FAB fails |
| `stratuxrun` | Real, built from this checkout: `POST /radio/0`, the float bridge, `radioSdrTune` |
| `rb-vor`, `rb-sdr-radio` | Real: each daemon's own `main()`, bridge client, state machine and DSP |
| Dongle | Stand-in, `dongle.py`. Refuses a second claim as `usb_claim_interface` does, gives it back if the holder dies, and runs in real time. Radiates a VOR on 109.400 (radial 130) and 113.800 (radial 245), a localizer on 110.300 (DDM +0.0775) and AM on 118.700, with noise everywhere else |
| Audio player | A script that saves what it is sent |

Because a signal exists only on its own channel, the plate can show the right station
and radial only if the press reached the receiver and the receiver tuned what was pressed.

## What it checks

| Area | Requirement |
|---|---|
| Two rounds of turns | VOR plate: pick a station, the plate shows FIX with that station's name and frequency, the needle gets that station's radial (3°). OFF, and the dongle is free. Radio plate: INACTIVE to ACTIVE, the channel is received with its SNR. SWITCH FREQ. retunes and the empty channel stays shut, and back. ACTIVE to INACTIVE, and the dongle is free |
| The dongle's own log | The claims go `vor, radio, vor, radio`, none refused, so each released it before the other asked. `rb-vor` tuned what was pressed. Each transmission is a WAV under its channel, and reached the player |
| Radio pressed while the VOR holds it | `rb-sdr-radio` reports status 1, fault bit 2, and `rb-vor` is not disturbed. OFF on the VOR, and the radio takes the dongle by itself at its next retry |
| VOR picked while the radio holds it | The plate shows NO SIGNAL with that station. `rb-vor` is refused, tries again, and stays up. The radio is not disturbed. When the radio goes INACTIVE, `rb-vor` takes the dongle by itself |
| `rb-vor` killed and restarted | With a station selected, it comes back on that station with no press. With a station picked while it was down, it comes up on that one. Either way it has read the bridge, and OFF still reaches it |
| ILS localizer (RB-VOR-IF v2.3) | `rb-vor` runs with `loc.enabled`. A localizer list entry added to the page only while the test runs (`TEST LOC FIXTURE`, 110.300, course 090; the shipped list has none) is picked: the plate shows LOC with that name and frequency, the bar is never drawn while TUNING or ACQUIRING, `locdev` is the 50 % the stand-in radiates (DDM +0.0775, `dongle.LOC_KHZ`), and the bar sits left of the course pointer, which is fly left. A second fixture on 108.900, where only noise is on the air, shows LOC NO SIGNAL and no bar for 12 s. A VOR then clears the localizer display, the localizer brings it back, and OFF parks the bar and frees the dongle |
| Logs | No error in the HMI, no panic, all three daemons still up |

One known gap: the radio plate says ACTIVE while the radio waits for the dongle. The test
prints it as KNOWN without failing, see `docs/tech-debt/radio-active-status.md`.

## On the real dongle

`--dongle` runs the same presses with the daemons opening the real device, and
`dongle.py` adds only the log. The claim, the release and the kernel driver coming back
between two processes are real, which is what the stand-in cannot show. Nothing known
is on the air, so it checks that the receivers took turns and tuned, not that they heard
anything: any working status will do, with no radial and no recording. An antenna
indoors usually hears nothing, so `NO SIGNAL`, `ACQUIRING` and a shut squelch all pass.

`rb-vor` needs `pyrtlsdr` or SoapySDR, and the `.venv` has neither. A current `pyrtlsdr`
does not import on a stock librtlsdr (`rtlsdr_set_dithering`, `rb-vor` A27), but 0.3.0
does and reads samples from an R820T. It needs `pkg_resources`:

```sh
../rb-sdr-radio/.venv/bin/python -m pip install --target /tmp/pyrtl "pyrtlsdr==0.3.0" "setuptools<81"
PYTHONPATH=/tmp/pyrtl python3 test_vor_radio.py --dongle
```

It opens device index 0 and stops at once, exit 2, if no dongle or no backend is there.
On 2026-11-05 it passed on a Nooelec NESDR Nano 3 (R820T), indoors on an x86 PC, with the
kernel DVB driver loaded: each claim detaches it and each release reattaches it, and a
handover takes about 1.8 s. Not yet run on a Pi or with an FC0012.

`/tmp` here is a tmpfs with a per-user quota, so `df` can show space while the Go linker
fails with `No space left on device`. Point `TMPDIR` at a directory on disk.

A test that is killed stops its receivers, even with SIGKILL (`PR_SET_PDEATHSIG`). One left
behind would go on retrying and take the dongle the moment it is plugged in, which is what
this did before that was added.

# The SDR radio watching two channels

`test_radio_dual.py` presses the RB-01 radio plate in a real Chromium, on a `stratuxrun` built
from this checkout, and checks the real `rb-sdr-radio` taking turns on two channels. It uses
the harness of `test_vor_radio.py`, without `rb-vor`.

```sh
python3 test_radio_dual.py                         # build, then ~1 min
python3 test_radio_dual.py --dongle                # on the real dongle
RB_RADIOS_KEEP=/tmp/r python3 test_radio_dual.py   # also keep the logs and dongle.log
```

`dongle.py` radiates a station on each of 118.700, 119.700 and 113.800, and retunes as slowly
as a real R820T. A station is on the air until `air.json` exists in the scratch directory, and
then only if its kHz are listed there, which is how the test keys one. Nothing else in the
chain is a stand-in, so the receiver can only find a transmission by really hopping to it.

| Step | Checks |
|---|---|
| Sliders | Opened by the button, a real press on a step reaches the receiver, which replies |
| VOL 0 | From a fresh config too: the radio goes INACTIVE, the dongle and sound device are released, and ACTIVE brings it back on its last level |
| DUAL | The receiver replies, the tuner hops about 20 times a second between those two channels, no hop reaches the bridge |
| A transmission | It locks on the standby, RX moves there, and the active digits stay |
| The primary | Starting during a secondary that never stops, it takes the lock inside a look back |
| After the hold | It goes quiet and takes turns again, and each channel has a recording |
| SWITCH FREQ. | The digits wait for the reply, like `vorfreqactive`, and the watching swaps |
| Squelch OPEN | The watching stops and DUAL warns, and a squelch brings it back |
| A restart of `stratuxrun` | The bridge starts empty, and the watching comes back on the pilot's squelch |
| DUAL off | The tuner stops, on the active |
| The VOR band | The receiver tunes it, hears a carrier that never stops, and records none of it |
| Off | The dongle is released |

`--dongle` skips the transmissions, as nothing known is on the air. The hops are real, the rest
holds, and for what the tuner itself does use `python3 -m rbsdrradio test-dual`, see the
`rb-sdr-radio` README.
