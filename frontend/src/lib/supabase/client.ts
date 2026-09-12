/**
 * Supabase 客户端配置
 * 用于数据收集页面的音频存储和元数据记录
 */
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSessionAccessToken, type AccessTokenOptions } from './session-token'

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

/** Get an account-bound token, refreshing near expiry or after an API rejection. */
export async function getAccessToken(options: AccessTokenOptions = {}): Promise<string | null> {
  const client = getSupabase()
  return client ? getSessionAccessToken(client.auth, options) : null
}
