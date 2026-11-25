# Display backlight: set the brightness in percent

Status (2026-11-24): **not built.** Decided by the owner on 2026-11-24 in reply to manual
finding F4: RB-Avionics will provide a shell script that sets the display backlight in
percent. No HMI control is planned in this step.

## Problem

The RB-01 HMI, the daemon and the image have no brightness, dimming or day/night control.
What exists:

| Item | What it does | Where |
|---|---|---|
| `on.sh` / `off.sh` | Switch the whole `HDMI-A-1` output on or off with `wlr-randr`. No HMI page calls them, and they do nothing on a DSI panel | `image_build_rb/root/home/pi/on.sh`, `off.sh` |
| `globalStatus.NightMode` | Only stops the daemon lighting the Pi's green ACT LED | `main/gen_gdl90.go` |

A panel too bright at night, or too dim in sunlight, has no remedy on the unit today except
the panel's own buttons, where it has any.

## What to build

One script, installed in the image as `/home/pi/backlight.sh` (next to `on.sh` / `off.sh`):

```sh
backlight.sh <percent>     # 0..100, set and remember
backlight.sh               # print the current percent
backlight.sh restore       # apply the remembered value (called at boot)
```

Behaviour:

1. **Find the control.** In this order, and use the first that works:
   - **DSI panels** (Waveshare 6.25", `config-add-625.txt`): the kernel backlight class,
     `/sys/class/backlight/*/brightness` with its `max_brightness`. Write
     `round(percent × max_brightness / 100)`.
   - **HDMI panels with DDC/CI**: `ddcutil setvcp 10 <percent>` (VCP code 0x10, luminance).
     `ddcutil` is not in the image: add it to the package list if a supported panel needs it.
     Most small HDMI panels, the 480×480 round one included, may not answer DDC/CI: check
     with `ddcutil detect` on the actual panel.
   - **HDMI panels with a PWM backlight pin** wired to the Pi: `pwm-2chan` overlay or `pinctrl`
     on the chosen GPIO. Only if the panel has the pin and the harness carries it.
   - None of these: print `no backlight control on this panel` and exit 1.
2. **Clamp.** Never go to 0 % through this script: use a floor (for example 5 %) so a typo
   cannot leave a black panel in flight. `off.sh` stays the way to turn the panel off.
3. **Remember.** Write the percent to `/boot/firmware/rb/backlight.json`
   (`{"percent": 80}`). `/boot/firmware` is read-write on the image (the root filesystem is
   a read-only overlay), so the value survives a restart.
4. **Restore at boot.** Call `backlight.sh restore` from `rb-prestart.sh`, or from a small
   `rb-backlight.service` ordered before `wayfire.service`. A missing file means 100 %.
5. **Permissions.** The sysfs file is root-owned. Either run as root (from the service), or
   add a udev rule that gives group `video` write access, so the kiosk user `pi` can call it.

## Later, not in this step

- A Settings add-on slider or Switchboard key that calls the script through a daemon
  endpoint (for example `POST /setBacklight {"percent": n}`).
- Day/night presets, and automatic dimming from sunrise/sunset at the GPS position.
- A light sensor input (ambient light on I²C), if a panel or sensor board provides one.

## Test

- On each supported panel: `backlight.sh 100`, `50`, `5`, then `backlight.sh` reads back the
  value; restart and check the value is restored before the HMI shows.
- On an unsupported panel: exit 1 with the message, and no change to the display.
- `backlight.sh 0` and `backlight.sh 150` clamp to the floor and to 100.

## Manual wording until it ships

"RB-01 has no brightness control in the display software. Use the panel's own control, if
fitted."
