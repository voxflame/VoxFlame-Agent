from __future__ import annotations

import asyncio
import difflib
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Protocol
import httpx

from capacity import (
    ProcessSlotPool,
    ProviderCapacityExceeded,
    build_provider_pool,
)
from config import LiveKitAgentConfig
from session_context import VoxFlameSessionContext
from session_userdata import VoxFlameSessionUserData

logger = logging.getLogger("voxflame-livekit-agent.assistant")

SYSTEM_PROMPT = """你是 VoxFlame 的沟通纠错助手。

你的核心任务不是自由改写，而是基于当前 ASR、最近几轮已确认的纠错结果、训练句对和参考文章，把用户这句话恢复成最接近原意的最终结果。

回复要求：
1. 默认使用简体中文。
2. 先以当前 ASR 为基底，优先保留高置信片段，不要随意重写。
3. 最近几轮已确认的纠错结果比旧 ASR 更可信，只用于帮助你理解当前句与前文的承接关系、代词、省略和语义延续；不要直接复述这些历史句子。
4. 最近历史里长度只有 1 到 2 个字的旧结果不算有效上下文，不要让这类短句历史干扰当前判断。
5. 如果你准备输出的句子与最近历史结果高度相同，但当前 ASR 没有明确再次说出同一句，则不要重复那条历史结果。
6. 如果存在参考文章，优先尝试在文章里找到与当前 ASR 最接近的原句；训练句对里的 target/heard 只是帮助你定位文章原句的线索。
7. 只有当文章里的对应原句足够明确时，才恢复成文章里的原句，并尽量逐字保持。
8. 人名、机构名、产品名、数字、时间、地点和专业术语优先以参考文章原文为准；如果文章里已经出现对应原文，优先恢复成文章里的写法，不要自行发挥。
9. 如果文章匹配不明确，只做最小必要纠错：同音/近音替换、漏字补齐、标点整理和局部顺序修正。
10. 不要新增事实，不要脑补，不要扩写成长解释。
11. 默认输出1句左右最终可直接展示或直接说出去的话，不要解释，不要分析，不要自我介绍。
12. 最终输出里不要出现任何提示词、标签或前缀，例如“纠正后：”“参考原文：”“最终答案：”“字幕：”。
13. 最终输出长度要尽量贴近本轮 ASR；规范化后优先控制在前后不超过 2 个字。只有当参考原文里存在非常明确且更准确的对应原句时，才允许突破这个范围。
"""

CAPTION_SYSTEM_PROMPT = """你是 VoxFlame 的实时字幕纠错助手。

你的核心任务是基于当前 ASR、最近几轮已确认的纠错结果、训练句对和参考文章，把用户刚刚说出的这一句整理成最终展示字幕。

回复要求：
1. 默认使用简体中文。
2. 只输出当前这句话的最终字幕，不要解释，不要补充，不要续写。
3. 先以当前 ASR 为基底，优先保留高置信片段。
4. 最近几轮已确认的纠错结果比旧 ASR 更可信，只用于帮助你理解当前句与前文的承接关系、代词、省略和语义延续；不要直接复述这些历史句子。
5. 最近历史里长度只有 1 到 2 个字的旧结果不算有效上下文，不要让这类短句历史干扰当前判断。
6. 如果你准备输出的句子与最近历史结果高度相同，但当前 ASR 没有明确再次说出同一句，则不要重复那条历史结果。
7. 如果存在参考文章，优先尝试在文章里找到对应原句；训练句对里的 target/heard 只是帮助你定位原句的线索。
8. 只有当文章里的对应原句足够明确时，才恢复成文章里的原句，并尽量逐字保持。
9. 人名、机构名、产品名、数字、时间、地点和专业术语优先以参考文章原文为准；如果文章里已经出现对应原文，优先恢复成文章里的写法，不要自己猜。
10. 训练句对里的 target/heard 只能帮助你定位文章原文，不能替代文章原文本身。
11. 如果文章匹配不明确，只做最小必要纠错，不要为了更顺而新增事实。
12. 最终输出里不要出现任何提示词、标签或前缀，例如“纠正后：”“参考原文：”“最终答案：”“字幕：”。
13. 最终字幕长度要尽量贴近本轮 ASR；规范化后优先控制在前后不超过 2 个字。只有参考原文里有非常明确的对应原句时，才允许更长或更短。
"""

