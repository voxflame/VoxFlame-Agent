# VoxFlame Backend

backend 当前是控制面和业务面，不再代理运行时 websocket 音频链路。

## 技术栈

- Express.js + TypeScript
- Supabase PostgreSQL
- REST API

## 当前职责

- RTC session orchestration
- workspace / memory API
- phrases API
- upload API
- RTC HTTP 响应/intent 契约与客户端生成源

## 当前主链

```text
Frontend
  -> Backend /api/rtc/session/*
  -> self-hosted livekit-server
  -> livekit_agent
```

## 快速开始

### Docker (推荐)

```bash
# 从项目根目录
sudo docker-compose up -d backend
```

### 本地开发

```bash
cd backend
npm install
npm run dev
```

服务运行在 `http://localhost:3001`

## 核心功能

### RTC orchestration

当前 backend 负责 LiveKit 会话编排：

```
Frontend (3000) → Backend (3001/api/rtc/*) → LiveKit server + livekit_agent
```

### API 端点

### 核心 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/rtc/health` | GET | RTC orchestration 健康检查 |
| `/api/rtc/session/start` | POST | 签发 LiveKit participant 凭证与会话意图 |

RTC 响应/intent 以 `src/contracts/rtc-session.ts` 为唯一可编辑源。从根目录运行 `node scripts/sync-rtc-contract.mjs` 生成客户端，`npm run test:rtc-contract` 检查漂移与解析；Backend `npm test` 包含本机 HTTP 路由测试（替身鉴权，不调用生产服务）。

`transport.participantToken` 是唯一凭证字段，`joinTokenTtlSeconds` 是 JWT TTL。实际连接/保活/断开归 LiveKit SDK room；`session/ping`、`session/stop`、`graphs` 已移除，不代表服务端支持踢人或撤销凭证。请求仍由 controller 白名单解析，可信账户/模型映射由 auth 与 service 提供；全量请求严格 schema 不在本轮范围。

本地破坏性契约尚未部署；Backend/Web/App 必须协调切换和整体回退，见[发布边界](../research/product-engineering/RTC_CONTRACT_CLEANUP_2026-09-11.md)。

### Workspace / 记忆系统 API

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/memory/workspace/:userId` | GET | 统一 workspace 快照：`profile bundle + session review + expression kit` | ✅ |
| `/api/memory/workspace/:userId/preferences` | PUT | 保存 durable `communication_preferences` | ✅ |
| `/api/memory/profile/:userId` | GET | 统一 memory profile 聚合 | ✅ |
| `/api/memory/add` | POST | 添加记忆 | ✅ |
| `/api/memory/search` | GET | 语义检索记忆 | ✅ |
| `/api/memory/:memoryId` | PUT | 更新记忆 | ✅ |
| `/api/memory/:memoryId` | DELETE | 删除记忆 | ✅ |

**添加记忆请求示例**:
```json
{
  "user_id": "uuid",
  "content": "用户喜欢用简短句子表达",
  "memory_type": "preference",
  "metadata": { "source": "conversation" }
}
```

**检索记忆请求示例**:
```
GET /api/memory/search?user_id=xxx&query=用户偏好&limit=10
```

### 常用短语 API

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/phrases` | POST | 创建短语 | ✅ |
| `/api/phrases/user/:userId` | GET | 获取用户短语 | ✅ |
| `/api/phrases/:phraseId` | PUT | 更新短语 | ✅ |
| `/api/phrases/:phraseId` | DELETE | 删除短语 | ✅ |
| `/api/phrases/:phraseId/use` | POST | 增加使用次数 | ✅ |
| `/api/phrases/reorder` | POST | 重排序短语 | ✅ |
| `/api/phrases/presets/initialize` | POST | 初始化预设 | ✅ |

## 环境变量

```bash
# .env
PORT=3001
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# Supabase (认证 + 数据库)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx  # 后端管理操作

# 记忆系统 (可选)
QDRANT_URL=http://qdrant:6333  # Phase 3
```

## 开发说明

- 新实时能力应接在 `/api/rtc/session/*` 或明确的业务 API 下
- 训练、沟通、记忆相关状态应分别落在 service/controller 分层里，不要堆进 `index.ts`。
- 新的 durable user state 默认应落到 `workspace owner`：
  - 读：`/api/memory/workspace/:userId`
  - 写：`/api/memory/workspace/:userId/preferences`
- 旧的 `/api/session/*` 与 `/api/agent/*` 兼容接口已从服务中移除，不再返回迁移型 501 响应。运行时会话统一使用 `/api/rtc/session/*`，durable user state 统一使用 `workspace owner` 或 `memory profile`。

## 相关文档

- [主项目 README](../README.md)
- [前端 README](../frontend/README.md)
- [LiveKit Agent README](../livekit_agent/README.md)
- [Full-stack 架构学习指南](../research/product-engineering/VOXFLAME_FULLSTACK_ARCHITECTURE_LEARNING_GUIDE_2026-04-29.md)
- [Voice agent 上下文与记忆研究综合](../research/voice-agent/CONTEXT_AND_MEMORY_RESEARCH_SYNTHESIS_2026-08-14.md)
