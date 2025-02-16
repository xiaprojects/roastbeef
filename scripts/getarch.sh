#!/bin/bash
ARCH=$(uname -m)
if [ "$ARCH" == "x86_64" ]; then
	ARCH="amd64"
fi
if [ "$ARCH" == "aarch64" ]; then
	ARCH="arm64"
fi
echo $ARCH
