# Compute Platform Assessment — Raspberry Pi 5 and ARM64 Alternatives

Roadmap Step 8 input (`docs/certification/roadmap.md`), and the hardware half of the
FHA's installation assumptions (`docs/certification/fha.md`).

Status: draft 2026-10-02. Every datasheet figure below is cited; cells marked **[confirm]**
are engineering judgement or vendor marketing that has not been verified against a
controlled document. Nothing here is a DER/CVE opinion.

**Question this answers:** can the RB-01 be certified on a Raspberry Pi 5, what has to be
derogated to do it, and would a different ARM64 board make the certification checklist
shorter?

**Short answer:** the Pi 5 is usable for the DAL D / NORSEE / CS-STAN target *with
documented derogations*, and its single disqualifying figure is the **0 °C** lower
operating limit — no DO-160G §4 category allows it. Moving from the Pi 5 board to the
**Compute Module 5 on an in-house carrier** fixes the temperature floor, the memory ECC,
the storage and the power-input design at the cost of one PCB and **zero software port**.
Everything beyond that (i.MX 95, Versal) buys certifiability the first baseline does not
need and costs a platform port.

---

## 1. Grading scheme

Two independent grades, because they trade off against each other: the most certifiable
boards are the least compatible with the RB-01 software as it stands.

| Grade | Certification suitability (C-grade) | RB-01 compatibility (R-grade) |
|---|---|---|
| **A** | Vendor supplies DO-178C/DO-254 artifacts or a safety package; certifiable GPU driver exists | Runs the current stack unchanged, including Chromium/WebGL synthetic vision |
| **B** | Industrial-grade COTS: wide-temp datasheet, 10 y+ longevity, ECC, errata access, safety co-processor | Same OS family and APIs; small, bounded changes (device tree, bus numbers) |
| **C** | Commercial COTS, but the gaps are closable with recognised derogations (uprating, limitations) | Debian arm64 + Chromium available; needs a new image build and GPIO/I²C abstraction |
| **D** | Commercial COTS with a gap that needs a design change or an operating limitation the market may reject | Significant port: different OS/BSP, display and graphics stack need work |
| **E** | Not acceptable in a certified baseline | Would be a rewrite of the HMI or the daemon |

**Overall grade** is the pair, read as "what it costs to certify / what it costs to get
there". A board is only better than the Pi 5 if it improves the C-grade without
dropping the R-grade below C.

---

## 2. What the standards actually require of the board

This is the part that is usually got wrong. Four separate chains apply, and at the
roadmap's target DAL (D) three of them are much lighter than they first look.

### 2.1 Environmental qualification applies to the *equipment*, not the board

DO-160G / ED-14G qualifies an **item of equipment** — the RB-01 as a box, with its
enclosure, power input, display and cabling. There is no such thing as a
"DO-160-certified Raspberry Pi", and not having one is not a finding. A commercial board
inside a qualified box is normal practice. What the board determines is whether the box
*can pass*:

- **§4 Temperature and altitude** is where a commercial board fails. The mildest standard
  category, A1 (controlled-temperature, pressurised locations), already has an operating
  low temperature of **−15 °C** ([Keystone Compliance summary of DO-160 §4][k4]); a
  light-aircraft cockpit that soaks overnight needs that at least. A board specified
  0 °C to 70 °C meets **no** standard category. See the derogation register (§4, D-1).
- **§8 Vibration** drives the SD card, connector retention and board mounting, not the SoC.
- **§16 Power input / §17 Voltage spike** are the carrier's or the power supply's problem:
  a 5 V/5 A USB-PD input ([Pi 5 product brief][pb5]) is not an aircraft power interface.
- **§21 RF emission** is where an unshielded consumer board with a 2.4/5 GHz radio and
  HDMI is at risk — and it is the one section where the board layout, not the box, usually
  decides the outcome.

DO-160 also defines **Category X** — section not applicable / not tested — which, under a
regime where the applicant proposes the standard (§2.3), is the formal way to carry an
operating limitation rather than a test failure.

### 2.2 Airborne electronic hardware: AMC/AC 20-152A, and what DAL D exempts

AMC 20-152A (EASA; FAA AC 20-152A is substantially identical) is the current guidance for
airborne electronic hardware. Three facts decide how much of it bites:

1. **It is not required at DAL D.** Verbatim: *"the use of this AMC is not required for
   AEH contributing to hardware DAL D functions. Appendix B provides some clarifications
   that may be used to ensure that the DAL D hardware performs its intended function."*
   Appendix B.2.4 then accepts *"ED-80/DO-254 or existing Level D hardware development
   assurance practices"* or even *"system-level development assurance practices such as
   ED-79A/ARP4754A or other means"* ([AMC 20-152A][amc152]).
