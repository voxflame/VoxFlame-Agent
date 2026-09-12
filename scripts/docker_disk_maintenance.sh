#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-status}"
PRUNE_UNTIL="${VOXFLAME_DOCKER_PRUNE_UNTIL:-168h}"
AUTO_ROOT_THRESHOLD_PERCENT="${VOXFLAME_DOCKER_AUTO_PRUNE_ROOT_THRESHOLD_PERCENT:-60}"

docker_cmd() {
  if [[ "${EUID}" -eq 0 ]]; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

print_status() {
  echo "[disk] root filesystem"
  df -h /
  echo
  echo "[docker] disk usage"
  docker_cmd system df
  echo
  echo "[docker] protected VoxFlame images"
  docker_cmd image ls --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}\t{{.Size}}' \
    | awk '$1 ~ /^voxflame-agent-/ && ($1 ~ /:latest$/ || $1 ~ /:pre-/) { print }'
  echo
  echo "[docker] dangling image candidates older than ${PRUNE_UNTIL}"
  docker_cmd image ls --filter dangling=true --filter "until=${PRUNE_UNTIL}" \
    --format '{{.ID}}\t{{.CreatedSince}}\t{{.Size}}'
  echo
  echo "[docker] stopped containers (container prune keeps only those older than ${PRUNE_UNTIL})"
  # `docker container ls` does not support the `until` filter on the Docker
  # version used by cpu1. The destructive prune command below does support it;
  # keep this status section informational and portable.
  docker_cmd container ls -a --filter status=created --filter status=exited \
    --format '{{.ID}}\t{{.Names}}\t{{.Status}}'
  echo
  echo "[docker] unused networks (informational; default networks are retained by prune rules)"
  docker_cmd network ls --filter scope=local --format '{{.ID}}\t{{.Name}}'
}

case "$MODE" in
  status)
    print_status
    ;;
  prune|prune-safe)
    print_status
    echo
    echo "[docker] pruning dangling images, stopped containers/networks older than ${PRUNE_UNTIL}, and all unused build cache"
    echo "[docker] build cache, stopped containers, and unused networks are disposable; running containers, named volumes, tagged latest images, and pre-* rollback images are preserved"
    docker_cmd image prune -f
    docker_cmd container prune -f --filter "until=${PRUNE_UNTIL}"
    docker_cmd network prune -f
    docker_cmd builder prune -af
    echo
    print_status
    ;;
  auto)
    root_usage_percent="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
    if [[ -z "${root_usage_percent}" ]]; then
      echo "[docker] unable to determine root filesystem usage; refusing automatic prune" >&2
      exit 1
    fi
    echo "[docker] automatic cleanup check: root=${root_usage_percent}% threshold=${AUTO_ROOT_THRESHOLD_PERCENT}%"
    if (( root_usage_percent < AUTO_ROOT_THRESHOLD_PERCENT )); then
      echo "[docker] below threshold; no cleanup performed"
      exit 0
    fi
    exec "$0" prune-safe
    ;;
  *)
    echo "Usage: $0 [status|prune-safe|auto]" >&2
    exit 1
    ;;
esac
