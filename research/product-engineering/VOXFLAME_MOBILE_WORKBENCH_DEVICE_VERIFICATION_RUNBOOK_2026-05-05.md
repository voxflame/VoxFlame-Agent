# VoxFlame Mobile Workbench Device Verification Runbook（2026-05-05）

## 1. 结论

当前 App 验证不需要先打包上架到 App Store 或 Google Play。

当前最小真实验收需要：

1. 本地静态验证：`check / typecheck / export:android`。
2. 真机 development build：Android 或 iPhone 至少一台，优先 Android。
3. 真机业务 smoke：登录、workspace read、录音、回放、上传 receipt、LiveKit quick talk。
4. 小范围内测分发：EAS internal distribution、TestFlight 或 Google Play internal testing。
5. 正式商店上架：等隐私、医疗表述、账号删除、录音权限文案、稳定性和内测反馈收口后再做。

这意味着：现在最应该做的是“真机 development build + 业务 smoke”，不是正式上架。

## 2. 为什么必须有真机

下面这些能力无法只靠代码检查、Web/PWA 或桌面模拟器证明：

1. 麦克风权限、录音文件 URI、回放和本地 document storage。
2. LiveKit React Native 的 `AudioSession`、WebRTC globals 和麦克风发布。
3. 手机访问本机 backend 的 LAN / HTTPS / tunnel 网络路径。
4. 断网、弱网、切后台、来电/系统中断后的状态恢复。
5. 后续 BLE / 外接麦 / 硬件按钮事件。

模拟器可以帮忙看 UI 和部分网络，但不能替代真实录音、真实音频路由和真实系统权限。

## 3. 验证梯度

### Level 0：代码级验证

目的：确认代码、contract 和 bundle 不明显坏。

命令：

```bash
npm run check:mobile-workbench
cd apps/mobile-workbench
npm run check
npm run typecheck
HOME=/tmp/voxflame-expo-home EXPO_NO_TELEMETRY=1 npm run export:android -- --output-dir /tmp/voxflame-mobile-workbench-device-export
HOME=/tmp/voxflame-expo-home EXPO_NO_TELEMETRY=1 npm run export:ios -- --output-dir /tmp/voxflame-mobile-workbench-ios-export
```

当前状态：已通过多轮。

### Level 1：真机 development build

目的：确认原生能力真正可运行。

VoxFlame 当前已经接入：

1. `@livekit/react-native`
2. `@livekit/react-native-webrtc`
3. `@livekit/react-native-expo-plugin`
4. `expo-audio`
5. `expo-file-system`
6. `expo-secure-store`

这些能力意味着不能长期依赖 Expo Go。需要 development build 或 prebuild 路线。

官方参考：

1. Expo Development Builds: https://docs.expo.dev/develop/development-builds/introduction/
2. Expo 使用 development build: https://docs.expo.dev/develop/development-builds/use-development-builds/
3. EAS 创建 development build: https://docs.expo.dev/develop/development-builds/create-a-build/

建议优先 Android：

1. Android development build 安装成本较低。
2. 录音、回放、上传、LiveKit room 可以先跑通。
3. iPhone 之后再补 TestFlight / ad hoc 设备。

当前仓库已提供 Android EAS 配置：

首次绑定团队项目时，先在已经设置 `EXPO_TOKEN` 的同一个终端执行：

```bash
cd apps/mobile-workbench
npm run eas:whoami
npm run eas:configure
```

该命令固定创建或绑定 `qiuds-team/voxflame-mobile-workbench`，并同步三套公共客户端环境。后续不再需要手工重复创建每个 EAS 环境变量。

```bash
cd apps/mobile-workbench
npm run eas:login
npx --yes eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_API_BASE_URL --value http://<your-lan-ip>:3001/api
npx --yes eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value <supabase-url>
npx --yes eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <supabase-anon-key>
npm run smoke:device-env
npm run build:android:development
```

iPhone development build 使用同一组 `EXPO_PUBLIC_*` 公开客户端配置：

```bash
cd apps/mobile-workbench
npm run eas:login
npm run build:ios:development
```

iOS 真机 build 需要 Apple Developer 凭据。Linux 可以验证 iOS Metro bundle，但不能在本机生成或签名 IPA；EAS cloud build 会完成原生构建与签名。

