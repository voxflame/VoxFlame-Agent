# VoxFlame AI Engineering System

> 更新日期：2026-09-10
>
> 本文档基于三类输入收敛：
> 1. OpenAI《Harness Engineering》
> 2. 用户提供文章《用 AI 写了 80 万行代码之后，我开始重新理解 AI 代码“治理”》
> 3. OpenAI / OWASP 关于 agent guardrails 与 Agentic Security 的官方最佳实践
> 4. https://zhuanlan.zhihu.com/p/2015575496742679437 这篇文章把harness engineering说得比较清楚
> 5. GitHub Copilot 官方 best practices / CLI best practices
> 6. Anthropic Claude Code 官方 common workflows
> 7. OpenAI Codex 官方关于 Docs MCP、agent internet access 与 coding workflow 的文档

## 1. 本轮升级要解决什么

过去我们已经完成了第一轮 `Harness Engineering` 化：把入口文件缩短、把深规则移到统一文档根 `research/`、把最小验证和状态同步纳入仓库。当前入口进一步收口为：根 `AGENTS.md` 负责任务分流，`research/aiprompts/HARNESS_ENTRY_CONTRACT.md` 负责交付契约，`research/HARNESS_RULES.yaml` 负责机器可读阈值和动作边界。

但这只解决了“不要把 prompt 写成百科全书”。

随着 AI 生成代码比例持续升高，第二个问题会迅速变成主问题：

- 代码生成越来越便宜
- 新抽象越来越容易长出来
- 旧入口不会自动消失
- 兼容层很容易被 AI 误当成正式层
- 安全边界如果不前置，AI 会把可调用路径继续扩散

所以这一轮升级的目标不是“让 AI 写得更多”，而是让系统更容易收敛、更难失控、更安全。

一句话概括：

**AI 编程时代，稀缺的不是生成能力，而是系统收口能力。**

## 2. 关键原则

普通话录音语料的候选筛选、覆盖统计和质量状态遵循 [`speech-health/MANDARIN_RECORDING_CORPUS_EVIDENCE_GATE.md`](speech-health/MANDARIN_RECORDING_CORPUS_EVIDENCE_GATE.md)。其中来源、整词/整句读音、文本污染、长度/重复和目标映射是可复现硬规则；没有量表和一致性证据的自然度/产品判断不得成为录音前置硬门。

用户录音进入云端原始语料层时，Backend 必须以 `research/HARNESS_RULES.yaml` 的 `upload_admission` 为机器事实源执行基础准入：授权从已验证 Auth 用户读取，不能信任请求自报；完成登记前核验对象存在、非空、大小和 Content-Type，并绑定账号路径、稳定 recording ID、非空 target 与正时长。客户端质量字段只用于补充诊断，不能替代服务端对象事实。

原始语料进入模型训练前必须再通过独立导出门。现役入口 `backend/scripts/export_audio_target_dataset.ts` 只接受当前授权有效、服务端已准入、用途包含训练、DB upload receipt 与 OSS 活动 manifest 一致、对象大小/类型/ETag 未变化且质量状态未明确拒绝或要求重录的样本。导出必须创建新目录，先在 staging 完整下载和生成 SHA-256，再原子发布版本化快照；不得覆盖既有快照，也不得用 `limit` 静默截断。split 以 contributor 为 speaker 单位确定性生成，禁止同一 contributor 跨 train/validation/test。质量为 `review` 的构音障碍样本可以保留进入快照，明确 `low_confidence`、`retry` 或 `rejected` 的样本只排除出训练快照，不删除原始录音。

账号录音累计时长的持久 owner 是 Backend + 数据库计时明细与累计字段，不是 OSS 对象列表或可删除的语料明细。以账号和稳定 recording ID 幂等入账：同一录音上传重试一次计时，同一句重新录制用新 ID 分别计时。云端确认与入账必须事务一致；本机待确认队列不得混入云端累计。存储迁移、常规清理和单条录音撤回不扣减已确认的投入时长；账号注销清除关联统计。实施与定向发布边界见 [长期录音计时](product-engineering/DURABLE_RECORDING_DURATION_2026-09-08.md)。

OSS 直下载的账户识别使用独立私有 `dataset/<UUID>/account.json` 映射，手机号和邮箱分字段，Auth 为事实源；UUID 保持训练归属，联系方式不进入训练清单。全体注册用户自动同步，GPU 必须校验身份状态和有效期，见 [账户映射同步](product-engineering/OSS_ACCOUNT_IDENTITY_SYNC_2026-09-08.md)。

### 2.1 环境优于提示词

