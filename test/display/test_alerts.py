"""The alert balloon on the two panels it is designed for, the state of an alert in
the Alerts list, and the alarm replayed when an alert comes back.

An alert arrives on the /alerts socket and shows one line, the title, coloured by
the severity the mapping gives its event type. Every balloon closes by itself after
10 s, or at once when clicked. On the small square and round panel it is a cap on the
bottom edge with a ring around the screen; on a bigger panel a rounded rectangle at
3/4 of the height.

The socket carries only new alerts. AlertsService reads the state of each alert from
/getAlerts, on every page: the list follows it, and an alert going from inactive to
active replays the alarm if it had been inactive for ALERT_REPLAY_CLEAR_SECONDS. The
daemon only reports Active, so these checks drive it by changing /getAlerts.

Not covered, because it does not exist yet: the status that has to outlive the
balloon until the condition ends (docs/tech-debt/ALERTS-NAVIGATION-UI-PROPOSAL.md),
which is why this file carries no `Covers: RB-HLR-ALR-230`.

The viewport is forced: `Display(window=...)` includes the browser chrome, and
the small panel layout only applies at exactly square.
"""

import math
import sys
import time

from plates import Display, Result

PANELS = [("480x480", 480, 480), ("1280x800", 1280, 800)]

# Event types of web/settings/alertsMapping.json, one per severity
TIMER, EMS_YELLOW, EMS_RED = 2, 14, 15
LEVELS = [
    ("danger", EMS_RED, "OILAVG red 125", "rgb(196, 0, 0)", "rgb(255, 255, 255)"),
    ("warning", EMS_YELLOW, "CHTMAX yellow 190", "rgb(255, 196, 0)", "rgb(0, 0, 0)"),
    ("info", TIMER, "Timer 1 fired", "rgb(255, 255, 255)", "rgb(0, 0, 0)"),
]

BALLOON = """(() => {
    const b = document.querySelector('.alertsballoon');
    if (!b) return null;
    const r = b.getBoundingClientRect(), s = getComputedStyle(b);
    const ring = getComputedStyle(b, '::before');
    const range = document.createRange();
    range.selectNodeContents(b);
    // An ellipsis adds a second rectangle on the same line: the part still visible
    const rects = [...range.getClientRects()], t = rects[rects.length - 1];
    return {
        text: b.textContent, severity: b.dataset.severity,
        left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        bg: s.backgroundColor, color: s.color, radius: parseFloat(s.borderRadius),
        font: parseFloat(s.fontSize), lines: new Set(rects.map(x => x.top)).size,
        overflow: b.scrollWidth > b.clientWidth, ellipsis: s.textOverflow,
        textTop: t.top, textBottom: t.bottom, textLeft: t.left, textRight: t.right,
        ring: ring.content == 'none' ? null : ring.borderRadius
    };
})()"""


ROWS = """[...document.querySelectorAll('[ui-view] .alertsline')].map(r => {
    const status = r.querySelector('.alertsstatus');
    return {
        title: r.querySelector('.alertstitle').firstChild.textContent.trim(),
        status: status.textContent, active: status.classList.contains('active'),
        kept: r.dataset.kept == '1'
    };
})"""


def boot(d, width, height):
    d.page.send("Emulation.setDeviceMetricsOverride", width=width, height=height,
                deviceScaleFactor=1, mobile=False)
    d.page.goto(d.srv.url + "/RB-01/index.html")
    d.page.wait("typeof angular !== 'undefined'", timeout=25, label="angular")
    d.page.wait("(s => !!s.alertsSocket && s.alertsSocket.readyState == 1"
                " && Object.keys(s.alertsMapping).length > 0)"
                "(angular.element(document.body).scope())",
                timeout=15, label="alerts socket and mapping")


def push(d, kind, title):
    delivered = d.srv.push("/alerts", {"Type": kind, "Title": title,
                                       "Timestamp": "2026-11-04T10:00:00Z"})
    d.page.pump(0.3)
    return delivered


def balloon(d):
    return d.page.eval(BALLOON)


def clear(d):
    d.page.eval("(b => b && b.click())(document.querySelector('.alertsballoon'))")


def listed(id_, kind, title, active=False, seconds=0):
    """One alert as /getAlerts answers it."""
    return {"Id": id_, "Type": kind, "Title": title, "Timestamp": "2026-11-04T10:00:00Z",
            "TimestampEnd": "2026-11-04T10:02:14Z", "Active": active, "ActiveSeconds": seconds}


def poll(d):
    """Long enough for AlertsService to read /getAlerts again."""
    d.page.pump(2.3)


def inside_circle(x, y, centre, radius):
    return math.hypot(x - centre, y - centre) <= radius


