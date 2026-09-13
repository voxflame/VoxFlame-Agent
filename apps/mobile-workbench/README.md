# VoxFlame Mobile Workbench

VoxFlame 的 Expo / React Native 移动端，Android 与 iOS 共用一套产品和接口实现。

## V1 Testable Slice

`0.1.0` 第一版包含四个可测试页面：

1. `沟通`：先进入固定场景选择 screen，再进入实时沟通 screen；通过 backend 创建 RTC session；连接和结束由 LiveKit room 管理，再连接 LiveKit 麦克风。
2. `练习`：只区分独立筛查与数据录入；自定义材料是数据录入页的一种内容来源。执行面支持原生录音、本机队列、逐条回放、确认删除、上传和 receipt。
3. `准备`：读取与 Web 相同的 workspace snapshot、准备材料和常用短句。
4. `我的`：账户、麦克风权限、资料同步和待上传状态。

App 不显示 participant token、RTC 策略或后端状态码等工程信息；这些由日志和静态守卫负责。

## Direction

This app is not a thin WebView companion. It is the native mobile surface for:

1. `communication` - quick talk and LiveKit communication sessions.
2. `practice` - native recording, local queue, retry, upload receipt.
3. `memory` - workspace snapshot, prepared expressions, high-frequency phrases.
4. `device` - mic permission, sync state, local files, future hardware bridge.

The app must reuse backend-owned contracts:

1. `workspace snapshot`
2. `recording envelope`
3. `upload receipt`
4. `RTC session orchestration`

## Setup

```bash
cd apps/mobile-workbench
npm install
```

Local environment values are public-client only. Do not commit `.env` files.

```bash
EXPO_PUBLIC_API_BASE_URL=http://<lan-ip>:3001/api
EXPO_PUBLIC_SUPABASE_URL=<supabase-url>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
```

For LiveKit, the app calls backend `/api/rtc/session/start`; it does not hold LiveKit API secrets.

## Communication Session

The communication surface now includes the first backend-orchestrated RTC slice:

1. `src/realtime/use-mobile-rtc-session.ts` calls backend `/api/rtc/session/start`.
2. The app receives room metadata, readiness, and participant token from backend.
3. The UI displays room/readiness state but never renders the participant token.
4. `src/realtime/use-livekit-room-connection.ts` starts the LiveKit React Native `AudioSession`, connects the room, and publishes microphone audio.
5. Disconnect the SDK room before clearing the bootstrap credential state; there are no HTTP ping/stop calls. `ready` in `use-mobile-rtc-session` means credentials acquired, not that audio/Agent are ready.
6. Real-device room smoke is still required before declaring communication complete.

RTC response/intent types and parser are generated from `backend/src/contracts/rtc-session.ts` into `src/contracts/generated/rtc-session.ts`; never hand-edit the generated file. Run `npm run test:rtc-contract` at the repo root. Mobile only accepts `mobile_workbench` responses; `appState` is client-local context, not a Backend device field. `joinTokenTtlSeconds` is a JWT TTL, not session duration.

This is an undeployed breaking contract change. New clients require the matching Backend; old installed apps require an upgrade/blocking plan before backend rollout. See [release and rollback boundaries](../../research/product-engineering/RTC_CONTRACT_CLEANUP_2026-09-11.md).

## Commands

```bash
npm run check
npm run typecheck
npm run start
npm run export:android
npm run export:ios
npm run build:android:development
npm run build:ios:development
npm run build:android:preview
npm run build:ios:preview
npm run build:all:preview
npm run build:android:china-store
npm run smoke:device-env
```

The first iOS device build also needs Apple signing credentials and an internal-distribution provisioning profile. Complete that one-time interactive setup in your own SSH terminal (enter Apple password and verification code only there), then rebuild:

```bash
cd /home/ubuntu/VoxFlame-Agent
npm run eas:credentials:ios
npm run build:ios:preview
```

## First EAS Setup

Google 登录创建的 Expo 账户在远程 SSH 构建机上推荐使用 Personal Access Token。第一次通过隐藏输入保存到当前 Linux 用户的 `~/.config/voxflame/expo-token`；文件权限为 `600`，不进入仓库，也不要放入项目 `.env` 或截图：

```bash
npm run eas:save-token
npm run eas:whoami
npm run eas:configure
```

项目的 `eas:*` 与 `build:*` 命令会自动加载该文件。重新 SSH、重开终端或重启服务器后无需重复输入；只有 Token 被 Expo 吊销或主动更换时才需再次运行 `npm run eas:save-token`。

`eas:configure` 会把项目创建在 `qiuds-team` 下，并将现有 Supabase 公共客户端配置与 `https://voxember.com/api` 同步到 EAS 的 `development / preview / production` 环境。它不会读取或上传 service role、LiveKit secret、模型密钥或 OSS secret。

完成后生成 Android 内测 APK：

```bash
npm run build:android:preview
```