2. **At DAL C only a limited set of objectives applies** — *"For AEH contributing to
   hardware DAL C functions, only a limited set of objectives applies."*
3. **A COTS SoC is handled by an ECMP, not by DO-254 design assurance.** Objective
   **COTS-2** requires *"an electronic component management process (ECMP) … to address the
   selection, qualification, and configuration management of COTS devices"* including
   *"access to component data such as the user manual, the datasheet, errata, installation
   manual, and access to information on changes made by the component manufacturer."*
   Recognised ECMP standards are **IEC 62239** and **SAE EIA-STD-4899**.

The COTS objectives that matter for a BCM2712:

| Objective | Requirement | Pi 5 status |
|---|---|---|
| COTS-2 | ECMP exists; access to datasheet, errata, change notices | **Weak.** No public errata list for BCM2712; no PCN subscription; the datasheet is a product brief. Maturity argument is strong (millions in service, see §3.4). |
| COTS-3 | Device used outside datasheet limits → establish reliability and technical suitability (the **uprating** route) | **This is the temperature derogation.** See §4, D-1. |
| COTS-4 | Unqualified or modified microcode must be covered by a process | **Applies.** The VideoCore boot firmware / `start.elf`, the RP1 firmware and the PMIC configuration are vendor microcode, not qualified with the device. Must be declared in the PSAC. |
| COTS-5 | Assess relevant errata and verify mitigations | **Blocked by COTS-2** — you cannot assess errata you cannot obtain. |
| COTS-6 | Identify failure modes of the used functions and feed them to the safety assessment | Doable qualitatively; quantitatively see §3.3. |

### 2.3 The route decides almost everything: NORSEE assumes the box fails

FAA policy **PS-AIR-21.8-1602** (NORSEE) is the single largest derogation available, and
it is not a loophole — it is the designed-in treatment of non-required equipment:

- *"Minimum design requirements (MDR) are design requirements found acceptable by the
  FAA… MDRs are usually industry standards **proposed by the applicant**."* and *"For
  non-required equipment, the applicant has the flexibility to determine which industry
  standard to use for the equipment's design."* — so DO-160 categories and DO-178C DAL are
  **proposed, not dictated**.
- *"The overall safety evaluation for non-required equipment **assumes the equipment will
  fail, regardless of the system or subsystem and the probability of such a failure**. The
  safety evaluation must show evidence that such failures do not reduce the capability of
  the aircraft or the ability of the pilot/flightcrew to cope with a failure condition
  worse than minor."* — **the Pi's failure rate is not the question.** Whether its failure
  can mislead is.
- Design considerations named: *separation* from primary systems, *independence* (no input
  from a primary system), *protection* from adverse effects on the rest of the system.
- *"A safety evaluation conducted by the applicant may include either a qualitative or
  quantitative approach… The qualitative approach may include service experience data from
  similar, previously approved systems."*
- §1.5: *"The system status (that is, operation or failure) should be conveyed to the
  pilot/flightcrew."* — this is the regulatory hook for the missing stale-data flag
  already raised as FHA-ATT-3 and FHA-ALT-3.

([PS-AIR-21.8-1602][norsee]. EASA CS-STAN standard changes play the equivalent role in
Europe — **[confirm]** the applicable standard change and its declaration content.)

### 2.4 Multi-core: free at DAL D, expensive at DAL C

The Pi 5 is a quad-core Cortex-A76 with shared L2/L3 and one LPDDR4X controller — a
textbook interference-channel problem. AMC 20-193 / AC 20-193, verbatim:

> *"This AMC applies to systems and equipment that contain MCPs with two or more activated
> cores for which the item development assurance level (IDAL) of at least one of the
> software applications hosted by the MCP or of the hardware item that contains the MCP is
> A, B, or C. … **This AMC does not apply when the IDALs are all Level D or E.**"*
> ([AMC 20-193][amc193])

So: **at DAL D the multicore objectives do not apply at all.** If the core is ever raised
to DAL C, the full set (MCP_Planning, MCP_Resources, MCP_Interference, MCP_Verification,
MCP_Safety) applies, with interference-channel identification and WCET under contention —
on a SoC whose cache and memory arbitration is undocumented. The mitigation the same AMC
provides is in its applicability: it covers *"MCPs with two or more activated cores"*, and
*"The deactivation of cores is handled through the applicable airborne electronic hardware
(AEH) guidance"*. A certified configuration pinned to **one activated core** (`maxcpus=1`,
or the core pinned and the rest offlined with evidence) moves the problem from the MCP
objectives to an AEH configuration argument. The RB-01's core functions — sensor read,
fusion, instrument render — do not need four A76 cores; synthetic vision does. That is a
real architecture lever and belongs in roadmap Step 7.