def check_shape(res, name, b, width, height):
    if width == height:
        res.check(b["left"] == 0 and b["right"] == width and b["bottom"] == height,
                  "%s cap on the bottom edge" % name, b)
        centre = width / 2
        corners = [(x, y) for x in (b["textLeft"], b["textRight"])
                   for y in (b["textTop"], b["textBottom"])]
        res.check(all(inside_circle(x, y, centre, centre - 8) for x, y in corners),
                  "%s text inside the circle" % name, corners)
        res.check(b["ring"] == "50%", "%s ring around the screen" % name, b["ring"])
    else:
        res.check(abs((b["left"] + b["right"]) / 2 - width / 2) <= 1,
                  "%s centred" % name, b)
        res.check(abs((b["top"] + b["bottom"]) / 2 - height * 3 / 4) <= 1,
                  "%s at 3/4 of the height" % name, b)
        res.check(b["radius"] > 0 and b["ring"] is None,
                  "%s rounded rectangle, no ring" % name, b)


def run_panel(res, label, width, height):
    with Display(window="%d,%d" % (width, height)) as d:
        boot(d, width, height)
        d.show("attitude", "#attitude-rollpitch", timeout=20)
        before = d.hash()

        for severity, kind, title, bg, fg in LEVELS:
            name = "%s %s" % (label, severity)
            res.check(push(d, kind, title) > 0, "%s reaches the display" % name)
            b = balloon(d)
            if not res.check(b is not None, "%s balloon shown" % name):
                continue
            res.check(b["text"] == title and b["lines"] == 1,
                      "%s one line, only the title" % name, b)
            res.check(b["bg"] == bg and b["color"] == fg, "%s colours" % name, b)
            check_shape(res, name, b, width, height)
            d.shot("alert_%s_%s" % (label, severity))
            start = time.time()
            d.page.wait("!document.querySelector('.alertsballoon')", timeout=13,
                        label="balloon closes")
            res.check(abs(time.time() - start - 9.7) < 1, "%s closes after 10 s" % name,
                      "%.1f s" % (time.time() - start + 0.3))

        res.check(d.hash() == before, "%s no alert changes the page" % label, d.hash())

        push(d, EMS_RED, "OILAVG red 125")
        d.page.click(".alertsballoon")
        d.page.pump(0.2)
        res.check(balloon(d) is None, "%s a click hides the balloon" % label)

        push(d, EMS_RED, "OILAVG red 125")
        push(d, TIMER, "Timer 1 fired")
        res.check(balloon(d)["severity"] == "danger",
                  "%s a lower severity does not cover the balloon" % label)
        push(d, EMS_RED, "CHTMAX red 225")
        res.check(balloon(d)["text"] == "CHTMAX red 225",
                  "%s the same severity replaces it" % label)
        clear(d)
        push(d, TIMER, "Timer 1 fired")
        push(d, EMS_YELLOW, "CHTMAX yellow 190")
        res.check(balloon(d)["severity"] == "warning",
                  "%s a higher severity replaces it" % label)
        clear(d)

        push(d, EMS_RED, "Radio Freq. Set Active fail")
        b = balloon(d)
        res.check(b["lines"] == 1 and not b["overflow"],
                  "%s a long title shrinks onto one line" % label, b)
        clear(d)
        push(d, EMS_RED, "AHRS Error: Couldn't read pressure from sensor: input/output error "
                         "on the I2C bus, and more of the same that no panel can show on one line")
        b = balloon(d)
        res.check(b["lines"] == 1 and b["font"] >= 18 and b["ellipsis"] == "ellipsis",
                  "%s a very long title is cut, still one line" % label, b)
        if width == height:
            check_shape(res, label + " long title", b, width, height)
        clear(d)

        push(d, 3, "")
        res.check(balloon(d)["text"] == "Danger",
                  "%s no title falls back to the mapping's text" % label, balloon(d))
        clear(d)

        # Robustness: RB-HLR-ALR-210 and 260, the mapping cannot name these
        for kind in (-1, 999):
            push(d, kind, "Bad event %d" % kind)
            b = balloon(d)
            res.check(b is not None and b["text"] == "Bad event %d" % kind,
                      "%s unknown type %d still shown" % (label, kind), b)
            clear(d)

        # A language with fewer rows keeps the severity. The shipped languages are
        # complete (RB-HLR-ALR-070), so one is cut short here to reach the fallback
        d.page.eval("angular.element(document.body).scope().alertsMapping['it-IT'].length = 4")
        d.page.eval("Object.defineProperty(navigator, 'language',"
                    " {get: () => 'it-IT', configurable: true})")
        push(d, EMS_RED, "OILAVG red 125")
        res.check(balloon(d)["severity"] == "danger",
                  "%s a language without the row keeps the severity" % label, balloon(d))
        clear(d)

        errs = d.js_errors()
        res.check(not errs, "%s no JS errors" % label, errs[:1])


