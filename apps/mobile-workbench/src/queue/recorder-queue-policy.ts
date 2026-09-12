import type {
  MobileWorkbenchRecorderQueueItem,
  MobileWorkbenchSyncStatus,
} from '../contracts/workbench-contracts'

export interface RecorderQueueSummary {
  total: number
  localOnly: number
  uploadPending: number
  failed: number
  uploaded: number
  nextAction: string
}

const EMPTY_SUMMARY: RecorderQueueSummary = {
  total: 0,
  localOnly: 0,
  uploadPending: 0,
  failed: 0,
  uploaded: 0,
  nextAction: '本地队列为空',
}

function countByStatus(
  items: MobileWorkbenchRecorderQueueItem[],
  status: MobileWorkbenchSyncStatus,
): number {
  return items.filter((item) => item.syncStatus === status).length
}

export function summarizeRecorderQueue(
  items: MobileWorkbenchRecorderQueueItem[],
): RecorderQueueSummary {
  if (items.length === 0) {
    return EMPTY_SUMMARY
  }

  const failed = countByStatus(items, 'failed')
  const uploadPending = countByStatus(items, 'upload_pending')
  const localOnly = countByStatus(items, 'local_only')
  const uploaded = countByStatus(items, 'uploaded') + countByStatus(items, 'indexed')

  return {
    total: items.length,
    localOnly,
    uploadPending,
    failed,
    uploaded,
    nextAction: failed > 0
      ? '稍后重试上传'
      : uploadPending > 0 || localOnly > 0
        ? '网络恢复后补传'
        : '清理已同步缓存',
  }
}

/** A shared device may keep several accounts offline, but one account never sees another account's queue. */
export function recorderQueueItemsForContributor(
  items: MobileWorkbenchRecorderQueueItem[],
  contributorId: string | null,
): MobileWorkbenchRecorderQueueItem[] {
  if (!contributorId) return []
  return items.filter((item) => item.contributorId === contributorId)
}

export function recorderQueueItemBelongsToContributor(
  item: MobileWorkbenchRecorderQueueItem,
  contributorId: string | null,
): boolean {
  return Boolean(contributorId) && item.contributorId === contributorId
}
