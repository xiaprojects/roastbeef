# Synthetic view: low-poly aircraft model preset

Status: implemented 2026-11-11, uncommitted, waiting for the owner's review of the renders
in [synthview-aircraft-models/](synthview-aircraft-models/). The seven files pass
`tools/synthview-models/check.py` and load in the RB-01 view with no loader error. Still
open: Q12 (source URL and licence of the three downloaded models) and the visibility of a
white model against the horizon line. Owner: xiaprojects.

Goal: ship a preset of seven low-poly aircraft models that the synthetic view can draw as the
own aircraft and as traffic:

| # | Model | Output file (`web/settings/glb/`) | Made from |
|---|---|---|---|
| M1 | Generic helicopter | `lowpoly_helicopter.glb` | modelled in Blender |
| M2 | Liner, Boeing 737 | `lowpoly_b737.glb` | modelled in Blender |
| M3 | Van's RV-4 | `lowpoly_rv4.glb` | reduced from `RV4.glb` |
| M4 | Van's RV-7 | `lowpoly_rv7.glb` | reduced from `RV7_CARB.glb` |
| M5 | Tecnam P92 | `lowpoly_p92.glb` | modelled in Blender |
| M6 | Piper PA-28 | `lowpoly_pa28.glb` | modelled in Blender |
| M7 | Cessna 172 | `lowpoly_c172.glb` | reduced from `C172.glb` |

The output names carry a prefix so they cannot collide with the owner's source files
(`RV4.glb` and `rv4.glb` are the same file on a case-insensitive checkout).

Section 1 is what the code imposes today, section 2 is the requirement list for the models,
section 3 holds the inputs and the decisions, section 4 is the implementation plan.

## 1. How the synthetic view uses a model today

Checked in this working tree: `web/RB-01/synthview/`, `web/RB-01/plates/js/synthview.js`,
`web/settings/synthview.json`, `web/settings/glb/`.

| # | Finding |
|---|---|
| F1 | The renderer is Three.js r136 with `GLTFLoader`. `web/RB-01/synthview/` ships no `DRACOLoader`, no meshopt decoder and no KTX2 loader, so a compressed model does not load. |
| F2 | A model is the file `glbPath + template + ".glb"`, binary glTF 2.0 only. The `template` string in `synthview.json` is the file name without its extension. |
| F3 | Orientation is fixed by the code (`generateItemGLB`): rotation order `YXZ`, yaw `180 - direction + directionModel`, pitch about X, roll about Z. North is −Z in the scene. A model therefore needs its nose on +Z and its top on +Y to work with `directionModel: 0`, which is also the glTF default. The current `me.glb` follows this. |
| F4 | The drawn size is `scale × cellSize / 300`. With the shipped `scale: 20` and a 240-row terrain window (`cellSize` 328) the current model, 15.2 units of span, is drawn about one terrain cell wide. Models are symbols, far larger than true scale. |
| F5 | The follow camera sits behind the own aircraft at its altitude, 2.5 cells back, with a 75° field of view. The own aircraft is seen from behind most of the time; traffic is seen from any side. |
| F6 | Colour: when the item `color` is not null, every `MeshStandardMaterial` in the model gets that colour as emissive at 0.5 intensity. All materials are tinted, glass and tyres included. An unlit material is skipped without warning. For traffic templates a non-null `color` is replaced by a random pastel. |
| F7 | Each aircraft item creates its own `GLTFLoader` and loads and parses the file again. Nothing is cached or cloned in the page, so file size and parse time are paid once per traffic target. |
| F8 | Animations in a file are never played: there is no `AnimationMixer`. Propellers and rotors are static. |
| F9 | Scene lighting is one ambient light (0.5) and one directional light (1.0). Antialiasing is off. There are no shadows and no environment map, so metalness and clearcoat give nothing useful. |
| F10 | Traffic picks a model in two ways: `trafficMapping[name]`, where the name is the tail number when known and the ICAO address otherwise, or a random entry of `trafficTemplates[category]`. Only `Helic`, `Large` and `Light` have entries; every other emitter category (glider, ultralight, small, heavy, ...) falls back to `Light`. |
| F11 | Traffic data carries no aircraft type. Nothing can tell a PA-28 from a C172 from the air. A type-specific model can only be chosen for the own aircraft (`items[0].template`) or for a tail number listed in `trafficMapping`. |
| F12 | `me.glb`, `traffic_light.glb`, `traffic_large.glb` and `traffic_helicopter.glb` are the same file (same MD5): a Corsair F4U-4, 776 KB, about 9,400 triangles in 9 meshes with 7 materials. Two propeller discs take 6,000 of those triangles. A helicopter and an airliner are drawn as a Corsair today. |
| F13 | Licences of the shipped files, from their own metadata: the Corsair is "Sketchfab Standard", the airfield pointer `map_pointer_places_of_interest.glb` is CC-BY-NC-ND 4.0. Neither is a licence that fits redistribution inside a commercial product. Neither file is in the hash list of `scripts/provenance.sh`. |
| F14 | The legacy UI (`web/plates/js/synthview.js`) reads the same `synthview.json` but applies `scale` without the `cellSize / 300` factor, so one scale value gives two sizes. |
| F15 | Blender 5.0.1 is installed on the development machine (`/usr/bin/blender`) and runs headless with `blender -b -P script.py`. |

