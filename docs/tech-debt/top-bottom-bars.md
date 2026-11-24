# Top and bottom bars: redesign plan

Status: plan, 2026-11-10. Phase 1 is handed to an implementer; the roadmap phases are not
started. Owner: xiaprojects.

This plan replaces section 4.2 of
[ALERTS-NAVIGATION-UI-PROPOSAL.md](ALERTS-NAVIGATION-UI-PROPOSAL.md) (the always-visible 96 px
soft bar). The alert levels, popups and acknowledgement in that proposal are not changed here.

## Requirements

Set by xiaprojects:

| # | Requirement |
|---|---|
| R1 | At 480×480 both bars stay hidden, as today. |
| R2 | The top bar can be hidden to give its space back to the plate, as today. |
| R3 | The bottom bar can be hidden to give its space back to the plate, as today. |
| R4 | Buttons and information may be moved between the two bars. |
| R5 | Roadmap, not phase 1: an external keypad can operate the same functions, as on many avionics. |

## What is wrong today

Checked in this working tree (`web/RB-01/index.html`, `plates/js/bottom.js`,
`plates/sidebottom.html`, `css/style.css`, `js/main.js`).

| # | Finding |
|---|---|
| B1 | Each bar mixes information and controls. The top bar has two values (traffic, alerts) and three actions (left panel, right panel, full screen). The bottom bar has four values that are also page links. |
| B2 | A shown bar has no hide control of its own. The north and south FABs disappear while their bar is shown, so the only way back is the `+` tile, which also asks for full screen and hides both bars. |
| B3 | Tiles are 45–93 × 46 px and wrap, so a tile's position depends on the width and on the length of the values. |
| B4 | A value with no data shows `X`, and a value whose source has stopped keeps its last number. |
| B5 | The alerts count is read once when the bar is created and never again. |
| B6 | The 480 px rule only removes the FABs. A display with `uiSidebarTop=true` in `localStorage` still draws the bar at 480×480. |
| B7 | `fabClick('N')` and `fabClick('S')` also dispatch a `key` event (`DOM_CLICK_N`, `DOM_CLICK_S`). On a page outside the navigation list the keypad service answers any unknown key by going to `#/`, so toggling a bar there changes the page. |
| B8 | The controller reaches the main scope through `$scope.$parent.$parent`, and addresses tiles by array index (`itemsByPosition["top"][1]`). |
| B9 | When hidden, the FAB that reopens a bar fades to fully invisible after 10 s. |

## Design

### One rule: look up, touch down

- **Top bar: status.** Values the pilot reads. Fixed slots, always in the same place.
- **Bottom bar: soft keys.** Things the pilot presses. Six equal keys on the bottom edge, where a
  finger can brace on the bezel and where a physical key row can sit under the labels later (R5).

