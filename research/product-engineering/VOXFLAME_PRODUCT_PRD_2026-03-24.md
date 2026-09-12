# VoxFlame Product PRD（当前代码对齐版，2026-05-26）

> 本文只保留当前产品定义、代码现状判断和下一步执行计划。
>
> 已完成的迁移、上线前 blocker、训练页拆层、音频设置、移动端 skeleton、训练语料整理等历史任务，不再放在本文当作未来计划。最近 3 天流水状态仍以 [当前任务](../../.tasks/current.md) 为准。

## 1. 产品定义

VoxFlame 不是“纠正用户声音”的产品，而是“帮助系统更准确理解构音障碍用户意图”的沟通工作台。

长期留存的价值不应来自固定句库本身，而应来自三件事：

1. **不同场景下更高效沟通**：陌生人、医生、家人、工作对象都能更快理解用户当前真正想表达的事。
2. **稳定住内心的东西**：用户在高压场景里不必从空白开始，可以用准备材料、补救句、展示界面和外放来守住表达自主权。
3. **能感受到进步**：训练页只记录可复查的训练表现和系统识别代理指标，不把波动包装成医学疗效。

当前第一优先级仍是沟通成功率；训练和记忆都服务于沟通，而不是反过来让用户为了系统数据结构而练。

## 2. 当前代码事实

### 已经稳定成立

1. 现役唯一主链已经收口：

```text
Frontend LiveKit RTC/Data
  -> Backend /api/rtc/session/*
  -> self-hosted livekit-server
  -> livekit_agent
  -> ASR / TTS / correction provider adapters
```

2. Web 首页已经按 `沟通 / 训练 / 记忆` 三个 surface 组织。
3. 沟通任务已收口为唯一 `/communicate` surface，不再使用 `/chat` 或 `/communicate/live` 子路由：
   - 默认是“快速表达”：匿名用户无需登录即可使用通用短语和手动输入；个人短语在登录后异步加载。三者均使用浏览器本机朗读，不连接 LiveKit、不调用 agent、不上传声音。
   - 用户明确选择“日常沟通”后，才要求登录并在同页挂载 `frontend/src/components/chat/ChatInterface.tsx`，使用 LiveKit agent 做语音理解、意图纠错、连续上下文和 confirmed output。
   - 记忆页是场景模板、热词、沟通策略、自定义材料和个人短语的唯一维护面；日常沟通自动读取已启用模板与当前材料，不再提供第二套手动装配 UI。
4. 练习入口下只有两个产品任务：筛查与数据录入：
   - `/practice`：只区分 `20 词能力筛查 / 训练与数据录入`。
   - `/assessment`：独立 20 词能力筛查执行页。
   - `/contribute`：数据录入主题选择、今日 / 7 天训练总结、匿名榜单；自定义材料是数据录入的一种来源。
   - `/contribute/topic/[topicId]`：公共题库或自定义材料的录音、自动上传与撤回执行面。
5. 记忆页已经不是单文档壳子：
   - 支持用户画像、场景 / 热词模板、多份自定义材料库、当前 active material、材料摘要、个人短语及编辑删除。
6. Web 音频设置已经落地：
   - `/settings/audio` 支持麦克风授权、设备列表、首选麦克风保存和现场电平测试。
7. Mobile Workbench 已进入 Web/App 能力对齐阶段：
   - `communication / practice / memory / device` 四个 surface 继续复用同一 backend owner，不通过 WebView 复制页面。
   - 沟通页已消费 LiveKit user/assistant transcript，并提供可编辑 confirmed output、给对方看、原生朗读、复制和文本发送。
   - 沟通 surface 内部使用 `communication_setup / communication_live` 两个 screen route；场景仍进入 RTC intent，不在实时工作台里占据主视觉。
   - 练习 surface 内部只使用 `practice_home / assessment / collection` screen route；自定义材料是 `collection` 内部的 `prepared_material` 来源，不是第三个产品任务。
   - 当前仍未达到 App 完全替代 Web：移动端尚缺训练实时识别/评分/总结、完整自定义材料训练，以及沟通档案的完整增删改；在这些 parity 项和真机 smoke 完成前，App 不能再标为“完整替代版”。
8. `dataset != memory` 仍是硬边界：
   - 训练样本上传进入 dataset / review / export 路线。
   - workspace snapshot 是 durable owner。
   - LiveKit 只承接 session-local runtime。

### 仍然不成立

