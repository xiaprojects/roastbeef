"""Every screen, on every panel shape the HMI is built for.

js/main.js branches on `innerWidth > innerHeight` (side panels) and
`innerHeight > 480` (north/south FABs), and settings/navigation.json carries
square, landscape and portrait orders - so the HMI ships on several geometries.
A plate that overflows on the 7" panel is broken even though it looks fine on a
desktop-sized window.
"""

import sys

from plates import Display, Result

GEOMETRIES = [
    ("800x480", "800,480"),      # classic Pi 7" - exactly on the FAB breakpoint
    ("1024x600", "1024,600"),
    ("1280x800", "1280,800"),
    ("600x1024", "600,1024"),    # portrait
    ("720x720", "720,720"),      # square
]

PLATES = ["home", "synthview", "hsi", "attitude", "sixpack", "speed",
          "altimeter", "variometer", "turnslip", "heading", "gmetergauge",
          "autopilot", "airfields", "timers", "ems", "emsegt", "radio",
          "checklist", "switchboard", "map", "radar", "alerts", "resources",
          "aircraft", "charts"]

READY = {"synthview": "#synthviewFrame", "hsi": "#hsi",
         "attitude": "#attitude-rollpitch", "map": "#map_display"}

OVERFLOW = """(() => {
    const d = document.documentElement, b = document.body;
    const vw = Math.max(d.clientWidth, window.innerWidth || 0);
    const vh = Math.max(d.clientHeight, window.innerHeight || 0);
    const scrollOverflowX = Math.max(d.scrollWidth - vw, b.scrollWidth - vw);

    // Only hunt for the culprit when the document actually overflows. Calling
    // getBoundingClientRect() on every element forces a reflow per element,
    // which costs ~a minute per screen on the heavier plates - far too slow to
    // run unconditionally across 25 screens x 5 geometries.
    let worstX = 0, culpritX = '';
    if (scrollOverflowX > %d) {
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const over = Math.round(r.right - vw);
            if (over > worstX) {
                worstX = over;
                culpritX = el.tagName + (el.id ? '#' + el.id : '') +
                           (el.className ? '.' + String(el.className).split(' ')[0] : '');
            }
        }
    }
    return {
        vw: vw, vh: vh, scrollOverflowX: scrollOverflowX,
        worstX: worstX, culpritX: culpritX
    };
})()"""

# A few pixels of rounding is not a layout bug; a visibly clipped control is.
TOLERANCE = 8


def main():
    res = Result()
    problems = []

    for label, window in GEOMETRIES:
        print("\n  --- %s ---" % label)
        with Display(window=window) as d:
            for plate in PLATES:
                try:
                    d.show(plate, READY.get(plate), timeout=18)
                except TimeoutError:
                    problems.append((label, plate, "did not render"))
                    continue
                d.fly(frames=2, interval=0.2, GPSTrueCourse=45.0, AHRSRoll=5.0)
                m = d.page.eval(OVERFLOW % TOLERANCE)
                if m and (m["scrollOverflowX"] > TOLERANCE or m["worstX"] > TOLERANCE):
                    problems.append((label, plate,
                                     "%dpx past right edge (%s)"
                                     % (max(m["worstX"], m["scrollOverflowX"]),
                                        m["culpritX"] or "body scroll")))
                d.shot("layout_%s_%s" % (label, plate))

            bad = [p for p in problems if p[0] == label]
            res.check(not bad, "%-9s all %d screens fit" % (label, len(PLATES)),
                      "%d overflow" % len(bad) if bad else "")
            res.check(not d.js_errors(), "%-9s no JS errors" % label,
                      d.js_errors()[:1])

    if problems:
        print("\n  \033[33mLAYOUT PROBLEMS\033[0m")
        for geom, plate, detail in problems:
            print("    %-9s %-12s %s" % (geom, plate, detail))

    print("\n%d/%d checks passed" % (len(res.checks) - len(res.failed), len(res.checks)))
    return 1 if res.failed else 0


if __name__ == "__main__":
    sys.exit(main())
