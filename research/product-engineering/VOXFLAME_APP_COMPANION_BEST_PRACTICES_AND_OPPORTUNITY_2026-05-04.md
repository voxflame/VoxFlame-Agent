# VoxFlame App / Mobile Workbench Best Practices And Opportunity（2026-05-04）

> 结论：可以开始完整移动端工作台研发。新的判断不是“先做一个薄 companion”，而是把移动端作为第一等产品面来设计；但工程交付仍按可验证切片推进，不能用一次性重写破坏现役 Web / PWA 主链。

Phase 0 已完成并进入真实设备验收，当前执行依据见 [Mobile Workbench 真机验证手册](VOXFLAME_MOBILE_WORKBENCH_DEVICE_VERIFICATION_RUNBOOK_2026-05-05.md)，代码目录为 [apps/mobile-workbench](../../apps/mobile-workbench)。

## 1. 当前是否适合开始 App

适合，而且现在更适合把 App 定义成完整移动端工作台。

原因不是“代码已经不贵，所以重写一遍”，而是当前 Web / PWA 已经形成了 App 可以复用的事实源和 contract：

1. `workspace snapshot` 已经是 durable owner。
2. 训练资产链路已收成 `recording envelope -> recorder queue -> upload receipt -> manifest`。
3. 实时主链已固定为 `Frontend -> Backend /api/rtc/session/* -> self-hosted LiveKit -> livekit_agent`。
4. PWA 已具备安装面、离线兜底和 recorder queue 概念，但移动端系统权限、真机录音、后台限制、通知和硬件桥接仍然需要原生工作台承接。

所以 App 的第一性目标应升级为：

1. 成为用户日常沟通、练习、准备、补传和设备入口的完整移动端工作台。
2. 复用 Web 已经跑通的 backend contract，不另造第二套事实源。
3. 把原生移动端的权限、录音、音频 session、后台同步和硬件桥接做成长期能力。
4. 继续让 Web / PWA 保持稳定演示和管理工作台，不被 App 研发拖垮。

## 2. 产品形态判断

### 2.1 目标：完整移动端工作台

移动端第一版就应该按完整信息架构设计，而不是只设计成几个快捷按钮。

建议从 day one 规划四个一级 surface：

1. `沟通`
   - quick talk
   - 一键开口
   - LiveKit room
   - data channel transcript / assistant message
   - 中断、重连、切后台状态
2. `练习`
   - 原生录音
   - recorder queue
   - audio-target pairing
   - upload receipt
   - 训练样本回流状态
3. `记忆与准备`
   - workspace snapshot
   - prepared expressions
   - 最近高频句
   - 就医 / 面试 / 工作沟通前的准备材料
4. `设备与同步`
   - 麦克风权限
   - 本地队列
   - 补传状态
   - BLE / USB / 外接麦桥接
   - 隐私、删除、本地缓存管理

这里的“一步到位”指产品信息架构、owner、contract 和技术路线一步到位，不代表第一周就把所有页面做完。

### 2.2 不建议继续把第一阶段定义成薄 companion

薄 companion 的优点是快，但对 VoxFlame 的风险是产品心智会被锁窄：

1. 用户真正需要的是高频移动端沟通工作台，不只是 Web 的遥控器。
2. 原生录音、LiveKit mobile、后台补传、硬件桥接都需要 App 从架构上长期承接。
3. 现在的 vibe coding 时代，代码量不是最大约束；更大的约束是技术路线、事实源、隐私承诺和移动端系统限制。

因此，后续文档里的 `companion` 只表示“Web 之外的随身入口”，不再表示“功能很薄的附属应用”。

## 3. 推荐技术路线

### 3.1 战略主线：Expo / React Native mobile workbench

如果目标是完整移动端工作台，推荐主线改为：

