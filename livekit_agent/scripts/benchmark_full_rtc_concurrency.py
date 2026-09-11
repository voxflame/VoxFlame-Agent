from __future__ import annotations

import argparse
import asyncio
import gc
import hashlib
import sys
import json
import os
import statistics
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "research"))
from voice_benchmark import percentile

from livekit import api, rtc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run concurrent LiveKit rooms through ASR, LLM correction, and TTS",
    )
    parser.add_argument("--audio", required=True, help="16 kHz mono signed 16-bit PCM fixture")
    parser.add_argument("--rooms", type=int, default=1)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--allow-live-provider-calls", action="store_true",
                        help="Explicit authorization: creates rooms and calls actual providers")
    parser.add_argument("--connect-stagger-ms", type=int, default=250)
    parser.add_argument("--turn-stagger-ms", type=int, default=0)
    parser.add_argument("--result-timeout-seconds", type=float, default=35.0)
    parser.add_argument(
        "--playout-grace-seconds",
        type=float,
        default=3.0,
        help="Keep rooms connected after first TTS audio so synthesis/playout can finish cleanly",
    )
    return parser.parse_args()


def latency_summary(values: list[float]) -> dict[str, float | int | None] | None:
    if not values:
        return None
    return {
        "n": len(values),
        "min": round(min(values), 1),
        "p50": percentile(values, 0.5),
        "p95": percentile(values, 0.95),
        "p99": percentile(values, 0.99),
        "max": round(max(values), 1),
        "mean": round(statistics.mean(values), 1),
    }