REPLY_HISTORY_WINDOW_TURNS = 5
REPLY_HISTORY_STORAGE_LIMIT = 20
CAPTION_ASR_FALLBACK_SOURCE = "caption_asr_fallback"
THINK_TAG_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
EDGE_PUNCTUATION_PATTERN = re.compile(r"^[\s，。！？!?；;：:、,.…~～-]+|[\s，。！？!?；;：:、,.…~～-]+$")
REFERENCE_PERSON_PATTERN = re.compile(
    r"(?:我叫|我是|叫|姓名是|名字是|主讲人是|创始人是|作者是)([\u4e00-\u9fff]{2,6})"
)
REFERENCE_COMPANY_PATTERN = re.compile(
    r"([\u4e00-\u9fffA-Za-z0-9]{2,32}(?:科技|公司|集团|医院|大学|学院|研究院|实验室|中心|平台))"
)
REFERENCE_LOCATION_PATTERN = re.compile(
    r"([\u4e00-\u9fff]{2,16}(?:省|市|区|县|镇|乡|村|路|街|大道|机场|火车站))"
)
REFERENCE_ASCII_TERM_PATTERN = re.compile(r"\b[A-Za-z][A-Za-z0-9.+/\-]{1,31}\b")
FIXED_REFERENCE_TERMS = (
    "邱生峰",
    "燃言",
    "上海生声不息科技",
    "生声不息科技",
    "智能体",
    "AI",
    "LLM",
    "VoxFlame",
)


def estimate_clarity_score(original_text: str, corrected_text: str) -> float:
    original = original_text.strip()
    corrected = corrected_text.strip()
    if not original or not corrected:
        return 0.0
    if original == corrected:
        return 1.0
    ratio = difflib.SequenceMatcher(a=original, b=corrected).ratio()
    return max(0.0, min(1.0, round(ratio, 4)))


def build_scene_prompt(
    ctx: VoxFlameSessionContext,
    *,
    caption_mode_enabled: bool = False,
) -> str:
    scene = ctx.scene or "general"
    return (
        f"当前场景：{scene}\n"
        + (
            "请优先输出当前这句话的最终展示字幕。"
            if caption_mode_enabled
            else "请优先输出一句能让对方马上理解用户意图、可以直接代说的表达。"
        )
    )


def _truncate_text(value: str, limit: int) -> str:
    normalized = " ".join(value.strip().split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: limit - 1]}…"


def _append_reference_term(results: list[str], raw_value: str) -> None:
    term = raw_value.strip().strip("，。！？!?；;：:、\"'“”‘’（）()【】[]{}<>《》")
    if not term or term in results:
        return
    results.append(term)


def extract_reference_terms(userdata: VoxFlameSessionUserData) -> list[str]:
    terms: list[str] = list(FIXED_REFERENCE_TERMS)
    document_content = userdata.preparation.document_content.strip()

    for pattern in (
        REFERENCE_PERSON_PATTERN,
        REFERENCE_COMPANY_PATTERN,
        REFERENCE_LOCATION_PATTERN,
        REFERENCE_ASCII_TERM_PATTERN,
    ):
        for match in pattern.finditer(document_content):
            _append_reference_term(terms, match.group(1) if match.lastindex else match.group(0))

    for pair in userdata.preparation.training_pairs:
        target = pair.get("target")
        if not isinstance(target, str):
            continue
        for pattern in (
            REFERENCE_PERSON_PATTERN,
            REFERENCE_COMPANY_PATTERN,
            REFERENCE_LOCATION_PATTERN,
            REFERENCE_ASCII_TERM_PATTERN,
        ):
            for match in pattern.finditer(target):
                _append_reference_term(terms, match.group(1) if match.lastindex else match.group(0))

    for term in userdata.preparation.hotwords:
        _append_reference_term(terms, term)

    return terms[:24]


