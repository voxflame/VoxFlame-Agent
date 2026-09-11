# 语音 / Voice Agent 官方工程指标与 Benchmark 协议

版本：v1，2026-09-10。Owner：livekit_agent + Harness。关联 RO-014 / FB-008。

## 1. 范围与原则

固定闭环：**发现需求 → 实现 → 优化 → 测试 → 迭代**。不是另一个研究状态机：需求/故障仍登记现有 Pipeline、Evidence、Feedback、Outcome 和应用回流。规则/阈值唯一事实源为 `research/HARNESS_RULES.yaml`。

不做“语音系统综合 90 分”。分开报告可靠性、阶段延迟、识别/意图质量、音频传输、打断、设备声学、任务成功和资源成本。官方指标定义不等于官方为本产品承诺的 SLO；本项目既有 ASR/TTS 等阈值读取 rules，未制定的阈值保持 `not_evaluated`，不凭空给 CER/AEC/端到端承诺。

## 2. 一手资料与版本

2026-09-10 经 Context7 定位，直接读取以下官方/作者仓库原文。网页工具未返回可用正文，采用官方 Markdown/原始文件作为回退。获取记录（URL、HTTP、类型、大小、SHA-256）见 `VOICE_BENCHMARK_SOURCES_2026-09-10.json`；原始快照本地在 `output/voice-benchmark-20260910/sources/`，不把快照未入 Git 说成任何机器都能离线重放。重新获取需核对哈希/修订协议，不静默套用漂移内容。

| ID | 原文入口 | 能证明什么 / 限制 |
| --- | --- | --- |
| livekit-data | `https://docs.livekit.io/deploy/observability/data.md` | SDK 分层指标与时间边界；不证明本机性能 |
| livekit-testing | `https://docs.livekit.io/agents/build/testing.md` | Agent 行为断言、测试与模拟入口；文本测试不证明音频质量 |
| webrtc-stats | `https://www.w3.org/TR/webrtc-stats/` | RTP/抖动缓冲/丢包/掩蔽标准字段；不直接等于主观听感 |
| nist-sctk | `https://github.com/usnistgov/SCTK` | NIST ASR 评分工具；输入转写规范仍需冻结 |
| jiwer | `https://github.com/jitsi/jiwer` | 编辑距离 WER/CER 与空参考处理；不是目标人群认证 |
| aec-challenge | `https://github.com/microsoft/AEC-Challenge` | 赛事主办方单讲/双讲、主客观声学评测；赛事算法预算不等于本产品 SLO |
| voicebench | `https://github.com/MatthewCYM/VoiceBench` | 作者语音理解、指令、安全/口音任务；不是 RTC 容量测试 |
| tau-voice | `https://github.com/sierra-research/tau2-bench/tree/main/src/tau2/voice` | 作者实时语音交互、噪声/打断/任务评测实现；需额外适配/服务授权 |

这里依据官方文档和仓库实现，不声称已经复现论文/排行榜。旧 `agents/build/metrics.md` 本次返回 Observability overview，不再将其视作旧指标表。

## 3. 当前运行时映射（尚非完整埋点）

已核验应用是自定义 `ASRRuntime / AssistantRuntime / TTSRuntime / ReplyTurnRunner`，不是标准 `AgentSession`。现役主链不变：RTC → Backend 可信 dispatch → self-hosted LiveKit → 自定义 Agent。服务端 NS/高通 → RMS VAD → 分句 HTTP ASR → 整句 LLM 完成 → 可选流式 TTS。模型/账号版本每次从当前受限配置冻结，不把用户口述 Qwen32B 当实际事实。

官方推荐 per-turn `ChatMessage.metrics`，用 `session_usage_updated / session.usage` 记录会话用量；**session-level** `metrics_collected` 与 `UsageCollector` 已弃用，**per-plugin** `metrics_collected` 未弃用。不可为了埋点恢复旧 API 或并行 AgentSession。我们需要在现役边界补对应计时/trace，不能仅注册 SDK 回调便声称覆盖自定义调用。Cloud Agent Insights/云端 simulations 有 Cloud 前提；自托管可保存本地报告，不等于已有 Cloud Dashboard。

单位以具体字段为准：Python plugin duration 为秒；Node plugin 常带 Ms；当前 per-turn MetricsReport 表中两语言均列秒。统一导出 `_ms` 前显式换算；禁止按语言一刀切。无 token 的 sentinel、streaming STT 的固定 duration=0 不能转成零延迟成功。

