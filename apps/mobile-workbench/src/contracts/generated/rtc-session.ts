// GENERATED from backend/src/contracts/rtc-session.ts; run node scripts/sync-rtc-contract.mjs
/** Canonical RTC HTTP wire contract. Client copies are generated; no server imports. */
export type RtcSessionMode = 'communication' | 'training' | 'quick_talk'
export type RtcExecutionBackend = 'livekit'
export type RtcSurface =
  | 'home_main'
  | 'communication_workspace'
  | 'training_workspace'
  | 'memory_workspace'
  | 'mobile_workbench'
  | 'desktop_companion'
export type RtcSessionStrategy = 'heavy_realtime' | 'light_voice'
export type RtcCapabilityId =
  | 'transport_send_control'
  | 'voice_profile_update'
  | 'workspace_snapshot_read'
  | 'upload_artifact_persist'
export type RtcScene =
  | 'medical'
  | 'family'
  | 'stranger'
  | 'emergency'
  | 'work'
  | 'interview'
  | 'outing'
  | 'home'
export type RtcMicrophoneStatus = 'unknown' | 'available' | 'unavailable'

export interface RtcDeviceContext {
  secureContext?: boolean
  mediaDevicesSupported?: boolean
  microphoneStatus?: RtcMicrophoneStatus
  networkOnline?: boolean
}

export interface RtcSessionIntent {
  surface: RtcSurface
  mode: RtcSessionMode
  sessionStrategy: RtcSessionStrategy
  requestedCapabilities: RtcCapabilityId[]
  scene?: RtcScene
  deviceContext?: RtcDeviceContext
}

export interface RtcResolvedSessionIntent {
  surface: RtcSurface
  mode: RtcSessionMode
  sessionStrategy: RtcSessionStrategy
  requestedCapabilities: RtcCapabilityId[]
  grantedCapabilities: RtcCapabilityId[]
  scene: RtcScene | null
  deviceContext: RtcDeviceContext
}

export interface RtcSessionReadiness {
  canStart: boolean
  requestedStrategy: RtcSessionStrategy
  resolvedStrategy: RtcSessionStrategy
  recommendedStrategy: RtcSessionStrategy
  microphoneRequired: boolean
  blockers: string[]
  warnings: string[]
  summary: RtcSessionReadinessSummary
}

export interface RtcSessionReadinessSummary {
  status: 'needs_attention' | 'can_start' | 'ready'
  label: string
  detail: string
  nextAction: string
  blockerSummary: string | null
  warningSummary: string | null
}

export interface LiveKitTransportRuntime {
  provider: 'livekit'
  serverUrl: string
  roomName: string
  participantIdentity: string
  participantName: string
  participantToken: string
  participantMetadata: string
  participantAttributes: Record<string, string>
  agentDispatch: {
    agentName: string
  } | null
}

export type RtcTransportRuntime = LiveKitTransportRuntime

export type RtcSessionIntentInput = Partial<RtcSessionIntent>

