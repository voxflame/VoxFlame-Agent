# 语音采集、扩容与控制面统一执行手册

> 版本：2026-09-04
>
> 本文合并原“语音采集四项需求总执行表”“阿里云迁移与 LiveKit 分阶段扩容手册”“VoxFlame Control Plane”和“采集容量与质检边界”。它是本专题唯一执行入口；产品 PRD、研究 Harness、安全整改、移动端真机验收和数据库 schema 仍由各自文档负责。

## 1. 目标、范围与当前结论

本手册把四项需求放在同一条可部署、可扩展、可回滚的链路中：

1. 方言配对采集；
2. 自动初筛、人工质检接口；
3. 1,000–10,000 注册/在线用户的容量路径；
4. 功能相同、默认白标的第二品牌采集站。

原则：Web 与 App 共用同一 Backend、账号、OSS、录音 envelope、质检和训练导出事实源；没有压测证据时不承诺容量数字；第二品牌不复制业务系统，也不隐藏真实法定运营主体、隐私责任主体或备案信息。

当前生产事实：单主机 Docker Compose、单 Backend、单 LiveKit Server、单 Agent Worker，音频主体直传阿里云 OSS。运行时唯一主链为：

```text
Frontend Web/App LiveKit RTC/Data
  -> Backend /api/rtc/session/*
  -> self-hosted livekit-server
  -> livekit_agent
  -> 8001 个性化 ASR / DashScope fallback / LLM / TTS
```

已完成的单机能力：方言元数据契约、质量初筛与人工审核 API 代码、OSS 直传和有界退避、Agent active-job/CPU/内存准入、单机 ASR/LLM/TTS 槽位、健康与 drain、LiveKit Agents `1.7.1`、LiveKit Server `1.13.6`、三名注册用户的 8001 模型路由对账，以及第二品牌白标配置骨架。

不能从上述能力推导出 1,000–10,000 路实时 AI 会话已完成。当前单 Worker 的证据是 8 路完整 RTC 会话；进一步扩容仍受个性化 ASR 单实例、TTS provider 配额、Agent Job 进程成本和 Backend 多实例事件一致性限制。

## 2. 四项需求状态总览

| 需求 | 已有能力 | Web/App 对齐 | 上线前剩余工作 | 状态 |
| --- | --- | --- | --- | --- |
| 方言配对采集 | 普通话后可录同句方言或跳过；共享 `utterance_pair_id`；保存语种、自报方言和来源；ASR 不一致不拒收 | 共用 recording envelope、元数据白名单和本机队列 | migration、真实设备双录/跳过/重录/断网补传 | 代码完成，待部署验证 |
| 自动质检与人工接口 | 服务端按时长、有效语音、静音、电平、削波等初筛；审核队列、决定 API 和独立审计表 | 两端上传同一质量元数据，后台统一审核 | 执行 migration、审核员白名单、授权账号幂等验证 | 代码完成，待部署 |
| 1,000–10,000 用户 | OSS 直传、Backend 背压、有限重试、Agent 联合准入、版本升级、8001 账户路由审计 | Web/App 使用同一退避、本机兜底和 RTC contract | 预发布、多实例事件队列、集群配额、双 Worker、ASR 双实例、阶梯压测 | 单机保护完成，集群未证明 |
| 第二品牌采集站 | 可配置白标模型、采集首页优先、同功能同数据契约 | Mobile 业务代码共用，独立品牌构建入口 | 全站白标检查、独立域名/容器路由、品牌资产和 App 标识 | 实现中，未上线 |

## 3. 唯一架构边界

```text
主站 Web ───────┐
第二品牌采集站 ─┼─> Backend 控制面 ─> Supabase Auth/DB
Mobile App ─────┘                         │
                                          ├─> OSS 音频与 manifest
                                          ├─> 质检、撤回、训练导出硬闸门
                                          └─> LiveKit session API

Web/App -> LiveKit SFU -> Agent Worker × N
                         ├─> ASR 网关 × N / 公共 fallback
                         ├─> LLM provider
                         └─> TTS provider
```

以下对象必须只有一个事实源：用户账号、授权版本、录音 ID、撤回状态、质检决定、训练导入资格和 workspace memory。第二品牌只改变域名、Logo、站名、主色和首页信息层级；登录、授权、录音、撤回、质检与训练导出仍回到同一系统。

### 3.1 控制面定义

Control Plane 是运行编排层。它决定何时启动会话、使用哪条 mode/graph 和 runtime properties、谁可以请求会话，以及会话如何被观测、保活、诊断和结束；它不直接执行 ASR/TTS/纠错、不保存长期记忆、不承担 UI 展示。

当前映射：

