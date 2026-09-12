from __future__ import annotations
import copy
import hashlib
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_benchmark import ROOT, cer, counter_ratio, load_rules, percentile, summarize


def fixture() -> dict:
    return {
        "schema": "voxflame-voice-benchmark-v1", "domain": "rtc",
        "metadata": {"run_id": "fixture", "code_version": "unit-test-only",
            "config_sha256": "a"*64, "dataset_sha256": "b"*64,
            "protocol_sha256": hashlib.sha256((ROOT / "research/voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md").read_bytes()).hexdigest(),
            "scenario": "unit-test", "population": "synthetic", "device": "mock",
            "model_version": "mock", "seed": 0, "concurrency": 1, "temperature_state": "warm"},
        "cycle": {s: "test fixture only" for s in ["发现需求", "实现", "优化", "测试", "迭代"]},
        "iteration": {"decision": "hold", "next_action": "real test", "owner": "test", "review_date": "2026-09-12"},
        "baseline_ref": "fixture", "evidence_ref": "fixture", "limitations": "synthetic validation of scorer only",
        "samples": [{"id": "1", "outcome": "completed", "measurements": {"asr_request_ms": 50}}],
    }


class BenchmarkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rules = load_rules()
        self.data = fixture()

    def metric(self, key: str = "asr_request_ms") -> dict:
        return summarize(self.data, self.rules)["metrics"][key]

    def test_nearest_rank_small_sample(self) -> None:
        self.assertEqual(percentile(list(range(1, 9)), .95), 8)
        self.assertEqual(percentile([1, 2, 3, 4], .5), 2)
        self.assertIsNone(percentile([], .95))

    def test_invalid_percentile(self) -> None:
        for v in [float("nan"), float("inf"), -1, True]:
            with self.assertRaises(ValueError): percentile([v], .95)
        with self.assertRaises(ValueError): percentile([1], 0)

    def test_missing_not_zero(self) -> None:
        m = self.metric("tts_ttfb_ms")
        self.assertIsNone(m["p95"])
        self.assertEqual(m["status"], "not_measured")
        self.assertEqual(m["missing_or_unsuccessful"], 1)

    def test_failed_and_cancelled_counted(self) -> None:
        for i, status in enumerate(["failed", "cancelled"]):
            self.data["samples"].append({"id": str(i+2), "outcome": status, "measurements": {"asr_request_ms": 1}})
        result = summarize(self.data, self.rules)
        self.assertEqual(result["outcomes"], {"completed": 1, "failed": 1, "cancelled": 1})
        self.assertEqual(self.metric()["n"], 1)
        self.assertEqual(self.metric()["status"], "not_measured")

    def test_threshold_read_from_rules(self) -> None:
        self.rules["triggers"]["realtime"]["asr_p95_ms"] = 10
        self.assertEqual(self.metric()["status"], "fail")
        self.rules["triggers"]["realtime"]["asr_p95_ms"] = 50
        self.assertEqual(self.metric()["status"], "pass")
        self.assertEqual(summarize(self.data, self.rules)["acceptance"], "manual_review_required")

    def test_known_failure_wins_over_missing(self) -> None:
        self.data["samples"][0]["measurements"]["asr_request_ms"] = 100000
        self.data["samples"].append({"id": "2", "outcome": "failed", "measurements": {}})
        self.assertEqual(self.metric()["status"], "fail")

    def test_no_threshold_not_pass(self) -> None:
        self.data["samples"][0]["measurements"]["llm_full_ms"] = 2
        self.assertEqual(self.metric("llm_full_ms")["status"], "not_evaluated")

    def test_synthetic_cannot_prove_real_metrics(self) -> None:
        self.data["domain"] = "synthetic"
        with self.assertRaises(ValueError): summarize(self.data, self.rules)

    def test_no_samples_not_pass(self) -> None:
        self.data["samples"] = []
        self.assertEqual(self.metric()["status"], "not_measured")

    def test_invalid_measurements(self) -> None:
        for value in [True, -1, float("nan"), float("inf"), "12"]:
            self.data["samples"][0]["measurements"]["asr_request_ms"] = value
            with self.assertRaises(ValueError): summarize(self.data, self.rules)

    def test_unknown_metric_rejected(self) -> None:
        self.data["samples"][0]["measurements"]["asr_ms"] = 50
        with self.assertRaises(ValueError): summarize(self.data, self.rules)

    def test_duplicate_rejected(self) -> None:
        self.data["samples"].append(copy.deepcopy(self.data["samples"][0]))
        with self.assertRaises(ValueError): summarize(self.data, self.rules)

    def test_missing_cycle_and_metadata(self) -> None:
        for section, key in [("cycle", "优化"), ("metadata", "dataset_sha256"), ("iteration", "owner")]:
            data = fixture(); del data[section][key]
            with self.assertRaises(ValueError): summarize(data, self.rules)

    def test_protocol_drift(self) -> None:
        self.data["metadata"]["protocol_sha256"] = "c" * 64
        with self.assertRaises(ValueError): summarize(self.data, self.rules)

    def test_device_metric_needs_device_domain(self) -> None:
        self.data["samples"][0]["measurements"]["audible_response_ms"] = 1
        with self.assertRaises(ValueError): summarize(self.data, self.rules)

    def test_cer_corpus_weighting_and_unicode(self) -> None:
        result = cer([{"reference": "你好", "hypothesis": "你号"}, {"reference": "世界和平", "hypothesis": "世界和平"}])
        self.assertEqual(result["cer"], 1/6)
        self.assertEqual(cer([{"reference": "é", "hypothesis": "e\u0301"}])["cer"], 0)
        self.assertNotIn("reference", result)

    def test_cer_empty_and_insertions(self) -> None:
        result = cer([{"reference": "", "hypothesis": ""}, {"reference": "", "hypothesis": "幻觉"}])
        self.assertIsNone(result["cer"])
        self.assertEqual(result["silence_hallucination_rate"], .5)
        self.assertEqual(cer([{"reference": "字", "hypothesis": "字字字字"}])["cer"], 3)
        self.assertIsNone(cer([])["cer"])

    def test_counter_windows(self) -> None:
        before = {"id": "audio", "ssrc": 123, "timestamp": 1, "delay": 10, "count": 10}
        after = dict(before, timestamp=2, delay=11, count=20)
        self.assertEqual(counter_ratio(before, after, "delay", "count", 1000), 100)
        for change in [{"count": 10}, {"delay": 9}, {"ssrc": 9}, {"timestamp": 0}, {"count": None}]:
            self.assertIsNone(counter_ratio(before, dict(after, **change), "delay", "count"))


if __name__ == "__main__": unittest.main()
