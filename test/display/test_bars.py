"""The top and bottom bars: status values on top, six soft keys along the bottom.

docs/tech-debt/top-bottom-bars.md, phase 1, checks T1 to T12. Each bar is hidden by
default, shown by the north or south FAB and hidden by its own key at the right end,
and neither is ever drawn at 480x480 (nor at 800x480): `barsAllowed` in js/main.js.
A shown bar reserves its height, so the plate area shrinks by it.

The top bar reads the situation, the radar, the alerts list, the radios, the EMS, the
status and the autopilot; a value with no data,
or whose source has stopped for 3 s (5 s for EMS, status, autopilot), reads `---`. The bottom bar draws the soft key
table of main.js; every press, by touch or by a `softkey` event, goes through the
`softkey` listener on the main scope, so a key works with the bar hidden.

The viewport is forced: `Display(window=...)` includes the browser chrome. The bars
are outside the routed view and the side panels, so their selectors cannot match a
sidebar copy of a plate.
"""

import sys
import time

from plates import Display, Result

KT_TO_KMH = 1.852
ROOT = ["SIXPACK", "3D", "MAP", "ENGINE", "SWITCH", "MENU"]
MENU = ["LEFT PNL", "RIGHT PNL", "TOP BAR", "FULL SCR", "ALERTS", "BACK"]
PAGES = {1: "#/sixpack", 2: "#/synthview", 3: "#/map", 4: "#/ems", 5: "#/switchboard"}
MENU_SECONDS = 10
# Event types of web/settings/alertsMapping.json and the severity the balloon gives them
TIMER, EMS_YELLOW, EMS_RED = 2, 14, 15
LAMP = {"": "rgb(44, 44, 44)", "info": "rgb(255, 255, 255)",
        "warning": "rgb(255, 196, 0)", "danger": "rgb(196, 0, 0)"}
SLOTS = ["speed", "alt", "qnh", "agl", "track", "ap", "gmax", "com", "stby", "utc",
         "oil", "traffic", "alerts", "hide"]
# TOP_BAR_DROP_ORDER of plates/js/bottom.js; the slots not in it are never dropped
DROP_ORDER = ["utc", "gmax", "qnh", "track", "stby", "traffic", "agl", "oil", "ap"]
NEVER_DROPPED = [s for s in SLOTS if s not in DROP_ORDER]

# Counts the window listeners and the intervals alive, before any page script runs
INSTRUMENT = """(() => {
    const live = {}, intervals = new Set();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, options) {
        if (this === window || this === undefined) {
            (live[type] = live[type] || new Set()).add(fn);
        }
        return add.call(this === undefined ? window : this, type, fn, options);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, options) {
        if ((this === window || this === undefined) && live[type]) {
            live[type].delete(fn);
        }
        return remove.call(this === undefined ? window : this, type, fn, options);
    };
    const set = window.setInterval, clear = window.clearInterval;
    window.setInterval = function () { const id = set.apply(window, arguments); intervals.add(id); return id; };
    window.clearInterval = function (id) { intervals.delete(id); return clear.call(window, id); };
    window.__rbListeners = type => live[type] ? live[type].size : 0;
    window.__rbIntervals = () => intervals.size;
})()"""

GEOMETRY = """(() => {
    const box = sel => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return {left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                width: r.width, height: r.height};
    };
    return {top: box('.rb-bar-top'), bottom: box('.rb-bar-bottom'),
            north: box('.fabNorth'), south: box('.fabSouth'),
            east: box('.fabEast'), west: box('.fabWest'),
            plate: box('.app-content'), app: box('.app'),
            vw: innerWidth, vh: innerHeight};
})()"""

# Every cell of a bar that is drawn: its box, and whether its text is cut
CELLS = """(sel => {
    const bar = document.querySelector(sel);
    if (!bar) return null;
    return [...bar.querySelectorAll('.rb-slot, .rb-softkey, .rb-bar-hide')].map(e => {
        const r = e.getBoundingClientRect();
        const texts = [...e.querySelectorAll('.rb-slot-label, .rb-slot-value, .rb-softkey-label')];
        return {slot: e.dataset.slot, text: e.textContent.trim().replace(/\\s+/g, ' '),
                left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width,
                shown: r.width > 0 && r.height > 0,
                cut: texts.some(t => t.scrollWidth > t.clientWidth + 0.5)};
    });
})(%r)"""


def boot(d, width, height, storage=None, plate=None):
    """Load the HMI at an exact viewport, with localStorage set before it starts."""
    d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                deviceScaleFactor=1, mobile=False)
    for key, value in (storage or {}).items():
        d.page.eval("localStorage.setItem(%r, %r)" % (key, value))
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined' && !!angular.element(document.body).scope()",
                timeout=25, label="angular")
    d.page.wait("!!document.querySelector('[ui-view] *')", timeout=25, label="plate")
    if plate is not None:
        d.show(plate)
    d.page.pump(0.5)


def geometry(d):
    return d.page.eval(GEOMETRY)


def scope(d, expr):
    """Change the main scope, as the HMI would."""
    d.page.eval("(function(){var s = angular.element(document.body).scope(); %s; s.$apply();})()"
                % expr)
    d.page.pump(0.3)


def main_scope(d, expr):
    return d.page.eval("angular.element(document.body).scope().%s" % expr)


def bar_shown(d, which, shown=True):
    sel = ".rb-bar-%s %s" % (which, ".rb-slot" if which == "top" else ".rb-softkey")
    d.page.wait(("!!" if shown else "!") + "document.querySelector(%r)" % sel, timeout=10,
                label="%s bar %s" % (which, "shown" if shown else "hidden"))
    d.page.pump(0.3)


