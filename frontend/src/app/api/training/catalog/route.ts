import { NextRequest, NextResponse } from 'next/server'

import {
  MANDARIN_TRAINING_CATEGORIES,
  MANDARIN_TRAINING_CATEGORY_META,
  getExercisesByCategory,
  type MandarinTrainingCategory,
} from '@/lib/corpus/mandarin-training'
import {
  MANDARIN_READING_ARTICLES,
  getReadingArticle,
  getReadingArticleExercises,
} from '@/lib/corpus/reading-articles'

const DEFAULT_PAGE_SIZE = 60
const MAX_PAGE_SIZE = 120

function isTrainingCategory(value: string): value is MandarinTrainingCategory {
  return MANDARIN_TRAINING_CATEGORIES.some((category) => category === value)
}

function parseBoundedInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return Math.min(parsed, maximum)
}

export function GET(request: NextRequest) {
  const categoryValue = request.nextUrl.searchParams.get('category')?.trim() ?? ''
  const category = isTrainingCategory(categoryValue) ? categoryValue : null
  const readingArticleId = request.nextUrl.searchParams.get('readingArticleId')?.trim() ?? ''
  const readingArticle = readingArticleId ? getReadingArticle(readingArticleId) : null
  const query = request.nextUrl.searchParams.get('query')?.trim().toLowerCase() ?? ''
  const offset = parseBoundedInteger(request.nextUrl.searchParams.get('offset'), 0, 100_000)
  const limit = parseBoundedInteger(
    request.nextUrl.searchParams.get('limit'),
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  )

  const exercises = readingArticle
    ? getReadingArticleExercises(readingArticle)
    : category
    ? getExercisesByCategory(category).filter((exercise) => (
        !query || exercise.text.toLowerCase().includes(query)
      ))
    : []

  return NextResponse.json({
    categories: MANDARIN_TRAINING_CATEGORIES.map((item) => ({
      id: item,
      label: MANDARIN_TRAINING_CATEGORY_META[item].label,
      shortLabel: MANDARIN_TRAINING_CATEGORY_META[item].shortLabel,
      description: MANDARIN_TRAINING_CATEGORY_META[item].description,
      count: MANDARIN_TRAINING_CATEGORY_META[item].corpusCount,
      kind: item === '评估筛查' ? 'assessment' : 'collection',
    })),
    selectedCategory: category,
    selectedReadingArticle: readingArticle ? {
      id: readingArticle.id,
      version: readingArticle.version,
      title: readingArticle.title,
      author: readingArticle.author,
      summary: readingArticle.summary,
      fullText: readingArticle.fullText,
      sourceLabel: readingArticle.source.label,
      sourceUrl: readingArticle.source.sourceUrl,
      segmentCount: readingArticle.segments.length,
    } : null,
    readingArticles: MANDARIN_READING_ARTICLES.map((article) => ({
      id: article.id,
      version: article.version,
      title: article.title,
      segmentCount: article.segments.length,
    })),
    total: exercises.length,
    offset,
    limit,
    exercises: exercises.slice(offset, offset + limit),
  })
}