稳定知识应落在仓库环境里，而不是依赖某一轮对话记忆。

VoxFlame 落地：

- 入口文件继续保持短规则和地图。
- 深层规则、产品与工程文档统一进入 `research/`。
- 守卫优先放进模板、脚本、lint、CI 和验证流程。

### 2.2 治理不是重写，而是收口

大多数失控不是因为“没有新方案”，而是“旧路径没有被关掉”。

VoxFlame 落地：

- 不把“新增统一实现”误认为“完成治理”。
- 每次迁移都要回答：旧入口是否真的被封住。
- 优先减少合法入口数量，而不是继续叠加平级抽象。

### 2.3 AI 偏局部最优，人要负责全局收敛

AI 会沿着可见上下文继续生长代码；只要旧实现仍可被引用，AI 就会继续复制旧模式。

VoxFlame 落地：

- 迁移任务先盘点旧路径，再改代码。
- 明确唯一事实源后，禁止继续在旧路径上长新逻辑。
- compat / deprecated 路径不能只靠口头约定存在。

### 2.4 过渡态必须显式标记

兼容层不是问题；没有退出条件的兼容层才是问题。

VoxFlame 落地：

- 所有过渡层都要明确角色和退出条件。
- 迁移做不完时，先建立“防扩散机制”。
- 删除成为正式流程，不是“有空再说”。

### 2.5 安全不是补丁，而是默认门禁

AI 让代码和工具调用更容易扩散，所以安全规则必须前置成默认值。

VoxFlame 落地：

- 最小权限默认开启。
- 任何副作用工具都需要白名单、显式授权或人工确认。
- 不可信输入不能直接驱动工具调用、命令执行或状态写入。

### 2.6 人机协作的最小可靠模式

这轮补充的官方资料给出了一个很一致的结论：

- AI 更擅长加速局部分析、实现和验证
- 人更应该负责目标对齐、边界收口、风险审批和结果验收

VoxFlame 默认采用下面这个协作顺序：

1. 先广后窄
- 先让 agent 用最小上下文理解代码库和目标，再逐步缩到具体模块，不要一上来塞满所有文档和目录。

2. 先计划，再改代码
- 多文件改动、重构、架构收口、边界不清任务，默认先进入 plan / review / research，再进入实现。

3. 会话保持聚焦
- 一个会话只追一个主任务；问题域变了，就压缩结论、切新任务，而不是把所有上下文硬串在一起。

4. 并行只给旁路任务
- 可并行、可验收、不会阻塞当前关键路径的子任务才适合 delegation；核心 feature、关键 bug、边界判断优先在主线程本地完成。

5. 验证比生成更重要
- AI 生成速度快不等于任务完成；任何输出都要经类型检查、测试、日志、浏览器或脚本验证后才算收口。

6. 仓库说明文件必须足够具体
- 仓库级 instructions 不能只写“遵循最佳实践”；至少要包含 build/test 命令、关键架构判断、何时 plan、何时 delegate、何时必须人工复核。

7. 主线程只吃结论，不吃探索噪音
- 复杂任务里，探索、试错、大范围搜索和备选方案比较可以发生在旁路上下文。
- 但回到主线程时，默认只带回 `结论 / 风险 / 下一步 / 证据`，不把整段垃圾上下文重新灌回主任务。
- 如果必须 delegate，多 agent 返回值应优先是 synthesis，而不是原始探索流水。

### 2.7 用户功能与固定功能的研究门槛

不是所有开发都该先看同一种资料。

VoxFlame 默认把任务分成两类：

1. 用户 / 人的功能
- 例如：沟通首句设计、训练反馈措辞、激励机制、陪练体验、解释性 UI、信任建立、照护者协作、认知负担控制。
- 这类任务优先需要：
  - 用户访谈 / 观察 / diary study / usability feedback
  - 心理学、康复、交互设计、无障碍设计相关资料
  - 用户提供的真实 field notes、需求清单、访谈摘要
- 如果缺这些输入，agent 只能做：
  - 可回退的最小实现
  - 明确写出假设
  - 不把“猜的用户需求”直接写死成长期产品结构

如果产品创建者本人就是目标用户，默认优先级更高的是：

- 先做“创始人即用户”研究，而不是先抽象 persona
- 先抓他真实经历过的沟通任务、失败瞬间、身体疲劳、情绪代价、补救动作和成功样本
- 再把这些一手材料外推成更广的人群假设

2. 固定 / 稳定功能
- 例如：SDK 接入、API schema、transport、auth、存储、部署、容器、数据库、realtime 协议。
- 这类任务优先需要：
  - 官方技术文档
  - SDK / framework / API 参考
  - 真实代码实现和运行日志