| 层 | 官方定义 / 本地指标 | 计时/验收边界 |
| --- | --- | --- |
| VAD | VADMetrics inference_duration_total / inference_count | 推理开销；不是端点正确率。另测慢语速、长停顿、漏起点/误切句 |
| ASR | STTMetrics.duration → asr_request_ms | 非流式请求开始到最终结果；与音频时长分别记录，RTF=处理秒/输入秒。不是录音开始到转写的总时间 |
| 端点 | EOUMetrics.end_of_utterance_delay → end_of_turn_ms | 最后语音到判定回合完成；**已包含 transcription_delay，不重复相加** |
| LLM | LLMMetrics.ttft / duration → llm_ttft_ms / llm_full_ms | 首 token 与整句完成分开；当前整句纠错后才 TTS，关键路径用 full 而不是 TTFT |
| TTS | TTSMetrics.ttfb → tts_ttfb_ms | 请求到首音频字节，不是客户端收到或扬声器发声；队列/限流等待另列 |
| 端到端 | MetricsReport.e2e_latency | SDK 语音结束到 Agent 开始响应；只能在匹配边界时同名 |
| RTC 探针 | rtc_first_frame_after_input_ms（项目代理指标） | 本地输入 source 播完到客户端首个收到的音频帧；可能静音，不等于可听首响 |
| 扬声器 | audible_response_ms（项目指标） | 同一采集时钟上，人工/固定方法标注的最后输入语音至实际扬声器有效音频起点；需要设备回录 |
| 打断 | cancel_to_clear_ms（项目指标） | 取消请求至生产者退出且音源清空；实际设备停播另外测。不是官方 adaptive InterruptionMetrics |
| 资源 | active jobs、拒绝/超时/429、CPU/RSS/FD、队列峰值、费用 | 并发、配额、总请求分母、异常与取消分开；队列有界不代表无丢帧 |

官方流式近似 EOU + LLM TTFT + TTS TTFB 不直接适用于当前整句路径。使用单次 turn 单调时钟/trace 的实际关键路径，标注队列/网络/输出等待；不能把不同轮次的各阶段 P95 相加当端到端 P95，也不能跨机器直接减未同步时间戳。

### W3C 传输指标

按同一 stats id/SSRC 的两个窗口计算，保存采样间隔：

- 平均 jitter buffer ms = `1000 × ΔjitterBufferDelay / ΔjitterBufferEmittedCount`，分母为 0、计数重置或 SSRC 变更记缺测。
- concealment ratio = `ΔconcealedSamples / ΔtotalSamplesReceived`；分母包含掩蔽样本，不是只数正常帧。
- `jitter`、candidate-pair `currentRoundTripTime` 从秒转毫秒；RTT 是连接往返，不是单向嘴到耳。
- 丢包采用同方向 inbound RTP 窗口：`ΔpacketsLost / (ΔpacketsReceived + ΔpacketsLost)`，注明重传/重复包影响。packetsLost 可为负；负增量、分母为零、reset 单独标注无效，不偷偷 clamp 为“零丢包”。

`voice_benchmark.counter_ratio` 提供同流增量工具；浏览器/硬件 getStats 采集还需接线，本轮不声称已经采集上述 RTC 指标。

## 4. 质量和场景测试矩阵

| 层 | 必测内容 | 工程结果不能外推为 |
| --- | --- | --- |
| L0 无网络回归 | 消息/capture归属、跨房间隔离、取消不回灌、上下文提交、超时/溢出、回收 | 真实 provider 延迟、CER、真机AEC |
| L1 授权离线音频 | 固定 reference 的 corpus CER/WER，空白幻觉；原始 ASR 与纠错后分别评分，意图保持/错误改写/恢复率 | 构音障碍人群效果、RTC可靠性 |
| L2 实际 RTC | 单房间连续10句→既有容量基线；阶段耗时、首帧、丢包/掩蔽、失败、取消/重连/资源 | 实际扬声器延迟、全双工AEC、通用人群能力 |
| L3 设备声学 | 近端单讲/远端单讲/双讲、不同音量距离噪声；残余回声、近端语音损伤、误打断、真实停播 | 仅凭服务端开关证明AEC；半双工不等于AEC |
| L4 真实任务/Agent | 意图保留、陌生人理解/任务成功、确认/拒绝/恢复、工具参数和权限、会话隔离 | 仅凭 LLM judge 分数证明产品有效 |

