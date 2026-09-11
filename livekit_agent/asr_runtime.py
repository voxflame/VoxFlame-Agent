from __future__ import annotations

import asyncio
import audioop
import base64
import json
import logging
import re
import time
import uuid
import wave
from io import BytesIO
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any, Protocol
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from capacity import ProcessSlotPool, ProviderCapacityLease, build_provider_pool
from config import LiveKitAgentConfig
from session_context import VoxFlameSessionContext

logger = logging.getLogger("voxflame-livekit-agent.asr")

ServerEventHandler = Callable[[dict[str, Any]], Awaitable[None]]
PublishPayload = Callable[[dict[str, Any]], Awaitable[None]]
FinalTranscriptHandler = Callable[[str], Awaitable[None]]
SpeechActivityHandler = Callable[[str, bool], Awaitable[None]]
AudioTelemetryHandler = Callable[[float, float, bool, bool, str], Awaitable[None]]


class ASRClient(Protocol):
    async def start(self, session_payload: dict[str, Any]) -> None: ...

    async def append_audio(self, pcm_bytes: bytes) -> None: ...

    async def commit_audio(self) -> None: ...

    async def clear_audio(self) -> None: ...

    async def stop(self) -> None: ...
TRANSCRIPT_EDGE_PUNCTUATION_PATTERN = re.compile(
    r"^[\s，。！？!?；;：:、,.…~～-]+|[\s，。！？!?；;：:、,.…~～-]+$"
)
FILLER_TRANSCRIPT_PATTERN = re.compile(r"^(嗯+|呃+|啊+|哦+|喔+|额+|唔+|哼+)$")
MANUAL_STOP_SHORT_TRANSCRIPT_GRACE_SECONDS = 2.0
SHORT_UTTERANCE_EXTRA_FINALIZE_GRACE_SECONDS = 1.1
HTTP_ASR_SUPPORTED_MODES = frozenset({"communication", "training"})


class VADState(Enum):
    IDLE = auto()
    SPEAKING = auto()


def with_model_query(url: str, model: str) -> str:
    if not model:
        return url

    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if query.get("model"):
        return url

    query["model"] = model
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
    )


def build_asr_session_payload(config: LiveKitAgentConfig) -> dict[str, Any]:
    return {
        "modalities": ["text"],
        "input_audio_format": "pcm",
        "sample_rate": config.dashscope_asr_sample_rate,
        "input_audio_transcription": {
            "language": config.dashscope_asr_language,
        },
        "turn_detection": None,
    }


def get_authenticated_user_id(ctx: VoxFlameSessionContext) -> str | None:
    """Read identity only from Backend-created Agent dispatch metadata."""
    payload_value = ctx.dispatch_payload.get("authenticated_user_id")
    if isinstance(payload_value, str) and payload_value.strip():
        return payload_value.strip()
    return None


def get_asr_account_id(ctx: VoxFlameSessionContext) -> str | None:
    """Read the model routing key only from Backend-created Agent dispatch metadata."""
    value = ctx.dispatch_payload.get("asr_account_id")
    return value.strip() if isinstance(value, str) and value.strip() else None


def should_use_qwen_http_asr(config: LiveKitAgentConfig, ctx: VoxFlameSessionContext) -> bool:
    if not config.qwen_http_asr_url:
        return False

    if ctx.mode not in HTTP_ASR_SUPPORTED_MODES:
        return False

    return get_authenticated_user_id(ctx) is not None and get_asr_account_id(ctx) is not None


def frame_to_pcm_bytes(frame: Any) -> bytes:
    data = frame.data.tobytes() if hasattr(frame.data, "tobytes") else bytes(frame.data)
    if getattr(frame, "num_channels", 1) > 1:
        return audioop.tomono(data, 2, 0.5, 0.5)
    return data


def pcm_bytes_to_audio_frame(
    pcm_bytes: bytes,
    *,
    sample_rate: int,
    num_channels: int = 1,
) -> Any:
    from livekit import rtc

    samples_per_channel = len(pcm_bytes) // 2 // num_channels
    if samples_per_channel <= 0:
        raise ValueError("PCM payload is empty")
    return rtc.AudioFrame(
        pcm_bytes,
        sample_rate=sample_rate,
        num_channels=num_channels,
        samples_per_channel=samples_per_channel,
    )


def normalized_rms_energy(pcm_bytes: bytes) -> float:
    if not pcm_bytes:
        return 0.0
    return audioop.rms(pcm_bytes, 2) / 32768.0


def pcm_duration_ms(pcm_bytes: bytes, sample_rate: int) -> float:
    if not pcm_bytes or sample_rate <= 0:
        return 0.0
    samples = len(pcm_bytes) / 2
    return (samples * 1000.0) / sample_rate


def normalized_peak_level(pcm_bytes: bytes) -> float:
    if not pcm_bytes:
        return 0.0
    return audioop.max(pcm_bytes, 2) / 32768.0


def pcm_bytes_to_wav_bytes(
    pcm_bytes: bytes,
    *,
    sample_rate: int,
    num_channels: int = 1,
    sample_width: int = 2,
) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(num_channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_bytes)
    return output.getvalue()


def semantic_transcript_length(text: str) -> int:
    return len(TRANSCRIPT_EDGE_PUNCTUATION_PATTERN.sub("", text.strip()))


def compact_semantic_transcript(text: str) -> str:
    return re.sub(r"[\s，。！？!?；;：:、,.…~～\-《》\"'“”‘’（）()【】\[\]]+", "", text)


def is_repetitive_transcript_noise(text: str) -> bool:
    compact = compact_semantic_transcript(text)
    if len(compact) < 12:
        return False

    if re.search(r"(.)\1{8,}", compact):
        return True

    counts: dict[str, int] = {}
    for char in compact:
        counts[char] = counts.get(char, 0) + 1

    top_count = max(counts.values()) if counts else 0
    return top_count / len(compact) >= 0.65 and len(counts) <= 4


