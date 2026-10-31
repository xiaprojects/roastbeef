"""Drive the settings addon: every tab, every save, and what it posts.

The settings screen is the one place in the HMI that writes configuration, so
this file tests the writes rather than the pixels. Three contracts matter:

  1. **What is posted is what the daemon accepts.** `/setSettings` type-asserts
     every key it knows (`handleSettingsSetRequest` in managementinterface.go):
     `val.(bool)`, `int(val.(float64))`, `val.(string)`. A value of the wrong
     type does not fail the request, it *panics the handler*, so every body this
     form posts is checked against CONF_TYPES below - a table written here, from
     the daemon, independently of the JavaScript being tested.
  2. **Only what changed is posted.** Editing the G meter limits must not re-post
     `IMUMapping`: the daemon drops the orientation quaternions and re-levels the
     AHRS whenever that key arrives, which would cage the attitude mid-flight.
  3. **A save round-trips.** After Save the value is in the daemon and comes back
     on Reload, and the plates that already read the file (the EMS gauges, the
     knob's navigation list) are refreshed without a page reload.

The form is also expected to refuse to post what the daemon would mangle:
out-of-range numbers (an input that fails its own min/max leaves the Angular
model undefined, which would otherwise be posted as 0) and malformed identifier
lists are blocked at the Save button with a message.

Addons are not in the captured `/addons` fixture, so the addon is registered on
the fake backend before the browser starts (see the ADDON constant).
"""

import json
import sys

from plates import Display, Result

ADDON = {"name": "settings", "js": "addons/js/settings.js", "hash": "/addons/settings",
         "html": "addons/settings.html", "controller": "SettingsCtrl"}

# Every stratux.conf key this screen may post, and the JSON type the daemon
# asserts for it. Derived from managementinterface.go, NOT from the addon.
CONF_TYPES = {
    "Autopilot_HomeWaypoint": dict,
    "IMUMapping": list, "GLimits": str, "AltitudeOffset": int,
    "OwnshipModeS": str, "WatchList": str, "PPM": int, "Dump1090Gain": float,
    "EstimateBearinglessDist": bool, "DisplayTrafficSource": bool, "SerialOutput": dict,
    "GPS_Enabled": bool, "UAT_Enabled": bool, "ES_Enabled": bool, "OGN_Enabled": bool,
    "AIS_Enabled": bool, "APRS_Enabled": bool, "IMU_Sensor_Enabled": bool,
    "BMP_Sensor_Enabled": bool, "MS4525DO_Enabled": bool, "PWMDutyMin": int, "Ping_Enabled": bool, "Pong_Enabled": bool,
    "OGNI2CTXEnabled": bool, "Camera_Enabled": bool, "Audio_Enabled": bool,
    "Autopilot_Enabled": bool, "AutopilotUdp_Enabled": bool, "AutopilotUdp_Port": int,
    "Keypad_Enabled": bool, "Radio_Enabled": bool, "EMS_Enabled": bool, "SwitchBoard_Enabled": bool,
}

SECTIONS = ["aircraft", "ems", "autopilot", "ahrs", "receiver", "hardware", "navigation", "keypad"]

# The addon lives in the routed view; the sidebar carries its own EMS gauges and
# panels, so every selector is anchored to [ui-view] to keep them apart.
VIEW = "[ui-view] "
SCOPE = "angular.element(document.querySelector('[ui-view] .addonSettings')).scope()"
MAIN = "angular.element(document.body).scope()"
SAVE = VIEW + ".addonSettings .btn-primary.btn-block"


# -- driving the form ------------------------------------------------------

def tab(d, label):
    d.page.eval("Array.from(document.querySelectorAll(%s)).find(b => b.textContent.trim().startsWith(%s)).click()"
                % (json.dumps(VIEW + ".addonSettingsTabs button"), json.dumps(label)))
    d.page.pump(0.5)


def set_input(d, model, value):
    d.page.eval("(function(){var i=document.querySelector(%s); i.value=%s;"
                " i.dispatchEvent(new Event('input',{bubbles:true}));})()"
                % (json.dumps(VIEW + "[ng-model='%s']" % model), json.dumps(str(value))))
    d.page.pump(0.3)


