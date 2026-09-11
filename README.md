# VoxFlame Agent

> 让声音不仅被听见，更被理解。

**更新时间**: 2026-09-11

VoxFlame 是面向构音障碍沟通场景的主动沟通助手。当前目标不是做“通用语音助手”，而是把主链路收敛成一个真正可用的产品：先帮助用户说出第一句话，再帮助用户在实时沟通中被理解，并把练习与记忆沉淀成长期改进。

当前产品判断已经明确吸收“创始人即用户”的一手研究：真正决定成败的，不只是识别准确率，而是用户在面试、工作协作、医疗沟通、陌生人求助这些高压时刻，能不能不被打断、不被忽视、不被别人替他说话。

继续开发默认以本 README、[产品 PRD](research/product-engineering/VOXFLAME_PRODUCT_PRD_2026-03-24.md) 和[当前任务状态](.tasks/current.md)为现役入口。全部项目文档统一看 [VoxFlame Research](research/README.md)；模型代码与原始实验记录由 `references/clear-vox-model` submodule 承接。

## 开发标准

VoxFlame 后续所有 Web / App / 硬件 / prompt / 训练语料 / memory 开发，都按 `标准 / 技术 / 用户反馈` 三角闭环推进：

```text
专家标准决定“应该怎么做”
技术验证决定“能不能稳定做”
用户反馈决定“真实场景里值不值得继续做”
```

- 专家标准：优先对齐 ASHA、WHO ICF、W3C WCAG / COGA、NIST AI RMF、FDA human factors / GMLP、中文构音评估与普通话音系资料。
- 技术验证：每个改动都要有对应 smoke、fixture、contract、上传回执、manifest 对账或真机验证。
- 用户反馈：已有 Research Harness 与 feedback registry；仍需补真实目标用户观察和回访证据，不能以模板和离线测试代替真实反馈。

具体证据状态、应用 owner、验证与回退要求见 [研究到应用回流登记](research/APPLICATION_FEEDBACK_REGISTRY.md)。

## 当前架构

当前唯一事实源：

```text
Frontend LiveKit RTC/Data
  -> Backend /api/rtc/session/start
  -> self-hosted livekit-server
  -> livekit_agent
  -> DashScope / Qwen ASR / TTS / correction
```

- `Frontend`：LiveKit RTC 音频、room data 文本/控制、沟通页与训练页；Web 直接打开即用，Android / iPhone 原生内测包统一从 `/download` 获取。
- `Backend`：RTC session orchestration、memory API、phrases API、upload API。
- `LiveKit Agent`：位于 [livekit_agent/](livekit_agent)；当前已承接沟通/训练的执行面主链。
- 旧运行时 `websocket` 主链已经退役，不再作为兼容路径保留。

## 当前能力

- 沟通页已跑通 `RTC audio + RTM text/control`。
- 纯文本代播会显式返回 assistant transcript，不再只靠语音回放。
- 训练页已能按需拉起 RTC worker，并通过 RTM 接收 `training_feedback` 与 `voice_profile_updated`。
- Qwen realtime ASR/TTS 已完成单元测试和真实供应商 smoke。
- memory、hotwords、confusion patterns 已能沿当前主链写回。

## 当前代码判断

- 沟通主链已经能用；沟通页首屏已经从 `chat-first` 收成 `starter kit + live session + expression kit drawer`，首页、练习页和沟通档案页的顶层信息也开始从“说明书式页面”收成“任务入口 + 资源入口 + 低压力提示”。
- 训练数据入口这轮也开始扎实起来：前端已围绕 `recording envelope -> recorder queue -> upload receipt` 收口，后端 `/api/upload/complete` 已开始按 `audio_path` 复用已有 contribution / manifest，减少补传和重试时的重复写入。
- 本地待同步录音现在不再只是“有个数量提示”，而是会带 `syncStatus / syncAttempts / lastAttemptAt / lastError` 显式展示；Web 和 mobile workbench 可以围绕同一套 recorder queue contract 继续扩展。
- `useRtcAgentSession.ts` 负责 Web 会话编排；LiveKit SDK room 是连接与断开事实源，Backend `/rtc/session/start` 只负责签发凭证和 dispatch，不再提供空转 ping/stop。
- 长期用户状态正在继续收口到前端 [memory-service.ts](frontend/src/lib/memory/memory-service.ts) 与后端 [supabase.service.ts](backend/src/services/supabase.service.ts) 共同维护的 `workspace snapshot / memory profile / expression kit` 读写链，不再继续向旧执行面分叉。
- 记忆系统当前重点不是继续堆训练复盘，而是把“用户画像、常见场景、即将面对场景的准备、热词、发音规律、补救策略”压缩成可直接服务沟通与训练的 owner 数据。

## 开源后的协作重点

