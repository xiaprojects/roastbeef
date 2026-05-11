# Android integration
### Points to be covered
1. Enable the GDL90 to be propagated to the Android VM
2. Enable the GPS device NMEA as backup
3. Audio routing from RB-06 to RB-01

## GDL90 Propagation
Add the gdl90-passthrough.sh script to your /etc/rc.local

## GPS NMEA Android
https://github.com/xiaprojects/roastbeef/wiki/Android-GNSS-Location-Integration

## Audio Routing
| Description | Action | Target |
| --- | --- | --- |
| Configure the RB-06 to play into a Loopback device | Loopback.ForSender.asoundrc | RB-06 |
| Configure Android to play into Alsa | pipewire-alsa.conf | RB-06 |
| Enable the Audio Sender |`sudo systemctl enable audioServiceSender.service`  | RB-06 |
| Enable the Audio Receiver | `sudo systemctl enable audioServiceServer.service` | RB-01 |
| Verify there is DMIX enabled | | RB-01 |

### Pipewire device check
Wire Plumber get current device status:
```
wpctl status
```

Expected output:
```
Audio
 ├─ Devices:
 │      48. Loopback                            [alsa]
 │
 ├─ Sinks:
 │  *   32. Waydroid ALSA Output                [vol: 1.00]
```

Test example:
```
pw-play /usr/share/sounds/alsa/Front_Right.wav
```

Where is my pipewire configuration?
```
pw-config
{
  "config.path": "/usr/share/pipewire/pipewire.conf"
}
```