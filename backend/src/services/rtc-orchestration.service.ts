import { v4 as uuidv4 } from 'uuid'
import {
  LiveKitConfigError,
  LiveKitConfigService,
  type LiveKitExecutionStatus,
} from './livekit-config.service'
import {
  LiveKitPreparationContext,
  LiveKitSessionService,
} from './livekit-session.service'
import { SupabaseService } from './supabase.service'
import type {
  WorkspaceSceneId,
} from './expression-kit.service'

import type {
  RtcSessionMode,
  RtcExecutionBackend,
  RtcSurface,
  RtcSessionStrategy,
  RtcCapabilityId,
  RtcScene,
  RtcDeviceContext,
  RtcSessionIntentInput,
  RtcResolvedSessionIntent,
  RtcSessionReadiness,
  RtcSessionReadinessSummary,
  RtcStartSessionResult,
} from '../contracts/rtc-session'
export type {
  RtcSessionMode,
  RtcExecutionBackend,
  RtcSurface,
  RtcSessionStrategy,
  RtcCapabilityId,
  RtcScene,
  RtcDeviceContext,
  RtcSessionIntentInput,
  RtcResolvedSessionIntent,
  RtcSessionReadiness,
  RtcSessionReadinessSummary,
  RtcStartSessionResult,
} from '../contracts/rtc-session'

export interface RtcControlPlaneStatus {
  executionBackendStatus: Record<RtcExecutionBackend, RtcExecutionBackendStatus>
  supportedExecutionBackends: RtcExecutionBackend[]
  defaultExecutionBackend: RtcExecutionBackend
  supportedSurfaces: RtcSurface[]
  supportedSessionStrategies: RtcSessionStrategy[]
  activeExecutionBackend: RtcExecutionBackend
  activeExecutionStrategy: RtcSessionStrategy
  capabilityMatrix: Record<RtcSessionMode, RtcCapabilityId[]>
}

export interface RtcExecutionBackendStatus {
  configured: boolean
  enabled: boolean
  detail: string
  serverUrl: string | null
  missingEnv: string[]
}

export interface StartRtcSessionInput {
  requestId?: string
  channelName?: string
  executionBackend?: RtcExecutionBackend
  mode?: RtcSessionMode
  intent?: RtcSessionIntentInput
  userUid?: number
  authenticatedUserId?: string | null
  asrAccountId?: string | null
  timeoutSeconds?: number
  browserOrigin?: string | null
}

const SUPPORTED_SURFACES: RtcSurface[] = [
  'home_main',
  'communication_workspace',
  'training_workspace',
  'memory_workspace',
  'mobile_workbench',
  'desktop_companion',
]

const SUPPORTED_SESSION_STRATEGIES: RtcSessionStrategy[] = [
  'heavy_realtime',
  'light_voice',
]

const SUPPORTED_EXECUTION_BACKENDS: RtcExecutionBackend[] = ['livekit']

const MODE_CAPABILITY_MATRIX: Record<RtcSessionMode, RtcCapabilityId[]> = {
  communication: ['transport_send_control', 'workspace_snapshot_read'],
  training: [
    'transport_send_control',
    'workspace_snapshot_read',
    'voice_profile_update',
    'upload_artifact_persist',
  ],
  quick_talk: ['transport_send_control'],
}

export class RtcOrchestrationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'RtcOrchestrationError'
  }
}

export class RtcOrchestrationService {
  private readonly liveKitConfig = new LiveKitConfigService()
  private readonly liveKitSessionService = new LiveKitSessionService()
  private readonly supabaseService = createSupabaseService()
  private readonly defaultTimeoutSeconds = this.parseTimeout(
    process.env.RTC_DEFAULT_TIMEOUT,
    120,
  )

  public isConfigured(): boolean {
    return this.liveKitConfig.getStatus().configured
  }

