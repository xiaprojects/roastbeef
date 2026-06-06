# Other Output Transports (FLARM/NMEA, X-Plane, CoT)

Beyond [GDL90 over UDP :4000](gdl90.md), Stratux emits the same fused traffic/GPS/AHRS over
several other transports, and accepts two inbound feeds. Output routing is governed by the
`Capability` bitmask described in the [integration overview](README.md). The relevant code is
`main/network.go`, `main/flarm-nmea.go`, `main/xplane.go`, and `main/cot-in.go`.

## FLARM / NMEA

Stratux produces standard FLARM/NMEA sentences — `$PFLAA` and `$PFLAU` (traffic), `$GPRMC`,
`$GPGGA`, `$GPGSA` (position/fix), and `$PGRMZ` (pressure altitude). Generators are in
`main/flarm-nmea.go`. The same NMEA stream is offered four ways:

- **UDP `:2000`** — pushed to DHCP-lease clients (one of the three default `NetworkOutputs`).
  An EFB on the Stratux Wi-Fi receives FLARM NMEA here automatically, in parallel with GDL90
  on `:4000`.
- **TCP `:2000`** — an "AirConnect-like" NMEA-out listener. Here the **client dials in** to
  Stratux (the opposite of the UDP push model).
- **Serial** — `serialOutWatcher()` autodetects serial adapters (udev symlinks
  `/dev/serialout0`, `/dev/serialout_nmea0…2`), opens them (typically 38400 baud), and sends
  the configured protocol (default FLARM/NMEA). Configure via the `SerialOutputs` setting.
- **Bluetooth LE** — `initBluetooth()` advertises GATT services and streams FLARM/NMEA over
  BLE. Two default profiles are provided: a SoftRF-style profile (`FFE0`/`FFE1`) and the
  Nordic UART service (`6E400001-…`). Configure via the `BleOutputs` setting.

All four carry `Capability` bit `NETWORK_FLARM_NMEA` (8).

## X-Plane / ForeFlight-sim (UDP :49002)

`sendXPlane()` emits X-Plane–format UDP datagrams — GPS, attitude, and traffic
(`createXPlaneGpsMsg` / `createXPlaneAttitudeMsg` / `createXPlaneTrafficMsg` in
`main/xplane.go`). This is one of the three default `NetworkOutputs` (UDP `:49002`,
`Capability` `2|16` = 18). It is consumed by SkyDemon, X-Plane, and other tools that expect
the ForeFlight-sim / X-Plane datagram format. ForeFlight-sim outputs force one message per UDP
packet.

## Inbound feeds

These are **inputs**, not outputs — Stratux consumes data from them:

- **Cursor-on-Target (CoT) in** — `cotListen()` accepts CoT events over UDP `:8087` and
  injects them as traffic (e.g. from ATAK). See `main/cot-in.go`.
- **NMEA in (TCP :30011)** — a listener that lets an external device (e.g. an OGN tracker)
  feed NMEA into Stratux over TCP. The remote IP is surfaced as `GPS_NetworkRemoteIp` in
  `/getStatus` so you can point the external device at the right address.

## Where the outputs are configured

`NetworkOutputs`, `SerialOutputs`, and `BleOutputs` in
[settings-reference.md](../settings-reference.md) define these transports. Each entry's
`Capability` field controls which message classes it gets; the defaults are described in the
[integration overview](README.md).