```text
apps/mobile-workbench/
  app/
    communication/
    practice/
    memory/
    device/
  src/
    auth/
    api/
    contracts/
    realtime/
    recorder/
    queue/
    storage/
    permissions/
    device-bridge/
  app.json
  package.json
```

技术栈建议：

1. `Expo / React Native` 作为移动端主框架。
2. `@livekit/react-native` 承接实时语音和 data channel。
3. Supabase React Native auth adapter 承接 session persistence 和 token refresh。
4. 原生文件系统承接录音文件落盘，本地 metadata 只保存 URI、hash、状态和 retry 信息。
5. 与 Web 共享 contract 类型，而不是共享整套页面 UI。

这个选择的核心理由：

1. 完整移动端工作台需要真正的 native audio session，而不是只靠 WebView。
2. LiveKit 官方有 React Native SDK 路线，更适合长期实时沟通。
3. 训练录音、后台补传、权限提示、设备桥接都属于移动端原生问题。
4. Web/PWA 的 Next.js App Router 可以继续作为现役产品面，不需要硬塞进 App shell。

### 3.2 Capacitor 的位置：原型或过渡，不做战略主线

Capacitor 仍有价值，但角色应降级为：

1. 快速验证 WebView 原型。
2. 复用某个很薄的 Web surface。
3. 做 native plugin bridge 的概念验证。

不建议用 Capacitor 承担完整移动端工作台主线，原因是：

1. 当前 Web 是 Next.js App Router + backend rewrites + auth callback + PWA 的产品面，不是纯静态单页应用。
2. Capacitor 常规工作流需要把 Web bundle 同步到原生项目；它不自动解决 SSR、rewrite、auth callback、长时录音和后台同步。
3. 完整工作台最终会越来越依赖 native audio、LiveKit React Native、SecureStore、文件系统、系统权限和硬件事件。

### 3.3 LiveKit 移动端原则

移动端不能绕开 backend 自己签 token。

正确路径仍是：

```text
mobile workbench
  -> backend /api/rtc/session/start
  -> LiveKit participant token + room metadata
  -> LiveKit React Native SDK
  -> livekit_agent
```

React Native 场景里，LiveKit 官方示例要求显式启动 / 停止 `AudioSession`，并用后端生成的 server URL 与 participant token 连接房间。VoxFlame 不能把 token、API secret 或 provider key 放进 App。

### 3.4 共享 contract，不共享整站 UI

移动端应共享这些 contract：

1. `workspace snapshot`
2. `recording envelope`
3. `upload receipt`
4. `RTC session intent / session response`
5. `prepared expression active asset`
6. `training topic / audio target`
7. `local queue item state`

移动端不应共享这些东西：

1. Web 页面路由。
2. Next.js server component 假设。
3. 浏览器 cookie / localStorage auth 细节。
4. Web-only service worker 行为。

后续可以新增 `packages/voxflame-contracts` 或先从现有 `frontend/src/lib/*` 提取最小共享类型，但必须避免复制粘贴出第二套 schema。

## 4. 官方资料带来的硬约束

### Expo / React Native

Expo 音频文档强调：

1. 录音前必须请求麦克风权限。
2. 需要设置 audio mode，例如允许录音、静音模式播放等。
3. 背景任务不是任意实时运行；Expo background task 依赖 Android WorkManager 与 iOS BGTaskScheduler。
4. iOS background fetch 有明显限制，不能假设 App 被杀掉后仍能继续同步。

所以完整移动端工作台要设计“可失败、可重试、用户可见”的队列，而不是承诺后台一定实时完成。

官方入口：

- https://docs.expo.dev/
- https://docs.expo.dev/versions/latest/sdk/audio/
- https://docs.expo.dev/versions/latest/sdk/background-task/
- https://docs.expo.dev/versions/latest/sdk/filesystem/
- https://docs.expo.dev/versions/latest/sdk/securestore/

### Supabase Auth

React Native 不能沿用浏览器 `localStorage` 假设。Supabase 官方 React Native 示例会：

