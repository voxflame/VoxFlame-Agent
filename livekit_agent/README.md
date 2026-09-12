# VoxFlame LiveKit Agent

> 当前目标：把 `livekit_agent` 作为现役执行面继续补齐训练页、记忆页与现场辅助能力，而不是继续保留旧执行面作为默认路径。

## 当前状态

这个目录现在已经是现役执行 runtime，优先服务：

1. `communication workspace`
2. `session intent / scene / capabilities` 元数据映射
3. 后续 `training feedback / memory / tooling` 迁移入口

当前还没完全补齐的能力：

1. 训练页 AI 功能完整等价
2. 记忆页 AI 功能完整等价
3. 更深的 `voice profile / clarity score / memory context`
4. 更完整的 `session review / memory tooling`
5. 更稳的 session-close 用户画像维护
6. 训练页、记忆页相关 AI 能力的最终等价补齐

当前最重要的状态纠偏是：

1. 现役 VoxFlame 执行面仍然是 `DashScope / Qwen-first`
2. 这个目录目前是 `LiveKit worker + DashScope communication loop`
3. 它已经替代了现役运行时主链，但还没补齐训练页和记忆页 AI parity
4. 现在真正要继续做的是把训练页、记忆页和现场辅助补满，而不是继续维护双轨运行时
5. 现在已经跑通了第一条可重复的 communication loop：`frontend connect -> backend token/dispatch -> livekit worker join room -> assistant text + TTS audio 回前端`
6. 当前最新进展是：语音路径的 assistant transcript 已开始携带 `correction` metadata，前端会按现役纠错样式消费；第一版 server-side `VAD / 自动收句` 也已接进 `livekit_agent`
7. `livekit_agent` 已开始产出最小 `voice_profile_updated` 信号：
   - 当前会在 correction reply 后发出 `clarity_score`
   - frontend 会把这些信号写回现有 session metadata，作为后续 `session_review / memory parity` 的过渡材料
8. `livekit_agent` 已开始具备最小 turn-taking：
   - server-side `speech_started / speech_stopped / barge_in_triggered`
   - 当前是“有门槛的 barge-in”：
     - 先检测到用户开始说话
     - 持续说够一小段时间后，才真正打断当前 TTS 代播
   - 对应 turn event 会通过 room data 回发给前端
9. `session.userdata` 第一片已经落下去：
   - `livekit_agent` 现在已正式有 typed session state owner
   - session start 时会构建最小 `PreparationContextPack`
   - backend 现在已经会把 `workspace snapshot.preparation` 注入 room metadata / dispatch metadata
   - 如果当前会话还没有显式 preparation，才会回退到 derived minimal pack
   - communication rewrite 也已开始读取这层准备上下文，而不再只依赖 `scene`
10. 训练页最小训练结果链已经并入现役主线：
   - frontend 现在会把每次录音的 `标签 / 目标句 / 系统听到 / 保存状态` 写成现有 memory service 可识别的 `training_result`
   - 这让 workspace / session review / growth profile 开始真正吃到 LiveKit 训练结果
   - 记忆架构本身不需要重做，仍沿现有 `training_result -> training_profile_summary -> workspace snapshot` 语义继续长
11. `session-close user profile update` 第一片已落地：
   - session 结束时不再新增 `session_compaction` 这类第五类长期记忆
   - 当前只会把很窄的 runtime signal 用于小幅维护 `用户个人画像`
   - backend `workspace snapshot` 已开始直接消费这层 `user_profile_memory`
12. `LiveKit Python RTC AudioProcessingModule` 第一片已接上：
   - 当前会在 agent 订阅到的房间麦克风帧上先走 LiveKit 官方 `AudioProcessingModule`
   - 第一版默认是保守配置：
     - `noise_suppression=true`
     - `high_pass_filter=true`
     - `echo_cancellation=false`
     - `auto_gain_control=false`
   - 这样做是因为：
     - 现在处理的是远端订阅音频，不是本地全双工采集
     - 对构音障碍用户，先避免过激增益和误伤发音特征
   - 这一步是对官方 APM 的最小接入，不等于已经完成 `room_options.audio_input` 级别的完整音频链