EAS 构建完成后会给出 build 页面。Android 手机上通常直接用系统相机扫 Expo 页面里的二维码；相机会打开浏览器下载 APK。下载后如果系统提示“禁止从此来源安装”，允许浏览器安装未知应用，再回到下载页安装。

如果只是给非开发者试用，不需要连接本地 Metro，可以用 preview APK：

```bash
cd apps/mobile-workbench
npm run eas:login
npx --yes eas-cli@latest env:create --environment preview --visibility plaintext --name EXPO_PUBLIC_API_BASE_URL --value http://<reachable-api-host>:3001/api
npx --yes eas-cli@latest env:create --environment preview --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value <supabase-url>
npx --yes eas-cli@latest env:create --environment preview --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <supabase-anon-key>
npm run smoke:device-env
npm run build:android:preview
```

`development` 和 `preview` 都不是应用商店版本；它们是内部测试安装包。
EAS 云端构建不会自动读取你本机未提交的 `.env`，所以云端打包前要用 `eas env:create` 或 Expo dashboard 配好 `EXPO_PUBLIC_*` 公共客户端配置。不要把 service role key、LiveKit API secret、DashScope key 或 OSS secret 放进 EAS 客户端环境。

当前服务器存在失效的 `HTTP_PROXY / HTTPS_PROXY` 与不安全的 `NODE_TLS_REJECT_UNAUTHORIZED` 全局环境。仓库 `eas:* / build:*` 脚本会自动移除这些变量；手动执行 EAS CLI 时也应使用：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u NODE_TLS_REJECT_UNAUTHORIZED npx --yes eas-cli@latest <command>
```

登录默认使用 `npm run eas:login`（内部带 `--no-browser`）。不要在 SSH 会话中使用 browser login：浏览器回调里的 `localhost:<random-port>` 指向开发者电脑，不是运行 CLI 的远程服务器。

### Level 2：真机业务 smoke

目的：确认“真实用户路径”可用。

必测账号链路：

1. 使用真实 Supabase 账号登录。
2. 读取 `GET /api/memory/workspace/:userId`。
3. 看到 active prepared expression、quick phrases 和 daily target。

必测练习链路：

1. 请求麦克风权限。
2. 录一条练习句。
3. 回放本地录音。
4. 点击上传。
5. 确认本地 queue item 变为 `uploaded`，并持有 `uploadReceipt`。
6. 后端 / OSS 能查到对应对象。

必测沟通链路：

1. 点击 quick talk。
2. App 调 backend `/api/rtc/session/start`。
3. App 进入 LiveKit room。
4. 本机麦克风发布成功。
5. 断开后 `AudioSession` 被清理。

必测失败路径：

1. 后端未启动时，App 显示可理解错误。
2. 网络断开时，本地录音不丢。
3. 上传失败后仍可重试或删除。
4. 切后台 / 回前台后状态不假装成功。

### Level 3：小范围内测分发

目的：让 1-10 个可信测试者用自己的手机验证真实场景。

可选路径：

1. EAS internal distribution：适合团队快速拿安装链接。
2. Apple TestFlight：适合 iPhone beta，内部/外部测试者收集反馈。
3. Google Play internal testing：适合 Android 内测轨道。

官方参考：

1. Expo EAS internal distribution: https://docs.expo.dev/build/internal-distribution
2. Apple TestFlight: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
3. Google Play internal testing: https://support.google.com/googleplay/android-developer/answer/9845334

### Level 4：正式商店上架

目的：公开发布，不是当前 Phase 0 的前置条件。

国内 Android 应用商店需要 release APK，不要上传 development build。当前仓库提供：

```bash
cd apps/mobile-workbench
npm run build:android:china-store
```

这条 profile 会生成面向国内 Android 商店的正式 APK。小米应用商店官方流程是创建应用、填写包名、上传 APK，并在权限信息模块说明敏感权限使用场景。华为 AppGallery Android 分发也需要开发者认证、创建应用、填写应用资料、上传应用包和隐私政策 URL。

华为 / 鸿蒙需要分两条线判断：

1. 华为应用市场里的 Android 应用：当前 React Native Android APK 可以作为提交物。
2. HarmonyOS NEXT 原生鸿蒙应用：当前 Android APK 不是原生鸿蒙应用，后续需要单独做 HarmonyOS-native 版本或确认跨端方案支持。

进入正式上架前，至少需要补齐：

1. 隐私政策：录音、账号、训练样本、OSS 存储、删除方式。
2. 账号删除 / 数据删除入口。
3. App Store / Google Play 文案：只表达“沟通辅助”，不表达医学诊断或康复疗效。
4. 麦克风权限说明与 App 内录音显式状态。
5. crash / 日志策略：不上传录音内容到普通日志。
6. 内测反馈闭环。

## 4. 本地环境预检

先在仓库根目录跑：

```bash
npm run check:mobile-workbench
```

再在 mobile workbench 目录跑：

```bash
cd apps/mobile-workbench
npm run smoke:device-env
```

真机访问本地 backend 时，`EXPO_PUBLIC_API_BASE_URL` 不应写成 `http://127.0.0.1:3001/api`，因为手机上的 `127.0.0.1` 指向手机自己。通常应该写成：

