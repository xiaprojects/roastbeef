# Software High-Level Requirements — Alerts (`ALR`)

Function: notice that something has failed, classify it, and tell the pilot — on the
display, in the alert list, and through the aircraft's audio.

This is the function FHA-ALR-1 names, and the FHA leans on it harder than on any other:
it is what turns FHA-ATT-3, FHA-ALT-3, FHA-SPD-4, FHA-HDG-2 and FHA-TRF-2 from Major
into Minor, and therefore what makes the numerical safety case close at all
([`../docs/certification/fha.md`](../docs/certification/fha.md) §3 item 3). A failure of
the alert function is not an inconvenience; it is the failure of the mitigation every
other row is classified under.

Recovered from `main/alerts.go` (`pushEvent()`, `pushEventByIdent()`, `InitFunc()`),
`main/ems.go` (`validateRules()`, `checkFeed()`),
`main/gen_gdl90.go` (`addSingleSystemErrorf()`, `removeSingleSystemError()`),
`main/managementinterface.go` (`/getAlerts`, `/alerts`, `/alerts/ws`, `/alert`, `/alert/`) and the display's
`web/RB-01/services/servicealerts.js` and `web/RB-01/plates/js/alerts.js`, under
DO-178C §12.1.4. Rules and field definitions:
[`../docs/certification/standards/requirements.md`](../docs/certification/standards/requirements.md).

**Read this before the rest of the file.** Nine of these 34 requirements are in
`untraced.txt`, and not one of them is there because nobody has got round to the test:
each is a requirement the equipment does **not** meet today. The alert function was
written as a convenience feature — a notification bell and a sound — and these
requirements are what it has to become to carry the weight the FHA puts on it. They are
listed as **open findings** in the body and in `fha.md` §4, and the nine of them are the
real content of this specification.

Per-quantity annunciation — the red X on a gauge, the blanked attitude, the dropped
traffic target — is **not** here. That lives with the function that owns the quantity
(`RB-HLR-ATT-200`…`270` for attitude, and the same pattern for the others) because it is
part of presenting the quantity. What is here is the equipment-level path: a failure of
a sensor, a subsystem or the platform itself reaching the pilot as an alert.

Code references in **Source** name the function, not a line number, so the trace
survives a refactor.

---

## Raising an alert

### RB-HLR-ALR-010 — A raised alert is retained in order

**The system shall retain each raised alert, with the event type, title and time of the
event, in the order the alerts were raised.**

- **Parent:** RB-SYS-ALR-040
- **Source:** `main/alerts.go` `pushEvent()`; `main/managementinterface.go`
  `handleAlertsRequest()` (`/getAlerts`)
- **Verification:** test
- **Derived:** no

The retained list is what the pilot reads on the Alerts page, and — because the
websocket dispatch of RB-HLR-ALR-020 reaches only the clients connected at the time —
it is the only way an alert raised before the display connected is ever seen. A
barometer that fails during boot is exactly that case.

### RB-HLR-ALR-020 — A raised alert is sent to the display as it is raised

**The system shall transmit each alert to the connected display clients at the time the
alert is raised.**

- **Parent:** RB-SYS-ALR-030
- **Source:** `main/alerts.go` `pushEvent()` calling `alertUpdate.SendJSON()`;
  `main/managementinterface.go` `handleAlertsWS()` (`/alerts`)
- **Verification:** test
- **Derived:** no

### RB-HLR-ALR-030 — An alert raised before the function is ready is discarded

**The system shall discard an alert raised before the alert function has been
initialised, and shall report it as not raised.**

- **Parent:** none
- **Source:** `main/alerts.go` `pushEvent()`, the `alertsData == nil` branch
- **Verification:** test
- **Derived:** yes

Derived: a design decision about start-up order, not a flow-down. The alert function is
started from `main()` after the management interface, so any failure detected earlier —
a sensor missing at boot, a filesystem that will not mount — is reported to a function
that cannot yet record it. Discarding it is honest, but it means the alert list does not
contain the failures found before the function came up. Whether that window matters is a
question for the review; closing it means raising the alert function earlier in start-up,
not changing this requirement.

### RB-HLR-ALR-040 — Start-up is recorded as an alert

**The system shall raise an alert when the alert function starts.**

- **Parent:** none
- **Source:** `main/alerts.go` `InitFunc()` pushing `EVENT_TYPE_STARTUP_INFO`
- **Verification:** test
- **Derived:** yes

