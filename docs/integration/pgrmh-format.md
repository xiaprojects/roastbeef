# `$PGRMH` — Aviation Height and VNAV Data: Format Specification

**Status:** proposed, 2026-10-12.

**What this file covers.** It defines the sentence **on the wire**: structure, field encoding,
null and invalid rules, and test vectors. Field *meaning* comes from Garmin 190-00684-00 Rev. C,
§2.2.4. The formatting choices Garmin leaves open (number format, rounding, saturation, null
encoding) are fixed here.

**Where the values come from.** How RB-01 computes each value (nav solution, VNAV model) is in
[nmea-navigation-output.md](nmea-navigation-output.md) §5.1 and §6. Where the two files
disagree on encoding, **this file wins**.

## 1. Sentence structure

```
$PGRMH,<1>,<2>,<3>,<4>,<5>,<6>,<7>,<8>*hh<CR><LF>
```

| Element | Rule |
|---|---|
| Address | `$` + `P` (proprietary) + `GRM` (Garmin) + `H` |
| Fields | exactly **8**, so exactly 8 commas after `PGRMH`. A null field is empty but **keeps its comma**; trailing commas are never dropped (`$PGRMH,V,,,,,,,`) |
| Checksum | `*` + two **uppercase** hex digits: the XOR of every byte between `$` and `*`, both exclusive. RB-01 uses `appendNmeaChecksum()` (`main/flarm-nmea.go`) |
| Terminator | `\r\n` |
| Characters | `0-9`, `-`, `A`, `V`, `,`, plus the `$ * \r \n` framing. No spaces, no `+` sign, no leading zeros |
| Length | ≤ 82 characters including `$` and `\r\n` (NMEA 0183). Worst case for this encoding is **50** (§5) |

Garmin's printed template reads `<8>hh<CR><LF>`. The missing `*` is a typo: the checksum
delimiter is required as in every NMEA sentence.

## 2. Fields

| # | Name (Garmin) | Unit | Sign | Encoded range | Encoding | Null when (RB-01) |
|---|---|---|---|---|---|---|
| 1 | Data status | — | — | `A` / `V` | one character | never |
| 2 | Vertical speed | ft/min | **+ up**, − down | −9999 … 9999 | integer, §2.1 | no valid baro VS |
| 3 | VNAV profile error | ft | **+ above profile**, − below | **−999 … 999** | integer, §2.1, saturating | VNAV inactive |
| 4 | Vertical speed to VNAV target | ft/min | + up, − down | −9999 … 9999 | integer, §2.1 | VNAV inactive |
| 5 | Vertical speed to next waypoint | ft/min | + up, − down | −9999 … 9999 | integer, §2.1 | no target altitude on the TO waypoint |
| 6 | Approximate height above terrain | ft | ≥ 0 | 0 … 99900, multiple of 100 | §2.3 | **always** (no terrain model in the daemon) |
| 7 | Desired track | degrees **true** | — | 0 … 359 | §2.2 | status `V` only |
| 8 | Course of next route leg after the active waypoint | degrees **true** | — | 0 … 359 | §2.2 | no next leg (TO is the last waypoint) |

Field 1: `A` means data valid; Garmin prints the unusable value as lowercase `v`. RB-01 **emits
uppercase `V`**, the NMEA convention. Parsers must accept `V` and `v`, and treat anything other
than `A` as unusable.

Garmin gives ranges only for field 3. The ±9999 limit on fields 2/4/5 is an RB-01 choice: it
keeps each field within 5 characters.

### 2.1 Integers (fields 2–5)

1. Round half away from zero (Go `math.Round`).
2. Saturate to the field range: fields 2/4/5 to ±9999, field 3 to ±999.
3. Convert to `int` and format with `strconv.Itoa` / `%d`.

- **Never emit `-0`.** Formatting a float with `%.0f` turns −0.4 into `"-0"`; converting to
  `int` first gives `"0"`.
