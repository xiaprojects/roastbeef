"""The radio plate: the standby frequency spinner and the Enabled switch.

The buttons step the standby channel and post it. The frequency is a string: the
kHz are three digits after the point, so 118.030 is 30 kHz and 118.7 is 700. Each
case clicks the real button and reads what the plate posted, which is what reaches
the radio. The fake backend does not store a POST, so the plate falls back to the
fixture after each click and every case sets its own starting point.

The switch in the radio's heading shows Enabled, like DUAL. Every other button posts the
flag as it stands, or a spinner press would turn a radio back on and a press on another
radio would turn it off. The other way to change it is VOL 0, which is the daemon's rule:
the plate posts the level, and shows what comes back.

The sidebar holds a second, closed copy of this plate, hence `[ui-view]` everywhere:
its buttons match the same selectors and sit underneath the page.

The switch is centred in the heading rather than pulled right like DUAL, for two
panels. Above 480 px high the north navigation zone, 35 to 65 % of the width, stays
clickable after it fades and would take a press at the right end of the first radio.
On the round 480x480 panel that corner is off the glass, which no hit test can see,
hence the check against the circle.

The viewport is forced: `Display(window=...)` includes the browser chrome.

An SDR radio also reaches the VOR band, on its 50 kHz grid, and has volume and squelch:
a row of step cells under a real range input, shown by the SQL button in the heading. Each
press is a real mouse event, on the middle of a cell, and the check is what was posted:
nothing else proves that the one cell wide thumb lands on the level it looks like. They
open below the fold on the small panels, hence the scroll before the hit test.

What the receiver says it is on comes back on the float bridge, like vorfreqactive on the
VOR plate. The digits show it, and what a press posts stays the pilot's selection.
"""

import copy
import json
import math
import re
import sys

from plates import Display, Result

# The panels, two radios side by side on the wide ones
PANELS = [(480, 480), (800, 480), (1024, 600), (1280, 800), (1920, 1080)]
ROUND_RADIUS = 240

# standby, button, what is posted
STEPS = [
    ("118.000", 5, "118.005"),
    ("118.030", 5, "118.035"),
    ("118.095", 5, "118.100"),
    ("118.100", 5, "118.105"),
    ("118.005", -5, "118.000"),
    ("118.100", -5, "118.095"),
    # The kHz knob wraps inside the MHz, in both directions
    ("118.995", 5, "118.000"),
    ("118.000", -5, "118.995"),
    # The MHz button leaves the kHz alone
    ("118.030", 1000, "119.030"),
    ("119.030", -1000, "118.030"),
    ("118.000", 1000, "119.000"),
    # Fewer digits are still a fraction, as the daemon's parsers read them
    ("118.7", 5, "118.705"),
    ("118.05", 5, "118.055"),
]

BOX = "[ui-view] #radio_box"
SCOPE = "angular.element(document.querySelector('%s')).scope()" % BOX
STANDBY = SCOPE + ".radio.standby"
REFRESH = SCOPE + ".radioRefresh()"
# The status in the radio's heading, what a pilot reads
LABELS = """[...document.querySelectorAll('%s .panel-heading .label')]
    .filter(e => e.offsetParent !== null && /ACTIVE/.test(e.textContent))
    .map(e => e.textContent.trim())""" % BOX
# Which channel is heard, as shown: RX in the heading for the active, DUAL RX for the standby
HEARD = """(() => {
    const shown = e => e.offsetParent !== null;
    const out = [];
    if ([...document.querySelectorAll('%s .panel-heading span.label')]
            .some(e => shown(e) && e.textContent.trim() == 'RX')) out.push('active');
    if ([...document.querySelectorAll('%s a[ng-click^="dualFreq"]')]
            .some(e => shown(e) && /RX/.test(e.textContent))) out.push('standby');
    return out;
})()""" % (BOX, BOX)
# The DUAL button shown, as its colour and its words: ["label-info DUAL ON"]
DUAL = """[...document.querySelectorAll('%s a[ng-click^="dualFreq"]')]
    .filter(e => e.offsetParent !== null)
    .map(e => (e.className.match(/label-[a-z]+/) || [''])[0] + ' ' + e.textContent.replace(/\\s+/g, ' ').trim())""" % BOX


