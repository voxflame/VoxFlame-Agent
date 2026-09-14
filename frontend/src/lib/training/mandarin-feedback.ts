import { getTrainingTipsForCategory } from '@/lib/corpus/mandarin-training'
import type { MandarinTrainingExercise } from '@/lib/corpus/mandarin-training'
import { normalizeChineseText } from '@/lib/training/mandarin-text'

export type MandarinFeedbackStatus = 'excellent' | 'close' | 'retry' | 'unclear'

export interface MandarinTrainingFeedback {
  status: MandarinFeedbackStatus
  normalizedTarget: string
  normalizedHeard: string
  missingChars: string[]
  extraChars: string[]
  speechPatterns: string[]
  articulationTips: string[]
  pronunciationTargets: string[]
  pronunciationSummary: string
  summary: string
  suggestions: string[]
}

function buildLcsTable(target: string[], heard: string[]): number[][] {
  const rows = target.length + 1
  const cols = heard.length + 1
  const table = Array.from({ length: rows }, () => Array(cols).fill(0))

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (target[i - 1] === heard[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1])
      }
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

  let i = targetChars.length
  let j = heardChars.length

  while (i > 0 && j > 0) {
    if (targetChars[i - 1] === heardChars[j - 1]) {
      i -= 1
      j -= 1
      continue
    }

    if (table[i - 1][j] >= table[i][j - 1]) {
      missingChars.unshift(targetChars[i - 1])
      i -= 1
    } else {
      extraChars.unshift(heardChars[j - 1])
      j -= 1
    }
  }

  while (i > 0) {
    missingChars.unshift(targetChars[i - 1])
    i -= 1
  }

  while (j > 0) {
    extraChars.unshift(heardChars[j - 1])
    j -= 1
  }

  return { missingChars, extraChars }
}

