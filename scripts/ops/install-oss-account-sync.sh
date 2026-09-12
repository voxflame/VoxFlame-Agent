#!/usr/bin/env bash
# Isolated release: deliberately excludes pending backend duration migrations/runtime changes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
(cd backend && npm run test:oss-identity && npm run build)
release="/opt/voxflame-oss-account-sync/releases/$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 0755 "$release/ops" "$release/services"
sudo -n install -m 0644 backend/dist/ops/sync-oss-account-documents.js "$release/ops/"
sudo -n install -m 0644 backend/dist/services/oss-account-{identity,document}.js "$release/services/"
sudo -n ln -s "$ROOT/backend/node_modules" "$release/node_modules"
# Preflight before activating the release or timer (no OSS writes).
env NODE_TLS_REJECT_UNAUTHORIZED=1 VOXFLAME_BACKEND_ENV_FILE="$ROOT/backend/.env" node "$release/ops/sync-oss-account-documents.js"
sudo -n ln -sfn "$release" /opt/voxflame-oss-account-sync/current
sudo -n install -m 0644 infra/systemd/voxflame-oss-account-sync.{service,timer} /etc/systemd/system/
sudo -n systemctl daemon-reload
sudo -n systemctl start voxflame-oss-account-sync.service
sudo -n systemctl enable --now voxflame-oss-account-sync.timer
sudo -n systemctl show voxflame-oss-account-sync.service -p Result -p ExecMainStatus
sudo -n systemctl list-timers voxflame-oss-account-sync.timer --no-pager
