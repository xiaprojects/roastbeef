# Keypad navigation inside every RB-01 page

Status: every page has the knob (2026-11-18); open questions at the end of Status. Written 2026-11-15 from a read of the working tree; each finding names the file it was
read from. Nothing here was run on hardware.

Progress (2026-11-17, display tests only, uncommitted):

- Phase 0a done: `servicekeypad.js` fixes F1, F2, F3, F6 and the keydown typo, D1 applied.
  Test: `test_keypad_service.py`.
- Phase 0b in part: `Display.key()` and `Display.ws_key()` in `plates.py`. The suites read
  `window.keypadFocusState()` directly; `Display.focus()` and `Display.focused()` are not added.
- Phase 0c done with `switchboard` (2026-11-18): `js/keypadfocus.js` (script tag in `index.html` and
  `simulator.html`), `.keypadFocus` and `.keypadEdit` in `css/style.css`. As 3.3, with: no focus on
  entry (first NEXT takes the first stop, first PREV the last, TAP with no focus does nothing); the
  focus put back after a digest that redrew its element; `timeoutSeconds` defaults to 0, as the
  20 s of D4 is postponed by the owner until every page is done. Not built yet: the `◄ ►` edit
  marker of 3.2.
- `radio` done first, at the owner's request, ahead of phase 1. It keeps its own model (3.4), with
  these fixes: the sidebar copy ignores the knob (F4, D3); the walk stops at both ends (D2), where NEXT
  past the last recording used to jump back to the last radio without redrawing; TAP on the third
  recording or later played the wrong one; a radio status frame cleared the bar on a recording; the
  listener of a left plate is removed on `$destroy`; every stop is scrolled onto the glass, not only
  the sliders; the `to` events are gone. SWITCH FREQ. is a stop between kHz and the sliders
  (owner, 2026-11-17): TAP swaps active and standby, no edit mode. DUAL, ACTIVE, SQL, KEYPAD and
  SEARCH stay touch only. No focus on entry and the 20 s timeout (3.1, D4) are postponed by the
  owner until every page is done, then applied to all pages, `radio` included.
  Test: `test_keypad_radio.py`.
- `checklist` done second, at the owner's request (2026-11-18). It keeps its own model: PREV / NEXT
  one row across the sections, TAP cycles the status. Fixes: the knob's row lived in each check's
  `isselected`, which is saved with the checklist, so it went to the daemon on every TAP, was shared by
  every display, could light several rows (one TAP then cycled them all and saved twice), and a
  checklist saved without one left the knob dead. It now lives in the controller, on `$rootScope` so
  the pilot comes back to the row they left; `isselected` is no longer read or written (the file
  format, `main/checklist.go` and `web/plates/` are unchanged). Also: stop at both ends, the `from` /
  `to` events gone, the scroll found the row by `status_<id>`, which repeats in every section; the
  row is centred on the glass instead; the listener of a left plate is removed on `$destroy` (on a
  return it posted the stale list); a touch on a row's list moves the knob there and gives the focus
  back, as a focused `<select>` takes no keypad key (F2). Test: `test_keypad_checklist.py`.
- `map` done third (2026-11-18), zoom only as the owner asked: PREV zooms out, NEXT zooms in, one
  whole level a click about the middle of the map, from wherever a pinch left it, within 2 to 18
  (`MAP_KNOB_MIN_ZOOM`, `MAP_KNOB_MAX_ZOOM`); on a wide panel the view stops near 2.3, where the
  world fills it. TAP does nothing: centring on the aircraft (3.4) is not built. The arrows do not
  also pan the map. Test: `test_keypad_map.py`.
- `switchboard` done fourth (2026-11-18), the first page on the helper: each tile a stop, TAP runs it
  as a touch does. No focus on entry matters here: the aircraft's tiles include `halt` and `reboot`.
  The stub listener and the `keypadSelectedYes` binding on `scrollItemCounter` (never set on this
  plate) are gone; the tile padding they carried is on `.switchBoardButton` itself. `rbserver.py`
  now answers `PUT /switches` with the switch, as `handleSwitchBoardPut` does, instead of
  `{"ok": true}`, which blanked the tile. Test: `test_keypad_switchboard.py`.
- `altimeter` done fifth (2026-11-18), as the owner asked: PREV / NEXT = QNH -1 / +1 hPa with AUTO
  off, TAP = AUTO on. F8 was wrong for this page: its own touch zones already set the QNH through
  `SituationUpdatedByPilot` (`fabClick` in the altimeter controller overrides the one in `main.js`);
  the knob calls the same `qnhStep` / `qnhAuto`. The shared instrument listener in
  `SixPackInstruments.js` hands the key to `$scope.knob(key)` when a plate defines one (only the
  routed plate: the altimeter inside the sixpack stays inert) and is removed on `$destroy`. Fixed on
  the way: the plate redrew only on a new baro altitude, so on the ground a new QNH did not move the
  needle and AUTO did not light until a climb. No QNH limits, as touch has none. Test:
  `test_keypad_altimeter.py`.
- `gmetergauge` done sixth (2026-11-18), as the owner asked: TAP resets Max and Min, the same
  `POST /resetGMeter` as the centre touch zone (it existed: F8 was wrong here too); PREV and NEXT
  stay inert. Test: `test_keypad_gmeter.py`.