  public getControlPlaneStatus(): RtcControlPlaneStatus {
    const liveKitStatus = this.liveKitConfig.getStatus()

    return {
      executionBackendStatus: {
        livekit: mapLiveKitExecutionStatus(liveKitStatus),
      },
      supportedExecutionBackends: [...SUPPORTED_EXECUTION_BACKENDS],
      defaultExecutionBackend: 'livekit',
      supportedSurfaces: [...SUPPORTED_SURFACES],
      supportedSessionStrategies: [...SUPPORTED_SESSION_STRATEGIES],
      activeExecutionBackend: 'livekit',
      activeExecutionStrategy: 'heavy_realtime',
      capabilityMatrix: {
        communication: [...MODE_CAPABILITY_MATRIX.communication],
        training: [...MODE_CAPABILITY_MATRIX.training],
        quick_talk: [...MODE_CAPABILITY_MATRIX.quick_talk],
      },
    }
  }

  public async startSession(
    input: StartRtcSessionInput,
  ): Promise<RtcStartSessionResult> {
    const intent = resolveSessionIntent(input)
    const readiness = buildSessionReadiness(intent)

    if (readiness.blockers.length > 0) {
      throw new RtcOrchestrationError(readiness.blockers[0], 400)
    }

    const requestId = input.requestId?.trim() || uuidv4()
    const channelName = sanitizeChannelName(
      input.channelName?.trim() || buildChannelName(intent.mode),
    )
    const userUid = normalizeUid(input.userUid) ?? generateRtcUid()
    const timeoutSeconds =
      normalizePositiveInt(input.timeoutSeconds) ?? this.defaultTimeoutSeconds

    const liveKitStatus = this.assertLiveKitCanStart()
    const browserServerUrl =
      liveKitStatus.browserUrl ??
      deriveRtcBrowserWebSocketUrl(
        liveKitStatus.serverUrl!,
        input.browserOrigin,
      ) ??
      liveKitStatus.serverUrl!
    const preparationContext = await this.loadPreparationContext(
      input.authenticatedUserId,
      intent,
    )
    const liveKitSession = await this.liveKitSessionService.createSession({
      requestId,
      roomName: channelName,
      userUid,
      timeoutSeconds,
      intent,
      readiness,
      serverUrl: liveKitStatus.serverUrl!,
      apiKey: process.env.LIVEKIT_API_KEY!.trim(),
      apiSecret: process.env.LIVEKIT_API_SECRET!.trim(),
      agentName: liveKitStatus.agentName,
      authenticatedUserId: input.authenticatedUserId,
      asrAccountId: input.asrAccountId,
      preparationContext,
    })

    return {
      requestId,
      channelName,
      executionBackend: 'livekit',
      joinTokenTtlSeconds: timeoutSeconds,
      transport: {
        provider: 'livekit',
        serverUrl: browserServerUrl,
        roomName: liveKitSession.roomName,
        participantIdentity: liveKitSession.participantIdentity,
        participantName: liveKitSession.participantName,
        participantToken: liveKitSession.participantToken,
        participantMetadata: liveKitSession.participantMetadata,
        participantAttributes: liveKitSession.participantAttributes,
        agentDispatch: liveKitSession.agentDispatch
          ? { agentName: liveKitSession.agentDispatch.agentName }
          : null,
      },
      intent,
      readiness,
    }
  }

