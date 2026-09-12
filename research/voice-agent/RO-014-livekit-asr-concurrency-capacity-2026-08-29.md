# RO-014 LiveKit/ASR/Agent 实时并发容量与隔离

## 问题定义

“一路”是一个同时存在的实时语音会话：一个房间、一个 Agent Job、一条音频流及其 ASR/TTS/LLM 请求；注册用户数不等于并发路数。当前一个 Agent Worker 按房间创建独立进程，单路还持有 VAD、队列和 session context，因此单实例是首要风险。

## 权威机制证据与对照

LiveKit Agents 官方文档说明 Job 使用隔离进程；默认按 5 秒 CPU 负载和 0.7 threshold 接受新 Job，可用自定义 load function 按 active jobs 控制。LiveKit 自托管文档指出单 SFU 房间约 3,000 用户是房间级参考，不等于 3,000 路 AI 会话。LiveKit CLI `lk load-test` 可模拟音频发布者，但只测媒体包/丢包，不测 ASR 语义、外部配额或端到端首字节。

跨模态对照：文本 Agent 常受请求并发、token 和工具限额约束；语音 Agent 还增加连续音频、端点/打断、抖动、TURN relay、ASR/TTS 长连接和隐私边界，不能把文本 QPS 或 SFU 房间上限直接外推为语音路数。

## 当前工程事实

已配置 `load_threshold=0.7`、2 个 idle processes、单 Job 450 MiB 告警/700 MiB 限制。2026-09-04 新增 active jobs/CPU/内存联合派单负载；在 4/8/16 路分层实测后，2 GiB Agent 容器的默认 active jobs 已分两步从 2 提升到 4，再提升到 8。个性化 HTTP ASR 为 4 个跨 Job 主槽位，DashScope realtime fallback 使用独立的 4 槽池；生产 `qwen-flash` 的 8 路直接请求验证通过后 LLM 提升到 8 槽；TTS 因第 4 路直连已出现 Provider 限流，只提升到 3 槽并允许最多 3 秒短队列。官方 SDK reserved slots 会纳入有效负载，避免派单窗口超收，但不能代替 provider 配额控制。

`QWEN_HTTP_ASR_URL=http://127.0.0.1:8001/transcribe` 已由 GPU1 主动建立的 SSH 反向隧道恢复；三名注册用户与公共 fallback 的模型路由已通过真实 WAV 审计，旧 8000/18000 入口不再监听。8001 仍是单隧道、单 GPU 服务，实际 ASR 并发容量、高可用、集群 provider 配额、TURN/TLS 和带宽仍需验证。低风险 HTTP 健康压测不能证明 RTC 容量。

## 2026-09-04 两路生产低风险验证

本轮直接把现有真实训练房间作为第 1 路，从第 2 路开始验证，没有重复制造第 1 路。第 2 路使用独立 `voxload2_*` 房间、合成身份和合成音频，不写训练数据，也不使用真实账户的个性化模型。

- 两个房间均出现独立 Agent Job 和 Agent participant；真实第 1 路在测试期间持续返回 8001 ASR 结果，第 2 路也完成音频发布、转写和数据回传。
- 两路活动时 Agent 容器单点观测为 `18.32% CPU / 593.8 MiB / 2 GiB / 64 PIDs`，LiveKit Server 为 `1.30% CPU / 93.3 MiB / 512 MiB`。
- 第 2 路退出后 Agent 回落到 `518 MiB / 30 PIDs`；Agent 与 LiveKit Server 均 `restart=0`、`OOMKilled=false`，日志未出现 provider capacity exhausted。
- 该结果证明当前安全配置下 2 个同时 RTC 房间、2 个 Agent Job 和两路 ASR 工作流可运行；第 2 路为训练模式，没有同时压满 LLM/TTS，也没有证明两个 8001 推理请求严格重叠，因此不能据此外推第 3 路、完整沟通链路上限或 1,000 路容量。

## 2026-09-04 单机 4/8/16 路分层验证

为避免重启或争抢生产 `voxflame-agent`，本轮启动独立临时 Worker `voxflame-capacity-probe`，使用独立 Agent 名称、3 GiB 容器内存、16 Job 临时上限和 0.95 负载阈值；测试完成后已停止并删除，生产 compose、生产 Worker 配置和真实房间均未修改。