# The VOR band, on an SDR. The fine step is 50 kHz and it wraps inside the MHz as well
NAV_STEPS = [
    ("108.000", 5, "108.050"),
    ("108.050", -5, "108.000"),
    ("108.000", -5, "108.950"),
    ("108.950", 5, "108.000"),
    ("117.950", 5, "117.000"),
    # Down from the COM band: only the 50 kHz grid exists there
    ("118.030", -1000, "117.000"),
    ("118.075", -1000, "117.050"),
    ("118.950", -1000, "117.950"),
    ("117.950", 1000, "118.950"),
    ("118.000", 5, "118.005"),
    # The ends of the band
    ("108.000", -1000, "108.000"),
    ("136.030", 1000, "136.030"),
]

# A serial radio is COM only: the same buttons stop at 118
SERIAL_STEPS = [
    ("118.030", -1000, "118.030"),
    ("118.000", -5, "118.995"),
    ("136.030", 1000, "136.030"),
    ("119.030", -1000, "118.030"),
]

# The south FAB takes a press through its fade, over the middle of the panel. The last row of
# the plate cannot scroll off it here: nothing is below it, the box floats beside the list
KNOWN_UNDER_FAB = {(1024, 600, "Squelch")}

# Typed on the keypad, whose display starts at 1
KEYPAD_SDR = [
    ([0, 8, 0, 5, 0], "108.050"),
    ([1, 7, 9, 5, 0], "117.950"),
    ([1, 8, 7, 0, 0], "118.700"),
    ([2, 1, 5, 0, 5], "121.505"),
]
LEVEL_CASES = [("Volume", "VolumeLevel", 100, 10), ("Squelch", "SquelchLevel", 10, 1)]

LEVEL_INPUT = BOX + " input[aria-label=%s]"
LEVELS_BUTTON = BOX + """ a[ng-click="toggleLevels(radio)"]"""
# The first and last corners of a slider, after scrolling it to the middle of the panel
LEVEL_BOX = """(() => {
    const e = document.querySelector(%s);
    e.scrollIntoView({behavior: "instant", block: "center", inline: "nearest"});
    const r = e.getBoundingClientRect();
    return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width};
})()"""
AT = """(() => {
    const e = document.elementFromPoint(%f, %f);
    return e ? (e.getAttribute("aria-label") || e.tagName) : null;
})()"""
BRIDGE = """dispatchEvent(new CustomEvent("BridgeUpdated", {detail: %s}))"""


def radios():
    return [{"Name": "COM", "Driver": "SDR", "Enabled": True, "Dual": False, "Path": "",
             "FrequencyActive": "121.500", "FrequencyStandby": "118.000",
             "LabelActive": "", "LabelStandby": "", "SquelchLevel": 0, "VolumeLevel": 0}]


# Every button in a radio's heading, and whether a press in its middle lands on it
SWITCHES = """[...document.querySelectorAll('[ui-view] a[ng-click^="enableRadio"], [ui-view] a[ng-click^="toggleLevels"]')]
    .filter(e => e.offsetParent !== null)
    .map(e => {
        const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        return {text: e.textContent.trim(), left: r.left, top: r.top, right: r.right,
                bottom: r.bottom, onscreen: y < innerHeight,
                reached: document.elementFromPoint(x, y) === e};
    })"""


def posted(d):
    """The body of every POST to /radio/0 so far."""
    out = []
    for path, body in d.srv.posted:
        if re.sub("/+", "/", path.split("?")[0]) == "/radio/0":
            out.append(json.loads(body))
    return out


def click_and_read(d, selector):
    """Click `selector` and return the body it posted, None if it posted nothing."""
    if not d.page.eval("!!document.querySelector(%s)" % json.dumps(selector)):
        return None
    before = len(posted(d))
    d.page.click(selector)
    for _ in range(20):
        d.page.pump(0.1)
        now = posted(d)
        if len(now) > before:
            return now[-1]
    return None


def step(d, standby, button):
    """Start from `standby`, click the button, return what the plate posted."""
    d.srv.rest["/radio"][0]["FrequencyStandby"] = standby
    d.page.eval(REFRESH)
    d.page.wait("%s === %s" % (STANDBY, json.dumps(standby)), timeout=5,
                label="standby %s shown" % standby)
    body = click_and_read(d, """%s a[ng-click="increaseFreq(radio,%d)"]""" % (BOX, button))
    return body and body["FrequencyStandby"]


