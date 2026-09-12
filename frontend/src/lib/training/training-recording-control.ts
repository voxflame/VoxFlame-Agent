export interface TrainingRecordingControlState {
  isProcessing: boolean
  isReadingAssistancePlaying: boolean
  status: 'idle' | 'connecting' | 'ready' | 'recording' | 'processing' | 'error'
}

/** Background persistence must never block capture of the next training prompt. */
export function shouldDisableTrainingRecordingControl(
  state: TrainingRecordingControlState,
): boolean {
  return state.isProcessing
    || state.isReadingAssistancePlaying
    || state.status === 'connecting'
}
