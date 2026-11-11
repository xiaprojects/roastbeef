#!/bin/sh
# Rebuild and check the synthetic-view aircraft models.
#   tools/synthview-models/rebuild.sh [RENDER_DIR]
# The reduced models need tools/synthview-models/sources/ (not in git, see README.md).
set -e
cd "$(dirname "$0")"
blender -b -P build.py
blender -b -P reduce.py
python3 check.py
if [ -n "$1" ]; then
	blender -b -P render.py -- "$(realpath "$1")"
	python3 sheet.py "$(realpath "$1")"
fi