def press_at(d, x, y):
    for kind in ("mouseMoved", "mousePressed", "mouseReleased"):
        d.page.send("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)


def refresh(d, **fields):
    """Show the radio with these fields, as the daemon would report them."""
    d.srv.rest["/radio"][0].update(fields)
    d.page.eval(REFRESH)
    d.page.pump(0.3)


def bridge(d, **keys):
    """A frame of the float bridge, which carries the whole map."""
    d.page.eval(BRIDGE % json.dumps(keys))
    d.page.pump(0.2)


def levels_on_screen(d):
    return d.page.eval("document.querySelectorAll('%s .radioLevel').length" % BOX)


def press_levels_button(d):
    """A real press. The knob and the sliders may have scrolled the heading away."""
    d.page.eval("document.querySelector(%s).scrollIntoView({behavior: 'instant', block: 'center'})"
                % json.dumps(LEVELS_BUTTON))
    d.page.pump(0.1)
    d.page.click(LEVELS_BUTTON)
    d.page.pump(0.3)


def show_levels(d):
    """Open the sliders with the button, unless they are open."""
    if not levels_on_screen(d):
        press_levels_button(d)


def active_digits(d):
    return d.page.eval("document.querySelector('%s .Radio').textContent.trim()" % BOX)


def check_band(res):
    for driver, steps in (("SDR", NAV_STEPS), ("NMEA", SERIAL_STEPS)):
        d = Display()
        d.srv.rest["/radio"] = radios()
        d.srv.rest["/radio"][0]["Driver"] = driver
        with d:
            d.show("radio", BOX)
            for standby, button, want in steps:
                got = step(d, standby, button)
                res.check(got == want, "%-5s %s %+5d posts %s" % (driver, standby, button, want), repr(got))


def key_buttons(d):
    """The digits that can be pressed now."""
    return d.page.eval("""[...document.querySelectorAll('%s a[ng-click^="digitKeypad"]')]
        .filter(e => e.textContent.trim() !== "" && e.getAttribute("disabled") === null)
        .map(e => e.textContent.trim()).sort()""" % BOX)


def type_keypad(d, digits):
    """Press KEYPAD and `digits`. Returns the digits on offer at each place, and the post."""
    press = "%s a[ng-click=\"toggleKeypad(radio)\"]" % BOX
    d.page.click(press)
    d.page.pump(0.3)
    before = len(posted(d))
    allowed = []
    for digit in digits:
        allowed.append(key_buttons(d))
        d.page.eval("""[...document.querySelectorAll('%s a[ng-click="digitKeypad(radio,%d)"]')]
            .filter(e => e.textContent.trim() !== "")[0].click()""" % (BOX, digit))
        d.page.pump(0.1)
    for _ in range(20):
        d.page.pump(0.1)
        if len(posted(d)) > before:
            break
    d.page.click(press)
    d.page.pump(0.3)
    return allowed, (posted(d)[-1]["FrequencyStandby"] if len(posted(d)) > before else None)


def check_keypad(d, res):
    for digits, want in KEYPAD_SDR:
        _, got = type_keypad(d, digits)
        res.check(got == want, "SDR keypad %s posts %s" % ("".join(map(str, digits)), want), repr(got))
    allowed, _ = type_keypad(d, [0, 8, 0, 5, 0])
    res.check(allowed[0] == ["0", "1", "2", "3"], "an SDR also takes 10x, the VOR band", repr(allowed[0]))
    res.check(allowed[1] == ["8", "9"], "after 10, only 108 and 109", repr(allowed[1]))
    res.check(allowed[3] == ["0", "5"], "the VOR band: tens of kHz on the grid", repr(allowed[3]))
    res.check(allowed[4] == ["0"], "the VOR band: no last digit but 0", repr(allowed[4]))
    allowed, _ = type_keypad(d, [1, 8, 0, 0, 5])
    res.check(allowed[4] == ["0", "5"], "the COM band: the last digit is 0 or 5", repr(allowed[4]))


def check_serial_keypad(res):
    d = Display()
    d.srv.rest["/radio"] = radios()
    d.srv.rest["/radio"][0]["Driver"] = "NMEA"
    with d:
        d.show("radio", BOX)
        allowed, got = type_keypad(d, [1, 8, 7, 0, 5])
        res.check(allowed[0] == ["1", "2", "3"], "serial keypad starts 11, 12 or 13", repr(allowed[0]))
        res.check(allowed[4] == ["0", "5"], "serial keypad ends 0 or 5", repr(allowed[4]))
        res.check(got == "118.705", "serial keypad posts 118.705", repr(got))


def check_levels_button(d, res):
    button = "document.querySelector(%s).className" % json.dumps(LEVELS_BUTTON)
    res.check(levels_on_screen(d) == 0, "the sliders start hidden", levels_on_screen(d))
    res.check("label-default" in d.page.eval(button), "and the button says so", d.page.eval(button))
    press_levels_button(d)
    res.check(levels_on_screen(d) == 2, "the button shows VOL and SQL", levels_on_screen(d))
    res.check("label-info" in d.page.eval(button), "and says so", d.page.eval(button))
    press_levels_button(d)
    res.check(levels_on_screen(d) == 0, "and hides them again", levels_on_screen(d))


def check_sliders(d, res):
    d.page.pump(0.3)
    show_levels(d)
    for name, field, top, stride in LEVEL_CASES:
        box = d.page.eval(LEVEL_BOX % json.dumps(LEVEL_INPUT % name))
        cells = top // stride + 1
        wrong = []
        for cell in range(cells):
            x = box["left"] + box["width"] * (cell + 0.5) / cells
            before = len(posted(d))
            press_at(d, x, (box["top"] + box["bottom"]) / 2)
            body = None
            for _ in range(20):
                d.page.pump(0.05)
                if len(posted(d)) > before:
                    body = posted(d)[-1]
                    break
            want = cell * stride
            # The fixture's stored level is already there: a press on it is no change
            if body != {field: want} and not (body is None and want == 0):
                wrong.append((want, body))
        res.check(not wrong, "%-7s every step posts its level, only that" % name, repr(wrong))

        # A finger is not on the middle of a cell: the whole of a cell is its level. Only a
        # thumb one cell wide does that, as the centres land right with any width
        value = "document.querySelector(%s).value" % json.dumps(LEVEL_INPUT % name)
        wrong = []
        for cell in (1, cells // 2, cells - 2):
            for across in (0.1, 0.9):
                press_at(d, box["left"] + box["width"] * (cell + across) / cells,
                         (box["top"] + box["bottom"]) / 2)
                d.page.pump(0.1)
                got = int(d.page.eval(value))
                if got != cell * stride:
                    wrong.append((cell * stride, across, got))
        res.check(not wrong, "%-7s the whole of a cell is its level" % name, repr(wrong))


def check_slider_shows(d, res):
    d.page.pump(1.9)     # the pilot's last press holds the slider until the reply, and none comes
    refresh(d, VolumeLevel=40, SquelchLevel=8)
    shown = """[...document.querySelectorAll('%s .radioLevelValue')].map(e => e.textContent.trim())""" % BOX
    lit = """[...document.querySelectorAll('%s .radioLevelTrack')]
        .map(t => t.querySelectorAll('.radioLevelOn').length)""" % BOX
    res.check(d.page.eval(shown) == ["40", "8 dB"], "no daemon: the stored levels", repr(d.page.eval(shown)))
    res.check(d.page.eval(lit) == [4, 8], "as many cells lit as steps", repr(d.page.eval(lit)))
    bridge(d, sdrradiovolumeactive=50, sdrradiosquelchactive=10)
    res.check(d.page.eval(shown) == ["50", "10 dB"], "a stored 0 or an old level: the daemon's reply wins",
              repr(d.page.eval(shown)))
    bridge(d, sdrradiovolumeactive=50, sdrradiosquelchactive=0)
    res.check(d.page.eval(shown)[1] == "OPEN", "squelch 0 reads OPEN", repr(d.page.eval(shown)))
    res.check(d.page.eval(lit)[1] == 0, "and lights nothing", repr(d.page.eval(lit)))

    # While the pilot's change is on its way, an older reply must not move the slider
    box = d.page.eval(LEVEL_BOX % json.dumps(LEVEL_INPUT % "Volume"))
    press_at(d, box["left"] + box["width"] * 8.5 / 11, (box["top"] + box["bottom"]) / 2)
    d.page.pump(0.1)
    # Moved by another radio key: a frame the same as the last one is not even looked at
    bridge(d, sdrradiovolumeactive=50, sdrradiosquelchactive=0, sdrradiofreqheard=118700)
    res.check(d.page.eval(shown)[0] == "80", "an old reply does not undo a press", repr(d.page.eval(shown)))
    bridge(d, sdrradiovolumeactive=80, sdrradiosquelchactive=0)
    res.check(d.page.eval(shown)[0] == "80", "the reply confirms it", repr(d.page.eval(shown)))


def check_no_sliders(res):
    d = Display()
    d.srv.rest["/radio"] = radios()
    d.srv.rest["/radio"][0]["Driver"] = "NMEA"
    with d:
        d.show("radio", BOX)
        d.page.pump(0.3)
        count = d.page.eval("document.querySelectorAll(%s).length" % json.dumps(LEVELS_BUTTON))
        res.check(count == 0, "a serial radio has no button for sliders it does not have", count)
        refresh(d, FrequencyActive="119.000", Dual=True)
        bridge(d, sdrradiofreqactive=121500, sdrradiofreqheard=119000, sdrradiosecondaryactive=0)
        res.check(active_digits(d) == "119.000", "a serial radio ignores the SDR's reply", active_digits(d))
        res.check(d.page.eval(HEARD) == [], "and shows no RX", repr(d.page.eval(HEARD)))
        res.check(d.page.eval(DUAL) == ["label-info DUAL ON"], "and keeps its DUAL ON", repr(d.page.eval(DUAL)))


def check_reply(d, res):
    refresh(d, Enabled=True, FrequencyActive="118.700", FrequencyStandby="121.500", Dual=False)
    bridge(d)
    res.check(active_digits(d) == "118.700", "no reply yet: the selection", active_digits(d))
    bridge(d, sdrradiofreqactive=118030)
    res.check(active_digits(d) == "118.030", "the digits follow the reply, 118030 kHz", active_digits(d))
    bridge(d, sdrradiofreqactive=109400)
    res.check(active_digits(d) == "109.400", "and in the VOR band", active_digits(d))
    bridge(d, sdrradiofreqactive=118700)
    res.check(active_digits(d) == "118.700", "and back", active_digits(d))

    # A press sends the selection, whatever the receiver has said so far
    bridge(d, sdrradiofreqactive=124000)
    body = click_and_read(d, """%s a[ng-click="switchFreq(radio)"]""" % BOX)
    res.check(bool(body) and body["FrequencyActive"] == "121.500" and body["FrequencyStandby"] == "118.700",
              "SWITCH FREQ. posts the pilot's channels, not the reply", repr(body))
    refresh(d, FrequencyActive="118.700", FrequencyStandby="121.500")

    bridge(d, sdrradiofreqactive=0)
    res.check(active_digits(d) == "118.700", "reply 0: the selection", active_digits(d))
    set_enabled(d, False)
    bridge(d, sdrradiofreqactive=121500)
    res.check(active_digits(d) == "118.700", "an INACTIVE radio shows its own channel", active_digits(d))
    set_enabled(d, True)
    bridge(d)


def check_quiet(d, res):
    """The sidebar's closed copy is alive on every screen. Another addon's frames must not
    redraw the whole HMI for a radio nobody is reading."""
    refresh(d, Enabled=True)
    bridge(d, sdrradiofreqactive=118700, sdrradiovolumeactive=50, sdrradiosquelchactive=10)
    count = """(() => {
        window.radioDigests = 0;
        const root = angular.element(document.body).injector().get('$rootScope');
        const digest = root.$digest.bind(root);
        root.$digest = () => { window.radioDigests++; digest(); };
    })()"""
    d.page.eval(count)
    frames = 20
    for rpm in range(2000, 2000 + frames):
        d.page.eval(BRIDGE % json.dumps({"rpm": rpm, "sdrradiofreqactive": 118700,
                                         "sdrradiovolumeactive": 50, "sdrradiosquelchactive": 10}))
    d.page.pump(0.1)
    # Not 0: the 5 s poll of the playback list digests as well. The fault costs one per frame
    quiet = d.page.eval("window.radioDigests")
    res.check(quiet < frames, "another addon's frames redraw nothing", "%d digests" % quiet)
    bridge(d, sdrradiofreqactive=118725, sdrradiovolumeactive=50, sdrradiosquelchactive=10)
    res.check(d.page.eval("window.radioDigests") > 0, "a radio key still does")


def check_dual(d, res):
    refresh(d, Enabled=True, Dual=True, FrequencyActive="118.700", FrequencyStandby="121.500")
    on, rx = ["label-info DUAL ON"], ["label-success DUAL RX"]

    bridge(d)
    res.check(d.page.eval(DUAL) == on, "DUAL ON: no daemon", repr(d.page.eval(DUAL)))
    bridge(d, sdrradiofreqactive=118700, sdrradiosecondaryactive=121500, sdrradiofreqheard=0)
    res.check(d.page.eval(DUAL) == on, "DUAL ON: taking turns", repr(d.page.eval(DUAL)))
    res.check(d.page.eval(HEARD) == [], "nothing heard, no RX", repr(d.page.eval(HEARD)))
    bridge(d, sdrradiofreqactive=118700, sdrradiosecondaryactive=121500, sdrradiofreqheard=121500)
    res.check(d.page.eval(DUAL) == rx, "the standby being heard: DUAL RX", repr(d.page.eval(DUAL)))
    res.check(d.page.eval(HEARD) == ["standby"], "and no RX in the heading", repr(d.page.eval(HEARD)))
    # Nothing beside the digits any more
    digits = d.page.eval("document.querySelector('%s .Radio').children.length" % BOX)
    res.check(digits == 0, "the standby digits stand alone", digits)
    bridge(d, sdrradiofreqactive=118700, sdrradiosecondaryactive=121500, sdrradiofreqheard=118700)
    res.check(d.page.eval(HEARD) == ["active"], "RX in the heading for the active being heard",
              repr(d.page.eval(HEARD)))
    res.check(d.page.eval(DUAL) == on, "and DUAL back to ON", repr(d.page.eval(DUAL)))
    fits = d.page.eval("""(() => {
        const mark = [...document.querySelectorAll('%s .panel-heading span.label')]
            .find(e => e.offsetParent !== null && e.textContent.trim() == 'RX');
        const heading = mark.closest('.panel-heading');
        return [mark.getBoundingClientRect().height, heading.getBoundingClientRect().height];
    })()""" % BOX)
    res.check(fits[0] < fits[1], "and it fits the heading", repr(fits))
    # No warning any more: DUAL ON whatever the receiver says about the watching
    bridge(d, sdrradiofreqactive=118700, sdrradiosecondaryactive=0, sdrradiofreqheard=0)
    res.check(d.page.eval(DUAL) == on, "DUAL on and not taking turns: still DUAL ON", repr(d.page.eval(DUAL)))
    # Either DUAL ON or DUAL RX turns it off
    for name, colour, heard in (("DUAL ON", "label-info", 0), ("DUAL RX", "label-success", 121500)):
        bridge(d, sdrradiofreqactive=118700, sdrradiosecondaryactive=121500, sdrradiofreqheard=heard)
        body = click_and_read(d, """%s a[ng-click="dualFreq(radio,false)"].%s""" % (BOX, colour))
        res.check(bool(body) and body["Dual"] is False, "%s posts Dual off" % name,
                  repr(body and body.get("Dual")))
        refresh(d, Dual=True)
    refresh(d, Dual=False)


def check_knob(d, res):
    """Through the knob's own key events, as the hardware sends them."""
    refresh(d, Enabled=True, VolumeLevel=40, SquelchLevel=8, FrequencyStandby="118.000")
    bridge(d)
    show_levels(d)
    key = "dispatchEvent(new KeyboardEvent('keypad', {key: KEYPAD_MAPPING_%s}))"
    where = """(() => {
        const r = %s.radio;
        return [r.classStandByLeft, r.classStandByRight, r.classVolume, r.classSquelch]
            .map(c => /btn-(danger|success)/.test(c));
    })()""" % SCOPE

    def stops():
        return d.page.eval(where).index(True)

    # The closed copy of the plate in the sidebar hears the knob too. If it did not share the
    # sliders it would run off the end of its shorter list and leave the plate
    d.page.eval("""window.radioLeft = 0;
        addEventListener("keypad", e => { if (e.key === "to") window.radioLeft++; })""")
    seen = [stops()]
    for _ in range(3):
        d.page.eval(key % "NEXT")
        d.page.pump(0.1)
        seen.append(stops())
    res.check(seen == [0, 1, 2, 3], "the knob reaches MHz, kHz, volume, squelch", repr(seen))
    res.check(d.page.eval("window.radioLeft") == 0, "and no copy of the plate leaves it",
              d.page.eval("window.radioLeft"))

    before = len(posted(d))
    d.page.eval(key % "TAP")
    d.page.pump(0.1)
    d.page.eval(key % "NEXT")
    d.page.eval(key % "NEXT")
    d.page.pump(0.1)
    d.page.eval(key % "TAP")
    d.page.pump(0.6)
    # The sidebar's closed copy hears the knob too and posts from its own state, which here
    # is the fixture's, as only the routed copy was refreshed. Either may post first
    bodies = posted(d)[before:]
    res.check({"SquelchLevel": 10} in bodies, "turning it steps the squelch, 1 dB a click", repr(bodies))
    res.check(all(list(body) == ["SquelchLevel"] for body in bodies), "and posts only that", repr(bodies))

    for _ in range(3):
        d.page.eval(key % "PREV")
        d.page.pump(0.1)
    res.check(stops() == 0, "and back to MHz", stops())

    # A level nobody can see must not be one the knob can change
    for _ in range(3):
        d.page.eval(key % "NEXT")
        d.page.pump(0.1)
    res.check(stops() == 3, "on the squelch", stops())
    press_levels_button(d)
    res.check(d.page.eval(where).index(True) == 1, "hiding the sliders puts the knob on kHz", d.page.eval(where))
    before = len(posted(d))
    d.page.eval(key % "PREV")
    d.page.pump(0.1)
    res.check(stops() == 0, "and it goes on from there", stops())
    d.page.eval(key % "TAP")
    d.page.pump(0.1)
    d.page.eval(key % "NEXT")
    d.page.pump(0.5)
    d.page.eval(key % "TAP")
    d.page.pump(0.1)
    levels = [body for body in posted(d)[before:] if "VolumeLevel" in body or "SquelchLevel" in body]
    res.check(not levels, "and it posts no level", repr(levels))


def check_knob_scrolls(res):
    """On the round panel the sliders start below the glass."""
    d = Display()
    d.srv.rest["/radio"] = radios()
    with d:
        d.page.send("Emulation.setDeviceMetricsOverride", width=480, height=480,
                    deviceScaleFactor=1, mobile=False)
        d.page.goto(d.srv.url + "/RB-01/index.html")
        d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
        d.show("radio", BOX)
        d.page.pump(0.6)
        low = """document.querySelector('[ui-view] #radio_level_0_3').getBoundingClientRect().bottom"""
        show_levels(d)
        d.page.pump(0.2)
        res.check(d.page.eval(low) <= 480, "480x480 the button brings the sliders into view",
                  "bottom %.0f" % d.page.eval(low))
        d.page.eval("document.querySelector('%s').scrollIntoView({behavior: 'instant', block: 'start'})" % BOX)
        d.page.pump(0.2)
        for _ in range(3):
            d.page.eval("dispatchEvent(new KeyboardEvent('keypad', {key: KEYPAD_MAPPING_NEXT}))")
            d.page.pump(0.2)
        res.check(d.page.eval(low) <= 480, "480x480 and so does the knob", "bottom %.0f" % d.page.eval(low))


def check_levels_reachable(res):
    for width, height in PANELS:
        d = Display()
        d.srv.rest["/radio"] = radios()
        d.srv.rest["/radio"][0].update(Name="KRT2")
        d.srv.rest["/radio"].append(dict(copy.deepcopy(radios()[0]), Name="COM2", Enabled=False))
        with d:
            d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                        deviceScaleFactor=1, mobile=False)
            d.page.goto(d.srv.url + "/RB-01/index.html")
            d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
            d.show("radio", BOX)
            d.page.pump(0.6)
            show_levels(d)
            for name, _, _, _ in LEVEL_CASES:
                box = d.page.eval(LEVEL_BOX % json.dumps(LEVEL_INPUT % name))
                d.page.pump(0.2)
                y = (box["top"] + box["bottom"]) / 2
                # Everywhere along it: the FABs cover the middle of the panel as well as the
                # ends, and a press under one looks like a slider that did not move
                xs = [box["left"] + 3 + (box["width"] - 6) * n / 40 for n in range(41)]
                missed = sorted({hit for hit in (d.page.eval(AT % (x, y)) for x in xs) if hit != name})
                label = "%dx%d %s" % (width, height, name)
                if (width, height, name) in KNOWN_UNDER_FAB and missed:
                    print("  KNOWN %s: the top of the slider is under the south FAB" % label)
                else:
                    res.check(not missed, "%-20s can be pressed all along" % label, repr(missed))
                if width == height:
                    far = max(math.hypot(x - width / 2, v - height / 2)
                              for x in (box["left"], box["right"]) for v in (box["top"], box["bottom"]))
                    res.check(far <= ROUND_RADIUS, "%-20s is on the glass" % label, "%.0f px from the centre" % far)


def set_enabled(d, enabled):
    """Show the radio with this Enabled, as the daemon would report it."""
    d.srv.rest["/radio"][0]["Enabled"] = enabled
    d.page.eval(REFRESH)
    d.page.wait("%s === %s" % (SCOPE + ".radio.enabled", json.dumps(enabled)), timeout=5,
                label="enabled %s shown" % enabled)
    d.page.pump(0.2)


def check_switch(d, res):
    for enabled, shown, press in ((True, "ACTIVE", "false"), (False, "INACTIVE", "true")):
        set_enabled(d, enabled)
        got = d.page.eval(LABELS)
        res.check(got == [shown], "enabled %-5s shows %s, once" % (enabled, shown), repr(got))
        body = click_and_read(d, """%s a[ng-click="enableRadio(radio,%s)"]""" % (BOX, press))
        res.check(bool(body) and body["Enabled"] is (not enabled),
                  "pressing it posts Enabled %s" % (not enabled), repr(body))


def check_reachable(res):
    # The first radio both ways round: INACTIVE is the wider, and KRT2 a real name
    cases = [(w, h, True) for w, h in PANELS] + [(480, 480, False)]
    for width, height, enabled in cases:
        d = Display()
        d.srv.rest["/radio"] = radios()
        d.srv.rest["/radio"][0].update(Name="KRT2", Enabled=enabled)
        d.srv.rest["/radio"].append(dict(copy.deepcopy(radios()[0]), Name="COM2", Enabled=False))
        with d:
            d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                        deviceScaleFactor=1, mobile=False)
            d.page.goto(d.srv.url + "/RB-01/index.html")
            d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
            d.show("radio", BOX)
            d.page.pump(0.6)
            # The fullest heading: the name, RX, SQL and the switch
            bridge(d, sdrradiofreqactive=121500, sdrradiofreqheard=121500)
            for s in d.page.eval(SWITCHES):
                if not s["onscreen"]:
                    continue
                label = "%dx%d %s" % (width, height, s["text"])
                res.check(s["reached"], "%-20s can be pressed" % label)
                if width == height:
                    far = max(math.hypot(x - width / 2, y - height / 2)
                              for x in (s["left"], s["right"]) for y in (s["top"], s["bottom"]))
                    res.check(far <= ROUND_RADIUS, "%-20s is on the glass" % label,
                              "%.0f px from the centre" % far)


