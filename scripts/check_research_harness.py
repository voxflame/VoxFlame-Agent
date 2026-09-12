#!/usr/bin/env python3
"""Validate the repository-level research lifecycle harness without dependencies."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "research" / "PIPELINE.yaml"
FEEDBACK = ROOT / "research" / "FEEDBACK_REGISTRY.yaml"
EVIDENCE = ROOT / "research" / "evidence"
RULES = ROOT / "research" / "HARNESS_RULES.yaml"

STATES = {
    "discovered", "evidence_review", "experiment_ready", "experimenting", "outcome_review",
    "authority_review", "scholarly_ip", "software_copyright_review", "scenario_pilot", "adopted", "improving", "hold", "rejected",
}
REQUIRED_FIELDS = {
    "research_id", "title", "topic", "state", "owner", "problem", "target_scenario",
    "current_gate", "next_action", "evidence_package", "feedback_refs", "release_intents", "authority_gate", "review_report",
}


def field_value(block: str, field: str) -> str | None:
    match = re.search(rf"^    {re.escape(field)}:\s*(.*)$", block, flags=re.MULTILINE)
    return match.group(1).strip() if match else None


def main() -> int:
    errors: list[str] = []
    for path in (PIPELINE, FEEDBACK):
        if not path.is_file():
            errors.append(f"missing harness file: {path.relative_to(ROOT)}")
    if not EVIDENCE.is_dir():
        errors.append("missing research/evidence directory")
    if not RULES.is_file():
        errors.append("missing research/HARNESS_RULES.yaml")
    if errors:
        print("\n".join(f"ERROR: {item}" for item in errors), file=sys.stderr)
        return 1

    pipeline = PIPELINE.read_text(encoding="utf-8")
    for field in REQUIRED_FIELDS:
        if f"  - {field}" not in pipeline:
            errors.append(f"PIPELINE missing required field declaration: {field}")

    entry_matches = list(re.finditer(r"^  - research_id:\s*(\S+)$", pipeline, flags=re.MULTILINE))
    if not entry_matches:
        errors.append("PIPELINE has no entries")
    seen: set[str] = set()
    for index, match in enumerate(entry_matches):
        entry_end = entry_matches[index + 1].start() if index + 1 < len(entry_matches) else len(pipeline)
        block = pipeline[match.start():entry_end]
        research_id = match.group(1)
        if research_id in seen:
            errors.append(f"duplicate research_id: {research_id}")
        seen.add(research_id)
        state = re.search(r"^    state:\s*(\S+)$", block, flags=re.MULTILINE)
        if state and state.group(1) not in STATES:
            errors.append(f"{research_id}: unknown state {state.group(1)}")
        evidence_ref = re.search(r"^    evidence_package:\s*(\S+)$", block, flags=re.MULTILINE)
        if evidence_ref:
            path = ROOT / evidence_ref.group(1)
            if not path.is_file():
                errors.append(f"{research_id}: evidence package missing: {evidence_ref.group(1)}")
        feedback_ref = re.search(r"^    feedback_refs:\s*(.*)$", block, flags=re.MULTILINE)
        if not feedback_ref:
            errors.append(f"{research_id}: feedback_refs missing")
        if not re.search(r"^    release_intents:\s*", block, flags=re.MULTILINE):
            errors.append(f"{research_id}: release_intents missing")
        if not re.search(r"^    authority_gate:\s*", block, flags=re.MULTILINE):
            errors.append(f"{research_id}: authority_gate missing")
        review_ref = re.search(r"^    review_report:\s*(\S+)$", block, flags=re.MULTILINE)
        if not review_ref or not (ROOT / review_ref.group(1)).is_file():
            errors.append(f"{research_id}: review_report missing or file does not exist")

    feedback = FEEDBACK.read_text(encoding="utf-8")
    required_feedback = re.findall(r"^  - (\w+)$", feedback[feedback.find("required_fields:"):feedback.find("states:")], flags=re.MULTILINE)
    expected_feedback = {"feedback_id", "research_id", "source", "observed_at", "scenario", "observation", "severity", "failure_type", "evidence_ref", "hypothesis", "owner", "action", "validation", "state"}
    if set(required_feedback) != expected_feedback:
        errors.append("FEEDBACK_REGISTRY required_fields do not cover observation, action and validation")
    if "accepted_risk" not in feedback or "resolved" not in feedback:
        errors.append("FEEDBACK_REGISTRY missing explicit resolution states")

    evidence_template = (EVIDENCE / "RO-000.yaml").read_text(encoding="utf-8")
    for required in ("authority_gate:", "authority_sources:", "counterevidence_recorded:", "population_device_scenario_bounds_recorded:", "failure_conditions:", "rollback_or_withdrawal:"):
        if required not in evidence_template:
            errors.append(f"evidence package missing authority gate field: {required}")

    if errors:
        print("\n".join(f"ERROR: {item}" for item in errors), file=sys.stderr)
        return 1
    print(f"Research harness check passed: {len(entry_matches)} pipeline entries, {len(list(EVIDENCE.glob('*.yaml')))} evidence packages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
