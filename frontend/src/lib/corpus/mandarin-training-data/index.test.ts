import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MANDARIN_TRAINING_CATEGORIES,
  MANDARIN_TRAINING_EXERCISES,
} from './index'
import type { MandarinTrainingExercise } from './index'

function visibleChineseLength(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length
}

const TRADITIONAL_CHINESE_BLOCKLIST = Array.from(
  '國與雲觀賊適於傷靈聞騎陰陽賢後內異稱謹計難補闕氣餘論詔吳違據敗鈍損無興陳諸則聖臨遠離隂敘並開關書讀處語聲韻歲夢歸風華東萬長學臺蘭懷懐扵爲為覺說聽應醫藥婦兒時間現點帶幫請讓這個們會來車話發電號門樓亂傳兩冊勝喚嘗圖報壯將宮廬張從復慮憶戰戶撲攬敵暢業極樂機殤洩漢濺營爺猶畢畫當盡簡紅終絕絲織脫腳蓋虛見視親觴討託許訴詩該誕誠諮豬責買賞跡軍載轡辭連週達遺邊錄鐵閣際隨雖韉領頭願類顧飛馬馳駿騁驅鳴黃齊龜僞創娛妝爾窺舊舎衞覩遊歎羣円脩稧',
)

const MODERN_READING_WEB_NOISE = [
  '刷题',
  '在线老师',
  '咨询在线',
  '初中学科',
  '学科知识',
  '综合素质',
  '教师资格',
  '题库',
  '课程',
  '资料',
  '证书',
  '报名',
  '希赛',
  'app下载',
]

const SEVERE_POLLUTION_PATTERNS = [
  /发生性关系|色情|强奸|猥亵|嫖娼|卖淫|妓女|裸照|裸体|性爱|性交|性交易|自慰|约炮|一夜情|黄片|援交|新世界阴道|生活在精囊|性生活的基础|享受合理的性生活婚后/,
  /劫持|绑架|掐死|砍死|砸死|撞死|枪杀|捅死|毒死|打死|勒死|烧死|服毒身亡|被炸身亡|遇害|殴打|砍伤|捅伤|谋杀|凶杀|女尸|男尸|尸体/,
  /一键领取.{0,8}大礼包|考试真题|模拟试题|高频考点|直播课堂|精讲班视频教程|客户端下载|客户端订阅|订阅节目|订阅收听|入群二维码|下载到.{0,8}客户端|促销方案|促销等方案|优惠活动.{0,8}拉客户|奖励赠礼品|引流儿|培训中心$|点个赞|留个言|历年真题|考试题型|资格考试采取闭卷|考试时请以试卷|每次考试考场|护理职称.{0,12}考试重点|锁定.{0,4}核心考点|读者订阅学习/,
  /[呃嗯]|客户儿|部门儿|为为什么|客客户|项项目|进进行|世世界|整整个|线线上|一一堆|咱咱|你你|我我|这这|那那|女女|喝喝|左左|他他们|这这些|那那些|抓抓住|采采购|使只能|拉到拉过来|怎么怎么|觉得觉得|能能解决|啊啊|老老客户|今今天|都都知道|到到时候|重重视|大大堂|客户端客户端|有有希望|出出门|能够能够|就就崩|就就要|就是是|是是关于/,
  /(希望达成的是|没有想到的是|自我成长能够|工作和呃|孩子说呃|科学的呃|短信呃|方案是)$/,
]

function repeatSignature(text: string): string {
  return text
    .replace(/[零一二三四五六七八九十百千万亿两幺]+/g, '数')
    .replace(/第[数]+/g, '第数')
    .replace(/[年月日号点分秒周星期公里元块楼层号]/g, '量')
    .replace(/(我|你|您|他|她|我们|你们|他们|大家)/g, '人')
    .replace(/(医生|护士|老师|同学|妈妈|爸爸|朋友|同事|客服|司机|乘务员)/g, '角色')
}

test('Mandarin training corpus stays within the guided prompt size', () => {
  const nonAssessmentPrompts = MANDARIN_TRAINING_EXERCISES.filter(
    (exercise: MandarinTrainingExercise) => exercise.category !== '普通话构音基线',
  )

  assert.ok(
    nonAssessmentPrompts.length >= 8_000,
    `expected at least 8000 trainable prompts, got ${nonAssessmentPrompts.length}`,
  )

  for (const exercise of nonAssessmentPrompts) {
    const length = visibleChineseLength(exercise.text)
    if (exercise.prompt_type === 'single_character') {
      assert.equal(length, 1, `${exercise.id} should be one character: ${exercise.text}`)
      assert.ok(exercise.target, `${exercise.id} should carry a pinyin target`)
      continue
    }
    if (exercise.prompt_type === 'word') {
      assert.ok(
        length >= 2 && length <= 6,
        `${exercise.id} should be 2-6 chars as a word prompt, got ${length}: ${exercise.text}`,
      )
      continue
    }
    assert.ok(
      length >= 7 && length <= 18,
      `${exercise.id} should be 7-18 chars, got ${length}: ${exercise.text}`,
    )
  }
})

test('Mandarin training corpus removes the classical Chinese category', () => {
  assert.equal((MANDARIN_TRAINING_CATEGORIES as readonly string[]).includes('文言文节奏'), false)
  assert.equal(MANDARIN_TRAINING_CATEGORIES.includes('音系强化'), true)
  assert.equal(
    MANDARIN_TRAINING_EXERCISES.some((exercise) => String(exercise.category) === '文言文节奏'),
    false,
  )
})

