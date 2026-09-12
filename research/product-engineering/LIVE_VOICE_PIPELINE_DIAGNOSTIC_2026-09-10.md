# 现役语音链路只读诊断（2026-09-10）

状态：diagnostic-only。用户要求解释 CPU1/GPU1 当前降噪、VAD、ASR、LLM、TTS 与硬件积压边界；不是发布或改造授权。

## 证据范围

- 从正在运行的 `livekit-agent` 容器调用 `load_config()`，只输出模型、音频与容量字段，未输出密钥。
- 容器 `app.py`、`asr_runtime.py`、`assistant_runtime.py` 与仓库 SHA-256 相同。`config.py`、`tts_runtime.py` 有未部署差异，本报告以容器源码和生效配置为准。
- CPU1 `127.0.0.1:8001/health`、`/accounts` 只读检查正常；308 默认为 `exp39-3083029019-r392-step500-beam5-rank0`，EXP-25 仍可用。未发送推理音频，未进入 GPU1 主机，因此不推定 GPU 内部预处理流程。
- 当前未取得成员的小智固件、自建服务配置、实际请求地址、设备播放缓存和脱敏请求日志。不能把本报告当作该硬件故障的已确认根因。

## 实际流程

```text
客户端麦克风
  -> 客户端音频处理（Web 请求 AEC/NS/AGC；硬件独立核验）
  -> LiveKit RTC 麦克风轨道
  -> CPU1 Agent 接收 PCM / 重采样为 16 kHz 单声道
  -> WebRTC APM：降噪 + 高通；服务端 AEC/AGC 关闭
  -> RMS 能量 VAD 或客户端显式录音停止
  -> 一段 WAV，经 HTTP /transcribe + SSH 隧道到 GPU1
  -> 原始 ASR 文本与路由元数据
  -> 沟通模式：文本队列 -> qwen-flash 最小纠错 -> 最终文本
  -> 若允许自动语音：qwen3-tts-flash-realtime -> PCM 音频块
  -> Agent 音频缓存 -> LiveKit 下行轨道 -> 客户端播放
```

LiveKit Server 承接传输；APM、VAD、模型调用和队列位于 Agent。不能把开放 Server 端口等同于完整应用会话授权，也不能把接入 LiveKit 等同于获得有效 AEC。

### 采集、APM、VAD

- Web 源码通过 `buildMicrophoneConstraints()` 请求单声道、AEC、NS、AGC；实际设备是否执行需用媒体设置与实录验证，不能套用于小智硬件。
- 服务端 APM 按 10 ms 块处理：`enabled=true`、`noise_suppression=true`、`high_pass_filter=true`、`echo_cancellation=false`、`auto_gain_control=false`。创建或处理失败时会回退原始输入。当前链路未向 APM 提供 `process_reverse_stream()` 播放参考；安装的 SDK 文档明确其用于回声消除远端参考。
- VAD 是 `RMSVoiceActivityDetector`，不是 Silero/语义端点检测。阈值 `0.032`，低于阈值持续 `860ms` 后自动提交；录音客户端已发送 capture 控制事件时，优先等显式停止，避免双重提交。
- `360ms` 为当前打断累计时间门槛，但实现按 VAD 的 SPEAKING 状态累计帧时长，包含静音宽限帧，不能称为已确认连续人声 360ms。`420ms` 用于部分手动停止/短噪声过滤，不是所有自动提交的统一下限。
- `vad_hop_size_ms=16` 虽有配置字段，当前运行时代码没有消费它；不能说 VAD 必然每 16ms 判一次。

### ASR 与账户

- 登录身份经 Backend 生成 `asr_account_id`，进入可信 Agent dispatch；Agent 不信任客户端自行上报账户。
- 个性化路径将收集的 PCM 封装 16-bit、16kHz、单声道 WAV，以 multipart `audio`、`language=Chinese`、`X-Account-ID` 请求 GPU 网关。是分句 HTTP 推理，不是 GPU token/音频流式 ASR。
- 当前 Agent 不发送 `X-Model-Version`，使用账户注册表默认模型；“固定某账户的指定版本”仍需可信授权字段及端到端适配。
- HTTP ASR 超时参数 5 秒，容量为 4 槽、等位 0.25 秒；失败后可送同段音频到 `qwen3-asr-flash-realtime-2026-02-10`。公共模型 fallback 与 HTTP 故障后的阿里云 fallback 是不同路径。

### LLM 与 TTS

