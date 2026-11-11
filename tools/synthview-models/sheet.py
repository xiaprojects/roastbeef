#!/usr/bin/env python3
"""Assemble the PNGs written by render.py into review sheets (needs Pillow).

    python3 tools/synthview-models/sheet.py RENDER_DIR [OUT_DIR]

Writes per model <name>.png (follow, side, front, and the 40 px-span views
enlarged 4x without smoothing) and all_common_scale.png (all seven from the
side and from behind at one scale).
"""

import os
import sys

from PIL import Image, ImageDraw

ALL = ["lowpoly_helicopter", "lowpoly_b737", "lowpoly_rv4", "lowpoly_rv7",
       "lowpoly_p92", "lowpoly_pa28", "lowpoly_c172"]


def label(im, text):
    ImageDraw.Draw(im).text((6, 4), text, fill=(0, 0, 0))
    return im


def model_sheet(src, out, name):
    big = [Image.open(os.path.join(src, "%s_%s.png" % (name, v))).convert("RGB")
           for v in ("follow", "side", "front")]
    w, h = big[0].size
    small = [Image.open(os.path.join(src, "%s_%s_40px.png" % (name, v))).convert("RGB")
             .resize((256, 160), Image.NEAREST) for v in ("follow", "side")]
    sheet = Image.new("RGB", (w * 2, h * 2), (255, 255, 255))
    for i, (im, txt) in enumerate(zip(big, ("follow camera (behind, above)", "side", "front"))):
        sheet.paste(label(im, txt), ((i % 2) * w, (i // 2) * h))
    for i, im in enumerate(small):
        sheet.paste(im, (w + 20 + i * 276, h + 40))
    ImageDraw.Draw(sheet).text((w + 20, h + 210), "40 px span, enlarged 4x: behind, side", fill=(0, 0, 0))
    sheet.save(os.path.join(out, "%s.png" % name))


def common_sheet(src, out, names):
    tiles = [[Image.open(os.path.join(src, "common_%s_%s.png" % (v, n))).convert("RGB")
              for v in ("side", "follow")] for n in names]
    w, h = tiles[0][0].size
    sheet = Image.new("RGB", (w * 2, h * len(names)), (255, 255, 255))
    for r, (row, n) in enumerate(zip(tiles, names)):
        for c, im in enumerate(row):
            sheet.paste(label(im, n if c == 0 else ""), (c * w, r * h))
    sheet.save(os.path.join(out, "all_common_scale.png"))


if __name__ == "__main__":
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else src
    os.makedirs(out, exist_ok=True)
    names = [n for n in ALL if os.path.exists(os.path.join(src, "%s_follow.png" % n))]
    for n in names:
        model_sheet(src, out, n)
    common_sheet(src, out, names)