The LiveKit React Native SDK requires a development build or prebuild path once the real room view is enabled.
Web export is not part of the current smoke path; add `react-dom` and `react-native-web` explicitly if browser preview becomes a product requirement.

Android V1 keeps only permissions tied to the audio product path: microphone, network/audio routing, wake lock for stable real-time communication, and Bluetooth/Nearby devices for headset routing. Camera, overlay, screen sharing, background camera, and background recording are not V1 capabilities. On Android 12+, Nearby devices is requested when communication starts; denying it falls back to the phone microphone/speaker instead of blocking communication.

## Device Verification

Early app verification does not require App Store or Google Play release. The current order is:

1. Static checks and Android/iOS bundle export.
2. Development build on a physical Android phone and iPhone.
3. Real-device smoke for login, workspace read, recording, playback, upload receipt, and LiveKit quick talk.
4. Small tester distribution through EAS internal distribution, TestFlight, or Google Play internal testing.
5. Formal store release only after privacy, deletion, medical wording, permission copy, and beta feedback are ready.

Run the environment preflight before opening the app on a phone:

```bash
npm run smoke:device-env
```

For a physical phone, `EXPO_PUBLIC_API_BASE_URL` should usually point at your computer's LAN address, for example `http://<lan-ip>:3001/api`, not `http://127.0.0.1:3001/api`.

See [Mobile Workbench Device Verification Runbook](../../research/product-engineering/VOXFLAME_MOBILE_WORKBENCH_DEVICE_VERIFICATION_RUNBOOK_2026-05-05.md).

## Real Account Smoke

This checks the mobile app's real dependency chain without storing credentials:

```bash
MOBILE_WORKBENCH_SMOKE_EMAIL=<account-email> \
MOBILE_WORKBENCH_SMOKE_PASSWORD=<account-password> \
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3001/api \
npm run smoke:real-workspace
```

It signs in through Supabase Auth, calls backend `/api/memory/workspace/:userId`, and verifies that the mobile read model can depend on the existing backend owner.

## Native Recorder Queue

The practice surface uses Expo-native APIs:

1. `expo-audio` for microphone permission, audio mode, recording, and local playback.
2. `expo-file-system` document storage for persistent local queue files.

Current local paths:

```text
Paths.document/voxflame-recorder-queue/queue.json
Paths.document/voxflame-recorder-queue/audio/
```

The queue now includes the first backend upload receipt slice:

1. `src/api/mobile-upload-client.ts` calls `/api/upload/sign`, PUTs the local audio file to OSS, then calls `/api/upload/complete`.
2. Successful uploads persist `uploadReceipt` on the queue item and move it to `uploaded`.
3. Failed uploads keep the local file, store `lastError`, and move the item to `failed` for retry or deletion.

Native-device smoke is still required before declaring the full recorder/upload loop complete.

## Android Install

There is no App Store / Google Play download yet. The public Android test app is always installed from `https://voxember.com/download/android`; Expo remains the build service, not the user-facing download page.

Use a development build when you want to connect the phone to your local Expo server:

```bash
cd apps/mobile-workbench
npm run eas:login
npx --yes eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_API_BASE_URL --value http://<your-lan-ip>:3001/api
npx --yes eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value <supabase-url>
npx --yes eas-cli@latest env:create --environment development --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <supabase-anon-key>
npm run smoke:device-env
npm run build:android:development
```

Use a preview build when you want a directly installable APK that does not need the local Expo dev server:

```bash
cd apps/mobile-workbench
npm run eas:login
npx --yes eas-cli@latest env:create --environment preview --visibility plaintext --name EXPO_PUBLIC_API_BASE_URL --value http://<reachable-api-host>:3001/api
npx --yes eas-cli@latest env:create --environment preview --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value <supabase-url>
npx --yes eas-cli@latest env:create --environment preview --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <supabase-anon-key>
npm run smoke:device-env
npm run build:android:preview
```

官网 Android preview 只有一条发布链：审核后的 main → GitHub Actions 检查/EAS构建（或同SHA有效artifact复用）→ 受限SSH receiver/publisher → 公网完整下载校验。构建后自动发布，不再逐包手动晋级；商店提交与真机验收仍独立。

- 唯一入口：GitHub Actions 的 `Android Preview Release`，main相关push、工作日18:30或main手动触发。失败重试默认复用原包；`force_rebuild` 才重新构建。
- `android-build` 只用Expo构建凭证，`production` 仅main使用部署凭证；预先核验SSH主机身份。Caddy直接读取 `/srv/voxflame/android`，无需重建应用/代理。
- 旧 `release:android:preview` / `sync:android:latest` 及后台形式已失败关闭，不再直发；旧服务器timer必须停用/mask，不能在GitHub失败时另起构建发布旁路。旧GitHub bootstrap也已退役。
- 构建辅助脚本仅支持 `bash scripts/release-android-preview.sh build-artifact <目录>`，不会更新官网。EAS下载缓存仍可续传。
- publisher保留previous及切换前历史备份，拒绝版本倒退/同版本异包；可处理的公网校验失败恢复旧实物。真机登录/录音/积压补传缺测不得记作通过。

