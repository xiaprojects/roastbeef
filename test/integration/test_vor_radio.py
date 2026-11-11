#!/usr/bin/env python3
"""Integration test: one dongle, two receivers, taking turns from the RB-01 screen.

A real Chromium presses the real HTML of the real HMI, served by a stratuxrun built from
this checkout, which commands the real rb-vor and rb-sdr-radio over the float bridge.
Only the USB device is a stand-in, see dongle.py. One program at a time can hold a
dongle and both receivers want it, so they work only if the screen makes them take turns:

    VOR plate     pick a station   rb-vor claims the dongle, the plate shows the fix
                  OFF              rb-vor releases it
    Radio plate   INACTIVE         rb-sdr-radio claims it and receives
                  SWITCH FREQ.     it retunes, and the channel with nobody on it is quiet
                  ACTIVE           rb-sdr-radio releases it

Two rounds, on different VOR stations, then what happens when the pilot does not take
turns, and when rb-vor is killed and restarted. Then an ILS localizer (RB-VOR-IF v2.3,
rb-vor with loc.enabled): the deviation bar is drawn only while locstatus >= 4, on the
side that means fly left; a localizer channel with only noise keeps it parked; and a VOR
clears the localizer display, and back. dongle.py radiates each station on its
own channel with its own radial, so the plate can only show the right station and radial
if the click reached the receiver and the receiver tuned it. Each press is a real mouse
event after a hit test, so a control under a navigation FAB fails rather than being
clicked by script.

    python3 test_vor_radio.py                  # build, then ~1 min
    python3 test_vor_radio.py --dongle         # the same, on the dongle on this machine
    RB_RADIOS_KEEP=/tmp/r python3 test_vor_radio.py   # keep the logs, HOME and dongle.log

Needs a Chromium, Go as for `make`, and ../rb-vor and ../rb-sdr-radio beside this
checkout with a Python that has their dependencies (their .venv by default). Without
them it says SKIP and passes. RB_VOR, RB_SDR_RADIO and RB_RADIOS_PYTHON move them.

--dongle swaps the stand-in for the real device: the claim, the release and the kernel
driver coming back between two processes are real, which no stand-in can show. Nothing
known is on the air, so it proves the receivers took turns and tuned, not that they
heard anything: no radial, no recording. rb-vor also needs a backend the daemons' .venv
does not have, see the README.
"""

import ctypes
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

import dongle
import replay
from test_daemon import Result

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "test", "display"))
from cdp import Chrome  # noqa: E402

RB_VOR = os.environ.get("RB_VOR", os.path.join(os.path.dirname(REPO), "rb-vor"))
RB_SDR_RADIO = os.environ.get("RB_SDR_RADIO", os.path.join(os.path.dirname(REPO), "rb-sdr-radio"))
PYTHON = os.environ.get("RB_RADIOS_PYTHON", os.path.join(RB_SDR_RADIO, ".venv", "bin", "python"))

PANEL = (1024, 600)
# The VOR list, by name as the plate shows it, and each one's frequency on the plate
ROUNDS = [("Perugia", 109400), ("Alghero", 113800)]
COM_ACTIVE, COM_STANDBY = "118.700", "121.500"   # dongle.COM_KHZ is on the air, 121.500 quiet

# What the receivers report with the stand-in's signals. Without them a VOR has no fix to
# find and the squelch opens for whatever is out there: any working state will do.
REAL = "--dongle" in sys.argv
VOR_WORKING = ("FIX", "DEGRADED", "ACQUIRING", "NO SIGNAL") if REAL else ("FIX",)
VOR_CODES = (1, 3, 4, 5) if REAL else (5,)     # vorstatus for the same
COM_HEARING = (3, 4) if REAL else (4,)
COM_QUIET = (3, 4) if REAL else (3,)

RADIAL_TOLERANCE = 3     # degrees. A real bearing, not a looked-up one: it comes from the DSP
# The localizer rounds. The list entries are test fixtures, added to the page's list only
# while this test runs, in place of the shipped entries on the same channels (Peretola
# ILS 05 on 110.30, Albenga LOC 27 on 108.90).
LOC_FIXTURE = {"name": "TEST LOC FIXTURE", "id": "TSTX", "type": "ILS",
               "freq": 110.3, "course": 90}
LOC_QUIET_FIXTURE = {"name": "TEST LOC NOISE", "id": "TSTN", "type": "ILS",
                     "freq": 108.9, "course": 90}
