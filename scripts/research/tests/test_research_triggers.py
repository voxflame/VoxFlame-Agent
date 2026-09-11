import importlib.util
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice_benchmark import load_rules
spec = importlib.util.spec_from_file_location("research_triggers", Path(__file__).resolve().parents[1] / "check-research-triggers.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TriggerTests(unittest.TestCase):
    def test_missing_is_explicit(self) -> None:
        result = module.evaluate({}, load_rules())
        self.assertIn("asr_p95_ms", result["unmeasured"])
        self.assertEqual(result["measurement_status"], "incomplete")
        self.assertEqual(result["triggered"], [])

    def test_tts_loss_thresholds_are_not_ignored(self) -> None:
        rules = load_rules()
        rules["triggers"]["realtime"]["tts_first_byte_p95_ms"] = 1
        rules["triggers"]["realtime"]["packet_loss_rate_max"] = .1
        result = module.evaluate({"tts_first_byte_p95_ms": 2, "packet_loss_rate": .2}, rules)
        self.assertEqual(len(result["triggered"]), 2)

    def test_benchmark_is_not_telemetry(self) -> None:
        for data in [{"schema": "voxflame-voice-benchmark-v1"}, {"domain": "synthetic"}]:
            with self.assertRaises(ValueError): module.evaluate(data, load_rules())

    def test_invalid_telemetry_is_not_silently_healthy(self) -> None:
        for v in [float("nan"), float("inf"), -1, True, "2", 1.1]:
            with self.assertRaises(ValueError): module.evaluate({"packet_loss_rate": v}, load_rules())
