#!/usr/bin/env bash
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo 'This installer requires Linux.' >&2; exit 1; }
[[ $(id -u) != 0 ]] || { echo 'Run as the desktop user, without sudo.' >&2; exit 1; }
runtime=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
node_bin=$(command -v "${LANTO_NODE:-node}")
"$node_bin" -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<24 || (major===24 && minor<12)) process.exit(1)' || {
  echo 'Node.js 24.12 or newer is required.' >&2; exit 1;
}
entry="$runtime/app/host/cli.js"
[[ -f "$entry" ]] || { echo 'Place this script in a built Host runtime bundle.' >&2; exit 1; }
data_dir=${LANTO_HOST_DATA_DIR:-"$HOME/.lanto/host"}
"$node_bin" "$entry" init --data-dir "$data_dir" "$@"
unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"
unit="$unit_dir/lanto-host.service"
if [[ -f "$unit" ]]; then cp -p -- "$unit" "$unit.backup-$(date +%Y%m%d%H%M%S)"; fi
temporary=$(mktemp "$unit_dir/.lanto-host.XXXXXX.service")
trap 'rm -f -- "$temporary"' EXIT
"$node_bin" "$entry" service-file --data-dir "$data_dir" > "$temporary"
systemd-analyze --user verify "$temporary"
chmod 600 "$temporary"
mv -- "$temporary" "$unit"
systemctl --user daemon-reload
systemctl --user enable lanto-host.service
systemctl --user restart lanto-host.service
for attempt in {1..30}; do
  if "$node_bin" "$entry" status --data-dir "$data_dir" 2>/dev/null; then exit 0; fi
  sleep 1
done
echo 'Host did not become ready; inspect journalctl --user -u lanto-host.service.' >&2
exit 1
