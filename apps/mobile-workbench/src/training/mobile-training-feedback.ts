import type { MobileTrainingExercise } from './training-catalog'

export type MobileTrainingFeedbackStatus = 'excellent' | 'close' | 'retry' | 'unclear'

export interface MobileTrainingFeedback {
  status: MobileTrainingFeedbackStatus
  normalizedTarget: string
  normalizedHeard: string
  missingChars: string[]
  extraChars: string[]
  summary: string
  suggestion: string
}

export interface MobileArticulationBaselineAttempt {
  exerciseId: string
  targetText: string
  heardText: string
  normalizedTarget: string
  normalizedHeard: string
  missingChars: string[]
  extraChars: string[]
  durationMs?: number
  qualityDisposition?: 'high_confidence' | 'review' | 'low_confidence'
}

export interface MobileArticulationBaselineSummary {
  completedCount: number
  totalCount: number
  remainingCount: number
  referenceTextAgreementPercent: number
  label: string
  summary: string
  isComplete: boolean
  patterns: Array<{ label: string; count: number }>
  personalizationSeconds: number
  personalizationProgressPercent: number
  nextAction: string
  boundary: string
}

const PUNCTUATION_PATTERN = /[，。！？、；：“”‘’（）()\s]/g

function normalizeChineseText(text: string): string {
  return text.replace(PUNCTUATION_PATTERN, '').trim()
}

function characterEditDistance(target: string, heard: string): number {
  const targetChars = Array.from(target)
  const heardChars = Array.from(heard)
  let previous = Array.from({ length: heardChars.length + 1 }, (_, index) => index)

  for (let targetIndex = 1; targetIndex <= targetChars.length; targetIndex += 1) {
    const current = [targetIndex]
    for (let heardIndex = 1; heardIndex <= heardChars.length; heardIndex += 1) {
      const substitutionCost = targetChars[targetIndex - 1] === heardChars[heardIndex - 1] ? 0 : 1
      current[heardIndex] = Math.min(
        current[heardIndex - 1] + 1,
        previous[heardIndex] + 1,
        previous[heardIndex - 1] + substitutionCost,
      )
    }
    previous = current
  }

  return previous[heardChars.length]
}

function buildLcsTable(target: string[], heard: string[]): number[][] {
  const table = Array.from(
    { length: target.length + 1 },
    () => Array(heard.length + 1).fill(0) as number[],
  )
  for (let row = 1; row <= target.length; row += 1) {
    for (let column = 1; column <= heard.length; column += 1) {
      table[row][column] = target[row - 1] === heard[column - 1]
        ? table[row - 1][column - 1] + 1
        : Math.max(table[row - 1][column], table[row][column - 1])
    }
  }
  return table
}

function diffChars(target: string, heard: string): { missingChars: string[]; extraChars: string[] } {
  const targetChars = Array.from(target)
  const heardChars = Array.from(heard)
  const table = buildLcsTable(targetChars, heardChars)
  const missingChars: string[] = []
  const extraChars: string[] = []
  let row = targetChars.length
  let column = heardChars.length

  while (row > 0 && column > 0) {
    if (targetChars[row - 1] === heardChars[column - 1]) {
      row -= 1
      column -= 1
    } else if (table[row - 1][column] >= table[row][column - 1]) {
      missingChars.unshift(targetChars[row - 1])
      row -= 1
    } else {
      extraChars.unshift(heardChars[column - 1])
      column -= 1
    }
  }
  while (row > 0) {
    missingChars.unshift(targetChars[row - 1])
    row -= 1
  }
  while (column > 0) {
    extraChars.unshift(heardChars[column - 1])
    column -= 1
  }
  return { missingChars, extraChars }
}

