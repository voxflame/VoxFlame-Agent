# Skill Routing Guide

> 这份文档定义 `VoxFlame` 仓库协作时，什么时候优先用 `gstack`、什么时候用工程纪律 skill、什么时候用设计专项 skill，以及 `Context7 / Playwright / Linear` 这些工具型入口如何配合。

## 核心原则

1. `skill` 用来承载稳定方法，不用来替代代码、测试或结构化 tool。
2. 同一轮任务只激活最相关的一组 skill，避免多个相似 skill 叠加造成冲突。
3. `Context7` 负责专业文档检索，`Playwright` 负责浏览器验证，`Linear` 负责项目管理；它们不是 `gstack` 的替代品，而是 workflow 的基础设施。
4. 如果任务已经很清晰，直接改代码并验证，不要为了“用 skill”而硬套流程。
5. 如果你拿不准该先查什么，默认走“本地代码/文档 -> 官方文档 -> skill -> 验证 -> web”的升级梯度。

## 拿不准时的决策梯度

### 先看本地

- 仓库代码、注释、测试、`AGENTS.md`、`.tasks/current.md`、`research/README.md`
- 如果问题其实是“仓库现在怎么实现的”，不要先去外部搜索

### 再看官方文档

- 库、框架、SDK、浏览器 API、第三方服务接入方式不确定时，优先 `Context7`
- OpenAI 专项优先 `openai-docs` 或官方文档 MCP

### 再决定要不要上 skill

- 当问题是“方法不清”“路径很多”“需要流程型评审”时，用 skill
- 当问题已经缩到单一文件、单一 bug、单一改动时，通常直接实现更快

### 再做运行态验证

- 页面和交互优先 `Playwright`
- 容器、后端、脚本、compose 流程优先本地命令和日志

### 最后才上 `web`

- 需要最新外部事实、行业状态、新闻、法规、价格、产品可用性时才用
- 技术问题如果官方文档已经足够，不要把 `web` 当默认搜索引擎

## 默认路由

### 需求与方向

- 新产品想法、功能方向、是否值得做：`gstack-office-hours`
- 想自动跑完整计划评审：`gstack-autoplan`

### 方案评审

- 产品范围、野心、用户价值：`gstack-plan-ceo-review`
- 架构、边界、性能、测试：`gstack-plan-eng-review`
- UI/UX 方案、设计风险：`gstack-plan-design-review`

### 调试与实现纪律

- 不明原因 bug、根因调查：`systematic-debugging` 或 `gstack-investigate`
- 适合先写测试再实现：`test-driven-development`
- 准备宣布完成前做最终核验：`verification-before-completion`
- 明确适合并行拆分的实现任务：`subagent-driven-development`

### 前端与设计

- 页面或组件要先定审美方向：`frontend-design`
- Tailwind 一致性、节奏、层级：`baseline-ui`
- 无障碍检查与修复：`fixing-accessibility`
- 动效卡顿、动画质量：`fixing-motion-performance`
- 要抽设计系统或设计基线：`gstack-design-consultation`
- 现有页面需要视觉 QA：`gstack-design-review`

### 验收与收尾

- Web 功能验收并顺手修 bug：`gstack-qa`
- 只做 QA 报告：`gstack-qa-only`
- 提交前结构性 review：`gstack-review`
- 发版前后文档收口：`gstack-document-release`
- 完整 ship 流程：`gstack-ship`

## 工具型入口

### Context7

- 适用：库、框架、SDK、系统 API、第三方服务集成方式不确定时。
- 目标：拿到最新官方文档，而不是凭经验猜。
- 配套主文：
  [CONTEXT7_RESEARCH_GUIDE.md](CONTEXT7_RESEARCH_GUIDE.md)
- 默认兜底：
  如果技术问题存在“我记不清 / 这个版本可能变了 / 这家 SDK 经常改”的情况，先用 `Context7`

### Playwright

- 适用：页面交互、登录跳转、表单流、可见状态、console 错误、回归 smoke。
- 目标：用真实浏览器验证，而不是主观假设“前端应该没问题”。
- 配套主文：
  [PLAYWRIGHT_VERIFICATION_GUIDE.md](PLAYWRIGHT_VERIFICATION_GUIDE.md)

### Linear

- 适用：读写 issue、补充决策记录、同步当前执行状态。
- 不适用：替代仓库文档或充当长期技术事实源。

## 最小冲突规则

- 范围判断不清：优先 `gstack-plan-eng-review`，产品方向再加 `gstack-plan-ceo-review`
- UI 方向不清：优先 `gstack-plan-design-review` 或 `frontend-design`
- 根因不清：优先 `systematic-debugging` 或 `gstack-investigate`
- 前端是否真的可用不清：优先 `Playwright`
- 技术资料是否过时不清：优先 `Context7`
- 外部事实是否最新不清：优先 `web`

## 推荐组合

### 新功能从 0 到 1

1. `gstack-office-hours`
2. `gstack-plan-eng-review`
3. 如涉及 UI，再加 `gstack-plan-design-review`
4. 实现阶段视情况用 `test-driven-development`
5. 收尾用 `gstack-review` 或 `gstack-qa`

### 重构或治理任务

1. `gstack-plan-eng-review`
2. 如存在历史脏状态或根因不清，用 `systematic-debugging`
3. 改完后用 `verification-before-completion`

### 前端打磨

1. `frontend-design`
2. `baseline-ui`
3. `fixing-accessibility`
4. `fixing-motion-performance`
5. 最后用 `gstack-design-review` 或 `gstack-qa`

## 不要这样用

- 不要同时激活多个相似评审 skill，然后让它们对同一问题反复给不同答案。
- 不要把 `gstack` 当成必须每步都调用的仪式。
- 不要把 `Context7` 当普通搜索引擎；它应该服务“专业资料核验”。
- 不要跳过 `Playwright` 就宣称前端交互已经通过。
- 不要把 skill 输出当唯一事实源；仓库代码、测试结果和验证记录才是事实源。

## 语音与 Agent benchmark

按 [官方指标协议](../voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md)：本地实现 → Context7/官方 LiveKit 与 W3C 定义 → 离线 Harness 校验 → 经授权复用现有 RTC 探针 → 真机/场景验收。网页 benchmark / Lighthouse 不代替语音评测；LLM 文本 judge 不代替 ASR、打断和声学测试。外部 benchmark 在隔离 runner 固定版本，不为研究升级生产依赖。