13. `server-side audio telemetry` 第一片已接上：
   - `livekit_agent` 现在会把会话里的原始收音信号压成正式事件，而不只是写日志
   - 当前会发：
     - `normalized_level`
     - `peak_level`
     - `clipping_detected`
     - `apm_enabled`
     - `reason`
   - 前端会把这些信号写回当前 session metadata
   - `session-close user profile update` 也已开始吸收这层信号，后续可以更可靠地区分“发音问题”和“收音问题”

## HTTP 与 Agent 边界

Web/Mobile 的 HTTP start 响应/intent 由 Backend canonical contract 管理，详见[接口收口](../research/product-engineering/RTC_CONTRACT_CLEANUP_2026-09-11.md)。Agent 继续消费签发服务的 metadata/dispatch 和 room data；本轮没有更改 Python data-message 协议或 ASR/LLM/TTS 参数。HTTP start 不等于 Agent ready，停止客户端 room 也不等于管理员删除房间。

## Env 约定

`livekit_agent` 的 env 现在按“LiveKit 基础设施 + DashScope correction/ASR/TTS”两层分组：

1. 保留同样的“模型提供方 / 日志级别”分组
2. `LOG_LEVEL` 与 `DASHSCOPE_*` 保持 provider 侧统一；当前 correction 继续走 DashScope OpenAI-compatible `/chat/completions`
3. `LIVEKIT_*` 继续由 compose environment 提供，`DASHSCOPE_*` 与 `LOG_LEVEL` 则优先从 [livekit_agent/.env](/home/ubuntu/VoxFlame-Agent/livekit_agent/.env) 读取
4. 当前已经接通的是 `LIVEKIT_*` 驱动的 communication loop，并开始优先使用 `DASHSCOPE_*` 做 text rewrite / TTS / ASR；训练结果与记忆沉淀继续走现有 `training_result -> workspace snapshot` 语义，不再并行维护逐句 feedback contract

也就是说：

- `LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_AGENT_NAME` 是当前必须的
- `OPENAI_API_KEY` 现在不是最小 communication/data loop 的必需项，也不是当前主链依赖
- `DASHSCOPE_API_KEY / DASHSCOPE_LLM_MODEL` 现在应写在 [livekit_agent/.env](/home/ubuntu/VoxFlame-Agent/livekit_agent/.env)
- 当前 correction 默认建议使用 `qwen-flash`，按“小型 formatter”思路运行
- 当前 correction 不再依赖 prompt/session cache；每轮都会直接带上最新的 `参考原文 + 训练句对 + 最近上下文`，避免 cache 过期后的上下文漂移
- 当前实时 ASR 默认锁到 `qwen3-asr-flash-realtime-2026-02-10` snapshot；如果后续官方放出更高阶的非 `flash` realtime 线，再评估切换
- `QWEN_ASR_REALTIME_*` 与 `QWEN_TTS_REALTIME_*` 现在也开始归 `livekit_agent` 自己管理，避免继续隐式借 TEN 的 provider 配置
- `LIVEKIT_AUDIO_APM_*` 现在开始归 `livekit_agent` 自己管理，用于控制 agent 侧的 LiveKit Python RTC APM
- 后续真正要达到的是 `小型 correction formatter + 稳定语音主链`

当前已经实际接上的 provider 能力：

1. `DashScope chat/completions`
   - 用于 communication rewrite
2. `DashScope realtime TTS`（默认 `qwen3-tts-flash-realtime`，可通过 `DASHSCOPE_TTS_MODEL` 切换到同一实时协议兼容的阿里云模型，例如 `cosyvoice-v3-flash`；`ALIYUN_TTS_MODEL` 为兼容别名）
   - worker 已会把 assistant reply 合成为 LiveKit 房间音轨
