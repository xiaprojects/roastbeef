"""Reduce the owner's detailed models to the low-poly preset (M3, M4, M7).

    blender -b -P tools/synthview-models/reduce.py -- [rv4 rv7 c172] [--measure DIR]

Sources are read from tools/synthview-models/sources/ (not in git, see
README.md).  Output goes to web/settings/glb/lowpoly_<name>.glb.

Per model:
 1. import, weld the unwelded triangles (S5), rotate to flight attitude
    (S6, R8), scale to the real span (S3, R5), move the origin to 25 % MAC at
    mid fuselage height (R7, S4);
 2. split the loose parts by position into body, propeller, wheels, legs,
    struts; small interior or detail parts are dropped;
 3. the body (fuselage, wing, tail, and on the RVs the fused gear legs and
    wheel pants) is voxel-remeshed to a clean closed shell and decimated to its
    budget, so the silhouette survives (R9, R10);
 4. glass is cut out of the body with planes (the source has no materials);
 5. thin parts are rebuilt from simple prisms measured on the source parts:
    propeller (two blades, Q5), spinner, wheels, gear legs, wing struts.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

# ------------------------------------------------------------------ config
#
# All positions below are glTF axes in metres AFTER rotation, scaling and the
# origin move: +X left, +Y up, +Z forward, origin at the CG estimate.
#
# glass: list of convex regions; each region is a list of half-spaces
#        (point, normal) and a face whose centroid is inside all of them is
#        glass.  Planes are also used to cut the body so the edge is straight.
# trim:  same, for the trim colour.
# parts: role per loose part, chosen by the centre of its bounding box
#        with a function (cx, cy, cz, size) -> role.

MODELS = {
    "rv4": dict(
        src="RV4.glb", out="lowpoly_rv4", title="Van's RV-4 (low poly)",
        span=7.01, pitch=11.3, body_tris=1250, voxel=0.01,
    ),
    "rv7": dict(
        src="RV7_CARB.glb", out="lowpoly_rv7", title="Van's RV-7 (low poly)",
        span=7.62, pitch=11.4, body_tris=1250, voxel=0.01,
    ),
    "c172": dict(
        src="C172.glb", out="lowpoly_c172", title="Cessna 172 (low poly)",
        span=11.0, pitch=0.0, body_tris=1200, voxel=0.01,
    ),
}


# ------------------------------------------------------------------ geometry

def verts_g(ob):
    """Vertices of a Blender object in glTF axes."""
    return np.array([C.b2g(ob.matrix_world @ v.co) for v in ob.data.vertices])


def slice_points(V, T, axis, value):
    """Intersection points of triangle edges with the plane coord[axis]=value."""
    P = []
    for i, j in ((0, 1), (1, 2), (2, 0)):
        a = V[T[:, i]]
        b = V[T[:, j]]
        m = (a[:, axis] - value) * (b[:, axis] - value) < 0
        t = (value - a[m, axis]) / (b[m, axis] - a[m, axis])
        P.append(a[m] + (b[m] - a[m]) * t[:, None])
    return np.concatenate(P) if P else np.zeros((0, 3))


def mesh_arrays(ob):
    me = ob.data
    me.calc_loop_triangles()
    V = verts_g(ob)
    T = np.array([t.vertices[:] for t in me.loop_triangles])
    return V, T


def load_source(cfg):
    path = os.path.join(C.SOURCES, cfg["src"])
    if not os.path.isfile(path):
        sys.stderr.write(
            "reduce.py: source model missing: %s\n"
            "The detailed source models are not in git (see "
            "tools/synthview-models/README.md); put %s there to rebuild %s.\n"
            % (path, cfg["src"], cfg["out"]))
        sys.exit(2)
    C.reset()
    bpy.ops.import_scene.gltf(filepath=path)
    ob = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    xs = [v.co.x for v in bm.verts]
    k = cfg["span"] / (max(xs) - min(xs))
    # Blender axes: nose on -Y, up +Z.  A positive rotation about X lowers
    # the nose, which takes the tailwheel types out of the three-point
    # attitude.
    M = Matrix.Scale(k, 4) @ Matrix.Rotation(math.radians(cfg["pitch"]), 4, "X")
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.materials.clear()
    return ob, k


def find_origin(ob, span):
    """25 % of the chord at 40 % semispan, mid height of the centreline
    profile at that station.  Returns the glTF point to move to 0."""
    V, T = mesh_arrays(ob)
    sl = slice_points(V, T, 0, 0.4 * span / 2)
    sl = sl[sl[:, 1] > np.percentile(sl[:, 1], 5) - 1]  # all
    zle, zte = sl[:, 2].max(), sl[:, 2].min()
    # wing only: points near the wing chord (exclude a tail cut at this x)
    wing = sl[sl[:, 2] > zle - 3.0]
    zte = wing[:, 2].min()
    chord = zle - zte
    zcg = zle - 0.25 * chord
    cl = slice_points(V, T, 0, 0.0)
    near = cl[np.abs(cl[:, 2] - zcg) < 0.15]
    ycg = 0.5 * (near[:, 1].min() + near[:, 1].max())
    return Vector((0.0, ycg, zcg)), chord


def separate_parts(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    parts.sort(key=lambda o: -len(o.data.polygons))
    return parts


def remesh_decimate(ob, voxel, target):
    bpy.context.view_layer.objects.active = ob
    r = ob.modifiers.new("remesh", "REMESH")
    r.mode = "VOXEL"
    r.voxel_size = voxel
    r.adaptivity = 0.0
    bpy.ops.object.modifier_apply(modifier="remesh")
    n = C.tri_count(ob)
    d = ob.modifiers.new("dec", "DECIMATE")
    d.decimate_type = "COLLAPSE"
    d.use_symmetry = True
    d.symmetry_axis = "X"
    d.ratio = target / n
    bpy.ops.object.modifier_apply(modifier="dec")
    # A second pass corrects the small overshoot of the first one.
    n2 = C.tri_count(ob)
    if n2 > target:
        d = ob.modifiers.new("dec", "DECIMATE")
        d.use_symmetry = True
        d.symmetry_axis = "X"
        d.ratio = target / n2
        bpy.ops.object.modifier_apply(modifier="dec")
    return n


def pca(V):
    c = V.mean(0)
    u, s, vt = np.linalg.svd(V - c, full_matrices=False)
    ax = vt[0]
    t = (V - c) @ ax
    return c, ax, t.min(), t.max(), vt


def rebuild_prism(B, V, mat, n=4, w=None, d=None):
    """Straight leg or strut along the principal axis of the part."""
    c, ax, t0, t1, vt = pca(V)
    p0 = c + ax * t0
    p1 = c + ax * t1
    e1 = (V - c) @ vt[1]
    e2 = (V - c) @ vt[2]
    ww = w or max(0.03, e1.max() - e1.min())
    dd = d or max(0.02, e2.max() - e2.min())
    B.prism(tuple(p0), tuple(p1), ww, dd, mat, n=n, up=tuple(vt[2]))


def rebuild_wheel(B, V, n=10):
    lo, hi = V.min(0), V.max(0)
    c = (lo + hi) / 2
    r = max(hi[1] - lo[1], hi[2] - lo[2]) / 2
    B.wheel(tuple(c), r, max(0.06, hi[0] - lo[0]), "dark", n=n)


# ------------------------------------------------------------------ models
#
# Each function receives the classified parts (glTF vertex arrays), the
# Builder for rebuilt parts, and returns glass and trim regions for the body.

def setup_rv(kind):
    """RV-4 and RV-7 share the layout: low wing, bubble canopy, spring gear
    legs and wheel pants fused into the body, tailwheel."""

    def rules(c, size):
        if size.max() > 3.0:
            return "body"
        if c[2] > 1.3 and size.max() > 0.25:
            return "prop"           # blades and spinner
        if c[2] < -2.5 and size[2] > 0.3:
            return "tailwheel"      # RV-7 only; the RV-4 one is in the body
        return "drop"               # exhausts, interior pieces
    return rules


def finish_rv(B, roles, body_v, kind):
    props = np.concatenate(roles["prop"])
    lo, hi = props.min(0), props.max(0)
    nose = body_v[body_v[:, 2] > body_v[:, 2].max() - 0.04]
    hub_y = float(nose[:, 1].mean())
    hub_z = float(body_v[:, 2].max()) - 0.03
    if kind == "rv4":
        # two-blade source: blade direction in the disc from the part
        q = props[np.abs(props[:, 2] - props[:, 2].mean()) < 1.0]
        sgn = 1.0 if np.mean((q[:, 0]) * (q[:, 1] - hub_y)) > 0 else -1.0
        ang = sgn * math.degrees(math.atan2(hi[1] - lo[1], hi[0] - lo[0]))
        radius = 0.5 * math.hypot(hi[0] - lo[0], hi[1] - lo[1])
    else:
        # three-blade source; Q5 asks for two blades, set along the
        # vertical blade of the source
        ang = 90.0
        radius = hi[1] - hub_y
    print("  prop: radius %.2f m, blade angle %.1f deg" % (radius, ang))
    C.prop_and_spinner(B, (0.0, hub_y, hub_z), radius, ang, 0.15, 0.30)
    if "tailwheel" in roles:
        tw = np.concatenate(roles["tailwheel"])
        aft = tw[:, 2].min()
        wl = tw[tw[:, 2] < aft + 0.15]
        rebuild_wheel(B, wl, n=8)
        spring = tw[tw[:, 2] >= aft + 0.12]
        rebuild_prism(B, spring, "dark", w=0.04, d=0.03)


def regions_rv(kind):
    # Canopy bubble: above the deck line, between the windscreen base and
    # the aft end of the bubble, read on the side render of the source.
    if kind == "rv4":
        return [[C.up_plane(0.34), C.fwd_of(-1.65), C.aft_of(0.08), *C.side(0.6)]]
    return [[C.up_plane(0.34), C.fwd_of(-1.22), C.aft_of(0.15), *C.side(0.6)]]


def setup_c172():
    def rules(c, size):
        if size.max() > 3.0:
            return "body"
        if c[2] > 1.9 and size[0] > 1.0:
            return "prop"
        if size[0] > 1.5:
            return "strut"
        if size[0] < 0.2 and size[1] > 0.35 and abs(c[0]) < 0.05 and c[1] < -0.5:
            return "nosewheel"      # wheel and fork
        if size[0] < 0.2 and size[1] > 0.3 and size[2] > 0.3:
            return "wheel"
        if size[0] > 0.5:
            return "leg"
        if abs(c[0]) < 0.05 and size[1] > 0.3:
            return "noseleg"
        return "drop"               # exhaust, fuel cap
    return rules


def finish_c172(B, roles, body_v):
    props = np.concatenate(roles["prop"])
    lo, hi = props.min(0), props.max(0)
    hub_y = 0.5 * (lo[1] + hi[1])
    radius = 0.5 * (hi[0] - lo[0])
    print("  prop: radius %.2f m" % radius)
    C.prop_and_spinner(B, (0.0, hub_y, float(body_v[:, 2].max()) - 0.03), radius, 0.0, 0.17, 0.33)
    for V in roles.get("wheel", []):
        rebuild_wheel(B, V)
    for V in roles.get("nosewheel", []):
        lo, hi = V.min(0), V.max(0)
        r = 0.5 * (hi[2] - lo[2])
        rebuild_wheel(B, V[V[:, 1] < lo[1] + 2 * r])
        c = 0.5 * (lo + hi)
        B.prism((c[0], lo[1] + r, c[2]), (c[0], hi[1], c[2]), 0.05, 0.05, "paint", n=6)
    # Struts and legs are thicker than the real ones so they survive at
    # symbol size; the real ones are below one pixel at 40 px of span.
    for V in roles.get("strut", []):
        rebuild_prism(B, V, "paint", w=0.14, d=0.05)
    for V in roles.get("leg", []):
        rebuild_prism(B, V, "paint", w=0.12, d=0.05)
    for V in roles.get("noseleg", []):
        rebuild_prism(B, V, "paint", n=6, w=0.08, d=0.08)


def regions_c172():
    # Windscreen, door windows and rear window: the cabin band between the
    # belt line and the wing root, read on the side render of the source.
    return [[C.up_plane(0.30), C.below(0.68), C.aft_of(1.50), C.fwd_of(-1.35), *C.side(0.66)]]


# ------------------------------------------------------------------ main

def build(name, measure_dir=None):
    cfg = MODELS[name]
    ob, k = load_source(cfg)
    origin, chord = find_origin(ob, cfg["span"])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.translate(bm, vec=-C.g2b(origin), verts=bm.verts)
    bm.to_mesh(ob.data)
    bm.free()
    print("%s: %.4f m per unit, origin %s, chord at 40%% semispan %.2f m"
          % (name, k, tuple(round(v, 3) for v in origin), chord))
    if measure_dir:
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(measure_dir, name + "_src.glb"),
                                  export_format="GLB", use_selection=True, export_yup=True)
    parts = separate_parts(ob)
    named = [(p.name, verts_g(p)) for p in parts]
    for (n, V), p in zip(named, parts):
        print("  part %-14s %6d faces  min %s max %s" % (
            n, len(p.data.polygons), np.round(V.min(0), 2), np.round(V.max(0), 2)))
    if measure_dir:
        return parts
    kind = name
    rules = setup_rv(kind) if kind.startswith("rv") else setup_c172()
    roles = {}
    body = None
    for (n, V), p in zip(named, parts):
        lo, hi = V.min(0), V.max(0)
        role = rules((lo + hi) / 2, hi - lo)
        print("    %s -> %s" % (n, role))
        if role == "body" and body is None:
            body = p
            continue
        roles.setdefault(role, []).append(V)
        bpy.data.objects.remove(p)
    body_v = verts_g(body)
    n0 = remesh_decimate(body, cfg["voxel"], cfg["body_tris"])
    print("  body: remeshed %d -> %d triangles" % (n0, C.tri_count(body)))
    for mname in C.MAT_ORDER:
        body.data.materials.append(C.material(mname))
    for poly in body.data.polygons:
        poly.material_index = 0

    B = C.Builder()
    if kind.startswith("rv"):
        finish_rv(B, roles, body_v, kind)
        glass = regions_rv(kind)
        trim = trim_fin(body_v)
    else:
        finish_c172(B, roles, body_v)
        glass = regions_c172()
        trim = trim_fin(body_v)
    C.cut_and_assign(body, glass, "glass", max_ny=0.8)
    C.cut_and_assign(body, trim, "trim")
    rebuilt = B.to_object("rebuilt")
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rebuilt.select_set(True)
    bpy.context.view_layer.objects.active = body
    print("  before join", C.tri_by_material(body), C.tri_by_material(rebuilt))
    bpy.ops.object.join()
    print("  after join", C.tri_by_material(body))
    C.triangulate_and_clean(body)
    print("  total %d triangles %s" % (C.tri_count(body), C.tri_by_material(body)))
    path = C.export(body, cfg["out"], cfg["title"], {
        "source": "Reduced from %s, a model the owner downloaded free from the internet; "
                  "origin and licence of the source not recorded" % cfg["src"],
        "tool": "tools/synthview-models/reduce.py",
    })
    print("  wrote", path)


def trim_fin(body_v):
    """Fin and rudder above the fuselage top at the tail get the trim colour."""
    zmin = body_v[:, 2].min()
    # Top of the fuselage just ahead of the fin: centreline points at the
    # station 1.6 m forward of the tail, highest
    st = body_v[(body_v[:, 2] > zmin + 1.4) & (body_v[:, 2] < zmin + 1.6) & (np.abs(body_v[:, 0]) < 0.3)]
    ytop = float(st[:, 1].max()) + 0.05
    # leading edge of the fin a little above the deck
    fin = body_v[(body_v[:, 1] > ytop + 0.15) & (np.abs(body_v[:, 0]) < 0.15) & (body_v[:, 2] < zmin + 2.0)]
    zle = float(fin[:, 2].max()) + 0.05
    return [[C.up_plane(ytop), C.aft_of(zle), *C.side(0.25)]]


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    measure = None
    if "--measure" in argv:
        i = argv.index("--measure")
        measure = argv[i + 1]
        del argv[i:i + 2]
    names = argv or list(MODELS)
    for n in names:
        build(n, measure)
