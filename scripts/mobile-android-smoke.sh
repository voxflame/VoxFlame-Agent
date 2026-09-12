#!/usr/bin/env bash
# Run only against the disposable CI emulator; never a user's connected phone.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/apps/mobile-workbench"
MAESTRO_BIN="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
mkdir -p maestro-debug
# Preserve the original failure while collecting diagnostics before emulator teardown.
trap 'status=$?; adb logcat -d > maestro-debug/logcat.txt 2>&1 || :; exit "$status"' EXIT
adb install -r android/app/build/outputs/apk/release/app-release.apk
"$MAESTRO_BIN" test --format junit --output maestro-boot-report.xml \
  --debug-output maestro-debug/boot .maestro/release-boot-smoke.yml
if [[ -n "${MAESTRO_TEST_EMAIL:-}" && -n "${MAESTRO_TEST_PASSWORD:-}" ]]; then
  "$MAESTRO_BIN" test -e MAESTRO_TEST_EMAIL="$MAESTRO_TEST_EMAIL" \
    -e MAESTRO_TEST_PASSWORD="$MAESTRO_TEST_PASSWORD" \
    --format junit --output maestro-authenticated-report.xml \
    --debug-output maestro-debug/authenticated .maestro/authenticated-release-smoke.yml
else
  message='Authenticated smoke NOT RUN: dedicated test credentials are not configured; boot smoke only.'
  echo "$message"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$message" >> "$GITHUB_STEP_SUMMARY"
  fi
fi
