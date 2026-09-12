/**
 * 认证中间件
 * 验证 JWT Token 并提取用户信息
 */

import { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { SupabaseService } from '../services/supabase.service'

// 扩展 Request 类型，添加 user 属性
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        role?: string
        userMetadata: Record<string, unknown>
      }
    }
  }
}

// 初始化 Supabase 客户端（用于验证 Token）
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
const isProduction = process.env.NODE_ENV === 'production'

if (!supabaseUrl || !supabaseKey) {
  if (isProduction) {
    throw new Error('[AuthMiddleware] Supabase credentials are required in production')
  }

  console.warn('[AuthMiddleware] Supabase credentials missing. Auth middleware will be skipped.')
}

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null
const ensuredUserProfileIds = new Set<string>()

/**
 * 验证 Token 并提取用户信息
 * 
 * 使用方式：
 * router.get('/protected', authMiddleware, handler)
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // 如果 Supabase 未配置，跳过认证（开发环境）
  if (!supabase) {
    console.warn('[AuthMiddleware] Skipping auth - Supabase not configured')
    return next()
  }

  try {
    // 从 Header 获取 Token
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Missing or invalid Authorization header' 
      })
    }

    const token = authHeader.substring(7) // 去掉 "Bearer "

    // 验证 Token
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      console.error('[AuthMiddleware] Token validation failed:', error?.message)
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid or expired token' 
      })
    }

    // 将用户信息附加到 request
    req.user = {
      id: user.id,
      email: user.email || '',
      role: user.user_metadata?.role,
      userMetadata: user.user_metadata ?? {},
    }

    if (!ensuredUserProfileIds.has(user.id)) {
      const ensured = await SupabaseService.getInstance().ensureUserProfile(user.id)
      if (ensured) {
        ensuredUserProfileIds.add(user.id)
      }
    }

    next()
  } catch (err) {
    console.error('[AuthMiddleware] Error:', err)
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: 'Authentication failed' 
    })
  }
}

/**
 * 可选认证中间件
 * 如果有 Token 则验证，没有则跳过
 */
export async function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!supabase) {
    return next()
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next()
  }

  return authMiddleware(req, res, next)
}

/**
 * 验证 user_id 参数是否与当前登录用户匹配
 * 
 * 使用方式：
 * router.get('/user/:userId', authMiddleware, validateUserId, handler)
 */
export function validateUserId(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'User not authenticated' 
    })
  }

  // 从 params 或 body 获取 user_id
  const requestedUserId = req.params.userId || req.body.user_id || req.query.user_id

  if (!requestedUserId) {
    return res.status(400).json({ 
      error: 'Bad Request', 
      message: 'Missing user_id parameter' 
    })
  }

  // 验证 user_id 是否匹配
  if (requestedUserId !== req.user.id) {
    console.warn(`[AuthMiddleware] User ID mismatch: token=${req.user.id}, requested=${requestedUserId}`)
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'You do not have permission to access this resource' 
    })
  }

  next()
}

/**
 * 组合中间件：认证 + 用户ID验证
 */
export const requireAuth = [authMiddleware, validateUserId]

export default authMiddleware