LOC_DEV_TOLERANCE = 4    # % of full scale, against round(100 * DDM / 0.155)
QUIET_S = 12             # how long the noise-only channel is watched for a bar
FIX_S = 30               # to FIX from a press: debounce, settle, 2 s windows, the smoother
RETUNE_S = 8             # rb-sdr-radio's 300 ms debounce and a few blocks of squelch
RELEASE_S = 4
TRANSMISSION_S = 1.2
COME_BACK_S = 40         # a restart, which builds the stand-in's signals, then FIX_S
RETRY_S = 7              # sdr.retry_s is 5 in both daemons, plus one block

# tools/vor_calibrate.py's constant for the generator with the discriminator estimator, as
# in rbvor/selftest.py. The config's own 2.12 includes the aircraft's installation.
SYNTHETIC_PHASE_OFFSET = -1.9663

# Nothing that opens a dongle, or the daemon would take the real one on this machine.
SETTINGS = {
    "UAT_Enabled": False, "ES_Enabled": False, "OGN_Enabled": False, "AIS_Enabled": False,
    "Ping_Enabled": False, "Pong_Enabled": False, "GPS_Enabled": False,
    "IMU_Sensor_Enabled": False, "BMP_Sensor_Enabled": False, "MS4525DO_Enabled": False,
    "ReplayLog": False, "TraceLog": False, "DEBUG": False,
    "Radio_Enabled": True,
    "Radio": [{"Name": "COM", "Driver": "SDR", "Enabled": False, "FrequencyActive": COM_ACTIVE,
               "FrequencyStandby": COM_STANDBY}],
}

VOR_ROOT = "[ui-view] .addonVorSquare"
VOR_STATUS = "[ui-view] .addonVorLabelTopRight"    # also the button that opens the list
# The word in the list, which is where a finger goes: the middle of its row may be clear
# when the word is not
VOR_ROW = """[...document.querySelectorAll('[ui-view] tr[ng-click] td')]
    .find(e => e.textContent.trim() === %s)"""
# The name cell of the row with that name and frequency: names repeat in the shipped list
# (Alghero is a TACAN on 109.30 and a VORTAC on 113.80)
VOR_STATION_ROW = """[...document.querySelectorAll('[ui-view] tr[ng-click]')]
    .map(r => r.querySelectorAll('td'))
    .filter(t => t.length > 1 && t[0].textContent.trim() === %s
                 && Math.round(parseFloat(t[1].textContent) * 1000) === %d)
    .map(t => t[0])[0]"""
# What the status corner says, line by line: FIX, the station, the frequency
VOR_SHOWS = """document.querySelector('%s').innerText.split('\\n')
    .map(s => s.trim()).filter(s => s)""" % VOR_STATUS
VOR_ITEMS = "angular.element(document.querySelector('%s')).scope().items" % VOR_ROOT
VOR_SCOPE = "angular.element(document.querySelector('%s')).scope()" % VOR_ROOT
# The HSI's deviation bar: drawn or parked, and where, in the course pointer's frame
# (viewbox units, -12.5 per +1 of `vertical`) and on the screen against the rose's centre
VOR_BAR = """(() => {
    const s = %s;
    if (!s || !s.vorHSI) return null;
    const bar = s.vorHSI.verticalLineDirection;
    const svg = document.querySelector('#vorHSI svg').getBoundingClientRect();
    const r = bar.node.getBoundingClientRect(), k = svg.width / 280;
    return {drawn: bar.visible() && r.width > 0, frame: bar.cx(),
            dx: (r.left + r.width / 2 - svg.left - svg.width / 2) / k,
            dy: (r.top + r.height / 2 - svg.top - svg.height / 2) / k,
            track: s.items.GPSTrueCourse};
})()""" % VOR_SCOPE

BOX = "[ui-view] #radio_box"
RADIO_ON = 'document.querySelector(\'%s a[ng-click="enableRadio(radio,true)"]\')' % BOX
RADIO_OFF = 'document.querySelector(\'%s a[ng-click="enableRadio(radio,false)"]\')' % BOX
RADIO_SWAP = 'document.querySelector(\'%s a[ng-click="switchFreq(radio)"]\')' % BOX
# The word in the radio's heading and the frequency under it, what a pilot reads
RADIO_SHOWS = """[...document.querySelectorAll('%s .panel-heading .label')]
    .filter(e => e.offsetParent !== null && /ACTIVE/.test(e.textContent))
    .map(e => e.textContent.trim())
    .concat(document.querySelector('%s .Radio').textContent.trim())""" % (BOX, BOX)

