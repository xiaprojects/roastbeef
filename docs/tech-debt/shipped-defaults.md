# Defaults that disagree with "shipped enabled" in 2.4.1

## Problem
The maintainer's statement for RB-01 2.4.1 (2026-11-12) is that the SD image ships with every
feature enabled except the glideslope: the ILS localizer, the spoken terrain announcements
and the pitot sensor among them. The defaults in the code say otherwise in several places.
Nothing in this repository (`image_build/`, `debian/`) carries a settings file that turns
them on, so either the image sets them in its own `stratux.conf` and boot-partition configs,
or the defaults must change before the re-tag. Checked on 2026-11-12 against the working
trees.

| Setting | Repository | Default in code | Notes |
|---|---|---|---|
| `Terrain_Enabled` | roastbeef | ~~`false`~~ `true` since 2026-11-24 | `main/gen_gdl90.go` `defaultSettings()`. Off, it also blanks the AGL slot of the top bar (`---`). **Resolved** |
| `Terrain_Alerts_Enabled` | roastbeef | ~~`false`~~ `true` since 2026-11-24 | Same place. Tested by the owner and turned on. **Resolved** |
| `Audio_Enabled` | roastbeef | `false` | The daemon plays alert sounds through `aplay` only with it on, so spoken terrain alerts need it; the display plays its own copy |
| `MS4525DO_Enabled` | roastbeef | `false` | `defaultSettings()`. The comment on the field in `gen_gdl90.go` says "default: true", and `docs/hardware/sensors.md` says there is no enable setting: three statements, two of them wrong. The settings page switch is new in the working tree |
| `Radio_Enabled` | roastbeef | `false` | The SDR radio is not driven until it is on |
| `Autopilot_Enabled`, `AutopilotUdp_Enabled` | roastbeef | `false` | The guidance and VNAV output need them |
| `SwitchBoard_Enabled` | roastbeef | `false` | The bottom bar's SWITCH key opens the plate either way |
| `Keypad_Enabled` | roastbeef | `false` | `main/keypad.go` reads a USB keypad only with it on |
| `loc.enabled` | rb-vor | `false` in `rbvor/config.py` `LOC_DEFAULTS`; `true` in the committed `config/rb-vor.json`; `false` again in the uncommitted working tree | The CHANGELOG says "shipped disabled" until a real localizer is decoded (plan L7, open item O23). Also, this repository's `ota/create_ota_package.sh` leaves `rb-vor.json` out of the package, so an OTA update does not change an existing unit's value |
| `audio.device` | rb-sdr-radio | `""` (no sound card) | With it empty the radio records but plays nothing. Right for a Pi 5 without a sound card; an image with one must set it, shared with rbvoice through a `dmix` device |
| `demod.noise_reduction_db`, `demod.detector` | rb-sdr-radio | `0` (off), `envelope` | Options by design, off until tried on air; the voice-band filter itself is always on |
| Voice language | rbvoice | Italian: `rbvoice.sh` takes the last language block | The voice models are installed by the builder for their language (`make vosk-model`, `make piper-model`) |

Open terrain-alert items are not repeated here: `terrain-alerts.md` lists them under
"Not built yet", "Known limits found", "Next" and "Open questions, risks and regulatory
notes". Its status line was updated on 2026-11-24, when the owner turned both terrain
defaults on.

## Proposal
1. Decide, setting by setting, whether the default changes in code or the image sets it, and
   write the decision here.
2. For the image route, put the settings file in `image_build/` so that the shipped values
   are reviewed with the code, and let an OTA update leave a pilot's own choice alone.
3. Align the text with the code: the `MS4525DO_Enabled` comment, `docs/hardware/sensors.md`,
   `docs/settings-reference.md` for the terrain settings, and the rb-vor CHANGELOG.
4. For the terrain announcements, update the status line of `terrain-alerts.md` with what
   was decided about its release gates before the default changes.

## Done when
- Every row above has a decision and the code, the image and the docs agree with it.
- A fresh image, booted with no prior settings, shows the localizer, the terrain
  announcements and the pitot sensor working as the release notes say.