```bash
EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:3001/api
```

如果网络环境复杂，可以后续改用 HTTPS tunnel，但不要把 service role key、LiveKit API secret、DashScope key 放进 App 环境变量。

## 5. Android / iPhone 完整业务验收

> 适用版本：`0.1.7 (8)` 起。Android 与 iPhone 必须分别执行；只打开页面、只跑模拟器或只完成 bundle 构建都不算通过。

自动化门：

```bash
cd apps/mobile-workbench
npm run smoke:device-env
npm run test:communication
npm run test:training
npm run test:memory
npm run check
npm run typecheck
npm run export:android
npm run export:ios
cd ../../backend && npm run build
cd .. && bash scripts/check_ai_docs.sh
```

每个平台完整走通：

1. 真实账号登录；退出后仍能进入快速表达。
2. 快速表达完成短句/自定义文字朗读、复制和大字展示；不创建 RTC、不上传声音。
3. 语音助手连接 LiveKit、发布麦克风、接收并编辑确认文字、发送给 Agent、结束连接。
4. 训练首页可进入马上录、自己的材料、8 个主题和现代文章朗读。
5. 从系统文件选择器导入 `.txt/.md`，保存、切换材料，逐句清单与 Web/Backend 一致。
6. 停止录音后先确认；回听正常，确认收录后才上传并进入下一句。
7. 重录时旧录音撤回成功后才开始新录音；撤回失败不得开始。
8. 不收录会删除本机录音；已上传录音同时撤回云端资产，失败时保留可重试状态。
9. 场景模板和系统重点词/开口句可查看、启用和停用。
10. 自定义重点词新增、编辑、删除后，Web、App 和下一次 RTC workspace 一致。
11. 沟通画像、材料和常用短句完成新增、修改、删除或清空，并确认 Web 同源。
12. 录音中断网仍能停止并保留本机文件；恢复网络后上传成功，重试不产生重复 manifest。
13. 验证麦克风拒绝、重新授权、蓝牙/有线输入断开后的安全回退。

复制 `apps/mobile-workbench/device-acceptance.example.json`，分别保存 Android 和 iOS 结果。不得写真实姓名、完整手机号、表达正文或音频地址。每项必须有非空证据；`fail`、`pending`、`conditional` 都不能通过；conditional 仍须说明问题并修复复测，不得作为完整验收。

```bash
cd apps/mobile-workbench
npm run validate:device-acceptance -- android-result.json
npm run validate:device-acceptance -- ios-result.json
```

只有两条命令都退出码为 0，才可宣称 App 通过双平台完整真机验收。缺实体设备、Apple 签名或真实账号时必须保持 `pending`。


### RTC P0 补充场景（2026-09-11，未验收）

验收模板新增四项：`rtc_cancel_and_quick_reconnect`（在权限/连接等待中取消后重连）、`rtc_account_switch_and_unmount`（两账号切换/离开页面后无旧音频和字幕）、`rtc_audio_route_and_interruption`（蓝牙/有线/扬声器路由及打断）、`rtc_ten_utterances_capture_isolation`（连续十句不串capture）。Android/iOS分别记录真实设备、版本与不含PII的证据，不用本地替身结果填写pass。
延迟、CER、停播尾音、AEC与噪声条件依 `research/voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md` 及既有 RO-014/FB-008 归档；`npm run check:voice-evidence` 仅离线检查，不执行真实调用。未量测的指标保持缺测。