# Scroll a control into view as a finger would, then say what a press in its middle hits
AIM = """(() => {
    const el = %s;
    if (!el) return null;
    el.scrollIntoView({block: 'center', inline: 'nearest'});
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {x, y, reached: !!hit && (el === hit || el.contains(hit)),
            hit: hit ? hit.tagName + '.' + hit.className : 'nothing'};
})()"""


def die_with_parent():
    """Runs in each child. Whatever ends the test, even SIGKILL, the kernel stops the child:
    a receiver left behind goes on retrying, and takes a real dongle when one is plugged in."""
    PR_SET_PDEATHSIG = 1
    ctypes.CDLL(None).prctl(PR_SET_PDEATHSIG, signal.SIGTERM)


def stop(*_):
    """`timeout` signals the child and then its process group: the second one must not cut
    Bench.__exit__ short."""
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    sys.exit(143)


class Bench:
    """stratuxrun, both receivers and a browser, in a scratch directory."""

    def __enter__(self):
        self.work = tempfile.mkdtemp(prefix="rb-radios-")
        self.procs = {}
        self.page = None
        try:
            self.start_stratuxrun()
            self.start_receivers()
            self.start_browser()
        except BaseException:
            self.__exit__()
            raise
        return self

    def __exit__(self, *exc):
        if self.page:
            self.page.close()
        for proc in reversed(list(self.procs.values())):   # the receivers go first
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        keep = os.environ.get("RB_RADIOS_KEEP")
        if keep:
            shutil.copytree(self.work, keep, dirs_exist_ok=True, symlinks=True)
        shutil.rmtree(self.work, ignore_errors=True)

    def path(self, *names):
        return os.path.join(self.work, *names)

    def spawn(self, name, argv, **env):
        log = open(self.path(name + ".log"), "ab")
        self.procs[name] = subprocess.Popen(argv, cwd=self.work, stdout=log, stderr=subprocess.STDOUT,
                                            env=dict(os.environ, **env), start_new_session=True,
                                            preexec_fn=die_with_parent)

    def start_stratuxrun(self):
        self.binary = replay.build(self.work)
        # A non-root daemon serves <its directory>/web. The checkout's files, except
        # settings/, which it writes to and which is not the test's to change.
        web = self.path("web")
        os.mkdir(web)
        for name in os.listdir(os.path.join(REPO, "web")):
            source = os.path.join(REPO, "web", name)
            if name == "settings":
                shutil.copytree(source, os.path.join(web, name))
            else:
                os.symlink(source, os.path.join(web, name))
        home = self.path("home")
        os.mkdir(home)
        with open(os.path.join(home, ".stratux.conf"), "w") as fp:
            json.dump(SETTINGS, fp)
        self.port = replay.free_port()
        self.url = "http://127.0.0.1:%d" % self.port
        self.run_stratuxrun()

    def run_stratuxrun(self):
        self.spawn("stratuxrun", [self.binary, "-port", str(self.port)], HOME=self.path("home"),
                   LD_LIBRARY_PATH=REPO)
        self.wait_for(lambda: self.get("/getStatus"), 15, "stratuxrun to serve")

    def start_receivers(self):
        bridge = {"ws_url": "ws://127.0.0.1:%d/bridge/float/ws" % self.port,
                  "rest_url": self.url + "/bridge/float"}
        player = self.path("player")
        with open(player, "w") as fp:
            fp.write('#!/bin/sh\nexec cat >> "%s"\n' % self.path("heard.raw"))
        os.chmod(player, 0o755)
        self.playback = self.path("playback")

        def config(repo, name, **sections):
            with open(os.path.join(repo, "config", name)) as fp:
                cfg = json.load(fp)
            cfg["bridge"].update(bridge)
            for section, values in sections.items():
                cfg[section].update(values)
            with open(self.path(name), "w") as fp:
                json.dump(cfg, fp)
            return self.path(name)

        cfg = config(RB_VOR, "rb-vor.json", bearing={"phase_offset_deg": SYNTHETIC_PHASE_OFFSET},
                     log={"solution_csv": self.path("solutions.csv")},
                     loc={"enabled": True, "solution_csv": self.path("loc.csv")})
        self.vor_config = cfg
        self.start_vor()
        cfg = config(RB_SDR_RADIO, "rb-sdr-radio.json", audio={"player": player},
                     record={"dir": self.playback})
        self.receiver("radio", RB_SDR_RADIO, "--config", cfg)
        self.wait_for(lambda: {"vorstatus", "sdrradiostatus"} <= set(self.bridge()), 30,
                      "both receivers to report on the bridge")

    def receiver(self, name, repo, *args):
        self.spawn(name, [PYTHON, "-u", os.path.join(HERE, "dongle.py"), name, repo, self.work]
                   + (["--real"] if REAL else []) + list(args))

    def start_vor(self):
        self.receiver("vor", RB_VOR, "--quiet", "--config", self.vor_config)

    def start_browser(self):
        self.page = Chrome.launch()
        # The window size includes the browser's chrome: this is the real viewport
        self.page.send("Emulation.setDeviceMetricsOverride", width=PANEL[0], height=PANEL[1],
                       deviceScaleFactor=1, mobile=False)
        self.page.goto(self.url + "/RB-01/index.html")
        self.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
        # main.js registers an addon's route when /addons has answered and its script loaded
        self.page.wait("""(() => { const i = angular.element(document.body).injector();
                                   return !!i && !!i.get('$state').get('vor'); })()""",
                       timeout=15, label="the vor addon")

    # -- the daemon ------------------------------------------------------------------

    def get(self, path):
        try:
            with urllib.request.urlopen(self.url + path, timeout=3) as response:
                return response.read()
        except OSError:
            return None

    def bridge(self):
        return json.loads(self.get("/bridge/float") or b"{}")

    def post(self, values):
        request = urllib.request.Request(self.url + "/bridge/float", json.dumps(values).encode())
        urllib.request.urlopen(request, timeout=3).close()

    def wait_for(self, test, timeout, what):
        deadline = time.monotonic() + timeout
        while not test():
            for name, proc in self.procs.items():
                if proc.poll() is not None:
                    with open(self.path(name + ".log"), "rb") as fp:
                        tail = fp.read()[-1500:].decode("utf-8", "replace")
                    raise RuntimeError("%s exited %s\n%s" % (name, proc.returncode, tail))
            if time.monotonic() > deadline:
                raise RuntimeError("no sign of %s in %d s" % (what, timeout))
            time.sleep(0.1)

    # -- the dongle ------------------------------------------------------------------

    def dongle_log(self):
        """Everything that happened to the dongle, oldest first."""
        try:
            with open(self.path("dongle.log")) as fp:
                return [json.loads(line) for line in fp]
        except OSError:
            return []

    def events(self, event, who):
        return [e for e in self.dongle_log() if e["event"] == event and e["who"] == who]

    def tuned(self, who):
        """Every channel `who` has asked the dongle for, oldest first."""
        return [e["hz"] - dongle.OFFSET for e in self.events("tune", who)]

    def holder(self):
        held = None
        for entry in self.dongle_log():
            if entry["event"] == "open":
                held = entry["who"]
            elif entry["event"] == "close":
                held = None
        return held

    # -- the screen ------------------------------------------------------------------

    def until(self, test, timeout):
        """Poll `test`, serving the browser meanwhile; its last value."""
        deadline = time.monotonic() + timeout
        while True:
            value = test()
            if value or time.monotonic() > deadline:
                return value
            self.page.pump(0.1)

    def kill_vor(self):
        """A crash: no release and no last word. What it last published stays on the bridge,
        so that is cleared, and whatever the plate shows next came from the new process."""
        proc = self.procs["vor"]
        proc.kill()
        proc.wait()
        self.post({"vorstatus": 0, "vorfreqactive": 0})

    def show(self, plate, root):
        self.page.eval("window.location.hash = '#/%s'" % plate)
        self.page.wait("!!document.querySelector(%s)" % json.dumps(root), timeout=15, label=plate)
        self.page.pump(0.4)

    def press(self, element):
        """A real press on what `element` (JS) finds, or an exception if it cannot be reached."""
        aim = self.page.eval(AIM % element)
        if not aim:
            raise RuntimeError("nothing to press: %s" % element)
        if not aim["reached"]:
            raise RuntimeError("%s is under %s" % (element, aim["hit"]))
        for kind in ("mousePressed", "mouseReleased"):
            self.page.send("Input.dispatchMouseEvent", type=kind, x=aim["x"], y=aim["y"],
                           button="left", clickCount=1)
        self.page.pump(0.2)

    def pick(self, row, khz=None):
        """Open the VOR list and press the row that says `row`, on `khz` when given."""
        self.show("addons/vor", VOR_ROOT)
        self.press("document.querySelector('%s')" % VOR_STATUS)
        cell = (VOR_ROW % json.dumps(row) if khz is None
                else VOR_STATION_ROW % (json.dumps(row), khz))
        self.page.wait("!!(%s)" % cell, timeout=5, label="VOR list")
        self.press(cell)

    def pick_fixture(self, entry):
        """Put a test-only entry in the plate's list, then pick it as a pilot would."""
        self.show("addons/vor", VOR_ROOT)
        # Real stations on the fixture's channel leave for the test: the plate names the
        # channel and takes its front course from the first entry on it
        self.page.eval("""(() => { const s = %s, e = %s;
            s.vorList = s.vorList.filter(x => x.name === e.name || x.freq != e.freq);
            if (!s.vorList.some(x => x.name === e.name)) s.vorList.push(e);
            s.$apply(); })()""" % (VOR_SCOPE, json.dumps(entry)))
        self.press("document.querySelector('%s')" % VOR_STATUS)
        self.page.wait("!!(%s)" % (VOR_ROW % json.dumps(entry["name"])), timeout=5, label="VOR list")
        self.press(VOR_ROW % json.dumps(entry["name"]))

    def bar(self):
        return self.page.eval(VOR_BAR)

    def vor_shows(self):
        return self.page.eval(VOR_SHOWS)

    def vor_working(self):
        return self.vor_shows()[:1] and self.vor_shows()[0] in VOR_WORKING

    def radio_shows(self):
        return self.page.eval(RADIO_SHOWS)


