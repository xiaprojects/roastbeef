"""The charts plate on the knob helper, through the real key paths.

docs/tech-debt/keypad-page-navigation.md 3.4: the chart list (an adjust stop: TAP to edit,
PREV / NEXT to choose, which reloads the chart, TAP to leave), KML, GPX, CSV, then each chart's
Download. The old listener named constants that do not exist and was never registered.

A download navigates away from the HMI, so the suite records the call instead: TAP still goes
through the button's own ng-click.
"""

import sys

import keypadtest as kt
from plates import Result

READY = "[ui-view] select[data-keypad]"
SCOPE = "angular.element(document.querySelector('%s')).scope()" % READY


def main():
    res = Result()
    d = kt.boot()
    try:
        kt.route(d, "charts", READY)
        d.page.eval("""(() => { const s = %s; s.$apply(() => {
            s.files.push({Name: 'flight1.kml', Label: 'Flight 1'}, {Name: 'flight2.kml', Label: 'Flight 2'});
            s.downloadByExt = ext => { window.__ext = ext; };
            const reload = s.reloadCharts; s.reloadCharts = () => { window.__reloads = (window.__reloads || 0) + 1; reload(); };
        }); })()""" % SCOPE)
        d.page.pump(0.3)
        stops = kt.stops(d)
        res.check(stops[:4] == ["CHART", "KML", "GPX", "CSV"], "the chart list, KML, GPX, CSV", stops)
        kt.check_entry(d, res, "charts", lambda: (d.page.eval("window.__ext || null"), d.page.eval(SCOPE + ".ChartSelect")))
        kt.check_walk(d, res, "charts", plate="charts")
        kt.check_socket(d, res, "charts")

        kt.go_to(d, 0)
        d.key(kt.TAP)
        res.check(kt.focus(d).get("mode") == "edit", "TAP on the list enters edit mode", kt.focus(d))
        d.key(kt.NEXT)
        res.check(d.page.eval(SCOPE + ".ChartSelect") == "flight1.kml" and d.page.eval("window.__reloads") == 1,
                  "NEXT chooses the next chart and reloads it once", (d.page.eval(SCOPE + ".ChartSelect"), d.page.eval("window.__reloads")))
        d.key(kt.NEXT)
        d.key(kt.NEXT)
        res.check(d.page.eval(SCOPE + ".ChartSelect") == "flight2.kml", "and stops at the last", d.page.eval(SCOPE + ".ChartSelect"))
        d.key(kt.PREV)
        d.key(kt.PREV)
        res.check(d.page.eval(SCOPE + ".ChartSelect") == "live", "PREV back to the live recording", d.page.eval(SCOPE + ".ChartSelect"))
        d.key(kt.TAP)
        d.key(kt.NEXT)
        res.check(kt.lit(d) == ["KML"], "TAP leaves edit mode, NEXT moves on", kt.lit(d))
        got = []
        for k in (1, 2, 3):
            kt.go_to(d, k)
            d.key(kt.TAP)
            got.append(d.page.eval("window.__ext"))
        res.check(got == ["kml", "gpx", "csv"], "TAP on KML, GPX, CSV downloads that format", got)
        res.check(not kt.errors(d, "charts"), "no JS error", kt.errors(d, "charts")[:3])
    finally:
        kt.close(d)
    for width, height in kt.PANELS:
        d = kt.boot((width, height))
        try:
            kt.route(d, "charts", READY)
            kt.check_glass(d, res, "charts", width, height)
        finally:
            kt.close(d)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
