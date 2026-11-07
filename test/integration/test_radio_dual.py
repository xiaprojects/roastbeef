#!/usr/bin/env python3
"""Integration test: the SDR radio from the RB-01 screen, watching two channels.

A real Chromium presses the real radio plate, on a stratuxrun built from this checkout,
which commands the real rb-sdr-radio over the float bridge. Only the USB device is a
stand-in, as in test_vor_radio.py, whose harness this is. dongle.py radiates each station
on its own channel and keys it on and off, so the receiver can only find a transmission
by really hopping there.

    the sliders       opened by their button, real presses, the daemon's own reply
    VOL 0             the radio goes INACTIVE and gives the dongle back, and ACTIVE restores it
    DUAL              it takes turns on active and standby, and the digits stay put
    a transmission    on the standby: it locks, RX moves to it, the file names that channel
    the primary       starts talking meanwhile: it takes the lock inside a look back
    SWITCH FREQ.      the digits change on the receiver's reply, not on the press
    a restart         of stratuxrun: the watching comes back by itself
    the VOR band      a carrier that never stops, heard and not recorded

    python3 test_radio_dual.py                  # build, then about 1 min
    python3 test_radio_dual.py --dongle         # the same, on the dongle on this machine
    RB_RADIOS_KEEP=/tmp/r python3 test_radio_dual.py   # keep the logs, HOME and dongle.log

--dongle swaps the stand-in for the real device. Nothing known is on the air, so nothing
can be keyed: it proves that the tuner really hops from the HMI, and everything that does
not need a transmission. Needs what test_vor_radio.py needs, without ../rb-vor.
"""

import json
import os
import signal
import subprocess
import sys
import time

import dongle
from test_daemon import Result
from test_vor_radio import BOX, PYTHON, RB_SDR_RADIO, REAL, SETTINGS, Bench, HERE, RELEASE_S, RETUNE_S, stop

ACTIVE, STANDBY = "118.700", "119.700"
ACTIVE_KHZ, STANDBY_KHZ = dongle.COM_KHZ, dongle.COM2_KHZ
SETTINGS["Radio"][0]["FrequencyActive"] = ACTIVE
SETTINGS["Radio"][0]["FrequencyStandby"] = STANDBY

# Not the top of the slider: at this panel's size the south FAB is over it, see test_radio.py
SQUELCH_DB, VOLUME = 8, 50
HEAR_S = 3             # to a lock from a transmission: a cycle, a confirm and the status
LOOK_BACK_S = 2.5      # one look back, a confirm and the status
HOLD_S = 5             # dual.hold_s, and back on scan

RADIO_ON = 'document.querySelector(\'%s a[ng-click="enableRadio(radio,true)"]\')' % BOX
RADIO_OFF = 'document.querySelector(\'%s a[ng-click="enableRadio(radio,false)"]\')' % BOX
RADIO_SWAP = 'document.querySelector(\'%s a[ng-click="switchFreq(radio)"]\')' % BOX
DUAL_ON = 'document.querySelector(\'%s a[ng-click="dualFreq(radio,true)"]\')' % BOX
DUAL_OFF = 'document.querySelector(\'%s a[ng-click="dualFreq(radio,false)"]\')' % BOX
DIGITS = "document.querySelector('%s .Radio').textContent.trim()" % BOX
LEVELS = 'document.querySelector(\'%s a[ng-click="toggleLevels(radio)"]\')' % BOX
# The active's mark is in the heading, the standby's beside its digits
RX_ON = """[...document.querySelectorAll('%s .radioHeard')]
    .filter(e => e.offsetParent !== null)
    .map(e => e.closest('.panel-heading') ? 'active' : 'standby')""" % BOX
DUAL_CLASS = "%s.className" % DUAL_OFF
# Scroll a slider to the middle and say where one of its cells is
CELL = """(() => {
    const e = document.querySelector('%s input[aria-label=%%s]');
    e.scrollIntoView({behavior: "instant", block: "center", inline: "nearest"});
    const r = e.getBoundingClientRect();
    return {x: r.left + r.width * (%%d + 0.5) / %%d, y: r.top + r.height / 2};
})()""" % BOX