def vor_turn(b, res, station, khz):
    print("\n-- VOR: %s" % station)
    held_by = b.holder()
    res.check(held_by is None, "the dongle is free", held_by)
    pressed = time.monotonic()
    b.pick(station, khz)
    shown = b.until(lambda: b.vor_working() and b.vor_shows()[1:] == [station, str(khz)], FIX_S)
    res.check(shown, "the plate shows %s %d, %s" % (station, khz, "/".join(VOR_WORKING)),
              "%s, %.1f s" % (b.vor_shows()[0], time.monotonic() - pressed) if shown else b.vor_shows())
    if not REAL:
        radial = b.page.eval(VOR_ITEMS + ".vorradial")
        drawn = dongle.VOR_KHZ[khz]
        res.check(abs((radial - drawn + 180) % 360 - 180) <= RADIAL_TOLERANCE,
                  "the needle gets radial %d, the one %s radiates" % (drawn, station), radial)
    res.check(b.holder() == "vor", "rb-vor holds the dongle", b.holder())

    b.pick("OFF")
    res.check(b.until(lambda: b.vor_shows()[:1] == ["OFF"], RELEASE_S), "OFF: the plate shows OFF",
              b.vor_shows())
    res.check(b.until(lambda: b.holder() is None, RELEASE_S), "OFF: rb-vor has released the dongle",
              b.holder())