3. `DashScope realtime ASR`
   - 代码路径已经接进 worker，并开始监听房间里的麦克风音频
   - 当前已补首帧音频 / commit / final transcript 的诊断日志，并修复了 LiveKit 麦克风轨 `source` 未显式标注的问题
   - 第一版 server-side `VAD / 自动收句` 已接入，当前采用轻量 RMS 检测，并继续保留手动 `end_audio` 作为双保险
   - 当前也已接入 LiveKit Python RTC `AudioProcessingModule` 第一片，对房间麦克风帧做保守型 APM 处理
4. 最小 `voice_profile_updated`
   - 当前按 correction 前后文本估算 `clarity_score`
   - 先把 LiveKit communication loop 的 profile signal 跑起来
   - 后续再继续补真正的 `memory tooling`
5. 最小 `interrupt / turn detection`
   - 当前由 server-side VAD 驱动
   - 用户再次开口时，worker 会中断当前 TTS
   - 这一步先让沟通页更接近现役 TEN 的可打断体验
6. 最小 `training_result memory`
   - frontend 会把训练页每次录音结果记成现有 `training_result`
   - 后续 `session_review_build / growth profile` 可以继续沿同一条 memory 链演进
7. 训练页执行面已显式优先 LiveKit
   - [frontend/src/hooks/useMandarinTrainingSession.ts](/home/ubuntu/VoxFlame-Agent/frontend/src/hooks/useMandarinTrainingSession.ts) 现在直接指定 `executionBackend: 'livekit'`
   - 训练 AI 功能后续可以继续补齐等价能力，而不会再隐式吃到旧默认执行面

## 为什么 self-host 了还要这些 env

换到 LiveKit 的目标是：

1. 不再依赖旧托管执行面
2. 把 `RTC / RTM / agent dispatch` 的基础设施掌握在我们自己手里
3. 后续把 training / memory / tooling 长在我们自己的 runtime 上

但 `self-host` 不等于“完全不需要连接信息”。

即使是我们自己部署的 LiveKit，也仍然需要 4 类最小信息：

1. `LIVEKIT_URL`
   - 浏览器和 agent 要知道自己连哪台 LiveKit server
   - 本地开发默认可以是 `ws://127.0.0.1:7880`
   - 生产环境会变成我们自己的 `wss://rtc.voxflame.xxx`
2. `LIVEKIT_API_KEY / LIVEKIT_API_SECRET`
   - 这是我们自己那台 LiveKit server 的签发密钥
   - backend 要用它给前端 participant 签 token，也要给 agent dispatch 签 metadata
   - 它不是第三方 SaaS 凭据，而是我们自己的“门禁钥匙”
3. `LIVEKIT_AGENT_NAME`
   - 这是我们给 worker 约定的 dispatch 名称
   - backend 通过这个名字把某个 room 派发给 `livekit_agent`
   - 如果未来只保留单一 worker，它甚至可以继续保持默认值
4. 模型 / 存储 / 其他 provider keys
   - 这是 agent 自己的外部依赖，不是 LiveKit 特有要求
   - 和任何 self-hosted runtime 需要 provider key 是同一类问题

所以 LiveKit 带来的变化不是“完全不需要 env”，而是：

- 不再依赖旧执行面的云服务和私有控制协议
- 改成只依赖我们自己部署和拥有的 LiveKit server + worker
- env 也从“别人的平台凭据”变成“我们自己的基础设施地址和密钥”

## 自部署规划

### Phase A: 本地开发

1. 本机起一个 LiveKit dev server
2. backend 用 `LIVEKIT_API_KEY / SECRET` 给浏览器签 participant token
3. `livekit_agent` 作为 worker 向 LiveKit server 注册
4. frontend 浏览器直接通过 LiveKit SDK 进 room

