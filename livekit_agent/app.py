from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Coroutine

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, cli

from assistant_runtime import (
    CAPTION_ASR_FALLBACK_SOURCE,
    AssistantReplyGenerationError,
    CommunicationAssistantRuntime,
    estimate_clarity_score,
)
from asr_runtime import LiveKitASRRuntime
from capacity import WorkerLoadPolicy
from config import load_config, should_bypass_proxy_for_livekit
from data_contract import (
    build_audio_input_telemetry_output,
    build_assistant_text_output,
    build_error_output,
    build_session_init_ack,
    build_session_userdata_ack,
    build_speech_activity_output,
    build_voice_profile_updated_output,
    extract_caption_mode_update,
    extract_client_speech_activity,
    decode_data_packet,
    extract_end_audio_request,
    extract_preparation_context_update,
    extract_user_text_input,
)
from session_context import build_session_context
from session_userdata import (
    build_preparation_context_pack_from_payload,
    build_session_userdata,
)
from tts_runtime import LiveKitAudioReplyRuntime
from turn_runtime import ReplyTurn, ReplyTurnRunner

load_dotenv()

logger = logging.getLogger("voxflame-livekit-agent")
config = load_config()
logging.basicConfig(level=getattr(logging, config.log_level.upper(), logging.INFO))


def _sanitize_proxy_env_for_local_livekit() -> None:
    if not should_bypass_proxy_for_livekit(config.livekit_url):
        return

    for key in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
    ):
        os.environ.pop(key, None)

    no_proxy_hosts = {"127.0.0.1", "localhost", "livekit-server"}
    for key in ("NO_PROXY", "no_proxy"):
        current = os.environ.get(key, "")
        merged = {host.strip() for host in current.split(",") if host.strip()}
        merged.update(no_proxy_hosts)
        os.environ[key] = ",".join(sorted(merged))


_sanitize_proxy_env_for_local_livekit()

# Self-hosted LiveKit worker registration should bypass shell-level HTTP proxies.
# The default AgentServer behavior inherits HTTP_PROXY/HTTPS_PROXY, which caused
# local `/agent` websocket registration to be routed to 127.0.0.1:7897 and fail.
worker_load_threshold = float(os.getenv("VOXFLAME_AGENT_LOAD_THRESHOLD", "0.7"))
worker_load_policy = WorkerLoadPolicy(
    max_active_jobs=int(os.getenv("VOXFLAME_AGENT_MAX_ACTIVE_JOBS", "8")),
    load_threshold=worker_load_threshold,
    memory_limit_percent=float(os.getenv("VOXFLAME_AGENT_MEMORY_PRESSURE_PERCENT", "85")),
)

# LiveKit asks this parent Worker for availability before starting each Job.
# Additional Workers increase total capacity; a saturated machine stops taking
# new rooms before it degrades every already-active conversation.
server = AgentServer(
    host="127.0.0.1",
    http_proxy=None,
    load_threshold=worker_load_threshold,
    load_fnc=worker_load_policy,
    drain_timeout=int(os.getenv("VOXFLAME_AGENT_DRAIN_TIMEOUT_SECONDS", "1800")),
    num_idle_processes=int(os.getenv("VOXFLAME_AGENT_IDLE_PROCESSES", "2")),
    job_memory_warn_mb=float(os.getenv("VOXFLAME_AGENT_JOB_MEMORY_WARN_MB", "450")),
    job_memory_limit_mb=float(os.getenv("VOXFLAME_AGENT_JOB_MEMORY_LIMIT_MB", "700")),
    prometheus_port=(int(os.getenv("VOXFLAME_AGENT_PROMETHEUS_PORT", "0")) or None),
)


@server.on("worker_started")
def _on_worker_started() -> None:
    logger.info("LiveKit worker started agent_name=%s", config.agent_name)


@server.on("worker_registered")
def _on_worker_registered(worker_id: str, server_info: object) -> None:
    protocol = getattr(server_info, "protocol", None)
    region = getattr(server_info, "region", None)
    logger.info(
        "LiveKit worker registered agent_name=%s worker_id=%s protocol=%s region=%s",
        config.agent_name,
        worker_id,
        protocol,
        region,
    )