- 默认顺序：
  - 先本地代码
  - 再官方文档 / Context7
  - 再实现
  - 最后用脚本 / 浏览器 / 容器验证

一句话：

**跟“人”有关的功能先研究人，跟“系统”有关的功能先研究技术。**

### 2.8 证据化产品与硬件规划门禁

AI 可以加速资料发现、方案比较、规格起草和文档生成，但不能替代用户证据、供应商报价、法规意见、样机数据或投资决策。供应商初稿、竞品功能表和 AI 生成方案一律先视为待验证输入，不具有事实优先权。

涉及硬件、辅助器具、医疗/健康相邻产品、长期产品路线或重大采购时，默认执行：

1. 先写清用户、真实任务、失败后果、支付方、intended use、非目标和现役 baseline。
2. 用 `已知 / 未知 / 假设 / 求证方法` 盘点，不用精确参数掩盖未知。
3. 需求标记来源：目标用户/场景验证、权威/原厂证据、供应商书面报价、待验证假设；不同证据不能互相替代。
4. 先用现成设备、ODM 或最小风险原型验证净增益；只有在用户价值、商业可行、工程可行和责任边界同时通过 Gate 后，才冻结架构、BOM、芯片、开模或认证投入。
5. 路线图必须区分近期承诺、条件期权和探索方向；编号不等于预算承诺，上一代完成也不自动批准下一代。
6. 老板视角按完全落地成本评审，不只看 BOM：NRE、模具/工装、认证、许可/云、良率、库存、账期、渠道、售后、更新、备件与退市都要进入模型。
7. 每个 Gate 必须有 owner、预算上限、必需证据、反对意见、停止条件、回退和复审日期；负结果允许直接 `Pivot / Stop`。
8. 器件数字区分原厂公开值、采购门槛和整机/用户研究目标；没有报价或实测的数据不得伪装成冻结规格。
9. 医疗/辅助器具的监管、人因和安全指南可作为严格工程参照，但不得因此宣称产品已被分类、认证、临床有效或“医疗级”。
10. 先维护一份内部证据事实源，再按受众派生受控版本，避免一份文件同时承担互相冲突的披露目标：
    - 内部决策版保留预算上限、毛利/现金假设、反对意见、停止条件和 Founder Gate。
    - 原供应商反馈版应尽量保留对方熟悉的章节骨架、表格密度和术语入口；是否公开章节映射、主张处置和修订理由由任务目的决定。若用户要求直接形成最终产品方案，正文不得留下对照、研究过程或阅读角色分工。
    - 中性供应商征询版应是完整自有产品文件，保留产品功能、全路线、当前优先级、工程输入、偏离规则、验证、交付物和报价口径，但删除原稿对照、内部预算底牌、毛利、签批意见和未授权竞争情报。
    - 派生版本不得篡改证据等级；候选、目标、强制和待确认必须可区分，远期路线必须明确不构成订单、排期、预算或数量承诺。
11. 商业文档默认使用编号标题、标准表格、版本记录、页眉页脚和可填写回复/决策页；除非信息关系确实需要且用户明确要求，不使用图标、emoji、装饰性插画或 AI 风格视觉元素。多角色判断必须融合成统一的产品约束、取舍、验收和退出条件，不把正文切成“老板看这里、技术看那里”的阅读说明。发布前同时检查品牌词、文本禁词、DOCX 元数据与媒体资源、A4/PDF 页尺寸、跨页表头、表格裁切和最终签署/回复页。
12. 参数发布采用逐项台账：每个具体型号、容量、距离、时延、重量、续航、声压、防护、跌落、数量和工期都必须标记为原厂事实、候选配置、采购/测试目标或未知；原厂事实记录材料、版本、条件和限制，目标记录测试方法与冻结责任，未知记录下一步查询。找不到一手资料时宁可保留开放问题，不用同类器件、搜索摘要或 AI 推断补成确定数字。

硬件路线的默认顺序是：

```text
真实任务与支付方
  -> COTS/ODM A/B 与失败样本
  -> Founder Gate
  -> RFI（能力/风险）
  -> RFQ（同口径成本/条款）
  -> EVT（原理与最高风险）
  -> DVT（设计、可靠性、合规）
  -> PVT（生产、追溯、良率、售后）
```

不能跳过前一阶段的证据，直接用更高算力、更大电池、更多传感器或更多 AI 功能“解决”尚未定义的问题。

