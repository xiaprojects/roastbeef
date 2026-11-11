"""Review renders of the low-poly models (step 5), Workbench engine, headless.

    blender -b -P tools/synthview-models/render.py -- OUT_DIR [name ...]

For each model: behind and above (the follow camera), side, front, and
small 40 px-span thumbnails from behind and from the side (R9).  Also writes
sheet tiles of all models at one common scale; the PNGs are assembled into
contact sheets by tools/synthview-models/sheet.py (plain Python + Pillow).

With --grid the views are orthographic at a fixed 100 px per metre, centred
on the origin, for measuring (used while writing reduce.py and build.py).
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

ALL = ["lowpoly_helicopter", "lowpoly_b737", "lowpoly_rv4", "lowpoly_rv7",
       "lowpoly_p92", "lowpoly_pa28", "lowpoly_c172"]

# Camera placements in glTF axes (+X left, +Y up, +Z nose): direction from
# the model to the camera.
VIEWS = {
    "follow": (0.0, 0.32, -1.0),   # behind and a little above (F5)
    "side": (-1.0, 0.05, 0.0),     # from the right, nose to the right
    "front": (0.0, 0.08, 1.0),
    "top": (0.0, 1.0, 0.0),
    "rear": (0.0, 0.0, -1.0),
}


def setup_scene(res_x, res_y):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_backface_culling = True
    sc.display.shading.show_cavity = False
    sc.render.resolution_x = res_x
    sc.render.resolution_y = res_y
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    world.color = (0.52, 0.80, 0.91)  # synthview sky colour
    sc.world = world
    sc.display.shading.background_type = "WORLD"
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def look(cam, target_g, direction_g, dist):
    t = C.g2b(target_g)
    d = C.g2b(direction_g).normalized()
    cam.location = t + d * dist
    if abs(d.z) > 0.999:  # straight down: nose at the top of the image
        cam.rotation_euler = (0.0, 0.0, math.pi)
        return
    q = (-d).to_track_quat("-Z", "Y")
    cam.rotation_euler = q.to_euler()


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    for o in objs:
        for m in o.data.materials:
            if m and m.name.split(".")[0] in C.MATERIALS:
                rgb, _ = C.MATERIALS[m.name.split(".")[0]]
                m.diffuse_color = (*rgb, 1.0)
    return objs


def bounds(objs):
    pts = [C.b2g(o.matrix_world @ Vector(c)) for o in objs for c in o.bound_box]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def model_views(name, out_dir, glb_dir):
    C.reset()
    objs = import_glb(os.path.join(glb_dir, name + ".glb"))
    lo, hi = bounds(objs)
    size = max(hi[i] - lo[i] for i in range(3))
    span = hi[0] - lo[0]
    sc, cam = setup_scene(800, 500)
    # Follow view in perspective, like the synthetic view's camera; side and
    # front orthographic so near wings do not loom.
    cam.data.type = "PERSP"
    cam.data.angle = math.radians(40)
    look(cam, (0, 0, 0), VIEWS["follow"], size * 1.6)
    render(os.path.join(out_dir, "%s_follow.png" % name))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size * 1.15
    for v in ("side", "front"):
        look(cam, (0, 0, 0), VIEWS[v], size * 3)
        render(os.path.join(out_dir, "%s_%s.png" % (name, v)))
    # 40 px span thumbnails (R9): ortho, span over 40 of 64 px
    sc.render.resolution_x = 64
    sc.render.resolution_y = 40
    cam.data.type = "ORTHO"
    for v in ("follow", "side"):
        cam.data.ortho_scale = span * 64 / 40 if v == "follow" else (hi[2] - lo[2]) * 64 / 40
        look(cam, (0, 0, 0), VIEWS[v], size * 3)
        render(os.path.join(out_dir, "%s_%s_40px.png" % (name, v)))


def common_scale_tiles(out_dir, glb_dir, names):
    """Every model from the side and from the follow view at one scale."""
    for name in names:
        C.reset()
        import_glb(os.path.join(glb_dir, name + ".glb"))
        sc, cam = setup_scene(500, 260)
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 40.0
        for v in ("side", "follow"):
            look(cam, (0, 0, 0), VIEWS[v], 80)
            render(os.path.join(out_dir, "common_%s_%s.png" % (v, name)))


def grid_views(objs, out_prefix, width_m=12.0):
    sc, cam = setup_scene(int(width_m * 100), int(width_m * 50))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = width_m
    for v in ("side", "top", "front"):
        look(cam, (0, 0, 0), VIEWS[v], 50)
        render("%s_%s.png" % (out_prefix, v))


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:]
    if argv and argv[0] == "--grid":
        C.reset()
        objs = import_glb(argv[1])
        grid_views(objs, argv[2], float(argv[3]) if len(argv) > 3 else 12.0)
        sys.exit(0)
    out_dir = argv[0]
    names = argv[1:] or ALL
    os.makedirs(out_dir, exist_ok=True)
    for n in names:
        model_views(n, out_dir, C.OUT_DIR)
    common_scale_tiles(out_dir, C.OUT_DIR, names)