- Field 3 saturates; it does **not** go null when the error is out of range. "Far above the
  profile" is a real, pegged indication. Null means "no profile".

### 2.2 Courses (fields 7, 8)

1. Round to the nearest degree.
2. Normalise to [0, 360): `d = round(x) mod 360`, then `+360` if negative.

So 359.6 → `0`, and −10 → `350`. `360` is never sent.

### 2.3 Height above terrain (field 6)

Garmin: "rounded to next lowest 100 feet", i.e. `floor(max(0, h) / 100) · 100`. RB-01 sends it
null; the rule is here so a future terrain source encodes it correctly.

## 3. Null and invalid rules

1. **Null ≠ zero.** An empty field means *not available*. `0` is a real value: level flight in
   field 2, on-profile in field 3, north in field 7. Never write 0 as a stand-in.
2. **Status `V`** ⇒ fields 2–8 are all null: `$PGRMH,V,,,,,,,*16`. A parser ignores every field
   when the status is not `A`.
3. **Status `A`** ⇒ field 7 is present. Every other field may be null independently, except:
4. **Field 3 null ⇒ field 4 null.** Both describe the VNAV target. Field 5 may be present
   without them, since it needs only the TO waypoint's altitude.
5. **Consistency within a burst.** Field 7 equals `$GPBOD` field 1 of the same burst, rounded per
   §2.2.

### Other senders' conventions (passthrough)

An external navigator (sample in the `main/autopilotudp.go` header) encodes "no profile" with
values instead of nulls: `$PGRMH,A,0,-999,0,0,1300,341,0*21`. RB-01 passes external
sentences through unchanged and does not rewrite them.

How a receiver shows a null field 3 is **not specified by Garmin**. For the G5 it is bench item
B3 in [nmea-navigation-output.md](nmea-navigation-output.md) §10, which also gives the fallback
if a null field 3 draws a centred glide indicator.

## 4. Sign conventions at a glance

```
            field 3 (VNAV profile error)          fields 2 / 4 / 5 (vertical speeds)
  aircraft ●  above profile  →  +                 climbing   →  +
  ─────────── profile ─────     0                 level      →  0
  aircraft ●  below profile  →  −                 descending →  −
```

When the aircraft is above a descent profile, field 3 is positive, field 4 is more negative than
the on-path vertical speed, and the receiver's glide cue reads "fly down".

## 5. Test vectors

Every sentence below was produced by the reference encoder in §6, and its checksum was verified.
Lengths include `\r\n`. Inputs are the raw values before encoding; "—" means null.

| # | Case | Inputs (2 / 3 / 4 / 5 / 6 / 7 / 8) | Sentence | Len |
|---|---|---|---|---|
| T1 | VNAV active, last leg (worked example, implementation spec §6.4) | −500 / 559.4 / −686.1 / −514.6 / — / 232.1 / — | `$PGRMH,A,-500,559,-686,-515,,232,*1A` | 38 |
| T2 | Lateral only, VNAV inactive | −500 / — / — / — / — / 232.1 / — | `$PGRMH,A,-500,,,,,232,*2A` | 27 |
| T3 | Unusable (GPS invalid) | status `V` | `$PGRMH,V,,,,,,,*16` | 20 |
| T4 | Above profile beyond range: saturates | −300 / 1450 / −1210.6 / −905.2 / — / 232.1 / — | `$PGRMH,A,-300,999,-1211,-905,,232,*2A` | 39 |
| T5 | Below profile beyond range: saturates | 0 / −1200 / −120 / −90 / — / 232.1 / — | `$PGRMH,A,0,-999,-120,-90,,232,*2C` | 35 |
| T6 | Intermediate waypoint with next leg; no baro | — / — / — / — / — / 95.4 / 148.0 | `$PGRMH,A,,,,,,95,148*30` | 25 |
| T7 | DTK 359.6 → 0; VS −0.4 → `0`, never `-0` | −0.4 / — / — / — / — / 359.6 / 90 | `$PGRMH,A,0,,,,,0,90*08` | 24 |
| T8 | Negative course normalised; VS 12.5 rounds away from zero | 12.5 / — / — / — / — / −10 / — | `$PGRMH,A,13,,,,,350,*35` | 25 |
| T9 | Height above terrain 1349 → 1300 (future terrain source) | 150 / — / — / — / 1349 / 341 / — | `$PGRMH,A,150,,,,1300,341,*01` | 30 |
| T10 | VS saturates | −12000 / — / — / — / — / 10 / — | `$PGRMH,A,-9999,,,,,10,*2D` | 27 |
| T11 | Worst-case length | −9999 / −999 / −9999 / −9999 / 99900 / 359 / 359 | `$PGRMH,A,-9999,-999,-9999,-9999,99900,359,359*01` | 50 |