1. 引入 URL polyfill。
2. 用 `AsyncStorage` 持久化 session。
3. 打开 `autoRefreshToken` 和 `persistSession`。
4. 原生安全要求更高时，用 SecureStore 保存密钥或 session 加密材料。

VoxFlame App 必须先把 auth storage 封成独立 adapter，不要让 Web 的 cookie/localStorage 逻辑散进 App。

官方入口：

- https://supabase.com/docs/guides/auth
- https://supabase.com/docs/guides/auth/quickstarts/react-native
- https://supabase.com/docs/reference/javascript/auth-startautorefresh

### LiveKit

LiveKit React Native 官方示例要求：

1. 从后端拿 `serverUrl + participantToken`。
2. App 侧启动 audio session。
3. 用 SDK 连接 room 并发布音频。
4. 组件卸载或会话结束时停止 audio session。

VoxFlame 的 App 不应直接调用 LiveKit server secret；所有 session orchestration 继续归 backend。

官方入口：

- https://docs.livekit.io/home/client/connect/
- https://docs.livekit.io/transport/sdk-platforms/react-native/
- https://docs.livekit.io/home/client/data/

### Capacitor

官方文档的基本工作流是：

1. 构建 Web bundle。
2. 安装 `@capacitor/ios` / `@capacitor/android`。
3. `npx cap add ios` / `npx cap add android`。
4. `npx cap sync` 把 Web bundle 与 native dependencies 同步到原生项目。

这说明 Capacitor 很适合“Web 技术栈 + 原生插件桥”，但不自动解决：

1. Next.js SSR / rewrite / auth callback 如何完整静态化。
2. 长时后台录音与系统中断。
3. App Store / Google Play 对隐私、音频和远程内容的审核边界。

Capacitor `Preferences` 适合小型 key-value 配置，不适合直接存大音频；录音文件应使用原生文件系统或专门的录音队列目录，并用 metadata 指向文件 URI。

官方入口：

- https://capacitorjs.com/docs
- https://capacitorjs.com/docs/getting-started
- https://capacitorjs.com/docs/apis/preferences
- https://capacitorjs.com/docs/apis/app

### iOS / Android 麦克风与后台限制

iOS：

1. 麦克风采集需要用户显式授权。
2. 如果用户拒绝或未响应，音频录制可能得到静音。
3. 后台执行模式需要在 `Info.plist` 中声明，且不是任意后台计算许可。

Android：

1. 录音需要 `RECORD_AUDIO`。
2. Android 前台服务访问麦克风需要声明 microphone foreground service type。
3. 麦克风权限受 while-in-use 限制，不能假设从后台随时启动录音服务。
4. Android Emulator 不能代表真实录音设备，必须真机测录音。

官方入口：

- https://developer.apple.com/documentation/avfoundation/avcapturedevice/authorizationstatus%28for%3A%29
- https://developer.apple.com/documentation/avfoundation/avcapturedevice/requestaccess%28for%3Acompletionhandler%3A%29
- https://developer.apple.com/documentation/xcode/configuring-background-execution-modes
- https://developer.android.com/media/platform/mediarecorder
- https://developer.android.com/about/versions/11/privacy/foreground-services
- https://developer.android.com/develop/background-work/services/fgs/service-types

## 5. 完整移动端工作台机会点

### 5.1 沟通工作台

真实价值：

用户在陌生人、高压或临时场景里，不应先打开复杂 Web 页面。

第一批能力：

1. 最近准备好的表达大字展示 / 播报。
2. “请等我说完”“我需要帮助”“请看这句话”等保底句。
3. quick talk 进入 LiveKit room。
4. 能看到连接、录音、识别、回复、中断和断网状态。
5. 支持手动重连和退出。

复用 contract：

1. `workspace snapshot.preparation`
2. `expression kit`
3. `prepared expression active asset`
4. `RTC session orchestration`

