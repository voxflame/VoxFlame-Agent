/** Minimal Supabase session boundary; never returns an expired or another owner's token. */
interface TokenSession {
  access_token: string
  expires_at?: number
  user: { id: string }
}
interface SessionResult {
  data: { session: TokenSession | null }
  error: unknown
}
export interface SessionTokenAuth {
  getSession(): Promise<SessionResult>
  refreshSession(): Promise<SessionResult>
}
export interface AccessTokenOptions {
  expectedUserId?: string
  /** Refresh only if the SDK still has the JWT rejected by the API. */
  rejectedToken?: string
}
const REFRESH_MARGIN_SECONDS = 90
const SESSION_TIMEOUT_MS = 8_000
const refreshes = new WeakMap<SessionTokenAuth, Promise<SessionResult>>()

async function refreshOnce(auth: SessionTokenAuth): Promise<SessionResult> {
  const existing = refreshes.get(auth)
  if (existing) return existing
  const pending = auth.refreshSession()
  refreshes.set(auth, pending)
  try {
    return await pending
  } finally {
    if (refreshes.get(auth) === pending) refreshes.delete(auth)
  }
}

async function resolveToken(auth: SessionTokenAuth, options: AccessTokenOptions): Promise<string | null> {
  const current = await auth.getSession()
  if (current.error || !current.data.session) return null
  const session = current.data.session
  const owner = options.expectedUserId ?? session.user.id
  if (session.user.id !== owner) return null
  const now = () => Math.floor(Date.now() / 1000)
  const needsRefresh = !Number.isFinite(session.expires_at)
    || (session.expires_at ?? 0) <= now() + REFRESH_MARGIN_SECONDS
    || session.access_token === options.rejectedToken
  if (needsRefresh) {
    const refreshed = await refreshOnce(auth)
    if (refreshed.error || !refreshed.data.session || refreshed.data.session.user.id !== owner) return null
  }
  // Re-read the SDK owner after asynchronous refresh; account switches must not
  // authorize an old recording with the successor account's credentials.
  const latest = await auth.getSession()
  const value = latest.data.session
  if (latest.error || !value || value.user.id !== owner
    || !Number.isFinite(value.expires_at) || (value.expires_at ?? 0) <= now()
    || value.access_token === options.rejectedToken) return null
  return value.access_token || null
}

/** Bounded, coalesced SDK refresh. No custom JWT signing or stale-token fallback. */
export async function getSessionAccessToken(
  auth: SessionTokenAuth,
  options: AccessTokenOptions = {},
  timeoutMs = SESSION_TIMEOUT_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      resolveToken(auth, options),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
