import type { MobileTrainingExercise } from './training-catalog'

export interface MobileTrainingCaptureSnapshot {
  captureId: string
  contributorId: string
  exercise: MobileTrainingExercise
  exerciseIndex: number
  preparedExpressionId?: string
  speechVariant: MobileTrainingSpeechVariant
  utterancePairId?: string
  dialect?: { name: string; region: string }
}

export type MobileTrainingSpeechVariant = 'mandarin' | 'dialect'

/** Mirrors the Web collection contract without coupling the App bundle to Next.js code. */
export function createMobileUtterancePairId(
  now: number = Date.now(),
  randomValue: number = Math.random(),
): string {
  return `pair-${now.toString(36)}-${randomValue.toString(36).slice(2, 10)}`
}

export function shouldOfferMobileDialectPair(options: {
  hasDialect: boolean
  dialectName?: string
  isAssessment: boolean
}): boolean {
  return options.hasDialect
    && Boolean(options.dialectName?.trim())
    && !options.isAssessment
}

export function buildMobileSpeechVariantMetadata(options: {
  speechVariant: MobileTrainingSpeechVariant
  utterancePairId?: string
  dialectName?: string
  dialectRegion?: string
}): Record<string, string> {
  const metadata: Record<string, string> = {
    speech_variant: options.speechVariant,
    prompt_language: 'zh-CN',
    spoken_language: options.speechVariant === 'dialect' ? 'zh-dialect' : 'zh-CN',
  }
  if (options.utterancePairId) metadata.utterance_pair_id = options.utterancePairId
  if (options.speechVariant === 'dialect' && options.dialectName?.trim()) {
    metadata.dialect_name = options.dialectName.trim()
    metadata.label_source = 'user_reported'
    if (options.dialectRegion?.trim()) metadata.dialect_region = options.dialectRegion.trim()
  }
  return metadata
}

/** A capture may finish after auth changes; it must never be handed to another account. */
export function captureStillBelongsToContributor(
  capture: Pick<MobileTrainingCaptureSnapshot, 'contributorId'>,
  contributorId: string | null,
): boolean {
  return Boolean(contributorId) && capture.contributorId === contributorId
}

/** Serialize local queue read-modify-write operations so concurrent actions cannot overwrite each other. */
export function createMobileSerialExecutor() {
  let tail: Promise<void> = Promise.resolve()

  return async function runSerially<T>(operation: () => Promise<T>): Promise<T> {
    const predecessor = tail.catch(() => undefined)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    tail = predecessor.then(() => gate)
    await predecessor
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export type MobileAdvanceDecision =
  | { kind: 'select_loaded'; index: number }
  | { kind: 'load_more'; nextIndex: number }
  | { kind: 'complete' }

/** The accepted recording advances within loaded data, requests another page, or completes. */
export function decideMobileAdvance(options: {
  currentIndex: number
  loadedCount: number
  totalCount: number
}): MobileAdvanceDecision {
  if (options.currentIndex + 1 < options.loadedCount) {
    return { kind: 'select_loaded', index: options.currentIndex + 1 }
  }

  if (options.loadedCount < options.totalCount) {
    return { kind: 'load_more', nextIndex: options.currentIndex + 1 }
  }

  return { kind: 'complete' }
}

/** Appending a catalog page must not move a still-valid selection. */
export function reconcileMobileExerciseSelection(
  exercises: MobileTrainingExercise[],
  selectedExerciseId: string | null,
): { exercise: MobileTrainingExercise | null; index: number } {
  if (selectedExerciseId) {
    const selectedIndex = exercises.findIndex((exercise) => exercise.id === selectedExerciseId)
    if (selectedIndex >= 0) {
      return { exercise: exercises[selectedIndex], index: selectedIndex }
    }
  }

  return { exercise: exercises[0] ?? null, index: 0 }
}
