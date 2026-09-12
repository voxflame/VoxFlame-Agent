export const RECORDING_DISCARDED_EVENT: 'recording_discarded'

export function isRecordingDiscardEvent(row: unknown): boolean
export function resolveActiveRecordingManifestRows<T>(rows: T[]): T[]
export function parseRecordingManifestJsonl(
  content: string,
  source?: string,
): Record<string, unknown>[]
export function parseActiveRecordingManifestJsonl(
  content: string,
  source?: string,
): Record<string, unknown>[]