对外供应商文件不是把内部方案简单删减。它必须让未参与历史讨论的合作方独立回答：产品为谁解决什么任务，哪些路线是当前工作、条件产品或研究方向，软硬件责任在哪里，如何报告偏离，如何测试，交付哪些可迁移资产，以及按什么统一口径报价。信息不足时应显式列为开放问题，不能用模糊保密或精确但无证据的参数填空。

## 3. 治理型任务的统一模型

### 固有工程闭环：发现需求 → 实现 → 优化 → 测试 → 迭代

这是所有变更/构建任务的交付契约，不替代研究生命周期。每轮都记录：

1. **发现需求**：用户失败/遥测/来源证据，受影响场景与可验证目标；研究沿用同一 RO/反馈 ID。
2. **实现**：先盘点现役路径，完成最小可运行切片，记录 diff、权限和回退；分析不算实现。
3. **优化**：改动前固定 baseline、配置/数据版本、瓶颈假设与保护指标；不能测时标记未测，不宣称优化有效。无需性能优化时写明不适用理由，不为流程凭空重构。
4. **测试**：执行可重复验证，保留命令、版本、样本数、失败/取消/缺测及证据；官方指标定义与本项目阈值分开。测试贯穿各阶段，不能等到最后才补基线。
5. **迭代**：依据结果继续实现/优化、保持待验证或停止；回写原反馈、下一动作、owner 和复核日期。未测/失败不能自动发布、关闭反馈或标记采用。

文字修订可缩为任务记录与文档检查，不强制新建研究对象。性能、语音和 Agent 能力主张必须有基线与相同条件的回归；不以 mock、文本测试、HTTP 健康或单用户结果代替真实音频/RTC/设备/目标人群验证。

语音按 [官方工程指标与评测协议](voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md) 执行；规则与验收阈值只在 `HARNESS_RULES.yaml`，离线评测入口为 `scripts/research/voice_benchmark.py`，证据挂入既有 Pipeline/RO，不另建登记系统。缺测不是 0，阈值未设不是通过，报告验证通过不是产品发布通过。

当任务涉及迁移、统一、兼容层、废弃路径、双轨实现或主链路收敛时，默认按下面三个概念来判断。

### 3.1 四层盘点

先盘点该能力在四层里的真实分布：

1. 入口层：页面、组件、Hook、路由、前端 API 调用方
2. 服务层：Service、Controller、命令、Workflow、事件入口、Agent cmd/data handler
3. 存储层：表、DAO、Repository、缓存、文件存储、向量库索引
4. 旁路层：统计、记忆、搜索、审计、报表、后台任务、埋点、导出

只改入口层不等于完成治理；如果旁路层还读旧数据，旧路径就删不掉。

### 3.2 唯一事实源

每一项核心能力，都必须明确：

- 当前唯一应该继续演进的事实源是什么
- 其余实现为什么还存在
- 谁负责最终替换和删除旧路径

事实源可以是：

- 一个 Hook
- 一个 Service
- 一套命令组
- 一个 Repository
- 一组表 / 事件模型

但同一能力不能长期并存多个“同级现役入口”。

### RTC 契约与并行开发边界

- RTC HTTP 响应、intent 与响应解析的唯一可编辑源是 `backend/src/contracts/rtc-session.ts`；Web/Mobile 的 generated 副本由 `node scripts/sync-rtc-contract.mjs` 产生，禁止独立手改。各端仍独立构建，不导入 Backend service 或 Next.js 运行时。
- `npm run test:rtc-contract` 检查生成漂移与跨端解析；Backend API、Web runtime、Mobile 类型/检查与实际 RTC 验证分别负责各自边界，不能互相冒充。
- Backend 签发 participant 凭证与 dispatch；客户端 SDK room 管连接/保活/断开。JWT TTL 不是会话时长，HTTP start 成功也不是 Agent 已就绪。
- 并行前冻结请求/响应、错误语义、权限、事件次序和验收 fixture，并明确文件 owner。worktree/分支只能隔离写入，不能消除语义冲突；契约、迁移、共享入口由一个 owner 串行修改，其他任务消费已冻结接口。
- 当前只收口 RTC HTTP 响应/intent；data message、workspace/upload 的完整跨端 schema 尚未全部冻结。发布破坏性契约变更前必须明确 Web/Backend/已安装 App 的切换与整体回退，不能靠永久 compat 兜底。

### 3.3 路径分类

所有实现默认归类为以下四种之一：

- `current`：现役主路径，只允许继续演进这里
- `compat`：兼容壳，只允许做迁移适配，不允许承接新业务逻辑
- `deprecated`：禁止新增依赖，只允许迁移和删除准备
- `dead`：已无实际入口，进入删除流程

