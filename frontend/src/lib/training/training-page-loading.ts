/** Long-form reading needs cloud round state before selection; ordinary prompts stay usable. */
export function shouldBlockTrainingPageForProgress(
  isReadingArticle: boolean,
  isRecordingProgressLoading: boolean,
): boolean {
  return isReadingArticle && isRecordingProgressLoading
}
