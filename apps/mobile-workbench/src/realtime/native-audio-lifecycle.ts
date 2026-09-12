/** AudioSession is process-global, unlike Room. Serialize native calls and release by lease. */
export function createNativeAudioLeases(audio: {
  startAudioSession(): Promise<void>
  stopAudioSession(): Promise<void>
}) {
  const owners = new Set<symbol>()
  let tail: Promise<void> = Promise.resolve()
  let state: 'stopped' | 'started' | 'uncertain' = 'stopped'
  const reconcile = () => {
    const operation = tail.then(async () => {
      // A failed native call may still change device state. Reconcile before reuse.
      if (state === 'uncertain') {
        await audio.stopAudioSession()
        state = 'stopped'
      }
      if (owners.size > 0 && state === 'stopped') {
        state = 'uncertain'
        await audio.startAudioSession()
        state = 'started'
      } else if (owners.size === 0 && state === 'started') {
        state = 'uncertain'
        await audio.stopAudioSession()
        state = 'stopped'
      }
    })
    tail = operation.catch(() => undefined)
    return operation
  }
  return {
    acquire() {
      const owner = Symbol('native-audio')
      owners.add(owner)
      return {
        ready: reconcile(),
        release() {
          owners.delete(owner)
          return reconcile()
        },
      }
    },
  }
}

export class MobileConnectionCancelled extends Error {
  constructor() { super('mobile_connection_cancelled') }
}

export function assertMobileConnectionActive(signal: AbortSignal): void {
  if (signal.aborted) throw new MobileConnectionCancelled()
}

/** Settle the caller on cancellation, but keep observing late native rejections. */
export function waitForMobileConnection<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new MobileConnectionCancelled())
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(value => {
      signal.removeEventListener('abort', cancel)
      if (signal.aborted) cancel()
      else resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', cancel)
      if (signal.aborted) cancel()
      else reject(error)
    })
    if (signal.aborted) {
      signal.removeEventListener('abort', cancel)
      cancel()
    }
  })
}
