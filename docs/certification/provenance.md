# Third-Party Artifact Provenance

Every component that ships on the device but is **not built from source in this
repository**, with its version, origin, licence and SHA-256. This is the seed of the
Software Configuration Index (roadmap Step 1.2 / Step 10) and the input to the
PDS/COTS section of the PSAC.

`make check` runs `scripts/provenance.sh --verify docs/certification/provenance.md`,
so replacing any of these files without updating this document fails CI. To update:

```sh
scripts/provenance.sh          # prints the hash table; paste it below
```

then fill in the new version and origin in the inventory table and record the
change in the commit message.

Status legend for "certified baseline": **core** = inside the first certified
configuration (roadmap Step 3 scoping); **out** = must be disabled or removed in
the certified configuration; **build** = build-time only, not on the device.

## Inventory

### Prebuilt binaries (no source in this repository)

| Component | Version / identification | Origin | Licence | Certified baseline | Notes |
|---|---|---|---|---|---|
| `ogn-rx-eu` (aarch64 / arm / x86) | Unversioned binaries; repo commit `dcf625b1` (2026-02-26, "bump ogn-rx-eu and ogn-tracker binaries") | OGN project (Pawel Jalocha), obtained via upstream stratux | Proprietary / OGN | **out** | 868 MHz OGN/FLARM receiver. No source, no version string (only `libjpeg-turbo 2.1.2` inside). Replace with a source-built receiver or scope OGN out. |
| OGN tracker firmware (`ogn-tracker-bin-*.zip`) | 7 board variants, same commit as above | OGN project | OGN | **out** | Flashed to an external T-Beam; not executed on the RB-01. |
| SoftRF firmware (`softrf/SoftRF.mb.esp32.zip`, `USB-flashing-ESP32.zip`) | Unversioned | SoftRF project (lyusupov) | GPL-3.0 | **out** | External ESP32 device firmware. |
| Raspberry Pi OS (Trixie, 64-bit Lite) | Recorded per image in `image_build/pi-gen` submodule (`2026-06-18-raspios-trixie-armhf`+8) | Raspberry Pi Foundation | Various (Debian) | **core, PDS** | Kernel, systemd, Chromium. Package list of the certified image to be captured at image build time (Step 1.2). |
| Chromium (kiosk browser for the HMI) | From the Raspberry Pi OS package set | Debian / Raspberry Pi | BSD-3 and others | **core, PDS** | Display path; see roadmap Step 7. |

### Submodules built from source (pinned by commit)

| Component | Commit | Origin | Licence | Certified baseline |
|---|---|---|---|---|
| `dump1090` | `0339a57b` (v11.1) | github.com/flightaware/dump1090 via stratux fork | GPL-2.0 | core (1090 ES receiver) |
| `rtl-ais` | `01b8c996` (v0.3-48) | github.com/dgiardini/rtl-ais via stratux fork | GPL-2.0 | out (AIS is Level E) |
| `ogn/ogn-tracker` | `7542eab1` | github.com/pjalocha/esp32-ogn-tracker | OGN | out |
| `image_build/pi-gen` | `6a0419c1` | github.com/RPi-Distro/pi-gen | BSD-3 | build |
| `dump978` (in-tree C, `libdump978.so`) | in-tree | github.com/mutability/dump978 (2015 lineage) | BSD-2 | core (978 UAT decoder) |

### Go modules

Pinned in `go.mod` / `go.sum`: **52 modules** (18 direct, 34 indirect), of which **18 are
linked into `stratuxrun`**. The remainder are build- or test-only and reach no certified
binary: `gonum.org/v1/plot` and its font/PDF chain serve the `test/` diagnostic tools,
`kellydunn/golang-geo` drags in unused SQL backends (`lib/pq`, `ziutek/mymysql`), and the
TinyGo/Windows paths under `tinygo.org/x/*` and `saltosystems/winrt-go` are not built for
the target. The `fancontrol` binary adds the `prometheus/client_golang` set; `stratuxrun`
does not contain it. Roadmap Step 1.2 adds `go mod vendor` so the sources are in the tree;
the SBOM per build comes from `go version -m stratuxrun`.