def check_other_buttons(d, res):
    for enabled in (True, False):
        for name, button in (("spinner", "increaseFreq(radio,5)"), ("MHz", "increaseFreq(radio,1000)"),
                             ("swap", "switchFreq(radio)"), ("dual", "dualFreq(radio,true)")):
            set_enabled(d, enabled)
            body = click_and_read(d, """%s a[ng-click="%s"]""" % (BOX, button))
            res.check(bool(body) and body["Enabled"] is enabled,
                      "%-7s on %s radio leaves it so" % (name, "an enabled" if enabled else "a disabled"),
                      repr(body and body["Enabled"]))


def main():
    res = Result()
    # Tall enough that no FAB is over a slider: where they are is check_levels_reachable
    d = Display(window="1280,1000")
    d.srv.rest["/radio"] = radios()
    with d:
        d.show("radio", BOX)
        for standby, button, want in STEPS:
            got = step(d, standby, button)
            res.check(got == want, "%-7s %+5d posts %s" % (standby, button, want), repr(got))
        check_switch(d, res)
        check_other_buttons(d, res)
        check_keypad(d, res)
        check_levels_button(d, res)
        check_sliders(d, res)
        check_slider_shows(d, res)
        check_reply(d, res)
        check_quiet(d, res)
        check_dual(d, res)
        check_knob(d, res)
    check_band(res)
    check_serial_keypad(res)
    check_no_sliders(res)
    check_reachable(res)
    check_levels_reachable(res)
    check_knob_scrolls(res)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
