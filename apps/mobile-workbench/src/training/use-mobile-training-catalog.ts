import { useCallback, useEffect, useRef, useState } from 'react'

import type { MobileAuthTokenProvider } from '../api/mobile-workbench-client'
import { toMobileProductMessage } from '../ui/product-message'
import {
  fetchMobileTrainingCatalog,
  type MobileTrainingCategory,
  type MobileTrainingExercise,
  type MobileReadingArticleDetail,
  type MobileReadingArticleSummary,
} from './training-catalog'

export function isCurrentMobileCatalogRequest(
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestGeneration === currentGeneration
}

export function useMobileTrainingCatalog(params: {
  apiBaseUrl: string | null
  enabled: boolean
  tokenProvider: MobileAuthTokenProvider
}) {
  const [categories, setCategories] = useState<MobileTrainingCategory[]>([])
  const [exercises, setExercises] = useState<MobileTrainingExercise[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [readingArticles, setReadingArticles] = useState<MobileReadingArticleSummary[]>([])
  const [selectedReadingArticle, setSelectedReadingArticle] = useState<MobileReadingArticleDetail | null>(null)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const requestGenerationRef = useRef(0)
  const activeControllerRef = useRef<AbortController | null>(null)
  const catalogCacheRef = useRef(new Map<string, { cachedAt: number; catalog: Awaited<ReturnType<typeof fetchMobileTrainingCatalog>> }>())

  const beginRequest = useCallback(() => {
    activeControllerRef.current?.abort()
    const controller = new AbortController()
    const generation = requestGenerationRef.current + 1
    requestGenerationRef.current = generation
    activeControllerRef.current = controller
    return { controller, generation }
  }, [])

  const isCurrentRequest = useCallback((generation: number): boolean => (
    isCurrentMobileCatalogRequest(generation, requestGenerationRef.current)
  ), [])

  const load = useCallback(async (category?: string, readingArticleId?: string): Promise<void> => {
    if (!params.enabled || !params.apiBaseUrl) {
      return
    }
    setStatus('loading')
    setErrorMessage(null)
    const request = beginRequest()
    const cacheKey = `${category ?? ''}:${readingArticleId ?? ''}:0`
    const cached = catalogCacheRef.current.get(cacheKey)
    if (cached && Date.now() - cached.cachedAt < 30_000) {
      setCategories(cached.catalog.categories)
      setExercises(cached.catalog.exercises)
      setSelectedCategory(cached.catalog.selectedCategory)
      setReadingArticles(cached.catalog.readingArticles)
      setSelectedReadingArticle(cached.catalog.selectedReadingArticle)
      setTotal(cached.catalog.total)
      setStatus('ready')
      return
    }
    try {
      const catalog = await fetchMobileTrainingCatalog(
        params.apiBaseUrl,
        params.tokenProvider,
        category || readingArticleId ? { category, readingArticleId, limit: 120 } : undefined,
        request.controller.signal,
      )
      if (!isCurrentRequest(request.generation)) return
      catalogCacheRef.current.set(cacheKey, { cachedAt: Date.now(), catalog })
      setCategories(catalog.categories)
      setExercises(catalog.exercises)
      setSelectedCategory(catalog.selectedCategory)
      setReadingArticles(catalog.readingArticles)
      setSelectedReadingArticle(catalog.selectedReadingArticle)
      setTotal(catalog.total)
      setStatus('ready')
    } catch (error) {
      if (!isCurrentRequest(request.generation)) return
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'recording'))
    }
  }, [beginRequest, isCurrentRequest, params.apiBaseUrl, params.enabled, params.tokenProvider])

  const loadMore = useCallback(async (): Promise<MobileTrainingExercise[]> => {
    if (
      !params.enabled
      || !params.apiBaseUrl
      || (!selectedCategory && !selectedReadingArticle)
      || exercises.length >= total
    ) {
      return []
    }
    setStatus('loading')
    setErrorMessage(null)
    const request = beginRequest()
    const expectedCategory = selectedCategory
    const expectedArticleId = selectedReadingArticle?.id ?? null
    const expectedOffset = exercises.length
    try {
      const catalog = await fetchMobileTrainingCatalog(
        params.apiBaseUrl,
        params.tokenProvider,
        {
          category: selectedCategory ?? undefined,
          readingArticleId: selectedReadingArticle?.id,
          limit: 120,
          offset: expectedOffset,
        },
        request.controller.signal,
      )
      if (
        !isCurrentRequest(request.generation)
        || selectedCategory !== expectedCategory
        || (selectedReadingArticle?.id ?? null) !== expectedArticleId
      ) return []
      setExercises((current) => {
        if (current.length !== expectedOffset) return current
        const existingIds = new Set(current.map((exercise) => exercise.id))
        return [
          ...current,
          ...catalog.exercises.filter((exercise) => !existingIds.has(exercise.id)),
        ]
      })
      setStatus('ready')
      return catalog.exercises
    } catch (error) {
      if (!isCurrentRequest(request.generation)) return []
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'recording'))
      return []
    }
  }, [
    beginRequest,
    exercises.length,
    isCurrentRequest,
    params.apiBaseUrl,
    params.enabled,
    params.tokenProvider,
    selectedCategory,
    selectedReadingArticle,
    total,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => () => {
    requestGenerationRef.current += 1
    activeControllerRef.current?.abort()
  }, [])

  return {
    categories,
    exercises,
    selectedCategory,
    readingArticles,
    selectedReadingArticle,
    total,
    status,
    errorMessage,
    selectCategory: load,
    selectReadingArticle: (articleId: string) => load(undefined, articleId),
    loadMore,
  }
}
