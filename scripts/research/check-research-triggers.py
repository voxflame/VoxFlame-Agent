#!/usr/bin/env python3
"""Read telemetry and propose feedback; missing data never means healthy."""
from __future__ import annotations
import json
import sys
from pathlib import Path
from voice_benchmark import load_rules, number, obj, threshold


def evaluate(data: dict[str, object], rules: dict[str, object]) -> dict[str, object]:
    if data.get("schema") or data.get("domain") in {"synthetic", "offline_audio"}:
        raise ValueError("benchmark evidence is not production telemetry; use voice_benchmark.py")
    triggers: list[dict[str, str]] = []
    missing: list[str] = []

    def measured(key: str) -> float | None:
        value = data.get(key)
        if value is None:
            missing.append(key)
            return None
        result = number(value)
        if (key.endswith("_rate") and result > 1) or (key.endswith("_pct") and result > 100):
            raise ValueError(f"invalid telemetry range: {key}")
        return result

    def add(rid: str, reason: str, severity: str = "high") -> None:
        triggers.append({"research_id": rid, "severity": severity, "reason": reason})

    disk = measured("root_disk_used_pct")
    if disk is not None and disk >= threshold(rules, "triggers.disk.warning_percent"):
        add("RO-013", "root disk warning; review cleanup trend", "high" if disk >= threshold(rules, "triggers.disk.human_escalation_percent") else "medium")
    bindings = [
        ("progress_p95_ms", "triggers.training_progress.p95_ms", "RO-012", "max"),
        ("progress_recovery_rate", "triggers.training_progress.recovery_rate_min", "RO-012", "min"),
        ("job_reject_rate", "triggers.realtime.job_reject_rate_max", "RO-014", "max"),
        ("asr_p95_ms", "triggers.realtime.asr_p95_ms", "RO-014", "max"),
        ("tts_first_byte_p95_ms", "triggers.realtime.tts_first_byte_p95_ms", "RO-014", "max"),
        ("packet_loss_rate", "triggers.realtime.packet_loss_rate_max", "RO-014", "max"),
        ("provider_429_rate", "triggers.realtime.provider_429_rate_max", "RO-014", "max"),
    ]
    for key, path, rid, direction in bindings:
        value = measured(key)
        if value is not None:
            limit = threshold(rules, path)
            if (value > limit if direction == "max" else value < limit):
                add(rid, f"{key} protection threshold exceeded")
    failures = measured("same_failure_count_7d")
    window = measured("failure_window_days")
    if failures is not None and window is not None:
        if failures >= threshold(rules, "triggers.repeated_failure.count_min") and window <= threshold(rules, "triggers.repeated_failure.window_days"):
            add(str(data.get("research_id", "RO-012")), "same failure repeated within configured window")
    return {"triggered": triggers, "unmeasured": missing,
            "measurement_status": "incomplete" if missing else "complete",
            "manual_confirmation_required": bool(triggers), "acceptance": "not_a_release_gate"}


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-research-triggers.py metrics.json", file=sys.stderr)
        return 2
    try:
        result = evaluate(obj(json.loads(Path(sys.argv[1]).read_text())), load_rules())
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (ValueError, KeyError, OSError) as exc:
        print(f"Invalid telemetry: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
