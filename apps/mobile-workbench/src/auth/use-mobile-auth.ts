import { getSessionAccessToken, type AccessTokenOptions } from './session-token'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type {
  Session,
  SupabaseClient,
  User,
} from '@supabase/supabase-js'

import type { MobileRuntimeConfig } from '../api/mobile-config'
import type { MobileAuthTokenProvider } from '../api/mobile-workbench-client'
import {
  clearLastAuthEmail,
  readLastAuthEmail,
  rememberLastAuthEmail,
} from './mobile-auth-hint-storage'
import { createMobileSupabaseClient } from './mobile-supabase-client'
import { toMobileProductMessage } from '../ui/product-message'
import type { MobileRegistrationProfileMetadata } from './registration-profile'
import { buildMobileLegalConsentMetadata } from './legal-consent'

export type MobileAuthStatus =
  | 'config_missing'
  | 'initializing'
  | 'signed_out'
  | 'signed_in'
  | 'signing_in'
  | 'signing_up'
  | 'sending_code'
  | 'verifying_code'
  | 'binding_phone'
  | 'signing_out'
  | 'error'

export interface MobileAuthState {
  client: SupabaseClient | null
  user: User | null
  session: Session | null
  status: MobileAuthStatus
  errorMessage: string | null
  lastEmail: string
  tokenProvider: MobileAuthTokenProvider
  signInWithPassword(params: {
    email: string
    password: string
    consent?: boolean
  }): Promise<boolean>
  signUpWithPassword(params: {
    email: string
    password: string
    metadata: MobileRegistrationProfileMetadata
  }): Promise<boolean>
  requestPhoneLoginCode(phone: string, shouldCreateUser?: boolean, metadata?: MobileRegistrationProfileMetadata): Promise<boolean>
  verifyPhoneLoginCode(params: { phone: string; otp: string; consent?: boolean }): Promise<boolean>
  requestPhoneBindingCode(phone: string): Promise<boolean>
  verifyPhoneBindingCode(params: { phone: string; otp: string }): Promise<boolean>
  signOut(): Promise<void>
}