这四类不能只存在于脑子里，至少要通过目录、注释、文档、日志、lint 或脚本表达出来。

## 4. 治理型任务的默认执行闭环

### 4.1 盘点

不要一上来就重构。先确认：

- 现在有哪些真实入口
- 哪些入口仍在运行
- 哪些旁路系统还依赖旧路径
- 哪些旧实现其实已经是残留

### 4.2 定锚

在开始迁移前，先定唯一事实源。

必须有一句明确的话：

**从这次开始，这项能力以后只允许往这里收。**

### 4.3 建收口层

如果一次性替换风险过高，可以加 compat 壳或适配层，但 compat 的目标只有一个：迁移。

compat 层必须同时具备：

- 明确命名
- 明确注释
- 明确删除条件

### 4.4 加守卫

治理不是“鼓励走新路”，而是“封死老路”。

优先考虑的守卫包括：

- lint 禁止 import 旧 Hook / 模块
- CI 禁止新代码引用 deprecated 路径
- 静态扫描脚本检测重复实现或旧命令调用
- deprecated 命令 / API 打日志告警
- 审查规则要求说明 compat 的删除条件

### 4.5 分片迁移

不追求一次性切干净，按切片推进：

1. 主入口
2. 高频路径
3. 旁路系统
4. 长尾依赖

### 4.6 删除与复盘

完成迁移后必须继续做两件事：

- 删除旧入口、旧依赖、旧表、旧事件消费
- 复盘这次为什么会出现双轨和回流

删除不是扫尾，而是治理完成的核心标志。

## 5. 安全应用默认门禁

下面这些规则默认适用于所有 AI 参与的实现，不因任务大小而省略。

### 5.1 最小权限

- 工具、命令、数据库、第三方 API、文件系统访问都按最小权限暴露。
- 默认使用白名单能力，不给“泛化执行权限”。
- 高风险能力必须具备单独开关和撤销路径。

### 5.2 副作用审批

- 任何会发送消息、写数据库、调用外部系统、控制设备、暴露隐私数据的动作，都要有显式审批、用户确认或硬编码白名单。
- 不允许让模型自由拼接命令后直接执行。

### 5.3 不可信数据隔离

- 用户输入、网页内容、检索结果、外部文件都按不可信数据处理。
- 不可信内容不能直接驱动工具参数、SQL、Shell、系统 prompt 或权限边界。
- 优先使用结构化输出和严格 schema，再进入下游执行层。

### 5.4 身份、租户与数据边界

- 所有 user-scoped 数据都要显式校验 authn/authz 和 tenant boundary。
- 匿名态、登录态、本地态、云端态必须分别定义权限边界。
- 不允许因为 AI 辅助开发而默认放宽 ownership 校验。

### 5.5 Secret 与敏感数据治理

- Secret 不进入 prompt、日志、前端 bundle、测试快照或文档示例。
- 调试输出默认打码。
- 录音、转写、记忆和用户画像只保留最小必要范围，并保留删除路径。

### 5.6 供应链与执行环境

- 依赖尽量锁版本；高风险依赖和运行时工具要有来源说明。
- 能在 sandbox / mock / stub 验证的逻辑，不直接上真实副作用环境。
- 对生成代码优先做类型检查、测试、日志验证和最小 smoke，再谈合并。

### 5.7 观测与熔断

- 高风险链路要有审计日志、失败告警和可关闭开关。
- Agent 侧需要考虑 prompt injection、memory poisoning、excessive agency 和跨租户数据泄漏。
- 当链路可信度不足时，默认降级到“建议模式”，而不是继续自动执行。

### 5.8 外部资料与联网默认值

- 技术文档优先使用官方文档源，不先依赖社区二手总结。
- OpenAI 专项默认走官方文档 / Docs MCP；其他库、框架、SDK 默认优先走 `Context7`。
- 只有当问题具有明显时效性、官方文档不足、或需要外部事实核验时，才升级到 `web`。
- 对外部网页、issue、README、博客和搜索结果，一律按不可信输入处理。
- 允许联网时，优先最小域名白名单、最小 HTTP 方法和最小必要数据暴露。
- 下载到本地的“PDF/Word/数据表”必须同时校验 HTTP 结果、实际文件类型、标题/页数或 schema、来源 URL、访问时间和内容哈希；扩展名、200 状态和搜索摘要都不证明内容正确。
- 链接漂移、网页壳、无关文件、登录墙或下载失败必须记录失败与权威替代路径；不得改扩展名后继续使用，也不得写成“已读原文”。
- 规划方法优先来自监管/标准/专业机构，产品参数来自原厂规格与用户手册，成本和供货来自同口径书面 RFI/RFQ；营销页、媒体稿和二手方案不能跨层代替。

