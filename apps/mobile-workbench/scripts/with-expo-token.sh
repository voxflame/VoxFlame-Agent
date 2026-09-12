#!/usr/bin/env bash

set -euo pipefail

token_file="${XDG_CONFIG_HOME:-$HOME/.config}/voxflame/expo-token"
EXPO_TOKEN="${EXPO_TOKEN:-}"

if [ -z "$EXPO_TOKEN" ] && [ -f "$token_file" ]; then
  EXPO_TOKEN="$(tr -d '\r\n' < "$token_file")"
  export EXPO_TOKEN
fi

# Normalize file/CI secrets alike; a copied trailing newline invalidates HTTP auth.
EXPO_TOKEN="$(printf '%s' "$EXPO_TOKEN" | tr -d '\r\n')"
export EXPO_TOKEN

if [ "${#EXPO_TOKEN}" -lt 20 ]; then
  echo "没有可用的 Expo Token。请先运行 npm run eas:save-token。" >&2
  exit 1
fi

unset HTTP_PROXY HTTPS_PROXY NODE_TLS_REJECT_UNAUTHORIZED

exec "$@"
