# RB-01 Certification Roadmap (DO-178C / ED-12C and related standards)

Status: **Step 1 and Step 2 in progress** (see Progress log at the end). Owner: xiaprojects.
Drafted 2026-09-12, updated 2026-09-14.
This is the ordered list of activities to take the RB-01 avionics software from
"community project" to a package an authority (EASA/FAA) or a DER/CVE can review.
Steps are ordered from the **first, easiest, achievable** to the hardest. Each step is
self-contained and produces value even if the next one never happens.

> Regulatory numbers, routes and eligibility below are a starting structure written by
> engineers, not a DER opinion. Confirm the route (Step 3) with a DER (FAA) / CVE (EASA)
> before spending money on Steps 6–10.

---

## 0. Reality check before starting

### What certification is, and is not

- **DO-178C never certifies software on its own.** It is invoked by an aircraft or equipment
  approval: TC/STC, minor change, (E)TSO authorisation, or a "non-required equipment" route.
  So the first real decision is *which function, on which aircraft class, through which
  route* — that fixes the **Development Assurance Level (DAL)** and with it ~70 % of the work.
- **The DAL comes from the system safety assessment** (ARP4754A / ARP4761 FHA), not from the
  software team. Objectives per level: A = 71, B = 69, C = 62, **D = 26**, E = 0.
  DAL D drops low-level requirements, source-code review, structural coverage and most
  "conformance to standards" objectives. DAL C adds all of those plus statement coverage.
- **Legacy code is explicitly allowed.** DO-178C §12.1.4 ("Upgrading a development baseline")
  is the path for software written without DO-178C: reverse-engineer requirements from the
  existing code, then verify against them. This roadmap follows that path.

### The stack, as certification sees it

| Component | Reality | Consequence |
|---|---|---|
| Raspberry Pi OS (Linux kernel, systemd, Chromium) | Millions of lines of COTS with no requirements, tests or coverage; no DO-178C pedigree | Above DAL D this is a blocker. At D, arguable as **previously developed software** with **service history** (DO-178C §12.3.4) plus robustness testing. |
| `stratuxrun` (Go 1.24, ~25 k LOC, one process, shared globals) | No qualified compiler, garbage collector, goroutine scheduler; statement coverage via `go test -cover`; no MC/DC tooling | Fine at D, workable at C, not realistic at B/A. Everything in one process shares the **highest DAL of that process** (no partitioning). |
| RB-01 HMI (AngularJS 1.4.6 EOL, Three.js, OpenLayers, ~12 k LOC) | Renders the safety-relevant data; runs in Chromium; addons inject arbitrary JS at runtime (`GET /addons`) | Display path assurance is the second-hardest problem after the OS. Addons must be **out** of the certified configuration. |
| `dump978` (C, ~3.7 k LOC), `dump1090`, `rtl_ais` submodules | Source available; one known unbounded `strcpy` on RF input (`docs/tech-debt/modernization.md`) | Certifiable as PDS at D with a coding standard + robustness tests. |
| `ogn-rx-eu` prebuilt binary, `EMSDrivers/*.py` | No source / no process | Cannot be in the certified baseline. Scope out or replace. |
| OTA (`main/ota.go`) | MD5 integrity only, no signature | Fails "software load control" (Table A-8) and DO-326A. Needs signed packages. |
| Sensors (BMP388/ICM-20948 on a GY-91-class board) | Consumer/automotive grade, no aviation environmental data | DO-160 (Step 8) will decide; expect temperature/vibration findings. |
| Upstream Stratux merges | Periodic uncontrolled merges from `stratux/stratux` | Each merge becomes a change request with impact analysis (§12.1.1) once a baseline is frozen. |

### Functions and where they will land (to be confirmed by the FHA in Step 3)

