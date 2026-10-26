# Agent task pack — certification work executable in this checkout

This file turns the open items of [roadmap.md](roadmap.md) into **self-contained task
briefs that a coding agent can execute against the repositories on this machine**. Each
task block is written to be handed to one agent as its whole prompt: it states what to
read, what to touch, what "done" means and how to prove it with a command that runs here.

Written for agents. Humans want [roadmap.md](roadmap.md) instead — this file deliberately
omits the *why* and keeps only what is needed to do the work.

Grades, because not all certification work is agent work:

| Grade | Meaning |
|---|---|
| **A** | The agent can finish it and prove it alone, with the tools and data in this checkout. |
| **B** | One human decision (a number, a policy, a hazard opinion) must be recorded first. The decision is stated in the block; the agent may prepare everything around it. |
| **C** | Not agent work at all: repository ownership, money, laboratory time, or a DER/CVE signature. Listed in §6 so nobody assigns it to an agent. |

Last verified against the working tree on **2026-10-24**. The state numbers in §3 come from
`scripts/trace.py --check`; re-run it before trusting them.

---

## 1. House rules — these apply to every task in this file

**Read first, always:** [`../../AGENTS.md`](../../AGENTS.md) (build, test, line endings,
traceability) and [`standards/requirements.md`](standards/requirements.md) (the requirements
rulebook) if the task touches `requirements/`.

**The gate.** Every task ends with this green, with no new findings suppressed:

```sh
make libdump978.so          # once; needs git submodule update --init --recursive
make check                  # gofmt(leaf pkgs) + go vet + go test + provenance + trace
```

- `make check` **aborts at the first failing step**, so a trace error can hide a test
  failure. Re-run until it is clean end to end, don't read the first green lines as a pass.
- `go vet` runs as `-stdmethods=false` by deliberate choice (an `embd` interface signature
  collision, recorded in the `Makefile` comment). Do not widen the suppression.
- `go vet` is clean on every package and must stay clean. For a non-constant string use
  `log.Print(s)`, never `log.Printf(s)`.
- A local `go.work` points at `../goflying`, which silently changes module resolution. Use
  `GOWORK=off` to see what CI sees, and check both ways if you touch anything shared.
- `gofmt` is enforced on `common`, `uatparse`, `godump978`, `sensors` only. `main/` has many
  unformatted files; **do not reformat `main/`** — it would bury the real diff.

**Do not touch work in progress.** The owner has uncommitted changes in these files. Read
them, never edit them; if your task needs one changed, stop and say so in your report:

```
.vscode/settings.json  AGENTS.md  Makefile  docs/README.md
docs/certification/fha.md  docs/certification/roadmap.md
main/autopilot_test.go  main/flarm-nmea.go  main/gen_gdl90.go  main/gen_gdl90_test.go
main/gps.go  main/managementinterface.go  main/network.go  main/traffic.go
main/traffic_test.go  web/plates/js/settings.js  web/plates/settings.html
web/settings/elevations.json
```

Re-check with `git status --short` at the start of your session; the list moves.

**Line endings.** Go and shell are LF (`.gitattributes` enforces it). `web/` is CRLF by RB-01
convention and must stay CRLF — Python in text mode will flip it, so open web assets with
`newline=''` or edit them with `sed -i` and verify with `file`. Diff committed Go blobs with
`git diff --ignore-cr-at-eol` if they look wholly rewritten.

**Two web trees, and the one that matters.** `web/RB-01/` is the RB-01 HMI: first-party
code in `js/`, `plates/js/` and `services/`, vendored AngularJS 1.4.6 under `maui/`, and the
runtime addons under `addons/js/`. It is what `test/display/` serves and what the FHA's
display rows are about. `web/plates/` and `web/js/` are the older Stratux configuration UI.
When a task names a plate or a service it means the `web/RB-01/` one unless the path says
otherwise.

**`docs/` is in `.gitignore`, and the docs tree is tracked anyway.** Line 5 of
`.gitignore` is `docs/`, so a file you create there is invisible to `git status` and
`git add` picks it up only with `-f`. Every existing document under `docs/` was added that
way. If your task produces a document, say so explicitly in your report with the
`git add -f <path>` line the owner needs, or the work will look like it was never done.

**Do not commit, do not push, do not tag** unless the task says so. Leave the work in the
tree and report the file list. The baseline tag and branch protection are grade C.

**Honesty rules** (from `standards/requirements.md` §9, and they are the point of the whole
exercise):

- Write what the code *should* do, then check whether it does. Where it does not, that is a
  problem report, not a requirement rewritten to match the bug.
- Mark the uncertain ones. A requirement you inferred from one code path and could not
  confirm is flagged as such, not presented as specification.
- Never add a line to `requirements/untraced.txt` to make the gate pass. Adding one is an
  agreed act: say in your report why the gap exists and what would close it.
- If you delete or rename a tagged test, move its `// Covers:` tag to whatever replaces it.

**Report format.** End with: files added/changed (paths only), the gate output verbatim,
the trace numbers before and after, every judgement call you made, every claim you could
not verify, and anything you found that is not in your scope (as a candidate problem
report, not a fix).

---

## 2. What is on this machine

**Repositories** (all under `/home/stefano/`, all git unless noted):