# Covers: RB-HLR-ALR-310
def check_alert_list(res, label, width, height):
    """Each row says if the alert is active and for how long, and follows the daemon."""
    oil = listed(0, EMS_RED, "OILAVG red 125", active=True, seconds=75)  # 00:00:00.00
    closed = listed(19070000, EMS_YELLOW, "CHTMAX yellow 190", seconds=134)
    oneshot = listed(19064455, TIMER, "Timer 1 fired")
    # An older daemon sends none of the new fields
    older = {"Type": 7, "Title": "Startup", "Timestamp": "2026-11-04T09:00:00Z"}
    with Display(window="%d,%d" % (width, height)) as d:
        d.srv.rest["/getAlerts"] = [older, oneshot, closed, oil]
        boot(d, width, height)
        d.show("alerts", "[ui-view] .alertsline", timeout=20)
        rows = d.page.eval(ROWS)
        res.check([(r["title"], r["status"], r["active"]) for r in rows] == [
            ("OILAVG red 125", "ACTIVE 01:15", True),
            ("CHTMAX yellow 190", "02:14", False),
            ("Timer 1 fired", "", False),
            ("Startup", "", False),
        ], "%s rows say active, time in alarm, or nothing" % label, rows)
        res.check(d.page.eval("document.documentElement.scrollWidth <= innerWidth"),
                  "%s the status does not widen the page" % label)
        d.shot("alerts_list_%s" % label)

        d.page.eval("document.querySelector('[ui-view] .alertsline').dataset.kept = '1'")
        d.srv.rest["/getAlerts"] = [older, oneshot, closed, dict(oil, ActiveSeconds=80)]
        poll(d)
        rows = d.page.eval(ROWS)
        res.check(rows[0]["status"] == "ACTIVE 01:20",
                  "%s an open list follows the daemon" % label, rows[0])
        res.check(rows[0]["kept"], "%s the same Id keeps its row" % label, rows[0])

        fresh = listed(19100000, TIMER, "Timer 2 fired")
        d.srv.rest["/getAlerts"] = [older, oneshot, closed,
                                    dict(oil, Active=False, ActiveSeconds=82), fresh]
        poll(d)
        rows = d.page.eval(ROWS)
        res.check(rows[0]["title"] == "Timer 2 fired" and rows[1]["title"] == "OILAVG red 125",
                  "%s a new alert goes on top" % label, rows[:2])
        res.check((rows[1]["status"], rows[1]["active"], rows[1]["kept"]) == ("01:22", False, True),
                  "%s a closed alert shows its time in alarm, in the same row" % label, rows[1])

        errs = d.js_errors()
        res.check(not errs, "%s list no JS errors" % label, errs[:1])


# Covers: RB-HLR-ALR-330
def check_alert_replay(res, label, width, height):
    """An alert coming back replays the alarm, on any page, if it was gone for long enough."""
    oil = listed(15000000, EMS_RED, "OILAVG red 125", active=True, seconds=10)

    with Display(window="%d,%d" % (width, height)) as d:
        def report(active):
            d.srv.rest["/getAlerts"] = [dict(oil, Active=active)]
            poll(d)

        d.srv.rest["/getAlerts"] = [oil]
        boot(d, width, height)
        d.page.eval("localStorage.setItem('Display_Audio_Alerts_Enabled', 'true')")
        d.show("attitude", "#attitude-rollpitch", timeout=20)
        before = d.hash()
        poll(d)
        res.check(balloon(d) is None, "%s loading the page replays nothing" % label)

        report(False)
        report(True)
        res.check(balloon(d) is None,
                  "%s back within ALERT_REPLAY_CLEAR_SECONDS replays nothing" % label)

        d.page.eval("ALERT_REPLAY_CLEAR_SECONDS = 1")
        report(False)
        report(False)
        d.page.eval("document.getElementById('audioproxy').removeAttribute('src')")
        report(True)
        b = balloon(d)
        res.check(b is not None and b["text"] == "OILAVG red 125",
                  "%s back after the clear time replays the balloon" % label, b)
        src = d.page.eval("document.getElementById('audioproxy').getAttribute('src')")
        res.check(src == "sounds/EVENT_TYPE_EMS_RULE_RED.mp3",
                  "%s and the sound of the alert" % label, src)
        res.check(d.hash() == before, "%s a replay does not change the page" % label, d.hash())
        clear(d)
        poll(d)
        res.check(balloon(d) is None, "%s staying active replays nothing" % label)

        d.srv.rest["/getAlerts"] = [oil, listed(15000500, EMS_RED, "CHTMAX red 225", active=True)]
        poll(d)
        res.check(balloon(d) is None, "%s a new Id is left to the socket" % label)

        # Robustness: a daemon error answers {}, and an older daemon sends no Id
        d.srv.rest["/getAlerts"] = {}
        poll(d)
        d.srv.rest["/getAlerts"] = [{"Type": EMS_RED, "Title": "Old", "Timestamp": "2026-11-04T09:00:00Z"}]
        poll(d)
        res.check(balloon(d) is None, "%s an answer it cannot follow replays nothing" % label)

        errs = d.js_errors()
        res.check(not errs, "%s replay no JS errors" % label, errs[:1])


def main():
    res = Result()
    for label, width, height in PANELS:
        print("\n-- %s" % label)
        run_panel(res, label, width, height)
        check_alert_list(res, label, width, height)
        check_alert_replay(res, label, width, height)
    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
