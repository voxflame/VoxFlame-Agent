# RO-015 方言与普通话配对语音采集设计（2026-09-03）

## 摘要

本研究评估 VoxFlame 在注册阶段收集方言自述，并在训练录音中为同一条题面提供“普通话一遍、方言一遍”的可选采集模式。结论是：

1. 用户自报的“粤语、四川话、闽南语”等可作为**来源标签**，足以驱动个性化采集提示，但不能直接当作经过语言学核验的语言真值。
2. 数据层应同时保留原始自述、可选标准语言标签和标准化状态；未知时保留 `NULL`，不强行映射。
3. 普通话和方言录音共享 `utterance_pair_id`，但每个录音仍是独立、可撤回、可训练过滤的样本。方言录音跳过时只留下普通话样本，不制造空音频或“失败配对”。
4. “同一句话”定义为同一意图/提示语义，不要求方言逐字复现普通话书面文本；方言可以有合法的词汇、语序、语法和音系差异。
5. ASR 对方言的识别结果只能作为诊断提示，不能作为收录门槛，也不能以普通话 `target_text` 直接判定方言错读。
6. 方言样本需要和病种、构音障碍状态、设备、地点等元数据分层统计；训练、验证、测试必须按说话人隔离，避免同一人的普通话/方言配对跨集合泄漏。

研究状态保持 `evidence_review`：当前设计可做内部原型和小规模验证，尚不证明模型收益或医疗效果。

## 现有代码链路审计

- 注册页已经收集省份、城市、姓名、电话、残疾类别、病种、证件类型/号码，以及可跳过的 `has_dialect` 和 `dialect_name`。
- `user_profiles` 是 backend-owned 画像事实源；workspace 只下发训练所需的非敏感登记字段。
- 证件号不得进入 workspace、日志、manifest 或 `voice_contributions.metadata`。现有迁移用 Auth 触发器先写画像再从 Auth metadata 移除证件字段；迁移执行前仍需 dry-run 和权限核验。
- 前端上传元数据原先已经允许 `speech_variant`、`dialect_name`、`utterance_pair_id`，但 backend 白名单缺少这些键，会静默丢弃。已补齐 backend/client 白名单，并增加 `dialect_name_user_reported`、`label_source`、`language_tag` 等预留键。
- 当前 `TrainingRecorderPage` 在停止录音后立即移动到下一句，因此尚未支持配对采集；需要独立的变体状态机，不应在回调中用布尔值临时拼接。

## 证据与来源

### 1. 语言标签标准

RFC 5646 说明语言标签用于标识口语/书面/手语等语言，并允许用 region、variant、extension 和 private-use 表达语言变体；IANA 注册表将 `cmn`（Mandarin Chinese）、`yue`（Yue/Cantonese）、`nan`（Min Nan Chinese）、`hak`（Hakka）、`wuu`（Wu）、`gan`、`hsn`、`cjy`、`cpx` 等列为 `zh` 宏语言下的语言代码。RFC 同时明确：private-use 标签的含义由项目约定，不应在已有标准代码时替代标准代码。

**应用推论**：

- 采用双层字段：`dialect_name_user_reported`（原文）+ `language_tag`/`dialect_code`（可选标准化值）。
- `language_tag` 为空不是错误，表示尚未核验或用户自述无法映射。
- 中国省市不是语言代码；`province/city` 只能作为人口与采样分层字段，不能自动推断方言。
- 混合或无法判定时使用项目状态 `mixed_or_uncertain`；不要伪造 `x-*` 标签作为“官方语言”。

### 2. 语言变体与构音障碍必须分开

仓库保存的 ASHA《Dysarthria in Adults》页面指出，构音障碍是神经源性言语障碍，评估应同时关注构音、发声、呼吸、共鸣、韵律、可懂度、沟通效率和社会参与；页面还要求治疗计划考虑使用者的**所有语言和具体方言**。这支持“记录方言以提高系统理解”的产品方向，但不支持把方言差异当成病理错误或自动诊断。

**应用推论**：

- `speech_variant`（普通话/方言）是语言情境标签；`disability_category`、`etiology`、严重度是健康/用户画像标签，三者不互相替代。
- 方言 ASR 低置信度、普通话转写不一致、方言词汇差异只能进入 `quality_status`/诊断旁路，不得自动拒收构音障碍样本。

### 3. 数据集文档、代表性与隐私

Gebru 等人的 *Datasheets for Datasets* 要求记录数据来源、缺失值、关系、推荐切分、错误/噪声、同意、撤回和分布；Bender 等人的 *Data Statements for NLP* 明确要求描述语言变体（示例包括 `yue-Hant-HK`）、说话人群体、方言/语言差异、失语/构音障碍等语言行为因素、时间地点和录音质量，并指出隐私可能要求使用范围而非精确人口信息。

**应用推论**：