This is the layout the G3X Touch, SkyView HDX and G1000 share: a data bar on top and labelled
keys along the bottom edge.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ WIND KMH ALT ft UPTIME AGL ft TRK  AP     MAX G  COM     STBY    UTC   OIL °C TRAF ALERTS ▴│
│ 270°/28  4500   1018   1730   274° 268° ► 1.8    118.275 121.500 14:32 81     3    1      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                       plate                                          │
├──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬─────────┬───┤
│ ▔▔▔▔         │              │              │              │              │         │   │
│ SIXPACK      │ 3D           │ MAP          │ ENGINE       │ SWITCH       │ MENU    │ ▾ │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┴─────────┴───┘
```

### Top bar: status

Slots 1 to 13 changed on 2026-11-11 (xiaprojects): the first radio, the altimeter, AGL, oil
temperature and the autopilot were added.

WIND took the first place from the speed on 2026-11-23 (xiaprojects). The speed slot is kept,
hidden by default, for units with no airspeed sensor: see [Changing the top bar](#changing-the-top-bar).

| Slot | Group | Label | Value | Source | Tap opens | Drop order |
|---|---|---|---|---|---|---|
| wind | left | `WIND` with the pilot's speed unit, `WIND EST` when the ground speed stood in for a missing airspeed (`WindSource` `gs`) | `270°/28`: direction the wind blows from, true, three digits, `360` for north; then the speed. `---` with no estimate | `WindValid`, `WindDirection`, `WindSpeed`, `WindSource` that `services/windestimator.js` adds to `SituationUpdated` | `#/attitude` (wind arrow) | never |
| speed | left | `IAS` or `GS`, with the pilot's unit | Speed. **Hidden by default** (`TOP_BAR_SLOTS_HIDDEN`) | `SpeedKt`, `SpeedSource` from `SituationUpdated` | `#/speed` | never |
| alt | left | `ALT ft` or `ALT m` | Altimeter: `BaroPressureAltitude + 27 × (QNH − 1013.25)` ft, as the altimeter plate; `---` with no baro (`BaroSourceType` 0) | `SituationUpdated` | `#/altimeter` | never |
| uptime | left | `UPTIME` | Daemon uptime, H:MM; `---` 5 s after the status stops | `StatusUpdated` `Uptime` (ms) | `#/timers` | 3rd |
| agl | left | `AGL ft` or `AGL m` | Height above the terrain grid cell | `Terrain_AglFt` when `Terrain_AglValid`, `StatusUpdated` (main/terrain.go) | `#/synthview` | 7th |
| track | left | `TRK` | Track, `°` | `GPSTrueCourse` | `#/heading` | 4th |
| ap | left | `AP` | Bearing the autopilot steers to and `►`/`◄`, `OFF` when not engaged | `GPRMB.TrueBearing`, `GPRMB.Steer`, `AutopilotUpdated` (1 s, only with the autopilot setting on) | `#/autopilot` | 9th |
| gmax | left | `MAX G` | Peak load | `AHRSGLoadMax` | `#/gmetergauge` | 2nd |
| com | centre | `COM` | Active frequency of the first radio | `RadioUpdated[0].FrequencyActive` | `#/radio` | never |
| stby | centre | `STBY` | Standby frequency of the first radio | `RadioUpdated[0].FrequencyStandby` | `#/radio` | 5th |
| utc | centre | `UTC` | `HH:MM` | Browser clock | `#/aircraft` | 1st |
| voice | right | `VOICE` | Voice recognition: `ANSW` while rbvoice speaks its reply, `SPEAK` while the pilot speaks, `LISTNG` with the wake word on or after a push to talk, `MNUAL` when it waits for a push to talk, `---` before rbvoice publishes its keys. rbvoice has no end-of-reply event: `ANSW` lasts the reply length at 14 characters/s, 2 to 20 s | bridge keys `voice_wakeword`, `voice_trigger` (`BridgeUpdated`, `GET /bridge/float` once); `SPEAKING` and `VOICE` of the `voice` event (keypad socket) | `#/voice` | 1st (added 2026-11-22, the others drop one place later) |
| oil | right | `OIL °C` or `OIL °F` | Oil temperature | `oiltemperature` from `EMSUpdated` | `#/ems` | 8th |
| traffic | right | `TRAFFIC` | Targets heard in the last 60 s | `RadarChanged` | `#/radar` | 6th |
| alerts | right | `ALERTS` | All alerts, lamp until seen | `AlertsUpdated` (see below) | `#/alerts` | never |
| hide | right | `▴` | Hide the top bar | | | never |

- Dropping a slot never moves the others across the groups. With 13 slots fixed container
  queries cannot hold, because the values change length (`---`, `118.275`, `274° ►`): the bar
  measures itself and drops in `TOP_BAR_DROP_ORDER` (`plates/js/bottom.js`) until it fits, on
  every resize and once a second. `TopBarCtrl` shares its element with `ng-include`, which
  hands the controller a comment node, so the bar is found with `document.querySelector`.
- COM and STBY are selections, not measurements: the daemon sends the radios only when they
  change, so the bar asks `GET /radio` once and then keeps the last value.
- OIL goes to `---` when no EMS frame of any kind has come for 5 s. EMS frames are partial and
  the oil probe sends on change only, so the last oil value is kept while other frames come.
- AGL and AP go to `---` when their stream has been quiet for 5 s. AGL is also `---` whenever
  the terrain alerts are off (`Terrain_Enabled`), which is the default.
- **No data is shown as `---`**, never as `X` and never as an old number. WIND, speed, ALT, TRK
  and MAX G go to `---` when no `SituationUpdated` has arrived for 3 s.
- WIND needs an estimate from `windestimator.js`: an airspeed and a course change of 30-60°
  (source `tas`), or a heading from the AHRS in steady flight (`ias`, or `gs` without an airspeed).
  A unit with neither an airspeed sensor nor a magnetometer heading never gets one and reads
  `---`: show the speed slot there instead.
