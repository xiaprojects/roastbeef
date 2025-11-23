## SDCard Generator
This folder is used to self-create the RB-Avionics SDCard.

## Requirements
Before you start you shall be aware on what you are doing
### Examples
| Device | Nickname | Display | Raspberry | Optionals |
| --- | --- | --- | --- | --- |
| stratux | Existing stratux device upgrade | WiFi | 3 | Stratux optionals |
| RB-01 | Round display | 80 mm HDMI | 5 | Internet, RS-232, SDR-RTL |
| RB-03 | Aluminium remote box | WiFi | 3 | RS-232, SDR-RTL |
| RB-01 | Rectangular display | All formats HDMI/DSI | 5 | Internet, RS-232, SDR-RTL, OGN TX |


### Generic shop list
1. Hardware
2. Software
3. Configuration
4. Your Aircraft mesh
5. Other Aircraft mesh
6. Elevevations.json file
7. Mapbox Map file


## Steps
### Genearte RB
These are the steps to be followed:
1. Have hardware device capable of running debian like distribution (Raspberry 5, settings will be /boot/firmware/rb)
2. Install the debian like (Raspberry OS 64bit LITE)
3. Suggested to have "pi" username and "stratux" hostname (so the home folder will be for everybody the same /home/pi)
4. Connect the device to internet and have time-date set (Ethernet or WiFi)
5. Update the debian like OS
6. Copy the script
7. Run the script as sudo
8. In case the script requires some "Y" enter Y
### Create SDCard Image
1. Requires: Linux box and SDCard reader
2. Using G-Parted you shall shrink the partition to minimun
3. Create the image using: 

### Create SDCard Image
## Requirements
1. Set your WiFi name and Password

## Configuration
| Step | Subject | Description | Example |
| --- | --- | --- | --- |
| 1 | Internet Sharing | If you want to have Internet available from your RB-Device you shall enable the DHCP Gateway in /etc/dnsmasq.conf  | /boot/firmware/rb/internet.sh |
| 2 | My Aircraft | You shall change your aircraft 3D mesh, you can find many examples into https://sketchfab.com/3d-models/low-poly-airplane-reggiane-re-2000-dea61a7bd5c7487cb74beda24c214d75
https://free3d.com/3d-model/airplane-v2--549103.html
https://www.cgtrader.com/free-3d-models/aircraft/private-aircraft/template-cessna-152--2 | --- |
| 3 | WiFi 2G or 5G | RB-Avionics suggest to have a device capable of having 5Ghz WiFi bandwidth | --- |
| 4 | RTL-SDL Calibration | You shall calibrate your devices to have the correct PP | Kalibrate is already in |
| 5 | --- | --- | --- |
| 6 | --- | --- | --- |
| 7 | --- | --- | --- |
## Manual post steps
1. Clean up log and temporary folders
```
rm -Rf var/log
rm -Rf .config/chromium
rm -Rf .cache/chromium
```
2. Default settings: `mv settings settings-default`
3. Links: `ln -s /boot/firmware/rb settings`
3. `ls -l .well-known/public.pem`
4. `ls -l /etc/udev/rules.d`

### Create installable img
```
sudo dd if=/dev/sdb of=RB-01-raw.img bs=100M count=70
sudo pishrink.sh -vz RB-01-raw.img 
```

### Create Update file
## Manual post steps
1. `tar -czf update-2.1.0.tgz bin/stratuxrun ogn RB-01.20251030.txt www`
2. Create TGZ compatible with stratux
```
cp update.sh update-from-Stratux-1.6EU-to-RB-01-2.1.1.sh
cat update-2.1.1.tgz >> update-from-Stratux-1.6EU-to-RB-01-2.1.1.sh
```