  private parseTimeout(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  private assertLiveKitCanStart(): ReturnType<LiveKitConfigService['getStatus']> {
    try {
      const status = this.liveKitConfig.getStatus()
      this.liveKitConfig.assertCanStart()
      return status
    } catch (error) {
      if (error instanceof LiveKitConfigError) {
        throw new RtcOrchestrationError(error.message, error.statusCode)
      }

      throw error
    }
  }

  private async loadPreparationContext(
    authenticatedUserId: string | null | undefined,
    intent: RtcResolvedSessionIntent,
  ): Promise<LiveKitPreparationContext | null> {
    if (!authenticatedUserId) {
      return null
    }

    if (!intent.grantedCapabilities.includes('workspace_snapshot_read')) {
      return null
    }

    if (!this.supabaseService) {
      return null
    }

    try {
      const snapshot = await this.supabaseService.getWorkspaceMemorySnapshot(
        authenticatedUserId,
        {
          sceneId: mapRtcSceneToWorkspaceSceneId(intent.scene),
        },
      )

      return {
        source: 'workspace_snapshot',
        scene: snapshot.preparation.active_scene_id ?? intent.scene ?? null,
        immediateGoal:
          snapshot.preparation.immediate_goal ||
          '当前优先先准备最关键的一句表达。',
        profileSummary:
          snapshot.preparation.profile_summary ||
          '当前准备上下文已载入，请优先帮助用户把关键表达说清楚。',
        listenerGuidance: snapshot.preparation.listener_guidance.slice(0, 4),
        supportStrategies: snapshot.preparation.support_strategies.slice(0, 4),
        hotwords: this.collectInitialPreparationHotwords(snapshot),
        riskyTerms: this.collectInitialPreparationRiskyTerms(snapshot),
        documentSummary: this.collectInitialPreparationDocumentSummary(snapshot),
        documentContent: this.collectInitialPreparationDocumentContent(snapshot),
        referenceLines: this.collectInitialPreparationReferenceLines(snapshot),
        trainingPairs: [],
        loadoutMode: snapshot.communication_loadout.recommended_mode,
        loadoutReason: snapshot.communication_loadout.reason,
        loadoutItems: this.collectInitialPreparationLoadoutItems(snapshot),
      }
    } catch (error) {
      console.warn('[RTC] Failed to load workspace preparation context:', error)
      return null
    }
  }

  private collectInitialPreparationLoadoutItems(
    snapshot: Awaited<ReturnType<SupabaseService['getWorkspaceMemorySnapshot']>>,
  ): string[] {
    return snapshot.communication_loadout.sections.flatMap((section) => (
      section.items
        .filter((item) => item.required)
        .map((item) => (
          `默认 | ${section.title} | ${item.title}${item.summary.trim() ? `：${item.summary.trim()}` : ''}`
        ))
    )).slice(0, 8)
  }

  private collectInitialPreparationDocumentSummary(
    snapshot: Awaited<ReturnType<SupabaseService['getWorkspaceMemorySnapshot']>>,
  ): string | null {
    const customMaterialSelected = snapshot.communication_loadout.sections.some((section) => (
      section.items.some((item) => item.required && item.source_type === 'custom_material')
    ))

    return customMaterialSelected
      ? snapshot.preparation.document_context_summary
      : null
  }

  private collectInitialPreparationDocumentContent(
    snapshot: Awaited<ReturnType<SupabaseService['getWorkspaceMemorySnapshot']>>,
  ): string | null {
    const customMaterialSelected = snapshot.communication_loadout.sections.some((section) => (
      section.items.some((item) => item.required && item.source_type === 'custom_material')
    ))

    return customMaterialSelected
      ? snapshot.preparation.document_content
      : null
  }

  private collectInitialPreparationReferenceLines(
    snapshot: Awaited<ReturnType<SupabaseService['getWorkspaceMemorySnapshot']>>,
  ): string[] {
    const customMaterialSelected = snapshot.communication_loadout.sections.some((section) => (
      section.items.some((item) => item.required && item.source_type === 'custom_material')
    ))

    return customMaterialSelected
      ? snapshot.preparation.reference_lines.slice(0, 80)
      : []
  }

  private collectInitialPreparationHotwords(
    snapshot: Awaited<ReturnType<SupabaseService['getWorkspaceMemorySnapshot']>>,
  ): string[] {
    const sceneTemplateSelected = snapshot.communication_loadout.sections.some((section) => (
      section.items.some((item) => item.required && item.source_type === 'scene_template')
    ))

    return sceneTemplateSelected
      ? snapshot.preparation.hotwords.slice(0, 8)
      : []
  }

  private collectInitialPreparationRiskyTerms(
    snapshot: Awaited<ReturnType<SupabaseService['getWorkspaceMemorySnapshot']>>,
  ): string[] {
    const sceneTemplateSelected = snapshot.communication_loadout.sections.some((section) => (
      section.items.some((item) => item.required && item.source_type === 'scene_template')
    ))

    return sceneTemplateSelected
      ? snapshot.preparation.risky_terms.slice(0, 6)
      : []
  }
}

function mapLiveKitExecutionStatus(
  status: LiveKitExecutionStatus,
): RtcExecutionBackendStatus {
  return {
    configured: status.configured,
    enabled: status.enabled,
    detail: status.detail,
    serverUrl: status.browserUrl ?? status.serverUrl,
    missingEnv: [...status.missingEnv],
  }
}

function normalizeUid(value: number | undefined): number | null {
  if (!Number.isInteger(value) || !value || value <= 0) {
    return null
  }

  return value
}

function normalizePositiveInt(value: number | undefined): number | null {
  if (!Number.isInteger(value) || !value || value <= 0) {
    return null
  }

  return value
}

function generateRtcUid(): number {
  return 100000 + Math.floor(Math.random() * 800000)
}

function buildChannelName(mode: RtcSessionMode | undefined): string {
  const prefix =
    mode === 'training'
      ? 'voxtrain'
      : mode === 'quick_talk'
        ? 'voxquick'
        : 'voxrtc'
  return `${prefix}_${Date.now().toString(36)}_${uuidv4().slice(0, 8)}`
}

export function deriveRtcBrowserWebSocketUrl(
  serverUrl: string,
  browserOrigin: string | null | undefined,
): string | null {
  const trimmedServerUrl = serverUrl.trim()
  const trimmed = browserOrigin?.trim()
  if (!trimmedServerUrl || !trimmed) {
    return null
  }

  try {
    const targetUrl = new URL(trimmedServerUrl)
    const pageUrl = new URL(trimmed)
    if (
      (targetUrl.protocol !== 'ws:' && targetUrl.protocol !== 'wss:') ||
      (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:')
    ) {
      return null
    }

    const normalizedTargetHost = targetUrl.hostname.toLowerCase()
    const isTargetLoopback =
      normalizedTargetHost === 'localhost' ||
      normalizedTargetHost === '127.0.0.1' ||
      normalizedTargetHost === '::1'
    const isDockerOnlyHost = normalizedTargetHost === 'livekit-server'

    if (!isTargetLoopback && !isDockerOnlyHost) {
      return null
    }

    targetUrl.protocol = pageUrl.protocol === 'https:' ? 'wss:' : 'ws:'
    targetUrl.hostname = pageUrl.hostname
    targetUrl.pathname = ''
    targetUrl.search = ''
    targetUrl.hash = ''
    return targetUrl.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function mapRtcSceneToWorkspaceSceneId(
  scene: RtcScene | null,
): WorkspaceSceneId | undefined {
  switch (scene) {
    case 'interview':
      return 'interview'
    case 'work':
      return 'workplace'
    case 'stranger':
      return 'stranger'
    case 'medical':
      return 'medical'
    case 'family':
    case 'home':
      return 'caregiver'
    case 'emergency':
      return 'emergency'
    default:
      return undefined
  }
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  )
}


function createSupabaseService(): SupabaseService | null {
  try {
    return SupabaseService.getInstance()
  } catch {
    return null
  }
}

function resolveSessionIntent(input: StartRtcSessionInput): RtcResolvedSessionIntent {
  const requestedMode = input.intent?.mode ?? input.mode ?? 'communication'
  const mode = requestedMode
  const requestedStrategy =
    input.intent?.sessionStrategy ??
    (mode === 'quick_talk' ? 'light_voice' : 'heavy_realtime')
  const resolvedStrategy =
    requestedStrategy === 'light_voice'
      ? 'heavy_realtime'
      : requestedStrategy
  const surface = resolveSurface(input.intent?.surface, mode)
  const requestedCapabilities = resolveRequestedCapabilities(
    mode,
    input.intent?.requestedCapabilities,
  )
  const grantedCapabilities = requestedCapabilities.filter((capability) =>
    MODE_CAPABILITY_MATRIX[mode].includes(capability),
  )

  return {
    surface,
    mode,
    sessionStrategy: resolvedStrategy,
    requestedCapabilities,
    grantedCapabilities,
    scene: input.intent?.scene ?? null,
    deviceContext: {
      secureContext: input.intent?.deviceContext?.secureContext,
      mediaDevicesSupported: input.intent?.deviceContext?.mediaDevicesSupported,
      microphoneStatus: input.intent?.deviceContext?.microphoneStatus,
      networkOnline: input.intent?.deviceContext?.networkOnline,
    },
  }
}

function resolveSurface(
  surface: RtcSurface | undefined,
  mode: RtcSessionMode,
): RtcSurface {
  if (surface) {
    return surface
  }

  if (mode === 'training') {
    return 'training_workspace'
  }

  if (mode === 'quick_talk') {
    return 'home_main'
  }

  return 'communication_workspace'
}

function resolveRequestedCapabilities(
  mode: RtcSessionMode,
  requestedCapabilities: RtcCapabilityId[] | undefined,
): RtcCapabilityId[] {
  if (!requestedCapabilities || requestedCapabilities.length === 0) {
    return [...MODE_CAPABILITY_MATRIX[mode]]
  }

  const deduped = new Set<RtcCapabilityId>()
  for (const capability of requestedCapabilities) {
    if (MODE_CAPABILITY_MATRIX[mode].includes(capability)) {
      deduped.add(capability)
    }
  }

  return [...deduped]
}

function buildSessionReadiness(
  intent: RtcResolvedSessionIntent,
): RtcSessionReadiness {
  const blockers: string[] = []
  const warnings: string[] = []
  const microphoneRequired = intent.mode === 'training'
  const requestedStrategy =
    intent.mode === 'quick_talk'
      ? 'light_voice'
      : 'heavy_realtime'
  const resolvedStrategy = intent.sessionStrategy
  const recommendedStrategy = requestedStrategy

  if (recommendedStrategy !== resolvedStrategy) {
    warnings.push(
      'light_voice 仍是预留 contract，当前控制面会回退到 heavy_realtime 执行面。',
    )
  }

  if (intent.deviceContext.networkOnline === false) {
    blockers.push('当前设备离线，暂时无法启动实时语音会话。')
  }

  if (microphoneRequired) {
    if (intent.deviceContext.secureContext === false) {
      blockers.push('训练模式需要安全上下文，当前页面请使用 HTTPS 或 localhost。')
    }

    if (intent.deviceContext.mediaDevicesSupported === false) {
      blockers.push('当前浏览器暂不支持麦克风访问，训练模式无法启动。')
    }

    if (intent.deviceContext.microphoneStatus === 'unavailable') {
      blockers.push('当前设备未准备好麦克风，训练模式请先检查设备或权限。')
    }
  } else if (intent.deviceContext.secureContext === false) {
    warnings.push('当前页面不是安全上下文，后续若要录音请切到 HTTPS 或 localhost。')
  }

  const summary = buildSessionReadinessSummary({
    mode: intent.mode,
    blockers,
    warnings,
    canStart: blockers.length === 0,
  })

  return {
    canStart: blockers.length === 0,
    requestedStrategy,
    resolvedStrategy,
    recommendedStrategy,
    microphoneRequired,
    blockers,
    warnings,
    summary,
  }
}

function buildSessionReadinessSummary(input: {
  mode: RtcSessionMode
  blockers: string[]
  warnings: string[]
  canStart: boolean
}): RtcSessionReadinessSummary {
  const blockerSummary = input.blockers[0] || null
  const warningSummary = input.warnings[0] || null

  if (!input.canStart) {
    return {
      status: 'needs_attention',
      label: '需要处理',
      detail: blockerSummary || '当前页面还不满足启动条件。',
      nextAction: '先处理当前阻塞项，再继续这一轮任务。',
      blockerSummary,
      warningSummary,
    }
  }

  if (warningSummary) {
    return {
      status: 'can_start',
      label: '可以开始',
      detail: warningSummary,
      nextAction:
        input.mode === 'training'
          ? '可以先开始这一句训练，但最好先留意这条提醒。'
          : '可以继续连接或直接表达，但最好先留意这条提醒。',
      blockerSummary,
      warningSummary,
    }
  }

  return {
    status: 'ready',
    label: input.mode === 'training' ? '已经准备好训练' : '已经准备好沟通',
    detail:
      input.mode === 'training'
        ? '这页已经满足训练会话的基础条件，可以直接开始录音练习。'
        : '这页已经满足沟通会话的基础条件，可以直接连接并开始表达。',
    nextAction:
      input.mode === 'training'
        ? '可以直接开始这一句训练。'
        : '可以直接连接助手或开始表达，不需要再做额外准备。',
    blockerSummary,
    warningSummary,
  }
}

function sanitizeChannelName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new RtcOrchestrationError('channelName is required', 400)
  }

  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '_')
}
