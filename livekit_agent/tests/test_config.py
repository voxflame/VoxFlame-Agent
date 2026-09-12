from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import load_config


class ConfigTests(unittest.TestCase):
    def test_load_config_reads_livekit_env(self) -> None:
        env_updates = {
            "LIVEKIT_URL": "ws://127.0.0.1:7880",
            "LIVEKIT_API_KEY": "devkey",
            "LIVEKIT_API_SECRET": "secret",
            "LIVEKIT_AGENT_NAME": "voxflame-agent",
            "VOXFLAME_LIVEKIT_AGENT_MODE": "communication_stub",
            "DASHSCOPE_API_KEY": "dashscope-test",
            "DASHSCOPE_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "DASHSCOPE_CORRECTION_MODEL": "qwen-flash",
            "DASHSCOPE_LLM_MODEL": "qwen-flash",
            "DASHSCOPE_TIMEOUT_SECONDS": "9.5",
            "DASHSCOPE_REPLY_TIMEOUT_SECONDS": "3.2",
            "DASHSCOPE_LLM_TEMPERATURE": "0.1",
            "DASHSCOPE_LLM_MAX_TOKENS": "32",
            "DASHSCOPE_SESSION_CACHE_ENABLED": "1",
            "QWEN_ASR_REALTIME_URL": "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
            "QWEN_ASR_REALTIME_MODEL": "qwen3-asr-flash-realtime-2026-02-10",
            "QWEN_ASR_REALTIME_SAMPLE_RATE": "16000",
            "QWEN_ASR_REALTIME_LANGUAGE": "zh",
            "QWEN_ASR_ENABLE_INTERIM": "1",
            "QWEN_ASR_CONNECT_TIMEOUT_SECONDS": "11",
            "QWEN_HTTP_ASR_URL": "http://121.41.45.9:8080/transcribe",
            "QWEN_HTTP_ASR_LANGUAGE": "Chinese",
            "QWEN_HTTP_ASR_TIMEOUT_SECONDS": "18",
            "LIVEKIT_AUDIO_APM_ENABLED": "1",
            "LIVEKIT_AUDIO_APM_ECHO_CANCELLATION": "0",
            "LIVEKIT_AUDIO_APM_NOISE_SUPPRESSION": "1",
            "LIVEKIT_AUDIO_APM_HIGH_PASS_FILTER": "1",
            "LIVEKIT_AUDIO_APM_AUTO_GAIN_CONTROL": "0",
            "QWEN_ASR_VAD_THRESHOLD": "0.02",
            "QWEN_ASR_VAD_SILENCE_DURATION_MS": "650",
            "QWEN_ASR_BARGE_IN_MIN_SPEECH_MS": "240",
            "QWEN_ASR_MIN_COMMIT_SPEECH_MS": "360",
            "QWEN_TTS_REALTIME_URL": "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
            "QWEN_TTS_REALTIME_MODEL": "qwen3-tts-flash-realtime",
            "QWEN_TTS_REALTIME_VOICE": "Cherry",
            "QWEN_TTS_REALTIME_SAMPLE_RATE": "16000",
            "QWEN_TTS_CONNECT_TIMEOUT_SECONDS": "12",
            "QWEN_TTS_REQUEST_TIMEOUT_SECONDS": "21",
            "VOXFLAME_PROVIDER_CAPACITY_DIRECTORY": "/tmp/voxflame-test-capacity",
            "VOXFLAME_PROVIDER_ASR_MAX_CONCURRENCY": "7",
            "VOXFLAME_PROVIDER_ASR_WAIT_TIMEOUT_SECONDS": "0.4",
            "VOXFLAME_PROVIDER_ASR_FALLBACK_MAX_CONCURRENCY": "8",
            "VOXFLAME_PROVIDER_ASR_FALLBACK_WAIT_TIMEOUT_SECONDS": "0.6",
            "VOXFLAME_PROVIDER_LLM_MAX_CONCURRENCY": "6",
            "VOXFLAME_PROVIDER_LLM_WAIT_TIMEOUT_SECONDS": "0.3",
            "VOXFLAME_PROVIDER_TTS_MAX_CONCURRENCY": "5",
            "VOXFLAME_PROVIDER_TTS_WAIT_TIMEOUT_SECONDS": "0.2",
        }
        previous = {key: os.environ.get(key) for key in env_updates}

        try:
            os.environ.update(env_updates)
            config = load_config()
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertEqual(config.livekit_url, "ws://127.0.0.1:7880")
        self.assertEqual(config.livekit_api_key, "devkey")
        self.assertEqual(config.livekit_api_secret, "secret")
        self.assertEqual(config.agent_name, "voxflame-agent")
        self.assertEqual(config.mode, "communication_stub")
        self.assertEqual(config.dashscope_api_key, "dashscope-test")
        self.assertEqual(
            config.dashscope_base_url,
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        self.assertEqual(config.dashscope_correction_model, "qwen-flash")
        self.assertEqual(config.dashscope_llm_model, "qwen-flash")
        self.assertEqual(config.dashscope_timeout_seconds, 9.5)
        self.assertEqual(config.dashscope_reply_timeout_seconds, 3.2)
        self.assertEqual(config.dashscope_llm_temperature, 0.1)
        self.assertEqual(config.dashscope_llm_max_tokens, 32)
        self.assertTrue(config.dashscope_session_cache_enabled)
        self.assertEqual(config.dashscope_asr_url, "wss://dashscope.aliyuncs.com/api-ws/v1/realtime")
        self.assertEqual(config.dashscope_asr_model, "qwen3-asr-flash-realtime-2026-02-10")
        self.assertEqual(config.dashscope_asr_sample_rate, 16000)
        self.assertEqual(config.dashscope_asr_language, "zh")
        self.assertTrue(config.dashscope_asr_enable_interim)
        self.assertEqual(config.dashscope_asr_connect_timeout_seconds, 11)
        self.assertEqual(config.qwen_http_asr_url, "http://121.41.45.9:8080/transcribe")
        self.assertEqual(config.qwen_http_asr_language, "Chinese")
        self.assertEqual(config.qwen_http_asr_timeout_seconds, 18)
        self.assertTrue(config.livekit_audio_apm_enabled)
        self.assertFalse(config.livekit_audio_apm_echo_cancellation)
        self.assertTrue(config.livekit_audio_apm_noise_suppression)
        self.assertTrue(config.livekit_audio_apm_high_pass_filter)
        self.assertFalse(config.livekit_audio_apm_auto_gain_control)
        self.assertEqual(config.dashscope_asr_vad_threshold, 0.02)
        self.assertEqual(config.dashscope_asr_vad_silence_duration_ms, 650)
        self.assertEqual(config.dashscope_asr_barge_in_min_speech_ms, 240)
        self.assertEqual(config.dashscope_asr_min_commit_speech_ms, 360)
        self.assertEqual(config.dashscope_tts_url, "wss://dashscope.aliyuncs.com/api-ws/v1/realtime")
        self.assertEqual(config.dashscope_tts_model, "qwen3-tts-flash-realtime")
        self.assertEqual(config.dashscope_tts_voice, "Cherry")
        self.assertEqual(config.dashscope_tts_sample_rate, 16000)
        self.assertEqual(config.dashscope_tts_connect_timeout_seconds, 12)
        self.assertEqual(config.dashscope_tts_request_timeout_seconds, 21)
        self.assertEqual(config.provider_capacity_directory, "/tmp/voxflame-test-capacity")
        self.assertEqual(config.provider_asr_max_concurrency, 7)
        self.assertEqual(config.provider_asr_wait_timeout_seconds, 0.4)
        self.assertEqual(config.provider_asr_fallback_max_concurrency, 8)
        self.assertEqual(config.provider_asr_fallback_wait_timeout_seconds, 0.6)
        self.assertEqual(config.provider_llm_max_concurrency, 6)
        self.assertEqual(config.provider_llm_wait_timeout_seconds, 0.3)
        self.assertEqual(config.provider_tts_max_concurrency, 5)
        self.assertEqual(config.provider_tts_wait_timeout_seconds, 0.2)

    def test_dashscope_tts_model_alias_can_select_another_aliyun_model(self) -> None:
        previous = {key: os.environ.get(key) for key in ("DASHSCOPE_TTS_MODEL", "ALIYUN_TTS_MODEL", "QWEN_TTS_REALTIME_MODEL")}
        try:
            os.environ.update({
                "LIVEKIT_URL": "ws://127.0.0.1:7880",
                "LIVEKIT_API_KEY": "devkey",
                "LIVEKIT_API_SECRET": "secret",
                "DASHSCOPE_TTS_MODEL": "cosyvoice-v3-flash",
            })
            config = load_config()
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        self.assertEqual(config.dashscope_tts_model, "cosyvoice-v3-flash")


if __name__ == "__main__":
    unittest.main()