### Source models supplied by the owner

Three detailed models were added to `web/settings/glb/` on 2026-11-11. They are untracked in
git. Measured from the files:

| | `C172.glb` | `RV4.glb` | `RV7_CARB.glb` |
|---|---|---|---|
| Size | 1.3 MB | 1.1 MB | 1.1 MB |
| Triangles | 17,134 | 13,701 | 14,721 |
| Vertices stored / distinct positions | 50,252 / 7,511 | 41,070 / 6,860 | 43,959 / 6,799 |
| Separate parts in the one mesh | 12 | 6 | 8 |
| Span in file units | 390.3 | 339.1 | 332.9 |
| File units per metre, from the real span | about 35.5 | about 48.4 | about 43.7 |

| # | Finding |
|---|---|
| S1 | Each file is one node with one mesh, exported from Blender. There are no materials, no textures, no UVs and no animations: the models draw in the loader's default grey. |
| S2 | Orientation already matches R6: nose on +Z, top on +Y, no transform on the node. |
| S3 | The units are neither metres nor one common scale; each file needs its own factor to reach real size (R5). |
| S4 | The origin is not at the centre of gravity. In all three the wing sits at about z 0 to +40 and the tailplane at about z −150. |
| S5 | The triangles are stored unwelded (every stored vertex is used once), so the files are six to seven times larger than their shape needs. |
| S6 | In `RV4.glb` and `RV7_CARB.glb` the lowest point at the tail is at the same height as the main wheels, so both appear to sit in the three-point ground attitude, nose high. `synthview_my_samples.json` corrects an RV-4 with `pitchModel: 15`, which agrees. To be confirmed in Blender, then rotated to flight attitude (R8). |
| S7 | `RV7_CARB.glb` has a tailwheel, so M4 is the RV-7 and not the RV-7A. |
| S8 | At 13,000 to 17,000 triangles they are about ten times over the budget of R11 and cannot be shipped as they are. |

## 2. Requirements for the models

### Format

| # | Requirement |
|---|---|
| R1 | Binary glTF 2.0 (`.glb`), one self-contained file per model, no external buffers or images. |
| R2 | No Draco, meshopt or KTX2/Basis compression (F1). `KHR_mesh_quantization` is allowed. |
| R3 | No textures, no UV set, no animations, no skins, no cameras, no lights. Colour comes from material base colours only. |
| R4 | `asset.extras` carries title, author and licence, as the current files do. |

### Geometry

| # | Requirement |
|---|---|
| R5 | Units are metres, at the real dimensions of the type (span, length, height, tailplane span, wheel track). |
| R6 | Nose on +Z, top on +Y, right wing on −X, with no transform left on the root node, so that `directionModel`, `pitchModel` and `roll` are all 0 in the preset (F3). |
| R7 | Origin at the approximate centre of gravity: on the centreline, at about 25 % of the mean wing chord, at mid fuselage height. Roll and pitch then turn the model about a believable point. For the helicopter the origin is on the rotor mast axis. |
| R8 | Level flight attitude: fuselage reference line horizontal. Tailwheel types (RV-4, RV-7) are modelled in flight attitude, not sitting on the tailwheel. |
| R9 | The type must be recognisable from behind and from the side at about 40 px of span: wing position (high or low), struts, tail shape, gear layout and canopy shape matter; panel lines, rivets and antennas do not. |
| R10 | Closed, outward-facing surfaces with normals. Flat shading, single-sided materials. No interior, no cockpit. |

### Budget

Target hardware is the Raspberry Pi running Chromium, with many traffic targets on screen.

