#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${VOXFLAME_SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_DIR="$ROOT_DIR/apps/mobile-workbench"
RELEASE_DIR="$ROOT_DIR/releases/android"
APK_PATH="$RELEASE_DIR/VoxFlame-Android.apk"
METADATA_PATH="$RELEASE_DIR/VoxFlame-Android.json"
DOWNLOAD_CACHE_DIR="$RELEASE_DIR/.downloads"
PUBLIC_URL="${VOXFLAME_ANDROID_DOWNLOAD_URL:-https://voxember.com/download/android}"
LOCK_PATH="${TMPDIR:-/tmp}/voxflame-android-preview-release.lock"
MODE="${1:-build}"
ARTIFACT_OUTPUT_DIR="${2:-}"
SERVER_RECEIVER="${VOXFLAME_ANDROID_SERVER_RECEIVER:-/usr/local/libexec/voxflame-receive-android-ci-artifact}"
SERVER_RECEIVER_USER="${VOXFLAME_ANDROID_SERVER_RECEIVER_USER:-voxflame-release}"

if [[ "$MODE" != "build" && "$MODE" != "publish-latest" && "$MODE" != "build-artifact" ]]; then
  echo "Usage: $0 [build|publish-latest|build-artifact <output-directory>]" >&2
  exit 1
fi
if [[ "$MODE" == "build-artifact" && -z "$ARTIFACT_OUTPUT_DIR" ]]; then
  echo "build-artifact requires an output directory" >&2
  exit 1
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
# Keep the staging directory on the same filesystem as the public APK so the
# final rename is atomic for concurrent downloads.
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
if [[ "$MODE" == "build" || "$MODE" == "build-artifact" ]]; then
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
else
  cp "$work_dir/latest.json" "$work_dir/build.json"
fi

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

if [[ "$MODE" == "build" && -x "$SERVER_RECEIVER" ]] \
  && id -u "$SERVER_RECEIVER_USER" >/dev/null 2>&1; then
  echo "[voxflame] Publishing through the production Android receiver..."
  cp "$work_dir/metadata.json" "$work_dir/VoxFlame-Android.json"
  tar -C "$work_dir" -cf - VoxFlame-Android.apk VoxFlame-Android.json \
    | sudo -n -u "$SERVER_RECEIVER_USER" "$SERVER_RECEIVER"
  exit 0
fi

current_build_id=""
if [[ -f "$METADATA_PATH" ]]; then
  current_build_id="$(node --input-type=module - "$METADATA_PATH" <<'NODE'
import { readFileSync } from 'node:fs'

const metadata = JSON.parse(readFileSync(process.argv[2], 'utf8'))
process.stdout.write(typeof metadata.buildId === 'string' ? metadata.buildId : '')
NODE
)"
fi

if [[ -n "$current_build_id" && "$current_build_id" != "$build_id" ]]; then
  if [[ -f "$APK_PATH" ]]; then
    cp -f "$APK_PATH" "$RELEASE_DIR/VoxFlame-Android.previous.apk"
  fi
  cp -f "$METADATA_PATH" "$RELEASE_DIR/VoxFlame-Android.previous.json"
fi
mv -f "$work_dir/VoxFlame-Android.apk" "$APK_PATH"
mv -f "$work_dir/metadata.json" "$METADATA_PATH"

echo "[voxflame] Recreating Caddy with the release-directory mount..."
if [[ -n "${VOXFLAME_DOCKER_PREFIX:-}" ]]; then
  # shellcheck disable=SC2206
  docker_prefix=( ${VOXFLAME_DOCKER_PREFIX} )
else
  docker_prefix=( sudo )
fi
"${docker_prefix[@]}" docker compose -f "$ROOT_DIR/docker-compose.yml" \
  --project-directory "$ROOT_DIR" --profile https up -d --no-deps --force-recreate caddy

echo "[voxflame] Verifying the permanent website download URL..."
remote_headers="$work_dir/headers.txt"
curl --fail --silent --show-error --location \
  --range 0-0 --dump-header "$remote_headers" --output /dev/null "$PUBLIC_URL"
if ! grep -iq '^content-type: application/vnd.android.package-archive' "$remote_headers"; then
  echo "Unexpected Android download content type at $PUBLIC_URL" >&2
  sed -n '1,40p' "$remote_headers" >&2
  exit 1
fi

echo "[voxflame] Android preview published"
echo "  version: $app_version ($app_build_version)"
echo "  build:   $build_id"
echo "  sha256:  $apk_sha256"
echo "  bytes:   $apk_size"
echo "  url:     $PUBLIC_URL"