def is_filler_transcript_noise(text: str) -> bool:
    compact = compact_semantic_transcript(text)
    if not compact:
        return True

    return bool(FILLER_TRANSCRIPT_PATTERN.fullmatch(compact))


def build_livekit_audio_apm_options(config: LiveKitAgentConfig) -> dict[str, bool]:
    return {
        "echo_cancellation": config.livekit_audio_apm_echo_cancellation,
        "noise_suppression": config.livekit_audio_apm_noise_suppression,
        "high_pass_filter": config.livekit_audio_apm_high_pass_filter,
        "auto_gain_control": config.livekit_audio_apm_auto_gain_control,
    }


def should_enable_livekit_audio_apm(config: LiveKitAgentConfig) -> bool:
    return config.livekit_audio_apm_enabled and any(build_livekit_audio_apm_options(config).values())


def extract_http_asr_transcript(payload: Any) -> str:
    if isinstance(payload, str):
        return payload.strip()

    if not isinstance(payload, dict):
        return ""

    for key in (
        "text",
        "transcript",
        "result",
        "sentence",
        "recognized_text",
        "recognizedText",
    ):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    for key in ("data", "output"):
        nested = payload.get(key)
        transcript = extract_http_asr_transcript(nested)
        if transcript:
            return transcript

    for key in ("results", "segments"):
        value = payload.get(key)
        if not isinstance(value, list):
            continue
        texts = [extract_http_asr_transcript(item) for item in value]
        joined = "".join(text for text in texts if text)
        if joined:
            return joined.strip()

    return ""


@dataclass
class RMSVoiceActivityDetector:
    threshold: float
    silence_duration_ms: int
    state: VADState = VADState.IDLE
    silence_ms: float = 0.0

    def observe(self, pcm_bytes: bytes, sample_rate: int) -> tuple[bool, bool, float]:
        energy = normalized_rms_energy(pcm_bytes)
        is_speech = energy >= self.threshold
        speech_started = False
        speech_stopped = False

        if is_speech:
            if self.state is VADState.IDLE:
                speech_started = True
            self.state = VADState.SPEAKING
            self.silence_ms = 0.0
            return speech_started, speech_stopped, energy

        if self.state is VADState.SPEAKING:
            self.silence_ms += pcm_duration_ms(pcm_bytes, sample_rate)
            if self.silence_ms >= self.silence_duration_ms:
                self.state = VADState.IDLE
                self.silence_ms = 0.0
                speech_stopped = True

        return speech_started, speech_stopped, energy


@dataclass
class QwenRealtimeASRClient:
    url: str
    model: str
    api_key: str
    connect_timeout_seconds: int
    event_handler: ServerEventHandler
    capacity_pool: ProcessSlotPool | None = None

    websocket: Any = None
    receive_task: asyncio.Task[None] | None = None
    ready_event: asyncio.Event = asyncio.Event()
    _connect_lock: asyncio.Lock = asyncio.Lock()
    _send_lock: asyncio.Lock = asyncio.Lock()
    _session_payload: dict[str, Any] | None = None
    _capacity_lease: ProviderCapacityLease | None = None

    def __post_init__(self) -> None:
        self.url = with_model_query(self.url, self.model)
        self.ready_event = asyncio.Event()
        self._connect_lock = asyncio.Lock()
        self._send_lock = asyncio.Lock()

    def is_ready(self) -> bool:
        return self.websocket is not None and self.ready_event.is_set()

    async def start(self, session_payload: dict[str, Any]) -> None:
        self._session_payload = session_payload
        await self._connect()

    async def append_audio(self, pcm_bytes: bytes) -> None:
        await self._ensure_ready()
        await self._send_json(
            {
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(pcm_bytes).decode("utf-8"),
            }
        )

    async def commit_audio(self) -> None:
        await self._ensure_ready()
        await self._send_json({"type": "input_audio_buffer.commit"})

    async def clear_audio(self) -> None:
        await self._ensure_ready()
        await self._send_json({"type": "input_audio_buffer.clear"})

    async def stop(self) -> None:
        async with self._connect_lock:
            await self._close_current_socket()

    async def _ensure_ready(self) -> None:
        if self.is_ready():
            return
        await self._connect()

    async def _connect(self) -> None:
        if not self._session_payload:
            raise RuntimeError("Qwen realtime ASR session payload is missing")

        async with self._connect_lock:
            if self.is_ready():
                return

            await self._close_current_socket()
            self.ready_event.clear()

            import websockets

            try:
                if self.capacity_pool is not None:
                    self._capacity_lease = await self.capacity_pool.acquire()
                self.websocket = await websockets.connect(
                    self.url,
                    additional_headers=[("Authorization", f"Bearer {self.api_key}")],
                    max_size=512 * 1024,
                    max_queue=4,
                    ping_interval=20,
                    ping_timeout=20,
                    close_timeout=1,
                    open_timeout=self.connect_timeout_seconds,
                )
                self.receive_task = asyncio.create_task(self._receive_loop())
                await self._send_json({"type": "session.update", "session": self._session_payload})
                await asyncio.wait_for(self.ready_event.wait(), timeout=self.connect_timeout_seconds)
            except BaseException:
                await self._close_current_socket()
                raise

    async def _close_current_socket(self) -> None:
        receive_task = self.receive_task
        self.receive_task = None
        websocket = self.websocket
        self.websocket = None
        self.ready_event.clear()

        if receive_task:
            receive_task.cancel()
            try:
                await receive_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        try:
            if websocket:
                await websocket.close()
        finally:
            self._release_capacity_lease()

    def _release_capacity_lease(self) -> None:
        lease = self._capacity_lease
        self._capacity_lease = None
        if lease is not None:
            lease.release()

    async def _send_json(self, payload: dict[str, Any]) -> None:
        if self.websocket is None:
            raise RuntimeError("Qwen realtime ASR websocket is not connected")

        async with self._send_lock:
            payload_to_send = dict(payload)
            payload_to_send.setdefault("event_id", f"event_{uuid.uuid4().hex}")
            await self.websocket.send(json.dumps(payload_to_send, ensure_ascii=False))

    async def _receive_loop(self) -> None:
        websocket = self.websocket
        if websocket is None:
            return

        try:
            async for raw_message in websocket:
                if isinstance(raw_message, bytes):
                    continue

                payload = json.loads(raw_message)
                message_type = str(payload.get("type", "") or "")
                if message_type in {"session.created", "session.updated"}:
                    self.ready_event.set()
                elif message_type == "session.finished":
                    self.ready_event.clear()

                await self.event_handler(payload)
            await self.event_handler({"type": "client.error", "error": {"message": "语音服务连接已关闭，请重试。"}})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self.event_handler(
                {
                    "type": "client.error",
                    "error": {"message": str(exc)},
                }
            )
        finally:
            if websocket is self.websocket:
                self.ready_event.clear()
                self.websocket = None
                self._release_capacity_lease()


