#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v fail2ban-client >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban
fi

sudo install -d -m 0755 /etc/ssh/sshd_config.d /etc/fail2ban/jail.d
sudo install -m 0644 "$REPO_ROOT/infra/ssh/99-voxflame-hardening.conf" /etc/ssh/sshd_config.d/99-voxflame-hardening.conf
sudo install -m 0644 "$REPO_ROOT/infra/fail2ban/voxflame-sshd.local" /etc/fail2ban/jail.d/voxflame-sshd.local
sudo /usr/sbin/sshd -t

if [[ ! -e /swapfile ]]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 0600 /swapfile
  sudo mkswap /swapfile
fi

sudo install -m 0644 "$REPO_ROOT/infra/systemd/swapfile.swap" /etc/systemd/system/swapfile.swap
sudo install -m 0755 "$REPO_ROOT/scripts/ops/voxflame-host-health-probe.sh" /usr/local/libexec/voxflame-host-health-probe
sudo install -m 0644 "$REPO_ROOT/infra/systemd/voxflame-host-health-probe.service" /etc/systemd/system/voxflame-host-health-probe.service
sudo install -m 0644 "$REPO_ROOT/infra/systemd/voxflame-host-health-probe.timer" /etc/systemd/system/voxflame-host-health-probe.timer
sudo install -m 0755 "$REPO_ROOT/scripts/docker_disk_maintenance.sh" /usr/local/libexec/voxflame-docker-disk-maintenance
sudo install -m 0644 "$REPO_ROOT/infra/systemd/voxflame-docker-disk-maintenance.service" /etc/systemd/system/voxflame-docker-disk-maintenance.service
sudo install -m 0644 "$REPO_ROOT/infra/systemd/voxflame-docker-disk-maintenance.timer" /etc/systemd/system/voxflame-docker-disk-maintenance.timer
sudo install -d -m 0755 /etc/logrotate.d
sudo install -m 0644 "$REPO_ROOT/infra/logrotate/voxflame-host-logs" /etc/logrotate.d/voxflame-host-logs

sudo bash "$REPO_ROOT/scripts/ops/retire-android-main-sync.sh"

sudo systemctl daemon-reload
sudo systemctl enable --now swapfile.swap
sudo systemctl enable --now fail2ban
sudo systemctl reload ssh
sudo systemctl enable --now voxflame-host-health-probe.timer
sudo systemctl enable --now voxflame-docker-disk-maintenance.timer
sudo systemctl start voxflame-host-health-probe.service

echo "[voxflame] CPU1 reliability hardening installed."
