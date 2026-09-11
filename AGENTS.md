# VoxFlame Agent Guide

> 让声音不仅被听见，更被理解。

VoxFlame 面向构音障碍者，第一原则是提升系统对用户意图的理解，而不是纠正用户的声音。

本文件是仓库级入口，也是 Harness 的第一跳。它只保存长期稳定的协作规则、任务分流、运行时边界、工具路由和权威文档入口。历史故障、单次部署结果、压测数字和临时决策必须放在 `.claude-summary.md`、`.tasks/current.md` 或 `research/`，不得回填这里。

详细方法论以 [research/AI_ENGINEERING_SYSTEM.md](research/AI_ENGINEERING_SYSTEM.md) 为准。

## Session Start

每次会话按顺序读取：

1. `.claude-summary.md`
2. `.tasks/current.md`
3. 本文件

其余文档按任务触发，不要一次性加载整个 `research/`、`ideas/` 或 `frontend/`。

## 文件边界

- 根 `AGENTS.md` 只放仓库级规则和入口索引，不放产品百科、排障实录、研究报告或任务流水。
- 只有对某个目录树长期稳定且独有的规则，才新增子目录 `AGENTS.md`。
- 运行时 agent prompt、memory 写入规则和产品功能指令必须维护在 runtime 文档或配置中，不直接写入本文件。
- 发现某类规则、命令或验证方式反复出现时，优先沉淀到 `research/`、`scripts/` 或模板，再在这里保留链接。

## Operating Model

- 每个任务先按 [Harness 入口契约](research/aiprompts/HARNESS_ENTRY_CONTRACT.md) 分流：回答/诊断、变更/构建、研究闭环或高风险副作用；不能把“已分析”直接当成“已实施”。
- 先稳定单链路和单 agent workflow，再考虑 handoff 或多 agent。
- 任何改动先看代码、配置、日志和现状；复杂任务先形成计划，再做最小可运行切片。
- 涉及迁移、统一、兼容层、废弃路径或新旧并存时，先盘点入口层、服务层、存储层和旁路层，明确唯一事实源。
- 涉及副作用时使用显式工具、结构化参数、权限边界和清晰退出条件；不让自然语言隐式驱动删除、命令、SQL 或发布。
- 每次改动都要有对应验证；完成后同步 `.claude-summary.md` 与 `.tasks/current.md`。