**Parser vector** (external sender, must be accepted as-is): `$PGRMH,A,0,-999,0,0,1300,341,0*21`.

## 6. Reference encoder (Go)

A `nil` pointer is a null field. Rounding, saturation and normalisation follow §2.

```go
// PGRMHData holds the raw values; nil = null field.
type PGRMHData struct {
	Valid         bool     // field 1
	VertSpeedFpm  *float64 // field 2
	VnavErrorFt   *float64 // field 3
	VsToTargetFpm *float64 // field 4
	VsToWptFpm    *float64 // field 5
	HatFt         *float64 // field 6
	DtkTrue       *float64 // field 7
	NextLegTrue   *float64 // field 8
}

// Round half away from zero, saturate, then int: never "-0".
func pgrmhInt(v *float64, limit float64) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(int(math.Max(-limit, math.Min(limit, math.Round(*v)))))
}

// Whole degrees in [0, 360): 359.6 -> 0, -10 -> 350.
func pgrmhDeg(v *float64) string {
	if v == nil {
		return ""
	}
	d := int(math.Round(*v)) % 360
	if d < 0 {
		d += 360
	}
	return strconv.Itoa(d)
}

// Rounded down to the next lowest 100 ft.
func pgrmhHat(v *float64) string {
	if v == nil {
		return ""
	}
	return strconv.Itoa(int(math.Floor(math.Max(0, *v)/100) * 100))
}

func makePGRMHString(d PGRMHData) string {
	msg := "$PGRMH,V,,,,,,,"
	if d.Valid {
		msg = "$PGRMH,A," + strings.Join([]string{
			pgrmhInt(d.VertSpeedFpm, 9999),
			pgrmhInt(d.VnavErrorFt, 999),
			pgrmhInt(d.VsToTargetFpm, 9999),
			pgrmhInt(d.VsToWptFpm, 9999),
			pgrmhHat(d.HatFt),
			pgrmhDeg(d.DtkTrue),
			pgrmhDeg(d.NextLegTrue),
		}, ",")
	}
	return appendNmeaChecksum(msg) + "\r\n"
}
```

The unit tests use the vectors in §5, as golden strings including the `\r\n`.

## 7. Parsing rules (for any receiver, including RB-01 if it ever decodes `$PGRMH`)

- Verify the checksum, case-insensitive hex. Drop the sentence on a mismatch.
- Split on `,` after the address. Missing trailing fields count as null, which tolerates
  truncated senders.
- Status: only `A` is valid; `V`, `v` or anything else makes the whole sentence unusable.
- Numbers: accept integers or decimals with an optional leading `-`. An empty field is null.
  Out-of-range values are clamped, not rejected.
- Don't treat field 3 = −999 or 999 as "no data". It is a pegged deviation (see the external
  sender convention in §3).

## References

- Garmin, *Garmin Proprietary NMEA 0183 Sentences — Technical Specifications*, 190-00684-00
  Rev. C, §2.2.4 *Aviation Height and VNAV Data (PGRMH)*.
- NMEA 0183: sentence framing, checksum, 82-character limit.
- [nmea-navigation-output.md](nmea-navigation-output.md): value sources, VNAV model, timing,
  bench procedure.
