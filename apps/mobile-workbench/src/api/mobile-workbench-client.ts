import { parseRtcStartSessionResult } from '../contracts/generated/rtc-session'
import type {
  MobileWorkbenchRtcSessionIntent,
  MobileWorkbenchRtcSessionResponse,
} from '../contracts/workbench-contracts'
import type { MobileWorkspaceSnapshotContract } from '../contracts/workspace-read-model'

export interface MobileAuthTokenProvider {
  getAccessToken(): Promise<string | null>
}

export interface MobileWorkbenchClientOptions {
  apiBaseUrl: string
  tokenProvider: MobileAuthTokenProvider
}

function buildApiUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

async function getAuthorizationHeader(
  tokenProvider: MobileAuthTokenProvider,
): Promise<Record<string, string>> {
  const token = await tokenProvider.getAccessToken()
  if (!token) {
    throw new Error('mobile_auth_required')
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

export async function fetchMobileWorkspaceSnapshot(
  userId: string,
  options: MobileWorkbenchClientOptions,
): Promise<MobileWorkspaceSnapshotContract> {
  const authHeaders = await getAuthorizationHeader(options.tokenProvider)
  const response = await fetch(
    buildApiUrl(options.apiBaseUrl, `/memory/workspace/${userId}`),
    {
      headers: authHeaders,
    },
  )

  if (!response.ok) {
    throw new Error(`workspace_snapshot_${response.status}`)
  }

  return await response.json() as MobileWorkspaceSnapshotContract
}

export async function startMobileRtcSession(
  intent: MobileWorkbenchRtcSessionIntent,
  options: MobileWorkbenchClientOptions,
): Promise<MobileWorkbenchRtcSessionResponse> {
  const authHeaders = await getAuthorizationHeader(options.tokenProvider)
  const response = await fetch(
    buildApiUrl(options.apiBaseUrl, '/rtc/session/start'),
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: intent.mode,
        intent,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`rtc_session_start_${response.status}`)
  }

  const session = parseRtcStartSessionResult(await response.json())
  if (session.intent.surface !== 'mobile_workbench') throw new Error('rtc_session_invalid_surface')
  return session
}
