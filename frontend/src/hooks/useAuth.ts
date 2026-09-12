'use client'

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import type { Session, User } from '@supabase/supabase-js'
import { buildLoginPath, getCurrentPathWithSearch } from '@/lib/auth/navigation'
import { createClient } from '@/lib/supabase/client'

export interface UseAuthOptions {
  /** 未登录时是否自动跳转到登录页 */
  redirectToLogin?: boolean
  /** 自定义登录页路径 */
  loginPath?: string
  /** 登录后回跳的目标页，默认使用当前地址 */
  nextPath?: string
}

export interface AuthState {
  user: User | null
  session: Session | null
  userId: string | null
  isLoading: boolean
  isAuthenticated: boolean
  error: Error | null
}

const INITIAL_AUTH_STATE: AuthState = {
  user: null,
  session: null,
  userId: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<AuthState>(INITIAL_AUTH_STATE)

  useEffect(() => {
    let active = true

    const setSessionState = (session: Session | null) => {
      if (!active) return
      setState({
        user: session?.user ?? null,
        session,
        userId: session?.user.id ?? null,
        isLoading: false,
        isAuthenticated: Boolean(session?.user),
        error: null,
      })
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        console.error('[auth] initial session unavailable')
        setState((current) => ({ ...current, isLoading: false, error }))
        return
      }
      setSessionState(data.session)
    }).catch(() => {
      if (!active) return
      console.error('[auth] initial session lookup failed')
      setState((current) => ({
        ...current,
        isLoading: false,
        error: new Error('登录状态暂时无法确认'),
      }))
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setSessionState(null)
        return
      }

      if (
        (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')
        && session?.user
      ) {
        setSessionState(session)
      }
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [supabase])

  return createElement(AuthContext.Provider, { value: state }, children)
}

export function useAuth(options: UseAuthOptions = {}): AuthState {
  const state = useContext(AuthContext)
  const router = useRouter()
  const {
    redirectToLogin = false,
    loginPath = '/login',
    nextPath,
  } = options

  useEffect(() => {
    if (!state || !redirectToLogin || state.isLoading || state.isAuthenticated || state.error) {
      return
    }

    const targetPath = nextPath ?? getCurrentPathWithSearch()
    router.replace(buildLoginPath(targetPath, loginPath))
  }, [loginPath, nextPath, redirectToLogin, router, state])

  if (!state) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return state
}

export async function getCurrentUserId(): Promise<string | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function getCurrentUser(): Promise<User | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export default useAuth