Modules with hardware or safety relevance: `xiaprojects/goflying` v1.1.1 (AHRS/IMU drivers,
fork), `kidoman/embd` (I²C, unmaintained since 2017), `xiaprojects/serial` (GPS/NMEA
serial), `mattn/go-sqlite3` (flight log), `gorilla/websocket` (HMI transport). Upstream
`github.com/stratux/stratux` is **no longer a dependency**: six `test/` tools imported its
copies of `uatparse`/`godump978`/`sensors/bmp388` instead of this fork's own packages, which
pulled the whole upstream tree (and a stale `tarm/serial`) into the module graph.

### Build toolchain (`Dockerfile`, build-time only)

| Component | Version / identification | Origin | Pinned by | Notes |
|---|---|---|---|---|
| Base image | `debian:trixie` | Debian | **[pending]** floating tag | Pin by digest for a reproducible builder (see `scmp.md`). |
| Go compiler | 1.27.3, `go1.27.3.linux-arm64.tar.gz` | go.dev | `ARG GO_VERSION` + `ARG GO_SHA256` verified with `sha256sum -c` | SHA-256 `a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49`. `GOTOOLCHAIN=local` keeps this compiler authoritative, so a `go.mod` that outgrows it fails the build instead of silently downloading another toolchain. Debian's `golang-go` is deliberately not used: Trixie ships Go 1.24 with `GOTOOLCHAIN=local` patched in, which cannot build `go 1.27` (nor `golang.org/x/exp`, which needs >= 1.26). |
| `librtlsdr0` / `librtlsdr-dev` | 2.0.2-2 arm64 `.deb` | github.com/stratux/rtlsdr release v1.0 | URL only, **[pending]** no checksum | Fetched with `wget` at image build. |
| gcc, make, git, ncurses-dev, libusb-1.0-0-dev, python3 | Debian Trixie package set | Debian | **[pending]** unversioned `apt-get install` | Capture the package list of the builder image alongside the device image (Step 1.2). |

### Vendored web libraries (served to the HMI)

Two web trees ship (`web/Makefile` copies both): the legacy UI under `web/`, and the RB-01
display under `web/RB-01/`, which loads its own copies from `web/RB-01/maui/js/`, `js/`,
`css/` and `synthview/`. Both sets are hashed. The RB-01 copies are byte-identical to the
`web/` ones unless the Notes column says otherwise. Three.js exists only in the RB-01 tree;
flight-indicators, NoSleep.js and addtohomescreen only in the legacy one.

| Component | Version | Origin | Licence | Certified baseline | Notes |
|---|---|---|---|---|---|
| AngularJS (`web/maui/js/angular*.js`, `web/RB-01/maui/js/angular*.js`) | 1.4.6 (2015) | angularjs.org | MIT | **core, PDS** | EOL since Dec 2021; see `docs/tech-debt/modernization.md`. RB-01 copies differ only in line endings (CRLF). |
| angular-ui-router | 0.2.15 | github.com/angular-ui/ui-router | MIT | core, PDS | Plate navigation. RB-01 copies differ only in line endings (CRLF). |
| Mobile Angular UI (`mobile-angular-ui*.js`, incl. FastClick) | not stated in file (1.3.x lineage) | github.com/mcasimir/mobile-angular-ui | MIT | core, PDS | Version to be pinned from upstream diff. RB-01 copies have CRLF line endings, and **`web/RB-01/maui/js/mobile-angular-ui.js` is locally modified** (282b525e): in the `sidebarLeft`/`sidebarRight` directives the outer-click callback no longer calls `SharedState.turnOff`, so a sidebar stays open when the pilot taps outside it, and logs `outerClickCb` to the console instead. |
| OpenLayers (`web/js/ol.js`, `web/css/ol.css`) | 6.9.0 | openlayers.org | BSD-2 | second baseline (map) | |
| ol-mapbox-style (`web/js/olms.js`) | not stated | github.com/openlayers/ol-mapbox-style | BSD-2 | second baseline | |
| ol-layerswitcher (`web/js/ol-layerswitcher.js`, `.css`) | not stated | github.com/walkermatt/ol-layerswitcher | MIT | second baseline | |
| Three.js (`web/RB-01/synthview/three.min.js`) | r136 (2021) | threejs.org | MIT | second baseline (synthetic vision) | |
| Three.js examples: `GLTFLoader.js`, `OrbitControls.js`, `FontLoader.js`, `TextGeometry.js` | r136 examples/js | threejs.org | MIT | second baseline | |
| Chart.js (`web/js/chart.js`) | 4.4.1 | chartjs.org | MIT | out (charts plate is Level E) | |
| svg.js (`web/js/svg.min.js`) | 2.7.1 | svgjs.dev | MIT | core (instrument drawing) | |
| flight-indicators (`web/js/flight-indicators.js`, `.css`) | Teocci, 2021-11-04 | github.com/teocci | not stated in file | core (six-pack) | Licence to be confirmed and recorded. |
| NoSleep.js (`web/js/NoSleep.min.js`) | 0.5.0 | github.com/richtr/NoSleep.js | MIT | out | Legacy UI only. |
| addtohomescreen (`web/js/addtohomescreen.min.js`, `.css`) | not stated | github.com/cubiq/add-to-homescreen | MIT | out | Legacy UI only. |
| GPXParser (`web/js/GPXParser.js`) | not stated | github.com/Luuka/GPXParser.js | MIT | out (flight-plan import, Level E) | |

