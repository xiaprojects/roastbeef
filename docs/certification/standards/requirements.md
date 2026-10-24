# Requirements Standard

Roadmap Step 2 deliverable, and the rulebook for the `requirements/` tree. DO-178C
§11.6 (Software Requirements Standards), supporting Table A-1 obj. 5 and the review
objectives of Table A-3.

Status: issue 1, 2026-10-24.

## 1. Scope

This standard governs **system requirements** and **software high-level requirements
(HLRs)** for the RB-01 certified core as scoped in `../fha.md`. Low-level requirements are
out of scope until the target DAL is C (roadmap Step 7); if that happens, this standard
gains an LLR section rather than being replaced.

It does **not** govern the Level E functions. Writing a requirement for one is not
forbidden, but it buys no certification credit and must not consume review effort.

## 2. Where requirements live

Plain Markdown under `requirements/`, one file per function, reviewed in pull requests
like code. No requirements-management tool, no database, no export step.

| File | Contents |
|---|---|
| `requirements/RB-SYS.md` | System requirements for the certified core |
| `requirements/RB-HLR-<FUNC>.md` | Software HLRs for one function |
| `requirements/untraced.txt` | The agreed budget of requirements that have no test yet |

The rationale is the same one the rest of this repository follows: an artifact that is not
in git next to the code it describes goes stale, and a trace matrix that is not regenerated
on every commit is a snapshot of a tree nobody has any more.

## 3. Identifier scheme

```
RB-SYS-<FUNC>-<nnn>      system requirement
RB-HLR-<FUNC>-<nnn>      software high-level requirement
RB-ICD-<IFACE>-<nnn>     interface requirement
```

- `<FUNC>` is a 3-letter function code, fixed by this standard: `ATT` attitude and AHRS,
  `ALT` altimetry, `SPD` speed, `HDG` heading, `TRF` traffic, `ALR` alerts, `EMS` engine,
  `SIT` the situation (GPS fix and fused state), `SYS` whole-unit behaviour.
- `<nnn>` is a zero-padded three-digit number, allocated in steps of 10 within a file so
  related requirements can be inserted later without renumbering.
- **Identifiers are permanent.** A requirement that is withdrawn keeps its number and is
  marked `Status: withdrawn`; the number is never reused. Renumbering silently invalidates
  every test tag, review record and trace matrix that referenced the old number.

## 4. Form of a requirement

Each requirement is a level-3 heading followed by a bolded requirement sentence and a
metadata list. The format is machine-parsed by `scripts/trace.py`, so it is strict:

```markdown
### RB-HLR-TRF-010 — Stale position reports are not transmitted

**The system shall not transmit a traffic position report to an EFB client when the
position is 6 s or more old.**

- **Parent:** RB-SYS-TRF-020
- **Source:** `main/traffic.go` `trafficCycle()`; FHA-TRF-2
- **Verification:** test
- **Derived:** no
```

| Field | Rule |
|---|---|
| **Parent** | The requirement this one implements: a `RB-SYS-…` id for an HLR, or `none` for a derived requirement. Never empty. |
| **Source** | Where the requirement comes from: the code it was reverse-engineered from (§12.1.4), the FHA row that demands it, the ICD clause, or the standard. |
| **Verification** | `test`, `analysis`, `review`, or `inspection`. `test` is the default and anything else needs a sentence of justification in the requirement body. |
| **Derived** | `yes` if the requirement has no parent above it — a design decision rather than a flow-down. Derived requirements **must** be fed back to the safety assessment (§6). |
| **Status** | Optional. `withdrawn` or `planned`. Absent means active. |

## 5. How to write the requirement sentence

1. **One "shall" per requirement.** Two shalls are two requirements. "and" joining two
   testable behaviours is the usual tell.
2. **Verifiable.** A reader must be able to describe the test that would fail if the
   implementation were wrong. "The display shall be clear" is not a requirement;
   "the attitude indication shall be replaced by a cross within 1 s of the last valid
   sample" is.