export function analyzeMobileTrainingAttempt(
  exercise: MobileTrainingExercise,
  heardText: string,
): MobileTrainingFeedback {
  const normalizedTarget = normalizeChineseText(exercise.text)
  const normalizedHeard = normalizeChineseText(heardText)
  if (!normalizedHeard) {
    return {
      status: 'unclear',
      normalizedTarget,
      normalizedHeard,
      missingChars: Array.from(normalizedTarget),
      extraChars: [],
      summary: '录音已经保留，暂时没有生成参考文字。',
      suggestion: '先回听确认；只有你觉得需要时再录一次。',
    }
  }

  const { missingChars, extraChars } = diffChars(normalizedTarget, normalizedHeard)
  const gapCount = missingChars.length + extraChars.length
  const status: MobileTrainingFeedbackStatus = normalizedTarget === normalizedHeard
    ? 'excellent'
    : gapCount <= 2 ? 'close' : 'retry'
  const summary = status === 'excellent'
    ? '参考文字和题目一致。'
    : status === 'close'
      ? '参考文字和题目基本一致，只有少量差异。'
      : '参考文字和题目有一些差异，请以回听为准。'
  const suggestion = missingChars.length > 0
    ? `参考文字里少了“${missingChars.slice(0, 3).join('、')}”；你可以回听后决定是否再录。`
    : extraChars.length > 0
      ? `参考文字里多了“${extraChars.slice(0, 3).join('、')}”；你可以回听后决定是否再录。`
      : '如果回听内容符合你的表达，可以直接继续。'

  return {
    status,
    normalizedTarget,
    normalizedHeard,
    missingChars,
    extraChars,
    summary,
    suggestion,
  }
}

export function summarizeMobileArticulationBaseline(
  attempts: MobileArticulationBaselineAttempt[],
  totalCount: number,
): MobileArticulationBaselineSummary {
  const completedCount = attempts.length
  const remainingCount = Math.max(0, totalCount - completedCount)
  const totalChars = attempts.reduce(
    (sum, attempt) => sum + Array.from(attempt.normalizedTarget).length,
    0,
  )
  const matchedChars = attempts.reduce(
    (sum, attempt) => {
      const targetLength = Array.from(attempt.normalizedTarget).length
      return sum + Math.max(
        0,
        targetLength - characterEditDistance(attempt.normalizedTarget, attempt.normalizedHeard),
      )
    },
    0,
  )
  const referenceTextAgreementPercent = totalChars > 0 ? Math.round((matchedChars / totalChars) * 100) : 0
  const isComplete = totalCount > 0 && completedCount >= totalCount
  const patternCounts = new Map<string, number>()
  attempts.forEach((attempt) => {
    for (const character of [...attempt.missingChars, ...attempt.extraChars]) {
      patternCounts.set(character, (patternCounts.get(character) ?? 0) + 1)
    }
  })
  const patterns = Array.from(patternCounts.entries())
    .map(([label, count]) => ({ label: `“${label}”`, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
  const personalizationSeconds = Math.round(
    attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0) / 1000,
  )
  const personalizationProgressPercent = Math.min(
    100,
    Math.round((personalizationSeconds / 300) * 100),
  )
  const hasLowConfidenceRecording = attempts.some(
    (attempt) => attempt.qualityDisposition === 'low_confidence',
  )
  const reportFields = {
    patterns,
    personalizationSeconds,
    personalizationProgressPercent,
    nextAction: hasLowConfidenceRecording
      ? '有录音过短或收音不稳；请先回听，只有你觉得需要时再用相同设备复测。'
      : patterns[0]
        ? `如果你想复测，可以先对比${patterns[0].label}的录音和参考文字。`
        : '保持当前设备和距离，完成更多词后再看稳定规律。',
    boundary: '报告只对照自动参考文字和录音条件；参考文字可能有误，不代表你的表达能力，也不诊断疾病。',
  }

  if (!isComplete) {
    return {
      completedCount,
      totalCount,
      remainingCount,
      referenceTextAgreementPercent,
      label: completedCount > 0 ? '基线进行中' : '待开始',
      summary: completedCount > 0
        ? `已经完成 ${completedCount}/${totalCount} 个单音节，还剩 ${remainingCount} 个。`
        : '逐字完成 50 个单音节后，可查看参考文字与题面的对照和建议复测项。',
      isComplete: false,
      ...reportFields,
    }
  }

  return {
    completedCount,
    totalCount,
    remainingCount,
    referenceTextAgreementPercent,
    label: '基线已完成',
    summary: `本轮参考文字与题面一致约 ${referenceTextAgreementPercent}%。这只反映自动文字的对照结果，不评价你的声音。`,
    isComplete: true,
    ...reportFields,
  }
}