1. **confirmed output 层已有本机 v0，但闭环还不完整**。当前沟通页已经能把同一个“沟通转写 agent”的结果稳定收成确认输出缓冲区：
   - 给对方看：大字展示、面对面反转、确认后展示。
   - 文本发声：浏览器本机朗读，后续再接硬件扬声器。
   - 听写复制：确认文本复制、粘贴到第三方。
   - 仍缺：保存为短语 / 准备材料的显式闭环、第三方接入状态流、硬件接口选型。
3. **训练页还不是专家协作系统**。现在只有病因标签、严重度粗分、20 词筛查、通用句库和自定义材料练习；还没有治疗师配置、专家复核、病因机制化训练协议或报告审核闭环。
4. **listener-facing 呈现层已有本机 v0，但还没进入真实硬件链路**。大字展示、反转、本机朗读、复制已补齐；硬件外放先等接口选型，不做伪接入。
5. **固定句库仍然偏重**。表达工具箱和 starter kit 已有价值，但下一步要把它从“句库”升级为“场景沟通协议”：先表达、被确认、补救、外放、保存有效表达。

## 3. 产品结构重新收口

### 沟通页

沟通页是主产品，也是后续硬件连接页面。

下一步不应该把 `给对方看 / 文本发声 / 听写` 做成独立 agent 或平行页面。它们都属于实时沟通环节：

```text
用户语音 / 文本输入
  -> 沟通转写 agent（读取用户画像、准备材料、场景模板、热词、短语）
  -> confirmed output buffer
  -> 给对方看 / 文本发声 / 听写复制 / 显式保存 / 后续硬件外放
```

其中：

1. **沟通转写 agent 是唯一主干**
   - 负责听懂用户、结合记忆和场景、生成 confirmed output。
   - 所有出口共用同一份 session state、同一份 workspace snapshot、同一套 correction policy。
2. **给对方看只是呈现出口**
   - 大字显示、面对面反转、确认后展示。
   - 适合医院窗口、陌生人问路、嘈杂环境。
3. **文本发声只是呈现出口，硬件等接口明确后再接**
   - 当前先把 confirmed output 送到浏览器本机朗读。
   - 未来胸前 / 挂脖扬声器盒再根据 BLE、串口、局域网、系统音频路由或厂商 SDK 做真实接入。
   - 不另起一套 TTS 页面作为第二主链。
4. **听写 / Dictate 只是呈现出口**
   - 把同一个 confirmed output 变成可复制、可粘贴、可转交文本。
   - 默认不和另一个助手对话，不自动写长期记忆。
   - 适合微信、会议、客服输入框、表单、文档和第三方粘贴。

沟通页必须优先解决真实场景的效率问题，不应只强化“聊天感”。

### Confirmed Output Buffer

沟通页需要的不是多个 agent，而是一层稳定的 confirmed output buffer。它承接沟通转写 agent 的结果，再把同一句话送到不同出口。

P1 本机 v0 已支持这些出口：

1. 大字展示。
2. 面对面反转。
3. 文本发声 / 本机外放。
4. 一键复制。
5. 后续粘贴到第三方的状态流。
6. 显式保存为短语或准备材料。

默认不保存原始音频，不默认写入长期记忆。只有用户明确点“保存为短语 / 保存为准备材料”时，才进入 workspace。

复制、第三方输入、会议字幕等如果被验证为高频入口，也只是增加快捷入口；底层仍然走同一个沟通转写 agent。

### 第一句话 / 破冰材料库

当前 starter kit 不应继续被理解成“人工造的一批句子”。它应该升级成沟通转写 agent 的第一轮沟通协议。

它的作用不是替用户说漂亮话，而是用第一句话建立 4 个条件：

1. **让对方知道怎么听**：例如“我说话会慢一点，请先听我说完。”
2. **保护用户表达权**：例如“请直接和我沟通，我可以自己回答。”
3. **建立补救规则**：例如“如果没听清，请告诉我，我会换一种方式说。”
4. **给 agent 装入场景目标**：例如当前是就医、面试、陌生人求助还是家人照护。

它可以结合这些理论和实践锚点：

1. **Supported Conversation / Communication Partner Training**
   - 先教对方怎么配合，而不是只要求用户说得更清楚。
   - 适合“给对方看”和第一句开场。
2. **AAC self-advocacy**
   - 用户主动说明自己的沟通方式、需要的等待时间和替代输出方式。
   - 适合大字展示、外放和短语保存。
3. **Conversation repair**
   - 把“没听清”设计成可恢复流程：重说关键词、确认对方听到什么、切短句、切文字。
   - 适合 confirmed output 的修正和复制出口。
4. **Speech Systems / Intelligibility strategy**
   - 第一句话不追求标准口音，而是先稳住听众注意力、语速、停顿和关键词。
   - 适合陌生人、工作、面试和医疗窗口。

