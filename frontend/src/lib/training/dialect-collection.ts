export type TrainingSpeechVariant = 'mandarin' | 'dialect'

export interface DialectCollectionTarget<TExercise> {
  exercise: TExercise
  speechVariant: TrainingSpeechVariant
  utterancePairId?: string
  dialect?: { name: string; region: string }
}

/** Pair ids are client-generated lineage only; recording ids remain the upload idempotency key. */
export function createUtterancePairId(
  now: number = Date.now(),
  randomValue: number = Math.random(),
): string {
  return `pair-${now.toString(36)}-${randomValue.toString(36).slice(2, 10)}`
}

export function shouldOfferDialectPair(options: {
  hasDialect: boolean
  dialectName?: string
  isAssessment: boolean
}): boolean {
  return options.hasDialect
    && Boolean(options.dialectName?.trim())
    && !options.isAssessment
}

export function buildSpeechVariantMetadata(options: {
  speechVariant: TrainingSpeechVariant
  utterancePairId?: string
  dialectName?: string
  dialectRegion?: string
}): Record<string, string> {
  const metadata: Record<string, string> = {
    speech_variant: options.speechVariant,
    prompt_language: 'zh-CN',
    spoken_language: options.speechVariant === 'dialect' ? 'zh-dialect' : 'zh-CN',
  }

  if (options.utterancePairId) {
    metadata.utterance_pair_id = options.utterancePairId
  }
  if (options.speechVariant === 'dialect' && options.dialectName?.trim()) {
    metadata.dialect_name = options.dialectName.trim()
    metadata.label_source = 'user_reported'
    if (options.dialectRegion?.trim()) metadata.dialect_region = options.dialectRegion.trim()
  }

  return metadata
}
