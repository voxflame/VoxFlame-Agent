# VoxFlame 文档与研究

`research/` 是仓库唯一文档根，统一承接产品、运行时、工程、运维、合规、任务模板和应用研究。模型仓库的实验原始事实仍留在 `references/clear-vox-model`。

## 现役入口

- 上游实验事实源：[CLEAR-VOX-MODEL](../references/clear-vox-model/) submodule。模型代码、数据处理、实验配置、逐实验记录和原始结果都留在那里。
- 产品与运行时：[产品 PRD](product-engineering/VOXFLAME_PRODUCT_PRD_2026-03-24.md)、[采集/扩容/控制面](product-engineering/VOICE_COLLECTION_SCALING_CONTROL_PLANE_2026-09-04.md)、[数据库 schema](product-engineering/database/supabase-schema.sql)、[当前任务](../.tasks/current.md) 和实际代码。
- 工程协作：[AI 工程系统](AI_ENGINEERING_SYSTEM.md)、[Harness 入口](aiprompts/HARNESS_ENTRY_CONTRACT.md)、[执行计划模板](templates/AI_EXECUTION_PLAN_TEMPLATE.md)。
- 移动端与设备：[真机验证手册](product-engineering/VOXFLAME_MOBILE_WORKBENCH_DEVICE_VERIFICATION_RUNBOOK_2026-05-05.md)、[硬件桥接手册](product-engineering/VOXFLAME_HARDWARE_BRIDGE_DEVELOPMENT_GUIDE_2026-05-05.md)。
- 数据采集：[产品规范](speech-health/VOXFLAME_VOICE_COLLECTION_PRODUCT_SPEC_2026-08-18.md)、[设备验收](speech-health/VOXFLAME_VOICE_COLLECTION_DEVICE_ACCEPTANCE_CHECKLIST_2026-08-18.md)、[普通话覆盖基线](speech-health/MANDARIN_LINGUISTIC_COVERAGE_AND_COLLECTION_BASELINE_2026-08-22.md)。
- 安全合规：[内部整改记录](product-engineering/NETWORK_SECURITY_REMEDIATION_2026_267.md)、[正式整改报告](product-engineering/上海生声不息科技有限公司网络安全整改报告_沪浦网信安通2026_267号.md)、[WAIC 安全清单](product-engineering/WAIC_SECURITY_CHECKLIST_2026-07-08.md)。

研究结论不能自行变成运行时能力；仍须进入应用回流登记、指定 owner 并完成验证。

## 五个研究主题

| 主题 | 目录 | 研究问题 |
| --- | --- | --- |
| Voice agent | [`voice-agent/`](voice-agent/) | 实时 agent、ASR/TTS、纠错、上下文、memory、打断和工具边界 |
| 通用 Agent 系统 | [`agent-systems/`](agent-systems/) | 通用 Agent 底层机制、工程架构、产品化和场景落地；为语音 Agent 提供跨模态对照 |
| 语音底层与医疗/健康 | [`speech-health/`](speech-health/) | 构音障碍 ASR、声学/音系、训练评估、康复、健康检测及临床边界 |
| 产品与用户心理 | [`product-psychology/`](product-psychology/) | 创始人即用户、沟通失败、信任、羞耻/疲劳、坚持使用、照护者和无障碍体验 |
| 应用/全栈与商业化质量 | [`product-engineering/`](product-engineering/) | Web/App/硬件架构、vibe coding 治理、安全、质量、部署与商业化可维护性 |

## 从研究到应用

研究不能只停在“值得关注”。每条准备影响应用的结论都进入 [应用回流登记](APPLICATION_FEEDBACK_REGISTRY.md)，并沿同一条链路推进：

```text
上游实验 / 论文 / 用户研究
  -> 证据与限制
  -> adopt / validate / hold / reject
  -> 产品或工程 owner
  -> 最小实现
  -> 用户 / 指标 / 安全验证
  -> PRD、任务与代码
```

状态含义：

- `adopt`：证据和应用边界足够明确，可以进入实施计划。
- `validate`：有希望但证据未达到部署门槛，只允许做隔离实验或小流量验证。
- `hold`：缺关键证据、资源、授权或临床复核，暂不进入实现。
- `reject`：已被实验否定或与产品边界冲突，禁止换名后重复引入。

新增研究使用 [研究模板](templates/RESEARCH_NOTE_TEMPLATE.md)；从模型实验提炼应用结论使用 [实验回流模板](templates/EXPERIMENT_TO_APPLICATION_TEMPLATE.md)。涉及语音的通用 Agent 研究还应按 [`agent-systems/README.md`](agent-systems/README.md) 补齐跨模态对照。