- 提交说明只写核心改动，提交/推送回复只给结果、分支、短 hash 与必要风险；详细证据留任务记录，见 [简洁沟通规则](research/AI_ENGINEERING_SYSTEM.md#提交与推送的简洁沟通规则)。

## UI 全局指导

- UI 改动先读 `research/aiprompts/design-language.md`。
- 表单使用窄阅读宽度，卡片/工作台使用自适应宽度，不全仓统一 `max-width`。
- 中文优先，避免过大英文 tracking、重复标题和挤压式统计卡。
- 渐变只作弱氛围层；主表面默认使用实体底色，避免 `bg-white/80`、`backdrop-blur` 造成层级和遮挡错觉。

## Research Routing

- 应用研究统一进入 `research/` 的五个主题：`voice-agent`、`agent-systems`、`speech-health`、`product-psychology`、`product-engineering`。
- 上游模型实验事实只来自 `references/clear-vox-model`；应用结论必须先进入 `research/APPLICATION_FEEDBACK_REGISTRY.md`。
- 研究生命周期、证据包、反馈、权威闸门和自动触发规则以 [`research/RESEARCH_HARNESS.md`](research/RESEARCH_HARNESS.md) 为准。
- 研究阈值和人工确认边界的机器可读事实源是 [`research/HARNESS_RULES.yaml`](research/HARNESS_RULES.yaml)；不要在业务脚本中复制阈值。
- 普通话录音题面和采集遵循 `research/RESEARCH_HARNESS.md` 的可复现证据门；录音可见不等于训练导入。
- 研究状态为 `planned`、`blocked`、`diagnostic-only` 或低于门槛时，不得直接进入默认产品或部署。
- 语音研究必须补充 ASR 不确定性、端点/打断、噪声、设备、隐私和跨用户隔离；通用 Agent 或文本结果不能单独证明语音能力。
- 医疗/健康研究不等于诊断或治疗；需要专家、目标人群、隐私和合规门禁。
- 硬件、辅助器具和重大采购遵循 `已知 / 未知 / 假设 / 求证方法`，先做 COTS/ODM 与真实任务验证，再冻结 BOM、采购或量产。
- 外部技术资料优先本地代码和官方文档；第三方 SDK/API 用 Context7，OpenAI 产品用 `openai-docs`，浏览器行为用 Playwright；外部 PDF 必须核验实际文件类型、标题、页数、来源和哈希。

## Runtime and Architecture Boundaries

- 现役唯一运行时主链：`Frontend LiveKit RTC/Data -> Backend /api/rtc/session/* -> self-hosted livekit-server -> livekit_agent`。
- 不恢复 WebSocket、TEN 或 Agora 作为平行主链。
- durable memory 的 owner 是 `backend + workspace snapshot`；LiveKit 只承接 session-local state 和会话原始材料。
- 账号录音累计时长以数据库独立计时账本为准，不依赖 OSS 文件或可删除语料行；规则见 [长期录音计时](research/product-engineering/DURABLE_RECORDING_DURATION_2026-09-08.md)。
- OSS 直下载身份映射使用私有 account.json，邮箱/手机分字段、UUID 归属不变；见 [账户映射同步](research/product-engineering/OSS_ACCOUNT_IDENTITY_SYNC_2026-09-08.md)。
- 已有唯一事实源时，优先封旧入口或 compat，而不是新增平行实现；`compat` 只做迁移适配，必须带退出条件。
- Agent 改动必须考虑会话隔离、打断、上下文窗口、工具边界、失败恢复和资源上限。

## Engineering Constraints

- 禁止显式 `any`；接口、Props、状态和结构化响应都要有明确类型。
- 前端使用 Next.js App Router，组件和状态保持小而清晰。
- 后端保持 Service / Controller 分层，避免把业务逻辑堆进路由。
- Secrets 不进入 prompt、日志或前端；默认最小权限、显式审批和可审计副作用。
- 非显而易见的函数或协议补简短 JSDoc，不写空洞长注释。

## Verification Minimums

- 前端交互改动：目标页面 smoke；涉及状态、跳转、文本、console 或网络行为时优先 Playwright。
- 后端接口改动：验证受影响 API、RTC orchestration 或控制路径。
- `livekit_agent` / 纠错链路改动：验证消息流、日志或针对性脚本。
- Docker / 部署改动：验证相关 compose 配置、构建或健康检查。
- 容器验证默认使用 `docker compose`；权限不足时说明并使用 `sudo docker compose ...`。
- 部署优先使用 `scripts/docker-rebuild-core-fast.sh` 的最小影响模式；不要把 `docker compose down` 作为部署前置。
- 磁盘清理先运行 `scripts/docker_disk_maintenance.sh status`，再使用 `prune-safe`；保留运行容器、持久化卷、`latest` 和 `pre-*` 回滚镜像，禁止默认使用 `docker system prune -af`。
- 麦克风/语音权限优先通过端口转发的 `http://localhost:3000` 验证；公网验证必须提供 HTTPS。
- 纯文档改动至少运行 `bash scripts/check_ai_docs.sh`；研究改动还要运行研究 Harness 检查。

## Reference Map

- 系统规则：[research/AI_ENGINEERING_SYSTEM.md](research/AI_ENGINEERING_SYSTEM.md)
- 执行计划：[research/templates/AI_EXECUTION_PLAN_TEMPLATE.md](research/templates/AI_EXECUTION_PLAN_TEMPLATE.md)
- AI workflow 入口：[research/aiprompts/README.md](research/aiprompts/README.md)
- 工具路由：[research/aiprompts/SKILL_ROUTING_GUIDE.md](research/aiprompts/SKILL_ROUTING_GUIDE.md)
- Playwright：[research/aiprompts/PLAYWRIGHT_VERIFICATION_GUIDE.md](research/aiprompts/PLAYWRIGHT_VERIFICATION_GUIDE.md)
- Research：[research/README.md](research/README.md)
- Research Harness：[research/RESEARCH_HARNESS.md](research/RESEARCH_HARNESS.md)
- Harness 入口契约：[research/aiprompts/HARNESS_ENTRY_CONTRACT.md](research/aiprompts/HARNESS_ENTRY_CONTRACT.md)
- Harness 规则：[research/HARNESS_RULES.yaml](research/HARNESS_RULES.yaml)
- 应用回流：[research/APPLICATION_FEEDBACK_REGISTRY.md](research/APPLICATION_FEEDBACK_REGISTRY.md)
- 采集、扩容与运行时控制面：[research/product-engineering/VOICE_COLLECTION_SCALING_CONTROL_PLANE_2026-09-04.md](research/product-engineering/VOICE_COLLECTION_SCALING_CONTROL_PLANE_2026-09-04.md)
- 前端边界：[frontend/README.md](frontend/README.md)
- Mobile 真机验证：[research/product-engineering/VOXFLAME_MOBILE_WORKBENCH_DEVICE_VERIFICATION_RUNBOOK_2026-05-05.md](research/product-engineering/VOXFLAME_MOBILE_WORKBENCH_DEVICE_VERIFICATION_RUNBOOK_2026-05-05.md)

## Anti-Patterns

- 不把 `AGENTS.md` 当产品百科、任务日志或研究报告。
- 不用超长 prompt 取代结构化文档、schema 和测试。
- 不把“新增一套统一实现”当成治理完成。
- 不让 compat/deprecated 路径继续增长业务逻辑。
- 不在边界未收敛时做横向风格清洗、目录搬迁或大范围重构。
- 不跳过验证直接宣布完成。
- 不让 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md` 与系统规则长期漂移。

## Update Rule

当架构、协作流程或 agent 工程规范发生实质变化时：

1. 先更新 `research/AI_ENGINEERING_SYSTEM.md`。
2. 再同步本文件、`CLAUDE.md` 和 `.github/copilot-instructions.md` 的入口描述。
3. 最后更新 `.claude-summary.md` 和 `.tasks/current.md`。

## 工程闭环与评测入口

- 固有闭环：**发现需求 → 实现 → 优化 → 测试 → 迭代**；记录需求证据、实现/回退、baseline/优化假设、测试结果和下一动作/owner/日期，缺测不当通过，失败回到实现/优化。
- 语音与 Agent 使用 `research/voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md` 的官方工程口径，阈值仍以 `research/HARNESS_RULES.yaml` 为准；离线评测与真实 RTC/设备/目标用户证据分开，沿现有 RO/反馈闭环，不自动发布。
