# VoxFlame Frontend

前端已收口到 `LiveKit RTC + room data` 实时链路，不再接入旧 websocket 代理。

## 技术栈

- Next.js 14 App Router
- React 18 + TypeScript + Tailwind CSS
- LiveKit client
- Web 网站（原生 Android / iPhone App 通过独立下载页提供）
- Web Audio API

## 当前职责

- 首页任务入口与资源入口
- 沟通页实时会话与 starter kit
- 训练页 RTC 会话、录音资产与上传回执
- 沟通档案页与共享 `workspace` 读模型
- 旧 Web App 运行时迁移清理

## 当前主链

```text
Frontend
  -> Backend /api/rtc/session/*
  -> self-hosted livekit-server
  -> livekit_agent
```

## 当前页面系统

- `/`
  首页已经从说明页收口成“高压场景优先”的任务入口，重点是 `现在沟通 / 练习表达 / 沟通档案`。
- `/communicate`
  唯一沟通 surface。匿名默认可直接用通用短语和手动输入做本机朗读；用户明确选择日常沟通后，才要求登录并在同页启动 LiveKit agent。记忆资料自动带入，不在沟通页重复编辑。
- `/practice`
  练习任务入口，只负责区分 `50 字普通话构音表现基线 / 训练与数据录入`。
- `/articulation-baseline`
  50 字普通话构音表现基线入口；录音与结果边界分别进入子页面。
- `/articulation-baseline/record`
  只保留准备、当前字、录音、确认和折叠进度的专注执行页。
- `/articulation-baseline/about`
  解释结果能做什么、不能做什么以及同设备复测原则。
- `/contribute`
  数据录入主题选择页。
- `/contribute/topic/[topicId]`
  单主题录音、训练反馈、训练资产上传和本地待同步队列工作台。
- `/memory`
  沟通档案页，不再只做统计，而是为“下一次沟通前准备什么”服务。

## 如何理解前端目录

一个更成熟的理解方式，不是把这些目录看成“按 React 习惯随便分”，而是把它们看成 4 层：

1. `src/app`
   - 路由入口层
   - 负责页面边界、URL、layout、server/client 入口和页面级组装
   - 这里回答的是“这个产品 surface 从哪里进”
2. `src/components`
   - 视图与交互块
   - 负责某个页面或某个 surface 上能被复用的 UI 片段
   - `components/home` 不是另一套架构，只是“首页专属组件”的意思
3. `src/hooks`
   - React 生命周期里的状态编排层
   - 负责把 RTC、录音、上传、workspace 等状态流组织成页面可用的 hook
   - 这里回答的是“这个交互如何在 React 里活起来”
4. `src/lib`
   - 领域逻辑、contract、runtime adapter 和纯函数层
   - 尽量承接不依赖具体页面结构的逻辑
   - 这里回答的是“这套产品能力在工程上到底怎么实现”

如果用一条更顶尖前端工程师的阅读顺序来理解，就是：

```text
app (路由/页面入口)
  -> components (页面里的可见块)
  -> hooks (状态和副作用编排)
  -> lib (领域逻辑、协议、runtime adapter)
```

在 VoxFlame 里，这 4 层对应的真实含义是：

- `app`
  决定沟通页、训练页、记忆页这些产品 surface
- `components`
  决定用户此刻看到什么、点哪里、负担重不重
- `hooks`
  决定会话怎么连、录音怎么走、页面状态怎么同步
- `lib`
  决定 memory、RTC、上传、workspace、training contract 这些底层能力如何落地

所以一个顶尖前端工程师不会只问“组件放哪”，而会先问：

1. 这是路由边界问题，还是可复用视图块问题？
2. 这是 React 状态编排问题，还是领域逻辑问题？
3. 这段代码以后会被多个 surface 共享，还是只服务某一个页面？

用这个标准再看现在的目录：

- `src/app/communicate`、`src/app/contribute`、`src/app/memory`
  是产品 surface
- `src/components/chat`、`src/components/home`
  是 surface-specific UI
- `src/hooks/useRtcAgentSession.ts`
  是会话 orchestration
- `src/lib/realtime-audio`、`src/lib/memory`、`src/lib/training`
  是真正应该长期稳定沉淀的能力层

## 当前前端 contract

- 运行时唯一事实源是 `Frontend LiveKit RTC/Data -> Backend /api/rtc/session/* -> self-hosted livekit-server -> livekit_agent`
- 长期画像前端优先消费 backend `workspace` 聚合接口，而不是页面各自拼 memory
- 训练录音前端统一围绕 `recording envelope -> recorder queue -> upload receipt` 组织
- 默认优先走同源 `/api` rewrite，而不是让浏览器直接访问 `:3001`

### RTC HTTP 契约与生命周期

