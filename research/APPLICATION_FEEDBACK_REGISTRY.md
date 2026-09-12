# 研究到应用回流登记

> 更新日期：2026-08-22
>
> 这是研究结论影响 VoxFlame 应用的唯一登记表。原始实验结果以 `references/clear-vox-model` 为准，本表不改写实验事实。

## 门禁

1. 必须给出固定上游 commit、实验/研究路径和可核验结果。
2. `planned`、`blocked`、`diagnostic-only`、低于实验门槛的候选不能标为 `adopt`。
3. 模型离线指标不能直接替代陌生人沟通成功率、延迟、可打断性、设备稳定性或目标用户体验。
4. 医疗/健康能力还需临床证据、专家复核、隐私与合规门禁。
5. 进入代码前必须指定 owner、最小切片、回退方式和验证信号。
6. `agent-systems` 研究必须拆开记录机制、工程、产品和场景四类证据；通用 Agent 或文本 Agent 的结果不能单独证明语音 Agent 可部署。
7. 涉及语音的通用机制必须补充语音特有的误识别、端点/打断、延迟、隐私和误触发风险，并给出语音场景验证信号。

## 当前登记

| ID | 主题 | 上游证据 | 结论与限制 | 状态 | 应用动作 / owner | 验证信号 |
| --- | --- | --- | --- | --- | --- | --- |
| RF-001 | 语音底层 | `0997c0d` · `modules/dsr/R&D/Qwen3-ASR/EXP/EXP-INDEX.md` · EXP-16 | SpecAugment、VTLP、RIR、带宽、Opus、pooled-style FiLM 等当前 recipes 未带来稳定 CER 改善，多数已 rejected | `reject` | `livekit_agent` 不引入这些 recipe；模型研究继续留在上游 | 防止配置/文档把 rejected recipe 标成现役优化 |
| RF-002 | 语音底层 | 同上 · EXP-17A | real short spans 相对强基线仅净省 54 errors / 0.0660 pp，低于 0.5 pp 门槛 | `validate` | 只设计针对 VoxFlame 真实短词/短句的离线 shadow evaluation；模型 owner：CLEAR-VOX-MODEL，应用 owner：`livekit_agent` | 固定集 CER、1–3 字错误、真实沟通任务成功率、P95 延迟均不回退 |
| RF-003 | 语音底层 | 同上 · EXP-18D | personal adapter teacher 有局部正向，但上游要求最终蒸馏成一个无状态 shared student；尚非部署证据 | `hold` | 不把个人 adapter/router 带入应用会话；等待 shared student 与完整对照 | 无状态部署、跨用户隔离、总体与 severe 分层指标达到门槛 |
| RF-004 | 语音底层 | 同上 · EXP-21 | 1h curriculum endpoint `28.2306%`，明显差于既有 endpoint，且机制 closeout 未完成 | `reject` | 不接入该 checkpoint，不改变 Qwen-first 当前运行配置 | 部署配置不得引用 EXP-21 artifact |
| RF-005 | Voice agent | [上下文与记忆综合](voice-agent/CONTEXT_AND_MEMORY_RESEARCH_SYNTHESIS_2026-08-14.md) | 上下文必须有窗口、熔断、作用域和写入边界；session state 不能冒充 durable memory | `adopt` | 继续以 `backend workspace` 为 durable owner，LiveKit 只承接 session-local state | 单元测试覆盖窗口/热词/会话隔离；workspace 写入需显式路径 |
| RF-006 | 产品心理 | [Voiceitt 对照研究](product-psychology/VOICEITT_FEATURE_SETTINGS_ANALYSIS_AND_VOXFLAME_INSPIRATION_2026-05-15.md) | 个性化训练、编辑后代播、首选麦克风和数据控制有直接产品价值；不照搬复杂设置面 | `adopt` | 通过现有沟通、训练、准备和设置 surface 逐切片承接 | 目标用户任务成功率、操作步数、放弃率与错误恢复 |
| RF-007 | 医疗/健康 | [康复产品映射](speech-health/VOXFLAME_REHAB_THERAPY_PRODUCT_MAPPING_BY_ETIOLOGY_2026-05-15.md) | 疗法锚点可指导训练设计，但当前应用不能宣称诊断、自动治疗或替代临床评估 | `adopt` | 文案与功能保持“沟通支持/训练反馈”；新增健康检测必须单独评审 | 专家复核、目标人群研究、风险文案与合规检查 |
| RF-008 | 声音与沟通表现 | [报告研究](speech-health/VOICE_AND_COMMUNICATION_PERFORMANCE_REPORT_RESEARCH_2026-08-16.md) · Shor 2019 · ASHA · ELS/UEP 共识 · 2024–2026 会话 ASR、核心结局、表达教练与伙伴训练研究 · Orai/ELSA/Yoodli/Voiceitt/Poised/Project Relate/Apple/Microsoft 官方能力 | 可采用字符编辑距离、音系错误、节奏、静音、收音、用户预设要点、伙伴听懂结果和个人趋势做低风险沟通反馈；固定词与自由表达必须分开；5 分钟仅作 Shor 英语 ALS 实验的研究参考；禁止自动医学分级 | `validate` | Web/App 20词筛查增加体验版沟通表现报告；不新增入口。自由表达、A/B 复测和伙伴确认只作为现有验证/报告流程内的候选增强，完成用户研究后再落地。owner：训练工作台 | Web 回归与真实登录录音；目标用户和普通用户理解率；同设备复测稳定性；伙伴确认可用性；无诊断性文案或持久化医学标签 |
| RF-009 | 沟通入口收口 | 仓库内 `/communicate`、quick phrases、workspace loadout 与 LiveKit agent 数据流复核 | “把话表达出去”是唯一用户目标；通用短语和手动输入只需本机朗读，不应被登录或 agent 阻塞；持续理解、个人短语与 workspace 才需要身份。场景/材料/短语的长期维护只属于记忆页，不能在沟通页再造一套配置面 | `adopt` | 唯一 `/communicate` 同页承接快速表达与日常沟通；删除 `/chat`、`/communicate/live` 和固定场景选择组件。匿名快速表达零 RTC/agent；日常沟通按需登录、挂载 agent，并自动读取 workspace 默认准备。owner：沟通工作台 / 记忆页 | 匿名 `/communicate` 为 200，旧入口均直接 404；点击快速短语不产生 RTC session 请求；进入日常沟通前不挂载 agent；记忆页选择能进入 preparation context；真实账号麦克风 smoke |
| RF-010 | 硬件产品路线 | [首家供应商产品功能需求](product-engineering/RANYAN_HARDWARE_PRODUCT_REQUIREMENTS_FIRST_SUPPLIER_2026-08-17.md) · [通用供应商产品方案](product-engineering/RANYAN_HARDWARE_PRODUCT_PLAN_GENERAL_SUPPLIER_2026-08-17.md) · [参数台账](product-engineering/evidence/ranyan-hardware-product-2026-08-17/PARAMETER_LEDGER.md) · [来源清单](product-engineering/evidence/ranyan-hardware-product-2026-08-17/SOURCE_MANIFEST.md) | P0 是证据项目，G1 是唯一近期产品候选，G2 是条件期权，G3—G7 是独立产品线期权；原厂事实、采购门槛、候选配置和整机研究目标已分开。芯片、BOM、重量、续航和性能尚未由用户验证、书面报价与样机共同冻结；监管材料不构成分类、认证或医疗有效性 | `validate` | 先完成目标用户 P0 交叉 A/B、支付方访谈与 intended use 预分类；样本量由统计计划与人群分层确定，不以草案数字冒充冻结方案。Gate 0 通过后向至少两家供应商发同口径 G1 RFI/RFQ。owner：产品 + 硬件/移动端 + 质量/法规 + 经营负责人 | 相对裸手机的真实任务增益、携带接受、音频路由可靠、支付信号、完全落地成本、两家报价、法规边界与可停止决策门同时成立 |
| RF-011 | 普通话语言学覆盖与采集闭环 | [普通话语言学覆盖与构音障碍采集基线](speech-health/MANDARIN_LINGUISTIC_COVERAGE_AND_COLLECTION_BASELINE_2026-08-22.md) · Lee & Zee 2003 · 版本化规范字常用读音集合 · CC-CEDICT/Tatoeba 核验快照 · 本地题库/manifest · CLEAR-VOX-MODEL EXP-1/2/13/17 | SOP 只作现场流程参考；覆盖必须分开审计音系库存、核心音节—声调、词汇扩展读音、连续语流和真实任务。现有 9107 条题库仍缺 217 个音节—声调；按现代词、整词读音证据与默认用户负担分为 88 个默认核心、121 个边缘专项和 8 个争议下线目标。主要依赖贬损、地域、醉酒、虐待或犯罪承载词的形式仍保留在全音台账，但不进入默认任务。88 个核心目标各有 3 条待审候选，共 263 条唯一文本（88 词、175 短句；每目标 1 词 + 2 句）；175/175 句都有句内整词拼音证据，高负担词锚点已替换为同音中性词。候选均未批准，生产导入仍为 0。1185 条去重应用录音仍没有独立人工 `spoken_text`；覆盖增长不等于模型收益 | `validate` | 保持版本化全量台账、同源状态门和六项发布门；原音组练习保留，“核心补音”只读取全审批准导出，边缘/争议不混入默认任务。下一步由语言学与目标用户审核 263 条候选，再做小规模采集和固定 baseline 消融。owner：训练工作台 + 数据管线 + CLEAR-VOX-MODEL | 核心候选批准率与目标覆盖；目标用户完成/跳过/疲劳；人工转写一致性与 audio-text 完整性；speaker-disjoint overall/worst/短句不回退；真实沟通成功率改善 |

