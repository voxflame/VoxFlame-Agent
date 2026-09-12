import { sha256 } from 'js-sha256'
import type { MandarinTrainingExercise } from '@/lib/corpus/mandarin-training'
import readingArticleCatalog from '@/lib/corpus/generated/mandarin-reading-articles.json'

export type ReadingArticleDifficulty = '轻松' | '平稳' | '进阶'

export interface MandarinReadingSegment {
  id: string
  index: number
  text: string
  chineseCharacterCount: number
}

export interface MandarinReadingArticle {
  id: string
  version: string
  title: string
  author: string
  summary: string
  theme: string
  difficulty: ReadingArticleDifficulty
  fullText: string
  source: {
    kind: 'public_domain' | 'licensed'
    label: string
    publication: string
    sourceUrl: string
    sourceByline: string
    retrievedAt: string
    rawContentHash: string
    rightsStatus: string
    rightsUrl: string
    mirrorUrl: string
    mirrorCommit: string
    crossCheckMethod: string
    crossCheckScore: number
    crossCheckCoverage: number
    contentHash: string
  }
  segments: MandarinReadingSegment[]
}

export function countChineseCharacters(text: string): number {
  return Array.from(text).filter((character) => /\p{Script=Han}/u.test(character)).length
}

/**
 * 按句号、问号、叹号、分号、逗号、顿号和冒号等自然停顿切分录音单元。
 * 16 个汉字是录音单元的目标，不是改写或拒收完整原文的条件；没有自然停顿时保留原句。
 */
export function splitReadingArticleIntoSegments(fullText: string): string[] {
  const normalized = fullText
    .replace(/\r\n?/gu, '\n')
    .replace(/\n+/gu, '\n')
    .trim()
  if (!normalized) return []

  const segments: string[] = []
  const naturalPauses = /[。！？；，、：!?;,:…—]/u
  const closingMarks = /[”’」』）】》〕]/u
  let current = ''
  let pauseReached = false

  for (const character of normalized) {
    if (character === '\n') {
      if (current) segments.push(current)
      current = ''
      pauseReached = false
      continue
    }
    if (pauseReached && !closingMarks.test(character) && !naturalPauses.test(character)) {
      segments.push(current)
      current = ''
      pauseReached = false
    }
    current += character
    if (naturalPauses.test(character)) pauseReached = true
  }
  if (current) segments.push(current)
  return segments
}

type ReadingArticleRecord = Omit<MandarinReadingArticle, 'segments'>

/**
 * 只从已保存完整正文、来源快照、第二底本互校和公版依据的目录生成录音材料。
 */
export const MANDARIN_READING_ARTICLES: readonly MandarinReadingArticle[] = (
  readingArticleCatalog.articles as ReadingArticleRecord[]
).map((article) => ({
  ...article,
  segments: splitReadingArticleIntoSegments(article.fullText).map((text, index) => ({
    id: `${article.id}-segment-${String(index + 1).padStart(4, '0')}`,
    index,
    text,
    chineseCharacterCount: countChineseCharacters(text),
  })),
}))

export function getReadingArticle(articleId: string): MandarinReadingArticle | null {
  return MANDARIN_READING_ARTICLES.find((article) => article.id === articleId) ?? null
}

export function getReadingArticleExercises(
  article: MandarinReadingArticle,
): MandarinTrainingExercise[] {
  return article.segments.map((segment) => ({
    id: segment.id,
    text: segment.text,
    category: '现代文章朗读',
    prompt_type: 'short_sentence',
  }))
}

export function validateReadingArticles(
  articles: readonly MandarinReadingArticle[],
): string[] {
  const errors: string[] = []
  const articleIds = new Set<string>()
  const titles = new Set<string>()
  const segmentIds = new Set<string>()

  for (const article of articles) {
    if (articleIds.has(article.id)) errors.push(`文章ID重复：${article.id}`)
    if (titles.has(article.title)) errors.push(`文章标题重复：${article.title}`)
    articleIds.add(article.id)
    titles.add(article.title)

    if (!article.author.trim()) errors.push(`${article.id}缺少作者`)
    if (!article.source.publication.trim()) errors.push(`${article.id}缺少底本信息`)
    if (!/^https?:\/\//u.test(article.source.sourceUrl)) errors.push(`${article.id}缺少可核验底本链接`)
    if (!article.source.retrievedAt.trim()) errors.push(`${article.id}缺少底本访问日期`)
    if (!/^sha256:[a-f0-9]{64}$/u.test(article.source.rawContentHash)) errors.push(`${article.id}缺少原始页面哈希`)
    if (!article.source.rightsStatus.trim()) errors.push(`${article.id}缺少权利状态`)
    if (!/^https:\/\//u.test(article.source.rightsUrl)) errors.push(`${article.id}缺少权利依据链接`)
    if (!/^https:\/\//u.test(article.source.mirrorUrl)) errors.push(`${article.id}缺少第二底本链接`)
    if (!/^[a-f0-9]{40}$/u.test(article.source.mirrorCommit)) errors.push(`${article.id}缺少固定镜像版本`)
    if (article.source.crossCheckCoverage < 0.9) errors.push(`${article.id}第二底本连续正文覆盖不足`)
    if (/[\uE000-\uF8FF]/u.test(article.fullText)) errors.push(`${article.id}正文含无法识别的私用区乱码`)
    if (countChineseCharacters(article.fullText) < 180) errors.push(`${article.id}不是完整长文正文`)
    if (article.segments.length === 0) errors.push(`${article.id}没有可录句子`)
    if (article.source.contentHash !== `sha256:${sha256(article.fullText)}`) {
      errors.push(`${article.id}内容哈希与全文不一致`)
    }

    const normalizedFullText = article.fullText.replace(/\r?\n/gu, '').trim()
    const normalizedSegments = article.segments.map((segment) => segment.text).join('').trim()
    if (normalizedSegments !== normalizedFullText) errors.push(`${article.id}录音句未完整覆盖全文`)

    for (const segment of article.segments) {
      if (segmentIds.has(segment.id)) errors.push(`录音句ID重复：${segment.id}`)
      segmentIds.add(segment.id)
      if (segment.index !== article.segments.indexOf(segment)) errors.push(`${segment.id}序号不连续`)
      const count = countChineseCharacters(segment.text)
      if (count !== segment.chineseCharacterCount) errors.push(`${segment.id}汉字数不一致`)
    }
  }

  return errors
}