def com_turn(b, res):
    print("\n-- COM: %s" % COM_ACTIVE)
    held_by = b.holder()
    res.check(held_by is None, "the dongle is free", held_by)
    b.show("radio", BOX)
    res.check(b.radio_shows() == ["INACTIVE", COM_ACTIVE], "the plate shows INACTIVE, nothing tuned",
              b.radio_shows())

    def on(channel, statuses):
        def test():
            state = b.bridge()
            return state.get("sdrradiofreqactive") == channel and state.get("sdrradiostatus") in statuses
        return test

    pressed = time.monotonic()
    b.press(RADIO_ON)
    res.check(b.until(lambda: b.radio_shows() == ["ACTIVE", COM_ACTIVE], RELEASE_S),
              "pressed: the plate shows ACTIVE %s" % COM_ACTIVE, b.radio_shows())
    heard = b.until(on(dongle.COM_KHZ, COM_HEARING), RETUNE_S)
    state = b.bridge()
    res.check(heard, "rb-sdr-radio is on %s" % COM_ACTIVE,
              "status %s, %.1f s, %d dB" % (state.get("sdrradiostatus"), time.monotonic() - pressed,
                                            state.get("sdrradiosnr", 0)) if heard else state)
    if not REAL:
        res.check(state.get("sdrradiosnr", 0) > 20, "it hears the signal, not the squelch held open",
                  state.get("sdrradiosnr"))
    res.check(b.holder() == "radio", "rb-sdr-radio holds the dongle", b.holder())
    # Stay for a transmission: a retune ends the file, and one under record.min_segment_s
    # is dropped
    b.page.pump(TRANSMISSION_S)

    b.press(RADIO_SWAP)
    res.check(b.until(lambda: b.radio_shows() == ["ACTIVE", COM_STANDBY], RELEASE_S),
              "SWITCH FREQ.: the plate shows %s" % COM_STANDBY, b.radio_shows())
    res.check(b.until(on(121500, COM_QUIET), RETUNE_S),
              "it retunes" + ("" if REAL else " and the empty channel stays shut"),
              b.bridge().get("sdrradiofreqactive"))
    b.press(RADIO_SWAP)
    res.check(b.until(on(dongle.COM_KHZ, COM_HEARING), RETUNE_S), "SWITCH FREQ. back on %s" % COM_ACTIVE,
              b.bridge().get("sdrradiofreqactive"))

    b.press(RADIO_OFF)
    res.check(b.until(lambda: b.radio_shows() == ["INACTIVE", COM_ACTIVE], RELEASE_S),
              "pressed: the plate shows INACTIVE", b.radio_shows())
    res.check(b.until(lambda: b.bridge().get("sdrradiostatus") == 0, RELEASE_S),
              "rb-sdr-radio reports off", b.bridge().get("sdrradiostatus"))
    res.check(b.until(lambda: b.holder() is None, RELEASE_S),
              "rb-sdr-radio has released the dongle", b.holder())