- Backend `rtc-orchestration.service.ts`：`listGraphs`、`startSession`、`stopSession`、`pingSession`、mode 到 property overrides。
- Backend `rtc.controller.ts`：`/health`、`/graphs`、`/session/start`、`/session/stop`、`/session/ping`。
- Frontend `useRtcAgentSession`：控制面客户端，负责请求 session、连接 LiveKit 和事件路由，不得膨胀为第二套治理逻辑。
- Execution plane：`livekit-session.service.ts` 与 `livekit_agent/app.py`。

建议对象模型：

```text
Session Intent   = surface, mode, userId, requestId, channelName,
                   requestedCapabilities, deviceContext
Session Runtime  = roomName, participantIdentity, accessToken,
                   livekitUrl, dispatchMetadata, timeoutSeconds,
                   runtimeOverrides
Session State    = created -> connecting -> active/degraded
                   -> ending -> stopped/failed
```

### 3.2 个性化 ASR 账户路由

Backend 从已验证 Supabase 身份生成稳定 `asr_account_id`，写入签名的 Agent dispatch metadata；前端不能自报，participant token 不携带认证用户 ID 或 ASR 键。Agent 仅发送 `X-Account-ID` 到 `127.0.0.1:8001/transcribe`，8001 注册表负责个性化模型、公共 fallback、线上最佳版本和实验晋升。

当前真实对账：`2187054680 -> EXP-29`、`2307294809 -> EXP-24`、`3083029019 -> EXP-25`，均为 `personalized=true/fallback=false`；未注册键命中公共 `exp16l3-lambda025`，为 `personalized=false/fallback=true`。8000/18000 已无监听。网关不可达时才回退 DashScope realtime，这不等于账户未注册的公共模型 fallback。

升级/部署硬门：

```bash
cd backend
env -u NODE_TLS_REJECT_UNAUTHORIZED npm run audit:asr-models
```

路由正确不等于容量完成；8001 仍需并发、双实例和故障切换证据。

## 4. 分阶段执行顺序

### Step 1：完成不依赖新服务器的代码

- 完成第二品牌站环境变量、首页采集优先、邮箱确认回站和安全默认值。
- 保持主站默认表现不变；Web/App 共用方言、质量、上传和撤回契约。
- 白标站缺少独立安装包链接时显示“准备中”，不得从第二域名分发现有 VoxFlame APK。
- 完成 Web、Backend、App 测试、production build、Compose 展开和 Playwright smoke。

通过条件：主站无回归；第二站不出现“燃言/VoxFlame”产品品牌；法定主体和备案信息真实；未登录、登录、上传失败和本机队列路径可解释。

### Step 2：部署方言与质检，不扩大公开流量

1. 保存当前生产镜像回滚点。
2. 只执行新增表和索引的质检 migration。
3. 以最小影响模式重建 Backend/Frontend，不以 `docker compose down` 作为前置。
4. 设置 `VOXFLAME_QUALITY_REVIEWER_EMAILS` 精确白名单。
5. 用测试账号验证普通话、方言、跳过方言、低质录音、人工决定、撤回和幂等重试。

停止条件：普通话单录、旧录音上传、撤回、审核越权或训练导入资格任一回归；不得把质量初筛或人工决定直接改成训练允许。

### Step 3：阿里云预发布控制面

第一批资源建议与现有 OSS 同地域：VPC、两台 4 vCPU/8 GiB ECS（`control-a`、`control-b`）、ALB/CLB、ACR、SLS。先用临时预发布域名，不改 `voxember.com` 正式 DNS；`control-b` 初期只承接 Frontend 或备用。

预发布顺序：部署 Frontend/单 Backend -> 配置 Supabase/OSS/LiveKit/CORS/Secrets -> 执行 migration -> 验证登录、workspace、签名、OSS PUT、complete、撤回和质检 -> 用临时 ALB 地址做 50/100/200 并发控制面测试。生产入口保持不变，旧节点保留回滚周期。

### Step 4：Backend 多实例硬门

当前 `runSerializedArtifactOperation()` 只在单 Node 进程内串行，不能直接用于双 Backend。第一版应使用现有 Postgres/Supabase 事件表和 `FOR UPDATE SKIP LOCKED`：

1. `/upload/complete` 先写不可变上传事件，以 `recording_id/audio_path` 幂等；
2. 独立 worker 消费事件，生成 manifest/transcript 投影；
3. 事件状态至少有 `pending/processing/completed/failed`、attempt、last_error、lease 到期时间；
4. 撤回写终态 tombstone，迟到 complete 不得复活；
5. 训练导出从数据库事实和活动投影读取，不依赖进程内锁。

