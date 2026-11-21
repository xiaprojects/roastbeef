#!/bin/sh -e
# This file has being moved from /etc/rc.local to /boot/firmware/rb/rb-prestart.sh
# Here you need to add any custom setup BEFORE stratux service starts
# Set USB or internal UART GPS
if [ ! -f /dev/ublox8 ]; then
ln -s /dev/ttyAMA0 /dev/ublox8
fi
# Enable USB->RS232 to Radio KRT or Trig
if [ ! -f /dev/radio0 ]; then
ln -s /dev/ttyUSB0 /dev/radio0
fi
# Enable USB->RS232 to FLARM or RB-05/RB-07
if [ ! -f /dev/serialout_nmea1 ]; then
ln -s /dev/ttyACM1 /dev/serialout_nmea0
fi
# If you wan to enable T-Beam FLARM Input only without GPS you need to update stratux.conf
# Enable T-Beam GPS and FLARM Input
if [ ! -f /dev/serialout_nmea1 ]; then
ln -s /dev/ttyACM0 /dev/serialin
fi