### RTC/Agent 静默常驻

测试客户端发布静音音轨但不提交 ASR/LLM/TTS，用于单独验证房间、媒体连接和 Job 进程常驻成本。

- 4 路同时突发建立时只派出 2 个 Job，另 2 个因瞬时 CPU 负载被判定 `no worker available`；改为逐路等待 Agent 就绪后再启动下一路，4/4 路全部成功。4 路稳态约 `504.7 MiB / 4.61% CPU / 79 PIDs`。
- 8 路错峰启动 8/8 成功；观测约 `647.2 MiB / 105.21% CPU / 174 PIDs`。该 CPU 数包含同容器运行的 8 个合成客户端，不能直接视为纯 Worker CPU。
- 16 路错峰目标中前 12 路成功，第 13—16 路均未获得 Job；临界点约 `744.2 MiB / 155.58% CPU / 250 PIDs`，主机仍有约 3.4 GiB available memory，swap 未增长，Worker 无 OOM/重启。拒绝来自 CPU/系统负载准入，不是内存耗尽。
- 因此，这台 4 vCPU/7.3 GiB 主机已经证明单隔离 Worker 可保持 8 路静默 Job，12 路属于本轮观测到的静默临界值；16 路静默尚未通过，更不能把静默常驻等同于 16 路同时推理。

### 8001 ASR 并发探针

真实生产自然出现两个训练房间时，额外并发发送 2 个同一 EXP-25 adapter 的 5.55 秒 WAV 请求。两次均 HTTP 成功并返回正确账户/模型，但端到端分别耗时约 `18.192 秒` 与 `25.204 秒`。该延迟远高于本研究 ASR P95 2 秒停止线，因此按规则停止 4/8/16 路 ASR 加压。

当前结论是：内存不是最先触线项；4 核 CPU 的 Job 冷启动/准入限制静默房间扩展，而单 GPU 8001 的排队或有效批处理吞吐是实时并发的首要瓶颈。必须先在 GPU1 核对全局推理锁、动态 batching、worker 数、adapter cache 和 GPU 利用率，再重新做 1→2→4→8→16 路严格重叠推理测试。TTS/LLM 16 路仍未验证。

### 新多账户服务切换后的严格并发复测

GPU1 切换到预热三账户、adapter cache 64、4 GiB 权重预算、队列 128、greedy 最大 batch 8 的新服务后，从 CPU1 经真实 `127.0.0.1:8001` 反向隧道重新压测。所有请求均 HTTP 200，三个个性化模型和未知账户 fallback 路由 100% 正确；但“能完成 16 路”仍不等于“16 路实时”。

- 固定 EXP-25、5.55 秒 WAV：4 路 P95 `1.650s`，8 路 P95 `4.010s`，16 路 P95 `18.089s`。
- 固定 EXP-29 greedy、5.55 秒 WAV：4/8/16 路 P95 分别约 `5.146s / 12.891s / 14.437s`；该轮没有复现 GPU1 本机 benchmark 所称的亚秒完成。
- 四种路由混合 16 路：16/16 成功、路由 16/16 正确，但 P95 `7.602s`。
- 固定 EXP-25、1 秒音频：4/8/16 路 P95 分别 `0.960s / 1.629s / 3.446s`。
- 固定 EXP-25、2 秒音频：4/8/16 路 P95 分别 `3.537s / 7.368s / 9.779s`；冷却后重复 4 路三次，P95 在 `1.393s–3.454s` 间波动。
- 健康口本身约 `0.20–0.21s`，因此慢点不只是隧道断连；服务 health 中累计 average batch size 仅约 `1.32`，当前真实路由/音频形态没有持续形成有效 batch 8。

据此保留 16 路平台目标，但不把单 GPU 个性化 ASR 主槽直接设为 16。生产第一阶段配置为：单 Worker 最多 8 个 active jobs，个性化 ASR 4 槽，独立 DashScope realtime fallback 4 槽，HTTP 个性化请求 5 秒超时后降级；LLM 8 槽；TTS 3 槽、3 秒短等待。代码同时修复了主 ASR 与 fallback 共用同一文件锁池、主槽耗尽后 fallback 也被拒绝的问题。