---

## 3. Raspberry Pi 5 — fact sheet

### 3.1 What the vendor commits to

| Item | Value | Source |
|---|---|---|
| SoC | Broadcom BCM2712, quad Cortex-A76 @ 2.4 GHz | [Pi 5 product brief][pb5] |
| Memory | LPDDR4X-4267, 1/2/4/8/16 GB — **ECC not stated** | [Pi 5 product brief][pb5] |
| **Operating temperature** | **0 °C to 70 °C** | [Pi 5 product brief][pb5] |
| Production lifetime | *"will remain in production until at least January 2036"* | [Pi 5 product brief][pb5] |
| Power | 5 V / 5 A DC via USB-C with Power Delivery | [Pi 5 product brief][pb5] |
| RTC | On board, external battery | [Pi 5 product brief][pb5] |
| Compliance | Local/regional approvals list (CE/FCC class) — no aviation standard | [Pi 5 product brief][pb5] |
| Storage | microSD (primary), NVMe over the single PCIe Gen2 lane | [Pi 5 product brief][pb5] |
| MTBF | **Not published for the Pi 5 board.** CM5: 143 000 h ground-benign, **16 000 h ground-mobile** | [CM5 datasheet][cm5] App. E |

### 3.2 The vendor explicitly disclaims aviation use

This is the first thing a DER will read, so it has to be in the PSAC rather than
discovered. From the Raspberry Pi datasheet legal notice, verbatim:

> **"HIGH RISK ACTIVITIES.** Raspberry Pi products are not designed, manufactured or
> intended for use in hazardous environments requiring fail safe performance, such as in
> the operation of nuclear facilities, **aircraft navigation or communication systems**,
> air traffic control, weapons systems or safety-critical applications … in which the
> failure of the products could lead directly to death, personal injury or severe physical
> or environmental damage ("High Risk Activities"). RPL specifically disclaims any express
> or implied warranty of fitness for High Risk Activities and accepts no liability for use
> or inclusions of Raspberry Pi products in High Risk Activities."
> ([CM5 datasheet][cm5], legal disclaimer; the same notice is on Raspberry Pi datasheets
> generally)

What it does and does not mean:

- It is **not** a regulatory prohibition. Authorities approve equipment, not components,
  and vendor disclaimers of this shape are on most COTS silicon used in GA avionics.
- It **does** remove the vendor from the assurance chain: no aviation-specific support, no
  errata obligation, no PCN commitment, no liability flow-down. Everything the vendor
  would normally supply (COTS-2 data access) must be substituted by the applicant's own
  ECMP, maturity argument and monitoring.
- It makes the NORSEE framing (§2.3) not merely convenient but necessary: the argument
  must be that the equipment is assumed to fail and that failure is Minor.

### 3.3 The quantitative consequence of 16 000 h

Using the CM5's own ground-mobile figure as the closest published analogue (vibration,
no temperature or humidity control — a light aircraft is harsher than ground-mobile for
vibration and worse for temperature):

- 16 000 h MTBF ≈ **6 × 10⁻⁵ failures per hour**.
- A **Major** failure condition budget is on the order of 10⁻⁵ per flight hour. A single
  Pi, unmonitored, is **~6× over budget on its own** before any software failure is counted.
- A **Minor** failure condition has no such numerical constraint under AC 23.1309-1E for
  this class, and NORSEE assumes failure outright.

Therefore the quantitative case only closes if every *credible* failure of the board
produces **loss, annunciated** (Minor) rather than **misleading information** (Major). That
is precisely what the FHA's missing stale-data flags (FHA-ATT-3, FHA-ALT-3) currently fail
to guarantee, and why the detection/annunciation work is worth more than any board swap.

### 3.4 Where the Pi 5 is actually strong

Not everything is a finding:

- **Maturity and service experience.** AMC 20-152A B.2.2.2.1 lists exactly the evidence the
  Pi has: *"the time of the device in service"*, *"widespread use in service… a large
  minimum number of chips sold"*, *"a decreasing rate of new errata being raised"*. Tens of
  millions of units and a mature Linux BSP is a credible maturity argument — stronger than
  most industrial SoMs could make.
- **Longevity.** January 2036 ([Pi 5 product brief][pb5]) beats several industrial SoM
  vendors and removes the usual COTS obsolescence objection. CM4 is committed to
  January 2034 and CM5 to **January 2036** ([Raspberry Pi CM5 product page][cm5p]).