### Hardware and vendor firmware

**[pending]** — tracked in `hardware/bom.md` (roadmap Step 8), not here: compute board part
number and revision, SoC stepping, bootloader/EEPROM version, RP1 and PMIC firmware, display
and sensor module part numbers. AMC 20-152A Objective COTS-4 makes vendor microcode a
configuration item; see `hardware/platform-assessment.md` (derogations D-4, D-10).

### Data sets

| Data | Origin | Certified baseline | Notes |
|---|---|---|---|
| `ogn/ddb.json` (OGN device database) | ddb.glidernet.org, fetched at build (`ogn/fetch_ddb.sh`), fallback `ddb.json.copy` | out | Not deterministic at build time — pin to the copy for a certified build. |
| `web/settings/elevations.json` (terrain) | To be documented (SRTM-derived) | second baseline | DO-200B/DO-276 chain, roadmap Step 9.2. |
| `web/settings/deviation.json`, `web/settings/databases/deviations/*.json` (magnetic declination: Europe, USA, Canada) | Generated by `scripts/gen_deviation.py` from WMM2025 (`WMM.COF`, NOAA NCEI / BGS, public domain, ncei.noaa.gov/products/world-magnetic-model) | second baseline | Deterministic from the coefficient file; the generator checks itself against the NOAA `WMM2025_TestValues.txt` (`--test`). Valid 2025.0–2030.0, regenerate for WMM2030. |
| `mapdata/`, airfields, OpenAIP-style resources | To be documented | second baseline | DO-200B, Step 9.2. |
| `web/RB-01/synthview/helvetiker_regular.typeface.json` | Three.js examples font | second baseline | |

## Hashes

Generated by `scripts/provenance.sh`; verified by `make check`.