### 5.9 用户研究输入的默认处理方式

当用户提供一手调研数据时，默认按下面顺序吸收：

1. 原始材料先压成结构化摘要
- 用户是谁
- 在什么场景下
- 想完成什么任务
- 卡在什么地方
- 当前替代方案是什么
- 哪句话最能代表真实痛点
- 什么结果算“真的有帮助”

如果提供材料的人本身就是目标用户，还要额外补两组信息：

- 哪些困难是身体 / 发音 / 疲劳本身带来的
- 哪些困难是社会互动、误解、催促、羞耻感或环境设计带来的

2. 再翻译成产品输入
- JTBD
- 关键情绪与阻力
- UI / 文案 / 交互约束
- 不该做什么
- 可验证的 acceptance signal

3. 最后才进入开发
- 改 PRD
- 改页面 / API / contract
- 改验证标准

如果用户愿意自己做研究，agent 不替代研究本身；agent 负责把用户给的数据整理、对齐并落成产品与工程输入。

## 6. 必须进仓库的工件

治理规则如果只存在于人脑里，AI 下一轮就会继续回流。

所以至少要落到下面几个位置：

- 项目级规则：`AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md`
- 体系文档：本文档
- 任务模板：`research/templates/AI_EXECUTION_PLAN_TEMPLATE.md`
- 治理 Prompt 模板：`research/aiprompts/GOVERNANCE_PROMPT_TEMPLATE.md`
- 守卫：lint / CI / 脚本 / deprecated 日志

当前仓库中的最小机械守卫已经落到：

- `scripts/check_ai_docs.sh`：校验入口规则和深文档没有漂移
- `scripts/check_ai_governance.sh`：阻止 compat 路径和旧页面入口重新被新代码引用
- `.github/workflows/ai-doc-guard.yml`：在 CI 中同时执行文档 harness 与治理守卫
- `scripts/docker-rebuild-core-fast.sh`：生产 Docker 部署 harness；环境变量更新使用 `env-backend` 只重建 backend，单服务代码改动使用 `backend` / `frontend`，只有核心链路共同变化才使用默认 `core`，不先执行 `docker compose down`
- `scripts/docker_disk_maintenance.sh`：Docker 磁盘维护 harness；`status` 先盘点，`prune-safe` 清理全部 dangling images、7 天前停止容器、未使用网络和全部未使用 Build Cache；Build Cache/停止容器/未使用网络可重建，运行容器、卷、`latest` 和 `pre-*` 回滚镜像保留。持久化卷不自动删除，只盘点并告警
- `voxflame-docker-disk-maintenance.timer`：每日自动检查根盘；达到 `VOXFLAME_DOCKER_AUTO_PRUNE_ROOT_THRESHOLD_PERCENT`（默认 60%）才调用 `auto -> prune-safe`，不清理运行容器、卷、`latest` 或 `pre-*` 回滚镜像
- `/etc/logrotate.d/voxflame-host-logs`：宿主机 bind-mounted `logs/*.log` 每日轮转，单文件达到 50 MiB 时提前轮转，保留 14 份压缩副本；不删除 JSONL 诊断或业务数据文件

另外，仓库级 instructions 至少要明确：

- 当前环境常用 build / test / smoke 命令
- 如果 `docker compose` 在当前机器权限不足，何时回退到 `sudo docker compose`
- Docker 部署遵循最小影响面：环境变量更新只 recreate 目标服务，单服务代码更新只 build/up 目标服务，不把 `docker compose down` 作为默认前置步骤
- Docker 清理先保留运行镜像与显式回滚标签；默认禁止用 `docker system prune -af` 代替精确的 dangling image / 过期 build cache 清理
- 哪些验证必须在浏览器、哪些验证必须在容器、哪些验证必须在脚本
- 哪些工具 / skill / MCP 是默认入口，哪些只在特定条件下启用

### 6.1 协作系统的自演进机制

这套体系不是静态手册，而应随着协作自动优化。

默认触发下面三类动作：

1. 自动吸收经验
- 同一类判断、坑点、命令或验证方式在 2 次以上任务中重复出现时，应上升为仓库规则、模板、脚本或路由文档，而不是继续只存在于聊天记录里。

2. 自动清理失效内容
- 当旧计划、旧排障记录、旧兼容说明已经被主文档或新事实源吸收后，应及时从入口文件、导航和状态文件中清走，避免 AI 继续把历史内容当现役事实。

