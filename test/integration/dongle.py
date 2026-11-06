#!/usr/bin/env python3
"""A receiver daemon with its USB dongle replaced, or logged.

    python dongle.py vor   <rb-vor checkout>       <dir> --config rb-vor.json
    python dongle.py radio <rb-sdr-radio checkout> <dir> --config rb-sdr-radio.json
    python dongle.py radio --real ...                      # the dongle on this machine
    python dongle.py probe <rb-sdr-radio checkout>         # why --real cannot work here

Runs the daemon's own main(): its bridge client, state machine, DSP and publisher are
the real ones, and it exits as it would on a Pi. Only what it opens instead of a dongle
is different, and that keeps the three properties test_vor_radio.py depends on:

- One program at a time. Both daemons claim <dir>/dongle.claim, and the second one is
  refused as usb_claim_interface refuses it. flock, because the kernel gives it back
  when the holder dies, as it does a USB interface.
- A signal only on its channel. Tuned anywhere else the dongle reads noise, so a daemon
  on the wrong frequency hears nothing and the plate shows it.
- Real time. A read takes as long as the samples it returns.

Every claim, refusal, tune and release is one JSON line in <dir>/dongle.log. With --real
the daemon opens the dongle itself and only the log is added, so the test reads both
the same way.

Needs the daemons' own dependencies (numpy, scipy, websockets, aiohttp, jsonschema), so
it runs under their Python, not the one running the test. The constants are imported by
the test too, so numpy is only imported in main().
"""

import fcntl
import json
import os
import sys
import time

FS = 1_024_000
OFFSET = -256_000      # both daemons park the tuner fs/4 below the channel
BLOCK = 65_536         # the larger of the two daemons' blocks
LOOP_S = 2.0           # whole cycles of every tone, so the loop has no seam
NOISE_DBFS = -60.0

# What is on the air. Each VOR has its own radial, so the plate shows which one it hears.
VOR_KHZ = {109_400: 130, 113_800: 245}
COM_KHZ = 118_700


class Logged:
    def __init__(self, who, directory):
        self.who, self.directory = who, directory

    def note(self, event, **fields):
        line = json.dumps(dict(fields, t=time.time(), who=self.who, event=event)) + "\n"
        fd = os.open(os.path.join(self.directory, "dongle.log"),
                     os.O_CREAT | os.O_WRONLY | os.O_APPEND)
        try:
            os.write(fd, line.encode())
        finally:
            os.close(fd)


class Real(Logged):
    """What the daemon opens itself, with the same log as the stand-in."""

    def __init__(self, who, directory, opener, cfg, refused):
        super().__init__(who, directory)
        try:
            self.device = opener(cfg)
        except refused:
            self.note("busy")
            raise
        self.note("open")

    def __getattr__(self, name):
        return getattr(self.device, name)     # tuner, swap_iq, read, ...

    def set_frequency(self, hz):
        self.note("tune", hz=int(hz))
        self.device.set_frequency(hz)

    def close(self):
        self.device.close()
        self.note("close")


class Dongle(Logged):
    tuner = ""
    name = "stand-in dongle"

    def __init__(self, who, directory, sky, quiet, refused):
        super().__init__(who, directory)
        self.sky, self.quiet = sky, quiet
        self.hz = 0
        self.position = 0
        self.closed = False
        self.fd = os.open(os.path.join(directory, "dongle.claim"), os.O_CREAT | os.O_RDWR)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(self.fd)
            self.note("busy")
            raise refused("usb_claim_interface error -6") from None
        self.note("open")

    def set_frequency(self, hz):
        self.hz = int(hz)
        self.note("tune", hz=self.hz)

    def read(self, n):
        time.sleep(n / FS)
        source = self.sky.get(self.hz, self.quiet)
        start = self.position % (source.size - BLOCK)
        self.position += n
        return source[start:start + n]

    def close(self):
        if not self.closed:
            self.closed = True
            self.note("close")
            os.close(self.fd)   # also releases the flock


def looped(numpy, samples):
    """`samples` with its head repeated, so a read across the end is seamless."""
    return numpy.concatenate((samples, samples[:BLOCK])).astype(numpy.complex64)


def vor(directory, argv, real):
    from rbvor import _threadcaps  # noqa: F401  # must come before numpy
    import numpy as np
    from rbvor import sdr
    from rbvor.__main__ import main
    from tools.vor_gen import VorParams, generate_blocks

    if real:
        opener = sdr.open_device
        sdr.open_device = lambda cfg: Real("vor", directory, opener, cfg, sdr.SdrError)
        return main(argv)

    sky = {}
    for khz, radial in VOR_KHZ.items():
        params = VorParams(radial_deg=radial, fs=FS, seconds=LOOP_S, offset_hz=OFFSET,
                           snr_db=40.0, ident="", seed=khz)
        sky[khz * 1000 + OFFSET] = looped(np, np.concatenate(list(generate_blocks(params))))
    quiet = looped(np, noise(np))
    sdr.open_device = lambda cfg: Dongle("vor", directory, sky, quiet, sdr.SdrError)
    return main(argv)


def radio(directory, argv, real):
    import numpy as np
    from rbsdrradio import sdr, synth

    # Before the daemon module is imported: it binds this name as a default argument
    if real:
        opener = sdr.RtlDevice
        sdr.RtlDevice = lambda cfg: Real("radio", directory, opener, cfg, sdr.SdrError)
    else:
        tone = synth.am(LOOP_S, -30.0, tone_hz=1000.0) + noise(np)
        sky = {COM_KHZ * 1000 + OFFSET: looped(np, tone)}
        quiet = looped(np, noise(np))
        sdr.RtlDevice = lambda cfg: Dongle("radio", directory, sky, quiet, sdr.SdrError)
    from rbsdrradio.__main__ import main
    return main(argv)


def probe(repo):
    """Why --real cannot work on this machine, or "" if it can."""
    from rbsdrradio.sdr import SdrError, list_devices
    try:
        if not list_devices():
            return "no RTL-SDR is plugged in"
    except SdrError as e:
        return str(e)
    for module in ("rtlsdr", "SoapySDR"):
        try:
            __import__(module)
            return ""
        except Exception:      # noqa: BLE001  # pyrtlsdr raises AttributeError on a stock librtlsdr
            continue
    return "rb-vor has no backend: this Python cannot import rtlsdr or SoapySDR, see the README"


def noise(np):
    n = int(LOOP_S * FS)
    rng = np.random.default_rng(0)
    scale = 10.0 ** (NOISE_DBFS / 20.0) / np.sqrt(2.0)
    return (rng.standard_normal(n) + 1j * rng.standard_normal(n)) * scale


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[0] == "probe":
        sys.path.insert(0, args[1])
        print(probe(args[1]))
        sys.exit(0)
    real = "--real" in args
    if real:
        args.remove("--real")
    who, repo, directory = args[:3]
    sys.path.insert(0, repo)
    sys.exit({"vor": vor, "radio": radio}[who](directory, args[3:], real))