def key(slot):
    return ".rb-bar-bottom .rb-softkey[data-slot='%d']" % slot


def labels(d):
    return d.page.eval("[...document.querySelectorAll('.rb-bar-bottom .rb-softkey')]"
                       ".map(k => k.textContent.trim())")


def lit(d, slot):
    return d.page.eval("(k => !!k && k.classList.contains('rb-lit'))(document.querySelector(%r))"
                       % key(slot))


def press(d, slot):
    d.page.click(key(slot))
    d.page.pump(0.4)


def softkey(d, slot):
    d.page.eval("dispatchEvent(new CustomEvent('softkey', {detail: {slot: %d}}))" % slot)
    d.page.pump(0.4)


def page(d):
    return d.hash().split("?")[0]


def slot_text(d, slot, part):
    return d.page.eval("(e => e && e.textContent.trim())(document.querySelector("
                       "\".rb-bar-top [data-slot='%s'] .rb-slot-%s\"))" % (slot, part))


def near(a, b, tol=1.0):
    return a is not None and b is not None and abs(a - b) <= tol


# -- T1 ----------------------------------------------------------------------
def check_round(res):
    """480x480: a bar left shown in localStorage is not drawn, and there is no north or south FAB."""
    with Display(window="480,480") as d:
        boot(d, 480, 480, storage={"uiSidebarTop": "true", "uiSidebarBottom": "true"})
        g = geometry(d)
        res.check(main_scope(d, "barsAllowed") is False, "T1 barsAllowed is false at 480x480")
        res.check(g["top"] is None and g["bottom"] is None,
                  "T1 no bar at 480x480 with both stored as shown", g)
        res.check(g["north"] is None and g["south"] is None,
                  "T1 no north or south FAB at 480x480", g)
        res.check(near(g["plate"]["height"], 480) and near(g["plate"]["top"], 0),
                  "T1 the plate keeps the full height", g["plate"])
        d.shot("bars-480x480")
        errs = d.js_errors()
        res.check(not errs, "T1 no JS errors", errs[:1])


# -- 1280x800: T2 to T9, T11 ------------------------------------------------------
def check_hidden_default(res, d, width, height):
    g = geometry(d)
    res.check(main_scope(d, "barsAllowed") is True, "T2 barsAllowed at %dx%d" % (width, height))
    res.check(g["top"] is None and g["bottom"] is None, "T2 no bar by default", g)
    res.check(g["north"] is not None and g["south"] is not None, "T2 both FABs by default", g)
    res.check(near(g["plate"]["top"], 0) and near(g["plate"]["height"], height),
              "T2 the plate area is the full height", g["plate"])
    # Hidden bars keep the FAB zones of today: the centre 30% of the edge
    for name, fab in (("north", g["north"]), ("south", g["south"])):
        if fab is None:
            continue
        res.check(near(fab["left"], 0.35 * width) and near(fab["width"], 0.30 * width),
                  "T2 %s FAB in the centre 30%% of the edge" % name, fab)
    res.check(g["north"] and near(g["north"]["top"], 0), "T2 north FAB on the top edge", g["north"])
    res.check(g["south"] and near(g["south"]["bottom"], height), "T2 south FAB on the bottom edge",
              g["south"])
    grip = d.page.eval("""['.fabNorth', '.fabSouth'].map(sel => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const s = getComputedStyle(e, '::after');
        return {content: s.content, width: s.width, height: s.height};
    })""")
    res.check(all(g_ and g_["content"] != "none" and g_["width"] == "64px" and g_["height"] == "4px"
                  for g_ in grip), "T2 both FABs carry a 64x4 grip line", grip)


def expected_heights(height):
    top = min(max(40, 0.06 * height), 52)
    bottom = min(max(56, 0.09 * height), 80)
    return top, bottom


def check_show_hide(res, d, width, height):
    top_h, bottom_h = expected_heights(height)

    d.page.click(".fabSouth")
    bar_shown(d, "bottom")
    g = geometry(d)
    res.check(g["bottom"] and near(g["bottom"]["height"], bottom_h) and near(g["bottom"]["bottom"], height),
              "T3 south FAB shows the bottom bar, %d px high" % bottom_h, g["bottom"])
    res.check(near(g["plate"]["height"], height - bottom_h) and g["plate"]["bottom"] <= g["bottom"]["top"] + 0.5,
              "T3 the plate area shrinks by the bottom bar, nothing under it", g["plate"])
    res.check(g["south"] is None, "T3 the south FAB goes while the bar is shown", g["south"])
    d.page.click(".rb-bar-bottom [data-slot='hide']")
    bar_shown(d, "bottom", False)
    g = geometry(d)
    res.check(g["bottom"] is None and near(g["plate"]["height"], height) and g["south"] is not None,
              "T3 the hide key hides it, the plate is full height again", g)

    d.page.click(".fabNorth")
    bar_shown(d, "top")
    g = geometry(d)
    res.check(g["top"] and near(g["top"]["height"], top_h) and near(g["top"]["top"], 0),
              "T3 north FAB shows the top bar, %d px high" % top_h, g["top"])
    res.check(near(g["plate"]["top"], top_h) and near(g["plate"]["height"], height - top_h),
              "T3 the plate area shrinks by the top bar, nothing under it", g["plate"])
    res.check(g["north"] is None, "T3 the north FAB goes while the bar is shown", g["north"])
    d.page.click(".rb-bar-top [data-slot='hide']")
    bar_shown(d, "top", False)
    g = geometry(d)
    res.check(g["top"] is None and near(g["plate"]["height"], height) and g["north"] is not None,
              "T3 the hide key hides it, the plate is full height again", g)

    d.page.click(".fabNorth")
    d.page.click(".fabSouth")
    bar_shown(d, "top")
    bar_shown(d, "bottom")
    stored = d.page.eval("[localStorage.uiSidebarTop, localStorage.uiSidebarBottom]")
    boot(d, width, height)
    bar_shown(d, "top")
    bar_shown(d, "bottom")
    g = geometry(d)
    res.check(stored == ["true", "true"] and g["top"] and g["bottom"]
              and near(g["plate"]["height"], height - top_h - bottom_h),
              "T3 both bars survive a reload", {"stored": stored, "plate": g["plate"]})
    d.page.click(".rb-bar-top [data-slot='hide']")
    d.page.click(".rb-bar-bottom [data-slot='hide']")
    bar_shown(d, "top", False)
    bar_shown(d, "bottom", False)
    boot(d, width, height)
    g = geometry(d)
    res.check(g["top"] is None and g["bottom"] is None, "T3 and so does hiding them", g)


