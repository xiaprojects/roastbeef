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
| [`RB-HLR-ATT.md`](RB-HLR-ATT.md) | Attitude: sample, calibrate, fuse, annunciate | software | `main/sensors_test.go` |
| [`RB-HLR-TRF.md`](RB-HLR-TRF.md) | Traffic: receive, fuse, age, present | software | `main/traffic_test.go`, `main/gen_gdl90_test.go`, `main/flarm-nmea_test.go`, `test/integration/test_daemon.py` |
| [`RB-ICD-GDL.md`](RB-ICD-GDL.md) | GDL90 output: framing, ownship, AHRS messages | interface | `main/gen_gdl90_test.go`, `main/sensors_test.go` |
| `untraced.txt` | The agreed budget of requirements with no test yet | — | — |

## Status

**Traffic (`TRF`) and attitude (`ATT`) are specified and traced.** Traffic was done first
because it already had 32 unit tests to trace to, so the mechanism could be proved
end-to-end on real evidence rather than on a sample of three. Attitude followed because
the FHA ranks it highest. Its evidence — a simulated IMU, 216 board mountings and the
daemon's own attitude loop on a fake sensor, in `main/sensors_test.go` — was built for
this purpose rather than inherited, so the requirements could be written at the grain the
tests actually verify, and the two gaps left over were closed by adding tests rather than
by budgeting them.

Still unspecified: altimetry, speed, heading, variometer, the situation, alerts and EMS.
`main/airdata_test.go` and `main/gps_test.go` are the evidence waiting for the first
three. Roadmap Step 4 carries them, and
[`../docs/certification/agent-tasks.md`](../docs/certification/agent-tasks.md) carries
them as task briefs.

Four requirements are specified with no passing test and are counted in `untraced.txt`.
Two of them are findings rather than omissions: RB-HLR-ATT-350 (the attitude levels itself
during a GPS outage and says nothing) and RB-HLR-ATT-360 (the engine selector does not
select anything, because the Kalman branch is commented out).

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