def select_text(d, model, text, nth=0):
    d.page.eval("(function(){var s=document.querySelectorAll(%s)[%d];"
                " s.value=Array.from(s.options).find(o=>o.textContent.trim()==%s).value;"
                " s.dispatchEvent(new Event('change',{bubbles:true}));})()"
                % (json.dumps(VIEW + "select[ng-model='%s']" % model), nth, json.dumps(text)))
    d.page.pump(0.3)


def toggle(d, model):
    d.page.eval("(function(){var e=document.querySelector(%s); (e.querySelector('.switch')||e).click();})()"
                % json.dumps(VIEW + "ui-switch[ng-model='%s']" % model))
    d.page.pump(0.3)


def press(d, text):
    """Press the button whose label contains `text`."""
    return d.page.eval("(function(){var b=Array.from(document.querySelectorAll(%s))"
                       ".find(b=>b.textContent.includes(%s)); if(!b) return false; b.click(); return true;})()"
                       % (json.dumps(VIEW + ".addonSettings button, " + VIEW + ".addonSettings a.btn"),
                          json.dumps(text))) and d.page.pump(0.4) is None


def click_icon(d, icon, panel=None):
    """Click an icon button (fa-plus, fa-arrow-up, ...), optionally the one in
    the panel whose heading starts with `panel`."""
    hit = d.page.eval("(function(){var root=%s; if(!root) return false;"
                      " var i=root.querySelector(%s); if(!i) return false;"
                      " i.parentElement.click(); return true;})()"
                      % ("Array.from(document.querySelectorAll(%s)).map(h=>h.parentElement)"
                         ".find(p=>p.querySelector('.panel-heading').textContent.trim().startsWith(%s))"
                         % (json.dumps(VIEW + ".addonSettings .panel-heading"), json.dumps(panel))
                         if panel else "document.querySelector(%s)" % json.dumps(VIEW + ".addonSettings"),
                         json.dumps("." + icon)))
    if not hit:
        raise AssertionError("no %s icon%s" % (icon, (" in " + panel) if panel else ""))
    d.page.pump(0.4)


def badge(d):
    return d.page.eval("(document.querySelector(%s)||{}).textContent"
                       % json.dumps(VIEW + ".addonSettings .panel-heading .label.pull-right")) or ""


def blocked(d):
    """(Save disabled?, the reason shown to the pilot)"""
    return (d.page.eval("document.querySelector(%s).disabled" % json.dumps(SAVE)),
            d.page.eval("(document.querySelector(%s)||{}).textContent"
                        % json.dumps(VIEW + ".addonSettings .text-warning")) or "")


def save(d):
    d.page.eval("document.querySelector(%s).scrollIntoView({block:'center'})" % json.dumps(SAVE))
    d.page.pump(0.3)
    d.page.click(SAVE)
    d.page.pump(1.2)


def posts(d, path="/setSettings", since=0):
    """The JSON bodies posted to `path`, from index `since` on."""
    out = []
    for p, b in d.srv.posted:
        if p.split("?")[0] == path:
            try:
                out.append(json.loads(b))
            except ValueError:
                out.append(b)
    return out[since:]


def count(d, path="/setSettings"):
    return len(posts(d, path))


# -- the sections ----------------------------------------------------------

def load_test(d, res):
    res.check(d.page.eval("typeof " + SCOPE + " === 'object'"), "addon plate renders")
    labels = d.page.eval("Array.from(document.querySelectorAll(%s)).map(b=>b.textContent.trim()).join('|')"
                         % json.dumps(VIEW + ".addonSettingsTabs button"))
    res.check(all(s.lower() in labels.lower() for s in ("Aircraft", "EMS", "Autopilot", "AHRS",
                                                        "Receiver", "Hardware", "Navigation", "Keypad")),
              "every section has a tab", labels)
    loaded = [s for s in SECTIONS if d.page.eval(SCOPE + ".%s !== null" % s)]
    res.check(len(loaded) == len(SECTIONS), "every section loads its configuration",
              "%d/%d: %s" % (len(loaded), len(SECTIONS), ",".join(s for s in SECTIONS if s not in loaded)))
    res.check(not d.js_errors(), "no JS errors while loading", d.js_errors()[:1])
    res.check(not [m for m in d.srv.missing if "settings" in m], "no missing assets",
              [m for m in d.srv.missing if "settings" in m][:2])