两个 Backend 随机分流，同一账号 complete/discard 至少 50 轮：不得重复活动记录、丢 tombstone、撤回后复活、相邻录音误删；所有失败必须可幂等重试收敛。此门通过前不得让两个 Backend 同时写 manifest/transcript。

### Step 5：切换 Web/Backend 控制面

预发布域名 -> ALB 小流量 -> 10% -> 50% -> 100%。每级观察错误率、P95/P99、DB/OSS 调用、容器重启和队列堆积；旧腾讯云节点至少保留一个观察周期。回滚使用 ALB 权重或 DNS 切回旧主机，新增数据库结构保留，不删除历史数据。

### Step 6：单节点 LiveKit 与双 Agent Worker

第二批资源建议：独立 `rtc-a`（8 vCPU/16 GiB、独立公网 IP）、`agent-a`/`agent-b`（各 8 vCPU/16–32 GiB）、至少双实例 ASR 网关、独立 `rtc.<domain>` 域名。安全组必须覆盖信令 HTTPS/WSS、RTC UDP/TCP、TURN UDP/TLS；域名、证书、公网 IP 和 TURN 配置一致。

先迁移单 LiveKit 节点，不立即做集群。按 `5 -> 10 -> 20 -> 50 -> 100 -> 200` 路分级，分别保存 LiveKit 媒体、Agent 端到端和真实设备弱网/TURN 证据。`lk load-test` 只证明媒体面，不能替代 ASR/LLM/TTS 证据。

当前 Agent 保护：父进程按 active jobs、CPU、内存联合准入；独立 Job 以 POSIX 文件锁共享单机槽位；健康口、drain/stop grace 和精确版本已配置。多机前必须加入 Redis/集中配额、provider 429/超时/首包/fallback/内存监控、ASR 双实例和优雅下线。

集群实时 AI 安全容量使用：

```text
min(
  单 Worker 实测安全路数 × 健康 Worker 数,
  ASR 集群书面/实测并发配额,
  LLM 集群书面/实测并发配额,
  TTS 集群书面/实测并发配额
)
```

### Step 7：证据充分后再做 LiveKit 多节点

只有单 SFU 的 CPU、带宽或故障域被实测证明为瓶颈，才开 Redis 高可用和 `rtc-b`。多节点需要共享 Redis、每节点公网 UDP/TCP 路径、支持真实客户端 IP 的入口和至少两个 TURN 故障域；不能只复制容器或放到普通七层负载均衡后面。验收包括节点上下线、Redis 短暂故障、单 SFU 带宽饱和和 TURN 故障注入。

### Step 8：第二品牌域名上线

用户需提供：正式域名、中文站名、Logo（优先 SVG）、主色十六进制值；若要独立 App，还需 Android package、iOS Bundle ID、URL scheme、EAS project、签名账号和发布渠道。正式域名加入 Supabase Auth Redirect URLs，并分别验证桌面、Android 浏览器和 iPhone 浏览器。品牌页面不显示“燃言/VoxFlame”产品名，但保留真实运营主体、隐私责任主体和备案信息。

## 5. 容量与质检口径

“并发”至少拆成：同时在线、同时录音、同时 PUT OSS、同时调用 `/upload/sign`、同时调用 `/upload/complete`、同时 RTC AI 会话和 TURN 中继比例。注册用户数、打开页面数、LiveKit 房间人数、HTTP QPS 均不能替代实时 AI 容量。

建议业务目标先写清比例，例如：10,000 注册用户、1,000 同时在线、500 同时采集、100 同时 RTC；这是设计和压测场景，不是当前容量承诺。

资源换算：

- Agent 数 = 目标 RTC 路数 / 单 Worker 安全路数，向上取整并保留故障余量；
- TURN 峰值带宽 = 中继会话数 × 实测单会话双向码率 × 安全系数；
- Backend 实例数 = 目标动态请求速率 / 单实例安全 RPS，再加冗余；
- Provider 信号量不得超过服务商书面确认配额。

数据采集链路的自动保护：音频直传 OSS；Backend 只承担签名、complete、进度和撤回；`/sign`、`/complete` 有实例级在途上限；过载返回 `503 + Retry-After: 2`；Web/App 最多退避 3 次，之后保留本机队列；`/health` 暴露 active/limit/rejected 计数。

无真实用户数据时的压测：

```bash
cd backend
VOXFLAME_LOAD_REQUESTS=1000 VOXFLAME_LOAD_CONCURRENCY=100 npm run load:upload-control
```

带专用预发布 token 时只生成合成路径，不上传真实音频：

