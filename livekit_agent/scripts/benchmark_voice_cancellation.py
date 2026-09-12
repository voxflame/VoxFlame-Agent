"""Measure actual TTS interrupt code against in-memory test doubles; no RTC/provider."""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "livekit_agent"))
sys.path.insert(0, str(ROOT / "livekit_agent/tests"))
from test_voice_pipeline import VoicePipelineTests


def digest(paths: list[Path]) -> str:
    hasher = hashlib.sha256()
    for path in paths:
        hasher.update(str(path.relative_to(ROOT)).encode())
        hasher.update(path.read_bytes())
    return hasher.hexdigest()


async def measure() -> list[dict[str, object]]:
    samples: list[dict[str, object]] = []
    fixtures = VoicePipelineTests()
    for index in range(32):
        runtime, source, client = fixtures.make_tts()
        task = asyncio.create_task(runtime.speak("合成测试"))
        try:
            await asyncio.wait_for(client.ready.wait(), 2)
            start = time.perf_counter()
            interrupted = await asyncio.wait_for(runtime.interrupt(), 2)
            await asyncio.wait_for(asyncio.gather(task, return_exceptions=True), 2)
            elapsed = (time.perf_counter() - start) * 1000
            passed = interrupted and client.stopped and source.clears > 0 and not source.frames
            samples.append({"id": f"mock-{index:02}", "outcome": "completed" if passed else "failed",
                            "measurements": {"cancel_to_clear_ms": elapsed}})
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
    return samples


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    protocol = ROOT / "research/voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md"
    samples = asyncio.run(measure())
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    scope = [ROOT / "livekit_agent" / f for f in ["tts_runtime.py", "config.py", "tests/test_voice_pipeline.py", "tests/test_asr_runtime.py", "scripts/benchmark_voice_cancellation.py"]]
    report = {
        "schema": "voxflame-voice-benchmark-v1", "research_id": "RO-014", "feedback_ref": "FB-008",
        "domain": "synthetic", "metadata": {
            "run_id": "local-tts-cancellation-20260910", "code_version": revision + "+scope-sha256:" + digest(scope),
            "config_sha256": digest([ROOT / "livekit_agent/config.py", ROOT / "livekit_agent/tests/test_asr_runtime.py"]),
            "dataset_sha256": digest([ROOT / "livekit_agent/tests/test_voice_pipeline.py"]),
            "protocol_sha256": hashlib.sha256(protocol.read_bytes()).hexdigest(),
            "scenario": "TTS cancellation with in-memory source and client; 32 serial trials",
            "population": "no-user-audio", "device": "cpu1-local-process-no-device",
            "model_version": "mock-no-model", "seed": 0, "concurrency": 1, "temperature_state": "not_applicable"},
        "baseline_ref": "research/voice-agent/RO-014-voice-pipeline-repair-2026-09-10.md (functional reproduction only; no comparable timing baseline)",
        "evidence_ref": "livekit_agent/scripts/benchmark_voice_cancellation.py",
        "limitations": "Actual TTS interrupt with test doubles, not live RTC/provider or acoustic stop. No before/after timing claim. ASR/CER/AEC and real user latency unmeasured. Shared host scheduler affects microtiming.",
        "cycle": {
            "发现需求": "FB-008 audio backlog/interrupt report; official engineering metric request",
            "实现": "Existing TTS producer cancellation then source clear; offline Harness added",
            "优化": "Removed old queue; hypothesis stale audio stops. Timing baseline absent, improvement unproven",
            "测试": "32 serial trials against actual interrupt method with source/provider doubles; actual results below",
            "迭代": "Keep FB-008 validating; authorize one-room RTC then device/quality evidence"},
        "iteration": {"decision": "hold", "next_action": "Collect authorized RTC/device traces and licensed reference audio; do not deploy on mock results", "owner": "livekit_agent + platform operations", "review_date": "2026-09-12"},
        "samples": samples}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, ensure_ascii=False, indent=2, allow_nan=False)
        output.write("\n")
    print(f"Saved {len(samples)} synthetic-only trials to {args.output}")
    return 0 if all(s["outcome"] == "completed" for s in samples) else 1


if __name__ == "__main__":
    raise SystemExit(main())
