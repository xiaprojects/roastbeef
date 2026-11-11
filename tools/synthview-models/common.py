"""Shared Blender helpers for the synthetic-view aircraft models.

Run inside Blender (headless): blender -b -P build.py -- ...

Conventions used by every builder in this folder:

* Geometry is written in glTF axes, metres: +X left wing, +Y up, +Z nose.
  The right wing is therefore on -X.  The helpers convert to Blender's Z-up
  frame (x, y, z)_gltf -> (x, -z, y)_blender, and the exporter converts back,
  so the exported file carries the glTF axes with no node transform.
* Four materials with fixed names (R16): paint, trim, glass, dark.
* Flat shading, single sided, no UVs, no textures, no animation (R3, R10).
"""

import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(REPO, "web", "settings", "glb")
SOURCES = os.path.join(HERE, "sources")

AUTHOR = "RB-Avionics (roastbeef repository)"
LICENSE = "Repository licence (see LICENSE): AGPL-3 for personal use, commercial agreement otherwise"

# Linear base colours.  The view renders with linear output, one ambient
# light (0.5) and one directional light (1.0), so paint is kept below 1.0 to
# leave headroom for the emissive tint (F6, R17).
MATERIALS = {
    "paint": ((0.75, 0.75, 0.75), 0.6),
    "trim": ((0.08, 0.20, 0.55), 0.6),
    "glass": ((0.05, 0.09, 0.14), 0.5),
    "dark": ((0.05, 0.05, 0.05), 0.75),
}
MAT_ORDER = ["paint", "trim", "glass", "dark"]


# ---------------------------------------------------------------- scene

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    rgb, rough = MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*rgb, 1.0)  # Workbench review renders
    m.use_backface_culling = True
    return m


def g2b(p):
    """glTF axes to Blender axes."""
    return Vector((p[0], -p[2], p[1]))


def b2g(v):
    return (v[0], v[2], -v[1])


# ---------------------------------------------------------------- builder

