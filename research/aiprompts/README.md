# AI Workflow Docs

> 这里存放的是 `VoxFlame` 的任务型 AI 工作流文档。
> 根 [AGENTS.md](/home/ubuntu/VoxFlame-Agent/AGENTS.md) 只保留仓库级规则和入口；长流程、专门验证方式、任务模板下沉到这里。

## 使用原则

1. 根 `AGENTS.md` 负责告诉 agent “先看什么、别做什么、有哪些入口”。
2. `research/aiprompts/` 负责承载“具体任务怎么做”的长流程说明。
3. 如果某个说明更像 workflow，而不是仓库级规则，就应该放到这里。

## 当前入口

- [AGENTS_FILE_SYSTEM_GUIDE.md](AGENTS_FILE_SYSTEM_GUIDE.md)
  什么时候该把说明写进根 `AGENTS.md`，什么时候该下沉到文档。

- [CONTEXT7_RESEARCH_GUIDE.md](CONTEXT7_RESEARCH_GUIDE.md)
  如何把 `Context7` 当成专业文档检索默认入口，用来查库、框架、SDK、系统 API 和官方集成方式。

- [USER_RESEARCH_HANDOFF_TEMPLATE.md](USER_RESEARCH_HANDOFF_TEMPLATE.md)
  当用户自己去做访谈、观察、问卷或 field study 后，如何把一手材料交给 agent，转成 PRD / 设计 / 开发输入。

- [design-language.md](design-language.md)
  页面改版时的默认视觉与交互语言，强调任务优先、低压力、中文优先和实体表面。

- [PLAYWRIGHT_VERIFICATION_GUIDE.md](PLAYWRIGHT_VERIFICATION_GUIDE.md)
  如何把 `Playwright` 当成浏览器验证默认入口，覆盖页面交互、登录跳转、控制台错误、回归验证和 smoke 流程。

- [SKILL_ROUTING_GUIDE.md](SKILL_ROUTING_GUIDE.md)
  如何在 `gstack`、工程纪律 skill、设计专项 skill 与 `Context7 / Playwright / Linear` 之间做最小且稳定的路由。

- [GOVERNANCE_PROMPT_TEMPLATE.md](GOVERNANCE_PROMPT_TEMPLATE.md)
  用于迁移、统一、兼容层、废弃路径、双轨实现收口等治理型任务。

- [HARNESS_ENTRY_CONTRACT.md](HARNESS_ENTRY_CONTRACT.md)
  从根 `AGENTS.md` 开始判断任务是否进入研究闭环、工程实施、验证或人工确认。

## 推荐读取顺序

### 要调整 AGENTS 入口组织方式

先读：
[AGENTS_FILE_SYSTEM_GUIDE.md](AGENTS_FILE_SYSTEM_GUIDE.md)

### 要查专业文档、官方接口、库/框架集成方式

先读：
[CONTEXT7_RESEARCH_GUIDE.md](CONTEXT7_RESEARCH_GUIDE.md)

### 要把访谈、观察、问卷或用户 field notes 交给 agent

先读：
[USER_RESEARCH_HANDOFF_TEMPLATE.md](USER_RESEARCH_HANDOFF_TEMPLATE.md)

### 要改首页、工作台、卡片布局或页面视觉语言

先读：
[design-language.md](design-language.md)

### 要做页面验证、回归、登录跳转、console 错误检查

先读：
[PLAYWRIGHT_VERIFICATION_GUIDE.md](PLAYWRIGHT_VERIFICATION_GUIDE.md)

### 要判断该用哪个 skill、工具或 workflow

先读：
[SKILL_ROUTING_GUIDE.md](SKILL_ROUTING_GUIDE.md)

### 要处理新旧并存、compat、deprecate、统一事实源

先读：
[GOVERNANCE_PROMPT_TEMPLATE.md](GOVERNANCE_PROMPT_TEMPLATE.md)

## 维护规则

1. 同一主题尽量一份主文，不要重复堆多个近似流程。
2. 这些文档应该是任务导向的，不要写成产品愿景文或操作日志。
3. 如果 workflow 已经失效，要及时更新根 `AGENTS.md` 的索引与这里的主文。