- 生效纠错/LLM 型号均是 `qwen-flash`，未发现 Qwen 32B 的显式运行配置。若成员实际调用 Qwen 32B，那是另一段待核验链路；不从别名推测参数规模。
- 当前 LLM 用途是恢复用户原意、最小纠错，不是小智自由聊天回答。请求读取完整 JSON 后返回文本，再调用 TTS；未实现 LLM token 边生成边喂 TTS。
- `max_tokens=32`、`temperature=0.1`；HTTP 超时参数 15 秒。`reply_timeout=5.5s` 只被用作日志软目标，不是强制中断时限。
- 自动语音开启时，TTS 是 `qwen3-tts-flash-realtime`、`Cherry`、16kHz PCM；整段文本提交后接收音频 delta 流。容量为 3 槽、等位 3 秒；收到请求完成信号的等待超时为 20 秒，不等于含等位/连接/播放的总耗时上限。
- **模式例外**：`communication_workspace`、`training_workspace` 与 training 模式默认禁用 Agent 自动 TTS，字幕模式也禁用。Web 沟通页的确认后朗读使用浏览器 `speechSynthesis`。training 模式直接展示 ASR，不走 LLM 纠错；不能把所有页面都画成必经 LLM+云端 TTS。

## 积压风险与验证程度

1. **输入消费等待 ASR**：自动 VAD 停句在音频消费协程内 `await commit_audio()`，HTTP 推理期间不能继续消费同一输入流。调用 `AudioStream.from_participant()` 未指定 capacity；已检查容器 SDK，默认 `0` 为无界队列。因此存在旧输入帧积压的实现路径，尚无该成员会话实测。
2. **回复排队**：每房间最多 8 个待处理文本，一个 worker 顺序等待 LLM 和整轮 `speak()`。新语音触发打断只调用 TTS interrupt，不取消正在生成的 LLM、不清理 pending 文本队列；队列满才丢最旧项。
3. **输出缓存与不完整打断**：Python TTS `audio_queue` 无 maxsize，LiveKit `AudioSource` 配置 4000ms 缓存。这是缓存容量，不是每次固定增加四秒延迟。interrupt 清了 AudioSource，却未排空 Python 音频队列；消费者仍可能将旧音频重新塞回。
   - 隔离复现：使用容器现役 `LiveKitAudioReplyRuntime` 方法，mock 音频源与 TTS client，预先放入两帧 PCM，调用 interrupt 后消费队列；观察 `source_queue_cleared=1`、`pending_after_interrupt=2`、`stale_frames_recaptured_after_interrupt=2`。
   - 无真实房间、无用户音频、无网络请求。证明代码行为，不证明成员当前一定经过此路径。
4. **回声反馈假设**：若设备无有效 AEC 又在播报时持续上行，扬声器可能触发能量 VAD 和再次识别，继续生成回复。需要关扬声器/耳机/显式半双工 A/B，不能只凭“没有 AEC”定根因，也不能只调高阈值而损失轻声/非典型语音。

## 运行观察与后续门槛

- 24 小时最多 25,000 行尾部日志样本中有训练会话与 HTTP ASR fallback 警告，但没有可用于本次硬件诊断的 LLM/TTS 闭环样本；不能据此归因于硬件或估算其实际延迟。检查瞬时 GPU 队列为 0，也不证明高峰无积压。
- 下一步先取得设备实际接入方式、脱敏 URL/房间模式及每轮 trace：采集起止、ASR 提交/完成、模型版本/fallback、LLM 起止、TTS 首包/结束、设备播放完毕、队列毫秒数与轮次 ID。
- 对无 AEC 设备先单设备半双工验证：录音时不播放，播放时不上传，取消轮次不回灌旧音频；先固定一个授权账户与模型，不扩大并发。再按证据拆输入消费/推理并发、实现贯穿 LLM/TTS/播放的轮次取消与有界缓存。
- 本轮未修改运行时代码、未重启/部署、未开放端口、未发放凭证。仅更新诊断记录，不需生产回滚。

## 代码入口

- `frontend/src/lib/audio/microphone-preferences.ts`、`frontend/src/lib/realtime-audio/session-audio.ts`、`session-actions.ts`。
- `frontend/src/components/chat/ChatInterface.tsx`：确认后本机朗读。
- `backend/src/services/livekit-session.service.ts`：房间凭证与可信 dispatch。
- `livekit_agent/asr_runtime.py`：RMS VAD、APM、输入流、HTTP ASR 与 fallback。
- `livekit_agent/assistant_runtime.py`：纠错提示与非流式完整响应。
- `livekit_agent/app.py`：回复队列、模式分支和打断调用。
- `livekit_agent/tts_runtime.py`：输出队列和清理边界（诊断以容器版本为准）。
- `livekit_agent/session_userdata.py`：自动语音开关。
