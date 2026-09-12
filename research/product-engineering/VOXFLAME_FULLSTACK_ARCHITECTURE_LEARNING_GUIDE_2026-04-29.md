# VoxFlame Full-stack Architecture Learning Guide（2026-04-29）

> 这份文档回答一个问题：面对一个新需求，怎样从“我想做一个功能”走到“我知道前端、后端、runtime、agent、数据和验证分别该怎么建”。

它不是新的技术选型，也不是替代 `README / PRD / current` 的入口。它是一套可复用的判断方法。

## 1. 总原则

一个应用不是由页面和接口拼起来的，而是由这些东西串起来的：

```text
真实用户场景
  -> 产品 surface
  -> 前端交互状态
  -> backend durable contract
  -> runtime / agent 执行面
  -> 数据沉淀与评估
```

所以每次遇到需求，先不要问“我要写几个组件 / 几个 API”。先问：

1. 用户在什么真实瞬间需要它？
2. 这个需求是一次会话内的事，还是跨天长期存在的事？
3. 哪些状态只是 UI 临时状态？
4. 哪些状态必须成为长期事实源？
5. 哪个系统拥有最终解释权？
6. 失败时怎么兜底？
7. 怎么证明它真的跑通？

这套问题比具体框架更重要。

## 2. VoxFlame 当前推荐架构

当前主链继续固定为：

```text
Frontend
  -> Backend
  -> self-hosted LiveKit
  -> livekit_agent
  -> model providers
  -> Backend workspace / dataset
```

分工如下：

1. `Frontend`
   - 产品 surface、可见交互、麦克风权限、本地录音、当前页面状态、本地 recorder queue。
   - 可以兜底，但不做长期记忆 owner。
2. `Backend`
   - durable owner、control plane、workspace snapshot、RTC session orchestration、upload receipt、训练总结、用户画像。
   - 负责把产品事实收成稳定 API contract。
3. `LiveKit`
   - realtime transport、room、participant、data channel、音频流。
   - 不做 durable memory owner。
4. `livekit_agent`
   - ASR、turn detection、correction、TTS、session-local working memory、会后 compaction candidate。
   - 聪明可以在这里发生，但长期事实仍要回到 backend。
5. `Dataset`
   - 录音资产、`target_text / recognized_text`、manifest、review、export。
   - 它不是 memory。
6. `Qdrant / Redis`
   - Qdrant 只在需要长历史语义召回时作为增强层。
   - Redis 只在明确需要 ephemeral coordination / cache 时引入。

## 3. 面对需求的 8 步

以后任何需求，都按这 8 步拆。

### 3.1 真实场景

先写一句人话：

```text
用户在什么时候、为什么需要这个能力？
```

例如：

```text
脑卒中后用户每天练习说话，希望知道最近一周是不是更稳定，而不是被系统评价“发音好坏”。
```

这一步决定产品语气和边界。

### 3.2 Surface

判断它出现在哪个 surface：

```text
home
communication workspace
training workspace
memory workspace
PWA
mobile workbench
desktop companion
hardware bridge
livekit_agent runtime
```

如果一个需求横跨多个 surface，先定义 primary surface，再定义其他 surface 只是读取、快捷入口还是补充展示。

### 3.3 生命周期

把状态按生命周期分开：

```text
UI temporary state
  只活在页面里

session-local state
  只活在一次 LiveKit session 里

durable workspace state
  跨天、跨设备、可恢复

dataset artifact
  音频、样本、manifest、导出

derived report
  后台维护、可覆盖、可解释
```

一旦生命周期混了，架构就会开始长歪。

### 3.4 Owner

每个事实只能有一个 owner。

当前 VoxFlame 的默认 owner 是：

```text
页面 UI 状态               -> frontend
麦克风 / 本地录音 blob      -> frontend
RTC token / session intent -> backend
room / audio / data        -> LiveKit
当前会话 working memory     -> livekit_agent
长期用户画像               -> backend workspace
准备材料 / 高频句           -> backend workspace
训练样本                   -> dataset layer
训练总结                   -> backend maintenance
```

如果一个新需求需要“新增一个长期对象”，先问它能不能被已有 owner 承接。

### 3.5 Contract

把需求写成最小输入输出。

例如训练 7 天总结：

```text
Input:
  user_id
  target_text
  recognized_text
  created_at
  exercise_category
  recording_id
  metadata.etiology / severity

Output:
  daily_summary
  weekly_summary
  sample_count
  mismatch_pairs
  stable_wins
  next_focus
  generated_at
```

contract 要比代码更早稳定。代码可以重构，contract 漂了会拖垮页面、runtime 和数据层。

### 3.6 Flow

画出数据流：

```text
Frontend action
  -> Backend API
  -> service
  -> provider / storage / runtime
  -> typed response
  -> frontend render
  -> verification
```

实时语音需求则要画两条线：

```text
control plane:
Frontend -> Backend -> LiveKit token / dispatch metadata

data plane:
Frontend RTC/Data -> LiveKit -> livekit_agent -> room data / audio
```

### 3.7 Failure