def check_turns(b, res):
    print("\n-- the dongle's own log")
    log = b.dongle_log()
    opened = [e["who"] for e in log if e["event"] == "open"]
    res.check(opened == ["vor", "radio"] * len(ROUNDS), "the receivers took it in turns", opened)
    refused = [e["who"] for e in log if e["event"] == "busy"]
    res.check(not refused, "each released it before the other asked", refused)
    tuned = b.tuned("vor")
    res.check(tuned == [khz * 1000 for _, khz in ROUNDS], "rb-vor tuned what was pressed", tuned)
    if not REAL:
        recordings = [f for f in os.listdir(b.playback) if f.endswith("_%d000.wav" % dongle.COM_KHZ)]
        res.check(len(recordings) == len(ROUNDS), "each transmission was recorded under its channel",
                  recordings)
        heard = b.path("heard.raw")
        res.check(os.path.exists(heard) and os.path.getsize(heard) > 0, "and played")


def check_no_turns(b, res):
    """A pilot does not have to know there is one dongle."""
    print("\n-- the radio pressed while the VOR holds the dongle")
    station, khz = ROUNDS[0]
    b.pick(station, khz)
    res.check(b.until(b.vor_working, FIX_S), "the plate shows %s" % station, b.vor_shows())
    b.show("radio", BOX)
    b.press(RADIO_ON)

    def busy():
        state = b.bridge()
        return state.get("sdrradiostatus") == 1 and state.get("sdrradiofault", 0) & 2
    res.check(b.until(busy, RETUNE_S), "rb-sdr-radio reports the SDR unavailable",
              {k: v for k, v in b.bridge().items() if k in ("sdrradiostatus", "sdrradiofault")})
    if b.radio_shows()[0] == "ACTIVE":
        print("  KNOWN the plate says ACTIVE and rb-sdr-radio reports the SDR unavailable, see "
              "docs/tech-debt/radio-active-status.md")
    res.check(b.bridge().get("vorstatus") in VOR_CODES and b.holder() == "vor", "rb-vor is not disturbed",
              (b.bridge().get("vorstatus"), b.holder()))

    def receiving():
        return b.bridge().get("sdrradiostatus") in COM_HEARING and b.holder() == "radio"
    b.pick("OFF")
    res.check(b.until(receiving, RETRY_S), "OFF on the VOR: the radio takes the dongle by itself",
              b.bridge().get("sdrradiostatus"))

    print("\n-- a VOR picked while the radio holds the dongle")
    refused = len(b.events("busy", "vor"))
    vor = b.procs["vor"]
    b.pick(station, khz)
    res.check(b.until(lambda: b.vor_shows() == ["NO SIGNAL", station, str(khz)], RETUNE_S),
              "the plate shows NO SIGNAL %s %d" % (station, khz), b.vor_shows())
    res.check(b.until(lambda: len(b.events("busy", "vor")) >= refused + 2, RETRY_S),
              "rb-vor is refused and tries again", len(b.events("busy", "vor")) - refused)
    res.check(vor.poll() is None, "it is still running", vor.returncode)
    res.check(receiving(), "the radio is not disturbed", (b.bridge().get("sdrradiostatus"), b.holder()))

    b.show("radio", BOX)
    b.press(RADIO_OFF)
    b.show("addons/vor", VOR_ROOT)
    res.check(b.until(lambda: b.vor_working() and b.holder() == "vor", RETRY_S + FIX_S),
              "radio INACTIVE: rb-vor takes the dongle by itself", b.vor_shows())


