#!/bin/bash

SCRIPT=$(realpath $0)

# Extract archive from below
echo "Extracting archive.."
# The payload follows the script after the line: __ARCHIVE_BELOW__
PAYLOAD_MARKER="__ARCHIVE_BELOW__"

# Find line number where marker appears
SKIP_LINE=$(awk "/^${PAYLOAD_MARKER}\$/ {print NR+1; exit 0; }" "$0")
if [[ -z "$SKIP_LINE" ]]; then
  log "Payload marker not found in script!" >&2
  exit 2
fi
TMPDIR="$(mktemp -d)"

# Extract base64 data and decode to a tgz
PAYLOAD_FILE="$TMPDIR/payload.tgz"
tail -n +"$SKIP_LINE" "$0" > "$PAYLOAD_FILE"

echo "Extracting done. Installing"
tar -C /opt/stratux -xzf "$PAYLOAD_FILE"
echo "Installed."

# re-enable overlay if it is configured. TODO: switch to jq for json parsing in the future once it's available in all installations
if [ "$(cat /boot/firmware/stratux.conf | grep 'PersistentLogging.:\s*true')" != "" ]; then
    raspi-config nonint do_overlayfs 1
else
    raspi-config nonint do_overlayfs 0
fi
raspi-config nonint disable_bootro

# Check for settings moved on the boot partition
export RB_SETTINGS_FOLDER="/boot/firmware/rb"
export RB_WWW_SETTINGS="/opt/stratux/www/settings-default"
if [ -e "$RB_SETTINGS_FOLDER" ]; then
    echo $RB_SETTINGS_FOLDER already moved into boot
else
    echo Moving configuration from $RB_SETTINGS_FOLDER
    cp -R $RB_WWW_SETTINGS $RB_SETTINGS_FOLDER
    # Link is already bundled into the tgz
fi

exit 0

# After this line there needs to be EXACTLY ONE NEWLINE!
__ARCHIVE_BELOW__
