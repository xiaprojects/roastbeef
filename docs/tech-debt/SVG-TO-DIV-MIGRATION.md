# SVG.js to DIV migration: HSI, AHRS, Radar

## Context
The six-pack instruments were moved from SVG.js drawings to plain DIVs: the plate
holds the markup, a per-instrument stylesheet positions it, and the controller only
puts values on the scope that the markup binds with `{{ }}`. Reference:
`plates/altimeter.html` + `css/Altimeter.css`, driven by `SixPackInstrumentAltimeter`
in `plates/js/SixPackInstruments.js` (for example `altimeterDegreeM = "...deg"` bound as
`style="transform: rotate({{Altimeter.altimeterDegreeM}});"`).

Three widgets still draw with SVG.js (`js/svg.min.js`). This document migrates all
three and then removes SVG.js from RB-01.

All paths are under `web/RB-01/`. **Scope rule: only files inside `web/RB-01/` are
modified.** Files outside it (`docs/`, `test/display/`, `web/index.html`) are only read
or run.

Phases, each one shippable on its own, in this order:
- **A**: HSI (`HSICircleRenderer`) becomes DOM in the four plates that show it
- **B**: AHRS (`AHRSRenderer`) is replaced by the existing `SixPackInstrumentAttitude` + `plates/attitude.html`
- **C**: Radar (`RadarRenderer`) becomes DOM in `plates/radar.html`
- **D**: remove `js/ahrs.js` and `js/svg.min.js`

## 0. Why `js/svg.min.js` is still loaded
A scan of all of RB-01 for `SVG(` finds:

| User | Where | Used by | Phase |
|---|---|---|---|
| `HSICircleRenderer` | `plates/js/hsi.js:51` | hsi, synthview, autopilot, vor | A |
| `AHRSRenderer` | `js/ahrs.js:1-183` | `plates/js/synthview.js:223` (overlay, all colours transparent), `plates/js/autopilot.js:778` (AHRS panel) | B |
| `GMeterRenderer` | `js/ahrs.js:184-290` | **nothing**: no caller anywhere, dead code | D |
| `RadarRenderer` | `plates/js/radar.js:717-957` | radar plate; also embedded as a right page (`js/startup.js:7`) | C |

`js/svg.min.js` can only be removed after A, B and C. (`web/index.html`, the legacy
Stratux UI outside RB-01, loads its own `web/js/svg.min.js` and is not affected.)

## Constraints from the display tests (read-only, under `test/display/`)
- `#hsi` must exist on the hsi plate and the synthview: `test_plates.py:21`, `test_layout.py:28`, `test_keypad.py:20`, `test_replay.py:153`, `test_chevrons.py:55-90` (measures `#hsi` height to check the HSI hides for the chevrons).
- `#attitude-rollpitch` is the attitude plate's ready selector (`test_plates.py:13`, `test_replay.py`, `test_flight.py`). It stays in `attitude.html`.
- `test_slipskid.py` measures `.attitude-slipskid` against `.attitude-center` on the attitude plate. It also requires **zero** `.attitude-slipskid` on the sixpack (`:104-107`). Phase B's overlay gate must therefore stay false outside synthview.
- **The radar plate must still contain a `canvas` or `svg` element**: its ready selector is `"canvas, svg"` (`test_plates.py:22`, `test_controls.py:23`, `marketing.py:36`). Phase C therefore keeps the aircraft silhouettes and traces as *static inline* `<svg>` markup in the template. That is ordinary Angular-bound DOM, not SVG.js. See C.3.
- `test_instruments.py` / `test_replay.py` / `test_flight.py` compare pixels between frames, so every migrated widget must visibly move when its data changes.

---

## Phase A: HSI to DOM

### A.1 Remove `HSICircleRenderer`, keep only the values
Delete `HSICircleRenderer` and its prototype (`hsi.js:36-213`, including the broken,
never-called `resize()` that reads an undefined `this.locationId`). Replace it with two
small global helpers at the same spot in `plates/js/hsi.js` (loaded from `index.html:103`,
before `autopilot.js` and before the addons). They contain no DOM code:

```js
// Compass card: a tick every 5 degrees, long ones every 15, none under the letters
const HSI_TICKS = [];   // {deg, big}  - deg % 90 != 0
const HSI_LABELS = [];  // {deg, text, cardinal} - N E S W at 0/90/180/270, 3 6 12 15 21 24 30 33

function hsiCreate(foregroundColor) {
    return { fg: foregroundColor, ticks: HSI_TICKS, labels: HSI_LABELS,
             card: "0deg", course: "0deg", bug: "0deg", cdi: "0cqw", gs: "0cqw" };
}

// Same arguments, order and clamps as the old update(), minus the unused `item`
function hsiUpdate(HSI, outer, center, vertical, radial, glideSlope) {
    // card   = rotate(-outer)
    // course = rotate(-center)
    // bug    = rotate(radial), inside the course layer as before
    // cdi    = vertical clamped to [-6, 6],       moved -vertical * 12.5 units
    // gs     = glideSlope clamped to [-15, 15],   moved -glideSlope * 25/3 units
    // units -> cqw: the old viewbox is 280 units wide, so 1 unit = 100/280 cqw
}
```

The values are strings with units, like `$scope.Altimeter` (`"90deg"`). Each host keeps
them on `$scope.HSI` (the name matches `$scope.Altimeter` / `$scope.Heading`).

### A.2 The DOM and `css/Hsi.css`
New `css/Hsi.css` (CRLF like `Altimeter.css`), linked in `index.html` next to the other
instrument sheets (lines 15-34).

- `.hsi`: `margin: 0 auto; max-height: 100cqh; aspect-ratio: 1/1; position: relative; overflow: hidden; container-type: inline-size;` (same box as `.altimeter` / `.gyro`).
- Positions and sizes are percentages of the square, fonts and borders `cqw`. Conversion from the old SVG: viewbox 280 units centred on 0, so a size of N units is `N/2.8 %` and a point at y is `top: (140 + y)/2.8 %`.
- Colour: `--hsi-fg` set on the root from `HSI.fg` (white on hsi/autopilot/vor, black on synthview). Fixed colours: orange (CDI bar, GS diamonds, lubber line, bug), red (N, centre GS dots), gray (ticks).
- Rotated items (ticks, labels, bug): one full-size layer (`position: absolute; inset: 0`) rotated about the centre, with the item placed at its radius from the top. This replaces SVG `cy(-r)` + `rotation`.
- Shapes: circles with `border-radius: 50%`; ring with a `--hsi-fg` border; arrow, bug and GS diamonds with `clip-path: polygon(...)` converted from the old polygon points.

| Element (old SVG) | DIV | Geometry |
|---|---|---|
| GS label left/right, 10px | `.hsi-gs-label` | top 10.7 %, 8 units from each edge (2.86 %), 3.57cqw |
| GS dots ×9 per side, centre red, 5 units | `.hsi-gs-dot` (ng-repeat over `[-4..4]`) | 1.79 %, every 25 units (8.93 %) |
| GS diamond (hourglass polygon) 10×20 | `.hsi-gs-diamond`, `translateY({{HSI.gs}})` | 3.57 % × 7.14 % |
| Card group, `rotate(-outer)` | `.hsi-card`, `rotate({{HSI.card}})` | full size |
| Ticks 2×10 / 4×20 at r = 105 | `.hsi-tick` / `.hsi-tick-big` (ng-repeat `HSI.ticks`) | centre at top 12.5 % |
| N E S W, 32px, at r = 120 | `.hsi-label.hsi-cardinal` (N also red) | centre at top 7.14 %, 11.43cqw |
| 3 6 … 33, 24px, at r = 125 | `.hsi-label` (ng-repeat `HSI.labels`) | centre at top 5.36 %, 8.57cqw |
| Course group, `rotate(-center)` | `.hsi-course`, `rotate({{HSI.course}})` | full size |
| Ring, diameter 200 | `.hsi-ring` | inset 14.29 %, 0.36cqw border |
| CDI bar 10×100 | `.hsi-cdi`, `translateX({{HSI.cdi}})` | 3.57 % × 35.71 %, centred |
| Course dots ×7, 5 units | `.hsi-dot` (ng-repeat over `[-3..3]`) | every 8.93 % |
| Arrow 20×40, cy −80 | `.hsi-arrow` | 7.14 % × 14.29 %, centre top 21.43 % |
| Tail 10×40, cy +80 | `.hsi-tail` | 3.57 % × 14.29 %, centre top 78.57 % |
| Bug 20×15, cy −108, inside course group | `.hsi-bug` in a layer with `rotate({{HSI.bug}})` | 7.14 % × 5.36 %, centre top 11.43 % |
| Lubber line 5×50, cy −120, fixed | `.hsi-lubber` | 1.79 % × 17.86 %, centre top 7.14 % |
| Aircraft: 2×30 @ y 5, 10×2 @ y 15, 30×2 @ y 0 | `.hsi-aircraft-*` | fixed, `--hsi-fg` |