function buildSummary(
  status: MandarinFeedbackStatus,
  missingChars: string[],
  extraChars: string[],
): string {
  if (status === 'unclear') {
    return '录音已经保存，暂时没有生成可参考的文字。'
  }

  if (status === 'excellent') {
    return '参考文字和题目一致。你可以直接继续，也可以先回听确认。'
  }

  if (status === 'close') {
    const missing = missingChars.length > 0 ? `少了“${missingChars.join('、')}”` : ''
    const extra = extraChars.length > 0 ? `多了“${extraChars.join('、')}”` : ''
    const detail = [missing, extra].filter(Boolean).join('，')
    return `参考文字和题目基本一致，${detail || '只有少量差异'}。请以回听为准。`
  }

  return '参考文字和题目有一些差异。录音仍已保存，请以回听内容为准。'
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function buildPronunciationSummary(
  missingChars: string[],
  extraChars: string[],
): {
  targets: string[]
  summary: string
} {
  const targets = unique([
    ...missingChars.map((char) => `补稳“${char}”`),
    ...extraChars.map((char) => `收住“${char}”`),
  ]).slice(0, 4)

  const summaryParts = [
    missingChars.length > 0 ? `漏掉了“${missingChars.join('、')}”` : '',
    extraChars.length > 0 ? `多带出了“${extraChars.join('、')}”` : '',
  ].filter(Boolean)

  return {
    targets,
    summary:
      summaryParts.length > 0
        ? `参考文字里：${summaryParts.join('；')}。这只是识别提示，请以回听为准。`
        : '参考文字没有显示固定差异；是否需要再录，由你回听后决定。',
  }
}

function buildFocusSyllables(
  normalizedTarget: string,
  missingChars: string[],
  extraChars: string[],
): string[] {
  const combined = unique([...missingChars, ...extraChars])
  if (combined.length > 0) {
    return combined.slice(0, 4)
  }

  return Array.from(normalizedTarget).slice(0, 3)
}

function buildArticulationTips(
  exercise: MandarinTrainingExercise,
  missingChars: string[],
  extraChars: string[],
): string[] {
  const observedTips = [
    missingChars.length > 0 ? `如果你想再试，可以单独说一次“${missingChars[0]}”，看参考文字是否变化。` : '',
    extraChars.length > 0 ? '如果你想再试，可以在这几个字之间留一点间隔。' : '',
  ].filter(Boolean)

  return unique([
    ...observedTips,
    ...getTrainingTipsForCategory(exercise.category),
  ]).slice(0, 3)
}

function buildMotorSuggestions(
  status: MandarinFeedbackStatus,
  missingChars: string[],
  extraChars: string[],
  pronunciationSummary: {
    targets: string[]
  },
  articulationTips: string[],
  categoryTips: string[],
): string[] {
  const suggestions: string[] = []

  if (status === 'unclear') {
    suggestions.push('你可以先回听；如果录音内容完整，可以直接继续。')
  }

  if (missingChars.length > 0) {
    suggestions.push(`参考文字少了“${missingChars.join('、')}”；你可以回听后决定是否单独试试这几个字。`)
  }

  if (extraChars.length > 0) {
    suggestions.push(`参考文字多了“${extraChars.join('、')}”；你可以回听后决定是否再试一次。`)
  }

  if (pronunciationSummary.targets[0]) {
    suggestions.push(`如果你想对比，可以先试试 ${pronunciationSummary.targets[0]}，再回到整句。`)
  }

  if (articulationTips.length > 0) {
    suggestions.push(articulationTips[0])
  }

  if (suggestions.length === 0) {
    suggestions.push('如果回听内容符合你的表达，可以直接继续。')
  }

  return unique(suggestions).slice(0, 3)
}

export function analyzeMandarinAttempt(
  exercise: MandarinTrainingExercise,
  heardText: string,
): MandarinTrainingFeedback {
  const normalizedTarget = normalizeChineseText(exercise.text)
  const normalizedHeard = normalizeChineseText(heardText)
  const pronunciationSummary = buildPronunciationSummary([], [])
  const categoryTips = getTrainingTipsForCategory(exercise.category)
  const baseFocus = Array.from(normalizedTarget).slice(0, 3)
  const articulationTips = buildArticulationTips(
    exercise,
    [],
    [],
  )

  if (!normalizedHeard) {
    return {
      status: 'unclear',
      normalizedTarget,
      normalizedHeard,
      missingChars: Array.from(normalizedTarget),
      extraChars: [],
      speechPatterns: baseFocus,
      articulationTips,
      pronunciationTargets: [],
      pronunciationSummary: '暂时没有可用的参考文字；这不代表录音里没有声音。',
      summary: buildSummary('unclear', [], []),
      suggestions: [
        '先点回听确认录音内容；只有你觉得需要时再重录。',
      ],
    }
  }

  const { missingChars, extraChars } = diffChars(normalizedTarget, normalizedHeard)
  const gapCount = missingChars.length + extraChars.length
  const nextPronunciationSummary = buildPronunciationSummary(missingChars, extraChars)
  const nextArticulationTips = buildArticulationTips(
    exercise,
    missingChars,
    extraChars,
  )

  let status: MandarinFeedbackStatus = 'retry'
  if (normalizedTarget === normalizedHeard) {
    status = 'excellent'
  } else if (gapCount <= 2) {
    status = 'close'
  }

  const suggestions = buildMotorSuggestions(
    status,
    missingChars,
    extraChars,
    nextPronunciationSummary,
    nextArticulationTips,
    categoryTips,
  )

  return {
    status,
    normalizedTarget,
    normalizedHeard,
    missingChars,
    extraChars,
    speechPatterns: buildFocusSyllables(
      normalizedTarget,
      missingChars,
      extraChars,
    ),
    articulationTips: nextArticulationTips,
    pronunciationTargets: nextPronunciationSummary.targets,
    pronunciationSummary: nextPronunciationSummary.summary,
    summary: buildSummary(status, missingChars, extraChars),
    suggestions,
  }
}
