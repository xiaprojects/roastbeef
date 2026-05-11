#!/bin/bash

# Usage: ./update_script.sh <download_url> <process_name> <start_command> <expected_md5>

if [ $# -ne 4 ]; then
    echo "Usage: $0 <download_url> <process_name> <start_command> <expected_md5>"
    echo "Example: $0 'https://example.com/update.tar.gz' 'myapp' './myapp --start' 'a1b2c3d4e5f6...'"
    exit 1
fi

URL="$1"
PROCESS_NAME="$2"
START_CMD="$3"
EXPECTED_MD5="$4"
PACKAGE_NAME="update.tar.gz"

echo "Starting update process..."

# 1. Download the update package
echo "Downloading update package from $URL..."
if ! curl -L -o "$PACKAGE_NAME" "$URL"; then
    echo "Error: Failed to download package from $URL"
    exit 1
fi

# 2. Check MD5
echo "Verifying MD5 checksum (expected: $EXPECTED_MD5)..."
ACTUAL_MD5=$(md5sum "$PACKAGE_NAME" | cut -d' ' -f1)
if [ "$ACTUAL_MD5" != "$EXPECTED_MD5" ]; then
    echo "Error: MD5 mismatch!"
    echo "Expected: $EXPECTED_MD5"
    echo "Actual:   $ACTUAL_MD5"
    rm -f "$PACKAGE_NAME"
    exit 1
fi
echo "MD5 checksum verified successfully."

# 3. Wait for no specific process running
echo "Waiting for process '$PROCESS_NAME' to stop..."
while pgrep -x "$PROCESS_NAME" > /dev/null; do
    echo "Process '$PROCESS_NAME' still running. Waiting 5 seconds..."
    sleep 5
done
echo "No '$PROCESS_NAME' processes found."

# 4. Install the package
echo "Installing update package..."
if ! sudo tar -C / -zxf "$PACKAGE_NAME"; then
    echo "Error: Failed to extract package!"
    rm -f "$PACKAGE_NAME"
    exit 1
fi
rm -f "$PACKAGE_NAME"
echo "Package installed successfully."

# 4.5 Clean chromium cache to ensure the new web interface is correctly loaded
rm -Rf /home/pi/.config/chromium/
rm -Rf /home/pi/.cache/chromium/


# 5. Start the command
echo "Starting process with: $START_CMD"
if ! eval "$START_CMD"; then
    echo "Warning: Failed to start command '$START_CMD'"
    exit 1
fi

echo "Update process completed successfully!"