def check_off_list_page(res, d):
    """B7: a FAB or a key that toggles a bar does not change the page, nor send a key event."""
    d.show("hsi", "#hsi")
    d.page.eval("window.__rbKeys = []; addEventListener('key', e => __rbKeys.push(e.key))")
    landscape = d.page.eval("whichKeywordIsForThisDisplay()")
    listed = d.page.eval("angular.element(document.body).scope().keypadSettingsNavigation.indexOf('#/hsi')")
    res.check(landscape == "Landscape" and listed == -1, "T4 #/hsi is outside the navigation list",
              (landscape, listed))
    for sel in (".fabNorth", ".rb-bar-top [data-slot='hide']",
                ".fabSouth", ".rb-bar-bottom [data-slot='hide']"):
        d.page.click(sel)
        d.page.pump(0.5)
    res.check(page(d) == "#/hsi", "T4 showing and hiding both bars keeps the page", d.hash())
    softkey(d, 6)
    softkey(d, 3)
    softkey(d, 3)
    softkey(d, 6)
    res.check(page(d) == "#/hsi", "T4 TOP BAR in the menu keeps the page", d.hash())
    keys = d.page.eval("__rbKeys")
    res.check(keys == [], "T4 no key event dispatched", keys)


def check_root_keys(res, d):
    scope(d, "s.uiSidebarBottom = true")
    bar_shown(d, "bottom")
    res.check(labels(d) == ROOT, "T5 root level labels", labels(d))
    for slot, href in sorted(PAGES.items()):
        press(d, slot)
        d.page.wait("location.hash.split('?')[0] == %r" % href, timeout=10, label="page %s" % href)
        d.page.pump(0.5)
        others = [s for s in PAGES if s != slot and lit(d, s)]
        res.check(lit(d, slot) and not others,
                  "T5 %s opens %s and lights only its lamp" % (ROOT[slot - 1], href),
                  {"hash": d.hash(), "others lit": others})
    res.check(d.page.eval("document.querySelectorAll(%r).length" % (key(6) + " .rb-lamp")) == 0,
              "T5 MENU has no lamp")

    # A touch surface gives no other feedback than the pressed state
    box = d.page.eval("(r => ({x: r.left + r.width / 2, y: r.top + r.height / 2}))"
                      "(document.querySelector(%r).getBoundingClientRect())" % key(6))
    d.page.send("Input.dispatchMouseEvent", type="mousePressed", x=box["x"], y=box["y"],
                button="left", clickCount=1)
    pressed = d.page.eval("getComputedStyle(document.querySelector(%r)).backgroundColor" % key(6))
    d.page.send("Input.dispatchMouseEvent", type="mouseReleased", x=box["x"], y=box["y"],
                button="left", clickCount=1)
    d.page.pump(0.4)
    res.check(pressed == "rgb(58, 58, 58)", "T5 a key shows its pressed state", pressed)
    res.check(labels(d) == MENU, "T5 MENU shows the menu level", labels(d))
    d.shot("bars-1280x800-menu")
    press(d, 6)
    res.check(labels(d) == ROOT, "T5 BACK restores the root level", labels(d))

    start = time.time()
    press(d, 6)
    d.page.pump(MENU_SECONDS - 1.5 - (time.time() - start))
    still = labels(d)
    d.page.wait("document.querySelector(%r).textContent.trim() == 'MENU'" % key(6),
                timeout=4, label="menu returns")
    after = time.time() - start
    res.check(still == MENU and abs(after - MENU_SECONDS) < 1,
              "T5 the menu returns by itself after %d s" % MENU_SECONDS, "%.1f s" % after)

    press(d, 6)
    press(d, 5)
    d.page.wait("location.hash.split('?')[0] == '#/alerts'", timeout=10, label="alerts page")
    res.check(labels(d) == ROOT, "T5 ALERTS in the menu opens #/alerts and returns to the root level",
              labels(d))


