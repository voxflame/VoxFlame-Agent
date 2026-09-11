import { Request, Response, Router } from 'express'
import {
  RtcCapabilityId,
  RtcDeviceContext,
  RtcExecutionBackend,
  RtcOrchestrationError,
  RtcOrchestrationService,
  RtcScene,
  RtcSessionMode,
  RtcSessionIntentInput,
  RtcSessionStrategy,
  RtcSurface,
} from '../services/rtc-orchestration.service'
import { authMiddleware } from '../middlewares/auth.middleware'
import { resolveAsrAccountId } from '../services/asr-account-routing.service'

const router = Router()
const rtcService = new RtcOrchestrationService()

function getSingleHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null
  }

  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function deriveBrowserOrigin(req: Request): string | null {
  const originHeader = getSingleHeaderValue(req.headers.origin)
  if (originHeader) {
    try {
      const originUrl = new URL(originHeader)
      if (originUrl.protocol === 'http:' || originUrl.protocol === 'https:') {
        originUrl.pathname = ''
        originUrl.search = ''
        originUrl.hash = ''
        return originUrl.toString().replace(/\/$/, '')
      }
    } catch {
      // Ignore malformed origin and continue with fallback headers.
    }
  }

  const refererHeader = getSingleHeaderValue(req.headers.referer)
  if (refererHeader) {
    try {
      const refererUrl = new URL(refererHeader)
      if (refererUrl.protocol === 'http:' || refererUrl.protocol === 'https:') {
        refererUrl.pathname = ''
        refererUrl.search = ''
        refererUrl.hash = ''
        return refererUrl.toString().replace(/\/$/, '')
      }
    } catch {
      // Ignore malformed referer and continue with forwarded headers.
    }
  }

  const forwardedProto =
    getSingleHeaderValue(req.headers['x-forwarded-proto']) ?? req.protocol
  const forwardedHost =
    getSingleHeaderValue(req.headers['x-forwarded-host']) ??
    getSingleHeaderValue(req.headers.host)

  if (!forwardedProto || !forwardedHost) {
    return null
  }

  if (forwardedProto !== 'http' && forwardedProto !== 'https') {
    return null
  }

  return `${forwardedProto}://${forwardedHost}`
}

function parseExecutionBackend(value: unknown): RtcExecutionBackend | undefined {
  return value === 'livekit' ? value : undefined
}

function parseMode(value: unknown): RtcSessionMode | undefined {
  return value === 'training'
    ? 'training'
    : value === 'communication'
      ? 'communication'
      : value === 'quick_talk'
        ? 'quick_talk'
        : undefined
}

function parseSurface(value: unknown): RtcSurface | undefined {
  return value === 'home_main' ||
    value === 'communication_workspace' ||
    value === 'training_workspace' ||
    value === 'memory_workspace' ||
    value === 'mobile_workbench' ||
    value === 'desktop_companion'
    ? value
    : undefined
}

function parseSessionStrategy(value: unknown): RtcSessionStrategy | undefined {
  return value === 'heavy_realtime' || value === 'light_voice'
    ? value
    : undefined
}

function parseScene(value: unknown): RtcScene | undefined {
  return value === 'medical' ||
    value === 'family' ||
    value === 'stranger' ||
    value === 'emergency' ||
    value === 'work' ||
    value === 'interview' ||
    value === 'outing' ||
    value === 'home'
    ? value
    : undefined
}

function parseRequestedCapabilities(value: unknown): RtcCapabilityId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const supportedCapabilities: RtcCapabilityId[] = [
    'transport_send_control',
    'voice_profile_update',
    'workspace_snapshot_read',
    'upload_artifact_persist',
  ]

  const deduped = new Set<RtcCapabilityId>()

  for (const item of value) {
    if (
      typeof item === 'string' &&
      supportedCapabilities.includes(item as RtcCapabilityId)
    ) {
      deduped.add(item as RtcCapabilityId)
    }
  }

  return deduped.size > 0 ? [...deduped] : undefined
}

function parseDeviceContext(value: unknown): RtcDeviceContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const raw = value as Record<string, unknown>
  const microphoneStatus =
    raw.microphoneStatus === 'unknown' ||
    raw.microphoneStatus === 'available' ||
    raw.microphoneStatus === 'unavailable'
      ? raw.microphoneStatus
      : undefined

  return {
    secureContext:
      typeof raw.secureContext === 'boolean' ? raw.secureContext : undefined,
    mediaDevicesSupported:
      typeof raw.mediaDevicesSupported === 'boolean'
        ? raw.mediaDevicesSupported
        : undefined,
    microphoneStatus,
    networkOnline:
      typeof raw.networkOnline === 'boolean' ? raw.networkOnline : undefined,
  }
}

function parseSessionIntent(value: unknown): RtcSessionIntentInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const raw = value as Record<string, unknown>

  return {
    surface: parseSurface(raw.surface),
    mode: parseMode(raw.mode),
    sessionStrategy: parseSessionStrategy(raw.sessionStrategy ?? raw.session_strategy),
    requestedCapabilities: parseRequestedCapabilities(
      raw.requestedCapabilities ?? raw.requested_capabilities,
    ),
    scene: parseScene(raw.scene),
    deviceContext: parseDeviceContext(raw.deviceContext ?? raw.device_context),
  }
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }

  return undefined
}

function handleRtcError(res: Response, error: unknown): void {
  if (error instanceof RtcOrchestrationError) {
    res.status(error.statusCode).json({ error: error.message })
    return
  }

  console.error('[RTC] Unexpected controller error:', error)
  res.status(500).json({ error: 'Internal server error' })
}

router.get('/health', (_req: Request, res: Response) => {
  const enabled = rtcService.isConfigured()

  res.json({
    status: enabled ? 'ok' : 'degraded',
    enabled,
    executionBackend: 'livekit',
  })
})

router.use(authMiddleware)

router.post('/session/start', async (req: Request, res: Response) => {
  try {
    const authenticatedUserId = req.user?.id ?? null
    const asrAccountId = authenticatedUserId
      ? resolveAsrAccountId({
          userId: authenticatedUserId,
          email: req.user?.email,
        })
      : null
    const result = await rtcService.startSession({
      requestId:
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
      channelName:
        typeof req.body?.channelName === 'string' ? req.body.channelName : undefined,
      executionBackend: parseExecutionBackend(
        req.body?.executionBackend ?? req.body?.execution_backend,
      ),
      mode: parseMode(req.body?.mode),
      intent: parseSessionIntent(req.body?.intent),
      userUid: parseOptionalInteger(req.body?.userUid),
      authenticatedUserId,
      asrAccountId,
      timeoutSeconds: parseOptionalInteger(req.body?.timeoutSeconds),
      browserOrigin: deriveBrowserOrigin(req),
    })

    res.json(result)
  } catch (error) {
    handleRtcError(res, error)
  }
})

export default router