| File | SHA-256 |
|---|---|
| `ogn/ogn-rx-eu_aarch64` | `878cc245427b422571de366973ea8db2fd5b9a9d34521bf988491eb25dac81e1` |
| `ogn/ogn-rx-eu_arm` | `6917ad1d1f515b50763a888e8af32d698e800abf865d9e14a10e526e2bd78fea` |
| `ogn/ogn-rx-eu_x86` | `a38b08bd5737543e66052d32f13237c45ba8f2a777e89f294c7899fc30ae6fe5` |
| `ogn/ogn-tracker-bin-tbeam07-sx1276.zip` | `199a0ae15fa8394cf72fc6ca4dd0b493ae9674f722ed4b0be1e1f0dc46f21f8a` |
| `ogn/ogn-tracker-bin-tbeam10-sx1262.zip` | `7114354c7c81012e92e96d565764178e7b956d6bf01076a7fd36530a5d74a2e8` |
| `ogn/ogn-tracker-bin-tbeam10-sx1276.zip` | `4d2597f8819979130944d7f7cfdfcc1e06440ecead16f835657c78dd88229f6c` |
| `ogn/ogn-tracker-bin-tbeam12-sx1262.zip` | `36d09e2e086b53b537bc674a4427e56f4b8c32a1215bb189758f479dc81809ca` |
| `ogn/ogn-tracker-bin-tbeam12-sx1276.zip` | `0c38c723cb62680dcdb7c2a61bbd5dc9edb2d1bd9ffc807b3cfabf5ebed6e196` |
| `ogn/ogn-tracker-bin-tbeams3-sx1262-mtk.zip` | `5e2ba52e4f8cf049d1345068119043aa8fc3c769ceafa5adae34e977c8c68b13` |
| `ogn/ogn-tracker-bin-tbeams3-sx1262-ubx.zip` | `1aa0da7c3ca42e27e01d6ea1afa4b90ee5be986a73ca19a9bd5de1d90a3ca66e` |
| `softrf/SoftRF.mb.esp32.zip` | `7c15aa7af60b445c40890769207ebbdca1693aaf38806148c129c5961b727589` |
| `softrf/USB-flashing-ESP32.zip` | `cb82f65fac8fc67e9a0e8af20c1e51575f524e39731068117004effebdd84485` |
| `web/maui/js/angular.min.js` | `4489225195cb3347d8060c602814823e717196edfba20b8761ef7a73db7e1c08` |
| `web/maui/js/angular.js` | `2927fafbcdad931bca3d1ff4f75eb098484eb7dd4bc3c50571392167ceaac06a` |
| `web/maui/js/angular-ui-router.min.js` | `caa3d73a4067cf98ff271cc9ce5c826f7dadf8afe4df67be2330133f872c73e8` |
| `web/maui/js/angular-ui-router.js` | `9bb5972d8f0db82a9ea460c974a3c6758a35864c625e6d26952a1a80d0c20138` |
| `web/maui/js/mobile-angular-ui.min.js` | `14545825752d8726ebe72a59681322158dc3d7001ea07ab2bab0aa113e339e85` |
| `web/maui/js/mobile-angular-ui.js` | `7406f6d14bf90dac3b5a283ed1a789a9614b04648cb455b8ce1ed11c74238c6e` |
| `web/maui/js/mobile-angular-ui.core.min.js` | `1e98cda9d3f855c91cad0cde35cd7753bef09543f1d85ac90a10140a9c71c939` |
| `web/maui/js/mobile-angular-ui.core.js` | `1889cda707d32778aefb038e3f8680be85e23470e1732c6fac1cb0bd967cbdd5` |
| `web/maui/js/mobile-angular-ui.gestures.min.js` | `b17f815e4c46dffca5534c796640fe6a17086a66aaa29632887fe6c8b213ba3b` |
| `web/maui/js/mobile-angular-ui.gestures.js` | `fead562c6d99b50d3fc5637dd972432d56a8fb3f975296df5b232f4e03d63e3f` |
| `web/js/ol.js` | `efb7688143d9d565682bd0431740b1b0a9c0a2e5f76332ba9f8b4871b0e0b452` |
| `web/js/olms.js` | `41e017e1f379c44cde8367b7fa3d96d02081ede2b1ff3f66031bdcebca6dc75f` |
| `web/js/ol-layerswitcher.js` | `f3e199998c08a3a319343c29bebbcb11b5cb5cfd96ca12dfb81ebcc74b1eb900` |
| `web/js/chart.js` | `d2af8974e95271638772e9e9524db5b9a6f58d6ec2d5d781400447b4a31c681e` |
| `web/js/svg.min.js` | `0d2015814bb3e985ccee950ebe7f8b738d0493a716bc1802054d63b31ef60ea8` |
| `web/js/NoSleep.min.js` | `84bc0af4520ec8f6f6a401f9f64b085decd24dae961c1a4a22c01b2d820ddadf` |
| `web/js/addtohomescreen.min.js` | `bfe7c663e87c9dc70be6b0f02351ba6769cef07bc9fa81574242b583e8f4ee6b` |
| `web/js/flight-indicators.js` | `b23f80c81c5135ce96ecd89a3b95512cc5f27f258880e1a33ff57da377f11f0c` |
| `web/js/GPXParser.js` | `70959361c26fd3d613d0509b3223a685e4baa5d1b39e3b7fe02d09113082d934` |
| `web/css/ol.css` | `8dc90f664eba109ac40505e7279402d9b0fe1b158f0d1555a0c1abe6facc66f3` |
| `web/css/ol-layerswitcher.css` | `734ee9b221964f38af15ef61dd7539313927c6c083cd136ccfea12d0295c660d` |
| `web/css/flight-indicators.css` | `4dd5468048e7e8650ca05f3167a1c3e802235f7150bbe4afa9d88d7de2898be5` |
| `web/css/addtohomescreen.css` | `a768e035c759ac8f34eeff1943146a2d2025ee4df3ccba482cd8d68addcefdb5` |
| `web/RB-01/maui/js/angular.min.js` | `6ef82bfa3ccf5eddbcf08a4117d6af932aac88b3b2c93b2afcc43f4b11deb967` |
| `web/RB-01/maui/js/angular.js` | `1e0def47508c4d7d8a9dd74ea29755b65bba2a46a782dd75d40a38877be54ac5` |
| `web/RB-01/maui/js/angular-ui-router.min.js` | `0c284abba2aa3c2d7e4cac53e27feb5836cb6f733111e88934e2e13df8c66aab` |
| `web/RB-01/maui/js/angular-ui-router.js` | `ed865c6f59ed6e35ba26a1d85c2a65204fa85455053544f469324dcbec6ebaf2` |
| `web/RB-01/maui/js/mobile-angular-ui.min.js` | `09df4d6010798aeeddc166dd15146881f3623639fd7bac34d5b27d4f01aa612a` |
| `web/RB-01/maui/js/mobile-angular-ui.js` | `bbac6d13397d06c9119fef2db4b951b8bdf7306536472d44b432f8a131a1a20e` |
| `web/RB-01/maui/js/mobile-angular-ui.core.min.js` | `06bac4c3c96e2f9def0c80e05c0a55c78670603e2223b4ae6eab3bea1b139954` |
| `web/RB-01/maui/js/mobile-angular-ui.core.js` | `5ae09045059d64c21cb028808da632c9d2b653fd711e734248d9616c2f7a205c` |
| `web/RB-01/maui/js/mobile-angular-ui.gestures.min.js` | `beb6002dfb15694e2ff8e2ce4a944e90a7d5cc1574099b46de65300a0b0a9e3c` |
| `web/RB-01/maui/js/mobile-angular-ui.gestures.js` | `860249f37225040565850550628a4b31a7f0efa8fb9d97503b86f270a3c55357` |
| `web/RB-01/js/ol.js` | `efb7688143d9d565682bd0431740b1b0a9c0a2e5f76332ba9f8b4871b0e0b452` |
| `web/RB-01/js/olms.js` | `41e017e1f379c44cde8367b7fa3d96d02081ede2b1ff3f66031bdcebca6dc75f` |
| `web/RB-01/js/ol-layerswitcher.js` | `f3e199998c08a3a319343c29bebbcb11b5cb5cfd96ca12dfb81ebcc74b1eb900` |
| `web/RB-01/js/chart.js` | `d2af8974e95271638772e9e9524db5b9a6f58d6ec2d5d781400447b4a31c681e` |
| `web/RB-01/js/svg.min.js` | `0d2015814bb3e985ccee950ebe7f8b738d0493a716bc1802054d63b31ef60ea8` |
| `web/RB-01/js/GPXParser.js` | `70959361c26fd3d613d0509b3223a685e4baa5d1b39e3b7fe02d09113082d934` |
| `web/RB-01/synthview/three.min.js` | `404ac94a7c76637465730ffc01c99f818065af5797f34b2f604c9ca29af35182` |
| `web/RB-01/synthview/GLTFLoader.js` | `b2edda923572c73e6b30b139756d182c87e2c34d022845c6e067a9a0a9544e01` |
| `web/RB-01/synthview/OrbitControls.js` | `84e74621b76f7c063dd04dfa6aa8d09b55c8b1c774532ebe0edbe0ce778bab85` |
| `web/RB-01/synthview/FontLoader.js` | `b3afff765c1deb35b1b9a6fe3e9a8042b7b602f19edb7591fdcccf595faae126` |
| `web/RB-01/synthview/TextGeometry.js` | `c4cb3d2123f60d7037b1b74c69a0ac98cdd9fff1ff8c61e74484f428f7002957` |
| `web/RB-01/css/ol.css` | `8dc90f664eba109ac40505e7279402d9b0fe1b158f0d1555a0c1abe6facc66f3` |
| `web/RB-01/css/ol-layerswitcher.css` | `734ee9b221964f38af15ef61dd7539313927c6c083cd136ccfea12d0295c660d` |