- **ALERTS** counts every entry of the last `AlertsUpdated` list, active or not: the alerts page
  shows them all. Its lamp is on while an alert has come, or has come back (inactive to active),
  since the pilot last opened `#/alerts`, and stays on even if that alert clears meanwhile. It
  takes the colour of the worst such alert, using the same severity the balloon uses
  (`alertMappingRow()` in `services/servicealerts.js`: `danger` red, `warning` amber). The unseen
  state lives in `AlertsService` (`alertsSeen()`, `alertUnseen()`), so it survives the bar being
  hidden; it is lost on a page reload, when the whole list counts as new again. This is not the
  acknowledgement of TD1 and TD2, which stays in the roadmap.
- Red and amber are used for the ALERTS lamp only. Values are white, labels grey.

### Changing the top bar

The slots are the `<a class="rb-slot" data-slot="…">` blocks of `web/RB-01/plates/sidetop.html`,
filled by `TopBarCtrl` in `web/RB-01/plates/js/bottom.js`. Slot names are the `data-slot`
values in the table above: `wind`, `speed`, `alt`, `agl`, `track`, `ap`, `gmax`, `com`, `stby`,
`utc`, `uptime`, `voice`, `oil`, `outsideTemperature`, `traffic`, `alerts`.

Each slot is drawn only while it is not in the list of hidden slots. That list is read when the
bar is created, so after changing it hide the bar with `▴` and show it again with the north FAB,
or reload the page.

**On one unit, no code change.** Set `localStorage.topBarSlotsHidden` in the kiosk browser to a
JSON list of slot names. It replaces the default list, so name every slot you want hidden;
`'[]'` shows them all. A value that is not a JSON list of strings is ignored and the default is
used. `localStorage` belongs to the browser and the origin: set it in the kiosk Chromium, which
loads `http://localhost/RB-01`, not from a laptop browsing to the unit's IP.

The kiosk Chromium is started with `--remote-debugging-port=9222`
(`image_build_rb/root/home/pi/display.sh`). From a computer on the unit's Wi-Fi:

1. `ssh -L 9222:localhost:9222 pi@192.168.10.1`
2. Open `chrome://inspect` in Chrome or Chromium, add `localhost:9222` under *Configure…*, and
   click *inspect* under the RB-01 page.
3. In the console, one of:

   ```js
   // Speed back in the first place, no wind (a unit with no airspeed sensor and no magnetometer)
   localStorage.topBarSlotsHidden = '["wind"]'
   // Both wind and speed
   localStorage.topBarSlotsHidden = '[]'
   // Wind, no speed, and no UTC clock
   localStorage.topBarSlotsHidden = '["speed", "utc"]'
   // Back to the default of the installed version
   localStorage.removeItem('topBarSlotsHidden')
   ```

4. `location.reload()`, or hide and show the bar.

The setting survives reboots and software updates (it lives in the Chromium profile of user
`pi`) and is lost if that profile is cleared.

**For every unit, in the code.**

| Change | Where |
|---|---|
| Which slots are hidden by default | `TOP_BAR_SLOTS_HIDDEN` in `plates/js/bottom.js`, today `["speed"]`. Units with `localStorage.topBarSlotsHidden` set keep their own list. |
| The order of the slots, or the group they are in | Move the `<a class="rb-slot">` block in `plates/sidetop.html`. Groups are `rb-status-left`, `rb-status-centre`, `rb-status-right`; a slot never moves across groups when others are dropped. |
| Which slots are dropped first when the bar is too narrow | `TOP_BAR_DROP_ORDER` in `plates/js/bottom.js`. A slot not in it is never dropped: keep that set small (today wind, speed, alt, com, alerts) or the bar no longer fits at 1024×600. |
| A new slot | Add a block in `sidetop.html` with a new `data-slot` and `ng-if="slotShown('<name>')"`, set `$scope.values.<name>` from a listener in `TopBarCtrl` (start it at `BAR_NO_DATA`), add the slot to the `slots` of its stream in `streams` so it goes to `---` when the stream stops, and to `TOP_BAR_DROP_ORDER` unless it must never be dropped. Add it to `SLOTS` in `test/display/test_bars.py`. |

RB-01 HTML and JS files are CRLF: keep the line endings when editing. `simulator.html` includes
the same `sidetop.html`, so it follows. After a code change run `test/display/test_bars.py`
(local only); T10 checks that the bar is still one row at 1280×800 with both side panels and at
1024×600. The bars are never drawn at 480×480 or 800×480, whatever the list says.

### Bottom bar: soft keys

Six keys of equal width, then a narrow hide key. The whole cell is the touch target.

