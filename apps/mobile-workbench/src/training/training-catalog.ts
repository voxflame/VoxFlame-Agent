import type { MobileAuthTokenProvider } from '../api/mobile-workbench-client'

export interface MobileTrainingCategory {
  id: string
  label: string
  shortLabel: string
  description: string
  count: number
  kind: 'assessment' | 'collection'
}

export interface MobileTrainingExercise {
  id: string
  text: string
  category: string
}

export interface MobileReadingArticleSummary {
  id: string
  version: string
  title: string
  segmentCount: number
}

export interface MobileReadingArticleDetail extends MobileReadingArticleSummary {
  author: string
  summary: string
  fullText: string
  sourceLabel: string
  sourceUrl: string
}

export interface MobileTrainingCatalogResponse {
  categories: MobileTrainingCategory[]
  selectedCategory: string | null
  selectedReadingArticle: MobileReadingArticleDetail | null
  readingArticles: MobileReadingArticleSummary[]
  total: number
  offset: number
  limit: number
  exercises: MobileTrainingExercise[]
}

function buildCatalogUrl(
  apiBaseUrl: string,
  options?: { category?: string; readingArticleId?: string; query?: string; limit?: number; offset?: number },
): string {
  const normalizedApi = apiBaseUrl.replace(/\/$/, '')
  const route = `${normalizedApi}/training/catalog`
  const params = new URLSearchParams()
  if (options?.category) params.set('category', options.category)
  if (options?.readingArticleId) params.set('readingArticleId', options.readingArticleId)
  if (options?.query) params.set('query', options.query)
  if (typeof options?.limit === 'number') params.set('limit', String(options.limit))
  if (typeof options?.offset === 'number') params.set('offset', String(options.offset))
  const query = params.toString()
  return query ? `${route}?${query}` : route
}

export async function fetchMobileTrainingCatalog(
  apiBaseUrl: string,
  tokenProvider: MobileAuthTokenProvider,
  options?: { category?: string; readingArticleId?: string; query?: string; limit?: number; offset?: number },
  signal?: AbortSignal,
): Promise<MobileTrainingCatalogResponse> {
  const token = await tokenProvider.getAccessToken()
  if (!token) {
    throw new Error('mobile_auth_required')
  }

  const response = await fetch(buildCatalogUrl(apiBaseUrl, options), {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) {
    throw new Error(`training_catalog_${response.status}`)
  }
  return await response.json() as MobileTrainingCatalogResponse
}