Derived: a design decision. It is also the one piece of evidence in the alert list that
distinguishes "no alerts because nothing failed" from "no alerts because the equipment
restarted and lost them", which is why it is worth keeping: an in-flight restart
(FHA-SYS-2) is otherwise invisible in the list.

---

## The presentation mapping

One file, `web/settings/alertsMapping.json`, holds the text, icon and sound for every
event type, per language. Both the daemon's aural annunciation and the display's list
read it, indexed by the event type's number — which is why its alignment with the
`EVENT_TYPE_` enumeration is a requirement rather than a convention.

### RB-HLR-ALR-050 — The presentation mapping is loaded at start

**The system shall load the alert presentation mapping from
`settings/alertsMapping.json` under the web root when the alert function starts.**

- **Parent:** RB-SYS-ALR-020
- **Source:** `main/alerts.go` `InitFunc()`, `ALERT_MAPPING_JSON_NAME`
- **Verification:** test
- **Derived:** no

### RB-HLR-ALR-060 — A missing presentation mapping does not stop alerts being raised

**The system shall start the alert function, and shall go on raising alerts, when the
presentation mapping is absent or unreadable.**

- **Parent:** RB-SYS-ALR-060
- **Source:** `main/alerts.go` `InitFunc()`, which logs the error and continues;
  `pushEvent()`, whose sound lookup is bounded by the loaded length
- **Verification:** test
- **Derived:** no

The mapping is how an alert is *presented*, not whether it is *raised*. The display
fetches its own copy over HTTP, so a daemon that lost the file still produces a readable
alert list — it just cannot play the sound. This is the robustness case that keeps a
corrupt settings partition from taking the annunciation path down with it.

### RB-HLR-ALR-070 — Every event type has a row in every language

**The alert presentation mapping shall contain, for every defined event type and in
every language it offers, an entry at the index equal to that event type's number,
identifying that event type and carrying text for the pilot.**

- **Parent:** RB-SYS-ALR-020
- **Source:** `main/alerts.go` `EVENT_TYPE_*`, and the index lookup in `pushEvent()`,
  `web/RB-01/services/servicealerts.js` `pushAlert()` and
  `web/RB-01/plates/js/alerts.js` `generateAlertRow()`
- **Verification:** test
- **Derived:** no

The mapping is addressed by number from three places in two languages of code, and
nothing in the file says which row is which event. A row inserted in the middle
silently relabels every alert after it. The test reads the enumeration out of
`main/alerts.go` and the rows out of the shipped file, so the two cannot drift apart
unnoticed, and it is also the collision check the comment above the constants asks for.

The file currently does double duty: beyond the enumerated rows, the `it-IT` array
continues with unrelated interface words. That is the cause of the finding in
RB-HLR-ALR-210 — the length of the array is used as the bound on a valid event type.

### RB-HLR-ALR-080 — Every sound the mapping names exists in both formats

**Every sound named by the alert presentation mapping shall exist both in the format the
equipment plays through the aircraft's audio and in the format the display plays through
the browser.**

- **Parent:** RB-SYS-ALR-020
- **Source:** `main/alerts.go` `soundFile()` (`RB-01/sounds/<name>.wav`, the default folder);
  `web/RB-01/services/servicealerts.js` `pushAlert()` (`sounds/<name>.mp3`, the same folder)
- **Verification:** test
- **Derived:** no

One field names two files in two formats, in two different pieces of software. A sound
that exists only as `.mp3` is a silent alert on the aircraft's audio and an audible one
in the browser, and nothing reports the difference: `aplay` is started with
`exec.Command` and neither its exit status nor its output is read.

### RB-HLR-ALR-090 — Every icon the mapping names exists

**Every icon named by the alert presentation mapping shall exist as a display asset.**

- **Parent:** RB-SYS-ALR-020
- **Source:** `web/RB-01/plates/js/alerts.js` `generateAlertRow()`
  (`/img/<name>.svg`, and `bar<name>` as the row's colour class)
- **Verification:** test
- **Derived:** no

The icon name is also the row's severity colour (`barinfo`, `barwarning`, `bardanger`
in `web/css/alerts.css`), so a missing icon is both a blank row and a row with no
severity colour.

---

## Classifying a system failure

The daemon reports a platform or sensor failure by raising a *system error* under a
short identifier — `addSingleSystemErrorf("BaroBroken", …)`. The alert function maps
that identifier to an event type, which is what selects the sound and the text the pilot
gets. These are the requirements for that mapping.