操作、配置与恢复统一见[App发布手册](../../research/operations/APP_RELEASE.md)；线上是否已完成切换以[单链路记录](../../research/operations/ANDROID_SINGLE_RELEASE_2026-09-13.md)为准。

The app environment is public-client only. Before building for a real phone, set `EXPO_PUBLIC_API_BASE_URL` to the computer or server address the phone can reach, such as `http://192.168.1.23:3001/api`. Do not use `127.0.0.1` for a physical phone.

Remote EAS builds do not automatically receive your uncommitted local `.env`, so configure the `EXPO_PUBLIC_*` values in EAS before cloud builds. These values are public client configuration; never add service role keys, LiveKit API secrets, DashScope keys, or OSS secrets.

### 独立品牌构建

第二品牌与主 App 共用业务代码和 Backend/Auth/OSS 契约，但必须作为独立安装包发布。构建前设置以下公开品牌值和发布标识：

```bash
VOXFLAME_APP_FLAVOR=collection \
EXPO_PUBLIC_APP_BRAND_NAME=<第二品牌名称> \
EXPO_PUBLIC_APP_BRAND_ACCENT=<#RRGGBB> \
VOXFLAME_COLLECTION_APP_ICON=<图标路径> \
VOXFLAME_COLLECTION_ANDROID_ADAPTIVE_ICON=<Android 前景图路径> \
VOXFLAME_COLLECTION_APP_SLUG=<独立 Expo slug> \
VOXFLAME_COLLECTION_APP_SCHEME=<独立 URL scheme> \
VOXFLAME_COLLECTION_ANDROID_PACKAGE=<独立 Android package> \
VOXFLAME_COLLECTION_IOS_BUNDLE_IDENTIFIER=<独立 iOS Bundle ID> \
VOXFLAME_COLLECTION_EAS_PROJECT_ID=<独立 EAS project ID> \
npx expo config --type public
```

`app.config.js` 会在缺少任一独立标识时直接失败，防止误用 VoxFlame 名称、图标、包名、签名项目或发布渠道。第二品牌网站未配置自己的 App 下载地址时只显示“准备中”，不会分发现有 VoxFlame APK。

This server currently has stale `HTTP_PROXY / HTTPS_PROXY` values and an unsafe `NODE_TLS_REJECT_UNAUTHORIZED` override. The repository's `eas:*` and `build:*` scripts unset them automatically. If you run EAS manually, prefix the command with `env -u HTTP_PROXY -u HTTPS_PROXY -u NODE_TLS_REJECT_UNAUTHORIZED`.

`npm run eas:login` also uses `--no-browser` because this app is developed over VS Code / SSH. Browser login would send the callback to the developer computer's `localhost`, while EAS CLI is listening on the remote server.

## China App Stores

Domestic Android stores need a release APK, not a development build. Use:

```bash
cd apps/mobile-workbench
npm run eas:login
npx --yes eas-cli@latest env:create --environment production --visibility plaintext --name EXPO_PUBLIC_API_BASE_URL --value https://<production-api-host>/api
npx --yes eas-cli@latest env:create --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value <supabase-url>
npx --yes eas-cli@latest env:create --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <supabase-anon-key>
npm run build:android:china-store
```

Upload the generated APK to Xiaomi, Huawei AppGallery Android distribution, OPPO, vivo, or other Android app stores after store-specific review materials are ready.

Huawei / HarmonyOS has two tracks:

1. Huawei AppGallery Android app: use the APK generated above.
2. HarmonyOS NEXT native app: this React Native Android APK is not enough; a separate HarmonyOS-native implementation or port is required.

Before store submission, prepare privacy policy, user agreement, account deletion/data deletion instructions, microphone permission explanation, screenshots, app icon, app description, ICP/website information if required, and medical wording that says communication/training assistance only.

### RTC 第二切片（本地未部署）

Pending start HTTP is aborted on clear; stale responses cannot restore credentials. Reconnect fetches fresh credentials instead of reusing an old session. Native lifecycle logic now has isolated regression coverage; OS AudioSession and real-device cancellation remain acceptance gates. Bundle exports do not prove audio behavior.


### RTC P0 验证与治理

在仓库根运行 `npm run test:mobile-rtc`：执行生产hook代码的权限/audio/join/mic取消、旧事件/控制消息、账号切换、卸载和共享AudioSession租约回归；hook host/SDK/native均为替身，不是React或设备验收。App切换沟通/训练会取消另一路，HTTP到Room交接检查当前凭证归属。
真机模板新增四项RTC P0场景；`npm run validate:device-acceptance -- <result.json>` 对缺项、缺证据、pending/fail/conditional 返回非零。只有真实证据才能填写pass。完整指标继续使用既有语音Benchmark协议，不将租约回归换算为延迟/AEC效果。
