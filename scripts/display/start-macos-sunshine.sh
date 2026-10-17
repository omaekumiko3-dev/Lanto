#!/bin/sh
# SPDX-License-Identifier: MIT
# Wait for the headless display before launching Sunshine through its usual command.
set -eu
display_helper="$1"
shift
attempt=0
while [ "$attempt" -lt 30 ]; do
  if "$display_helper" --check-ready; then
    exec "$@"
  fi
  attempt=$((attempt + 1))
  sleep 1
done
echo 'Lanto 4K display did not become ready; starting Sunshine with the available display.' >&2
exec "$@"