def _format_training_pairs(
    pairs: list[dict[str, Any]],
    *,
    max_items: int,
    max_chars: int,
) -> list[str]:
    results: list[str] = []
    total_chars = 0

    for pair in pairs:
        target = pair.get("target")
        heard = pair.get("heard")
        if not isinstance(target, str) or not target.strip():
            continue
        if not isinstance(heard, str) or not heard.strip():
            continue
        occurrence_count = pair.get("occurrence_count")
        normalized_occurrence_count = (
            int(occurrence_count)
            if isinstance(occurrence_count, int) and occurrence_count > 1
            else 1
        )
        line = (
            f"{normalized_occurrence_count}次 | 目标：{target.strip()} | 系统常听成：{heard.strip()}"
        )
        if line in results:
            continue
        next_total_chars = total_chars + len(line)
        if results and next_total_chars > max_chars:
            break
        results.append(line)
        total_chars = next_total_chars
        if len(results) >= max_items:
            break

    return results


def build_preparation_prompt(userdata: VoxFlameSessionUserData) -> str:
    preparation = userdata.preparation
    reference_terms = extract_reference_terms(userdata)
    training_pairs = _format_training_pairs(
        preparation.training_pairs,
        max_items=80,
        max_chars=3600,
    )
    lines = [
        "稳定准备上下文：",
        "- 这里的重点不是场景润色，而是参考原文对齐。",
        f"- 参考原文专名/地名/公司名/术语：{'；'.join(reference_terms)}",
    ]
    if preparation.loadout_mode:
        mode_label = "长时间沟通" if preparation.loadout_mode == "long_form" else "紧急沟通"
        lines.append(f"- 本次上下文装配模式：{mode_label}")
    if preparation.loadout_reason:
        lines.append(f"- 装配原因：{_truncate_text(preparation.loadout_reason, 180)}")
    if preparation.loadout_items:
        lines.append("- 本次已加载上下文：")
        lines.extend(
            f"  - {_truncate_text(item, 120)}"
            for item in preparation.loadout_items[:8]
        )
    if preparation.hotwords:
        lines.append(f"- 当前高优先热词：{'；'.join(preparation.hotwords[:8])}")
    if preparation.risky_terms:
        lines.append(f"- 当前容易被听偏的词：{'；'.join(preparation.risky_terms[:6])}")
    if preparation.document_summary and not preparation.document_content:
        lines.append(f"- 参考原文摘要：{_truncate_text(preparation.document_summary, 220)}")
    if preparation.document_content:
        lines.append("- 参考原文全文：")
        lines.append(preparation.document_content.strip())
    if training_pairs:
        lines.append("- 已训练错配对：")
        lines.extend(f"  - {_truncate_text(line, 120)}" for line in training_pairs)
    return "\n".join(lines)


def build_current_turn_prompt(
    user_text: str,
    userdata: VoxFlameSessionUserData,
    *,
    recent_correction_history: list[str] | None = None,
    caption_mode_enabled: bool = False,
) -> str:
    reference_terms = extract_reference_terms(userdata)
    lines = [
        "以下是用户本轮 ASR 最终文本，可能仍有误听、漏字或同音词偏差。",
        f"本轮 ASR 最终文本：{user_text.strip() or '未提供'}",
        "本轮优先级：先看当前 ASR，再结合最近几轮已确认的纠错结果和训练句对判断语义，然后直接对照参考原文找最接近的原句。",
        f"参考原文专名/地名/公司名/术语优先按这些写法保留：{'；'.join(reference_terms)}",
        "最终输出长度要尽量贴近本轮 ASR，优先控制在前后不超过 2 个字；如果明显更长或更短，通常说明你改写过度，应回到更贴近 ASR 的版本。",
    ]
    if userdata.preparation.loadout_mode:
        mode_label = (
            "长时间沟通"
            if userdata.preparation.loadout_mode == "long_form"
            else "紧急沟通"
        )
        lines.append(f"当前这轮沟通按“{mode_label}”模式装配上下文。")
    if userdata.preparation.loadout_items:
        lines.append("本轮默认已加载的上下文如下；优先利用这些线索，不要跳出这批已装配内容随意扩写：")
        lines.extend(
            f"  - {_truncate_text(item, 100)}"
            for item in userdata.preparation.loadout_items[:8]
        )
    if userdata.preparation.hotwords:
        lines.append(
            f"本轮高优先热词如下；人名、地名、机构名、术语优先往这些词靠拢：{'；'.join(userdata.preparation.hotwords[:8])}"
        )
    if userdata.preparation.risky_terms:
        lines.append(
            f"这些词在当前用户身上更容易被系统听偏：{'；'.join(userdata.preparation.risky_terms[:6])}。遇到近音或漏字时优先结合材料判断。"
        )
    if recent_correction_history:
        lines.append("最近几轮已确认的纠错结果如下；这些结果比旧 ASR 更可信，但只能用于理解语义承接和避免重复，不能直接复述：")
        lines.append("长度只有 1 到 2 个字的旧结果不算有效上下文，已经忽略。")
        lines.extend(
            f"  - {_truncate_text(item, 60)}"
            for item in recent_correction_history
            if item.strip()
        )
        lines.append(
            "如果你的候选结果与上面某句高度相同，但本轮 ASR 没有明确再次说出同一句，则这是 history 回声，应回到更贴近当前 ASR 的版本。"
        )
    if userdata.preparation.document_content:
        lines.append("如果参考原文里已经有对应说法，人名、地名、公司名、产品名、数字和术语必须优先以原文写法为准。")
    if userdata.preparation.training_pairs:
        lines.append("训练句对只是帮助你识别常见误听模式，最终答案仍必须以参考原文为主。")
    lines.append("不要管其他场景包装，不要扩写。只做最小必要纠错，并尽量恢复到参考原文里的准确说法；如果拿不准，宁可少改，不要整句重写。")
    lines.append(
        "请只输出当前这句话的最终展示字幕。"
        if caption_mode_enabled
        else "请只输出最终可直接说出去的话。"
    )
    return "\n".join(lines)


