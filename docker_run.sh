#!/bin/bash

MY_UID="$(id -u)" MY_GID="$(id -g)" docker compose run --service-ports --rm cli -c "$1"
