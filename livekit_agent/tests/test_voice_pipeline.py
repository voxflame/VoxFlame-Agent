"""Deterministic pipeline tests: no provider, account, or real room traffic."""
from __future__ import annotations

import asyncio
import base64
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_asr_runtime import create_config
from tts_runtime import LiveKitAudioReplyRuntime


class FakeSource:
    def __init__(self, **kwargs: object) -> None:
        self.options = kwargs
        self.frames: list[object] = []
        self.clears = 0
        self.playout = asyncio.Event()
        self.capture_started = asyncio.Event()
        self.release_capture = asyncio.Event()
        self.release_capture.set()

    async def capture_frame(self, frame: object) -> None:
        self.capture_started.set()
        await self.release_capture.wait()
        self.frames.append(frame)

    async def wait_for_playout(self) -> None:
        await self.playout.wait()

    def clear_queue(self) -> None:
        self.clears += 1
        self.frames.clear()
        self.playout.set()


class FakeTTSClient:
    def __init__(self, runtime: LiveKitAudioReplyRuntime) -> None:
        self.runtime = runtime
        self.ready = asyncio.Event()
        self.stopped = False

    async def start(self, payload: object) -> None:
        self.ready.set()

    async def append_text(self, text: str) -> None:
        pass

    async def commit_text(self) -> None:
        pass

    async def stop(self) -> None:
        self.stopped = True

    async def clear_text(self) -> None:
        pass

    async def finish_session(self) -> None:
        self.stopped = True


class FakeLease:
    async def __aenter__(self) -> None:
        pass

    async def __aexit__(self, *args: object) -> None:
        pass


class FakePool:
    def lease(self) -> FakeLease:
        return FakeLease()


class VoicePipelineTests(unittest.IsolatedAsyncioTestCase):
    def make_tts(self) -> tuple[LiveKitAudioReplyRuntime, FakeSource, FakeTTSClient]:
        with patch('livekit.rtc.AudioSource', FakeSource):
            runtime = LiveKitAudioReplyRuntime(config=create_config(), room=None, capacity_pool=FakePool())
        runtime.audio_track = object()
        client = FakeTTSClient(runtime)
        runtime.client = client
        return runtime, runtime.audio_source, client

    async def test_tts_remains_interruptible_during_playout(self) -> None:
        runtime, source, client = self.make_tts()
        task = asyncio.create_task(runtime.speak('测试'))
        await client.ready.wait()
        await runtime._handle_server_event({'type': 'response.done'})
        for _ in range(10):
            await asyncio.sleep(0)
        self.assertFalse(task.done())
        self.assertTrue(await runtime.interrupt())
        await asyncio.gather(task, return_exceptions=True)
        self.assertTrue(client.stopped)
        self.assertGreater(source.clears, 0)

    async def test_tts_ignores_late_audio_after_interrupt(self) -> None:
        runtime, source, client = self.make_tts()
        task = asyncio.create_task(runtime.speak('测试'))
        await client.ready.wait()
        await runtime.interrupt()
        await asyncio.gather(task, return_exceptions=True)
        await runtime._handle_server_event({'type':'response.audio.delta', 'delta':base64.b64encode(b'\0\0'*160).decode()})
        self.assertEqual(source.frames, [])
        self.assertFalse(hasattr(runtime, 'audio_queue'), 'unbounded duplicate audio queue must be removed')

    async def test_tts_source_buffer_is_bounded_below_one_second(self) -> None:
        _, source, _ = self.make_tts()
        self.assertLessEqual(source.options['queue_size_ms'], 500)

from dataclasses import replace
from asr_runtime import ASRCapture, LiveKitASRRuntime, QwenHttpASRClient, RMSVoiceActivityDetector
from turn_runtime import ReplyTurn, ReplyTurnRunner
from assistant_runtime import CommunicationAssistantRuntime, DashScopeChatClient, AssistantReplyGenerationError
from test_assistant_runtime import create_context
from session_userdata import build_session_userdata
import httpx


class TurnCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_latest_turn_waits_for_cancelled_cleanup(self) -> None:
        started, cleaning, release, latest = (asyncio.Event() for _ in range(4))
        seen: list[str] = []
        async def process(turn: ReplyTurn) -> None:
            seen.append(turn.text)
            if turn.text == 'first':
                started.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    cleaning.set()
                    await release.wait()
            else:
                latest.set()
        runner = ReplyTurnRunner(process)
        runner.submit(ReplyTurn('first'))
        await started.wait()
        runner.submit(ReplyTurn('obsolete'))
        await cleaning.wait()
        runner.submit(ReplyTurn('latest'))
        runner.interrupt()
        runner.submit(ReplyTurn('latest'))
        self.assertEqual(seen, ['first'])
        release.set()
        await latest.wait()
        await runner.aclose()
        self.assertEqual(seen, ['first', 'latest'])

    async def test_close_and_explicit_interrupt_drop_pending(self) -> None:
        called: list[str] = []
        async def process(turn: ReplyTurn) -> None:
            called.append(turn.text)
        runner = ReplyTurnRunner(process)
        runner.submit(ReplyTurn('never'))
        runner.interrupt()
        await asyncio.sleep(0)
        await runner.aclose()
        runner.submit(ReplyTurn('closed'))
        self.assertEqual(called, [])


class ASRConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    def make_runtime(self, mode: str = 'training') -> LiveKitASRRuntime:
        self.published: list[dict[str, object]] = []
        self.finals: list[str] = []
        async def publish(payload: dict[str, object]) -> None:
            self.published.append(payload)
        async def final(text: str) -> None:
            self.finals.append(text)
        runtime = LiveKitASRRuntime(
            config=create_config(),
            ctx=SimpleNamespace(room_name='room', participant_identity='user', request_id='request', mode=mode),
            participant=None, publish_payload=publish, on_final_transcript=final,
        )
        runtime.client = QwenHttpASRClient(
            url='http://test.invalid', account_id='test-account', language='Chinese',
            sample_rate=16000, request_timeout_seconds=1, event_handler=runtime._handle_server_event,
        )
        runtime._asr_source = 'qwen_http_asr'
        runtime._started = True
        return runtime

    async def capture(self, runtime: LiveKitASRRuntime, identifier: str) -> None:
        runtime.note_client_recording_event('speech_started', False, short_utterance_expected=True, client_capture_id=identifier)
        runtime._speech_ms_since_commit = 500
        await runtime.client.append_audio(identifier.encode() * 2)
        await runtime.commit_audio('manual_stop', client_capture_id=identifier)

    async def test_nonblocking_recognition_out_of_order_ids_and_overload(self) -> None:
        runtime = self.make_runtime()
        gates = {b'aa': asyncio.Event(), b'bb': asyncio.Event()}
        async def transcribe(pcm: bytes) -> tuple[str, dict[str, object]]:
            await gates[pcm].wait()
            return pcm.decode(), {}
        runtime.client._transcribe = transcribe
        await self.capture(runtime, 'a')
        await self.capture(runtime, 'b')
        self.assertEqual(len(runtime._recognition_tasks), 2)
        await self.capture(runtime, 'c')
        self.assertEqual(self.published[-1]['client_capture_id'], 'c')
        gates[b'bb'].set()
        for _ in range(10):
            await asyncio.sleep(0)
        gates[b'aa'].set()
        await asyncio.gather(*runtime._recognition_tasks)
        finals = [p for p in self.published if p.get('text') in {'aa', 'bb'}]
        self.assertEqual([p['client_capture_id'] for p in finals], ['b', 'a'])
        self.assertEqual(self.finals, ['bb', 'aa'])
        self.assertEqual(runtime._pending_final_transcript_client_capture_ids, [])
        await runtime.stop()

    async def test_stale_communication_not_training_result_is_dropped(self) -> None:
        for mode, expected in [('communication', []), ('training', ['旧结果'])]:
            runtime = self.make_runtime(mode)
            runtime._speech_generation = 2
            await runtime._handle_server_event({'type':'conversation.item.input_audio_transcription.completed', 'transcript':'旧结果'}, ASRCapture('old', 1, True, 500, False))
            self.assertEqual(self.finals, expected)
            await runtime.stop()

    async def test_generation_rechecked_after_publication_yields(self) -> None:
        runtime = self.make_runtime('communication')
        runtime._speech_generation = 1
        async def publish(payload: dict[str, object]) -> None:
            runtime._speech_generation = 2
        runtime.publish_payload = publish
        await runtime._handle_server_event({'type':'conversation.item.input_audio_transcription.completed', 'transcript':'旧结果'}, ASRCapture('old', 1, True, 500, False))
        self.assertEqual(self.finals, [])

    async def test_stop_cancels_pending_recognition(self) -> None:
        runtime = self.make_runtime()
        started, cancelled = asyncio.Event(), asyncio.Event()
        async def transcribe(pcm: bytes) -> tuple[str, dict[str, object]]:
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        runtime.client._transcribe = transcribe
        await self.capture(runtime, 'a')
        await started.wait()
        await runtime.stop()
        self.assertTrue(cancelled.is_set())
        self.assertEqual(runtime._recognition_tasks, set())
        self.assertEqual(self.finals, [])

    async def test_capture_overflow_is_explicit_and_next_capture_recovers(self) -> None:
        runtime = self.make_runtime()
        runtime.client.max_audio_seconds = 0.001
        runtime.note_client_recording_event('speech_started', False, client_capture_id='large')
        runtime._speech_ms_since_commit = 500
        await runtime.client.append_audio(b'\0\0' * 100)
        await runtime.commit_audio('manual_stop')
        self.assertEqual(self.published[-1]['client_capture_id'], 'large')
        self.assertEqual(len(runtime._recognition_tasks), 0)
        await runtime.client.append_audio(b'\0\0')
        self.assertEqual(runtime.client.take_audio(), b'\0\0')
        await runtime.stop()

    async def test_half_duplex_drops_echo_and_resets_vad_buffer(self) -> None:
        runtime = self.make_runtime()
        allowed = False
        runtime.input_allowed = lambda: allowed
        runtime._vad = RMSVoiceActivityDetector(.032, 860)
        await runtime.client.append_audio(b'old')
        speech = (2000).to_bytes(2, 'little', signed=True) * 320
        self.assertFalse(await runtime._observe_vad(speech, 16000))
        self.assertEqual(runtime.client.take_audio(), b'')
        self.assertEqual(runtime._speech_ms_since_commit, 0)
        allowed = True
        self.assertTrue(await runtime._observe_vad(speech, 16000))
        self.assertEqual(runtime._speech_ms_since_commit, 20)
        await runtime.stop()

    async def test_silence_hangover_does_not_count_as_barge_in_speech(self) -> None:
        runtime = self.make_runtime()
        runtime._vad = RMSVoiceActivityDetector(.032, 860)
        speech = (2000).to_bytes(2, 'little', signed=True) * 320
        await runtime._observe_vad(speech, 16000)
        for _ in range(25):
            await runtime._observe_vad(b'\0\0'*320, 16000)
        self.assertEqual(runtime._speech_ms_since_commit, 20)
        self.assertFalse(runtime._barge_in_triggered_since_commit)
        await runtime.stop()

    async def test_aec_without_reference_fails_explicitly(self) -> None:
        runtime = self.make_runtime()
        runtime.config = replace(runtime.config, livekit_audio_apm_echo_cancellation=True)
        with self.assertRaisesRegex(RuntimeError, 'render reference'):
            runtime._create_audio_apm()
        await runtime.stop()

    async def test_fallback_owns_each_request_and_closes_on_timeout(self) -> None:
        runtime = self.make_runtime()
        client = runtime.client
        client.request_timeout_seconds = .02
        await client.start({'sample_rate':16000})
        clients: list[object] = []
        class Fallback:
            def __init__(self, handler):
                self.handler = handler
                self.stopped = False
            async def start(self, payload):
                pass
            async def append_audio(self, pcm):
                pass
            async def commit_audio(self):
                pass
            async def stop(self):
                self.stopped = True
        def factory(handler):
            fallback = Fallback(handler)
            clients.append(fallback)
            return fallback
        client.fallback_factory = factory
        async def failed(pcm: bytes) -> tuple[str, dict[str, object]]:
            raise RuntimeError('offline')
        client._transcribe = failed
        await self.capture(runtime, 'a')
        await self.capture(runtime, 'b')
        await asyncio.gather(*runtime._recognition_tasks)
        self.assertEqual(len(clients), 2)
        self.assertTrue(all(client.stopped for client in clients))
        self.assertEqual({p['client_capture_id'] for p in self.published}, {'a', 'b'})
        await runtime.stop()


class LLMTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancellation_stops_http_and_does_not_commit_memory(self) -> None:
        started, stopped = asyncio.Event(), asyncio.Event()
        async def transport(request: httpx.Request) -> httpx.Response:
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()
        client = DashScopeChatClient('test', 'http://llm.invalid', 'test', 10, .1, 32)
        client._http_client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
        ctx = create_context()
        runtime = CommunicationAssistantRuntime(config=create_config(), ctx=ctx, userdata=build_session_userdata(ctx), client=client, capacity_pool=FakePool())
        task = asyncio.create_task(runtime.generate_reply('测试文本'))
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(stopped.is_set())
        self.assertEqual(runtime.history, [])
        await runtime.aclose()
        self.assertIsNone(client._http_client)

    async def test_deadline_cancels_request_and_releases_slot(self) -> None:
        class Pool(FakePool):
            active = 0
            def lease(self):
                pool = self
                class Lease:
                    async def __aenter__(self):
                        pool.active += 1
                    async def __aexit__(self, *args):
                        pool.active -= 1
                return Lease()
        pool = Pool()
        async def transport(request: httpx.Request) -> httpx.Response:
            await asyncio.Event().wait()
        client = DashScopeChatClient('test', 'http://llm.invalid', 'test', 10, .1, 32)
        client._http_client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
        ctx = create_context()
        runtime = CommunicationAssistantRuntime(config=replace(create_config(), dashscope_reply_timeout_seconds=.01), ctx=ctx, userdata=build_session_userdata(ctx), client=client, capacity_pool=pool)
        with self.assertRaises(AssistantReplyGenerationError) as error:
            await runtime.generate_reply('测试文本')
        self.assertEqual(error.exception.code, 'correction_timeout')
        self.assertEqual(pool.active, 0)
        await runtime.aclose()


class TTSRaceTests(unittest.IsolatedAsyncioTestCase):
    make_tts = VoicePipelineTests.make_tts

    async def test_cancel_inflight_capture_before_clearing(self) -> None:
        runtime, source, client = self.make_tts()
        source.release_capture.clear()
        producer: asyncio.Task[None] | None = None
        async def stop() -> None:
            client.stopped = True
            if producer is not None:
                producer.cancel()
                await asyncio.gather(producer, return_exceptions=True)
        client.stop = stop
        task = asyncio.create_task(runtime.speak('测试'))
        await client.ready.wait()
        producer = asyncio.create_task(runtime._handle_server_event({'type':'response.audio.delta', 'delta':base64.b64encode(b'\0\0'*320).decode()}))
        await source.capture_started.wait()
        await runtime.interrupt()
        await asyncio.gather(task, return_exceptions=True)
        source.release_capture.set()
        await asyncio.sleep(0)
        self.assertTrue(producer.done())
        self.assertEqual(source.frames, [])
        self.assertEqual(source.clears, 1)

    async def test_repeated_interrupt_does_not_cancel_cleanup(self) -> None:
        runtime, source, client = self.make_tts()
        cleanup, release = asyncio.Event(), asyncio.Event()
        async def stop() -> None:
            cleanup.set()
            await release.wait()
            client.stopped = True
        client.stop = stop
        task = asyncio.create_task(runtime.speak('测试'))
        await client.ready.wait()
        first = asyncio.create_task(runtime.interrupt())
        await cleanup.wait()
        second = asyncio.create_task(runtime.interrupt())
        await asyncio.sleep(0)
        self.assertFalse(first.done())
        self.assertFalse(second.done())
        release.set()
        await asyncio.gather(first, second)
        await asyncio.gather(task, return_exceptions=True)
        self.assertTrue(client.stopped)
        self.assertEqual(source.clears, 1)
        self.assertFalse(runtime.is_speaking)

    async def test_total_tts_timeout_and_next_speech(self) -> None:
        runtime, source, client = self.make_tts()
        runtime.config = replace(runtime.config, dashscope_tts_request_timeout_seconds=.01)
        self.assertFalse(await runtime.speak('超时'))
        self.assertTrue(client.stopped)
        self.assertFalse(runtime.is_speaking)
        self.assertFalse(runtime.input_allowed)
        client.ready.clear()
        runtime.config = replace(runtime.config, dashscope_tts_request_timeout_seconds=1, audio_playout_tail_seconds=0)
        task = asyncio.create_task(runtime.speak('下一句'))
        await client.ready.wait()
        await runtime._handle_server_event({'type':'response.done'})
        self.assertTrue(await task)
        self.assertTrue(runtime.input_allowed)

    async def test_tts_error_clears_and_keeps_half_duplex_through_playout(self) -> None:
        runtime, source, client = self.make_tts()
        self.assertTrue(runtime.input_allowed)
        task = asyncio.create_task(runtime.speak('测试'))
        await client.ready.wait()
        self.assertFalse(runtime.input_allowed)
        await runtime._handle_server_event({'type':'client.error', 'error': {'message': 'provider failed'}})
        self.assertFalse(await task)
        self.assertEqual(source.clears, 1)
        self.assertFalse(runtime.input_allowed)

    async def test_tts_close_releases_source_and_rejects_new_speech(self) -> None:
        runtime, source, client = self.make_tts()
        closed = asyncio.Event()
        async def close() -> None:
            closed.set()
        source.aclose = close
        task = asyncio.create_task(runtime.speak('测试'))
        await client.ready.wait()
        await runtime.aclose()
        await asyncio.gather(task, return_exceptions=True)
        self.assertTrue(closed.is_set())
        self.assertFalse(await runtime.speak('已关闭'))