@server.rtc_session(agent_name=config.agent_name)
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {
        "room": ctx.room.name,
        "agent_name": config.agent_name,
    }

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()

    session_context = build_session_context(
        room_name=ctx.room.name,
        participant_identity=participant.identity,
        participant_name=participant.name,
        metadata=participant.metadata,
        job_metadata=ctx.job.metadata,
        attributes=participant.attributes,
    )

    logger.info(
        "LiveKit session connected room=%s participant=%s mode=%s surface=%s scene=%s strategy=%s request_id=%s",
        session_context.room_name,
        session_context.participant_identity,
        session_context.mode,
        session_context.surface,
        session_context.scene,
        session_context.session_strategy,
        session_context.request_id,
    )
    session_userdata = build_session_userdata(session_context)
    logger.info(
        "LiveKit session userdata prepared room=%s participant=%s source=%s scene=%s document_chars=%s training_pairs=%s support_strategies=%s",
        session_context.room_name,
        session_context.participant_identity,
        session_userdata.preparation.source,
        session_userdata.preparation.scene,
        len(session_userdata.preparation.document_content),
        len(session_userdata.preparation.training_pairs),
        len(session_userdata.preparation.support_strategies),
    )
    assistant_runtime = CommunicationAssistantRuntime(
        config=config,
        ctx=session_context,
        userdata=session_userdata,
    )
    audio_runtime = LiveKitAudioReplyRuntime(config=config, room=ctx.room)
    use_training_transcript_tts = (
        session_context.mode == "training"
        or session_context.surface == "training_workspace"
    )
    control_tasks: set[asyncio.Task[None]] = set()
    closing = False

    def schedule_control(coro: Coroutine[object, object, None]) -> None:
        if closing or len(control_tasks) >= 16:
            coro.close()
            logger.warning("Session control rejected: closed or overloaded")
            return
        task = asyncio.create_task(coro)
        control_tasks.add(task)
        def done(completed: asyncio.Task[None]) -> None:
            control_tasks.discard(completed)
            if not completed.cancelled() and completed.exception() is not None:
                logger.warning("Session control failed type=%s", type(completed.exception()).__name__)
        task.add_done_callback(done)

    async def publish_payload(payload: dict[str, object]) -> None:
        await asyncio.wait_for(
            ctx.room.local_participant.publish_data(
                json.dumps(payload, ensure_ascii=True).encode("utf-8"),
                reliable=True,
                topic=ctx.room.name,
            ),
            timeout=1.0,
        )

    async def handle_speech_activity(state: str, auto_finalize: bool) -> None:
        interruption_requested = False

        if state == "barge_in_triggered":
            turn_runner.interrupt()
            interruption_requested = True
            interrupted = audio_runtime.is_speaking
            logger.info(
                "LiveKit barge-in room=%s participant=%s interrupted_tts=%s",
                session_context.room_name,
                session_context.participant_identity,
                interrupted,
            )

        session_userdata.note_speech_activity(state, interruption_requested)

        await publish_payload(
            build_speech_activity_output(
                session_context,
                state=state,
                auto_finalize=auto_finalize,
                interruption_requested=interruption_requested,
                speech_duration_ms=0,
            ),
        )

    async def handle_audio_input_telemetry(
        normalized_level: float,
        peak_level: float,
        clipping_detected: bool,
        apm_enabled: bool,
        reason: str,
    ) -> None:
        await publish_payload(
            build_audio_input_telemetry_output(
                session_context,
                normalized_level=normalized_level,
                peak_level=peak_level,
                clipping_detected=clipping_detected,
                apm_enabled=apm_enabled,
                reason=reason,
            ),
        )

    async def process_user_text(
        user_text: str,
        *,
        correction_original: str | None = None,
    ) -> None:
        try:
            reply_text, source = await assistant_runtime.generate_reply(user_text)
        except AssistantReplyGenerationError as exc:
            logger.warning(
                "LiveKit assistant correction unavailable room=%s participant=%s code=%s detail=%s",
                session_context.room_name,
                session_context.participant_identity,
                exc.code,
                exc.detail,
            )
            await publish_payload(build_error_output(exc.user_message))
            return

        logger.info(
            "LiveKit assistant reply prepared room=%s participant=%s source=%s chars=%s",
            session_context.room_name,
            session_context.participant_identity,
            source,
            len(reply_text),
        )
        await publish_payload(
            build_assistant_text_output(
                session_context,
                reply_text,
                source=source,
                metadata_type="correction" if correction_original else "assistant_text_output",
                original_text=correction_original,
            ),
        )
        assistant_runtime.accept_reply(user_text, reply_text, source)
        if correction_original and source != CAPTION_ASR_FALLBACK_SOURCE:
            clarity_score = estimate_clarity_score(correction_original, reply_text)
            await publish_payload(
                build_voice_profile_updated_output(
                    session_context,
                    source="livekit_correction",
                    clarity_score=clarity_score,
                    confusion_patterns_count=1 if correction_original != reply_text else 0,
                ),
            )
        if session_userdata.should_skip_tts():
            logger.info(
                "LiveKit text-first reply active, skipping TTS room=%s participant=%s surface=%s caption_mode=%s",
                session_context.room_name,
                session_context.participant_identity,
                session_context.surface,
                session_userdata.caption_mode_enabled,
            )
            return

        await audio_runtime.speak(reply_text)

    async def handle_training_transcript_tts(transcript: str) -> None:
        normalized = transcript.strip()
        if not normalized:
            return

        session_userdata.note_user_transcript(normalized)
        session_userdata.note_assistant_reply(
            normalized,
            source="training_asr_echo",
        )
        await publish_payload(
            build_assistant_text_output(
                session_context,
                normalized,
                source="training_asr_echo",
                metadata_type="training_transcript_echo",
                original_text=normalized,
            ),
        )

        if session_userdata.should_skip_tts():
            logger.info(
                "LiveKit training transcript echo skipping TTS room=%s participant=%s surface=%s caption_mode=%s",
                session_context.room_name,
                session_context.participant_identity,
                session_context.surface,
                session_userdata.caption_mode_enabled,
            )
            return

        logger.info(
            "LiveKit training transcript echo speaking raw ASR room=%s participant=%s chars=%s",
            session_context.room_name,
            session_context.participant_identity,
            len(normalized),
        )
        await audio_runtime.speak(normalized)

    async def process_turn(turn: ReplyTurn) -> None:
        if use_training_transcript_tts:
            await handle_training_transcript_tts(turn.text)
        else:
            await process_user_text(turn.text, correction_original=turn.correction_original)

    turn_runner = ReplyTurnRunner(process_turn)

    def enqueue_user_text(user_text: str, *, correction_original: str | None = None) -> None:
        turn_runner.submit(ReplyTurn(user_text.strip(), correction_original))

    async def handle_final_transcript(transcript: str) -> None:
        if use_training_transcript_tts:
            # Training finals are all published by ASR; do not let old echo tasks
            # replace a newer recording or serialize the ASR callback on playout.
            if session_userdata.should_skip_tts():
                await handle_training_transcript_tts(transcript)
                return
        enqueue_user_text(transcript, correction_original=transcript)

    asr_runtime = LiveKitASRRuntime(
        config=config,
        ctx=session_context,
        participant=participant,
        publish_payload=publish_payload,
        on_final_transcript=handle_final_transcript,
        input_allowed=lambda: audio_runtime.input_allowed,
        on_speech_activity=handle_speech_activity,
        on_audio_telemetry=handle_audio_input_telemetry,
    )
    async def shutdown() -> None:
        nonlocal closing
        closing = True
        turn_runner.interrupt()
        for task in tuple(control_tasks):
            task.cancel()
        await asyncio.gather(*control_tasks, return_exceptions=True)
        # Stop intake before releasing the clients used by recognition/replies.
        results = await asyncio.gather(asr_runtime.stop(), turn_runner.aclose(), return_exceptions=True)
        results += await asyncio.gather(audio_runtime.aclose(), assistant_runtime.aclose(), return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                logger.warning("Session shutdown cleanup failed type=%s", type(result).__name__)

    ctx.add_shutdown_callback(shutdown)

    @ctx.room.on("participant_disconnected")
    def participant_disconnected(remote: rtc.RemoteParticipant) -> None:
        if remote.identity == session_context.participant_identity:
            turn_runner.interrupt()
            ctx.shutdown(reason="session participant disconnected")

    await asr_runtime.start()

    async def stop_audio() -> None:
        await audio_runtime.interrupt()

    async def publish_init_ack() -> None:
        await publish_payload(build_session_init_ack(session_context))
        await publish_payload(
            build_session_userdata_ack(
                session_context,
                session_userdata.preparation,
                session_userdata.session_memory,
                caption_mode_enabled=session_userdata.caption_mode_enabled,
            ),
        )

    @ctx.room.on("data_received")
    def _on_data_received(packet: rtc.DataPacket) -> None:
        if closing:
            return
        if packet.topic != ctx.room.name:
            return
        if packet.participant is None:
            return
        if packet.participant.identity != session_context.participant_identity:
            return

        message = decode_data_packet(packet.data)
        if not message:
            return

        logger.info(
            "LiveKit room data received room=%s participant=%s type=%s",
            session_context.room_name,
            session_context.participant_identity,
            str(message.get("type", "") or "unknown"),
        )

        user_text = extract_user_text_input(message)
        if user_text:
            logger.info(
                "LiveKit user text input room=%s participant=%s chars=%s preview=%s",
                session_context.room_name,
                session_context.participant_identity,
                len(user_text),
                user_text[:80],
            )
            enqueue_user_text(user_text)
            return

        client_speech_activity = extract_client_speech_activity(message)
        if client_speech_activity is not None:
            state, auto_finalize, short_utterance_expected, client_capture_id = client_speech_activity
            if state == "speech_started":
                turn_runner.interrupt()
            asr_runtime.note_client_recording_event(
                state,
                auto_finalize,
                short_utterance_expected=short_utterance_expected,
                client_capture_id=client_capture_id,
            )
            logger.info(
                "LiveKit client speech activity room=%s participant=%s state=%s auto_finalize=%s short_utterance_expected=%s client_capture_id=%s",
                session_context.room_name,
                session_context.participant_identity,
                state,
                auto_finalize,
                short_utterance_expected,
                client_capture_id,
            )
            return

        caption_mode_enabled = extract_caption_mode_update(message)
        if caption_mode_enabled is not None:
            session_userdata.set_caption_mode(caption_mode_enabled)
            logger.info(
                "LiveKit caption mode updated room=%s participant=%s enabled=%s",
                session_context.room_name,
                session_context.participant_identity,
                caption_mode_enabled,
            )
            if caption_mode_enabled:
                schedule_control(stop_audio())
            return

        preparation_update = extract_preparation_context_update(message)
        if preparation_update is not None:
            next_preparation = build_preparation_context_pack_from_payload(
                preparation_update,
                fallback_scene=session_context.scene,
                source="runtime_update",
            )
            if next_preparation is None:
                logger.warning(
                    "LiveKit preparation context update ignored room=%s participant=%s reason=invalid_payload",
                    session_context.room_name,
                    session_context.participant_identity,
                )
                return

            session_userdata.replace_preparation(next_preparation)
            logger.info(
                "LiveKit preparation context updated room=%s participant=%s scene=%s document_chars=%s training_pairs=%s",
                session_context.room_name,
                session_context.participant_identity,
                next_preparation.scene,
                len(next_preparation.document_content),
                len(next_preparation.training_pairs),
            )
            schedule_control(
                publish_payload(
                    build_session_userdata_ack(
                        session_context,
                        session_userdata.preparation,
                        session_userdata.session_memory,
                        caption_mode_enabled=session_userdata.caption_mode_enabled,
                    )
                )
            )
            return

        end_audio_request = extract_end_audio_request(message)
        if end_audio_request:
            end_audio_reason, client_capture_id = end_audio_request
            logger.info(
                "LiveKit end_audio received room=%s participant=%s reason=%s client_capture_id=%s",
                session_context.room_name,
                session_context.participant_identity,
                end_audio_reason,
                client_capture_id,
            )
            schedule_control(
                asr_runtime.commit_audio(
                    end_audio_reason,
                    client_capture_id=client_capture_id,
                )
            )

    await publish_init_ack()

    logger.info(
        "LiveKit minimal data contract ready room=%s participant=%s",
        session_context.room_name,
        session_context.participant_identity,
    )


if __name__ == "__main__":
    cli.run_app(server)