def aircraft_test(d, res):
    """aircraft.json: the profile every other plate reads on entry."""
    tab(d, "Aircraft")
    set_input(d, "aircraft.name", "I-TEST")
    select_text(d, "aircraft.units.speed", "KT")
    res.check(d.page.eval(SCOPE + ".aircraft.units.speedConversionFromKmh.multiply") == 0.539957,
              "picking a unit fills in its conversion factor")
    res.check(badge(d) == "MODIFIED", "an edit is flagged as unsaved", badge(d))
    res.check(d.page.eval("document.querySelectorAll(%s).length > 0"
                          % json.dumps(VIEW + ".addonSettingsTabs .label-warning")),
              "the tab of an edited section is marked")

    before = count(d, "/settings/aircraft.json")
    save(d)
    body = posts(d, "/settings/aircraft.json", before)[-1]
    res.check(badge(d) == "SAVED", "saving reports success", badge(d))
    res.check(body.get("name") == "I-TEST" and body["units"]["speed"] == "KT",
              "the edited values are written to aircraft.json")
    res.check("$$hashKey" not in json.dumps(body), "Angular's $$hashKey never reaches the file")
    res.check(all(k in body["GPSGroundSpeed"] for k in ("raw", "speed", "speedDegree", "speedTicks")),
              "the gauge's runtime fields survive a save")
    res.check(d.page.eval("window.aircraftData.name") == "I-TEST",
              "the profile the other plates read is refreshed at once")

    press(d, "Reload")
    d.page.pump(1.0)
    res.check(d.page.eval(SCOPE + ".aircraft.name") == "I-TEST",
              "the value comes back from the daemon on reload",
              d.page.eval(SCOPE + ".aircraft.name"))
    d.shot("settings_aircraft")


def ems_test(d, res):
    """ems.json: the engine gauges drawn by the EMS plate and the sidebar."""
    tab(d, "EMS")
    n = d.page.eval(SCOPE + ".ems.widgets.length")
    res.check(n > 0, "the gauges are listed", "%d gauges" % n)
    d.page.eval("document.querySelectorAll(%s)[3].click()" % json.dumps(VIEW + ".addonSettingsWidgets tr"))
    d.page.pump(0.3)
    res.check(d.page.eval("document.querySelectorAll(%s).length"
                          % json.dumps(VIEW + ".addonSettingsWidgets tr.addonSettingsSelected")) == 1,
              "tapping a gauge selects it for editing")
    set_input(d, "gauge.label", "ENGINE RPM")
    click_icon(d, "fa-arrow-up")
    res.check(d.page.eval(SCOPE + ".ems.widgets[1].label") == "ENGINE RPM",
              "a gauge can be moved up the list", d.page.eval(SCOPE + ".ems.widgets.slice(0,3).map(w=>w.label).join(',')"))
    click_icon(d, "fa-plus", panel="Gauges")
    res.check(d.page.eval(SCOPE + ".ems.widgets.length") == n + 1, "a gauge can be added")

    before = count(d, "/settings/ems.json")
    save(d)
    body = posts(d, "/settings/ems.json", before)[-1]
    res.check(len(body["widgets"]) == n + 1, "every gauge is written to ems.json")
    res.check("activeColor" not in json.dumps(body),
              "the arcs' runtime colour never reaches the file")
    res.check(d.page.eval(MAIN + ".EMS.length") == n + 1 and
              d.page.eval(MAIN + ".EMS[1].label") == "ENGINE RPM",
              "the EMS plate and sidebar pick up the new gauges")
    res.check(d.page.eval(MAIN + ".EMS[0].speedTicks.length") > 0,
              "the refreshed gauges keep their scale ticks")
    d.shot("settings_ems")


