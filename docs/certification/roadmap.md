# RB-01 Certification Roadmap (DO-178C / ED-12C and related standards)

Status: **Steps 1, 2 and 5 in progress; Step 4 has three of nine functions traced.** Owner:
xiaprojects. Drafted 2026-09-12, updated 2026-10-24 (see the Progress log at the end).
This is the ordered list of activities to take the RB-01 avionics software from
"community project" to a package an authority (EASA/FAA) or a DER/CVE can review.
Steps are ordered from the **first, easiest, achievable** to the hardest. Each step is
self-contained and produces value even if the next one never happens.

> Regulatory numbers, routes and eligibility below are a starting structure written by
> engineers, not a DER opinion. Confirm the route (Step 3) with a DER (FAA) / CVE (EASA)
> before spending money on Steps 6–10.

> **Executing this plan.** The open items of Steps 1–9 that can be done in the checkout are
> written up as agent-ready task briefs in [agent-tasks.md](agent-tasks.md), graded by
> whether an agent can finish one alone (A), needs a recorded human decision first (B), or
> is not agent work at all (C). That file is the executable subset of this one; this one
> stays the plan and the reasoning.

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
   both with a DER/CVE before proceeding. Note what the NORSEE policy actually says, because
   it reshapes the whole safety case: *"The overall safety evaluation for non-required
   equipment **assumes the equipment will fail**, regardless of the system or subsystem and
   the probability of such a failure. The safety evaluation must show evidence that such
   failures do not reduce the capability of the aircraft or the ability of the
   pilot/flightcrew to cope with a failure condition worse than minor."* The board's failure
   rate is therefore not the argument — detection and annunciation are. The same policy also
   lets the applicant *propose* the industry standard (the "minimum design requirements"),
   which is what makes a tailored DO-160 set and DAL D credible.
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

> **Done for traffic, attitude and alerting.** The mechanism is in place and enforced:
> [`../../requirements/`](../../requirements/) holds the requirements,
> [standards/requirements.md](standards/requirements.md) is the rulebook, and
> `scripts/trace.py --check` runs from `make check`. 126 requirements; 83 of the 96 HLRs
> verifiable by test are covered, by 95 tags. The thirteen that are not are in the agreed
> budget, and eleven of the thirteen are findings — requirements the equipment does not
> meet — rather than tests nobody has written. Remaining functions: altimetry, speed,
> heading, variometer, EMS, situation.

1. ~~**Pick a text-based, git-native requirements tool.**~~ Neither StrictDoc nor Doorstop
   was adopted: both add a dependency and a build step to a repository that deliberately has
   neither, and the trace they produce is a report rather than a gate. Requirements are plain
   Markdown in a strict, parsed heading-and-fields form, and `scripts/trace.py` (stdlib only)
   produces the matrix and fails the build on an inconsistency. Revisit if the requirement
   count passes roughly a thousand. IDs: `RB-SYS-<FUNC>-nnn` (system),
   `RB-HLR-<FUNC>-nnn` (software), `RB-ICD-<IFACE>-nnn` (interfaces).
2. **Write system requirements** for the core (from the FHA + target memo), then HLRs per
   function: ranges, resolutions, update rates, latency, behaviour on invalid/stale input,
   flags, units, colour/symbology, power-up defaults. Interface requirements for
   `/situation`, `/traffic`, `/alerts`, `/ems` frames and the sensor drivers.
3. **Derived requirements** (design decisions with no parent) are tagged and fed back to
   the safety assessment, as DO-178C requires.
4. **Review** each requirement against the requirements standard with a checklist; record
   the review (a PR review with the checklist is acceptable evidence).
5. ~~**Trace** system → HLR → test.~~ `scripts/trace.py`, wired into `make check`. The
   rules it enforces, and the one it deliberately does not: a tag naming a non-existent
   requirement, a duplicate id, a missing field, a bad parent and a derived requirement
   missing from the FHA are **hard errors**; a requirement with no test is **reported and
   budgeted** in `requirements/untraced.txt`, which may only shrink. A permanently red gate
   trains everyone to ignore it — the same reasoning as `test/display/known.py`.

Deliverables: `requirements/` tree, requirements standard applied, review records, trace
matrix generated in CI (`scripts/trace.py --matrix`). **Exit criterion:** every core
function has reviewed HLRs and zero untraced items.

