import { parseRtcStartSessionResult } from './generated/rtc-session'
import { config } from '@/lib/config'
import { getAccessToken } from '@/lib/supabase/client'
import type {
  RtcExecutionBackend,
  RtcSessionIntent,
  RtcSessionMode,
} from './session-contract'
import type { StartRtcSessionResponse } from './session-types'

function buildApiUrl(path: string): string {
  return `${config.api.baseUrl}${path}`
}

export async function buildAuthorizedJsonHeaders(
  accessToken?: string,
): Promise<Record<string, string>> {
  const token = await getAccessToken() || accessToken
  if (!token) {
    throw new Error('当前登录态还没有准备好，请刷新页面后再试。')
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

interface StartRtcSessionOptions {
  executionBackend?: RtcExecutionBackend
  accessToken?: string
  timeoutSeconds?: number
}

export async function startRtcSession(
  mode: RtcSessionMode,
  intent: RtcSessionIntent,
  options: StartRtcSessionOptions = {},
): Promise<StartRtcSessionResponse> {
  const headers = await buildAuthorizedJsonHeaders(options.accessToken)
  const response = await fetch(buildApiUrl('/rtc/session/start'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode,
      intent,
      ...(options.executionBackend
        ? { executionBackend: options.executionBackend }
        : {}),
      ...(typeof options.timeoutSeconds === 'number' && options.timeoutSeconds > 0
        ? { timeoutSeconds: options.timeoutSeconds }
        : {}),
    }),
  })

  if (!response.ok) {
    throw new Error(`rtc_session_start_${response.status}`)
  }

  return parseRtcStartSessionResult(await response.json())
}
