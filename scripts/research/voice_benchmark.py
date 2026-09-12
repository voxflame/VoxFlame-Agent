#!/usr/bin/env python3
"""Offline-only voice evidence validation and aggregation; never invokes providers."""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import re
from typing import cast
import unicodedata

ROOT = Path(__file__).resolve().parents[2]


def obj(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(k, str) for k in value):
        raise ValueError("expected an object with string keys")
    return cast(dict[str, object], value)


def items(value: object) -> list[object]:
    if not isinstance(value, list):
        raise ValueError("expected a list")
    return cast(list[object], value)


def label(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("expected a nonempty string")
    return value


def number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise ValueError("expected a finite nonnegative number")
    if not math.isfinite(value) or value < 0:
        raise ValueError("expected a finite nonnegative number")
    return float(value)


def load_rules() -> dict[str, object]:
    import yaml  # Existing research runner dependency, not a production dependency.
    return obj(yaml.safe_load((ROOT / "research/HARNESS_RULES.yaml").read_text()))


def percentile(values: list[float], ratio: float) -> float | None:
    """Nearest-rank; small samples are descriptive, not a reliable tail estimate."""
    if not 0 < ratio <= 1:
        raise ValueError("percentile must be in (0, 1]")
    ordered = sorted(number(v) for v in values)
    return ordered[math.ceil(len(ordered) * ratio) - 1] if ordered else None


def counter_ratio(before: dict[str, object], after: dict[str, object],
                  numerator: str, denominator: str, scale: float = 1) -> float | None:
    """Same SSRC statistics window only; reset/empty/invalid windows are missing."""
    if not before.get("id") or before.get("id") != after.get("id"):
        return None
    if before.get("ssrc") is None or before.get("ssrc") != after.get("ssrc"):
        return None
    try:
        if number(after.get("timestamp")) <= number(before.get("timestamp")):
            return None
        n = number(after.get(numerator)) - number(before.get(numerator))
        d = number(after.get(denominator)) - number(before.get(denominator))
        if n < 0 or d <= 0:
            return None
        return n / d * number(scale)
    except ValueError:
        return None


def cer(pairs: list[object]) -> dict[str, object]:
    """Corpus edit distance over NFC codepoints; preserve case/punctuation/spacing.

    Exact normalization is deliberately narrow. Silence is scored separately.
    Raw references/hypotheses are never included in output.
    """
    errors = reference_chars = silence = hallucinations = insertions = 0
    for raw in pairs:
        pair = obj(raw)
        ref, hyp = pair.get("reference"), pair.get("hypothesis")
        if not isinstance(ref, str) or not isinstance(hyp, str):
            raise ValueError("CER requires string reference and hypothesis")
        ref, hyp = unicodedata.normalize("NFC", ref), unicodedata.normalize("NFC", hyp)
        if not ref:
            silence += 1
            hallucinations += bool(hyp)
            insertions += len(hyp)
            continue
        previous = list(range(len(hyp) + 1))
        for i, a in enumerate(ref, 1):
            current = [i]
            for j, b in enumerate(hyp, 1):
                current.append(min(current[-1] + 1, previous[j] + 1,
                                   previous[j - 1] + (a != b)))
            previous = current
        errors += previous[-1]
        reference_chars += len(ref)
    return {"normalization": "NFC-codepoint-preserve-all-v1", "pairs": len(pairs),
            "reference_characters": reference_chars, "edit_errors": errors,
            "cer": errors / reference_chars if reference_chars else None,
            "silence_trials": silence, "silence_hallucinations": hallucinations,
            "silence_inserted_characters": insertions,
            "silence_hallucination_rate": hallucinations / silence if silence else None}


def threshold(rules: dict[str, object], path: str) -> float:
    current: object = rules
    for key in path.split("."):
        current = obj(current)[key]
    return number(current)


def summarize(raw: object, rules: dict[str, object]) -> dict[str, object]:
    data = obj(raw)
    policy = obj(rules["voice_benchmark"])
    if data.get("schema") != policy["schema"]:
        raise ValueError("unsupported benchmark schema; legacy metrics are not silently converted")
    domain = label(data.get("domain"))
    if domain not in items(policy["domains"]):
        raise ValueError("unsupported measurement domain")
    metadata = obj(data.get("metadata"))
    for raw_key in items(policy["metadata_fields"]):
        key = label(raw_key)
        if key in {"seed", "concurrency"}:
            value = metadata.get(key)
            if type(value) is not int or number(value) < (1 if key == "concurrency" else 0):
                raise ValueError(f"invalid {key}")
        else:
            value = label(metadata.get(key))
            if key.endswith("sha256") and not re.fullmatch(r"[0-9a-f]{64}", value):
                raise ValueError(f"invalid hash: {key}")
    if metadata.get("temperature_state") not in {"cold", "warm", "not_applicable"}:
        raise ValueError("separate cold/warm runs")
    protocol = ROOT / label(policy["protocol"])
    if metadata.get("protocol_sha256") != hashlib.sha256(protocol.read_bytes()).hexdigest():
        raise ValueError("protocol hash differs; rerun/review instead of comparing silently")
    cycle_policy = obj(rules["engineering_cycle"])
    cycle = obj(data.get("cycle"))
    for stage in items(cycle_policy["stages"]):
        label(cycle.get(label(stage)))
    iteration = obj(data.get("iteration"))
    for key in items(cycle_policy["required_iteration_fields"]):
        label(iteration.get(label(key)))
    if iteration["decision"] not in items(cycle_policy["decisions"]):
        raise ValueError("invalid iteration decision")
    date.fromisoformat(label(iteration["review_date"]))
    label(data.get("baseline_ref"))
    label(data.get("evidence_ref"))
    label(data.get("limitations"))
    catalog = obj(policy["metric_catalog"])
    samples = items(data.get("samples"))
    seen: set[str] = set()
    values: dict[str, list[float]] = {key: [] for key in catalog}
    counts = {label(k): 0 for k in items(policy["sample_outcomes"])}
    for raw_sample in samples:
        sample = obj(raw_sample)
        sample_id = label(sample.get("id"))
        if sample_id in seen:
            raise ValueError("duplicate sample id")
        seen.add(sample_id)
        outcome = label(sample.get("outcome"))
        if outcome not in counts:
            raise ValueError("invalid sample outcome")
        counts[outcome] += 1
        measurements = obj(sample.get("measurements"))
        for key, raw_value in measurements.items():
            if key not in catalog:
                raise ValueError(f"unknown metric: {key}")
            spec = obj(catalog[key])
            if raw_value is None:
                continue
            if domain not in items(spec["domains"]):
                raise ValueError(f"{domain} cannot establish {key}")
            value = number(raw_value)
            if spec["unit"] == "ratio" and value > 1:
                raise ValueError("ratio exceeds 1")
            # Failed/cancelled observations stay visible in counts, not success percentiles.
            if outcome == "completed":
                values[key].append(value)
    report: dict[str, object] = {}
    for key, observed in values.items():
        spec = obj(catalog[key])
        limit = threshold(rules, label(spec["threshold"])) if "threshold" in spec else None
        p95 = percentile(observed, .95)
        status = "not_evaluated"
        if p95 is not None and limit is not None and p95 > limit:
            status = "fail"
        elif len(observed) != len(samples) or not samples:
            status = "not_measured"
        elif limit is not None:
            status = "pass"
        report[key] = {"unit": spec["unit"], "basis": spec["basis"],
                       "n": len(observed), "missing_or_unsuccessful": len(samples) - len(observed),
                       "p50": percentile(observed, .5), "p95": p95,
                       "p99": percentile(observed, .99), "threshold": limit, "status": status}
    # A valid artifact is not a release decision, even if every measured SLO passes.
    return {"schema": policy["schema"], "domain": domain, "run_id": metadata["run_id"],
            "total": len(samples), "outcomes": counts, "metrics": report,
            "iteration": iteration, "acceptance": "manual_review_required",
            "limitations": data["limitations"]}


def check_registered(rules: dict[str, object]) -> int:
    """Check reports via existing Pipeline/evidence graph; no second registry."""
    import yaml
    pipeline = obj(yaml.safe_load((ROOT / "research/PIPELINE.yaml").read_text()))
    feedback = obj(yaml.safe_load((ROOT / "research/FEEDBACK_REGISTRY.yaml").read_text()))
    feedback_by_id = {obj(f)["feedback_id"]: obj(f) for f in items(feedback["entries"])}
    count = 0
    for raw_entry in items(pipeline["entries"]):
        entry = obj(raw_entry)
        evidence = obj(yaml.safe_load((ROOT / label(entry["evidence_package"])).read_text()))
        for ref in items(evidence.get("benchmark_runs", [])):
            path = (ROOT / label(ref)).resolve()
            if not path.is_relative_to(ROOT / "research"):
                raise ValueError("registered reports must be in research/")
            data = obj(json.loads(path.read_text()))
            if data.get("research_id") != entry["research_id"]:
                raise ValueError("benchmark research_id mismatch")
            fb = label(data.get("feedback_ref"))
            if fb not in items(entry.get("feedback_refs", [])) or feedback_by_id[fb]["research_id"] != entry["research_id"]:
                raise ValueError("benchmark feedback mismatch")
            summarize(data, rules)
            count += 1
    print(f"Voice benchmark artifacts validated: {count}; not a product acceptance result.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--input", type=Path, help="versioned run JSON (no network)")
    group.add_argument("--cer-pairs", type=Path, help="authorized local reference/hypothesis JSON array; aggregate only")
    group.add_argument("--check-registered", action="store_true")
    args = parser.parse_args()
    try:
        if args.check_registered:
            return check_registered(load_rules())
        if args.cer_pairs:
            result = cer(items(json.loads(args.cer_pairs.read_text())))
        else:
            result = summarize(json.loads(args.input.read_text()), load_rules())
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        metrics = obj(result.get("metrics", {}))
        failed = number(obj(result.get("outcomes", {})).get("failed", 0))
        return 1 if failed or any(obj(m)["status"] == "fail" for m in metrics.values()) else 0
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(2, f"Invalid benchmark input: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
