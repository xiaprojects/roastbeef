#!/usr/bin/env bash
set -euo pipefail

PATTERN='hci0: Opcode 0x2006 tx timeout'

journalctl -k -f -o cat | while IFS= read -r line; do
    case "$line" in
        *"$PATTERN"*)
            logger -t tx-timeout-watchdog "Matched kernel log: $line"
            /usr/bin/sudo /sbin/reboot
            exit 0
            ;;
    esac
done