@dataclass
class QwenHttpASRClient:
    url: str
    account_id: str
    language: str
    sample_rate: int
    request_timeout_seconds: float
    event_handler: ServerEventHandler
    fallback_factory: Callable[[ServerEventHandler], ASRClient] | None = None
    capacity_pool: ProcessSlotPool | None = None

    _buffer: bytearray = field(default_factory=bytearray)
    _session_payload: dict[str, Any] | None = None
    _http_client: Any | None = None
    max_audio_seconds: float = 120.0
    _buffer_overflow: bool = False

    @property
    def provider_name(self) -> str:
        return "qwen_http_asr"

    @property
    def fallback_provider_name(self) -> str:
        return "dashscope_realtime_asr_backup"

    async def start(self, session_payload: dict[str, Any]) -> None:
        self._session_payload = dict(session_payload)
        await self.event_handler(
            {
                "type": "session.updated",
                "provider": self.provider_name,
                "sample_rate": session_payload.get("sample_rate", self.sample_rate),
            }
        )

    async def append_audio(self, pcm_bytes: bytes) -> None:
        if self._buffer_overflow:
            return
        if len(self._buffer) + len(pcm_bytes) > self.sample_rate * 2 * self.max_audio_seconds:
            self._buffer.clear()
            self._buffer_overflow = True
            return
        self._buffer.extend(pcm_bytes)

    def take_audio(self) -> bytes:
        """Detach the current utterance before scheduling inference; never share buffers."""
        if self._buffer_overflow:
            self._buffer_overflow = False
            self._buffer.clear()
            raise ValueError("录音片段过长，请停止后分段重录；本段未提交识别。")
        pcm = bytes(self._buffer)
        self._buffer.clear()
        return pcm

    async def commit_audio(self) -> None:
        await self.transcribe_audio(self.take_audio(), self.event_handler)

    async def transcribe_audio(self, pcm_bytes: bytes, handler: ServerEventHandler) -> None:
        if not pcm_bytes:
            await handler({"type": "client.error", "error": {"message": "未收到有效音频，请重录。"}})
            return
        await handler({
            "type": "input_audio_buffer.committed", "provider": self.provider_name,
            "audio_ms": pcm_duration_ms(pcm_bytes, self.sample_rate),
        })
        try:
            transcript, routing = await asyncio.wait_for(
                self._transcribe(pcm_bytes), timeout=self.request_timeout_seconds,
            )
        except Exception as exc:
            logger.warning("HTTP ASR failed type=%s; trying isolated fallback", type(exc).__name__)
            try:
                event = await self._fallback_transcribe(pcm_bytes)
            except Exception as fallback_error:
                await handler({"type": "client.error", "error": {
                    "message": "语音识别暂不可用，请重试。",
                    "code": type(fallback_error).__name__,
                }})
                return
            await handler(event)
            return
        await handler({
            "type": "conversation.item.input_audio_transcription.completed",
            "transcript": transcript, "provider": self.provider_name, **routing,
        })

    async def _fallback_transcribe(self, pcm_bytes: bytes) -> dict[str, object]:
        """Each utterance owns its fallback socket and final result, including timeout."""
        if self.fallback_factory is None or self._session_payload is None:
            raise RuntimeError("No ASR fallback configured")
        result: asyncio.Future[dict[str, object]] = asyncio.get_running_loop().create_future()

        async def on_event(event: dict[str, object]) -> None:
            if result.done():
                return
            kind = event.get("type")
            if kind == "conversation.item.input_audio_transcription.completed":
                result.set_result({**event, "provider": self.fallback_provider_name})
            elif kind in {"client.error", "error"}:
                result.set_exception(RuntimeError("ASR fallback failed"))

        fallback = self.fallback_factory(on_event)

        async def run() -> dict[str, object]:
            await fallback.start(self._session_payload)
            await fallback.append_audio(pcm_bytes)
            await fallback.commit_audio()
            return await result

        try:
            return await asyncio.wait_for(run(), timeout=self.request_timeout_seconds)
        finally:
            result.cancel()
            await asyncio.wait_for(fallback.stop(), timeout=2.0)

    async def clear_audio(self) -> None:
        self._buffer.clear()
        self._buffer_overflow = False

    async def stop(self) -> None:
        await self.clear_audio()
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    async def _transcribe(self, pcm_bytes: bytes) -> tuple[str, dict[str, Any]]:
        wav_bytes = pcm_bytes_to_wav_bytes(
            pcm_bytes,
            sample_rate=self.sample_rate,
            num_channels=1,
            sample_width=2,
        )
        files = {
            "audio": (
                "voxflame_capture.wav",
                wav_bytes,
                "audio/wav",
            )
        }
        data = {"language": self.language}
        headers = {"X-Account-ID": self.account_id}

        client = self._get_http_client()
        if self.capacity_pool is None:
            response = await client.post(
                self.url,
                headers=headers,
                data=data,
                files=files,
            )
        else:
            async with self.capacity_pool.lease():
                response = await client.post(
                    self.url,
                    headers=headers,
                    data=data,
                    files=files,
                )

        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            payload = response.json()
        else:
            try:
                payload = response.json()
            except ValueError:
                payload = response.text

        transcript = extract_http_asr_transcript(payload)
        if not transcript:
            raise RuntimeError("HTTP ASR response did not include transcript text")

        routing_metadata: dict[str, Any] = {}
        if isinstance(payload, dict):
            response_account_id = payload.get("account_id")
            if not isinstance(response_account_id, str) or not response_account_id.strip():
                raise RuntimeError("HTTP ASR response did not include account_id")
            if response_account_id.strip() != self.account_id:
                raise RuntimeError("HTTP ASR response account_id did not match request")

            model_version = payload.get("model_version")
            if isinstance(model_version, str) and model_version.strip():
                routing_metadata["model_version"] = model_version.strip()
            for key in ("personalized", "fallback"):
                if isinstance(payload.get(key), bool):
                    routing_metadata[key] = payload[key]

        return transcript, routing_metadata

    def _get_http_client(self) -> Any:
        if self._http_client is None:
            import httpx

            self._http_client = httpx.AsyncClient(
                timeout=self.request_timeout_seconds,
                trust_env=False,
            )
        return self._http_client


