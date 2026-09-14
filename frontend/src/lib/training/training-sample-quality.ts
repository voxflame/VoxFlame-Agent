import type { VoxFlameRecordingEnvelope } from '@/lib/recording/recording-contract'
import type { MandarinTrainingFeedback } from '@/lib/training/mandarin-feedback'

export type TrainingSampleQualityTier = 'ready' | 'usable' | 'review' | 'retry'
export type TrainingSampleQualityAction = 'keep' | 'review' | 'retry'

export interface TrainingSampleQuality {
  score: number
  tier: TrainingSampleQualityTier
  action: TrainingSampleQualityAction
  confidence: number
  latencyMs: number
  coverageRatio: number
  summary: string
  reasons: string[]
}

interface AssessTrainingSampleQualityOptions {
  feedback: MandarinTrainingFeedback
  recording: VoxFlameRecordingEnvelope | null
  transcriptLatencyMs: number
  referenceTextStatus?: 'pending' | 'available' | 'unavailable'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100
}

function deriveTier(score: number): {
  tier: TrainingSampleQualityTier
  action: TrainingSampleQualityAction
  summary: string
} {
  if (score >= 85) {
    return {
      tier: 'ready',
      action: 'keep',
      summary: '这条录音已保存；当前收音指标可供后续检查。',
    }
  }

  if (score >= 65) {
    return {
      tier: 'usable',
      action: 'keep',
      summary: '这条录音已保存；如果你想对比，以后可以再录一次。',
    }
  }

  if (score >= 40) {
    return {
      tier: 'review',
      action: 'review',
      summary: '这条录音已保存；请先回听，再由你决定是否补录。',
    }
  }

  return {
    tier: 'retry',
    action: 'retry',
    summary: '这条录音已保存；当前指标需要回看，但不会要求你自动重录。',
  }
}

export function assessTrainingSampleQuality(
  options: AssessTrainingSampleQualityOptions,
): TrainingSampleQuality {
  const {
    feedback,
    recording,
    transcriptLatencyMs,
    referenceTextStatus = feedback.normalizedHeard ? 'available' : 'unavailable',
  } = options
  const targetLength = feedback.normalizedTarget.length
  const heardLength = feedback.normalizedHeard.length
  const coverageRatio = targetLength > 0
    ? clamp(heardLength / targetLength, 0, 1)
    : 0

  const statusBaseScore: Record<MandarinTrainingFeedback['status'], number> = {
    excellent: 92,
    close: 76,
    retry: 54,
    unclear: 62,
  }

  let score = statusBaseScore[feedback.status]
  const reasons: string[] = []

  if (recording) {
    if (recording.audio.quality?.disposition === 'low_confidence') {
      score -= 22
      reasons.push('这次收音质量偏低，已保留为一次尝试，不建议当作高置信训练样本。')
    } else if (recording.audio.quality?.disposition === 'review') {
      score -= 8
      reasons.push('这次收音需要回看；可以先回听，再决定是否补录。')
    }

    if (recording.audio.durationMs < 900) {
      score -= 18
      reasons.push('录音时长较短；请先回听是否包含你想保留的内容。')
    } else if (recording.audio.durationMs < 1_500) {
      score -= 8
      reasons.push('录音略短；如果回听内容完整，可以直接保留。')
    } else {
      reasons.push('录音时长基本够支撑这一句继续进入训练链路。')
    }
  } else {
    score -= 24
    reasons.push('当前没有完整录音 envelope，只能先当作一次反馈尝试。')
  }

  if (referenceTextStatus === 'pending') {
    reasons.push('参考文字仍在生成；当前不用文字覆盖度评价录音。')
  } else if (referenceTextStatus === 'unavailable') {
    reasons.push('暂时没有可用的参考文字；当前不用文字覆盖度评价录音。')
  } else if (coverageRatio >= 0.95) {
    score += 4
    reasons.push('参考文字和题目的覆盖度很高。')
  } else if (coverageRatio >= 0.75) {
    reasons.push('参考文字包含了大部分关键词。')
  } else if (coverageRatio >= 0.45) {
    score -= 8
    reasons.push('参考文字只包含部分关键词；请以回听录音为准。')
  } else {
    score -= 18
    reasons.push('参考文字里的关键词偏少；这可能是文字尚未完整，不代表录音里没有声音。')
  }

  if (feedback.missingChars.length === 0 && feedback.extraChars.length === 0 && feedback.status === 'excellent') {
    score += 4
  }

  if (feedback.status === 'unclear') {
    reasons.push('这次暂时没有可用的参考文字；录音保存与文字结果分开判断。')
  } else if (feedback.status === 'retry') {
    reasons.push('参考文字和题目有一些差异；请以回听为准，是否补录由你决定。')
  } else if (feedback.status === 'close') {
    reasons.push('参考文字和题目基本一致；你可以直接保留或回听后再决定。')
  }

  if (referenceTextStatus === 'pending') {
    reasons.push('文字结果尚未返回，不影响录音保存。')
  } else if (transcriptLatencyMs > 4_500) {
    score -= 8
    reasons.push('参考文字返回较慢；这是处理延迟，不是对声音的评价。')
  } else if (transcriptLatencyMs > 2_500) {
    score -= 4
    reasons.push('参考文字返回稍慢，不影响录音保存。')
  } else {
    reasons.push('参考文字返回速度正常。')
  }

  const normalizedScore = clamp(Math.round(score), 0, 100)
  const confidence = roundToTwo(
    clamp(0.16 + normalizedScore / 100 * 0.78, 0.16, 0.94),
  )
  const derived = deriveTier(normalizedScore)

  return {
    score: normalizedScore,
    tier: derived.tier,
    action: derived.action,
    confidence,
    latencyMs: transcriptLatencyMs,
    coverageRatio: roundToTwo(coverageRatio),
    summary: derived.summary,
    reasons,
  }
}
