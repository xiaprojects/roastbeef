"""Rebuild the RB-01 FLARM-NMEA serial output from a flightlog sqlite.

Each sentence is formatted the way main/*.go formats it, with the flight's own
values, so the byte counts are real lengths. Rates come from the code:
  RPYL 20 Hz (sensors.go 50 ms loop), RBEMS 5 Hz / RBCYL 0.5 Hz (ems.go),
  RMC/GGA/PGRMZ/GSA + PFLAA per target + PFLAU 1 Hz (heartBeatSender),
  RBATT/RBAIR 1 Hz (SlaveNMEADisplay_SleepMs 1000),
  autopilot RMB/APB/BOD/XTE/PGRMH 1 Hz when a route is active.
Usage: python3 -I tools/nmea_out_budget.py flightlog.sqlite [min_gs_kt]
"""
import math, sqlite3, sys, statistics as st
from collections import defaultdict

OWN = 0x300A61
db = sqlite3.connect(sys.argv[1])
min_gs = float(sys.argv[2]) if len(sys.argv) > 2 else 40.0


def ck(body):
    c = 0
    for ch in body[1:]:
        c ^= ord(ch)
    return f"{body}*{c:02X}\r\n"


def latlon(lat, lng):
    ns = "N" if lat >= 0 else "S"; lat = abs(lat)
    ew = "E" if lng >= 0 else "W"; lng = abs(lng)
    d = math.floor(lat); lat = d * 100 + (lat - d) * 60
    d = math.floor(lng); lng = d * 100 + (lng - d) * 60
    return lat, ns, lng, ew


rows = db.execute("""
 select substr(t.GPSClock_value,12,8), GPSLatitude, GPSLongitude, GPSGroundSpeed, GPSTrueCourse,
        GPSSatellites, GPSAltitudeMSL, GPSGeoidSep, GPSFixQuality, BaroPressureAltitude, BaroVerticalSpeed,
        AHRSRoll, AHRSPitch, AHRSGyroHeading, AHRSSlipSkid, AHRSTurnRate, AHRSGLoad
 from mySituation m join timestamp t on t.id=m.timestamp_id""").fetchall()
sit = {}
for r in rows:
    sit.setdefault(r[0], []).append(r)

traffic = defaultdict(list)
for r in db.execute("""select substr(t.GPSClock_value,12,8), Icao_addr, Tail, Lat, Lng, Alt, Track, TurnRate, Speed, Vvel, Emitter_category
                        from traffic tr join timestamp t on t.id=tr.timestamp_id where Icao_addr != ?""", (OWN,)):
    traffic[r[0]].append(r)

ems = {}
for name, val in db.execute("select SensorName, SensorValue from ems where SensorValue != 0"):
    ems[name] = val  # last non-zero value: lengths are what matter


def e(k):
    return f"{ems.get(k, 0):.0f}"


rbems = ck("$RBEMS," + ",".join(e(k) for k in ["enginerpm", "manifoldpressure", "oiltemperature", "oilpressure",
                                               "coolanttemperature", "outsidetemperature", "fuelpressure", "fuel1", "fuel2"]))
rbcyl = ck("$RBCYL," + ",".join(e(k) for k in ["cht1", "cht2", "cht3", "cht4", "egt1", "egt2", "egt3", "egt4"]))