@dataclass(frozen=True)
class ASRCapture:
    client_capture_id: str | None
    generation: int
    short_expected: bool
    speech_ms: float
    ignore_short: bool


@dataclass
class LiveKitASRRuntime:
    config: LiveKitAgentConfig
    ctx: VoxFlameSessionContext
    participant: Any
    publish_payload: PublishPayload
    on_final_transcript: FinalTranscriptHandler
    on_speech_activity: SpeechActivityHandler | None = None
    on_audio_telemetry: AudioTelemetryHandler | None = None
    client: ASRClient | None = None
    capacity_pool: ProcessSlotPool | None = None
    fallback_capacity_pool: ProcessSlotPool | None = None
    _stream_task: asyncio.Task[None] | None = None
    _started: bool = False
    _audio_frame_count: int = 0
    _logged_first_frame: bool = False
    _vad: RMSVoiceActivityDetector | None = None
    _audio_apm: Any | None = None
    _received_voice_since_commit: bool = False
    _speech_ms_since_commit: float = 0.0
    _barge_in_triggered_since_commit: bool = False
    _level_sum_since_commit: float = 0.0
    _level_count_since_commit: int = 0
    _peak_level_since_commit: float = 0.0
    _clipping_detected_since_commit: bool = False
    _clipping_reported_since_commit: bool = False
    _apm_remainder: bytes = b""
    _ignore_short_transcripts_until: float = 0.0
    _client_recording_active: bool = False
    _client_capture_tracking_enabled: bool = False
    _client_capture_id: int = 0
    _last_committed_client_capture_id: int | None = None
    _client_capture_external_id: str | None = None
    _last_committed_client_capture_external_id: str | None = None
    _pending_final_transcript_client_capture_ids: list[str] = field(default_factory=list)
    _suppress_vad_auto_finalize_until: float = 0.0
    _short_utterance_capture_expected: bool = False
    _asr_source: str = "dashscope_realtime_asr"
    _recognition_tasks: set[asyncio.Task[None]] = field(default_factory=set)
    _speech_generation: int = 0
    input_allowed: Callable[[], bool] | None = None
    _input_suppressed: bool = False

    def _primary_capacity_pool(self) -> ProcessSlotPool:
        if self.capacity_pool is None:
            self.capacity_pool = build_provider_pool(
                provider="asr",
                slots=self.config.provider_asr_max_concurrency,
                wait_timeout_seconds=self.config.provider_asr_wait_timeout_seconds,
                lock_directory=self.config.provider_capacity_directory,
            )
        return self.capacity_pool

    def _realtime_fallback_capacity_pool(self) -> ProcessSlotPool:
        if self.fallback_capacity_pool is None:
            self.fallback_capacity_pool = build_provider_pool(
                provider="asr-fallback",
                slots=self.config.provider_asr_fallback_max_concurrency,
                wait_timeout_seconds=(
                    self.config.provider_asr_fallback_wait_timeout_seconds
                ),
                lock_directory=self.config.provider_capacity_directory,
            )
        return self.fallback_capacity_pool

    async def start(self) -> None:
        if self._stream_task is not None:
            return

        from livekit import rtc

        use_http_asr = should_use_qwen_http_asr(self.config, self.ctx)
        if not use_http_asr and not self.config.dashscope_api_key:
            logger.warning("DashScope ASR is disabled because DASHSCOPE_API_KEY is missing")
            return

        if self.client is None:
            primary_capacity_pool = self._primary_capacity_pool()
            if use_http_asr:
                account_id = get_asr_account_id(self.ctx)
                if account_id is None:
                    raise RuntimeError("HTTP ASR selected without an authenticated account ID")
                def fallback_factory(handler: ServerEventHandler) -> ASRClient:
                    return QwenRealtimeASRClient(
                        url=self.config.dashscope_asr_url,
                        model=self.config.dashscope_asr_model,
                        api_key=self.config.dashscope_api_key or "",
                        connect_timeout_seconds=self.config.dashscope_asr_connect_timeout_seconds,
                        event_handler=handler,
                        capacity_pool=self._realtime_fallback_capacity_pool(),
                    )
                self.client = QwenHttpASRClient(
                    url=self.config.qwen_http_asr_url or "",
                    account_id=account_id,
                    language=self.config.qwen_http_asr_language,
                    sample_rate=self.config.dashscope_asr_sample_rate,
                    request_timeout_seconds=self.config.qwen_http_asr_timeout_seconds,
                    event_handler=self._handle_server_event,
                    fallback_factory=fallback_factory if self.config.dashscope_api_key else None,
                    capacity_pool=primary_capacity_pool,
                )
                self._asr_source = "qwen_http_asr"
            else:
                self.client = QwenRealtimeASRClient(
                    url=self.config.dashscope_asr_url,
                    model=self.config.dashscope_asr_model,
                    api_key=self.config.dashscope_api_key or "",
                    connect_timeout_seconds=self.config.dashscope_asr_connect_timeout_seconds,
                    event_handler=self._handle_server_event,
                    capacity_pool=primary_capacity_pool,
                )
                self._asr_source = "dashscope_realtime_asr"

        logger.info(
            "LiveKit ASR runtime starting room=%s participant=%s provider=%s model=%s sample_rate=%s interim=%s vad_threshold=%s vad_silence_ms=%s barge_in_min_speech_ms=%s",
            self.ctx.room_name,
            self.ctx.participant_identity,
            self._asr_source,
            self.config.dashscope_asr_model,
            self.config.dashscope_asr_sample_rate,
            self.config.dashscope_asr_enable_interim,
            self.config.dashscope_asr_vad_threshold,
            self.config.dashscope_asr_vad_silence_duration_ms,
            self.config.dashscope_asr_barge_in_min_speech_ms,
        )
        self._vad = RMSVoiceActivityDetector(
            threshold=self.config.dashscope_asr_vad_threshold,
            silence_duration_ms=self.config.dashscope_asr_vad_silence_duration_ms,
        )
        self._audio_apm = self._create_audio_apm()
        stream = rtc.AudioStream.from_participant(
            participant=self.participant,
            track_source=rtc.TrackSource.SOURCE_MICROPHONE,
            sample_rate=self.config.dashscope_asr_sample_rate,
            num_channels=1,
            frame_size_ms=20,
            capacity=50,
        )
        self._stream_task = asyncio.create_task(self._consume_stream(stream))

    def note_client_recording_event(
        self,
        state: str,
        auto_finalize: bool,
        *,
        short_utterance_expected: bool = False,
        client_capture_id: str | None = None,
    ) -> None:
        normalized_state = state.strip()
        if not normalized_state:
            return

        if normalized_state == "speech_started":
            self._speech_generation += 1
            self._client_recording_active = True
            self._client_capture_tracking_enabled = True
            self._client_capture_id += 1
            self._last_committed_client_capture_id = None
            self._client_capture_external_id = (
                client_capture_id.strip()
                if isinstance(client_capture_id, str) and client_capture_id.strip()
                else str(self._client_capture_id)
            )
            self._suppress_vad_auto_finalize_until = 0.0
            self._short_utterance_capture_expected = short_utterance_expected
            return

        if normalized_state == "speech_stopped":
            if (
                client_capture_id
                and self._client_capture_external_id
                and client_capture_id != self._client_capture_external_id
            ):
                logger.warning(
                    "LiveKit ASR stale client stop ignored room=%s participant=%s expected_capture_id=%s active_capture_id=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    client_capture_id,
                    self._client_capture_external_id,
                )
                return
            self._client_recording_active = False
            if auto_finalize:
                suppression_seconds = self.config.dashscope_asr_vad_silence_duration_ms / 1000.0
                if self._short_utterance_capture_expected:
                    suppression_seconds = max(
                        suppression_seconds,
                        SHORT_UTTERANCE_EXTRA_FINALIZE_GRACE_SECONDS,
                    )
                self._suppress_vad_auto_finalize_until = time.monotonic() + (
                    suppression_seconds
                )

    def _is_duplicate_client_capture_commit(self) -> bool:
        return (
            self._client_capture_tracking_enabled
            and self._client_capture_id > 0
            and self._last_committed_client_capture_id == self._client_capture_id
        )

    def _mark_client_capture_committed(self, queue_final_transcript: bool = True) -> None:
        if self._client_capture_tracking_enabled and self._client_capture_id > 0:
            self._last_committed_client_capture_id = self._client_capture_id
            self._last_committed_client_capture_external_id = self._client_capture_external_id
            if queue_final_transcript and self._client_capture_external_id:
                self._pending_final_transcript_client_capture_ids.append(self._client_capture_external_id)

    async def commit_audio(
        self,
        reason: str | None = None,
        *,
        client_capture_id: str | None = None,
    ) -> None:
        if self.client is None or not self._started:
            return

        if (
            client_capture_id
            and self._client_capture_external_id
            and client_capture_id != self._client_capture_external_id
        ):
            logger.warning(
                "LiveKit ASR stale capture commit ignored room=%s participant=%s reason=%s expected_capture_id=%s active_capture_id=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
                reason or "unknown",
                client_capture_id,
                self._client_capture_external_id,
            )
            return

        if self._is_duplicate_client_capture_commit():
            logger.info(
                "LiveKit ASR duplicate commit ignored room=%s participant=%s reason=%s capture_id=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
                reason or "unknown",
                self._client_capture_id,
            )
            return

        if (
            reason == "manual_stop"
            and self._client_capture_tracking_enabled
            and self._speech_ms_since_commit < self.config.dashscope_asr_min_commit_speech_ms
            and not isinstance(self.client, QwenHttpASRClient)
        ):
            logger.info(
                "LiveKit ASR manual commit skipped because capture had no stable speech room=%s participant=%s capture_id=%s speech_ms=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
                self._client_capture_id,
                int(self._speech_ms_since_commit),
            )
            await self.client.clear_audio()
            self._mark_client_capture_committed(queue_final_transcript=False)
            self._received_voice_since_commit = False
            self._speech_ms_since_commit = 0.0
            self._barge_in_triggered_since_commit = False
            self._level_sum_since_commit = 0.0
            self._level_count_since_commit = 0
            self._peak_level_since_commit = 0.0
            self._clipping_detected_since_commit = False
            self._clipping_reported_since_commit = False
            self._apm_remainder = b""
            return

        self._ignore_short_transcripts_until = 0.0
        if reason == "manual_stop" and not self._short_utterance_capture_expected:
            self._ignore_short_transcripts_until = (
                time.monotonic() + MANUAL_STOP_SHORT_TRANSCRIPT_GRACE_SECONDS
            )
        logger.info(
            "LiveKit ASR commit requested room=%s participant=%s reason=%s",
            self.ctx.room_name,
            self.ctx.participant_identity,
            reason or "unknown",
        )
        if isinstance(self.client, QwenHttpASRClient):
            capture = ASRCapture(
                client_capture_id=self._client_capture_external_id,
                generation=self._speech_generation,
                short_expected=self._short_utterance_capture_expected,
                speech_ms=self._speech_ms_since_commit,
                ignore_short=False,
            )
            self._mark_client_capture_committed(queue_final_transcript=False)
            self._reset_utterance()
            try:
                pcm = self.client.take_audio()
                if sum(not task.done() for task in self._recognition_tasks) >= 2:
                    raise ValueError("识别请求处理中，请稍后重试本段录音。")
            except ValueError as exc:
                await self._handle_server_event({"type": "client.error", "error": {"message": str(exc)}}, capture)
                return
            # Detachment and snapshot above contain no await: next capture cannot
            # alter this request's bytes, routing, flags or attribution.
            task = asyncio.create_task(self._recognize_capture(self.client, pcm, capture))
            self._recognition_tasks.add(task)
            task.add_done_callback(self._recognition_tasks.discard)
            return

        # Realtime provider remains the current unauthenticated-session path.
        # Bound outstanding commits; it is not a compatibility reply queue.
        if len(self._pending_final_transcript_client_capture_ids) >= 2:
            await self.client.clear_audio()
            from data_contract import build_error_output
            await self.publish_payload({**build_error_output("识别请求处理中，请稍后重试本段录音。"),
                                        "client_capture_id": self._client_capture_external_id})
            self._mark_client_capture_committed(queue_final_transcript=False)
            self._reset_utterance()
            return
        self._mark_client_capture_committed()
        self._reset_utterance()
        await self.client.commit_audio()

    def _reset_utterance(self) -> None:
        self._received_voice_since_commit = False
        self._speech_ms_since_commit = 0.0
        self._barge_in_triggered_since_commit = False
        self._level_sum_since_commit = 0.0
        self._level_count_since_commit = 0
        self._peak_level_since_commit = 0.0
        self._clipping_detected_since_commit = False
        self._clipping_reported_since_commit = False
        self._apm_remainder = b""
        if self._vad is not None:
            self._vad.state = VADState.IDLE
            self._vad.silence_ms = 0.0

    async def _recognize_capture(self, client: QwenHttpASRClient, pcm: bytes, capture: ASRCapture) -> None:
        async def handler(payload: dict[str, object]) -> None:
            await self._handle_server_event(payload, capture)
        try:
            await client.transcribe_audio(pcm, handler)
        except Exception as exc:
            logger.warning("ASR capture failed type=%s", type(exc).__name__)
            await handler({"type": "client.error", "error": {"message": "语音识别失败，请重试本段。"}})

    async def stop(self) -> None:
        logger.info(
            "LiveKit ASR runtime stopping room=%s participant=%s started=%s frames=%s",
            self.ctx.room_name,
            self.ctx.participant_identity,
            self._started,
            self._audio_frame_count,
        )
        if self._stream_task:
            self._stream_task.cancel()
            await asyncio.gather(self._stream_task, return_exceptions=True)
            self._stream_task = None

        tasks = tuple(self._recognition_tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._recognition_tasks.clear()
        if self.client is not None:
            await self.client.stop()
        self._started = False

    def _create_audio_apm(self) -> Any | None:
        if not should_enable_livekit_audio_apm(self.config):
            logger.info(
                "LiveKit audio APM disabled room=%s participant=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
            )
            return None

        from livekit import rtc

        if self.config.livekit_audio_apm_echo_cancellation:
            raise RuntimeError("Server AEC has no aligned render reference; use verified endpoint AEC or half-duplex")
        options = build_livekit_audio_apm_options(self.config)
        logger.info(
            "LiveKit audio APM enabled room=%s participant=%s options=%s",
            self.ctx.room_name,
            self.ctx.participant_identity,
            options,
        )
        try:
            return rtc.AudioProcessingModule(**options)
        except Exception as exc:
            logger.warning(
                "LiveKit audio APM unavailable room=%s participant=%s error=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
                exc,
            )
            return None

    async def _consume_stream(self, stream: Any) -> None:
        from livekit import rtc

        resampler: rtc.AudioResampler | None = None
        try:
            async for audio_event in stream:
                frame = audio_event.frame
                self._audio_frame_count += 1
                if not self._logged_first_frame:
                    self._logged_first_frame = True
                    logger.info(
                        "LiveKit ASR first audio frame room=%s participant=%s sample_rate=%s channels=%s samples_per_channel=%s",
                        self.ctx.room_name,
                        self.ctx.participant_identity,
                        frame.sample_rate,
                        getattr(frame, "num_channels", 1),
                        getattr(frame, "samples_per_channel", "unknown"),
                    )
                if not self._started:
                    await self._ensure_started()

                frames = [frame]
                if frame.sample_rate != self.config.dashscope_asr_sample_rate:
                    if resampler is None:
                        resampler = rtc.AudioResampler(
                            input_rate=frame.sample_rate,
                            output_rate=self.config.dashscope_asr_sample_rate,
                        )
                    frames = list(resampler.push(frame))

                for current in frames:
                    pcm_bytes = frame_to_pcm_bytes(current)
                    pcm_bytes = self._apply_audio_apm(pcm_bytes, current.sample_rate)
                    if not pcm_bytes:
                        continue
                    should_forward_audio = await self._observe_vad(pcm_bytes, current.sample_rate)
                    if should_forward_audio:
                        await self.client.append_audio(pcm_bytes)
        finally:
            await stream.aclose()

    def _apply_audio_apm(self, pcm_bytes: bytes, sample_rate: int) -> bytes:
        if self._audio_apm is None or not pcm_bytes:
            return pcm_bytes

        samples_per_10ms = sample_rate // 100
        if samples_per_10ms <= 0:
            return pcm_bytes

        chunk_size = samples_per_10ms * 2
        buffered = self._apm_remainder + pcm_bytes
        processed_chunks: list[bytes] = []

        while len(buffered) >= chunk_size:
            chunk = buffered[:chunk_size]
            buffered = buffered[chunk_size:]
            try:
                frame = pcm_bytes_to_audio_frame(
                    chunk,
                    sample_rate=sample_rate,
                    num_channels=1,
                )
                processed = self._audio_apm.process_stream(frame)
                processed_frame = processed if processed is not None else frame
                processed_chunks.append(frame_to_pcm_bytes(processed_frame))
            except Exception as exc:
                logger.warning(
                    "LiveKit audio APM process_stream failed room=%s participant=%s error=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    exc,
                )
                self._audio_apm = None
                self._apm_remainder = b""
                return pcm_bytes

        self._apm_remainder = buffered
        if not processed_chunks:
            return b""
        return b"".join(processed_chunks)

    async def _ensure_started(self) -> None:
        if self._started:
            return
        if self.client is None:
            raise RuntimeError("LiveKit ASR client is not initialized")
        logger.info(
            "LiveKit ASR opening session room=%s participant=%s provider=%s url=%s model=%s",
            self.ctx.room_name,
            self.ctx.participant_identity,
            self._asr_source,
            getattr(self.client, "url", ""),
            self.config.dashscope_asr_model,
        )
        await self.client.start(build_asr_session_payload(self.config))
        self._started = True
        logger.info(
            "LiveKit ASR session ready room=%s participant=%s provider=%s",
            self.ctx.room_name,
            self.ctx.participant_identity,
            self._asr_source,
        )

    async def _observe_vad(self, pcm_bytes: bytes, sample_rate: int) -> bool:
        if self.input_allowed is not None and not self.input_allowed():
            if not self._input_suppressed:
                self._input_suppressed = True
                self._reset_utterance()
                if self.client is not None:
                    await self.client.clear_audio()
            return False
        self._input_suppressed = False
        if self._vad is None:
            return True
        if self._client_capture_tracking_enabled and not self._client_recording_active:
            return False

        speech_started, speech_stopped, energy = self._vad.observe(pcm_bytes, sample_rate)
        peak_level = normalized_peak_level(pcm_bytes)
        chunk_duration_ms = pcm_duration_ms(pcm_bytes, sample_rate)
        self._level_sum_since_commit += energy
        self._level_count_since_commit += 1
        self._peak_level_since_commit = max(self._peak_level_since_commit, peak_level)
        clipping_detected = peak_level >= 0.98
        self._clipping_detected_since_commit = self._clipping_detected_since_commit or clipping_detected

        if speech_started:
            if not self._client_capture_tracking_enabled:
                self._speech_generation += 1
            self._received_voice_since_commit = True
            self._speech_ms_since_commit += chunk_duration_ms
            self._barge_in_triggered_since_commit = False
            logger.info(
                "LiveKit VAD speech_started room=%s participant=%s energy=%.4f threshold=%.4f",
                self.ctx.room_name,
                self.ctx.participant_identity,
                energy,
                self.config.dashscope_asr_vad_threshold,
            )
            if self.on_speech_activity is not None:
                await self.on_speech_activity("speech_started", False)
            await self._emit_audio_telemetry("speech_started")
            return True

        if self._vad.state is VADState.SPEAKING:
            self._received_voice_since_commit = True
            if energy >= self.config.dashscope_asr_vad_threshold:
                self._speech_ms_since_commit += chunk_duration_ms
            if clipping_detected and not self._clipping_reported_since_commit:
                self._clipping_reported_since_commit = True
                await self._emit_audio_telemetry("clipping_detected")
            if (
                not self._barge_in_triggered_since_commit
                and self._speech_ms_since_commit >= self.config.dashscope_asr_barge_in_min_speech_ms
            ):
                self._barge_in_triggered_since_commit = True
                logger.info(
                    "LiveKit barge-in triggered room=%s participant=%s speech_ms=%s threshold_ms=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    round(self._speech_ms_since_commit),
                    self.config.dashscope_asr_barge_in_min_speech_ms,
                )
                if self.on_speech_activity is not None:
                    await self.on_speech_activity("barge_in_triggered", False)
            return True

        if speech_stopped and self._received_voice_since_commit:
            if self._client_capture_tracking_enabled and self._client_recording_active:
                logger.info(
                    "LiveKit ASR auto finalize deferred until client stop room=%s participant=%s capture_id=%s speech_ms=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    self._client_capture_external_id,
                    round(self._speech_ms_since_commit),
                )
                return False
            if (
                not self._client_recording_active
                and time.monotonic() < self._suppress_vad_auto_finalize_until
            ):
                logger.info(
                    "LiveKit ASR auto finalize suppressed after client stop room=%s participant=%s speech_ms=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    round(self._speech_ms_since_commit),
                )
                self._received_voice_since_commit = False
                self._speech_ms_since_commit = 0.0
                self._barge_in_triggered_since_commit = False
                return False
            await self._emit_audio_telemetry("speech_stopped")
            logger.info(
                "LiveKit VAD speech_stopped room=%s participant=%s silence_ms=%s speech_ms=%s -> auto_finalize",
                self.ctx.room_name,
                self.ctx.participant_identity,
                self.config.dashscope_asr_vad_silence_duration_ms,
                round(self._speech_ms_since_commit),
            )
            if self.on_speech_activity is not None:
                await self.on_speech_activity("speech_stopped", True)
            await self.commit_audio("vad_auto_finalize")

        return False

    async def _emit_audio_telemetry(self, reason: str) -> None:
        if self.on_audio_telemetry is None or self._level_count_since_commit <= 0:
            return

        normalized_level = self._level_sum_since_commit / self._level_count_since_commit
        await self.on_audio_telemetry(
            normalized_level,
            self._peak_level_since_commit,
            self._clipping_detected_since_commit,
            self._audio_apm is not None,
            reason,
        )

    async def _handle_server_event(self, payload: dict[str, object], capture: ASRCapture | None = None) -> None:
        from data_contract import build_error_output, build_user_transcript_output

        message_type = str(payload.get("type", "") or "")
        short_expected = capture.short_expected if capture else self._short_utterance_capture_expected
        speech_ms = capture.speech_ms if capture else self._speech_ms_since_commit
        if (capture is not None and getattr(self.ctx, "mode", "communication") != "training"
                and capture.generation != self._speech_generation):
            return

        if message_type in {"session.created", "session.updated"}:
            logger.info(
                "LiveKit ASR session event room=%s participant=%s type=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
                message_type,
            )
            return

        if message_type == "input_audio_buffer.committed":
            logger.info(
                "LiveKit ASR audio buffer committed room=%s participant=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
            )
            return

        if message_type == "conversation.item.input_audio_transcription.text":
            if not self.config.dashscope_asr_enable_interim:
                return

            text = str(payload.get("text", "") or "").strip()
            if not text:
                return
            if is_repetitive_transcript_noise(text):
                logger.info(
                    "LiveKit ASR ignored repetitive interim noise room=%s participant=%s chars=%s preview=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    len(text),
                    text[:80],
                )
                return
            if (
                is_filler_transcript_noise(text)
                and not short_expected
                and speech_ms < self.config.dashscope_asr_min_commit_speech_ms
            ):
                logger.info(
                    "LiveKit ASR ignored filler interim noise room=%s participant=%s chars=%s preview=%s speech_ms=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    len(text),
                    text[:80],
                    round(self._speech_ms_since_commit),
                )
                return

            logger.info(
                "LiveKit ASR interim transcript room=%s participant=%s chars=%s preview=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
                len(text),
                text[:80],
            )

            await self.publish_payload(
                build_user_transcript_output(
                    self.ctx,
                    text,
                    is_final=False,
                    source=self._asr_source,
                    client_capture_id=self._client_capture_external_id,
                )
            )
            return

        if message_type == "conversation.item.input_audio_transcription.completed":
            final_capture_external_id = capture.client_capture_id if capture else (
                self._pending_final_transcript_client_capture_ids.pop(0)
                if self._pending_final_transcript_client_capture_ids
                else self._last_committed_client_capture_external_id
                or self._client_capture_external_id
            )
            ignore_short_transcript = capture.ignore_short if capture else time.monotonic() <= self._ignore_short_transcripts_until
            transcript = str(payload.get("transcript", "") or "").strip()
            if not transcript:
                transcript = str(payload.get("text", "") or "").strip()
            if not transcript:
                if ignore_short_transcript and capture is None:
                    self._ignore_short_transcripts_until = 0.0
                logger.warning(
                    "LiveKit ASR final transcript event had no text room=%s participant=%s payload=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    payload,
                )
                return

            if is_repetitive_transcript_noise(transcript):
                if capture is None:
                    self._ignore_short_transcripts_until = 0.0
                logger.info(
                    "LiveKit ASR ignored repetitive noise transcript room=%s participant=%s chars=%s preview=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    len(transcript),
                    transcript[:80],
                )
                return
            if (
                is_filler_transcript_noise(transcript)
                and not short_expected
                and speech_ms < self.config.dashscope_asr_min_commit_speech_ms
            ):
                if capture is None:
                    self._ignore_short_transcripts_until = 0.0
                logger.info(
                    "LiveKit ASR ignored filler transcript noise room=%s participant=%s chars=%s transcript=%s speech_ms=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    len(transcript),
                    transcript,
                    round(self._speech_ms_since_commit),
                )
                return

            if ignore_short_transcript:
                if capture is None:
                    self._ignore_short_transcripts_until = 0.0
                if (
                    semantic_transcript_length(transcript) <= 2
                    and not short_expected
                ):
                    logger.info(
                        "LiveKit ASR ignored short manual_stop tail room=%s participant=%s chars=%s transcript=%s",
                        self.ctx.room_name,
                        self.ctx.participant_identity,
                        len(transcript),
                        transcript,
                    )
                    return

            logger.info(
                "LiveKit ASR final transcript room=%s participant=%s chars=%s transcript=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
                len(transcript),
                transcript,
            )
            asr_source = (
                "dashscope_realtime_asr_backup"
                if payload.get("provider") == "dashscope_realtime_asr_backup"
                else self._asr_source
            )

            await self.publish_payload(
                build_user_transcript_output(
                    self.ctx,
                    transcript,
                    is_final=True,
                    source=asr_source,
                    client_capture_id=final_capture_external_id,
                    asr_metadata={
                        key: payload[key]
                        for key in ("model_version", "personalized", "fallback")
                        if key in payload
                    },
                )
            )
            # Publishing can yield while a new recording starts. Re-check before
            # dispatching old communication text into the cancellable reply owner.
            if (capture is None or getattr(self.ctx, "mode", "communication") == "training"
                    or capture.generation == self._speech_generation):
                await self.on_final_transcript(transcript)
            if capture is None:
                self._short_utterance_capture_expected = False
            return

        if message_type in {"error", "client.error"}:
            failed_capture_external_id = capture.client_capture_id if capture else (
                self._pending_final_transcript_client_capture_ids.pop(0)
                if self._pending_final_transcript_client_capture_ids
                else self._last_committed_client_capture_external_id
                or self._client_capture_external_id
            )
            error_info = payload.get("error", {})
            error_message = str(error_info.get("message", "unknown error")) if isinstance(error_info, dict) else "语音识别失败"
            logger.warning(
                "LiveKit ASR error room=%s capture_id=%s error=%s",
                self.ctx.room_name,
                failed_capture_external_id,
                error_message,
            )
            if capture is None:
                self._short_utterance_capture_expected = False
            await self.publish_payload({**build_error_output(error_message), "client_capture_id": failed_capture_external_id})
            return
