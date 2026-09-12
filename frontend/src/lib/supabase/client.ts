/**
 * Supabase 客户端配置
 * 用于数据收集页面的音频存储和元数据记录
 */
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// 从环境变量读取配置
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

if (!hasSupabaseConfig) {
  console.warn('⚠️ Supabase 配置缺失，客户端功能受限')
}

// 创建 Supabase 客户端（Singleton）
let supabaseInstance: SupabaseClient | null = null

/**
 * 获取 Supabase 客户端实例 (Browser)
 */
export const getSupabase = (): SupabaseClient | null => {
  if (!hasSupabaseConfig) return null

  if (!supabaseInstance) {
    supabaseInstance = createBrowserClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  }
  return supabaseInstance
}

/**
 * 通用创建函数 (供新代码使用)
 */
export const createClient = (): SupabaseClient => {
  const client = getSupabase()
  if (client) {
    return client
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

/**
 * Return the current access token through Supabase's single session owner.
 * `getSession()` already serializes refresh work and rotates expired tokens.
 */
export async function getAccessToken(): Promise<string | null> {
  const client = getSupabase()
  if (!client) return null

  try {
    const { data: { session }, error } = await client.auth.getSession()

    if (error) {
      console.error('[auth] session unavailable')
      return null
    }

    if (!session) return null

    // Do not hand an about-to-expire JWT to the upload pipeline. A request can
    // otherwise upload the object successfully and then lose the DB receipt
    // when /upload/complete rejects the stale token.
    const expiresAt = session.expires_at ?? 0
    if (expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000) + 90) {
      const refreshed = await client.auth.refreshSession()
      if (!refreshed.error && refreshed.data.session) {
        return refreshed.data.session.access_token
      }
    }

    return session.access_token
  } catch {
    console.error('[auth] session lookup failed')
    return null
  }
}