### RB-HLR-ALR-100 — A settings or filesystem failure is annunciated as such

**The system shall raise a settings-failure alert when a system error is reported under
an identifier that names the saving of settings, the available disk space, the rebuilding
of a partition, or a write to the filesystem.**

- **Parent:** RB-SYS-ALR-010
- **Source:** `main/alerts.go` `pushEventByIdent()`; the identifiers raised in
  `main/managementinterface.go` and `main/logging.go`
- **Verification:** test
- **Derived:** no

### RB-HLR-ALR-110 — A pressure-sensor failure is annunciated as such

**The system shall raise a barometer-failure alert when a system error is reported under
an identifier that names a read of the pressure sensor or a broken barometer.**

- **Parent:** RB-SYS-ALR-010
- **Source:** `main/alerts.go` `pushEventByIdent()`; `main/sensors.go`
  `tempAndPressureSender()`
- **Verification:** test
- **Derived:** no

This is the alert FHA-ALT-3 and FHA-ALT-1 rely on: the barometric altitude is the
quantity the pilot is least likely to notice has frozen.

### RB-HLR-ALR-120 — A receiver failure is annunciated as such

**The system shall raise a receiver-failure alert when a system error is reported under
an identifier that names the SDR configuration or a missing ping receiver.**

- **Parent:** RB-SYS-ALR-010
- **Source:** `main/alerts.go` `pushEventByIdent()`; `main/sdr.go`, `main/ping.go`
- **Verification:** test
- **Derived:** no

### RB-HLR-ALR-130 — Any other system failure is annunciated as a general failure

**The system shall raise a general system-failure alert, carrying the reported message,
when a system error is reported under any other identifier.**

- **Parent:** RB-SYS-ALR-010
- **Source:** `main/alerts.go` `pushEventByIdent()`, the fallback branch
- **Verification:** test
- **Derived:** no

The fallback is what makes RB-SYS-ALR-010 true for identifiers nobody classified: a new
failure path added anywhere in the daemon annunciates something rather than nothing. The
price is RB-HLR-ALR-150.

### RB-HLR-ALR-140 — A failure is annunciated once per occurrence

**The system shall raise one alert each time a system error is reported under an
identifier that is not already reported, and shall raise no alert while that identifier
remains reported.**

- **Parent:** RB-SYS-ALR-050
- **Source:** `main/gen_gdl90.go` `addSingleSystemErrorf()`, guarded on `systemErrs`
- **Verification:** test
- **Derived:** no

Sensors are polled at 10 Hz and the failing read is usually the next one too. Without
this the alert list and the aural annunciation would be a continuous tone, which is the
spurious-alert half of FHA-SYS-3. With RB-HLR-ALR-160 it is also how a failure that
comes back is annunciated again.

### RB-HLR-ALR-150 — A core-function failure identifies the function that failed

**The system shall raise an alert that identifies the affected function when a system
error is reported for the attitude, air-data, heading, traffic or engine function.**

- **Parent:** RB-SYS-ALR-020
- **Source:** FHA-ALR-1; FHA-ATT-1, FHA-SPD-4; `main/alerts.go` `pushEventByIdent()`
- **Verification:** test
- **Derived:** no

**Open finding — the equipment does not meet this.** Of the fifteen identifiers the
daemon raises, six fall through to the general failure of RB-HLR-ALR-130, and two of
those six are core functions: `ahrs-web-start` (attitude) and `airspeed-sensor-read`
(the pitot airspeed, the Major row FHA-SPD-4). Both annunciate as "Danger" with
`danger.wav` — the same text and the same sound the pilot gets for a full disk. The two
functions the FHA ranks highest are the two whose failures the alert cannot name. Fixing
it is an event type per core function plus its rows in the mapping; it is not a design
change. Tracked in `untraced.txt`.

### RB-HLR-ALR-160 — A failure that has gone is cleared

**The system shall stop reporting a system error when the condition that raised it is no
longer present.**

- **Parent:** RB-SYS-ALR-050
- **Source:** `main/gen_gdl90.go` `removeSingleSystemError()`; FHA-ALR-1
- **Verification:** test
- **Derived:** no

