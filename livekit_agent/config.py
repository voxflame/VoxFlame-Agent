from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class LiveKitAgentConfig:
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    agent_name: str
    mode: str
    dashscope_api_key: str | None
    dashscope_base_url: str
    dashscope_correction_model: str
    dashscope_llm_model: str
    dashscope_timeout_seconds: float
    dashscope_reply_timeout_seconds: float
    dashscope_llm_temperature: float
    dashscope_llm_max_tokens: int
    dashscope_session_cache_enabled: bool
    dashscope_asr_url: str
    dashscope_asr_model: str
    dashscope_asr_sample_rate: int
    dashscope_asr_language: str
    dashscope_asr_enable_interim: bool
    dashscope_asr_connect_timeout_seconds: int
    qwen_http_asr_url: str | None
    qwen_http_asr_language: str
    qwen_http_asr_timeout_seconds: float
    livekit_audio_apm_enabled: bool
    livekit_audio_apm_echo_cancellation: bool
    livekit_audio_apm_noise_suppression: bool
    livekit_audio_apm_high_pass_filter: bool
    livekit_audio_apm_auto_gain_control: bool
    dashscope_asr_vad_threshold: float
    dashscope_asr_vad_silence_duration_ms: int
    dashscope_asr_barge_in_min_speech_ms: int
    dashscope_asr_min_commit_speech_ms: int
    dashscope_tts_url: str
    dashscope_tts_model: str
    dashscope_tts_voice: str
    dashscope_tts_sample_rate: int
    dashscope_tts_connect_timeout_seconds: int
    dashscope_tts_request_timeout_seconds: float
    log_level: str
    audio_duplex_mode: str = "half"
    audio_playout_tail_seconds: float = 0.3
    provider_capacity_directory: str = "/tmp/voxflame-provider-capacity"
    provider_asr_max_concurrency: int = 4
    provider_asr_wait_timeout_seconds: float = 0.25
    provider_asr_fallback_max_concurrency: int = 4
    provider_asr_fallback_wait_timeout_seconds: float = 0.25
    provider_llm_max_concurrency: int = 8
    provider_llm_wait_timeout_seconds: float = 0.25
    provider_tts_max_concurrency: int = 3
    provider_tts_wait_timeout_seconds: float = 3.0