3. 自动同步关键状态
- 任务完成后，稳定结论至少同步到 `.claude-summary.md` 和 `.tasks/current.md`；如果是协作规则变化，还要继续同步到 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md` 和相关 workflow 文档。

### 提交与推送的简洁沟通规则

- Git 提交说明默认只写一行 `类型: 核心改动`，不附长篇过程、文件清单或测试流水；必要的风险与验证证据留在任务记录。
- 提交/推送过程只报告关键进度或阻塞；完成回复只给结果、分支和短 commit hash，必要时补一句重要风险，不重复展开修改详情。
- 简洁不等于省略验证或混淆状态：本地提交、远程推送、部署和数据库迁移分别报告；未成功的动作不得声称完成。
- 用户要求详细说明时再展开。

### 6.2 需要继续补强的协作基础设施

结合 2026-04-06 的新增工程观察，这套协作系统后续最值得继续补的，不是“让 agent 拿到更多自由”，而是让上下文、并发和审批更可控。

1. `context assembly` 文档化
- 协作系统应明确区分：
  - 静态可缓存规则
  - 本轮动态任务边界
  - 附件化的大对象或低频状态
- 目标不是写更长 prompt，而是减少 prompt 漂移和缓存穿透。

2. 工具并发安全元数据化
- 除了人工判断“是否适合并行”，后续应尽量把工具或脚本补成更显式的并发安全分级。
- 例如：
  - 只读搜索 / 读文件 / 文档检索：默认可并行
  - 写同一文件、改同一模块、带副作用命令：默认串行

3. synthesis-only delegation contract
- 如果使用子 agent，默认要求其回传：
  - 关键发现
  - 风险
  - 结论
  - 需要主线程接手的阻塞点
- 不默认回传完整探索流水，避免主线程上下文被污染。

4. 拒绝追踪与优雅降级
- 高风险命令或工具如果在同一任务中反复被拒绝，应考虑触发更保守的人工确认模式。
- 目标不是继续碰运气，而是主动收紧自动化边界。

5. 短期日志与长期规则分层
- `.tasks/current.md`、临时计划和任务记录继续承接短期工作记忆。
- 重复出现的坑点、命令套路、验证路径和收口原则，应异步蒸馏进：
  - 系统文档
  - 模板
  - 守卫脚本
  - CI / lint
- 一句话：日志追加和长期规则不能混写在一个层里。

### 6.1.1 Harness 入口与规则单一事实源

- 每轮任务先读取根 `AGENTS.md`，再按 `research/aiprompts/HARNESS_ENTRY_CONTRACT.md` 判断是回答、诊断、变更、研究、遥测触发还是高风险变更。
- 研究生命周期和证据门只写在 `research/RESEARCH_HARNESS.md`；阈值、状态集合、自动动作和人工确认边界只写在 `research/HARNESS_RULES.yaml`。
- `scripts/research/` 只能读取并执行上述规则，禁止复制一套隐藏阈值或自行改变研究状态。
- 动态事实放摘要/任务/研究条目；长期规则放入口/体系文档；运行时配置放代码与部署文件。三者必须通过脚本和文档检查保持可追溯。

### 6.3 研究事实源与应用回流

研究系统同样必须防止平级事实源扩散：

- `references/clear-vox-model` 是模型代码、实验配置、逐实验记录和原始结果的上游 Git submodule，不在应用仓库复制或改写实验事实。
- `research/` 是仓库唯一文档根，同时承接应用研究、产品、运行时、工程规则、运维、合规和模板。五类主题目录仍负责研究综合、证据限制、应用决策和验证门槛；`aiprompts/` 与 `templates/` 负责协作流程，不参与研究状态判定。
- 不再恢复平级 `docs/` 目录；旧计划被现役事实源吸收后直接删除，由 Git 历史保留。
- 每条会影响应用的研究结论必须进入 `research/APPLICATION_FEEDBACK_REGISTRY.md`，固定到上游 commit / 来源版本，并标记 `adopt / validate / hold / reject`。
- 任何学术/专利/公开成果、产品默认能力或范围扩展都必须先通过 `research/evidence/*#authority_gate`；来源、独立复核、反证、边界和回退缺一不可。
- `planned`、`blocked`、`diagnostic-only` 和低于实验阈值的候选不得直接变成部署配置或用户承诺。
- 模型离线指标不能替代陌生人沟通成功率、P95 延迟、可打断性、设备稳定性和目标用户验证。
- 医疗 / 健康检测结论必须额外经过临床证据、专家复核、隐私和合规门禁；研究信号不等于诊断或治疗建议。

研究回流的默认闭环是：

```text
上游实验 / 论文 / 用户研究
  -> 证据与限制
  -> 应用决策状态
  -> 现役 owner 与最小切片
  -> 验证和回退
  -> PRD / task / code
```

更新 submodule gitlink 只表示上游版本变化，不表示应用已经采用其中模型或结论。必须先更新应用回流登记并完成对应验证。

## 7. VoxFlame 的默认判断

### 7.1 产品判断

- 任何治理动作都不能破坏主链路：`Frontend LiveKit RTC/Data -> Backend /api/rtc/session/* -> self-hosted livekit-server -> livekit_agent`
- 对构音障碍用户来说，可理解性和授权边界优先于“更自动”
- local-first、最小必要存储、会话可打断保持不变

### 7.2 工程判断

- 前端：优先统一页面入口、Hook 和状态模型，避免多套平级页面逻辑
- 后端：Controller 处理边界，Service 处理业务；不要把 compat 当新主路径
- Agent：命令、记忆、广播、纠错链路都要明确唯一事实源和回退路径
- 数据：主链路和旁路系统一起盘点，不只看页面能不能跑

### 7.3 VoxFlame 的工具选择升级梯度

当 agent 不确定该用什么资料或什么工具时，默认按下面顺序升级：

1. 代码与仓库文档
- 先读代码、`AGENTS.md`、`.tasks/current.md`、`research/README.md` 和相关权威主文。

2. 专业官方文档
- 库、框架、SDK、浏览器 / 平台 API 不确定时，优先 `Context7`。
- OpenAI 产品问题优先官方 OpenAI 文档 / Docs MCP。

3. 仓库内 workflow / skill
- 任务命中明确方法论时，再激活最小必要 skill；不要为了“用 skill”而硬叠流程。

4. 运行态验证
- 页面和交互问题优先 `Playwright`；容器和后端问题优先脚本、日志和 compose 验证。

5. 外部联网检索
- 只有在需要最新事实、对比外部产品、查询法规 / 新闻 / 价格 / 社区状态时，才升级到 `web`。

一句话规则：

**先本地，后官方；先文档，后联网；先验证，后结论。**

## 8. 默认反模式

以下做法默认视为退化：

1. 新方案出来后，旧入口继续开放且没有删除条件
2. 在 compat 或 deprecated 路径上继续堆新业务逻辑
3. 只改主链路，不改统计 / 记忆 / 搜索 / 审计等旁路系统
4. 把“又新增一套统一实现”误认为“已经完成治理”
5. 用推荐、约定、自觉代替 lint / CI / 脚本守卫
6. 让不可信输入直接驱动工具、命令或数据写入
7. 让 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md` 与本文长期漂移

## 9. 维护顺序

当 AI 协作机制、治理规则或安全默认值发生实质变化时，按下面顺序更新：

1. 本文档
2. `research/templates/AI_EXECUTION_PLAN_TEMPLATE.md`
3. `research/aiprompts/GOVERNANCE_PROMPT_TEMPLATE.md`
4. `research/aiprompts/SKILL_ROUTING_GUIDE.md`
5. `research/README.md`
6. `AGENTS.md`
7. `CLAUDE.md`
8. `.github/copilot-instructions.md`
9. `.claude-summary.md`
10. `.tasks/current.md`

最后运行：

```bash
bash scripts/check_ai_docs.sh
```

## 10. 参考

- OpenAI, Harness Engineering: https://openai.com/zh-Hans-CN/index/harness-engineering/
- OpenAI, A practical guide to building agents: https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- OpenAI, Building guardrails for agents: https://openai.github.io/openai-agents-js/guides/guardrails
- OpenAI, Docs MCP: https://developers.openai.com/learn/docs-mcp
- OpenAI, Codex internet access: https://developers.openai.com/codex/cloud/internet-access
- OWASP Agentic Security Initiative: https://owasp.org/www-project-agentic-security-initiative/
- OWASP Top 10 for LLM Applications / Agentic AI: https://genai.owasp.org/
- Anthropic, Claude Code common workflows: https://code.claude.com/docs/en/tutorials
- GitHub, Repository custom instructions for Copilot coding agent: https://docs.github.com/en/copilot/how-tos/agents/copilot-coding-agent/customizing-the-development-environment-for-copilot-coding-agent
- GitHub, MCP and Copilot coding agent best practices: https://docs.github.com/en/copilot/concepts/coding-agent/mcp-and-coding-agent