因此第一句话材料库应该进入实时沟通链路：

```text
场景 + 用户画像 + 破冰协议
  -> 沟通转写 agent 的第一轮上下文
  -> confirmed output
  -> 给对方看 / 外放 / 复制 / 后续补救
```

下一步不要继续横向堆句子，而是给每条第一句话补结构化 metadata：

1. `intent`: 建立等待 / 保护自主 / 请求确认 / 切文字 / 紧急求助。
2. `partner_instruction`: 对方应该怎么配合。
3. `fallback_output`: 适合大字展示、外放、复制还是保存为短语。
4. `scene_fit`: 医疗、陌生人、工作、面试、家人、紧急。
5. `theory_basis`: supported conversation、AAC self-advocacy、conversation repair、speech intelligibility strategy。

### 记忆页

记忆页应该叫“沟通档案 / 准备材料”，不是包办所有长期状态。

应该保留：

1. 用户画像：稳定偏好、沟通对象、常见场景、对方配合方式。
2. 准备材料：稿件、说明、医疗信息、面试稿、会议提纲。
3. 场景模板：开发者维护、用户选择启用。
4. 高频短语 / 补救句：能直接进入沟通页或 TTS 出口。

暂时不应作为长期记忆保留：

1. 单条训练录音。
2. 未经复核的训练总结。
3. 一次性 ASR 误听。
4. 只对当天有用的训练提示。

训练总结可以留在训练页和 dataset review 中，但不应默认进入沟通页上下文。

### 训练页

训练页短期先服务两件事：

1. 让用户能稳定、低压力地录到可训练的 `audio + target_text` 样本。
2. 让用户看到“系统识别代理指标”的进步，而不是宣称医学康复。

中期再进入专家协作：

1. 专家选择训练目标和禁忌边界。
2. 软件承载高频任务。
3. AI 记录表现、归纳薄弱环节。
4. 专家复核报告和调整方案。
5. 被专家确认后的策略再自动化进产品。

训练页不要急着按病名硬编码功能。应先按机制组织任务：

1. 听理解 / 语义链接。
2. 命名 / 口语模仿。
3. 构音 / 音节强化。
4. 响度 / 气息 / 句尾衰减。
5. 节奏 / 停顿 / 旋律支架。
6. 场景描述 / 叙事。
7. AAC / 短语 / TTS 迁移。

病因标签只做适用画像、风险约束和专家分流。

## 4. 下一步执行计划

### P0：训练总结退出长期记忆和沟通上下文（已完成 2026-05-26）

目标：先把“训练报告”和“长期记忆”分开。

代码范围：

1. `backend/src/services/supabase.service.ts`
   - `WorkspaceMemorySnapshot.object_zones` 移除 `training_summaries` zone。
   - `communication_loadout.sections` 移除 `training_summary` section。
   - `buildPreparationSnapshot` 不再把 `preferredTrainingSummary` 注入 `immediate_goal / support_strategies / risky_terms / pronunciation_patterns / training_pairs`。
   - `session_review` 不再用训练复盘兜底，只保留最近沟通会话复盘。
2. `frontend/src/lib/memory/workspace-snapshot.ts`
   - 删除 `training_summary` loadout 类型。
3. `frontend/src/components/chat/ChatInterface.tsx`
   - 删除“用户画像和训练总结会默认进入这次上下文”文案。
   - `contextResultSummary` 不再展示默认训练总结。
4. `frontend/src/app/memory/page.tsx`
   - 移除记忆页里的训练总结区。
5. 保留 `prepared_expression.training_reports` 给训练页使用，不进入沟通 loadout。

验证：

1. `cd backend && npm test -- memory-maintenance`
2. `cd frontend && npx tsc --noEmit --allowImportingTsExtensions`
3. 沟通页 smoke：workspace snapshot 仍可读、材料和模板仍可加载、训练总结不再进入“本次上下文”。

### P1：沟通页补 confirmed output 呈现层（本机 v0 已完成 2026-05-26）

目标：让同一个实时沟通链路的结果，可以稳定呈现为给对方看、文本发声和听写复制。硬件输出不做伪接口，等接口选型后再接。

交付：

1. 新增 `confirmed_output` 前端状态：
   - 已来源于沟通转写 agent 的最终确认文本。
   - 已与 interim transcript 分开，避免把未确认错字直接展示给对方。
   - 用户可手动改写确认输出。
2. `给对方看`出口：
   - 已大字展示最新确认文本。
   - 已支持反转显示。
   - 已支持“确认后再展示”，避免把 interim 错字直接给对方看。
