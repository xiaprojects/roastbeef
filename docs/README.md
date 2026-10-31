# Stratux Developer Documentation

These are the **developer-facing** docs that track the code (build, architecture, APIs,
hardware integration). User-facing how-tos live in the
[project wiki](https://github.com/stratux/stratux/wiki) — see
[the main README](../README.md#docs-in-repository-vs-in-wiki) for the rationale of that split.

## Start here

- **[architecture.md](architecture.md)** — what the daemon is, the three signal-source
  patterns, fusion and output, the web UI. Read this first.
- **[building.md](building.md)** — build targets, CI/release workflows, repo organization, and
  the OTA update process.
- **[dev-setup.md](dev-setup.md)** — setting up a development environment (remote on a Pi, or
  local Linux).

## Interfaces (for EFB / app / tool developers)

- **[integration/README.md](integration/README.md)** — the transport map (GDL90, FLARM/NMEA,
  X-Plane, CoT) and the `Capability` routing bitmask. Start here for output integration.
  - [integration/gdl90.md](integration/gdl90.md) — GDL90 over UDP, recognizing Stratux, sleep
    mode, traffic lifecycle, ForeFlight specifics.
  - [integration/other-transports.md](integration/other-transports.md) — FLARM/NMEA
    (TCP/UDP/serial/BLE), X-Plane, Cursor-on-Target.
  - [integration/nmea-navigation-output.md](integration/nmea-navigation-output.md) — spec
    (proposed): autopilot NMEA for an external HSI (`$GPRMB`/`$GPBOD`/`$PGRMH` VNAV).
  - [integration/pgrmh-format.md](integration/pgrmh-format.md) — `$PGRMH` wire format:
    fields, encoding, null rules, test vectors, reference encoder.
  - [integration/slave-nmea-display-format.md](integration/slave-nmea-display-format.md) —
    `$RBATT`/`$RBAIR`, the attitude and air data RB-01 sends a slave display (RB-09).
- **[http-api.md](http-api.md)** — the full HTTP + WebSocket JSON API.
- **[settings-reference.md](settings-reference.md)** — every `stratux.conf` / `/getSettings`
  field.
- **[terrain-elevations.md](terrain-elevations.md)** — the `elevations.json` terrain grid
  behind synthetic vision: format, grid geometry, how the HMI reads it, known gaps, and a
  proposed water layer.

## Hardware

- **[hardware/README.md](hardware/README.md)** — overview + the udev-recognized USB device
  table.
  - [hardware/sdr-and-bands.md](hardware/sdr-and-bands.md) — RTL-SDR dongles and band
    assignment.
  - [hardware/gps.md](hardware/gps.md) — GPS/GNSS receivers.
  - [hardware/sensors.md](hardware/sensors.md) — barometric and IMU/AHRS sensors.
  - [hardware/ogn-ais-receivers.md](hardware/ogn-ais-receivers.md) — OGN trackers (RX/TX),
    AIS, and external ADS-B receivers (Ping/Pong/UATRadio).

## Tech debt

Point-in-time audits tracking cleanup backlogs. Findings are candidates, not commitments —
re-verify before acting.

- **[tech-debt/modernization.md](tech-debt/modernization.md)** — outdated dependencies,
  deprecated language/stdlib usage, EOL frameworks (AngularJS), and aging build/CI/packaging
  tooling, with a prioritized backlog and suggested sequencing.
- **[tech-debt/dead-code.md](tech-debt/dead-code.md)** — functions, types, and fields that are
  defined but never referenced.

## Certification

- **[certification/roadmap.md](certification/roadmap.md)** — ordered plan (easiest first) to
  bring RB-01 under DO-178C / ED-12C and the related standards (DO-160, DO-330, DO-200B,
  DO-326A, ARP4761), with the reality check on the current stack and the recommended
  NORSEE / CS-STAN target.
- **[certification/scmp.md](certification/scmp.md)** — configuration management plan:
  how items are identified (version, build id, hashes), change control, archive, load
  control; pending actions listed.
- **[certification/provenance.md](certification/provenance.md)** — every prebuilt binary and
  vendored library with version, origin, licence and SHA-256; verified by `make check`.
- **[certification/fha.md](certification/fha.md)** — preliminary functional hazard
  assessment: installation assumptions, failure conditions and proposed DAL per function.
- **[certification/standards/requirements.md](certification/standards/requirements.md)** —
  the requirements standard: identifier scheme, required fields, phrasing rules, derived
  requirements, traceability and the review checklist. Read it before touching
  [`requirements/`](../requirements/).
- **[../requirements/](../requirements/)** — the system and software high-level
  requirements themselves, with `scripts/trace.py` enforcing the trace both ways from
  `make check`.
- **[certification/agent-tasks.md](certification/agent-tasks.md)** — the open roadmap
  items rewritten as self-contained briefs a coding agent can execute in this checkout,
  each graded by whether an agent can finish it alone, needs a human decision first, or is
  not agent work at all.
- **[certification/hardware/platform-assessment.md](certification/hardware/platform-assessment.md)**
  — how the standards treat a COTS board, the Raspberry Pi 5 compliance fact sheet, the
  derogation register (12 findings with the clause that carries each), and a graded
  reference table of ARM64 alternatives compatible with the RB-01.

## Doc conventions

- Keep these docs in sync with the code in the same PR — they are reviewed alongside code
  changes.
- Cite code by package/file where it helps (`main/sdr.go`, `main/traffic.go`, …) rather than
  pinning line numbers that drift.
- User how-tos and buyer's-guide content belong in the wiki; cross-link instead of
  duplicating.