DOM order = old SVG paint order: GS columns, card, course, lubber line, aircraft.

The markup is written out in full in each of the four plates. It is the same in all four
apart from the root id, so write it once and copy it.

### A.3 Plates and controllers
`hsiUpdate` replaces `this.hsi.update(...)` at every call site. Because the DOM is now
bound through Angular, the event listeners that feed it must run a digest
(`$scope.$apply(); // trigger any needed refreshing of data`, like
`SixPackInstruments.js:769`). Handlers that come from `ng-click` already run in one.

**a) `plates/hsi.html` + `HSICtrl` (`plates/js/hsi.js`)**
- Replace `<div id="hsi" style="… height: calc(100vh - 0px);">` with the `.hsi` markup, keeping `id="hsi"` on the root.
- `$scope.HSI = hsiCreate($scope.foregroundColor)` in `init()` (so the synthview black colour applies) and once by default. Drop `$scope.hsi = null`, the lazy `new HSICircleRenderer` (`:416-418`) and the "renderer is built asynchronously" guard (`:471-473`).
- `SituationUpdated` → `loadSituationInHSI` → add `$scope.$apply()`. The keypad listener already calls it.

**b) `plates/synthview.html`** (reuses `HSICtrl` via `ng-controller`, `init('SynthViewCtrl','#000000')`)
- Replace the inner `<div id="hsi" style="width: 40cqw; height: 40cqmin; position: absolute; …">` with the `.hsi` markup. Keep the absolute box (width, bottom, margin-left) on a wrapper or on the root, and keep `id="hsi"`.
- `.hsi` is `max-height: 100cqh` / `aspect-ratio: 1`. Check it stays square inside the 40cqw × 40cqmin box.

**c) `plates/autopilot.html` + `plates/js/autopilot.js`**
- Replace `<div id="hsi"></div>` (`:28`) with the `.hsi` markup (`id="hsi"`). The `#overrideHSI` label stays below it.
- `autopilot.js:818` `$scope.hsi = new HSICircleRenderer(...)` → `$scope.HSI = hsiCreate("#ffffff")`.
- `$scope.hsi.update(...)` at `:692`, `:718`, `:910` → `hsiUpdate($scope.HSI, ...)`. `:692`/`:718` already `$apply`. `:910` is inside `loadSituationInAutopilot`, whose caller already `$apply`s (around `:810`).
- Don't confuse it with `$scope.to.hsi`, the cross-track number (`:195`). It stays.
- The panel is a Bootstrap column with no height. Check the square fills the column width.

**d) `addons/vor.html` + `addons/js/vor.js`** (the file is `addons/vor.html`, not `plates/vor.html`)
- Replace `<div id="vorHSI" …>` (`:24`) with the `.hsi` markup, keeping `id="vorHSI"`.
- `$scope.vorHSI = null` (`:248`) → `$scope.HSI = hsiCreate($scope.foregroundColor)`. Remove the three lazy `new HSICircleRenderer` blocks (`:164-166`, `:205-207`, `:235-237`).
- The three `.update(...)` calls → `hsiUpdate($scope.HSI, items.GPSTrueCourse, items.vorradial + items.vorto*180, items.vertical, items.overrideHSI, items.slope)`.
- `situationUpdateEventListener` and `bridgeUpdatedEventListener` don't `$apply` today: add it. `switchToFrom` is `ng-click` and needs nothing.

---

## Phase B: AHRS (`AHRSRenderer`) → the existing attitude instrument
`AHRSRenderer` is not rewritten. Its DIV replacement already exists:
`SixPackInstrumentAttitude` (`plates/js/SixPackInstruments.js:210-530`) with
`plates/attitude.html` + `css/Attitude.css`. It has roll/pitch, the roll scale, the
centre symbol, slip/skid, failure X / AHRS ALIGN, chevrons, a heading tape and
speed/alt/VSI tapes. Both hosts embed it the same way `plates/sixpack.html:3` does.

