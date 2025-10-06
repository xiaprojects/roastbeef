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