def navigation_test(d, res):
    """navigation.json: the plate order the knob rotates through."""
    tab(d, "Navigation")
    shape = d.page.eval(SCOPE + ".displayShape")
    res.check(d.page.eval(SCOPE + ".edit.navigationList") == "navigationSort" + shape,
              "the list this display actually uses is the one opened", shape)
    entries = d.page.eval(SCOPE + ".navigationEntries().length")
    d.page.eval("document.querySelectorAll(%s)[2].querySelector('.fa-arrow-down').parentElement.click()"
                % json.dumps(VIEW + ".addonSettingsList tr"))
    d.page.pump(0.4)
    select_text(d, "edit.navigationAdd", "ota")
    press(d, "Append to list")
    res.check(d.page.eval(SCOPE + ".navigationEntries().length") == entries + 1,
              "a plate can be appended to the list")

    before = count(d, "/settings/navigation.json")
    save(d)
    body = posts(d, "/settings/navigation.json", before)[-1]
    res.check(body["navigationSort" + shape][-1] == "#/ota",
              "the new order is written to navigation.json")
    res.check(len(body["navigationSort"]) > 0 and "navigationSortSquare" in body,
              "the lists of the other display shapes are kept")
    res.check(d.page.eval(MAIN + ".keypadSettingsNavigation.slice(-1)[0]") == "#/ota",
              "the knob follows the new order without a reload")
    d.shot("settings_navigation")


def keypad_test(d, res):
    """keypad.json: key names to knob functions, and direct keys to plates."""
    tab(d, "Keypad")
    set_input(d, "keypadText[fn.key]", "1, MediaTrackNext, F5,")
    res.check(d.page.eval("JSON.stringify(" + SCOPE + ".keypad.keypad.KEYPAD_MAPPING_PREV)") ==
              '["1","MediaTrackNext","F5"]',
              "a comma separated list becomes an array, blanks dropped",
              d.page.eval("JSON.stringify(" + SCOPE + ".keypad.keypad.KEYPAD_MAPPING_PREV)"))
    select_text(d, "edit.directKeyMap", "Portrait")
    set_input(d, "edit.directKeyAdd.key", "Z")
    select_text(d, "edit.directKeyAdd.href", "radar")
    press(d, "Add / replace key")
    res.check(d.page.eval("(" + SCOPE + ".keypad.keypad.directKeyPortrait.Z||{}).href") == "#/radar",
              "a direct key can be added to a display-shape map")

    before = count(d, "/settings/keypad.json")
    save(d)
    body = posts(d, "/settings/keypad.json", before)[-1]
    res.check(body["keypad"]["directKeyPortrait"]["Z"]["href"] == "#/radar",
              "the direct key is written to keypad.json")
    res.check("cacheFunctions" not in json.dumps(body),
              "the knob service's runtime cache never reaches the file")
    res.check(d.page.eval("JSON.stringify(" + MAIN + ".keypadSettings.KEYPAD_MAPPING_PREV)") ==
              '["1","MediaTrackNext","F5"]',
              "the knob picks up the new mapping without a reload")
    res.check(d.page.eval("!(" + MAIN + ".keypadSettings.hasOwnProperty('cacheFunctions'))"),
              "the knob's key cache is dropped so it is rebuilt")
    d.shot("settings_keypad")


def autopilot_test(d, res):
    """Autopilot_HomeWaypoint: the Bring Me Home target, in stratux.conf."""
    tab(d, "Autopilot")
    set_input(d, "autopilot.Autopilot_HomeWaypoint.Lat", "")
    disabled, why = blocked(d)
    res.check(disabled and "atitude" in why, "an empty latitude blocks Save", why)
    press(d, "Use current GPS position")
    res.check(d.page.eval(SCOPE + ".autopilot.Autopilot_HomeWaypoint.Lat") ==
              d.page.eval("Number(window.situation.GPSLatitude.toFixed(6))"),
              "the current position can be taken as home")
    set_input(d, "autopilot.Autopilot_HomeWaypoint.Cmt", "Hangar")

    before = count(d)
    save(d)
    body = posts(d, since=before)[-1]
    home = body["Autopilot_HomeWaypoint"]
    res.check(sorted(home.keys()) == ["Cmt", "Ele", "Lat", "Lon"],
              "the waypoint is posted with the four fields the daemon reads", sorted(home.keys()))
    res.check(isinstance(home["Ele"], int) and not isinstance(home["Ele"], bool),
              "the elevation is posted as a whole number", repr(home["Ele"]))
    d.shot("settings_autopilot")