def build_recent_correction_history(
    history: list[str],
) -> list[str]:
    results: list[str] = []
    seen: set[str] = set()

    for item in reversed(history):
        normalized = normalize_history_correction_text(item)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        results.append(normalized)
        if len(results) >= REPLY_HISTORY_WINDOW_TURNS:
            break

    return list(reversed(results))


def strip_think_tags(text: str) -> str:
    return THINK_TAG_PATTERN.sub("", text).strip()


def normalize_history_correction_text(text: str) -> str:
    normalized = strip_think_tags(text)
    if not normalized:
        return ""

    normalized = normalized.strip()
    semantic_length = len(EDGE_PUNCTUATION_PATTERN.sub("", normalized))
    if not normalized or semantic_length <= 2:
        return ""
    return normalized


def sanitize_correction_reply(text: str) -> str:
    normalized = strip_think_tags(text)
    if not normalized:
        return ""

    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    if not lines:
        return ""

    label_patterns = (
        r"^(?:纠正后|修正后|更正后|最终答案|最终结果|最终字幕|字幕|输出|答案|参考原文|原文|改写后)\s*[：:]\s*",
    )

    cleaned_lines: list[str] = []
    for line in lines:
        cleaned_line = line
        for pattern in label_patterns:
            cleaned_line = re.sub(pattern, "", cleaned_line)
        if cleaned_line:
            cleaned_lines.append(cleaned_line)

    if not cleaned_lines:
        return ""

    return " ".join(cleaned_lines).strip()


def extract_text_from_completion(payload: dict[str, Any]) -> str | None:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None

    first = choices[0]
    if not isinstance(first, dict):
        return None

    message = first.get("message")
    if not isinstance(message, dict):
        return None

    content = message.get("content")
    if isinstance(content, str) and content.strip():
        normalized = sanitize_correction_reply(content)
        return normalized or None

    if isinstance(content, list):
        text_parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                text_parts.append(item["text"].strip())
        combined = sanitize_correction_reply("".join(part for part in text_parts if part))
        return combined or None

    return None