class Builder:
    """Collects faces per material in one bmesh, written in glTF axes."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mat_index = {n: i for i, n in enumerate(MAT_ORDER)}

    def _v(self, p):
        return self.bm.verts.new(g2b(p))

    def face(self, pts, mat, verts=None):
        vs = verts if verts is not None else [self._v(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = self.mat_index[mat]
        return f

    def rings(self, rings, mat, cap0=True, cap1=True, closed=True):
        """Skin consecutive rings (lists of points, same length).
        A ring of one point is an apex.  Ring order and point order decide
        the normal; recalc_normals() at the end makes them outward."""
        vr = [[self._v(p) for p in r] for r in rings]
        for a, b in zip(vr[:-1], vr[1:]):
            n = max(len(a), len(b))
            last = n if closed else n - 1
            for i in range(last):
                j = (i + 1) % n
                if len(a) == 1:
                    self.face(None, mat, [a[0], b[i], b[j]])
                elif len(b) == 1:
                    self.face(None, mat, [a[i], a[j], b[0]])
                else:
                    self.face(None, mat, [a[i], a[j], b[j], b[i]])
        if cap0 and len(vr[0]) > 2:
            self.face(None, mat, list(reversed(vr[0])))
        if cap1 and len(vr[-1]) > 2:
            self.face(None, mat, vr[-1])
        return vr

    # ---- primitives -------------------------------------------------

    def loft(self, sections, mat, n=8, power=2.0, phase=None, cap0=True, cap1=True):
        """Fuselage-like body along Z.
        sections: (z, cy, half_width, half_height[, cx]); radius 0 = apex.
        power: superellipse exponent (2 = ellipse, larger = boxier)."""
        rings = []
        if phase is None:
            phase = math.pi / n
        for s in sections:
            z, cy, hw, hh = s[:4]
            cx = s[4] if len(s) > 4 else 0.0
            if hw <= 0 or hh <= 0:
                rings.append([(cx, cy, z)])
                continue
            r = []
            for i in range(n):
                a = phase + 2 * math.pi * i / n
                c, si = math.cos(a), math.sin(a)
                x = hw * math.copysign(abs(c) ** (2 / power), c)
                y = hh * math.copysign(abs(si) ** (2 / power), si)
                r.append((cx + x, cy + y, z))
            rings.append(r)
        return self.rings(rings, mat, cap0=cap0, cap1=cap1)

    def surface(self, sections, mat, vertical=False, mirror=False, tc=0.12, npts=None):
        """Wing, tailplane or fin through airfoil sections.
        sections: (span_pos, offset, z_le, chord[, thickness_ratio]).
        Horizontal: span_pos is x, offset is y.  Vertical: span_pos is y,
        offset is x.  Chord runs from z_le aft (towards -Z)."""
        prof = npts or [(0.0, 0.0), (0.08, 0.6), (0.35, 1.0), (0.75, 0.45),
                        (1.0, 0.0), (0.75, -0.25), (0.35, -0.45), (0.08, -0.35)]
        sides = [1, -1] if mirror else [1]
        for side in sides:
            rings = []
            for s in sections:
                sp, off, zle, ch = s[:4]
                t = (s[4] if len(s) > 4 else tc) * ch * 0.5
                r = []
                for u, v in prof:
                    z = zle - u * ch
                    if vertical:
                        r.append((side * off + v * t, sp, z))
                    else:
                        r.append((side * sp, off + v * t, z))
                rings.append(r)
            self.rings(rings, mat)

    def prism(self, p0, p1, w, d, mat, n=4, up=(0, 1, 0), taper=1.0):
        """Tube from p0 to p1, cross-section w (across) by d (along 'up'),
        n sides (4 = box).  taper scales the p1 end."""
        p0, p1 = Vector(p0), Vector(p1)
        ax = (p1 - p0).normalized()
        u = Vector(up)
        u = (u - ax * u.dot(ax))
        if u.length < 1e-6:
            u = Vector((1, 0, 0)) - ax * ax.x
        u.normalize()
        s = ax.cross(u).normalized()
        rings = []
        for p, k in ((p0, 1.0), (p1, taper)):
            r = []
            for i in range(n):
                a = math.pi / n + 2 * math.pi * i / n
                q = p + s * (math.cos(a) * w * 0.5 * k) + u * (math.sin(a) * d * 0.5 * k)
                r.append(tuple(q))
            rings.append(r)
        return self.rings(rings, mat)

    def wheel(self, c, r, width, mat="dark", n=10):
        """Wheel on an axle along X."""
        x, y, z = c
        rings = []
        for dx in (-width / 2, width / 2):
            rings.append([(x + dx, y + r * math.sin(2 * math.pi * i / n + math.pi / n),
                           z + r * math.cos(2 * math.pi * i / n + math.pi / n)) for i in range(n)])
        return self.rings(rings, mat)

    def blade(self, hub, direction, length, chord, thick, mat="dark", fwd=(0, 0, 1), tip=0.6, r0=0.0):
        """Flat tapered propeller or rotor blade from hub outwards."""
        d = Vector(direction).normalized()
        f = Vector(fwd).normalized()
        c = d.cross(f).normalized()  # chord direction
        h = Vector(hub)
        rings = []
        for t, k in ((r0, 1.0), (length, tip)):
            p = h + d * t
            rings.append([tuple(p + c * (sx * chord * 0.5 * k) + f * (sy * thick * 0.5 * k))
                          for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
        return self.rings(rings, mat)

    # ---- finish -----------------------------------------------------

    def to_object(self, name):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for n in MAT_ORDER:
            me.materials.append(material(n))
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------- mesh ops

def triangulate_and_clean(ob):
    """Triangulate, drop unused material slots, flat shade."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    # remove degenerate faces
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = False
    slots = [m.name for m in ob.data.materials]
    per_face = [slots[p.material_index] for p in ob.data.polygons]
    names = [n for n in MAT_ORDER if n in set(per_face)]
    ob.data.materials.clear()
    for n in names:
        ob.data.materials.append(material(n))
    idx = {n: i for i, n in enumerate(names)}
    ob.data.polygons.foreach_set("material_index", [idx[n] for n in per_face])
    ob.data.validate(clean_customdata=True)
    ob.data.update()


def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def tri_by_material(ob):
    ob.data.calc_loop_triangles()
    out = {}
    for t in ob.data.loop_triangles:
        n = ob.data.materials[t.material_index].name
        out[n] = out.get(n, 0) + 1
    return out


# ---------------------------------------------------------------- regions
#
# A region is a list of half-spaces (point, normal) in glTF axes; a point is
# inside when (p - point) . normal <= 0 for all of them.

def up_plane(y):
    return ((0, y, 0), (0, -1, 0))  # keep y >= value


def below(y):
    return ((0, y, 0), (0, 1, 0))   # keep y <= value


def aft_of(z):
    return ((0, 0, z), (0, 0, 1))   # keep z <= value


def fwd_of(z):
    return ((0, 0, z), (0, 0, -1))  # keep z >= value


def side(x):
    return ((x, 0, 0), (1, 0, 0)), ((-x, 0, 0), (-1, 0, 0))


def plane(p, n):
    return (tuple(p), tuple(n))


def inside(p, region):
    return all((p - Vector(q)).dot(Vector(nrm)) <= 0 for q, nrm in region)