| Repo | Content | Role in certification |
|---|---|---|
| `roastbeef` | The product: Go daemon `stratuxrun`, RB-01 HMI, C submodules. **This checkout.** | Everything. All tasks below live here unless stated. |
| `goflying` | AHRS/Kalman library (`ahrs/`, `icm20948/`, `bmp280/`, `sim/`), own test files. Clean at `251f919` "Kalman improvements #3". | Attitude requirements (AT-01) trace into it. `go.work` already wires it in. |
| `rb-ems-go` | EMS/engine data daemon, Go. | EMS function requirements, later. |
| `rb-vor` | VOR/navigation receiver, Python, ~15 `test_*.py`. | Second-baseline function; not in the certified core. |
| `serial` | The consolidated serial library the daemon depends on. | Configuration item; dependency pinning (grade C). |
| `mag-can-bridge`, `rb-esp`, `rbvoice`, `rb-cloud*`, `rb-panel-concept` | Peripherals, firmware, cloud, concept work. | Out of the certified baseline. Do not spend agent time here. |
| `distro-rb-01` | Image build material (not a git repo). | Step 1 pinning, Step 8 BOM. |

**Tools present:** `go` (1.27 toolchain), `python3`, `node`, `npm`, `eslint 6.4.0`
(`/usr/bin/eslint` — ESLint 6 means `.eslintrc.json`, not `eslint.config.js`), `chromium`
(`/snap/bin/chromium` and `/usr/bin/chromium-browser`), `docker` (`/snap/bin/docker`).
Network reaches `proxy.golang.org`, and `honnef.co/go` is already in the module cache.

**Tools missing** — a task needing one must install it as its first step and record the
exact version it installed: `staticcheck`, `golangci-lint`, `govulncheck` (all
`go install`, network is up), `cppcheck`, `lcov`/`gcovr`, `syft`.

---

## 3. The state the tasks start from

```
trace: 126 requirements, 83/96 HLRs verifiable by test are covered, 95 tag(s) bound

UNTRACED (13) - specified, no test yet:
  RB-HLR-ALR-150  A core-function failure identifies the function that failed
  RB-HLR-ALR-160  A failure that has gone is cleared
  RB-HLR-ALR-190  The aural annunciation does not require the pilot to touch the display
  RB-HLR-ALR-200  The aural annunciation follows the configured language
  RB-HLR-ALR-210  An undefined event type is not raised
  RB-HLR-ALR-220  The retained alert list is bounded
  RB-HLR-ALR-230  An alert is indicated without the pilot selecting the alert list
  RB-HLR-ALR-250  The age of each alert is shown
  RB-HLR-ALR-260  An alert the display cannot present is still listed
  RB-HLR-ATT-350  The attitude survives a loss of GPS, or says it has not
  RB-HLR-ATT-360  The attitude engine is the one that was selected
  RB-HLR-TRF-330  Target count limit
  RB-HLR-TRF-340  Staleness is visible on the traffic display

NO FLOW-DOWN (1) - system requirements with no HLR beneath them:
  RB-SYS-SYS-040  Identification of the installed software
```

Specified: attitude (`RB-HLR-ATT`, 37), traffic (`RB-HLR-TRF`, 35), alerts
(`RB-HLR-ALR`, 26), GDL90 interface (`RB-ICD-GDL`, 6), system (`RB-SYS`, 22).
**Unspecified: altimetry, speed, heading, variometer, EMS, situation.**

Eleven of the thirteen untraced items are **findings** — requirements the equipment does
not meet — not tests nobody has written. Nine of those came out of AT-02 and are listed
in `RB-HLR-ALR.md` with the evidence. A task that touches the alerting or attitude code
should read them first; several are a few lines to fix, and two are decisions for the
safety review rather than code at all.

Test evidence that exists and is not yet traced to anything: `main/airdata_test.go`
(pitot airspeed and barometric altitude/vertical speed, each sender driven on a scripted
sensor) and `main/gps_test.go` (NMEA parsing, hemispheres, the 3 kt track hold, malformed
sentences, NACp from GST). Those are AT-19 and AT-20, and they are the cheapest
requirements work left.

`scripts/trace.py` binds a requirement to a test through a `Covers:` line in the comment
block immediately above the test definition. It scans three places, so HMI and daemon
tests are first-class evidence, not just Go unit tests:

| Where | File pattern | Test pattern |
|---|---|---|
| anywhere in the repo | `*_test.go` | `func TestXxx(` |
| `test/display/` | `test_*.py` | `def test_xxx(` |
| `test/integration/` | `test_*.py` | `def test_xxx(` |

---

## 4. Task index

