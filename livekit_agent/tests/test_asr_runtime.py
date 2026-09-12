from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from asr_runtime import (
    ServerEventHandler,
    LiveKitASRRuntime,
    QwenHttpASRClient,
    RMSVoiceActivityDetector,
    build_asr_session_payload,
    build_livekit_audio_apm_options,
    extract_http_asr_transcript,
    frame_to_pcm_bytes,
    get_authenticated_user_id,
    get_asr_account_id,
    pcm_bytes_to_wav_bytes,
    should_use_qwen_http_asr,
    is_repetitive_transcript_noise,
    is_filler_transcript_noise,
    normalized_rms_energy,
    semantic_transcript_length,
    should_enable_livekit_audio_apm,
    with_model_query,
)
from capacity import ProcessSlotPool, ProviderCapacityExceeded
from config import LiveKitAgentConfig


def create_config() -> LiveKitAgentConfig:
    return LiveKitAgentConfig(
        livekit_url="ws://127.0.0.1:7880",
        livekit_api_key="devkey",
        livekit_api_secret="secret",
        agent_name="voxflame-agent",
        mode="communication_stub",
        dashscope_api_key="dashscope-test",
        dashscope_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        dashscope_correction_model="qwen-flash",
        dashscope_llm_model="qwen3.6-plus",
        dashscope_timeout_seconds=15.0,
        dashscope_reply_timeout_seconds=4.5,
        dashscope_llm_temperature=0.1,
        dashscope_llm_max_tokens=32,
        dashscope_session_cache_enabled=True,
        dashscope_asr_url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        dashscope_asr_model="qwen3-asr-flash-realtime-2026-02-10",
        dashscope_asr_sample_rate=16000,
        dashscope_asr_language="zh",
        dashscope_asr_enable_interim=True,
        dashscope_asr_connect_timeout_seconds=15,
        qwen_http_asr_url=None,
        qwen_http_asr_language="Chinese",
        qwen_http_asr_timeout_seconds=30.0,
        livekit_audio_apm_enabled=True,
        livekit_audio_apm_echo_cancellation=False,
        livekit_audio_apm_noise_suppression=True,
        livekit_audio_apm_high_pass_filter=True,
        livekit_audio_apm_auto_gain_control=False,
        dashscope_asr_vad_threshold=0.032,
        dashscope_asr_vad_silence_duration_ms=860,
        dashscope_asr_barge_in_min_speech_ms=360,
        dashscope_asr_min_commit_speech_ms=420,
        dashscope_tts_url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        dashscope_tts_model="qwen3-tts-flash-realtime",
        dashscope_tts_voice="Cherry",
        dashscope_tts_sample_rate=16000,
        dashscope_tts_connect_timeout_seconds=15,
        dashscope_tts_request_timeout_seconds=20.0,
        log_level="info",
    )


class FakeFrame:
    def __init__(self, data: bytes, num_channels: int) -> None:
        self.data = data
        self.num_channels = num_channels


class FakeAPM:
    def __init__(self) -> None:
        self.frames: list[bytes] = []

    def process_stream(self, frame):  # noqa: ANN001
        payload = frame.data.tobytes() if hasattr(frame.data, "tobytes") else bytes(frame.data)
        self.frames.append(payload)
        return frame


class FakeMonoFrame:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.num_channels = 1


class FakeASRClient:
    def __init__(self) -> None:
        self.commit_calls = 0
        self.clear_calls = 0

    async def commit_audio(self) -> None:
        self.commit_calls += 1

    async def clear_audio(self) -> None:
        self.clear_calls += 1


class FakeFallbackASRClient:
    def __init__(self) -> None:
        self.handler: ServerEventHandler | None = None
        self.stopped = False
        self.started_payloads: list[dict[str, object]] = []
        self.appended_audio: list[bytes] = []
        self.commit_calls = 0
        self.clear_calls = 0

    async def start(self, session_payload: dict[str, object]) -> None:
        self.started_payloads.append(session_payload)

    async def append_audio(self, pcm_bytes: bytes) -> None:
        self.appended_audio.append(pcm_bytes)

    async def commit_audio(self) -> None:
        self.commit_calls += 1
        await self.handler({"type": "conversation.item.input_audio_transcription.completed", "transcript": "备用识别结果"})

    async def clear_audio(self) -> None:
        self.clear_calls += 1

    async def stop(self) -> None:
        self.stopped = True


class FakeHttpResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload
        self.headers = {"content-type": "application/json"}

    def raise_for_status(self) -> None:
        return

    def json(self) -> dict[str, object]:
        return self._payload

    @property
    def text(self) -> str:
        return json.dumps(self._payload, ensure_ascii=False)