| RF-015 | 方言与普通话配对采集 | [RO-015 方言与普通话配对采集设计](speech-health/RO-015-dialect-paired-speech-collection-2026-09-03.md) · RFC 5646 · IANA Language Subtag Registry · Datasheets for Datasets · Data Statements for NLP · ASHA Dysarthria in Adults · KeSpeech 作者仓库/多口音 ASR 题录 | 用户自报方言可做来源标签和可选采集分流，但不能当作已核验语言真值；普通话/方言按同一语义题面用 `utterance_pair_id` 关联，方言录音可跳过，ASR 不匹配不作为拒收门槛。证件、电话、姓名不进训练样本；同一 contributor 的 pair 必须在同一 speaker-disjoint split。当前无配对流程设备证据、无 VoxFlame 方言模型收益证据，KeSpeech 原论文 PDF 访问受限 | `validate` | 实现训练工作台纯状态机、前后端元数据契约和 migration dry-run；小规模 shadow 采集后做语言学/SLP/隐私复核与分层 speaker-disjoint 评测。owner：训练工作台 + backend + data governance | 方言选择/跳过/完成率、疲劳、pair 完整率、方言 ASR 诊断率、总体/最差方言与病种 CER、真实伙伴一次听懂、敏感字段泄露数 |

## 新条目要求

