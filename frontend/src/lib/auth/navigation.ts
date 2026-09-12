const DEFAULT_NEXT_PATH = '/contribute'

const EXACT_PROTECTED_PATHS = new Set([
  '/assessment',
  '/memory',
  '/practice',
])

const PROTECTED_PATH_TREES = [
  '/contribute',
  '/communicate/assistant',
  '/corpus-review',
  '/settings',
]

function readForwardedHeader(
  headers: Pick<Headers, 'get'>,
  name: string,
): string | null {
  const value = headers.get(name)?.split(',')[0]?.trim()
  return value || null
}

export function normalizeNextPath(nextPath: string | null | undefined): string {
  if (!nextPath) {
    return DEFAULT_NEXT_PATH
  }

  if (!nextPath.startsWith('/')) {
    return DEFAULT_NEXT_PATH
  }

  if (nextPath.startsWith('//')) {
    return DEFAULT_NEXT_PATH
  }

  return nextPath
}

export function buildLoginPath(nextPath?: string | null, loginPath = '/login'): string {
  const normalizedNextPath = normalizeNextPath(nextPath)
  const params = new URLSearchParams({
    next: normalizedNextPath,
  })

  return `${loginPath}?${params.toString()}`
}

export function isProtectedPath(pathname: string): boolean {
  if (EXACT_PROTECTED_PATHS.has(pathname)) {
    return true
  }

  return PROTECTED_PATH_TREES.some(
    (rootPath) => pathname === rootPath || pathname.startsWith(`${rootPath}/`),
  )
}

export function resolveExternalOrigin(
  requestUrl: string,
  headers: Pick<Headers, 'get'>,
): string {
  const url = new URL(requestUrl)
  const forwardedHost = readForwardedHeader(headers, 'x-forwarded-host') ?? readForwardedHeader(headers, 'host')
  const forwardedProto =
    readForwardedHeader(headers, 'x-forwarded-proto') ?? url.protocol.replace(/:$/, '')

  if (!forwardedHost) {
    return url.origin
  }

  return `${forwardedProto}://${forwardedHost}`
}

export function getCurrentPathWithSearch(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_NEXT_PATH
  }

  return normalizeNextPath(`${window.location.pathname}${window.location.search}`)
}
