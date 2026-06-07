# SDR Dongles & Band Assignment

Stratux uses generic **RTL2832U** RTL-SDR USB dongles (typically with R820T/R820T2 tuners,
or any librtlsdr-compatible tuner). The tuner type is queried and logged but not gated, so
any working RTL-SDR should function. SDR handling lives in `main/sdr.go`.

Up to **three** dongles are used simultaneously, each demodulated by a different backend:

| Band | Frequency | Device tag | Demodulator |
|---|---|---|---|
| 1090ES (ADS-B) | 1090 MHz | `ES` | `dump1090` (FlightAware fork) |
| UAT | 978 MHz | `UAT` | `godump978` (in-process via `libdump978.so`) |
| OGN / FLARM | 868 MHz | `OGN` | `ogn-rx-eu` (prebuilt binary in `ogn/`) |
| AIS (marine) | 161/162 MHz | `AIS` | `rtl_ais` |

## How dongles are assigned to bands

Each dongle is tagged by writing a string into its **EEPROM serial number**, which Stratux
reads at startup to decide which band the dongle serves. The scheme (matched by regex in
`main/sdr.go`, tolerant of a truncated "stratux"):

| Serial prefix | Band |
|---|---|
| `stratux:1090` | 1090ES |
| `stratux:978` | UAT |
| `stratux:868` | OGN |
| `stratux:162` | AIS |

You program these with **`debian/sdr-tool.sh`**, which wraps `rtl_eeprom` and writes
`stx:<freq>:<ppm>` (it offers an 868/978/1090 menu). The `:<ppm>` suffix lets you store a
per-dongle clock correction; if absent, `globalSettings.PPM` is used as the fallback.

### Assignment algorithm

`configDevices()` runs two passes:

1. **Pass 1** assigns each serial-tagged dongle to its tagged band.
2. **Pass 2** assigns any *untagged* (anonymous) dongles to whichever enabled band still
   needs one.

There is also a **fallback** mode (`stx:0:<ppm>`) written by `sdr-tool.sh`: a dongle tagged
this way will serve 1090ES, but fall back to 978 UAT if the dedicated UAT dongle is missing —
useful for single-dongle setups.

## Gain and PPM

- **1090ES** gain comes from `Dump1090Gain` (default `37.2`).
- **UAT** uses a fixed internal tuner gain.
- **PPM** is taken from the dongle serial suffix if present, otherwise from the `PPM` setting.

## Hot reconfiguration

`sdrWatcher()` monitors for changes and reconfigures the SDR assignment on the fly when:

- the number of connected dongles changes,
- a band enable flag (`UAT_Enabled` / `ES_Enabled` / `OGN_Enabled` / `AIS_Enabled`) changes, or
- the gain setting changes.

Each external demodulator subprocess (`dump1090`, `ogn-rx-eu`, `rtl_ais`) is spawned with
`exec.Command`, monitored, and **auto-restarted on crash**. UAT is decoded in-process and
does not run as a subprocess.

See [settings-reference.md](../settings-reference.md) for `UAT_Enabled`, `ES_Enabled`,
`OGN_Enabled`, `AIS_Enabled`, `PPM`, and `Dump1090Gain`.
