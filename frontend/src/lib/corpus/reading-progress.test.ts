import assert from 'node:assert/strict'
import test from 'node:test'

import type { MandarinReadingArticle } from './reading-articles'
import {
  getReadingArticleCycle,
  getReadingArticleProgress,
  rankReadingArticles,
} from './reading-progress'

function buildArticle(id: string): MandarinReadingArticle {
  return {
    id,
    version: 'test',
    title: id,
    author: '测试作者',
    summary: '测试概况',
    theme: '测试',
    difficulty: '轻松',
    fullText: '第一句完整正文。第二句完整正文。第三句完整正文。',
    source: {
      kind: 'public_domain',
      label: '测试底本',
      publication: '测试出版物',
      sourceUrl: 'https://example.com/source',
      sourceByline: '测试作者',
      retrievedAt: '2026-09-03',
      rawContentHash: `sha256:${'0'.repeat(64)}`,
      rightsStatus: '测试用公版状态',
      rightsUrl: 'https://example.com/rights',
      mirrorUrl: 'https://example.com/mirror',
      mirrorCommit: '0'.repeat(40),
      crossCheckMethod: '测试互校',
      crossCheckScore: 1,
      crossCheckCoverage: 1,
      contentHash: 'sha256:test',
    },
    segments: [
      { id: `${id}-1`, index: 0, text: '第一句完整正文。', chineseCharacterCount: 8 },
      { id: `${id}-2`, index: 1, text: '第二句完整正文。', chineseCharacterCount: 8 },
      { id: `${id}-3`, index: 2, text: '第三句完整正文。', chineseCharacterCount: 8 },
    ],
  }
}

test('article progress identifies recorded segments and next unrecorded segment', () => {
  const article = buildArticle('reading-a')
  const progress = getReadingArticleProgress(article, [article.segments[0].id, article.segments[2].id])
  assert.equal(progress.recordedCount, 2)
  assert.equal(progress.nextSegmentId, article.segments[1].id)
  assert.equal(progress.isComplete, false)
})

test('reset cycle restores global progress from the latest cloud-backed round', () => {
  const article = buildArticle('reading-a')
  const cycle = getReadingArticleCycle(
    article,
    article.segments.map((segment) => segment.id),
    [
      `round-1:${article.segments[0].id}`,
      `round-1:${article.segments[1].id}`,
    ],
  )

  assert.equal(cycle.roundId, 'round-1')
  assert.deepEqual(cycle.recordedSegmentIds, [article.segments[0].id, article.segments[1].id])
  assert.equal(cycle.nextRoundId, 'round-2')
})

test('ranking puts the least recorded incomplete article first and completed article last', () => {
  const first = buildArticle('reading-a')
  const second = buildArticle('reading-b')
  const third = buildArticle('reading-c')
  const recorded = [
    ...first.segments.map((segment) => segment.id),
    second.segments[0].id,
  ]
  const ranked = rankReadingArticles([first, second, third], recorded)
  assert.equal(ranked[0].article.id, third.id)
  assert.equal(ranked[1].article.id, second.id)
  assert.equal(ranked[2].article.id, first.id)
})
