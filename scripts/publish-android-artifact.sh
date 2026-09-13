#!/usr/bin/env bash
# Receiver primitive, not a build scheduler. Only the main GitHub workflow delivers here.
set -euo pipefail
if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo "Usage: $0 <apk> <metadata-json> <release-directory> [public-url]" >&2
  exit 1
fi
SOURCE_APK="$1"
SOURCE_METADATA="$2"
RELEASE_DIR="$3"
PUBLIC_URL="${4:-https://voxember.com/download/android}"
for command_name in curl python3 sha256sum unzip flock; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 1; }
done
for path in "$SOURCE_APK" "$SOURCE_METADATA"; do
  [[ -f "$path" && ! -L "$path" ]] || { echo 'Invalid artifact file' >&2; exit 1; }
done
mkdir -p "$RELEASE_DIR"
exec 9>"$RELEASE_DIR/.publish.lock"
flock -n 9 || { echo 'Another Android publish is running' >&2; exit 1; }
work_dir="$(mktemp -d "$RELEASE_DIR/.deploy-XXXXXX")"
switched=0
backup_dir=''
files=(VoxFlame-Android.apk VoxFlame-Android.json VoxFlame-Android.previous.apk VoxFlame-Android.previous.json)
cleanup() {
  status=$?
  trap - EXIT
  if [[ "$status" != 0 && "$switched" == 1 ]]; then
    echo 'Public verification failed; restoring pre-release files' >&2
    for name in "${files[@]}"; do
      if [[ -f "$backup_dir/$name" ]]; then
        cp -p "$backup_dir/$name" "$work_dir/restore"
        mv -f "$work_dir/restore" "$RELEASE_DIR/$name"
      else
        rm -f "$RELEASE_DIR/$name"
      fi
    done
  fi
  rm -f "$work_dir"/*
  rmdir "$work_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cp "$SOURCE_APK" "$work_dir/VoxFlame-Android.apk"
cp "$SOURCE_METADATA" "$work_dir/VoxFlame-Android.json"
# Validate the staged bytes, not a mutable caller path. Never evaluate artifact content.
python3 - "$work_dir" "$RELEASE_DIR" <<'PY'
import hashlib, json, re, sys, zipfile
from pathlib import Path
stage, release = map(Path, sys.argv[1:])
m = json.loads((stage / 'VoxFlame-Android.json').read_text())
apk = stage / 'VoxFlame-Android.apk'
def require(ok, message):
    if not ok:
        raise SystemExit(message)
def digest(path):
    with path.open('rb') as stream:
        h = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
        return h.hexdigest()
require(re.fullmatch(r'[a-f0-9]{40}', str(m.get('sourceSha', ''))) is not None, 'Missing source SHA')
require(m['sourceSha'] == m.get('gitCommitHash'), 'Source SHA mismatch')
require(re.fullmatch(r'[1-9][0-9]{0,15}', str(m.get('candidateRunId', ''))) is not None, 'Missing workflow run')
require(bool(m.get('buildId')) and bool(m.get('appVersion')), 'Missing build identity')
require(re.fullmatch(r'[1-9][0-9]{0,9}', str(m.get('appBuildVersion', ''))) is not None, 'Invalid version code')
require(digest(apk) == m.get('sha256') and apk.stat().st_size == m.get('sizeBytes'), 'Artifact integrity failed')
with zipfile.ZipFile(apk) as archive:
    require(archive.testzip() is None and 'AndroidManifest.xml' in archive.namelist(), 'Invalid APK')
current = release / 'VoxFlame-Android.json'
current_apk = release / 'VoxFlame-Android.apk'
require(current.exists() == current_apk.exists(), 'Incomplete current release; repair before publication')
for name in ('VoxFlame-Android.apk', 'VoxFlame-Android.json', 'VoxFlame-Android.previous.apk', 'VoxFlame-Android.previous.json'):
    path = release / name
    require(not path.is_symlink() and (not path.exists() or path.is_file()), 'Unsafe release path')
if current.exists():
    old = json.loads(current.read_text())
    require(digest(current_apk) == old['sha256'] and current_apk.stat().st_size == old['sizeBytes'], 'Current release corrupt')
    code, old_code = int(m['appBuildVersion']), int(old['appBuildVersion'])
    require(code >= old_code, 'Version downgrade refused')
    if code == old_code:
        require(all(m.get(k) == old.get(k) for k in ('sha256', 'buildId', 'gitCommitHash', 'appVersion')), 'Same version with different artifact refused')
PY

verify_public() {
  curl --fail --silent --show-error --location --retry 2 --connect-timeout 20 --max-time 180 \
    --dump-header "$work_dir/headers.txt" --output "$work_dir/public.apk" "$PUBLIC_URL"
  grep -iq '^content-type: application/vnd.android.package-archive' "$work_dir/headers.txt"
  grep -iq '^cache-control: no-store' "$work_dir/headers.txt"
  cmp "$work_dir/public.apk" "$work_dir/VoxFlame-Android.apk"
}
if [[ -f "$RELEASE_DIR/VoxFlame-Android.apk" ]] && cmp -s "$work_dir/VoxFlame-Android.apk" "$RELEASE_DIR/VoxFlame-Android.apk"; then
  verify_public
  echo '[voxflame] Identical Android release already public; previous backup unchanged'
  exit 0
fi
# Retain both generations before touching the served files. A failed publish cannot erase rollback assets.
mkdir -p "$RELEASE_DIR/.history"
backup_dir="$(mktemp -d "$RELEASE_DIR/.history/release-XXXXXXXX")"
for name in "${files[@]}"; do
  if [[ -f "$RELEASE_DIR/$name" ]]; then cp -p "$RELEASE_DIR/$name" "$backup_dir/$name"; fi
done
chmod 0640 "$work_dir/VoxFlame-Android.apk" "$work_dir/VoxFlame-Android.json"
switched=1
# Each rename is atomic for concurrent APK downloads; handled errors/signals restore the pair (not power loss or SIGKILL).
cp -p "$work_dir/VoxFlame-Android.apk" "$work_dir/next.apk"
cp -p "$work_dir/VoxFlame-Android.json" "$work_dir/next.json"
mv -f "$work_dir/next.apk" "$RELEASE_DIR/VoxFlame-Android.apk"
mv -f "$work_dir/next.json" "$RELEASE_DIR/VoxFlame-Android.json"
verify_public
if [[ -f "$backup_dir/VoxFlame-Android.apk" ]]; then
  cp -p "$backup_dir/VoxFlame-Android.apk" "$work_dir/previous.apk"
  cp -p "$backup_dir/VoxFlame-Android.json" "$work_dir/previous.json"
  mv -f "$work_dir/previous.apk" "$RELEASE_DIR/VoxFlame-Android.previous.apk"
  mv -f "$work_dir/previous.json" "$RELEASE_DIR/VoxFlame-Android.previous.json"
fi
switched=0
echo '[voxflame] Android artifact published and full public bytes verified'
sha256sum "$RELEASE_DIR/VoxFlame-Android.apk"
