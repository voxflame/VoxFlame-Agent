# CLAUDE.md

`AGENTS.md` 是本仓库的入口与规则源。开始工作时：

1. 读取 `.claude-summary.md`
2. 读取 `.tasks/current.md`
3. 读取 [AGENTS.md](AGENTS.md)
4. 需要系统规则时，读取 [research/AI_ENGINEERING_SYSTEM.md](research/AI_ENGINEERING_SYSTEM.md)

如果 `AGENTS.md` 与本文件不一致，以 [AGENTS.md](AGENTS.md) 为准，并在任务结束后同步修正。

补充约定：

- 提交说明只写核心改动，提交/推送回复只给结果、分支、短 hash 与必要风险；详细证据留任务记录，见 [简洁沟通规则](research/AI_ENGINEERING_SYSTEM.md#提交与推送的简洁沟通规则)。


- 账号录音累计时长以数据库独立计时账本为准，不依赖 OSS 文件或可删除语料行；见 [长期录音计时](research/product-engineering/DURABLE_RECORDING_DURATION_2026-09-08.md)。
- OSS 直下载身份映射使用私有 account.json，邮箱/手机分字段、UUID 归属不变；见 [账户映射同步](research/product-engineering/OSS_ACCOUNT_IDENTITY_SYNC_2026-09-08.md)。

- 工具和 skill 选择拿不准时，按 `本地代码/文档 -> 官方文档 -> skill -> 验证 -> web` 升级。
- 容器验证默认先用 `docker compose`；若当前机器权限要求更高或普通命令失败，再回退到 `sudo docker compose ...`。
- Docker 部署优先使用 `scripts/docker-rebuild-core-fast.sh` 的 `env-backend` / `backend` / `frontend` / `core` 最小影响模式，不默认先执行 `docker compose down`；磁盘清理使用 `scripts/docker_disk_maintenance.sh status|prune-safe` 并保留回滚镜像。
- 研究先看 `research/README.md` 与 `research/APPLICATION_FEEDBACK_REGISTRY.md`；模型实验原始事实看 `references/clear-vox-model`，不能把上游候选直接当成应用已采用能力。
- 研究故障和遥测问题通过 `research/RESEARCH_HARNESS.md` 及 `scripts/research/*` 进入发现→证据→反馈→实施→验证闭环；触发器不自动删除、扩容、发布或采用。
- 每轮任务先按 `research/aiprompts/HARNESS_ENTRY_CONTRACT.md` 分流；阈值与人工确认边界只以 `research/HARNESS_RULES.yaml` 为准。
- 硬件/辅助器具/重大采购先把供应商稿、竞品功能和 AI 草案当待验证假设；先做 COTS/ODM 真实任务 A/B，再用用户价值、支付方、完全落地成本、工程与责任 Gate 冻结架构/BOM。
- 硬件方案按内部决策、原供应商反馈、中性供应商征询分层；原供应商稿保留熟悉的章节骨架和表格入口，中性外发稿独立保留完整产品/路线/验收/报价，两者均隔离不需要的对照、研究过程、角色阅读分工、预算毛利和签批底牌。具体参数逐项区分原厂事实、候选配置、测试目标和未知，并验证品牌禁词、无装饰图、DOCX 元数据/媒体、A4/PDF 无裁切。
- 外部 PDF/规格书必须核验实际文件类型、标题/页数、来源和哈希；网页壳、无关文件或不可访问原文要记录失败与替代，不能写成“已读”。

## 工程闭环与评测入口

- 固有闭环：**发现需求 → 实现 → 优化 → 测试 → 迭代**；记录需求证据、实现/回退、baseline/优化假设、测试结果和下一动作/owner/日期，缺测不当通过，失败回到实现/优化。
- 语音与 Agent 使用 `research/voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md` 的官方工程口径，阈值仍以 `research/HARNESS_RULES.yaml` 为准；离线评测与真实 RTC/设备/目标用户证据分开，沿现有 RO/反馈闭环，不自动发布。

## RTC 契约入口

- RTC HTTP 响应/intent 唯一可编辑源：`backend/src/contracts/rtc-session.ts`；客户端 generated 文件禁止手改。生成与验证：`node scripts/sync-rtc-contract.mjs`、`npm run test:rtc-contract`。并行开发先冻结接口与文件 owner，详见 `research/AI_ENGINEERING_SYSTEM.md` 的 RTC 契约边界。

## CLI 治理入口

- 完整检查：`npm run check:harness`；普通 checkout：`npm run check:harness:checkout`（不验证私有上游正文）；负例回归：`npm run test:governance`、`npm run test:mobile-rtc`。边界以 `research/AI_ENGINEERING_SYSTEM.md` 为准，替身或 checkout 检查不得代替真机/发布验收。


## Android 官网发布入口

官网 Android preview 只由 `android-preview-release.yml` 从 main 构建/复用原包并自动发布；停用服务器旧timer与CLI直发，不恢复旁路。规则见 `research/AI_ENGINEERING_SYSTEM.md`，操作与真机边界见 `research/operations/APP_RELEASE.md`。
