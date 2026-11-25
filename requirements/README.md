# Requirements

System and software high-level requirements for the RB-01 **certified core** as scoped in
[`../docs/certification/fha.md`](../docs/certification/fha.md).

Read [`../docs/certification/standards/requirements.md`](../docs/certification/standards/requirements.md)
before adding or changing anything here — it fixes the identifier scheme, the required
fields, the phrasing rules and the review checklist, and `scripts/trace.py` enforces the
mechanical half of it.

| File | Function | Requirements | Tests |
|---|---|---|---|
| [`RB-SYS.md`](RB-SYS.md) | System level, all core functions | system | — |
| [`RB-HLR-ALR.md`](RB-HLR-ALR.md) | Alerts: raise, classify, annunciate, retain | software | `main/alerts_test.go` |
| [`RB-HLR-ATT.md`](RB-HLR-ATT.md) | Attitude: sample, calibrate, fuse, annunciate | software | `main/sensors_test.go` |
| [`RB-HLR-ALT.md`](RB-HLR-ALT.md) | Altimetry: pressure altitude, altimeter setting (pilot and AUTO), vertical speed | software | `main/airdata_test.go`, `common/equations_test.go`, `test/display/test_keypad_altimeter.py`, `test/display/test_variometer.py` |
| [`RB-HLR-SPD.md`](RB-HLR-SPD.md) | Speed: pitot airspeed, zeroing, sensor loss, IAS/GS presentation | software | `main/airdata_test.go`, `common/equations_test.go`, `sensors/ms4525do_test.go`, `test/display/test_speed_source.py` |
| [`RB-HLR-HDG.md`](RB-HLR-HDG.md) | Heading: GPS track, gyro and magnetic sources, the heading plate, the attitude plate's heading | software | `main/sensors_test.go`, `test/display/test_heading.py` |
| [`RB-HLR-SIT.md`](RB-HLR-SIT.md) | Situation: NMEA parsing, fix currency, accuracy, GPS vertical speed, fix-loss alert | software | `main/gps_test.go`, `main/gpsvspeed_test.go`, `main/gpsfixalert_test.go`, `main/lastposition_test.go` |
| [`RB-HLR-TRF.md`](RB-HLR-TRF.md) | Traffic: receive, fuse, age, present | software | `main/traffic_test.go`, `main/gen_gdl90_test.go`, `main/flarm-nmea_test.go`, `test/integration/test_daemon.py` |
| [`RB-ICD-GDL.md`](RB-ICD-GDL.md) | GDL90 output: framing, ownship, AHRS messages | interface | `main/gen_gdl90_test.go`, `main/sensors_test.go` |
| `untraced.txt` | The agreed budget of requirements with no test yet | — | — |

## Status

**Traffic (`TRF`), attitude (`ATT`) and alerts (`ALR`) are specified and traced.** Traffic
was done first because it already had 32 unit tests to trace to, so the mechanism could be
proved end-to-end on real evidence rather than on a sample of three. Attitude followed
because the FHA ranks it highest. Its evidence — a simulated IMU, 216 board mountings and
the daemon's own attitude loop on a fake sensor, in `main/sensors_test.go` — was built for
this purpose rather than inherited, so the requirements could be written at the grain the
tests actually verify, and the two gaps left over were closed by adding tests rather than
by budgeting them.

Alerts came third, ahead of functions whose tests already exist, because the FHA
classifies most of its own rows under the alert function. That one went the other way:
specifying it found that the function does not meet nine of its own requirements, and the
nine are the substance of `RB-HLR-ALR.md`. **If you read one file in this directory, read
its preamble.**

Altimetry (`ALT`, with the variometer), speed (`SPD`), heading (`HDG`) and the situation
(`SIT`) followed on 2026-11-25 (agent-tasks AT-19, AT-20), traced to the air data and
GPS tests that were waiting for them, four display tests and three new tests. Speed and
the situation come out nearly clean; altimetry and heading do not, and for one reason
worth knowing before reading either file: the daemon stamps and labels its barometric
and heading data, and the display draws them without looking at the stamp or the label.
**Read the preambles of `RB-HLR-ALT.md` and `RB-HLR-HDG.md`.**

Still unspecified: EMS (AT-18, waiting on the supplemental-or-primary decision).

Twenty-two requirements are specified with no passing test and are counted in
`untraced.txt`, and twenty of them are **findings** rather than omissions — seven
alerting ones; RB-HLR-ATT-350 and RB-HLR-ATT-360; six in altimetry, three in heading,
one in speed and one in the situation, each with its evidence in the requirement body.
That is more weight than a budget file was meant to carry: the file exists to stop the
gate going permanently red over untested requirements, not to track defects. A
problem-report register ([`agent-tasks.md`](../docs/certification/agent-tasks.md)
AT-13) is where they belong, and until it exists this file is the register.

## Working with the trace

```sh
scripts/trace.py              # the matrix, plus errors and the untraced report
scripts/trace.py --matrix     # just the matrix, as Markdown
scripts/trace.py --check      # exit non-zero on a hard error (what make check runs)
scripts/trace.py --budget     # rewrite untraced.txt from the current tree
```

A test says what it verifies with a `Covers:` line in the comment block above it:

```go
// Stale data is not presented as current: a position report under 6 s old goes to the
// EFB and the radar; at 6 s it goes to neither.
// Covers: RB-HLR-TRF-150, RB-HLR-TRF-160
func TestTrafficCycleDropsReportsOlderThanSixSeconds(t *testing.T) {
```

Adding a requirement without a test is allowed and is recorded in `untraced.txt`; the count
in that file may only go down. Referencing a requirement that does not exist is a build
failure.
