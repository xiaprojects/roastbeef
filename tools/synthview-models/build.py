"""Model the four types that have no source (M1, M2, M5, M6) from parametric
descriptions: fuselage sections, wing and tail sections, struts, gear,
propeller or rotor.

    blender -b -P tools/synthview-models/build.py -- [helicopter b737 p92 pa28]

Output: web/settings/glb/lowpoly_<name>.glb.  Axes and units as in
common.py: glTF axes, metres, +X left wing, +Y up, +Z nose; origin at about
25 % of the mean chord at mid fuselage height (R7), on the mast axis for the
helicopter.

Dimensions are the working figures of docs/tech-debt/synthview-aircraft-models.md
section 3 (typical published values, not data-sheet checked); shapes are
from general knowledge of each type, enough for a symbol (R9).
"""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

T = math.tan
R = math.radians


def finish(B, name, title, glass=None, trim=None, max_ny=0.85):
    ob = B.to_object(name)
    C.cut_and_assign(ob, glass or [], "glass", max_ny=max_ny)
    C.cut_and_assign(ob, trim or [], "trim")
    C.triangulate_and_clean(ob)
    print("%s: %d triangles %s" % (name, C.tri_count(ob), C.tri_by_material(ob)))
    path = C.export(ob, name, title, {
        "source": "Original low-poly model built from parameters in tools/synthview-models/build.py",
        "tool": "tools/synthview-models/build.py",
    })
    print("  wrote", path)


# ------------------------------------------------------------------ PA-28

def pa28():
    """Piper PA-28 Warrior/Archer: low tapered wing with dihedral, tricycle
    gear with wheel fairings, stabilator, swept fin.  Span 10.67 m, length
    7.25 m, height 2.2 m."""
    B = C.Builder()
    # Fuselage: nose (spinner tip) at z +2.40, tail at z -4.85.
    B.loft([
        (2.12, -0.05, 0.26, 0.26),
        (1.75, -0.02, 0.45, 0.42),
        (1.15, 0.02, 0.56, 0.55),
        (0.40, 0.04, 0.60, 0.62),
        (-0.70, 0.02, 0.58, 0.60),
        (-1.60, -0.02, 0.46, 0.48),
        (-3.00, -0.10, 0.27, 0.32),
        (-4.60, -0.16, 0.10, 0.15),
        (-4.85, -0.16, 0.0, 0.0),
    ], "paint", n=12, power=2.6)
    # Wing: constant chord 1.60 inboard, tapered outboard, 7 deg dihedral.
    dih = T(R(7.0))
    y0 = -0.48
    B.surface([
        (0.0, y0, 0.40, 1.60, 0.15),
        (2.10, y0 + 2.10 * dih, 0.40, 1.60, 0.15),
        (5.33, y0 + 5.33 * dih, 0.18, 1.07, 0.12),
    ], "paint", mirror=True)
    # Stabilator and fin
    B.surface([(0.0, -0.20, -4.02, 0.78, 0.10), (1.98, -0.20, -4.12, 0.68, 0.10)], "paint", mirror=True)
    B.surface([(0.05, 0.0, -3.25, 1.35, 0.10), (0.95, 0.0, -4.05, 0.72, 0.10)], "paint", vertical=True)
    # Gear: wheel centres 0.30 above the ground at y -1.30; track 3.05 m.
    for s in (1, -1):
        x = s * 1.52
        B.prism((x, y0 + 1.52 * dih - 0.05, -0.45), (x, -0.95, -0.50), 0.08, 0.08, "paint", n=6)
        B.wheel((x, -1.00, -0.50), 0.29, 0.14, "dark", n=10)
        B.loft([(0.05, -0.98, 0.0, 0.0, x), (-0.20, -0.98, 0.11, 0.20, x),
                (-0.65, -0.97, 0.13, 0.23, x), (-1.05, -0.95, 0.06, 0.10, x),
                (-1.20, -0.94, 0.0, 0.0, x)], "paint", n=8)
    B.prism((0.0, -0.35, 1.85), (0.0, -1.05, 1.90), 0.07, 0.07, "paint", n=6)
    B.wheel((0.0, -1.06, 1.90), 0.25, 0.12, "dark", n=10)
    C.prop_and_spinner(B, (0.0, -0.05, 2.10), 0.94, 20.0, 0.17, 0.30)
    glass = [
        # windscreen and side windows: upper cabin from the windscreen base
        # to the rear window
        [C.up_plane(0.22), C.aft_of(1.20), C.fwd_of(-1.75), *C.side(0.7)],
    ]
    trim = [[C.up_plane(0.10), C.aft_of(-3.20), *C.side(0.2)]]
    finish(B, "lowpoly_pa28", "Piper PA-28 (low poly)", glass, trim)