## 2026-08-29 工程可靠性闭环

| RF-012 | 训练进度与长历史稳定性 | [RO-012 报告](product-engineering/RO-012-training-progress-stability-2026-08-29.md) · 生产日志与 migration 20260828010000 | 数据库聚合与刷新去重已消除已知循环放大器；真实设备和大历史回归仍待完成 | `validate` | 训练工作台 owner；完成 308 账号设备 smoke、1k/5k/20k 基准后再升级 | progress P95、恢复率、重复刷新率、跨设备一致性 |
| RF-013 | Docker 与宿主资源治理 | [RO-013 报告](product-engineering/RO-013-docker-resource-governance-2026-08-29.md) · Docker 官方 prune 文档 · 主机 df/定时器证据 | 安全清理与日志轮转已部署；需要连续趋势和保护对象验证 | `validate` | 平台 owner；维持每日 timer，达到扩容门再评估 | 根盘趋势、回收量、清理耗时、卷/回滚保护 |
| RF-014 | LiveKit/ASR/Agent 实时并发容量 | [RO-014 LiveKit 报告](voice-agent/RO-014-livekit-asr-concurrency-capacity-2026-08-29.md) · [跨模态对照](agent-systems/RO-014-cross-modal-realtime-capacity-2026-08-29.md) · LiveKit 官方文档 | 单 Worker/外部 provider 可能是瓶颈，但尚无真实 RTC 容量结论；不能承诺 1000 路 | `validate` | livekit_agent + 平台 owner；先做 5→10→20→50 路，达标再考虑多 Worker/扩容 | Job、ASR/TTS/LLM P95/P99、拒绝/429、丢包、CPU/RAM/FD |
| RF-016 | Web/App 查表与搜索效率 | [RO-016 查表与搜索效率](product-engineering/RO-016-cross-surface-lookup-efficiency-2026-09-03.md) · 本地调用链审计、Supabase migration、OSS 客户端契约 | 已并行化撤回外部清理、复用 workspace profile、增加活动/目录短缓存；尚无生产 P95 与大历史基准，不能宣称整体延迟达标 | `validate` | frontend + backend + mobile；补阶段耗时、缓存命中和 1k/5k/20k 基准，达标后再升级 | discard/progress/workspace/catalog P95、重复请求率、跨账号隔离、部分清理恢复率 |

