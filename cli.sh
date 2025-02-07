# Script for getting a cli interface into docker

echo "'cd data' to find the local files"
MY_UID="$(id -u)" MY_GID="$(id -g)" docker compose run --rm cli
