#!/usr/bin/env python3
"""Identify a u-blox GNSS receiver and look for signs that it is a clone.

Read-only: it only sends UBX poll requests and never changes or saves the
receiver configuration. Stop the daemon first so it does not own the port:

    sudo systemctl stop stratux
    python3 ublox_probe.py /dev/ublox8
    sudo systemctl start stratux

Needs pyserial (python3-serial, already on the RB-01 image).
See docs/hardware/gps-authenticity.md for how to read the output.
"""
import argparse
import struct
import sys
import time

import serial

BAUDS = (9600, 38400, 115200, 57600, 19200, 230400, 460800)
GNSS = {0: "GPS", 1: "SBAS", 2: "Galileo", 3: "BeiDou", 4: "IMES", 5: "QZSS", 6: "GLONASS"}


def ubx(cls, mid, payload=b""):
    msg = struct.pack("<BBH", cls, mid, len(payload)) + payload
    a = b = 0
    for c in msg:
        a = (a + c) & 0xFF
        b = (b + a) & 0xFF
    return b"\xb5\x62" + msg + bytes([a, b])


def frames(buf, cls, mid):
    """Return the payloads of every complete, checksum-valid UBX cls/mid frame."""
    out, i = [], 0
    while True:
        i = buf.find(b"\xb5\x62", i)
        if i < 0 or i + 8 > len(buf):
            return out
        ln = struct.unpack("<H", buf[i + 4:i + 6])[0]
        end = i + 8 + ln
        if end <= len(buf) and buf[i + 2] == cls and buf[i + 3] == mid:
            if ubx(cls, mid, buf[i + 6:i + 6 + ln]) == buf[i:end]:
                out.append(buf[i + 6:i + 6 + ln])
        i += 2


def ack(buf, cls, mid):
    for p in frames(buf, 0x05, 0x01):
        if p[:2] == bytes([cls, mid]):
            return "ACK"
    for p in frames(buf, 0x05, 0x00):
        if p[:2] == bytes([cls, mid]):
            return "NAK"
    return "no reply"


def read_for(port, seconds):
    buf, end = b"", time.time() + seconds
    while time.time() < end:
        buf += port.read(4096)
    return buf


def cstr(b):
    return b.split(b"\0")[0].decode(errors="replace").strip()