def check_toggles(res, d):
    press(d, 6)
    for slot, name, cls in ((1, "uiSidebarLeft", "sidebar-left-in"),
                            (2, "uiSidebarRight", "sidebar-right-in")):
        press(d, slot)
        d.page.pump(0.5)
        on = d.page.eval("document.body.classList.contains(%r)" % cls)
        stored = d.page.eval("localStorage.getItem(%r)" % name)
        res.check(on and lit(d, slot) and stored == "true",
                  "T6 %s opens its panel, lamp lit, remembered" % MENU[slot - 1], (on, lit(d, slot), stored))
    res.check(labels(d) == MENU, "T6 a toggle keeps the menu open", labels(d))
    d.shot("bars-1280x800-panels")
    for slot, name, cls in ((1, "uiSidebarLeft", "sidebar-left-in"),
                            (2, "uiSidebarRight", "sidebar-right-in")):
        press(d, slot)
        d.page.pump(0.5)
        on = d.page.eval("document.body.classList.contains(%r)" % cls)
        res.check(not on and not lit(d, slot), "T6 %s closes it, lamp off" % MENU[slot - 1],
                  (on, lit(d, slot)))
    press(d, 3)
    bar_shown(d, "top")
    res.check(lit(d, 3), "T6 TOP BAR shows the top bar, lamp lit")
    press(d, 3)
    bar_shown(d, "top", False)
    res.check(not lit(d, 3), "T6 TOP BAR hides it, lamp off")
    press(d, 6)


def check_softkey_event(res, d):
    d.page.eval("window.__rbSoftkeys = []; addEventListener('softkey', e => __rbSoftkeys.push(e.detail && e.detail.slot))")
    press(d, 3)
    res.check(d.page.eval("__rbSoftkeys") == [3] and page(d) == "#/map",
              "T7 a touch only sends the softkey event with its slot", d.page.eval("__rbSoftkeys"))
    softkey(d, 1)
    res.check(page(d) == "#/sixpack" and lit(d, 1), "T7 softkey slot 1 does what SIXPACK does, lamp lit",
              d.hash())

    scope(d, "s.uiSidebarBottom = false")
    bar_shown(d, "bottom", False)
    softkey(d, 3)
    res.check(page(d) == "#/map", "T7 with the bar hidden: softkey slot 3 opens the map", d.hash())
    softkey(d, 6)
    res.check(main_scope(d, "softKeyLevel") == "menu", "T7 with the bar hidden: slot 6 enters the menu")
    softkey(d, 3)
    shown = d.page.eval("!!document.querySelector('.rb-bar-top')")
    softkey(d, 3)
    hidden = d.page.eval("!document.querySelector('.rb-bar-top')")
    res.check(shown and hidden, "T7 with the bar hidden: TOP BAR toggles the top bar", (shown, hidden))
    softkey(d, 6)
    res.check(main_scope(d, "softKeyLevel") == "root", "T7 with the bar hidden: slot 6 leaves the menu")
    softkey(d, 9)
    d.page.eval("dispatchEvent(new CustomEvent('softkey'))")
    d.page.pump(0.3)
    res.check(page(d) == "#/map", "T7 a slot with no key does nothing", d.hash())


def check_values(res, d):
    d.show("hsi", "#hsi")
    d.page.wait("window.aircraftData && window.aircraftData.units", timeout=10, label="aircraft units")
    ratio = d.page.eval("window.aircraftData.units.speedConversionFromKmh.multiply")
    unit = d.page.eval("window.aircraftData.units.speed")
    scope(d, "s.uiSidebarTop = true")
    bar_shown(d, "top")
    before = {s: slot_text(d, s, "value") for s in ("speed", "track", "qnh", "gmax")}
    res.check(all(v == "---" for v in before.values()), "T8 --- before any data", before)
    d.page.eval("addEventListener('SituationUpdated', () => { window.__rbSituationAt = Date.now(); })")

    def frame(seq, gs, ias, track, gmax):
        return {"TestSeq": seq, "GPSGroundSpeed": gs, "IndicatedAirSpeed": ias,
                "GPSTrueCourse": track, "AHRSGLoadMax": gmax, "GPSFixQuality": 2}

    for seq, gs, ias, track, gmax, source in ((1, 100, 0, 274.4, 1.83, "GS"),
                                              (2, 100, 120, 5.2, 2.46, "IAS")):
        d.fly(frames=4, interval=0.3, **frame(seq, gs, ias, track, gmax))
        d.page.wait("window.situation.TestSeq === %d" % seq, timeout=10, label="frame %d" % seq)
        d.page.pump(0.3)
        qnh = d.page.eval("window.situation.QNH")
        kt = gs if source == "GS" else ias
        want = {"speed": "%d" % round(kt * KT_TO_KMH * ratio), "track": "%03d°" % round(track),
                "qnh": "%d" % round(qnh) if isinstance(qnh, (int, float)) else "---",
                "gmax": "%.1f" % gmax}
        got = {s: slot_text(d, s, "value") for s in want}
        res.check(got == want, "T8 values follow the situation (%s)" % source, {"got": got, "want": want})
        res.check(slot_text(d, "speed", "label") == "%s %s" % (source, unit),
                  "T8 speed labelled %s %s" % (source, unit), slot_text(d, "speed", "label"))
    # Timed on the page from the last frame it published, not from the last push
    d.page.wait("Date.now() - window.__rbSituationAt >= 2000", timeout=5, label="2 s quiet")
    early = slot_text(d, "speed", "value")
    d.page.wait("document.querySelector(\".rb-bar-top [data-slot='speed'] .rb-slot-value\")"
                ".textContent.trim() == '---'", timeout=5, label="stale")
    gone = d.page.eval("(Date.now() - window.__rbSituationAt) / 1000")
    after = {s: slot_text(d, s, "value") for s in ("speed", "track", "qnh", "gmax")}
    res.check(early != "---" and all(v == "---" for v in after.values()) and 3.0 <= gone <= 4.3,
              "T8 --- 3 s after the situation stops", {"at 2 s": early, "after %.1f s" % gone: after})

    utc = slot_text(d, "utc", "value")
    clock = d.page.eval("new Date().toISOString().substring(11, 16)")
    res.check(utc == clock, "T8 UTC is the clock, HH:MM", (utc, clock))

    res.check(slot_text(d, "traffic", "value") == "0", "T8 no traffic heard", slot_text(d, "traffic", "value"))
    for icao in (0x4B1234, 0x4B5678, 0x4B1234):
        d.srv.push("/radar", {"Icao_addr": icao, "Reg": "TEST", "Lat": 45.0, "Lng": 10.0})
    d.page.pump(0.5)
    res.check(slot_text(d, "traffic", "value") == "2", "T8 TRAFFIC counts the targets heard",
              slot_text(d, "traffic", "value"))
    # A minute later without a word from them
    d.page.eval("window.__rbNow = Date.now; Date.now = () => window.__rbNow() + 61000")
    d.page.pump(1.5)
    aged = slot_text(d, "traffic", "value")
    d.page.eval("Date.now = window.__rbNow")
    res.check(aged == "0", "T8 a target not heard for 60 s is no longer counted", aged)

    d.page.click(".rb-bar-top [data-slot='qnh']")
    d.page.pump(0.4)
    res.check(page(d) == "#/altimeter", "T8 a tap on QNH opens the altimeter", d.hash())
    d.page.click(".rb-bar-top [data-slot='utc']")
    d.page.pump(0.4)
    res.check(page(d) == "#/altimeter", "T8 a tap on UTC opens nothing", d.hash())


