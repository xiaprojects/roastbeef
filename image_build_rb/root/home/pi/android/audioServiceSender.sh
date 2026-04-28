#!/bin/bash
sudo modprobe snd-aloop

exec arecord -D plug:loopcap  -f S16_LE -r 22050 -c 1 -t raw | nc -u 192.168.10.1 5004