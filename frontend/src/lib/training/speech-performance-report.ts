import { pinyin } from 'pinyin-pro'

import { calculateCharacterEditDistance } from './articulation-baseline-report'

export interface SpeechPerformanceAttemptInput {
  exerciseId: string
  targetText: string
  heardText: string
  normalizedTarget: string
  normalizedHeard: string
  missingChars: string[]
  extraChars: string[]
  durationMs?: number
  speechDurationMs?: number
  silenceRatio?: number
  inputLevelRms?: number
  inputLevelPeak?: number
  qualityDisposition?: 'high_confidence' | 'review' | 'low_confidence'
}

export interface SpeechPerformancePattern {
  id: string
  label: string
  detail: string
  count: number
}

export interface SpeechPerformanceReport {
  sampleCount: number
  systemUnderstandingPercent: number
  consistencyLabel: string
  consistencyDetail: string
  speechRateCharsPerSecond: number | null
  speechRateDetail: string
  captureLabel: string
  captureDetail: string
  personalizationSeconds: number
  personalizationProgressPercent: number
  personalizationDetail: string
  patterns: SpeechPerformancePattern[]
  nextActions: string[]
  boundary: string
}

const PERSONALIZATION_REFERENCE_SECONDS = 300
const PHONOLOGY_GROUPS = [
  { id: 'labial', label: '双唇与唇齿音', initials: new Set(['b', 'p', 'm', 'f']) },
  { id: 'tongue-tip-mid', label: '舌尖中音', initials: new Set(['d', 't', 'n', 'l']) },
  { id: 'velar', label: '舌根音', initials: new Set(['g', 'k', 'h']) },
  { id: 'palatal', label: '舌面音', initials: new Set(['j', 'q', 'x']) },
  { id: 'sibilants', label: '平舌与翘舌音', initials: new Set(['z', 'c', 's', 'zh', 'ch', 'sh', 'r']) },
] as const

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length
  return Math.sqrt(variance)
}

function phonologyGroupForCharacter(character: string): { id: string; label: string } | null {
  const [syllable] = pinyin(character, {
    type: 'all',
    toneType: 'none',
    nonZh: 'removed',
  }).filter((item) => item.isZh)
  if (!syllable) return null

  const initialGroup = PHONOLOGY_GROUPS.find((group) => group.initials.has(syllable.initial as never))
  if (initialGroup) return { id: initialGroup.id, label: initialGroup.label }

  const normalizedFinal = syllable.final.replaceAll('v', 'ü')
  if (/(n|ng)$/.test(normalizedFinal)) {
    return { id: 'nasal-finals', label: '前后鼻韵母' }
  }
  if (/^(ai|ei|ao|ou|ia|ie|ua|uo|üe|iao|iou|uai|uei)$/.test(normalizedFinal)) {
    return { id: 'compound-finals', label: '复韵母' }
  }
  return null
}

function buildPatterns(attempts: SpeechPerformanceAttemptInput[]): SpeechPerformancePattern[] {
  const characterCounts = new Map<string, number>()
  const groupCounts = new Map<string, { label: string; count: number; characters: Set<string> }>()

  attempts.forEach((attempt) => {
    for (const character of [...attempt.missingChars, ...attempt.extraChars]) {
      characterCounts.set(character, (characterCounts.get(character) ?? 0) + 1)
      const group = phonologyGroupForCharacter(character)
      if (!group) continue
      const current = groupCounts.get(group.id) ?? { label: group.label, count: 0, characters: new Set<string>() }
      current.count += 1
      current.characters.add(character)
      groupCounts.set(group.id, current)
    }
  })

  const phonologyPatterns = Array.from(groupCounts.entries()).map(([id, value]) => ({
    id,
    label: value.label,
    detail: `本轮涉及“${Array.from(value.characters).slice(0, 4).join('、')}”等字`,
    count: value.count,
  }))
  const characterPatterns = Array.from(characterCounts.entries()).map(([character, count]) => ({
    id: `character:${character}`,
    label: `“${character}”`,
    detail: '系统本轮容易漏听或混淆',
    count,
  }))

  return [...phonologyPatterns, ...characterPatterns]
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
}

