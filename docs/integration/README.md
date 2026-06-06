# Integrating with Stratux

Stratux is not "GDL90 over UDP and nothing else." It simultaneously offers several output
transports plus a couple of inbound ones, so an EFB/EFIS/app can pick whatever fits. This
page is the map; the linked docs have the detail.

## Transport map

| Transport | Port / path | Payload | Direction | Typical consumer |
|---|---|---|---|---|
| **GDL90** | UDP `:4000` | GDL90 (binary) | push → DHCP-lease + `StaticIps` clients | ForeFlight and most EFBs |
| **GDL90** | WebSocket `/gdl90` | GDL90 (binary) | push to connected WS client | web UI, browser apps |
| **FLARM / NMEA** | UDP `:2000` | `$PFLAA`/`$PFLAU`/`$GPRMC`/… | push → DHCP-lease clients | EFIS, FLARM-aware apps |
| **FLARM / NMEA** | TCP `:2000` | same NMEA | client **dials in** | AirConnect-style apps |
| **FLARM / NMEA** | serial (`/dev/serialout*`) | configurable (default NMEA) | push over wire | panel EFIS |
| **FLARM / NMEA** | Bluetooth LE (GATT) | same NMEA | push to paired device | BLE EFBs, SoftRF-style apps |
| **X-Plane / FF-sim** | UDP `:49002` | GPS + attitude + traffic datagrams | push → DHCP-lease clients | SkyDemon, X-Plane |
| **Cursor-on-Target** | UDP `:8087` | CoT XML | **inbound** | ATAK (injects traffic) |
| **NMEA in** | TCP `:30011` | NMEA | **inbound** | external OGN tracker feeding data in |
| **HTTP / WebSocket JSON** | TCP `:80` | JSON | request / stream | any tool, see below |

Details:

- [gdl90.md](gdl90.md) — the GDL90/UDP protocol, how to recognize Stratux, sleep mode, traffic lifecycle, ForeFlight specifics.
- [other-transports.md](other-transports.md) — FLARM/NMEA (TCP/UDP/serial/BLE), X-Plane, Cursor-on-Target, and the `Capability` bitmask.
- [http-api.md](../http-api.md) — the full HTTP + WebSocket JSON API (status, situation, traffic, weather, settings…).
- [settings-reference.md](../settings-reference.md) — every setting, including the output configuration (`NetworkOutputs`, `SerialOutputs`, `BleOutputs`).

## How outputs are selected: the `Capability` bitmask

Each output (a `networkConnection`, `serialConnection`, or `bleConnection`) carries a static
`Capability` bitmask that decides which classes of message it receives. There is **no runtime
capability negotiation** with the client — the bits are fixed per output. Values:

| Bit | Value | Meaning |
|---|---|---|
| `NETWORK_GDL90_STANDARD` | 1 | Standard GDL90 messages |
| `NETWORK_AHRS_FFSIM` | 2 | AHRS in ForeFlight-sim (X-Plane) format |
| `NETWORK_AHRS_GDL90` | 4 | AHRS as the GDL90 `0x4C` message |
| `NETWORK_FLARM_NMEA` | 8 | FLARM/NMEA sentences |
| `NETWORK_POSITION_FFSIM` | 16 | Position in ForeFlight-sim (X-Plane) format |

So the three default UDP outputs are `:4000` = `1|4` = **5** (GDL90 + GDL90-AHRS), `:2000` =
**8** (FLARM/NMEA), and `:49002` = `2|16` = **18** (X-Plane position + attitude). ForeFlight-sim
outputs also force one message per UDP packet.

## Networking basics

- Default Stratux IP is `192.168.10.1` in AP mode (the DHCP-assigned address in client mode).
- No authentication — it is a local AP network, HTTP not HTTPS.
- UDP push outputs send to every device holding a DHCP lease, plus any `StaticIps`.
