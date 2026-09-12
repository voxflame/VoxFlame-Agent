import {
  useCallback,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
} from 'react'

import type {
  MobileAuthTokenProvider,
} from '../api/mobile-workbench-client'
import {
  startMobileRtcSession,
} from '../api/mobile-workbench-client'
import type {
  MobileWorkbenchRtcSessionIntent,
  MobileWorkbenchRtcSessionResponse,
} from '../contracts/workbench-contracts'
import { toMobileProductMessage } from '../ui/product-message'
import { waitForMobileConnection } from './native-audio-lifecycle'

export type MobileRtcSessionStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'error'

export interface MobileRtcSessionState {
  status: MobileRtcSessionStatus
  session: MobileWorkbenchRtcSessionResponse | null
  errorMessage: string | null
  canStart: boolean
  start(intent: MobileWorkbenchRtcSessionIntent): Promise<MobileWorkbenchRtcSessionResponse | null>
  clear(): void
  isCurrent(session: MobileWorkbenchRtcSessionResponse): boolean
}

export function useMobileRtcSession(params: {
  apiBaseUrl: string | null
  tokenProvider: MobileAuthTokenProvider
  enabled: boolean
  ownerId: string | null
}): MobileRtcSessionState {
  const requestRef = useRef<AbortController | null>(null)
  const contextRef = useRef<{ ownerId: string | null; enabled: boolean; apiBaseUrl: string | null; tokenProvider: MobileAuthTokenProvider } | null>(null)
  const sessionRef = useRef<MobileWorkbenchRtcSessionResponse | null>(null)
  const [status, setStatus] = useState<MobileRtcSessionStatus>('idle')
  const [session, setSession] = useState<MobileWorkbenchRtcSessionResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const canStart = Boolean(params.apiBaseUrl && params.ownerId) && params.enabled

  const start = useCallback(async (
    intent: MobileWorkbenchRtcSessionIntent,
  ): Promise<MobileWorkbenchRtcSessionResponse | null> => {
    const context = contextRef.current
    if (!context || context.ownerId !== params.ownerId || context.enabled !== params.enabled
      || context.apiBaseUrl !== params.apiBaseUrl || context.tokenProvider !== params.tokenProvider) return null
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    sessionRef.current = null
    setSession(null)
    setErrorMessage(null)

    if (!params.apiBaseUrl) {
      setStatus('error')
      setErrorMessage('服务暂不可用，请稍后再试。')
      return null
    }

    if (!params.enabled || !params.ownerId) {
      setStatus('error')
      setErrorMessage('请先登录。')
      return null
    }

    setStatus('starting')

    try {
      const nextSession = await waitForMobileConnection(startMobileRtcSession(intent, {
        apiBaseUrl: params.apiBaseUrl,
        signal: request.signal,
        tokenProvider: params.tokenProvider,
      }), request.signal)
      if (request.signal.aborted || requestRef.current !== request) return null
      setSession(nextSession)
      sessionRef.current = nextSession
      setStatus('ready')
      return nextSession
    } catch (error) {
      if (request.signal.aborted || requestRef.current !== request) return null
      setSession(null)
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'realtime'))
      return null
    }
  }, [params.apiBaseUrl, params.enabled, params.tokenProvider, params.ownerId])

  const clear = useCallback((): void => {
    requestRef.current?.abort()
    requestRef.current = null
    sessionRef.current = null
    setSession(null)
    setErrorMessage(null)
    setStatus('idle')
  }, [])

  useLayoutEffect(() => {
    contextRef.current = { ownerId: params.ownerId, enabled: params.enabled, apiBaseUrl: params.apiBaseUrl, tokenProvider: params.tokenProvider }
    clear()
    return () => {
      contextRef.current = null
      clear()
    }
  }, [clear, params.enabled, params.ownerId, params.apiBaseUrl, params.tokenProvider])

  const isCurrent = useCallback((candidate: MobileWorkbenchRtcSessionResponse) => (
    sessionRef.current === candidate && !requestRef.current?.signal.aborted
  ), [])

  return useMemo(() => ({
    status,
    session,
    errorMessage,
    canStart,
    start,
    clear,
    isCurrent,
  }), [
    canStart,
    clear,
    isCurrent,
    errorMessage,
    session,
    start,
    status,
  ])
}
