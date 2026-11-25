# Running RB-01 from an NVMe SSD (Raspberry Pi 5)

Answers manual question Q-01B-74ea1 (2026-11-24). The RB-01 image is built for, and tested
on, a **microSD card**. The Raspberry Pi 5 can boot the same image from an NVMe SSD on its
PCIe connector. This page lists what changes. Nothing in the daemon depends on the storage
type.

## What does not change

- **The image itself.** `cmdline.txt` mounts the root filesystem by `root=PARTUUID=…`, and
  `/etc/fstab` uses PARTUUIDs too. A byte copy of the image to the SSD keeps the same
  PARTUUIDs, so the SSD boots without editing either file.
- `/boot/firmware/rb` (RB settings), `/boot/firmware/stratux.conf`, the overlay (read-only
  root) and the OTA paths are the same on SD and NVMe.

## What is needed

| Item | Why |
|---|---|
| An M.2 adapter for the Pi 5 PCIe connector (Raspberry Pi M.2 HAT+ or equivalent) and a 2230/2242 NVMe SSD | Hardware. The adapter must leave room for the **Active Cooler, which is mandatory** on RB-01, and must not cover the GPIO pins the RB-01 uses (I²C, UART, SPI): use a stacking header or an adapter mounted under the board |
| Bootloader EEPROM recent enough to boot NVMe, with NVMe in the boot order | The Pi 5 boots NVMe only when the bootloader says so |
| `dtparam=pciex1` in `config.txt` | Turns on the external PCIe connector for an adapter that is not HAT+ auto-detected. Harmless with a HAT+ |
| A power supply with margin | The SSD adds its own draw (up to a few watts at peak, see its datasheet) to the RB-01 budget. Re-measure the current (RB-01-C) |

## Steps

1. **Update the bootloader** (on the unit, with internet, overlay off: `sudo overlayctl
   disable`, reboot):
   ```sh
   sudo rpi-eeprom-update -a
   sudo reboot
   ```
   The image disables `rpi-eeprom-update.service` on purpose; the command above runs it
   once by hand.
2. **Set the boot order** so NVMe is tried first, then SD, then USB:
   ```sh
   sudo rpi-eeprom-config --edit
   # set:
   BOOT_ORDER=0xf416
   ```
   (`6` = NVMe, `1` = SD card, `4` = USB, read right to left.) With an SD card left in the slot
   as a spare, the unit still boots NVMe first.
3. **Enable the connector.** Add to `/boot/firmware/config.txt` (in the `[all]` section):
   ```
   dtparam=pciex1
   ```
   Leave the link at its default (Gen 2). `dtparam=pciex1_gen=3` is faster but is not
   certified by Raspberry Pi; do not use it on an aircraft unit.
4. **Write the image to the SSD.** Either with Raspberry Pi Imager (SSD in a USB enclosure on
   a PC, choose the RB-01 release image from GitHub), or from the running unit:
   ```sh
   lsblk                                  # the SSD is /dev/nvme0n1
   zcat RB-01-<version>.img.gz | sudo dd of=/dev/nvme0n1 bs=4M conv=fsync status=progress
   ```
   Or copy a configured SD card to the SSD (`sudo dd if=/dev/mmcblk0 of=/dev/nvme0n1 bs=4M
   conv=fsync status=progress`, with stratux stopped) to keep its settings.
5. **Grow the root partition** to the SSD size (the image is shrunk): on first boot the
   standard Raspberry Pi OS resize runs if enabled; otherwise `sudo raspi-config nonint
   do_expand_rootfs` with the overlay off, then reboot.
6. **Check:**
   ```sh
   findmnt /                              # root on /dev/nvme0n1p2 (or the overlay over it)
   findmnt /boot/firmware                 # /dev/nvme0n1p1
   vcgencmd get_throttled                 # throttled=0x0
   ```
   Then run the normal power-up checks (RB-01-B) and the HMI at `http://192.168.10.1/RB-01`.

## Known differences

- **rb-sysmon disk metrics.** `../rb-ems-go/sysmon/rb-sysmon.json` reads
  `/sys/block/sda/stat` (`sda_inflight`, `sda_busy_ms_total`). On NVMe the device is
  `nvme0n1`: change those two entries, or they read nothing.
- **Do not leave two copies of the same image** (SD and SSD) in the unit: both carry the same
  PARTUUIDs, and the kernel may mount the root of the wrong one. Wipe or remove the SD card
  after moving to NVMe, or give the SSD new PARTUUIDs and edit `cmdline.txt` and `fstab`.
- **Boot time** is the same or shorter (the boot times in the manual are measured on SD).
- **Temperature.** An NVMe SSD under the board warms the Pi; check `CPUTemp` after one hour of
  operation (RB-01-B).