def check_new_values(res, d):
    """T12 the slots added on 2026-11-11: COM and STBY of the first radio, ALT, AGL, OIL, AP."""
    d.show("hsi", "#hsi")
    scope(d, "s.uiSidebarTop = true")
    bar_shown(d, "top")
    d.page.wait("window.aircraftData && window.aircraftData.units", timeout=10, label="aircraft units")
    # The fixture answers GET /radio with no radio list
    res.check(slot_text(d, "com", "value") == "---" and slot_text(d, "stby", "value") == "---",
              "T12 COM and STBY --- before any radio", (slot_text(d, "com", "value"), slot_text(d, "stby", "value")))

    radios = [{"Name": "COM1", "FrequencyActive": "118.275", "FrequencyStandby": "121.500",
               "Dual": False, "Enabled": True, "Driver": "", "VolumeLevel": 0, "SquelchLevel": 0},
              {"Name": "COM2", "FrequencyActive": "122.800", "FrequencyStandby": "123.450",
               "Dual": False, "Enabled": False, "Driver": "", "VolumeLevel": 0, "SquelchLevel": 0}]
    d.srv.push("/radioStatus", radios)
    d.page.pump(0.5)
    got = (slot_text(d, "com", "value"), slot_text(d, "stby", "value"))
    res.check(got == ("118.275", "121.500"), "T12 COM and STBY follow the first radio", got)

    # ALT: the pressure altitude on the QNH in use, as the altimeter plate has it
    d.fly(frames=3, interval=0.3, GPSGroundSpeed=100, GPSTrueCourse=90.0, GPSFixQuality=2,
          BaroSourceType=1, BaroPressureAltitude=4500.0, BaroVerticalSpeed=0)
    want = d.page.eval("pilotDisplayedAltitudeFromMeters((window.situation.BaroPressureAltitude"
                       " + 27 * (window.situation.QNH - 1013.25)) / 3.28084).toFixed(0)")
    unit = "ft" if str(d.page.eval("window.aircraftData.units.altimeter")).lower().startswith("f") else "m"
    res.check(slot_text(d, "alt", "value") == want and slot_text(d, "alt", "label") == "ALT " + unit,
              "T12 ALT is the baro altitude on the QNH, in %s" % unit,
              {"got": slot_text(d, "alt", "value"), "want": want, "label": slot_text(d, "alt", "label")})
    d.fly(frames=3, interval=0.3, BaroSourceType=0)
    res.check(slot_text(d, "alt", "value") == "---", "T12 ALT --- with no baro", slot_text(d, "alt", "value"))

    d.srv.push("/ems", {"oiltemperature": 81, "cht1": 120})
    d.page.pump(0.8)
    want = d.page.eval("pilotDisplayedTemperaturesFromCelsius(81).toFixed(0)")
    label = "OIL " + d.page.eval("pilotTemperatureUnit()")
    res.check(slot_text(d, "oil", "value") == want and slot_text(d, "oil", "label") == label,
              "T12 OIL follows the EMS, in the pilot's unit",
              {"got": slot_text(d, "oil", "value"), "want": want, "label": slot_text(d, "oil", "label")})
    d.srv.push("/ems", {"cht1": 121})
    d.page.pump(0.8)
    res.check(slot_text(d, "oil", "value") == want, "T12 an EMS frame without oil keeps the oil value",
              slot_text(d, "oil", "value"))

    d.srv.push("/status", dict(d.srv.status or {}, Terrain_AglValid=True, Terrain_AglFt=1730))
    d.page.pump(0.6)
    want = d.page.eval("pilotDisplayedAltitudeFromMeters(1730 / 3.28084).toFixed(0)")
    res.check(slot_text(d, "agl", "value") == want and slot_text(d, "agl", "label") == "AGL " + unit,
              "T12 AGL follows Terrain_AglFt", {"got": slot_text(d, "agl", "value"), "want": want})
    d.srv.push("/status", dict(d.srv.status or {}, Terrain_AglValid=False, Terrain_AglFt=0))
    d.page.pump(0.6)
    res.check(slot_text(d, "agl", "value") == "---", "T12 AGL --- while Terrain_AglValid is false",
              slot_text(d, "agl", "value"))
    d.srv.push("/status", dict(d.srv.status or {}, Terrain_AglValid=True, Terrain_AglFt=1730))

    gprmb = dict(d.srv.autopilot_status["GPRMB"], Steer="R", TrueBearing=268.4)
    d.srv.push_autopilot(Active=True, GPRMB=gprmb)
    d.page.pump(0.5)
    res.check(slot_text(d, "ap", "value") == "268° \u25ba", "T12 AP shows the bearing it steers to and the side",
              slot_text(d, "ap", "value"))
    d.srv.push_autopilot(Active=False)
    d.page.pump(0.5)
    res.check(slot_text(d, "ap", "value") == "OFF", "T12 AP OFF when not engaged", slot_text(d, "ap", "value"))

    # Five seconds later without a word from the streams: the radio is a selection, it stays
    d.page.eval("window.__rbNow = Date.now; Date.now = () => window.__rbNow() + 6000")
    d.page.pump(1.5)
    stale = {x: slot_text(d, x, "value") for x in ("oil", "agl", "ap", "com", "stby")}
    d.page.eval("Date.now = window.__rbNow")
    res.check(stale == {"oil": "---", "agl": "---", "ap": "---", "com": "118.275", "stby": "121.500"},
              "T12 OIL, AGL and AP go to --- 5 s after their stream stops, COM and STBY stay", stale)

    for slot, href in (("ap", "#/autopilot"), ("com", "#/radio"), ("oil", "#/ems"), ("track", "#/heading")):
        d.page.click(".rb-bar-top [data-slot='%s']" % slot)
        d.page.pump(0.4)
        res.check(page(d) == href, "T12 a tap on %s opens %s" % (slot, href), d.hash())


