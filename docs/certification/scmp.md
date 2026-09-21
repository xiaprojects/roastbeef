# Software Configuration Management Plan (SCMP)

Roadmap Step 1 deliverable (`docs/certification/roadmap.md`). DO-178C §7 and Table A-8.
Written to describe the mechanisms that exist in this repository; where a mechanism is
not in place yet it is marked **[pending]** with the action that closes it.

Status: draft 2026-09-14. Applies to: `stratuxrun`, `fancontrol`, `libdump978.so`, the RB-01
HMI (`web/`), the Debian package and the SD-card image.

## 1. Configuration identification (A-8 obj. 1)

| Configuration item | Identified by | Where |
|---|---|---|
| Source tree | git commit SHA; release tags `vMAJOR.MINOR` | github.com/xiaprojects/roastbeef |
| Submodules (`dump1090`, `rtl-ais`, `ogn/ogn-tracker`, `image_build/pi-gen`) | commit pinned in the superproject | `.gitmodules`, `git submodule status` |
| Go dependencies | `go.mod` + `go.sum` (module path, version, hash) | repo root. **[pending]** `go mod vendor` so sources are in the tree |
| Prebuilt binaries and vendored web libraries | version + SHA-256 | `docs/certification/provenance.md`, verified by `make check` |
| Build toolchain | `Dockerfile` (Debian trixie, distro `golang-go`, librtlsdr from stratux/rtlsdr v1.0) | **[pending]** pin the base image by digest and the Go version explicitly |
| Executable | `Version` = latest tag (`scripts/getversion.sh`); `Build` = commit SHA, `-dirty` suffix when built from a modified tree | `Makefile` (`LFLAGS`), shown in the log at start-up, `/getStatus`, RB-01 OTA screen |
| Debian package | `stratux-<version>-<arch>.deb`, built by CI on every push to `master` | `.github/workflows/ci.yml` |
| SD-card image | produced by `release.yml` on tag push | GitHub release (draft) |
| OS package set of the image | **[pending]** capture `dpkg -l` at image build time into the release assets | `image_build/`, `image_build_rb/` |

A **certification baseline** is a tag of the form `vX.Y-cert-base` (first one:
**[pending]** tag the current `master` once the working tree is clean) from which every
later certification artifact is measured.

## 2. Baselines and traceability (A-8 obj. 2)

- Every change is a commit on a branch, merged to `master` through a pull request.
- Every commit message references the GitHub issue it implements or fixes (`#NNN`).
  Issues are the change requests; the problem-report form
  (`.github/ISSUE_TEMPLATE/problem-report.yml`) carries version found / fixed, affected
  function, severity and safety relevance.
- Merges from upstream `stratux/stratux` are treated as change requests: a PR whose
  description lists the upstream commits and the affected functions (DO-178C §12.1.1
  change impact analysis, informal at this stage).
- Requirements ↔ code ↔ test traceability arrives with roadmap Step 4/5; until then the
  issue number is the trace key.

## 3. Problem reporting, change control, change review, status accounting (A-8 obj. 3)

- **Problem reports** are GitHub issues with label `problem-report`, classified on entry
  (severity 1–3, safety-related flag). Severity 1 or safety-related problems are triaged
  before any other work and get an entry in the release notes even if not fixed.
- **Change control**: **[pending]** GitHub branch protection on `master` — require a PR,
  require the `check` and `build` jobs (and `display-tests.yml` when it runs) to pass,
  no force-push, no direct push. Until then the rule is procedural.
- **Change review**: the PR review. The reviewer checks the standards checklist
  (roadmap Step 2, **[pending]**) and that the issue is referenced.
- **Status accounting**: the issue tracker itself (open/closed, `Version fixed` field);
  release notes list fixed problem reports per version.

## 4. Archive, retrieval and release (A-8 obj. 4)

- Release artefacts (`.deb`, image) are attached to the GitHub release created by
  `release.yml`; the CI `.deb` is retained as a workflow artefact.
- **[pending]** Off-GitHub archive: a bare mirror (`git clone --mirror` including
  submodules), the build container image (`docker save`), and every released `.deb`/image
  with its SHA-256, on storage owned by the project. Restore is tested once per year:
  rebuild a released version from the archive alone and compare the `.deb` hash.
- Reproducibility: `make ddpkg` in the pinned container. **[pending]** verify two builds of
  the same commit yield byte-identical `.deb` contents (timestamps in `dpkg-deb` and Go
  build IDs are the usual culprits — `SOURCE_DATE_EPOCH` and `-trimpath`).

## 5. Software load control (A-8 obj. 5)

- Installed software is identified on the device by `Version` and `Build`
  (`/getStatus`, OTA screen). Field reports must quote both.
- OTA (`main/ota.go`) currently verifies an MD5 checksum only. **[pending]** sign release
  packages (minisign or GPG) and verify the signature before installing; refuse unsigned
  packages in the certified configuration.
- **[pending]** installation record: which unit (serial) runs which version — a table
  maintained per delivered unit.

## 6. Life-cycle environment control (A-8 obj. 6)

- Build and static-analysis run inside the container defined by `Dockerfile` /
  `docker-compose.yaml` (`make ddpkg`, `make check` in CI).
- HMI tests need only Python 3 and a Chromium; `display-tests.yml` uses the stock GitHub
  runner's Chrome and prints its version in the job log.
- Editor/IDE settings are not configuration items.

## 7. Roles

Single maintainer today. Configuration management is performed by the maintainer;
independence for SQA (roadmap Step 6) is provided by a second person to be named in
the SQAP.

## 8. Open actions from this plan

| # | Action | Roadmap item |
|---|---|---|
| 1 | Tag `v2.0-cert-base` on a clean tree | 1.1 |
| 2 | `go mod vendor`; pin container base image by digest and Go version | 1.2 |
| 3 | Capture the OS package list into release assets | 1.2 |
| 4 | Branch protection on `master` requiring `check`, `build`, `display-tests` | 1.4 |
| 5 | Off-GitHub archive + yearly restore test | 1.5 |
| 6 | Byte-reproducible `.deb` | 1.3 |
| 7 | Signed OTA packages | 1.6 |
| 8 | Per-unit installation record | 1.6 |