### 5.2 练习与原生 recorder queue

真实价值：

移动端最常见失败不是模型不好，而是录音、网络、权限、切后台导致样本丢失。

第一批能力：

1. 原生录音文件落盘。
2. 每条样本生成同构 `recording envelope`。
3. 离线时保留本地队列。
4. 网络恢复、App 回前台、用户手动点击时补传。
5. 成功后拿 `upload receipt`，再删除或归档本地文件。
6. 显示补传状态、失败原因、重试次数和本地删除入口。

不能做：

1. 不要发明第二套训练样本 schema。
2. 不要绕过 `/api/upload/sign` 和 `/api/upload/complete`。
3. 不要把 App 本地队列当 durable truth owner。

### 5.3 记忆与准备工作台

真实价值：

用户在就医、面试、工作沟通前，最需要的是“当前这次我要说什么”，不是完整后台管理系统。

第一批能力：

1. 只读显示当前 active prepared expression 摘要。
2. 显示 3 到 8 条锚点句。
3. 支持复制 / 大字展示 / 播报。
4. 支持低风险的收藏、置顶、最近使用标记。
5. 复杂编辑可以先回 Web，但移动端 IA 要为后续编辑留位置。

### 5.4 设备、同步与隐私工作台

真实价值：

用户要信任一个随身语音工具，必须能看懂它什么时候录音、什么没上传、什么留在本地、什么可以删除。

第一批能力：

1. 麦克风权限状态。
2. 本地队列数量与详情。
3. 手动补传。
4. 删除本地未上传录音。
5. 账号、退出登录、隐私说明。
6. 外接麦 / BLE / USB 事件的未来入口。

### 5.5 硬件桥接预留

硬件不应先做整机，但 App 可以成为 BLE / USB / 外接麦的桥。

第一版只定义事件：

```text
capture_start
capture_stop
replay_last
interrupt_tts
device_quality_sample
```

事件进入 App，再由 App 显式映射到现有 recorder / RTC / playback 行为。

## 6. 分阶段开发计划

### Phase 0：Mobile workbench RFC 与 contract audit

目标：

1. 确认 App 是完整移动端工作台，不是薄 companion。
2. 把移动端四个一级 surface、owner 和 contract 写清。
3. 列出 App 不允许新增的 durable owner。
4. 明确哪些 contract 从 Web 迁出共享，哪些仍由 backend 控制。

交付物：

1. `apps/mobile-workbench` 技术 RFC。
2. 四个一级 surface 的 IA 草图。
3. `workspace snapshot` App read/write model 清单。
4. `recording envelope` App 端字段映射。
5. 登录态、token refresh、离线队列、删除本地文件的安全边界。

验证：

1. Web 主链 build 仍通过。
2. backend build 仍通过。
3. Docker 核心栈可重建或至少健康启动。

当前落地状态：

1. 已新增 `apps/mobile-workbench` Expo / React Native skeleton。
2. 已新增移动端四 surface shell：`communication / practice / memory / device`。
3. 已新增移动端 contract boundary：RTC intent、recording envelope、workspace read model、recorder queue policy。
4. 已新增 `npm run check:mobile-workbench` 静态验证入口。
5. 现役 RTC / recording contract 已把移动端 surface 收口为 `mobile_workbench`。
6. 已接入 Supabase React Native auth adapter 与只读 `workspace snapshot` 同步壳子。
7. 已完成移动端依赖安装、typecheck、Expo dev server smoke 和 Android Metro bundle export。
8. 已用真实账号跑通 `Supabase Auth -> backend auth middleware -> workspace snapshot`，取消 `NODE_TLS_REJECT_UNAUTHORIZED` 后仍通过。
9. 已按 Expo 官方 `expo-audio` / `expo-file-system` 路线接入 Native recorder queue 的本地最小闭环：权限、录音、持久本地文件、recording envelope、本地 queue、回放、待补传标记和丢弃。

