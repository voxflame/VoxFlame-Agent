/**
 * VoxFlame Backend Server
 * 
 * 单一 Agent 架构 - 后端当前主要负责：
 * 1. RTC session orchestration
 * 2. 记忆 / 短语 / 上传 API
 * 3. 基础 HTTP 健康检查
 * 
 * 语音处理（RTC/ASR/LLM/TTS）由 LiveKit + livekit_agent 承接
 */

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import rtcRouter from './controllers/rtc.controller'
import { memoryController } from './controllers/memory.controller'
import { uploadRouter } from './controllers/upload.controller'
import { phrasesController } from './controllers/phrases.controller'
import { mobileDiagnosticsRouter } from './controllers/mobile-diagnostics.controller'
import { qualityReviewRouter } from './controllers/quality-review.controller'
import { handleSupabaseSendSmsHook } from './controllers/auth-hook.controller'
import { errorHandler } from './middlewares/error.middleware'
import { authMiddleware, validateUserId } from './middlewares/auth.middleware'
import { TrainingReportMaintenanceService } from './services/training-report-maintenance.service'
import { uploadCapacityService } from './services/upload-capacity.service'

// 加载环境变量
dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const trainingReportMaintenanceService = new TrainingReportMaintenanceService()

const isProduction = process.env.NODE_ENV === 'production'
const publicBaseUrl = (process.env.VOXFLAME_PUBLIC_BASE_URL || '').trim()
const collectionPublicBaseUrl = (process.env.VOXFLAME_COLLECTION_PUBLIC_BASE_URL || '').trim()
const allowedCorsOrigins = new Set(
  [
    publicBaseUrl,
    collectionPublicBaseUrl,
    ...(process.env.VOXFLAME_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    ...(isProduction ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000']),
  ].filter(Boolean),
)

function isAllowedCorsOrigin(origin: string): boolean {
  return allowedCorsOrigins.has(origin)
}

// 中间件
app.disable('x-powered-by')
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})
app.use(cors({
  origin(origin, callback) {
    if (!origin || isAllowedCorsOrigin(origin)) {
      callback(null, true)
      return
    }

    callback(new Error('Origin is not allowed by CORS'))
  },
}))

// Supabase Send SMS Hook must receive the exact raw body used for Standard Webhooks signing.
app.post(
  '/api/auth/hooks/send-sms',
  express.raw({ type: 'application/json', limit: '64kb' }),
  handleSupabaseSendSmsHook,
)
app.use(express.json({ limit: process.env.VOXFLAME_JSON_BODY_LIMIT || '1mb' }))

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'VoxFlame Backend 运行正常',
    version: '2.2.0',
    architecture: 'RTC-native Agent Orchestration',
    rtcOrchestration: {
      enabled: true,
      target: process.env.LIVEKIT_BROWSER_URL || process.env.LIVEKIT_URL || null,
    },
    uploadCapacity: uploadCapacityService.snapshot(),
  })
})

// RTC orchestration API 路由；/api/rtc/health 在 router 内保持无认证，session/control 端点仍需认证。
app.use('/api/rtc', rtcRouter)

// Memory API 路由 (记忆系统) - 需要认证
const memoryRouter = express.Router()
memoryRouter.post('/session', authMiddleware, memoryController.syncSession.bind(memoryController))
memoryRouter.post('/session-close', authMiddleware, memoryController.persistSessionCloseProfileUpdate.bind(memoryController))
memoryRouter.post('/add', authMiddleware, memoryController.addMemory.bind(memoryController))
memoryRouter.get('/workspace/:userId', authMiddleware, validateUserId, memoryController.getWorkspaceMemorySnapshot.bind(memoryController))
memoryRouter.get('/workspace/:userId/scene-templates', authMiddleware, validateUserId, memoryController.getSceneTemplates.bind(memoryController))
memoryRouter.put('/workspace/:userId/scene-templates', authMiddleware, validateUserId, memoryController.syncSceneTemplates.bind(memoryController))
memoryRouter.get('/workspace/:userId/prepared-expressions', authMiddleware, validateUserId, memoryController.getPreparedExpressionLibrary.bind(memoryController))
memoryRouter.put('/workspace/:userId/prepared-expressions', authMiddleware, validateUserId, memoryController.syncPreparedExpressionAsset.bind(memoryController))
memoryRouter.put('/workspace/:userId/prepared-expressions/active', authMiddleware, validateUserId, memoryController.setActivePreparedExpressionAsset.bind(memoryController))
memoryRouter.delete('/workspace/:userId/prepared-expressions/:assetId', authMiddleware, validateUserId, memoryController.deletePreparedExpressionAsset.bind(memoryController))
memoryRouter.post('/workspace/:userId/prepared-expressions/:assetId/summarize', authMiddleware, validateUserId, memoryController.summarizePreparedExpressionAsset.bind(memoryController))
memoryRouter.put('/workspace/:userId/preferences', authMiddleware, validateUserId, memoryController.syncCommunicationPreferences.bind(memoryController))
memoryRouter.put('/workspace/:userId/profile-memory', authMiddleware, validateUserId, memoryController.syncUserProfileMemory.bind(memoryController))
memoryRouter.post('/hotwords', authMiddleware, memoryController.syncHotwords.bind(memoryController))
memoryRouter.get('/profile/:userId', authMiddleware, validateUserId, memoryController.getUserMemoryProfile.bind(memoryController))
memoryRouter.get('/search', authMiddleware, memoryController.searchMemories.bind(memoryController))
memoryRouter.put('/:memoryId', authMiddleware, memoryController.updateMemory.bind(memoryController))
memoryRouter.delete('/:memoryId', authMiddleware, memoryController.deleteMemory.bind(memoryController))
app.use('/api/memory', memoryRouter)

