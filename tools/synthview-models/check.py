#!/usr/bin/env python3
"""Check the synthetic-view aircraft models against R1-R3, R5, R6, R10-R16
of docs/tech-debt/synthview-aircraft-models.md.

    python3 tools/synthview-models/check.py [file.glb ...]

Reads the exported files themselves (no Blender): the GLB container is a
12-byte header, a JSON chunk and a binary chunk.  Exit status 1 if any
check fails.  Dimensions are compared with the reference table of section 3
(span within 3 %, length within 10 %, height within 15 %; the 737 has its
gear up, so its height is compared with the gear-up figure noted below).
"""

import json
import math
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GLB_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "web", "settings", "glb"))

# name: (span or rotor diameter, length, height, triangle budget)
# The RV-4 and RV-7 heights are on the ground, in the three-point attitude;
# the models are level (R8), so they are measured after pitching them back
# nose-up by GROUND_PITCH (the angle reduce.py took out of the sources),
# fin top to wheel bottom, without the propeller.
GROUND_PITCH = {"lowpoly_rv4": 11.3, "lowpoly_rv7": 11.4}
REFERENCE = {
    "lowpoly_helicopter": (10.1, 9.1, 3.3, 2500),
    # 12.5 m is on the ground; with the gear up the model is about 0.9 m
    # lower (nacelle bottom to fin top), so 11.6 m is the comparable figure.
    "lowpoly_b737": (35.8, 39.5, 11.6, 2500),
    "lowpoly_rv4": (7.01, 6.2, 1.6, 1500),
    "lowpoly_rv7": (7.62, 6.2, 1.8, 1500),
    "lowpoly_p92": (9.3, 6.4, 2.5, 1500),
    "lowpoly_pa28": (10.67, 7.3, 2.2, 1500),
    "lowpoly_c172": (11.0, 8.3, 2.7, 1500),
}
TOL = {"span": 0.03, "length": 0.10, "height": 0.15}
MAX_BYTES = 100 * 1024
MATERIAL_NAMES = {"paint", "trim", "glass", "dark"}
ALLOWED_EXTENSIONS = {"KHR_mesh_quantization"}

COMP = {5120: ("i1", 127.0), 5121: ("u1", 255.0), 5122: ("<i2", 32767.0),
        5123: ("<u2", 65535.0), 5125: ("<u4", None), 5126: ("<f4", None)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack("<4sII", data[:12])
    if magic != b"glTF" or version != 2:
        raise ValueError("not a binary glTF 2.0 file")
    if length != len(data):
        raise ValueError("header length %d != file size %d" % (length, len(data)))
    jlen, jtype = struct.unpack("<II", data[12:20])
    if jtype != 0x4E4F534A:
        raise ValueError("first chunk is not JSON")
    doc = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    binary = b""
    if off < len(data):
        blen, btype = struct.unpack("<II", data[off:off + 8])
        if btype != 0x004E4942:
            raise ValueError("second chunk is not BIN")
        binary = data[off + 8:off + 8 + blen]
    return doc, binary, len(data)


def accessor(doc, binary, i):
    a = doc["accessors"][i]
    bv = doc["bufferViews"][a["bufferView"]]
    dt, norm = COMP[a["componentType"]]
    n = NCOMP[a["type"]]
    itemsize = np.dtype(dt).itemsize
    stride = bv.get("byteStride", itemsize * n)
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    raw = np.frombuffer(binary, dtype=np.uint8, count=stride * (a["count"] - 1) + itemsize * n, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], itemsize * n), strides=(stride, 1)).copy()
    arr = rows.view(dt).reshape(a["count"], n).astype(np.float64)
    if a.get("normalized") and norm:
        arr = np.maximum(arr / norm, -1.0)
    return arr


