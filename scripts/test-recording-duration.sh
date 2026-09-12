#!/usr/bin/env bash
# Only touches a uniquely named, network-isolated disposable compose project.
set -euo pipefail
cd "$(dirname "$0")/.."
project="voxflame-duration-test-$$"
compose=(docker compose -p "$project" -f supabase/tests/recording-duration.compose.yml)
if ! docker info >/dev/null 2>&1; then compose=(sudo -n "${compose[@]}"); fi
cleanup() { "${compose[@]}" down >/dev/null; }
trap cleanup EXIT
"${compose[@]}" up -d --wait
"${compose[@]}" cp supabase db:/tmp/supabase
psql_test() { "${compose[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d recording_duration_test "$@"; }
psql_test -f /tmp/supabase/tests/recording-duration-bootstrap.sql
psql_test -f /tmp/supabase/tests/recording-duration.sql
# Independent DB sessions contend on the same recording and then on the account counter.
pids=()
for n in $(seq 1 12); do
  psql_test -q -c "INSERT INTO voice_contributions (contributor_id,audio_path,transcript,duration_seconds,metadata) VALUES ('concurrent','retry-$n.wav','test',2,'{\"recording_id\":\"one-capture\",\"upload_receipt\":{\"manifest_synced\":true}}');" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
pids=()
for n in $(seq 1 12); do
  psql_test -q -c "INSERT INTO voice_contributions (contributor_id,audio_path,transcript,duration_seconds,metadata) VALUES ('concurrent','new-$n.wav','same sentence',3,'{\"recording_id\":\"capture-$n\",\"upload_receipt\":{\"manifest_synced\":true}}');" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
psql_test -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM recording_duration_totals WHERE contributor_id='concurrent' AND total_duration_seconds=38 AND recording_count=13) THEN RAISE EXCEPTION 'concurrent accounting failed'; END IF; END \$\$;"
echo 'PASS: backfill, retry, re-recording, cleanup, dates, permissions, erasure, rollback and concurrent accounting'
