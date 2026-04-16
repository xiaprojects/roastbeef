#!/usr/bin/env bash
# License AGPL-3 for personal usage
# License for commercial is available
# Original idea is coming from the GitHub forum: https://github.com/waydroid/waydroid/issues/226
# This script is used on the RB-06 Android Avionics Open Source when the users enables Waydroid as VM
# Host Requirements: adb gpsd
# Android VM: Appium
# You shall use "userspace" adb shell and not waydroid shell --
# Android permission by the following commands:
# adb shell settings put global hidden_api_policy  1
# adb shell appops set io.appium.settings android:mock_location allow
# adb shell pm grant io.appium.settings android.permission.ACCESS_FINE_LOCATION
#
# Teste Software Trixie Apr-2026, Waydroid, Appium v7.0.10
# Tested Hardware without modifications in Raspberry 5 USB VK-162
# Working apps: generic google location like Google Map, not working for real Avionics Navigators due to lack of "GPS Satellites status"
# Possible improvements:
# 1. Make the invokation into a loop
# 2. Reuse the "nc" channel without reconnecting every time
# 3. Reuse the adb shell pipe to inject commands without reissuing every time it
# 4. Waydroid requires a waydroid adb connect before launching this script
# 5. Error management in case of the steps fails
#
# RB-Avionics the opensource avionics for your real aircraft, drone, simulator
# Please read the Wiki documentation and Join Discord for more tips
# https://github.com/xiaprojects/roastbeef/wiki/How-to-install
set -euo pipefail

GPSD_HOST="${GPSD_HOST:-127.0.0.1}"
GPSD_PORT="${GPSD_PORT:-2947}"
WAIT_FIX="${WAIT_FIX:-15}"
WAYDROID_USER="${WAYDROID_USER:-0}"
SERVICE="${SERVICE:-io.appium.settings/.LocationService}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd nc
need_cmd jq
need_cmd timeout
need_cmd waydroid

TPV_LINE="$(
  timeout "$WAIT_FIX" bash -c '
    {
      printf '\''?WATCH={"enable":true,"json":true};\n'\''
      sleep 1
    } | nc "$0" "$1" \
      | jq -rc '\''select(.class? == "TPV" and (.mode // 0) >= 2 and (.lat != null) and (.lon != null))'\'' \
      | head -n 1
  ' "$GPSD_HOST" "$GPSD_PORT" || true
)"

if [[ -z "$TPV_LINE" ]]; then
  echo "No valid TPV fix received from gpsd within ${WAIT_FIX}s" >&2
  exit 2
fi

lat="$(jq -r '.lat' <<<"$TPV_LINE")"
long="$(jq -r '.lon' <<<"$TPV_LINE")"
alt="$(jq -r 'if .alt != null then .alt else 0 end' <<<"$TPV_LINE")"
speed="$(jq -r 'if .speed != null then .speed else 0 end' <<<"$TPV_LINE")"
track="$(jq -r 'if .track != null then .track else 0 end' <<<"$TPV_LINE")"
mode="$(jq -r '.mode // 0' <<<"$TPV_LINE")"

>&2 echo "gpsd fix: mode=$mode lat=$lat lon=$long alt=$alt speed=$speed track=$track"

adb shell am start-foreground-service -e speed $speed -e bearing $track -e longitude $long -e latitude $lat -e altitude $alt io.appium.settings/.LocationService
