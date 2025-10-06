#!/bin/bash
#


ifconfig ap0 >/dev/null 2> /dev/null || iw dev wlan0 interface add ap0 type __ap
nmcli con up AccessPoint > /dev/null

echo "discoverable on" |bluetoothctl > /dev/null


echo 1 > /proc/sys/net/ipv4/ip_forward
iptables -t nat -A POSTROUTING -o eth1 -j MASQUERADE
iptables -t nat -A POSTROUTING -o ap0 -j MASQUERADE

/sbin/iw dev wlan0 set power_save off
/sbin/iw dev ap0 set power_save off