def listed(id_, kind, active):
    return {"Id": id_, "Type": kind, "Title": "Test %d" % id_, "Timestamp": "2026-11-04T10:00:00Z",
            "TimestampEnd": "2026-11-04T10:02:14Z", "Active": active, "ActiveSeconds": 10}


def lamp(d):
    return d.page.eval("""(l => ({severity: l.dataset.severity, colour: getComputedStyle(l).backgroundColor}))
        (document.querySelector('.rb-bar-top .rb-alerts-lamp'))""")


def check_alerts(res, d):
    d.page.wait("Object.keys(angular.element(document.body).scope().alertsMapping).length > 0",
                timeout=10, label="alerts mapping")
    cases = [
        ("an empty list", [], "0", ""),
        ("one active warning, one cleared danger",
         [listed(1, EMS_RED, False), listed(2, EMS_YELLOW, True)], "1", "warning"),
        ("an active danger on top", [listed(1, EMS_RED, True), listed(2, EMS_YELLOW, True)], "2", "danger"),
        ("one-shot and cleared alerts only",
         [listed(1, EMS_RED, False), listed(2, EMS_YELLOW, False), listed(3, TIMER, False)], "0", ""),
        ("an active info", [listed(3, TIMER, True)], "1", "info"),
        ("a type the mapping cannot name", [listed(4, 999, True)], "1", "warning"),
    ]
    for name, alerts, count, severity in cases:
        d.srv.set_rest("/getAlerts", alerts)
        d.page.pump(0.5)
        got = (slot_text(d, "alerts", "value"), lamp(d))
        res.check(got[0] == count and got[1] == {"severity": severity, "colour": LAMP[severity]},
                  "T9 %s: ALERTS %s, lamp %s" % (name, count, severity or "off"), got)

    scope(d, "s.uiSidebarTop = false")
    d.srv.set_rest("/getAlerts", [listed(1, EMS_RED, True)])
    d.page.pump(0.5)
    scope(d, "s.uiSidebarTop = true")
    bar_shown(d, "top")
    got = (slot_text(d, "alerts", "value"), lamp(d)["severity"])
    res.check(got == ("1", "danger"), "T9 a bar shown after the list came shows it", got)
    d.srv.set_rest("/getAlerts", [])
    d.page.pump(0.5)


def check_listeners(res, d):
    """Bars created and destroyed by ng-if leave one set of listeners and timers."""
    events = ["SituationUpdated", "RadarChanged", "AlertsUpdated", "RadioUpdated", "EMSUpdated",
              "StatusUpdated", "AutopilotUpdated", "softkey"]
    count = lambda: {e: d.page.eval("__rbListeners(%r)" % e) for e in events}
    scope(d, "s.uiSidebarTop = false; s.uiSidebarBottom = false")
    d.page.pump(0.5)
    hidden, timers_hidden = count(), d.page.eval("__rbIntervals()")
    scope(d, "s.uiSidebarTop = true; s.uiSidebarBottom = true")
    bar_shown(d, "top")
    shown, timers_shown = count(), d.page.eval("__rbIntervals()")
    for _ in range(5):
        scope(d, "s.toggleBar('top'); s.toggleBar('bottom')")
        scope(d, "s.toggleBar('top'); s.toggleBar('bottom')")
    bar_shown(d, "top")
    again, timers_again = count(), d.page.eval("__rbIntervals()")
    res.check(all(shown[e] == hidden[e] + 1 for e in events[:-1]) and shown["softkey"] == hidden["softkey"],
              "T11 a shown top bar adds one listener per stream, the bars add no softkey listener",
              {"hidden": hidden, "shown": shown})
    res.check(again == shown and timers_again == timers_shown and timers_shown == timers_hidden + 1,
              "T11 five show and hide cycles leave one listener set and one timer",
              {"after": again, "timers": (timers_hidden, timers_shown, timers_again)})
    scope(d, "s.uiSidebarTop = false; s.uiSidebarBottom = false")
    d.page.pump(0.5)
    res.check(count() == hidden and d.page.eval("__rbIntervals()") == timers_hidden,
              "T11 hidden again, nothing of the bars is left", count())