**Order of attack for the rest.** Traffic was done first because 32 tests already existed
to trace to, which proved the mechanism on real evidence rather than on a sample of three.
Attitude was done second because the FHA ranks it highest, and it was the harder case:
its evidence had to be built — a simulated IMU, every square board mounting, and the
daemon's own attitude loop driven on a fake sensor — before the requirements could be
written at a grain a test can hold. That is the pattern for the rest.

Alerting was done third, out of that order on purpose: it had no test file at all, and the
FHA classifies most of its own rows under it. Specifying it produced the opposite result to
attitude — the function turns out not to meet nine of its own 26 requirements — which is
the other thing this exercise is for. A specification that only ever confirms the code is
not being written honestly.

Next: **altimetry and speed** (`ALT`, `SPD`), whose evidence already exists in
`main/airdata_test.go`, then **heading and the situation** (`HDG`, `SIT`) against
`main/gps_test.go`, then **EMS**. Each open function is written up as an agent-executable
brief in [agent-tasks.md](agent-tasks.md). The nine alerting findings want a decision
before they want code — two of them (no master caution, no re-annunciation of a recurring
failure) change what the FHA may claim — so they are on the review agenda in
[fha.md](fha.md) §5 item 3 rather than in a branch.

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
2. **Display path decision — which is really a board decision.** Either (a) keep
   Chromium/AngularJS as DAL D PDS backed by service history and the HMI test suite, and
   confine addons/non-core plates to a separate "non-certified" page, or (b) implement the
   core instruments natively (a small framebuffer/DRM renderer in Go or C) and keep Chromium
   for the rest. (a) caps you at D; (b) is the door to C and to (E)TSO. The reason is the
   graphics driver: DO-178C DAL A certifiable drivers exist for AMD Embedded Radeon, NXP
   i.MX 8 Vivante and Arm Mali-G78AE, and for **no** Broadcom VideoCore part — so on a Pi,
   (b) is the only DAL-C-capable display path. See
   [hardware/platform-assessment.md §5](hardware/platform-assessment.md).
3. **Health monitoring.** Hardware watchdog (`bcm2835_wdt`) kicked by the core, stale-data
   flags end-to-end (sensor → daemon → HMI, with the times from Step 3), measured Go GC
   pause and worst-case frame latency, power-up time, read-only root FS in the certified
   configuration. On a bare Pi the only watchdog is the SoC's own — the same device that
   computes and draws the data judges its own health (derogation D-9); an independent
   supervisor needs either a carrier-board watchdog or a companion safety MCU.
4. **Multi-core.** AMC 20-193 *"does not apply when the IDALs are all Level D or E"*, so at
   DAL D a quad-core A76 costs nothing. At DAL C the full MCP objective set applies
   (interference channels, WCET under contention) on a SoC with no published cache/memory
   arbitration data. The mitigation is in the AMC's own applicability — it covers *"MCPs
   with two or more activated cores"* — so a certified configuration pinned to **one
   activated core** moves the problem to an AEH configuration argument. The core functions
   do not need four cores; synthetic vision does.
5. **Software Design Description**: architecture, the coupling analysis, and — at C —
   low-level requirements traced from HLRs.

Deliverables: `docs/certification/sdd.md`, refactored process boundary, HIL evidence for
timing/watchdog. **Exit criterion:** the core runs and passes Step 5 with all Level E
software removed.

### Step 8 — Hardware and environmental qualification (DO-160G / ED-14G, DO-254 stance)

*Independent of the software steps; can start any time after Step 3. Effort: 2–3
person-weeks of engineering plus laboratory time (budget in the tens of k€ for a reduced
category set).*

> The platform analysis for this step is written up in
> **[hardware/platform-assessment.md](hardware/platform-assessment.md)**: what the standards
> require of a COTS board, the Raspberry Pi 5 fact sheet, a 12-row derogation register, and a
> graded reference table of ARM64 alternatives. Headline: the Pi 5's **0 °C** lower limit
> meets no DO-160G §4 category, and moving to **CM5 on an in-house carrier** closes that plus
> three other derogations with no software port.

1. **Pick the DO-160G §4 category first.** It is the decision that drives the board choice,
   not the other way round: the mildest standard category (A1) already requires −15 °C
   operating, so a 0…+70 °C board fails every category. Decide §4 before ordering hardware.
2. **Hardware baseline.** BOM with part numbers, revisions and datasheet operating ranges
   (compute board/module and its SoC stepping, display, GY-91-class sensor board, power
   supply, cabling, enclosure), plus the **vendor firmware** versions and hashes (bootloader
   EEPROM, RP1, PMIC configuration) — AMC 20-152A Objective COTS-4 treats unqualified
   microcode as a configuration item.