### Phase 1：Expo / React Native shell + 四 tab 工作台

目标：

1. App 能启动。
2. 能登录。
3. 四个一级 tab 跑通。
4. 能读取 `workspace snapshot`。
5. 能显示最近准备句、保底短句和本地队列空状态。

不做：

1. 不做复杂编辑。
2. 不承诺后台常驻录音。
3. 不绕过 backend token orchestration。

验证：

1. iOS Simulator / Android Emulator 能打开。
2. 真机至少验证一次登录与麦克风权限提示。
3. Web Docker 栈同步验证，不破坏现有页面。

### Phase 2：原生 recorder queue

目标：

1. App 录一条音频。
2. 本地落盘。
3. 生成 `recording envelope`。
4. 走现有 `/api/upload/*` 完成上传与登记。
5. 断网后可补传。

验证：

1. 同一条 recording retry 不重复写 manifest。
2. 账号 `2307294809@qq.com` 这类真实账号可看到回流状态。
3. Android 真机、iPhone 真机各至少录一条。

### Phase 3：LiveKit communication workbench

目标：

1. App 通过 backend session orchestration 拿 LiveKit token。
2. 能进入 quick talk 或 communication room。
3. 能发布麦克风音频。
4. 能接收 data channel transcript / assistant message。
5. 能处理中断、断网、切后台、退出房间。

验证：

1. 不绕过 backend。
2. token 不落日志。
3. 中断、切后台、断网有明确 UI 状态。

### Phase 4：记忆与准备的移动端闭环

目标：

1. 移动端能查看 prepared expressions、重要表达和最近高频句。
2. 支持低风险的置顶、收藏、最近使用。
3. 高风险编辑仍走明确保存与撤销。
4. 写回 backend 后 Web 记忆页能看到一致结果。

验证：

1. workspace snapshot 不出现双写冲突。
2. 移动端写回失败可见、可重试。
3. Web 与 App 的 prepared expression 状态一致。

### Phase 5：硬件控制桥

目标：

1. 先支持现成外设，不自研整机。
2. App 接收 BLE / USB / 按钮事件。
3. 映射到 capture / replay / interrupt。
4. 记录 device metadata 与 telemetry。

验证：

1. 设备断连可见。
2. 事件不会直接触发高风险副作用。
3. 样本 metadata 能记录设备类型与输入质量。

## 7. 标准 / 技术 / 用户反馈闭环

移动端不能只按技术路线推进。App 是用户最高频的沟通入口，后续每个阶段都必须同时回答三件事：

```text
Standard:
  这个 surface 引用了哪些专家框架 / 无障碍标准 / 医学边界？

Technical:
  这个 surface 的权限、录音、上传、LiveKit、memory contract 是否稳定？

Feedback:
  真实用户、创始人即用户、沟通伙伴、专家反馈是否证明它值得继续？
```

当前 App 研发已经有技术闭环：

1. Expo / React Native skeleton。
2. Supabase mobile auth。
3. workspace snapshot read。
4. native recorder queue。
5. upload sign / complete。
6. LiveKit room connection slice。

但用户反馈闭环还没有形成。下一阶段必须补：

1. `founder_self_observation_template`
   - 每次真实沟通或训练后记录：场景、目标、哪里卡住、情绪成本、是否愿意下次继续用。
2. `target_user_interview_template`
   - 面向构音障碍用户：最怕在哪些场景开口、最想保留哪些准备句、最不能接受哪些代播方式。
3. `communication_partner_feedback_template`
   - 面向家属 / 同事 / 医生 / 陌生人：是否更容易理解、是否知道该怎么等、怎么问、怎么确认。
4. `weekly_feedback_triage`
   - 每周把反馈分到 `communication / practice / memory / device / prompt / hardware / data`。
5. `ship decision log`
   - 每个 App 阶段写明：ship / iterate / hold / delete，以及依据的是标准、技术还是用户反馈。

