import { Directory, File, Paths } from 'expo-file-system'

import type {
  MobileWorkbenchRecorderQueueItem,
  MobileWorkbenchSyncStatus,
  MobileWorkbenchUploadReceipt,
} from '../contracts/workbench-contracts'
import { createMobileSerialExecutor } from '../training/mobile-recording-workflow'

const QUEUE_DIR_NAME = 'voxflame-recorder-queue'
const AUDIO_DIR_NAME = 'audio'
const QUEUE_FILE_NAME = 'queue.json'
const runQueueMutation = createMobileSerialExecutor()

function getQueueDirectory(): Directory {
  return new Directory(Paths.document, QUEUE_DIR_NAME)
}

function getAudioDirectory(): Directory {
  return new Directory(getQueueDirectory(), AUDIO_DIR_NAME)
}

function getQueueFile(): File {
  return new File(getQueueDirectory(), QUEUE_FILE_NAME)
}

function ensureQueueStorage(): void {
  const queueDirectory = getQueueDirectory()
  if (!queueDirectory.exists) {
    queueDirectory.create({ intermediates: true, idempotent: true })
  }

  const audioDirectory = getAudioDirectory()
  if (!audioDirectory.exists) {
    audioDirectory.create({ intermediates: true, idempotent: true })
  }
}

function isQueueItem(value: unknown): value is MobileWorkbenchRecorderQueueItem {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Partial<MobileWorkbenchRecorderQueueItem>
  return typeof item.recordingId === 'string'
    && typeof item.contributorId === 'string'
    && typeof item.text === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.syncStatus === 'string'
    && Boolean(item.recording)
}

function parseQueueItems(content: string): MobileWorkbenchRecorderQueueItem[] {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isQueueItem)
  } catch {
    return []
  }
}

export async function loadNativeRecorderQueue(): Promise<MobileWorkbenchRecorderQueueItem[]> {
  ensureQueueStorage()

  const queueFile = getQueueFile()
  if (!queueFile.exists) {
    return []
  }

  return parseQueueItems(await queueFile.text())
}

export async function saveNativeRecorderQueue(
  items: MobileWorkbenchRecorderQueueItem[],
): Promise<void> {
  ensureQueueStorage()

  const queueFile = getQueueFile()
  if (!queueFile.exists) {
    queueFile.create({ intermediates: true, overwrite: true })
  }

  queueFile.write(JSON.stringify(items, null, 2))
}

export async function appendNativeRecorderQueueItem(
  item: MobileWorkbenchRecorderQueueItem,
): Promise<MobileWorkbenchRecorderQueueItem[]> {
  return await runQueueMutation(async () => {
    const items = await loadNativeRecorderQueue()
    const nextItems = [item, ...items]
    await saveNativeRecorderQueue(nextItems)
    return nextItems
  })
}

export async function updateNativeRecorderQueueItemStatus(
  recordingId: string,
  status: MobileWorkbenchSyncStatus,
  errorMessage?: string,
  uploadReceipt?: MobileWorkbenchUploadReceipt | null,
): Promise<MobileWorkbenchRecorderQueueItem[]> {
  return await runQueueMutation(async () => {
    const items = await loadNativeRecorderQueue()
    const nextItems = items.map((item) => (
      item.recordingId === recordingId
        ? {
          ...item,
          syncStatus: status,
          syncAttempts: status === 'upload_pending'
            ? item.syncAttempts + 1
            : item.syncAttempts,
          lastAttemptAt: new Date().toISOString(),
          lastError: errorMessage,
          uploadReceipt: uploadReceipt === undefined
            ? item.uploadReceipt ?? null
            : uploadReceipt,
        }
        : item
    ))

    await saveNativeRecorderQueue(nextItems)
    return nextItems
  })
}

export async function updateNativeRecorderQueueItemRecognition(
  recordingId: string,
  recognizedText: string,
  metadata: Record<string, unknown>,
): Promise<MobileWorkbenchRecorderQueueItem[]> {
  return await runQueueMutation(async () => {
    const items = await loadNativeRecorderQueue()
    const nextItems = items.map((item) => (
      item.recordingId === recordingId
        ? {
          ...item,
          recognizedText: recognizedText.trim() || null,
          metadata: {
            ...item.metadata,
            ...metadata,
          },
        }
        : item
    ))

    await saveNativeRecorderQueue(nextItems)
    return nextItems
  })
}

export async function removeNativeRecorderQueueItem(
  recordingId: string,
): Promise<MobileWorkbenchRecorderQueueItem[]> {
  return await runQueueMutation(async () => {
    const items = await loadNativeRecorderQueue()
    const itemToRemove = items.find((item) => item.recordingId === recordingId)
    const nextItems = items.filter((item) => item.recordingId !== recordingId)

    await saveNativeRecorderQueue(nextItems)
    if (itemToRemove?.recording.audio.uri) {
      const audioFile = new File(itemToRemove.recording.audio.uri)
      if (audioFile.exists) {
        audioFile.delete()
      }
    }
    return nextItems
  })
}

export function persistNativeRecordingFile(params: {
  recordingId: string
  sourceUri: string
  extension?: string
}): {
  uri: string
  format: string
  fileSizeBytes: number
} {
  ensureQueueStorage()

  const sourceFile = new File(params.sourceUri)
  const rawExtension = params.extension
    ?? (sourceFile.extension.replace(/^\./, '') || 'm4a')
  const format = rawExtension.toLowerCase()
  const destination = new File(
    getAudioDirectory(),
    `${params.recordingId}.${format}`,
  )

  if (destination.exists) {
    destination.delete()
  }

  sourceFile.copy(destination)

  return {
    uri: destination.uri,
    format,
    fileSizeBytes: destination.size ?? 0,
  }
}
