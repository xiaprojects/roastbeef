export STRATUX_HOME := /opt/stratux/
export DEBPKG_BASE := /tmp/dpkg-stratux/stratux
export DEBPKG_HOME := /tmp/dpkg-stratux/stratux/opt/stratux
VERSIONSTR := $(shell ./scripts/getversion.sh)
ARCH = $(shell ./scripts/getarch.sh)

LFLAGS=-X main.stratuxVersion=$(VERSIONSTR) -X main.stratuxBuild=`git log -n 1 --pretty=%H`
BUILDINFO=-ldflags "$(LFLAGS)"
BUILDINFO_STATIC=-ldflags "-extldflags -static $(LFLAGS)"
PLATFORMDEPENDENT=fancontrol

ifeq ($(debug),true)
	BUILDINFO := -gcflags '-N -l' $(BUILDINFO)
endif

ifeq ($(ARCH),arm64)
	OGN_RX_BINARY=ogn/ogn-rx-eu_aarch64
else ifeq ($(ARCH),amd64)
	OGN_RX_BINARY=ogn/ogn-rx-eu_x86
else
	OGN_RX_BINARY=ogn/ogn-rx-eu_arm
endif

all: libdump978.so xdump1090 xrtlais stratuxrun $(PLATFORMDEPENDENT)

stratuxrun: main/*.go common/*.go libdump978.so
	LIBRARY_PATH=$(CURDIR) CGO_CFLAGS_ALLOW="-L$(CURDIR)" go build $(BUILDINFO) -o stratuxrun ./main/

fancontrol: fancontrol_main/*.go common/*.go
	go build $(BUILDINFO) -o fancontrol -p 4 ./fancontrol_main/

xdump1090:
	cd dump1090 && make BLADERF=no

libdump978.so: dump978/*.c dump978/*.h
	cd dump978 && make lib

xrtlais:
	cd rtl-ais && sed -i 's/^LDFLAGS+=-lpthread.*/LDFLAGS+=-lpthread -lm -lrtlsdr -L \/usr\/lib\//' Makefile && make


.PHONY: test
test:
	make -C test

www:
	make -C web

ogn/ddb.json:
	cd ogn && ./fetch_ddb.sh

