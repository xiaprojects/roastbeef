# OTA update: improvements

Status (2026-11-24): **open.** Opened by the owner on 2026-11-24 in reply to manual finding
F10 (no rollback) and question Q-01B-e9525 (update duration and display indication). The
installed software version on the OTA page is **done** (item 1).

## How it works today

1. The OTA page (`/RB-01/#/ota`) asks `GET /updates/available`. The daemon reads
   `/boot/firmware/rb/rb-cloud.json` (`device_id`, `base_url`, `authorization`), asks RB-Cloud
   for the component list, and compares each `version` with `/opt/stratux/<component>.version`
   (`main/ota.go`).
2. `INSTALL` / `UPDATE` posts the row to `POST /updates/install`. `ApplyUpdate` starts, with
   `nohup` in the background, `/opt/stratux/bin/update_script.sh <url> "systemctl stop stratux"
   "systemctl start stratux" <md5>`, logging to `/tmp/update-<component>.log`.
3. The page goes back to the home page (`#/`) at once.
4. `update_script.sh` downloads the tar with `curl`, checks the **MD5**, stops stratux,
   extracts the tar **over `/`**, clears the Chromium cache and starts stratux.

## Problems

| # | Problem | Effect | Source |
|---|---|---|---|
| O1 | **No rollback.** No copy of the replaced files, no A/B partition | A bad update leaves the unit broken until a previous package is applied again or the SD card is re-written | `update_script.sh:49-56` |
| O2 | **No indication while updating** (Q-01B-e9525). The page returns to home; the update runs in the background with no progress, no end message, no error | Stratux is stopped during the install, so **every instrument shows no data** until it restarts, with nothing saying why. A failure is visible only in `/tmp/update-*.log`, lost at restart | `ota.js` `installUpdate`; `ota.go` `ApplyUpdate` |
| O3 | **Duration unknown** (Q-01B-e9525) | The manual cannot tell the operator how long to wait. It depends on package size and link speed and was never measured | — |
| O4 | **No confirmation, usable in flight.** One touch starts an install that blanks the instruments | A stray touch in flight stops the avionics | `ota.html`; manual finding 3 |
| O5 | **`update_script.sh` is not installed where the daemon calls it.** `ApplyUpdate` runs `/opt/stratux/bin/update_script.sh`; the image has it in `/home/pi/`, and `make optinstall` does not copy it | `INSTALL` silently fails unless the script was copied by hand | `ota.go`; manual finding 2 |
| O6 | **Read-only root.** The image runs the root filesystem as an overlay (`raspi-config nonint do_overlayfs 0`). Files extracted over `/` with the overlay on land in the RAM upper layer | The update may be lost at the next restart: **to verify on a unit** (`overlayctl status` before and after) | `generate_rb_from_clean_sdcard.sh`; `image_build_rb/update.sh` |
| O7 | **MD5 only**, sent by the same server as the file | Detects a corrupt download, not a tampered one | `update_script.sh:27-36` |
| O8 | **The device key travels in the URL** (`?Authorization=…`) and is written to `/tmp/update-*.log` with the URL | The key ends up in logs and proxies | `ota.go` `FetchAvailableUpdates`, `ApplyUpdate` |
| O9 | The package is downloaded to the daemon's working directory (`update.tar.gz`, relative path) | Location depends on how the daemon was started | `update_script.sh` |

## What to build

1. **Show the installed version on the OTA page. Done 2026-11-24.** The page has an
   *Installed Software* panel with `Version <tag> (<build>)` from `GET /getStatus`
   (`web/RB-01/plates/ota.html`, `js/ota.js`). The operator compares it with the manual and
   with the GitHub release.
2. **Block in flight and confirm.** Refuse `POST /updates/install` while the aircraft is moving
   (GPS ground speed above the taxi limit, or `IndicatedAirSpeed` > 0), and ask for a
   confirmation on the page: "The instruments will stop for about N minutes. Install?".
3. **Progress and result.** `update_script.sh` writes its step to
   `/boot/firmware/rb/ota-status.json` (`downloading` with bytes, `verifying`, `installing`,
   `done`, `failed: <reason>`, the component and the times). The daemon serves it at
   `GET /updates/status`. Before stopping stratux, the script tells the kiosk to show a static
   page, `web/RB-01/updating.html`, served by a tiny fallback (or a local file), that polls the
   status and says **"Updating – do not switch off"**, then reloads `/RB-01` when stratux is
   back. Keep the last status after the restart so the OTA page can show "Last update: done /
   failed at …".
4. **Measure and publish the duration.** Log the time of each step in the status file; record
   the download and install times per component on the reference unit and on a 1 Mbit/s link,
   and put both in the manual (Q-01B-e9525). Download first, with the instruments still
   running, and stop stratux only for the extract and restart.
5. **Rollback.** Before extracting, list the package's files (`tar -tzf`) and save the files it
   replaces into `/boot/firmware/rb/ota-backup/<component>-<installed>.tgz` (or a dedicated
   partition). Keep the last one per component. Add `POST /updates/rollback` and a `ROLLBACK`
   button that restores it with the same status flow. After the restart, if stratux does not
   answer `/getStatus` within 60 s, the script restores the backup by itself.
   Longer term: an A/B root partition with `tryboot` (Raspberry Pi 5 bootloader supports it),
   which also covers a broken kernel or library.
6. **Install the script.** Copy `update_script.sh` to `/opt/stratux/bin/` in `make optinstall`
   and in the image script, mode 755 (fixes O5).
7. **Overlay.** Have the script write through the overlay (`overlayctl disable` for the
   install, or extract into `/media/root-ro` remounted read-write) and verify the result after
   a restart (fixes O6).
8. **SHA-256 and a signature.** Replace MD5 with SHA-256, and sign the package (minisign or
   GPG) with a key whose public half is in the image (fixes O7).
9. **Key out of the URL.** Send the device key in an `Authorization` header, and do not log
   the URL with it (fixes O8).
10. Download into `/tmp/ota/` or the boot partition with an absolute path (fixes O9), and
    check the free space against `size` before downloading.

## Manual wording until it ships (Q-01B-e9525)

"Install updates on the ground with the engine off. After pressing INSTALL or UPDATE the
display returns to the home page and the instruments stop showing data while the update is
installed. Wait until the data comes back; do not remove power. The duration depends on the
package size and the internet link. Check the result on the OTA page: the *Installed* column
shows the new number, and *Installed Software* shows the new version."
