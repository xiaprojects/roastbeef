#!/bin/bash
VER=$(git describe --tags --abbrev=0)
if [ "${VER:0:1}" == "v" ]; then
	VER=${VER:1}
fi
echo $VER