def should_bypass_proxy_for_livekit(livekit_url: str) -> bool:
    parsed = urlparse(livekit_url)
    hostname = (parsed.hostname or "").strip().lower()
    return hostname in {"127.0.0.1", "localhost", "livekit-server"}


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def load_config() -> LiveKitAgentConfig:
    duplex_mode = os.getenv("VOXFLAME_AUDIO_DUPLEX_MODE", "half").strip().lower()
    if duplex_mode not in {"half", "full"}:
        raise ValueError("VOXFLAME_AUDIO_DUPLEX_MODE must be half or full")
    playout_tail = float(os.getenv("VOXFLAME_AUDIO_PLAYOUT_TAIL_SECONDS", "0.3"))
    if not 0 <= playout_tail <= 2:
        raise ValueError("VOXFLAME_AUDIO_PLAYOUT_TAIL_SECONDS must be between 0 and 2")
    return LiveKitAgentConfig(
        audio_duplex_mode=duplex_mode,
        audio_playout_tail_seconds=playout_tail,
        livekit_url=_required_env("LIVEKIT_URL"),
        livekit_api_key=_required_env("LIVEKIT_API_KEY"),
        livekit_api_secret=_required_env("LIVEKIT_API_SECRET"),
        agent_name=os.getenv("LIVEKIT_AGENT_NAME", "voxflame-agent").strip() or "voxflame-agent",
        mode=os.getenv("VOXFLAME_LIVEKIT_AGENT_MODE", "communication_stub").strip()
        or "communication_stub",
        dashscope_api_key=os.getenv("DASHSCOPE_API_KEY", "").strip() or None,
        dashscope_base_url=(
            os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
            .strip()
            .rstrip("/")
        ),
        dashscope_correction_model=(
            os.getenv("DASHSCOPE_CORRECTION_MODEL")
            or os.getenv("DASHSCOPE_LLM_MODEL")
            or "qwen-flash"
        ).strip()
        or "qwen-flash",
        dashscope_llm_model=os.getenv("DASHSCOPE_LLM_MODEL", "qwen-flash").strip()
        or "qwen-flash",
        dashscope_timeout_seconds=float(os.getenv("DASHSCOPE_TIMEOUT_SECONDS", "15").strip() or "15"),
        dashscope_reply_timeout_seconds=float(
            os.getenv("DASHSCOPE_REPLY_TIMEOUT_SECONDS", "4.5").strip() or "4.5"
        ),
        dashscope_llm_temperature=float(
            os.getenv("DASHSCOPE_LLM_TEMPERATURE", "0.1").strip() or "0.1"
        ),
        dashscope_llm_max_tokens=int(
            os.getenv("DASHSCOPE_LLM_MAX_TOKENS", "32").strip() or "32"
        ),
        dashscope_session_cache_enabled=(
            os.getenv("DASHSCOPE_SESSION_CACHE_ENABLED", "0").strip().lower()
            not in {"0", "false", "no"}
        ),
        dashscope_asr_url=(
            os.getenv("QWEN_ASR_REALTIME_URL", "wss://dashscope.aliyuncs.com/api-ws/v1/realtime")
            .strip()
        ),
        dashscope_asr_model=(
            os.getenv("QWEN_ASR_REALTIME_MODEL", "qwen3-asr-flash-realtime-2026-02-10").strip()
            or "qwen3-asr-flash-realtime-2026-02-10"
        ),
        dashscope_asr_sample_rate=int(os.getenv("QWEN_ASR_REALTIME_SAMPLE_RATE", "16000").strip() or "16000"),
        dashscope_asr_language=os.getenv("QWEN_ASR_REALTIME_LANGUAGE", "zh").strip() or "zh",
        dashscope_asr_enable_interim=(
            os.getenv("QWEN_ASR_ENABLE_INTERIM", "1").strip().lower() not in {"0", "false", "no"}
        ),
        dashscope_asr_connect_timeout_seconds=int(
            os.getenv("QWEN_ASR_CONNECT_TIMEOUT_SECONDS", "15").strip() or "15"
        ),
        qwen_http_asr_url=(os.getenv("QWEN_HTTP_ASR_URL", "").strip() or None),
        qwen_http_asr_language=os.getenv("QWEN_HTTP_ASR_LANGUAGE", "Chinese").strip()
        or "Chinese",
        qwen_http_asr_timeout_seconds=float(
            os.getenv("QWEN_HTTP_ASR_TIMEOUT_SECONDS", "5").strip() or "5"
        ),
        livekit_audio_apm_enabled=(
            os.getenv("LIVEKIT_AUDIO_APM_ENABLED", "1").strip().lower() not in {"0", "false", "no"}
        ),
        livekit_audio_apm_echo_cancellation=(
            os.getenv("LIVEKIT_AUDIO_APM_ECHO_CANCELLATION", "0").strip().lower()
            not in {"0", "false", "no"}
        ),
        livekit_audio_apm_noise_suppression=(
            os.getenv("LIVEKIT_AUDIO_APM_NOISE_SUPPRESSION", "1").strip().lower()
            not in {"0", "false", "no"}
        ),
        livekit_audio_apm_high_pass_filter=(
            os.getenv("LIVEKIT_AUDIO_APM_HIGH_PASS_FILTER", "1").strip().lower()
            not in {"0", "false", "no"}
        ),
        livekit_audio_apm_auto_gain_control=(
            os.getenv("LIVEKIT_AUDIO_APM_AUTO_GAIN_CONTROL", "0").strip().lower()
            not in {"0", "false", "no"}
        ),
        dashscope_asr_vad_threshold=float(os.getenv("QWEN_ASR_VAD_THRESHOLD", "0.032").strip() or "0.032"),
        dashscope_asr_vad_silence_duration_ms=int(
            os.getenv("QWEN_ASR_VAD_SILENCE_DURATION_MS", "860").strip() or "860"
        ),
        dashscope_asr_barge_in_min_speech_ms=int(
            os.getenv("QWEN_ASR_BARGE_IN_MIN_SPEECH_MS", "360").strip() or "360"
        ),
        dashscope_asr_min_commit_speech_ms=int(
            os.getenv("QWEN_ASR_MIN_COMMIT_SPEECH_MS", "420").strip() or "420"
        ),
        dashscope_tts_url=(
            os.getenv("QWEN_TTS_REALTIME_URL", "wss://dashscope.aliyuncs.com/api-ws/v1/realtime")
            .strip()
        ),
        dashscope_tts_model=(
            (
                os.getenv("DASHSCOPE_TTS_MODEL")
                or os.getenv("ALIYUN_TTS_MODEL")
                or os.getenv("QWEN_TTS_REALTIME_MODEL")
                or "qwen3-tts-flash-realtime"
            ).strip()
            or "qwen3-tts-flash-realtime"
        ),
        dashscope_tts_voice=(
            os.getenv("DASHSCOPE_TTS_VOICE")
            or os.getenv("ALIYUN_TTS_VOICE")
            or os.getenv("QWEN_TTS_REALTIME_VOICE")
            or "Cherry"
        ).strip()
        or "Cherry",
        dashscope_tts_sample_rate=int(os.getenv("QWEN_TTS_REALTIME_SAMPLE_RATE", "16000").strip() or "16000"),
        dashscope_tts_connect_timeout_seconds=int(
            os.getenv("QWEN_TTS_CONNECT_TIMEOUT_SECONDS", "15").strip() or "15"
        ),
        dashscope_tts_request_timeout_seconds=float(
            os.getenv("QWEN_TTS_REQUEST_TIMEOUT_SECONDS", "20").strip() or "20"
        ),
        log_level=os.getenv("LOG_LEVEL", "info").strip().lower() or "info",
        provider_capacity_directory=(
            os.getenv("VOXFLAME_PROVIDER_CAPACITY_DIRECTORY", "/tmp/voxflame-provider-capacity").strip()
            or "/tmp/voxflame-provider-capacity"
        ),
        provider_asr_max_concurrency=int(
            os.getenv("VOXFLAME_PROVIDER_ASR_MAX_CONCURRENCY", "4").strip() or "4"
        ),
        provider_asr_wait_timeout_seconds=float(os.getenv("VOXFLAME_PROVIDER_ASR_WAIT_TIMEOUT_SECONDS", "0.25").strip() or "0.25"),
        provider_asr_fallback_max_concurrency=int(
            os.getenv("VOXFLAME_PROVIDER_ASR_FALLBACK_MAX_CONCURRENCY", "4").strip() or "4"
        ),
        provider_asr_fallback_wait_timeout_seconds=float(
            os.getenv("VOXFLAME_PROVIDER_ASR_FALLBACK_WAIT_TIMEOUT_SECONDS", "0.25").strip()
            or "0.25"
        ),
        provider_llm_max_concurrency=int(
            os.getenv("VOXFLAME_PROVIDER_LLM_MAX_CONCURRENCY", "8").strip() or "8"
        ),
        provider_llm_wait_timeout_seconds=float(os.getenv("VOXFLAME_PROVIDER_LLM_WAIT_TIMEOUT_SECONDS", "0.25").strip() or "0.25"),
        provider_tts_max_concurrency=int(
            os.getenv("VOXFLAME_PROVIDER_TTS_MAX_CONCURRENCY", "3").strip() or "3"
        ),
        provider_tts_wait_timeout_seconds=float(os.getenv("VOXFLAME_PROVIDER_TTS_WAIT_TIMEOUT_SECONDS", "3").strip() or "3"),
    )