- 每个数据集版本应有方言分布、病种分布、设备/场景分布和缺失率报告。
- 注册画像中的姓名、电话、证件号与训练样本解耦；训练只带最小必要标签。
- `contributor_id` 是租户隔离键；说话人拆分优先按 contributor，而不是按录音随机拆分。
- 用户撤回应能按单个 recording 处理，同时不连带删除同一 `utterance_pair_id` 的另一成员。

### 4. 方言 ASR 的工程现实

KeSpeech 作者仓库将其描述为“普通话及八类子方言”的开放语音数据集，说明方言应作为显式数据维度管理，而非把所有中文声音折叠为普通话。相关公开研究的 arXiv 摘要（Qifusion-Net、M2R-Whisper、MMGER）分别把多口音/子方言识别作为独立问题，并在 KeSpeech 等数据上报告相对基线改善；这些结果是离线模型证据，不是 VoxFlame 用户收益证据，也不证明任何特定方言或构音障碍人群的泛化。

## 推荐数据模型

### A. 用户画像（`public.user_profiles`，backend owner）

```text
has_dialect: boolean | null                 -- null = 跳过/未知
dialect_name: text | null                   -- 兼容旧字段，用户自述
dialect_name_user_reported: text | null     -- 新字段，建议作为最终命名
dialect_language_tag: text | null           -- BCP 47/ISO，可空
dialect_code_status: enum                   -- user_reported | normalized | mixed_or_uncertain
```

建议先保留现有 `dialect_name`，新增标准化字段时通过一次兼容迁移承接，不复制一套画像 owner。方言登记更正应写入画像审计字段（操作者、时间、来源），不改写历史录音标签。

### B. 每条录音（`voice_contributions.metadata` 与 manifest）

```text
speech_variant: mandarin | dialect
prompt_language: cmn                         -- 题面/提示语言
spoken_language: cmn | <BCP47 tag> | null    -- 实际说话语言，未知可空
dialect_name_user_reported: string | null
dialect_code: string | null
label_source: user_reported | reviewer_verified | derived
utterance_pair_id: UUID | null
pair_role: mandarin | dialect
pair_status: unpaired | mandarin_only | complete  -- 派生视图优先
target_text: string                           -- 普通话题面/意图锚点
spoken_text: string | null                    -- ASR/人工转写，不当作唯一真值
```

`pair_status` 不必复制进不可变录音；由同一 contributor、`utterance_pair_id` 和有效收录状态在数据集视图中派生，避免撤回一条后另一条留下过时状态。

### C. 混合语言/代码切换

一条录音中混入普通话和方言时，保留 `speech_variant: mixed`（若当前 schema 暂不扩展，可先使用 `speech_variant: dialect` + `spoken_language: mul`，并写 `label_source`/备注）。后续若需要逐词训练，再增加 token/span 级语言标签；不要把一条混合录音强行拆成多个音频文件或套用单语言 target。

## 推荐采集流程

```text
注册：方言使用？可跳过
  ├─ 未填写/没有 → 普通话录音，保存后进入下一句
  └─ 有 + 名称 → 当前句生成 pair_id
                  普通话录音 → 确认收录
                    ├─ 再用方言说一遍（可跳过）→ 方言录音
                    └─ 跳过方言，下一句
```

必须满足：

- pair_id 在普通话和方言两次录音间稳定；重录只替换当前 `pair_role`。
- 方言录音可跳过、失败或稍后补录；不阻塞普通话样本和句子进度。
- 刷新/重新进入不能凭空生成半配对；只有客户端持久化了明确的 `pair_id + role` 草稿才可恢复。
- 上传/撤回以 recording_id 为单位；撤回方言不得删除普通话成员。
- 进度仍按句子级计算，普通话成功即可计入已读；方言完成率单独统计。

## 题面、转写与评分

### “同一句”采用语义对齐

普通话题面 `target_text` 是共享意图锚点。方言可以没有统一书写形式，也可能使用不同词汇表达同一意图，因此不把方言录音的 ASR 文本直接与普通话字面做 CER 门槛。可选字段：

- `prompt_intent_id`：同一语义提示的稳定 ID；
- `dialect_transcript`：由熟悉该方言的人工/工具转写；
- `translation_to_mandarin`：仅在研究标注需要时提供；
- `alignment_status`：`not_reviewed | semantically_aligned | uncertain`。

ASR 结果应标为 `asr_hint`，并把“方言未被识别”与“用户没有按题意说”分开。构音障碍用户的停顿、重复、音节变形和低音量也不能仅靠 ASR 自动删除。

## 训练与评测设计

