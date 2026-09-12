export const RECORDING_DISCARDED_EVENT = 'recording_discarded'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isRecordingDiscardEvent(row) {
  return isRecord(row) && row.event === RECORDING_DISCARDED_EVENT
}

function recordingId(row) {
  if (!isRecord(row)) return null
  const value = row.recording_id ?? (isRecord(row.metadata) ? row.metadata.recording_id : null)
  return typeof value === 'string' && value.trim() ? value : null
}

function audioPath(row) {
  if (!isRecord(row)) return null
  const value = isRecord(row.audio) ? row.audio.path : null
  return typeof value === 'string' && value.trim() ? value : null
}

/** Fold append-only discard events while keeping every non-discard sibling immutable. */
export function resolveActiveRecordingManifestRows(rows) {
  const discardedRecordingIds = new Set()
  const discardedAudioPaths = new Set()

  for (const row of rows) {
    if (!isRecordingDiscardEvent(row)) continue
    const id = recordingId(row)
    const path = audioPath(row)
    if (id) discardedRecordingIds.add(id)
    if (path) discardedAudioPaths.add(path)
  }

  return rows.filter((row) => {
    if (!isRecord(row) || isRecordingDiscardEvent(row)) return false
    const id = recordingId(row)
    const path = audioPath(row)
    return !(
      (id && discardedRecordingIds.has(id)) ||
      (path && discardedAudioPaths.has(path))
    )
  })
}

export function parseRecordingManifestJsonl(content, source = 'manifest.jsonl') {
  return content
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`${source}:${index + 1}: ${error.message}`)
      }
    })
}

export function parseActiveRecordingManifestJsonl(content, source = 'manifest.jsonl') {
  return resolveActiveRecordingManifestRows(parseRecordingManifestJsonl(content, source))
}
