/**
 * usePhrases Hook
 *
 * 管理常用短语的 React Hook
 * 提供 CRUD 操作和本地缓存
 */

import { useState, useEffect, useCallback } from 'react'
import { createClient, getAccessToken } from '@/lib/supabase/client'
import { config } from '@/lib/config'
import { reportFrontendDiagnostic, toProductMessage } from '@/lib/ui/product-message'
import type {
  QuickPhrase,
  CreatePhraseDTO,
  UpdatePhraseDTO,
  PhraseCategory
} from '@/lib/types/phrases'

export interface UsePhrasesOptions {
  autoLoad?: boolean
  userId?: string
}

export interface PhrasesState {
  phrases: QuickPhrase[]
  isLoading: boolean
  error: string | null
  requiresAuth: boolean
  selectedCategory: PhraseCategory | 'all'
}

export function usePhrases(options: UsePhrasesOptions = {}) {
  const { autoLoad = true, userId } = options

  const [state, setState] = useState<PhrasesState>({
    phrases: [],
    isLoading: false,
    error: null,
    requiresAuth: false,
    selectedCategory: 'all'
  })

  // 获取当前用户 ID
  const getCurrentUserId = useCallback(async (): Promise<string | null> => {
    if (userId) return userId

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id || null
  }, [userId])

  // API 请求辅助函数
  const apiRequest = useCallback(async (
    endpoint: string,
    options: RequestInit = {}
  ): Promise<unknown> => {
    const token = await getAccessToken()
    const url = `${config.api.baseUrl}${endpoint}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    if (!response.ok) {
      throw new Error(`phrases_request_${response.status}`)
    }

    return response.json()
  }, [])

  // 加载用户短语
  const loadPhrases = useCallback(async (category?: PhraseCategory | 'all') => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const currentUserId = await getCurrentUserId()
      if (!currentUserId) {
        setState(prev => ({
          ...prev,
          phrases: [],
          isLoading: false,
          error: null,
          requiresAuth: true,
          selectedCategory: category || 'all'
        }))
        return
      }

      const categoryParam = category && category !== 'all' ? `?category=${category}` : ''
      const data = await apiRequest(`/phrases/user/${currentUserId}${categoryParam}`) as {
        phrases?: QuickPhrase[]
      }

      setState(prev => ({
        ...prev,
        phrases: data.phrases || [],
        isLoading: false,
        requiresAuth: false,
        selectedCategory: category || 'all'
      }))
    } catch (error) {
      reportFrontendDiagnostic('phrases-load', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        requiresAuth: false,
        error: toProductMessage(error, 'phrases')
      }))
    }
  }, [apiRequest, getCurrentUserId])

  // 创建短语
  const createPhrase = useCallback(async (dto: CreatePhraseDTO): Promise<QuickPhrase | null> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const currentUserId = await getCurrentUserId()
      if (!currentUserId) {
        throw new Error('登录后可保存自定义短语')
      }

      const data = await apiRequest('/phrases', {
        method: 'POST',
        body: JSON.stringify({
          user_id: currentUserId,
          ...dto
        })
      }) as QuickPhrase

      // 刷新列表
      await loadPhrases(state.selectedCategory)

      return data
    } catch (error) {
      reportFrontendDiagnostic('phrases-create', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: toProductMessage(error, 'phrases')
      }))
      return null
    }
  }, [apiRequest, getCurrentUserId, loadPhrases, state.selectedCategory])

  // 更新短语
  const updatePhrase = useCallback(async (
    phraseId: string,
    dto: UpdatePhraseDTO
  ): Promise<QuickPhrase | null> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const data = await apiRequest(`/phrases/${phraseId}`, {
        method: 'PUT',
        body: JSON.stringify(dto)
      }) as QuickPhrase

      // 更新本地状态
      setState(prev => ({
        ...prev,
        phrases: prev.phrases.map(p =>
          p.id === phraseId ? { ...p, ...data } : p
        ),
        isLoading: false
      }))

      return data
    } catch (error) {
      reportFrontendDiagnostic('phrases-update', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: toProductMessage(error, 'phrases')
      }))
      return null
    }
  }, [apiRequest])

  // 删除短语
  const deletePhrase = useCallback(async (phraseId: string): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      await apiRequest(`/phrases/${phraseId}`, {
        method: 'DELETE'
      })

      // 更新本地状态
      setState(prev => ({
        ...prev,
        phrases: prev.phrases.filter(p => p.id !== phraseId),
        isLoading: false
      }))

      return true
    } catch (error) {
      reportFrontendDiagnostic('phrases-delete', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: toProductMessage(error, 'phrases')
      }))
      return false
    }
  }, [apiRequest])

  // 记录使用
  const incrementUsage = useCallback(async (phraseId: string): Promise<void> => {
    try {
      await apiRequest(`/phrases/${phraseId}/use`, {
        method: 'POST'
      })

      // 更新本地状态
      setState(prev => ({
        ...prev,
        phrases: prev.phrases.map(p =>
          p.id === phraseId
            ? { ...p, usage_count: (p.usage_count || 0) + 1, last_used_at: new Date().toISOString() }
            : p
        )
      }))
    } catch (error) {
      console.error('Failed to increment usage:', error)
      // 静默失败，不影响用户体验
    }
  }, [apiRequest])

  // 批量重排
  const reorderPhrases = useCallback(async (
    phraseOrders: Array<{ id: string; order_index: number }>
  ): Promise<boolean> => {
    try {
      await apiRequest('/phrases/reorder', {
        method: 'POST',
        body: JSON.stringify({ phrase_orders: phraseOrders })
      })

      return true
    } catch (error) {
      console.error('Failed to reorder phrases:', error)
      return false
    }
  }, [apiRequest])

  // 初始化预设短语
  const initializePresets = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const currentUserId = await getCurrentUserId()
      if (!currentUserId) {
        throw new Error('登录后可初始化并同步预设短语')
      }

      await apiRequest('/phrases/presets/initialize', {
        method: 'POST',
        body: JSON.stringify({ user_id: currentUserId })
      })

      // 刷新列表
      await loadPhrases(state.selectedCategory)

      return true
    } catch (error) {
      reportFrontendDiagnostic('phrases-initialize', error)
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: toProductMessage(error, 'phrases')
      }))
      return false
    }
  }, [apiRequest, getCurrentUserId, loadPhrases, state.selectedCategory])

  // 按分类筛选
  const filterByCategory = useCallback((category: PhraseCategory | 'all') => {
    setState(prev => ({ ...prev, selectedCategory: category }))
    loadPhrases(category)
  }, [loadPhrases])

  // 获取分类统计
  const getCategoryStats = useCallback(() => {
    const stats: Record<string, number> = {}
    state.phrases.forEach(phrase => {
      stats[phrase.category] = (stats[phrase.category] || 0) + 1
    })
    return stats
  }, [state.phrases])

  // 获取最常用短语
  const getMostUsed = useCallback((limit: number = 5) => {
    return [...state.phrases]
      .sort((a, b) => b.usage_count - a.usage_count)
      .slice(0, limit)
  }, [state.phrases])

  // 自动加载
  useEffect(() => {
    if (autoLoad) {
      loadPhrases()
    }
  }, [autoLoad, loadPhrases])

  return {
    ...state,
    loadPhrases,
    createPhrase,
    updatePhrase,
    deletePhrase,
    incrementUsage,
    reorderPhrases,
    initializePresets,
    filterByCategory,
    getCategoryStats,
    getMostUsed
  }
}

export default usePhrases
