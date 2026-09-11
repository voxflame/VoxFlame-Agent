/** Cancellation is control flow, never a user-facing connection failure. */
export class SessionConnectionCancelledError extends Error {
  constructor() {
    super('rtc_connection_cancelled')
    this.name = 'SessionConnectionCancelledError'
  }
}

export function assertSessionActive(signal: AbortSignal): void {
  if (signal.aborted) throw new SessionConnectionCancelledError()
}

/** Observe late rejection while allowing the caller to stop waiting immediately. */
export function waitForSession<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(new SessionConnectionCancelledError())
    signal.addEventListener('abort', cancel, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', cancel)
        if (signal.aborted) cancel()
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', cancel)
        if (signal.aborted) cancel()
        else reject(error)
      },
    )
    if (signal.aborted) {
      signal.removeEventListener('abort', cancel)
      cancel()
    }
  })
}

export function waitForSessionRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      reject(new SessionConnectionCancelledError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, ms)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}