- **Configuration control of the software stack** is already better than the hardware's:
  see `docs/certification/provenance.md`.
- **USB topology.** Pi 5 gives two USB 3.0 + two USB 2.0 with the USB controller behind
  RP1, not a shared single hub as on the Pi 4 — relevant because the RB-01 runs two or
  three RTL-SDR dongles concurrently.

---

## 4. Derogation register

Each row is a finding, the recognised mechanism that can carry it, what has to be produced,
and what is left over. "Mechanism" cites the clause that makes it acceptable — these are
not invented concessions.

| # | Finding | Mechanism | Evidence to produce | Residual risk |
|---|---|---|---|---|
| **D-1** | Operating temperature 0 °C to 70 °C meets **no** DO-160G §4 category (mildest, A1, is −15 °C) | **(a)** *Uprating* per **AMC 20-152A Obj. COTS-3** and **IEC/TR 62240-1**: *"For each instance of device usage outside the manufacturer's specified temperature range relevant data are documented and stored in a controlled, retrievable format"*; **(b)** DO-160 **Category X** for the section plus an operating limitation, under a NORSEE MDR the applicant proposes; **(c)** design change — CM5 is **−20 °C to +85 °C** | (a) uprating test campaign over batches/dies, documented per IEC/TR 62240-1; (b) AFM-supplement limitation "not for use below 0 °C" + a power-up inhibit and annunciation below the qualified range; (c) carrier design | (a) expensive and AMC 20-152A itself calls establishing reliability outside spec *"difficult"*; (b) a cockpit display that is unusable on a cold morning is a commercial problem, not just a paper one; (c) best value — see §6 |
| **D-2** | No DO-160 qualification of the board | None needed — DO-160 qualifies **equipment** (§2.1) | Qualification of the RB-01 as a box, categories selected in roadmap Step 8 | §21 RF emission and §8 vibration can still fail because of board-level choices |
| **D-3** | No DO-254 design data for BCM2712 | **AMC 20-152A §6.4 / DO-254 §11.2**: complex COTS is managed by an **ECMP**, not design assurance. At DAL D the AMC *"is not required"* (App. B.2.4) | ECMP per **IEC 62239** / **SAE EIA-STD-4899**; device maturity assessment (§3.4) | Any move to DAL C/B brings the limited objective set and the COTS objectives back |
| **D-4** | No public errata list, no PCN/change notification (COTS-2, COTS-5) | Partial: maturity + service experience per **AMC 20-152A B.2.2.2.1** | Documented maturity argument; a monitored channel (forum/github/Raspberry Pi PCN **[confirm]** whether RPL issues PCNs to volume customers); in-service problem reporting via the new problem-report form | **The weakest link.** You cannot verify mitigations for errata you cannot read. Flag it in the PSAC rather than let a DER find it |
| **D-5** | Vendor disclaims aviation use (§3.2) | NORSEE framing: equipment assumed to fail, effect Minor | PSAC statement; failure-condition classification per `fha.md`; the monitors of D-9 | Commercial/liability exposure is the applicant's; not transferable |
| **D-6** | Multi-core interference, no WCET data | **AMC 20-193 does not apply at DAL D or E** (§2.4) | Statement of IDAL D in the PSAC | At DAL C: full MCP objectives, or a single-activated-core configuration |
| **D-7** | ECC not stated for Pi 5 memory → SEU/soft error can corrupt the rendered frame undetected (a Major path, not a Minor one) | **(a)** CM5 states LPDDR4-4267 **with ECC**; **(b)** end-to-end data integrity monitor in software (CRC on the situation frame, plausibility bounds at the renderer) | (a) CM5 selection; (b) HLRs + tests from roadmap Steps 4–5 | Software monitor does not cover framebuffer/scanout corruption; only ECC + a display-path monitor does |
| **D-8** | microSD as primary storage: wear, power-cut corruption, vibration | eMMC on the compute module; read-only root (the overlay already configured in `image_build_rb/`) | Power-interruption test campaign; `fsck`/boot-integrity evidence | Residual on the boot partition unless it is also read-only |
| **D-9** | No independent monitor: the SoC that computes attitude also draws it and judges its own health | Architecture, not a derogation. Either a companion safety MCU (i.MX 8M Plus Cortex-M7, i.MX 95 M7+M33) or an external watchdog + supervisor on the carrier | Roadmap Step 7 health monitoring; the watchdog and stale-flag HLRs | On a Pi 5 board (no carrier), the only watchdog is the SoC's own — a classic single-point monitor |
| **D-10** | Vendor microcode (VideoCore boot firmware, RP1, PMIC config) is not qualified with the device (COTS-4) | **AMC 20-152A Obj. COTS-4**: declare it and name the process that covers it | PSAC section; firmware versions pinned and hashed exactly like the software (extend `provenance.md`) | Firmware is closed-source; only configuration control and testing are available |
| **D-11** | Pure-tin / RoHS lead-free finishes without an aerospace lead-free control plan | **GEIA-STD-0005-1/-2** lead-free control plan and tin-whisker risk assessment **[confirm]** applicability at this approval level | Lead-free control plan; whisker mitigation statement | Usually accepted for NORSEE-class equipment **[confirm]** |
| **D-12** | No lot traceability / PPAP from the board vendor | ECMP (D-3) plus incoming inspection and serialisation at the RB-01 level | Per-unit build record keyed to the board serial; the installation record already in `scmp.md` §5 | Cannot trace a silicon lot; a bad batch is detectable only in service |

