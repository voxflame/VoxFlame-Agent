#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT="${VOXFLAME_HOST_HEALTH_STATE_ROOT:-/var/lib/voxflame-host-health}"
CURRENT_BOOT_ID="$(tr -d '\r\n' < /proc/sys/kernel/random/boot_id)"
PREVIOUS_BOOT_ID_PATH="$STATE_ROOT/boot-id"
LAST_SUCCESS_PATH="$STATE_ROOT/last-success"

mkdir -p "$STATE_ROOT"

if [[ -f "$PREVIOUS_BOOT_ID_PATH" ]]; then
  previous_boot_id="$(tr -d '\r\n' < "$PREVIOUS_BOOT_ID_PATH")"
  if [[ -n "$previous_boot_id" && "$previous_boot_id" != "$CURRENT_BOOT_ID" ]]; then
    previous_success="unknown"
    if [[ -f "$LAST_SUCCESS_PATH" ]]; then
      previous_success="$(tr -d '\r\n' < "$LAST_SUCCESS_PATH")"
    fi
    echo "[host-health] boot_changed previous=$previous_boot_id current=$CURRENT_BOOT_ID previous_probe=$previous_success"
  fi
fi
printf '%s\n' "$CURRENT_BOOT_ID" > "$PREVIOUS_BOOT_ID_PATH"

probe_http() {
  local name="$1"
  local url="$2"
  local output
  if output="$(curl -4 --silent --show-error --output /dev/null \
    --connect-timeout 3 --max-time 8 \
    --write-out 'code=%{http_code},dns=%{time_namelookup},connect=%{time_connect},tls=%{time_appconnect},total=%{time_total},remote=%{remote_ip}' \
    "$url" 2>&1)"; then
    echo "$name=$output"
  else
    output="${output//$'\n'/ }"
    echo "$name=failed:${output// /_}"
  fi
}

memory_available_kib="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
swap_free_kib="$(awk '/SwapFree:/ {print $2}' /proc/meminfo)"
root_usage="$(df --output=pcent / | tail -n 1 | tr -d ' ')"
load_average="$(cut -d' ' -f1-3 /proc/loadavg | tr ' ' ',')"
gateway="$(ip route show default | awk 'NR == 1 {print $3}')"
gateway_status="missing"
if [[ -n "$gateway" ]]; then
  gateway_status="route_present"
fi
if [[ -n "$gateway" ]] && ping -c 1 -W 1 "$gateway" >/dev/null 2>&1; then
  gateway_status="icmp_ok"
fi

github="$(probe_http github https://api.github.com)"
dashscope="$(probe_http dashscope https://dashscope.aliyuncs.com)"
production="$(probe_http production https://voxember.com/api/rtc/health)"

docker_state="unavailable"
if command -v docker >/dev/null 2>&1; then
  if docker_output="$(docker ps --format '{{.Names}}={{.Status}}' 2>/dev/null)"; then
    docker_state="$(printf '%s\n' "$docker_output" | paste -sd, -)"
    docker_state="${docker_state:-empty}"
  fi
fi

timestamp="$(date --iso-8601=seconds)"
echo "[host-health] ts=$timestamp boot=$CURRENT_BOOT_ID uptime_s=$(cut -d. -f1 /proc/uptime) mem_available_kib=$memory_available_kib swap_free_kib=$swap_free_kib root=$root_usage load=$load_average gateway=$gateway:$gateway_status $github $dashscope $production docker=$docker_state"
printf '%s\n' "$timestamp" > "$LAST_SUCCESS_PATH"
