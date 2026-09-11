#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required_files=(
  "AGENTS.md"
  "CLAUDE.md"
  ".github/copilot-instructions.md"
  ".claude-summary.md"
  ".tasks/current.md"
  "research/README.md"
  "research/AI_ENGINEERING_SYSTEM.md"
  "research/APPLICATION_FEEDBACK_REGISTRY.md"
  "research/templates/AI_EXECUTION_PLAN_TEMPLATE.md"
  "research/speech-health/MANDARIN_RECORDING_CORPUS_EVIDENCE_GATE.md"
  "research/aiprompts/HARNESS_ENTRY_CONTRACT.md"
  "research/HARNESS_RULES.yaml"
  "scripts/research/check-research-triggers.py"
  "scripts/research/create-feedback-entry.py"
  "scripts/research/validate-research-loop.py"
)

assert_file() {
  local rel="$1"
  if [[ ! -f "${ROOT_DIR}/${rel}" ]]; then
    echo "Missing required file: ${rel}" >&2
    exit 1
  fi
}

assert_contains() {
  local rel="$1"
  local expected="$2"
  if ! grep -qF "${expected}" "${ROOT_DIR}/${rel}"; then
    echo "Expected '${expected}' in ${rel}" >&2
    exit 1
  fi
}

for rel in "${required_files[@]}"; do
  assert_file "${rel}"
done

for rel in "AGENTS.md" "CLAUDE.md" ".github/copilot-instructions.md"; do
  assert_contains "${rel}" ".claude-summary.md"
  assert_contains "${rel}" ".tasks/current.md"
  assert_contains "${rel}" "research/AI_ENGINEERING_SYSTEM.md"
  assert_contains "${rel}" "发现需求 → 实现 → 优化 → 测试 → 迭代"
  assert_contains "${rel}" "VOICE_AGENT_BENCHMARK_PROTOCOL.md"
done

if [[ -e "${ROOT_DIR}/docs" ]]; then
  echo "Legacy docs directory has returned; use research/ as the only documentation root." >&2
  exit 1
fi

assert_contains "research/README.md" "AI_ENGINEERING_SYSTEM.md"
assert_contains "research/README.md" "AI_EXECUTION_PLAN_TEMPLATE.md"
assert_contains "AGENTS.md" "research/APPLICATION_FEEDBACK_REGISTRY.md"
assert_contains "AGENTS.md" "可复现证据门"
assert_contains "AGENTS.md" "HARNESS_ENTRY_CONTRACT.md"
assert_contains "AGENTS.md" "HARNESS_RULES.yaml"
assert_contains "research/AI_ENGINEERING_SYSTEM.md" "普通话录音语料"

bash "${ROOT_DIR}/scripts/check_research_system.sh"

echo "AI docs harness check passed."
