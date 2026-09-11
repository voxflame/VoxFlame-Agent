"""Offline regression of the existing live probe's measurement boundaries."""
import asyncio
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("rtc_benchmark", Path(__file__).resolve().parents[1] / "scripts/benchmark_full_rtc_concurrency.py")
probe_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe_module
spec.loader.exec_module(probe_module)


class ProbeTests(unittest.IsolatedAsyncioTestCase):
    def test_percentile_and_empty(self) -> None:
        self.assertEqual(probe_module.latency_summary(list(range(1, 9)))["p95"], 8)
        self.assertIsNone(probe_module.latency_summary([]))

    async def test_live_probe_requires_opt_in_before_credentials(self) -> None:
        with patch.object(sys, "argv", ["probe", "--audio", "not-read.pcm", "--account-id", "test"]):
            with self.assertRaisesRegex(ValueError, "allow-live-provider-calls"):
                await probe_module.main()

    async def test_end_clock_waits_for_input_playout(self) -> None:
        trace = []
        class Source:
            def __init__(self, *args: object, **kwargs: object) -> None: pass
            async def capture_frame(self, frame: object) -> None: trace.append("capture")
            async def wait_for_playout(self) -> None: trace.append("drained")
        class Participant:
            async def publish_track(self, *args: object) -> object: return object()
            async def publish_data(self, *args: object, **kwargs: object) -> None: trace.append("message")
        probe = SimpleNamespace(index=0, room_name="mock", room=SimpleNamespace(local_participant=Participant()))
        with patch.object(probe_module.rtc, "AudioSource", Source), patch.object(probe_module.rtc.LocalAudioTrack, "create_audio_track", return_value=object()):
            await probe_module.run_turn(probe, pcm_bytes=b"\0" * 1280, delay_seconds=0)
        self.assertEqual(trace, ["message", "capture", "drained", "message", "message"])
        self.assertGreater(probe.turn_stopped_at, probe.turn_started_at)