// Phrases API 路由 (常用短语) - 需要认证
const phrasesRouter = express.Router()
phrasesRouter.post('/', authMiddleware, phrasesController.createPhrase.bind(phrasesController))
phrasesRouter.get('/user/:userId', authMiddleware, validateUserId, phrasesController.getUserPhrases.bind(phrasesController))
phrasesRouter.put('/:phraseId', authMiddleware, phrasesController.updatePhrase.bind(phrasesController))
phrasesRouter.delete('/:phraseId', authMiddleware, phrasesController.deletePhrase.bind(phrasesController))
phrasesRouter.post('/:phraseId/use', authMiddleware, phrasesController.incrementUsage.bind(phrasesController))
phrasesRouter.post('/reorder', authMiddleware, phrasesController.reorderPhrases.bind(phrasesController))
phrasesRouter.post('/presets/initialize', authMiddleware, phrasesController.initializePresets.bind(phrasesController))
app.use('/api/phrases', phrasesRouter)

// Upload API 路由 (OSS 签名)
app.use('/api/upload', authMiddleware, uploadRouter)

// Human quality review is authenticated and additionally closed behind an exact email allowlist.
app.use('/api/quality-review', authMiddleware, qualityReviewRouter)

// Mobile release diagnostics: authenticated, strictly allow-listed, and text/audio-free.
app.use('/api/mobile/diagnostics', authMiddleware, mobileDiagnosticsRouter)

// Webhook 端点 - 预留给后续外部异步回调；生产默认关闭，显式启用后要求共享密钥。
app.post('/api/webhook/conversation', (req, res) => {
  if (process.env.VOXFLAME_WEBHOOK_CONVERSATION_ENABLED !== '1') {
    return res.status(404).json({ error: 'Not found' })
  }

  const expectedSecret = process.env.VOXFLAME_WEBHOOK_CONVERSATION_SECRET || ''
  const providedSecret = req.headers['x-voxflame-webhook-secret']

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { text, is_final, data_type, conversation_id, message_id } = req.body
  console.log(
    `[Webhook] type=${data_type || 'message'} conversationId=${conversation_id || 'null'} messageId=${message_id || 'null'} isFinal=${Boolean(is_final)} hasText=${typeof text === 'string' && text.length > 0}`,
  )
  res.json({ success: true, received: true })
})

// 错误处理中间件
app.use(errorHandler)

// 启动服务器
app.listen(PORT, () => {
  trainingReportMaintenanceService.start()
  console.log('')
  console.log('🔥 VoxFlame Backend v2.2 已启动')
  console.log('📡 HTTP 服务地址: http://localhost:' + PORT)
  console.log('🏥 健康检查: http://localhost:' + PORT + '/health')

  console.log('')
  console.log('🏗️ RTC-native 架构:')
  console.log('   - LiveKit server + livekit_agent: RTC + ASR/TTS + 纠错 + memory')
  console.log('   - 本服务 (' + PORT + '): session orchestration + API + 记忆管理')
  console.log('')
  console.log('🎛️ RTC Orchestration 端点:')
  console.log('   - GET  /api/rtc/health')
  console.log('   - POST /api/rtc/session/start')

  console.log('')
  console.log('💾 Memory API 端点:')
  console.log('   - POST /api/memory/session')
  console.log('   - GET  /api/memory/workspace/:userId')
  console.log('   - GET  /api/memory/workspace/:userId/scene-templates')
  console.log('   - PUT  /api/memory/workspace/:userId/scene-templates')
  console.log('   - GET  /api/memory/workspace/:userId/prepared-expressions')
  console.log('   - PUT  /api/memory/workspace/:userId/prepared-expressions')
  console.log('   - PUT  /api/memory/workspace/:userId/prepared-expressions/active')
  console.log('   - DELETE /api/memory/workspace/:userId/prepared-expressions/:assetId')
  console.log('   - POST /api/memory/workspace/:userId/prepared-expressions/:assetId/summarize')
  console.log('   - PUT  /api/memory/workspace/:userId/preferences')
  console.log('   - PUT  /api/memory/workspace/:userId/profile-memory')
  console.log('   - GET  /api/memory/profile/:userId')
  console.log('   - POST /api/memory/add')
  console.log('   - GET  /api/memory/search?user_id=xxx&query=...')

  console.log('')
  console.log('💬 Phrases API 端点:')
  console.log('   - POST /api/phrases')
  console.log('   - GET  /api/phrases/user/:userId')
  console.log('   - PUT  /api/phrases/:phraseId')
  console.log('   - POST /api/phrases/:phraseId/use')
  console.log('   - POST /api/phrases/reorder')

  console.log('')
  console.log('📡 Webhook 端点:')
  console.log('   - POST /api/webhook/conversation')
  console.log('')
})

export default app