export function buildSpeechPerformanceReport(
  attempts: SpeechPerformanceAttemptInput[],
): SpeechPerformanceReport {
  const validAttempts = attempts.filter((attempt) => Array.from(attempt.normalizedTarget).length > 0)
  const totalTargetChars = validAttempts.reduce(
    (sum, attempt) => sum + Array.from(attempt.normalizedTarget).length,
    0,
  )
  const matchedChars = validAttempts.reduce((sum, attempt) => {
    const targetLength = Array.from(attempt.normalizedTarget).length
    return sum + Math.max(
      0,
      targetLength - calculateCharacterEditDistance(attempt.normalizedTarget, attempt.normalizedHeard),
    )
  }, 0)
  const systemUnderstandingPercent = totalTargetChars > 0
    ? Math.round((matchedChars / totalTargetChars) * 100)
    : 0
  const attemptScores = validAttempts.map((attempt) => {
    const targetLength = Array.from(attempt.normalizedTarget).length
    return Math.max(
      0,
      (targetLength - calculateCharacterEditDistance(attempt.normalizedTarget, attempt.normalizedHeard)) / targetLength,
    )
  })
  const scoreSpread = standardDeviation(attemptScores)
  const consistencyLabel = validAttempts.length < 3
    ? '继续积累'
    : scoreSpread <= 0.12 ? '本轮较稳定' : scoreSpread <= 0.25 ? '本轮有波动' : '不同词差异明显'
  const consistencyDetail = validAttempts.length < 3
    ? '至少完成 3 条后再看不同词之间的稳定性。'
    : `不同词条听清率波动约 ${Math.round(scoreSpread * 100)} 个百分点。`

  const totalDurationMs = validAttempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0)
  const totalSpeechDurationMs = validAttempts.reduce(
    (sum, attempt) => sum + (attempt.speechDurationMs ?? attempt.durationMs ?? 0),
    0,
  )
  const speechRateCharsPerSecond = totalSpeechDurationMs > 0
    ? round(totalTargetChars / (totalSpeechDurationMs / 1000))
    : null
  const speechRateDetail = speechRateCharsPerSecond === null
    ? '当前设备还没有提供足够的有效发声时长。'
    : `本轮约 ${speechRateCharsPerSecond} 字/秒，先作为你的个人基线，不与他人强行比较。`

  const measurableSilenceRatios = validAttempts
    .map((attempt) => attempt.silenceRatio)
    .filter((value): value is number => typeof value === 'number')
  const averageSilenceRatio = measurableSilenceRatios.length > 0
    ? measurableSilenceRatios.reduce((sum, value) => sum + value, 0) / measurableSilenceRatios.length
    : null
  const lowConfidenceCount = validAttempts.filter((attempt) => attempt.qualityDisposition === 'low_confidence').length
  const quietCount = validAttempts.filter((attempt) => typeof attempt.inputLevelRms === 'number' && attempt.inputLevelRms < 0.024).length
  const loudCount = validAttempts.filter((attempt) => typeof attempt.inputLevelPeak === 'number' && attempt.inputLevelPeak > 0.23).length
  const captureLabel = lowConfidenceCount > 0 || quietCount > 0 || loudCount > 0
    ? '收音可优化'
    : validAttempts.length > 0 ? '本轮收音可用' : '等待录音'
  const captureDetail = averageSilenceRatio === null
    ? '手机端当前只记录时长；Web端可进一步分析静音和输入强弱。'
    : `平均静音占比约 ${Math.round(averageSilenceRatio * 100)}%；这只是录音结构，不代表表达能力好坏。`

  const personalizationSeconds = Math.round(totalDurationMs / 1000)
  const personalizationProgressPercent = Math.min(
    100,
    Math.round((personalizationSeconds / PERSONALIZATION_REFERENCE_SECONDS) * 100),
  )
  const personalizationDetail = personalizationSeconds >= PERSONALIZATION_REFERENCE_SECONDS
    ? '已达到首轮小样本个性化实验的参考数据量；仍需固定测试验证是否真正提升。'
    : `本轮累计约 ${personalizationSeconds} 秒；先向 5 分钟高质量、文本对齐录音积累。`

  const patterns = buildPatterns(validAttempts)
  const nextActions: string[] = []
  if (quietCount > 0) nextActions.push('有录音偏小：把麦克风靠近一些，再用同一句复测。')
  if (loudCount > 0) nextActions.push('有录音峰值过高：稍微离麦克风远一点，避免爆音。')
  if (averageSilenceRatio !== null && averageSilenceRatio > 0.72) {
    nextActions.push('停顿较多：完整说完再结束录音；需要长停顿时不要把它当成错误。')
  }
  if (patterns[0]) nextActions.push(`优先复练${patterns[0].label}，用相同设备对比前后两轮系统听清率。`)
  if (systemUnderstandingPercent < 80) nextActions.push('把最常用的人名、地名和工作术语加入自定义材料，优先提高真实场景可用性。')
  if (nextActions.length === 0) nextActions.push('保持当前设备和距离，再换到面试、会议或日常场景验证是否同样稳定。')

  return {
    sampleCount: validAttempts.length,
    systemUnderstandingPercent,
    consistencyLabel,
    consistencyDetail,
    speechRateCharsPerSecond,
    speechRateDetail,
    captureLabel,
    captureDetail,
    personalizationSeconds,
    personalizationProgressPercent,
    personalizationDetail,
    patterns,
    nextActions: nextActions.slice(0, 3),
    boundary: '本报告描述系统本轮如何听到你的声音和录音条件，不诊断疾病、嗓音健康或医学严重程度。',
  }
}
