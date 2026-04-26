## Choices...
If you want to start working on the Stratux code base, here are a few hints for a developer-friendly setup.
Note that this only works as-is for the Stratux EU Edition.

You basically have two choices.
- Remotely working on a PI
- Working locally on a Linux machine

Working remotely on a pi can also be done from Windows and has the advantage of full hardware support (e.g. AHRS module, which can't be plugged into your PC).
Working locally on a Linux machine is a bit harder to set up and requires some creativity, but is much faster and more comfortable when doing basic work that doesn't rely on AHRS/Baro stuff.

We recommend working remotely on the Pi, preferably a Pi4.

## Remote Setup
To work remotely on the PI, first **make sure your Stratux is connected to the internet**. 

### Turn up CPU and restart
Keep in mind that the PI's CPU is clocked down by default in the Stratux image to save some power. This makes compiling stuff extremely slow. Therefore it is recommended to remove/comment the *_freq lines in `/boot/config.txt` (or `/boot/firmware/config.txt` starting with bookworm) and restarting it.

### Enable Developer mode
You will also have to enable developer mode and persistent logging on the web interface to make sure that the file system of the PI is writable.

- Enable Developer mode by visiting the status page and repeatedly clicking the version number at the top of the screen.
- Navigate to **Settings > Diagnostics > Persistent logging** and enable it.
- Restart again and verify that persistent logging is enabled before you continue.

### Set root password
Then connect to it via Putty/SSH and set a root password (`sudo passwd`).

### Set the correct date
```bash
timedatectl set-ntp on
```

### Install build dependencies
If you run out of disk space, persistent logging is probably disabled

```bash
apt update
apt install build-essential git ncurses-dev
```
Notes:
Some dpkg errors are normal.

```bash
cd /tmp
wget https://github.com/stratux/rtlsdr/releases/download/v1.0/librtlsdr0_2.0.2-2_arm64.deb
dpkg -i librtlsdr0_2.0.2-2_arm64.deb
wget https://github.com/stratux/rtlsdr/releases/download/v1.0/librtlsdr-dev_2.0.2-2_arm64.deb
dpkg -i librtlsdr-dev_2.0.2-2_arm64.deb
```

### Clone the repo
Now clone the Stratux repository and install go:

```bash
cd /root
git clone --recursive https://github.com/stratux/stratux.git
wget https://golang.org/dl/go1.20.1.linux-arm64.tar.gz
tar xzf go1.20.1.linux-arm64.tar.gz
rm go1.20.1.linux-arm64.tar.gz
```

### Set up VSCode
Afterwards, install Visual Studio Code on your PC, and additionally install and configure the VSCode Remote-SSH Extension: https://code.visualstudio.com/docs/remote/ssh
When done, connect to the RPi as root via Visual Studio Code.
Then click `File->Open Folder` and type in `/root/stratux`.
You should now have the Stratux project loaded into VSCode.
There are preconfigured build an debug tasks in the project which allow you to create a debuggable Stratux build and remote-debug it in VSCode.
To get started, you need to install the "Go" extensions ("Install on Stratux" while connected via Remote-SSH).
The extension will ask you to install several tools (including delve if you want to debug). Go ahead and do so.
Before debugging, run `stxstop` to stop the already running stratux service.

There is also a makefile in the repository, so `make && make install && stxrestart` would be a simple way to build, install and start.

### Save your public key to the pi
Run on your local machine (On windows use git bash).  Stops VSCode from continually prompting for passwords

```bash
ssh-copy-id root@stratux
```

## Local x86 Linux Setup
This is an **ADVANCED** setup, which requires experience with the Linux shell, system, and common build processes. Do not open issues if you can't get it to work - you are on your own here.

First, you need to install and setup go and its dependencies.
Once done, you can try to build your first X86 version of Stratux. Clone the Stratux repository and run `make`.
To make everything work, you will also have to run `sudo make install`, so that Stratux can find the OGN decoder, dump1090, etc. This will also install Stratux service files and udev rules. If you don't want that, you can instead run `make optinstall` to only install the stuff that resides in `/opt/stratux`.
Once everything is running, you might want to install Visual Studio Code and open the Stratux directory in there.
There are preconfigured build and debug tasks for VSCode in the repository.

