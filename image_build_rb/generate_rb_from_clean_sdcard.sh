#!/bin/bash
# This script generates an RB from a standard installation
# Please read the Wiki documentation and Join Discord for more tips
# https://github.com/xiaprojects/roastbeef/wiki/How-to-install

# Settings
export USER="pi"
export USER_HOME=/home/$USER
# into /boot/ you shall have 450 MB
export RB_SETTINGS_FOLDER="/boot/firmware/rb"
export RB_WWW_SETTINGS="/opt/stratux/www/settings"
export GOURL="https://go.dev/dl/go1.25.1.linux-arm64.tar.gz"
export WIFI_AP_NAME=AccessPoint
export WIFI_AP_PASSWORD=steffano
# set a or bg
export WIFI_AP_BAND=bg



# Access point setup
cd $USER_HOME
iw dev wlan0 interface add ap0 type __ap
nmcli connection del 'AccessPoint'
nmcli connection del 'AccessPoint'
nmcli connection del 'AccessPoint'
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


# If you have Internet WiFi in your Aircraft here is the right place to enable it
# raspi-config nonint do_wifi_setup "MyNetwork" "MyPassword"
raspi-config nonint do_wifi_country "IT"
raspi-config nonint do_i2c 0
raspi-config nonint do_overlayfs 0
# To write on the root file system:
#sudo mount -o remount,rw /media/root-ro
#sudo mount -o remount,ro /media/root-ro
# Todo create a similar script to be invoked by application

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
apt install -y librtlsdr-dev
apt install -y bc
apt install -y bison
apt install -y flex
apt install -y libssl-dev
apt install -y make
apt install -y git
apt install -y wayfire
apt install -y seatd
apt install -y xdg-user-dirs
apt install -y libgl1-mesa-dri
apt install -y libusb-1.0-0-dev
apt install -y build-essential
apt install -y autoconf
apt install -y libtool
apt install -y i2c-tools
apt install -y libfftw3-dev
apt install -y libncurses-dev
apt install -y python3-serial
apt install -y jq
apt install -y iptables
apt install -y libttspico-utils
apt install -y bluez bluez-firmware
apt install -y chromium
apt install -y chromium-browser
apt install -y usbmuxd
apt install -y dnsmasq
apt install -y libtool
apt install -y libfftw3-dev
apt install -y rtl-sdr

# OGN ESP Updater
apt install -y python3-pip
pip install --break-system-packages esptool

# Enable RW on /boot to allow writing of configuration
# TODO in the future change method
raspi-config nonint disable_bootro

# Apply files
cd $USER_HOME
tar --owner=0 --group=0 --no-overwrite-dir --no-same-owner -zxf rootfiles.tgz -C /
# Double check that shell scripts shall be executable
chmod a+x *.sh
# Hostname is already contained into the tgz
# raspi-config nonint do_hostname "raspberrypi"


# Enable I2C
cp $USER_HOME/config.txt /boot/firmware/config.txt
# Enable 80 mm round display
#cat $USER_HOME/config-add-80mm.txt >> /boot/firmware/config.txt
# Enable DSI 6.25" display
#cat $USER_HOME/config-add-625.txt >> /boot/firmware/config.txt



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
cd $USER_HOME
wget https://github.com/WiringPi/WiringPi/releases/download/${WIRINGPI_VERSION}/${WIRINGPI_FILENAME}
dpkg -i $WIRINGPI_FILENAME


# Stratux - RB-Avionics install from sources
chown -R $USER:$USER $USER_HOME
mkdir -p /opt/stratux/
# Roadmap to make it run as user without root
chown -R $USER:$USER /opt/stratux/

# Install latest sources from RB-Avionics
cd $USER_HOME
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
mv /opt/stratux/www /opt/stratux/www.old
mv web /opt/stratux/www

# Enable stratux service
cp $USER_HOME/stratux/debian/stratux.service /lib/systemd/system
systemctl daemon-reload
systemctl enable stratux

# Move the configuration away into /boot/firmware/rb
mv $RB_WWW_SETTINGS $RB_SETTINGS_FOLDER
ln -s $RB_SETTINGS_FOLDER $RB_WWW_SETTINGS


# I2C Enable
raspi-config nonint do_i2c 0

# Debugging purposes
#raspi-config nonint do_ssh 1


# Enable the Overlay
raspi-config nonint do_overlayfs 0
# In the future to write into the root you shall:
#sudo mount -o remount,rw /media/root-ro
# In the future to readonly into the root you shall:
#sudo mount -o remount,ro /media/root-ro


# TODO: make everything without root
chown -R $USER:$USER $USER_HOME
chown -R $USER:$USER /opt/stratux/

# Apply User Settings
# Create USA SDCard with Maps and detailed elevations:
# Join Discord Channel for the script
# Create EU SDCard with Maps and detailed elevations:
# Join Discord Channel for the script