Two derogations are **not** available and should not be attempted: a certifiable GPU
driver for VideoCore VII (none exists, from any vendor — see §5), and any argument that
turns an unflagged misleading display into a Minor condition.

---

## 5. Certifiable graphics: the one gap no derogation closes

The RB-01 renders safety-relevant data through Chromium → WebGL → Mesa V3D → VideoCore VII.
For the first baseline that stack is argued as previously developed software with service
history (roadmap Step 7, option (a)), which caps the display path at DAL D. Above D a
graphics driver with certification artifacts is needed, and the market for those is
narrow and **does not include Broadcom**:

- **CoreAVI VkCore SC** provides a Vulkan-subset driver certifiable to *"RTCA
  DO-178C/EUROCAE ED-12C Level A"* with a complete certification data package, supporting
  *"NXP's i.MX 8 SoC featuring dual Vivante GC7000XSVX GPUs"* and *"Arm-based SoCs
  incorporating the Mali-G78AE GPU"*, plus AMD Embedded Radeon E-series
  ([CoreAVI / Arm product brief][coreavi], [Mali-G78AE announcement][coreavimali]).
- **Arm Mali-G78AE** is Arm's first GPU IP designed for functional safety; in shipping
  ARM64 silicon it appears in **AMD Versal AI Edge Gen 2** ([AMD wiki][versal]) and in
  automotive SoCs such as Black Sesame Wudang C1200 ([CNX][bst]).
- Whether the **i.MX 8M Plus**'s GC7000UL (as opposed to the i.MX 8QuadMax's GC7000XSVX)
  or the **i.MX 95**'s Mali-G310 are covered is **[confirm] with CoreAVI** — this single
  question decides whether the i.MX route reaches DAL C for the display.

Consequence for the roadmap: Step 7's display-path decision is really a *board* decision.
Option (b) "implement the core instruments natively" is the only DAL-C-capable display
path on a Pi; on an i.MX 95 or Versal platform, option (a) with a certifiable driver
becomes available.

---

## 6. What it costs to leave the Raspberry Pi

Porting cost is not hypothetical — it is measurable in this repository:

