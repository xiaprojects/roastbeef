# Avionics Standards and Open Source Audit

This document records what being open source changes about RB-01's path to the avionics
standards: which standards apply, the pros and cons of each open-source decision, which
premises in the [certification roadmap](../certification/roadmap.md) did not survive a
reading of the primary texts, and a prioritized backlog. It is a companion to the roadmap,
the [modernization audit](modernization.md) and the [provenance inventory](../certification/provenance.md).

The audit was produced by reading the regulatory texts where they are public, abstracts
where they are not, and this repository. Each entry under [References](#references) is graded by
how much of it was actually read. Nothing here has been changed yet. **This is an engineer's
reading, not a DER/CVE opinion and not legal advice**: §3.3 and §4.5 need a lawyer, and §4 needs
a DER (FAA), a CVE or a Part 21 design organisation (EASA) before anyone spends money on it.

Last updated: 2026-11-04.

## Summary

1. **No avionics standard forbids open source.** DO-178C asks for evidence, not for a licence.
   The joint RTCA/EUROCAE committee's charter describes its open-source supplement as
   explaining ["how the existing documents allow for the incorporation"][sc240-r6] of such software.
   Open source earns no credit and costs none. What it gives is source access, without which
   the evidence cannot be produced at all.
2. **On this stack the realistic ceiling stays DAL D.** Linux has been [certified to Level
   D][vanderleest-2023], so the roadmap's target has precedent. The Level A effort measured only
   [about 7 % MC/DC coverage][illinois] from Linux's existing tests. No precedent was found
   for a web browser as a certified display path at any level.
3. **The EU half of the roadmap's first regulatory target does not work as written.** CS-STAN
   is not a European NORSEE. A secondary attitude indicator under CS-SC060a needs ETSO-level
   compliance *and* a prior certified installation. An awareness function under CS-SC062a needs
   neither. The route has to be chosen function by function (§4.2).
4. **Selling the unit removes the open-source shelters in EU product law.** RB-01 is
   [priced at €2,500][competitors]. The Product Liability Directive applies to products placed on the
   market after **9 December 2026**. The Cyber Resilience Act's reporting duty has applied since
   **11 September 2026**, and it excludes only products *certified* under Regulation 2018/1139.
5. **The licence is the most urgent debt and the cheapest to fix.** The BSD-3 notice was dropped
   from `LICENSE`, the current wording is not clearly an open-source grant, and signed OTA
   (roadmap Step 1.6) collides with AGPL §6 unless it is designed around it (§3.3).
6. **Service history is a weaker argument than the roadmap assumes.** The FAA's own report says
   history for software outside configuration control [should not be used as evidence][ar125], and
   the committee writing the guidance reports [areas with no consensus][sc240-r6].

Roadmap Steps 1, 2, 4 and 5 stay right under every route: requirements, trace, tests and
configuration management are what every route asks for. What changes is the Step 3 target, the
order of Step 8, and the design of Step 1.6.

### Decisions this audit needs

| # | Decision | Owner | Why now |
| --- | --- | --- | --- |
| 1 | Legal review of `LICENSE`, CRA and PLD exposure | Owner + lawyer | PLD date is five weeks away; the CRA reporting duty is already running |
| 2 | Which CS-STAN change each RB-01 function targets, or whether the first EU product is an awareness device only | Owner + CVE/DOA | It decides what is sold into certified aircraft and what is DAL D work for nothing |
| 3 | Is the first certified market EU or US? | Owner | NORSEE is written for a U.S. manufacturer (§4.1) |
| 4 | OTA signing design: owner-enrolled keys and an out-of-baseline flag | Owner | Must be settled before Step 1.6 is built, not after |
| 5 | What certification evidence stays public (§3.4) | Owner | Every push to a public repository is irreversible |

## Priority legend

| Tier | Meaning |
| --- | --- |
| 🔴 Blocking | A wrong premise or a legal date. Address first. |
| 🟢 Quick win | Low risk, self-contained, high return. |
| 🟡 Needs decision | Blocked on a human or external decision, not on engineering. |
| 🔵 Strategic | Large effort; plan as its own project. |

---

## 1. The standards landscape

"Access" matters to an open project: a paid document cannot be read by most contributors and its
text cannot be pasted into this repository. "State" is what could be confirmed on the audit date.

### Software assurance

| Standard | Covers | State on 2026-11-04 | Access | For RB-01 |
| --- | --- | --- | --- | --- |
| DO-178C / ED-12C | Software objectives by level | Current. Recognised by [AC 20-115D][faa-sw] (2017). No AC 20-115E found | Paid | Baseline of the roadmap |
| **DO-395 (provisional) / ED equivalent** | Incorporating COTS and open-source software | Being written by [SC-240 / WG-117][sc240]. Charter Rev 6 projected [publication March 2026][sc240-r6]; publication **could not be confirmed**. Level C/D first; Level A/B [projected October 2028][sc240-r6]. The number comes from [a 2024 article][csc] and may change | Paid when issued | **The most relevant document in this audit, and absent from the roadmap** |
| Report on Product Service History (RTCA RR) | Service-history equivalence | Projected [December 2025][sc240-r6]; publication not confirmed | Not checked | Tests the roadmap's PDS argument |
| DO-330 / ED-215 | Tool qualification | Current | Paid | TQL-5 for the harness, coverage and trace tools |
| DO-332 / ED-217 | Object-oriented techniques | Current | Paid | Go interfaces and closures, JavaScript |
| DO-331 / ED-218, DO-333 / ED-216 | Model-based and formal supplements | Current | Paid | Only if a model or a proof is claimed as evidence (§3.6) |
| [AC 20-148][ac148] | Reusable software components | Active (2004), written around DO-178B | Free | Not needed at the target level |
| AC 20-193 / AMC 20-193 | Multi-core processors | [FAA January 2024, EASA 2022][ac193] | Free | [Does not apply at Level D or E](../certification/roadmap.md) (roadmap Step 7.4) |
| AMC 20-189 | Open problem reports | As cited by the roadmap | Free | Step 10 |

### Hardware, environment and system safety

| Standard | Covers | State on 2026-11-04 | Access | For RB-01 |
| --- | --- | --- | --- | --- |
| DO-254 / ED-80 + AC 20-152A | Airborne electronic hardware, COTS devices | [AC 20-152A active (2022)][faa-sw] | Paid / free | Not required at DAL D, per [platform assessment](../certification/hardware/platform-assessment.md) |
| DO-160G / ED-14G | Environmental qualification | **DO-160H imminent**: the joint plenary of 31 Aug–3 Sep 2026 had a [motion to proceed to publication][do160h] | Paid | Fix which revision Step 8 tests to |
| ARP4754B / ED-79B | System development | [Released 20 December 2023][dmd], supersedes the roadmap's ARP4754A | Paid | Read B; AC 20-174 still [recognises A][ac174] (no revision found) |
| ARP4761A / ED-135 | Safety assessment | Now [holds the detail moved out of ARP4754B][dmd] | Paid | The roadmap's "ARP4761 / ED-135" pairs the old SAE number with the new ED number |
| AC 23.1309-1E, ASTM F3230 | Failure classification to DAL | Open item in [fha.md §5](../certification/fha.md) | Free / paid | Step 3 |

### Data and security

| Standard | Covers | State on 2026-11-04 | Access | For RB-01 |
| --- | --- | --- | --- | --- |
| DO-200B / ED-76A, DO-276 / ED-98 | Aeronautical and terrain data | As cited by the roadmap, not re-checked | Paid | Synthetic vision, airfields, map tiles |
| DO-326A / ED-202A, DO-356A / ED-203A, DO-355 | Airworthiness security | As cited by the roadmap, not re-checked | Paid | Open Wi-Fi API, unsigned OTA, addons |

### Light-aircraft routes

| Standard | Covers | State on 2026-11-04 | Access | For RB-01 |
| --- | --- | --- | --- | --- |
| [PS-AIR-21.8-1602][norsee] (NORSEE) | Non-required safety equipment, parts 23/27/29 | In force, dated 31 March 2016 | Free | §4.1 |
| [CS-STAN Issue 4][csstan] | EASA standard changes | Dated 27 April 2022. Latest issue that could be verified; re-check | Free | §4.2 |
| [ASTM F3264-24][part23] with F3061-22b, F3227-22, F3230-21a | Part 23 means of compliance | Accepted, published 20 May 2025, with changes. **F3153 does not appear** in that notice | Paid | §4.3 |
| [ASTM F3815-26a, F3834-26 and others][mosaic] | MOSAIC light-sport category | Accepted, effective on publication, scheduled for 16 July 2026 | Paid | §4.3 |

### EU product law

| Regulation | Covers | State on 2026-11-04 | Access | For RB-01 |
| --- | --- | --- | --- | --- |
| [Cyber Resilience Act, 2024/2847][cra71] | Security of products with digital elements | Article 14 reporting since 11 Sep 2026; all of it from 11 Dec 2027 | Free | §4.5 |
| [Product Liability Directive, 2024/2853][pld] | Liability for defective products, including software | Applies to products [placed on the market after 9 Dec 2026][pld-hl] | Free | §4.5 |

---

## 2. Open source against the standards: pros and cons

### Pros

| # | Pro | Evidence | What it means here |
| --- | --- | --- | --- |
| P1 | Nothing forbids it | SC-240 explains how [existing documents allow it][sc240-r6] | The objection "open source cannot be certified" is wrong as a matter of text |
| P2 | Source access is what makes evidence possible | [COTS often lacks source][csc], and DO-178C §12.1.4 upgrades a baseline by reverse-engineering requirements from the code | Already paying off: writing alert requirements exposed [nine open findings](../certification/roadmap.md), which no black-box component would have allowed |
| P3 | Outsiders can find defects, including in the tools | The Illinois/Boeing team could [measure Linux coverage and test the coverage tools][illinois] only because both are open | The same reasoning supports public tests in `test/display/` and `scripts/trace.py` |
| P4 | Assurance evidence can be shared | ESA publishes the [RTEMS qualification data package][rtems-qdp] for end users to build on | A model for a reusable "core" evidence set |
| P5 | Licensing friction goes away | JPL found it [easier to open-source F´ than to license it][zdnet] | Fits a small team |
| P6 | Market differentiator | All four EFIS competitors are [closed][competitors] | Real, but worth nothing to a regulator |
| P7 | Continuous, CI-driven process is compatible | DO-178C [does not block Agile][ribeiro]; [continuous certification with open-source tooling][baron] has been evaluated on an industrial case | Matches `make check` as the gate |

### Cons

| # | Con | Evidence | What it means here |
| --- | --- | --- | --- |
| C1 | No pedigree | Open source has an [unknown development pedigree][csc]; objectives assume plans, requirements and reviews that upstream never produced | Applies to Linux, Chromium, dump1090, Go modules: see [provenance.md](../certification/provenance.md) |
| C2 | Service history does not transfer | History for software not under configuration control ["should not be used as evidence since there is no confidence in the data or software"][ar125]. Written against DO-178B §12.3.5 | Debian's or Chromium's field use is not this image's history. Hours only count from a frozen, identified release (AOS-10) |
| C3 | Upstream moves, a baseline must not | Open-DO named this the ["big-freeze" problem][opendo]. Under NORSEE ["the software revision is approved as part of that configuration"][norsee] | Every upstream merge and OTA release is a design change. Roadmap line 43 still says Go 1.24 while `go.mod` needs 1.27 |
| C4 | Accountability cannot be crowdsourced | NORSEE needs a [certifying statement, a quality system and failure reporting][norsee] (§1.6.2.6, §1.6.2.8, §1.9); DO-178C needs independent SQA at every level | A named legal entity carries all of it, whatever the licence says |
| C5 | The right to modify leaves the approved configuration | AGPL grants modification; an approval covers one revision | Needs a visible out-of-baseline state on the unit (§3.3) |
| C6 | A commercial product gets no open-source shelter | PLD excludes only software ["outside the course of a commercial activity"][pld]; a CRA manufacturer is anyone [marketing under its name, paid or free][cra3] | README's disclaimer protects a free download, not a €2,500 unit (§4.5) |
| C7 | Open tools are not automatically correct | Open-source coverage tools were found [unclear, misleading or incorrect][illinois] in many cases | The roadmap's `go test -cover` and gcov need known-answer tests before they count as evidence (AOS-08) |
| C8 | The standards themselves are closed | The DLR thesis names ["reliance on expensive standards and software"][friedrich] as the barrier to entry | Contributors cannot check conformance, and standard text cannot go in this repository |
| C9 | Published defects are published to attackers too | `GET /alert/-1` and the `uat_decode.c` `strcpy` are written up in this repository | Harmless for a hobby receiver, a CRA vulnerability-handling matter for a product |

---

## 3. Decisions, with pros and cons

### 3.1 Linux and Chromium in the core

| Pros of keeping them as previously developed software | Cons |
| --- | --- |
| [Level D precedent for Linux][vanderleest-2023] | [ELISA says][elisa] DO-178C life-cycle data for a kernel this size is a major undertaking |
| No port; synthetic vision keeps working | No precedent found for Chromium at any level |
| AMC 20-193 does not apply at Level D | No certifiable graphics driver for any Broadcom VideoCore part ([roadmap Step 7](../certification/roadmap.md)) |
| NORSEE ["assumes the equipment will fail"][norsee], so the argument is annunciation, not kernel reliability | Service history is weak (C2); SC-240 itself [lacks consensus][sc240-r6] on parts of it |
| | A [2026 preprint][preprint] argues Linux is unsuitable at DAL A/B. Not peer-reviewed and not read in full |

**Verdict:** keep both for Level D, and argue the safety case from detection and annunciation
rather than from service history. That makes the [nine open alert findings](../certification/roadmap.md)
more important than any work on the OS. A native display path stays the door to Level C.

### 3.2 Go in the core

| Pros | Cons |
| --- | --- |
| Memory safety removes a class of defect that C needs a coding standard to manage | No qualified compiler, a garbage collector, a scheduler |
| The test and trace infrastructure already exists | `go test` coverage modes are statement-only (`go help testflag`): no decision or MC/DC data, so the stock tool cannot support Level B or A |
| Compilers stay unqualified at Level D if the output is verified on target (roadmap Step 9) | Toolchain moves quickly (C3) |

Alternatives for a future Level C native path: Rust with [Ferrocene][ferrocene], an open-source
toolchain qualified to ISO 26262 and IEC 61508, whose vendor says it supports customer efforts
toward DO-178C DAL C (a vendor claim, not a qualification), or C with MC/DC from
[`clang -fcoverage-mcdc`][clang-cov] or `gcc -fcondition-coverage` (present in GCC 15.2 here).
[Friedrich's thesis][friedrich] shows ARINC 653 work in Rust.

**Verdict:** stay on Go for Level D. Do not rewrite anything for assurance reasons until a
Level C function has a customer.

### 3.3 Licence model

Facts from this repository:

- `LICENSE` was BSD-3 until `0f58148b` (2025-10-15), which replaced it with "All rights reserved.
  For personal use apply the AGPL-3. For commercial use the agreement is available". 3,149 of
  3,408 commits predate that change.
- BSD-3 requires redistributions to retain the copyright notice, conditions and disclaimer. Neither
  `LICENSE` nor a `NOTICE` file carries them now. **This looks like a defect today, independent of
  every other decision here.**
- AGPL §10 forbids further restrictions on the rights granted, and has no field-of-use term. "For
  personal use" is therefore either meaningless or a restriction, and the CRA defines free and
  open-source software as licensed with [all rights to access, use, modify and redistribute][cra3].
  The [marketing claim](../product/competitor-features.md) "Open source (AGPL-3 and commercial)"
  depends on how this reads.
- `CONTRIBUTING.md` has no contributor agreement. Without one, code contributed under AGPL cannot
  go into the commercial edition.
- AGPL §6 (`agpl-3.0.txt:285-322`) requires "Installation Information" for a **User Product**,
  meaning a consumer product, with doubtful cases "resolved in favor of coverage". Whether a
  light-aircraft EFIS is one is arguable. The exemption is narrow: it applies only if nobody
  retains the ability to install modified code, and OTA retains it.
- AGPL §13 requires offering source to users of a modified version over a network. The web UI
  carries no licence notice or source offer (no match in `web/RB-01/plates`).

| Option | Pros | Cons |
| --- | --- | --- |
| **A. AGPL plus commercial, wording fixed** | Competitors cannot close a fork; fixes flow back; the owner can still sell | §6 applies if a User Product; needs a CLA or similar; AGPL discourages integrators |
| **B. A + vendor-signed certified image alongside a community build** | Separates "approved configuration" from "modifiable software" cleanly; matches NORSEE's per-revision approval | Two configurations to label and support; needs A's contributor rights |
| **C. Back to permissive, as upstream** | Simplest; no §6; upstream merges stay clean | Anyone can ship a closed fork and reuse the evidence |

**Verdict:** B, subject to the lawyer. Design Step 1.6 so that the unit verifies a vendor signature
by default, the owner can enrol their own key, and any non-vendor image reports itself out of
baseline on the display and in `/getStatus`. §6 explicitly does not require support or warranty for a
modified unit, so this meets the licence and DO-178C load control at once. [AC 20-115D][faa-sw]
also carries guidance on field-loadable and user-modifiable software that should be read
before finalising it.

### 3.4 Public or private certification evidence

| Pros of publishing | Cons |
| --- | --- |
| A DER/CVE or customer can inspect it directly | Under AGPL a competitor can reuse what the project paid to produce |
| Tests and requirements improve from outside review (P3) | Open findings become public exhibits in any liability claim |
| Follows the [RTEMS][rtems-qdp] model | Standard text cannot be quoted, so some documents cannot be complete in public |

**Verdict:** keep requirements, trace and tests public: they are already the project's strongest
asset. Keep the PSAC, SAS, authority correspondence, lab reports and per-unit records private.

### 3.5 Interfaces

| Interface | Openness | In RB-01 | Pros | Cons |
| --- | --- | --- | --- | --- |
| GDL90 | Public Garmin ICD | [Core output](../integration/gdl90.md) | Every EFB reads it | Single vendor owns it |
| NMEA 0183, `$PGRMH` | Paid NMEA spec; [Garmin sentences published][pgrmh-doc] | [Autopilot output](../integration/nmea-navigation-output.md) | Works with installed autopilots and the G5 | Spec cannot be read freely |
| `$RBATT` / `$RBAIR` | [Documented here](../integration/slave-nmea-display-format.md) | RB-09 slave display | Open, with test vectors | Own format; to be checked against NMEA's `$P…` proprietary framing (spec not read) |
| FLARM | Proprietary; [reception is licensed][safesky] | Via prebuilt `ogn-rx-eu` | Large installed base; [CS-SC051d][csstan] names it | No source; [outside the baseline](../certification/provenance.md) |
| ADS-L | [EASA-published][adsl-easa], with FLARM's [involvement][flarm-adsl] | Only through `ogn-rx-eu` | Open European route to the same traffic, [open implementations exist][openace] | [About 3.3 % of tracked traffic][adsl-stats] on one blog's figures |
| ARINC 429 / 825 | Paid; [ARINC 825 derives from CANaerospace][cia-825] and uses [29-bit identifiers only][kvaser] | [429 out of scope](../integration/nmea-navigation-output.md) | The language of certified avionics | Cost; little value in this market |
| DroneCAN, Cyphal | [Cyphal: MIT code, CC-BY spec, no approval needed][cyphal]; [DroneCAN open][dronecan] | None | Free, modern, CAN FD | UAV ecosystem, no EFIS peers |
| MAVLink | [MIT definitions, LGPLv3 generator][mavlink] | None | Free | UAV ecosystem |
| FIX / CAN-FiX | Open project ([pyEfis][pyefis], GPL-2.0) | None | Closest open community | Small |

**Verdict:** no change now. The one interface worth action is OGN/ADS-L reception, because a
source-built receiver removes the only unversioned binary in the product (AOS-13).

### 3.6 Architecture models: OAAM, ARINC 653, FACE

[Annighöfer (SAE 2019-01-1383)][annighoefer-2019] presents the **Open Avionics Architecture
Model**: a technology-independent, deliberately simple domain model for designing and configuring
Integrated Modular Avionics, usable offline or online, on the argument that AADL and similar
models serve other purposes and lack that rigidity. Only the abstract was available; the full
paper is paywalled. The code is at [ComplexAvionicsSystems/OAAM][oaam] under EPL-1.0: nine
layers (Library, Scenarios, Systems, Functions, Hardware, Anatomy, Capabilities, Restrictions,
Allocations), 12 stars, last push 15 September 2021, and its [README][oaam-fork] targets Eclipse 4.6.

| Pros | Cons |
| --- | --- |
| A rigorous vocabulary for functions, hardware, restrictions and allocations | Built for many functions on many IMA modules; RB-01 is one process on one board |
| Would make the RB-01/RB-09 split and Step 7 coupling analysis explicit | Eclipse/EMF dependency, against the repository's [no-dependency, no-build-step rule](../certification/roadmap.md) that rejected even StrictDoc and Doorstop |
| Open licence; as a separate tool, EPL-1.0 raises no linking question | Dormant since 2021 |
| Could feed automated checks | A model counts as evidence only under DO-331, which adds work |
| | Self-organisation conflicts with certification: the follow-up paper says [predetermined behaviour conflicts with adaptive systems][annighoefer-2021] and needs a qualifiable model database and a virtual qualification authority. RB-01's runtime addons are excluded from the baseline for the same reason |

**Verdict:** do not adopt. Use its layers as the headings of the Step 7 design description, which
takes the useful part at no cost. Revisit if RB grows into several networked boxes.

**ARINC 653 / IMA (DO-297):** not applicable to one process. The Step 7 process split is a useful
first step but gives no time or space partitioning guarantee. **FACE** is an [open standard, not
open source][face], aimed at military airborne software, with no value in this market.

---

## 4. What the routes actually say

### 4.1 FAA NORSEE (PS-AIR-21.8-1602)

Read in full. Where it differs from roadmap lines 69–73:

- **It is written for U.S. manufacturers.** Section 1 covers design and production approval ["to a
  U.S. manufacturer"][norsee] under §21.8(d), and the sample letter allows transfer "to another U.S.
  manufacturer". §1.6 says "an individual or manufacturer" and does not resolve it. Whether an
  EU maker qualifies directly, through a bilateral, or needs a U.S. entity is an open question.
- **It names neither DO-178C nor DO-160 nor a DAL.** The applicant [proposes the standard][norsee] and
  the FAA accepts, adds to or rejects it (§1.1–1.2). The roadmap's "reduced DO-160 set and DAL
  D-level evidence" is a reasonable proposal, not something the policy grants.
- **It is an FAA letter of approval, not a manufacturer's declaration**, though the applicant does
  sign a certifying statement (§1.6.2.8), and it requires a quality system (§1.9).
- **Approval is not installation.** Equipment ["becomes eligible for installation"][norsee]; a major
  alteration still needs an STC or field approval.
- **Above-minor failures fall to §2**, which means §xx.1309 compliance, with ARP4754A and AC 23.1309-1E
  as reference documents. The roadmap's condition that failure stays Minor is correct for §1.
- It asks for what the alert findings say RB-01 lacks: system status ["should be conveyed to the
  pilot"][norsee] (§1.5). A placard "Not for use as a primary…" may also be required (§1.6.2.7).

Precedent: the AV-20-S display was [approved under NORSEE in March 2019][av30], and the AV-30-C that
followed it received a full [STC in September 2020][av30], which is the pattern to copy. Dynon went
straight to an [STC in 2018][dynon], then to [592 models][dynon-592], selling hardware at
[experimental prices][kitplanes]. All of these are closed products.

### 4.2 EASA CS-STAN Issue 4

The roadmap treats CS-STAN as equivalent to NORSEE. It is not: there is no application to an authority
and no general rule for non-required equipment, only a list of specific changes, each with its
own conditions. Eligible aircraft are generally aeroplanes that are not complex motor-powered
aircraft, plus ELA2.

| RB-01 function | Closest change | Conditions in the text | Reachable? |
| --- | --- | --- | --- |
| Secondary attitude | [CS-SC060a][csstan] | Complies with ETSO-C4c and ETSO-C113 or equivalent, **and** certified on a similar aircraft by EASA or a bilateral authority | **No**, on this stack |
| Non-required basic instruments, including bank and pitch | [CS-SC401d][csstan] | Digital multifunction displays are barred except where "the basic instrument is not required". That branch sets no ETSO condition, but needs an AFM supplement "for situational awareness only". Not for pilot-owner release | **Possibly.** How this overlaps with CS-SC060a is the first question for the CVE |
| Engine display, optional (Configuration 1) | [CS-SC208a][csstan] | Awareness placard, no Table 1 requirement, but the installation "has been certified on a similar aircraft" | Only by following a certified installation |
| Engine display, replacing instruments (Configuration 2) | [CS-SC208a][csstan] | Authorised to each ETSO. Table 1: software Level C for fuel flow, pressure, quantity and any combined unit; Level D for fire detection and tachometer | **No**: Level C |
| FLARM traffic | [CS-SC051d][csstan] | Systems "based on the specifications as defined by FLARM Technology Ltd." | Not for an OGN-based receiver, unless the CVE accepts CS-SC062a |
| GNSS, moving map | [CS-SC052d][csstan] | Situational awareness; no connection to an AFCS or a required system | Likely; check remaining conditions |
| Checklists, nearby aerodromes, calculators, OAT, a combined display of existing cockpit data | [CS-SC062a][csstan] | New installations on VFR aircraft only (exchange only on IFR aircraft). No ETSO. Parts eligible without an EASA Form 1. Excludes anything covered by another change | **Yes: the natural first EU product** |

Two effects on the roadmap:

- **Environmental evidence.** [CS STAN.42][csstan] asks that the manufacturer has *declared* the
  equipment suitable, in a document or even an email. The annex never mentions DO-160 or ED-14, so
  Step 8's "tens of k€" laboratory campaign is not a precondition of the changes that carry no
  ETSO condition (an ETSO brings its own qualification). A declaration still needs a basis (§4.5),
  so bench-test temperature and vibration first and buy full DO-160 only if a route demands it.
- **Software level.** None of the changes above except Configuration 2 of CS-SC208a states a software
  level. The DAL D work is still worthwhile as a defence and for later routes, but it is not what
  opens the CS-STAN door.

CS-STAN applies to EASA aircraft. It does not apply to the microlights and homebuilts that are
the roadmap's first target market.

### 4.3 ASTM and MOSAIC

- **Part 23:** the FAA [accepted ASTM F3264-24][part23] with changes, including F3061/F3061M-22b
  (systems and equipment), F3227/F3227M-22, F3230-21a and F3117/F3117M-23a (crew interface). F3153,
  which the roadmap names as the route (lines 74 and 641), does not appear in that notice. Check
  how software is actually handled before planning around it.
- **MOSAIC:** the FAA [accepted F3815-26a][mosaic] for light-sport airplanes, with F3836-26 for gliders,
  F3840-26 for powered lift and F3841-26 for gyroplanes. For §22.135 *Instruments and equipment* the
  functional standards include **F3834-26** (systems and equipment), F3737-25 and F3768-26a (IFR
  in IMC). F3833-26, a guide on computer-based control systems, is referenced for §22.185, but the
  FAA says it is not required and has made no determination of its suitability. None of these
  was read: they are paid. This is the route closest to RB-01's market in the US, and the roadmap
  does not cover it.

### 4.4 Microlight and homebuilt

These are outside EASA's certification system and under national rules, and this remains the actual
market. No avionics certification is generally required, so DO-178C-shaped work is a voluntary
differentiator, as the roadmap says. National rules were **not** researched country by country.

### 4.5 EU product law

- **PLD 2024/2853.** Software is a product. The exclusion covers only free and open-source software
  ["developed or supplied outside the course of a commercial activity"][pld] (Art. 2(2)), and
  liability to an injured person cannot be limited or excluded [by contract][pld] (Art. 15). It
  applies to products [placed on the market after 9 December 2026][pld-hl]. Open-source components
  inside a commercial product [do not exempt the product][heydata].
- **CRA 2024/2847.** Article 2(3) excludes products ["certified"][cra2] under Regulation 2018/1139, and
  [the reasoning][cra-r27] is that certification already gives the assurance. An uncertified unit sold for
  microlights and homebuilts is not certified, so on this reading it is **in scope**. A company that
  sells products built on its own open-source project carries [manufacturer duties on the commercial
  side][greenbone]. Dates are in [Article 71][cra71]: Article 14 reporting from 11 Sep 2026, Chapter IV
  from 11 Jun 2026, everything else from 11 Dec 2027.
- **Why this matters technically.** Roadmap Steps 1 and 9 (SBOM, signed updates, vulnerability
  handling, an authenticated API) are CRA-shaped work whatever happens with certification, so they
  gain a legal reason and a date.

How these apply to a unit installed in a microlight or homebuilt, and whether a national approval
could count as certification, are questions for a lawyer. No guidance specific to light aviation
was found.

---

## 5. Precedents

| Project | Openness | Assurance reached | Lesson |
| --- | --- | --- | --- |
| **Linux** | GPL-2.0 | [Certified to Level D][vanderleest-2023]. Level A is research: [Zhang et al.][zhang] won best of conference at DASC 2025; [7 % MC/DC][illinois] from existing tests. [ELISA][elisa] runs a working group | RB-01's target has precedent; the Level A work is not close |
| **RTEMS SMP** | Open source | [ESA qualification data package][rtems-qdp], [ECSS category C and D][rtems-org], tied to specific LEON processors | The best model of open evidence, funded by an agency |
| **Zephyr** | Apache-2.0 | [Concept approval][zephyr] toward IEC 61508 SIL 3, not a certificate. Scope is a kernel subset | Integrator keeps drivers, toolchain and application |
| **Ferrocene** | Open toolchain | [Qualified][ferrocene] to ISO 26262 and IEC 61508; DO-178C is a stated direction | Open code, with paid qualification as the business |
| **seL4** | Open source | [Formally proven][sel4-dw], [flown on a Boeing Little Bird][sel4-heli] in a DARPA test. No DO-178C approval found | Proof is not certification evidence by itself |
| **Xen** | GPL-2.0 | [ARINC 653 on Xen][xen-ieee] prototyped; [DornerWorks aimed][xen-dw] at Level A. No approval found | Ambition ages without a customer |
| **F´ on Ingenuity** | Open source | [Flew on Mars][fprime] on Linux and a Snapdragon, outside aviation certification | Shows capability, not assurance |
| **pyEfis** | [GPL-2.0][pyefis] | None claimed | The closest open peer |
| **ArduPilot, PX4** | Open source | None established in this audit | Different market; no route to borrow |

No open-source EFIS with an airworthiness approval was found.

---

## 6. Backlog

| ID | Item | Where | Action | Tier |
| --- | --- | --- | --- | --- |
| AOS-01 | BSD-3 notice dropped | `LICENSE`, no `NOTICE` | Restore the upstream notice and disclaimer; add `NOTICE` for third parties | 🔴 |
| AOS-02 | Licence wording | `LICENSE`, `competitor-features.md:90` | Lawyer rewrites it as a clear AGPL grant plus a commercial alternative | 🔴 |
| AOS-03 | PLD and CRA not assessed | No document | Legal assessment; check CRA Article 14 reporting obligations now | 🔴 |
| AOS-04 | Roadmap merges NORSEE and CS-STAN | `roadmap.md:69-73`, Step 3 | Split them; carry the §4.2 table into `target.md` | 🔴 |
| AOS-05 | OTA design conflicts with AGPL §6 | `main/ota.go:71,185`, `scmp.md:72` | Signature, owner key, out-of-baseline flag before Step 1.6 (§3.3) | 🔴 |
| AOS-06 | No contributor terms | `CONTRIBUTING.md` | Choose CLA or inbound=outbound; without it, keep contributions out of the commercial build | 🟡 |
| AOS-07 | Stale citations | `roadmap.md:43,638,641` | Go 1.27; ARP4754B/ED-79B and ARP4761A/ED-135, noting AC 20-174 still cites A; re-check F3153; add F3834-26 and DO-160H | 🟢 |
| AOS-08 | Coverage tools unproven | Roadmap Step 5.4, 9.1 | Known-answer tests for `go test -cover` and gcov, as the TQL-5 core | 🟢 |
| AOS-09 | No watch list | Roadmap | Track DO-395 and its ED twin, the service-history report, AC 20-115E, DO-160H, CS-STAN Issue 5+ | 🟢 |
| AOS-10 | Service-history clock not running | `scmp.md:75`, `provenance.md:31-32` | Freeze an image; log unit-hours per build id and problem reports per version, as NORSEE §1.13 suggests | 🟢 |
| AOS-11 | No licence surface in the UI | `web/RB-01/plates` | Add licence notice and source link to the OTA or about page | 🟢 |
| AOS-12 | Buy and read DO-395 if issued | Roadmap Steps 6–7 | Rewrite the PDS strategy against it; **do not freeze the PSAC before this** | 🟡 |
| AOS-13 | Proprietary receiver | `ogn-rx-eu`, `provenance.md` | Assess a source-built OGN/ADS-L receiver | 🔵 |
| AOS-14 | First EU product undefined | Step 3, `fha.md` A3 | Scope an "awareness device" under CS-SC062a as a first baseline | 🟡 |
| AOS-15 | Evidence publication rule | `scmp.md` | Write the public/private split of §3.4 | 🟡 |
| AOS-16 | Step 8 ordering | Roadmap Step 8 | Bench-test temperature and vibration; defer the DO-160 campaign until a route requires it | 🟡 |

### Suggested order

1. **Now:** AOS-01 to AOS-03. Legal, with dates attached.
2. **Before the first DER/CVE conversation:** AOS-04, AOS-07, AOS-09. That conversation is the
   roadmap's open item, and §4 is its agenda.
3. **Before Step 1.6 starts:** AOS-05, AOS-06.
4. **Alongside Step 5:** AOS-08, AOS-10, AOS-11.
5. **After the route is agreed:** AOS-12, AOS-14, AOS-16, then AOS-13.

---

## 7. Literature

No thesis was found that treats open-source software under DO-178C directly. That is a gap in the
literature or in what can be searched, and the closest work is below.

**Theses**

- Annighöfer, [*Model-based Architecting and Optimization of Distributed Integrated Modular
  Avionics*][annighoefer-2015], Dr.-Ing., TU Hamburg, 2015 (Shaker, ISBN 9783844034202). The meta-model
  behind OAAM; the publisher reports up to 75 % optimisation potential over manual design.
- Paz Loboguerrero, [*A DO-178C-compliant model-driven approach…*][paz], PhD, ÉTS Montréal, 2020.
  Consistency and traceability across models, explicitly traced to DO-178C objectives.
- Friedrich, [*Platform-Based Approach for Avionics Application Software*][friedrich], MSc, TU
  Clausthal, 2022 (DLR-IB-FT-BS-2022-198). A Rust ARINC 653 API, with a Linux-only hypervisor for
  prototyping, and portability shown against a proprietary hypervisor.

**Papers**

- Annighöfer, [*An Open Source Domain-Specific Avionics System Architecture Model…*][annighoefer-2019], SAE
  2019-01-1383, *SAE Int. J. Adv. & Curr. Prac. in Mobility* 1(2):429-446. See §3.6.
- Annighöfer et al., [*Challenges and Ways Forward for Avionics Platforms…*][annighoefer-dasc], DASC 2019.
- Annighöfer et al., [*The Concept of an Autonomic Avionics Platform…*][annighoefer-2021], arXiv 2021.
- Kalliamvakou, Weber, Knauss, [*Certification of Open Source Software: A Scoping Review*][kalliamvakou],
  OSS 2016. Finds little empirical evidence on effectiveness; argues for evidence from the code.
- VanderLeest, [*Avionics Linux*][vanderleest-2023], and VanderLeest and Stewart, [*Enabling Linux in
  Aerospace Applications*][vanderleest-stewart], DASC 2023.
- Zhang et al., [*An Open-Source Structural Coverage Tool for DO-178C Compliance*][zhang], DASC 2025.
- Ribeiro, Silva, Aguiar, [*Beyond Tradition: Evaluating Agile feasibility in DO-178C…*][ribeiro], arXiv 2023.
- Baron, Louis, [*Framework and tooling proposals for Agile certification…*][baron], 2023.
- Morris, [*2Fly with RPi*][morris], 2017. Raspberry Pi 3 B for experimental glass cockpits.
- FAA, [*Software Service History Report*][ar125], DOT/FAA/AR-01/125, and the
  [Handbook, DOT/FAA/AR-01/116][faa-research], both written against DO-178B.

---

## 8. Not verified

- **Whether DO-395 is published**, under what number, and what it says. This is the largest unknown in
  this document. No FAA or EASA recognition was found either.
- **CS-STAN's current issue.** Issue 4 is the newest confirmed; a later one may change §4.2.
- **The full SAE paper**, the IEEE papers and every paid standard: abstracts or metadata only.
  The VanderLeest Level D statement rests on the abstract.
- **Preprints.org** blocked access, so [the 2026 Linux preprint][preprint] is cited from search results.
- **CRA and PLD text** came from mirrors, because EUR-Lex blocked the fetch. Confirm clauses against the
  Official Journal, and check whether the CRA has since been amended.
- **ASTM status of F3153**, and how F3061 or F3834 handle software.
- **DO-160H publication.** The motion was on the agenda; the outcome was not found.
- **National microlight and homebuilt rules**, and CE/radio equipment rules for a device with Wi-Fi
  and receivers. Neither was researched.

## References

Grades: **[P]** primary text read for this audit. **[A]** abstract, metadata or part only.
**[S]** secondary source. Vendor and blog sources are marked as such in the body where they matter.

Regulation and standards:

- [P] [FAA PS-AIR-21.8-1602, NORSEE][norsee] (third-party copy of the FAA policy)
- [P] [EASA CS-STAN Issue 4, ED Decision 2022/009/R][csstan]
- [P] [RTCA SC-240 Terms of Reference Rev 6, March 2025][sc240-r6]
- [S] [RTCA SC-240 committee page][sc240]; [CS Canada on the COTS supplement, June 2024][csc]
- [A] [FAA software and AEH guidance page][faa-sw]; [AC 20-148][ac148]; [AC 20-174][ac174]
- [S] [AC 20-193 summary (Green Hills, vendor)][ac193]; [ARP4754B update summary][dmd]
- [A] [RTCA SC-135 / WG-14 plenary agenda, July 2026][do160h]
- [P] [FAA Part 23 means of compliance notice, 2025-08985][part23]
- [P] [FAA light-sport consensus standards notice, FAA-2026-6965][mosaic] (AVweb copy)
- [P] [DOT/FAA/AR-01/125, Software Service History Report][ar125]; [A] [FAA research reports][faa-research]
- [P, mirror] [CRA Article 2][cra2], [Article 3][cra3], [Article 71][cra71]; [S] [Recital 27][cra-r27]
- [P, mirror] [PLD Articles 2 and 15][pld]; [S] [Hogan Lovells on the PLD][pld-hl]; [heyData on the PLD][heydata]
- [S] [Greenbone on the CRA and open source][greenbone]

Open-source projects and precedents:

- [P] [University of Illinois on Linux and DO-178C, February 2026][illinois]; [A] [ELISA seminar][elisa]
- [A] [RTEMS SMP QDP (ESA)][rtems-qdp]; [rtems.org][rtems-org]; [S] [Zephyr status interview][zephyr]
- [A] [Ferrocene 26.02 (vendor)][ferrocene]; [DornerWorks on seL4][sel4-dw]; [DornerWorks on Xen][xen-dw]; [Xen ARINC 653 paper][xen-ieee]
- [S] [seL4 helicopter test][sel4-heli]; [GitHub on Ingenuity][fprime]; [ZDNet on Ingenuity][zdnet]; [Open-DO interview][opendo]
- [P] [ComplexAvionicsSystems/OAAM metadata][oaam]; [fork README][oaam-fork]; [pyEfis][pyefis]; [MAVLink licence][mavlink]
- [A] [UAVCAN/Cyphal specification][cyphal]; [DroneCAN][dronecan]; [Clang coverage docs][clang-cov]; [EASA ADS-L FAQ][adsl-easa]
- [S] [CiA paper on ARINC 825][cia-825]; [Kvaser on ARINC 825][kvaser]; [FLARM on ADS-L][flarm-adsl]; [SafeSky on FLARM licensing][safesky]; [OpenAce][openace]; [ADS-L statistics blog][adsl-stats]
- [S] [AOPA on the AV-30-C and AV-20-S][av30]; [Dynon first STC][dynon]; [Dynon 592 models][dynon-592]; [Dynon pricing][kitplanes]; [FACE overview][face]

Internal: [roadmap](../certification/roadmap.md), [FHA](../certification/fha.md),
[provenance](../certification/provenance.md), [SCMP](../certification/scmp.md),
[platform assessment](../certification/hardware/platform-assessment.md),
[competitor features](../product/competitor-features.md).

[norsee]: https://vb.taylorcraft.org/filedata/fetch?id=185031
[csstan]: https://www.easa.europa.eu/en/downloads/136407/en
[sc240-r6]: https://www.rtca.org/wp-content/uploads/2025/04/SC-240-TOR-Rev-6-Approved-2025-03-2013.pdf
[sc240]: https://www.rtca.org/sc-240/
[csc]: https://www.cscanada.ca/cots-software-aerospace-development-rtca-supplement/
[faa-sw]: https://www.faa.gov/aircraft/air_cert/design_approvals/air_software/software_regs
[ac148]: https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC20-148.pdf
[ac174]: https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentID/1019527
[ac193]: https://www.ghs.com/products/safety_critical/integrity_178_standards_ac_20-193.html
[dmd]: https://dmd.solutions/blog/arp4754b-updates
[do160h]: https://www.rtca.org/wp-content/uploads/2026/07/135agn98_wg14_109.pdf
[part23]: https://public-inspection.federalregister.gov/2025-08985.pdf
[mosaic]: https://avweb.com/wp-content/uploads/2026/07/2026-07-15_FAA-Acceptance-LS-Consensus-Standards.pdf
[ar125]: https://www.faa.gov/sites/faa.gov/files/aircraft/air_cert/design_approvals/air_software/AR-01-125_report.pdf
[faa-research]: https://www.faa.gov/aircraft/air_cert/design_approvals/air_software/research/
[cra2]: https://www.european-cyber-resilience-act.com/Cyber_Resilience_Act_Article_2.html
[cra3]: https://www.european-cyber-resilience-act.com/Cyber_Resilience_Act_Article_3.html
[cra71]: https://www.european-cyber-resilience-act.com/Cyber_Resilience_Act_Article_71.html
[cra-r27]: https://lxgesetze.de/crv/(27)
[pld]: https://www.lexaris.de/book/version/documentflat/head/6811882
[pld-hl]: https://www.hlc.com/en/publications/eu-introduces-comprehensive-digitalera-product-liability-directive
[heydata]: https://heydata.eu/en/magazine/eu-product-liability-directive-2024-2853-digital-software-ai
[greenbone]: https://www.greenbone.net/en/blog/cra-open-source-software/
[illinois]: https://siebelschool.illinois.edu/news/linux-kernel-fly-boeing
[elisa]: https://elisa.tech/event/elisa-seminar-making-linux-fly-towards-certified-linux-kernel/
[rtems-qdp]: https://rtems-qual.io.esa.int/
[rtems-org]: https://www.rtems.org/node/139
[zephyr]: https://tfir.io/zephyr-rtos-10-years-safety-certification-sbom-edge-ai/
[ferrocene]: https://ferrous-systems.com/blog/ferrocene-26-02-0/
[sel4-dw]: https://www.dornerworks.com/about/whitepapers/formally-proven-sel4-microkernel/
[sel4-heli]: https://www.bankinfosecurity.com/does-this-drone-sport-worlds-most-secure-operating-system-a-9166
[xen-dw]: https://www.dornerworks.com/about/whitepapers/open-source-hypervisor/
[xen-ieee]: https://ieeexplore.ieee.org/document/5655298
[fprime]: https://github.com/readme/featured/nasa-ingenuity-helicopter
[zdnet]: https://webcf.waybackmachine.org/web/20211001074126/https://www.zdnet.com/article/flying-on-mars-fueled-with-open-source-software
[opendo]: https://opensource.com/government/13/4/can-do-interview
[oaam]: https://github.com/ComplexAvionicsSystems/OAAM
[oaam-fork]: https://github.com/matt-brunner/OAAM
[pyefis]: https://github.com/makerplane/pyEfis
[mavlink]: https://mavlink.io/en/
[cyphal]: https://github.com/UAVCAN/specification/files/3851768/UAVCAN_Specification.pdf
[dronecan]: https://dronecan.github.io
[clang-cov]: https://llvm.googlesource.com/llvm-project/+/refs/heads/main/clang/docs/SourceBasedCodeCoverage.rst
[adsl-easa]: https://www.easa.europa.eu/en/print/pdf/node/141859/264548
[cia-825]: https://www2.can-cia.org/fileadmin/resources/documents/proceedings/2012_knueppel.pdf
[kvaser]: https://kvaser.com/arinc/
[flarm-adsl]: https://www.flarm.com/en/news/easa-introduces-ads-l-in-new-u-space-regulation-further-defines-e-conspicuity/
[safesky]: https://docs.safesky.app/books/aero-tracker/page/1-introduction
[openace]: https://github.com/rvt/OpenAce
[adsl-stats]: https://dlapilota.pl/wiadomosci/polska/world-statistics-electronic-conspicuity-devices-technology-march-2025-2026
[pgrmh-doc]: ../integration/pgrmh-format.md
[competitors]: ../product/competitor-features.md
[av30]: https://aopa.org/news-and-media/all-news/2020/september/02/faa-certifies-uavionix-av-30-c
[dynon]: https://www.aviationpros.com/engines-components/aircraft-airframe-accessories/avionics/press-release/12402798/dynon-avionics-dynon-avionics-receives-first-faa-stc-for-installation-of-skyview-hdx-in-type-certificated-aircraft
[dynon-592]: https://aopa.org/news-and-media/all-news/2019/july/16/skyview-hdx-approved-for-592-aircraft
[kitplanes]: https://www.kitplanes.com/dynon-certified-introduced/
[face]: https://en.wikipedia.org/wiki/Future_Airborne_Capability_Environment
[annighoefer-2015]: https://buchnah.de/buch/9783844034202
[paz]: https://espace.etsmtl.ca/2484/
[friedrich]: https://elib.dlr.de/197932/1/IB-2022-198_Geschw%C3%A4rzt.pdf
[annighoefer-2019]: https://doi.org/10.4271/2019-01-1383
[annighoefer-dasc]: https://tore.tuhh.de/handle/11420/4819
[annighoefer-2021]: https://arxiv.org/abs/2103.12065
[kalliamvakou]: https://link.springer.com/chapter/10.1007/978-3-319-39225-7_9
[vanderleest-2023]: https://ieeexplore.ieee.org/document/10311247/
[vanderleest-stewart]: https://doi.org/10.1109/DASC58513.2023.10311338
[zhang]: https://doi.org/10.1109/DASC66011.2025.11257174
[ribeiro]: https://arxiv.org/abs/2311.04344
[baron]: https://memsic.ccsd.cnrs.fr/LAAS-ISI/hal-04043572v1
[morris]: https://core.ac.uk/download/213550449.pdf
[preprint]: https://www.preprints.org/manuscript/202603.0354/v6
