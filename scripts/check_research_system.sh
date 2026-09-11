#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="${ROOT_DIR}/references/clear-vox-model"
EXPECTED_UPSTREAM_COMMIT="0997c0dc941ad0cda39e3ab92d5efd783fbfc38f"

required_files=(
  ".gitmodules"
  "research/README.md"
  "research/SOURCE_REGISTRY.yaml"
  "research/SOURCE_ROUTING.md"
  "research/EXPERT_WATCHLIST.yaml"
  "research/RESEARCH_HARNESS.md"
  "research/OUTCOME_REVIEW.md"
  "research/PIPELINE.yaml"
  "research/FEEDBACK_REGISTRY.yaml"
  "research/HARNESS_RULES.yaml"
  "research/evidence/RO-000.yaml"
  "research/outcome-reviews/RO-000.md"
  "research/templates/RESEARCH_OPPORTUNITY_TEMPLATE.md"
  "research/templates/SCENARIO_PILOT_TEMPLATE.md"
  "research/templates/SCHOLARLY_IP_TEMPLATE.md"
  "research/templates/OUTCOME_REVIEW_REPORT_TEMPLATE.md"
  "research/templates/EVIDENCE_PACKAGE_TEMPLATE.yaml"
  "research/templates/FEEDBACK_ENTRY_TEMPLATE.yaml"
  "research/agent-systems/README.md"
  "research/APPLICATION_FEEDBACK_REGISTRY.md"
  "research/UPSTREAM_INTEGRATION_STATUS.md"
  "research/voice-agent/README.md"
  "research/speech-health/README.md"
  "research/product-psychology/README.md"
  "research/product-engineering/README.md"
  "research/templates/RESEARCH_NOTE_TEMPLATE.md"
  "research/templates/EXPERIMENT_TO_APPLICATION_TEMPLATE.md"
)

for rel in "${required_files[@]}"; do
  if [[ ! -f "${ROOT_DIR}/${rel}" ]]; then
    echo "Missing research system file: ${rel}" >&2
    exit 1
  fi
done

python3 "${ROOT_DIR}/scripts/check_research_sources.py"
python3 "${ROOT_DIR}/scripts/check_research_harness.py"
python3 "${ROOT_DIR}/scripts/research/voice_benchmark.py" --check-registered
python3 -m unittest discover -s "${ROOT_DIR}/scripts/research/tests" -q

if ! grep -qF 'path = references/clear-vox-model' "${ROOT_DIR}/.gitmodules"; then
  echo "CLEAR-VOX-MODEL submodule path is not registered" >&2
  exit 1
fi

if ! grep -qF 'git@github.com:voxflame/CLEAR-VOX-MODEL.git' "${ROOT_DIR}/.gitmodules"; then
  echo "CLEAR-VOX-MODEL submodule URL is not the expected SSH URL" >&2
  exit 1
fi

if [[ ! -e "${UPSTREAM_DIR}/.git" ]]; then
  echo "CLEAR-VOX-MODEL is not initialized; run git submodule update --init --recursive" >&2
  exit 1
fi

actual_commit="$(git -C "${UPSTREAM_DIR}" rev-parse HEAD)"
if [[ "${actual_commit}" != "${EXPECTED_UPSTREAM_COMMIT}" ]]; then
  echo "Unexpected CLEAR-VOX-MODEL commit: ${actual_commit}" >&2
  exit 1
fi

upstream_exp_index="${UPSTREAM_DIR}/modules/dsr/R&D/Qwen3-ASR/EXP/EXP-INDEX.md"
if [[ ! -f "${upstream_exp_index}" ]]; then
  echo "Missing upstream Qwen3-ASR experiment index" >&2
  exit 1
fi

for status in adopt validate hold reject; do
  if ! grep -qF "\`${status}\`" "${ROOT_DIR}/research/APPLICATION_FEEDBACK_REGISTRY.md"; then
    echo "Application feedback registry does not define/use status: ${status}" >&2
    exit 1
  fi
done

if [[ -e "${ROOT_DIR}/docs" ]]; then
  echo "Legacy docs directory has returned; use research/ as the only documentation root." >&2
  exit 1
fi

echo "Research system check passed at CLEAR-VOX-MODEL ${actual_commit}."