当前仓库已经从“架构反复迁移期”进入“开源协作与长期扩展期”。接下来最值得聚焦的，不再是重新争论主链，而是围绕现有稳态继续扩展：

1. `Web 主产品继续打磨`
   继续提升沟通页、训练页、记忆页的真实可用性和可验证性。
2. `App / Mobile Workbench 接入`
   在复用 `workspace snapshot / recording envelope / upload receipt` 的前提下，推进完整移动端工作台和桌面 companion。
   当前移动端已落在 [apps/mobile-workbench](apps/mobile-workbench)，App 不依赖 Web/Next.js 运行时，而是和 Web 作为两个 sibling client 共同依赖 backend-owned contracts；真机门见 [Mobile Workbench 真机验证手册](research/product-engineering/VOXFLAME_MOBILE_WORKBENCH_DEVICE_VERIFICATION_RUNBOOK_2026-05-05.md)。
3. `硬件接入`
   先做 BLE / USB / 外接麦克风 / 一键控制桥，再决定是否走更重的硬件形态。
   第一版硬件开发路线、购买清单、ESP32-S3 / BLE / I2S / LiveKit 边界见 [硬件桥接开发手册](research/product-engineering/VOXFLAME_HARDWARE_BRIDGE_DEVELOPMENT_GUIDE_2026-05-05.md)。
4. `自主语音 agent 架构`
   继续把 `livekit_agent` 演进成 provider-neutral、可解释、可验证的语音 runtime，而不是一上来整套重写。

## 快速开始

### 环境要求

- Docker + Docker Compose
- DashScope API Key
- LiveKit API Key + Secret（self-hosted server 自签）
- Supabase 项目

### 环境变量

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cp livekit_agent/.env.example livekit_agent/.env
```

关键变量：

- `DASHSCOPE_API_KEY`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_API_URL`：浏览器推荐同源 `/api`；直连 Backend 时使用 `http://localhost:3001/api`
- `FRONTEND_NEXT_PUBLIC_API_URL`：Docker 部署时推荐固定为 `/api`
- Web 不再注册 service worker 或提供 PWA 安装入口；原生 App 下载统一走 `/download`

### 启动

```bash
sudo docker compose up -d --build livekit-server backend frontend livekit-agent
sudo docker compose ps
```

常用命令：

```bash
sudo docker compose logs -f frontend
sudo docker compose logs -f backend
sudo docker compose logs -f livekit-agent
bash scripts/docker-rebuild-core-fast.sh frontend # 更新时只重建受影响服务
```

可选服务默认不参与主链启动；如果需要再显式启用：

```bash
sudo docker compose --profile extras up -d qdrant redis
```

### 访问入口

- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:3001/health`
- RTC orchestration health: `http://localhost:3001/api/rtc/health`
- LiveKit signaling: `ws://localhost:3000/rtc`

## 目录

```text
VoxFlame-Agent/
├── frontend/
│   ├── src/app/
│   ├── src/components/
│   ├── src/hooks/
│   └── src/lib/
├── backend/
│   └── src/
├── livekit_agent/
├── scripts/
├── research/
├── references/
│   └── clear-vox-model/  # Git submodule
└── docker-compose.yml
```

## 关键入口

- 前端沟通会话：[frontend/src/hooks/useRtcAgentSession.ts](frontend/src/hooks/useRtcAgentSession.ts)
- 前端训练会话：[frontend/src/hooks/useMandarinTrainingSession.ts](frontend/src/hooks/useMandarinTrainingSession.ts)
- 后端 RTC orchestration：[backend/src/services/rtc-orchestration.service.ts](backend/src/services/rtc-orchestration.service.ts)
- LiveKit runtime agent：[livekit_agent/app.py](livekit_agent/app.py)

## 验证脚本

```bash
npm run test:rtc-contract
(cd backend && npm run build && npm test)
(cd frontend && npm run test:runtime && npx tsc --noEmit)
(cd apps/mobile-workbench && npm run typecheck && npm run check)
```


## 接口与并行开发

RTC HTTP 响应与 intent 已收口到 [Backend 契约源](backend/src/contracts/rtc-session.ts)，Web/Mobile 通过生成副本独立构建；修改后运行 `node scripts/sync-rtc-contract.mjs`，禁止手改 generated 文件。HTTP JSON 在连接前校验，`scene` 明确允许 `null`。

Backend `POST /api/rtc/session/start` 签发凭证；`transport` 是连接信息唯一入口，`joinTokenTtlSeconds` 是入房 JWT 的 TTL，不是会话倒计时。LiveKit SDK room 承担连接、保活和断开；空转 HTTP ping/stop、空 graphs 及 RTM 凭证别名已从本地代码删除。