| Slot | Root level | Menu level |
|---|---|---|
| 1 | `SIXPACK` → `#/sixpack`, `3D` → `#/synthview` (cycle); reading: QNH | `LEFT PNL` toggle, lamp when open |
| 2 | `MAP` → `#/map`, `AUTOPILOT` → `#/autopilot` (cycle); reading: ETA | `RIGHT PNL` toggle, lamp when open |
| 3 | `TIMERS` → `#/timers`; reading: first running timer | `TOP BAR` toggle, lamp when shown |
| 4 | `SWITCH` → `#/switchboard`, `ADDONS` → `#/addons` (cycle); reading: CPU load | `FULL SCR` toggle |
| 5 | `EMS` → `#/ems`, `EGT` → `#/emsegt` (cycle); reading: battery | `ALERTS` → `#/alerts` |
| 6 | `MENU` | `BACK` |
| end | `▾` hide the bottom bar | same |

- **Slot 6 never moves**: it enters the menu and leaves it. The menu returns to the root level by
  itself 10 s after the last press. A toggle keeps the menu open, so both panels can be set in one
  visit. A page key in the menu (`ALERTS`) returns to the root level.
- A page key shows a green lamp while its page is the current one. The lamp is a 4 px line on the
  top edge of the key, not the 16 px block on the left that today's tiles have.
- A key shows a pressed state while touched (`:active`), because a touch surface gives no other
  feedback (AC 20-175 §3-5).
- `FULL SCR` only enters or leaves full screen. It no longer hides the bars: the pilot who pressed
  it would lose the key they pressed.
- The keys of both levels are defined in **one table in the code**, one row per slot and level,
  with `label`, and `href` or `action`. Nothing addresses a key by array index.
- The five page keys were set by xiaprojects on 2026-11-11 (decision D1). The switchboard key is
  labelled `SWITCH` so the key font is not shrunk: `RIGHT PNL` and `AUTOPILOT` stay the longest labels.
- The root keys were changed by xiaprojects on 2026-11-17 to five page keys, three of them cycles; `EMS`/`EGT` added the same day.
  A cycle key has `pages` in place of `href`. Its label names the page shown now; from another page it names
  the page the key last showed. The first press opens that page and each press after it steps the cycle.
  The step is kept in `localStorage.softKeyPage_<level>_<slot>`. A slot with no row is drawn as an
  empty key, so `MENU` stays on slot 6.
- A key with `value` draws a reading under its label (`BottomBarCtrl`), `---` with no data:
  - `qnh`: `QNH 1013`, the `QNH` of the situation; `---` 3 s after the situation stops. It moved here
    from the top bar on 2026-11-17, where `UPTIME` took its slot.
  - `cpu`: `CPU 0.30`, `cpu_load_1m` of the EMS frames; `battery`: `13.4 V`, `batteryvoltage` of the
    EMS frames. Each is kept across the partial frames, and reads `---` 5 s after the EMS stops.
  - `eta`: UTC HH:MM of arrival at the active waypoint, from `GPRMB.Distance / GPRMB.Knots`. It reads
    `---` with the autopilot off, with no speed towards the waypoint, or after 5 s with no `AutopilotUpdated`.
  - `timer`: the first running timer of the list `TimersService` receives on `/timers/ws` (sent on
    connect and on every change, no polling; the bar counts the seconds). A countdown shows the time left,
    a chrono the time elapsed.

### Hiding and showing

| | Top | Bottom |
|---|---|---|
| Hide | `▴` at the right end of the bar | `▾` at the right end of the bar |
| Show | North FAB, same zone as today | South FAB, same zone as today |
| Also | `TOP BAR` in the menu | |
| State kept in | `localStorage.uiSidebarTop` | `localStorage.uiSidebarBottom` |
| Default | hidden | hidden |

- A hidden bar takes no space: the plate gets the full height, as today (R2, R3). A shown bar
  reserves its height; nothing is drawn under it.
- Hide and show are one function on the main scope, `toggleBar('top' | 'bottom')`, used by the
  FABs, the hide keys and the menu. It does not dispatch a `key` event (B7).
- When hidden, the north and south FABs fade as today but leave a **grip line** (about 64×4 px,
  low contrast, centred on the edge) so the place to touch stays marked (AC 20-175 §3-2, B9). The
  east and west FABs are not changed. Changed 2026-11-22 (xiaprojects): there is no grip line.

### 480×480 (R1)

