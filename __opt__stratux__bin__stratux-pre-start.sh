#!/bin/bash

#echo powersave >/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor

#Logging Function
SCRIPT=`basename ${BASH_SOURCE[0]}`
STX_LOG="/var/log/stratux.log"
function wLog () {
	echo "$(date +"%Y/%m/%d %H:%M:%S")  - $SCRIPT - $1" >> ${STX_LOG}
}
wLog "Running Stratux Updater Script."

TEMP_DIRECTORY="/boot/firmware/StratuxUpdates"

######################
# script based update
SCRIPT_MASK="update*stratux*v*.sh"
TEMP_SCRIPT_LOCATION="$TEMP_DIRECTORY/$SCRIPT_MASK"
SCRIPT_UPDATE_LOCATION="/root/$SCRIPT_MASK"

######################
# package based update
PACKAGE_MASK="stratux*.deb"
# packages are placed here after download, before movement to PACKAGE_UPDATE_LOCATION
TEMP_PACKAGE_LOCATION="$TEMP_DIRECTORY/$PACKAGE_MASK"
# packages are placed here for update
PACKAGE_UPDATE_LOCATION="/root/$PACKAGE_MASK"

###############
# script based update in download location
if [ -e ${TEMP_SCRIPT_LOCATION} ]; then
	wLog "Found Update Script in $TEMP_SCRIPT_LOCATION$SCRIPT_MASK"
	TEMP_SCRIPT_FILE=`ls -1t ${TEMP_SCRIPT_LOCATION} | head -1`
	wLog "Moving Update Script $TEMP_SCRIPT_FILE"
	cp -r ${TEMP_SCRIPT_FILE} /root/
	wLog "Changing permissions to chmod a+x $UPDATE_LOCATION"
	chmod a+x ${SCRIPT_UPDATE_LOCATION}
	wLog "Removing Script file from $TEMP_SCRIPT_LOCATION"
	rm -rf ${TEMP_SCRIPT_FILE}
fi

# script based update to apply
if [ -e ${SCRIPT_UPDATE_LOCATION} ]; then
	UPDATE_SCRIPT_FILE=`ls -1t ${SCRIPT_UPDATE_LOCATION} | head -1`
	if [ -n ${UPDATE_SCRIPT_FILE} ] ; then
		# Execute the script, remove it, then reboot.
		wLog "Installing update script ${UPDATE_SCRIPT_FILE}..."
		bash ${UPDATE_SCRIPT_FILE}
		wLog "Removing Update Script"
		rm -f ${UPDATE_SCRIPT_FILE}
		wLog "Finished... Rebooting... Bye"
		reboot
	fi
fi

##############
# package based update in download location
if [ -e ${TEMP_PACKAGE_LOCATION} ]; then
	wLog "Found Update Package in $TEMP_PACKAGE_LOCATION$PACKAGE_MASK"
	TEMP_PACKAGE_FILE=`ls -1t ${TEMP_PACAGE_LOCATION} | head -1`
	wLog "Moving Update Package $TEMP_PACKAGE_FILE"
	cp -r ${TEMP_PACKAGE_FILE} /root/
	wLog "Changing permissions to chmod a+x $PACKAGE_UPDATE_LOCATION"
	chmod a+x ${PACKAGE_UPDATE_LOCATION}
	wLog "Removing Update file from $TEMP_PACKAGE_LOCATION"
	rm -rf ${TEMP_PACKAGE_FILE}
fi

# package based update to apply
if [ -e ${PACKAGE_UPDATE_LOCATION} ]; then
	UPDATE_PACKAGE_FILE=`ls -1t ${PACKAGE_UPDATE_LOCATION} | head -1`
	if [ -n ${UPDATE_PACKAGE_FILE} ] ; then
		# Install the new packagepackage, remove it, then reboot.
		wLog "Installing update package ${UPDATE_PACKAGE_FILE}..."
		bash dpkg -i ${UPDATE_PACKAGE_FILE}
		wLog "Removing Update Package"
		rm -f ${UPDATE_PACKAGE_FILE}
		wLog "Finished... Rebooting... Bye"
		reboot
	fi
fi


if [ -f /boot/firmware/.stratux-first-boot ]; then
	rm /boot/firmware/.stratux-first-boot
	if [ -f /boot/firmware/stratux.conf ]; then
		# In case of US build, a stratux.conf file will always be imported, only containing UAT/OGN options.
		# We don't want to force-reboot for that.. Only for network/overlay changes
		do_reboot=false

		# re-apply overlay
		if [ "$(jq -r .PersistentLogging /boot/firmware/stratux.conf)" = "true" ]; then
			/sbin/overlayctl disable
			do_reboot=true
			wLog "overlayctl disabled due to stratux.conf settings"
		fi

		# write network config
		if grep -q WiFi /boot/firmware/stratux.conf ; then
			/opt/stratux/bin/stratuxrun -write-network-config
			do_reboot=true
			wLog "re-wrote network configuration for first-boot config import. Rebooting... Bye"
		fi
		if $do_reboot; then
			reboot
		fi
	fi
fi

wLog "Exited without updating anything..."