可以在**接口与验收样例冻结后**分别开发 Web/Mobile 视图、Backend service 和测试；共享契约、数据库迁移、主入口由单一 owner 串行收口。worktree 隔离文件写入，不解决接口含义、事件次序或账户权限冲突。RTC data-message、workspace/upload 的全量跨端 schema 仍待收口，不能宣称整个项目都可无约束并行。

**本次未部署，存在破坏性接口变化**：新客户端不能直接配旧 Backend，旧 App 的 HTTP ping/stop 在新 Backend 上也不再可用。发布前需安排 Backend/Web 切换、App 升级与旧版阻断；回退整个契约切片，不保留永久兼容层。详情见[接口收口与验证记录](research/product-engineering/RTC_CONTRACT_CLEANUP_2026-09-11.md)。

## 协作入口

- 当前任务：[.tasks/current.md](.tasks/current.md)
- 项目摘要：[.claude-summary.md](.claude-summary.md)
- 工程规范：[AGENTS.md](AGENTS.md)
- 产品主文档：[research/product-engineering/VOXFLAME_PRODUCT_PRD_2026-03-24.md](research/product-engineering/VOXFLAME_PRODUCT_PRD_2026-03-24.md)
- 研究入口：[research/README.md](research/README.md)
- 应用回流登记：[research/APPLICATION_FEEDBACK_REGISTRY.md](research/APPLICATION_FEEDBACK_REGISTRY.md)
- 模型与实验上游：[references/clear-vox-model](references/clear-vox-model)

---

## QA

### Q1: 为什么不直接做“全能 Agent + A2UI + Skill”?

因为实时语音场景的第一约束是**时延和稳定性**。先把核心沟通链路做稳，再增加智能层，风险更低。

### Q2: TEN 能不能直接做意图驱动的工具调度？

TEN 已退出本项目主链，不再作为接入选项。工具调度沿现役 LiveKit Agent 和 Backend 权限边界演进。

### Q3: 这个项目是“语音翻译器”还是“沟通助手”？

短期就应该是“主动沟通助手”，不是只会展示字幕的翻译器；中长期再长成“训练教练 + 成长系统 + 场景感知助手”。

### Q4: 为什么强调记录与复盘？

单次纠错解决“当下可说”；复盘与训练解决“长期变好”。两者缺一不可。

### Q5: 听障辅助为什么放后面？

它很有价值，但工程边界和主沟通链路不同。近期更适合先做“场景声音提醒 + 硬件 / App / Web 通信”的原型验证，而不是直接挤占构音障碍主线的 P0 资源。

---

## 项目号召

我们正在寻找 4 条长期 owner 方向的贡献者：

- Web 产品与实时体验：沟通页、训练页、记忆页、评估区、可用性与 QA
- App / Mobile Workbench：移动端、桌面端、后台同步、通知、设备权限
- 硬件接入：外接麦克风、BLE 控制、音频输入质量监测、设备桥接
- 自主语音 agent：turn controller、context assembler、provider adapter、evaluation harness

如果你认同“沟通权”是基本权利，欢迎一起把它做成真正可用、可扩展、可协作的开源产品。

---

## 参考资料 / 致谢

### 官方文档与模型能力

- OpenAI Realtime API 介绍与更新  
  https://openai.com/index/introducing-the-realtime-api/  
  https://developers.openai.com/blog/realtime-api

- Google Gemini Live API（能力、限制、工具调用）  
  https://ai.google.dev/gemini-api/docs/live-guide  
  https://ai.google.dev/gemini-api/docs/live-tools

- Alibaba Cloud Model Studio（Qwen Realtime / Function Calling）  
  https://www.alibabacloud.com/help/en/model-studio/realtime-model  
  https://www.alibabacloud.com/help/en/model-studio/function-calling

- Kyutai 全双工语音项目  
  https://github.com/kyutai-labs/moshi  
  https://github.com/kyutai-labs/hibiki

### 构音障碍语音研究

- Interspeech 2025 Dysarthric Speech Recognition Challenge  
  https://www.isca-archive.org/interspeech_2025/plumley25_interspeech.html

- DyPCL: Personalized Dysarthric Speech Recognition with Prompt-based Contrastive Learning (NAACL 2025)  
  https://aclanthology.org/2025.findings-naacl.388/

- Hypernetworks for Personalized, Cross-Lingual Dysarthria and Stuttering Speech Recognition (Apple, Interspeech 2025)  
  https://machinelearning.apple.com/research/hypernetworks-personalized-cross-lingual-dysarthria-stuttering

- Latent Phrase Matching for Dysarthric Speech Recognition (Apple, Interspeech 2023)  
  https://machinelearning.apple.com/research/latent-phrase-matching

### 开源社区与框架

- TEN Framework 官方文档  
  https://theten.ai/docs/ten_framework/extension/

- 本项目文档导航  
  [research/README.md](research/README.md)

---

## License

本项目协议保持不变，详见 [LICENSE](LICENSE)。
