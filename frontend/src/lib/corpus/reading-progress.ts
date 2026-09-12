import type { MandarinReadingArticle } from './reading-articles'

export interface ReadingArticleProgress {
  article: MandarinReadingArticle
  recordedCount: number
  totalCount: number
  completionRatio: number
  isStarted: boolean
  isComplete: boolean
  nextSegmentId: string | null
}

export interface ReadingArticleCycle {
  roundId: string | null
  recordedSegmentIds: string[]
  nextRoundId: string
}

function parseRoundKey(key: string): { roundId: string; segmentId: string } | null {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex < 1) return null
  return {
    roundId: key.slice(0, separatorIndex),
    segmentId: key.slice(separatorIndex + 1),
  }
}

function roundNumber(roundId: string): number {
  const match = /^round-(\d+)$/.exec(roundId)
  return match ? Number(match[1]) : 0
}

/** Resolve the account-level current cycle. Resetting starts a new cycle without deleting audio. */
export function getReadingArticleCycle(
  article: MandarinReadingArticle,
  recordedSegmentIds: Iterable<string>,
  recordedRoundKeys: Iterable<string>,
  currentRoundId?: string | null,
): ReadingArticleCycle {
  const articleSegmentIds = new Set(article.segments.map((segment) => segment.id))
  const rounds = new Map<string, Set<string>>()

  for (const key of recordedRoundKeys) {
    const parsed = parseRoundKey(key)
    if (!parsed || parsed.roundId === 'initial' || !articleSegmentIds.has(parsed.segmentId)) continue
    const segments = rounds.get(parsed.roundId) ?? new Set<string>()
    segments.add(parsed.segmentId)
    rounds.set(parsed.roundId, segments)
  }

  const latestRoundId = currentRoundId ?? Array.from(rounds.keys())
    .sort((left, right) => roundNumber(right) - roundNumber(left) || right.localeCompare(left))[0] ?? null
  const latestRoundNumber = latestRoundId ? roundNumber(latestRoundId) : 0

  return {
    roundId: latestRoundId,
    recordedSegmentIds: latestRoundId
      ? Array.from(rounds.get(latestRoundId) ?? [])
      : Array.from(recordedSegmentIds).filter((segmentId) => articleSegmentIds.has(segmentId)),
    nextRoundId: `round-${latestRoundNumber + 1}`,
  }
}

export function getReadingArticleProgress(
  article: MandarinReadingArticle,
  recordedSegmentIds: Iterable<string>,
): ReadingArticleProgress {
  const recorded = new Set(recordedSegmentIds)
  const recordedCount = article.segments.filter((segment) => recorded.has(segment.id)).length
  const nextSegment = article.segments.find((segment) => !recorded.has(segment.id)) ?? null

  return {
    article,
    recordedCount,
    totalCount: article.segments.length,
    completionRatio: article.segments.length > 0 ? recordedCount / article.segments.length : 0,
    isStarted: recordedCount > 0,
    isComplete: article.segments.length > 0 && recordedCount === article.segments.length,
    nextSegmentId: nextSegment?.id ?? null,
  }
}

/** Keep the least-recorded material first without asking the user to configure sorting. */
export function rankReadingArticles(
  articles: readonly MandarinReadingArticle[],
  recordedSegmentIds: Iterable<string>,
  recordedRoundKeys: Iterable<string> = [],
  readingArticleRoundIds: Record<string, string> = {},
): ReadingArticleProgress[] {
  const recorded = Array.from(recordedSegmentIds)
  const roundKeys = Array.from(recordedRoundKeys)
  return articles
    .map((article) => {
      const cycle = getReadingArticleCycle(
        article,
        recorded,
        roundKeys,
        readingArticleRoundIds[article.id] ?? null,
      )
      return getReadingArticleProgress(article, cycle.recordedSegmentIds)
    })
    .sort((left, right) => (
      Number(left.isComplete) - Number(right.isComplete)
      || left.completionRatio - right.completionRatio
      || left.article.id.localeCompare(right.article.id)
    ))
}