| Function | Files | Likely worst failure (non-required install) | Likely DAL | In first baseline? |
|---|---|---|---|---|
| Attitude, airspeed, altimeter, VSI, turn/slip, heading, G | `main/sensors.go`, `main/gps.go`, `sensors/`, `SixPackInstruments.js` | Hazardously misleading attitude in IMC → Major (Hazardous if used as primary) | D (C if primary) | **Yes — the core** |
| Alerts (stale data, sensor loss, limits) | `main/alerts.go`, `alerts.js` | Missing alert → Major | D | **Yes** |
| Traffic display (ADS-B/UAT/OGN/FLARM/AIS) | `main/traffic.go`, `radar.js` | Misleading target → Minor/Major | D | Yes |
| EMS engine display | `main/ems.go`, `bridge.go`, `ems.js` | Misleading engine data → Major if primary, Minor if supplemental | D | Yes (supplemental only) |
| Synthetic vision, HSI/VOR, map, weather | `synthview.js`, `hsi.js`, `map.js`, `uatparse/` | Misleading terrain → Major; depends on DO-200B data quality | D | Second baseline |
| Autopilot guidance out (`$GPRMB`/`$GPAPB` to an external AP) | `main/autopilot.go`, `autopilotudp.go` | Wrong steering to a coupled AP → Major | C/D | **No** — scope out ("not for coupled AP") |
| GPIO switchboard | `main/switchboard.go` | Wrong load switching → Major | C/D | **No** |
| Checklist, timers, camera, voice, radio remote, OTA UI, addons, X-Plane, CoT, charts | rest of `main/` and plates | No safety effect | E | No — must be shown not to interfere |

### Realistic targets, in order of reach

