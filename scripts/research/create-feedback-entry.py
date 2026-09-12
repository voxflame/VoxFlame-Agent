#!/usr/bin/env python3
"""Create a reviewable YAML feedback entry; never executes the requested action."""
from __future__ import annotations

import argparse
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "research" / "FEEDBACK_REGISTRY.yaml"


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("research-id", "source", "scenario", "observation", "severity", "failure-type", "evidence-ref", "hypothesis", "owner", "action", "validation"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--write", action="store_true", help="append to registry after printing")
    args = parser.parse_args()
    current = REGISTRY.read_text(encoding="utf-8")
    numbers = [int(n) for n in re.findall(r"feedback_id: FB-(\d+)", current)]
    feedback_id = f"FB-{max(numbers, default=0) + 1:03d}"
    def quote(value: str) -> str:
        return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ') + '"'
    block = "\n  - feedback_id: %s\n    research_id: %s\n    source: %s\n    observed_at: %s\n    scenario: %s\n    observation: %s\n    severity: %s\n    failure_type: %s\n    evidence_ref: %s\n    hypothesis: %s\n    owner: %s\n    action: %s\n    validation: %s\n    state: new\n" % (feedback_id, args.research_id, args.source, date.today().isoformat(), *(quote(getattr(args, key.replace('-', '_'))) for key in ("scenario", "observation", "severity", "failure_type", "evidence_ref", "hypothesis", "owner", "action", "validation")))
    print(block, end="")
    if args.write:
        REGISTRY.write_text(current.rstrip() + block, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