3. **Numbers carry units and tolerances.** `6 s`, `±2000 ft`, `1 kt`, `0.1°`. A bare
   number is a defect. Where the code uses one unit internally and the API another, state
   both and name the conversion.
4. **State the behaviour, not the implementation.** "shall not transmit a report older
   than 6 s", not "shall check `ti.Age < 6` in `trafficCycle`". The implementation goes in
   **Source** so the trace survives a refactor.
5. **Negative and robustness cases are requirements too**, and are the ones that matter
   here: what happens on an out-of-range value, a malformed frame, a lost sensor, a stale
   input. Every input named in a requirement needs its invalid-input behaviour specified
   somewhere.
6. **No "should", "may", "typically", "as appropriate", "etc.", "TBD".** `shall` for a
   requirement; prose for explanation, clearly outside the bolded sentence.
7. **Tolerate no silent coupling.** If a requirement only holds while a setting has a
   particular value, say so in the sentence.

## 6. Derived requirements

A requirement with `Derived: yes` has no parent in the system requirements — it exists
because of a design or implementation decision. DO-178C requires these to be given back to
the safety assessment process, because the FHA could not have considered them.

The mechanism here: every derived requirement is listed in `../fha.md` §4 under the
function it belongs to, with one line saying why it cannot create a new failure condition
or which existing row covers it. `scripts/trace.py` reports derived requirements that are
not mentioned in the FHA.

## 7. Traceability

Bidirectional, enforced on every commit by `scripts/trace.py` (run from `make check`):

```
RB-SYS-xxx  ←→  RB-HLR-xxx  ←→  test function
```

- A test declares what it verifies with a `Covers:` line in the comment block above it:
  `// Covers: RB-HLR-TRF-010, RB-HLR-TRF-020`. Go tests, and Python tests under
  `test/display/` and `test/integration/`, use the same syntax.
- **Hard errors, which fail the build:** a `Covers:` tag naming an identifier that does not
  exist; a duplicate identifier; a malformed requirement block; an HLR whose parent does
  not exist; a non-derived HLR with `Parent: none`.
- **Reported but not fatal:** a requirement with no covering test. These are the honest
  work-in-progress, and they are held to a budget in `requirements/untraced.txt` which may
  only shrink. This is the same discipline as `test/display/known.py`: a permanently red
  gate teaches everyone to ignore it, and a silently skipped one hides the gap.

## 8. Review

A requirement is reviewed in the pull request that introduces it, against this checklist.
The reviewer records it by ticking the list in a PR review comment — that is the review
record for Table A-3.

- [ ] Exactly one `shall`, and it is verifiable
- [ ] Numbers have units and, where relevant, tolerances
- [ ] Behaviour, not implementation
- [ ] Invalid, out-of-range and stale inputs are specified (here or in a named sibling)
- [ ] No ambiguous verb or TBD
- [ ] Parent exists and the flow-down is real; or `Derived: yes` **and** it appears in the FHA
- [ ] Source cites the code, ICD clause or FHA row it came from
- [ ] Does not contradict another requirement (check the siblings in the same file)
- [ ] Verification method is achievable with the harness that exists, or the gap is noted

## 9. Reverse-engineering from existing code

The core was written before these requirements existed, so most HLRs are recovered from
code under DO-178C §12.1.4. Two rules keep that honest:

1. **Write what the code should do, then check whether it does.** If the code is wrong, the
   requirement stays and a problem report is raised against the code. Documenting a bug as
   a requirement is the main failure mode of this activity.
2. **Mark the uncertain ones.** Where the intended behaviour cannot be recovered with
   confidence — a magic constant with no rationale, an undocumented interface quirk — the
   requirement body says so explicitly and the item goes on the list for the next review
   with the author. It does not get a confident-sounding sentence it has not earned.
