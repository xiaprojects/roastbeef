#!/bin/bash

echo "Update Pong Script"
if [ $# -lt 1 ]; then
	echo "Need to pass path for update"
	exit -1
fi
fname=$1
destdir="/tmp/pong-update"
rm -rf $destdir
mkdir $destdir
echo "Unpacking $fname to $destdir"
unzip -x $fname -d $destdir
exit 0