| ID | Task | Grade | Step | Depends on |
|---|---|---|---|---|
| ~~[AT-01](#at-01--attitude-att-requirements-and-the-first-mainsensorsgo-tests)~~ **done** | Attitude (`ATT`) requirements + `main/sensors.go` unit tests | **A** | 4, 5 | — |
| ~~[AT-02](#at-02--alerting-alr-requirements-and-tests)~~ **done** | Alerting (`ALR`) requirements + `main/alerts.go` tests | **A** | 4, 5 | — |
| [AT-03](#at-03--http-interface-requirements-rb-icd-http) | HTTP/WebSocket interface requirements (`RB-ICD-HTTP`) | **A** | 4 | — |
| [AT-04](#at-04--close-rb-sys-sys-040-installed-software-identification) | Close `RB-SYS-SYS-040`: software identification flow-down | **A** | 1, 4 | — |
| [AT-05](#at-05--close-rb-hlr-trf-340-staleness-on-the-traffic-display) | Close `RB-HLR-TRF-340` with an HMI test | **A** | 5 | — |
| [AT-06](#at-06--the-design-and-code-standards) | `standards/design.md` and `standards/code.md` | **A** | 2 | — |
| [AT-07](#at-07--staticcheck-and-golangci-lint-as-a-gate) | `staticcheck` + `golangci-lint` config, findings triaged | **A** | 2 | — |
| [AT-08](#at-08--eslint-for-the-rb-01-plates) | ESLint config for the RB-01 plates, `eval` forbidden | **A** | 2 | — |
| [AT-09](#at-09--c-warnings-clean-and-the-strcpy-problem-reports) | `-Wall -Wextra -Werror` on `dump978` + the `strcpy` reports | **A** | 2 | — |
| [AT-10](#at-10--coverage-baseline) | Statement-coverage baseline + unreached-code triage | **A** | 5 | — |
| [AT-11](#at-11--tql-5-tool-qualification-files) | DO-330 TQL-5 files for the four evidence-producing tools | **A** | 9 | — |
| [AT-12](#at-12--security-assessment-do-326a) | DO-326A threat assessment of the real attack surface | **A** | 9 | — |
| [AT-13](#at-13--the-open-problem-report-register) | In-repo open problem report register | **A** | 1, 10 | — |
| [AT-14](#at-14--data-chain-and-integrity-do-200b--do-276) | DO-200B data chain + load-time integrity check | **A** | 9 | — |
| [AT-15](#at-15--sbom-and-build-identity) | SBOM per build + build identity evidence | **A** | 1 | — |
| [AT-16](#at-16--coupling-analysis-for-the-process-split) | Data/control coupling analysis for the Level E split | **A** | 7 | AT-03 |
| [AT-17](#at-17--close-rb-hlr-trf-330-the-efb-target-count-limit) | `RB-HLR-TRF-330`: the EFB target count limit | **B** | 4, 5 | a cap + drop policy |
| [AT-18](#at-18--ems-requirements-across-two-repositories) | EMS (`EMS`) requirements across `roastbeef` + `rb-ems-go` | **B** | 4 | primary/supplemental scope |
| [AT-19](#at-19--altimetry-and-speed-requirements) | Altimetry (`ALT`) and speed (`SPD`) requirements against `main/airdata_test.go` | **A** | 4 | — |
| [AT-20](#at-20--heading-and-situation-requirements) | Heading (`HDG`) and situation (`SIT`) requirements against `main/gps_test.go` | **A** | 4 | — |

**AT-01 and AT-02 are done** (37 attitude and 26 alerting requirements, traced; see the
roadmap progress log). Start with **AT-19** and **AT-20**: they are the cheapest left,
because `main/airdata_test.go` and `main/gps_test.go` already hold the evidence and only
the requirements are missing. Then **AT-13**, which has become more useful than it was
when this file was written: AT-02 produced nine findings and they are currently recorded
in `requirements/untraced.txt`, a file whose job is budgeting untested requirements, not
tracking defects. AT-04, AT-05 are each under a day and each closes a line the gate
currently prints.

---

## 5. Tasks

### AT-01 — Attitude (`ATT`) requirements and the first `main/sensors.go` tests

**Grade A. Roadmap steps 4 and 5. Objectives A-2 obj. 1–2, A-3, A-6 obj. 1–2.**

> **Done, 2026-10-24.** `requirements/RB-HLR-ATT.md` (37 requirements), the
> `RB-SYS-ATT-*` section of `RB-SYS.md`, `RB-ICD-GDL-050/060`, and 13 tagged tests in
> `main/sensors_test.go`. Two requirements are in the untraced budget and both are
> findings, not omissions. The brief below is kept as the worked example of what a
> function-sized requirements task looks like.

**Goal.** Specify the attitude function and write the unit tests in the same change. Unlike
traffic there is no existing test evidence to recover requirements from — `main/sensors.go`
(1170 lines) has no test file at all — so you are writing both halves, and that is why this
task is harder than its size suggests.

**Read first.** [`fha.md`](fha.md) rows `FHA-ATT-1/2/3` (loss, misleading, **frozen** — the
insidious one) and `RB-SYS-SYS-020` (every displayed quantity annunciated invalid or
non-current within 1 s); `requirements/RB-HLR-TRF.md` as the worked example of form and
grain; `standards/requirements.md`; `docs/hardware/sensors.md`;
`web/RB-01/plates/js/SixPackInstruments.js` for what is actually drawn; and
`../goflying/ahrs/` — paths outside this repo are written relative to the repo root, which
is your working directory.

**Scope.** Add `requirements/RB-HLR-ATT.md` and `main/sensors_test.go`. Read `main/sensors.go`
and `../goflying/ahrs/`; **do not edit either** — this task produces specification and tests,
not behaviour changes.

**Do.**

1. Write the HLRs for: ranges and resolutions of pitch/roll/heading/slip/G; update rate;
   latency; the power-up state and caging (`CageAHRS`, `CageAHRSAt` at line 1108/1115);
   behaviour on sensor loss and on an implausible value (`isAHRSInvalidValue`, line 1168);
   the AHRS status and how invalidity reaches the HMI (`updateAHRSStatus`, line 1130);
   internal versus external AHRS source selection (`newAHRS(engine string)`, line 777) and
   what happens on a source change; the G-load reset (`ResetAHRSGLoad`, line 1125);
   magnetometer usability (`magSampleUsable`, line 1031) and the Kalman field update.
2. Test the hardware-free functions directly. These need no I2C bus and are where the real
   arithmetic is: `makeOrientationQuaternion` (892), `accelGain` (981), `accelCorrect` (991),
   `accelRestOffset` (1006), `magSampleUsable` (1031), `makeMagOrientationQuaternion` (1048),
   `isAHRSInvalidValue` (1168), `kalmanMagnetometer` (847). Normal range **and** robustness:
   NaN, ±Inf, zero-magnitude vectors, gimbal-lock attitudes, sign conventions at ±180°.
3. For anything that needs a sensor, follow the scripted-bus pattern in
   `sensors/ms4525do_test.go` rather than inventing a second mocking style.
4. `sensorAttitudeSender` (369) is a long loop over globals and is **not** unit-testable as
   it stands. Do not refactor it — specify its requirements with
   `Verification: analysis`, write the analysis as a short note under
   `docs/certification/verification/`, and say in your report which requirements would
   become testable if the loop were split, so the owner can price the refactor.
5. Check each written requirement against the §8 review checklist before you finish.

**Acceptance.**

- `make check` green.
- `scripts/trace.py --check` shows `RB-HLR-ATT-*` requirements with `Covers:` tags bound to
  the new tests, and `requirements/untraced.txt` **has not grown**.
- Every `Verification: test` ATT requirement has a test; every `analysis`/`review` one has
  its record.
- `requirements/README.md` table gains the ATT row. (That file is not WIP — check first.)

**Known traps.** Attitude sign conventions differ between `sensors/`, `goflying/ahrs` and
the HMI; state the convention in the requirement rather than assuming the reader shares
yours. Aerobatic attitudes are real on this aircraft, so do not write requirements that
assume |pitch| < 90°.

---

### AT-19 — Altimetry and speed requirements

**Grade A. Roadmap step 4.** Specify `ALT` (barometric altitude, QNH, AutoQNH, vertical
speed) and `SPD` (pitot indicated airspeed, the GPS ground speed substitution) and trace
them to the five tests already in `main/airdata_test.go`. The FHA rows are FHA-ALT-1/2/3,
FHA-SPD-1/2/3/4 and FHA-VSI-1; `RB-SYS.md` needs `RB-SYS-ALT-*` and `RB-SYS-SPD-*`
sections first, as `RB-SYS-ATT-*` shows. FHA-SPD-2 — ground speed presented on a gauge
with airspeed colour arcs — is an open item in `fha.md` §5 and must be written as the
requirement it is, not smoothed over. Acceptance as AT-01: `make check` green, the new
requirements traced, `untraced.txt` not grown without saying why.

### AT-20 — Heading and situation requirements

**Grade A. Roadmap step 4.** Specify `HDG` (the GPS-track / gyro / magnetic source
selection, FHA-HDG-1/2 — source substitution with no indication is the hazard) and `SIT`
(fix validity, accuracy, NACp, the 3 kt track hold), and trace them to
`main/gps_test.go`. Note that `RB-HLR-ATT-210` already couples the attitude to the GPS
fix, and `RB-HLR-ATT-280`…`300` specify the magnetometer's alignment but deliberately not
its heading: that is this task's.

### AT-02 — Alerting (`ALR`) requirements and tests

**Grade A. Roadmap steps 4 and 5.**

> **Done, 2026-10-24.** `requirements/RB-HLR-ALR.md` (26 requirements), the
> `RB-SYS-ALR-*` section of `RB-SYS.md`, and eight tagged tests in the new
> `main/alerts_test.go`. **The acceptance criterion below was not met as written and was
> not met deliberately: `untraced.txt` grew by nine.** Each of the nine is a requirement
> the equipment does not meet — not a test nobody wrote — and the brief's own step 3 says
> to record an open question rather than pick a policy silently. The alternatives were to
> not write the requirement (hiding the finding) or to write a test that asserts the
> defective behaviour (freezing it), and both are worse. The findings are in the
> requirement bodies with their evidence, in `fha.md` §4, and summarised in the roadmap
> progress log; two of them are on the review agenda in `fha.md` §5 item 3 because they
> bear on what severity the FHA may claim. **AT-13 is now the task that matters here**: a
> problem-report register is where those nine belong, and `untraced.txt` is holding them
> only because nothing better exists yet.
>
> Where this brief guessed wrong, for the next one's benefit: the queue policy is not
> unspecified, it is unimplemented (`EVENT_MAX_QUEUE` is declared and the trim is a
> `TODO`); de-duplication lives in `addSingleSystemErrorf`, not in the alert function;
> and there is no acknowledgement to specify because there is no master caution to
> acknowledge. The latency question turned out to be the wrong one — the path from
> condition to queue is a function call, and what fails is the path from queue to pilot.

**Goal.** Specify the alerting function (`FHA-ALR-1`: alert missing / false / late) and test
it. The alerting path is small — `main/alerts.go` is 187 lines — and carries a Major
severity, which is the best ratio of safety value to effort in this whole file.

**Read first.** `fha.md` row `FHA-ALR-1` and `RB-SYS-SYS-020`; `main/alerts.go`;
`web/settings/alertsMapping.json`; `web/RB-01/plates/js/alerts.js` and
`web/RB-01/services/servicealerts.js`.

**Scope.** Add `requirements/RB-HLR-ALR.md` and `main/alerts_test.go`. Read-only elsewhere.

**Do.**

1. Specify: the event taxonomy (the `EVENT_TYPE_*` constants, and what makes an id
   safety-relevant versus informational); queue behaviour at `EVENT_MAX_QUEUE = 100` — what
   is dropped when it is full, and whether a safety alert can be lost behind informational
   ones; the mapping-file contract (`alertsMapping.json`: missing id, missing language,
   malformed file — the daemon must not die and must not go silent); latency from condition
   to annunciation against the 1 s of `RB-SYS-SYS-020`; de-duplication and repeat policy;
   acknowledgement; the alert's own failure mode (if the mapping file is absent, is the pilot
   told?).
2. Write the tests, including the robustness cases: queue overflow, unknown event id, absent
   and corrupt mapping file, unknown language.
3. Where behaviour is unspecified in code — most likely the overflow and de-duplication
   policy — record the open question as a problem report candidate. **Do not pick a policy
   silently.**

**Acceptance.** `make check` green; ALR requirements traced; `untraced.txt` not grown; the
open questions listed in your report.

---

### AT-03 — HTTP interface requirements (`RB-ICD-HTTP`)

**Grade A. Roadmap step 4.**

**Goal.** The HMI and every EFB see the daemon only through HTTP and the WebSockets.
`docs/http-api.md` is already a de-facto interface specification; turn it into interface
requirements in the parsed form, so that HMI tests have something to trace to.

**Read first.** `docs/http-api.md`, `docs/settings-reference.md`,
`requirements/RB-ICD-GDL.md` (the worked interface example), `standards/requirements.md`.

**Scope.** Add `requirements/RB-ICD-HTTP.md`. `main/managementinterface.go` is **WIP —
read-only**. Tag existing tests in `test/display/` and `test/integration/` where they
already verify a frame; do not rewrite them.

**Do.** Specify, per endpoint and per WebSocket stream — the GET endpoints `/getStatus`,
`/getSituation`, `/getTowers`, `/getSatellites`, `/getClients`, `/getRegion`,
`/getSettings`, the mutating `POST /setSettings` and `POST /setRegion`, and the streams
`ws://…/{gdl90,status,situation,traffic,weather}`: field names, units, ranges, resolution,
which fields may be absent, the validity and age fields, the update rate, and the behaviour
on a malformed or oversized request. Where `docs/http-api.md` and the code disagree, the
code wins and the disagreement is a problem report.

Note the gap you will find: **engine data has no documented endpoint**, although the HMI
reads it (`web/RB-01/services/serviceems.js`, `main/bridge.go`). Record it as a
documentation problem report; specifying it belongs to AT-18.

**Acceptance.** `make check` green; the new requirements either tagged from existing tests
or listed in your report as the gap, with the test that would close each one named.

---

### AT-04 — Close `RB-SYS-SYS-040`: installed software identification

**Grade A. Roadmap steps 1 and 4.**

**Goal.** `scripts/trace.py` prints `RB-SYS-SYS-040  Identification of the installed
software` as having **no flow-down**. Close it: the HLRs plus a test. DO-178C Table A-8 asks
that the installed software be identifiable; the mechanism (commit SHA with a `-dirty`
suffix, shown on the OTA screen and in `/getStatus`) already exists and is unspecified.

**Read first.** `scmp.md`; `scripts/getversion.sh`; `stratuxVersion`/`stratuxBuild` in
`main/gen_gdl90.go` (**WIP — read-only**); the OTA screen (`web/RB-01/plates/js/ota.js`).

**Scope.** Edit `requirements/RB-SYS.md` to add the children, add
`requirements/RB-HLR-SYS.md`, and add the test. Prefer a `test/display/` test for the HMI
half (the build id must be *visible*) and a Go test for the string's construction — put the
Go test in a file you create, not in a WIP one.

**Acceptance.** `make check` green and the `NO FLOW-DOWN` line **gone** from
`scripts/trace.py --check` output. That disappearing line is the whole deliverable.

---

### AT-05 — Close `RB-HLR-TRF-340`: staleness on the traffic display

**Grade A. Roadmap step 5.**

**Goal.** One of the two budgeted gaps. The daemon publishes a target's growing age
(`RB-HLR-TRF-180`, tested); nobody has verified that the **display** shows it. This is the
HMI half of `RB-SYS-SYS-020` and the same gap as `FHA-ATT-3`.

**Read first.** `requirements/RB-HLR-TRF.md` entry 340; `test/display/README.md`;
`test/display/test_flight.py` as a model; `web/RB-01/plates/js/radar.js` and
`web/RB-01/services/servicetraffic.js`.

**Do.** Write a `test/display/test_*.py` case that drives `rbserver.py` with a target whose
age crosses the threshold and asserts what the HMI does — and assert what the requirement
says, not what the HMI happens to do. If the HMI does *not* annunciate staleness, the test
fails, you leave it failing, and you register the finding per `test/display/known.py`: that
is the correct outcome and a real safety finding, not a task failure.

**Acceptance.** `cd test/display && ./run.py <yourtest>` runs; the `Covers: RB-HLR-TRF-340`
tag binds (`scripts/trace.py --check`); the line is deleted from
`requirements/untraced.txt` **only if the test passes**. If it fails, keep the budget line,
add the `known.py` entry, and report the finding prominently.

---

### AT-06 — The design and code standards

**Grade A. Roadmap step 2 item 4.**

**Goal.** Two of the three DO-178C standards are missing. Write
`standards/design.md` and `standards/code.md` to the same quality as
`standards/requirements.md`: rules this repository can actually pass, each one checkable,
with the deviations already in force written down as deviations rather than ignored.

**Do.** `code.md` covers Go, C and JavaScript: naming, error handling (no ignored errors on
a safety path), the `log.Print` versus `log.Printf` rule and why it is a safety rule here,
complexity and function-length limits with the numbers chosen from what the codebase
actually is (measure first — a limit the baseline fails on day one is theatre), forbidden
constructs (`eval` and dynamic script injection in core plates, unbounded string copies in
C, `panic` in a daemon path), concurrency rules for the shared globals
(`globalSettings`/`globalStatus`/`mySituation`), the file-level licence header, line endings,
and the review checklist. `design.md` covers the architecture rules: what may depend on what,
where the process boundary will be (AT-16), how a plugin/bridge may and may not reach into
the core.

Record as explicit, justified deviations: `gofmt` enforced on leaf packages only;
`-stdmethods=false`; `main/` not formatted; `web/` CRLF.

**Acceptance.** Both files committed to the tree, referenced from
[`../README.md`](../README.md) and from the roadmap's Step 2 deliverable list, with every rule
either enforced by a command in `make check` or marked "review only".

---

### AT-07 — `staticcheck` and `golangci-lint` as a gate

**Grade A. Roadmap step 2 item 1.**

**Goal.** The last unchecked item of Step 2's Go line. `go vet` is clean; `staticcheck` and
`golangci-lint` are not installed and have never been run here.

**Do.** Install both at a pinned version (record the exact version and the install command
in your report; `honnef.co/go` is already in the module cache). Run them across all
packages, both with and without `GOWORK=off`. Expect a large first-run finding count:
triage it, do not bulk-suppress. Fix what is a real defect in a **non-WIP** file; for
everything else write a committed configuration (`.golangci.yml`) that disables a check only
with a one-line reason next to it, plus `docs/certification/accepted-findings.md` for the
findings you accept with their justification. Add the command to `make check` **only when it
is green**, and add `govulncheck` the same way.

**Acceptance.** `make check` green including the new step, from a clean tree, twice in a row.
Every disabled check and accepted finding has a written reason. Report the finding count
before and after, and list separately anything you found in a WIP file so the owner can
fix it.

---

### AT-08 — ESLint for the RB-01 plates

**Grade A. Roadmap step 2 item 3.**

**Goal.** The AngularJS 1.4.6 HMI renders the safety-relevant data and nothing lints it.
The installed ESLint is **6.4.0**, so the config format is `.eslintrc.json`, not
`eslint.config.js`, and the parser target is ES5 — the HMI has no build step and must keep
none.

**Scope.** First-party code, roughly 40 files: `web/RB-01/js/` (3),
`web/RB-01/plates/js/` (21, including `SixPackInstruments.js`, `alerts.js`, `radar.js`),
`web/RB-01/services/` (13), and the older UI in `web/plates/js/` and
`web/js/{main,keypad,service*}.js`.

**Out of scope, by `.eslintignore`:** vendored AngularJS and Mobile Angular UI
(`web/RB-01/maui/`), the Three.js and OpenLayers bundles (`web/synthview/`, `web/js/ol*.js`,
`web/js/chart.js`, `web/js/svg.min.js`, `web/js/NoSleep.min.js`, `web/js/GPXParser.js`,
`web/js/addtohomescreen.min.js`, `web/js/flight-indicators.js`), and `web/RB-01/addons/js/`
— addons are loaded at runtime into the HMI and are excluded from the certified
configuration, which is the reason not to lint them. Say that in your report rather than
leaving a silent ignore.

**Do.** Write `.eslintrc.json` (ES5, browser + Angular globals, `eqeqeq`, `no-undef`,
`no-unused-vars`, `no-fallthrough`, and **`no-eval` plus `no-implied-eval` as errors**).
Fix what it finds in the first-party files, except the WIP ones
(`web/plates/js/settings.js`, `web/plates/settings.html`) — report those instead. Expect
`no-undef` noise from the Angular injection style; solve it with a `globals` list, not by
disabling the rule. Preserve CRLF in every file you touch and verify with `file` afterwards.

**Acceptance.** `eslint -c .eslintrc.json web/RB-01/js web/RB-01/plates/js web/RB-01/services
web/plates/js web/js` exits 0; `test/display/run.py` still passes (a lint fix that breaks the
HMI is worse than the lint finding); the run is wired into `make check`; `git diff --stat` shows no whole-file rewrites, which is how a CRLF accident
shows up.

---

### AT-09 — C warnings clean, and the `strcpy` problem reports

**Grade A. Roadmap step 2 item 2.**

**Goal.** `dump978` decodes attacker-controllable RF input in C. There are **three**
unbounded `strcpy` calls on that path, not the one the roadmap mentions:
`dump978/uat_decode.c:841`, `dump978/uat2json.c:167`, `dump978/uat2json.c:169` — and the
second one copies `mdb->callsign` into `a->squawk`, which looks like a bug independent of
the overflow.

**Do.** Build `dump978` with `-Wall -Wextra` and triage every warning (`-Werror` once it is
clean). Write the three `strcpy` sites up as problem reports in the AT-13 register with the
input path that reaches each, then fix them with a bounded copy and a test that feeds an
over-long field. `dump978` is a submodule: make the change in the submodule checkout, state
clearly in your report that it needs an upstream decision (fork, patch file, or upstream PR),
and do not update the submodule pointer yourself.

**Acceptance.** Warning-clean build with the flags recorded in the Makefile or a
`docs/certification/` note; the three reports written; a test that demonstrates the
truncation; the submodule question put to the owner.

---

### AT-10 — Coverage baseline

**Grade A. Roadmap step 5 item 4.**

**Goal.** Statement coverage is not required at DAL D and is required at C; the roadmap says
collect it from day one. Nobody has measured it.

**Do.** `go test -coverprofile` per package (keep the `LIBRARY_PATH`/`CGO_CFLAGS_ALLOW` env
from the Makefile), write `docs/certification/verification/coverage-baseline.md` with a
per-package table, and triage the unreached code in the **certified-core** files only
(`main/sensors.go`, `main/alerts.go`, `main/traffic.go`, `main/gps.go`, `common/`,
`sensors/`, `uatparse/`): each unreached block is dead code (cross-check
`docs/tech-debt/dead-code.md`), deactivated code that needs the DO-178C §12 argument, or
code with no requirement — which is the interesting category and feeds AT-01/AT-02. Do not
chase a coverage number; the triage is the deliverable.

**Acceptance.** The report exists, the numbers are reproducible by the command printed in
it, and the "no requirement" list is itemised by function.

---

### AT-11 — TQL-5 tool qualification files

**Grade A. Roadmap step 9 item 1.**

**Goal.** Four tools now produce certification evidence, and a verification tool that could
fail to detect an error needs DO-330 TQL-5 treatment: Tool Operational Requirements, tests
showing the tool meets them, and tool configuration management. The tools are
`scripts/trace.py`, `scripts/provenance.sh`, the `test/display/` harness and
`test/integration/replay.py`.

**Do.** Per tool, write `docs/certification/tools/<tool>.md`: what it is used for, what it
would mean for it to be wrong, its TORs, its CM state (path and commit), and its
verification. Then make the verification real: `scripts/trace.py`'s three negative paths
(unknown identifier in a tag, a requirement losing its last test, a non-existent parent)
were verified by hand once — turn that into `scripts/trace_test.py` that runs them against
fixtures in a temporary directory, and do the same for `provenance.sh`'s tamper detection.
A tool whose self-test is a memory of someone running it once is not qualified.

**Acceptance.** Four files; `scripts/trace_test.py` passing and runnable from `make check`;
each TOR traced to a self-test case.

---

### AT-12 — Security assessment (DO-326A)

**Grade A. Roadmap step 9 item 3. Analysis only — no code changes.**

**Goal.** A threat assessment of what the unit actually exposes, written from the code
rather than from a template.

**Do.** Enumerate the real attack surface by reading the code: the open Wi-Fi AP
(`main/network.go`, `main/networksettings.go` — WIP, read-only), the unauthenticated HTTP and
WebSocket API including `POST /setSettings` (`main/managementinterface.go` — WIP,
read-only), runtime-loaded addons (`GET /addons` injecting arbitrary JS into the HMI), OTA
with MD5 and no signature (`main/ota.go`), USB device handling (`debian/*.rules`), and the
RF input paths (`dump978`, `dump1090`, `rtl_ais`, OGN). For each: threat, attack path,
effect on the safety functions, and mitigation or accepted risk. Write
`docs/certification/security.md`. Note where a mitigation is already planned elsewhere
(signed OTA is grade C; addons out of the certified configuration is a scoping decision).

**Acceptance.** Every threat traces to a file and a code path you actually read, every
mitigation names its owner, and nothing is asserted that you did not verify in the source.
Propose no exploit code and change no behaviour.

---

### AT-13 — The open problem report register

**Grade A. Roadmap steps 1 and 10.**

**Goal.** Real problem reports exist and are scattered across the roadmap progress log, the
FHA and commit messages. EASA AMC 20-189 and the Software Accomplishment Summary need one
register. The GitHub issue template exists; the in-repo register does not.

**Do.** Write `docs/certification/problem-reports.md` with one row per report: id, title,
affected function, severity, safety-related y/n, version found, version fixed, root cause,
status. Populate it from what is already recorded: the `go vet` campaign findings
(`uatparse.New()` panic on an over-long dump978 line; `common.Distance()` NaN; the
`export-csv.go` `%!(EXTRA …)` rows; the truncated AIRMET numeric object label; the 27
non-constant `log.Printf` calls), `RB-HLR-TRF-330` (specified in a comment, not
implemented), `RB-HLR-TRF-230` (the eight-target circle — an accepted new failure condition
needing a human-factors opinion), and the three `dump978` `strcpy` sites from AT-09. Give
each an id and reference it from the FHA and roadmap rather than restating the detail.

**Acceptance.** Every report in the register traces to a file, a line and the document that
first recorded it. No invented reports, no invented fix versions.

---

### AT-14 — Data chain and integrity (DO-200B / DO-276)

**Grade A. Roadmap step 9 item 2.**

**Goal.** Aeronautical and terrain data feeds the navigation and synthetic-vision displays
with no documented origin and no integrity check: `web/settings/elevations.json` (4.2 MB),
`db.airfields.json`, `db.frequencies.json`, `web/settings/databases/`, and the map tiles
built by `scripts/create_ofm_tiles.sh` / `download_osm_tiles.py`.

**Do.** Write `docs/certification/data.md`: per data set, origin, licence, processing chain
(the script that produced it, with its commit), currency, intended function, and the
"not for navigation" limitation that must appear in the installation manual. Then add the
load-time integrity check — a recorded SHA-256 per data set, verified when it is loaded,
with a defined behaviour when it fails (the display must say the data is unavailable, not
draw unverified terrain) — and requirements plus a test for that behaviour.
`web/settings/elevations.json` is **WIP**: do not edit the file, hash it as it is and note
that the hash must be re-recorded after the owner's change lands.

**Acceptance.** `make check` green; the doc exists; the integrity failure path has a test;
`scripts/provenance.sh` extended if that is the natural home for the hashes.

---

### AT-15 — SBOM and build identity

**Grade A. Roadmap step 1 item 3.**

**Goal.** Make each build describe itself. `syft` is not installed, but `go version -m
stratuxrun` gives the full Go dependency set with versions and hashes for free, and the
image package set is enumerable from `image_build_rb/`.

**Do.** Write `scripts/sbom.sh` producing a per-build SBOM (Go module list with versions and
sums, the C submodule commits, the embedded JS libraries with version and SHA-256, the
`ogn-rx-eu` binary hash, the apt package set) and archive it next to the artifact. Record
the reproducibility procedure (`make ddpkg` twice, compare checksums) and run it if Docker
cooperates here; if it does not, say exactly where it stopped rather than claiming the
property. Do not add `vendor/` or pin the container digest — those are grade C.

**Acceptance.** The script runs in this checkout and its output is committed as a sample;
the gap list (what it cannot enumerate, and why) is in the report.

---

### AT-16 — Coupling analysis for the process split

**Grade A for the analysis. Roadmap step 7 item 1. The refactor itself is grade B.**

**Goal.** Step 7 wants the Level E functions out of the core process. Before anyone moves
code, somebody must know what the Level E code actually touches. Produce that analysis.

**Do.** For each function the FHA puts at Level E (checklist, timers, camera, voice, radio
remote, OTA UI, addons, X-Plane, CoT, charts, export), list every read and write of the
shared globals (`globalSettings`, `globalStatus`, `mySituation`), every goroutine it starts,
every file and port it owns, and every core function that depends on it. Classify each as
data coupling or control coupling, and mark the ones that would break if the function moved
to a second process. Write `docs/certification/sdd-coupling.md` with a table and name the
natural seam (`main/plugin.go`, `main/bridge.go`). **Analysis only — move no code.** End
with a ranked list of what is cheap to extract and what is entangled.

**Acceptance.** Every claim cites a file and line. No code changes.

---

### AT-17 — Close `RB-HLR-TRF-330`: the EFB target count limit

**Grade B.** *Blocked on one decision: the cap and the drop policy.*

**The decision the owner must record first:** how many targets may be transmitted to an EFB,
and which targets are dropped when there are more. Dropping the furthest is the obvious
answer and the one that needs a hazard opinion, because the EFB then silently stops showing
traffic that exists. Until this is recorded, the implementation must not be written.

**Background the agent may prepare now (grade A).** `main/traffic.go` `trafficCycle()`
carries a comment that ForeFlight 7.5 fails at roughly 1000–2000 messages and that the
practical limit is around 500 aircraft, then transmits every current target with no counter,
cap or early exit; the only bound is the 6 s currency limit, which is exactly the
dense-airspace case the comment warns about. Prepare: a design note with the options (cap
by count, by range, by alert relevance; drop silently versus annunciate truncation), the
measurement
(replay a dense log through `test/integration/replay.py` and count the messages per second
actually emitted), and the test that would prove whichever policy is chosen.
`main/traffic.go` is **WIP — read-only**: propose the patch, do not apply it.

**Acceptance for the prepared half.** The design note, the measured numbers, and the
question put to the owner in one paragraph they can answer with a sentence.

---

### AT-18 — EMS requirements across two repositories

**Grade B.** *Blocked on one decision: is the engine display supplemental or primary?*

The FHA row `FHA-EMS-1` is Major if the pilot acts on the parameter and the roadmap scopes
EMS into the first baseline "supplemental only". That limitation has to be a recorded
decision with an installation-manual consequence before the requirements are worth writing,
because it changes the DAL of `rb-ems-go`.

**Preparable now (grade A).** The interface requirements between the two repositories: the
`$RBEMS` sentence set that `rb-ems-go` sends and `main/bridge.go` parses (OAT arrives this
way), the units, ranges and resolutions per channel, the sensor-loss and out-of-range
behaviour, and the `web/settings/ems.json` configuration contract. `main/bridge_test.go`
exists and is a place to trace to. Note in your report that `rb-ems-go` is a separate
repository with its own baseline and no tests, which makes the interface the only place the
two sides can be pinned.

---

## 6. Not agent work (grade C)

Listed so nobody assigns them. Each needs the repository owner, money, a laboratory or a
signature:

- Tag `v2.0-cert-base` on a clean tree; branch protection on `master`; the PR template.
- `go mod vendor` and committing `vendor/`; pinning the container base image by digest.
- Signing keys and signed OTA (`main/ota.go` verifying a signature, not MD5).
- The off-GitHub archive and proving the restore procedure once.
- Booking the first DER/CVE conversation to validate the NORSEE/CS-STAN target — now the
  highest-value hour available, because there are artifacts to show.
- The DO-160G §4 temperature category decision, and the board decision behind it
  (CM5 on an in-house carrier closes four derogations with no software port — see
  [hardware/platform-assessment.md](hardware/platform-assessment.md)).
- Laboratory environmental qualification; thermal uprating campaigns.
- The display-path decision of Step 7 (Chromium as DAL D PDS versus a native renderer),
  which caps the achievable DAL.
- SQA independence: a second person auditing plan compliance.
- The human-factors opinion on `RB-HLR-TRF-230` (one bearingless target drawn as eight).

## 7. Adding a task to this file

A task belongs here when an agent could finish it in this checkout and prove it with a
command. Give it the next `AT-nn`, a grade, the roadmap step, what to read, what is in and
out of scope, and an acceptance criterion that is a command and its expected output — not
"the document is good". If the acceptance criterion cannot be a command, say which human
judges it. If the task needs a decision, make it grade B and write the decision as one
question the owner can answer in a sentence.