**Open finding — the equipment meets this for three of sixteen identifiers.** Only
`airspeed-sensor-read`, `sdrconfig` and `sounds-dir` are ever cleared. The other thirteen — including
every barometer identifier — latch for the life of the process: the message stays in
`globalStatus.Errors` and on the display after the condition has gone, and because
RB-HLR-ALR-140 suppresses a repeat while the identifier is reported, a failure that
recovers and fails again is annunciated **once, for the first occurrence only**. A pilot
who sees a barometer alert, watches the altitude come back, and then loses it again is
not told the second time. Tracked in `untraced.txt`.

---

## Aural annunciation

### RB-HLR-ALR-170 — The mapped sound is played on the aircraft's audio

**The system shall play the sound named for the event type by the presentation mapping
when local audio playback is enabled.**

- **Parent:** RB-SYS-ALR-030
- **Source:** `main/alerts.go` `pushEvent()`, `globalSettings.Audio_Enabled`
- **Verification:** analysis
- **Derived:** no

Verified by analysis, not test: the player is built inline — `exec.Command` on a fixed
path to `aplay`, started in a goroutine whose result is never read — so there is no seam
a test could observe without running an audio player on the build machine. The analysis
is the code review of `pushEvent()` recorded with this requirement, and it finds three
things worth the reviewer's attention: the player path is absolute and unconfigurable,
nothing reads the exit status, and nothing serialises two alerts raised together, so
their sounds overlap (the `TODO` in the function says as much).

### RB-HLR-ALR-180 — An event type with no sound is silent

**The system shall play no sound for an event type whose presentation mapping entry names
no sound.**

- **Parent:** none
- **Source:** `main/alerts.go` `pushEvent()`, the `len(sound) > 0` guard;
  `EVENT_TYPE_STARTUP_INFO`, whose row names none
- **Verification:** analysis
- **Derived:** yes

Derived: a design decision, and the mechanism by which an event type is made silent — an
empty `Sound` field rather than a flag. Verified by analysis for the same reason as
RB-HLR-ALR-170. It matters because it is the only control over which alerts make a noise:
the choice is in a data file, so it can be changed in the field without rebuilding, and
equally it can be changed in the field without anyone noticing.

### RB-HLR-ALR-340 — The sounds are played from the folder the settings name

**The system shall play the aural annunciation from the folder named by the settings, and
shall report a system error at start-up when local audio playback is enabled and that
folder does not exist.**

- **Parent:** none
- **Source:** `main/alerts.go` `soundFile()`, `setSoundsDir()`, `InitFunc()`,
  `globalSettings.Audio_SoundsDir`
- **Verification:** test
- **Derived:** yes

Derived: a design decision, so that an installation can name the folder that holds its
sounds. The default is `RB-01/sounds`, which holds every sound the mapping names. A folder
that is not there would silence every alert on the aircraft's audio with no report, because
nothing reads the result of `aplay`, so
`/setSettings` refuses it and start-up reports one that went missing, under the identifier
`sounds-dir`, cleared when a folder is accepted. The report is on the folder and not on each
file: a folder that lacks one sound stays silent for that alert, and RB-HLR-ALR-080 checks
the default folder only.

### RB-HLR-ALR-190 — The aural annunciation does not require the pilot to touch the display

**The system shall play the aural annunciation for an alert without requiring any prior
interaction with the display.**