### B.1 The embedding pattern (reuse as is)
- Markup, copied from `sixpack.html:3`: `<div ng-repeat="instrument in instruments" ng-include="instrument.url" ng-controller="instrument.ctrl"></div>`. The `ng-repeat` is required: `SixPackInstrument` (`SixPackInstruments.js:780-787`) registers itself as `instruments[i].pointer` through `$scope.$parent.$parent.instruments`. Also, `SixPackInstrumentAttitude` sets `Attitude.standalone = false` (`:493-496`) when it finds `instruments` there, and that hides the PFD tapes like on the six-pack.
- Host scope: `$scope.instruments = [{ "url": "plates/attitude.html", "ctrl": SixPackInstrumentAttitude, pointer: null, "name": "attitude" }]`.
- Host feeds it: `$scope.instruments.forEach(i => { if (i.pointer != null) i.pointer.updateSituation(situation); })`, exactly like `SixPackInstrumentSixpack.updateSituation` (`:803-809`), inside a listener that already `$apply`s. The child's own listeners remove themselves because `$state.current.controller` is the host, which is the intended behaviour.

### B.2 Autopilot (`plates/autopilot.html:13`, `plates/js/autopilot.js`)
- Replace `<div id="ahrs_display"></div>` with the embed. The six-pack ball look needs `.Sixpack_intrument` (round bevel in `Attitude.css:31-45`), but that class is sized for the six-pack grid (`Sixpack.css:10-19`, `33cqmax`/`50cqmin`). Add an override scoped to `#ahrs_panel` (width 100 %, square) in `css/Sixpack.css`.
- `autopilot.js:778-779` (`var ahrs = new AHRSRenderer("ahrs_display"); ahrs.turn_on();`) → `$scope.instruments = [...]`.
- `autopilot.js:853` `ahrs.update(...)` → the B.1 feed. Move it out of the `gps_time - ahrs_time < 1000` branch: the attitude does its own failure handling (`updateFailures`), so it is fed every frame.
- Known difference: AHRSRenderer drew the GS/altitude text and a heading tape in this panel. The embedded ball (standalone = false) doesn't. Accepted, because the panel next to it already shows the AHRS numbers.

### B.3 Synthetic view overlay (`plates/synthview.html:5-7`, `plates/js/synthview.js`)
Today `AHRSRenderer("ahrs_display", true, "transparent", …)` draws only marks over the 3D
scene: horizon line, roll scale + pointer, slip/skid bar, heading marks. Sky, earth and
the aircraft symbol are transparent (`css/style.css:134`), and there are no pitch marks.
- Replace the `#ahrs_display` div with the embed, keeping the wrapper's `ng-show="remote.reset==false"`, full-screen fixed box and `pointer-events: none`. Entry: `{ …, "name": "attitude", "overlay": true }`.
- `SixPackInstrumentAttitude`: in the block at `:493-496`, also set `$scope.Attitude.overlay = $scope.instrument?.overlay === true` (the ng-repeat item is on the scope chain). Default `false`, so the plate and the six-pack are unchanged.
- `attitude.html`: root gets `ng-class="{'attitude-overlay': Attitude.overlay}"`. The slip/skid (`:25`) and heading bottom bar (`:35`) gates become `(Attitude.standalone==true || Attitude.overlay==true) && …`. The tapes, QNH, VSI, wind and the attitude's own chevrons stay standalone-only. Synthview already draws its own speed/alt sides and chevrons (`synthview.html:8-24`).
- `css/Attitude.css`: a `.attitude-overlay` block. It makes sky and terrain transparent, keeps a white horizon line (top border of `.attitude-rollpitch-terrain`), makes the pink `.attitude-rollpitch` background transparent, and hides `.attitude-rollpitch-numbers`, `.attitude-center`, the doughnuts and `.attitude-fail` (the 3D view has its own failure handling). `.attitude-overlay` fills the fixed full-screen box (no `aspect-ratio`).
- `synthview.js:223-224` (`new AHRSRenderer`, `turn_on`) → `$scope.instruments = [...]`. `loadSituationInAHRS` (`:304-306`) → the B.1 feed. `situationUpdateEventListener` (`:268-290`) already `$apply`s. `$scope.Attitude.chevrons` (`:260`, `:285`) belongs to `SynthViewCtrl` and stays. The child's `Attitude` is its own scope property and does not clash.
- Compare against the baseline screenshot. If the attitude's roll scale image (`AttitudeRoll.png`) doesn't line up with the 3D horizon at full-screen aspect, scale it in the `.attitude-overlay` block only.

---