3. `文本发声`出口：
   - 当前先用浏览器本机 `speechSynthesis` 朗读确认文本。
   - 未来硬件输出等接口选型后再接，不在当前 Web 里发伪请求。
4. `听写复制`出口：
   - 已支持一键复制和展示。
   - 待补：清空、保存为短语或准备材料、第三方接入状态流。
   - 默认不保存到长期记忆。
5. `memory 写入`：
   - 当前只写 session metadata 的 `latestConfirmedOutput*` 动作记录。
   - 只有用户显式保存为短语、材料或画像片段时才写 workspace。

验证：

1. `cd frontend && npm run build`。
2. Playwright 或浏览器 smoke 检查同一条 confirmed output 能被展示、反转、复制、外放。
3. LiveKit smoke 确认所有出口仍走现有沟通 session，不新增第二套 agent。

### P2：高频输出面增强

目标：在同一条实时沟通链路里补齐 Voiceitt 式真实使用场景，不把它误做训练，也不先拆第二个沟通页。

交付：

1. confirmed output 增加“复制到剪贴板 / 发送到第三方 / 保留本次文本”的状态提示。
2. 给会议、客服、文档、微信等场景增加轻量 preset。
3. 记录匿名使用信号：复制次数、展示次数、保存为短语次数，不记录原始文本内容。
4. 如果听写复制明显高频，可以新增快捷入口；但底层仍进入沟通页 / 沟通转写 agent，不新建第二条主链。

验证：

1. 不登录时按当前授权策略处理。
2. 登录时只在用户显式保存后写 workspace。
3. 不产生训练上传记录。

### P3：训练页专家协作 v0

目标：让训练从“通用录音工具”走向“专家知识自动化执行面”。

交付：

1. 训练 profile 拆成 `observable speech profile`：
   - 病因标签
   - 构音 / 韵律 / 响度 / 疲劳 / 听觉反馈 / 失语或言语动作计划风险
2. 增加专家配置对象：
   - 训练目标
   - 禁忌和风险提示
   - 任务类型
   - 复核节奏
3. 先做非医疗承诺的训练协议：
   - 响度校准
   - 可懂度策略训练
   - 自定义材料高频句复练
4. MIT / MUSTIM、PECS、LSVT LOUD 等正式疗法只做专家准入协议，不开放成自助娱乐化按钮。

验证：

1. 训练上传 metadata 带 profile / protocol id。
2. 报告文案不写医学疗效。
3. 专家配置缺失时只显示低风险通用训练。

## 5. 配套文档

短期执行状态：

- [当前任务](../../.tasks/current.md)

App / Mobile Workbench 技术路线：

- [App / Mobile Workbench 最佳实践与机会](VOXFLAME_APP_COMPANION_BEST_PRACTICES_AND_OPPORTUNITY_2026-05-04.md)

分病因疗法锚点：

- [分病因疗法锚点与产品化边界](../speech-health/VOXFLAME_REHAB_THERAPY_PRODUCT_MAPPING_BY_ETIOLOGY_2026-05-15.md)

Voiceitt 对标与设置启发：

- [Voiceitt 功能设置与 VoxFlame 启发](../product-psychology/VOICEITT_FEATURE_SETTINGS_ANALYSIS_AND_VOXFLAME_INSPIRATION_2026-05-15.md)

录音、上传与训练资产 contract：

- [语音采集产品规范](../speech-health/VOXFLAME_VOICE_COLLECTION_PRODUCT_SPEC_2026-08-18.md)
- [采集、扩容与控制面](VOICE_COLLECTION_SCALING_CONTROL_PLANE_2026-09-04.md)
## 2026-08-13 UI/UX parity 收口补充

- Web 与 Mobile 共享同一业务能力和后端事实源，但按设备优化交互，不要求桌面布局像素级复制。
- Web 首页负责任务入口；沟通页负责实时沟通；训练页先区分能力筛查与训练收集，再进入单句工作台；训练回顾与沟通档案不抢占首屏主动作。
- Mobile 继续保持 `沟通 / 练习 / 记忆 / 设备` 四个一级 surface。档案编辑支持材料、画像和短句 CRUD；训练页支持筛查、公共题库、自定义材料、真实识别反馈、自动收集和撤回。
- 当前 parity 验收口径是：功能链路、权限和数据事实源一致，界面针对触控和窄屏重排；在 Android/iOS 真机完成 RTC、原生录音并行、上传撤回、TTS/复制和 CRUD smoke 前，不宣称 100% 替代 Web。