def cut_and_assign(ob, regions, mat, max_ny=None):
    """Bisect the body with the planes of each region, give the faces inside
    it the material, then dissolve the cuts again wherever both sides kept
    the same material (limited dissolve with a material delimit), so only
    the region boundary costs triangles.  max_ny skips faces whose normal is
    closer to vertical than that (keeps wing skins out of a window band)."""
    if not regions:
        return
    mi = MAT_ORDER.index(mat)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for region in regions:
        for q, nrm in region:
            elems = list(bm.faces) + list(bm.edges) + list(bm.verts)
            bmesh.ops.bisect_plane(bm, geom=elems, plane_co=g2b(q), plane_no=g2b(nrm), dist=1e-5)
        for f in bm.faces:
            c = Vector(b2g(f.calc_center_median()))
            if not inside(c, region):
                continue
            if max_ny is not None and abs(f.normal.z) > max_ny:  # Blender z = glTF y
                continue
            f.material_index = mi
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), use_dissolve_boundaries=False,
                             verts=bm.verts, edges=bm.edges, delimit={"MATERIAL"})
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()



# ---------------------------------------------------------------- shared parts

def prop_and_spinner(B, hub, radius, angle_deg, spinner_r, spinner_len, chord=0.13, pitch_fwd=0.0):
    """Two-blade static propeller with a spinner; hub = spinner base centre."""
    a = math.radians(angle_deg)
    d = (math.cos(a), math.sin(a), 0.0)
    hx, hy, hz = hub
    tipz = hz + spinner_len
    B.loft([(hz - 0.02, hy, spinner_r * 0.95, spinner_r * 0.95),
            (hz, hy, spinner_r, spinner_r),
            (hz + spinner_len * 0.55, hy, spinner_r * 0.7, spinner_r * 0.7),
            (tipz, hy, 0, 0)], "trim", n=8)
    bz = hz + spinner_len * 0.25
    for sgn in (1, -1):
        B.blade((hx, hy, bz), (sgn * d[0], sgn * d[1], 0), radius, chord, 0.035,
                "dark", fwd=(0, 0, 1), tip=0.55, r0=spinner_r * 0.5)


# ---------------------------------------------------------------- export

def export(ob, name, title, extras=None):
    """Export one object as <OUT_DIR>/<name>.glb and write asset.extras."""
    for o in list(bpy.context.scene.objects):
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    ob.name = name
    ob.data.name = name
    path = os.path.join(OUT_DIR, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_vertex_color="NONE",
        export_attributes=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_draco_mesh_compression_enable=False,
    )
    info = {"title": title, "author": AUTHOR, "license": LICENSE}
    if extras:
        info.update(extras)
    rewrite_asset(path, info)
    return path


def rewrite_asset(path, extras):
    """Post-process an exported GLB: asset.extras (R4), normals stored as
    normalised bytes with KHR_mesh_quantization (R2 allows it; it keeps the
    flat-shaded files under the R13 size), and nothing we never want."""
    import numpy as np

    with open(path, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack("<4sII", data[:12])
    assert magic == b"glTF" and version == 2
    jlen, jtype = struct.unpack("<II", data[12:20])
    assert jtype == 0x4E4F534A
    doc = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen, btype = struct.unpack("<II", data[off:off + 8])
    assert btype == 0x004E4942
    binary = data[off + 8:off + 8 + blen]

    doc["asset"]["extras"] = extras
    for k in ("animations", "skins", "cameras", "textures", "images", "samplers"):
        doc.pop(k, None)
    for s in doc.get("scenes", []):
        s.pop("extras", None)

    views = [binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]
             for v in doc["bufferViews"]]
    normal_acc = {prim["attributes"]["NORMAL"]
                  for m in doc["meshes"] for prim in m["primitives"]
                  if "NORMAL" in prim["attributes"]}
    for ai in sorted(normal_acc):
        acc = doc["accessors"][ai]
        if acc["componentType"] != 5126:
            continue
        bv = doc["bufferViews"][acc["bufferView"]]
        assert bv.get("byteStride", 12) == 12 and acc.get("byteOffset", 0) == 0
        n = np.frombuffer(views[acc["bufferView"]], dtype="<f4", count=acc["count"] * 3)
        q = np.clip(np.round(n.reshape(-1, 3) * 127.0), -127, 127).astype("i1")
        packed = np.zeros((acc["count"], 4), dtype="i1")
        packed[:, :3] = q
        views[acc["bufferView"]] = packed.tobytes()
        bv["byteStride"] = 4
        acc["componentType"] = 5120
        acc["normalized"] = True
        acc.pop("min", None)
        acc.pop("max", None)
    if normal_acc:
        for key in ("extensionsUsed", "extensionsRequired"):
            lst = doc.setdefault(key, [])
            if "KHR_mesh_quantization" not in lst:
                lst.append("KHR_mesh_quantization")

    out = bytearray()
    for bv, chunk in zip(doc["bufferViews"], views):
        out += b"\0" * ((4 - len(out) % 4) % 4)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(chunk)
        out += chunk
    out += b"\0" * ((4 - len(out) % 4) % 4)
    doc["buffers"] = [{"byteLength": len(out)}]

    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(out), 0x004E4942))
        f.write(bytes(out))
