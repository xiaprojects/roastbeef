#!/bin/bash
# Third-party artifact inventory: prints (or verifies) SHA-256 of every prebuilt
# binary and vendored library that ships in the image but is not built from
# source in this repository. See docs/certification/provenance.md.
#
#   scripts/provenance.sh                 print the hash table (markdown)
#   scripts/provenance.sh --verify FILE   fail if any hash differs from FILE
set -e
cd "$(dirname "$0")/.."

FILES="
ogn/ogn-rx-eu_aarch64
ogn/ogn-rx-eu_arm
ogn/ogn-rx-eu_x86
ogn/ogn-tracker-bin-tbeam07-sx1276.zip
ogn/ogn-tracker-bin-tbeam10-sx1262.zip
ogn/ogn-tracker-bin-tbeam10-sx1276.zip
ogn/ogn-tracker-bin-tbeam12-sx1262.zip
ogn/ogn-tracker-bin-tbeam12-sx1276.zip
ogn/ogn-tracker-bin-tbeams3-sx1262-mtk.zip
ogn/ogn-tracker-bin-tbeams3-sx1262-ubx.zip
softrf/SoftRF.mb.esp32.zip
softrf/USB-flashing-ESP32.zip
web/maui/js/angular.min.js
web/maui/js/angular.js
web/maui/js/angular-ui-router.min.js
web/maui/js/angular-ui-router.js
web/maui/js/mobile-angular-ui.min.js
web/maui/js/mobile-angular-ui.js
web/maui/js/mobile-angular-ui.core.min.js
web/maui/js/mobile-angular-ui.core.js
web/maui/js/mobile-angular-ui.gestures.min.js
web/maui/js/mobile-angular-ui.gestures.js
web/js/ol.js
web/js/olms.js
web/js/ol-layerswitcher.js
web/js/chart.js
web/js/svg.min.js
web/js/NoSleep.min.js
web/js/addtohomescreen.min.js
web/js/flight-indicators.js
web/js/GPXParser.js
web/synthview/three.min.js
web/synthview/GLTFLoader.js
web/synthview/OrbitControls.js
web/synthview/FontLoader.js
web/synthview/TextGeometry.js
web/css/ol.css
web/css/ol-layerswitcher.css
web/css/flight-indicators.css
web/css/addtohomescreen.css
"

table() {
	echo "| File | SHA-256 |"
	echo "|---|---|"
	for f in $FILES; do
		if [ ! -f "$f" ]; then
			echo "missing: $f" >&2
			exit 1
		fi
		echo "| \`$f\` | \`$(sha256sum "$f" | cut -d' ' -f1)\` |"
	done
}

if [ "$1" = "--verify" ]; then
	doc="$2"
	[ -f "$doc" ] || { echo "provenance: no such file $doc" >&2; exit 1; }
	want="$(grep -E '^\| `[^`]+` \| `[0-9a-f]{64}` \|$' "$doc" | sort)"
	have="$(table | grep -E '^\| `' | sort)"
	if [ "$want" != "$have" ]; then
		echo "provenance: hashes in $doc do not match the tree. Diff (doc vs tree):" >&2
		diff <(echo "$want") <(echo "$have") >&2 || true
		echo "If the change is intended, update the doc: scripts/provenance.sh > hashes and paste, then record the new version and origin." >&2
		exit 1
	fi
	echo "provenance: $(echo "$have" | wc -l) artifacts match $doc"
else
	table
fi