optinstall: www ogn/ddb.json
	mkdir -p $(STRATUX_HOME)/bin
	mkdir -p $(STRATUX_HOME)/www
	mkdir -p $(STRATUX_HOME)/ogn
	mkdir -p $(STRATUX_HOME)/softrf
	mkdir -p $(STRATUX_HOME)/cfg
	mkdir -p $(STRATUX_HOME)/lib
	mkdir -p $(STRATUX_HOME)/mapdata
	chmod a+rwx $(STRATUX_HOME)/mapdata # so users can upload their stuff as user pi

	# binaries
	cp -f stratuxrun $(STRATUX_HOME)/bin/
	cp -f fancontrol $(STRATUX_HOME)/bin/
	cp -f dump1090/dump1090 $(STRATUX_HOME)/bin
	cp -f rtl-ais/rtl_ais $(STRATUX_HOME)/bin
	cp -f $(OGN_RX_BINARY) $(STRATUX_HOME)/bin/ogn-rx-eu
	chmod +x $(STRATUX_HOME)/bin/*

	# Libs
	cp -f libdump978.so $(STRATUX_HOME)/lib/

	# map data
	cp -ru mapdata/* $(STRATUX_HOME)/mapdata/

	# OGN stuff
	cp -f ogn/ddb.json ogn/*ogn-tracker-bin-*.zip ogn/install-ogntracker-firmware-pi.sh ogn/fetch_ddb.sh $(STRATUX_HOME)/ogn
	cp -f softrf/*.zip softrf/*.sh $(STRATUX_HOME)/softrf

	# Scripts
	cp debian/stratux-pre-start.sh $(STRATUX_HOME)/bin/stratux-pre-start.sh
	chmod 744 $(STRATUX_HOME)/bin/stratux-pre-start.sh
	cp -f debian/stratux-wifi.sh $(STRATUX_HOME)/bin/
	cp -f debian/sdr-tool.sh $(STRATUX_HOME)/bin/
	chmod 755 $(STRATUX_HOME)/bin/*

	# Config templates
	cp -f debian/stratux-dnsmasq.conf.template $(STRATUX_HOME)/cfg/
	cp -f debian/interfaces.template $(STRATUX_HOME)/cfg/
	cp -f debian/wpa_supplicant.conf.template $(STRATUX_HOME)/cfg/
	cp -f debian/wpa_supplicant_ap.conf.template $(STRATUX_HOME)/cfg/


install: dpkg
	dpkg -i stratux-$(VERSIONSTR)-$(ARCH).deb

#
# Debian package related targets below
#

.PHONY: prep_dpkg
prep_dpkg:
	rm -rf $(DEBPKG_BASE)
	mkdir -p $(DEBPKG_BASE)
	mkdir $(DEBPKG_BASE)/DEBIAN

.PHONY: wwwdpkg
wwwdpkg: STRATUX_HOME=$(DEBPKG_HOME)
wwwdpkg:
	make -C web

.PHONY: optinstall_dpkg

optinstall_dpkg:  STRATUX_HOME=$(DEBPKG_HOME)
optinstall_dpkg: optinstall

dpkg: all prep_dpkg wwwdpkg ogn/ddb.json optinstall_dpkg
	# Copy the control script to DEBIAN directory
	cp -f debian/control.dpkg $(DEBPKG_BASE)/DEBIAN/control
	# Copy the configuration  file list to DEBIAN directory
	cp -f debian/conffiles.dpkg $(DEBPKG_BASE)/DEBIAN/conffiles
	# Copy the preinstall script to DEBIAN directory
	cp -f debian/preinst.dpkg $(DEBPKG_BASE)/DEBIAN/preinst
	# Copy the preinstall script to DEBIAN directory
	cp -f debian/postinst.dpkg $(DEBPKG_BASE)/DEBIAN/postinst
	# Copy the preremoval script to DEBIAN directory
	cp -f debian/prerm.dpkg $(DEBPKG_BASE)/DEBIAN/prerm
	# Create the directories inside of the dpkg environment
	mkdir -p $(DEBPKG_BASE)/etc/udev/rules.d/
	mkdir -p $(DEBPKG_BASE)/lib/systemd/system/
	# Copy the udev rules to the dpkg environment
	cp -f debian/10-stratux.rules $(DEBPKG_BASE)/etc/udev/rules.d/10-stratux.rules
	cp -f debian/99-uavionix.rules $(DEBPKG_BASE)/etc/udev/rules.d/99-uavionix.rules
	cp -f debian/99-pong.rules $(DEBPKG_BASE)/etc/udev/rules.d/99-pong.rules
	# Copy the systemd scripts to the dpkg environment
	cp debian/stratux.service $(DEBPKG_BASE)/lib/systemd/system/stratux.service
	chmod 644 $(DEBPKG_BASE)/lib/systemd/system/stratux.service
	cp debian/stratux_fancontrol.service $(DEBPKG_BASE)/lib/systemd/system
	chmod 644 $(DEBPKG_BASE)/lib/systemd/system/stratux_fancontrol.service
	#ln -s $(DEBPKG_BASE)/lib/systemd/system/stratux.service $(DEBPKG_BASE)/etc/systemd/system/multi-user.target.wants/stratux.service
	# Set up the versioning inside of the dpkg system. This puts the version number inside of the config file
	sed -i 's/VERSION/$(VERSIONSTR)/g' $(DEBPKG_BASE)/DEBIAN/control
	# set up the arch inside of the dpkg System. We have to use a script because x86_64 is arm64, aarch64 is arm64, etc.
	sed -i 's/ARCH/$(ARCH)/g' $(DEBPKG_BASE)/DEBIAN/control
	# Set permissions of the scripts for dpkg
	chmod 755 $(DEBPKG_BASE)/DEBIAN/control
	chmod 755 $(DEBPKG_BASE)/DEBIAN/preinst
	chmod 755 $(DEBPKG_BASE)/DEBIAN/postinst
	chmod 755 $(DEBPKG_BASE)/DEBIAN/prerm
	# Create the default US settings for the config default
	echo '{"UAT_Enabled": true,"OGN_Enabled": false,"DeveloperMode": false}' > $(DEBPKG_HOME)/cfg/stratux.conf.default
	# Create the debian package
	dpkg-deb -b $(DEBPKG_BASE)
	# Rename the file and move it to the base directory. Include the arch in the name
	mv -f $(DEBPKG_BASE)/../stratux.deb ./stratux-$(VERSIONSTR)-$(ARCH).deb

clean:
	rm -f stratuxrun libdump978.so fancontrol ahrs_approx *.deb
	cd dump1090 && make clean
	cd dump978 && make clean
	cd rtl-ais && make clean


# docker targets for ease of use
#
# NOTE: 'clean' works outside of docker
dall:
	./docker_run.sh "cd data && make all"

ddpkg:
	./docker_run.sh "cd data && make dpkg"
