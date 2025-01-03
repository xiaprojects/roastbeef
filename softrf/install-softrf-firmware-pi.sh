#!/bin/bash


cd "$(dirname "$0")"

fwfile="SoftRF*.zip"
echo $fwfile
if [ ! -f $fwfile ]; then
    echo "Unknown firmware $fwfile"
    exit 1
fi

rm -rf /tmp/softrf
mkdir -p /tmp/softrf

unzip $fwfile -d /tmp/softrf
unzip USB-flashing-ESP32.zip -d /tmp/softrf

systemctl stop stratux
cd /tmp/softrf

esptool.py --chip auto --port /dev/serialin --baud 921600 erase_flash

esptool.py --chip auto --port /dev/serialin --baud 921600 --before default_reset --after hard_reset \
    write_flash -u --flash_mode dio --flash_freq 80m --flash_size detect \
    0x1000 bootloader_dio_80m.bin \
    0x8000 SoftRF.ino.partitions.bin \
    0xE000 boot_app0.bin \
    0x10000 SoftRF.mb*.esp32.bin

systemctl start stratux


