interface TrainingExerciseLike {
  id: string
}

interface GetNextExerciseAfterAcceptedRecordingOptions<TExercise extends TrainingExerciseLike> {
  accepted: boolean
  currentExerciseId: string
  activeExercises: TExercise[]
  fallbackExercises?: TExercise[]
}

function findNextDistinctExercise<TExercise extends TrainingExerciseLike>(
  exercises: TExercise[],
  currentExerciseId: string,
): TExercise | null {
  if (exercises.length <= 1) {
    return null
  }

  const currentIndex = exercises.findIndex((exercise) => exercise.id === currentExerciseId)
  if (currentIndex < 0) {
    return exercises.find((exercise) => exercise.id !== currentExerciseId) ?? null
  }

  for (let offset = 1; offset < exercises.length; offset += 1) {
    const candidate = exercises[(currentIndex + offset) % exercises.length]
    if (candidate.id !== currentExerciseId) {
      return candidate
    }
  }

  return null
}

/**
 * Moves the prompt cursor after a complete recording is accepted.
 * ASR alignment and sample-quality advice deliberately do not control navigation.
 */
export function getNextExerciseAfterAcceptedRecording<TExercise extends TrainingExerciseLike>(
  options: GetNextExerciseAfterAcceptedRecordingOptions<TExercise>,
): TExercise | null {
  if (!options.accepted) {
    return null
  }

  return findNextDistinctExercise(options.activeExercises, options.currentExerciseId)
    ?? findNextDistinctExercise(options.fallbackExercises ?? [], options.currentExerciseId)
}
