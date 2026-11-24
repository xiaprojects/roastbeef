"""The Best Glide panel of the settings addon: aircraft.json "bestGlide".

The glide range on the map and the synthetic view (js/glidereach.js,
docs/glide-range.md) reads its parameters from aircraft.json. The settings addon
edits them in the Aircraft section:

    defaults     a profile without bestGlide shows the defaults the glide range uses
    hints        speed and clearance repeated in the pilot's units (km/h, m)
    out of range a ratio, speed or clearance the glide range would ignore blocks
                 Save with the reason, and nothing is posted
    save         the edited values are written to aircraft.json with the right
                 types, the rest of the profile untouched
    live         window.aircraftData has them at once, and the map's glide range
                 is recomputed with them without a reload
    reload       they come back from the daemon
"""

import json
import sys

from plates import Display, Result
from test_settings import (ADDON, VIEW, SCOPE, tab, set_input, toggle, blocked, badge, save,
                           posts, count, press)

PANEL = "Array.from(document.querySelectorAll(%s)).find(h => h.textContent.trim() === 'Best Glide')" \
    % json.dumps(VIEW + ".addonSettings .panel-heading")
GLIDE = SCOPE + ".aircraft.bestGlide"


def label_text(d, model):
    return d.page.eval("document.querySelector(%s).closest('.addonSettingsRow').querySelector('label').textContent"
                       % json.dumps(VIEW + "[ng-model='%s']" % model))


def main():
    res = Result()
    d = Display(window="1024,768")
    d.srv.rest["/addons"] = d.srv.rest["/addons"] + [ADDON]
    with d:
        d.page.wait("!!angular.element(document.body).injector().get('$state').get('settings')",
                    timeout=25, label="addon registered")
        d.show("addons/settings", VIEW + ".addonSettingsTabs", timeout=25)
        d.page.wait(SCOPE + ".aircraft !== null", timeout=15, label="aircraft.json")
        d.page.pump(0.4)
        tab(d, "Aircraft")

        res.check(d.page.eval("!!(%s)" % PANEL), "the Aircraft section has a Best Glide panel")
        served = d.page.eval("fetch('/settings/aircraft.json').then(r => r.json()).then(j => j.bestGlide ?? null)")
        shown = d.page.eval(GLIDE)
        defaults = d.page.eval("GLIDE_DEFAULTS")
        res.check(shown == dict(defaults, **(served or {})),
                  "it shows the profile's values, the glide range defaults where it has none",
                  "served %s, shown %s" % (served, shown))

        # Hints in the pilot's units: the fixture flies km/h and feet
        d.page.eval(SCOPE + ".aircraft.units.speed = 'KMH'; " + SCOPE
                    + ".aircraft.units.speedConversionFromKmh = {multiply: 1, sum: 0}; "
                    + SCOPE + ".aircraft.units.altimeter = 'meters'; " + SCOPE + ".$apply()")
        set_input(d, "aircraft.bestGlide.speedKt", "80")
        set_input(d, "aircraft.bestGlide.clearanceAglFt", "1000")
        res.check("148 KMH" in label_text(d, "aircraft.bestGlide.speedKt"),
                  "the speed is repeated in km/h", label_text(d, "aircraft.bestGlide.speedKt"))
        res.check("305 m" in label_text(d, "aircraft.bestGlide.clearanceAglFt"),
                  "the clearance is repeated in metres", label_text(d, "aircraft.bestGlide.clearanceAglFt"))

        # Out of range: blocked with the reason, nothing posted
        before = count(d, "/settings/aircraft.json")
        for model, bad, word in (("aircraft.bestGlide.glideRatio", "100", "Glide ratio"),
                                 ("aircraft.bestGlide.speedKt", "5", "Best glide speed"),
                                 ("aircraft.bestGlide.clearanceAglFt", "-10", "Terrain clearance")):
            good = d.page.eval(SCOPE + "." + model)
            set_input(d, model, bad)
            disabled, why = blocked(d)
            res.check(disabled and word in why, "%s %s: Save is blocked and says why" % (word, bad), why)
            set_input(d, model, good)
        res.check(count(d, "/settings/aircraft.json") == before, "nothing is posted while blocked")

        # Save
        set_input(d, "aircraft.bestGlide.glideRatio", "11.5")
        toggle(d, "aircraft.bestGlide.useWind")
        res.check(blocked(d)[0] is False and badge(d) == "MODIFIED", "valid values unblock Save", blocked(d))
        name = d.page.eval(SCOPE + ".aircraft.name")
        save(d)
        body = posts(d, "/settings/aircraft.json", before)[-1]
        g = body.get("bestGlide", {})
        res.check(g == {"enabled": True, "glideRatio": 11.5, "speedKt": 80, "clearanceAglFt": 1000, "useWind": False},
                  "the values are written to aircraft.json as numbers and booleans", json.dumps(g))
        res.check(body.get("name") == name and "units" in body and "GPSGroundSpeed" in body,
                  "the rest of the profile is untouched")
        res.check(d.page.eval("JSON.stringify(glideParameters(window.aircraftData))")
                  == json.dumps({"enabled": True, "glideRatio": 11.5, "speedKt": 80,
                                 "clearanceAglFt": 1000, "useWind": False}, separators=(",", ":")),
                  "the glide range reads them at once (window.aircraftData)")

        press(d, "Reload")
        d.page.pump(1.0)
        res.check(d.page.eval(GLIDE + ".glideRatio") == 11.5 and d.page.eval(GLIDE + ".useWind") is False,
                  "they come back from the daemon on reload", d.page.eval(GLIDE))
        d.page.eval("document.querySelector(%s).scrollIntoView()" % json.dumps(VIEW + "[ng-model='aircraft.bestGlide.glideRatio']"))
        d.shot("settings_glide")

        # The map uses them without a reload: flat Po plain, 3000 ft
        d.show("map", "#map_display", timeout=25)
        map_scope = "angular.element(document.getElementById('map_display')).scope()"
        for _ in range(4):
            d.fly(frames=3, interval=0.3, GPSLatitude=45.07, GPSLongitude=11.14,
                  GPSAltitudeMSL=3000.0, GPSFixQuality=2)
            d.page.pump(1.2)
        r1 = d.page.eval("(r => r && r.reachM.reduce((a, b) => a + b))(%s.glideReach)" % map_scope)
        d.show("addons/settings", VIEW + ".addonSettingsTabs", timeout=25)
        d.page.wait(SCOPE + ".aircraft !== null", timeout=15, label="aircraft.json")
        tab(d, "Aircraft")
        set_input(d, "aircraft.bestGlide.glideRatio", "23")
        save(d)
        d.show("map", "#map_display", timeout=25)
        for _ in range(4):
            d.fly(frames=3, interval=0.3, GPSLatitude=45.07, GPSLongitude=11.14,
                  GPSAltitudeMSL=3000.0, GPSFixQuality=2)
            d.page.pump(1.2)
        r2 = d.page.eval("(r => r && r.reachM.reduce((a, b) => a + b))(%s.glideReach)" % map_scope)
        res.check(r1 and r2 and abs(r2 / r1 - 2) < 0.1,
                  "the map's glide range follows a saved ratio (11.5 -> 23 doubles it on the plain)",
                  "%.2fx" % ((r2 or 0) / (r1 or 1)))

        res.check(not d.js_errors(), "no JS errors", d.js_errors()[:2])

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