| RF-017 | 算力政策与子公司布局 | [RO-017报告与交付记录](product-engineering/RO-017-compute-policy-briefing-2026-09-07.md) · 12个官方网页正文及SHA-256清单 | 已完成8页合伙人商务报告及9项官方依据附录；缺少完整细则与企业资格，不能确认可得补贴 | `hold` | 管理层/财务取得修订细则和书面资格回复；仅供内部汇报，不执行设立、采购、迁移或申报 | 文本排版完整、原稿未改写、官方依据可追溯；独立确认资格前不纳入确定补贴收入 |

| RF-018 | 阿里云充值与GPU商务规划 | [RO-018交付与依据](product-engineering/RO-018-aliyun-budget-and-compute-2026-09-07.md) · 原政策PDF与7份官方原文 | 两份中文Word/PDF已形成审批和征询稿；配置预算为建议，资格/报价/GPU性能未确认，采集与RTC容量严格区分 | `hold` | 管理层/财务/技术独立审核后询价和试机，不执行充值或采购 | 金额/规格一致、来源和全文完整；书面报价、试机、主体资格与合同条款后再决策 |

每个新条目至少回答：

- 来源是否固定到 commit / 版本？
- 证据支持的是机制、离线指标，还是实际用户收益？
- 哪些人群、语言、设备和场景不在证据范围内？
- 进入哪个现役 owner，是否会制造第二套事实源？
- 如何回退，什么结果会让它变成 `hold` 或 `reject`？

### 通用 Agent 研究的额外问题

- 这是可跨模态泛化的机制，还是依赖文本输入的局部技巧？
- 机制、工程架构、产品交互和真实场景分别有什么证据，哪一层仍是假设？
- 对语音输入，ASR 不确定性、停顿、打断、重叠说话和音频隐私会如何改变结论？
- 进入 VoxFlame 时复用哪个现役 owner，如何避免新增平行 runtime / memory / control plane？

### RF-014 补充：FB-008 取消与音频积压（2026-09-10）

[本地修复/官方机制/验证边界](voice-agent/RO-014-voice-pipeline-repair-2026-09-10.md)：已移除TTS重复待播队列、回复FIFO、同步LLM与共享fallback状态，HTTP ASR录音独立归属，增加半双工保护和退出回收。118项合成/入口回归通过；决策保持 `validate`，未部署。没有成员固件或真实播放时间戳，不能宣称AEC或识别准确率已改善。owner：livekit_agent；2026-09-12或取得真机日志时复核。下个门槛为单房间非敏感音频、播放尾音/双讲、连续10句capture一致与原容量保护指标。

### RF-014 / FB-008：工程评测闭环（2026-09-10）

[官方指标协议](voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md)与[本地实测包](voice-agent/RO-014-benchmark-local-2026-09-10.json)已沿现有 RO-014 接入 Harness。采用官方指标定义作为工程方法，不等于采用未验证语音能力；应用决定保持 `validate`。32次实际 TTS 取消函数 + 内存替身仅证明局部机制可测，真实 RTC/识别准确率/设备AEC仍未验证，无基线计时对照，不宣称速度提升或生产通过。