per_sec = defaultdict(list)  # type -> bytes per second, one entry per airborne second
examples = {}
for sec, rs in sorted(sit.items()):
    r = rs[-1]
    (_, lat, lng, gs, trk, sats, altmsl, geoid, fixq, palt, vs, roll, pitch, hdg, slip, tr, g) = r
    if gs is None or gs < min_gs or sec.startswith("00:00"):
        continue
    hh, mm, ss = sec.split(":")
    la, ns, lo, ew = latlon(lat, lng)
    s = {}
    s["GPRMC"] = ck(f"$GPRMC,{hh}{mm}{float(ss):05.2f},A,{la:010.5f},{ns},{lo:011.5f},{ew},{gs:.1f},{trk:.1f},211126,,,A")
    s["GPGGA"] = ck(f"$GPGGA,{hh}{mm}{float(ss):05.2f},{la:010.5f},{ns},{lo:011.5f},{ew},{fixq},{sats},1.00,{altmsl/3.28084:.1f},M,{geoid/3.28084:.1f},M,,")
    s["PGRMZ"] = ck(f"$PGRMZ,{int(palt)},f,3")
    s["GPGSA"] = "$GPGSA,A,3,,,,,,,,,,,,,1.0,1.0,1.0*33\r\n"
    # RPYL: 20 per second, take the logged samples of this second as representatives
    rp = []
    for x in rs:
        rp.append(ck("$RPYL,%d,%d,%d,%d,%d,%d,0" % (round(x[11]*10), round(x[12]*10), round(x[13]*10),
                                                    round(-x[14]*10), round(x[15]*10), round(x[16]*1000))))
    s["RPYL x20"] = 20 * st.mean(len(m) for m in rp)
    examples.setdefault("RPYL x20", rp[0])
    s["RBEMS x5"] = 5 * len(rbems); examples["RBEMS x5"] = rbems
    s["RBCYL x0.5"] = 0.5 * len(rbcyl); examples["RBCYL x0.5"] = rbcyl
    ball = max(-20, min(20, slip)) * math.pi / 180
    yaw = -((hdg % 360) + 360) % 360
    s["RBATT"] = ck("$RBATT,%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,,,,,,,," % (roll, pitch, yaw, g*math.cos(ball), g*math.sin(ball), 0, 0, 0, 0))
    p = 1013.25 * (1 - palt / 145366.45) ** (1 / 0.190284)
    s["RBAIR"] = ck("$RBAIR,%.4f,%.5f,,%.0f,,," % (p / 33.8639, 1015 / 33.8639, vs))
    # Traffic
    pflaa = []
    for (_, icao, tail, tlat, tlng, talt, ttrk, ttr, tspd, tvv, cat) in traffic.get(sec, []):
        dn = (tlat - lat) * 111320; de = (tlng - lng) * 111320 * math.cos(math.radians(lat))
        idstr = f"{icao & 0xFFFFFF:06X}" + (f"!{tail}" if tail else "")
        pflaa.append(ck(f"$PFLAA,0,{int(dn)},{int(de)},{int((talt-palt)*0.3048)},1,{idstr},{int(ttrk)},{int(ttr)},{int(tspd*0.514444)},{tvv*0.3048/60:.1f},9"))
    s["PFLAA (n targets)"] = sum(len(m) for m in pflaa)
    if pflaa: examples.setdefault("PFLAA (n targets)", pflaa[0])
    s["PFLAU"] = ck(f"$PFLAU,{len(pflaa)},1,2,1,0,,0,,,")
    s["_ntargets"] = len(pflaa)
    s["_ntargets_10km"] = sum(1 for (_, _, _, tlat, tlng, talt, *_ ) in traffic.get(sec, [])
                              if math.hypot((tlat-lat)*111320, (tlng-lng)*111320*math.cos(math.radians(lat))) < 10000
                              and abs(talt - palt) < 3000)
    for k, v in s.items():
        if isinstance(v, str):
            examples.setdefault(k, v); v = len(v)
        per_sec[k].append(v)

n = len(per_sec["GPRMC"])
print(f"airborne seconds (GS >= {min_gs} kt): {n}")
groups = {
    "GPS (G5 needs RMC; GGA/PGRMZ/GSA FLARM-style)": ["GPRMC", "GPGGA", "PGRMZ", "GPGSA"],
    "FLARM traffic": ["PFLAA (n targets)", "PFLAU"],
    "EMS slave": ["RBEMS x5", "RBCYL x0.5"],
    "AHRS (Levil RPYL)": ["RPYL x20"],
    "AHRS slave RB-09": ["RBATT", "RBAIR"],
}
ap = [ck("$GPRMB,A,0.12,L,LIRV,LIAF,4256.3400,N,01242.1000,E,12.3,123.4,98.0,V"),
      ck("$GPAPB,A,A,0.12,L,N,V,V,123,T,LIAF,123,T,123,T"),
      ck("$GPBOD,123.4,T,,M,LIAF,LIRV"),
      ck("$GPXTE,A,A,0.12,L,N"),
      ck("$PGRMH,A,-500,120,-450,-480,2500,123.4,210.0")]
tot_mean = tot_p95 = 0
print(f"{'sentence':22s} {'B/s mean':>9s} {'p95':>7s} {'max':>7s}   example")
for gname, keys in groups.items():
    print(f"-- {gname}")
    gm = 0
    for k in keys:
        v = sorted(per_sec[k]); m = st.mean(v); p95 = v[int(0.95*(len(v)-1))]; mx = v[-1]
        gm += m; tot_mean += m; tot_p95 += p95
        print(f"{k:22s} {m:9.1f} {p95:7.0f} {mx:7.0f}   {examples.get(k, '').strip()}")
    print(f"{'   subtotal':22s} {gm:9.1f}")
apb = sum(len(x) for x in ap)
print("-- Autopilot (only with an active route; not active on this flight)")
for x in ap:
    print(f"{x[1:6]:22s} {len(x):9.1f}   {x.strip()}")
print(f"{'   subtotal':22s} {apb:9.1f}")
nt = sorted(per_sec["_ntargets"]); n10 = sorted(per_sec["_ntargets_10km"])
print(f"targets/s mean {st.mean(nt):.1f} p95 {nt[int(.95*(len(nt)-1))]} max {nt[-1]}; within 10 km and +-3000 ft: mean {st.mean(n10):.2f} max {n10[-1]}")
print(f"TOTAL as flown  mean {tot_mean:.0f} B/s  p95-sum {tot_p95:.0f} B/s ; + autopilot {tot_mean+apb:.0f} B/s")
for baud in (4800, 9600, 19200, 38400, 57600, 115200):
    cap = baud / 10
    print(f"  {baud:6d} baud = {cap:6.0f} B/s : load {100*tot_mean/cap:5.0f}% (with AP {100*(tot_mean+apb)/cap:5.0f}%)")
