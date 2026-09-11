import {
  useCallback,
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
}

export function useMobileRtcSession(params: {
  apiBaseUrl: string | null
  tokenProvider: MobileAuthTokenProvider
  enabled: boolean
}): MobileRtcSessionState {
  const [status, setStatus] = useState<MobileRtcSessionStatus>('idle')
  const [session, setSession] = useState<MobileWorkbenchRtcSessionResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const canStart = Boolean(params.apiBaseUrl) && params.enabled

  const start = useCallback(async (
    intent: MobileWorkbenchRtcSessionIntent,
  ): Promise<MobileWorkbenchRtcSessionResponse | null> => {
    setErrorMessage(null)

    if (!params.apiBaseUrl) {
      setStatus('error')
      setErrorMessage('服务暂不可用，请稍后再试。')
      return null
    }

    if (!params.enabled) {
      setStatus('error')
      setErrorMessage('请先登录。')
      return null
    }

    setStatus('starting')

    try {
      const nextSession = await startMobileRtcSession(intent, {
        apiBaseUrl: params.apiBaseUrl,
        tokenProvider: params.tokenProvider,
      })
      setSession(nextSession)
      setStatus('ready')
      return nextSession
    } catch (error) {
      setSession(null)
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'realtime'))
      return null
    }
  }, [params.apiBaseUrl, params.enabled, params.tokenProvider])

  const clear = useCallback((): void => {
    setSession(null)
    setErrorMessage(null)
    setStatus('idle')
  }, [])

  return useMemo(() => ({
    status,
    session,
    errorMessage,
    canStart,
    start,
    clear,
  }), [
    canStart,
    clear,
    errorMessage,
    session,
    start,
    status,
  ])
}