至少列出 4 类失败：

1. 权限失败：麦克风、浏览器 secure context、移动端限制。
2. 网络失败：断网、本地 queue、重试、补传。
3. provider 失败：ASR / TTS / LLM 超时或返回异常。
4. 重复提交：同一条录音重试、manifest 重复、session 重连。

能解释失败，才算真的设计了功能。

### 3.8 Verification

每个需求都要能被验证：

```text
frontend interaction smoke
backend build / service test
runtime unit / replay
dataset fixture
docs harness
```

VoxFlame 当前最重要的验证心智是：

```text
能点通不够，必须证明 owner、contract、fallback 和沉淀路径都对。
```

## 4. 前端架构怎么想

VoxFlame 前端按 4 层理解：

```text
src/app        路由和页面入口
src/components 可见 UI 块
src/hooks      React 生命周期与副作用编排
src/lib        领域逻辑、协议、adapter、纯函数
```

判断代码放哪：

1. 是 URL / 页面边界，放 `app`。
2. 是用户看见的一块界面，放 `components`。
3. 是连接 RTC、录音、上传、workspace 的状态编排，放 `hooks`。
4. 是可测试、可复用、脱离页面也成立的逻辑，放 `lib`。

当前最重要的边界：

1. hook 不要变成第二后端。
2. 页面不要自己拼 durable memory。
3. 前端可以有本地 queue，但最终 receipt 和 owner 在 backend。
4. UI state 要最小化，能从数据推导的不要重复存。

## 5. 后端架构怎么想

VoxFlame backend 是 control plane 和 durable owner，不是普通 CRUD 中转站。

推荐结构：

```text
controller
  -> service
  -> durable owner / provider adapter
  -> typed response contract
```

规则：

1. controller 只做认证、解析、错误映射。
2. service 承接业务判断和 owner 逻辑。
3. Supabase / OSS / LiveKit / model provider 都藏在 service 或 adapter 后面。
4. 新 durable user state 默认进入 `workspace owner`。
5. compat 路由只做迁移兜底，不承接新业务逻辑。

对 VoxFlame 来说，backend 最应该守住的是：

```text
workspace snapshot
RTC session intent
preparation context pack
upload receipt
training summary
session-close maintenance
```

## 6. Agent / Runtime 架构怎么想

`livekit_agent` 不应该一开始做成万能大脑。当前最健康的形态是：

```text
transport/session
  -> turn controller
  -> ASR adapter
  -> correction adapter
  -> TTS adapter
  -> context assembler
  -> session working memory
  -> compaction candidate
  -> backend durable write
```

它只拥有 session-local intelligence：

1. 当前轮 transcript。
2. 最近几轮上下文。
3. 当前准备包。
4. 打断、收音、clarity signal。
5. 会后压缩候选。

它不应该直接拥有：

1. 长期用户画像。
2. 训练样本主库。
3. prepared expression 主库。
4. 多端同步事实源。

## 7. 一个完整例子

需求：

```text
训练完后，给用户一个 7 天进步总结。
```

推荐拆法：

1. 场景
   - 用户想知道最近练习是否更稳，不要医学诊断。
2. surface
   - 主 surface 是 `training workspace`，辅助 surface 是 `memory workspace`。
3. 生命周期
   - 单条录音是 dataset artifact。
   - 7 天总结是 backend derived report。
4. owner
   - `voice_contributions / manifest` 提供事实输入。
   - backend summary service 生成总结。
   - frontend 只展示。
5. contract
   - 输入是 `target_text / recognized_text / created_at / category`。
   - 输出是 `weekly_summary / stable_wins / mismatch_pairs / next_focus`。
6. flow
   - 训练页录音上传。
   - backend 写 contribution 和 manifest。
   - maintenance service 聚合最近 7 天。
   - summary service 生成结构化报告。
   - workspace snapshot 暴露给训练页和记忆页。
7. failure
   - 样本少时只说“样本还不够形成趋势”。
   - ASR 低置信时只说“系统识别代理指标不稳定”。
   - provider 失败时保留旧 summary，不清空页面。
8. verification
   - service fixture 覆盖同一句多次练习。
   - frontend smoke 验证 summary 展示。
   - backend build。
   - docs harness。

这就是需求落架构的过程。

## 8. 当前最值得补的工程能力

短期不是继续加框架，而是补这三件事：

1. `context assembler`
   - 从 workspace snapshot 取最小必要上下文。
   - 生成明确的 `PreparationContextPack`。
   - 可测试、可回放。
2. `session-close compaction`
   - livekit_agent 产出 compaction candidate。
   - backend 做 durable maintenance。
   - 不把原始流水直接写入长期 memory。
3. `evaluation harness`
   - 前端 smoke。
   - backend fixture。
   - agent replay。
   - dataset export review。

## 9. 学习路线

### 9.1 先学 UI 和状态

目标：看到页面时，知道怎么拆组件、怎么找最小状态、怎么让数据单向流动。

推荐阅读：

