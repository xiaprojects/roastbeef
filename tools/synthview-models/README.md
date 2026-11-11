# Synthetic-view aircraft models

Scripts that produce the low-poly preset in `web/settings/glb/lowpoly_*.glb`, specified in
`docs/tech-debt/synthview-aircraft-models.md`. Blender 5.0.1, headless.

| File | Role |
|---|---|
| `common.py` | Materials (`paint`, `trim`, `glass`, `dark`), primitives (loft, wing, prism, wheel, blade), glass cutting by planes, export with `asset.extras` and byte normals |
| `build.py` | Models with no source: helicopter, 737, P92, PA-28 |
| `reduce.py` | Models reduced from detailed sources: RV-4, RV-7, C172 |
| `check.py` | Checks the exported files (format, axes, size, budgets); plain Python + numpy, no Blender |
| `render.py` | Review renders (Workbench) |
| `rebuild.sh` | All of the above in one go |

```sh
tools/synthview-models/rebuild.sh                              # everything
blender -b -P tools/synthview-models/build.py -- p92           # one built model
blender -b -P tools/synthview-models/reduce.py -- rv4          # one reduced model
python3 tools/synthview-models/check.py                        # check all seven
blender -b -P tools/synthview-models/render.py -- OUT_DIR      # review renders
```

## The sources are not in git

`reduce.py` reads `C172.glb`, `RV4.glb` and `RV7_CARB.glb` from `sources/` in this folder.
The owner downloaded them free from the internet; their origin and licence are not recorded,
so they are kept out of git (`.gitignore`) and a fresh clone **cannot rebuild** the three
reduced models. `reduce.py` stops with a message naming the missing file. The four built
models need nothing but Blender.

## Conventions

glTF axes in metres: +X left wing (right wing on −X), +Y up, +Z nose, no node transform.
Origin at about 25 % of the mean chord, mid fuselage height; on the mast axis for the
helicopter. Level flight attitude: `reduce.py` pitches the RV-4 and RV-7 sources nose down by
11.3° and 11.4°, the angle of their tailplane chord, to take them out of the three-point
attitude. Normals are stored as normalised bytes (`KHR_mesh_quantization`), which keeps the
flat-shaded files under 100 KB.
