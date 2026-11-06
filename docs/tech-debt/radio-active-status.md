# Radio plate: ACTIVE shows the command, not the radio

## Problem
The word in the heading of the radio plate says what the pilot asked for, not what the
radio is doing. With `Driver: "SDR"`, `ACTIVE` can be on screen while nothing is being
received, and nothing else on the plate says so.

The word is bound to `radio.enabled` (`web/RB-01/plates/radio.html:5-6`). That is
`RadioStatus.Enabled`, the flag the same button sets: `enableRadio` in
`web/RB-01/plates/js/radio.js:172`, stored by `handleRadioPost` in
`main/managementinterface.go:1226`. So the button can only ever repeat itself.

`rb-sdr-radio` publishes what is really happening on the float bridge
(`RB-SDR-RADIO-IF-v1.0.md` sections 3.1 and 3.2 in `../rb-sdr-radio/docs/`), and nothing
in `web/RB-01` reads those keys.

| Situation | `sdrradiostatus` | `sdrradiofault` | Plate says | Evidence |
|---|---|---|---|---|
| Receiving, or listening on a quiet channel | 4, 3 | 0 | ACTIVE, correct | Measured |
| The VOR holds the dongle | 1 | 2 | ACTIVE, nothing received | Measured |
| Dongle missing or unplugged | 1 | 2 | ACTIVE, nothing received | From the code |
| Frequency rejected | 0 | 1 | ACTIVE, nothing received | From the code |
| Sound device busy | 3 or 4 | 4 | ACTIVE, nothing heard | From the code |
| Cannot record | 3 or 4 | 8 | ACTIVE, nothing recorded | From the code |
| `rb-sdr-radio` not running or dead | absent, or its last value | | ACTIVE | From the code |

The second row is normal use, not a failure. RB-01 has one dongle: with a VOR selected,
pressing the radio on shows ACTIVE and the pilot hears nothing, until the VOR is turned
off. A pilot reading ACTIVE expects to hear calls, and has no sign that they will not.

To see it, run `test/integration/test_vor_radio.py`, which prints a `KNOWN` line at
that step, with `sdrradiostatus` 1 and `sdrradiofault` 2 beside the plate's ACTIVE.

## Proposal
Keep the button and add the truth beside it.

1. **`ACTIVE`/`INACTIVE` stays the switch.** `Enabled` is what is stored in
   `stratux.conf` and restored after a restart, and it is the right thing for a button
   to show. Only its meaning as a status is wrong.
2. **Show `sdrradiostatus` as its own label**, the way the VOR plate shows `vorstatus`
   (`web/RB-01/addons/vor.html:11-16`): for example `NO SDR` in red for 1, `TUNING` for
   2, `LISTENING` for 3 and `RECEIVING` in green for 4. Only for `Driver: "SDR"`: the
   serial radios report no such status, so they keep what they have today.
3. **A message for each `sdrradiofault` bit**, as section 6 of the interface asks. The
   one that matters most tells the pilot why: the dongle is in use by the VOR.
4. **Show `sdrradiofreqactive`** rather than the frequency sent, which is the channel
   the radio is really on. Same section.

`radio.js` has no bridge values today. `addons/js/vor.js` shows the pattern: listen for
`BridgeUpdated` from `services/servicebridge.js`.

Two constraints on the design:

- **Where the label goes.** The heading has little room on the round 480x480 panel:
  `test/display/test_radio.py` already checks that the switch stays on the glass with the
  name `KRT2`. Extend that check to the label, on every panel, and hit-test it against
  the FAB zones.
- **Liveness needs a server change, not only a plate change.** See below.

## Same problem on the VOR plate
The VOR plate reads the real status, but it cannot tell when that status has gone stale.
With `rb-vor` killed during a fix, the plate went on showing `FIX` and the last radial
for the 15 s measured, with nothing to end it. `vor.js` has no timeout, although
`RB-VOR-IF-v2.2.md` section 4 item 2 asks consumers for one (3 s recommended). A frozen
needle under `FIX` is worse than the radio case: it looks like valid navigation.

A timeout on the plate alone will not work. Both daemons repeat their payload every 5 s,
but RB-01 rebroadcasts only values that changed, so on a steady signal the repeat
reaches no client, and a timeout would fire on a healthy receiver. RB-01 has to give
clients a liveness signal first, for example the time each key was last written. TD2 in
`../rb-sdr-radio/docs/tech-debt.md` tracks this gap, as one design for every radio.

## Done when
- With the VOR holding the dongle, the radio plate shows that the radio is not receiving,
  and why. The `KNOWN` line in `test_vor_radio.py` becomes a check.
- A receiver that dies is shown as dead on its plate within the timeout, on both plates.
- `test_radio.py` passes on all five panels, with the label clear of the FAB zones.