test('character foundation corpus preserves source rows and polyphonic readings inside phonology', () => {
  const characters = MANDARIN_TRAINING_EXERCISES.filter((exercise) => exercise.id.startsWith('character-foundation-'))
  assert.equal(characters.length, 1126)
  assert.equal(characters.every((exercise) => exercise.prompt_type === 'single_character'), true)
  assert.equal(characters.every((exercise) => exercise.target && exercise.pronunciation_hint !== undefined), true)
  assert.ok(characters.filter((exercise) => exercise.text === '揣').length >= 2)
})

test('Mandarin articulation baseline replaces the legacy screening set', () => {
  const baseline = MANDARIN_TRAINING_EXERCISES.filter(
    (exercise) => exercise.category === '普通话构音基线',
  )

  assert.equal(baseline.length, 50)
  assert.equal(baseline.every((exercise) => exercise.prompt_type === 'single_character'), true)
  assert.equal(baseline[0]?.id, 'mandarin_articulation_baseline_001')
  assert.equal(baseline.at(-1)?.id, 'mandarin_articulation_baseline_050')
  assert.deepEqual(baseline.slice(0, 4).map((exercise) => exercise.text), ['包', '抛', '猫', '飞'])
})

test('Mandarin training corpus target text is Simplified Chinese only', () => {
  for (const exercise of MANDARIN_TRAINING_EXERCISES) {
    const leaked = TRADITIONAL_CHINESE_BLOCKLIST.filter((char) => exercise.text.includes(char))
    assert.deepEqual(leaked, [], `${exercise.id} contains Traditional Chinese: ${exercise.text}`)
  }
})

test('recording-ready core gap corpus is visible with target metadata', () => {
  const coreGap = MANDARIN_TRAINING_EXERCISES.filter((exercise) => exercise.id.startsWith('coverage-recording-gap-'))
  assert.equal(coreGap.length, 263)
  assert.equal(new Set(coreGap.flatMap((exercise) => exercise.coverage_targets ?? [])).size, 88)
  assert.equal(coreGap.every((exercise) => exercise.target && exercise.prompt_type), true)
})

test('recording-ready reinforcement corpus is visible without human transcript fields', () => {
  const reinforcement = MANDARIN_TRAINING_EXERCISES.filter((exercise) => exercise.id.startsWith('coverage-recording-reinforcement-'))
  assert.equal(reinforcement.length, 291)
  assert.equal(new Set(reinforcement.flatMap((exercise) => exercise.coverage_targets ?? [])).size, 116)
  assert.equal(reinforcement.every((exercise) => exercise.target && exercise.prompt_type), true)
})

test('open research recording corpus is visible with explicit target metadata', () => {
  const openResearch = MANDARIN_TRAINING_EXERCISES.filter((exercise) => exercise.id.startsWith('coverage-recording-open-research-'))
  assert.equal(openResearch.length, 14)
  assert.equal(new Set(openResearch.flatMap((exercise) => exercise.coverage_targets ?? [])).size, 15)
  assert.equal(openResearch.every((exercise) => exercise.target && exercise.prompt_type), true)
})

test('Modern article reading corpus excludes page and training-site noise', () => {
  const modernReadingPrompts = MANDARIN_TRAINING_EXERCISES.filter(
    (exercise: MandarinTrainingExercise) => exercise.category === '现代文章朗读',
  )

  assert.ok(modernReadingPrompts.length >= 500, `expected modern reading prompts, got ${modernReadingPrompts.length}`)

  for (const exercise of modernReadingPrompts) {
    const leaked = MODERN_READING_WEB_NOISE.filter((term) => exercise.text.includes(term))
    assert.deepEqual(leaked, [], `${exercise.id} contains web noise: ${exercise.text}`)
  }
})

test('Mandarin training corpus excludes confirmed severe pollution', () => {
  for (const exercise of MANDARIN_TRAINING_EXERCISES) {
    const leaked = SEVERE_POLLUTION_PATTERNS.filter((pattern) => pattern.test(exercise.text))
    assert.deepEqual(leaked, [], `${exercise.id} contains severe pollution: ${exercise.text}`)
  }
})

test('Mandarin training corpus retains valid news, finance, dialogue, and medical topics', () => {
  const texts = new Set(MANDARIN_TRAINING_EXERCISES.map((exercise) => exercise.text))
  assert.equal(texts.has('孕期减少性生活'), true)
  assert.equal(texts.has('乳房肿胀的疼痛可以通过冷敷'), true)
})

test('Mandarin training corpus has no duplicate target text per category', () => {
  const seen = new Set<string>()

  for (const exercise of MANDARIN_TRAINING_EXERCISES) {
    if (exercise.prompt_type === 'single_character') continue
    const key = exercise.text
    assert.equal(seen.has(key), false, `duplicate target text: ${key}`)
    seen.add(key)
  }
})

test('Mandarin training corpus limits near-duplicate sentence structures', () => {
  const counts = new Map<string, number>()

  for (const exercise of MANDARIN_TRAINING_EXERCISES) {
    if (exercise.category === '普通话构音基线' || exercise.prompt_type === 'single_character') {
      continue
    }

    const key = `${exercise.category}:${repeatSignature(exercise.text)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const overLimit = Array.from(counts.entries()).filter(([, count]) => count > 8)
  assert.deepEqual(overLimit, [], `near-duplicate structures exceeded limit: ${JSON.stringify(overLimit.slice(0, 5))}`)
})
