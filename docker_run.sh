#!/bin/bash

my_uid=${MY_UID:-$(id -u)}
my_gid=${MY_GID:-$(id -g)}

MY_UID="${my_uid}" MY_GID="${my_gid}" docker compose run --service-ports --rm cli -c "$1"
