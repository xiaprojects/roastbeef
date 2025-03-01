#!/bin/bash -e
# Install Stratux

DEB_NAME=`cd ../../stratux && ls -1t *.deb | head -1`

DEB_FILENAME_TMP=${ROOTFS_DIR}/tmp/${DEB_NAME}

# copy dpkg into /tmp directory so its available in the chroot
(cp ../../stratux/${DEB_NAME} ${DEB_FILENAME_TMP})
on_chroot << EOF
    # needed for OGN for some reason
    apt install --yes libjpeg62-turbo
    # needed for dump1090
    apt install -y libncurses6 
    dpkg -i /tmp/${DEB_NAME}
EOF

# remove the dpkg file from tmp
rm ${DEB_FILENAME_TMP}
