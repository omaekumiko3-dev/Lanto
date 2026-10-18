#!/bin/sh
# SPDX-License-Identifier: MIT
set -eu
for attempt in $(seq 1 30); do
  /usr/bin/python3 "$HOME/.lanto/display/linux-virtual-display.py" --check-ready && exit 0
  sleep 1
done
echo 'Lanto virtual display was not ready' >&2
exit 1