@dataclass
class DashScopeChatClient:
    api_key: str
    base_url: str
    model: str
    timeout_seconds: float
    temperature: float
    max_tokens: int

    _http_client: httpx.AsyncClient | None = field(default=None, init=False, repr=False)

    async def aclose(self) -> None:
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    async def complete(self, messages: list[dict[str, object]]) -> "DashScopeCompletionResult":
        payload = (
            {
                "model": self.model,
                "messages": messages,
                "temperature": self.temperature,
                "max_tokens": self.max_tokens,
                "parameters": {
                    "enable_thinking": False,
                },
            }
        )
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=self.timeout_seconds, trust_env=False)
        response = await self._http_client.post(
            f"{self.base_url}/chat/completions", json=payload, headers=headers,
        )
        response.raise_for_status()
        parsed = response.json()
        text = extract_text_from_completion(parsed)
        if not text:
            raise RuntimeError("DashScope returned no usable text content")
        usage = parsed.get("usage")
        prompt_tokens = usage.get("prompt_tokens") if isinstance(usage, dict) else None
        completion_tokens = usage.get("completion_tokens") if isinstance(usage, dict) else None

        prompt_token_details = usage.get("prompt_tokens_details") if isinstance(usage, dict) else None
        cached_tokens = (
            prompt_token_details.get("cached_tokens")
            if isinstance(prompt_token_details, dict)
            else None
        )
        cache_creation_input_tokens = (
            prompt_token_details.get("cache_creation_input_tokens")
            if isinstance(prompt_token_details, dict)
            else None
        )
        return DashScopeCompletionResult(
            text=text,
            prompt_tokens=prompt_tokens if isinstance(prompt_tokens, int) else None,
            completion_tokens=completion_tokens if isinstance(completion_tokens, int) else None,
            cached_tokens=cached_tokens if isinstance(cached_tokens, int) else None,
            cache_creation_input_tokens=(
                cache_creation_input_tokens
                if isinstance(cache_creation_input_tokens, int)
                else None
            ),
        )


@dataclass(frozen=True)
class DashScopeCompletionResult:
    text: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cached_tokens: int | None = None
    cache_creation_input_tokens: int | None = None


class AssistantReplyGenerationError(RuntimeError):
    def __init__(self, user_message: str, *, code: str, detail: str | None = None) -> None:
        super().__init__(detail or user_message)
        self.user_message = user_message
        self.code = code
        self.detail = detail or user_message


class ChatClient(Protocol):
    async def complete(self, messages: list[dict[str, object]]) -> DashScopeCompletionResult: ...

    async def aclose(self) -> None: ...


def _classify_generation_failure(exc: Exception) -> AssistantReplyGenerationError:
    detail = str(exc).strip() or exc.__class__.__name__
    if isinstance(exc, ProviderCapacityExceeded):
        return AssistantReplyGenerationError(
            "当前使用人数较多，请稍后再说一次。",
            code="correction_capacity",
            detail=detail,
        )
    lowered = detail.lower()
    if "timed out" in lowered or "timeout" in lowered:
        return AssistantReplyGenerationError(
            "本句整理超时，请再说一次完整句子。",
            code="correction_timeout",
            detail=detail,
        )
    return AssistantReplyGenerationError(
        "本句整理失败，请再说一次完整句子。",
        code="correction_failed",
        detail=detail,
    )