3. **DO-160 category selection** for the remaining sections, matching the target route. A
   NORSEE/CS-STAN set is typically: §4 temperature/altitude, §5 humidity, §8 vibration,
   §16 power input, §17 voltage spike, §18 audio-frequency susceptibility, §19 induced
   signal, §20 RF susceptibility, §21 RF emission, §25 ESD. Lightning (§22) only if the
   route asks. DO-160 qualifies the **equipment**, not the board — a COTS board inside a
   qualified box is normal practice.
4. **DO-254 / AEH position.** AMC 20-152A states that its use *"is not required for AEH
   contributing to hardware DAL D functions"* (Appendix B.2.4 accepts DO-254, existing
   Level D practices, or a system-level ARP4754A argument). The obligation at DAL D is an
   **Electronic Component Management Plan** per IEC 62239-1 / SAE EIA-STD-4899 (selection,
   qualification, configuration management, datasheet/errata/change-notice access), not
   design assurance. Write it, and state plainly that no public errata list or PCN channel
   exists for the BCM2712 (derogation D-4).
5. **Thermal uprating, if the Pi 5 board is kept.** Objective COTS-3 plus IEC/TR 62240-1 is
   the recognised route for using a device outside its datasheet range, with the data
   *"documented and stored in a controlled, retrievable format"*. Plan it as a test campaign
   across batches, or avoid it by selecting a wide-temperature module.
6. Expect the consumer-grade IMU/baro to fail cold-temperature or vibration limits;
   plan a hardware iteration.

Deliverables: `docs/certification/hardware/{bom,ecmp,eqtp}.md` (the assessment and
derogation register are already in `hardware/platform-assessment.md`), lab test report.
**Exit criterion:** environmental qualification test report with no open failures, and
every derogation in the register either closed by design or carried with its evidence.

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
- [x] `docs/certification/standards/requirements.md` — the requirements standard.
- [x] `requirements/` + `scripts/trace.py` — the traffic function specified and traced
      bidirectionally, enforced by `make check`.
- [x] `docs/certification/hardware/platform-assessment.md` — Pi 5 compliance, the
      derogation register, the graded ARM64 platform table.
- [ ] Book a first conversation with a DER/CVE to validate the NORSEE/CS-STAN target.
- [x] `requirements/RB-HLR-ATT.md` — the attitude function specified (37 requirements) and
      traced to `main/sensors_test.go`, with the attitude system requirements
      (`RB-SYS-ATT-010`…`070`) and the two GDL90 AHRS message interface requirements.
- [x] `requirements/RB-HLR-ALR.md` — the alert function specified (26 requirements), with
      six alerting system requirements (`RB-SYS-ALR-010`…`060`) and the first
      `main/alerts.go` tests. Nine of the 26 are open findings; two of them belong on the
      review agenda before the FHA's Minor classifications can stand.
- [ ] **Next:** altimetry and speed (`ALT`, `SPD`) against `main/airdata_test.go`, then
      heading and the situation (`HDG`, `SIT`) against `main/gps_test.go` — both cheap,
      because the evidence already exists.

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

**2026-10-02 — Step 8 (assessment written).**

- `hardware/platform-assessment.md`: how the standards treat a COTS board, a Raspberry Pi 5
  fact sheet against the vendor datasheets, a 12-entry derogation register, and a graded
  reference table of ARM64 alternatives. Three findings drive the rest: the Pi 5's **0 °C**
  lower limit meets no DO-160G §4 category; AMC 20-152A is *not required* at DAL D and
  AMC 20-193 *does not apply* at DAL D or E; and no certifiable graphics driver exists for
  any Broadcom VideoCore part, which makes Step 7's display-path choice a board choice.
- NORSEE's *"assumes the equipment will fail"* was folded back into Step 3 and the FHA: the
  platform's ~6 × 10⁻⁵/h failure rate makes annunciation, not reliability, the argument.

**2026-10-24 — Step 4 (first function traced), Step 2 (requirements standard).**

- `standards/requirements.md` written: identifier scheme, required fields, phrasing rules,
  derived-requirement handling, the review checklist, and the two rules that keep
  reverse-engineering honest (write what the code *should* do; mark the uncertain ones).
