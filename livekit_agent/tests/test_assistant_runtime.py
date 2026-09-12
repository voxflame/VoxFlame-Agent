from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from assistant_runtime import (
    CAPTION_ASR_FALLBACK_SOURCE,
    DashScopeCompletionResult,
    AssistantReplyGenerationError,
    CommunicationAssistantRuntime,
    build_recent_correction_history,
    build_current_turn_prompt,
    build_preparation_prompt,
    estimate_clarity_score,
    extract_text_from_completion,
    normalize_history_correction_text,
    sanitize_correction_reply,
)
from capacity import ProcessSlotPool
from config import LiveKitAgentConfig
from session_context import VoxFlameSessionContext
from session_userdata import build_session_userdata


def create_config() -> LiveKitAgentConfig:
    return LiveKitAgentConfig(
        livekit_url="ws://127.0.0.1:7880",
        livekit_api_key="devkey",
        livekit_api_secret="secret",
        agent_name="voxflame-agent",
        mode="communication_stub",
        dashscope_api_key=None,
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


def create_context() -> VoxFlameSessionContext:
    return VoxFlameSessionContext(
        request_id="req-1",
        room_name="room-1",
        participant_identity="user-1",
        participant_name="User",
        surface="communication_workspace",
        mode="communication",
        scene="medical",
        session_strategy="heavy_realtime",
        requested_capabilities=["transport_send_control"],
        granted_capabilities=["transport_send_control"],
        raw_participant_metadata=None,
        raw_job_metadata=None,
        raw_attributes={},
    )


class FakeDashScopeClient:
    async def aclose(self) -> None:
        pass

    def __init__(self, text: str | list[str]) -> None:
        self.text = text
        self.requests: list[list[dict[str, object]]] = []

    async def complete(self, messages: list[dict[str, object]]) -> DashScopeCompletionResult:
        self.requests.append(messages)
        if isinstance(self.text, list):
            index = min(len(self.requests) - 1, len(self.text) - 1)
            return DashScopeCompletionResult(self.text[index])
        return DashScopeCompletionResult(self.text)


class FailingDashScopeClient:
    async def aclose(self) -> None:
        pass

    async def complete(self, messages: list[dict[str, object]]) -> DashScopeCompletionResult:  # noqa: ARG002
        raise RuntimeError("The read operation timed out")


class TestAssistantRuntime(unittest.TestCase):
    def test_estimate_clarity_score_prefers_identical_text(self) -> None:
        self.assertEqual(estimate_clarity_score("我想挂号", "我想挂号"), 1.0)

    def test_estimate_clarity_score_decreases_when_text_changes(self) -> None:
        score = estimate_clarity_score("我说话慢一点", "医生您好，我说话会慢一点，请等我说完。")
        self.assertGreaterEqual(score, 0.0)
        self.assertLess(score, 1.0)

    def test_extract_text_from_completion_reads_string_content(self) -> None:
        text = extract_text_from_completion(
            {"choices": [{"message": {"content": "你好，我来帮你。"}}]},
        )
        self.assertEqual(text, "你好，我来帮你。")

    def test_extract_text_from_completion_strips_prompt_labels(self) -> None:
        text = extract_text_from_completion(
            {"choices": [{"message": {"content": "纠正后：我是邱生峰"}}]},
        )
        self.assertEqual(text, "我是邱生峰")

    def test_extract_text_from_completion_reads_parts_content(self) -> None:
        text = extract_text_from_completion(
            {
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"type": "text", "text": "第一句。"},
                                {"type": "text", "text": "第二句。"},
                            ],
                        },
                    },
                ],
            },
        )
        self.assertEqual(text, "第一句。第二句。")

    def test_generate_reply_raises_when_dashscope_is_unavailable(self) -> None:
        runtime = CommunicationAssistantRuntime(
            config=create_config(),
            ctx=create_context(),
            userdata=build_session_userdata(create_context()),
        )

        with self.assertRaises(AssistantReplyGenerationError) as exc:
            asyncio.run(runtime.generate_reply("请帮我叫医生"))

        self.assertEqual(exc.exception.code, "llm_unavailable")

    def test_generate_reply_uses_client_when_available(self) -> None:
        fake_client = FakeDashScopeClient("请先帮我叫医生，我需要马上处理。")
        userdata = build_session_userdata(create_context())
        userdata.preparation.document_content = "医生您好，我叫邱生峰。我想先挂号。"
        runtime = CommunicationAssistantRuntime(
            config=create_config(),
            ctx=create_context(),
            userdata=userdata,
            client=fake_client,
        )
        reply, source = asyncio.run(runtime.generate_reply("请帮我叫医生"))
        self.assertEqual(source, "dashscope_chat_completion")
        self.assertEqual(reply, "请先帮我叫医生，我需要马上处理。")
        self.assertIn("本轮 ASR 最终文本：请帮我叫医生", fake_client.requests[0][-1]["content"])
        self.assertIsInstance(fake_client.requests[0][0]["content"], str)
        self.assertIn("稳定准备上下文", fake_client.requests[0][0]["content"])

    def test_generate_reply_uses_caption_prompt_with_recent_correction_history_when_caption_mode_enabled(self) -> None:
        fake_client = FakeDashScopeClient("请先帮我叫医生。")
        userdata = build_session_userdata(create_context())
        userdata.set_caption_mode(True)
        runtime = CommunicationAssistantRuntime(
            config=create_config(),
            ctx=create_context(),
            userdata=userdata,
            client=fake_client,
        )

        reply, source = asyncio.run(runtime.generate_reply("请帮我叫医生"))
        runtime.accept_reply("请帮我叫医生", reply, source)
        asyncio.run(runtime.generate_reply("我现在很难受"))

        self.assertIn("实时字幕纠错助手", fake_client.requests[0][0]["content"])
        self.assertIn("最终展示字幕", fake_client.requests[0][-1]["content"])
        self.assertEqual(len(fake_client.requests[1]), 2)
        self.assertIn("最近几轮已确认的纠错结果如下", fake_client.requests[1][1]["content"])
        self.assertIn("请先帮我叫医生。", fake_client.requests[1][1]["content"])
        self.assertNotIn("本轮 ASR 最终文本：请帮我叫医生", fake_client.requests[1][1]["content"])

    def test_generate_reply_strips_prompt_labels_from_model_output(self) -> None:
        fake_client = FakeDashScopeClient("纠正后：我是邱生峰")
        runtime = CommunicationAssistantRuntime(
            config=create_config(),
            ctx=create_context(),
            userdata=build_session_userdata(create_context()),
            client=fake_client,
        )

        reply, _ = asyncio.run(runtime.generate_reply("我是邱文峰"))

        self.assertEqual(reply, "我是邱生峰")

    def test_generate_reply_raises_error_when_dashscope_times_out(self) -> None:
        runtime = CommunicationAssistantRuntime(
            config=create_config(),
            ctx=create_context(),
            userdata=build_session_userdata(create_context()),
            client=FailingDashScopeClient(),
        )

        with self.assertRaises(AssistantReplyGenerationError) as exc:
            asyncio.run(runtime.generate_reply("我渴了"))

        self.assertEqual(exc.exception.code, "correction_timeout")
        self.assertIn("超时", exc.exception.user_message)

    def test_generate_reply_reports_capacity_without_calling_provider(self) -> None:
        with tempfile.TemporaryDirectory() as lock_directory:
            pool = ProcessSlotPool(
                provider="llm",
                slots=1,
                wait_timeout_seconds=0,
                lock_directory=lock_directory,
            )
            fake_client = FakeDashScopeClient("不应调用")
            runtime = CommunicationAssistantRuntime(
                config=create_config(),
                ctx=create_context(),
                userdata=build_session_userdata(create_context()),
                client=fake_client,
                capacity_pool=pool,
            )

            async def run() -> None:
                held_lease = await pool.acquire()
                try:
                    with self.assertRaises(AssistantReplyGenerationError) as exc:
                        await runtime.generate_reply("请帮我叫医生")
                    self.assertEqual(exc.exception.code, "correction_capacity")
                    self.assertIn("使用人数较多", exc.exception.user_message)
                finally:
                    held_lease.release()

            asyncio.run(run())
            self.assertEqual(fake_client.requests, [])

    def test_generate_reply_falls_back_to_asr_in_caption_mode_when_dashscope_times_out(self) -> None:
        userdata = build_session_userdata(create_context())
        userdata.set_caption_mode(True)
        runtime = CommunicationAssistantRuntime(
            config=create_config(),
            ctx=create_context(),
            userdata=userdata,
            client=FailingDashScopeClient(),
        )

        reply, source = asyncio.run(runtime.generate_reply("不是不知道该怎么过"))

        self.assertEqual(reply, "不是不知道该怎么过")
        self.assertEqual(source, CAPTION_ASR_FALLBACK_SOURCE)
        self.assertEqual(runtime.history, [])

    def test_generate_reply_keeps_recent_five_turns_of_confirmed_corrections(self) -> None:
        fake_client = FakeDashScopeClient([f"纠错结果{index}" for index in range(6)])
        runtime = CommunicationAssistantRuntime(
            config=create_config(),
            ctx=create_context(),
            userdata=build_session_userdata(create_context()),
            client=fake_client,
        )

        for index in range(6):
            reply, source = asyncio.run(runtime.generate_reply(f"第{index}句"))
            runtime.accept_reply(f"第{index}句", reply, source)

        current_turn_prompt = fake_client.requests[-1][1]["content"]
        self.assertEqual(len(fake_client.requests[-1]), 2)
        self.assertIn("最近几轮已确认的纠错结果如下", current_turn_prompt)
        self.assertIn("纠错结果0", current_turn_prompt)
        self.assertIn("纠错结果4", current_turn_prompt)
        self.assertNotIn("纠错结果5", current_turn_prompt)
        self.assertNotIn("本轮 ASR 最终文本：第0句", current_turn_prompt)
        self.assertIn("本轮 ASR 最终文本：第5句", current_turn_prompt)

    def test_build_recent_correction_history_keeps_latest_unique_replies(self) -> None:
        history = [
            "我想挂号。",
            "我想挂号。",
            "我现在有点难受。",
            "请先帮我叫医生。",
            "我现在有点难受。",
            "我需要喝水。",
            "我头有点晕。",
        ]

        recent = build_recent_correction_history(history)

        self.assertEqual(
            recent,
            [
                "我想挂号。",
                "请先帮我叫医生。",
                "我现在有点难受。",
                "我需要喝水。",
                "我头有点晕。",
            ],
        )

    def test_build_recent_correction_history_skips_short_replies(self) -> None:
        history = [
            "嗯。",
            "大家好，我是邱生峰。",
            "啊",
            "你好",
            "不是不知道该怎么过，嗯。",
            "哦。",
            "好的。",
            "我现在状态比较低落。",
            "呃",
            "大家好，欢迎观看重庆大学物理与技术学院人工智能领域。",
        ]

        recent = build_recent_correction_history(history)

        self.assertEqual(
            recent,
            [
                "大家好，我是邱生峰。",
                "不是不知道该怎么过，嗯。",
                "我现在状态比较低落。",
                "大家好，欢迎观看重庆大学物理与技术学院人工智能领域。",
            ],
        )

    def test_normalize_history_correction_text_skips_one_to_two_char_history(self) -> None:
        self.assertEqual(normalize_history_correction_text("嗯。"), "")
        self.assertEqual(normalize_history_correction_text("啊"), "")
        self.assertEqual(normalize_history_correction_text("你好"), "")
        self.assertEqual(normalize_history_correction_text("好的。"), "")
        self.assertEqual(normalize_history_correction_text("嗯，大家好，我是邱生峰。"), "嗯，大家好，我是邱生峰。")
        self.assertEqual(normalize_history_correction_text("不是不知道该怎么过，嗯。"), "不是不知道该怎么过，嗯。")

    def test_build_preparation_prompt_includes_document_and_pairs(self) -> None:
        userdata = build_session_userdata(create_context())
        userdata.preparation.loadout_mode = "long_form"
        userdata.preparation.loadout_reason = "当前已有完整准备稿，优先带材料进入长时间沟通。"
        userdata.preparation.loadout_items = [
            "默认 | 默认常驻 | 用户个人画像：围绕稳定表达规律继续装配。",
            "辅助 | 最近沉淀 | 当前训练总结：优先减少专名误听。",
        ]
        userdata.preparation.hotwords = ["邱生峰", "挂号"]
        userdata.preparation.risky_terms = ["邱文峰"]
        userdata.preparation.document_content = (
            "大家好，我叫邱生峰，在生声不息科技做 AI 智能体和 LLM 产品。"
        )
        userdata.preparation.training_pairs = [
            {"target": "我叫邱生峰。", "heard": "我叫邱文峰。", "occurrence_count": 2},
        ]
        prompt = build_preparation_prompt(userdata)
        self.assertIn("稳定准备上下文", prompt)
        self.assertIn("参考原文专名/地名/公司名/术语", prompt)
        self.assertIn("邱生峰", prompt)
        self.assertIn("燃言", prompt)
        self.assertIn("上海生声不息科技", prompt)
        self.assertIn("生声不息科技", prompt)
        self.assertIn("AI", prompt)
        self.assertIn("智能体", prompt)
        self.assertIn("LLM", prompt)
        self.assertIn("本次上下文装配模式：长时间沟通", prompt)
        self.assertIn("本次已加载上下文", prompt)
        self.assertIn("当前高优先热词", prompt)
        self.assertIn("当前容易被听偏的词", prompt)
        self.assertIn("系统常听成", prompt)

    def test_build_current_turn_prompt_prefers_prepared_content_and_pairs(self) -> None:
        userdata = build_session_userdata(create_context())
        userdata.preparation.loadout_mode = "urgent"
        userdata.preparation.loadout_items = [
            "默认 | 默认常驻 | 固定补救句：请您慢一点，我再说一次。",
        ]
        userdata.preparation.hotwords = ["邱生峰", "挂号"]
        userdata.preparation.risky_terms = ["邱文峰"]
        userdata.preparation.document_content = (
            "医生您好，我叫邱生峰，在生声不息科技做 AI 智能体和 LLM 产品。我想先挂号。"
        )
        userdata.preparation.reference_lines = ["医生您好，我叫邱生峰。"]
        userdata.preparation.training_pairs = [
            {"target": "我叫邱生峰。", "heard": "我叫邱文峰。", "occurrence_count": 3},
        ]

        prompt = build_current_turn_prompt(
            "我叫邱文峰",
            userdata,
            recent_correction_history=["大家好，我叫邱生峰。", "我在生声不息科技做 AI 智能体。"],
        )

        self.assertIn("本轮 ASR 最终文本：我叫邱文峰", prompt)
        self.assertIn("最近几轮已确认的纠错结果", prompt)
        self.assertIn("直接对照参考原文找最接近的原句", prompt)
        self.assertIn("参考原文专名/地名/公司名/术语优先按这些写法保留", prompt)
        self.assertIn("邱生峰", prompt)
        self.assertIn("上海生声不息科技", prompt)
        self.assertIn("这些结果比旧 ASR 更可信，但只能用于理解语义承接和避免重复，不能直接复述", prompt)
        self.assertIn("长度只有 1 到 2 个字的旧结果不算有效上下文", prompt)
        self.assertIn("history 回声", prompt)
        self.assertIn("人名、地名、公司名、产品名、数字和术语必须优先以原文写法为准", prompt)
        self.assertIn("训练句对只是帮助你识别常见误听模式", prompt)
        self.assertIn("最终输出长度要尽量贴近本轮 ASR", prompt)
        self.assertIn("当前这轮沟通按“紧急沟通”模式装配上下文", prompt)
        self.assertIn("本轮默认已加载的上下文如下", prompt)
        self.assertIn("本轮高优先热词如下", prompt)
        self.assertIn("这些词在当前用户身上更容易被系统听偏", prompt)

    def test_generate_reply_sends_full_reference_article_to_model(self) -> None:
        fake_client = FakeDashScopeClient("请先帮我确认一下。")
        userdata = build_session_userdata(create_context())
        userdata.preparation.document_content = (
            "大家好，我叫邱生峰，在生声不息科技做 AI 智能体和 LLM 产品。"
        )
        userdata.preparation.training_pairs = [
            {"target": "我叫邱生峰。", "heard": "我叫邱文峰。", "occurrence_count": 3},
        ]
        runtime = CommunicationAssistantRuntime(
            config=create_config(),
            ctx=create_context(),
            userdata=userdata,
            client=fake_client,
        )

        asyncio.run(runtime.generate_reply("请帮我确认一下"))

        stable_prompt = fake_client.requests[0][0]["content"]
        current_turn_prompt = fake_client.requests[0][-1]["content"]
        self.assertIn("参考原文全文", stable_prompt)
        self.assertIn("参考原文专名/地名/公司名/术语", stable_prompt)
        self.assertIn("邱生峰", stable_prompt)
        self.assertIn("燃言", stable_prompt)
        self.assertIn("上海生声不息科技", stable_prompt)
        self.assertIn("生声不息科技", stable_prompt)
        self.assertIn("AI 智能体", stable_prompt)
        self.assertIn("LLM", stable_prompt)
        self.assertIn("参考原文专名/地名/公司名/术语优先按这些写法保留", current_turn_prompt)
        self.assertIn("训练句对只是帮助你识别常见误听模式", current_turn_prompt)
        self.assertIn("最终输出长度要尽量贴近本轮 ASR", current_turn_prompt)

    def test_generate_reply_does_not_treat_reference_lines_as_article_source(self) -> None:
        userdata = build_session_userdata(create_context())
        userdata.preparation.document_content = "大家好，我叫邱生峰。"
        userdata.preparation.reference_lines = ["请先听我说完。"]
        userdata.preparation.training_pairs = [
            {"target": "我叫邱生峰。", "heard": "我叫邱文峰。", "occurrence_count": 3},
        ]
        stable_prompt = build_preparation_prompt(userdata)
        self.assertIn("大家好，我叫邱生峰。", stable_prompt)
        self.assertNotIn("请先听我说完。", stable_prompt)

    def test_generate_reply_still_uses_model_for_name_correction_case(self) -> None:
        fake_client = FakeDashScopeClient("我叫邱生峰。")
        userdata = build_session_userdata(create_context())
        userdata.preparation.document_content = (
            "大家好，我叫邱生峰，在生声不息科技做 AI 智能体和 LLM 产品。"
        )
        runtime = CommunicationAssistantRuntime(
            config=create_config(),
            ctx=create_context(),
            userdata=userdata,
            client=fake_client,
        )

        reply, source = asyncio.run(runtime.generate_reply("我叫邱文峰"))

        self.assertEqual(reply, "我叫邱生峰。")
        self.assertEqual(source, "dashscope_chat_completion")
        self.assertEqual(len(fake_client.requests), 1)

    def test_sanitize_correction_reply_strips_prompt_like_prefixes(self) -> None:
        self.assertEqual(sanitize_correction_reply("参考原文：我是邱生峰"), "我是邱生峰")
        self.assertEqual(sanitize_correction_reply("最终字幕：我是邱生峰"), "我是邱生峰")


if __name__ == "__main__":
    unittest.main()