def ahrs_test(d, res):
    """IMUMapping, GLimits, AltitudeOffset - the sensor installation."""
    tab(d, "AHRS")
    res.check(d.page.eval("!!document.querySelector(%s)" % json.dumps(VIEW + "[ng-model='ahrs.AltitudeOffset']"))
              == bool(d.page.eval(SCOPE + ".conf.BMP_Sensor_Enabled")),
              "the altitude offset is offered only with a baro sensor")
    set_input(d, "ahrs.GLimits", "-1.76 x")
    disabled, why = blocked(d)
    res.check(disabled and "G limits" in why, "malformed G limits block Save", why)
    set_input(d, "ahrs.GLimits", "-1.76 4.4")
    set_input(d, "ahrs.AltitudeOffset", "-25")

    before = count(d)
    save(d)
    body = posts(d, since=before)[-1]
    res.check(body.get("GLimits") == "-1.76 4.4" and body.get("AltitudeOffset") == -25,
              "the limits and the offset are posted", json.dumps(body))
    # The daemon drops the orientation quaternions and re-levels whenever
    # IMUMapping arrives, so it must not ride along with an unrelated edit.
    res.check("IMUMapping" not in body,
              "an unrelated edit does not re-post IMUMapping (no surprise re-level)")

    select_text(d, "ahrs.IMUMapping[0]", "+Y toward nose (RY836AI)")
    before = count(d)
    save(d)
    body = posts(d, since=before)[-1]
    res.check(body.get("IMUMapping") == [2, 0], "changing the forward axis posts it", json.dumps(body))
    d.shot("settings_ahrs")


def receiver_test(d, res):
    """Ownship, traffic and the serial outputs."""
    tab(d, "Receiver")
    set_input(d, "receiver.WatchList", "LIRU LIR")
    disabled, why = blocked(d)
    res.check(disabled and "Watch list" in why, "a malformed watch list blocks Save", why)
    set_input(d, "receiver.WatchList", "liru lira")
    set_input(d, "receiver.OwnshipModeS", "300a61,abcdef")
    set_input(d, "receiver.PPM", "-3")
    select_text(d, "receiver.Dump1090Gain", "43.4")
    toggle(d, "receiver.EstimateBearinglessDist")

    ports = d.page.eval("document.querySelectorAll(%s).length"
                        % json.dumps(VIEW + "select[ng-model='serial.Baud']"))
    res.check(ports == len(d.srv.settings.get("SerialOutputs", {})),
              "every serial output port is offered", "%d ports" % ports)
    if ports:
        select_text(d, "serial.Baud", "115200 baud", nth=0)
        select_text(d, "serial.Capability", "GDL90", nth=ports - 1)

    before = count(d)
    save(d)
    bodies = posts(d, since=before)
    serial = [b["SerialOutput"] for b in bodies if "SerialOutput" in b]
    settings = [b for b in bodies if "SerialOutput" not in b]
    res.check(len(serial) == (2 if ports > 1 else ports),
              "each changed port is posted on its own, as the daemon takes them",
              "%d posts" % len(serial))
    res.check(all(sorted(s.keys()) == ["Baud", "Capability", "DeviceString"] for s in serial),
              "a port is posted with the fields the daemon reads")
    known_ports = list(d.srv.settings.get("SerialOutputs", {}))
    res.check(all(s["DeviceString"] in known_ports for s in serial),
              "only ports the daemon reported are posted (an unknown one panics it)")
    body = settings[-1]
    res.check(body.get("OwnshipModeS") == "300A61,ABCDEF" and body.get("WatchList") == "LIRU LIRA",
              "identifiers are posted upper case, as the daemon stores them", json.dumps(body))
    res.check(body.get("PPM") == -3 and body.get("Dump1090Gain") == 43.4 and
              body.get("EstimateBearinglessDist") is True,
              "the receiver settings are posted with their values", json.dumps(body))

    # Nothing changed since: Save must not write the settings again.
    before = count(d)
    save(d)
    res.check(count(d) == before, "saving an unchanged section posts nothing",
              posts(d, since=before))
    d.shot("settings_receiver")