- `requirements/` created with 47 requirements: 9 system (`RB-SYS`), 34 traffic HLRs
  (`RB-HLR-TRF`), 4 GDL90 interface requirements (`RB-ICD-GDL`). Traffic was chosen first
  because 32 unit tests already existed to trace to, so the mechanism could be proved on
  real evidence.
- `scripts/trace.py` enforces the trace from `make check`. 39 `Covers:` tags added to
  existing tests; 35 of 38 HLRs verifiable by test are covered. All three negative paths
  were verified to actually fail the build (unknown identifier in a tag, a requirement
  losing its last test, a parent that does not exist) — a gate that cannot fail is theatre.
- System requirements trace *through* their children rather than to a test of their own,
  so `RB-SYS-SYS-040` (installed-software identification) shows up correctly as having no
  flow-down yet.
- The FHA gained §4, the derived-requirements feedback loop DO-178C asks for: 9 derived
  requirements, each with its effect on the hazard analysis. One is a **new failure
  condition, accepted**: RB-HLR-TRF-230 draws a single bearingless target as eight GDL90
  targets on a circle, a deliberate distortion of the traffic picture, mitigated by being
  off by default and worth a human-factors opinion at the DER review.
- Writing the requirements surfaced one problem report: **RB-HLR-TRF-330, the EFB target
  count limit, is specified in a code comment but does not appear to be implemented**
  (`main/traffic.go` `trafficCycle()` records that ForeFlight 7.5 fails at roughly
  1000–2000 messages, then transmits every current target). Recorded as a requirement with
  low confidence and no test, rather than written up as if the behaviour existed.
- Untraced budget: 3 (`requirements/untraced.txt`) — FLARM PFLAA/PFLAU conformance (no test
  file for `flarm-nmea.go` at all), the target count limit above, and staleness annunciation
  on the traffic display (the HMI half of RB-SYS-SYS-020, same gap as FHA-ATT-3).

**2026-10-24 (second pass) — Step 4 (attitude), Step 5 (attitude tests).**

- `requirements/RB-HLR-ATT.md`: 37 software requirements for the attitude function, plus
  seven attitude system requirements in `RB-SYS.md` and two interface requirements for the
  Stratux (0x4C) and ForeFlight (0x65) AHRS messages. 30 are traced to
  `main/sensors_test.go`, five are verified by analysis with the justification written into
  the requirement as the standard requires, and two are in the untraced budget — both
  findings rather than omissions.
- The attitude evidence was built for the purpose rather than inherited: a simulated IMU
  derived from first principles (the simulator checks its own output against the 1/cos(bank)
  load factor of a coordinated turn), all 24 square board mountings plus out-of-square
  variants, and `sensorAttitudeSender` itself driven on a fake IMU in a child process. Two
  small gaps were closed by writing tests rather than budgeting them (the magnetometer
  dead-axis deadband, the G-meter reset).
- Three findings came out of writing the requirements, all now in the FHA §4 feedback
  table and the untraced budget:
  **(a)** with no GPS ground track the Simple AHRS levels the horizon in a turn and says
  nothing — only the turn rate goes invalid (`RB-HLR-ATT-350`, measured by a test that
  skips with the numbers; the mitigation in force is that a *lost* fix blanks the attitude
  on the EFB interfaces, which does not cover a merely inaccurate one);
  **(b)** the `AHRSEngine` selector selects nothing, because the Kalman branch of
  `newAHRS()` is commented out pending flight test — and selecting `kalman` additionally
  suppresses the engine restart in the loop's recovery branch (`RB-HLR-ATT-360`);
  **(c)** with no IMU, pitch and roll are derived from GPS track changes and published in
  the same fields, distinguished only by a status bit (`RB-HLR-ATT-030`) — a candidate new
  failure condition the FHA's attitude rows were not written for.
- Noted while reading the loop: `SimpleState.Valid()` returns `true` unconditionally, so
  the branch that writes the invalid sentinel into every attitude field is unreachable with
  the shipped engine. Loss of attitude is caught downstream instead, by the 1 s currency
  rule — which the tests do cover.

**2026-10-24 (third pass) — Step 4 (alerting), Step 5 (alert tests).**