```bash
VOXFLAME_LOAD_BASE_URL=https://staging.example.com \
VOXFLAME_LOAD_BEARER_TOKEN=REDACTED \
VOXFLAME_LOAD_REQUESTS=1000 VOXFLAME_LOAD_CONCURRENCY=100 \
npm run load:upload-control
```

只允许在明确授权的预发布环境执行；token 不写入文件或日志。

自动质检只做初步分层：时长、有效语音、静音比例、输入电平、削波和对象完整性。ASR 不匹配不作为拒收依据；质量异常分层但不删除原始录音。人工审核使用 `VOXFLAME_QUALITY_REVIEWER_EMAILS` 白名单和独立审计记录，审核决定不能绕过授权、准入和训练导出 hard gate。

## 6. 1,000–10,000 用户阶段门

阶段 0：记录当前 vCPU、内存、磁盘、峰值带宽、FD、容器重启，连续观察 24 小时。

阶段 1：阿里云预发布控制面，50/100/200 控制面并发。

阶段 2：双 Backend 事件一致性 50 轮并发 complete/discard。

阶段 3：单 LiveKit + 双 Agent，5/10/20/50/100/200 路媒体与完整链路。

阶段 4：50 路稳定 30 分钟后进入 100 路；100 路稳定后进入 200 路。每级保存原始指标、配置和失败日志，不凭平均值通过。

阶段 5：只有 SFU/带宽/故障域证据明确后才进入 LiveKit 多节点和 Redis。

停止条件：OOM；Agent Job 拒绝率 >1%；ASR P95 >2 秒；TTS 首包 P95 >1.5 秒；媒体丢包 >1%；provider 429 持续 5 分钟。

## 7. 发布、回滚与用户审批

每次完成一个阶段，都在 `.tasks/current.md` 和 `.claude-summary.md` 记录版本、命令、指标、未验证项和回滚点。部署优先使用 `scripts/docker-rebuild-core-fast.sh`，磁盘清理先 `scripts/docker_disk_maintenance.sh status` 再 `prune-safe`；不得默认 `docker system prune -af`。

必须停下来由负责人确认的动作：购买/升配 ECS、ALB、Redis、带宽、ACR/SLS；申请 provider 配额；生产 migration；正式 DNS、证书、ICP备案接入或流量权重；释放旧服务器/资源；扩大公开用户范围；发布 Android/iOS 安装包。

## 8. 阿里云迁移与备案说明

域名注册商、DNS、服务器和备案接入不是同一件事：域名在哪里买，不决定必须在哪里部署。可以保留腾讯云注册和 DNS，把解析指向阿里云 ALB；长期全部在阿里云运维时，将 DNS、ALB、证书、WAF 和备案接入集中到阿里云更易维护，但不必转移注册商。

推荐顺序：阿里云预发布域名 -> 备案接入/变更确认 -> ALB 临时地址验证 -> 正式域名小流量 -> 观察后全量切换 -> 保留腾讯云旧节点。跨云迁移前必须核对 ICP 备案接入要求、OSS 同地域网络、VPC/安全组和公网 UDP/TURN 路径；不在未获用户批准时改正式 DNS 或释放腾讯云资源。

## 9. 官方机制依据与证据边界

- LiveKit 自托管部署、Redis、外部 IP、TURN、Prometheus：<https://docs.livekit.io/transport/self-hosting/deployment/>
- LiveKit 分布式部署：<https://docs.livekit.io/transport/self-hosting/distributed/>
- LiveKit Kubernetes 网络约束：<https://docs.livekit.io/transport/self-hosting/kubernetes/>
- Agents 自定义 `load_fnc`、`load_threshold`：<https://docs.livekit.io/agents/server/options/>
- Agents Job 生命周期、水平扩展和优雅下线：<https://docs.livekit.io/agents/server/lifecycle/>
- Agents `1.7.1`：<https://github.com/livekit/agents/releases/tag/livekit-agents%401.7.1>
- Server `1.13.6`：<https://github.com/livekit/livekit/releases/tag/v1.13.6>

仓库每周一自动对比 LiveKit 稳定版并创建待评估 Issue，但不自动升级生产。真正升级必须经过版本分类、Agent 全量测试、RTC/TURN 预发布、回滚点和人工发布门。

官方文档只说明机制，不证明 VoxFlame 容量。最终容量只能由本项目阶梯压测、真实语音端到端指标、provider 配额和故障演练确认。

## 10. 每阶段交付信息模板

完成任一阶段后，提供：资源规格与地域、VPC/子网、内网/公网拓扑、域名、端口与安全组、部署版本、30 分钟指标快照、失败日志摘要和回滚镜像。不要发送 AccessKey、服务密钥、JWT、个人账号 token 或原始音频。