CER 使用 corpus `Σ编辑错误 / Σ参考字符`（不是句级 CER 均值），可超过 1，不写成有界“1-CER准确率”。当前离线小工具使用 NFC codepoint、保留所有标点/空白/大小写；中文口语的标点/数字归一化必须另冻版本并同时保留严格结果，不随结果改规则。空参考独立报告空白幻觉率/插入数；ASR API 失败必须另记 outcome，不能丢弃后只算成功样本。WER 可用 NIST SCTK/JiWER，固定工具与分词版本。CER 不等于意图理解，最终仍以用户想表达的意思为准。

数据必须有授权与许可、内容哈希、模型/配置、speaker-disjoint 划分；按语言、构音特征、设备、噪声、冷/热、并发分层。真实转写/音频/账号/token 不进公共结果。未知 `020.wav` 不作为评测材料；不把录音区训练准入改成新的人工审核流程。

AEC 优先端侧带真实播放参考，比较 bypass/NS/AEC 及半双工安全路径；报告信号同步、延迟、double-talk 的近端语音损伤、词/意图保持、主观听感。可按主办方协议选择 AECMOS/MOS/词准确率，注明模型/许可；不能用半双工静音或 ERLE 单指标冒充全双工可用。

### 外部 Benchmark 的取舍

- LiveKit 官方 Agent tests：使用消息、工具、参数、错误恢复断言的工程方法；LLM judge 可选且非确定性。当前自定义运行时先复用现有 unittest，不增加平行 AgentSession 来“跑分”。
- VoiceBench：用于语音 vs 文本对照、理解/指令/安全；以自有中文纠错任务为主，不把应用忠实纠错而不回答百科问题算能力失败。尚未执行。
- 当前 Sierra 仓库含 τ³ / τ-Voice：实时双工、噪声/口音/打断和事务任务可参考，但本应用缺对应银行等工具。其 Python 3.12+ 与现役3.10隔离，需 provider/ElevenLabs 许可与预算，8kHz G.711 telephony 与当前16kHz PCM/Opus不可直接横比；需固定 adapter/版本。尚未执行，不宣称排行榜成绩。

## 5. 运行与验收契约

输入 schema 与指标 catalog 在 rules，唯一离线入口：

```bash
python3 scripts/research/voice_benchmark.py --check-registered
python3 scripts/research/voice_benchmark.py --input research/voice-agent/RO-014-benchmark-local-2026-09-10.json
python3 -m unittest discover -s scripts/research/tests -v
# 只读本地授权的 reference/hypothesis JSON 数组，输出无原文的聚合 CER：
python3 scripts/research/voice_benchmark.py --cer-pairs /restricted/authorized-pairs.json
```

报告要有五阶段记录、baseline/evidence/限制、下一动作/owner/日期；run 固定代码版本（脏树需变更哈希）、配置/数据/协议 SHA-256、模型、场景、人群、设备、seed、并发、冷/热。每行唯一脱敏 ID、completed/failed/cancelled 和指标。输出 n、总数、失败/取消/缺测、P50/P95/P99（nearest-rank），小样本尾部仅描述、不作 SLA。每指标缺测/失败不进入成功百分位但保留分母；已测超阈值优先 fail，缺覆盖不能 pass，未设阈值 not_evaluated。

退出码：0=结构有效（可能全未测），1=存在 failed 样本或已测保护指标超限，2=输入非法；**不得只凭退出码 0 发布**。输出 acceptance 恒为 manual_review_required。登记报告通过既有 RO evidence 的 `benchmark_runs` 引用，由研究检查自动校验。不执行文件内“命令”，不自动写反馈/切模型/部署。

真实 RTC 仍只使用 `livekit_agent/scripts/benchmark_full_rtc_concurrency.py`，显式提供经授权账号/fixture、`--allow-live-provider-calls`，默认单房间。它会发凭证、创建/删除自己的临时房间并实际调用 provider，需事前确认；本轮未执行。探针结果为 `voxflame-rtc-probe-v2`，旧计时字段直接退出，不提供错误口径兼容。输入 PCM 结束不是声学语音结束，首帧不是首响；它不直接产出完整 benchmark-v1 验收包，须补版本/数据授权/阶段trace后再登记，严禁将整个录音到转写时长映射为 asr_request_ms。

baseline/candidate 使用同一组录音/语句/设备/协议/负载，模型或算法为明确唯一实验变量，保留所有失败；不同人群/采样率/端点定义不能混成提升比例。改协议要同时重跑基线。持续回归按：PR 运行 L0 与报告守卫；发布前授权跑 L1/L2；新设备/人群补 L3/L4；回归失败→原 FB 继续 validating → 定位→实现/优化→重测。没有真实覆盖时保持待验证，而不是关闭需求。