- `requirements/RB-HLR-ALR.md`: 26 software requirements for the alert function, plus six
  alerting system requirements in `RB-SYS.md`. 14 are traced to the new
  `main/alerts_test.go` (eight tests), two are verified by analysis — the aural path is
  `exec.Command` on a fixed `aplay` path with no seam a test can observe — one by review
  (the display's ordering of the list), and nine are in the untraced budget as open
  findings.
- Alerting was taken third, before the functions with evidence waiting, because the FHA
  classifies most of its rows under it: `fha.md` §3 item 3 says in as many words that the
  alert function is what keeps FHA-ATT-3, FHA-ALT-3, FHA-SPD-4, FHA-HDG-2 and FHA-TRF-2 at
  Minor. It was the last core function with no test file.
- Specifying it found that it does not carry that weight yet. The nine findings, all in
  the FHA §4 table and the budget, in the order they matter:
  **(a)** there is no master caution — `$scope.alarmIsLit` is set on every alert and bound
  to nothing in any template, and never cleared, so an equipment-level failure is visible
  only on a page the pilot has to choose (`RB-HLR-ALR-230`);
  **(b)** and it is usually inaudible too: the daemon's own audio is off by default and the
  display's `<audio>` element will not autoplay until someone has touched the screen, which
  the code comments say outright (`RB-HLR-ALR-190`);
  **(c)** thirteen of the fifteen failure identifiers are never cleared, so a failure that
  recovers and recurs is annunciated once, for the first occurrence only — the
  intermittent-sensor case (`RB-HLR-ALR-160`);
  **(d)** the two functions the FHA ranks highest are the two the alert cannot name:
  `ahrs-web-start` and `airspeed-sensor-read` fall through to a generic "Danger" with the
  same sound as a full disk (`RB-HLR-ALR-150`);
  **(e)** `/alert/<n>` takes an event type off the network unchecked and the lookup is
  bounded only above, so `GET /alert/-1` panics `pushEvent` — confirmed on this tree. The
  process survives only because `net/http` recovers a panic in a handler goroutine, and the
  display repeats the same one-sided bound in JavaScript, where it empties the alert list
  instead (`RB-HLR-ALR-210`, `RB-HLR-ALR-260`);
  **(f)** `EVENT_MAX_QUEUE = 100` is declared, documented in the display as enforced, and
  not implemented — the trim is a `TODO`, so the list grows for as long as the daemon runs
  (`RB-HLR-ALR-220`);
  **(g)** the alerts list's time column is `textBySeconds(hours * 60 + minutes)` — a count
  of minutes passed to a formatter that reads seconds — so it renders the wall-clock time as
  `mm:ss` and the pilot cannot tell a current failure from one from a previous flight
  (`RB-HLR-ALR-250`);
  **(h)** the daemon's aural annunciation is hard-coded to `en-US` while the display selects
  on the browser's language (`RB-HLR-ALR-200`).
- Two of the tests are data tests rather than behaviour tests, and they earn their place:
  the presentation mapping is addressed by event-type *number* from three places in two
  languages, with nothing in the file saying which row is which, so one test reads the
  `EVENT_TYPE_` constants straight out of `main/alerts.go` and checks every row against
  them, and the other checks that every sound the mapping names exists both as the `.wav`
  the daemon plays and the `.mp3` the browser plays. A row inserted in the middle of that
  file silently relabels every alert after it.
- Noted while reading: four event types (`EVENT_TYPE_UNKOWN_INFO`, both autopilot
  engage/disengage types and `EVENT_TYPE_EMS_GENERIC_FAILURE`) have rows, text and sounds
  and are raised by nothing in the daemon or the RB-01. The EMS one matters for the EMS
  function's own requirements (agent-tasks.md AT-18), which have an alerting path specified
  for them and no code behind it.
- Unrelated to alerting, found because `make check` runs the whole suite: **HEAD was red.**
  `3d02953c` ("shadow aircraft ... FLARM #149") disabled the 500 ft vertical agreement check
  in `isOwnshipTrafficInfo()`, which `TestOwnshipFilter` — committed earlier, in `f5caad94` —
  asserts. The commit is right and the test was written against the behaviour before it, so
  the test's expectation and `RB-HLR-TRF-130` were corrected to say "horizontal", and the
  decision is now recorded as `RB-HLR-TRF-135` (derived) with its own FHA §4 row: the
  equipment was raising a FLARM collision warning about its own transponder loopback during
  aerobatics, and what it accepts in exchange is suppressing a *different* aircraft that
  transmits this aircraft's Mode S address 1000 ft away. That is the trade the review should
  see, and it is exactly the kind of decision a requirements trace exists to catch — the
  behaviour changed in one commit, and nothing but the gate noticed that two other artifacts
  now described something the equipment no longer did.

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
