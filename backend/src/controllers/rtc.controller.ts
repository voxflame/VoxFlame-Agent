import { Request, Response, Router } from 'express'
import { RtcOrchestrationError, RtcOrchestrationService } from '../services/rtc-orchestration.service'
import { parseRtcStartSessionRequest } from '../contracts/rtc-session'
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
    // RTC credentials must never be issued via the development auth bypass.
    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    let request
    try {
      request = parseRtcStartSessionRequest(req.body)
    } catch {
      res.status(400).json({ error: 'rtc_session_invalid_request' })
      return
    }
    const authenticatedUserId = req.user.id
    const result = await rtcService.startSession({
      intent: request.intent,
      authenticatedUserId,
      asrAccountId: resolveAsrAccountId({ userId: authenticatedUserId, email: req.user.email }),
      browserOrigin: deriveBrowserOrigin(req),
    })

    res.json(result)
  } catch (error) {
    handleRtcError(res, error)
  }
})

export default router