1. **Microlight / ultralight / experimental (today's market).** No avionics certification is
   legally required (national ULM rules, FAA experimental). Adopting a DO-178C-shaped process
   is voluntary and a commercial differentiator. Everything in Steps 1–7 applies.
2. **"Non-required, safety-enhancing" installation in certified light aircraft.**
   FAA policy PS-AIR-21.8-1602 (**NORSEE**) and EASA **CS-STAN** standard changes let
   supplemental attitude/traffic/engine displays into Part 23 / ELA aircraft with a
   manufacturer's declaration, a reduced DO-160 set and DAL D-level software evidence, on the
   condition that failure is Minor. This is the **recommended first regulatory target**.
3. **ASTM F3153** ("Verification of Avionics Systems") with F3061/F3230/F3227: the LSA /
   Part 23 Level 1–2 consensus-standard route. Lighter than DO-178C; the same artifacts
   (requirements, tests, traceability, CM) satisfy it.
4. **(E)TSO authorisation** (e.g. ETSO-C113a multipurpose display, ETSO-C195b ADS-B In,
   ETSO-C4c attitude): full DO-178C at the DAL required by the MPS, DO-160, DO-254 for
   hardware. Requires the assurance architecture of Step 7 and most likely a re-implemented
   display path. Multi-year.
5. **Primary flight display under STC/TC.** Not realistic on this platform.

---

## Step-by-step plan (easiest first)

Effort figures are order-of-magnitude for one developer plus a part-time independent
reviewer; re-estimate after Step 3. "Objectives" cite DO-178C Annex A tables.

### Step 1 — Freeze and control the baseline (configuration management)

*Objectives: Table A-8 (all six), A-1 obj. 3. Effort: 1–2 person-weeks. Prerequisites: none.*

Why first: it is almost entirely tooling already in the repo, and every later artifact is
worthless if the thing it describes cannot be rebuilt bit-for-bit.

1. **Clean tree, tagged baseline.** Commit or shelve work in progress, tag `v2.0-cert-base`.
   All later certification work is measured as a delta from this tag.
2. **Pin everything.** Submodules by commit (already), Go modules (`go mod vendor`, commit
   `vendor/`), Docker base image by digest in `Dockerfile`, Raspberry Pi OS image version and
   the exact `apt` package set recorded in `image_build_rb/`, embedded JS libraries listed
   with version and SHA-256, the `ogn-rx-eu` binary recorded with SHA-256 and upstream
   commit (or removed from the certified configuration).
3. **Reproducible, identified builds.** Embed the git SHA and dirty flag into
   `stratuxVersion`/`stratuxBuild` (`main/gen_gdl90.go`), show them on the HMI and in
   `/getStatus`; `make ddpkg` twice must produce identical `.deb` checksums; generate an SBOM
   per build (`go version -m stratuxrun`, `syft`) and archive it with the `.deb`.
4. **Change control.** GitHub branch protection on `master` (PR + CI green, no direct push).
   Issue template gains fields: *affected function*, *severity (safety-related y/n)*,
   *version found*, *version fixed*, *root cause*. Every commit references an issue. Upstream
   Stratux merges become explicit change requests.
5. **Archive and retrieval.** A bare mirror of the repo + submodules + toolchain container +
   released `.deb`/images, stored off GitHub. Document the restore procedure and prove it once.
6. **Software load control.** Sign release packages (GPG/minisign); `main/ota.go` verifies
   the signature, not just MD5. Record which units run which version.

Deliverables: `docs/certification/scmp.md` (short Software Configuration Management Plan),
CI changes, issue template. **Exit criterion:** any tagged release can be rebuilt identically
from the archive by someone else, and every change since the tag traces to an issue.

### Step 2 — Standards and static analysis, enforced by CI

*Objectives: A-1 obj. 5, A-5 obj. 4 (C+), supports A-9. Effort: 1–2 person-weeks.*

Mechanical, and it turns the CI from "it compiles" into a gate.

1. **Go:** `gofmt -l`, `go vet`, `staticcheck`, `golangci-lint` with a committed config,
   `govulncheck`, `go test -race ./...`. Zero findings on the baseline, or documented
   accepted findings.
2. **C (`dump978/`, and `dump1090`/`rtl_ais` as PDS):** `-Wall -Wextra -Werror`, `cppcheck`;
   adopt a MISRA-C:2012 subset for `dump978` with a deviation log. Fix the unbounded
   `strcpy` in `uat_decode.c` as the first tracked safety-related problem report.
3. **JavaScript (RB-01 plates/services):** ESLint strict config (no build step needed to
   lint). Forbid `eval`/dynamic script injection in the core plates.
4. **Write the three standards** DO-178C asks for: `standards/requirements.md` (ID scheme,
   "shall" phrasing, verifiability, derived-requirement rule), `standards/design.md`,
   `standards/code.md` (Go/C/JS rules, complexity limits, forbidden constructs, review
   checklist).
5. **CI runs the tests:** `make test`, `go test ./...`, and `test/display/run.py` headless
   (Chromium is present on GitHub runners). Failure blocks the merge.

Deliverables: `.golangci.yml`, `.eslintrc`, `docs/certification/standards/*.md`, CI job.
**Exit criterion:** CI is red on lint or test failure; the standards are referenced by the
PR template.

### Step 3 — Preliminary FHA and the certification target memo

*Objectives: system-level (ARP4754A/ARP4761), DO-178C §2. Effort: 1–2 person-weeks plus one
DER/CVE consultation day.*

A table exercise, cheap, but it decides the DAL and therefore everything after it.

1. **Functional Hazard Assessment.** For each function in the table above: failure modes
   (loss, hazardously misleading, frozen/delayed, uncommanded), flight phase, effect on the
   aircraft and crew, severity (Minor/Major/Hazardous/Catastrophic), mitigations (required
   instruments remain installed, flags on stale data, pilot cross-check), resulting DAL.
   State the installation assumptions explicitly — "supplemental, non-required, the
   aircraft's required instruments remain" is what keeps most rows at Major or below.
2. **Scope the certified core** versus Level E "must not interfere" software. Recommended
   first core: sensors → situation → PFD instruments → alerts, plus traffic display.
   Explicitly scoped out of the first baseline: coupled-autopilot output, GPIO switchboard,
   addons, camera, voice, radio, OTA UI, X-Plane/CoT.
3. **Choose the route** (NORSEE / CS-STAN / ASTM F3153 / ETSO) and the target DAL. Validate
   both with a DER/CVE before proceeding.
4. **Derived safety requirements** fall out of the FHA and feed Step 4: stale-data flagging
   times, power-up time, behaviour on sensor loss, watchdog, SD-card power-cut survival
   (the overlay root FS in `image_build_rb/` already helps).

Deliverables: `docs/certification/fha.md`, `docs/certification/target.md` (route, DAL,
scope, assumptions, limitations to appear in the installation manual). **Exit criterion:**
a DER/CVE agrees the target is credible.

### Step 4 — High-level requirements for the core, with traceability

*Objectives: A-2 obj. 1–2, A-3 obj. 1–2–6 (D) / all (C). Effort: 6–10 person-weeks.*

The largest gap. Reverse-engineer from what exists (DO-178C §12.1.4): `docs/http-api.md`,
`docs/settings-reference.md`, `docs/integration/gdl90.md`, `docs/hardware/sensors.md`,
`docs/architecture.md` and the `test/display/` suite are de-facto requirements already.

1. **Pick a text-based, git-native requirements tool** so requirements are reviewed in PRs
   like code: StrictDoc or Doorstop (both open source, both produce traceability matrices).
   Requirement IDs `RB-SYS-…` (system), `RB-HLR-<FUNC>-nnn` (software), `RB-ICD-…`
   (interfaces).
2. **Write system requirements** for the core (from the FHA + target memo), then HLRs per
   function: ranges, resolutions, update rates, latency, behaviour on invalid/stale input,
   flags, units, colour/symbology, power-up defaults. Interface requirements for
   `/situation`, `/traffic`, `/alerts`, `/ems` frames and the sensor drivers.
3. **Derived requirements** (design decisions with no parent) are tagged and fed back to
   the safety assessment, as DO-178C requires.
4. **Review** each requirement against the requirements standard with a checklist; record
   the review (a PR review with the checklist is acceptable evidence).
5. **Trace** system → HLR → test (Step 5). A script in CI fails when an HLR has no test or
   a test has no HLR.

Deliverables: `requirements/` tree, requirements standard applied, review records, trace
matrix generated in CI. **Exit criterion:** every core function has reviewed HLRs and
zero untraced items.

### Step 5 — Requirements-based verification and coverage

*Objectives: A-6 obj. 1–2–5, A-7 obj. 3 (D); A-7 obj. 1–2–4–5 and statement coverage (C).
Effort: 8–12 person-weeks, then continuous.*

Builds on assets that already exist: the HMI harness, the flight-log replay, `test-data/`.

1. **Go unit tests (`*_test.go`)** starting where it is cheapest and most valuable: the pure
   functions in `common/` (aviation equations, magnetometer maths), `uatparse/`, the sensor
   fusion in `main/sensors.go`, traffic dedup/extrapolation in `main/traffic.go`. Normal-range
   and **robustness** cases (out-of-range, NaN, stale, malformed frames) per HLR.
2. **HMI tests as requirements-based tests.** Each `test/display/` test names the HLR IDs it
   covers. Add the missing cases the FHA asks for: stale-data flag within *n* ms, red-X on
   sensor loss, power-up time, no console errors across a full replayed flight.
3. **Hardware-in-the-loop replay.** Replay recorded flights (`test-data/flightlog-sample.sqlite`,
   the trace replay flags of `stratuxrun`) on the real Pi build, compare outputs against
   golden results. This is the "executable object code on target" evidence (A-6 obj. 5).
4. **Coverage.** `go test -coverprofile` (statement) for the Go core; `gcov/lcov` for
   `dump978`. Not required at D, required at C — collect it from day one; unreached code is
   either dead (see `docs/tech-debt/dead-code.md`), deactivated, or missing a requirement.
5. **Reviews.** Code review checklist from the code standard applied to every core PR;
   at C, LLR/design reviews as well.
6. **Verification records** per release: `verification/results-<version>.md` generated
   from CI (pass/fail per test, coverage, open problem reports).

Deliverables: `go test` suites, updated `test/display/`, HIL procedure, coverage report,
Software Verification Cases & Procedures (SVCP) and Results (SVR) generated from CI.
**Exit criterion:** 100 % of core HLRs have passing tests on target; coverage report
reviewed; every unreached line explained.

### Step 6 — Write the plans and get them reviewed (PSAC, SDP, SVP, SQAP)

*Objectives: A-1 (all), A-9 obj. 1, A-10 obj. 1–2. Effort: 3–4 person-weeks plus DER/CVE
review fees.*

In a greenfield project the plans come first. On a legacy baseline it is more honest and
much faster to write them once Steps 1–5 have proven the process on real artifacts.

1. **PSAC** (Plan for Software Aspects of Certification): system overview, the FHA/DAL,
   life-cycle, the PDS/COTS strategy for Linux/Chromium/Go runtime (service history +
   robustness), the deactivated/scoped-out functions, tool qualification stance, schedule.
   This is the document the authority actually reads.
2. **SDP / SVP / SCMP (Step 1) / SQAP**, each short and pointing at the concrete mechanisms
   already in the repo (CI jobs, PR template, trace script) rather than describing an ideal.
3. **SQA independence.** DO-178C requires SQA to be independent of development at every
   level including D. A solo developer needs a second person: a contracted QA/DER who
   audits plan compliance and signs the conformity review.
4. **Stage of Involvement #1 (planning review)** with the DER/CVE. Expect findings; fold
   them back into Steps 1–5.

Deliverables: `docs/certification/plans/{psac,sdp,svp,sqap}.md`, review records.
**Exit criterion:** PSAC accepted (or agreed in principle) by the DER/CVE.

### Step 7 — Assurance architecture: partition the core

*Objectives: A-2 obj. 3, A-4 obj. 8–9–13 (D) / all (C), §2.4 partitioning. Effort: 8–16
person-weeks; much more if the display path is re-implemented.*

The step that decides whether anything above DAL D is ever reachable.

1. **Split the process.** Move the Level E functions out of `stratuxrun` into a second
   process (or disable them in the certified configuration) so the core process can claim
   a single DAL. The existing plugin/bridge boundaries (`main/plugin.go`, `main/bridge.go`)
   are the natural seam. Document data and control coupling.
2. **Display path decision.** Either (a) keep Chromium/AngularJS as DAL D PDS backed by
   service history and the HMI test suite, and confine addons/non-core plates to a separate
   "non-certified" page, or (b) implement the core instruments natively (a small
   framebuffer/DRM renderer in Go or C) and keep Chromium for the rest. (a) caps you at D;
   (b) is the door to C and to (E)TSO.
3. **Health monitoring.** Hardware watchdog (`bcm2835_wdt`) kicked by the core, stale-data
   flags end-to-end (sensor → daemon → HMI, with the times from Step 3), measured Go GC
   pause and worst-case frame latency, power-up time, read-only root FS in the certified
   configuration.
4. **Software Design Description**: architecture, the coupling analysis, and — at C —
   low-level requirements traced from HLRs.

Deliverables: `docs/certification/sdd.md`, refactored process boundary, HIL evidence for
timing/watchdog. **Exit criterion:** the core runs and passes Step 5 with all Level E
software removed.

### Step 8 — Hardware and environmental qualification (DO-160G / ED-14G, DO-254 stance)

*Independent of the software steps; can start any time after Step 3. Effort: 2–3
person-weeks of engineering plus laboratory time (budget in the tens of k€ for a reduced
category set).*

1. **Hardware baseline.** BOM with part numbers, revisions and datasheet operating ranges
   (Pi 5, display, GY-91-class sensor board, power supply, cabling, enclosure).
2. **DO-160 category selection** matching the target route. A NORSEE/CS-STAN set is
   typically: §4 temperature/altitude, §5 humidity, §8 vibration, §16 power input,
   §17 voltage spike, §18 audio-frequency susceptibility, §19 induced signal,
   §20 RF susceptibility, §21 RF emission, §25 ESD. Lightning (§22) only if the route asks.
3. **DO-254 position.** The Pi and sensors are COTS; at DAL D the obligation is an
   Electronic Component Management Plan (sourcing, obsolescence, lot control), not DO-254
   design assurance. Write it.
4. Expect the consumer-grade IMU/baro to fail cold-temperature or vibration limits;
   plan a hardware iteration.

Deliverables: `docs/certification/hardware/{bom,ecmp,eqtp}.md`, lab test report.
**Exit criterion:** environmental qualification test report with no open failures.

### Step 9 — Tools, data and security (DO-330, DO-200B/DO-276, DO-326A)

*Effort: 3–5 person-weeks. After Steps 4–5.*

1. **Tool qualification (DO-330).** Verification tools that could fail to detect an error
   (the `test/display/` harness, the coverage tool, the trace script) are **TQL-5**: Tool
   Operational Requirements + tests showing the tool does what the TORs say + tool CM.
   Compilers (`go`, `gcc`) stay unqualified; the argument is that their output is verified
   by testing on target.
2. **Aeronautical and terrain data (DO-200B, DO-276).** `elevations.json`/terrain, the
   airfields database and map tiles feed synthetic vision and navigation displays. Define
   origin, processing chain, integrity check (CRC on load), currency and the "not for
   navigation" limitation; or scope synthetic vision out of the first baseline.
3. **Security (DO-326A/ED-202A, DO-356A).** Threat assessment of: open Wi-Fi AP with an
   unauthenticated HTTP/WebSocket API, unsigned OTA, runtime-loaded addons, USB devices.
   Mitigations: signed OTA (Step 1), addons disabled in the certified configuration, API
   restricted to the local AP with authentication for `POST /setSettings`, USB whitelist via
   udev (already partially there in `debian/*.rules`).

Deliverables: `docs/certification/tools/`, `docs/certification/data.md`,
`docs/certification/security.md`. **Exit criterion:** every tool used as evidence has a
TQL-5 file; every data set has a documented chain; every threat has a mitigation or an
accepted risk.

### Step 10 — Authority liaison and the final package

*Objectives: A-10 obj. 1–3, A-9 obj. 5. Effort: 3–4 person-weeks plus authority calendar
time (months).*

1. **Software Configuration Index (SCI)** and **Software Life Cycle Environment
   Configuration Index (SECI)**: the exact tags, hashes, toolchain images and build steps
   that make the certified release — mostly generated from Step 1.
2. **Software Accomplishment Summary (SAS):** compliance with each objective, deviations,
   open problem reports with their justification (EASA AMC 20-189 for OPR management).
3. **Stage of Involvement audits** #2 (development), #3 (verification), #4 (final) with
   the DER/CVE, or the equivalent conformity review under NORSEE/CS-STAN.
4. **Installation and limitations documentation** for the installer/pilot, carrying the
   assumptions from the FHA.

Deliverables: `sci.md`, `seci.md`, `sas.md`, installation manual. **Exit criterion:** the
authority/DER accepts the package for the chosen route.

---

## Phases and rough timeline

| Phase | Steps | Calendar (one dev + part-time reviewer) | Depends on |
|---|---|---|---|
| A. Foundations | 1, 2 | 1 month | — |
| B. Scope and requirements | 3, 4 | 2–3 months | A |
| C. Verification | 5 | 2–3 months, then continuous | B |
| D. Plans and first authority contact | 6 | 1 month | A–C |
| E. Assurance architecture | 7 | 2–4 months | B, D |
| F. Hardware, tools, data, security | 8, 9 | in parallel with C–E | 3 |
| G. Package and audits | 10 | 3–6 months of calendar time | all |

Order-of-magnitude total: 40–60 person-weeks of engineering plus laboratory and DER/CVE
costs; 12–18 months to a DAL D package for the scoped core on the NORSEE/CS-STAN route.
Anything requiring DAL C or an ETSO adds the native display path of Step 7 and roughly
doubles the effort.

## What can start this week

- [ ] Tag the baseline (`v2.0-cert-base`) on a clean tree; enable branch protection on
      `master` (GitHub settings — needs the repository owner).
- [x] `make check` = `gofmt` (leaf packages) + `go vet` (all packages, now clean) +
      `go test` + provenance hash check; wired into `.github/workflows/ci.yml`. The HMI
      suite already runs in `display-tests.yml`. `staticcheck`/`golangci-lint` still to add.
- [x] Build id = commit SHA with `-dirty` suffix, shown on the RB-01 OTA screen and in
      `/getStatus`.
- [x] `docs/certification/provenance.md` + `scripts/provenance.sh` — 40 artifacts hashed and
      verified by `make check`.
- [x] `.github/ISSUE_TEMPLATE/problem-report.yml` — version found/fixed, function, severity,
      safety-related, root cause.
- [x] `docs/certification/fha.md` — assumptions, the seven PFD instruments, skeleton for the rest.
- [x] `common/equations_test.go`, `uatparse/uatparse_test.go` — 17 tests, golden UAT frame.
- [ ] Book a first conversation with a DER/CVE to validate the NORSEE/CS-STAN target.

## Progress log

**2026-09-14 — Step 1 (partial), Step 2 (partial), Step 3 (skeleton), Step 5 (started).**

- `make check` gate added and green; CI job `check` runs it in the build container.
- Bringing `go vet` to zero surfaced and fixed real defects, now the first entries of the
  problem-report log: `uatparse.New()` panicked on an over-long dump978 line (would take
  the daemon down); `common.Distance()` returned NaN for some identical coordinates;
  `export-csv.go` appended `%!(EXTRA …)` to every CSV row (20 args, 16 verbs); the AIRMET
  numeric object label was truncated to 8 bits; 27 `log.Printf(nonConstant)` calls, several
  on RF/network-derived strings, converted to `log.Print`; six unreachable statements removed.
- Deliverables written: `scmp.md` (with its pending-action table), `provenance.md`, `fha.md`.
- Not done, needs the owner: baseline tag, branch protection, signed OTA, off-GitHub
  archive, `go mod vendor`, container image pinned by digest.

## Standards referenced

| Standard | Scope | Used in step |
|---|---|---|
| DO-178C / ED-12C (+ FAA AC 20-115D, EASA AMC 20-115D) | Airborne software | all |
| DO-330 / ED-215 | Tool qualification | 9 |
| DO-332 / ED-217 | Object-oriented and related techniques (Go interfaces/closures, JS) | 4, 7 |
| DO-254 / ED-80 (+ AC 20-152A, AMC 20-152A) | Airborne electronic hardware | 8 |
| DO-160G / ED-14G (+ AC 21-16G) | Environmental qualification | 8 |
| ARP4754A / ED-79A, ARP4761 / ED-135 | System development and safety assessment (FHA) | 3 |
| AC 23.1309-1E, CS-23 / AMC 23.1309, ASTM F3230 | Failure-condition classification → DAL for small aircraft | 3 |
| FAA PS-AIR-21.8-1602 (NORSEE), EASA CS-STAN | Non-required safety-enhancing equipment routes | 3, 10 |
| ASTM F3153, F3061, F3227 | LSA / Part 23 consensus-standard verification and environmental testing | 3, 5, 8 |
| DO-200B / ED-76A, DO-276 / ED-98 | Aeronautical and terrain data quality | 9 |
| DO-326A / ED-202A, DO-356A / ED-203A, DO-355 | Airworthiness security | 9 |
| EASA AMC 20-189 | Open problem report management | 10 |
| (E)TSO-C113a, -C195b, -C4c, -C10b, -C2d, -C3e, -C6e, -C8e | Minimum performance standards if the ETSO route is ever taken | later |