class FakeHttpClient:
    response_payload: dict[str, object] = {}
    requests: list[dict[str, object]] = []

    def __init__(self, *, timeout: float, trust_env: bool = False) -> None:
        self.timeout = timeout

    async def post(self, url: str, **kwargs: object) -> FakeHttpResponse:
        self.requests.append({"url": url, **kwargs})
        return FakeHttpResponse(self.response_payload)

    async def aclose(self) -> None:
        return


class TestASRRuntime(unittest.TestCase):
    def test_with_model_query_appends_model_when_missing(self) -> None:
        url = with_model_query(
            "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
            "qwen3-asr-flash-realtime-2026-02-10",
        )
        self.assertIn("model=qwen3-asr-flash-realtime-2026-02-10", url)

    def test_build_asr_session_payload_matches_dashscope_contract(self) -> None:
        payload = build_asr_session_payload(create_config())
        self.assertEqual(payload["modalities"], ["text"])
        self.assertEqual(payload["input_audio_format"], "pcm")
        self.assertEqual(payload["sample_rate"], 16000)
        self.assertEqual(payload["input_audio_transcription"]["language"], "zh")

    def test_should_use_qwen_http_asr_for_all_authenticated_communication_and_training_users(self) -> None:
        config = create_config()
        config = type(config)(
            **{
                **config.__dict__,
                "qwen_http_asr_url": "http://127.0.0.1:8001/transcribe",
            }
        )
        matching_ctx = type(
            "Ctx",
            (),
            {
                "mode": "communication",
                "participant_payload": {},
                "dispatch_payload": {
                    "authenticated_user_id": "64758dee-5026-4b53-a063-1d02d0834f67",
                    "asr_account_id": "2307294809",
                },
                "raw_attributes": {},
            },
        )()
        other_ctx = type(
            "Ctx",
            (),
            {
                "mode": "communication",
                "participant_payload": {},
                "dispatch_payload": {
                    "authenticated_user_id": "other-user",
                    "asr_account_id": "other-user",
                },
                "raw_attributes": {},
            },
        )()
        training_ctx = type(
            "Ctx",
            (),
            {
                "mode": "training",
                "participant_payload": {},
                "dispatch_payload": {
                    "authenticated_user_id": "64758dee-5026-4b53-a063-1d02d0834f67",
                    "asr_account_id": "2307294809",
                },
                "raw_attributes": {},
            },
        )()
        quick_talk_ctx = type(
            "Ctx",
            (),
            {
                "mode": "quick_talk",
                "participant_payload": {},
                "dispatch_payload": {
                    "authenticated_user_id": "64758dee-5026-4b53-a063-1d02d0834f67",
                    "asr_account_id": "2307294809",
                },
                "raw_attributes": {},
            },
        )()
        anonymous_ctx = type(
            "Ctx",
            (),
            {
                "mode": "communication",
                "participant_payload": {},
                "dispatch_payload": {},
                "raw_attributes": {},
            },
        )()

        self.assertTrue(should_use_qwen_http_asr(config, matching_ctx))
        self.assertTrue(should_use_qwen_http_asr(config, training_ctx))
        self.assertTrue(should_use_qwen_http_asr(config, other_ctx))
        self.assertFalse(should_use_qwen_http_asr(config, quick_talk_ctx))
        self.assertFalse(should_use_qwen_http_asr(config, anonymous_ctx))

    def test_get_asr_account_id_accepts_only_backend_dispatch_metadata(self) -> None:
        routed_ctx = type(
            "Ctx",
            (),
            {
                "participant_payload": {},
                "dispatch_payload": {
                    "authenticated_user_id": "supabase-user-id",
                    "asr_account_id": "2307294809",
                },
                "raw_attributes": {},
            },
        )()
        participant_compat_ctx = type(
            "Ctx",
            (),
            {
                "participant_payload": {
                    "authenticated_user_id": "supabase-user-id",
                    "asr_account_id": "2187054680",
                },
                "dispatch_payload": {},
                "raw_attributes": {"vox.asr_account_id": "3083029019"},
            },
        )()
        missing_route_ctx = type(
            "Ctx",
            (),
            {
                "participant_payload": {},
                "dispatch_payload": {"authenticated_user_id": "supabase-user-id"},
                "raw_attributes": {},
            },
        )()

        self.assertEqual(get_asr_account_id(routed_ctx), "2307294809")
        self.assertIsNone(get_asr_account_id(participant_compat_ctx))
        self.assertIsNone(get_authenticated_user_id(participant_compat_ctx))
        self.assertIsNone(get_asr_account_id(missing_route_ctx))

    def test_pcm_bytes_to_wav_bytes_writes_standard_wav_header(self) -> None:
        wav_bytes = pcm_bytes_to_wav_bytes(b"\x01\x00" * 160, sample_rate=16000)
        self.assertEqual(wav_bytes[:4], b"RIFF")
        self.assertEqual(wav_bytes[8:12], b"WAVE")
        self.assertIn(b"fmt ", wav_bytes[:64])
        self.assertIn(b"data", wav_bytes[:80])

    def test_extract_http_asr_transcript_accepts_common_response_shapes(self) -> None:
        self.assertEqual(extract_http_asr_transcript({"text": "刷牙"}), "刷牙")
        self.assertEqual(
            extract_http_asr_transcript({"data": {"transcript": "我要喝水"}}),
            "我要喝水",
        )
        self.assertEqual(
            extract_http_asr_transcript({"segments": [{"text": "我想"}, {"text": "挂号"}]}),
            "我想挂号",
        )

    def test_qwen_http_asr_client_emits_final_transcript_on_success(self) -> None:
        events: list[dict[str, object]] = []

        async def handle_event(payload: dict[str, object]) -> None:
            events.append(payload)

        client = QwenHttpASRClient(
            url="http://asr.example/transcribe",
            account_id="2307294809",
            language="Chinese",
            sample_rate=16000,
            request_timeout_seconds=3,
            event_handler=handle_event,
        )

        async def fake_transcribe(pcm_bytes: bytes) -> tuple[str, dict[str, object]]:
            self.assertGreater(len(pcm_bytes), 0)
            return "刷牙", {
                "model_version": "exp24-2307294809-r784-step84-beam5-rank0",
                "personalized": True,
                "fallback": False,
            }

        client._transcribe = fake_transcribe  # type: ignore[method-assign]

        async def run_client() -> None:
            await client.start({"sample_rate": 16000})
            await client.append_audio(b"\x01\x00" * 160)
            await client.commit_audio()

        asyncio.run(run_client())

        self.assertEqual(events[-1]["type"], "conversation.item.input_audio_transcription.completed")
        self.assertEqual(events[-1]["transcript"], "刷牙")
        self.assertEqual(events[-1]["provider"], "qwen_http_asr")
        self.assertEqual(events[-1]["model_version"], "exp24-2307294809-r784-step84-beam5-rank0")
        self.assertTrue(events[-1]["personalized"])
        self.assertFalse(events[-1]["fallback"])

    def test_qwen_http_asr_client_sends_trusted_account_header_and_reads_routing_result(self) -> None:
        async def handle_event(_payload: dict[str, object]) -> None:
            return

        client = QwenHttpASRClient(
            url="http://127.0.0.1:8001/transcribe",
            account_id="2307294809",
            language="Chinese",
            sample_rate=16000,
            request_timeout_seconds=3,
            event_handler=handle_event,
        )
        FakeHttpClient.requests = []
        FakeHttpClient.response_payload = {
            "text": "我要喝水",
            "account_id": "2307294809",
            "model_version": "exp24-2307294809-r784-step84-beam5-rank0",
            "personalized": True,
            "fallback": False,
        }

        with patch.dict(sys.modules, {"httpx": SimpleNamespace(AsyncClient=FakeHttpClient)}):
            transcript, metadata = asyncio.run(client._transcribe(b"\x01\x00" * 160))

        self.assertEqual(transcript, "我要喝水")
        self.assertEqual(metadata["model_version"], "exp24-2307294809-r784-step84-beam5-rank0")
        self.assertTrue(metadata["personalized"])
        self.assertFalse(metadata["fallback"])
        self.assertEqual(len(FakeHttpClient.requests), 1)
        request = FakeHttpClient.requests[0]
        self.assertEqual(request["url"], "http://127.0.0.1:8001/transcribe")
        self.assertEqual(request["headers"], {"X-Account-ID": "2307294809"})
        self.assertEqual(request["data"], {"language": "Chinese"})
        self.assertIn("audio", request["files"])

    def test_qwen_http_asr_client_respects_process_capacity(self) -> None:
        async def handle_event(_payload: dict[str, object]) -> None:
            return

        with tempfile.TemporaryDirectory() as lock_directory:
            pool = ProcessSlotPool(
                provider="asr",
                slots=1,
                wait_timeout_seconds=0,
                lock_directory=lock_directory,
            )
            client = QwenHttpASRClient(
                url="http://127.0.0.1:8001/transcribe",
                account_id="2307294809",
                language="Chinese",
                sample_rate=16000,
                request_timeout_seconds=3,
                event_handler=handle_event,
                capacity_pool=pool,
            )

            async def run() -> None:
                held_lease = await pool.acquire()
                try:
                    with patch.dict(
                        sys.modules,
                        {"httpx": SimpleNamespace(AsyncClient=FakeHttpClient)},
                    ):
                        with self.assertRaises(ProviderCapacityExceeded):
                            await client._transcribe(b"\x01\x00" * 160)
                finally:
                    held_lease.release()

            asyncio.run(run())

    def test_qwen_http_asr_client_rejects_response_for_another_account(self) -> None:
        async def handle_event(_payload: dict[str, object]) -> None:
            return

        client = QwenHttpASRClient(
            url="http://127.0.0.1:8001/transcribe",
            account_id="2307294809",
            language="Chinese",
            sample_rate=16000,
            request_timeout_seconds=3,
            event_handler=handle_event,
        )
        FakeHttpClient.requests = []
        FakeHttpClient.response_payload = {
            "text": "错误路由",
            "account_id": "2187054680",
            "personalized": True,
            "fallback": False,
        }

        with patch.dict(sys.modules, {"httpx": SimpleNamespace(AsyncClient=FakeHttpClient)}):
            with self.assertRaisesRegex(RuntimeError, "account_id did not match"):
                asyncio.run(client._transcribe(b"\x01\x00" * 160))

    def test_qwen_http_asr_client_requires_account_id_in_response(self) -> None:
        async def handle_event(_payload: dict[str, object]) -> None:
            return

        client = QwenHttpASRClient(
            url="http://127.0.0.1:8001/transcribe",
            account_id="2307294809",
            language="Chinese",
            sample_rate=16000,
            request_timeout_seconds=3,
            event_handler=handle_event,
        )
        FakeHttpClient.requests = []
        FakeHttpClient.response_payload = {
            "text": "缺少账户契约",
            "personalized": False,
            "fallback": True,
        }

        with patch.dict(sys.modules, {"httpx": SimpleNamespace(AsyncClient=FakeHttpClient)}):
            with self.assertRaisesRegex(RuntimeError, "did not include account_id"):
                asyncio.run(client._transcribe(b"\x01\x00" * 160))

    def test_qwen_http_asr_client_reuses_connection_until_stop(self) -> None:
        async def handle_event(_payload: dict[str, object]) -> None:
            return

        client = QwenHttpASRClient(
            url="http://127.0.0.1:8001/transcribe",
            account_id="new-user-id",
            language="Chinese",
            sample_rate=16000,
            request_timeout_seconds=3,
            event_handler=handle_event,
        )
        FakeHttpClient.requests = []
        FakeHttpClient.response_payload = {
            "text": "公共识别",
            "account_id": "new-user-id",
            "personalized": False,
            "fallback": True,
        }

        async def run_client() -> None:
            await client._transcribe(b"\x01\x00" * 160)
            first_http_client = client._http_client
            await client._transcribe(b"\x01\x00" * 160)
            self.assertIs(client._http_client, first_http_client)
            await client.stop()
            self.assertIsNone(client._http_client)

        with patch.dict(sys.modules, {"httpx": SimpleNamespace(AsyncClient=FakeHttpClient)}):
            asyncio.run(run_client())

        self.assertEqual(len(FakeHttpClient.requests), 2)

    def test_qwen_http_asr_client_falls_back_to_realtime_on_failure(self) -> None:
        events: list[dict[str, object]] = []
        fallback = FakeFallbackASRClient()

        def factory(handler: ServerEventHandler) -> FakeFallbackASRClient:
            fallback.handler = handler
            return fallback

        async def handle_event(payload: dict[str, object]) -> None:
            events.append(payload)

        client = QwenHttpASRClient(
            url="http://asr.example/transcribe",
            account_id="2307294809",
            language="Chinese",
            sample_rate=16000,
            request_timeout_seconds=3,
            event_handler=handle_event,
            fallback_factory=factory,
        )

        async def fake_transcribe(_pcm_bytes: bytes) -> tuple[str, dict[str, object]]:
            raise RuntimeError("timeout")

        client._transcribe = fake_transcribe  # type: ignore[method-assign]

        async def run_client() -> None:
            await client.start({"sample_rate": 16000})
            await client.append_audio(b"\x01\x00" * 160)
            await client.commit_audio()

        asyncio.run(run_client())

        self.assertTrue(fallback.stopped)
        self.assertEqual(fallback.commit_calls, 1)
        self.assertEqual(fallback.appended_audio, [b"\x01\x00" * 160])
        self.assertEqual(events[-1]["provider"], "dashscope_realtime_asr_backup")

    def test_http_asr_capacity_exhaustion_can_use_independent_realtime_fallback(self) -> None:
        events: list[dict[str, object]] = []
        fallback = FakeFallbackASRClient()

        def factory(handler: ServerEventHandler) -> FakeFallbackASRClient:
            fallback.handler = handler
            return fallback

        async def handle_event(payload: dict[str, object]) -> None:
            events.append(payload)

        with tempfile.TemporaryDirectory() as lock_directory:
            primary_pool = ProcessSlotPool(
                provider="asr",
                slots=1,
                wait_timeout_seconds=0,
                lock_directory=lock_directory,
            )
            fallback_pool = ProcessSlotPool(
                provider="asr-fallback",
                slots=1,
                wait_timeout_seconds=0,
                lock_directory=lock_directory,
            )
            client = QwenHttpASRClient(
                url="http://asr.example/transcribe",
                account_id="2307294809",
                language="Chinese",
                sample_rate=16000,
                request_timeout_seconds=3,
                event_handler=handle_event,
                fallback_factory=factory,
                capacity_pool=primary_pool,
            )

            async def run_client() -> None:
                held_primary = await primary_pool.acquire()
                try:
                    await client.start({"sample_rate": 16000})
                    await client.append_audio(b"\x01\x00" * 160)
                    with patch.dict(
                        sys.modules,
                        {"httpx": SimpleNamespace(AsyncClient=FakeHttpClient)},
                    ):
                        await client.commit_audio()
                    async with fallback_pool.lease():
                        pass
                finally:
                    held_primary.release()

            asyncio.run(run_client())

        self.assertTrue(fallback.stopped)
        self.assertEqual(fallback.commit_calls, 1)
        self.assertEqual(fallback.appended_audio, [b"\x01\x00" * 160])
        self.assertEqual(events[-1]["provider"], "dashscope_realtime_asr_backup")

    def test_runtime_builds_distinct_primary_and_realtime_fallback_capacity_pools(self) -> None:
        config = create_config()
        config = type(config)(
            **{
                **config.__dict__,
                "provider_capacity_directory": "/tmp/voxflame-test-asr-pools",
                "provider_asr_max_concurrency": 4,
                "provider_asr_fallback_max_concurrency": 6,
            }
        )
        runtime = LiveKitASRRuntime(
            config=config,
            ctx=type("Ctx", (), {"room_name": "room", "participant_identity": "user"})(),
            participant=None,
            publish_payload=None,
            on_final_transcript=None,
        )

        primary = runtime._primary_capacity_pool()
        fallback = runtime._realtime_fallback_capacity_pool()

        self.assertIsNot(primary, fallback)
        self.assertEqual(primary.provider, "asr")
        self.assertEqual(primary.slots, 4)
        self.assertEqual(fallback.provider, "asr-fallback")
        self.assertEqual(fallback.slots, 6)

    def test_livekit_audio_apm_defaults_are_conservative_for_remote_tracks(self) -> None:
        options = build_livekit_audio_apm_options(create_config())
        self.assertEqual(
            options,
            {
                "echo_cancellation": False,
                "noise_suppression": True,
                "high_pass_filter": True,
                "auto_gain_control": False,
            },
        )
        self.assertTrue(should_enable_livekit_audio_apm(create_config()))

    def test_frame_to_pcm_bytes_downmixes_stereo_to_mono(self) -> None:
        frame = FakeFrame(
            data=bytes.fromhex("0100020003000400"),
            num_channels=2,
        )
        pcm = frame_to_pcm_bytes(frame)
        self.assertEqual(len(pcm), 4)

    def test_normalized_rms_energy_returns_zero_for_silence(self) -> None:
        self.assertEqual(normalized_rms_energy(b"\x00\x00" * 160), 0.0)

    def test_semantic_transcript_length_ignores_edge_punctuation(self) -> None:
        self.assertEqual(semantic_transcript_length("。"), 0)
        self.assertEqual(semantic_transcript_length("嗯。"), 1)
        self.assertEqual(semantic_transcript_length("我想挂号。"), 4)

    def test_repetitive_transcript_noise_detects_single_character_run(self) -> None:
        self.assertTrue(is_repetitive_transcript_noise("我我我我我我我我我我我我我我我我我我"))
        self.assertFalse(is_repetitive_transcript_noise("我想我想喝水。"))

    def test_filler_transcript_noise_detects_short_nonsemantic_fillers(self) -> None:
        self.assertTrue(is_filler_transcript_noise("嗯。"))
        self.assertTrue(is_filler_transcript_noise("呃呃"))
        self.assertFalse(is_filler_transcript_noise("六级。"))

    def test_vad_detector_emits_start_then_stop_after_silence_window(self) -> None:
        detector = RMSVoiceActivityDetector(threshold=0.01, silence_duration_ms=20)
        speech_frame = (1000).to_bytes(2, byteorder="little", signed=True) * 160
        silence_frame = b"\x00\x00" * 160

        started, stopped, _ = detector.observe(speech_frame, 16000)
        self.assertTrue(started)
        self.assertFalse(stopped)

        started, stopped, _ = detector.observe(silence_frame, 16000)
        self.assertFalse(started)
        self.assertFalse(stopped)

        started, stopped, _ = detector.observe(silence_frame, 16000)
        self.assertFalse(started)
        self.assertTrue(stopped)

    def test_apply_audio_apm_chunks_pcm_into_10ms_frames(self) -> None:
        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type("Ctx", (), {"room_name": "room", "participant_identity": "user"})(),
            participant=None,
            publish_payload=None,
            on_final_transcript=None,
        )
        fake_apm = FakeAPM()
        runtime._audio_apm = fake_apm
        pcm_bytes = b"\x01\x00" * 400  # 25ms @ 16k mono

        with patch(
            "asr_runtime.pcm_bytes_to_audio_frame",
            side_effect=lambda data, sample_rate, num_channels=1: FakeMonoFrame(data),
        ):
            first = runtime._apply_audio_apm(pcm_bytes, 16000)
            second = runtime._apply_audio_apm(b"", 16000)

        self.assertEqual(len(fake_apm.frames), 2)
        self.assertEqual(len(fake_apm.frames[0]), 320)
        self.assertEqual(len(fake_apm.frames[1]), 320)
        self.assertEqual(len(first), 640)
        self.assertEqual(second, b"")
        self.assertEqual(len(runtime._apm_remainder), 160)

    def test_handle_server_event_ignores_short_manual_stop_tail_transcript(self) -> None:
        published_payloads: list[dict[str, object]] = []
        final_transcripts: list[str] = []

        async def publish_payload(payload: dict[str, object]) -> None:
            published_payloads.append(payload)

        async def on_final_transcript(text: str) -> None:
            final_transcripts.append(text)

        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type(
                "Ctx",
                (),
                {"room_name": "room", "participant_identity": "user", "request_id": "req-1"},
            )(),
            participant=None,
            publish_payload=publish_payload,
            on_final_transcript=on_final_transcript,
        )
        runtime._ignore_short_transcripts_until = float("inf")

        asyncio.run(
            runtime._handle_server_event(
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": "嗯。",
                }
            )
        )

        self.assertEqual(published_payloads, [])
        self.assertEqual(final_transcripts, [])
        self.assertEqual(runtime._ignore_short_transcripts_until, 0.0)

    def test_handle_server_event_keeps_meaningful_manual_stop_transcript(self) -> None:
        published_payloads: list[dict[str, object]] = []
        final_transcripts: list[str] = []

        async def publish_payload(payload: dict[str, object]) -> None:
            published_payloads.append(payload)

        async def on_final_transcript(text: str) -> None:
            final_transcripts.append(text)

        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type(
                "Ctx",
                (),
                {"room_name": "room", "participant_identity": "user", "request_id": "req-1"},
            )(),
            participant=None,
            publish_payload=publish_payload,
            on_final_transcript=on_final_transcript,
        )
        runtime._ignore_short_transcripts_until = float("inf")

        asyncio.run(
            runtime._handle_server_event(
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": "我想挂号。",
                }
            )
        )

        self.assertEqual(len(published_payloads), 1)
        self.assertEqual(final_transcripts, ["我想挂号。"])
        self.assertEqual(published_payloads[0]["text"], "我想挂号。")
        self.assertEqual(runtime._ignore_short_transcripts_until, 0.0)

    def test_handle_server_event_ignores_repetitive_noise_transcript(self) -> None:
        published_payloads: list[dict[str, object]] = []
        final_transcripts: list[str] = []

        async def publish_payload(payload: dict[str, object]) -> None:
            published_payloads.append(payload)

        async def on_final_transcript(text: str) -> None:
            final_transcripts.append(text)

        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type(
                "Ctx",
                (),
                {"room_name": "room", "participant_identity": "user", "request_id": "req-1"},
            )(),
            participant=None,
            publish_payload=publish_payload,
            on_final_transcript=on_final_transcript,
        )

        asyncio.run(
            runtime._handle_server_event(
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": "我我我我我我我我我我我我我我我我我我我我",
                }
            )
        )

        self.assertEqual(published_payloads, [])
        self.assertEqual(final_transcripts, [])

    def test_handle_server_event_keeps_two_char_transcript_for_short_utterance_capture(self) -> None:
        published_payloads: list[dict[str, object]] = []
        final_transcripts: list[str] = []

        async def publish_payload(payload: dict[str, object]) -> None:
            published_payloads.append(payload)

        async def on_final_transcript(text: str) -> None:
            final_transcripts.append(text)

        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type(
                "Ctx",
                (),
                {"room_name": "room", "participant_identity": "user", "request_id": "req-1"},
            )(),
            participant=None,
            publish_payload=publish_payload,
            on_final_transcript=on_final_transcript,
        )
        runtime._ignore_short_transcripts_until = float("inf")
        runtime._short_utterance_capture_expected = True

        asyncio.run(
            runtime._handle_server_event(
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": "喝水",
                }
            )
        )

        self.assertEqual(len(published_payloads), 1)
        self.assertEqual(final_transcripts, ["喝水"])
        self.assertEqual(published_payloads[0]["text"], "喝水")
        self.assertFalse(runtime._short_utterance_capture_expected)

    def test_commit_audio_ignores_duplicate_commit_for_same_client_capture(self) -> None:
        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type("Ctx", (), {"room_name": "room", "participant_identity": "user"})(),
            participant=None,
            publish_payload=None,
            on_final_transcript=None,
        )
        runtime.client = FakeASRClient()
        runtime._started = True
        runtime.note_client_recording_event("speech_started", False)
        runtime._speech_ms_since_commit = 520

        asyncio.run(runtime.commit_audio("manual_stop"))
        asyncio.run(runtime.commit_audio("vad_auto_finalize"))

        self.assertEqual(runtime.client.commit_calls, 1)

    def test_commit_audio_skips_manual_stop_when_capture_has_no_stable_speech(self) -> None:
        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type("Ctx", (), {"room_name": "room", "participant_identity": "user"})(),
            participant=None,
            publish_payload=None,
            on_final_transcript=None,
        )
        runtime.client = FakeASRClient()
        runtime._started = True
        runtime.note_client_recording_event(
            "speech_started",
            False,
            client_capture_id="capture-empty",
        )
        runtime._speech_ms_since_commit = 0

        asyncio.run(runtime.commit_audio("manual_stop"))

        self.assertEqual(runtime.client.commit_calls, 0)
        self.assertEqual(runtime.client.clear_calls, 1)
        self.assertEqual(runtime._last_committed_client_capture_id, runtime._client_capture_id)
        self.assertEqual(
            runtime._last_committed_client_capture_external_id,
            "capture-empty",
        )
        self.assertEqual(runtime._pending_final_transcript_client_capture_ids, [])
        self.assertEqual(runtime._speech_ms_since_commit, 0.0)

    def test_commit_audio_allows_new_client_capture_after_restart(self) -> None:
        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type("Ctx", (), {"room_name": "room", "participant_identity": "user"})(),
            participant=None,
            publish_payload=None,
            on_final_transcript=None,
        )
        runtime.client = FakeASRClient()
        runtime._started = True
        runtime.note_client_recording_event("speech_started", False)
        runtime._speech_ms_since_commit = 520
        asyncio.run(runtime.commit_audio("manual_stop"))

        runtime.note_client_recording_event("speech_started", False)
        runtime._speech_ms_since_commit = 520
        asyncio.run(runtime.commit_audio("manual_stop"))

        self.assertEqual(runtime.client.commit_calls, 2)

    def test_final_transcript_uses_fifo_capture_binding_across_back_to_back_speech(self) -> None:
        published_payloads: list[dict[str, object]] = []
        final_transcripts: list[str] = []

        async def publish_payload(payload: dict[str, object]) -> None:
            published_payloads.append(payload)

        async def on_final_transcript(text: str) -> None:
            final_transcripts.append(text)

        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type(
                "Ctx",
                (),
                {"room_name": "room", "participant_identity": "user", "request_id": "req-1"},
            )(),
            participant=None,
            publish_payload=publish_payload,
            on_final_transcript=on_final_transcript,
        )
        runtime.client = FakeASRClient()
        runtime._started = True

        runtime.note_client_recording_event("speech_started", False, client_capture_id="capture-1")
        runtime._speech_ms_since_commit = 520
        asyncio.run(runtime.commit_audio("manual_stop"))

        runtime.note_client_recording_event("speech_started", False, client_capture_id="capture-2")
        runtime._speech_ms_since_commit = 520
        asyncio.run(runtime.commit_audio("manual_stop"))

        asyncio.run(
            runtime._handle_server_event(
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": "第一句",
                }
            )
        )

        asyncio.run(
            runtime._handle_server_event(
                {
                    "type": "conversation.item.input_audio_transcription.completed",
                    "transcript": "第二句",
                }
            )
        )

        self.assertEqual(final_transcripts, ["第一句", "第二句"])
        self.assertEqual(
            [payload["client_capture_id"] for payload in published_payloads],
            ["capture-1", "capture-2"],
        )

    def test_filtered_final_consumes_its_capture_binding_before_next_final(self) -> None:
        published_payloads: list[dict[str, object]] = []

        async def publish_payload(payload: dict[str, object]) -> None:
            published_payloads.append(payload)

        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type(
                "Ctx",
                (),
                {"room_name": "room", "participant_identity": "user", "request_id": "req-1"},
            )(),
            participant=None,
            publish_payload=publish_payload,
            on_final_transcript=lambda _text: asyncio.sleep(0),
        )
        runtime.client = FakeASRClient()
        runtime._started = True

        runtime.note_client_recording_event("speech_started", False, client_capture_id="capture-1")
        runtime._speech_ms_since_commit = 520
        asyncio.run(runtime.commit_audio("manual_stop", client_capture_id="capture-1"))
        runtime.note_client_recording_event("speech_started", False, client_capture_id="capture-2")
        runtime._speech_ms_since_commit = 520
        asyncio.run(runtime.commit_audio("manual_stop", client_capture_id="capture-2"))

        asyncio.run(runtime._handle_server_event({
            "type": "conversation.item.input_audio_transcription.completed",
            "transcript": "我我我我我我我我我我我我我我我我",
        }))
        asyncio.run(runtime._handle_server_event({
            "type": "conversation.item.input_audio_transcription.completed",
            "transcript": "妈妈",
        }))

        self.assertEqual(len(published_payloads), 1)
        self.assertEqual(published_payloads[0]["text"], "妈妈")
        self.assertEqual(published_payloads[0]["client_capture_id"], "capture-2")

    def test_vad_does_not_commit_while_client_capture_is_active(self) -> None:
        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type("Ctx", (), {"room_name": "room", "participant_identity": "user"})(),
            participant=None,
            publish_payload=None,
            on_final_transcript=None,
        )
        runtime.client = FakeASRClient()
        runtime._started = True
        runtime._vad = RMSVoiceActivityDetector(threshold=0.01, silence_duration_ms=20)
        runtime.note_client_recording_event(
            "speech_started",
            False,
            short_utterance_expected=True,
            client_capture_id="capture-1",
        )
        speech_frame = (1000).to_bytes(2, byteorder="little", signed=True) * 160
        silence_frame = b"\x00\x00" * 160

        asyncio.run(runtime._observe_vad(speech_frame, 16000))
        asyncio.run(runtime._observe_vad(silence_frame, 16000))
        asyncio.run(runtime._observe_vad(silence_frame, 16000))

        self.assertEqual(runtime.client.commit_calls, 0)
        self.assertTrue(runtime._received_voice_since_commit)

        runtime._speech_ms_since_commit = 520
        runtime.note_client_recording_event(
            "speech_stopped",
            True,
            client_capture_id="capture-1",
        )
        asyncio.run(runtime.commit_audio("manual_stop", client_capture_id="capture-1"))
        self.assertEqual(runtime.client.commit_calls, 1)

    def test_stale_end_audio_capture_id_cannot_commit_active_capture(self) -> None:
        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type("Ctx", (), {"room_name": "room", "participant_identity": "user"})(),
            participant=None,
            publish_payload=None,
            on_final_transcript=None,
        )
        runtime.client = FakeASRClient()
        runtime._started = True
        runtime.note_client_recording_event(
            "speech_started",
            False,
            client_capture_id="capture-2",
        )
        runtime._speech_ms_since_commit = 520

        asyncio.run(runtime.commit_audio("manual_stop", client_capture_id="capture-1"))

        self.assertEqual(runtime.client.commit_calls, 0)
        self.assertEqual(runtime._pending_final_transcript_client_capture_ids, [])

    def test_manual_stop_does_not_enable_short_tail_ignore_for_short_utterance_capture(self) -> None:
        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=type("Ctx", (), {"room_name": "room", "participant_identity": "user"})(),
            participant=None,
            publish_payload=None,
            on_final_transcript=None,
        )
        runtime.client = FakeASRClient()
        runtime._started = True
        runtime.note_client_recording_event(
            "speech_started",
            False,
            short_utterance_expected=True,
        )
        runtime._speech_ms_since_commit = 520

        asyncio.run(runtime.commit_audio("manual_stop"))

        self.assertEqual(runtime._ignore_short_transcripts_until, 0.0)


if __name__ == "__main__":
    unittest.main()
