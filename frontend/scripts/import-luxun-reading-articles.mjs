import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = resolve(SCRIPT_DIR, '../src/lib/corpus/generated/mandarin-reading-articles.json')
const MUSEUM_BASE_URL = 'http://www.luxunmuseum.com.cn/cx'
const MIRROR_ARCHIVE_URL = 'https://codeload.github.com/Ac-heron/luxun/zip/b859e5043211b9ead7417ba3f5776e81eaf9213c'
const MIRROR_COMMIT = 'b859e5043211b9ead7417ba3f5776e81eaf9213c'
const RIGHTS_URL = 'https://www.wipo.int/wipolex/en/legislation/details/21065'
const RETRIEVED_AT = process.env.VOXFLAME_READING_RETRIEVED_AT ?? '2026-09-03'
const COLLECTION_IDS = [1, 2, 3, 4, 5, 6, 7]
const MIN_CROSS_CHECK_COVERAGE = 0.9
const EXCLUDED_SOURCE_IDS = new Map([
  ['1406', '早期文言论文不适合作为普通话朗读材料'],
  ['1407', '早期文言论文不适合作为普通话朗读材料'],
  ['1408', '早期文言论文不适合作为普通话朗读材料'],
  ['1409', '早期文言论文不适合作为普通话朗读材料'],
  ['1476', '官方数字底本篇尾年份缺字'],
])

const TITLE_ALIASES = new Map([
  ['呐喊/呐喊自序', '《呐喊》自序'],
  ['故事新编/故事新编序言', '序言'],
  ['野草/复仇(其二)', '复仇〔其二〕'],
  ['野草/希望①', '希望'],
  ['朝花夕拾/朝花夕拾小引', '《朝花夕拾》小引'],
  ['朝花夕拾/阿长与《山 海 经》', '阿长与山海经'],
  ['朝花夕拾/《二十四孝图》', '二十四孝图'],
  ['朝花夕拾/朝花夕拾后记', '后记'],
  ['坟/坟题记', '题记'],
  ['坟/我们现在怎样做父亲', '我们怎样做父亲'],
  ['坟/杂忆', '杂亿'],
])

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;?/giu, ' ')
    .replace(/&#(\d+);?/gu, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&#x([\da-f]+);?/giu, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
}

function plainText(html) {
  return decodeHtml(html.replace(/<[^>]+>/gu, '')).replace(/\s+/gu, ' ').trim()
}

function canonicalTitle(title) {
  return title
    .normalize('NFKC')
    .replace(/[《》〈〉「」『』【】〔〕（）()·\s①⑴]/gu, '')
    .replace(/其二/gu, '其二')
    .trim()
}

function canonicalText(text) {
  return text
    .normalize('NFKC')
    .replace(/象/gu, '像')
    .replace(/熬了苦痛/gu, '煞了苦痛')
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]/gu, '')
    .toLowerCase()
}