export function useMobileAuth(config: MobileRuntimeConfig): MobileAuthState {
  const client = useMemo(() => createMobileSupabaseClient(config), [
    config.supabaseAnonKey,
    config.supabaseUrl,
  ])
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<MobileAuthStatus>(
    client ? 'initializing' : 'config_missing',
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastEmail, setLastEmail] = useState('')

  useEffect(() => {
    let isMounted = true

    void readLastAuthEmail().then((email) => {
      if (!isMounted || !email) {
        return
      }

      setLastEmail(email)
    })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!client) {
      setStatus('config_missing')
      setUser(null)
      setSession(null)
      return undefined
    }

    let isMounted = true

    void client.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return
      }

      if (error) {
        setErrorMessage(toMobileProductMessage(error, 'auth'))
        setStatus('error')
        return
      }

      const currentSession = data.session ?? null
      setSession(currentSession)
      setUser(currentSession?.user ?? null)
      setStatus(currentSession ? 'signed_in' : 'signed_out')
    })

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      setStatus(nextSession ? 'signed_in' : 'signed_out')
      setErrorMessage(null)
    })

    return () => {
      isMounted = false
      data.subscription.unsubscribe()
    }
  }, [client])

  const signInWithPassword = useCallback(async (
    params: { email: string; password: string; consent?: boolean },
  ): Promise<boolean> => {
    if (!client) {
      setStatus('config_missing')
      setErrorMessage('服务暂不可用，请稍后再试。')
      return false
    }

    const email = params.email.trim().toLowerCase()
    const password = params.password
    if (!email || !password) {
      setStatus('signed_out')
      setErrorMessage('请输入邮箱和密码。')
      return false
    }

    setStatus('signing_in')
    setErrorMessage(null)

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setStatus('signed_out')
        setErrorMessage(toMobileProductMessage(error, 'auth'))
        return false
      }

      await rememberLastAuthEmail(email)
      setLastEmail(email)
      setSession(data.session)
      setUser(data.user)
      setStatus(data.session ? 'signed_in' : 'signed_out')
      if (data.session && params.consent) {
        const { data: updated } = await client.auth.updateUser({ data: buildMobileLegalConsentMetadata() })
        if (updated.user) setUser(updated.user)
      }
      return Boolean(data.session)
    } catch (error) {
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'auth'))
      return false
    }
  }, [client])

  const signUpWithPassword = useCallback(async (params: {
    email: string
    password: string
    metadata: MobileRegistrationProfileMetadata
  }): Promise<boolean> => {
    if (!client) {
      setStatus('config_missing')
      setErrorMessage('服务暂不可用，请稍后再试。')
      return false
    }
    const email = params.email.trim().toLowerCase()
    if (!email || !params.password) {
      setStatus('signed_out')
      setErrorMessage('请输入邮箱和密码。')
      return false
    }
    setStatus('signing_up')
    setErrorMessage(null)
    try {
      const { data, error } = await client.auth.signUp({
        email,
        password: params.password,
        options: { data: params.metadata },
      })
      if (error) {
        setStatus('signed_out')
        setErrorMessage(toMobileProductMessage(error, 'register'))
        return false
      }
      await rememberLastAuthEmail(email)
      setLastEmail(email)
      setSession(data.session)
      setUser(data.user)
      setStatus(data.session ? 'signed_in' : 'signed_out')
      return Boolean(data.session)
    } catch (error) {
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'register'))
      return false
    }
  }, [client])

  const requestPhoneLoginCode = useCallback(async (
    phone: string,
    shouldCreateUser = false,
    metadata?: MobileRegistrationProfileMetadata,
  ): Promise<boolean> => {
    if (!client) {
      setStatus('config_missing')
      setErrorMessage('服务暂不可用，请稍后再试。')
      return false
    }

    setStatus('sending_code')
    setErrorMessage(null)
    try {
      const { error } = await client.auth.signInWithOtp({
        phone,
        options: { shouldCreateUser, data: metadata },
      })
      setStatus('signed_out')
      if (error) {
        setErrorMessage(toMobileProductMessage(error, 'phone'))
        return false
      }
      return true
    } catch (error) {
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'phone'))
      return false
    }
  }, [client])

  const verifyPhoneLoginCode = useCallback(async (
    params: { phone: string; otp: string; consent?: boolean },
  ): Promise<boolean> => {
    if (!client) {
      setStatus('config_missing')
      setErrorMessage('服务暂不可用，请稍后再试。')
      return false
    }

    setStatus('verifying_code')
    setErrorMessage(null)
    try {
      const { data, error } = await client.auth.verifyOtp({
        phone: params.phone,
        token: params.otp,
        type: 'sms',
      })
      if (error || !data.session || !data.user) {
        setStatus('signed_out')
        setErrorMessage(toMobileProductMessage(error, 'phone'))
        return false
      }

      setSession(data.session)
      setUser(data.user)
      setStatus('signed_in')
      if (params.consent) {
        const { data: updated } = await client.auth.updateUser({ data: buildMobileLegalConsentMetadata() })
        if (updated.user) setUser(updated.user)
      }
      return true
    } catch (error) {
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'phone'))
      return false
    }
  }, [client])

  const requestPhoneBindingCode = useCallback(async (phone: string): Promise<boolean> => {
    if (!client || !user) {
      setErrorMessage('请先登录。')
      return false
    }

    setStatus('binding_phone')
    setErrorMessage(null)
    try {
      const { error } = await client.auth.updateUser({ phone })
      setStatus('signed_in')
      if (error) {
        setErrorMessage(toMobileProductMessage(error, 'phone'))
        return false
      }
      return true
    } catch (error) {
      setStatus('signed_in')
      setErrorMessage(toMobileProductMessage(error, 'phone'))
      return false
    }
  }, [client, user])

  const verifyPhoneBindingCode = useCallback(async (
    params: { phone: string; otp: string },
  ): Promise<boolean> => {
    if (!client || !user) {
      setErrorMessage('请先登录。')
      return false
    }

    const originalUserId = user.id
    setStatus('binding_phone')
    setErrorMessage(null)
    try {
      const { error } = await client.auth.verifyOtp({
        phone: params.phone,
        token: params.otp,
        type: 'phone_change',
      })
      if (error) {
        setStatus('signed_in')
        setErrorMessage(toMobileProductMessage(error, 'phone'))
        return false
      }

      const { data, error: refreshError } = await client.auth.getUser()
      if (refreshError || !data.user || data.user.id !== originalUserId) {
        setStatus('signed_in')
        setErrorMessage('账号验证失败，请重新登录。')
        return false
      }

      setUser(data.user)
      setStatus('signed_in')
      return true
    } catch (error) {
      setStatus('signed_in')
      setErrorMessage(toMobileProductMessage(error, 'phone'))
      return false
    }
  }, [client, user])

  const signOut = useCallback(async (): Promise<void> => {
    if (!client) {
      setStatus('config_missing')
      return
    }

    setStatus('signing_out')
    setErrorMessage(null)

    try {
      await client.auth.signOut()
      await clearLastAuthEmail()
      setLastEmail('')
      setSession(null)
      setUser(null)
      setStatus('signed_out')
    } catch (error) {
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'auth'))
    }
  }, [client])

  const tokenProvider = useMemo<MobileAuthTokenProvider>(() => ({
    async getAccessToken(options: AccessTokenOptions = {}): Promise<string | null> {
      if (!client || !user?.id) return null
      return getSessionAccessToken(client.auth, {
        ...options,
        expectedUserId: options.expectedUserId ?? user.id,
      })
    },
  }), [client, user?.id])

  return {
    client,
    user,
    session,
    status,
    errorMessage,
    lastEmail,
    tokenProvider,
    signInWithPassword,
    signUpWithPassword,
    requestPhoneLoginCode,
    verifyPhoneLoginCode,
    requestPhoneBindingCode,
    verifyPhoneBindingCode,
    signOut,
  }
}