# -- T10 -----------------------------------------------------------------------------
def check_row(res, d, label, width_note=""):
    """Both bars: one row, no cell clipped, cut or overlapping, keys of equal width.
    The soft keys at both levels: the menu labels are the longest."""
    for which in ("top", "bottom", "menu"):
        if which == "menu":
            scope(d, "s.softKeyLevel = 'menu'")
        sel = ".rb-bar-%s" % ("top" if which == "top" else "bottom")
        bar = d.page.eval("(r => ({left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width}))"
                          "(document.querySelector(%r).getBoundingClientRect())" % sel)
        cells = [c for c in d.page.eval(CELLS % sel) if c["shown"]]
        inside = all(c["left"] >= bar["left"] - 0.5 and c["right"] <= bar["right"] + 0.5
                     and c["top"] >= bar["top"] - 0.5 and c["bottom"] <= bar["bottom"] + 0.5 for c in cells)
        row = len({round(c["top"]) for c in cells}) == 1
        ordered = sorted(cells, key=lambda c: c["left"])
        overlap = [(a["slot"], b["slot"]) for a, b in zip(ordered, ordered[1:]) if a["right"] > b["left"] + 0.5]
        cut = [c["slot"] for c in cells if c["cut"]]
        res.check(inside and row and not overlap and not cut,
                  "T10 %s %s bar one row, nothing clipped, cut or overlapping%s" % (label, which, width_note),
                  {"bar": bar, "overlap": overlap, "cut": cut, "row": row, "inside": inside})
        if which == "bottom":
            keys = [c for c in cells if c["slot"] != "hide"]
            want = (bar["width"] - 56) / 6
            res.check(len(keys) == 6 and all(near(c["width"], want) for c in keys),
                      "T10 %s six keys of %.0f px" % (label, want), [round(c["width"], 1) for c in keys])
        if which == "menu":
            scope(d, "s.softKeyLevel = 'root'")
    g = geometry(d)
    for fab in ("east", "west"):
        box = g[fab]
        clear = box is None or all(b is None or box["bottom"] <= b["top"] or box["top"] >= b["bottom"]
                                   for b in (g["top"], g["bottom"]))
        res.check(clear, "T10 %s no bar in the %s FAB zone" % (label, fab), box)


def visible_slots(d):
    return [c["slot"] for c in d.page.eval(CELLS % ".rb-bar-top") if c["shown"]]


def dropped_prefix(got):
    """How many of DROP_ORDER are dropped if exactly its first ones are, else None."""
    dropped = [x for x in SLOTS if x not in got]
    k = len(dropped)
    return k if sorted(dropped) == sorted(DROP_ORDER[:k]) and got == [x for x in SLOTS if x in got] else None


def check_fit(res, d, label):
    """The shown slots are SLOTS less the first slots of DROP_ORDER, and the next one back would not fit."""
    got = visible_slots(d)
    k = dropped_prefix(got)
    res.check(k is not None and all(x in got for x in NEVER_DROPPED),
              "T10 %s top bar drops in order: %s" % (label, " ".join(got)), got)
    if k:
        # Put the last dropped slot back for one measure: it must not fit
        over = d.page.eval("""(() => {
            const status = document.querySelector('.rb-bar-top .rb-status');
            const slot = status.querySelector(".rb-slot[data-slot='%s']");
            slot.classList.remove('rb-slot-dropped');
            const over = status.scrollWidth > status.clientWidth;
            slot.classList.add('rb-slot-dropped');
            return over;
        })()""" % DROP_ORDER[k - 1])
        res.check(over, "T10 %s %s is dropped only because it does not fit" % (label, DROP_ORDER[k - 1]))
    return k


def check_drop_order(res, d, label):
    """As the top bar narrows it drops DROP_ORDER first to last, never across the groups,
    and the never dropped slots stay."""
    last = 0
    for width in (1280, 1100, 950, 800, 691, 600, 553, 500):
        d.page.eval("document.querySelector('.rb-bar-top').style.width = '%dpx'" % width)
        d.page.pump(0.3)
        end = d.page.eval("document.querySelector('.rb-bar-top').getBoundingClientRect().right")
        k = check_fit(res, d, "%s at %d px" % (label, width))
        res.check(k is not None and k >= last, "T10 %s at %d px drops no fewer than when wider" % (label, width),
                  (last, k))
        last = k if k is not None else last
        cells = [c for c in d.page.eval(CELLS % ".rb-bar-top") if c["shown"]]
        ordered = sorted(cells, key=lambda c: c["left"])
        overlap = [(a["slot"], b["slot"]) for a, b in zip(ordered, ordered[1:]) if a["right"] > b["left"] + 0.5]
        right = max(c["right"] for c in cells)
        res.check(not overlap and not any(c["cut"] for c in cells) and near(right, end),
                  "T10 %s at %d px nothing overlaps, the hide key ends the bar" % (label, width),
                  {"overlap": overlap, "right": right})
    d.page.eval("document.querySelector('.rb-bar-top').style.width = ''")


