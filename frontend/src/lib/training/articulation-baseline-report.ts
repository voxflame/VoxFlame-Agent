export type ArticulationBaselineStatus = 'not_started' | 'in_progress' | 'complete'

export interface ArticulationBaselineAttemptInput {
  exerciseId: string
  targetText: string
  heardText: string
  normalizedTarget: string
  normalizedHeard: string
}

export interface ArticulationBaselineItemResult {
  exerciseId: string
  targetText: string
  heardText: string
  matchedCharacters: number
  totalCharacters: number
  systemUnderstandingRatio: number
}

export interface ArticulationBaselineSummary {
  completedCount: number
  totalItemCount: number
  remainingCount: number
  matchedCharacters: number
  totalCharacters: number
  systemUnderstandingRatio: number
  status: ArticulationBaselineStatus
  statusLabel: string
  statusSummary: string
  isComplete: boolean
  reviewItems: ArticulationBaselineItemResult[]
}

export function calculateCharacterEditDistance(target: string, heard: string): number {
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

function buildItemResult(
  attempt: ArticulationBaselineAttemptInput,
): ArticulationBaselineItemResult {
  const totalCharacters = Array.from(attempt.normalizedTarget).length
  const editDistance = calculateCharacterEditDistance(
    attempt.normalizedTarget,
    attempt.normalizedHeard,
  )
  const matchedCharacters = Math.max(0, totalCharacters - editDistance)

  return {
    exerciseId: attempt.exerciseId,
    targetText: attempt.targetText,
    heardText: attempt.heardText,
    matchedCharacters,
    totalCharacters,
    systemUnderstandingRatio: totalCharacters > 0
      ? matchedCharacters / totalCharacters
      : 0,
  }
}

export function summarizeArticulationBaseline(
  attempts: ArticulationBaselineAttemptInput[],
  totalItemCount: number,
): ArticulationBaselineSummary {
  const itemResults = attempts
    .map(buildItemResult)
    .filter((result) => result.totalCharacters > 0)
  const completedCount = itemResults.length
  const remainingCount = Math.max(totalItemCount - completedCount, 0)
  const totalCharacters = itemResults.reduce(
    (sum, result) => sum + result.totalCharacters,
    0,
  )
  const matchedCharacters = itemResults.reduce(
    (sum, result) => sum + result.matchedCharacters,
    0,
  )
  const systemUnderstandingRatio = totalCharacters > 0
    ? matchedCharacters / totalCharacters
    : 0
  const isComplete = totalItemCount > 0 && completedCount >= totalItemCount
  const status: ArticulationBaselineStatus = completedCount === 0
    ? 'not_started'
    : isComplete ? 'complete' : 'in_progress'
  const statusLabel = status === 'not_started'
    ? '待开始'
    : status === 'complete' ? '基线已完成' : '基线进行中'
  const statusSummary = status === 'not_started'
    ? '逐字完成 50 个单音节后，可查看本轮系统听懂表现和建议复测项。'
    : status === 'complete'
      ? `本轮已完成 ${completedCount} 个单音节。结果用于同设备复测和沟通支持，不判断构音障碍类型或医学严重程度。`
      : `当前已完成 ${completedCount}/${totalItemCount} 个单音节，还剩 ${remainingCount} 个。`

  return {
    completedCount,
    totalItemCount,
    remainingCount,
    matchedCharacters,
    totalCharacters,
    systemUnderstandingRatio,
    status,
    statusLabel,
    statusSummary,
    isComplete,
    reviewItems: itemResults
      .filter((result) => result.systemUnderstandingRatio < 1)
      .sort((left, right) => left.systemUnderstandingRatio - right.systemUnderstandingRatio)
      .slice(0, 3),
  }
}