| # | Requirement |
|---|---|
| R11 | Triangles: at most 1,500 for each GA type, 2,500 for the 737 and the helicopter. |
| R12 | At most 4 materials and one mesh per material, so at most 4 draw calls per aircraft. |
| R13 | File size at most 100 KB per model (F7). |
| R14 | No alpha-blended material, except the propeller or rotor disc if that option is chosen (Q5). |

### Materials and colour

| # | Requirement |
|---|---|
| R15 | Standard PBR materials only (metallic 0, roughness 0.5 to 0.8). No `KHR_materials_unlit`, or the tint is lost (F6). No clearcoat or specular extensions (F9). |
| R16 | Fixed material names in every model: `paint`, `trim`, `glass`, `dark` (tyres, propeller, rotor). This lets the code tint only `paint` later instead of everything. |
| R17 | Neutral default scheme, white `paint` with one `trim` colour, readable against the sky colour and against green, yellow and red terrain. The emissive tint must still give clearly different colours on it. |
| R18 | No manufacturer logo, airline livery or registration on any model. |

### Integration

| # | Requirement |
|---|---|
| R19 | Files go in `web/settings/glb/` under the names in the table at the top. The existing models are not modified, moved or deleted. The owner's three source files are moved unchanged to `tools/synthview-models/sources/` (Q13). |
| R20 | `web/settings/synthview.json` gets a ready `scale` per model, so that all GA types are drawn at today's size and the preset can be used without tuning. |
| R21 | The category defaults stop being a Corsair: in `synthview.json`, `Helic` uses M1, `Large` uses M2, `Light` uses M7 and the own aircraft uses M3 (Q7). |
| R22 | The models are original work under a licence that allows shipping them with the product, and are recorded in `docs/certification/provenance.md` (F13). |
| R23 | The Blender scripts that produce each `.glb` are kept in the repository under `tools/synthview-models/`, so a model can be corrected and rebuilt with one command. |

### Acceptance

| # | Requirement |
|---|---|
| R24 | Each file loads in the RB-01 synthetic view with no console error or warning from `GLTFLoader`. |
| R25 | A check script confirms R1 to R3, R5, R6 and R11 to R13 for every file: bounding box against the reference dimensions, triangle, material and mesh counts, file size. |
| R26 | One screenshot per model as own aircraft from the follow camera, at 480×480 (round panel) and at 1024×600, and one with all seven as traffic, reviewed by the owner. |
| R27 | Heading, pitch and roll are checked with the model in the scene: heading 090 points east, pitch up raises the nose, roll right lowers the right wing. |

## 3. Inputs and decisions

### Reference dimensions

The table lists the figures the models are built to. They are typical published values
written from memory and must be checked against each type's data sheet.

| Model | Variant | Span | Length | Height | Layout |
|---|---|---|---|---|---|
| Helicopter | light single, two-blade rotor | rotor 10.1 m | 9.1 m fuselage | 3.3 m | skids, tail boom, tail rotor |
| 737 | 737-800 with winglets | 35.8 m | 39.5 m | 12.5 m | low wing, two underwing engines |
| RV-4 | as in `RV4.glb` | 7.0 m | 6.2 m | 1.6 m | low wing, tandem, tailwheel, bubble canopy |
| RV-7 | tailwheel, as in `RV7_CARB.glb` | 7.6 m | 6.2 m | 1.8 m | low wing, side by side, bubble canopy |
| P92 | P92 Echo | 8.7 to 9.6 m by variant | 6.3 to 6.6 m | 2.5 m | high wing, one strut per side, tricycle |
| PA-28 | Warrior / Archer, tapered wing | 10.7 m | 7.3 m | 2.2 m | low wing, tricycle, stabilator |
| C172 | as in `C172.glb` | 11.0 m | 8.3 m | 2.7 m | high wing, one strut per side, tricycle |

The three source models fix the shape of M3, M4 and M7; only their size comes from this
table. M1, M2, M5 and M6 have no source and are built from these dimensions and general
knowledge of the type, which is enough for R9 but not for exact proportions. A three-view
drawing would improve them.

### Decisions

The implementer works to the "Working decision" column. A row marked open can still be
changed by the owner without redoing the others.