/** Only transport contains connection credentials; token TTL is not session duration. */
export interface RtcStartSessionResult {
  requestId: string
  channelName: string
  executionBackend: RtcExecutionBackend
  joinTokenTtlSeconds: number
  transport: RtcTransportRuntime
  intent: RtcResolvedSessionIntent
  readiness: RtcSessionReadiness
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function strategy(value: unknown): value is RtcSessionStrategy {
  return oneOf(value, ['heavy_realtime', 'light_voice'])
}

function capabilities(value: unknown): value is RtcCapabilityId[] {
  return Array.isArray(value) && value.every((item: unknown) => oneOf(item, [
    'transport_send_control', 'voice_profile_update',
    'workspace_snapshot_read', 'upload_artifact_persist',
  ]))
}

function deviceContext(value: unknown): value is RtcDeviceContext {
  return record(value)
    && ['secureContext', 'mediaDevicesSupported', 'networkOnline'].every(
      (key) => value[key] === undefined || typeof value[key] === 'boolean',
    )
    && (value.microphoneStatus === undefined
      || oneOf(value.microphoneStatus, ['unknown', 'available', 'unavailable']))
}

function resolvedIntent(value: unknown): value is RtcResolvedSessionIntent {
  return record(value)
    && oneOf(value.surface, ['home_main', 'communication_workspace', 'training_workspace',
      'memory_workspace', 'mobile_workbench', 'desktop_companion'])
    && oneOf(value.mode, ['communication', 'training', 'quick_talk'])
    && strategy(value.sessionStrategy)
    && capabilities(value.requestedCapabilities)
    && capabilities(value.grantedCapabilities)
    && (value.scene === null || oneOf(value.scene,
      ['medical', 'family', 'stranger', 'emergency', 'work', 'interview', 'outing', 'home']))
    && deviceContext(value.deviceContext)
}

function readiness(value: unknown): value is RtcSessionReadiness {
  if (!record(value) || !record(value.summary)) return false
  const summary = value.summary
  return typeof value.canStart === 'boolean'
    && typeof value.microphoneRequired === 'boolean'
    && strategy(value.requestedStrategy) && strategy(value.resolvedStrategy)
    && strategy(value.recommendedStrategy)
    && strings(value.blockers) && strings(value.warnings)
    && oneOf(summary.status, ['needs_attention', 'can_start', 'ready'])
    && typeof summary.label === 'string' && typeof summary.detail === 'string'
    && typeof summary.nextAction === 'string'
    && nullableString(summary.blockerSummary) && nullableString(summary.warningSummary)
}

function transport(value: unknown): value is LiveKitTransportRuntime {
  if (!record(value) || value.provider !== 'livekit') return false
  const required = ['serverUrl', 'roomName', 'participantIdentity', 'participantName', 'participantToken']
  if (!required.every((key) => typeof value[key] === 'string' && value[key].trim().length > 0)) return false
  if (typeof value.serverUrl !== 'string') return false
  try {
    const url = new URL(value.serverUrl)
    if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false
  } catch { return false }
  return typeof value.participantMetadata === 'string'
    && record(value.participantAttributes)
    && Object.values(value.participantAttributes).every((item) => typeof item === 'string')
    && (value.agentDispatch === null || (record(value.agentDispatch)
      && typeof value.agentDispatch.agentName === 'string'
      && value.agentDispatch.agentName.trim().length > 0))
}

/** Validate untrusted HTTP JSON before either client opens an RTC connection. Never log payload/tokens. */
export function parseRtcStartSessionResult(value: unknown): RtcStartSessionResult {
  if (!record(value)
    || typeof value.requestId !== 'string' || !value.requestId.trim()
    || typeof value.channelName !== 'string' || !value.channelName.trim()
    || value.executionBackend !== 'livekit'
    || typeof value.joinTokenTtlSeconds !== 'number'
    || !Number.isSafeInteger(value.joinTokenTtlSeconds) || value.joinTokenTtlSeconds <= 0
    || !transport(value.transport) || value.channelName !== value.transport.roomName
    || !resolvedIntent(value.intent) || !readiness(value.readiness)) {
    throw new Error('rtc_session_invalid_response')
  }
  // Return only the supported public fields, not arbitrary HTTP additions.
  return {
    requestId: value.requestId, channelName: value.channelName,
    executionBackend: value.executionBackend, joinTokenTtlSeconds: value.joinTokenTtlSeconds,
    transport: value.transport, intent: value.intent, readiness: value.readiness,
  }
}

/** Public clients request intent only; room, participant, account and token TTL are server-owned. */
export interface RtcStartSessionRequest {
  intent: RtcSessionIntent
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

/** Strict public boundary: reject typos/legacy routing fields instead of silently choosing defaults. */
export function parseRtcStartSessionRequest(value: unknown): RtcStartSessionRequest {
  if (!record(value) || !onlyKeys(value, ['intent']) || !record(value.intent)) {
    throw new Error('rtc_session_invalid_request')
  }
  const intent = value.intent
  if (!onlyKeys(intent, ['surface', 'mode', 'sessionStrategy', 'requestedCapabilities', 'scene', 'deviceContext'])
    || !oneOf(intent.surface, ['home_main', 'communication_workspace', 'training_workspace',
      'memory_workspace', 'mobile_workbench', 'desktop_companion'])
    || !oneOf(intent.mode, ['communication', 'training', 'quick_talk'])
    || !strategy(intent.sessionStrategy)
    || !capabilities(intent.requestedCapabilities)
    || intent.requestedCapabilities.length > 4
    || new Set(intent.requestedCapabilities).size !== intent.requestedCapabilities.length
    || !(intent.scene === undefined || oneOf(intent.scene,
      ['medical', 'family', 'stranger', 'emergency', 'work', 'interview', 'outing', 'home']))
    || !(intent.deviceContext === undefined || (deviceContext(intent.deviceContext)
      && onlyKeys(intent.deviceContext as Record<string, unknown>,
        ['secureContext', 'mediaDevicesSupported', 'microphoneStatus', 'networkOnline'])))) {
    throw new Error('rtc_session_invalid_request')
  }
  return { intent: {
    surface: intent.surface, mode: intent.mode, sessionStrategy: intent.sessionStrategy,
    requestedCapabilities: [...intent.requestedCapabilities],
    ...(intent.scene !== undefined ? { scene: intent.scene } : {}),
    ...(intent.deviceContext !== undefined ? { deviceContext: { ...intent.deviceContext } } : {}),
  } }
}