1. **切分单位**：按 `contributor_id` 做 speaker-disjoint；同一人的普通话和方言 pair 必须在同一 split。
2. **文本隔离**：固定测试集中的 prompt/意图不应被训练集以同一文本泄漏；至少保留 text-unshared 子集。
3. **分层报告**：总体、方言标签、病种/残疾类别、严重度、设备、噪声、短句/长句分别报告 CER/WER、拒识、延迟和用户完成/跳过率。
4. **小样本策略**：样本量不足的方言只进入 `validate`/shadow 评测，不承诺专项模型收益；不要用单个用户的配对样本代表方言群体。
5. **真实目标**：除 ASR 指标外，记录“沟通伙伴一次听懂 / 看文字后懂 / 需要重说”、方言用户完成率和疲劳；离线 CER 改善不等于真实沟通改善。

## 隐私、同意与访问

- 方言、病种、残疾类别与声音组合可形成敏感画像；注册同意应明确“用于画像”“用于训练/研究”两个目的，支持分别撤回。
- 证件号、电话、姓名、精确地址不进入训练元数据、manifest、ASR prompt、日志或前端 workspace 响应。
- 省/市只做粗粒度分层；小样本方言组不得在导出报告中暴露可重新识别的组合。
- 后端应记录谁在何时访问/导出方言样本；导出使用不透明 recording_id，避免把姓名或手机号写入文件名。

## 验证计划与停止条件

### 工程验证

- 纯状态机测试：无方言、方言完成、方言跳过、普通话重录、方言重录、方言撤回、刷新恢复、跨账号隔离。
- 上传契约测试：client/backend 白名单保留方言字段；证件字段始终被丢弃；manifest 中 pair_id/role 一致。
- 生产前 migration dry-run：统计已有画像行数、可回填字段数、冲突数、证件字段存在数；只允许空字段回填。
- Playwright：注册字段、方言选择、训练页提示和“跳过方言”按钮；不创建真实用户。

### 停止/回退

- 方言跳过率高、疲劳或完成率下降：降低默认触发比例，保留手动入口。
- 方言样本被 ASR/质量规则误删，或普通话样本进度被阻塞：立即关闭配对强制逻辑，回退为普通话单流；保留已上传原始样本。
- speaker 泄漏、证件/电话进入 manifest、跨账号串读：停止导出与训练导入，撤回受影响版本并修复权限/切分。
- 固定 speaker-disjoint 评测无收益、最差方言/病种回退或真实沟通不改善：保持 `validate` 或转 `hold`，不得扩大采集承诺。

## 结论与下一步

可以批准“可选方言配对采集”的内部原型设计，但不应把用户自报方言直接当作标准语言标签，也不应让方言 ASR 准确率成为用户录音资格门槛。下一步应先实现纯状态机和字段契约，再做小规模 shadow 采集；完成 speaker-disjoint、分层和真实沟通评测后，才决定是否进入默认推荐或模型训练导入。

## 来源清单

1. RFC 5646, *Tags for Identifying Languages*, https://www.rfc-editor.org/rfc/rfc5646.txt （本地核验 SHA-256 `5d9515f053163c80e7294a84d18217dc83471acc7caa9773da2ac40deeec8228`，访问 2026-09-03）。
2. IANA Language Subtag Registry, https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry （本地核验 SHA-256 `be21e91b6851f750a7b1a687f11209d46ad5a8471d6b10a1efc8d1dac4c8a926`，访问 2026-09-03）。
3. Gebru et al., *Datasheets for Datasets*, arXiv:1803.09010, https://arxiv.org/abs/1803.09010 （本地 PDF 核验 SHA-256 `c7f595988ee2c109631d5173fdae37ff1774c68ec17add51bd012f2a6e8792d0`）。
4. Bender & Friedman, *Data Statements for NLP*, TACL 2018, https://aclanthology.org/Q18-1041/ （本地 PDF 核验 SHA-256 `da123cf0cc7dfb32479066ce01e0d107c312cff0c2818f9abfccb101c6005ff2`）。
5. ASHA, *Dysarthria in Adults*, https://www.asha.org/practice-portal/clinical-topics/dysarthria-in-adults/ （仓库本地保存页面，访问/核验 2026-08-17；用于语言/方言与构音障碍边界）。
6. KeSpeech project repository, https://github.com/tzyll/KeSpeech （作者仓库 README，访问 2026-09-03；仅支持“普通话+八类子方言”数据集存在这一范围性事实）。
7. Chen et al., *Qifusion-Net*, arXiv:2407.03026, https://arxiv.org/abs/2407.03026 （摘要访问 2026-09-03；离线多口音 ASR 机制证据）。
8. Zhou et al., *M2R-Whisper*, arXiv:2409.11889, https://arxiv.org/abs/2409.11889 （摘要访问 2026-09-03；离线子方言 ASR 机制证据）。

外部访问限制：OpenReview 的 KeSpeech 原始 PDF 返回 403，先前下载的同名 PDF 经 `pdfinfo`/文本核验为无关引力理论论文，已不作为证据；本报告只使用作者仓库 README 与可核验题录/摘要，不虚构论文细节。