def hardware_test(d, res):
    """The receivers, sensors and features the daemon runs."""
    tab(d, "Hardware")
    res.check(d.page.eval("document.querySelectorAll(%s).length" % json.dumps(VIEW + "ui-switch")) > 15,
              "the hardware switches are shown")
    res.check(d.page.eval("!!document.querySelector(%s)" % json.dumps(VIEW + "[ng-model='hardware.PWMDutyMin']"))
              == bool(d.page.eval(SCOPE + ".hardware.IMU_Sensor_Enabled")),
              "the fan duty is offered only with the AHRS sensor on")

    # An input that fails its own min/max leaves the model undefined; posting
    # that would coerce to 0 and silently stop the fan.
    set_input(d, "hardware.PWMDutyMin", "120")
    disabled, why = blocked(d)
    res.check(disabled and "PWMDutyMin" in why, "an out-of-range number blocks Save", why)
    set_input(d, "hardware.PWMDutyMin", "30")

    was = d.page.eval(SCOPE + ".hardware.AIS_Enabled")
    toggle(d, "hardware.AIS_Enabled")
    before = count(d)
    save(d)
    body = posts(d, since=before)[-1]
    res.check(body == {"AIS_Enabled": not was, "PWMDutyMin": 30},
              "only the keys that changed are posted", json.dumps(body))
    res.check(isinstance(body["AIS_Enabled"], bool), "a switch is posted as a boolean")

    was = d.page.eval(SCOPE + ".hardware.MS4525DO_Enabled")
    toggle(d, "hardware.MS4525DO_Enabled")
    before = count(d)
    save(d)
    body = posts(d, since=before)[-1]
    res.check(body == {"MS4525DO_Enabled": not was},
              "the airspeed sensor switch posts MS4525DO_Enabled", json.dumps(body))
    d.shot("settings_hardware")


def posted_bodies_test(d, res):
    """Every body this screen posted must be something the daemon can read."""
    bad_key, bad_type = [], []
    for body in posts(d):
        if not isinstance(body, dict):
            bad_key.append(repr(body)[:40])
            continue
        for key, value in body.items():
            want = CONF_TYPES.get(key)
            if want is None:
                bad_key.append(key)
            elif want is float:
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    bad_type.append("%s=%r" % (key, value))
            elif want is int:
                if isinstance(value, bool) or not isinstance(value, int):
                    bad_type.append("%s=%r" % (key, value))
            elif not isinstance(value, want):
                bad_type.append("%s=%r" % (key, value))
    res.check(not bad_key, "every posted key is one /setSettings knows", sorted(set(bad_key))[:4])
    res.check(not bad_type, "every posted value has the type the daemon asserts",
              sorted(set(bad_type))[:4])
    res.check(count(d) > 0, "the screen did post settings", "%d posts" % count(d))


def main():
    res = Result()
    d = Display(window="1024,768")
    # The captured /addons list is from an aircraft without this addon.
    d.srv.rest["/addons"] = d.srv.rest["/addons"] + [ADDON]
    with d:
        d.page.wait("!!angular.element(document.body).injector().get('$state').get('settings')",
                    timeout=25, label="addon registered")
        d.show("addons/settings", VIEW + ".addonSettingsTabs", timeout=25)
        for section in SECTIONS:
            try:
                d.page.wait(SCOPE + ".%s !== null" % section, timeout=15, label=section)
            except TimeoutError:
                pass                      # load_test reports which one failed
        d.page.pump(0.4)

        load_test(d, res)
        for section_test in (aircraft_test, ems_test, navigation_test, keypad_test,
                             autopilot_test, ahrs_test, receiver_test, hardware_test):
            section_test(d, res)
        posted_bodies_test(d, res)
        res.check(not d.js_errors(), "no JS errors in the whole run", d.js_errors()[:2])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