class PipelineConfigTests(unittest.TestCase):
    def test_duplex_mode_validated_not_silently_downgraded(self) -> None:
        from config import load_config
        for value in ('invalid', 'auto'):
            with patch.dict('os.environ', {'VOXFLAME_AUDIO_DUPLEX_MODE':value}):
                with self.assertRaises(ValueError):
                    load_config()
        for value in ('-1', '3', 'nan'):
            with patch.dict('os.environ', {'VOXFLAME_AUDIO_DUPLEX_MODE':'half', 'VOXFLAME_AUDIO_PLAYOUT_TAIL_SECONDS': value}):
                with self.assertRaises(ValueError):
                    load_config()

    def test_old_blocking_reply_paths_removed(self) -> None:
        root = Path(__file__).resolve().parents[1]
        self.assertNotIn('reply_queue', (root/'app.py').read_text())
        self.assertNotIn('asyncio.to_thread', (root/'assistant_runtime.py').read_text())
        self.assertNotIn('urllib.request', (root/'assistant_runtime.py').read_text())
        self.assertNotIn('audio_queue', (root/'tts_runtime.py').read_text())
        self.assertNotIn('fallback_active', (root/'asr_runtime.py').read_text())
        self.assertNotIn('vad_hop_size_ms', (root/'config.py').read_text())


class StreamLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_consumes_next_utterance_while_http_is_waiting(self) -> None:
        from livekit import rtc
        helper = ASRConcurrencyTests()
        runtime = helper.make_runtime()
        runtime.ctx.mode = 'training'
        runtime._vad = RMSVoiceActivityDetector(.032, 20)
        started, release = asyncio.Event(), asyncio.Event()
        async def transcribe(pcm: bytes) -> tuple[str, dict[str, object]]:
            started.set()
            await release.wait()
            return '测试', {}
        runtime.client._transcribe = transcribe
        speech = rtc.AudioFrame((2000).to_bytes(2,'little',signed=True)*320,16000,1,320)
        silence = rtc.AudioFrame(b'\0\0'*320,16000,1,320)
        class Stream:
            closed = False
            async def __aiter__(self):
                for frame in [speech, silence]:
                    yield SimpleNamespace(frame=frame)
                await asyncio.wait_for(started.wait(), .5)
                yield SimpleNamespace(frame=speech)
            async def aclose(self):
                self.closed = True
        stream = Stream()
        await asyncio.wait_for(runtime._consume_stream(stream), .5)
        self.assertTrue(stream.closed)
        self.assertEqual(runtime._audio_frame_count, 3)
        self.assertGreater(len(runtime.client._buffer), 0)
        self.assertEqual(len(runtime._recognition_tasks), 1)
        release.set()
        await asyncio.gather(*runtime._recognition_tasks)
        await runtime.stop()

    async def test_http_short_meaningful_capture_not_dropped_by_old_tail_filter(self) -> None:
        helper = ASRConcurrencyTests()
        runtime = helper.make_runtime()
        async def transcribe(pcm: bytes) -> tuple[str, dict[str, object]]:
            return '喝水', {}
        runtime.client._transcribe = transcribe
        runtime.note_client_recording_event('speech_started', False, client_capture_id='short')
        runtime._speech_ms_since_commit = 100
        await runtime.client.append_audio(b'\0\0'*1600)
        await runtime.commit_audio('manual_stop')
        await asyncio.gather(*runtime._recognition_tasks)
        self.assertEqual(helper.finals, ['喝水'])
        self.assertEqual(helper.published[-1]['client_capture_id'], 'short')
        await runtime.stop()

    async def test_no_accepted_reply_memory_until_explicit_publish_commit(self) -> None:
        from assistant_runtime import DashScopeCompletionResult
        class Client:
            async def complete(self, messages):
                return DashScopeCompletionResult('我要喝水')
            async def aclose(self):
                pass
        ctx = create_context()
        runtime = CommunicationAssistantRuntime(config=create_config(), ctx=ctx, userdata=build_session_userdata(ctx), client=Client(), capacity_pool=FakePool())
        reply, source = await runtime.generate_reply('要喝水')
        self.assertEqual(runtime.history, [])
        runtime.accept_reply('要喝水', reply, source)
        self.assertEqual(runtime.history, ['我要喝水'])
        await runtime.aclose()


class EntrypointIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_entrypoint_routes_latest_text_and_shuts_down_all_owners(self) -> None:
        import importlib.util
        import json
        from unittest.mock import AsyncMock
        class Server:
            def __init__(self, **kwargs):
                pass
            def on(self, event):
                return lambda fn: fn
            def rtc_session(self, **kwargs):
                return lambda fn: fn
        spec = importlib.util.spec_from_file_location('pipeline_app_test', Path(__file__).resolve().parents[1]/'app.py')
        app = importlib.util.module_from_spec(spec)
        with patch('livekit.agents.AgentServer', Server), patch.dict('os.environ', {'LIVEKIT_URL':'ws://localhost', 'LIVEKIT_API_KEY':'dev', 'LIVEKIT_API_SECRET':'test'}):
            spec.loader.exec_module(app)
        callbacks = {}
        class Room:
            name = 'room'
            local_participant = SimpleNamespace(publish_data=AsyncMock())
            def on(self, event):
                def register(fn):
                    callbacks[event] = fn
                    return fn
                return register
        participant = SimpleNamespace(identity='user-1', name='test', metadata='', attributes={})
        shutdowns = []
        ctx = SimpleNamespace(room=Room(), job=SimpleNamespace(metadata=''), connect=AsyncMock(), wait_for_participant=AsyncMock(return_value=participant), add_shutdown_callback=shutdowns.append, shutdown=lambda **kwargs: None)
        started, cancelled, latest = asyncio.Event(), asyncio.Event(), asyncio.Event()
        class Assistant:
            closed = False
            accepted = []
            async def generate_reply(self, text):
                if text == '旧句':
                    started.set()
                    try:
                        await asyncio.Event().wait()
                    finally:
                        cancelled.set()
                return text, 'test'
            def accept_reply(self, text, reply, source):
                self.accepted.append(text)
                latest.set()
            async def aclose(self):
                self.closed = True
        class ASR:
            closed = False
            async def start(self):
                pass
            async def stop(self):
                self.closed = True
        class Audio:
            closed = False
            input_allowed = True
            is_speaking = False
            async def speak(self, text):
                pass
            async def interrupt(self):
                pass
            async def aclose(self):
                self.closed = True
        assistant, asr, audio = Assistant(), ASR(), Audio()
        with patch.object(app, 'build_session_context', return_value=create_context()), patch.object(app, 'CommunicationAssistantRuntime', return_value=assistant), patch.object(app, 'LiveKitASRRuntime', return_value=asr), patch.object(app, 'LiveKitAudioReplyRuntime', return_value=audio), patch.object(app, 'extract_user_text_input', side_effect=lambda message: message.get('text')):
            await app.entrypoint(ctx)
            def send(text):
                callbacks['data_received'](SimpleNamespace(topic='room', participant=participant, data=json.dumps({'type':'user_text_input', 'text':text}).encode()))
            send('旧句')
            await asyncio.wait_for(started.wait(), .5)
            send('新句')
            await asyncio.wait_for(latest.wait(), .5)
            self.assertTrue(cancelled.is_set())
            self.assertEqual(assistant.accepted, ['新句'])
            self.assertEqual(len(shutdowns), 1)
            await shutdowns[0]()
            self.assertTrue(asr.closed and assistant.closed and audio.closed)
            send('已关闭')
            await asyncio.sleep(0)
            self.assertEqual(assistant.accepted, ['新句'])


class ProviderDisconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_clean_socket_close_emits_error_instead_of_waiting_full_deadline(self) -> None:
        from asr_runtime import QwenRealtimeASRClient
        from tts_runtime import DashScopeRealtimeTTSClient
        events = []
        async def handler(event):
            events.append(event)
        class ClosedSocket:
            async def __aiter__(self):
                if False:
                    yield ''
        for cls in (QwenRealtimeASRClient, DashScopeRealtimeTTSClient):
            events.clear()
            client = cls(url='wss://test.invalid', model='test', api_key='test', connect_timeout_seconds=1, event_handler=handler)
            client.websocket = ClosedSocket()
            await client._receive_loop()
            self.assertEqual(events[-1]['type'], 'client.error')
            self.assertIsNone(client.websocket)
