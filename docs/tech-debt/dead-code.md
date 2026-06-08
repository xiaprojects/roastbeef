# Dead Code Audit

This document records the results of a dead-code sweep across the stratux
codebase. "Dead code" here means functions, methods, types, constants, global
variables, and struct fields that are defined but never referenced anywhere in
the repository (accounting for cross-language references such as JSON tags,
HTML template bindings, and the cgo layer).

The audit was performed by reference analysis (repo-wide grep, plus the Go
`deadcode` tool where it could build). Each finding lists a confidence level.
Nothing in this audit has been removed yet — it is a backlog of candidates for
cleanup. **Before deleting any exported symbol, confirm it is not part of an
intended public/API surface.**

Last updated: 2026-06-06.

## dump978/ (C)

| Location                 | Symbol                        | Notes                                                                          | Confidence |
| ------------------------ | ----------------------------- | ------------------------------------------------------------------------------ | ---------- |
| `dump978/dump978.c:297`  | `check_sync_word()`           | Global function, forward-declared but never called anywhere.                   | High       |
| `dump978/dump978.c:73`   | `userCB` (static var)         | Only used in the `BUILD_LIB` `#else` path; dead in the default `main()` build. | Medium     |
| `dump978/uat2json.c:304` | `//uat_display_adsb_mdb(...)` | Commented-out call.                                                            | High       |

Not dead, but a code smell worth a follow-up: `make_atan2_table` and
`read_from_stdin` in `dump978.c` are forward-declared `static` but defined
non-`static`. Both are actually used.

## Go support packages

`common/`, `uatparse/`, `godump978/`, `sensors/bmp388/`.

### High confidence — zero references repo-wide

| Location                         | Symbol           | Kind       |
| -------------------------------- | ---------------- | ---------- |
| `common/equations.go:288`        | `DistRectNorth`  | func       |
| `common/equations.go:298`        | `DistRectEast`   | func       |
| `common/equations.go:343`        | `IMin`           | func       |
| `common/equations.go:350`        | `IMax`           | func       |
| `uatparse/uatdata.go:6`          | `UATMSG_TEXT`    | const      |
| `uatparse/uatdata.go:7`          | `UATMSG_NEXRAD`  | const      |
| `uatparse/uatdata.go:8`          | `UATMSG_AIRMET`  | const      |
| `uatparse/uatdata.go:11`         | `AIRMET_POLYGON` | const      |
| `uatparse/uatdata.go:12`         | `AIRMET_ELLIPSE` | const      |
| `uatparse/uatdata.go:13`         | `AIRMET_PRISM`   | const      |
| `uatparse/uatdata.go:14`         | `AIRMET_3D`      | const      |
| `uatparse/uatdata.go:24`         | `UATAirmet`      | type       |
| `uatparse/uatdata.go:28`         | `UATMsgDecoded`  | type       |
| `godump978/godump978.go:40`      | `PackageVersion` | var        |
| `godump978/godump978.go:45`      | `UserCbT`        | type alias |
| `sensors/bmp388/bmp388.go:17`    | `errSoftReset`   | var        |
| `sensors/bmp388/registers.go:27` | `DRDYPress`      | const      |
| `sensors/bmp388/registers.go:28` | `DRDYTemp`       | const      |

These are exported from internal `main`-module packages (not a published
library), so unreferenced exports are very likely safe to remove.

### Medium confidence — `uatparse/uatparse.go` struct fields

| Location                  | Field          | Notes                                                     |
| ------------------------- | -------------- | --------------------------------------------------------- |
| `uatparse/uatparse.go:50` | `a_f`          | Never read.                                               |
| `uatparse/uatparse.go:51` | `g_f`          | Never read.                                               |
| `uatparse/uatparse.go:52` | `p_f`          | Never read.                                               |
| `uatparse/uatparse.go:53` | `s_f`          | Written `= true` at :171, never read (has a TODO).        |
| `uatparse/uatparse.go:34` | `FISB_month`   | Read only by `test/getairmet.go`, not by production code. |
| `uatparse/uatparse.go:35` | `FISB_day`     | Read only by `test/getairmet.go`, not by production code. |
| `uatparse/uatparse.go:38` | `FISB_seconds` | Read only by `test/getairmet.go`, not by production code. |

## Web JS frontend

`web/js/main.js`, `web/plates/js/*.js` (third-party libraries excluded).
Cross-referenced against the AngularJS HTML templates so template-bound
functions are not falsely flagged.

| Location                         | Symbol                      | Notes                                                                                         | Confidence |
| -------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- | ---------- |
| `web/plates/js/developer.js:107` | `webUIRefresh()`            | `$scope` method, no template/JS callers.                                                      | High       |
| `web/plates/js/settings.js:468`  | `pongUpdateRun()`           | Broken/orphaned (references undefined `inputfile`); template uses `uploadPongFile()` instead. | High       |
| `web/plates/js/status.js:336`    | `GetDeveloperModeClick()`   | `$scope` method, no callers.                                                                  | High       |
| `web/plates/js/map.js:378`       | `aircraft.posHistroy = ...` | Typo'd property assignment (`posHistroy` vs `posHistory`); written, never read.               | Medium     |

## Go main/ package

A manual sweep of 300+ unexported functions, methods, types, globals, and
constants found **no definitive dead code**. Logging, parsers, network/sensor
functions, connection-type methods, and reflection-used marshal functions are
all referenced.

Caveat: this verdict is from manual reference analysis, not a static analyzer —
the Go `deadcode` tool could not run because of unsatisfied cgo dependencies.
For higher assurance, get `go run golang.org/x/tools/cmd/deadcode ./...`
building once the cgo deps are satisfied.