def check_restart(b, res):
    """systemd restarts rb-vor with the pilot's choice on the bridge, and nobody presses anything."""
    def comes_back(name, khz, what):
        claims = len(b.events("open", "vor"))
        b.start_vor()

        def test():
            return (len(b.events("open", "vor")) > claims and b.vor_working()
                    and b.vor_shows()[1:] == [name, str(khz)])
        res.check(b.until(test, COME_BACK_S), what, b.vor_shows())
        res.check(b.tuned("vor")[-1] == khz * 1000, "rb-vor tuned %d" % khz, b.tuned("vor")[-1:])

    print("\n-- rb-vor killed with a station selected")
    station, khz = ROUNDS[0]
    b.kill_vor()
    comes_back(station, khz, "it comes back on %s with no press" % station)

    print("\n-- a station picked while rb-vor is down")
    station, khz = ROUNDS[1]
    b.kill_vor()
    b.pick(station, khz)
    comes_back(station, khz, "it comes up on %s" % station)

    b.pick("OFF")
    res.check(b.until(lambda: b.holder() is None, RELEASE_S), "OFF: the restarted rb-vor releases the dongle",
              b.holder())


def loc_watch(b, until, timeout):
    """Serve the browser until `until()` or the timeout, and collect every moment the bar
    was drawn while the plate's status word was not a usable one (LOC, LOC DEGRADED)."""
    bad = []
    deadline = time.monotonic() + timeout
    while True:
        shows, bar = b.vor_shows(), b.bar()
        if bar and bar["drawn"] and shows[:1] not in (["LOC"], ["LOC DEGRADED"]):
            bad.append((shows[:1], bar))
        if until() or time.monotonic() > deadline:
            return until(), bad
        b.page.pump(0.1)