@dataclass
class CommunicationAssistantRuntime:
    config: LiveKitAgentConfig
    ctx: VoxFlameSessionContext
    userdata: VoxFlameSessionUserData
    client: ChatClient | None = None
    capacity_pool: ProcessSlotPool | None = None
    history: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.capacity_pool is None:
            self.capacity_pool = build_provider_pool(
                provider="llm",
                slots=self.config.provider_llm_max_concurrency,
                wait_timeout_seconds=self.config.provider_llm_wait_timeout_seconds,
                lock_directory=self.config.provider_capacity_directory,
            )
        if self.client is None and self.config.dashscope_api_key:
            self.client = DashScopeChatClient(
                api_key=self.config.dashscope_api_key,
                base_url=self.config.dashscope_base_url,
                model=self.config.dashscope_correction_model,
                timeout_seconds=self.config.dashscope_timeout_seconds,
                temperature=self.config.dashscope_llm_temperature,
                max_tokens=self.config.dashscope_llm_max_tokens,
            )

    def _build_system_prompt(self) -> str:
        return CAPTION_SYSTEM_PROMPT if self.userdata.caption_mode_enabled else SYSTEM_PROMPT

    def _build_caption_fallback_reply(self, user_text: str) -> tuple[str, str] | None:
        if not self.userdata.caption_mode_enabled:
            return None
        fallback = user_text.strip()
        if not fallback:
            return None
        return fallback, CAPTION_ASR_FALLBACK_SOURCE

    async def generate_reply(self, user_text: str) -> tuple[str, str]:
        normalized = user_text.strip()
        if not normalized:
            raise AssistantReplyGenerationError(
                "未收到可整理的语音内容，请再说一遍。",
                code="empty_transcript",
            )

        if self.client is None:
            caption_fallback = self._build_caption_fallback_reply(normalized)
            if caption_fallback is not None:
                logger.warning(
                    "DashScope correction unavailable, using caption ASR fallback room=%s participant=%s reason=llm_unavailable chars=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    len(normalized),
                )
                return caption_fallback
            raise AssistantReplyGenerationError(
                "纠错模型未配置，暂时无法整理这句话。",
                code="llm_unavailable",
            )

        recent_correction_history = build_recent_correction_history(self.history)
        stable_prompt = "\n\n".join(
            [
                self._build_system_prompt(),
                build_preparation_prompt(self.userdata),
            ]
        )
        messages = [
            {
                "role": "system",
                "content": stable_prompt,
            },
            {
                "role": "user",
                "content": build_current_turn_prompt(
                    normalized,
                    self.userdata,
                    recent_correction_history=recent_correction_history,
                    caption_mode_enabled=self.userdata.caption_mode_enabled,
                ),
            },
        ]
        started_at = time.perf_counter()
        deadline_ms = round(self.config.dashscope_reply_timeout_seconds * 1000)

        try:
            if self.capacity_pool is None:
                raise RuntimeError("LLM capacity pool is not initialized")
            async def complete_with_lease() -> DashScopeCompletionResult:
                async with self.capacity_pool.lease():
                    return await self.client.complete(messages)

            raw_result = await asyncio.wait_for(
                complete_with_lease(), timeout=self.config.dashscope_reply_timeout_seconds,
            )
            completion = raw_result
            reply = sanitize_correction_reply(completion.text)
            if not reply:
                raise RuntimeError("LLM returned an empty reply")
        except Exception as exc:
            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
            classified_error = _classify_generation_failure(exc)
            logger.warning(
                "DashScope correction failed room=%s participant=%s scene=%s latency_ms=%s deadline_ms=%s code=%s error=%s",
                self.ctx.room_name,
                self.ctx.participant_identity,
                self.ctx.scene,
                elapsed_ms,
                deadline_ms,
                classified_error.code,
                classified_error.detail,
            )
            caption_fallback = self._build_caption_fallback_reply(normalized)
            if caption_fallback is not None:
                logger.info(
                    "DashScope correction fallback to ASR room=%s participant=%s scene=%s latency_ms=%s code=%s chars=%s",
                    self.ctx.room_name,
                    self.ctx.participant_identity,
                    self.ctx.scene,
                    elapsed_ms,
                    classified_error.code,
                    len(normalized),
                )
                return caption_fallback
            raise classified_error from exc

        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
        logger.info(
            "DashScope correction completed room=%s participant=%s scene=%s latency_ms=%s deadline_ms=%s exceeded_deadline=%s prompt_tokens=%s cached_tokens=%s cache_creation_input_tokens=%s completion_tokens=%s reply_chars=%s",
            self.ctx.room_name,
            self.ctx.participant_identity,
            self.ctx.scene,
            elapsed_ms,
            deadline_ms,
            elapsed_ms > deadline_ms,
            completion.prompt_tokens,
            completion.cached_tokens,
            completion.cache_creation_input_tokens,
            completion.completion_tokens,
            len(reply),
        )
        source = "dashscope_chat_completion"
        return reply, source

    def accept_reply(self, user_text: str, reply: str, source: str) -> None:
        """Commit session-local history only after the current output was published."""
        self.userdata.note_user_transcript(user_text)
        self.userdata.note_assistant_reply(reply, source=source)
        if source != CAPTION_ASR_FALLBACK_SOURCE:
            self._remember_turn(reply)

    async def aclose(self) -> None:
        if self.client is not None:
            await self.client.aclose()

    def _remember_turn(self, reply: str) -> None:
        self.history.append(reply)
        self.history = self.history[-REPLY_HISTORY_STORAGE_LIMIT:]