def check_balloon(res, d, label):
    """The alert balloon stays clear of both bars."""
    d.srv.push("/alerts", {"Type": EMS_RED, "Title": "OILAVG red 125", "Timestamp": "2026-11-04T10:00:00Z"})
    d.page.wait("!!document.querySelector('.alertsballoon')", timeout=5, label="balloon")
    g = geometry(d)
    b = d.page.eval("(r => ({top: r.top, bottom: r.bottom}))(document.querySelector('.alertsballoon')"
                    ".getBoundingClientRect())")
    res.check(b["top"] >= g["top"]["bottom"] and b["bottom"] <= g["bottom"]["top"],
              "T10 %s the alert balloon is clear of both bars" % label, {"balloon": b})
    return b


def run_wide(res):
    width, height = 1280, 800
    with Display(window="%d,%d" % (width, height)) as d:
        d.page.send("Page.addScriptToEvaluateOnNewDocument", source=INSTRUMENT)
        boot(d, width, height)
        res.check(d.page.eval("__rbListeners('softkey')") == 1,
                  "T7 one softkey listener, on the main scope")
        check_hidden_default(res, d, width, height)
        check_show_hide(res, d, width, height)
        check_off_list_page(res, d)
        d.show("attitude", "#attitude-rollpitch", timeout=20)
        check_root_keys(res, d)
        check_toggles(res, d)
        check_softkey_event(res, d)
        check_values(res, d)
        check_new_values(res, d)
        check_alerts(res, d)
        check_listeners(res, d)

        # T10 and the screenshots: both bars, root level, then both side panels open
        d.show("attitude", "#attitude-rollpitch", timeout=20)
        scope(d, "s.uiSidebarTop = true; s.uiSidebarBottom = true; s.softKeyLevel = 'root'")
        bar_shown(d, "top")
        bar_shown(d, "bottom")
        d.fly(frames=3, interval=0.3, GPSGroundSpeed=100, IndicatedAirSpeed=0, GPSTrueCourse=274.0,
              AHRSGLoadMax=1.8)
        check_row(res, d, "%dx%d" % (width, height))
        check_fit(res, d, "%dx%d" % (width, height))
        d.shot("bars-1280x800-root")
        check_balloon(res, d, "%dx%d" % (width, height))
        d.shot("bars-1280x800-balloon")
        d.page.eval("document.querySelector('.alertsballoon').click()")
        scope(d, "s.Ui.turnOn('uiSidebarLeft'); s.Ui.turnOn('uiSidebarRight')")
        d.page.pump(1.0)
        bar = d.page.eval("document.querySelector('.rb-bar-bottom').getBoundingClientRect().width")
        res.check(near(bar, width * 0.54, 2), "T10 both side panels leave the bars 54%% of the screen", bar)
        d.fly(frames=3, interval=0.3, GPSGroundSpeed=100, IndicatedAirSpeed=0, GPSTrueCourse=274.0,
              AHRSGLoadMax=1.8)
        check_row(res, d, "%dx%d both panels" % (width, height), " (%.0f px)" % bar)
        check_fit(res, d, "%dx%d both panels" % (width, height))
        d.shot("bars-1280x800-both-panels")
        check_drop_order(res, d, "%dx%d" % (width, height))
        scope(d, "s.Ui.turnOff('uiSidebarLeft'); s.Ui.turnOff('uiSidebarRight')")

        errs = d.js_errors()
        res.check(not errs, "1280x800 no JS errors", errs[:1])


def run_small(res):
    width, height = 1024, 600
    with Display(window="%d,%d" % (width, height)) as d:
        boot(d, width, height, storage={"uiSidebarTop": "true", "uiSidebarBottom": "true"},
             plate="attitude")
        bar_shown(d, "top")
        bar_shown(d, "bottom")
        top_h, bottom_h = expected_heights(height)
        g = geometry(d)
        res.check(near(g["top"]["height"], top_h) and near(g["bottom"]["height"], bottom_h)
                  and near(g["plate"]["height"], height - top_h - bottom_h),
                  "T10 1024x600 bars of %d and %d px, the plate between them" % (top_h, bottom_h),
                  {"top": g["top"], "bottom": g["bottom"], "plate": g["plate"]})
        d.fly(frames=3, interval=0.3, GPSGroundSpeed=100, IndicatedAirSpeed=0, GPSTrueCourse=274.0,
              AHRSGLoadMax=1.8)
        check_row(res, d, "1024x600")
        check_fit(res, d, "1024x600")
        d.shot("bars-1024x600")
        check_balloon(res, d, "1024x600")
        d.page.eval("document.querySelector('.alertsballoon').click()")
        scope(d, "s.Ui.turnOn('uiSidebarLeft'); s.Ui.turnOn('uiSidebarRight')")
        d.page.pump(1.0)
        check_row(res, d, "1024x600 both panels")
        check_fit(res, d, "1024x600 both panels (553 px)")
        d.shot("bars-1024x600-both-panels")
        errs = d.js_errors()
        res.check(not errs, "1024x600 no JS errors", errs[:1])


def main():
    res = Result()
    print("\n-- 480x480")
    check_round(res)
    print("\n-- 1280x800")
    run_wide(res)
    print("\n-- 1024x600")
    run_small(res)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