部署只替换 `livekit-agent`：新容器 healthy、restart 0、OOM false，LiveKit Agents 仍为 `1.7.1`；89 项测试通过。新增可重复完整链路探针 `livekit_agent/scripts/benchmark_full_rtc_concurrency.py`，为测试会话显式启用语音回复，创建独立房间并发布真实中文 PCM，分别确认 ASR 最终文本、LLM assistant 文本和订阅到的 TTS 音轨；测试结束显式取消发布麦克风、关闭音频源、断开并删除房间，测试身份和音频不进入训练链路。

### 8 路完整 RTC + ASR + LLM + TTS 复测

- Provider 单项基线：生产 `qwen-flash` 8 路请求 `8/8` 成功、P95 约 `743ms`，无 429/5xx；生产 `qwen3-tts-flash-realtime` 直接并发 3 路连续三轮 `9/9` 成功，第 4 路开始出现明确 `Requests rate limit exceeded`。因此 LLM 槽设为 8，TTS 槽保持 3，不能把 TTS 配额臆测成 8。
- 最坏场景（8 房间连接错峰 500ms、8 路同时开口）：完整链路 `8/8` 成功，4 路 EXP-25 个性化 ASR、4 路独立 realtime fallback；从停止说话到 TTS 首包 P95 约 `2.82s`。Agent 采样峰值约 `175.37% CPU / 762.8 MiB / 2 GiB`，无 OOM、重启、Provider 429 或 5xx。
- 现实错峰场景（每路开口间隔 300ms）：完整链路重复 `8/8` 成功，最终一轮 8 路全部命中 `3083029019 -> EXP-25`；停止说话后 ASR P95 `1.2736s`、assistant P95 `1.7351s`、TTS 首包 P95 `1.8709s`。房间全部删除，Agent 保持 healthy、restart 0、OOM false。
- 结论：当前单 Worker 已证明“8 路同时在线且 8 路完整 AI 会话可完成”，不再只是静默房间或 ASR 单项；但严格的 TTS 首包 P95 `1.5s` 体验门仍未达到，不能宣称 8 路低延迟 SLA 已完成。要把同时开口 P95 压到 1.5 秒，仍需提高 DashScope TTS 并发配额并继续优化 8001 延迟，而不是继续放大本地 TTS 槽位。

本轮直接回滚镜像为 `voxflame-agent-livekit-agent:pre-llm8-tts3-20260904`；更早的 `pre-jobs8-20260904` 仍保留。

当前 16 路落地路径是至少两个 8 路 Agent Worker，并继续把 GPU1 的 16 路 P95 压到实时门槛；LLM 已有 8 路证据，但 TTS 稳定直连仍约 3 路，且多 Worker 尚无集中 provider 配额，因此不能把本轮配置表述为 16 路完整 AI 会话已完成。

版本专项对照结论：LiveKit Agents `1.7.1` 相比仓库原 `1.5.1` 包含扩容相关的进程内存统计修正、Worker 连接失败退出、drain/指标增强；LiveKit Server `1.13.6` 相比原 `1.10.1` 包含 Agent 连接关闭死锁修复、节点统计、负载修正及 TURN 配额/安全变化。仓库升级到这两个精确版本，但生产 Server 升级必须验证 1.12/1.13 引入的 TURN TTL 与受限网段权限变化。

## 分阶段实验与扩展

1. **基线**：固定 5→10→20→50 路音频样本、测试账号和版本；同时采集 active jobs、Job 启动耗时、ASR/TTS/LLM P95/P99、429/5xx/timeout、丢包、CPU/RAM/FD。
2. **隔离**：单机 Provider 槽位已实现；下一步以 Redis/集中配额控制多 Agent 服务器总配额，恢复 8001 新账户网关至少两个实例，并故障注入验证第二 Worker 接管。
3. **扩展门**：仅当 50 路保护指标达标且第二 Worker、外部配额和 TURN 带宽通过，才做 100→200 路；1000 路必须拆分 Worker/ASR、增加可观测性并重新压测，不能由当前单机推算。

## 停止与回退

任一阶段出现 OOM、Job 拒绝率 >1%、ASR P95 超过 2 秒、TTS 首包 P95 超过 1.5 秒、丢包 >1% 或 provider 429 持续 5 分钟即停止加压，回退 load/memory 配置并保持小流量。