App 用户反馈最小指标：

| Surface | 必须采集的反馈 | 不足时不能宣称 |
|---|---|---|
| 沟通 | 用户是否完成原本想说的话、对方是否理解、修复是否顺手 | “沟通成功率提升” |
| 练习 | 用户是否愿意继续练、反馈是否听得懂、是否觉得被评价 / 被羞辱 | “训练体验有效” |
| 记忆与准备 | 准备句是否真的在高压场景被复用、memory 是否让用户安心 | “长期记忆有帮助” |
| 设备与同步 | 用户是否理解本地/云端状态、是否能删除未上传录音 | “同步可靠可信” |
| 硬件桥接 | 佩戴 / 外放 / 按钮是否自然，是否减少开口负担 | “硬件形态成立” |

对应的研究准入、证据状态和应用回流规则见 [研究总入口](../README.md) 与 [应用回流登记](../APPLICATION_FEEDBACK_REGISTRY.md)。

## 8. 创始人需要把控的技术方向

这些点不应完全交给 agent 自动决定：

1. 产品承诺边界
   - App 是完整移动端工作台，但第一批公开承诺应聚焦“沟通、练习、准备、补传”。
   - 不承诺医疗诊断、康复疗效或后台常驻录音。
2. 移动端技术路线
   - 推荐主线：`Expo / React Native + LiveKit React Native`。
   - `Capacitor` 只作为 WebView 原型或过渡，不作为长期工作台主线。
3. 后台录音与隐私
   - 哪些场景允许后台录？
   - 用户如何知道正在录？
   - 未上传录音如何删除？
4. 医疗与康复表述
   - App Store / 应用市场文案不能暗示医学诊断或康复疗效。
   - 仍然只表达“沟通辅助 / 训练表现 / 系统识别代理指标”。
5. 硬件优先级
   - 先支持外接麦、BLE 按钮、脚踏，还是先做自研硬件？
   - 推荐先外设桥接。
6. 共享 contract 的治理
   - 哪些类型可以进共享 package？
   - 哪些 owner 必须留在 backend？
   - 哪些本地缓存只能是 cache，不能变成 truth？

## 9. 当前最值得补的学习点

建议按这个顺序学：

1. Expo / React Native 基础
   - 你需要知道 Expo managed workflow、development build、native module、文件系统和权限配置的关系。
2. 移动端权限与后台限制
   - 你需要知道为什么“后台录音 / 自动补传 / 麦克风常驻”不能随便承诺。
3. LiveKit React Native
   - 你需要知道 audio session、room token、data channel 和 backend orchestration 的关系。
4. Supabase mobile auth
   - 你需要知道为什么 App 不能沿用浏览器 localStorage/cookie 思维。
5. App Store / 应用市场隐私与医疗边界
   - 你需要能把控产品文案和数据使用说明，不让产品被误解成医疗诊断工具。
6. Capacitor 基础
   - 只需要理解它适合什么原型场景，以及为什么不作为完整工作台主线。

## 10. 下一步建议

下一步可以直接开工，但按下面顺序：

1. `apps/mobile-workbench` RFC、skeleton 和四 tab 信息架构已落地。
2. Supabase mobile auth adapter 已落地，真实账号 backend smoke 已通过；下一步做真机 UI smoke。
3. `workspace snapshot` 只读接入与快捷表达已落地，下一步在真机上确认 Web / App 读到同一份 active prepared expression。
4. 原生 recorder queue 的代码闭环已落地，下一步做 Android / iPhone 真机录音、回放和断网队列 smoke。
5. 再做 upload receipt / retry 去重接入。
6. 再做 LiveKit communication workbench。
6. 再补移动端记忆写回。
7. 最后接硬件桥。

每一步都必须同步验证 Web/PWA Docker 栈，因为移动端工作台不能破坏现役主链。
