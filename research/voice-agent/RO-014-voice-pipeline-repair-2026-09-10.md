# RO-014：语音积压与取消修复（2026-09-10）

状态：`validating / internal_only`。本轮已获本地修复授权，未部署、未开放端口、未改模型、未请求真实用户音频。与 [只读诊断基线](../product-engineering/LIVE_VOICE_PIPELINE_DIAGNOSTIC_2026-09-10.md) 区分：基线描述修复前容器，不是当前工作树。

## 入口盘点与最小计划

- 入口：现有 LiveKit RTC 麦克风/Data，`app.py`；不加小智 WebSocket 平行主链。
- 服务：`asr_runtime.py`、`assistant_runtime.py`、`tts_runtime.py`；Backend dispatch 继续独占账号模型路由授权。未让客户端选择任意账户/模型。
- 存储：PCM、进行中的请求、纠错历史均为房间内状态；不修改数据库、OSS 或 durable memory owner。
- 旁路：训练最终转写保留 capture ID；训练默认不经 LLM，不开启自动 TTS；已发布文本才计入纠错历史。Web 确认后本机朗读不归 Agent TTS 控制。
- 删除对象：TTS Python 无界待播队列/消费者、旧回复 FIFO/worker、同步 urllib+线程 LLM 调用、共享 fallback_active 状态、无调用的 TTS clear/finish 方法、从未驱动处理的 VAD hop 配置。只保留一种异步 LLM 返回协议，测试替身也不走同步/字符串兼容分支。
- 保留对象：现役无个性化账户的 realtime ASR，以及 HTTP 故障的逐请求 realtime fallback，是当前 provider 路由而不是过时主链；环境模型别名不触发第二次推理，未借本轮破坏现有部署配置。
- 计划顺序：复现 → TTS 单一生产者/有界输出 → 可取消 LLM/单轮回复 owner → 非阻塞 HTTP ASR/不可变录音归属 → 半双工保护 → 竞态/入口回归 → 文档闭环。

## 官方资料与底层机制

本次网页工具打开 LiveKit turns 文档未返回可用内容；改用 Context7 官方仓库索引及**本地安装版本源码**。未声称网页已经读到，未升级依赖。Context7 的 main 示例只能说明当前示例约定，具体调用以安装的 Agents 1.7.1 / RTC 1.1.15 为准。

| 一手来源 | 实际核验与工程含义 | 不支持的外推 |
| --- | --- | --- |
| LiveKit 官方 `agents/examples/voice_agents/push_to_talk.py`（Context7 `/livekit/agents`） | 手动开始时 interrupt + clear_user_turn + 启用输入；结束时关输入再 commit。采集、推理、播放是不同生命周期，取消不是只静音扬声器 | 不证明现有小智固件已实现这些动作 |
| Agents 1.7.1 `voice/generation.py` 658–667 | 先 cancel_and_wait 转发任务，再 clear_buffer，并将部分播放与整段完成区分 | 不证明网络或设备端已送达音频能够撤回 |
| RTC 1.1.15 `audio_source.py` capture_frame / clear_queue / wait_for_playout | capture 有背压；clear 清的是源端队列。不能在其外叠一个无界 Python PCM 队列 | 服务端 playout 完成不是设备播放完成 ACK |
| RTC 1.1.15 `audio_stream.py` / `_utils.RingQueue` | capacity=0 无界；有限容量满时丢最旧帧，不提供逐帧丢失通知 | 单设 capacity 不能声称音频无丢失 |
| RTC 1.1.15 `apm.py` | process_stream 与 reverse_stream 都要求 10ms；AEC 需要远端播放参考和 stream delay，对齐采集/播放时序 | 只有 `echo_cancellation=True` 不等于有效 AEC；NS/VAD 也不能代替 AEC |

来源定位：
- https://github.com/livekit/agents/blob/main/agents/examples/voice_agents/push_to_talk.py
- https://docs.livekit.io/reference/python/livekit/rtc/audio_source.html
- https://docs.livekit.io/reference/python/livekit/rtc/apm.html
- 本地版本文件位于 `livekit_agent/.venv/lib/python3.10/site-packages/livekit/`。上述三个关键文件 SHA-256（generation / audio_source / apm）：
  - `ae90bcbcae05a061a471f2fea3caa558adf8f7b75014b0bf611cd2db0902f46d`
  - `1811c7104468563eccc5a37d836abad6f43ef917988f41f170fd535a8379d44e`
  - `0f1366fabe0cf0de93e223309f49720b1bf0356c72bc4dcf36dbf048f5813a81`

未直接把现役应用改成标准 AgentSession：当前应用执行个性化分句 HTTP ASR、最小文本纠错、训练 capture 绑定而非通用聊天。搬迁整个会话框架不是修复取消竞态的必要条件。此次沿用官方生命周期原则修复现役路径，不另开兼容框架。

## 本地实现及资源边界