当前这轮的 `LIVEKIT_URL=ws://127.0.0.1:7880 + LIVEKIT_BROWSER_URL=ws://localhost:3000 + devkey/voxflame_livekit_dev_secret_32chars` 就是这一层，而且已经不只是“能起服务”，而是：

1. `livekit-server` 已在 compose 内跑稳
2. `livekit-agent` 已在 Docker worker 内注册成功
3. 文字沟通与 TTS 音频回放已完成真实 smoke

仓库内现在已经提供了正式的开发基座：

```bash
sudo docker compose up -d livekit-server
```

当前建议显式使用可追踪的官方镜像 tag，而不是镜像站的 `latest`。仓库默认已切到：

```bash
LIVEKIT_SERVER_IMAGE=docker.m.daocloud.io/livekit/livekit-server:v1.13.6
```

这样做的原因是：当 `self-hosted livekit-server -> Agents worker registration` 出现异常时，我们需要先排除“镜像站 latest 漂移”这类基础设施噪音。

另外，当前仓库已经把 `livekit_agent` 收成了“本地 / 自部署 LiveKit 默认不走 shell 代理”的安全默认值：

1. [app.py](/home/ubuntu/VoxFlame-Agent/livekit_agent/app.py) 会在 `LIVEKIT_URL` 指向 `127.0.0.1 / localhost / livekit-server` 时主动清理 `HTTP_PROXY / HTTPS_PROXY / ALL_PROXY`
2. [docker-compose.yml](/home/ubuntu/VoxFlame-Agent/docker-compose.yml) 里的 `livekit-agent` 也会显式设置 `NO_PROXY=127.0.0.1,localhost,livekit-server`
3. 这样做是因为我们已经实测过：代理污染会让 worker 注册失败，或者让 job 子进程在 `ctx.connect()` 阶段超时

对应配置文件在：

- [infra/livekit/livekit.dev.yaml](/home/ubuntu/VoxFlame-Agent/infra/livekit/livekit.dev.yaml)

它当前服务的是“本地并行 smoke / transport adapter 开发”，不是最终生产配置。

### Phase B: 预发环境

1. 自己部署一套 LiveKit server
2. 给它配域名和 TLS
3. 打开需要的 WebRTC / TURN 端口
4. backend / livekit_agent 都改用这套预发 LiveKit
5. 只让 `communication workspace` 先切到 LiveKit

### Phase C: 正式替换

1. `livekit_agent` 接管 communication 主链
2. 再迁 `training feedback / correction / memory tooling`
3. 默认执行面切到 LiveKit
4. 最后清退剩余历史代码和容器说明

## 部署边界

未来真正自部署时，我们至少会有这几个 owner：

1. `frontend`
   - 浏览器只连我们自己的 LiveKit 域名
2. `backend`
   - 只负责签 token、发 dispatch metadata、做 control plane
3. `livekit server`
   - 我们自己的 WebRTC/room/data plane
4. `livekit_agent`
   - 我们自己的 runtime worker pool

这才是我们真正想要的“自主可控”。

## 目录说明

- [app.py](/home/ubuntu/VoxFlame-Agent/livekit_agent/app.py)
  LiveKit worker 入口
- [config.py](/home/ubuntu/VoxFlame-Agent/livekit_agent/config.py)
  环境变量与运行模式配置
- [session_context.py](/home/ubuntu/VoxFlame-Agent/livekit_agent/session_context.py)
  把 participant metadata 解析成 VoxFlame session 语义
- [session_userdata.py](/home/ubuntu/VoxFlame-Agent/livekit_agent/session_userdata.py)
  session-local typed state 与 `PreparationContextPack` 的当前 owner
- [agent_factory.py](/home/ubuntu/VoxFlame-Agent/livekit_agent/agent_factory.py)
  第一版 VoxFlame agent 构造逻辑

## 为什么放在主仓库里

`/home/ubuntu/agents` 继续作为上游参考源，当前主仓库通过：

