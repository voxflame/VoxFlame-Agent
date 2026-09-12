export type TrainingExerciseSelectionStage = 'unrecorded' | 'unrepeated' | 'revisit'

export interface TrainingExerciseLike {
  id: string
}

export interface SelectTrainingExercisesOptions<TExercise extends TrainingExerciseLike> {
  exercises: TExercise[]
  recordedExerciseIds?: Iterable<string>
  sessionExerciseIds?: Iterable<string>
  resumeAfterExerciseId?: string | null
}

export interface SelectedTrainingExercises<TExercise extends TrainingExerciseLike> {
  exercises: TExercise[]
  stage: TrainingExerciseSelectionStage
  unrecordedCount: number
  unrepeatedCount: number
  totalCount: number
}

function toIdSet(values?: Iterable<string>): Set<string> {
  const results = new Set<string>()

  if (!values) {
    return results
  }

  for (const value of Array.from(values)) {
    const normalized = value.trim()
    if (!normalized) {
      continue
    }

    results.add(normalized)
  }

  return results
}

export function selectTrainingExercises<TExercise extends TrainingExerciseLike>(
  options: SelectTrainingExercisesOptions<TExercise>,
): SelectedTrainingExercises<TExercise> {
  const recordedExerciseIds = toIdSet(options.recordedExerciseIds)
  const sessionExerciseIds = toIdSet(options.sessionExerciseIds)
  const completedExerciseIds = new Set<string>([
    ...Array.from(recordedExerciseIds),
    ...Array.from(sessionExerciseIds),
  ])

  const resumeIndex = options.resumeAfterExerciseId
    ? options.exercises.findIndex((exercise) => exercise.id === options.resumeAfterExerciseId)
    : -1
  const orderedExercises = resumeIndex >= 0
    ? [
        ...options.exercises.slice(resumeIndex + 1),
        ...options.exercises.slice(0, resumeIndex + 1),
      ]
    : options.exercises

  const unrecordedExercises = orderedExercises.filter(
    (exercise) => !completedExerciseIds.has(exercise.id),
  )
  const unrepeatedExercises = orderedExercises.filter(
    (exercise) => !sessionExerciseIds.has(exercise.id),
  )

  if (unrecordedExercises.length > 0) {
    return {
      exercises: unrecordedExercises,
      stage: 'unrecorded',
      unrecordedCount: unrecordedExercises.length,
      unrepeatedCount: unrepeatedExercises.length,
      totalCount: orderedExercises.length,
    }
  }

  if (unrepeatedExercises.length > 0) {
    return {
      exercises: unrepeatedExercises,
      stage: 'unrepeated',
      unrecordedCount: 0,
      unrepeatedCount: unrepeatedExercises.length,
      totalCount: orderedExercises.length,
    }
  }

  return {
    exercises: orderedExercises,
    stage: 'revisit',
    unrecordedCount: 0,
    unrepeatedCount: 0,
    totalCount: orderedExercises.length,
  }
}
