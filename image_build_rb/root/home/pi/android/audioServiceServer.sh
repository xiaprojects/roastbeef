#!/bin/bash
exec /bin/nc -k -u -l 5004 | /usr/bin/aplay  -f S16_LE -r 22050 -c 1 --buffer-time=500000 --period-time=100000