| Dependency | Where | Pi-specific? | Port cost |
|---|---|---|---|
| `stianeikeland/go-rpio` memory-mapped BCM GPIO/PWM | [fancontrol.go:137-145](fancontrol_main/fancontrol.go#L137-L145) | **Yes** — maps Broadcom registers | Replace with `periph.io` or libgpiod/sysfs PWM |
| `kidoman/embd` with `embd.SetHost(embd.HostRPi, 3)` | [sensors.go:93-95](main/sensors.go#L93-L95) | **Yes** — host hardcoded to Raspberry Pi | Bus numbers differ per board; library is unmaintained since 2017 (see `docs/tech-debt/modernization.md`) — replace rather than port |
| `raspi-config`, `/boot/firmware/config.txt`, `dtoverlay`, `rpi-eeprom-update`, overlayfs via raspi-config, DSI display overlays | [image_build_rb/generate_rb_from_clean_sdcard.sh](image_build_rb/generate_rb_from_clean_sdcard.sh) | **Yes** throughout | Rewrite the image build for the vendor BSP (Yocto on most SoMs, not Debian + apt) |
| `/boot/firmware/stratux.conf`, `/boot/firmware/rb` settings paths | daemon + image | Convention only | Rename |
| CPU temperature from `/sys/class/thermal/thermal_zone0/temp` | [cputemp.go:23](common/cputemp.go#L23) | No | None |
| Chromium + WebGL for `synthview`, OpenLayers, Chart.js | `web/RB-01/` | No, but GPU-driver dependent | Depends entirely on the GPU's Linux driver quality |
| `dump1090`, `rtl_ais`, `ogn-rx-eu`, `libdump978` | submodules + `ogn/` | arm64 generally; **`ogn-rx-eu` is a prebuilt binary** | aarch64 build exists; already out of the certified baseline (`provenance.md`) |

**Staying inside the Raspberry Pi family (Pi 5 → CM5) costs none of this.** Same SoC, same
BSP, same `raspi-config` world, same GPU driver, same binaries. That asymmetry is the single
most important input to the recommendation.

---

## 7. Reference table — ARM64 platforms, graded

Ordered by overall usefulness for the RB-01 certification target. "C" = certification
suitability, "R" = RB-01 compatibility (§1).

| Platform | SoC / cores | Op. temp | Longevity | ECC | Safety co-proc | Certifiable GPU driver | C | R | Verdict for RB-01 |
|---|---|---|---|---|---|---|:--:|:--:|---|
| **Raspberry Pi 5** (baseline) | BCM2712, 4× A76 2.4 GHz | **0 … +70 °C** [pb5] | **Jan 2036** [pb5] | Not stated [pb5] | None (SoC watchdog only) | None | **D** | **A** | Works today; D-1 temperature is the blocking derogation, D-7/D-9 push failures toward Major |
| **Raspberry Pi CM5 + in-house carrier** | BCM2712, 4× A76 | **−20 … +85 °C** [cm5] | **Jan 2036** [cm5p] | **Yes**, LPDDR4-4267 with ECC [cm5] | Carrier's choice (external WDT, supervisor) | None | **C** | **A** | **Recommended for the first baseline.** Closes D-1, D-7, D-8; lets the carrier own power input (§16/§17), watchdog, coating, connector retention. Zero software port. MTBF published (16 000 h ground-mobile) |
| Industrial CM5 carrier, off the shelf (EDATEC ED-IPC3100 / ED-SBC3300 class) | BCM2712 | −25 … +50/60 °C (carrier-limited) [eda] | Follows CM5 | Yes (module) | Vendor-dependent | None | **C** | **A** | Faster than designing a carrier, but the carrier derates the module and you do not control its power input or BOM — acceptable for prototyping the cold-temperature case |
| Raspberry Pi CM4 + carrier | BCM2711, 4× A72 | −20 … +85 °C **[confirm]** | **Jan 2034** [cm5] | **[confirm]** | Carrier's choice | None | **C** | **A** | Only if CM5 supply or power budget forces it; slower GPU hurts `synthview` |
| **Toradex Verdin / Variscite DART i.MX 8M Plus** | i.MX 8M Plus, 4× A53 + **Cortex-M7** | **−40 … +85 °C** [tdx] | 2030+ [tdx] | **Inline ECC LPDDR4** [tdx] | **Cortex-M7** | CoreAVI covers i.MX 8 (GC7000XSVX); GC7000UL **[confirm]** | **B** | **C** | Real step up in assurance: wide temp, ECC, an independent M7 for the monitor of D-9. Costs the full port of §6, and the GC7000UL GPU is materially weaker than VideoCore VII for Three.js synthetic vision |
| **Toradex / Variscite i.MX 95** (Verdin, SMARC, DART) | i.MX 95, 6× A55 + **M7 + M33** | **−40 … +85 °C** [imx95] | **2039** (15-year programme) [imx95] | **[confirm]** | **M7 (800 MHz) + M33** | Mali-G310 **[confirm]** | **B+** | **C/D** | The DAL-C-capable choice: ASIL-B/SIL-2 random-metric targets, NXP lists tools qualified for *"ISO 26262, DO-178C, IEC 61508"*, two safety cores, longest longevity on this table. Second-generation candidate, not a 2026 move |
| NVIDIA Jetson Orin NX / Nano | Orin, 6–8× A78AE | −25 … +105 °C (commercial module); AGX Orin **Industrial** −40 °C, production through 2033 [jet] | Orin NX/Nano through **Jan 2032** [jet] | **[confirm]** | A78AE supports split-lock **[confirm]** | Not from NVIDIA; Aitech productises Jetson for avionics (A178-AV now EOL) [ait] | **C+** | **C** | Only if synthetic vision becomes the product's centre of gravity. Best GPU/driver story after the Pi, shortest longevity, highest power |
| **AMD Versal AI Edge Gen 2** | Cortex-A78AE + **Mali-G78AE** + programmable logic | Industrial grades available **[confirm]** | AMD long-term **[confirm]** | Yes (FPGA fabric + DDR ECC) **[confirm]** | A78AE lockstep + R5F | **Yes — CoreAVI VkCore SC DAL A on Mali-G78AE** [coreavimali][versal] | **A** | **D** | The certifiable ceiling and the calibration point for this table: this is what DAL B/A display hardware looks like. PetaLinux/Yocto, no Debian+Chromium path, cost and power far outside the RB-01 envelope |
| Rugged avionics GPGPU box (Aitech A17x/A19x class) | Jetson-based, 8× ARM v8.2 | Vendor-qualified, IP65 sealed [ait] | Vendor lifecycle programme | Vendor | Vendor | Vendor | **A/B** | **D** | Reference tier. Buys the DO-160 and ruggedisation work outright; price and SWaP are two orders off the RB-01 market. Note the A178-AV is already EOL — even this tier obsoletes |
| Radxa ROCK 5B+/5T, Orange Pi 5 (RK3588/RK3588J) | RK3588, 4× A76 + 4× A55 | 0 … +50/60 °C commercial; **RK3588J industrial −40 … +85 °C** [rdx] | **No published commitment** | **[confirm]** | None | None | **E** | **C** | **Avoid.** Better raw specs than the Pi and a worse certification position: no longevity commitment, thinner documentation, and the Mali-G610 driver situation (Panfrost/Panthor vs. closed libmali) is the weakest link for a WebGL display path |
| Generic x86 industrial SBC + AMD Radeon E-series | x86 | Vendor | Vendor | Yes | — | **Yes — CoreAVI on AMD Embedded** [coreavi] | **A/B** | **E** | Out of scope (not ARM64) but worth knowing: this is the conventional certified-display platform, and the reason most certified EFIS hardware is x86 + AMD |

### How to read the table

- **Nothing on it improves both axes.** The Pi family is alone at R = A; every board that
  improves the certification grade costs the §6 port.
- **The first real decision is one row down, not one platform across.** Pi 5 → CM5 lifts
  C from D to C for the price of a PCB.
- **The gap between C = C and C = B is the independent monitor and the wide-temp
  datasheet**, not the CPU. That is why the i.MX rows score better while being slower.
- **The gap between C = B and C = A is the GPU driver's certification package**, and only
  three families offer one.

---

## 8. Recommendation and the resulting checklist changes

**Now (first baseline, NORSEE/CS-STAN, DAL D):** stay on BCM2712 and move the product from
the Pi 5 board to **CM5 on an in-house carrier**. It is the only change that improves the
certification position without touching the software, and it converts four derogations
(D-1 temperature, D-7 ECC, D-8 storage, D-9 monitor) from paper arguments into design
facts. Budget one PCB revision and a DO-160 §16/§17 power-input design.

**Keep as the Pi-only fallback** if the carrier slips: uprating per IEC/TR 62240-1 (D-1a)
*plus* a cold-start inhibit and annunciation, and declare the limitation. Cheaper in
cash, worse in the field, and the uprating campaign is not trivial.

**Second generation (if DAL C or an ETSO is ever targeted):** i.MX 95 SoM, with the CoreAVI
GPU-driver question answered **before** committing. Plan the §6 port as its own project —
the `go-rpio` and `embd` replacements are worth doing regardless, since both are already on
the modernization backlog.

**Never:** RK3588 consumer boards. They look like an upgrade and are a certification
regression.

### Changes this analysis makes to the existing checklist

| Document | Change |
|---|---|
| `roadmap.md` Step 8 | Add: select the DO-160G §4 category **first** — it is what decides Pi 5 vs CM5. Add an uprating work package (IEC/TR 62240-1) as the fallback. Add an ECMP per IEC 62239 / SAE EIA-STD-4899 as a named deliverable. Record that AMC 20-152A is *not required* at DAL D and cite App. B.2.4 |
| `roadmap.md` Step 7 | The display-path decision is a board decision (§5). Add "single activated core" as the DAL-C multicore mitigation, and the independent-monitor options per platform |
| `roadmap.md` Step 3 | Add the NORSEE quote "assumes the equipment will fail" to the FHA framing — it is the strongest available argument and changes what the safety case has to prove |
| `fha.md` | FHA-ATT-3 / FHA-ALT-3 gain a regulatory hook: NORSEE §1.5 *"system status … should be conveyed to the pilot/flightcrew"*. Add the 6 × 10⁻⁵ /h board failure rate (§3.3) as the quantitative reason loss must be annunciated |
| `scmp.md` | Extend configuration identification to **vendor microcode** (VideoCore boot firmware, RP1, PMIC config) per COTS-4, with versions and hashes in `provenance.md`. Add the errata/PCN monitoring channel as a named CM activity (D-4) |
| `provenance.md` | Add a hardware section: board part number, revision, SoC stepping, firmware (`bootloader`/EEPROM) version and hash |
| New | `docs/certification/hardware/ecmp.md` (electronic component management plan) and `bom.md`, both already listed as Step 8 deliverables |

---

## 9. Sources

[pb5]: https://pip.raspberrypi.com/documents/RP-008348-DS-raspberry-pi-5-product-brief.pdf
[cm5]: https://edatec.cn/storage/file/Raspberry%20Pi%20CM5-datasheet.pdf
[cm5p]: https://www.raspberrypi.com/products/compute-module-5/
[amc152]: https://patmos-eng.com/wp-content/uploads/2026/03/AMC20-152A.pdf
[amc193]: https://www.easa.europa.eu/sites/default/files/dfu/annex_i_to_ed_decision_2022-001-r_amc_20-193_use_of_multi-core_processors_mcps.pdf
[norsee]: https://www.gajsc.org/wordpress/wp-content/uploads/2016/08/PS-AIR-21.8-1602.pdf
[k4]: https://keystonecompliance.com/rtca-do-160/temperature-altitude/
[tdx]: https://www.toradex.com/computer-on-modules/verdin-arm-family/nxp-imx-8m-plus
[imx95]: https://www.toradex.com/computer-on-modules/verdin-arm-family/nxp-imx95
[jet]: https://developer.nvidia.com/embedded/lifecycle
[coreavi]: https://developer.arm.com/-/media/Arm%20Developer%20Community/PDF/FuSa%20Partners/CoreAVI_ProductBrief_VkCoreSC.pdf
[coreavimali]: https://militaryembedded.com/avionics/software/core-avionics-industrial-inc-announces-certifiable-safety-critical-software-for-arms-next-gen-mali-g78ae-gpu-designed-with-functional-safety
[versal]: https://xilinx-wiki.atlassian.net/wiki/spaces/A/pages/3268509715/AMD+Versal+AI+Edge+Series+Gen+2+-+Mali-G78AE+Linux+DDK
[bst]: https://www.cnx-software.com/2026/02/10/black-sesame-technologies-wudang-c1200-cross-domain-automotive-socs-feature-up-to-10x-cortex-a78ae-cores/
[ait]: https://aitechsystems.com/product/a178-av-gpgpu
[rdx]: https://radxa.com/products/rock5/5t/
[eda]: https://www.cnx-software.com/2024/12/11/edatec-ed-ipc3100-raspberry-pi-cm5-based-industrial-computers/

| Tag | Document |
|---|---|
| [pb5] | Raspberry Pi 5 product brief (RP-008348-DS) — temperature, lifetime, power, memory |
| [cm5] | Raspberry Pi Compute Module 5 datasheet — −20…+85 °C, ECC, MTBF App. E, High Risk Activities notice |
| [cm5p] | Raspberry Pi CM5 product page — production until at least January 2036 |
| [amc152] | EASA AMC 20-152A (AMC-20 Amdt 19) — COTS objectives, DAL D treatment, uprating, ECMP |
| [amc193] | EASA AMC 20-193 — multi-core applicability and exclusion at DAL D/E |
| [norsee] | FAA PS-AIR-21.8-1602 — NORSEE: MDR, "assumes the equipment will fail", human factors |
| [k4] | Keystone Compliance, DO-160 §4 temperature & altitude categories |
| [tdx] | Toradex Verdin iMX8M Plus — industrial temperature, inline ECC |
| [imx95] | Toradex Verdin iMX95 — −40…+85 °C, availability to 2039, M7/M33 |
| [jet] | NVIDIA Jetson product lifecycle |
| [coreavi] | CoreAVI VkCore SC product brief (hosted by Arm, FuSa partners) |
| [coreavimali] | CoreAVI DO-178C DAL A driver for Arm Mali-G78AE |
| [versal] | AMD Versal AI Edge Gen 2 — Mali-G78AE Linux DDK |
| [bst] | Black Sesame Wudang C1200 — shipping silicon with Mali-G78AE |
| [ait] | Aitech A178-AV rugged avionics GPGPU (EOL) |
| [rdx] | Radxa ROCK 5T — RK3588J industrial temperature option |
| [eda] | EDATEC ED-IPC3100 industrial CM5 computers |

Standards referenced without a link (purchase required): RTCA DO-160G / EUROCAE ED-14G,
RTCA DO-254 / ED-80 §11.2–11.3, IEC/TR 62240-1 (thermal uprating), IEC 62239-1 (ECMP),
SAE EIA-STD-4899, IEC 62402 (obsolescence), GEIA-STD-0005-1/-2 (lead-free control),
SAE ARP4754A / ARP4761, FAA AC 23.1309-1E, EASA CS-STAN.
