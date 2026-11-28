# Spoken Callouts: Bank, Speed Limits, Altitude, Low Speed

Plan for rank 1 of the agreed priorities (`docs/product/competitor-features.md`, "Voice
callouts wired to events"). The engine limit alerts in that rank are already done
(`main/ems.go` rules, `main/icing.go`). This plan covers the callouts about the aircraft
itself: bank, speed limits, altitude above ground, selected altitude and low speed.

**Status: plan, 2026-11-26. Nothing built yet. On by default; the owner reports back after
the flight test.**

## Owner's decisions (2026-11-26)

1. A new thread that runs at 2 Hz.
2. The thread reads `mySituation`.
3. It uses the simplest algorithm that can tell the current flight phase.
4. The alerts it raises are notifications only.
5. Each callout has its own event, but all of them play the same gentle sound.
6. The speed callouts can use the internal pitot sensor, an external airspeed source or GPS
   ground speed. The pilot chooses which one. On RB-01 the pilot is also the builder, so they
   know what the device is connected to.
7. Altitude callouts include a selected-altitude alert.
8. Bank threshold default: 45°.
9. Callouts go in the alert list and the flight log, like every other alert.
10. On by default. The owner will say after the flight test whether that stays.
11. Two levels of switch:
    - **`stratux.conf`:** one boolean that turns the whole function on or off.
    - **Each Chromium display:** three flags in that browser's storage, like
      `AUDIO_STATUS_GMETER`, which the pilot toggles from the Switchboard:
      `AUDIO_STATUS_UNUSUALATTITUDE`, `AUDIO_STATUS_AGL` and `AUDIO_STATUS_AIRCRAFTLIMITS`.

The rest of this document turns those points into code that matches what is already in the
tree.

## Design

### Where it lives

| Item | Where |
| --- | --- |
| The loop | `main/callouts.go`, `CalloutsStratuxPlugin`, built like `TerrainStratuxPlugin` and `IcingStratuxPlugin`: `InitFunc()` starts `ListenerFunc()`, a `time.NewTicker(500 * time.Millisecond)`, and `ShutdownFunc()` clears `enabled` |
| Start and stop | `main/gen_gdl90.go`: `callouts.InitFunc()` after `terrain.InitFunc()`, so it can read `Terrain_AglFt`. `callouts.ShutdownFunc()` goes next to `terrain.ShutdownFunc()` in `gracefulShutdown()` |
| Pure logic | `calloutsEvaluate(in calloutInput, st *calloutState, cfg calloutConfig, now time.Time) []calloutEvent`, with no globals, so the tests can drive it |
| Event types | `main/alerts.go`: `EVENT_TYPE_CALLOUT_*`, 30 to 37 (26 to 29 went to the core-function failure alerts of RB-HLR-ALR-150, 2026-11-27), with `EVENT_TYPE_COUNT` moved past the last one |
| Mapping | `web/settings/alertsMapping.json`: one row per type in `en-US` **and** `it-IT` (RB-HLR-ALR-070), each with `"Icon": "info"`, `"Sound": "callout"` and a new `"Group"` field naming its display flag (below) |
| Sound | `web/RB-01/sounds/callout.mp3` (what Chromium plays) and `callout.wav`: one gentle chime (below) |
| Daemon switch | `globalSettings.Callouts_Enabled` in `stratux.conf`, plus `Callouts_BankDeg` and `Callouts_SpeedSource` |
| Display switches | three `localStorage` flags. Switchboard: `switchBoardHelperGet()` / `switchBoardHelperToggle()` in `web/RB-01/plates/js/switchboard.js`. Settings page: `$scope.audioFlags` in `web/RB-01/addons/js/settings.js` |
| Display playback | `raiseAlert()` in `web/RB-01/services/servicealerts.js` |
| Aircraft limits | `aircraft.json` `"callouts"` block |
| Selected altitude | set on the HMI, posted to `/bridge/float` as `selected_altitude_ft` next to `qnh` |
| Status | `globalStatus.Callouts_Phase` and `Callouts_SpeedInUse`, which `/getStatus` serves and the flight log records |
| Tests | `main/callouts_test.go`, `alerts_test.go`, a display test for the flags |
| Docs | this file, `docs/settings-reference.md`, `docs/http-api.md` (the status fields, `selected_altitude_ft`) |

### One cycle (every 500 ms)

1. **Read** (`readSituation()`): take each mutex once, copy the fields, unlock.
   - `muAttitude`: `AHRSRoll`, plus `isAHRSValid()` (attitude under 1 s old and a GPS fix).
   - `muGPS`: `GPSGroundSpeed` (kt), `GPSAltitudeMSL`, `isGPSValid()`,
     `isGPSGroundTrackValid()`, `GPSLastFixLocalTime`.
   - `muBaro`: `BaroPressureAltitude`, `BaroVerticalSpeed`, `BaroSourceType`, `isTempPressValid()`.
   - Airspeed: `IndicatedAirSpeed` (kt), valid when it is above 0 and
     `PitotLastMeasurementTime` is under 2 s old. The `/bridge/float` path
     (`main/managementinterface.go`, `ias_mps`) sets `IndicatedAirSpeed` without a time, so a
     bridge that stops sending leaves the last value in place. This work makes it set
     `PitotLastMeasurementTime` too, so the same 2 s rule covers both sources.
   - `addonsBridge.bridgeFloatData`: `qnh` (hPa) and `selected_altitude_ft`, under
     `bridgeDataMutex`, as `makeRBAIRString()` reads them.
   - `globalStatus.Terrain_AglFt` / `Terrain_AglValid` (`main/terrain.go`).
   - `globalStatus.Terrain_State`, which is used only to keep callouts quiet during a terrain alert.
2. **Phase** (`calloutsPhase()`): the state machine below.
3. **Evaluate**: each callout checks its condition, its debounce, its hysteresis and its
   repeat interval.
4. **Notify**: at most one `alerts.pushEvent()` per cycle. Then publish `Callouts_Phase` and
   `Callouts_SpeedInUse`.

Vertical speed is chosen the way `terrain.go` chooses it: `BaroVerticalSpeed` only from a
BMP280 or an OGN tracker. Otherwise the slope of the GPS altitude over the last 5 s, because
`$PGRMZ` and ADS-B baro leave `BaroVerticalSpeed` stale. `GPSTurnRate` is not used: it reads
0 while an IMU is connected.

### Flight phase: the simplest algorithm

The callouts only need to know whether the aircraft is on the ground, has just taken off,
is flying normally or is on approach. Five states, worked out from ground speed, AGL and
vertical speed, with time filters so that one bad GPS fix does not change the phase:

```
          GS >= 45 kt for 5 s                AGL >= 1000 ft, or 120 s airborne
 GROUND ───────────────────────► TAKEOFF ──────────────────────────────► ENROUTE
   ▲                                │                                    │   ▲
   │ GS < 45 kt for 10 s            │ GS < 45 kt for 10 s                │   │ VS > +300 fpm for 5 s
   │ (from any airborne state)      ▼                                    ▼   │ or AGL > 1500 ft
   └──────────────────────────── (GROUND)        AGL < 1000 ft and VS < -300 fpm for 5 s
                                                                         │
                                                                         ▼
                                                                     APPROACH
 UNKNOWN: no valid GPS fix. Every callout is quiet. The machine restarts from GROUND when
 the fix comes back, so a fix lost in the air does not trigger a takeoff callout.
```

- **Airborne threshold:** 45 kt ground speed, the terrain function's value. When
  `Terrain_Alerts_MinSpeedKmh` is set, that value is used here too, so the two functions
  never disagree about whether the aircraft is on the ground. IAS is not used for this,
  because many installations have no pitot sensor.
- **AGL:** `Terrain_AglFt` while `Terrain_AglValid` is true. Otherwise the height above the
  altitude recorded when the machine left GROUND (baro when valid, else GPS MSL). Without
  either, TAKEOFF ends after 120 s and APPROACH is never entered, so the 500 ft call stays quiet.
- **Go-around:** climbing out of APPROACH goes back to ENROUTE, and the 500 ft call is armed
  again for the next approach.

`Callouts_Phase` is published every cycle, so the replays can check the phase sequence
against the recorded flights.

### The callouts

| Event type | Title (en-US) | Display flag | Condition (default) | Clears / re-arms when | Repeat | Phases where it can sound |
| --- | --- | --- | --- | --- | --- | --- |
| `EVENT_TYPE_CALLOUT_BANK` (30) | Bank angle | `AUDIO_STATUS_UNUSUALATTITUDE` | \|roll\| ≥ 45° for 2 cycles (1 s), AHRS valid | \|roll\| < 40° | 10 s while it holds | TAKEOFF, ENROUTE, APPROACH |
| `EVENT_TYPE_CALLOUT_VNO` (31) | Speed, caution range | `AUDIO_STATUS_AIRCRAFTLIMITS` | speed ≥ `vnoKt` for 2 cycles | speed < `vnoKt` − 3 kt | once until it clears | all airborne |
| `EVENT_TYPE_CALLOUT_VNE` (32) | Overspeed | `AUDIO_STATUS_AIRCRAFTLIMITS` | speed ≥ `vneKt` for 1 cycle | speed < `vneKt` − 3 kt | 5 s while it holds | all airborne |
| `EVENT_TYPE_CALLOUT_LOW_SPEED` (33) | Low speed | `AUDIO_STATUS_AIRCRAFTLIMITS` | speed ≤ `lowSpeedKt` for 2 cycles | speed > `lowSpeedKt` + 3 kt | 5 s while it holds | TAKEOFF (above 100 ft AGL), ENROUTE, APPROACH (above 100 ft AGL) |
| `EVENT_TYPE_CALLOUT_ALT_500` (34) | Five hundred | `AUDIO_STATUS_AGL` | AGL crosses 500 ft going down | leaving APPROACH | once per approach | APPROACH |
| `EVENT_TYPE_CALLOUT_ALT_1000` (35) | One thousand | `AUDIO_STATUS_AGL` | AGL crosses 1000 ft going up | landing (GROUND) | once per flight | TAKEOFF |
| `EVENT_TYPE_CALLOUT_ALT_SELECTED` (36) | Approaching selected altitude | `AUDIO_STATUS_AGL` | 1000 ft to go, moving towards it (VS at least 300 fpm in its direction) | the selected altitude changes, or 1500 ft away | once per approach to it | TAKEOFF, ENROUTE |
| `EVENT_TYPE_CALLOUT_ALT_DEVIATION` (37) | Altitude deviation | `AUDIO_STATUS_AGL` | after capture (within ±200 ft for 10 s), more than 200 ft away for 2 cycles | back within ±150 ft, or the selected altitude changes | once until it clears | ENROUTE |

Rules that apply to all of them:

- **The speed comes from the source the pilot chose** in `Callouts_SpeedSource`:

  | Value | Speed used | Without it |
  | --- | --- | --- |
  | `IAS` (default) | `IndicatedAirSpeed`: the internal MS4525DO pitot sensor or an external source on `/bridge/float`, whichever the build has | rows 31 to 33 are quiet |
  | `IAS_GPS` | IAS while it is valid, GPS ground speed when it is not | quiet without both |
  | `GPS` | GPS ground speed, always, even when an IAS is present | quiet without a valid GPS ground track (`isGPSGroundTrackValid()`) |

  Each cycle `Callouts_SpeedInUse` shows the speed actually used: `IAS`, `GPS` or `NONE`.
  The flight log records it, so a replay shows which source raised each callout. The limits
  in `aircraft.json` are compared with whichever speed is in use. The daemon does not change
  them for GPS. Choosing GPS is the builder's decision, and they set limits that suit it.
  Ground speed differs from airspeed by the wind: a 25 kt headwind on approach hides 25 kt of
  a real low-speed condition, and a tailwind raises a false one. The settings page says so
  next to the option.
- **Low speed below 100 ft AGL is inhibited** in TAKEOFF and APPROACH, so the flare and the
  rotation do not set it off. Without a valid AGL, low speed is inhibited for the whole of
  TAKEOFF and APPROACH.
- **Quiet during terrain alerts:** nothing is raised while `Terrain_State` is `CAUTION` or
  `WARNING`. This is the priority-5 row of the sound table in `terrain-alerts.md`, without
  the arbiter.
- **One event per cycle, and at least 2 s between two callouts.** When two are due together,
  the higher row in this order goes first: VNE, low speed, bank, VNO, altitude deviation,
  selected altitude, 500 / 1000 ft. The other waits for the next free slot. An altitude call
  that is more than 3 s late is dropped.
- **A missing limit means that callout is off.** `vnoKt`, `vneKt` and `lowSpeedKt` have no
  defaults. An aircraft without them in `aircraft.json` gets no speed callouts. The values
  come from the aircraft's POH, never from a generic aircraft.

### Selected altitude

There is no altitude bug today. This work adds one:

- **Setting it:** the pilot sets it on the altitude tape of the attitude and sixpack plates,
  by touch and with the knob, in 100 ft steps, the way the QNH is adjusted
  (`keypadfocus.js` `adjust`). It is shown as a bug on the tape and as a number above it.
  "Off" (no selected altitude) is a valid choice and is where it starts.
- **Reaching the daemon:** the HMI posts it to `/bridge/float` as `selected_altitude_ft`, as
  it already posts `qnh`. It is not kept across a reboot, the same rule as the QNH (owner
  decision of 2026-11-24). 0 or a missing key means off, and rows 36 and 37 are quiet.
- **Altitude it is compared with:** the indicated altitude, worked out like the HMI's
  altimeter from `BaroPressureAltitude` and the posted `qnh`. Without a valid baro or a QNH
  in 850 to 1100 hPa (the `$RBAIR` rule), it uses `GPSAltitudeMSL`, and the status shows
  that the GPS was used.
- **Several displays:** the last value posted wins. Every display shows the daemon's value,
  read back from the bridge, so two displays never show different bugs.

### Notifications only

Each callout is a one-shot event. The `Alert` comment in `main/alerts.go` describes this:
`Active` is always false, and the event is never updated or closed.

```go
alerts.pushEvent(Alert{Type: EVENT_TYPE_CALLOUT_BANK, Title: "Bank angle", Timestamp: now, Active: false})
```

What this gives:

- a line in the alert list, as with every other alert (owner decision 9);
- one `raise` row in the flight log's alerts table, so the replays can count callouts from
  the `.sqlite` files;
- the event on the `alertUpdate` socket to every display, which plays the sound and shows
  the balloon if its flag allows (next section).

What it does not do: there is no active alert, nothing to acknowledge and no annunciator.
`raiseAlert()` does not light the bell (`alarmIsLit`) for a row with a `Group`, because a
callout is not something the pilot has to go back and look at.

**Alert list space.** `EVENT_MAX_QUEUE` is 100, and when it is full the oldest events are
dropped, active or not (RB-HLR-ALR-220). The repeat intervals above cap a steep turn at 6
events a minute. Aerobatics (I-RVDX flies them) can still push real alerts out of the list.
A display flag does not prevent this, because it only silences that display: the daemon
still raises the event. For an aerobatic flight, the pilot turns `Callouts_Enabled` off or
raises `Callouts_BankDeg` to 60°. The replay of an aerobatic flight measures how much of the
list is used.

### The switches

**Daemon (`stratux.conf`).** `Callouts_Enabled` turns the whole function on or off. When it
is off, the phase is still worked out and published, but nothing is raised. That keeps the
replays and the status useful.

**Each display (Chromium `localStorage`).** These flags are like the existing
`Display_Audio_*` ones. They belong to one browser, so the round panel and a tablet can
differ:

| Switchboard toggle | `localStorage` key | Callouts it governs |
| --- | --- | --- |
| `AUDIO_STATUS_UNUSUALATTITUDE` | `Display_Audio_UnusualAttitude_Enabled` | bank (30) |
| `AUDIO_STATUS_AGL` | `Display_Audio_Agl_Enabled` | 500, 1000, selected altitude, altitude deviation (34 to 37) |
| `AUDIO_STATUS_AIRCRAFTLIMITS` | `Display_Audio_AircraftLimits_Enabled` | VNO, VNE, low speed (31 to 33) |

- **Default on.** `localDisplayGetFlag()` returns `false` for a key never written, which would
  make the three flags off on every display that has not been through the settings page. They
  are read as `localDisplayGetFlag(key) != "false"`, so a missing key means on (owner
  decision 10).
- **Off on a display** means no sound and no balloon *on that display*. The event is still in
  the shared alert list and the flight log.
- **Independent of `Display_Audio_Alerts_Enabled`.** That flag keeps governing the other
  alerts. A callout sounds when its own flag is on, whatever the Alert Sounds flag says.
- **The mapping names the flag.** Each callout row gets `"Group": "AUDIO_STATUS_UNUSUALATTITUDE"`
  (or the AGL / limits one). `raiseAlert()` looks the toggle up in one table that maps toggles
  to keys, and the Switchboard and settings page use the same table. Go's `EventHolder` gains
  the `Group` field too (next point). A new callout type only needs its mapping row.
- **Switchboard.** `switchBoardHelperGet()` and `switchBoardHelperToggle()` get the three new
  cases. While doing that, the five cases are moved to the shared table, which removes the
  repeated `if` blocks and makes a missing key read as on for the callout flags. The pilot
  adds tiles of type 5 ("Display toggle") with these names, as for `AUDIO_STATUS_GMETER`.
  `$scope.audioFlags` in the settings page gets the three rows, so the flags can also be set
  there.

**Who plays the sound.** The display, not the daemon. A per-browser flag can only silence
what that browser plays, so `pushEvent()` does not start `aplay` for a mapping row that has
a `Group`, even with `Audio_Enabled` on. Without this, the daemon's speaker would ignore the
Switchboard. The consequence: with no display connected, callouts are raised and logged but
make no sound. On RB-01 the kiosk Chromium is always connected, and the "avionics
malfunction" balloon already covers a lost link.

**Overlap on a display.** `raiseAlert()` plays every sound through the one `audioproxy`
element, and setting a new `src` cuts the one playing. A callout is therefore not played
while `audioproxy` is playing a sound that is not a callout (`!paused && !ended`). Its
balloon still shows. Other alerts keep cutting whatever plays, callouts included.

### One gentle sound

All the callout rows in the mapping point at `"Sound": "callout"`. The file is a soft
two-tone chime (about 0.4 s, falling major third, around 880 to 700 Hz, sine with a 20 ms
fade in and out, peak at -12 dBFS), made with `sox`, so it has no licence question. It is
committed as `.mp3` (what Chromium plays) and `.wav`, like the other sounds.

**Trade-off to note:** with one sound for everything, the pilot has to look at the display
to know which callout it was. That is the opposite of what a spoken callout is for. The
mapping keeps this a data-only change: replacing `"callout"` with a per-event file (for
example `EVENT_TYPE_CALLOUT_BANK`, recorded like the terrain sounds and their `_IT`
versions) gives real speech without touching the code. This plan builds the chime first,
as asked.

### Settings

In `stratux.conf` (`/getSettings`, `/setSettings`, the settings page):

| Setting | Default | Meaning |
| --- | --- | --- |
| `Callouts_Enabled` | **true** | The whole function. When off, the phase is still published and nothing is raised |
| `Callouts_BankDeg` | 0 (= 45°) | Bank threshold, 30 to 60°. Re-arms 5° below |
| `Callouts_SpeedSource` | `IAS` | Where the speed callouts get the speed: `IAS`, `IAS_GPS` or `GPS` (table above). Any other value reads as `IAS` |

In each browser, the three flags above, default on.

Aircraft limits go in `web/settings/aircraft.json`, in knots, next to `bestGlide`. They are
compared with the speed in use (`Callouts_SpeedSource`):

```json
"callouts": {
    "vnoKt": null,
    "vneKt": null,
    "lowSpeedKt": null
}
```

The daemon reads `aircraft.json` when it starts, and again when its modification time
changes, so an edit from the HMI takes effect without a restart.

## Requirements (draft)

| Id | The system shall | Verification |
| --- | --- | --- |
| CAL-010 | Evaluate the callouts every 500 ms in the daemon, with no display connected | Test |
| CAL-020 | Classify the phase as UNKNOWN, GROUND, TAKEOFF, ENROUTE or APPROACH with the transitions and filters above, and publish it in `Callouts_Phase` | Test, replay |
| CAL-030 | Keep every callout quiet in GROUND and UNKNOWN | Test |
| CAL-040 | Raise each callout as a one-shot event of its own type, `Active` false, kept in the alert list and the flight log | Test |
| CAL-050 | Map every callout type to the same sound, `callout`, and to its display flag (`Group`), in every language | Inspection, test |
| CAL-060 | Raise a speed callout (VNO, VNE, low speed) only from a valid speed of the source chosen in `Callouts_SpeedSource`, and only when its limit is set | Test |
| CAL-070 | Apply the debounce, hysteresis and repeat interval of each row | Test |
| CAL-080 | Raise at most one callout per cycle and leave at least 2 s between two of them | Test |
| CAL-090 | Raise no callout while `Terrain_State` is CAUTION or WARNING | Test |
| CAL-100 | Inhibit low speed below 100 ft AGL in TAKEOFF and APPROACH, and for the whole of both phases without a valid AGL | Test |
| CAL-110 | Raise nothing while `Callouts_Enabled` is off, and still publish the phase | Test |
| CAL-120 | Publish the speed used in each cycle (`IAS`, `GPS` or `NONE`) in `Callouts_SpeedInUse`, and with `IAS_GPS` fall back to GPS only while the IAS is not valid | Test |
| CAL-130 | Raise the selected-altitude callouts only while a selected altitude is set, against the QNH-corrected baro altitude, or GPS MSL without one | Test |
| CAL-140 | Not play a callout sound from the daemon (`aplay`), whatever `Audio_Enabled` says | Test |
| CAL-150 | On a display, play the callout sound and show its balloon only while that display's flag for the callout's group is on, with a missing flag read as on | Display test |
| CAL-160 | On a display, not cut a non-callout sound that is playing to play a callout | Display test |

They stay in this document until the owner decides whether callouts join the certified
core. If they do, they move to `requirements/RB-HLR-CAL.md` and are traced with
`Covers:` tags (`scripts/trace.py`).

## Delivery steps

1. **Phase.** `main/callouts.go` with the loop, `readSituation()`, `calloutsPhase()`, the
   status fields and the settings. No events yet. Replay the recorded flights and check the
   phase sequence by hand against the GPS track.
2. **Events, mapping and sound.** Event types 30 to 35, the mapping rows in both languages
   with `Group`, `callout.mp3`/`.wav`, `calloutsEvaluate()` with its unit tests, and no
   `aplay` for grouped rows in `pushEvent()`.
3. **Display flags.** The shared toggle table, the three Switchboard toggles, the settings
   page rows, and the `raiseAlert()` changes (flag, no bell, no cut). Display test.
4. **Selected altitude.** The bug on the tape, the knob and touch, `selected_altitude_ft` on
   the bridge, and rows 36 and 37 with their tests.
5. **Replay counts.** Run every recorded flight (`~/Desktop/win10/`, the replay fixture) and
   count the `raise` rows of each type per flight hour. Set the thresholds and the repeat
   intervals from the counts. Target: under 2 nuisance callouts an hour in normal
   cross-country flight.
6. **Bench and flight test.** Bench check that each flag silences only its own callouts and
   only on its own display, and that a callout never cuts a terrain sound. Then the flight
   test, with everything on by default. The owner decides afterwards whether the default stays.
7. **Later, not in this plan:** a recorded voice per event (data only); pitch extremes (nose
   high or low) under `AUDIO_STATUS_UNUSUALATTITUDE`; VFE once the flap position is known
   (`voice-switchboard-trim-flaps.md`); GPS ground speed corrected by the wind estimate,
   which means moving `services/windestimator.js` into the daemon; the shared sound arbiter
   (TER-400).

## Verification

- `main/callouts_test.go`, table-driven over `calloutsEvaluate()` and `calloutsPhase()`:
  - each row of the callout table (raise, debounce, hysteresis, repeat);
  - every phase transition with its filter, the GPS lost and found in the air, go-around,
    no AGL;
  - terrain priority, the 2 s spacing and its order, `Callouts_Enabled` off;
  - every speed source: `IAS` with and without a valid IAS, `IAS_GPS` falling back to GPS
    and back again, `GPS` ignoring a valid IAS, a stale `/bridge/float` value, and an unknown
    setting value read as `IAS`;
  - selected altitude: off, approaching from below and above, capture, deviation, change of
    the selected value, no QNH (GPS used).
- `alerts_test.go`: every `EVENT_TYPE_CALLOUT_*` has a row in both languages with sound
  `callout` and a known `Group`, and `pushEvent()` starts no `aplay` for it.
- A display test (`test/display/`, run locally and serially): each flag silences only its
  own group, a missing key reads as on, the Switchboard toggle flips the key, no bell for a
  callout, a callout does not cut a playing alert sound.
- Replays of the flights of 2026-10-25, 2026-11-20 and 2026-11-21: phase sequence and
  callout counts. The 2026-10-25 aerobatics give the worst case for bank and list space.
- `make check` green (`go vet`, `go test`, trace).

## Known limits and risks

- **Bank comes from the AHRS.** The 0.75× bank error in steady turns found on the
  2026-11-20 flight (RMC and VTG giving two GPS stamps) is fixed in `main/gps.go`: VTG is no
  longer parsed (commit `1984da52`, `TestNMEAVTGIsIgnored`). No flight has confirmed it yet,
  so bank should be checked against GPS in steady turns on the flight test. The AHRS also
  needs a GPS fix (`isAHRSValid()`), so bank is quiet without GPS.
- **Speed callouts are only as good as the chosen source.** With `IAS`, the internal pitot's
  `AirspeedScale` has not been measured in flight yet, so its IAS is uncalibrated until it
  is. An external source on `/bridge/float` is as good as the builder's sensor. With `GPS`,
  the wind error described above is the builder's choice, made knowingly. The pilot
  documentation must say that GPS speed callouts are not airspeed callouts.
- **AGL from the display grid** reads summits up to 755 ft low (`terrain-alerts.md`). Near
  a field this matters less, because fields lie in flat cells, but the 500 ft call can be off
  by a grid cell's error. With no grid it falls back to height above the takeoff point,
  which is wrong when landing somewhere else.
- **No sound without a display.** The daemon does not play callouts, so they depend on a
  connected browser with its flag on. That is what makes the per-display flags work.
- **On by default, with limits unset.** With `Callouts_Enabled` on and `aircraft.json` limits
  unset, a new installation gets bank and altitude callouts, and no speed callouts until the
  builder enters the POH values.
- **No audio arbiter.** The 2 s spacing and the no-cut rule keep callouts from overlapping
  each other and other alert sounds on one display. They do not stop the daemon's `aplay`
  (terrain, other alerts) and a browser callout from sounding together on the same speaker.
  The arbiter in `terrain-alerts.md` (TER-400) solves this for everything, and it stays a
  separate piece of work.
- **Advisory only.** Like terrain, a callout that does not sound is not proof of a safe
  condition. This goes in the pilot documentation.