def check(path):
    name = os.path.splitext(os.path.basename(path))[0]
    results = []

    def res(ok, label, detail):
        results.append((ok, label, detail))

    try:
        doc, binary, size = read_glb(path)
    except Exception as e:  # noqa: BLE001
        print("%s: FAIL cannot read: %s" % (name, e))
        return False
    res(True, "R1 container", "GLB v2, %d bytes, JSON + BIN chunks" % size)
    ext_buf = [b for b in doc.get("buffers", []) if "uri" in b]
    res(not ext_buf and len(doc.get("buffers", [])) <= 1, "R1 self-contained",
        "%d buffer(s), %d external" % (len(doc.get("buffers", [])), len(ext_buf)))
    used = set(doc.get("extensionsUsed", [])) | set(doc.get("extensionsRequired", []))
    res(used <= ALLOWED_EXTENSIONS, "R2/R15 extensions", ", ".join(sorted(used)) or "none")
    forbidden = [k for k in ("textures", "images", "samplers", "animations", "skins", "cameras") if doc.get(k)]
    if "KHR_lights_punctual" in json.dumps(doc):
        forbidden.append("lights")
    texcoord = any(k.startswith("TEXCOORD") or k.startswith("JOINTS") or k.startswith("WEIGHTS")
                   or k.startswith("COLOR")
                   for m in doc["meshes"] for p in m["primitives"] for k in p["attributes"])
    res(not forbidden and not texcoord, "R3 no textures/UV/anim/skin/camera/light",
        "found: %s" % (", ".join(forbidden + (["UV/vertex attributes"] if texcoord else [])) or "none"))
    ex = doc.get("asset", {}).get("extras", {})
    res(all(ex.get(k) for k in ("title", "author", "license")), "R4 asset.extras",
        "title=%r" % ex.get("title"))

    # nodes and transforms
    scene = doc["scenes"][doc.get("scene", 0)]
    roots = scene["nodes"]
    tf = [i for i in roots if any(k in doc["nodes"][i] for k in ("translation", "rotation", "scale", "matrix"))]
    res(not tf, "R6 no root transform", "%d root node(s), %d with a transform" % (len(roots), len(tf)))

    # materials
    mats = doc.get("materials", [])
    names = [m.get("name") for m in mats]
    bad = []
    for m in mats:
        pbr = m.get("pbrMetallicRoughness", {})
        if pbr.get("metallicFactor", 1.0) != 0.0:
            bad.append("%s metallic %s" % (m.get("name"), pbr.get("metallicFactor", 1.0)))
        r = pbr.get("roughnessFactor", 1.0)
        if not 0.5 - 1e-4 <= r <= 0.8 + 1e-4:
            bad.append("%s roughness %s" % (m.get("name"), r))
        if m.get("alphaMode", "OPAQUE") == "BLEND":
            bad.append("%s alpha blend" % m.get("name"))
        if m.get("doubleSided"):
            bad.append("%s double sided" % m.get("name"))
        if m.get("extensions"):
            bad.append("%s extensions %s" % (m.get("name"), list(m["extensions"])))
    res(len(mats) <= 4 and set(names) <= MATERIAL_NAMES and not bad, "R12/R14-R16 materials",
        "%d: %s%s" % (len(mats), ", ".join(names), ("; " + "; ".join(bad)) if bad else ""))

    # meshes, primitives, triangles, geometry
    prims = [p for m in doc["meshes"] for p in m["primitives"]]
    per_mat = {}
    tris = 0
    P = []
    vol = 0.0
    agree = []
    for p in prims:
        per_mat[p.get("material")] = per_mat.get(p.get("material"), 0) + 1
        if p.get("mode", 4) != 4:
            res(False, "triangles", "primitive mode %s" % p.get("mode"))
            continue
        pos = accessor(doc, binary, p["attributes"]["POSITION"])
        idx = accessor(doc, binary, p["indices"]).astype(int).ravel() if "indices" in p else np.arange(len(pos))
        t = idx.reshape(-1, 3)
        tris += len(t)
        P.append(pos)
        a, b, c = pos[t[:, 0]], pos[t[:, 1]], pos[t[:, 2]]
        vol += np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0
        if "NORMAL" in p["attributes"]:
            nrm = accessor(doc, binary, p["attributes"]["NORMAL"])
            fn = np.cross(b - a, c - a)
            ok = np.einsum("ij,ij->i", fn, nrm[t[:, 0]]) >= 0
            agree.append(ok)
    draws = len(prims)
    res(all(v == 1 for v in per_mat.values()) and draws <= 4, "R12 draw calls",
        "%d mesh(es), %d primitive(s), one per material" % (len(doc["meshes"]), draws)
        if all(v == 1 for v in per_mat.values()) else "material used by more than one primitive")
    ref = REFERENCE.get(name)
    budget = ref[3] if ref else 1500
    res(tris <= budget, "R11 triangles", "%d (budget %d)" % (tris, budget))
    res(size <= MAX_BYTES, "R13 file size", "%.1f KB (limit %d KB)" % (size / 1024.0, MAX_BYTES // 1024))
    has_n = all("NORMAL" in p["attributes"] for p in prims)
    agree_ok = np.concatenate(agree).mean() if agree else 0.0
    res(has_n and vol > 0 and agree_ok > 0.98, "R10 normals and winding",
        "normals %s, enclosed volume %.2f m3 (positive = outward), %.1f %% of stored normals agree with winding"
        % ("present" if has_n else "MISSING", vol, 100 * agree_ok))

    V = np.concatenate(P)
    lo, hi = V.min(0), V.max(0)
    ext = hi - lo
    # Axes (R6): top on +Y and nose on +Z.  The fin tip, the highest point
    # of a fixed-wing type, lies aft of the origin; the propeller or nose
    # lies ahead of it.  For the helicopter the tail boom is the aft end.
    top = V[np.argmax(V[:, 1])]
    length = ext[2]
    height = ext[1]
    if name in GROUND_PITCH:
        a = math.radians(GROUND_PITCH[name])
        y3 = V[:, 1] * math.cos(a) + V[:, 2] * math.sin(a)
        body = V[:, 2] < hi[2] - 0.35   # without propeller and spinner
        height = y3[body].max() - y3[body].min()
    if name == "lowpoly_helicopter":
        rotor = V[:, 1] > hi[1] - 0.3
        span = 2.0 * np.sqrt(V[:, 0] ** 2 + V[:, 2] ** 2)[rotor].max()
        length = V[~rotor, 2].max() - V[~rotor, 2].min()
        tail_aft = abs(lo[2]) > abs(hi[2])
        axes_ok = tail_aft and ext[2] > ext[1]
        axes_detail = "tail boom towards -Z (%.2f .. %.2f), rotor on top" % (lo[2], hi[2])
    else:
        span = ext[0]
        axes_ok = top[2] < 0 and ext[0] > ext[1] and ext[2] > ext[1]
        axes_detail = "fin tip at z %.2f (aft), span on X, length on Z" % top[2]
    res(axes_ok, "R6 axes", axes_detail)
    if ref:
        dims = (("span", span, ref[0]), ("length", length, ref[1]), ("height", height, ref[2]))
        parts = []
        dims_ok = True
        for label, got, want in dims:
            dev = (got - want) / want
            ok = abs(dev) <= TOL[label]
            dims_ok &= ok
            parts.append("%s %.2f m (ref %.2f, %+.1f %%)%s" % (label, got, want, 100 * dev, "" if ok else " OUT"))
        res(dims_ok, "R5 real size", "; ".join(parts))
    res(True, "info bounds", "x %.2f..%.2f  y %.2f..%.2f  z %.2f..%.2f (origin at 0,0,0)"
        % (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))

    ok_all = all(r[0] for r in results)
    print("%s  %s" % (name, "PASS" if ok_all else "FAIL"))
    for ok, label, detail in results:
        print("  %-4s %-42s %s" % ("ok" if ok else "FAIL", label, detail))
    return ok_all


def main(argv):
    paths = argv or [os.path.join(GLB_DIR, n + ".glb") for n in REFERENCE]
    good = True
    for p in paths:
        good &= check(p)
    print("\n%d file(s): %s" % (len(paths), "all pass" if good else "FAILURES"))
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
