import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MANDARIN_READING_ARTICLES,
  splitReadingArticleIntoSegments,
  validateReadingArticles,
} from './reading-articles'

test('runtime catalog contains only verified independent full texts', () => {
  assert.ok(MANDARIN_READING_ARTICLES.length >= 60)
  assert.deepEqual(validateReadingArticles(MANDARIN_READING_ARTICLES), [])
  assert.equal(new Set(MANDARIN_READING_ARTICLES.map((article) => article.source.contentHash)).size, MANDARIN_READING_ARTICLES.length)
  assert.ok(MANDARIN_READING_ARTICLES.every((article) => article.fullText.includes('\n') || article.fullText.length > 180))
  assert.ok(MANDARIN_READING_ARTICLES.every((article) => article.source.label.includes('北京鲁迅博物馆')))
  assert.ok(MANDARIN_READING_ARTICLES.every((article) => article.source.crossCheckCoverage >= 0.9))
})

test('reading splitter uses punctuation as natural recording pauses', () => {
  const segments = splitReadingArticleIntoSegments(
    '清晨的风很轻，树叶在窗外慢慢摇动，远处还传来清脆的鸟鸣。我沿着河边往前走。',
  )

  assert.deepEqual(segments, [
    '清晨的风很轻，',
    '树叶在窗外慢慢摇动，',
    '远处还传来清脆的鸟鸣。',
    '我沿着河边往前走。',
  ])
  assert.ok(segments.every((segment) => Array.from(segment).filter((character) => /\p{Script=Han}/u.test(character)).length <= 16))
  assert.deepEqual(splitReadingArticleIntoSegments('先听一听；再慢慢开口：甲、乙都可以。'), [
    '先听一听；',
    '再慢慢开口：',
    '甲、',
    '乙都可以。',
  ])
  assert.deepEqual(splitReadingArticleIntoSegments('我不知道——现在仍不知道——答案。'), [
    '我不知道——',
    '现在仍不知道——',
    '答案。',
  ])
})

test('reading splitter never hard-cuts an overlong sentence without a natural pause', () => {
  const sentence = '这是一句没有任何自然停顿但是字数明显超过十六个汉字的测试句子。'
  assert.deepEqual(splitReadingArticleIntoSegments(sentence), [sentence])
})

test('recording units preserve every character and mostly stay within 16 Chinese characters', () => {
  const segments = MANDARIN_READING_ARTICLES.flatMap((article) => article.segments)
  const overTargetSegments = segments.filter((segment) => segment.chineseCharacterCount > 16)
  const naturalPause = /[。！？；，、：!?;,:…—]/u
  const trailingMarks = /[。！？；，、：!?;,:…—”’」』）】》〕]+$/u

  assert.ok(overTargetSegments.length / segments.length < 0.03)
  assert.ok(overTargetSegments.every((segment) => (
    !naturalPause.test(segment.text.replace(trailingMarks, ''))
  )))
  assert.ok(MANDARIN_READING_ARTICLES.every((article) => (
    article.segments.map((segment) => segment.text).join('')
      === article.fullText.replace(/\r?\n/gu, '')
  )))
})

test('reading splitter preserves spaces and punctuation inside the original text', () => {
  const fullText = '鲁迅 说：“先听， 再读。”'
  assert.equal(splitReadingArticleIntoSegments(fullText).join(''), fullText)
})
