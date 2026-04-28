#!/bin/bash
export WAYLAND_DISPLAY=wayland-1
export XDG_SESSION_CLASS=user
export XDG_SESSION_ID=1
export XDG_RUNTIME_DIR=/run/user/1000
sudo chmod 666 /dev/ttyACM0

exec waydroid show-full-ui