One flag, `barsAllowed`, with today's rule (`window.innerHeight > 480`). It gates the two FABs
**and** the two bars, so a stored `uiSidebarTop=true` cannot draw a bar on the round panel (B6).
An 800×480 panel therefore has no bars either, exactly as today.

### Size and style

| | Top | Bottom |
|---|---|---|
| Height | `clamp(40px, 4vh, 52px)`: 40 px at 800 and at 600 | `clamp(56px, 9vh, 80px)`: 72 px at 800, 56 px at 600 |
| Key or slot width at 1280 | by content, minimum 72 px | 204 px |
| Key width at 1024 | | 161 px |
| Key width at 1280 with both side panels | | 204 px: the bars keep the full width, the panels open between them (2026-11-22) |

- Heights are CSS variables (`--rb-bar-top`, `--rb-bar-bottom`) so a real panel can be tuned in
  one place. `mobile-angular-ui` pads `.app-body` by a fixed 51 px for `.has-navbar-top` and
  `.has-navbar-bottom`: override both with the variables.
- Black background, a 1 px `#3a3a3a` line on the inner edge. Labels: capitals, grey `#b8b8b8`,
  12–13 px. Values: white, 22–24 px, `font-variant-numeric: tabular-nums` so digits do not shift.
  Lamp green `#00ff00`, as today.
- No wrapping, ever. A bar is one row.
- The physical panel sizes are not in this repository. At 8.5 px/mm (7 in, 1280×800) a 72 px key
  is 24×8.5 mm: wide enough, short of the 15 mm reference in height, acceptable on a bezel edge
  and to be checked on the real panel (roadmap P5).

### Where the old controls go

| Today | New place |
|---|---|
| Top: `TRAF NEAR` | Top slot `traffic` |
| Top: `LEFT PNL`, `RIGHT PNL` | Menu slots 1 and 2 |
| Top: `AL RM` | Top slot `alerts`, and `ALERTS` in the menu |
| Top: `+` (full screen, hides both bars) | Menu slot 4 `FULL SCR`; hiding is `▴` and `▾` |
| Bottom: `GS`/`IAS`, `MAX G`, `TRK`, `QNH` | Top slots `speed`, `gmax`, `track`, `qnh` |

## Phase 1: implementation

RB-01 HTML, CSS and JS files are CRLF (`map.js` and `map.html` are LF). Keep each file's line
endings. `simulator.html` duplicates the shell of `index.html`: change both.

| File | Change |
|---|---|
| `web/RB-01/index.html`, `simulator.html` | Top bar includes `plates/sidetop.html` with `TopBarCtrl`; bottom bar includes `plates/sidebottom.html` with `BottomBarCtrl`. Both `ng-if` on `barsAllowed && uiSidebar…`. FABs on `barsAllowed && !uiSidebar…`. Remove the commented-out old navbar. Link `css/bars.css`. |
| `web/RB-01/plates/sidetop.html` | The status bar (today a stub). |
| `web/RB-01/plates/sidebottom.html` | The soft keys. |
| `web/RB-01/plates/js/bottom.js` | Replace `BottomCtrl` with `TopBarCtrl` and `BottomBarCtrl`. Keep the unit conversion and the IAS/GS label logic. Remove every `$parent.$parent`. Remove all listeners and timers on `$destroy` (the bars are created and destroyed by `ng-if`). |
| `web/RB-01/js/main.js` | `barsAllowed`, `toggleBar()`, panel toggles on the main scope; `fabClick` N and S call `toggleBar` and dispatch nothing. |
| `web/RB-01/css/bars.css` (new) | Everything above. Remove `.rb-button-switch*` from `style.css` only if nothing else uses it. |
| `test/display/test_bars.py` (new) | See below. |
| `test/display/test_speed_source.py` | Its bottom-bar section reads the speed tile from `.navbar-absolute-bottom`; the tile is now top slot 1. |
| `docs/tech-debt/ALERTS-NAVIGATION-UI-PROPOSAL.md` | One line at 4.2 pointing here. |

Check before editing: whether the `Makefile` or any packaging list names the plate files, and
whether anything else listens for `DOM_CLICK_N` or `DOM_CLICK_S`.

### Keypad-ready without a keypad

Every soft key press, from touch today and from a key later, goes through one entry point:

```js
dispatchEvent(new CustomEvent("softkey", { detail: { slot: 3 } }));
```

