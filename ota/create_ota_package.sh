#!/bin/bash
OTA_PACKAGE_NAME="avionics"
OTA_VERSION=$(cat ${OTA_PACKAGE_NAME}.version)
OTA_DATE=$(date +%Y%m%d)
OTA_FILE_NAME="${OTA_PACKAGE_NAME}-${OTA_VERSION}-${OTA_DATE}.tgz"
OTA_SERVICE_NAME="stratux"
STRATUX_PATH="/opt/stratux"
SYSTEMD_PATH="/lib/systemd/system"
RB_SETTINGS_PATH="/boot/firmware/rb"
RB_ADDON_PATH="/opt"

# omitting /boot/firmware/rb/rb-vor.json until we have a way to update it without overwriting user settings
tar -czf ${OTA_FILE_NAME} ${RB_SETTINGS_PATH}/alertsMapping.json \
     ${OTA_FILE_NAME} ${RB_SETTINGS_PATH}/databases \
     ${OTA_FILE_NAME} ${RB_SETTINGS_PATH}/deviation.json \
     ${OTA_FILE_NAME} ${RB_SETTINGS_PATH}/keypad.json \
     ${OTA_FILE_NAME} ${RB_SETTINGS_PATH}/navigation.json \
     ${OTA_FILE_NAME} ${RB_SETTINGS_PATH}/keypad.json \
    ${SYSTEMD_PATH}/${OTA_SERVICE_NAME}.service ${RB_ADDON_PATH}/${OTA_SERVICE_NAME} ${STRATUX_PATH}/${OTA_PACKAGE_NAME}.version