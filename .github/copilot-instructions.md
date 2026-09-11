# VoxFlame AI Coding Instructions

`AGENTS.md` 是本仓库的入口与规则源。本文件只保留 GitHub Copilot 需要的轻量入口，避免和 `AGENTS.md` 漂移。

系统级 AI 工程规则以 [research/AI_ENGINEERING_SYSTEM.md](../research/AI_ENGINEERING_SYSTEM.md) 为准。

## Start Here

每次任务开始前，按顺序读取：

1. `../.claude-summary.md`
2. `../.tasks/current.md`
3. `../AGENTS.md`

如果本文件与 `../AGENTS.md` 不一致，以 `../AGENTS.md` 为准。

## Core Rules

- 提交说明只写核心改动，提交/推送回复只给结果、分支、短 hash 与必要风险；详细证据留任务记录，见 [简洁沟通规则](../research/AI_ENGINEERING_SYSTEM.md#提交与推送的简洁沟通规则)。


- 账号录音累计时长以数据库独立计时账本为准，不依赖 OSS 文件或可删除语料行；见 [长期录音计时](../research/product-engineering/DURABLE_RECORDING_DURATION_2026-09-08.md)。
- OSS 直下载身份映射使用私有 account.json，邮箱/手机分字段、UUID 归属不变；见 [账户映射同步](../research/product-engineering/OSS_ACCOUNT_IDENTITY_SYNC_2026-09-08.md)。

- 先读代码和现状，再提方案，不要凭记忆猜仓库状态。
- 默认先做 workflow，再考虑 runtime agent 或多 agent。
- 复杂任务先形成计划，再执行；计划结构遵循 `../research/templates/AI_EXECUTION_PLAN_TEMPLATE.md`。
- 迁移、统一、废弃、兼容层任务先盘点入口层 / 服务层 / 存储层 / 旁路层，明确唯一事实源，再开始改代码。
- 采用最小可运行切片，避免一次性大重构。
- 所有改动都必须带验证；纯文档改动至少运行 `bash scripts/check_ai_docs.sh`。
- 容器相关验证默认使用 `docker compose`；若当前机器权限要求更高或命令失败，可回退到 `sudo docker compose build/up -d/logs`。
- Docker 部署优先使用 `../scripts/docker-rebuild-core-fast.sh` 的最小影响模式，不默认先执行 `docker compose down`；清理先运行 `../scripts/docker_disk_maintenance.sh status`，只用 `prune-safe` 保留运行与 `pre-*` 回滚镜像。
- 任务完成后，同步更新 `../.claude-summary.md` 和 `../.tasks/current.md`。
- 研究统一进入 `../research/`；模型实验原始事实来自 `../references/clear-vox-model` submodule，只有登记为 `adopt` 且完成应用验证的结论才能进入产品或部署。
- 研究故障和遥测问题按 `../research/RESEARCH_HARNESS.md` 进入发现→证据→反馈→实施→验证闭环；`../scripts/research/*` 触发器只生成待审输入，不自动删除、扩容、发布或采用。
- 每轮任务先按 `../research/aiprompts/HARNESS_ENTRY_CONTRACT.md` 分流；阈值和人工确认边界只以 `../research/HARNESS_RULES.yaml` 为准。
- 硬件/辅助器具/重大采购先把供应商稿、竞品功能和 AI 草案当待验证假设；先做 COTS/ODM 真实任务 A/B，再用用户价值、支付方、完全落地成本、工程与责任 Gate 冻结架构/BOM。外部 PDF/规格书必须核验实际类型、标题/页数、来源和哈希，不能把网页壳或搜索摘要当原文。
- 硬件文档按内部决策、原供应商反馈、中性供应商征询分层；原供应商稿保留熟悉的章节骨架和表格入口，中性外发稿独立呈现完整功能、路线、工程输入、验证、交付和报价。两者都隔离不需要的原稿对照、研究过程、角色阅读分工、内部预算/毛利和签批意见；参数逐项区分原厂事实、候选配置、测试目标和未知，并检查品牌禁词、无装饰图、DOCX 元数据/媒体、A4/PDF 无裁切。

## Tool Routing

- 仓库内能回答的问题先查本地代码和文档。
- 库、框架、API 用法不确定时，优先用 `Context7`。
- OpenAI 产品、Responses API、tools、MCP、Agents SDK 相关内容优先使用官方 OpenAI 文档。
- 前端交互、页面状态、RTC/RTM 页面行为验证，优先用 `Playwright`。
- 命中已安装的 skill 场景时，优先用对应 skill。
- 只有在需要最新外部信息或时效性事实时，才使用 `web`。
- 如果一时拿不准，按 `本地代码/文档 -> 官方文档 -> skill -> 运行态验证 -> web` 的顺序升级。

## Engineering Constraints

- 禁止显式 `any`。
- 前端遵循 Next.js App Router 和小组件分层。
- 后端保持 Service / Controller 分离。
- Agent 改动必须考虑会话隔离、打断控制、记忆上下文和容错。
- 当前运行时唯一事实源是 `Frontend LiveKit RTC/Data -> Backend /api/rtc/session/* -> self-hosted livekit-server -> livekit_agent`；不要恢复 websocket 或 TEN/Agora 主链。
- 已有唯一事实源时，不再新增平级实现；优先封旧入口，而不是继续加一套新入口。
- `compat` 只做迁移适配，不承接新业务逻辑，并且必须写退出条件。
- 安全默认值前置：最小权限、显式审批副作用操作、结构化输出驱动工具、Secrets 不进入 prompt / 日志 / 前端。
- 优先级始终是：可理解性 > 低延迟 > 可打断 > UI 精修。

## Avoid

- 用超长 prompt 代替文档系统。
- 把“新增一套统一实现”当成“完成治理”。
- 让 `compat` / `deprecated` 路径继续扩散。
- 让不可信输入直接驱动工具、命令、SQL 或高权限写操作。
- 跳过验证直接提交结论。
- 在未收敛边界前做大范围清理式改动。
- 让 `AGENTS.md`、`CLAUDE.md`、本文件长期漂移。

## 工程闭环与评测入口

- 固有闭环：**发现需求 → 实现 → 优化 → 测试 → 迭代**；记录需求证据、实现/回退、baseline/优化假设、测试结果和下一动作/owner/日期，缺测不当通过，失败回到实现/优化。
- 语音与 Agent 使用 `research/voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md` 的官方工程口径，阈值仍以 `research/HARNESS_RULES.yaml` 为准；离线评测与真实 RTC/设备/目标用户证据分开，沿现有 RO/反馈闭环，不自动发布。
