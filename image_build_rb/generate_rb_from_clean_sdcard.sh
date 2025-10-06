#!/bin/bash
# This script generates an RB from a standard installation

# Settings
export USER_HOME=$HOME
# into /boot/ you shall have 450 MB
export RB_SETTINGS_FOLDER="/boot/firmware/rb"
export RB_WWW_SETTINGS="/opt/stratux/www/RB-01/settings"
#export USER = "pi"
export GOURL="https://go.dev/dl/go1.25.1.linux-arm64.tar.gz"
export WIFI_AP_NAME=AccessPoint
export WIFI_AP_PASSWORD=steffano
# set a or bg
export WIFI_AP_BAND=bg



# Access point setup
cd $USER_HOME
iw dev wlan0 interface add ap0 type __ap

nmcli connection add type wifi ifname ap0 con-name 'AccessPoint' ssid $WIFI_AP_NAME mode ap
nmcli connection modify 'AccessPoint' wifi-sec.key-mgmt wpa-psk
nmcli connection modify 'AccessPoint' wifi-sec.psk $WIFI_AP_PASSWORD
nmcli connection modify 'AccessPoint' ipv4.method manual
nmcli connection modify 'AccessPoint' ipv6.method disabled
nmcli connection modify 'AccessPoint' ipv4.addresses 192.168.10.1/24
nmcli connection modify 'AccessPoint' wifi.powersave 0
nmcli connection modify 'AccessPoint' 802-11-wireless.band $WIFI_AP_BAND
#nmcli connection modify 'AccessPoint' 802-11-wireless.channel 1
nmcli con up AccessPoint


# GO Install
cd $USER_HOME
wget $GOURL
tar -zxf go1.*.linux-arm64.tar.gz
cd /usr/local/bin
ln -s $USER_HOME/go/bin/* .


# Package install
cd $USER_HOME
apt update
apt upgrade -y
apt install -y librtlsdr-dev bc bison flex libssl-dev make git wayfire seatd xdg-user-dirs libgl1-mesa-dri libusb-1.0-0-dev build-essential autoconf libtool i2c-tools libfftw3-dev libncurses-dev python3-serial jq ifplugd iptables libttspico-utils bluez bluez-firmware chromium-browser usbmuxd dnsmasq libtool libfftw3-dev rtl-sdr

# OGN ESP Updater
apt install -y python3-pip
pip install --break-system-packages esptool


# Apply files
cd $USER_HOME
tar --owner=0 --group=0 --no-overwrite-dir --no-same-owner -zxf rootfiles.tgz -C /


# Enable I2C
cp /home/pi/config.txt /boot/firmware

# Kalibrate Install
cd $USER_HOME
git clone https://github.com/steve-m/kalibrate-rtl.git
cd kalibrate-rtl/
./bootstrap 
CXXFLAGS='-W -Wall -O3' ./configure
make
make install


# Disable services
systemctl disable ModemManager.service
systemctl disable avahi-daemon.service  avahi-daemon.socket
systemctl disable systemd-fsckd.service  systemd-fsckd.socket
systemctl disable systemd-timesyncd.service
systemctl disable resize2fs_once
systemctl disable triggerhappy.service  triggerhappy.socket
systemctl disable upower.service
systemctl disable cron.service 
systemctl disable alsa-restore.service
systemctl disable alsa-state.service
systemctl disable alsa-utils.service
systemctl disable console-setup.service
systemctl disable dphys-swapfile.service
systemctl disable keyboard-setup.service
systemctl disable logrotate.timer
systemctl disable apt-daily.timer
systemctl disable apt-daily-upgrade.timer
systemctl disable man-db.timer
systemctl disable apt-daily-upgrade.timer
systemctl disable systemd-ask-password-console.path
systemctl disable systemd-ask-password-wall.path
systemctl disable dphys-swapfile.service
systemctl disable rpc-statd-notify.service
systemctl disable rpi-eeprom-update.service

# RB-Avionics ethernet service
systemctl enable accesspoint.service
# RB-01
systemctl enable wayfire.service
# RB-03
systemctl disable wayfire.service


# Prepare wiringpi for ogn trx via GPIO
export WIRINGPI_VERSION="3.16"
export WIRINGPI_FILENAME="wiringpi_${WIRINGPI_VERSION}_arm64.deb"
wget https://github.com/WiringPi/WiringPi/releases/download/${WIRINGPI_VERSION}/${WIRINGPI_FILENAME}
dpkg -i $WIRINGPI_FILENAME


# Stratux - RB-Avionics install from sources
chown -R $USER:$USER $USER_HOME
mkdir -p /opt/stratux/
# Roadmap to make it run as user without root
chown -R $USER:$USER /opt/stratux/

# Install latest sources from RB-Avionics
git clone  --recurse-submodules https://github.com/xiaprojects/roastbeef.git stratux

# Install latest sources from online
rm -Rf stratux/dump1090
git clone  --recurse-submodules https://github.com/flightaware/dump1090.git stratux/dump1090
# Install latest sources from online
rm -Rf stratux/ogn/ogn-tracker
git clone  --recurse-submodules https://github.com/pjalocha/ogn-tracker.git stratux/ogn/ogn-tracker

# Compile it
cd stratux
make && make optinstall

# Enable stratux service
cp /home/pi/stratux/debian/stratux.service /lib/systemd/system
systemctl daemon-reload
systemctl enable stratux

# Move the configuration away into /boot/firmware/rb
mv $RB_WWW_SETTINGS $RB_SETTINGS_FOLDER
ln -s $RB_SETTINGS_FOLDER $RB_WWW_SETTINGS


# Enable the Overlay
# TODO: 

# TODO: Check for I2C Enabled