# ------------------------------------------------------------------ P92

def p92():
    """Tecnam P92 Echo: high constant-chord wing with one strut per side,
    pod cabin with large windows, slim tail boom, stabilator, swept fin,
    tricycle gear on spring legs.  Span 9.3 m, length 6.4 m, height 2.5 m."""
    B = C.Builder()
    B.loft([
        (1.98, -0.06, 0.25, 0.27),
        (1.45, -0.02, 0.44, 0.46),
        (0.95, 0.03, 0.55, 0.58),
        (0.05, 0.05, 0.56, 0.62),
        (-0.95, 0.12, 0.48, 0.50),
        (-1.65, 0.26, 0.28, 0.30),
        (-2.60, 0.33, 0.15, 0.17),
        (-3.95, 0.36, 0.09, 0.11),
        (-4.15, 0.37, 0.0, 0.0),
    ], "paint", n=12, power=2.4)
    yw = 0.74
    B.surface([(0.0, yw, 0.36, 1.40, 0.14), (4.65, yw + 0.10, 0.36, 1.40, 0.13)], "paint", mirror=True)
    # Struts: fuselage lower side to the wing at 55 % of the semispan.
    for s in (1, -1):
        B.prism((s * 0.50, -0.30, -0.10), (s * 2.55, yw - 0.05, -0.05), 0.14, 0.05, "paint", n=4)
    # Tail
    B.surface([(0.0, 0.34, -3.32, 0.72, 0.10), (1.45, 0.34, -3.40, 0.62, 0.10)], "paint", mirror=True)
    B.surface([(0.38, 0.0, -2.90, 1.15, 0.10), (1.35, 0.0, -3.70, 0.62, 0.10)], "paint", vertical=True)
    # Gear: ground at y -1.15
    for s in (1, -1):
        B.prism((s * 0.40, -0.48, -0.55), (s * 0.95, -0.93, -0.58), 0.12, 0.05, "paint", n=4)
        B.wheel((s * 0.97, -0.95, -0.58), 0.20, 0.12, "dark", n=10)
    B.prism((0.0, -0.35, 1.60), (0.0, -0.95, 1.65), 0.06, 0.06, "paint", n=6)
    B.wheel((0.0, -0.96, 1.65), 0.18, 0.10, "dark", n=10)
    C.prop_and_spinner(B, (0.0, -0.06, 1.96), 0.86, 30.0, 0.15, 0.28)
    glass = [[C.up_plane(0.02), C.below(0.66), C.aft_of(1.05), C.fwd_of(-1.30), *C.side(0.7)]]
    trim = [[C.up_plane(0.47), C.aft_of(-2.85), *C.side(0.2)]]
    finish(B, "lowpoly_p92", "Tecnam P92 Echo (low poly)", glass, trim)


# ------------------------------------------------------------------ 737