## Phase C: Radar (`RadarRenderer`) → DOM in `plates/radar.html`
`RadarRenderer` (`radar.js:717-957`) draws the scope, and the traffic code in `RadarCtrl`
(`checkCollisionVector` `:203-274`, `checkCollisionVectorValid` `:276-374`) adds SVG.js
elements per target onto `radar.allScreen` (fixed) and `radar.rScreen` (rotates with the
course), and removes them with `.remove().forget()` in five places.

### C.1 View model instead of SVG elements
- Delete `RadarRenderer` + prototype, the global `var radar`, `displaySoundStatus` (`:656-694`, only called from commented-out code) and the commented-out fullscreen/speech blocks.
- Scope values bound directly in the template: `DisplayRadius`, `AltDiffThreshold`, `BaroAltitude` (FL text) and `Radar.card = -GPSCourse + "deg"`.
- `RadarRenderer.update($scope)` becomes a plain `radarRefresh($scope)` in `RadarCtrl`. It keeps the one piece of real logic: call `clearRadarTraces($scope)` when `AltDiffThreshold` or `DisplayRadius` differ from their `Old*` values. The text updates go away because they are bound.
- Each traffic object gets plain fields instead of `planeimg/planetext/planetextOut/planespeed/planetail/trace/circ`:
  - with position (`data_list`): `shown`, `x`/`y` (percent of the 402-unit box: `(201 + dist)/4.02 %`), `heading`, `altText` (`+12↑`), `speedText`, `tracePoints` (string, appended like today's `points` attribute).
  - without position (`data_list_invalid`): `circleShown`, `circleSize` (`distx*2/4.02 %`), `labelX`/`labelY` (from `posangle` as today), `altText`.
- Every `.remove().forget()` block (`:212`, `:283-287`, `:484-490`, `:549-555`, `:567`, `:635-649`) turns into resetting these fields. The DOM follows the arrays, which are already spliced.
- Drop the lazy `new RadarRenderer` guards (`:145-147`, `:421-428`, `:530-532`) and the `$scope.radar` checks.
- Digest: `ownSituation` already `$apply`s (last line of the function, `:143-186`). The traffic (`onMessageNew`) and status listeners must call `$scope.$apply()` too, and so must the `$interval` stale sweep (`$interval` already digests).

### C.2 Template `plates/radar.html` + `css/Radar.css`
- Root `.radar` (already square in `Radar.css:1-9`) gets `position: relative; container-type: inline-size`. Geometry from the old viewbox: 402 units centred on 0, so a size of N units is `N/4.02 %`.
- Fixed layer: range text top-left (`{{DisplayRadius}} nm`), altitude band top-right (`±{{AltDiffThreshold}}00ft`), `FL{{…}}` next to the centre, own-ship icon at the centre, and four round buttons `Ra-`, `Ra+`, `Alt+`, `Alt-` as DIVs with `ng-click`. Their handlers are the existing switch blocks (`:750-858`) moved to `$scope.radarZoomIn/ZoomOut/AltMore/AltLess`. The SVG.js spin animation becomes a short CSS `@keyframes` rotate applied via a class.
- Rotating card `.radar-card` with `transform: rotate({{Radar.card}})`: rings (diameters 400 and 200 → 99.5 % / 49.75 %), N/S/W/E, and the positioned traffic (`ng-repeat="t in data_list" ng-if="t.shown"`). Each target is a group at `left: {{t.x}}; top: {{t.y}}` with the icon rotated by `t.heading`. Its labels are counter-rotated by `GPSCourse` so they stay upright, as today (`rotate($scope.GPSCourse, …)`).
- Non-rotating layer for Mode-S targets without position (`ng-repeat="t in data_list_invalid" ng-if="t.circleShown"`): a `border-radius: 50%` purple ring plus the two labels.
- `Radar.css`: SVG paint properties become CSS: `fill` → `color`/`background`, ring `stroke` → `border`, and the outlined text (`.textCOut`, `.textPlaneOut`, `.textRegOut`, stroke 2-7 px) → `-webkit-text-stroke` or a `text-shadow` halo. Keep the class names so the colours stay where they are.
- Keep `id="{{locationId}}"` on the root: the radar also renders as a right page (`js/startup.js:7`), and the unique id keeps the two copies apart.

### C.3 Aircraft icons and traces stay inline `<svg>` (static markup)
The own-ship and traffic silhouettes are the same long vector path (`radar.js:340`,
`:743`), and traces are polylines. Both stay as **inline `<svg viewBox="…"><path d="…"/></svg>`**
and `<svg><polyline ng-attr-points="{{t.tracePoints}}"/></svg>` in the template:
- they are plain DOM bound by Angular, with no SVG.js;
- a path silhouette as DIVs would be a raster image or a lot of clip-path for no gain;
- the radar's test ready selector is `"canvas, svg"`, and the test files are outside RB-01 and can't be edited, so the plate must keep an `<svg>` element.

Put the path in one place: a `RADAR_PLANE_PATH` constant in `radar.js`, bound as
`ng-attr-d="{{planePath}}"`.

---

## Phase D: drop SVG.js from RB-01
After A, B and C, `grep -rn "SVG(" web/RB-01 --include=*.js | grep -v svg.min.js` must
only find `GMeterRenderer` in `js/ahrs.js`. Then:
- delete `js/ahrs.js` (AHRSRenderer is replaced; GMeterRenderer has no callers) and its `<script>` at `index.html:87`;
- remove `<script src="js/svg.min.js">` (`index.html:88`) and delete `js/svg.min.js`;
- `css/ahrs.css`: remove the `.gMeter …`, `.ai …`, `.error` and `.msgText` rules (SVG-only). Keep `.indicator` only if a grep still finds a user; otherwise delete the file and its link (`index.html:27`). `css/style.css:133-136`: remove `.ai .transparent`;
- fix the stale comment at `SixPackInstruments.js:295` that points at `web/plates/js/ahrs.js`.

## Files (all under `web/RB-01/`)
- A: `plates/js/hsi.js`, new `css/Hsi.css`, `index.html` (link), `plates/hsi.html`, `plates/synthview.html`, `plates/autopilot.html`, `addons/vor.html`, `plates/js/autopilot.js`, `addons/js/vor.js`
- B: `plates/autopilot.html`, `plates/js/autopilot.js`, `plates/synthview.html`, `plates/js/synthview.js`, `plates/attitude.html`, `plates/js/SixPackInstruments.js` (overlay flag only), `css/Attitude.css`, `css/Sixpack.css`
- C: `plates/radar.html`, `plates/js/radar.js`, `css/Radar.css`
- D: `index.html`, delete `js/ahrs.js` and `js/svg.min.js`, `css/ahrs.css`, `css/style.css`

Not part of this work (outside RB-01): `docs/tech-debt/modernization.md:143-170` describes svg.js as "renders AHRS gauges"; after phase D it should say that RB-01 no longer uses it.

Line endings: every RB-01 file is CRLF. Edit without converting (no Python text mode).
Review with `git diff --ignore-cr-at-eol`.

## Verification (per phase)
- **Before each phase**, take baseline screenshots of the screens it touches:
  - A: hsi plate, synthview on a tall screen, autopilot HSI panel, VOR addon. The VOR addon isn't in the `/addons` display-test fixture: append it to `d.srv.rest["/addons"]` before `with d:` in a throwaway scratchpad script.
  - B: attitude plate, sixpack, autopilot AHRS panel, synthview.
  - C: radar plate with the `TRAFFIC` fixture from `test_plates.py`, and the radar as a right page.
- **A after:** at several track / cross-track / slope values (keypad PREV/NEXT changes `overrideHSI`): the card turns opposite to the track; the course ring, arrow and bug turn together; the bug also turns by the radial; the CDI bar stops at ±6 and the GS diamonds at ±15; white on hsi/autopilot/vor and black on synthview.
- **B after:** the attitude plate and sixpack must not change (diff against the baseline). Autopilot: the ball tracks pitch/roll and shows the fail X when the AHRS times out. Synthview: horizon line, roll scale, slip/skid and heading marks over the 3D scene, no opaque sky or ground, and the chevrons/HSI hand-off still works (`test_chevrons`).
- **C after:** the card rotates with the course; targets with position sit at the right bearing and range, with labels upright; targets without position show as range rings; Ra± / Alt± change range and band (POST to settings) and clear traces; stale targets disappear after `radarCutoff`.
- **D after:** `grep -rn "SVG(\|svg.min\|AHRSRenderer\|RadarRenderer\|HSICircleRenderer" web/RB-01 --include=*.js --include=*.html` is empty. No 404 for `svg.min.js`/`ahrs.js` in the network log.
- Every phase: no console errors. Run the display tests as they are, without editing them: `test_plates`, `test_layout`, `test_keypad`, `test_controls`, `test_instruments`, `test_chevrons`, `test_slipskid`, `test_replay`. `test_flight` already fails at baseline (39/57) for unrelated reasons, so compare its count before and after.