def loc_round(b, res):
    if REAL:
        return        # nothing known is on the air: no localizer to find
    khz = int(round(LOC_FIXTURE["freq"] * 1000))
    print("\n-- ILS localizer: %s %d" % (LOC_FIXTURE["name"], khz))
    ddm = dongle.LOC_KHZ[khz]
    expect_dev = round(100 * ddm / 0.155)
    res.check(b.holder() is None, "the dongle is free", b.holder())
    pressed = time.monotonic()
    b.pick_fixture(LOC_FIXTURE)
    shown, bad = loc_watch(b, lambda: b.vor_shows() == ["LOC", LOC_FIXTURE["name"], str(khz)],
                           FIX_S)
    res.check(shown, "the plate shows LOC %s %d" % (LOC_FIXTURE["name"], khz),
              "%.1f s" % (time.monotonic() - pressed) if shown else b.vor_shows())
    res.check(not bad, "no bar while tuning and acquiring", bad[:2])
    res.check(b.tuned("vor")[-1:] == [khz * 1000], "rb-vor tuned %d" % khz, b.tuned("vor")[-1:])
    items = b.page.eval(VOR_ITEMS)
    res.check(abs(items["locdev"] - expect_dev) <= LOC_DEV_TOLERANCE,
              "locdev %d, the DDM %+.4f the station radiates" % (expect_dev, ddm), items["locdev"])
    res.check(items["vorfreqactive"] == 0 and items["vorstatus"] == 0,
              "every vor* field is 0 on a localizer", (items["vorfreqactive"], items["vorstatus"]))
    bar = b.bar()
    # + = fly left. In the pointer's frame the bar is left of the pointer by locdev * 6/100
    # half-dots of 12.5 units; on the screen, with the fixture's 090 course and the
    # stand-in's track, the pointer's left is the screen's north when the track is 000
    want = -items["locdev"] * 6 / 100 * 12.5
    res.check(bar and bar["drawn"] and bar["frame"] < 0 and abs(bar["frame"] - want) <= 0.5,
              "the bar is drawn LEFT of the course pointer (fly left), %.1f units" % want, bar)
    if bar and bar["track"] == 0:
        res.check(bar["dy"] < -30 and abs(bar["dx"]) <= 2,
                  "course 090, track 000: the bar is north of centre, where the course is", bar)
    notice = b.page.eval("(() => { const e = document.querySelector('[ui-view] .addonVorLocNotice');"
                         " return e ? e.innerText : ''; })()")
    res.check("NOT APPROACH GUIDANCE" in notice, "the plate says not approach guidance", notice)

    print("\n-- ILS localizer with only noise: %s" % LOC_QUIET_FIXTURE["name"])
    quiet = int(round(LOC_QUIET_FIXTURE["freq"] * 1000))
    b.pick_fixture(LOC_QUIET_FIXTURE)
    reached, bad = loc_watch(b, lambda: b.vor_shows()[:1] == ["LOC NO SIGNAL"]
                             and b.vor_shows()[2:] == [str(quiet)], FIX_S)
    res.check(reached, "the plate shows LOC NO SIGNAL %d" % quiet, b.vor_shows())
    _, more = loc_watch(b, lambda: False, QUIET_S)
    res.check(not bad and not more, "no bar on noise, over %d s" % QUIET_S, (bad + more)[:2])
    statuses = b.page.eval(VOR_ITEMS + ".locstatus")
    res.check(statuses < 4, "locstatus is not usable on noise", statuses)

    print("\n-- from the localizer to a VOR, and back")
    station, vkhz = ROUNDS[0]
    b.pick(station, vkhz)
    shown, bad = loc_watch(b, lambda: b.vor_working() and b.vor_shows()[1:] == [station, str(vkhz)],
                           FIX_S)
    res.check(shown, "a VOR: the plate shows %s %d" % (station, vkhz), b.vor_shows())
    left = b.page.eval("document.querySelector('[ui-view] .addonVorLabelTopLeft').innerText")
    notice = b.page.eval("!!document.querySelector('[ui-view] .addonVorLocNotice')")
    res.check(not bad and not b.bar()["drawn"] and not notice and "SUB:" in left,
              "the localizer display is cleared: no bar, no LOC notice, the VOR corner back",
              (bad[:1], b.bar(), notice, left))
    b.pick_fixture(LOC_FIXTURE)
    shown, bad = loc_watch(b, lambda: b.vor_shows()[:1] == ["LOC"], FIX_S)
    res.check(shown and not bad and b.bar()["drawn"],
              "and back to the localizer: LOC, the bar drawn again", (b.vor_shows(), bad[:1]))
    res.check(not b.page.eval("!!document.querySelector('[ui-view] .addonVorLabelTopLeft') && "
                              "/SUB:/.test(document.querySelector('[ui-view] .addonVorLabelTopLeft')"
                              ".innerText)"),
              "the VOR corner is gone again")

    b.pick("OFF")
    off, bad = loc_watch(b, lambda: b.vor_shows()[:1] == ["OFF"], RELEASE_S)
    res.check(off and not bad and not b.bar()["drawn"], "OFF: the plate shows OFF, no bar",
              (b.vor_shows(), b.bar()))
    res.check(b.until(lambda: b.holder() is None, RELEASE_S), "OFF: rb-vor has released the dongle",
              b.holder())


def check_clean(b, res):
    print("\n-- what the logs say")
    res.check(not b.page.errors, "the HMI logged no error", b.page.errors[:3])
    with open(b.path("stratuxrun.log"), errors="replace") as fp:
        crashes = [line for line in fp if "panic" in line or "fatal error" in line]
    res.check(not crashes, "stratuxrun logged no panic", crashes[:3])
    res.check(b.procs["stratuxrun"].poll() is None, "stratuxrun is still running")
    res.check(b.procs["radio"].poll() is None, "rb-sdr-radio is still running")
    res.check(b.procs["vor"].poll() is None, "rb-vor is still running")


def main():
    signal.signal(signal.SIGTERM, stop)
    missing = [p for p in (RB_VOR, RB_SDR_RADIO, PYTHON) if not os.path.exists(p)]
    if missing:
        print("SKIP: not here: %s" % ", ".join(missing))
        return 0
    if REAL:
        problem = subprocess.run([PYTHON, os.path.join(HERE, "dongle.py"), "probe", RB_SDR_RADIO],
                                 stdout=subprocess.PIPE, text=True).stdout.strip()
        if problem:
            print("cannot run --dongle: %s" % problem)
            return 2
    res = Result()
    with Bench() as b:
        for station, khz in ROUNDS:
            vor_turn(b, res, station, khz)
            com_turn(b, res)
        check_turns(b, res)
        check_no_turns(b, res)
        check_restart(b, res)
        loc_round(b, res)
        check_clean(b, res)
    print("\n%d checks, %d failed" % (len(res.checks), len(res.failed)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
