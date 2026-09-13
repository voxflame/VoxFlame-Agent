#!/usr/bin/env bash
# One-time/idempotent migration; never deletes build caches or release artifacts.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "$EUID" != 0 ]]; then echo 'Run as root to retire the legacy Android scheduler' >&2; exit 1; fi
backup_dir="$(mktemp -d /var/backups/voxflame-android-retire-XXXXXXXX)"
chmod 0700 "$backup_dir"
units=(voxflame-android-main-sync.timer voxflame-android-main-sync.service)
for unit in "${units[@]}"; do
  state="$(systemctl show "$unit" --property=LoadState --value)"
  if [[ "$state" != 'not-found' && "$state" != 'masked' ]]; then
    systemctl disable --now "$unit"
  fi
  if systemctl is-active --quiet "$unit"; then echo "Still active: $unit" >&2; exit 1; fi
  path="/etc/systemd/system/$unit"
  if [[ -e "$path" || -L "$path" ]]; then
    if [[ -L "$path" && "$(readlink "$path")" == /dev/null ]]; then continue; fi
    mv "$path" "$backup_dir/$unit"
  fi
  systemctl mask "$unit"
done
installed=/usr/local/libexec/voxflame-android-main-sync
if [[ -e "$installed" ]]; then cp -p "$installed" "$backup_dir/voxflame-android-main-sync"; fi
install -m 0755 "$ROOT_DIR/scripts/ops/sync-android-main-release.sh" "$installed"
systemctl daemon-reload
for unit in "${units[@]}"; do
  [[ "$(systemctl is-enabled "$unit")" == masked ]]
  if systemctl is-active --quiet "$unit"; then exit 1; fi
done
echo "Legacy Android scheduler retired; backups: $backup_dir"