- 2026-11-18, the remaining pages, in the order of section 4 (scheduled run at the owner's request).
  Shared checks of 6.3 in `test/display/keypadtest.py`, one `test_keypad_<page>.py` per page.
  - Helper changes: a page may be routed by several states (home is `home` and `aircraft`);
    `options.direct(key)` sees each key first (a page mode of its own); a focused stop replaced by a
    redraw hands the focus to the stop of the same name nearest its place, while a stop hidden or
    removed with no such heir (a list opened or closed) clears the focus, as a new page does; on a
    square panel a stop whose middle is outside the circle is scrolled to the middle too; the redraw
    check runs one tick after the digest, after `ng-show` applied its class.
  - home / `aircraft`: each tile that opens a page, left column then right; TAP opens it. The stub
    listener is gone. `test_keypad_home.py`.
  - `timers`: rewritten on the helper; per timer START/STOP, mode, -5, +5 (only on a running
    countdown), DELETE last; then Create. The hand-written selection and its two bugs are gone, with
    the highlight kept in the timers' data. On the round panel the first timer's delete button was
    off the glass where no scroll reaches: `css/timers.css` pulls it in on square viewports.
    `test_keypad_timers.py`.
  - addon `vor`: TO/FROM (LOC or GS on an ILS) and the status that opens the search; with the list
    open, OFF and each station, TAP tunes and closes the list. `test_keypad_vor.py`.
  - `radar`: direct, two modes; TAP switches between them, every entry starts on the range. Range:
    PREV / NEXT = Ra- / Ra+ (2 to 40 NM). Altitude band: PREV / NEXT = Alt- / Alt+ (500 to 50000 ft).
    The label being turned gets the green `keypadEdit` outline from the first knob key on, not on
    entry. The sidebar copy ignores it.
    Its `init()` from `radar.html` used to reset the sidebar flag. `radar.js` is LF now.
    `test_keypad_radar.py`.
  - `alerts`: each row, TAP replays its sound; a new alert above keeps the knob on its alert.
    `test_keypad_alerts.py`.
  - `synthview`: the dead `MediaTrackNext` / `MediaTrackPrevious` cases removed (the functions they
    called, zoom, stay, unused). `test_keypad_synthview.py` guards orbit and reset.
  - `camera`: each heading (Edit / Save), its type list while editing (adjust stop), the two create
    buttons; text fields never. Old listener and `scrollItemCounter` gone. `test_keypad_camera.py`.
  - `resources`: opens on the first image as before; with an image shown PREV / NEXT step images, TAP
    back to the list; on the list each row, TAP shows it. `test_keypad_resources.py`.
  - `voice`: PRIMARIO, SECONDARIO, DISPLAY, Enable Audio. `test_keypad_voice.py`.
  - `heading`: no heading bug exists; TAP cycles the source GPS > GYRO > MAG as the centre touch zone
    does, PREV / NEXT inert. `test_keypad_heading.py`.
  - addon `magnetometer`: mode, calibrate, config, autocal, RESET (two presses, as by touch), GPS
    offset last. On the round panel its top right buttons were off the glass: `magnetometer.css`
    moves them in on square viewports. `test_keypad_magnetometer.py`.
  - `charts`: the chart list (adjust stop: the chart reloads), KML, GPX, CSV, each Download. Dead
    listener deleted. Fixed on the way: choosing another chart threw "Canvas is already in use"
    (touch too); the old Chart.js chart is destroyed first. `test_keypad_charts.py`.
  - `ota`: each addon row, TAP opens it. INSTALL and UPDATE are not stops (open question below).
    `test_keypad_ota.py`.
  - `addons` (2026-11-22): the addon list of `ota` on its own page, after `switchboard` in every
    navigation list and on bottom bar slot 4 as the alternative to SWITCH. Each row a stop, TAP
    opens it. The list code is shared: `addonsListLoad` in `plates/js/addons.js`.
    `test_keypad_addons.py`.
  - addon `settings`: no stops, and the keypad is off on the page (F10, owner, 2026-11-19): the
    controller calls `$scope.keypadDisable($scope)`. `test_keypad_settings.py` types into its
    fields, then checks keys from both paths do nothing and a touch swipe still leaves.
  - addon `example`: a commented `KeypadFocus` block for addon authors.
  - Inert pages (6.4): `test_keypad.py` checks the real keys change nothing on sixpack, speed,
    attitude, turnslip, variometer, ems, emsegt.
  - Phase 5: regression tests first (6.5) for `airfields`, `autopilot`, `hsi`. `airfields` moved onto
    the helper: the sort toggle is the first stop (one anchor now, not two swapped by `ng-show`),
    no row is focused on entry (the old plate had row 0 selected, so a stray TAP flew direct to it),
    and the old scroll by list index into ids by `point.index` is gone. `checklist` stays on its
    own (fixed) model. `test_keypad_airfields.py`, `test_keypad_hsi.py`.
  - `autopilot`: moved onto the helper with the stops the owner chose (2026-11-18), in this order:
    the HSI panel (adjust: TAP, then PREV / NEXT turn the approach direction, the override radial,
    1 degree a click; TAP releases it), the HOME button (TAP = a touch on it), each waypoint of the
    flight plan, then each airfield of the list (TAP = a touch on the row). Not stops: the AHRS,
    destination and forecast panels, Nearest, STOP AP, the waypoint trash, Drop Route, the GPX
    import, the sort toggle. After a direct-to by the knob it lands on the HSI panel, as the old
    model did; a touch with the knob unused lights nothing. The helper gained `select(element)` and
    `isEditing(element)`, and a TAP on an adjust stop now runs a digest so a template can show the
    edit mode (the OVERRIDE RADIAL label turns red). `test_keypad_autopilot.py`.

### Open questions for the owner (2026-11-18)

- `ota`: INSTALL and UPDATE run at once on a touch, with no confirmation. Should the knob reach them,
  and if so with a confirmation step (a second TAP, as the magnetometer RESET)? Today they are not
  stops.
- `map`: TAP to centre on the aircraft (3.4) is still not built.
- The 20 s timeout (D4) and no focus on entry for `radio` and `checklist`: postponed until now, every
  page has the knob.
- The `◄ ►` edit marker of 3.2 is not built; edit mode is the green outline only.

## Goal

A pilot with a connected keyboard or knob can move inside every RB-01 page and operate it with
three functions only:

| Function | Constant | Default keys (`web/settings/keypad.json`) |
|---|---|---|
| Previous | `KEYPAD_MAPPING_PREV` | `1`, `MediaTrackNext`, `ArrowLeft`, `ArrowUp`, `MediaFastForward` |
| Tap | `KEYPAD_MAPPING_TAP` | `2`, `Enter`, `ENTER`, `BrowserHome`, `AudioVolumeMute` |
| Next | `KEYPAD_MAPPING_NEXT` | `3`, `MediaTrackPrevious`, `ArrowRight`, `ArrowDown`, `MediaRewind` |

Out of scope: changing page (`SwipeLeft`, `SwipeRight`, `directKey`), the soft key bars
(`top-bottom-bars.md`, P1) and alert acknowledge (`ALERTS-NAVIGATION-UI-PROPOSAL.md`, 4.4). This
plan must not break them, and section 3.5 says where they meet.

## How to use this plan (for the implementing agent)

- Do the phases in order. Phase 0 is a prerequisite: without it most pages never receive the keys.
- One page per commit, each with its test (section 6). Do not start a page before the previous
  page's test passes.
- RB-01 JavaScript is CRLF, except `map.js` and `map.html`. Keep each file's line endings.
- The working tree has uncommitted changes in `web/RB-01/plates/switchboard.html`,
  `web/RB-01/css/Switchboard.css`, `web/RB-01/addons/vor.*` and `test/display/test_vor*.py`. Build
  on them, do not revert them.
- The display tests are local only. Run them one suite at a time (`cd test/display && ./run.py
  test_keypad_focus.py`); two Chromium suites together run out of memory on the 8 GB machine.
- The 480×480 panel is round. A highlight must stay visible inside the circle.
- Decisions D1 to D5 in section 7 were agreed by the owner on 2026-11-15. They are requirements,
  not defaults.

## Architecture today

```
USB keyboard on the Pi ── main/keypad.go (keylogger) ── websocket /keypad ─┐
                          status 0 = release, 2 = hold (500 ms)            │
                                                                           ▼
Keyboard seen by Chromium ── keydown/keyup on window ──────────► services/servicekeypad.js
                                                                 window event "key" {key: raw name}
                                                                           │
                     directKey match ──► document.location = href          │
                     else page in navigation.json list for this shape?     │
                        no  ──► document.location = "#/"                   │
                        yes ──► keyToFunction(raw) ─► SwipeLeft/Right: change page
                                                   └► PREV/TAP/NEXT: window event
                                                      "keypad" {key: KEYPAD_MAPPING_*}
                                                                           ▼
                                                       plate controller keypadEventListener
```

- The display shape is `Square`, `Landscape` or `Portrait` (`whichKeywordIsForThisDisplay()` in
  `js/global.js`), and picks `navigationSort<Shape>` in `web/settings/navigation.json`.
- A plate receives only the three function names, never the raw key.
- A hold arrives as the window event `keypadHold`. Its only listener is empty.
- The highlight in use is the class pair `keypadSelectedYes` / `keypadSelectedNo`
  (`css/timers.css`): a 3 px red left border. `css/Switchboard.css` already redraws it as an
  outline for tiles, because the border shifts the content.

---

## 1. List of pages

Routes are in `web/RB-01/js/main.js`. Addons are routed at run time from `GET /addons`
(`handleAddonsGet`: one route `#/addons/<name>` per file in `web/RB-01/addons/`).

"In list" says whether the page is in the navigation list of each shape (S = Square,
L = Landscape, P = Portrait). It matters because of finding F1.

| # | Route | Template | Controller | In list | Touch controls |
|---|---|---|---|---|---|
| 1 | `#/` (home) | `plates/aircraft.html` | `AircraftCtrl` | S L P | tile grid, `goTo(item)` |
| 2 | `#/aircraft` | same | same | none | same |
| 3 | `#/sixpack` | `plates/sixpack.html` | `SixPackInstrumentSixpack` | L P | none |
| 4 | `#/speed` | `plates/speed.html` | `SixPackInstrumentSpeed` | S | none |
| 5 | `#/attitude` | `plates/attitude.html` | `SixPackInstrumentAttitude` | S | none |
| 6 | `#/altimeter` | `plates/altimeter.html` | `SixPackInstrumentAltimeter` | S | 3 FABs (NC, SC, C), dead: see F8 |
| 7 | `#/turnslip` | `plates/turnslip.html` | `SixPackInstrumentTurnslip` | S | none |
| 8 | `#/heading` | `plates/heading.html` | `SixPackInstrumentHeading` | S | 1 FAB (C), dead |
| 9 | `#/variometer` | `plates/variometer.html` | `SixPackInstrumentVariometer` | S | none |
| 10 | `#/gmetergauge` | `plates/gmetergauge.html` | `SixPackInstrumentGmetergauge` | S L P | 1 FAB (C), dead |
| 11 | `#/synthview` | `plates/synthview.html` | `SynthViewCtrl` | S L P | reset view, cage AHRS |
| 12 | `#/hsi` | `plates/hsi.html` | `HSICtrl` | S | none |
| 13 | `#/airfields` | `plates/airfields.html` | `AirfieldsCtrl` | S L P | sort toggle, row = direct to |
| 14 | `#/autopilot` | `plates/autopilot.html` | `AutopilotCtrl` | L P | 13 buttons, 1 input |
| 15 | `#/timers` | `plates/timers.html` | `TimersCtrl` | S L P | start, mode, −5, +5, delete, create |
| 16 | `#/ems` | `plates/ems.html` | `EMSCtrl` | L P | none |
| 17 | `#/emsegt` | `plates/emsegt.html` | `EmsegtCtrl` | S L P | none |
| 18 | `#/radio` | `plates/radio.html` | `RadioCtrl` | S L P | 28 buttons, 2 inputs |
| 19 | `#/camera` | `plates/camera.html` | `CameraCtrl` | L P | camera header, 2 create buttons, 3 inputs |
| 20 | `#/checklist` | `plates/checklist.html` | `CheckCtrl` | S L P | one `<select>` per item |
| 21 | `#/alerts` | `plates/alerts.html` | `AlertsCtrl` | L P | row = replay sound |
| 22 | `#/charts` | `plates/charts.html` | `ChartsCtrl` | L P | chart `<select>`, KML, GPX, CSV, download |
| 23 | `#/switchboard` | `plates/switchboard.html` | `SwitchboardCtrl` | S L P | tile = `sendCommand($index)` |
| 24 | `#/voice` | `plates/voice.html` | `VoiceCtrl` | S L P | 3 name buttons, Enable Audio |
| 25 | `#/map` | `plates/map.html` | `MapCtrl` | S L P | map gestures only |
| 26 | `#/radar` | `plates/radar.html` | `RadarCtrl` | S L P | none in the template |
| 27 | `#/resources` | `plates/resources.html` | `ResourcesCtrl` | S L P | thumbnail = zoom, zoom = back |
| 28 | `#/ota` | `plates/ota.html` | `OtaCtrl` | none | tiles, INSTALL / UPDATE |
| 28a | `#/addons` | `plates/addons.html` | `AddonsCtrl` | S L P | addon row = open it (START) |
| 29 | `#/addons/settings` | `addons/settings.html` | from `/addons` | none | 19 buttons, 51 inputs |
| 30 | `#/addons/vor` | `addons/vor.html` | from `/addons` | none | TO/FROM, LOC/GS select, search, station rows |
| 31 | `#/addons/magnetometer` | `addons/magnetometer.html` | from `/addons` | none | 7 toggles and actions |
| 32 | `#/addons/example` | `addons/example.html` | from `/addons` | none | none |

Not pages, but they hold controls and take part in the rules of section 3.5:

| Surface | File | Note |
|---|---|---|
| Left and right sidebars | `index.html`, pages from `js/startup.js` | They hold second copies of `radio`, `radar`, `ems`, `emsegt`, each with its own controller instance |
| Top bar | `plates/sidetop.html` | 13 slots that open a page |
| Bottom bar (soft keys) | `plates/sidebottom.html` | Entry point `softkey` event, see `top-bottom-bars.md` |
| Modals and alert popups | `index.html` (`ui-yield-to="modals"`, `#alertsModal`) | |

## 2. Pages that already support key navigation

A controller "supports" the keys when it registers a `keypad` listener that does something.

| Page | State | PREV / NEXT | TAP | Highlight | Gaps read in the code |
|---|---|---|---|---|---|
| `radio` | **Full** | Move across radios and their stops (MHz, kHz, volume, squelch, playback rows); in edit mode change the value | Enter or leave edit mode; play a recording | Row bar, button red = focused, green = editing | Reference implementation of the two-level model. Buttons other than the stops (swap, DUAL, Enabled, keypad digits) are touch only |
| `airfields` | **Full** | Move in the list | Direct to the airfield | Row bar | Sort toggle is touch only. Stops at both ends |
| `checklist` | **Full** | Move across items | Cycle the item status | Row bar | None found |
| `autopilot` | **Full**, to audit | Move across four header stops and the waypoints; with the HSI selected, turn the course by 1° | Toggle HSI edit; act on a waypoint | Row bar | 13 touch buttons; which ones the knob cannot reach was not audited |
| `hsi` | **Full** | Course −5° / +5° | Course back to 0 | None, one function only | None found |
| `synthview` | **Partial** | Orbit the camera left / right | Reset the view | None | Zoom in and out is bound to the raw names `MediaTrackNext` / `MediaTrackPrevious`, which never reach a plate (the service sends function names only): dead code. Cage AHRS is touch only |
| `timers` | **Partial, with bugs** | Move across timers, the clock and the create row | Start the selected timer, or create one | Row bar | Mode switch, −5, +5 and delete are touch only. `timerSelectPrev` has a comparison where an assignment is meant (`className == "keypadSelectedYes"`) and both select functions clear with the outer loop index (`timerId` instead of `timerId2`) |
| `camera` | **Partial** | Scroll across cameras | Create a camera when past the last one | Partial | Camera header (edit) and the second create button are not reachable. No `$state` check in the listener |
| `switchboard` | **Stub** | — | — | CSS ready (`.switchBoardButton.keypadSelectedYes`) | Listener registered, body commented out |
| home / `aircraft` | **Stub** | — | — | — | Listener registered, body empty |
| `sixpack` and the 8 single instruments | **Stub** | — | — | — | One shared listener in `SixPackInstruments.js`, body empty |
| `charts` | **Dead** | — | — | — | Listener defined, never registered. It names `KEYPAD_MAPPING_PREV_MEDIA` and `KEYPAD_MAPPING_NEXT_MEDIA`, which do not exist in RB-01: registering it as it is would throw on the first key |
| All others (`alerts`, `ems`, `emsegt`, `map`, `radar`, `resources`, `voice`, `ota`, all addons) | **None** | — | — | — | No listener |

### Findings in the shared path

These affect every page and are fixed in phase 0.

| Id | Finding | Read from | Effect |
|---|---|---|---|
| F1 | A page outside the navigation list of the current shape gets no `keypad` event: any key that is not a `directKey` sends the pilot to `#/`. | `servicekeypad.js`, `key` listener, final `else` | No knob on `ota`, on any addon, on `#/aircraft`; on Landscape and Portrait none on `hsi` and the single instruments; on Square none on `sixpack`, `autopilot`, `ems`, `camera`, `alerts`, `charts`. A page the pilot removes from the list in the settings addon loses the knob too |
| F2 | The browser path does not look at the event target. A key typed in an `<input>` or `<select>` is also a keypad key. | `fromKeyboardUpToKeypad` | Typing `1`, `2`, `3` in a camera URL or a settings field moves the selection; `a` and `b` change page. Text entry by keyboard is unusable on a page with a listener |
| F3 | The browser path never calls `preventDefault()`. | same | Arrow keys also scroll the page, Enter also activates whatever Chromium has focused |
| F4 | A sidebar copy of a plate registers its own `keypad` listener. `RadioCtrl` has no `$state` check, so the sidebar radio reacts to the knob on every page. | `radio.js` (the comment "For both copies of the plate" confirms two copies run), `index.html` | Two controllers act on one press; a hidden radio can be retuned from another page |
| F5 | Controllers dispatch `keypad` events with the keys `from` and `to` at the ends of a list. Nothing listens for them. | `airfields.js`, `autopilot.js`, `checklist.js`, `timers.js`, `radio.js` | Harmless today. They show the intent that a list end hands over to something; see D2 |
| F6 | `keyToFunction()` builds its table once and calls `forEach` on each of five lists. A `keypad.json` missing one list throws; an edit from the settings addon is not seen until reload. | `servicekeypad.js` | Already noted in `ALERTS-NAVIGATION-UI-PROPOSAL.md` |
| F7 | The same physical key has different names on the two paths (`A` from the Pi, `a` from Chromium), and one press may arrive twice when the keyboard is on the Pi that runs the kiosk. | `ALERTS-NAVIGATION-UI-PROPOSAL.md` N6, N7 | Not tested on hardware. A double TAP would toggle twice |
| F8 | (Wrong for `altimeter`, whose own `fabClick` sets the QNH; see Status.) The FABs on `altimeter`, `heading` and `gmetergauge` dispatch `DOM_CLICK_NC`, `DOM_CLICK_SC`, `DOM_CLICK_C`. No code handles these names. | `grep DOM_CLICK` finds only the dispatch in `main.js` | The buttons do nothing, and by F1 they send the pilot home on a shape where the page is not in the list |
| F9 | `test_keypad.py` fires the `keypad` event itself (`Display.keypad()`), after the service. | `test/display/plates.py` | The suite cannot see F1, F2, F3 or F4 |
| F10 | The F2 guard covers only the Chromium path and only while a field has focus. `main/keypad.go` forwards every key of the Pi's keyboard over `/keypad` with no target, and a key typed between fields is a knob key. Fixed 2026-11-19 for the settings addon only (owner): `keypadDisable(pageScope)` turns off both paths, holds included, until that scope is destroyed. Touch (the `DOM_CLICK_*` swipes) still goes through. | `servicekeypad.js` | Typing `b` on the Pi's keyboard sent the Pi's `B`, the radar's direct key: the pilot left settings and lost unsaved edits |

---

## 3. Proposal

### 3.1 Interaction model

One model on every page, the one `radio` already teaches the pilot:

1. **Browse.** PREV and NEXT move a single focus across the page's *stops*, in reading order.
   TAP activates the focused stop: the same action as a touch on it.
2. **Edit.** A stop that holds a value (frequency, QNH, volume, a `<select>`) is an *adjust* stop.
   TAP enters edit mode; PREV and NEXT change the value; TAP leaves edit mode.
3. **Direct.** A page with one obvious function and no list uses the knob for it at once, with no
   focus: `hsi` (course), `synthview` (orbit). These are listed per page below.

Rules:

- The focus stops at both ends of the list; it does not wrap (D2).
- No stop is focused when a page opens. The first PREV or NEXT focuses the first stop (NEXT) or
  the last (PREV); a TAP with no focus does nothing. A stray press on entry then changes nothing.
- The focus clears after 20 s without a key, as the soft key menu does after
  `SOFTKEY_MENU_SECONDS`. Edit mode ends with it (D4).
- Text fields are never stops. Text needs a real keyboard or the touch screen (D5).
- An action that touch protects with a confirmation keeps it; the dialog's buttons become the only
  stops while it is open.

### 3.2 Highlight

Two classes, defined once in `css/style.css`, replacing the per-page border variants over time:

| Class | Meaning | Drawing |
|---|---|---|
| `.keypadFocus` | Browse: this stop has the focus | `outline: 3px solid #ff0000; outline-offset: 2px` plus `box-shadow: 0 0 0 5px rgba(0,0,0,.6)` so it reads on any background. Red matches today's bar |
| `.keypadEdit` | Edit: the knob changes this value | Same shape in `#00c000`, as the radio's green button |

- An outline does not move the content, which the 3 px left border does (`Switchboard.css` works
  around exactly this).
- On focus, `scrollIntoView({block: "center", behavior: "instant"})`. Centre, not nearest: on the
  round 480×480 panel a stop at the top or bottom edge of the scroll area is cut by the circle.
- Colour is not the only cue: edit mode also shows a small `◄ ►` marker beside the value.
- `radio`, `airfields`, `checklist`, `autopilot` keep `keypadSelectedYes` until they migrate
  (phase 5); the pilot sees the same red on both.

### 3.3 Shared helper: `web/RB-01/js/keypadfocus.js`

Each stub today copies 15 lines of guard code. New pages do not write a listener; they mark their
template and create one helper.

Template:

```html
<div ng-repeat="item in switches" data-keypad="tap" ng-click="sendCommand($index)">…</div>
<select data-keypad="adjust" ng-model="ChartSelect" ng-change="reloadCharts()">…</select>
<span data-keypad="adjust" data-keypad-name="qnh">{{qnh}}</span>
```

Controller:

```js
const focus = new KeypadFocus($scope, $state, "switchboard", {
    // only for custom adjust stops; <select> and <input type=range> are built in
    adjust: { qnh: function (direction) { $scope.qnhStep(direction); } },
    // only for direct pages
    direct: null
});
```

Contract:

| Point | Behaviour |
|---|---|
| Stops | Collected at each key press: `[ui-view] [data-keypad]`, visible (`offsetParent !== null`, not `disabled`, not `ng-disabled`), in DOM order, or by `data-keypad-order` when present. Collecting at press time makes `ng-repeat`, `ng-if` and `ng-show` changes free |
| Scope | The selector starts at `[ui-view]`: a sidebar copy of a plate is never a stop (F4) |
| TAP on `tap` | `element.click()`, so `ng-click` runs as for a touch |
| TAP on `adjust` | Toggles edit mode |
| PREV / NEXT in edit | `<select>`: move `selectedIndex`, dispatch `change`. `<input type=range>`: `stepDown()` / `stepUp()`, dispatch `input`. Otherwise call `adjust[data-keypad-name](−1 or +1)` |
| Identity | The focused stop is remembered by element. If it left the DOM (list reloaded), the focus moves to the stop now at the same index, or the last one |
| Digest | All work inside `$scope.$evalAsync`, as the `softkey` listener does |
| Lifetime | Registers one `keypad` listener; removes it on `$scope.$on("$destroy")` and when `$state.current.name` is not its page. Not created when the controller runs in a sidebar (`init({isSidebar:true})`) |
| Test hook | `window.keypadFocusState()` returns `{page, index, count, mode, name}` for the tests |

The four full pages are not rewritten onto the helper in the first pass. They work, and `radio`
has knob logic the helper does not cover.

### 3.4 Per page proposal

Stops are listed in focus order. "Direct" means no focus, per rule 3 of 3.1.

| Page | Model | Stops and actions | Notes |
|---|---|---|---|
| home / `aircraft` | Browse, done 2026-11-18 | Each tile of `items[0]`, then `items[1]`. TAP = `goTo(item)` | Turns the home page into a knob launcher: with it, every page is reachable with three keys |
| `switchboard` | Browse, done 2026-11-18 | Each tile. TAP = `sendCommand($index)` | A tile drives hardware. Same single action as touch; the 20 s focus timeout and "no focus on entry" guard against stray presses. If a switch type needs a confirmation, it needs it for touch too: out of scope here. Read `voice-switchboard-trim-flaps.md` first |
| `altimeter` | Direct, done 2026-11-18 | PREV / NEXT = QNH −1 / +1 hPa. TAP = AUTO QNH (owner, instead of standard 1013) | F8: the action does not exist yet. Find how QNH is set today (top bar slot `qnh`, settings) before building; if there is no setter, this page drops to "nothing to operate" |
| `heading` | Direct, done 2026-11-18 (TAP = source, no bug exists) | PREV / NEXT = heading bug −1° / +1°, TAP = bug to current heading | Only if a heading bug exists in `SixPackInstruments.js`; otherwise nothing to operate |
| `gmetergauge` | Direct, done 2026-11-18 | TAP = reset G min / max | Only if the reset exists (the centre FAB suggests it was intended) |
| `sixpack`, `speed`, `attitude`, `turnslip`, `variometer` | None | Nothing to operate | Keep the keys inert. Do not invent a function |
| `synthview` | Direct, done 2026-11-18 | PREV / NEXT = orbit, as today. TAP = reset view, as today | Remove the dead `MediaTrackNext` / `MediaTrackPrevious` cases. Zoom and cage AHRS stay touch only: cage is not an action for a stray key |
| `timers` | Browse, done 2026-11-18 | Per timer: start/stop, mode, −5, +5, delete; then "Create new timer" | Replace the hand-written select functions (bugs in section 2) with the helper. Delete keeps its place last in the timer so NEXT, NEXT, TAP cannot hit it by habit |
| `camera` | Browse + edit, done 2026-11-18 | Each camera header (TAP = `cameraEdit`), then the two create buttons | Name and URL fields are not stops (D5) |
| `alerts` | Browse, done 2026-11-18 | Each row. TAP = replay its sound | When the alert popup of `ALERTS-NAVIGATION-UI-PROPOSAL.md` is built, TAP acknowledges first (3.5) |
| `charts` | Browse + edit, done 2026-11-18 | Chart `<select>` (adjust), KML, GPX, CSV, download | Delete the dead listener |
| `voice` | Browse, done 2026-11-18 | PRIMARIO, SECONDARIO, DISPLAY, Enable Audio | |
| `resources` | Browse, done 2026-11-18 | Each thumbnail. TAP = zoom; while zoomed, TAP = back and PREV / NEXT = previous / next image | |
| `map` | Direct, done 2026-11-18 (zoom) | PREV / NEXT = zoom out / in. TAP = centre on the aircraft, not built | `map.js` and `map.html` are LF. Pan stays touch only |
| `radar` | Direct, done 2026-11-18 | PREV / NEXT = range down / up, or altitude band narrower / wider. TAP = switch range / altitude band (owner, 2026-11-18) | Read `radar.js` for the range setter first |
| `ems`, `emsegt` | None | Nothing to operate | |
| `ota` | Browse, done 2026-11-18 (addon rows only, see open questions) | Tiles, then INSTALL / UPDATE of each row | Ground only. INSTALL needs a confirmation step for the knob if touch has none: propose it in the commit, do not add it silently |
| addon `vor` | Browse, done 2026-11-18 | TO/FROM, LOC / GS select, search; with the list open, each station row (TAP = `setFrequency`) | In-flight use, high value. The addon is not in the test fixture's `/addons`: append it to `d.srv.rest["/addons"]` before `with d:` |
| addon `magnetometer` | Browse, done 2026-11-18 | Mode, calibration, config, auto calibration, reset, GPS track offset | Reset and offset change the calibration: last in the order |
| addon `settings` | Keypad off, done 2026-11-19 (F10) | None | 51 inputs, many of them text. Ground use with a touch screen or a real keyboard. The owner chose the keypad off on the whole page until the pilot leaves it; touch is the way out |
| addon `example` | None, done 2026-11-18 (commented pattern) | | Add a commented `KeypadFocus` line as the pattern for addon authors |
| `airfields` | Done 2026-11-18, on the helper | Add the sort toggle as the first stop | Phase 5 |
| `autopilot` | Browse, done 2026-11-18 (stops chosen by the owner) | HSI (adjust, approach direction), HOME, the plan's waypoints, the airfields | Phase 5 |
| `radio` | Done 2026-11-17 | MHz, kHz, SWITCH FREQ. (TAP swaps), VOL, SQL per radio, then each recording | F4 guard and the fixes in Status. Timeout with the other pages |

### 3.5 Who owns the key

One press goes to exactly one owner. The order, first match wins:

0. A page that called `keypadDisable` (only the settings addon, F10): no key from either path
   goes anywhere until the page is left. Touch swipes are not keys and still work.
1. An alert popup on screen: TAP acknowledges (`ALERTS-NAVIGATION-UI-PROPOSAL.md` 4.4). Not built
   yet; leave the hook in the service where the `key` listener starts.
2. A modal: its buttons are the only stops.
3. `directKey` and the swipe functions: unchanged.
4. The routed plate inside `[ui-view]`: this plan.
5. Sidebar copies: never (D3).

The top and bottom bars are not knob stops. They get their own keys through the `softkey` event
(`top-bottom-bars.md` P1).

---

## 4. Summary: priority and cost

Cost is implementation plus its test: **S** up to half a day, **M** about one day, **L** two to
three days. Value is in-flight use first.

| Phase | Item | Priority | Cost | Why this place |
|---|---|---|---|---|
| 0a | Service: PREV / TAP / NEXT reach every page (F1); skip editable targets, `preventDefault` on mapped keys (F2, F3); rebuild the key table safely (F6) | **P0** | M | Without it nothing below works outside the navigation list |
| 0b | Test harness: real key and websocket paths (F9), section 6 | **P0** | S | Every later test depends on it |
| 0c | `keypadfocus.js`, the two CSS classes, sidebar guard (F4) | **P0** | M | Shared by all pages |
| 1 | home / `aircraft` | **P1** | S | Makes the knob a launcher |
| 1 | `switchboard` | **P1** | S | In-flight, CSS already there |
| 1 | `timers` (rewrite on the helper, fixes two bugs) | **P1** | M | In-flight, partly broken today |
| 1 | addon `vor` | **P1** | M | In-flight, touch targets are small |
| 2 | `map` | **P2** | S | Zoom without touching the screen |
| 2 | `radar` | **P2** | S | Range in turbulence |
| 2 | `alerts` | **P2** | S | |
| 2 | `altimeter` (QNH) | **P2** | S to M | M if the QNH setter must be written (F8) |
| 2 | `synthview` clean-up | **P2** | S | Removes dead code only |
| 3 | `camera` | **P3** | S | |
| 3 | `resources` | **P3** | S | |
| 3 | `voice` | **P3** | S | |
| 3 | `heading`, `gmetergauge` | **P3** | S each | Only if the function exists |
| 3 | addon `magnetometer` | **P3** | S | Mostly ground |
| 4 | `charts` | **P4** | S | Ground |
| 4 | `ota` | **P4** | S | Ground |
| 4 | addon `settings` | **P4** | L | Ground, text heavy |
| 5 | Migrate `airfields`, `checklist`, `autopilot` to the helper and the new classes; `autopilot` audit; `radio` guard only | **P3** | M | Consistency; no new function for the pilot |
| — | `sixpack`, `speed`, `attitude`, `turnslip`, `variometer`, `ems`, `emsegt`, addon `example` | none | 0 | Nothing to operate; covered by the inert-key test |

Total for phases 0 to 3: about 10 to 12 working days. Phase 4 adds 3 to 4, most of it the
settings addon.

## 5. Phase 0 in detail

### 5.1 `services/servicekeypad.js`

Replace the body of the `key` listener's function lookup. Behaviour, in order:

1. `directKey` match: unchanged.
2. `f = keyToFunction(event.key)`.
3. `f` is `SwipeLeft` or `SwipeRight`: needs the page in the list, as today. Outside the list, go
   to the first entry (today's behaviour for these two keys, kept).
4. `f` is PREV, TAP or NEXT: dispatch `keypad` **whether or not the page is in the list**.
5. `f` is undefined: do nothing. Delete the fallback that goes to `#/` (D1), with its
   `SPEAKING` / `VOICE` exceptions, which exist only to escape it.

`keyToFunction`: build the table with `(settings[fun] || []).forEach`, and drop the cache when
`$scope.keypadSettings` is replaced (the settings addon assigns it after a save).

Browser path (`fromKeyboardDownToKeypad`, `fromKeyboardUpToKeypad`):

- Return at once when `event.target` is an `<input>` (except `type=range`, `checkbox`, `button`),
  a `<textarea>`, a `<select>` or `isContentEditable`. Apply the same test on keydown, or a hold
  inside a field becomes `keypadHold`.
- Call `event.preventDefault()` on keydown and keyup when the key maps to a function or a
  `directKey`. Leave every other key alone, so browser shortcuts and text entry keep working.
- Fix the typo on reconnect: `removeEventListener("keyup", fromKeyboardDownToKeypad)` should name
  `keydown`.

Do not touch: the `voice` event, the `target` display filter, `keypadHold`, the rotary code.

### 5.2 Sidebar guard

In `radio.js`, the listener returns when the controller was created with `isSidebar` (D3). Check
how `init({isSidebar:true})` reaches the scope before choosing the test; `radar`, `ems` and
`emsegt` have no listener and need nothing.

### 5.3 What must not change

`test_keypad.py`, `test_radio.py`, `test_bars.py` and `test/integration/test_radio_dual.py` pass
before and after. Record the result of each before starting: several display suites have known
red checks, so compare against that baseline and not against green.

---

## 6. Test automation

All tests are display tests in `test/display/` (Python 3 and Chromium, fake backend
`rbserver.py`). `run.py` picks up every `test_*.py`. Add one line per new file to the table in
`test/display/README.md`.

### 6.1 Harness additions (phase 0b)

| Addition | Where | Purpose |
|---|---|---|
| `Display.key(name)` | `plates.py`, over the existing `Page.key()` in `cdp.py` | A real Chromium key press: the browser path, through the service |
| `Display.ws_key(name, status=0)` | `plates.py`, over `rbserver.push("/keypad", {...})` | The Pi path. Check that `/keypad` is a pushable socket in `rbserver.py`; it is in its socket list |
| `Display.focus()` | `plates.py` | Returns `window.keypadFocusState()` |
| `Display.focused(selector)` | `plates.py` | True when the element matching the selector, inside `[ui-view]`, has `.keypadFocus` or `.keypadEdit` |

Keep `Display.keypad()`: the old suite uses it.

Traps already met in this suite: selectors collide between the routed plate and the sidebar copy,
so prefix `[ui-view]`; `window=` is not the viewport, use `Emulation.setDeviceMetricsOverride` and
reload for an exact panel size; the `magnetometer` and `settings` addons are not in the `/addons`
fixture, `vor` is.

### 6.2 `test_keypad_service.py` (phase 0a)

| Check | How |
|---|---|
| The three functions reach a plate on every route of section 1, at each shape | For each route and each of 480×480, 1280×800, 800×1280: install a counting `keypad` listener, send `1`, `2`, `3` with `Display.key`, expect three events and an unchanged hash |
| Same through the websocket | `Display.ws_key` |
| A page outside the list no longer goes home on a mapped key | `#/ota`, `#/addons/vor`, and `#/hsi` at 1280×800 |
| Swipe keys still walk the list | `a` and `b`; compare with `navigation.json` |
| Typing in a field is not a keypad key | Focus the camera URL input, type `123ab` with real keys; the field holds `123ab`, no `keypad` event, hash unchanged |
| Mapped keys do not scroll | `ArrowDown` on a long page; `scrollTop` of `.scrollable-content` unchanged by the browser |
| A `keypad.json` missing one list does not throw | Override the REST answer for `/settings/keypad.json` |
| The sidebar radio ignores the knob | Open the left sidebar on `#/timers`, send NEXT, the sidebar radio's selection is unchanged |

### 6.3 `test_keypad_focus.py` (phase 0c, then one section per page)

Generic checks, run for every page that uses the helper, from a table
`(route, ready selector, expected stop count or minimum, [(stop index, effect check)])`:

| Check | Pass condition |
|---|---|
| No focus on entry | `Display.focus().index` is −1; TAP changes nothing (no POST recorded by `rbserver`, hash unchanged) |
| NEXT walks every stop once, in order | After n presses each stop was focused once; the order equals DOM order |
| Ends do not wrap | One more NEXT keeps the last stop; PREV from the first keeps the first |
| Exactly one highlight | `document.querySelectorAll(".keypadFocus, .keypadEdit").length` is 1 |
| The highlight is on screen and inside the circle | At 480×480, the focused element's box centre is within 240 px of the panel centre; at the other sizes it is inside the viewport |
| TAP equals touch | For each stop, the effect of TAP equals the effect of `Display.click_expr` on the same element: same request recorded by `rbserver`, same scope change, or same hash |
| Edit mode | On an adjust stop: TAP sets `.keypadEdit`, NEXT changes the value by one step, PREV restores it, TAP returns to `.keypadFocus` |
| Focus survives a data refresh | Push new data (`push_situation`, `/status`, the page's own socket); the focus stays on the same stop |
| Focus times out | After the timeout (shorten it through a test hook, do not sleep 20 s) no stop is focused |
| Leaving removes the listener | Go to another page, send NEXT, the first page's scope did not change and no JS error |
| No JS error | `d.js_errors()` empty across the section, filtered with `known.lookup` as `test_keypad.py` does |

Per page, the effect checks:

| Page | Specific checks |
|---|---|
| home | TAP on tile k goes to that tile's route |
| `switchboard` | TAP on tile k posts the same command as a click on it. No command after entry + TAP alone |
| `timers` | Start, mode, −5, +5, delete, create each do what the click does; delete is the last stop of its timer |
| addon `vor` | TO/FROM toggles; search opens the list; TAP on a station row posts its frequency. Run after the four known VOR plate bugs are counted in the baseline |
| `map` | NEXT raises the map zoom by one level, PREV lowers it, TAP recentres |
| `radar` | NEXT / PREV step the range, or after a TAP the altitude band, through its list and stop at both ends |
| `alerts` | With three alerts pushed, three stops; TAP plays that alert's sound (the audio element's `src`) |
| `altimeter` | NEXT raises QNH by 1 hPa and the needle moves accordingly; TAP gives 1013 |
| `camera` | Header TAP toggles edit; create adds a camera; the text inputs are never focused |
| `resources` | TAP zooms; TAP again returns; PREV / NEXT change the image while zoomed |
| `charts` | Edit mode on the select changes the chart and triggers one reload |
| `ota`, `magnetometer`, `voice`, `settings` | Generic checks plus one effect check per destructive stop |

### 6.4 Inert pages

Extend `test_keypad.py`'s `LISTENERS` to every route of section 1 and add: on `sixpack`, `speed`,
`attitude`, `turnslip`, `variometer`, `ems`, `emsegt`, the three functions through the real key
path cause no hash change, no request and no JS error.

### 6.5 Regression for the pages that already work

Before phase 5 touches them, write the current behaviour of `airfields`, `checklist`, `autopilot`
and `hsi` as tests through the real key path (`radio` is covered by `test_radio.py`). They must
pass before the migration and after it.

### 6.6 On hardware, by the owner

Not automatable here, and open since `ALERTS-NAVIGATION-UI-PROPOSAL.md`: the names the USB knob
reports through `main/keypad.go`, and whether one press arrives by both paths when the keyboard is
on the kiosk Pi (F7). If it does, add to the service a drop of the same function within 100 ms,
with a test that sends the key by both paths and expects one `keypad` event.

---

## 7. Decisions

All five agreed by the owner on 2026-11-15.

| Id | Question | Decision |
|---|---|---|
| D1 | An unmapped key on a page outside the navigation list sends the pilot home today (commented as a temporary workaround). Keep it? | Removed: an unknown key does nothing. `top-bottom-bars.md` B7 already had to work around it |
| D2 | At the end of a list: stop, wrap, or hand over to the next page (what the unused `from` / `to` events suggest)? | Stop. A knob turned too far must not change page. The `from` / `to` dispatches are deleted when each page migrates |
| D3 | May a plate in a sidebar be operated by the knob while another page is routed? | No. The routed plate owns the knob. Operating the sidebar radio from any page would need a visible "knob is on the sidebar" state: a separate proposal |
| D4 | Focus timeout | 20 s, focus and edit mode both end |
| D5 | Text fields with the knob (an on-screen character wheel)? | No. Touch or a real keyboard |

## 8. Files

| File | Change |
|---|---|
| `web/RB-01/services/servicekeypad.js` | Phase 0a |
| `web/RB-01/js/keypadfocus.js` (new), `web/RB-01/index.html` (script tag) | Phase 0c |
| `web/RB-01/css/style.css` | `.keypadFocus`, `.keypadEdit` |
| `web/RB-01/simulator.html` | Same script tag: the standalone simulator loads its own list |
| `web/RB-01/plates/*.html`, `addons/*.html` | `data-keypad` attributes, per page |
| `web/RB-01/plates/js/*.js`, `addons/js/*.js` | One `KeypadFocus` per page; delete stubs and dead listeners |
| `test/display/plates.py`, `test_keypad.py` | Harness, inert pages |
| `test/display/test_keypad_service.py`, `test_keypad_focus.py` (new) | Section 6 |
| `test/display/README.md` | Two rows |
| `web/settings/keypad.json` | No change. The mapping stays the only place that names hardware keys |
| `web/stratux.appcache`, `Makefile`, `ota/create_ota_package.sh` | Check whether they list RB-01 files by name before adding `keypadfocus.js` |
