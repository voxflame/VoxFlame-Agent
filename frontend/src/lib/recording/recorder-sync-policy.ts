import type { VoxFlameRecorderQueueItem } from '@/lib/recording/recording-contract'

const BASE_RETRY_DELAY_MS = 30_000
const MAX_RETRY_DELAY_MS = 15 * 60_000

/** Return only recordings owned by the active account without deleting other accounts' local data. */
export function selectRecorderQueueItemsForAccount(
  items: VoxFlameRecorderQueueItem[],
  contributorId: string | null | undefined,
): VoxFlameRecorderQueueItem[] {
  if (!contributorId) {
    return []
  }

  return items.filter((item) => item.contributorId === contributorId)
}

/** Keep background sync account-bound and throttle repeated infrastructure failures. */
export function selectRecorderQueueItemsForSync(
  items: VoxFlameRecorderQueueItem[],
  contributorId: string,
  nowMs: number = Date.now(),
  force: boolean = false,
): VoxFlameRecorderQueueItem[] {
  return selectRecorderQueueItemsForAccount(items, contributorId).filter((item) => {

    if (force || !item.lastAttemptAt || item.syncAttempts <= 0) {
      return true
    }

    const lastAttemptMs = Date.parse(item.lastAttemptAt)
    if (!Number.isFinite(lastAttemptMs)) {
      return true
    }

    const retryDelayMs = Math.min(
      MAX_RETRY_DELAY_MS,
      BASE_RETRY_DELAY_MS * (2 ** Math.min(item.syncAttempts - 1, 5)),
    )
    return nowMs - lastAttemptMs >= retryDelayMs
  })
}
