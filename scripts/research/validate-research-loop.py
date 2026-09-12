#!/usr/bin/env python3
"""Validate the complete Research Harness object graph and safety rules."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "research" / "PIPELINE.yaml"
FEEDBACK = ROOT / "research" / "FEEDBACK_REGISTRY.yaml"
RULES = ROOT / "research" / "HARNESS_RULES.yaml"
APPLICATION = ROOT / "research" / "APPLICATION_FEEDBACK_REGISTRY.md"


def local_path(value: str) -> Path | None:
    path = value.split("#", 1)[0]
    if path.startswith("research/"):
        return ROOT / path
    return None


def main() -> int:
    pipeline = yaml.safe_load(PIPELINE.read_text(encoding="utf-8"))
    feedback = yaml.safe_load(FEEDBACK.read_text(encoding="utf-8"))
    rules = yaml.safe_load(RULES.read_text(encoding="utf-8"))
    application_text = APPLICATION.read_text(encoding="utf-8")
    errors: list[str] = []
    feedback_by_id = {item["feedback_id"]: item for item in feedback.get("entries", [])}
    application_ids = set(re.findall(r"\| RF-(\d+) \|", application_text))
    allowed_research_states = set(rules["states"]["research"])
    allowed_feedback_states = set(rules["states"]["feedback"])
    for entry in pipeline.get("entries", []):
        rid = entry.get("research_id")
        if rid == "RO-000":
            continue
        if entry.get("state") not in allowed_research_states:
            errors.append(f"{rid}: state is not in HARNESS_RULES")
        for field in rules["completion"]["required_artifacts"]:
            if field in {"feedback_ref", "baseline", "metrics", "stop_conditions", "next_review_date"}:
                continue
            if not entry.get("evidence_package") and field == "evidence_package":
                errors.append(f"{rid}: missing evidence_package")
        evidence_ref = entry.get("evidence_package", "")
        evidence_path = local_path(evidence_ref)
        if not evidence_path or not evidence_path.is_file():
            errors.append(f"{rid}: evidence package missing")
        review_path = local_path(entry.get("review_report", ""))
        if not review_path or not review_path.is_file():
            errors.append(f"{rid}: outcome review missing")
        refs = entry.get("feedback_refs", [])
        if not refs:
            errors.append(f"{rid}: feedback_refs empty")
        for ref in refs:
            item = feedback_by_id.get(ref)
            if not item:
                errors.append(f"{rid}: feedback {ref} missing")
            elif item.get("research_id") != rid:
                errors.append(f"{rid}: feedback {ref} points to {item.get('research_id')}")
        numeric_id = rid.removeprefix("RO-")
        if numeric_id not in application_ids:
            errors.append(f"{rid}: application feedback RF-{numeric_id} missing")
        if not entry.get("next_action") or not entry.get("rollback"):
            errors.append(f"{rid}: next_action and rollback are required")
    for item in feedback.get("entries", []):
        if item.get("feedback_id") == "FB-000":
            continue
        if item.get("state") not in allowed_feedback_states:
            errors.append(f"{item.get('feedback_id')}: state is not in HARNESS_RULES")
        if not item.get("research_id") or not item.get("evidence_ref") or not item.get("validation"):
            errors.append(f"{item.get('feedback_id')}: research_id/evidence_ref/validation required")
    for action in rules["automatic_actions"]["forbidden"]:
        if action not in {"delete_data", "expand_production", "purchase_capacity", "publish_claim", "mark_adopted", "change_runtime_config"}:
            errors.append(f"unexpected forbidden action: {action}")
    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        return 1
    print(f"Research loop validation passed: {len([item for item in pipeline.get('entries', []) if item.get('research_id') != 'RO-000'])} active opportunities, {len([item for item in feedback.get('entries', []) if item.get('feedback_id') != 'FB-000'])} feedback entries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