def b737():
    """Boeing 737-800 with blended winglets: low swept wing with dihedral,
    two underwing engines, swept fin with dorsal fillet, swept tailplane,
    gear up.  Span 35.8 m, length 39.5 m, height 12.5 m (on the ground;
    the model has the gear up, so its own height is lower)."""
    B = C.Builder()
    B.loft([
        (18.50, -0.45, 0.0, 0.0),
        (18.10, -0.35, 0.75, 0.80),
        (17.00, -0.15, 1.40, 1.50),
        (15.30, 0.00, 1.82, 1.90),
        (13.50, 0.00, 1.88, 1.95),
        (-8.00, 0.00, 1.88, 1.95),
        (-12.00, 0.25, 1.62, 1.68),
        (-16.00, 0.75, 1.05, 1.15),
        (-19.60, 1.15, 0.42, 0.48),
        (-21.00, 1.30, 0.0, 0.0),
    ], "paint", n=12)
    # Wing: 25 deg quarter-chord sweep (about 27 deg at the leading edge),
    # unswept inboard trailing edge, 6 deg dihedral.
    sw = T(R(27.0))
    dih = T(R(6.0))
    y0 = -1.25

    def le(x):
        return 4.50 - x * sw

    B.surface([
        (0.0, y0, le(0.0), 7.30, 0.15),
        (5.50, y0 + 5.5 * dih, le(5.5), le(5.5) + 2.80, 0.13),
        (17.35, y0 + 17.35 * dih, le(17.35), 1.25, 0.10),
    ], "paint", mirror=True)
    ytip = y0 + 17.35 * dih
    # Blended winglets: near vertical, slightly canted out, swept.
    B.surface([(ytip, 17.35, le(17.35), 1.25, 0.10), (ytip + 2.40, 17.85, le(17.35) - 1.20, 0.55, 0.08)],
              "trim", vertical=True, mirror=True)
    # Engines (CFM56) under the wing at 5.0 m, flat-bottomed nacelle.
    for s in (1, -1):
        x = s * 5.00
        cy = -2.05
        B.loft([(4.40, cy, 0.98, 0.92, x), (3.40, cy, 1.05, 1.00, x),
                (1.00, cy + 0.05, 0.90, 0.85, x), (-0.40, cy + 0.10, 0.55, 0.50, x),
                (-1.20, cy + 0.10, 0.0, 0.0, x)], "paint", n=12, cap0=False)
        B.loft([(4.30, cy, 0.90, 0.85, x), (3.90, cy, 0.0, 0.0, x)], "dark", n=12)
        # pylon
        B.prism((x, -1.20, 2.60), (x, -1.20, -0.90), 0.28, 0.70, "paint", n=4)
    # Tailplane: 30 deg sweep, 7 deg dihedral.
    tsw = T(R(30.0))
    B.surface([(0.0, 0.85, -14.30, 4.40, 0.10), (7.17, 0.85 + 7.17 * T(R(7.0)), -14.30 - 7.17 * tsw, 1.30, 0.09)],
              "paint", mirror=True)
    # Fin with dorsal fillet, 35 deg sweep.
    B.surface([(1.40, 0.0, -10.00, 9.00, 0.10), (2.60, 0.0, -12.60, 6.60, 0.11),
               (8.80, 0.0, -12.60 - 6.2 * T(R(35.0)), 2.10, 0.10)], "paint", vertical=True)
    glass = [
        # cockpit windows
        [C.up_plane(0.55), C.below(1.25), C.aft_of(17.05), C.fwd_of(15.6), *C.side(2.0)],
        # cabin window line
        [C.up_plane(0.55), C.below(0.85), C.aft_of(13.6), C.fwd_of(-11.0), *C.side(2.0)],
    ]
    trim = [[C.up_plane(2.70), C.aft_of(-11.50), *C.side(0.6)]]
    finish(B, "lowpoly_b737", "Liner, Boeing 737-800 type (low poly)", glass, trim, max_ny=0.9)


# ------------------------------------------------------------------ helicopter

