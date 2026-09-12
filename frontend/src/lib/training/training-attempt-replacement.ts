export type TrainingAttemptUploadStatus =
  | 'idle'
  | 'saving'
  | 'uploaded'
  | 'local_only'
  | 'auth_required'
  | 'failed'
  | 'discarding'
  | 'discarded'

export type TrainingAttemptReplacementPlan =
  | 'start_without_discard'
  | 'wait_for_save_then_discard'
  | 'discard_then_start'
  | 'wait_for_discard'

/**
 * Decides how a retry replaces the previous recording without leaving two samples.
 */
export function planTrainingAttemptReplacement(
  uploadStatus: TrainingAttemptUploadStatus,
  hasRecording: boolean,
): TrainingAttemptReplacementPlan {
  if (!hasRecording || uploadStatus === 'discarded') {
    return 'start_without_discard'
  }

  if (uploadStatus === 'saving') {
    return 'wait_for_save_then_discard'
  }

  if (uploadStatus === 'discarding') {
    return 'wait_for_discard'
  }

  return 'discard_then_start'
}
