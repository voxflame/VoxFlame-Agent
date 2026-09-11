from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from capacity import ProcessSlotPool, build_provider_pool
from config import LiveKitAgentConfig

logger = logging.getLogger("voxflame-livekit-agent.tts")

ServerEventHandler = Callable[[dict[str, Any]], Awaitable[None]]


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


def with_model_query(url: str, model: str) -> str:
    if not model:
        return url

    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if query.get("model"):
        return url

    query["model"] = model
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


@dataclass
class DashScopeRealtimeTTSClient:
    url: str
    model: str
    api_key: str
    connect_timeout_seconds: int
    event_handler: ServerEventHandler

    def __post_init__(self) -> None:
        self.url = with_model_query(self.url, self.model)
        self.websocket = None
        self.receive_task: asyncio.Task[None] | None = None
        self.ready_event = asyncio.Event()
        self._connect_lock = asyncio.Lock()
        self._send_lock = asyncio.Lock()
        self._session_payload: dict[str, Any] = {}

    @property
    def selected_model(self) -> str:
        """Return the configured DashScope model for observability and tests."""
        return self.model

    def is_ready(self) -> bool:
        return self.websocket is not None and self.ready_event.is_set()

    async def start(self, session_payload: dict[str, Any]) -> None:
        self._session_payload = session_payload
        await self._connect()

    async def append_text(self, text: str) -> None:
        await self._ensure_ready()
        await self._send_json({"type": "input_text_buffer.append", "text": text})

    async def commit_text(self) -> None:
        await self._ensure_ready()
        await self._send_json({"type": "input_text_buffer.commit"})

    async def stop(self) -> None:
        async with self._connect_lock:
            await self._close_current_socket()

    async def _ensure_ready(self) -> None:
        if self.is_ready():
            return
        await self._connect()

    async def _connect(self) -> None:
        import websockets

        async with self._connect_lock:
            if self.is_ready():
                return

            await self._close_current_socket()
            self.ready_event.clear()

            headers = [("Authorization", f"Bearer {self.api_key}")]
            self.websocket = await websockets.connect(
                self.url,
                additional_headers=headers,
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

        if websocket:
            try:
                await websocket.close()
            except Exception:
                pass

    async def _send_json(self, payload: dict[str, Any]) -> None:
        if self.websocket is None:
            raise RuntimeError("Qwen realtime TTS websocket is not connected")

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
            await self.event_handler({"type": "client.error", "error": {"message": str(exc)}})
        finally:
            if websocket is self.websocket:
                self.ready_event.clear()
                self.websocket = None


class LiveKitAudioReplyRuntime:
    def __init__(
        self,
        *,
        config: LiveKitAgentConfig,
        room: Any,
        capacity_pool: ProcessSlotPool | None = None,
    ) -> None:
        from livekit import rtc

        self.config = config
        self.room = room
        self.audio_source = rtc.AudioSource(
            sample_rate=config.dashscope_tts_sample_rate,
            num_channels=1,
            queue_size_ms=200,
        )
        self.audio_track: Any | None = None
        self.done_event = asyncio.Event()
        self.error_message: str | None = None
        self._tts_lock = asyncio.Lock()
        self._speaking = False
        self._listen_after = 0.0
        self._closed = False
        self._cancel_requested = False
        self._accepting_audio = False
        self._speech_task: asyncio.Task[bool] | None = None
        self.capacity_pool = capacity_pool or build_provider_pool(
            provider="tts",
            slots=config.provider_tts_max_concurrency,
            wait_timeout_seconds=config.provider_tts_wait_timeout_seconds,
            lock_directory=config.provider_capacity_directory,
        )
        self.client = DashScopeRealtimeTTSClient(
            url=config.dashscope_tts_url,
            model=config.dashscope_tts_model,
            api_key=config.dashscope_api_key or "",
            connect_timeout_seconds=config.dashscope_tts_connect_timeout_seconds,
            event_handler=self._handle_server_event,
        )

    async def ensure_track_published(self) -> None:
        from livekit import rtc

        if self.audio_track is not None:
            return

        self.audio_track = rtc.LocalAudioTrack.create_audio_track("voxflame-assistant-audio", self.audio_source)
        await self.room.local_participant.publish_track(self.audio_track)
        logger.info("LiveKit assistant audio track published")

    @property
    def is_speaking(self) -> bool:
        # Includes provider startup and playout: half-duplex must cover both.
        return self._speaking

    @property
    def input_allowed(self) -> bool:
        """Half-duplex guard covers server playout plus a bounded, unverified device tail."""
        return self.config.audio_duplex_mode == "full" or (
            not self._speaking and time.monotonic() >= self._listen_after
        )

    def _cancel_speech(self) -> None:
        if self._speech_task is not None and not self._speech_task.done() and not self._cancel_requested:
            self._cancel_requested = True
            self._speech_task.cancel()

    async def aclose(self) -> None:
        self._closed = True
        await self.interrupt()
        async with self._tts_lock:
            await self.client.stop()
            await self.audio_source.aclose()

    async def speak(self, text: str) -> bool:
        if self._closed or not self.config.dashscope_api_key or not text.strip():
            return False
        async with self._tts_lock:
            if self._closed:
                return False
            self._cancel_requested = False
            self.done_event = asyncio.Event()
            self.error_message = None
            self._speaking = True
            self._accepting_audio = True
            task = asyncio.create_task(self._run_speech(text))
            self._speech_task = task
            try:
                # One total deadline, including admission, connection and playout.
                return await asyncio.wait_for(asyncio.shield(task), self.config.dashscope_tts_request_timeout_seconds)
            except asyncio.TimeoutError:
                logger.warning("LiveKit TTS total deadline exceeded")
                return False
            finally:
                self._cancel_speech()
                await asyncio.gather(task, return_exceptions=True)
                self._speech_task = None
                self._speaking = False
                self._listen_after = time.monotonic() + self.config.audio_playout_tail_seconds

    async def _run_speech(self, text: str) -> bool:
        completed = False
        started_at = time.perf_counter()
        try:
            await self.ensure_track_published()
            async with self.capacity_pool.lease():
                await self.client.start({
                    "modalities": ["audio"],
                    "voice": self.config.dashscope_tts_voice,
                    "mode": "server_commit",
                    "output_audio_format": "pcm",
                    "sample_rate": self.config.dashscope_tts_sample_rate,
                })
                await self.client.append_text(text)
                await self.client.commit_text()
                await self.done_event.wait()
                if self.error_message:
                    return False
                await self.audio_source.wait_for_playout()
                completed = True
            logger.info(
                "LiveKit TTS reply completed model=%s elapsed_ms=%s",
                self.config.dashscope_tts_model,
                round((time.perf_counter() - started_at) * 1000),
            )
            return True
        except Exception as exc:
            self.error_message = type(exc).__name__
            logger.warning("LiveKit TTS reply failed type=%s", type(exc).__name__)
            return False
        finally:
            self._accepting_audio = False
            # Stop/await the producer before clearing the sink. Otherwise a pending
            # capture_frame can re-populate the source after clear_queue().
            try:
                await asyncio.wait_for(self.client.stop(), timeout=2.0)
            finally:
                if not completed:
                    self.audio_source.clear_queue()

    async def interrupt(self) -> bool:
        task = self._speech_task
        if task is None or task.done():
            return False
        self._accepting_audio = False
        self.error_message = "interrupted"
        self._cancel_speech()
        await asyncio.shield(asyncio.gather(task, return_exceptions=True))
        return True

    async def _handle_server_event(self, payload: dict[str, object]) -> None:
        if not self._accepting_audio:
            return
        message_type = str(payload.get("type", ""))
        if message_type == "response.audio.delta":
            delta = payload.get("delta")
            if isinstance(delta, str) and delta:
                pcm = base64.b64decode(delta, validate=True)
                if len(pcm) % 2:
                    raise ValueError("TTS returned incomplete PCM16 sample")
                # No duplicate Python queue: SDK capture_frame provides backpressure.
                # Split provider packets so each write has at most 20ms of audio.
                chunk_bytes = self.config.dashscope_tts_sample_rate * 2 // 50
                for offset in range(0, len(pcm), chunk_bytes):
                    if not self._accepting_audio:
                        return
                    await self.audio_source.capture_frame(pcm_bytes_to_audio_frame(
                        pcm[offset:offset + chunk_bytes],
                        sample_rate=self.config.dashscope_tts_sample_rate,
                    ))
            return
        if message_type == "response.done":
            self._accepting_audio = False
            self.done_event.set()
        elif message_type in {"error", "client.error"}:
            self.error_message = "tts_provider_error"
            self._accepting_audio = False
            self.done_event.set()
