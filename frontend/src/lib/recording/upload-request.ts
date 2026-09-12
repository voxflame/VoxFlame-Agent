export const UPLOAD_REQUEST_TIMEOUT_MS = 20_000
export const UPLOAD_REQUEST_MAX_ATTEMPTS = 3

export function isRetryableUploadResponse(response: Response): boolean {
  return response.status === 401 || response.status === 408 || response.status === 429 || response.status === 503
}

type FetchRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('Retry-After'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(10_000, retryAfter * 1000)
  }
  return Math.min(4_000, 500 * 2 ** attempt)
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs))
}

/** Bounds each upload step so a stalled request can fall back to the recorder queue. */
export async function fetchUploadRequest(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number = UPLOAD_REQUEST_TIMEOUT_MS,
  request: FetchRequest = fetch,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await request(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

/** Retry bounded overload responses; every upload remains safe through recording-id idempotency. */
export async function fetchUploadRequestWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: {
    attempts?: number
    timeoutMs?: number
    request?: FetchRequest
    onUnauthorized?: () => Promise<string | null>
  } = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? UPLOAD_REQUEST_MAX_ATTEMPTS)
  let response: Response | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await fetchUploadRequest(input, init, options.timeoutMs, options.request)
    if (response.status === 401 && attempt < attempts - 1 && options.onUnauthorized) {
      const token = await options.onUnauthorized()
      if (token) {
        init = { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } }
      }
    }
    if (!isRetryableUploadResponse(response) || attempt === attempts - 1) {
      return response
    }
    await wait(retryDelayMs(response, attempt))
  }
  return response as Response
}