The key table, the current level and the listener that runs the key in that slot live on the main
scope, not in `BottomBarCtrl`, so a key works when the bar is hidden; `BottomBarCtrl` only draws
the table. The touch handler dispatches this event and does nothing else. Phase 1 adds no key
mapping: that is P1.

### Tests

`test/display/test_bars.py`, local only like the other display tests, at an exact viewport
(`Emulation.setDeviceMetricsOverride`, then reload; `window=` is not the viewport).

| # | Check |
|---|---|
| T1 | 480×480 with `uiSidebarTop` and `uiSidebarBottom` set to `true` in `localStorage`: no bar, no north or south FAB. |
| T2 | 1280×800, default: no bar, both FABs. The plate area is the full height. |
| T3 | South FAB shows the bottom bar, the plate area shrinks by its height, `▾` hides it and the plate area is the full height again. The same for the top with `▴`. The state survives a reload. |
| T4 | Toggling a bar on a page outside the navigation list does not change the hash (B7). |
| T5 | Each root key opens its page and lights its lamp. `MENU` changes the labels, `BACK` restores them, and the menu returns by itself after 10 s. |
| T6 | `LEFT PNL`, `RIGHT PNL`, `TOP BAR` toggle what they name and their lamps follow. |
| T7 | A `softkey` event with a slot does what a touch on that key does, also with the bar hidden. |
| T8 | Top values follow the situation; they read `---` before any data and 3 s after it stops. |
| T9 | `ALERTS` follows `AlertsUpdated`: count of active alerts, lamp colour of the worst, off at 0. |
| T10 | At 1280×800 with both side panels open, and at 1024×600: both bars are one row, no key or slot is clipped or overlaps another, and the slots drop in `TOP_BAR_DROP_ORDER`, each only because it does not fit. |
| T11 | Showing and hiding both bars several times leaves one listener set (no doubled updates). |
| T12 | COM and STBY follow the first radio and stay; ALT is the baro altitude on the QNH, `---` with no baro; OIL keeps its value across EMS frames without it; AGL follows `Terrain_AglValid`; AP shows bearing and side, `OFF` when disengaged; OIL, AGL and AP read `---` 5 s after their stream stops. |

The display tests need a Chromium that the sandbox kills. If it cannot start, verify what can be
verified through `test/display/simulator.py --idle` and say plainly which checks were not run.

## Roadmap

| # | Phase | Content |
|---|---|---|
| P1 | **External keypad** (R5) | A `softKeys` table maps key names to slots, with `F1`–`F6` as the default and an optional override in `keypad.json`. The `key` listener in `services/servicekeypad.js` looks it up first and dispatches `softkey`; nothing else changes because touch already uses that event. Bind both spellings of a key (the Go path reports `A`, the browser `a`). A key toggles each bar. With the bar hidden, a key still works and its label is shown for a moment above its position, so the six keys are usable on the 480×480 panel, where the bar never appears. A six-key strip mounted under the display lines up with the six labels; the hide key is outside the grid for that reason. |
| P2 | Keys per installation | The key table moves to a settings file, per display kind (`Landscape`, `Portrait`), like `directKeyLandscape`. Defaults stay in the code so a unit with an old file keeps working. |
| P3 | Pages | A `PAGES` key in the menu opens a list of every page of the display's navigation list, operated by touch or by the knob. |
| P4 | Alert annunciator | The `ALERTS` slot becomes the annunciator of the alerts proposal: flashing until acknowledged, solid until cleared, first touch acknowledges. With the top bar hidden, the north grip line takes the alert's colour, so hiding the bar never hides an active alert. Depends on TD1 and TD2 of the alerts proposal. |
| P5 | Real panels | Measure the key height on each panel that ships, with gloves, and fix `--rb-bar-top` and `--rb-bar-bottom` per panel. |
| P6 | Knob | Knob hold opens the menu level, rotate moves a selection across the six keys, press runs it. |

## Decisions

| # | Decision | Default taken in phase 1 |
|---|---|---|
| D1 | Which five pages are on the root keys? | Taken 2026-11-11: `SIXPACK`, `3D`, `MAP`, `ENGINE`, `SWITCH` (the switchboard). Traffic and radio stay one tap away from the top bar (TRAFFIC, COM, STBY). |
| D2 | Should `FULL SCR` stop hiding the bars? | Yes. |
| D3 | Should the grip line stay visible on every plate, including the synthetic view? | Yes, low contrast. |
| D4 | Is a UTC clock wanted in the top bar, or local time? | UTC. |
