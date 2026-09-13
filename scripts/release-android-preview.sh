#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VOXFLAME_SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_DIR="$ROOT_DIR/apps/mobile-workbench"
RELEASE_DIR="$ROOT_DIR/releases/android"
DOWNLOAD_CACHE_DIR="$RELEASE_DIR/.downloads"
PUBLIC_URL="${VOXFLAME_ANDROID_DOWNLOAD_URL:-https://voxember.com/download/android}"
LOCK_PATH="${TMPDIR:-/tmp}/voxflame-android-preview-release.lock"
MODE="${1:-build}"
ARTIFACT_OUTPUT_DIR="${2:-}"
# Only GitHub owns publication. This helper can produce artifacts, never serve them.
if [[ "$MODE" != "build-artifact" || -z "$ARTIFACT_OUTPUT_DIR" ]]; then
  echo "Direct Android publication retired; run Android Preview Release on main in GitHub Actions." >&2
  echo "Artifact-only usage: $0 build-artifact <output-directory>" >&2
  exit 2
fi

exec 9>"$LOCK_PATH"
if ! flock -n 9; then
  echo "Another Android preview release is already running." >&2
  exit 1
fi

for command_name in curl node npm sha256sum unzip; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

mkdir -p "$RELEASE_DIR" "$DOWNLOAD_CACHE_DIR"
# Stage build outputs locally; publication belongs exclusively to GitHub Actions.
work_dir="$(mktemp -d "$RELEASE_DIR/.publish-XXXXXX")"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

read_build_field() {
  node "$APP_DIR/scripts/read-eas-android-build.mjs" "$1" "$2"
}

echo "[voxflame] Reading the latest finished Android preview build..."
(
  cd "$APP_DIR"
  bash scripts/with-expo-token.sh npx --yes eas-cli@latest build:list \
    --platform android --build-profile preview --status finished \
    --limit 1 --json --non-interactive
) > "$work_dir/latest.json"

latest_build_code="$(read_build_field "$work_dir/latest.json" appBuildVersion)"
latest_app_version="$(read_build_field "$work_dir/latest.json" appVersion)"
echo "[voxflame] Validating Mobile Workbench before release..."
npm --prefix "$APP_DIR" run check
npm --prefix "$APP_DIR" run typecheck
npm --prefix "$APP_DIR" run test:training
node "$APP_DIR/scripts/prepare-android-preview-release.mjs" \
  "$latest_build_code" "$latest_app_version"

git -C "$ROOT_DIR" diff --binary -- apps/mobile-workbench/app.json apps/mobile-workbench/package.json apps/mobile-workbench/package-lock.json > "$work_dir/version.patch"
echo "[voxflame] Starting EAS Android preview build..."
(
  cd "$APP_DIR"
  bash scripts/with-expo-token.sh npx --yes eas-cli@latest build \
    --platform android --profile preview --wait --json --non-interactive \
    --message "VoxFlame website Android preview release"
) > "$work_dir/build.json"

build_status="$(read_build_field "$work_dir/build.json" status)"
if [[ "$build_status" != "FINISHED" ]]; then
  echo "EAS Android build did not finish successfully: $build_status" >&2
  exit 1
fi

build_id="$(read_build_field "$work_dir/build.json" id)"
build_url="$(read_build_field "$work_dir/build.json" buildUrl)"
app_version="$(read_build_field "$work_dir/build.json" appVersion)"
app_build_version="$(read_build_field "$work_dir/build.json" appBuildVersion)"
completed_at="$(read_build_field "$work_dir/build.json" completedAt)"
git_commit_hash="$(read_build_field "$work_dir/build.json" gitCommitHash)"

echo "[voxflame] Downloading build $build_id..."
cached_apk_path="$DOWNLOAD_CACHE_DIR/$build_id.apk"
partial_apk_path="$DOWNLOAD_CACHE_DIR/$build_id.apk.part"
if [[ ! -f "$cached_apk_path" ]]; then
  curl --fail --location --retry 8 --retry-all-errors \
    --connect-timeout 30 --speed-limit 1024 --speed-time 120 \
    --continue-at - --output "$partial_apk_path" "$build_url"
  unzip -tq "$partial_apk_path" >/dev/null
  mv -f "$partial_apk_path" "$cached_apk_path"
fi
unzip -tq "$cached_apk_path" >/dev/null
cp "$cached_apk_path" "$work_dir/VoxFlame-Android.apk"

apk_sha256="$(sha256sum "$work_dir/VoxFlame-Android.apk" | awk '{print $1}')"
apk_size="$(stat -c '%s' "$work_dir/VoxFlame-Android.apk")"

node --input-type=module - "$work_dir/metadata.json" "$build_id" "$app_version" "$app_build_version" "$completed_at" "$git_commit_hash" "$apk_sha256" "$apk_size" "$PUBLIC_URL" <<'NODE'
import { writeFileSync } from 'node:fs'

const [
  outputPath,
  buildId,
  appVersion,
  appBuildVersion,
  completedAt,
  gitCommitHash,
  sha256,
  sizeBytes,
  publicUrl,
] = process.argv.slice(2)

writeFileSync(outputPath, `${JSON.stringify({
  buildId,
  appVersion,
  appBuildVersion,
  completedAt,
  gitCommitHash,
  sha256,
  sizeBytes: Number(sizeBytes),
  publicUrl,
  artifactCreatedAt: new Date().toISOString(),
}, null, 2)}\n`)
NODE

if [[ "$MODE" == "build-artifact" ]]; then
  mkdir -p "$ARTIFACT_OUTPUT_DIR"
  cp "$work_dir/version.patch" "$ARTIFACT_OUTPUT_DIR/version.patch"
  mv -f "$work_dir/VoxFlame-Android.apk" "$ARTIFACT_OUTPUT_DIR/VoxFlame-Android.apk"
  mv -f "$work_dir/metadata.json" "$ARTIFACT_OUTPUT_DIR/VoxFlame-Android.json"
  echo "[voxflame] Android preview artifact ready"
  echo "  version: $app_version ($app_build_version)"
  echo "  build:   $build_id"
  echo "  sha256:  $apk_sha256"
  echo "  bytes:   $apk_size"
  echo "  path:    $ARTIFACT_OUTPUT_DIR"
  exit 0
fi