## 来源与实时更新

- [来源注册表](SOURCE_REGISTRY.yaml)：五个主题的官方、专业、行业和探索性来源，包含抓取方式、更新周期、备用来源与许可边界。
- [来源路由与更新规范](SOURCE_ROUTING.md)：决定先搜什么、如何抓取、如何处理失败和如何回流证据。
- [专家/学者/博主雷达](EXPERT_WATCHLIST.yaml)：中外学者、工程师、临床专家及机构社媒的待核验清单。社媒只负责发现和实时动态，重要结论必须回到论文、标准、官方文档、代码或机构页面。

## 端到端 Harness

- [研究 Harness](RESEARCH_HARNESS.md)：统一 `研究 → 发现 → 证据 → 实验 → 学术/专利 → 产品场景 → 反馈优化` 的生命周期、状态和硬门禁。
- [Harness 规则](HARNESS_RULES.yaml)：阈值、状态、自动动作和人工确认边界的机器可读事实源。
- [Pipeline registry](PIPELINE.yaml)：每个研究机会的唯一 `research_id` 和阶段索引。
- [Feedback registry](FEEDBACK_REGISTRY.yaml)：用户、沟通伙伴、专家、遥测和失败样本的优化输入。
- [Evidence package](evidence/RO-000.yaml)：强证据、独立复核、可复现性和成果/产品门禁的事实包模板。
- [Outcome review](outcome-reviews/RO-000.md)：每个研究机会必须挂载的初步成果审查/改进建议报告。

所有论文、专利和产品试点都必须关联同一 `research_id`，并通过独立证据包；没有强证据只能保持候选、内部研究或隔离试点状态。

发布论文、专利、公开数据/代码、产品默认能力，或把 idea 扩大到新用户/病因/语言/设备/场景之前，必须通过证据包中的 `authority_gate`。闸门未通过时只能 `internal_only` 或 `hold`，不能对外宣称或扩大承诺。

### 自动触发与闭环入口

工程遥测和用户反馈可以通过 `scripts/research/check-research-triggers.py` 生成待处理触发信号，再用 `create-feedback-entry.py` 写入反馈登记。触发器只产生证据化输入，不自动执行清理、扩容、发布或把研究标为 `adopted`。每个条目必须继续经过 owner、baseline、停止条件、可回退实现和场景验证；`scripts/research/validate-research-loop.py` 用于阻止缺少证据包、成果审查或反馈关联的研究条目进入闭环。

默认触发条件包括：同类故障 7 天内重复、P95/P99/5xx/429/超时/丢包或 Job 拒绝超过保护阈值、根盘达到 50/60/85% 阈值、修复缺少真实设备证据，以及准备扩大用户/设备/语言/场景范围。真实用户试点、生产流量扩大、扩容采购、数据删除、健康主张和对外发布必须由负责人确认。

国内成果初审规则见 [国内成果初步审查与改进建议](OUTCOME_REVIEW.md)。论文、专利、软件著作权和产品分别使用不同检查项；初步审查报告只能帮助发现材料缺口和改进方向，不能替代版权登记、专利代理/法律意见或期刊同行评审。

## CLEAR-VOX-MODEL 使用方式

首次克隆当前仓库：

```bash
git clone --recurse-submodules <VoxFlame-Agent URL>
```

已有工作树：

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

上游仓库当前是私有仓库，协作者必须同时拥有访问权限。模型权重、数据集或外部对象存储资产仍按上游自己的说明下载；submodule 负责 Git 跟踪的完整代码、文档、实验记录和嵌套仓库。

更新上游版本时，不直接修改 gitlink 后宣称应用已升级。先阅读上游 `modules/dsr/R&D/Qwen3-ASR/EXP/EXP-INDEX.md` 与相关 EXP，再更新本目录 registry，完成应用侧验证后才能更改部署配置。

## 医疗与健康边界

- 研究检测信号不等于诊断、治疗建议或医疗器械能力。
- 未经临床专家复核、目标人群验证和合规评估的结果，只能标为研究或训练反馈。
- 健康数据坚持最小必要收集、明确授权、可撤回和用途隔离。
- 任何面向用户的健康提示都必须声明能力边界，并为高风险情况提供人工专业支持路径。

- [语音/Agent 官方工程指标与 Benchmark 协议](voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md)：发现需求 → 实现 → 优化 → 测试 → 迭代；离线检查、RTC 与设备证据分层。
