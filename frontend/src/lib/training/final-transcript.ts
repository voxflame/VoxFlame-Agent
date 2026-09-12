function semanticLength(text: string): number {
  return text.replace(/^[\s，。！？!?；;：:、,.…~～-]+|[\s，。！？!?；;：:、,.…~～-]+$/g, '').length
}

function compactSemanticText(text: string): string {
  return text.replace(/[\s，。！？!?；;：:、,.…~～\-《》"'“”‘’（）()【】[\]]+/g, '')
}

export function isRepetitiveTranscriptNoise(text: string): boolean {
  const compact = compactSemanticText(text)
  if (compact.length < 12) {
    return false
  }

  if (/(.)\1{8,}/.test(compact)) {
    return true
  }

  const counts = new Map<string, number>()
  for (const char of Array.from(compact)) {
    counts.set(char, (counts.get(char) ?? 0) + 1)
  }

  const topCount = Math.max(...Array.from(counts.values()))
  return topCount / compact.length >= 0.65 && counts.size <= 4
}

function cleanCandidate(text: string): string {
  const trimmed = text.trim()
  return isRepetitiveTranscriptNoise(trimmed) ? '' : trimmed
}

interface TrainingTranscriptCandidateInput {
  baseline: string
  latestFinal: string
  latestInterim: string
  bestObserved: string
}

export function mergeCaptureBoundResult<T extends { clientCaptureId: string }>(
  current: T | null,
  finalized: T,
): T | null {
  return current?.clientCaptureId === finalized.clientCaptureId
    ? finalized
    : current
}

export function pickPreferredTrainingTranscriptCandidate(
  input: TrainingTranscriptCandidateInput,
): string {
  const baseline = input.baseline.trim()
  const latestFinal = cleanCandidate(input.latestFinal)
  const latestInterim = cleanCandidate(input.latestInterim)
  const bestObserved = cleanCandidate(input.bestObserved)

  if (latestFinal && latestFinal !== baseline) {
    return latestFinal
  }

  if (
    bestObserved
    && semanticLength(bestObserved) > 0
    && semanticLength(bestObserved) >= semanticLength(latestInterim)
  ) {
    return bestObserved
  }

  if (latestInterim) {
    return latestInterim
  }

  return latestFinal !== baseline ? latestFinal : ''
}