def helicopter():
    """Light single-engine helicopter, two-blade rotor: bubble cabin, engine
    hump, slim tail boom with fin and small tailplane, two-blade tail rotor
    on the left, skids.  Rotor 10.1 m, fuselage 9.1 m, height 3.3 m.
    Origin on the mast axis at mid cabin height."""
    B = C.Builder()
    B.loft([
        (2.00, -0.15, 0.0, 0.0),
        (1.85, -0.12, 0.42, 0.50),
        (1.40, -0.05, 0.62, 0.72),
        (0.60, 0.00, 0.68, 0.78),
        (-0.40, 0.02, 0.64, 0.74),
        (-1.20, 0.10, 0.45, 0.55),
        (-1.55, 0.20, 0.0, 0.0),
    ], "paint", n=12)
    # Engine and transmission hump behind the cabin top
    B.loft([(0.60, 0.72, 0.0, 0.0), (0.35, 0.78, 0.30, 0.18), (-0.80, 0.80, 0.34, 0.22),
            (-1.50, 0.62, 0.20, 0.14), (-1.75, 0.55, 0.0, 0.0)], "paint", n=8)
    # Tail boom
    B.loft([(-1.25, 0.30, 0.26, 0.26), (-4.00, 0.40, 0.15, 0.15), (-7.00, 0.48, 0.08, 0.08),
            (-7.10, 0.48, 0.0, 0.0)], "paint", n=8)
    # Fin (above and below the boom) and tailplane
    B.surface([(0.30, 0.0, -6.45, 0.75, 0.12), (1.35, 0.0, -6.85, 0.45, 0.12)], "trim", vertical=True)
    B.surface([(0.10, 0.0, -6.55, 0.55, 0.12), (0.48, 0.0, -6.75, 0.40, 0.12)], "trim", vertical=True)
    B.surface([(0.0, 0.43, -5.60, 0.45, 0.12), (0.85, 0.43, -5.65, 0.38, 0.12)], "paint", mirror=True)
    # Tail rotor on the left side, blades in the y-z plane
    hub = (0.16, 0.95, -6.95)
    B.prism((0.06, 0.95, -6.95), (0.20, 0.95, -6.95), 0.08, 0.08, "dark", n=6)
    for s in (1, -1):
        a = R(75.0)
        B.blade(hub, (0.0, s * math.cos(a), s * math.sin(a)), 0.80, 0.14, 0.03, "dark", fwd=(1, 0, 0), tip=0.8)
    # Mast and main rotor: two blades, 30 deg off the lateral axis
    B.prism((0.0, 0.85, 0.0), (0.0, 1.62, 0.0), 0.14, 0.14, "dark", n=6)
    B.loft([(0.18, 1.62, 0.0, 0.0), (0.12, 1.66, 0.20, 0.08), (-0.12, 1.66, 0.20, 0.08),
            (-0.18, 1.62, 0.0, 0.0)], "dark", n=6)
    for s in (1, -1):
        a = R(30.0)
        B.blade((0.0, 1.66, 0.0), (s * math.cos(a), -0.015, s * math.sin(a)), 5.05, 0.30, 0.05, "dark",
                fwd=(0, 1, 0), tip=0.9, r0=0.1)
    # Skids: ground at y -1.62
    for s in (1, -1):
        x = s * 1.10
        B.prism((x, -1.58, -1.45), (x, -1.58, 1.35), 0.08, 0.08, "dark", n=6)
        B.prism((x, -1.58, 1.35), (x, -1.38, 1.75), 0.08, 0.08, "dark", n=6)
        for z in (0.95, -0.85):
            B.prism((x, -1.58, z), (s * 0.45, -0.62, z), 0.07, 0.07, "dark", n=6)
    glass = [
        # bubble nose and doors
        [C.up_plane(-0.35), C.fwd_of(-0.30), *C.side(0.9)],
    ]
    finish(B, "lowpoly_helicopter", "Generic light helicopter (low poly)", glass, [], max_ny=0.97)


BUILDERS = {"helicopter": helicopter, "b737": b737, "p92": p92, "pa28": pa28}

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for n in argv or list(BUILDERS):
        C.reset()
        BUILDERS[n]()