@dataclass
class RoomProbe:
    index: int
    room_name: str
    identity: str
    request_id: str
    room: rtc.Room = field(default_factory=rtc.Room)
    init_event: asyncio.Event = field(default_factory=asyncio.Event)
    user_final_event: asyncio.Event = field(default_factory=asyncio.Event)
    assistant_final_event: asyncio.Event = field(default_factory=asyncio.Event)
    tts_audio_event: asyncio.Event = field(default_factory=asyncio.Event)
    messages: list[dict[str, object]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    connected_at: float | None = None
    turn_started_at: float | None = None
    turn_stopped_at: float | None = None
    user_final_at: float | None = None
    assistant_final_at: float | None = None
    tts_audio_at: float | None = None
    audio_tasks: list[asyncio.Task[None]] = field(default_factory=list)
    microphone_source: rtc.AudioSource | None = None
    microphone_publication: rtc.LocalTrackPublication | None = None

    def install_handlers(self) -> None:
        @self.room.on("data_received")
        def on_data(packet: rtc.DataPacket) -> None:
            try:
                payload = json.loads(bytes(packet.data).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return
            if not isinstance(payload, dict):
                return
            self.messages.append(payload)
            message_type = payload.get("type")
            if message_type == "session_init_ack":
                self.init_event.set()
                return
            if message_type == "error":
                self.errors.append(str(payload.get("message", "unknown agent error")))
                return
            if message_type != "transcript" or payload.get("is_final") is not True:
                return
            role = payload.get("role")
            now = time.perf_counter()
            if role == "user" and self.user_final_at is None:
                self.user_final_at = now
                self.user_final_event.set()
            elif role == "assistant" and self.assistant_final_at is None:
                self.assistant_final_at = now
                self.assistant_final_event.set()

        @self.room.on("track_subscribed")
        def on_track_subscribed(
            track: rtc.Track,
            _publication: rtc.RemoteTrackPublication,
            _participant: rtc.RemoteParticipant,
        ) -> None:
            if track.kind != rtc.TrackKind.KIND_AUDIO:
                return
            self.audio_tasks.append(asyncio.create_task(self._observe_audio(track)))

    async def _observe_audio(self, track: rtc.Track) -> None:
        stream = rtc.AudioStream(track)
        try:
            async for _event in stream:
                if self.turn_started_at is not None and self.tts_audio_at is None:
                    self.tts_audio_at = time.perf_counter()
                    self.tts_audio_event.set()
        finally:
            await stream.aclose()

    def final_message(self, role: str) -> dict[str, object] | None:
        for payload in reversed(self.messages):
            if (
                payload.get("type") == "transcript"
                and payload.get("role") == role
                and payload.get("is_final") is True
            ):
                return payload
        return None

    def result(self) -> dict[str, object]:
        user_message = self.final_message("user")
        assistant_message = self.final_message("assistant")
        user_metadata = (
            user_message.get("metadata", {}) if isinstance(user_message, dict) else {}
        )
        assistant_metadata = (
            assistant_message.get("metadata", {})
            if isinstance(assistant_message, dict)
            else {}
        )
        if not isinstance(user_metadata, dict):
            user_metadata = {}
        if not isinstance(assistant_metadata, dict):
            assistant_metadata = {}

        def elapsed_ms(completed_at: float | None) -> float | None:
            if completed_at is None or self.turn_started_at is None:
                return None
            return round((completed_at - self.turn_started_at) * 1000, 1)

        def after_input_ms(completed_at: float | None) -> float | None:
            if completed_at is None or self.turn_stopped_at is None or completed_at < self.turn_stopped_at:
                return None
            return round((completed_at - self.turn_stopped_at) * 1000, 1)

        return {
            "index": self.index,
            "room": self.room_name,
            "init": self.init_event.is_set(),
            "user_final": self.user_final_event.is_set(),
            "assistant_final": self.assistant_final_event.is_set(),
            "tts_audio": self.tts_audio_event.is_set(),
            "input_start_to_user_final_ms": elapsed_ms(self.user_final_at),
            "input_start_to_assistant_final_ms": elapsed_ms(self.assistant_final_at),
            "input_start_to_first_received_frame_ms": elapsed_ms(self.tts_audio_at),
            "input_end_to_user_final_ms": after_input_ms(self.user_final_at),
            "input_end_to_assistant_final_ms": after_input_ms(self.assistant_final_at),
            "rtc_first_frame_after_input_ms": after_input_ms(self.tts_audio_at),
            "asr_source": user_metadata.get("source"),
            "asr_model": user_metadata.get("model_version"),
            "asr_personalized": user_metadata.get("personalized"),
            "asr_fallback": user_metadata.get("fallback"),
            "assistant_source": assistant_metadata.get("source"),
            "errors": self.errors,
        }


def build_token(
    *,
    api_key: str,
    api_secret: str,
    agent_name: str,
    account_id: str,
    probe: RoomProbe,
) -> str:
    dispatch_metadata = json.dumps(
        {
            "request_id": probe.request_id,
            "participant_identity": probe.identity,
            "authenticated_user_id": f"synthetic-capacity-{probe.index}",
            "asr_account_id": account_id,
            "session_intent": {
                "mode": "communication",
                # Production communication_workspace is intentionally text-first.
                # This synthetic surface keeps TTS enabled so the probe exercises
                # the complete ASR -> LLM -> TTS path without changing user policy.
                "surface": "capacity_probe",
                "scene": "capacity_probe",
                "sessionStrategy": "heavy_realtime",
                "requestedCapabilities": [],
            },
            "granted_capabilities": [],
        },
        ensure_ascii=False,
    )
    room_config = api.RoomConfiguration(
        agents=[api.RoomAgentDispatch(agent_name=agent_name, metadata=dispatch_metadata)],
    )
    return (
        api.AccessToken(api_key, api_secret)
        .with_identity(probe.identity)
        .with_name(f"Synthetic capacity probe {probe.index}")
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=probe.room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
        .with_room_config(room_config)
        .to_jwt()
    )


async def connect_probe(
    probe: RoomProbe,
    *,
    livekit_url: str,
    token: str,
    delay_seconds: float,
) -> None:
    await asyncio.sleep(delay_seconds)
    probe.install_handlers()
    await probe.room.connect(livekit_url, token)
    probe.connected_at = time.perf_counter()
    await asyncio.wait_for(probe.init_event.wait(), timeout=20)


async def run_turn(
    probe: RoomProbe,
    *,
    pcm_bytes: bytes,
    delay_seconds: float,
) -> None:
    await asyncio.sleep(delay_seconds)
    sample_rate = 16000
    chunk_samples = 640
    chunk_bytes = chunk_samples * 2
    source = rtc.AudioSource(sample_rate, 1, queue_size_ms=200)
    probe.microphone_source = source
    track = rtc.LocalAudioTrack.create_audio_track(f"capacity-mic-{probe.index}", source)
    probe.microphone_publication = await probe.room.local_participant.publish_track(
        track,
        rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
    )
    capture_id = f"capture-{uuid.uuid4().hex[:10]}"
    probe.turn_started_at = time.perf_counter()
    await probe.room.local_participant.publish_data(
        json.dumps(
            {
                "type": "speech_activity",
                "state": "speech_started",
                "auto_finalize": False,
                "short_utterance_expected": False,
                "client_capture_id": capture_id,
            }
        ),
        topic=probe.room_name,
    )
    for offset in range(0, len(pcm_bytes), chunk_bytes):
        chunk = pcm_bytes[offset : offset + chunk_bytes]
        if len(chunk) < chunk_bytes:
            chunk += b"\0" * (chunk_bytes - len(chunk))
        await source.capture_frame(
            rtc.AudioFrame(chunk, sample_rate, 1, chunk_samples),
        )
        await asyncio.sleep(0.04)
    await source.wait_for_playout()
    probe.turn_stopped_at = time.perf_counter()
    await probe.room.local_participant.publish_data(
        json.dumps(
            {
                "type": "speech_activity",
                "state": "speech_stopped",
                "auto_finalize": True,
                "client_capture_id": capture_id,
            }
        ),
        topic=probe.room_name,
    )
    await probe.room.local_participant.publish_data(
        json.dumps(
            {
                "type": "end_audio",
                "reason": "manual_stop",
                "client_capture_id": capture_id,
            }
        ),
        topic=probe.room_name,
    )


async def main() -> int:
    args = parse_args()
    if not args.allow_live_provider_calls:
        raise ValueError("Live probe requires --allow-live-provider-calls and an authorized fixture/account")
    if args.rooms <= 0:
        raise ValueError("--rooms must be positive")
    pcm_bytes = Path(args.audio).read_bytes()
    if not pcm_bytes or len(pcm_bytes) % 2:
        raise ValueError("audio fixture must contain complete signed 16-bit PCM samples")
    if pcm_bytes.startswith(b"RIFF"):
        raise ValueError("expected raw PCM, not a WAV header")

    livekit_url = os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:7880")
    api_key = os.environ["LIVEKIT_API_KEY"]
    api_secret = os.environ["LIVEKIT_API_SECRET"]
    agent_name = os.environ.get("LIVEKIT_AGENT_NAME", "voxflame-agent")
    run_id = uuid.uuid4().hex[:10]
    probes = [
        RoomProbe(
            index=index,
            room_name=f"vox-full-capacity-{run_id}-{index}",
            identity=f"vox-synthetic-{run_id}-{index}",
            request_id=f"capacity-{run_id}-{index}",
        )
        for index in range(args.rooms)
    ]
    livekit_api = api.LiveKitAPI("http://127.0.0.1:7880", api_key, api_secret)

    try:
        tokens = [
            build_token(
                api_key=api_key,
                api_secret=api_secret,
                agent_name=agent_name,
                account_id=args.account_id,
                probe=probe,
            )
            for probe in probes
        ]
        await asyncio.gather(
            *(
                connect_probe(
                    probe,
                    livekit_url=livekit_url,
                    token=token,
                    delay_seconds=index * args.connect_stagger_ms / 1000,
                )
                for index, (probe, token) in enumerate(zip(probes, tokens))
            )
        )
        await asyncio.gather(
            *(
                run_turn(
                    probe,
                    pcm_bytes=pcm_bytes,
                    delay_seconds=index * args.turn_stagger_ms / 1000,
                )
                for index, probe in enumerate(probes)
            )
        )
        await asyncio.gather(
            *(
                asyncio.wait_for(
                    asyncio.gather(
                        probe.user_final_event.wait(),
                        probe.assistant_final_event.wait(),
                        probe.tts_audio_event.wait(),
                    ),
                    timeout=args.result_timeout_seconds,
                )
                for probe in probes
            ),
            return_exceptions=True,
        )
        if args.playout_grace_seconds > 0:
            await asyncio.sleep(args.playout_grace_seconds)
        results = [probe.result() for probe in probes]
        complete = [
            result
            for result in results
            if result["user_final"] and result["assistant_final"] and result["tts_audio"] and not result["errors"]
        ]
        summary = {
            "schema": "voxflame-rtc-probe-v2",
            "domain": "rtc",
            "fixture_sha256": hashlib.sha256(pcm_bytes).hexdigest(),
            "fixture_duration_seconds": len(pcm_bytes) / 32000,
            "percentile_method": "nearest_rank",
            "limitations": "Manual-end input proxy, not acoustic speech end; first received frame may be silent, not speaker onset; no CER or provider request timing; successful observations only, inspect coverage/errors. Not full benchmark-v1 acceptance evidence.",
            "rooms": args.rooms,
            "complete": len(complete),
            "incomplete": args.rooms - len(complete),
            "asr_success": sum(bool(result["user_final"]) for result in results),
            "assistant_success": sum(bool(result["assistant_final"]) for result in results),
            "tts_success": sum(bool(result["tts_audio"]) for result in results),
            "personalized_asr": sum(result["asr_personalized"] is True for result in results),
            "realtime_fallback_asr": sum(
                result["asr_source"] == "dashscope_realtime_asr_backup"
                for result in results
            ),
            "input_start_to_user_final_ms": latency_summary(
                [float(result["input_start_to_user_final_ms"]) for result in results if result["input_start_to_user_final_ms"] is not None]
            ),
            "input_start_to_assistant_final_ms": latency_summary(
                [
                    float(result["input_start_to_assistant_final_ms"])
                    for result in results
                    if result["input_start_to_assistant_final_ms"] is not None
                ]
            ),
            "input_start_to_first_received_frame_ms": latency_summary(
                [
                    float(result["input_start_to_first_received_frame_ms"])
                    for result in results
                    if result["input_start_to_first_received_frame_ms"] is not None
                ]
            ),
            "input_end_to_user_final_ms": latency_summary(
                [
                    float(result["input_end_to_user_final_ms"])
                    for result in results
                    if result["input_end_to_user_final_ms"] is not None
                ]
            ),
            "input_end_to_assistant_final_ms": latency_summary(
                [
                    float(result["input_end_to_assistant_final_ms"])
                    for result in results
                    if result["input_end_to_assistant_final_ms"] is not None
                ]
            ),
            "rtc_first_frame_after_input_ms": latency_summary(
                [
                    float(result["rtc_first_frame_after_input_ms"])
                    for result in results
                    if result["rtc_first_frame_after_input_ms"] is not None
                ]
            ),
            "results": results,
        }
        print(json.dumps(summary, ensure_ascii=False))
        return 0 if len(complete) == args.rooms else 1
    finally:
        await asyncio.gather(
            *(
                probe.room.local_participant.unpublish_track(probe.microphone_publication.sid)
                for probe in probes
                if probe.microphone_publication is not None
            ),
            return_exceptions=True,
        )
        await asyncio.gather(
            *(
                probe.microphone_source.aclose()
                for probe in probes
                if probe.microphone_source is not None
            ),
            return_exceptions=True,
        )
        await asyncio.gather(*(probe.room.disconnect() for probe in probes), return_exceptions=True)
        audio_tasks = [task for probe in probes for task in probe.audio_tasks]
        if audio_tasks:
            _done, pending = await asyncio.wait(audio_tasks, timeout=5)
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        await asyncio.gather(
            *(
                livekit_api.room.delete_room(api.DeleteRoomRequest(room=probe.room_name))
                for probe in probes
            ),
            return_exceptions=True,
        )
        await livekit_api.aclose()
        for probe in probes:
            probe.audio_tasks.clear()
            probe.microphone_publication = None
            probe.microphone_source = None
            probe.room._events.clear()
            probe.room._remote_participants.clear()
            probe.room._local_participant = None
            if probe.room._ffi_handle is not None:
                probe.room._ffi_handle.dispose()
                probe.room._ffi_handle = None
        probes.clear()
        gc.collect()
        await asyncio.sleep(0.25)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