class RadioBench(Bench):
    """No rb-vor, and a scratch file to key the stations."""

    def start_receivers(self):
        self.air([])
        bridge = {"ws_url": "ws://127.0.0.1:%d/bridge/float/ws" % self.port,
                  "rest_url": self.url + "/bridge/float"}
        player = self.path("player")
        with open(player, "w") as fp:
            fp.write('#!/bin/sh\nexec cat >> "%s"\n' % self.path("heard.raw"))
        os.chmod(player, 0o755)
        self.playback = self.path("playback")
        with open(os.path.join(RB_SDR_RADIO, "config", "rb-sdr-radio.json")) as fp:
            cfg = json.load(fp)
        cfg["bridge"].update(bridge)
        cfg["audio"]["player"] = player
        cfg["record"]["dir"] = self.playback
        with open(self.path("rb-sdr-radio.json"), "w") as fp:
            json.dump(cfg, fp)
        self.receiver("radio", RB_SDR_RADIO, "--config", self.path("rb-sdr-radio.json"))
        self.wait_for(lambda: "sdrradiostatus" in self.bridge(), 30, "rb-sdr-radio on the bridge")

    def air(self, stations):
        """Key these stations, in kHz, and unkey the rest."""
        scratch = self.path("air.new")
        with open(scratch, "w") as fp:
            json.dump(stations, fp)
        os.replace(scratch, self.path("air.json"))

    def slide(self, name, level, top, step):
        cells = top // step + 1
        where = self.page.eval(CELL % (name, level // step, cells))
        self.page.pump(0.2)
        where = self.page.eval(CELL % (name, level // step, cells))
        for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
            self.page.send("Input.dispatchMouseEvent", type=kind, x=where["x"], y=where["y"],
                           button="left", clickCount=1)
        self.page.pump(0.2)

    def key(self, key, value):
        return self.bridge().get(key) == value

    def hops(self):
        return len(self.events("tune", "radio"))

    def recordings(self):
        try:
            return sorted(os.listdir(self.playback))
        except OSError:
            return []


def check_sliders(b, res):
    print("\n-- the sliders")
    b.press(LEVELS)
    b.page.pump(0.3)
    b.slide("Squelch", SQUELCH_DB, 10, 1)
    res.check(b.until(lambda: b.key("sdrradiosquelchactive", SQUELCH_DB), RELEASE_S),
              "the squelch slider reaches the receiver, and it replies %d dB" % SQUELCH_DB,
              b.bridge().get("sdrradiosquelchactive"))
    b.slide("Volume", VOLUME, 100, 10)
    res.check(b.until(lambda: b.key("sdrradiovolumeactive", VOLUME), RELEASE_S),
              "the volume slider reaches the receiver, and it replies %d" % VOLUME,
              b.bridge().get("sdrradiovolumeactive"))

    print("\n-- VOL 0 is off")
    # The one a config file with no level could never reach: a stored 0, and a default on top
    b.slide("Volume", 0, 100, 10)
    res.check(b.until(lambda: b.key("sdrradiovolumeactive", 0), RELEASE_S),
              "volume 0 reaches the receiver", b.bridge().get("sdrradiovolumeactive"))
    res.check(b.until(lambda: b.radio_shows()[0] == "INACTIVE", RELEASE_S), "the plate shows INACTIVE",
              b.radio_shows())
    res.check(b.until(lambda: b.key("sdrradiofreq", 0), RELEASE_S), "the frequency goes to 0",
              b.bridge().get("sdrradiofreq"))
    res.check(b.until(lambda: b.holder() is None, RELEASE_S), "the dongle is released", b.holder())
    res.check(b.until(lambda: b.key("sdrradiostatus", 0) and b.key("sdrradiosdr", 0), RELEASE_S),
              "the receiver reports off", b.bridge().get("sdrradiostatus"))
    res.check(b.key("sdrradioaudio", 0), "and has let the sound device go", b.bridge().get("sdrradioaudio"))
    res.check(b.radio_shows()[-1] == ACTIVE, "the plate keeps the channel", b.radio_shows())

    b.press(RADIO_ON)
    res.check(b.until(lambda: b.key("sdrradiofreqactive", ACTIVE_KHZ), RETUNE_S), "ACTIVE tunes it again",
              b.bridge().get("sdrradiofreqactive"))
    res.check(b.until(lambda: b.key("sdrradiovolumeactive", VOLUME), RELEASE_S),
              "on the level it was at, not silent", b.bridge().get("sdrradiovolumeactive"))
    res.check(b.until(lambda: b.key("sdrradioaudio", 1), RELEASE_S), "with the sound device back",
              b.bridge().get("sdrradioaudio"))


def check_dual_on(b, res):
    print("\n-- DUAL")
    before = b.hops()
    b.press(DUAL_ON)
    res.check(b.until(lambda: b.key("sdrradiosecondaryactive", STANDBY_KHZ), RETUNE_S),
              "pressed: the receiver replies that it watches %s" % STANDBY,
              b.bridge().get("sdrradiosecondaryactive"))
    res.check(b.key("sdrradiofreqactive", ACTIVE_KHZ), "the primary does not move",
              b.bridge().get("sdrradiofreqactive"))
    b.page.pump(2.0)
    hopped = b.hops() - before
    res.check(hopped >= 20, "the tuner is hopping: about 20 a second", "%d in 2 s" % hopped)
    tuned = {hz // 1000 for hz in b.tuned("radio")[-10:]}
    res.check(tuned == {ACTIVE_KHZ, STANDBY_KHZ}, "between those two channels", sorted(tuned))
    res.check(b.page.eval(DIGITS) == ACTIVE, "the digits stay on the active", b.page.eval(DIGITS))
    res.check("label-success" in b.page.eval(DUAL_CLASS), "DUAL ON, without a warning",
              b.page.eval(DUAL_CLASS))
    state = b.bridge()
    res.check(state.get("sdrradiostatus") == 3 and state.get("sdrradiosnr") == 0,
              "a hop reaches nobody: status 3, no reading", state.get("sdrradiostatus"))


def check_transmissions(b, res):
    print("\n-- a transmission on the standby")
    res.check(b.page.eval(RX_ON) == [], "nothing heard, no RX", b.page.eval(RX_ON))
    keyed = time.monotonic()
    b.air([STANDBY_KHZ])
    heard = b.until(lambda: b.key("sdrradiofreqheard", STANDBY_KHZ), HEAR_S)
    res.check(heard, "it locks on the standby, in %.2f s" % (time.monotonic() - keyed),
              b.bridge().get("sdrradiofreqheard"))
    res.check(b.key("sdrradiostatus", 4), "the status is receiving", b.bridge().get("sdrradiostatus"))
    res.check(b.until(lambda: b.page.eval(RX_ON) == ["standby"], RELEASE_S),
              "RX is on the standby", b.page.eval(RX_ON))
    res.check(b.page.eval(DIGITS) == ACTIVE, "the active digits do not move", b.page.eval(DIGITS))
    b.page.pump(1.5)

    print("\n-- the primary starts talking")
    keyed = time.monotonic()
    b.air([ACTIVE_KHZ, STANDBY_KHZ])
    taken = b.until(lambda: b.key("sdrradiofreqheard", ACTIVE_KHZ), LOOK_BACK_S)
    res.check(taken, "it takes the lock from a standby that never stopped, in %.2f s"
              % (time.monotonic() - keyed), b.bridge().get("sdrradiofreqheard"))
    res.check(b.until(lambda: b.page.eval(RX_ON) == ["active"], RELEASE_S),
              "RX moves to the active", b.page.eval(RX_ON))
    b.page.pump(1.5)

    print("\n-- both stop")
    b.air([])
    res.check(b.until(lambda: b.key("sdrradiofreqheard", 0) and b.key("sdrradiostatus", 3), HOLD_S),
              "it goes quiet", b.bridge().get("sdrradiofreqheard"))
    before = b.hops()
    res.check(b.until(lambda: b.hops() > before + 5, HOLD_S), "and takes turns again after the hold",
              b.hops() - before)
    names = b.recordings()
    for khz in (STANDBY_KHZ, ACTIVE_KHZ):
        res.check(any(name.endswith("_%d.wav" % (khz * 1000)) for name in names),
                  "a recording names %d" % khz, names)
    with open(b.path("heard.raw"), "rb") as fp:
        res.check(len(fp.read()) > 16000, "and the player was fed")


def check_switch(b, res):
    print("\n-- SWITCH FREQ.")
    b.press(RADIO_SWAP)
    res.check(b.page.eval(DIGITS) == ACTIVE, "pressed: the digits wait for the receiver",
              b.page.eval(DIGITS))
    res.check(b.until(lambda: b.key("sdrradiofreqactive", STANDBY_KHZ), RETUNE_S),
              "the receiver replies %s" % STANDBY, b.bridge().get("sdrradiofreqactive"))
    res.check(b.until(lambda: b.page.eval(DIGITS) == STANDBY, RELEASE_S), "and the digits follow",
              b.page.eval(DIGITS))
    res.check(b.until(lambda: b.key("sdrradiosecondaryactive", ACTIVE_KHZ), RETUNE_S),
              "the watching swaps with it", b.bridge().get("sdrradiosecondaryactive"))
    b.press(RADIO_SWAP)
    res.check(b.until(lambda: b.page.eval(DIGITS) == ACTIVE, RETUNE_S), "and back", b.page.eval(DIGITS))
    res.check(b.until(lambda: b.key("sdrradiosecondaryactive", STANDBY_KHZ), RETUNE_S),
              "watching the standby again", b.bridge().get("sdrradiosecondaryactive"))


def check_warning(b, res):
    print("\n-- squelch held open")
    b.slide("Squelch", 0, 10, 1)
    res.check(b.until(lambda: b.key("sdrradiosecondaryactive", 0), RETUNE_S),
              "OPEN stops the watching: every look would find a signal",
              b.bridge().get("sdrradiosecondaryactive"))
    res.check(b.until(lambda: "label-warning" in b.page.eval(DUAL_CLASS), RELEASE_S),
              "and DUAL says so", b.page.eval(DUAL_CLASS))
    b.slide("Squelch", SQUELCH_DB, 10, 1)
    res.check(b.until(lambda: b.key("sdrradiosecondaryactive", STANDBY_KHZ), RETUNE_S),
              "a squelch brings it back", b.bridge().get("sdrradiosecondaryactive"))
    res.check(b.until(lambda: "label-success" in b.page.eval(DUAL_CLASS), RELEASE_S),
              "and DUAL with it", b.page.eval(DUAL_CLASS))


def check_restart(b, res):
    print("\n-- stratuxrun restarts")
    proc = b.procs["stratuxrun"]
    proc.terminate()
    proc.wait(timeout=10)
    b.run_stratuxrun()
    res.check(b.until(lambda: b.key("sdrradiofreqsecondary", 119.7), RETUNE_S) or
              abs(b.bridge().get("sdrradiofreqsecondary", 0) - 119.7) < 0.001,
              "the bridge starts empty, and it sends the standby again",
              b.bridge().get("sdrradiofreqsecondary"))
    res.check(b.until(lambda: b.key("sdrradiosecondaryactive", STANDBY_KHZ), 15),
              "the receiver is watching again", b.bridge().get("sdrradiosecondaryactive"))
    res.check(b.key("sdrradiosquelchactive", SQUELCH_DB), "on the pilot's squelch",
              b.bridge().get("sdrradiosquelchactive"))
    b.page.pump(1.5)


def check_dual_off(b, res):
    print("\n-- DUAL off")
    b.show("radio", BOX)
    b.press(DUAL_OFF)
    res.check(b.until(lambda: b.key("sdrradiosecondaryactive", 0), RETUNE_S),
              "pressed: one channel", b.bridge().get("sdrradiosecondaryactive"))
    b.page.pump(0.5)
    before = b.hops()
    b.page.pump(1.5)
    res.check(b.hops() == before, "the tuner stays put", b.hops() - before)
    res.check(b.tuned("radio")[-1] // 1000 == ACTIVE_KHZ, "on the active", b.tuned("radio")[-1])


def check_vor_band(b, res):
    print("\n-- the VOR band")
    b.air([dongle.NAV_KHZ])
    b.page.eval("""(() => {
        const scope = angular.element(document.querySelector('%s')).scope();
        scope.setFrequency(scope.radio, "113.800", "");
        scope.$apply();
    })()""" % BOX)
    b.page.pump(0.5)
    b.press(RADIO_SWAP)
    res.check(b.until(lambda: b.key("sdrradiofreqactive", dongle.NAV_KHZ), RETUNE_S),
              "the receiver replies 113.800", b.bridge().get("sdrradiofreqactive"))
    res.check(b.until(lambda: b.page.eval(DIGITS) == "113.800", RELEASE_S), "the digits follow",
              b.page.eval(DIGITS))
    if not REAL:
        res.check(b.until(lambda: b.key("sdrradiostatus", 4), RETUNE_S), "it hears the carrier",
                  b.bridge().get("sdrradiostatus"))
        before = b.recordings()
        b.page.pump(3.0)
        res.check(not [name for name in b.recordings() if "113800000" in name],
                  "and records none of it", b.recordings())
    b.air([])
    b.press(RADIO_SWAP)
    res.check(b.until(lambda: b.key("sdrradiofreqactive", ACTIVE_KHZ), RETUNE_S), "back on the COM band",
              b.bridge().get("sdrradiofreqactive"))


def check_off(b, res):
    print("\n-- off")
    b.press(RADIO_OFF)
    res.check(b.until(lambda: b.holder() is None, RELEASE_S), "the dongle is released", b.holder())
    res.check(b.key("sdrradiofreqsecondary", 0), "nothing asks it to watch",
              b.bridge().get("sdrradiofreqsecondary"))


def check_clean(b, res):
    print("\n-- what the logs say")
    res.check(not b.page.errors, "the HMI logged no error", b.page.errors[:3])
    with open(b.path("stratuxrun.log"), errors="replace") as fp:
        crashes = [line for line in fp if "panic" in line or "fatal error" in line]
    res.check(not crashes, "stratuxrun logged no panic", crashes[:3])
    with open(b.path("radio.log"), errors="replace") as fp:
        log = fp.read()
    res.check("Traceback" not in log, "rb-sdr-radio logged no traceback")
    res.check(b.procs["radio"].poll() is None, "rb-sdr-radio is still running")


def main():
    signal.signal(signal.SIGTERM, stop)
    if not all(os.path.exists(p) for p in (RB_SDR_RADIO, PYTHON)):
        print("SKIP: no %s or %s" % (RB_SDR_RADIO, PYTHON))
        return 0
    if REAL:
        problem = subprocess.run([PYTHON, os.path.join(HERE, "dongle.py"), "probe", RB_SDR_RADIO],
                                 stdout=subprocess.PIPE, text=True).stdout.strip()
        if problem.startswith("no RTL-SDR"):
            print("cannot run --dongle: %s" % problem)
            return 2
    res = Result()
    with RadioBench() as b:
        b.show("radio", BOX)
        b.press(RADIO_ON)
        res.check(b.until(lambda: b.key("sdrradiofreqactive", ACTIVE_KHZ), RETUNE_S),
                  "pressed ACTIVE: the receiver replies %s" % ACTIVE, b.bridge().get("sdrradiofreqactive"))
        res.check(b.until(lambda: b.page.eval(DIGITS) == ACTIVE, RELEASE_S), "and the digits show it",
                  b.page.eval(DIGITS))
        check_sliders(b, res)
        check_dual_on(b, res)
        if not REAL:
            check_transmissions(b, res)
        check_switch(b, res)
        check_warning(b, res)
        check_restart(b, res)
        check_dual_off(b, res)
        check_vor_band(b, res)
        check_off(b, res)
        check_clean(b, res)
    print("\n%d checks, %d failed" % (len(res.checks), len(res.failed)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
