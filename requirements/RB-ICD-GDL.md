# Interface Requirements — GDL90 Output (`GDL`)

The GDL90 link to EFB clients, over UDP port 4000 and mirrored on the `/gdl90` WebSocket.
These requirements cover the **transport**: framing, byte stuffing, checksum and the
ownship report. Per-message content requirements live with the function that produces the
message — traffic reports are in [`RB-HLR-TRF.md`](RB-HLR-TRF.md).

Normative reference: GDL 90 Data Interface Specification, 560-1058-00 Rev A
(`notes/GDL90_Public_ICD_RevA.PDF`). Recovered from `main/gen_gdl90.go` under
DO-178C §12.1.4; see also [`../docs/integration/gdl90.md`](../docs/integration/gdl90.md).

---

### RB-ICD-GDL-010 — Message framing

**The system shall frame every GDL90 message between two 0x7E flag bytes, with a
CRC-CCITT of the payload appended low byte first, such that the frame produced for the
specification's worked heartbeat example is byte-identical to the example.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/gen_gdl90.go` `prepareMessage()`; GDL90 ICD §2.2.1
- **Verification:** test
- **Derived:** no

### RB-ICD-GDL-020 — Byte stuffing

**The system shall replace every 0x7D and 0x7E byte occurring in a message payload or its
checksum with 0x7D followed by that byte exclusive-ORed with 0x20.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/gen_gdl90.go` `prepareMessage()`; GDL90 ICD §2.2.1
- **Verification:** test
- **Derived:** no

### RB-ICD-GDL-030 — No flag byte within a frame

**The system shall emit no 0x7E byte between the opening and closing flag bytes of a
framed message, for any payload content.**

- **Parent:** RB-SYS-TRF-050
- **Source:** `main/gen_gdl90.go` `prepareMessage()`; GDL90 ICD §2.2.1
- **Verification:** test
- **Derived:** no

Stated separately from RB-ICD-GDL-020 because it is the property a receiver depends on —
that a flag byte unambiguously delimits a message — and it is verifiable over arbitrary
payloads rather than over the two stuffed values.

### RB-ICD-GDL-040 — Ownship report requires a position

**The system shall transmit no ownship report until a valid own position is available.**

- **Parent:** RB-SYS-SYS-020
- **Source:** `main/gen_gdl90.go` `makeOwnshipReport()`
- **Verification:** test
- **Derived:** no

Recovered after a defect: for the first 10 s of uptime an ownship report went out at
0°N 0°E, 0 ft, "airborne", because the empty ownship record looked fresh against a stratux
clock that itself starts at zero. An EFB receiving that draws the aircraft in the Gulf of
Guinea — misleading own-position information, which is the one thing this interface must
never produce.

### RB-ICD-GDL-050 — Stratux AHRS message

**The system shall transmit the attitude as a 24-byte message identified by the bytes
0x4C 0x45 0x01 0x01, carrying roll, pitch, heading and slip/skid in tenths of a degree,
turn rate in tenths of a degree per second, load factor in tenths of a g, indicated
airspeed, pressure altitude offset by +5000 ft, and vertical speed in feet per minute,
each as a big-endian 16-bit field, with 0x7FFF — 0xFFFF for the unsigned pressure
altitude — meaning unavailable.**

- **Parent:** RB-SYS-ATT-070
- **Source:** `main/gps.go` `makeAHRSGDL90Report()`; `docs/integration/gdl90.md`
- **Verification:** test
- **Derived:** no

Two details are the message's own and not derivable from the fields: slip/skid is
transmitted with its sign inverted relative to the internal value, and indicated airspeed
is always unavailable even when a pitot sensor is fitted, because the field was never
wired to it. The pressure fields follow the barometer alone, so they stay valid while the
attitude is not.

### RB-ICD-GDL-060 — ForeFlight AHRS message

**The system shall transmit the attitude as a 12-byte message identified by the bytes
0x65 0x01, carrying roll and pitch in tenths of a degree as big-endian 16-bit fields with
0x7FFF meaning unavailable, and heading, indicated airspeed and true airspeed as
unavailable.**

- **Parent:** RB-SYS-ATT-070
- **Source:** `main/gps.go` `makeFFAHRSMessage()`; ForeFlight GDL90 extension
- **Verification:** test
- **Derived:** no
