#!/usr/bin/env bash
set -euo pipefail
echo 'Legacy GitHub bootstrap retired: it overwrote environment protection and mixed build/deploy credentials.' >&2
echo 'Use research/operations/APP_RELEASE.md; Android Preview Release on main is the sole website release owner.' >&2
exit 2