- **Parent:** RB-SYS-ALR-030
- **Source:** FHA-ALR-1; `web/RB-01/plates/js/alerts.js` (*"the audio will play only if
  the user touched the screen"*)
- **Verification:** test
- **Derived:** no

**Open finding — the equipment does not meet this.** There are two aural paths and in the
default configuration neither sounds. The daemon's own path is off by default
(`Audio_Enabled` is initialised to `false`). The display's path is a browser `<audio>`
element, and a browser will not autoplay until the page has had a user gesture — the
comment in `alerts.js` says so — so on a display nobody has touched since boot, the first
alert of the flight is silent. The pilot's first indication is then visual only, which
runs into RB-HLR-ALR-230. Tracked in `untraced.txt`.

### RB-HLR-ALR-200 — The aural annunciation follows the configured language

**The system shall play the aural annunciation defined for the configured display
language.**

- **Parent:** RB-SYS-ALR-020
- **Source:** `main/alerts.go` `ALERT_DEFAULT_LANGUAGE`; the mapping's per-language
  arrays; `web/RB-01/services/servicealerts.js`, which selects on `navigator.language`
- **Verification:** test
- **Derived:** no

**Open finding — the equipment does not meet this.** The mapping carries `en-US` and
`it-IT`, the display picks by browser language, and the daemon reads `en-US` and nothing
else: `ALERT_DEFAULT_LANGUAGE` is a constant with no setting behind it. An Italian
installation therefore reads Italian text on the Alerts page and hears whatever `en-US`
names. Today the two languages happen to name the same sound files, so the only
consequence is that the field cannot localise the audio — but it is a divergence between
two annunciations of the same event, decided in two places. Tracked in `untraced.txt`.

---

## Robustness and resources

### RB-HLR-ALR-210 — An undefined event type is not raised

**The system shall raise no alert whose event type is not one of the defined event
types.**

- **Parent:** RB-SYS-ALR-060
- **Source:** `main/managementinterface.go` `handleAlertsPutRequest()` (`/alert/<n>`),
  `handleAlertPost()` (`POST /alert`); `main/alerts.go` `pushEvent()`; RB-SYS-TRF-030
- **Verification:** test
- **Derived:** no

**Closed 2026-11-10.** `pushEvent()` raises nothing for a type that is not a row of the
loaded mapping (`alertTypeDefined()`), or, when the mapping did not load, not below
`EVENT_TYPE_COUNT`, and returns -1. Every path goes through it: `POST /alert` (which
also answers 400), the legacy `/alert/<n>`, and the callers inside the daemon. A new
event type therefore needs only its row in the mapping. Verified by
`TestUndefinedEventTypeIsNotRaised` (`main/alertsrest_test.go`).

The finding as it stood: `/alert/<n>` took the event type from the request path through
`strconv.Atoi` and passed it to `pushEvent()` unchecked, and the sound lookup was guarded
only against the upper bound, so `GET /alert/-1` panicked in `pushEvent()`; `net/http`
recovered it, the bogus type stayed in the list, and the display's one-sided bound in
JavaScript threw on it and emptied the alert list. That display-side bound is still there,
and is RB-HLR-ALR-260's to close: the daemon no longer sends it such a type.

### RB-HLR-ALR-220 — The retained alert list is bounded

**The system shall retain no more than `EVENT_MAX_QUEUE` alerts, discarding the oldest
first.**

- **Parent:** none
- **Source:** `main/alerts.go` `EVENT_MAX_QUEUE`, `pushEvent()`; `web/RB-01/plates/js/alerts.js`
  (*"up to MAX which shall be 100 items"*)
- **Verification:** test
- **Derived:** yes

Derived: a resource decision with no parent above it. **Closed 2026-11-11.**
`pushEvent()` keeps the list in the order raised and, past `EVENT_MAX_QUEUE`, drops the
oldest alerts, active or not. A dropped alert was announced when it was raised; an update
of it finds nothing (`POST /alert` answers 404, the callers inside the daemon ignore the
-1). A dropped Id is not issued again in a burst, see `newEventId()`
(`TestABurstDoesNotReissueADroppedId`). Verified by `TestRetainedAlertListIsBounded` (`main/alertsrest_test.go`), through
`POST /alert`, the path an unauthenticated client on the aircraft's network would use.

The finding as it stood: the constant was declared and the display's comment said it was
enforced, but the trim was a `TODO`, so the list grew for as long as the daemon ran.

---

## Presentation on the display

### RB-HLR-ALR-230 — An alert is indicated without the pilot selecting the alert list

**The system shall indicate on the display that an alert has been raised, without
requiring the pilot to have selected the alert list.**

- **Parent:** RB-SYS-ALR-030
- **Source:** FHA-ALR-1; `web/RB-01/services/servicealerts.js`, `showAlertBalloon()`
- **Verification:** test
- **Derived:** no

**Open finding — partly met, and of the nine it is the one that matters most.** Since
2026-11-04 every alert shows a one-line balloon for 10 s or until it is clicked
(`test/display/test_alerts.py`). Before that the service was never created, because the
guard in `MainCtrl` tested `$scope.keypad`, so an alert was invisible and the display's
sound path was dead.

What is still missing is an indication that outlasts the balloon. After 10 s nothing on
the screen says the alert happened or that the condition is still present: a pilot who
was looking outside misses it, and `$scope.alarmIsLit` is still bound to nothing and
never cleared. Every FHA row that is classified Minor "because loss is annunciated"
depends on this path. A master caution the pilot can see and acknowledge, held until the
condition ends, is the fix, and it is a human-factors question as much as a coding one.
It is recorded as tech debt in
[`ALERTS-NAVIGATION-UI-PROPOSAL.md`](../docs/tech-debt/ALERTS-NAVIGATION-UI-PROPOSAL.md).
Tracked in `untraced.txt` until then, which is why the test carries no `Covers:` tag.

### RB-HLR-ALR-240 — The alert list is ordered most recent first

**The display shall list the retained alerts with the most recently raised alert first.**

- **Parent:** RB-SYS-ALR-040
- **Source:** `web/RB-01/plates/js/alerts.js` `refreshAlertsAsync()`, which `unshift`s
  each alert of the daemon's oldest-first list
- **Verification:** review
- **Derived:** no

Verified by review rather than test: the display test harness (`test/display/`) has no
Alerts-page case yet, and the behaviour is one statement of presentation order in
`alerts.js` that a reader can confirm against the daemon's order in RB-HLR-ALR-010. The
review is recorded here. When the harness gains an Alerts page — the natural place to
verify RB-HLR-ALR-230 and RB-HLR-ALR-250 as well — this requirement should move to
`test` with the other two.

### RB-HLR-ALR-250 — The age of each alert is shown

**The display shall show, for each listed alert, how long ago it was raised.**

- **Parent:** RB-SYS-ALR-040
- **Source:** FHA-ALR-1 (*late alert*); `web/RB-01/plates/js/alerts.js`
  `generateAlertRow()`
- **Verification:** test
- **Derived:** no

**Open finding — the equipment does not meet this.** The row's time column is computed
as `textBySeconds(hours * 60 + minutes)` of the alert's timestamp: a count of minutes
passed to a formatter that reads its argument as seconds. The result happens to render
the wall-clock time of the alert as `mm:ss`, so the column looks plausible and is
labelled as though it were elapsed time. It is neither — it carries no date, so an alert
from a previous flight is indistinguishable from one a minute old, and it is not an age.
An engine alert now says whether it is current (RB-HLR-ALR-310), but no other alert does,
and none of them shows an age. Tracked in `untraced.txt`.

### RB-HLR-ALR-260 — An alert the display cannot present is still listed

**The display shall list an alert whose event type it cannot find in the presentation
mapping, with the title the alert carries.**

- **Parent:** RB-SYS-ALR-060
- **Source:** `web/RB-01/plates/js/alerts.js` `generateAlertRow()`;
  `web/RB-01/services/servicealerts.js` `pushAlert()`
- **Verification:** test
- **Derived:** no

**Open finding — partly met, and the gap is in the same place as RB-HLR-ALR-210.** For an
event type above the mapping's length the row falls back to the default template and the
alert is listed with its title, which is the required behaviour. For a type below zero
the lookup throws a `TypeError` inside the loop that builds the list, and the list is left
empty — one malformed alert hides every real one. The daemon and the display repeat the
same one-sided bound, so the fix belongs in both. Tracked in `untraced.txt`.

---

## The state of an alert

Until these requirements an alert was a one-shot record: nothing said whether the
condition behind it was still there. They cover the alerts raised by the engine rules,
which are the only ones a later evaluation can confirm. Every other alert keeps its end at
its raise time and is never active: RB-HLR-ALR-160 records why the system failures cannot
join them yet.

### RB-HLR-ALR-270 — An alert has an identifier

**The system shall identify each retained alert by an integer formed from its raise time
as `HHMMSScc`, unique among the retained alerts.**

- **Parent:** RB-SYS-ALR-040
- **Source:** `main/alerts.go` `newEventId()`, `pushEvent()`
- **Verification:** test
- **Derived:** no

19:06:44.55 is `19064455`, and 00:00:00.00 is `0`, an identifier like any other. A flight
is under 24 h, so the time alone separates its alerts. An alert whose identifier is already
in the list takes the next free centisecond, because two alerts with one identifier would
leave one of them impossible to update. The identifier is not ordered: a flight can cross
midnight and the GPS steps the clock, so the order of the alerts is RB-HLR-ALR-010's.

### RB-HLR-ALR-280 — An alert retains when its condition was last seen

**The system shall retain with each alert the time its condition was last seen, which is
the time of the event until the condition is seen again.**

- **Parent:** RB-SYS-ALR-040
- **Source:** `main/alerts.go` `pushEvent()`, `updateEvent()`
- **Verification:** test
- **Derived:** no

The difference from the time of the event is the overall duration of the alarm. A condition
that comes back within the interval of RB-HLR-ALR-300 is the same alert, so that difference
counts the gaps; the alert also retains the time actually spent in the condition, which is
what RB-HLR-ALR-310 shows. On a flapping rule the two differ by 1.5 to 1.9 times, in the
eight recordings replayed on 2026-11-05 (347 minutes). The time comes from the system clock
with no correction, so a duration spanning a GPS clock step can be wrong: accepted, this is
a record for the pilot and not a measurement.

### RB-HLR-ALR-290 — An engine alert follows its condition without being annunciated again

**The system shall update an alert, with no transmission to the display clients and no
sound, on each EMS update that finds the engine rule that raised it in the same colour.**

- **Parent:** RB-SYS-ALR-050
- **Source:** `main/ems.go` `validateRules()`; `main/alerts.go` `updateEvent()`;
  `main/managementinterface.go` `handleEMSSetRequest()`
- **Verification:** test
- **Derived:** no

The rules run on every EMS update, not only on a changed value: `ems-adc` and `rb-sysmon`
post on change only, so a steady reading sends nothing of its own, and any update confirms
every rule from the latest values. Nothing goes on the socket because the display treats
every frame there as a new alert, with its sound and balloon.

### RB-HLR-ALR-300 — An engine alert stays active until its condition is seen to go

**The system shall report an alert raised by an engine rule as active until an EMS update
finds that rule out of the colour that raised it.**

- **Parent:** RB-SYS-ALR-040
- **Source:** `main/ems.go` `validateRules()`; `main/alerts.go` `updateEvent()`
- **Verification:** test
- **Derived:** no

Active clears on evidence and not on a timeout. Silence is not a recovery: when the updates
stop the alert stays active with its end at the last update, and RB-HLR-ALR-320 says why. A
value outside every band neither confirms nor clears. Each colour is its own alert, and
yellow to red closes yellow at once, so a rule shows one active alert. A rule back in the
colour within `EMS_RULE_ALERT_INTERVAL` reopens the alert of that colour, with the same
identifier.

### RB-HLR-ALR-310 — The list shows the state of an alert

**The display shall show, for each listed alert with a condition, whether the condition is
active and the time spent in it.**

- **Parent:** RB-SYS-ALR-040
- **Source:** `web/RB-01/plates/js/alerts.js` `generateAlertRow()`;
  `web/RB-01/services/servicealerts.js` `pollAlerts()`
- **Verification:** test
- **Derived:** no

The list follows the daemon while it is open, through the poll of RB-HLR-ALR-330. A one-shot
alert shows neither, and neither does an alert from an older daemon.

### RB-HLR-ALR-320 — Loss of the EMS data during an alarm is annunciated

**The system shall raise one alert when no EMS update has been received for 5 s while an
engine rule is yellow or red.**

- **Parent:** RB-SYS-ALR-010
- **Source:** `main/ems.go` `checkFeed()`
- **Verification:** test
- **Derived:** no

Without it an alarm whose data stopped is indistinguishable from one still being confirmed.
The alert is `EVENT_TYPE_EMS_GENERIC_FAILURE`, it is active while the silence lasts, and it
closes when an update arrives. It stays quiet before the first update, so an aircraft with
no EMS never sees it, and with every rule green, so a single update posted by hand does not
raise it. 5 s is more than twice the widest gap between EMS updates in the eight recordings
replayed on 2026-11-05, 2.28 s.

### RB-HLR-ALR-330 — An alarm that returns is replayed by the display

**The display shall replay the alarm of an alert that becomes active again after being
inactive for at least 60 s.**

- **Parent:** RB-SYS-ALR-050
- **Source:** `web/RB-01/services/servicealerts.js` `followAlerts()`,
  `ALERT_REPLAY_CLEAR_SECONDS`
- **Verification:** test
- **Derived:** no

The daemon reports `Active` and the display decides: each display has its own audio setting,
and the limit is one constant there. The limit departs from "on each occurrence" of the
parent on purpose, on the side of FHA-SYS-3: in the eight recordings replayed on 2026-11-05
an alert came back 43 times an hour on top of the 14.5 raised, nearly all an `EGTDIFF` rule
at the edge of a band, against 3.5 an hour at 60 s. The daemon's own sound through
RB-HLR-ALR-170 is played only when an alert is raised, so a return is not heard on the
aircraft's audio.