function characterTrigramDice(leftText, rightText) {
  const left = canonicalText(leftText)
  const right = canonicalText(rightText)
  const makeCounts = (value) => {
    const counts = new Map()
    for (let index = 0; index <= value.length - 3; index += 1) {
      const gram = value.slice(index, index + 3)
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
    return counts
  }
  const leftCounts = makeCounts(left)
  const rightCounts = makeCounts(right)
  let overlap = 0
  for (const [gram, count] of leftCounts) {
    overlap += Math.min(count, rightCounts.get(gram) ?? 0)
  }
  const total = [...leftCounts.values()].reduce((sum, value) => sum + value, 0)
    + [...rightCounts.values()].reduce((sum, value) => sum + value, 0)
  return total === 0 ? 0 : (2 * overlap) / total
}

function characterNgramCoverage(sourceText, mirrorText, size = 5) {
  const source = canonicalText(sourceText)
  const mirror = canonicalText(mirrorText)
  const makeCounts = (value) => {
    const counts = new Map()
    for (let index = 0; index <= value.length - size; index += 1) {
      const gram = value.slice(index, index + size)
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
    return counts
  }
  const sourceCounts = makeCounts(source)
  const mirrorCounts = makeCounts(mirror)
  let overlap = 0
  let total = 0
  for (const [gram, count] of sourceCounts) {
    total += count
    overlap += Math.min(count, mirrorCounts.get(gram) ?? 0)
  }
  return total === 0 ? 0 : overlap / total
}

async function fetchText(url) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'VoxFlame reading corpus verifier/1.0' },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 500))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(`Failed to retrieve ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function parseCatalogRows(html) {
  return [...html.matchAll(/<tr[\s\S]*?<td id="tabel_bg"[\s\S]*?<\/tr>/gu)].map((match) => {
    const row = match[0]
    const fields = Object.fromEntries(
      [...row.matchAll(/<td[^>]*data-tabel="([^"]*)"[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/gu)]
        .map((field) => [field[1], plainText(field[2])]),
    )
    const sourceId = row.match(/content\.php\?id=(\d+)/u)?.[1]
    if (!sourceId || !fields['篇名'] || !fields['集名']) return null
    return {
      sourceId,
      collection: fields['集名'],
      title: fields['篇名'],
      sourceByline: fields['署名'] || '鲁迅',
      genre: fields['体裁'] || '文学作品',
      firstPublication: fields['发表刊物'] || fields['集名'],
      firstPublicationDate: fields['年/月/日'] || '',
    }
  }).filter(Boolean)
}

function extractFullText(html, expectedTitle) {
  const start = html.search(/<div[^>]+id=["']ctcontent["'][^>]*>/iu)
  if (start < 0) throw new Error('正文容器不存在')
  const openingEnd = html.indexOf('>', start)
  const end = html.indexOf('</div>', openingEnd)
  if (end < 0) throw new Error('正文容器未闭合')

  const body = html.slice(openingEnd + 1, end)
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<\/(?:blockquote|p|h1|h2|h3)>/giu, '\n')
    .replace(/<(?:blockquote|p|h1|h2|h3)[^>]*>/giu, '')
    .replace(/<[^>]+>/gu, '')
  const lines = decodeHtml(body)
    .replace(/[┏┓┗┛━]+/gu, '\n')
    .replace(/┃+/gu, '\n')
    .replace(/\r\n?/gu, '\n')
    .split(/\n+/gu)
    .map((line) => line.replace(/[\t ]+/gu, ' ').trim())
    .filter(Boolean)

  const expected = canonicalTitle(expectedTitle)
  while (lines.length > 0 && canonicalTitle(lines[0]) === expected) lines.shift()
  return lines.join('\n\n').trim()
}

function mirrorTitle(collection, title) {
  return TITLE_ALIASES.get(`${collection}/${title}`) ?? title
}

function readMirrorText(mirrorRoot, collection, title) {
  const collectionDir = join(mirrorRoot, '全集', collection)
  const expected = canonicalTitle(mirrorTitle(collection, title))
  const candidates = readdirSync(collectionDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, canonical: canonicalTitle(basename(name, '.md')) }))
    .filter((item) => item.canonical === expected)
  if (candidates.length !== 1) {
    throw new Error(`镜像篇名匹配失败：${collection}/${title}（${candidates.map((item) => item.name).join('、') || '无'}）`)
  }
  return readFileSync(join(collectionDir, candidates[0].name), 'utf8')
}

function toDifficulty(characterCount) {
  if (characterCount < 900) return '轻松'
  if (characterCount < 2_000) return '平稳'
  return '进阶'
}

async function downloadMirror() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'voxflame-reading-import-'))
  const archivePath = join(temporaryRoot, 'mirror.zip')
  const response = await fetch(MIRROR_ARCHIVE_URL, { headers: { 'user-agent': 'VoxFlame reading corpus verifier/1.0' } })
  if (!response.ok) throw new Error(`镜像归档下载失败：HTTP ${response.status}`)
  writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))
  execFileSync('unzip', ['-q', archivePath, '-d', temporaryRoot])
  const extractedDirectory = readdirSync(temporaryRoot).find((name) => name.startsWith('luxun-'))
  if (!extractedDirectory) throw new Error('镜像归档目录不存在')
  return { temporaryRoot, mirrorRoot: join(temporaryRoot, extractedDirectory) }
}

async function main() {
  const { temporaryRoot, mirrorRoot } = await downloadMirror()
  try {
    const catalogRows = []
    for (const collectionId of COLLECTION_IDS) {
      const catalogUrl = `${MUSEUM_BASE_URL}/works.php?lid=${collectionId}&tid=1`
      catalogRows.push(...parseCatalogRows(await fetchText(catalogUrl)))
    }

    const articles = []
    const failures = []
    for (const row of catalogRows) {
      try {
        if (EXCLUDED_SOURCE_IDS.has(row.sourceId)) throw new Error(EXCLUDED_SOURCE_IDS.get(row.sourceId))
        const sourceUrl = `${MUSEUM_BASE_URL}/content.php?id=${row.sourceId}`
        const sourceHtml = await fetchText(sourceUrl)
        const fullText = extractFullText(sourceHtml, row.title)
        const mirrorText = readMirrorText(mirrorRoot, row.collection, row.title)
        const chineseCharacterCount = [...fullText].filter((character) => /\p{Script=Han}/u.test(character)).length
        const crossCheckScore = characterTrigramDice(fullText, mirrorText)
        const crossCheckCoverage = characterNgramCoverage(fullText, mirrorText)
        if (chineseCharacterCount < 180) throw new Error(`正文仅 ${chineseCharacterCount} 个汉字`)
        if (crossCheckCoverage < MIN_CROSS_CHECK_COVERAGE) throw new Error(`第二底本连续正文覆盖率仅 ${crossCheckCoverage.toFixed(4)}`)
        if (/[\uE000-\uF8FF]/u.test(fullText)) throw new Error('正文含无法识别的私用区乱码')
        if (/copyright Reserved|技术支持|查看正文/u.test(fullText)) throw new Error('正文混入网页模板')

        const contentHash = sha256(fullText)
        articles.push({
          id: `luxun-${row.sourceId}`,
          version: `${RETRIEVED_AT}-${contentHash.slice(0, 12)}`,
          title: mirrorTitle(row.collection, row.title),
          author: '鲁迅',
          summary: `${row.collection} · ${row.genre} · 初刊《${row.firstPublication}》${row.firstPublicationDate ? `（${row.firstPublicationDate}）` : ''}`,
          theme: row.collection,
          difficulty: toDifficulty(chineseCharacterCount),
          fullText,
          source: {
            kind: 'public_domain',
            label: '北京鲁迅博物馆鲁迅著作全文库',
            publication: `${row.collection}；初刊《${row.firstPublication}》${row.firstPublicationDate ? `（${row.firstPublicationDate}）` : ''}`,
            sourceUrl,
            sourceByline: row.sourceByline,
            retrievedAt: RETRIEVED_AT,
            rawContentHash: `sha256:${sha256(sourceHtml)}`,
            rightsStatus: '鲁迅于1936年去世；依中国《著作权法》第二十三条，作品财产权保护期已届满。继续保留署名并保持作品完整。',
            rightsUrl: RIGHTS_URL,
            mirrorUrl: `https://github.com/Ac-heron/luxun/tree/${MIRROR_COMMIT}/全集/${encodeURIComponent(row.collection)}`,
            mirrorCommit: MIRROR_COMMIT,
            crossCheckMethod: '与第二底本按规范化字符三元组进行全文相似度互校',
            crossCheckScore: Number(crossCheckScore.toFixed(4)),
            crossCheckCoverage: Number(crossCheckCoverage.toFixed(4)),
            contentHash: `sha256:${contentHash}`,
          },
        })
      } catch (error) {
        failures.push(`${row.collection}/${row.title}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const hashes = new Set(articles.map((article) => article.source.contentHash))
    if (hashes.size !== articles.length) throw new Error('发现重复全文，拒绝生成目录')
    if (articles.length < 60) {
      throw new Error(`只有 ${articles.length} 篇通过，低于 60 篇门槛。失败项：\n${failures.join('\n')}`)
    }

    writeFileSync(OUTPUT_PATH, `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: RETRIEVED_AT,
      articleCount: articles.length,
      sourceCollections: COLLECTION_IDS,
      articles,
      excluded: failures,
    }, null, 2)}\n`)
    console.log(`Generated ${articles.length} verified full-text articles at ${OUTPUT_PATH}`)
    if (failures.length > 0) console.log(`Excluded ${failures.length} articles:\n${failures.join('\n')}`)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

await main()