- [references/agents](/home/ubuntu/VoxFlame-Agent/references/agents)

这个软链接直接查例子和实现。

真正属于 VoxFlame 的迁移代码应留在这里，因为它最终要对接的是：

- backend control plane
- workspace owner
- training feedback contract
- session intent / readiness / granted capabilities

## 运行方式

先复制环境变量：

```bash
cp livekit_agent/.env.example livekit_agent/.env
```

本地安装：

```bash
cd livekit_agent
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

开发模式：

```bash
cd livekit_agent
source .venv/bin/activate
python app.py dev
```

控制台模式：

```bash
cd livekit_agent
source .venv/bin/activate
python app.py console
```

运行测试：

```bash
cd livekit_agent
python -m unittest discover tests
```

## 本地实验建议

第一轮并行 smoke 建议保持最小化：

1. 先在本机启动一个 LiveKit dev server
2. backend 打开 `RTC_ENABLE_LIVEKIT_EXPERIMENT=1`
3. frontend 默认已经收口到 `NEXT_PUBLIC_RTC_EXECUTION_BACKEND=livekit`
4. 单独启动这个 worker，再只测 `communication workspace`

推荐的仓库内顺序：

```bash
sudo docker compose up -d livekit-server
cd backend && PORT=3201 RTC_ENABLE_LIVEKIT_EXPERIMENT=1 LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=voxflame_livekit_dev_secret_32chars LIVEKIT_AGENT_NAME=voxflame-agent npm run dev
cd frontend && NEXT_PUBLIC_API_URL=http://127.0.0.1:3201 NEXT_PUBLIC_RTC_EXECUTION_BACKEND=livekit npm run dev -- --hostname 127.0.0.1 --port 3200
```

这轮的目标是先确认：

- 浏览器能通过 LiveKit token 进房
- worker 能通过 dispatch metadata 恢复 `session intent`
- 文字控制消息和远端音频至少跑通最小沟通主链

## 当前现状

`livekit_agent` 现在已经不是“迁移实验壳”，而是现役执行面的组成部分。

当前已成立：

1. `self-hosted livekit-server + livekit_agent` 已是仓库现役 realtime execution plane
2. 沟通页主链已跑通：
   - room connect
   - ASR
   - correction-style transcript
   - TTS
   - interrupt / turn-taking
3. 训练页最小结果链已跑通：
   - `training_result -> training_profile_summary -> workspace snapshot`

当前还没做完的重点，不再是“迁移 seam”，而是：

1. 把 `session-local typed state` 制度化
2. 把 `PreparationContextPack` 真正接进 runtime
3. 把 `session-close compaction` 做成稳定的规律提取与记忆写回
4. 把训练页、记忆页 AI 能力继续补齐，而不是继续折腾 transport

当前应以这些文档为准：

- [VOXFLAME_PRODUCT_PRD_2026-03-24.md](/home/ubuntu/VoxFlame-Agent/research/product-engineering/VOXFLAME_PRODUCT_PRD_2026-03-24.md)
- [VOXFLAME_LIVEKIT_MEMORY_BEST_PRACTICES_2026-04-05.md](/home/ubuntu/VoxFlame-Agent/research/voice-agent/VOXFLAME_LIVEKIT_MEMORY_BEST_PRACTICES_2026-04-05.md)
- [.tasks/current.md](/home/ubuntu/VoxFlame-Agent/.tasks/current.md)

## 下一步重点

1. 在不重做 durable memory owner 的前提下，为 `livekit_agent` 补齐：
   - `session.userdata`
   - `PreparationContextPack`
   - `pattern extraction / compaction`
2. 让训练页继续稳定产出：
   - 发音规律
   - 高频误听点
   - 热词
   - 最稳表达
3. 让记忆页成为“用户画像 + 当前准备 owner”，而不是训练复盘页
4. 让沟通页只消费当前场景最小必要准备