1. **TTS**：PCM delta 分成最多 20ms 片段，直接 await SDK capture；AudioSource 从 4000ms 改为 200ms，WebSocket max_queue=4/max_size=512KiB。没有额外 Python PCM FIFO。speaking 覆盖等位、连接、生成与源端播放；取消只请求一次，等生产者退出后清音频源。总 deadline 覆盖请求与播放，取消后的 socket 清理另有最多 2 秒等待。
2. **LLM 取消**：取消的是旧一轮的异步 HTTP 请求及后续输出任务，**不是删除 Qwen、关闭模型服务或让系统不再用 LLM**。一个房间只有一个执行中的回复和一个最新待执行轮次；新文本或明确录音开始取消旧轮次，必须等清理完再开始最新轮次。有效 VAD barge-in 也取消整个回复，不仅 TTS。无法保证第三方服务器在客户端断开后立即停止内部 GPU 推理，但本地不会继续接收/发布旧结果。
3. **回复历史**：LLM 使用可复用 httpx AsyncClient，硬 deadline 包括槽位等待；仅在当前文本成功发布后 accept_reply。被取消或未发布的结果不写入纠错历史，不伪装成已经播放完的内容。
4. **HTTP ASR**：commit 无等待地分离 PCM 与不可变 capture（ID/轮次/短句标记/有效人声时长），至多两个录音识别任务；收音不等待 HTTP final。每段最大 120 秒 PCM，超限/超载带 capture ID 明确报错，不静默转成下一句。错误后的 realtime fallback 独占本段 socket/final/超时/清理；训练结果乱序仍绑定原句，沟通过时 final 不触发旧回复。HTTP 路径移除会误伤“喝水”等词的旧短尾时间窗抑制，低时长不再直接丢整段 HTTP 录音。
5. **输入与 VAD**：RTC 设置 20ms/50 帧容量；APM 仍按 10ms 做 NS/高通，未调高 RMS 阈值。打断累计只计超过阈值的帧，不把静音宽限时间算成人声；同一显式录音中的停顿后续语音继续累计。当前仍是 RMS VAD，不声称语义端点或构音障碍识别精度已提升。
6. **退出**：入口注册 shutdown callback，取消控制任务、停止 ASR/回复，然后关闭 HTTP/TTS/音频源。绑定成员断开时结束 Job。Data 控制任务有容量限制，发布有 1 秒超时；对明显过载记录拒绝，不创建无限后台任务。

HTTP 阶段 5 秒、fallback 阶段同样可再等待 5 秒（以部署配置为准），不是二者合计 5 秒；有限失败兜底有成本，但不串行阻塞收音。公共 realtime ASR 仍有自身网络发送/提交等待，尚未实测硬件该路径延迟。原始录音上传独立于 ASR，ASR 失败不删除语料。

## AEC 与半双工边界

- **已知 E**：AEC 要有实际播放参考及与回录对应的延迟；端侧最接近扬声器/麦克风时钟。无专用 AEC 芯片不一定不能做软件 AEC，但必须核对板卡、音频驱动、算力和参考通路。
- **已实现**：部署级 `VOXFLAME_AUDIO_DUPLEX_MODE=half` 默认在 Agent 播报期间丢弃识别输入并清理 VAD/未提交缓存，结束后 `VOXFLAME_AUDIO_PLAYOUT_TAIL_SECONDS=0.3` 保护。值验证范围 0–2 秒；`full` 仅用于已验证端侧 AEC 的设备组，不允许客户端 metadata 自报切换。服务端 AEC 在没有 reverse reference 时显式拒绝启动，不静默假装打开。
- **未知/H**：300ms 不是该设备的测量值，不能保证吞掉任意网络/设备播放尾音；硬件应在真实扬声器播放期间停止上行、清空取消轮次的本地播放缓冲，或提供完整有效 AEC。当前没有固件，未实现设备 ACK，也未声称端侧停传已完成。
- **取舍**：半双工期间无法仅靠声音打断，避免把扬声器回声误当用户；显式按钮/录音开始可取消旧轮次，但残余尾音保护期间可能吃掉开头，必须在真机 UI/固件上完成先停播、清缓冲、再收音。
- **不能外推**：Web 本机 speechSynthesis 不经过 Agent TTS，所以本轮半双工状态无法覆盖它；浏览器 AEC 有效性仍要真实设备验证。

## 验证与停止条件

- 基线：原 90 项测试通过；旧 TTS 隔离复现清源后仍回灌 2 帧。新增 TTS 三项回归在旧代码失败、修复后通过。
- 现有自动验证：118 项 Agent 测试通过（Python 3.10.12），其中新测试覆盖服务商正常断连立即报错、取消中清理/重复取消/播放末尾/迟到 PCM/总超时/下一句/释放源、HTTP 乱序/过载/超长/短句/停机取消/fallback 隔离、收音不等待推理、VAD/半双工、httpx 取消与槽位释放、history 发布门、真实入口函数的文本替换和所有 owner 关闭。全部为合成 fixture/mock，无外部 provider 推理。
- 可复跑：`livekit_agent/.venv/bin/python -m unittest discover -s livekit_agent/tests -v`；`livekit_agent/.venv/bin/python -m compileall -q livekit_agent/*.py`；文档与 Research Harness 检查按根入口执行。运行日志在本地 `output/voice-fixes-20260910/`，不是生产验收证据。
- 尚未验证：真实 RTC 传输/端侧播放尾音、设备 AEC/双讲、当前用户 CER、真实 8 路并发回归。有限 RingQueue 在消费者阻塞超过容量时仍可能丢帧，SDK 无逐帧通知；不能把“有界”写成“无损”。需测音频计数/丢包/设备时间戳，缺证据不得用作训练质量保证。
- 停止条件：任何旧音回灌、capture 串句、跨账户结果、未授权模型选择、资源无法回收、轻声/长停顿明显退化、过载/丢帧未告知真实录音流程时停止试点。性能门槛复用 RO-014/HARNESS_RULES，不因单测通过扩大并发。
- 发布/回退：本轮未部署。先用非敏感合成音频单房间验收，再经确认最小影响发布 Agent；保存发布前镜像，异常回退该镜像，不切回另一套兼容运行时，不执行 compose down。真机与独立复核完成前保持 internal_only。

最终静态验证：Python compileall、`check_ai_docs.sh`、`check_research_system.sh`、`check_research_harness.py`、`validate-research-loop.py`、`git diff --check` 均通过。未执行部署、生产重启、采购或 Git 提交/推送。