1. [React: Thinking in React](https://react.dev/learn/thinking-in-react)
2. [React: Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)
3. [React: You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
4. [Next.js App Router](https://nextjs.org/docs/app)

读完要能回答：

1. 哪些东西是 props？
2. 哪些东西是 state？
3. 哪些东西能从已有数据推导？
4. 页面边界和组件边界为什么不同？

### 9.2 再学 backend contract

目标：知道 controller、service、storage、provider adapter 为什么要分开。

推荐阅读：

1. [Express Routing](https://expressjs.com/en/guide/routing.html)
2. [Express Error Handling](https://expressjs.com/en/guide/error-handling.html)
3. [Supabase Database Overview](https://supabase.com/docs/guides/database/overview)
4. [Martin Fowler: Service Layer](https://martinfowler.com/eaaCatalog/serviceLayer.html)
5. [Stripe: Idempotent Requests](https://docs.stripe.com/api/idempotent_requests)

读完要能回答：

1. controller 为什么不写业务逻辑？
2. service 为什么是业务 owner？
3. 为什么上传、支付、训练样本这类动作都需要 idempotency？
4. 为什么 API contract 比实现细节更稳定？

### 9.3 再学 realtime / voice runtime

目标：知道 control plane 和 data plane 怎么分，为什么 LiveKit 管实时传输但不管 durable memory。

推荐阅读：

1. [LiveKit Agents Introduction](https://docs.livekit.io/agents/)
2. [LiveKit Agent Session](https://docs.livekit.io/agents/logic-structure/sessions/)
3. [LiveKit Agent State](https://docs.livekit.io/frontends/build/agent-state/)
4. [LiveKit External Data and RAG](https://docs.livekit.io/agents/logic/external-data/)
5. [LiveKit Connect Basics](https://docs.livekit.io/intro/basics/connect/)
6. [MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

读完要能回答：

1. token 谁签？
2. room 里传什么？
3. agent session 什么时候开始、什么时候结束？
4. userdata / session state 和 durable memory 有什么区别？
5. 为什么麦克风权限必须考虑 HTTPS / localhost secure context？

### 9.4 再学本地兜底与离线

目标：知道为什么 PWA / recorder queue 能兜底，但不能替代 backend owner。

推荐阅读：

1. [MDN: IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
2. [MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
3. [The Twelve-Factor App: Config](https://12factor.net/config)

读完要能回答：

1. 什么适合放 IndexedDB？
2. 什么必须尽快同步到 backend？
3. 为什么 env/config 要和代码分开？
4. 为什么 PWA 是近端产品面，不是 durable truth owner？

### 9.5 最后学架构取舍

目标：能判断什么时候要 BFF、什么时候要 service layer、什么时候不要过早微服务化。

推荐阅读：

1. [Sam Newman: Backends For Frontends](https://samnewman.io/patterns/architectural/bff/)
2. [Martin Fowler: Microservices](https://martinfowler.com/articles/microservices.html)
3. [Martin Fowler: Presentation Domain Data Layering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)

读完要能回答：

1. 为什么 frontend 不应该直接拼所有后端资源？
2. 为什么不同 surface 可能需要不同 API shape？
3. 为什么微服务不是早期产品的默认答案？
4. 为什么分层不是为了好看，而是为了让 owner 和变化方向更清楚？

## 10. 每次开工前的小清单

写代码前，先填这个：

```text
需求一句话：

真实场景：

Primary surface：

状态生命周期：
  UI temporary:
  session-local:
  durable workspace:
  dataset artifact:
  derived report:

Owner：

最小输入：

最小输出：

数据流：

失败模式：

验证方式：
```

如果这个清单填不出来，说明还没到可以放心开写的时候。

## 11. 跟当前仓库怎么对照

当前最该一起读的仓库入口：

1. [主项目 README](../../README.md)
2. [前端 README](../../frontend/README.md)
3. [后端 README](../../backend/README.md)
4. [LiveKit Agent README](../../livekit_agent/README.md)
5. [产品 PRD](VOXFLAME_PRODUCT_PRD_2026-03-24.md)
6. [LiveKit 记忆最佳实践](../voice-agent/VOXFLAME_LIVEKIT_MEMORY_BEST_PRACTICES_2026-04-05.md)
7. [上下文与记忆研究综合](../voice-agent/CONTEXT_AND_MEMORY_RESEARCH_SYNTHESIS_2026-08-14.md)

当前最该跟读的代码入口：

1. [frontend/src/hooks/useRtcAgentSession.ts](../../frontend/src/hooks/useRtcAgentSession.ts)
2. [frontend/src/lib/realtime-audio/session-runtime.ts](../../frontend/src/lib/realtime-audio/session-runtime.ts)
3. [backend/src/services/rtc-orchestration.service.ts](../../backend/src/services/rtc-orchestration.service.ts)
4. [backend/src/services/livekit-session.service.ts](../../backend/src/services/livekit-session.service.ts)
5. [livekit_agent/session_userdata.py](../../livekit_agent/session_userdata.py)
6. [livekit_agent/data_contract.py](../../livekit_agent/data_contract.py)

这几处合起来，就是 VoxFlame 当前“需求如何变成应用”的真实骨架。
