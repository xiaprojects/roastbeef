#!/bin/sh -e
# Set USB or internal UART GPS
ln -s /dev/ttyAMA0 /dev/ublox8
# Enable USB->RS232 to Radio KRT or Trig
ln -s /dev/ttyACM0 /dev/radio0
# Enable USB->RS232 to FLARM or RB-05/RB-07
ln -s /dev/ttyACM1 /dev/serialout_nmea0
