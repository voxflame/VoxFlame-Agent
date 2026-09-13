#!/usr/bin/env bash
set -euo pipefail
# Tombstone: old automation must fail closed, not create a second release owner.
echo "Retired: Android website releases are owned by GitHub Actions android-preview-release.yml on main." >&2
exit 2