`src/lib/realtime-audio/generated/rtc-session.ts` 来自 Backend canonical contract，不手改；`session-contract.ts` 只保留 Web 设备上下文与默认策略辅助函数。根目录 `npm run test:rtc-contract` 检查三端漂移与实际 HTTP 客户端解析。

`session-bootstrap.ts` 只获取并校验 start 响应；`session-runtime.ts` 等待 Agent ACK 后标记连接成功，退出走 SDK disconnect，不再 HTTP ping/stop。`transport` 是唯一连接信息；`joinTokenTtlSeconds` 不是会话时长。历史 `rtm` 内部变量名表示 LiveKit room data，不是另一套 RTM SDK。

发布需协调 Backend 与 App 版本；详见[接口边界](../research/product-engineering/RTC_CONTRACT_CLEANUP_2026-09-11.md)。

## 核心模块

- `src/hooks/useRtcAgentSession.ts`
  沟通页 RTC 音频、RTM 文本/控制、字幕与消息状态。

- `src/hooks/useMandarinTrainingSession.ts`
  训练页 RTC 会话、录音状态、实时 transcript 与 recorder envelope 产出。

- `src/hooks/useVoiceUpload.ts`
  训练资产上传、OSS 签名、manifest 回执与本地 recorder queue 同步。

- `src/hooks/useWorkspaceMemorySnapshot.ts`
  供沟通页、训练页、沟通档案页共享 `profile_bundle / session_review / expression_kit`。

- `src/app/page.tsx`
  首页和沟通模式入口。

- `src/app/contribute/page.tsx`
  中文训练页。

- `src/app/memory/page.tsx`
  沟通档案与场景化准备页。

## 快速开始

### Docker (推荐)

```bash
# 从项目根目录
sudo docker-compose up -d frontend
```

### 本地开发

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:3000`

## 核心组件

### `useRtcAgentSession`

管理 LiveKit RTC 音频会话和 room data 文本/控制通道：

```typescript
const {
  isConnected,
  isRecording,
  latestUserTranscript,
  messages,
  connect,
  startRecording,
  sendText,
} = useRtcAgentSession({ userId })
```

### `useMandarinTrainingSession`

训练页通过同一套 LiveKit transport 建会话，停止录音后回传 transcript 和本地录音 blob：

```typescript
const {
  status,
  interimText,
  startRecording,
  stopRecording,
  sendTrainingResult,
} = useMandarinTrainingSession({ userId })
```

## 训练资产链路

当前训练页的最小数据链路已经收口成：

```text
recording envelope
  -> recorder queue (IndexedDB)
  -> upload/sign
  -> OSS audio object
  -> upload/complete
  -> voice_contributions + manifest.jsonl + transcripts.txt(兼容)
```

- `recording_id / session_id / mode / source_surface / collection_mode / consent_scope` 已被强制带入上传 metadata
- 本地断网时录音先进入 `recorder queue`
- 上传成功后前端拿到结构化 `UploadReceipt`
- 后端现在会尽量复用已有 contribution / manifest，同一条录音重试时不再默认重复写入
- `upload/complete` 已把 `manifest.jsonl` 视为训练资产第一事实源；即使 `voice_contributions` 暂时异常，也优先避免样本静默丢失
- 历史缺 `upload_receipt` 的样本可通过 `backend` 下的 `npm run reconcile:artifacts -- --write` 补齐到当前 artifact 链
- 同一句目标句允许保留多条新录音；只有同一条录音的重试 / 补传才会被安全去重

## 音频格式

| 参数 | 值 |
|------|-----|
| 格式 | PCM |
| 采样率 | 16000 Hz |
| 位深 | 16-bit |
| 声道 | Mono |

## 环境变量

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

## 开发经验

### 浏览器自动播放策略

AudioContext 必须在用户交互后初始化：

```typescript
// 在用户点击后调用
await client.initAudio()
```

### Docker 缓存问题

代码更新后需要重新构建：

```bash
sudo docker-compose build frontend --no-cache
sudo docker-compose up -d frontend
```

### Web 与原生 App 边界

当前 Web 负责直接打开即用的沟通、练习和准备工作；Android / iPhone 原生内测包统一从 `/download` 获取。Web 不再提供安装到桌面、离线缓存或网页版本更新提示，避免与原生 App 入口混淆。

历史版本注册过 Web App 的浏览器，首次打开新版 Web 会自动注销旧 service worker 并删除旧缓存。录音待同步队列保存在 IndexedDB，不受这次清理影响。

## 相关文档

- [主项目 README](../README.md)
- [后端 README](../backend/README.md)
- [LiveKit Agent README](../livekit_agent/README.md)

### RTC 第二切片（本地未部署）

连接生命周期由单会话 AbortController 持有：disconnect 先使旧任务失效，HTTP/SDK/ACK/profile/重试均可取消；晚到 room 只清理自身，旧音轨禁止播放。`npm run test:rtc-contract`（仓库根）包含延迟替身竞态回归，不代替真实麦克风/RTC 验收。
