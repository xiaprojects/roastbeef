#!/bin/bash
export XDG_RUNTIME_DIR=/run/user/1000
export XDG_SESSION_CLASS=user
export XDG_SESSION_ID=5
export XDG_SESSION_TYPE=wayland

WAYLAND_DISPLAY=wayland-1 wlr-randr --output HDMI-A-1 --off