| # | Question | Working decision | State |
|---|---|---|---|
| Q1 | Which variant of each type? | RV-4, RV-7 and C172 as the source models. 737-800 with winglets, P92 Echo, PA-28 with the tapered wing, a light two-blade helicopter. | sources settle three; four open |
| Q2 | Reference material. | The three source models. Nothing for the other four. | settled for three |
| Q3 | Relative size. At true proportions and one scale the 737 is drawn five times wider than an RV-4. | Real metres in the file (R5), then `scale` per model: GA types and the helicopter at today's drawn size, the 737 at twice that. | open |
| Q4 | Colour scheme. | Neutral for all seven: white `paint`, one `trim` colour. A personal scheme is a later, separate file. | open |
| Q5 | Propeller and rotor: static blades or a translucent disc? | Static two-blade propeller, static rotor blades, no transparency. | open |
| Q6 | Landing gear. | Fixed gear on the GA types, skids on the helicopter, 737 gear up. | open |
| Q7 | Defaults. | M7 for `Light`, M3 for the own aircraft, M1 for `Helic`, M2 for `Large`. Other categories keep falling back to `Light`. | open |
| Q8 | How the pilot picks the own-aircraft model. | By editing `synthview.json`. A settings list is a separate task. | open |
| Q9 | How the models are produced. | Blender 5.0.1, headless, from Python scripts kept in the repository (F15). | settled |
| Q10 | Licence of the new models, and the fate of the Corsair and the airfield pointer (F13). | New models under the repository licence. The old files stay on disk; `synthview.json` stops pointing at the Corsair. The pointer is not replaced in this step. | open |
| Q11 | Budgets and the device target. | Budgets of R11 to R13. Frame time on the device is measured by the owner. | open |
| Q12 | Who made `C172.glb`, `RV4.glb` and `RV7_CARB.glb`, and under which licence? A reduced copy stays a derived work of its source (R22). | Owner, 2026-11-11: found free on the internet; reducing and transforming them is allowed. The download page and its licence terms are not recorded, so the provenance entry says so. | open: URL and licence text still missing |
| Q13 | Do the three source files stay in `web/settings/glb/`? | Owner, 2026-11-11: no. They move to `tools/synthview-models/sources/`, which git ignores. A fresh clone therefore cannot rebuild M3, M4 and M7; the shipped `lowpoly_*.glb` files are what git keeps. | settled |

## 4. Implementation plan

All work runs headless in Blender. The scripts live in `tools/synthview-models/`; nothing in
`web/RB-01/` changes.

| Step | Work | Result |
|---|---|---|
| 1 | Shared Blender helpers: import a `.glb`, the four materials of R16, flat shading, export with the settings of R1 to R3, write `asset.extras` (R4). | `tools/synthview-models/common.py` |
| 2 | Reduce M3, M4 and M7 from their sources: weld the vertices (S5), confirm and correct the attitude (S6), scale to real span (S3), move the origin (R7, S4), split the parts into `paint`, `glass` and `dark`, simplify the propeller and wheels, decimate to the budget while keeping the silhouette (R9). | `reduce.py`, three `.glb` |
| 3 | Model M1, M2, M5 and M6 from parametric descriptions: fuselage sections, wing, tail, struts, gear, rotor. | `build.py`, four `.glb` |
| 4 | Check script for R25, written without Blender so it tests the exported file and not the scene. | `check.py`, pass for all seven |
| 5 | Review renders from Blender: each model from behind and above (the follow camera of F5), from the side and from the front, plus one sheet with all seven at a common scale. | PNG files for the owner |
| 6 | `synthview.json`: per-model `scale` (R20), new defaults (R21), and the seven models listed as ready templates. | edited settings |
| 7 | Load test in the RB-01 synthetic view: console clean (R24), heading, pitch and roll (R27), screenshots at 480×480 and 1024×600 (R26). | screenshots, or a note of what could not be run |
| 8 | Provenance entry for the seven files and their sources (R22, Q12). | `docs/certification/provenance.md` |

Risks:

- Decimating to 1,500 triangles can destroy thin parts (struts, gear legs, propeller) and
  the canopy outline. Those parts are rebuilt from simple shapes instead of decimated.
- A source model has no material split (S1). Glass and dark parts must be identified by
  part and position; where the canopy is fused with the fuselage, it is cut by a plane.
- Steps 5 and 7 need the owner's eye: R9 is a judgement, not a number.

### Out of scope

- Choosing a model from the real aircraft type of a traffic target (F11). It needs a type
  source such as a registration database, which the daemon does not have.
- Caching one loaded model and cloning it for every traffic target (F7). It is the larger
  performance gain, but it is a code change in `synthview.js`, not a model requirement.
- Tinting only the `paint` material (F6, R16), and aligning the legacy UI scale (F14).
- Animated propellers and rotors (F8).
