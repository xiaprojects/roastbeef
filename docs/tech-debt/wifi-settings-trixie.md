# Wi-Fi password and network settings on Raspberry Pi OS Trixie

Status (2026-11-24): **documentation and tooling debt.** Asked by the owner on 2026-11-24 in
reply to manual finding F7. The upstream Stratux network settings were written for older
Raspberry Pi OS releases and do not apply to the RB-01 image, which runs Debian 13 Trixie
with NetworkManager.

## Problem

Two network stacks are in the repository, and only one is real on an RB-01:

| | Upstream Stratux | RB-01 image (Trixie) |
|---|---|---|
| Who writes the AP | `main/networksettings.go` (`applyNetworkSettings`) writes the Stratux templates for `hostapd`, `dnsmasq` and `wpa_supplicant`, and falls back to SSID `Stratux` with no passphrase | `image_build_rb/generate_rb_from_clean_sdcard.sh` creates a **NetworkManager** connection `AccessPoint` on a virtual interface `ap0` |
| SSID / passphrase | From the legacy Settings page (`WiFiSSID`, `WiFiPassphrase`) | `WIFI_AP_NAME=AccessPoint`, `WIFI_AP_PASSWORD=steffano` at the top of the build script |
| Address | 192.168.10.1 | `192.168.10.1/24`, DHCP from NetworkManager's shared dnsmasq (`/etc/NetworkManager/dnsmasq-shared.d/dnsmasq.conf`) |
| Started by | `hostapd.service` | `enable_accesspoint.sh` (creates `ap0`, `nmcli con up AccessPoint`) |

So the Wi-Fi fields of the legacy Stratux Settings page (`http://192.168.10.1/`) **do not
change the RB-01 access point**. A builder who changes them sees no effect, or, if
`-write-network-config` runs, gets files nobody reads.

Every unit built with the script has the same public passphrase (`steffano`). Manual findings
4 and 5 apply: a per-unit passphrase is needed, and `band bg` with `channel 44` (a 5 GHz
channel) is an invalid pair.

## Procedure to document (manual RB-01-B / RB-01-C)

All commands over SSH or a local console, as user `pi` with `sudo`.

### 1. Make the change persistent

The root filesystem is a **read-only overlay**. NetworkManager keeps its connections in
`/etc/NetworkManager/system-connections/`, on the root filesystem, so a change made with the
overlay on is **lost at the next restart**. First:

```sh
sudo overlayctl status          # "enabled" = read-only root
sudo overlayctl disable         # then reboot
sudo reboot
```

Make the changes below, then `sudo overlayctl enable` and reboot again.

### 2. Change the access point passphrase

```sh
nmcli connection show AccessPoint | grep -E 'ssid|psk|band|channel'
sudo nmcli connection modify AccessPoint wifi-sec.key-mgmt wpa-psk wifi-sec.psk 'NEW-PASSPHRASE'
sudo nmcli connection up AccessPoint
```

WPA2-PSK needs 8 to 63 characters. Clients already joined must forget the network and join
again with the new passphrase.

### 3. Change the SSID

```sh
sudo nmcli connection modify AccessPoint 802-11-wireless.ssid 'RB-01-1234'
sudo nmcli connection up AccessPoint
```

Keep the connection **name** `AccessPoint`: `enable_accesspoint.sh` brings it up by that name.

### 4. Band and channel

Pick a valid pair:

```sh
# 2.4 GHz
sudo nmcli connection modify AccessPoint 802-11-wireless.band bg 802-11-wireless.channel 6
# 5 GHz (check the country's rules; the Pi 5 radio in AP mode supports non-DFS channels)
sudo nmcli connection modify AccessPoint 802-11-wireless.band a 802-11-wireless.channel 36
sudo nmcli connection up AccessPoint
```

`ap0` shares the radio with `wlan0`. While `wlan0` is joined to another network as a client,
the AP must use **the same channel** as that network, or it will not start.

### 5. Wi-Fi country

```sh
sudo raspi-config nonint do_wifi_country IT      # ISO code of the country of operation
```

### 6. Join a hangar network (client, for OTA and RB-Cloud)

```sh
sudo nmcli device wifi connect 'HANGAR-SSID' password 'HANGAR-PASSPHRASE' ifname wlan0
nmcli connection show --active
```

### 7. Check

```sh
nmcli -f GENERAL.STATE,IP4.ADDRESS device show ap0    # 192.168.10.1/24
iw dev ap0 info                                        # ssid, channel
```

From a tablet: join the new SSID, open `http://192.168.10.1/RB-01`.

## What to build

1. **Per-unit passphrase at first boot.** A one-shot service that, when
   `/boot/firmware/rb/wifi.json` is missing, generates a random passphrase, applies it with
   `nmcli`, writes it to `/boot/firmware/rb/wifi.json` and shows it once on the display (and on
   a label for the unit). Remove `WIFI_AP_PASSWORD=steffano` from the public script.
2. **Settings from the boot partition.** Read `/boot/firmware/rb/wifi.json`
   (`ssid`, `psk`, `band`, `channel`, `country`) at every boot and apply it with `nmcli`.
   `/boot/firmware` is writable with the overlay on, so a builder can change the Wi-Fi from a
   PC card reader, and the change survives the overlay.
3. **RB-01 Settings page.** A Network tab that writes that file through the daemon, replacing
   the legacy Stratux Wi-Fi fields for RB hardware (`HardwareBuild == "RB"`). Hide the legacy
   fields on RB hardware so they do not mislead.
4. **Fix the build script pair**: `WIFI_AP_BAND=bg` with `channel 6`, or `a` with `36`.
5. `networksettings.go`: skip `applyNetworkSettings` on RB hardware, or make it write the
   NetworkManager connection instead of the hostapd templates.