def find_baud(device):
    for baud in BAUDS:
        port = serial.Serial(device, baud, timeout=0.2)
        port.reset_input_buffer()
        raw = read_for(port, 1.5)
        port.write(ubx(0x0A, 0x04))
        raw += read_for(port, 1.0)
        nmea = raw.count(b"$G")
        print(f"  {baud:>6} baud: {len(raw):5} bytes, {nmea:3} NMEA sentences")
        if nmea > 2 or frames(raw, 0x0A, 0x04):
            return port, baud, raw
        port.close()
    return None, None, b""


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("device", nargs="?", default="/dev/ublox8")
    args = ap.parse_args()

    flags = []
    print(f"Device {args.device}, looking for the baud rate:")
    port, baud, sample = find_baud(args.device)
    if not port:
        print("No receiver answered at any baud rate.")
        return 1

    def poll(cls, mid, payload=b"", wait=1.2):
        port.reset_input_buffer()
        port.write(ubx(cls, mid, payload))
        raw = read_for(port, wait)
        got = frames(raw, cls, mid)
        return (got[0] if got else None), raw

    lines = [l for l in sample.split(b"\r\n") if l.startswith(b"$")]
    print("\nNMEA sentence types:", " ".join(sorted({cstr(l[1:6]) for l in lines})))

    print("\n== UBX-MON-VER (firmware and hardware version)")
    p, _ = poll(0x0A, 0x04)
    protver, ext = 0.0, []
    if p is None:
        print("  no reply")
        flags.append("No reply to UBX-MON-VER: every genuine u-blox 6 or later answers it.")
    else:
        sw, hw = cstr(p[0:30]), cstr(p[30:40])
        ext = [cstr(p[k:k + 30]) for k in range(40, len(p), 30)]
        print(f"  SW  {sw}\n  HW  {hw}")
        for e in ext:
            print(f"  EXT {e}")
            if e.startswith("PROTVER"):
                try:
                    protver = float(e[7:].strip(" ="))
                except ValueError:
                    pass
        if hw == "00080000" and sw.startswith("2.01"):
            flags.append("u-blox M8 with ROM 2.01 (2014-15 silicon). Clone M8 chips report "
                         "this; genuine M8 parts made since about 2016 report ROM CORE 3.01.")
        if hw == "00080000" and not any(e.startswith("FWVER") for e in ext):
            print("  (no FWVER line: running from ROM, no flash)")

    print("\n== UBX-MON-GNSS (supported constellations)")
    p, _ = poll(0x0A, 0x28)
    if p is None:
        print("  no reply")
    else:
        names = lambda m: ", ".join(n for bit, n in enumerate(("GPS", "GLONASS", "BeiDou", "Galileo")) if m >> bit & 1)
        print(f"  supported: {names(p[1])}\n  enabled:   {names(p[3])}")
        if not p[1] >> 3 & 1:
            print("  (no Galileo support)")

    print("\n== UBX-SEC-UNIQID (unique chip ID, protocol 18 and later)")
    p, _ = poll(0x27, 0x03)
    print("  " + (p[4:9].hex() if p else "no reply"))
    if p is None and protver >= 18:
        flags.append(f"No unique chip ID although the firmware claims protocol {protver:.2f}.")

    print("\n== UBX-CFG-PRT (port configuration as the receiver reports it)")
    for pid in (None, 1):
        p, raw = poll(0x06, 0x00, b"" if pid is None else bytes([pid]))
        label = "port this poll came in on" if pid is None else "UART1"
        if p is None:
            print(f"  {label}: {ack(raw, 0x06, 0x00)}")
            continue
        cfg_baud = struct.unpack("<I", p[8:12])[0]
        print(f"  {label}: portID {p[0]} baud {cfg_baud} "
              f"inProto {struct.unpack('<H', p[12:14])[0]:#x} outProto {struct.unpack('<H', p[14:16])[0]:#x}")
        if p[0] == 1 and cfg_baud != baud:
            flags.append(f"Port reports {cfg_baud} baud but is really talking at {baud} baud. A genuine "
                         "receiver applies a baud change at once, so the two always agree.")
            break

    print("\n== UBX-MON-HW (antenna, noise, jamming)")
    p, _ = poll(0x0A, 0x09)
    if p is None:
        print("  no reply")
    else:
        noise, agc = struct.unpack("<HH", p[16:20])
        ant = {0: "INIT", 1: "DONTKNOW", 2: "OK", 3: "SHORT", 4: "OPEN"}.get(p[20], p[20])
        print(f"  antenna {ant}, power {('OFF', 'ON', 'DONTKNOW')[p[21]] if p[21] < 3 else p[21]}, "
              f"noise {noise}, AGC {agc}/8191, jamming indicator {p[45]}/255")

    print("\n== UBX-NAV-PVT (fix)")
    p, _ = poll(0x01, 0x07)
    if p is None:
        print("  no reply")
    else:
        print(f"  fix type {p[20]}, satellites used {p[23]}, UTC "
              f"{struct.unpack('<H', p[4:6])[0]}-{p[6]:02}-{p[7]:02} {p[8]:02}:{p[9]:02}:{p[10]:02}")

    print("\n== UBX-NAV-SAT (satellites)")
    p, _ = poll(0x01, 0x35)
    if p is None:
        print("  no reply")
    else:
        print(f"  {p[5]} satellites")
        for k in range(p[5]):
            s = p[8 + 12 * k:20 + 12 * k]
            print(f"    {GNSS.get(s[0], s[0]):8} sv {s[1]:3}  C/N0 {s[2]:2} dBHz  "
                  f"elev {struct.unpack('b', s[3:4])[0]:4}  used {s[8] >> 3 & 1}")
    port.close()

    print("\n== Red flags")
    for f in flags:
        print("  - " + f)
    if not flags:
        print("  none found (a good clone can still pass these checks)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
