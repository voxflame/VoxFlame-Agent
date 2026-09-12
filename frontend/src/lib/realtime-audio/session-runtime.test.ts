import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRtmMessageHandler,
  createSessionInitAckGate,
  createDecodedRtcMessageHandler,
  publishRtcRuntimeControlMessage,
  startRtcRuntimeConnection,
} from './session-runtime.ts'
import { createInitialRtcAgentState } from './session-state.ts'
import { memoryService } from '../memory/memory-service.ts'
import type { RtcAgentState, StartRtcSessionResponse } from './session-types.ts'

function createStateHarness(initialState: RtcAgentState = createInitialRtcAgentState()) {
  let state = initialState

  return {
    getState: () => state,
    setState: (updater: ((prev: RtcAgentState) => RtcAgentState) | RtcAgentState) => {
      state = typeof updater === 'function' ? updater(state) : updater
      return state
    },
  }
}

function createSession(): StartRtcSessionResponse {
  return {
    requestId: 'req_1',
    channelName: 'voxrtc_channel',
    executionBackend: 'livekit',
    joinTokenTtlSeconds: 90,
    transport: {
      provider: 'livekit',
      serverUrl: 'ws://127.0.0.1:3000',
      roomName: 'voxrtc_channel',
      participantIdentity: 'rtm-user-1',
      participantName: 'vox-user-1001',
      participantToken: 'participant_token',
      participantMetadata: '{}',
      participantAttributes: {},
      agentDispatch: null,
    },
    intent: {
      surface: 'communication_workspace',
      mode: 'communication',
      sessionStrategy: 'heavy_realtime',
      scene: 'medical',
      requestedCapabilities: ['transport_send_control'],
      grantedCapabilities: ['transport_send_control'],
      deviceContext: {
        secureContext: true,
        mediaDevicesSupported: true,
        microphoneStatus: 'unknown',
        networkOnline: true,
      },
    },
    readiness: {
      canStart: true,
      requestedStrategy: 'heavy_realtime',
      resolvedStrategy: 'heavy_realtime',
      recommendedStrategy: 'heavy_realtime',
      microphoneRequired: true,
      blockers: [],
      warnings: [],
      summary: {
        status: 'ready',
        label: '已经准备好',
        detail: '沟通会话可以开始。',
        nextAction: '直接连接并开始表达。',
        blockerSummary: null,
        warningSummary: null,
      },
    },
  }
}

test('session-runtime throws when control messages are published before RTM is ready', async () => {
  await assert.rejects(
    publishRtcRuntimeControlMessage(
      {
        rtmClientRef: { current: null },
        sessionRef: { current: null },
      },
      'user_input',
      { text: '你好' },
    ),
    /RTM 会话尚未就绪/,
  )
})

test('session-runtime clears connecting state when session start fails', async () => {
  const harness = createStateHarness()
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const originalNavigator = globalThis.navigator

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      isSecureContext: true,
    },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {},
      onLine: true,
    },
  })
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: '实时转录助手当前还没有准备好，请稍后再试。' }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    },
  )) as typeof fetch

  try {
    await assert.rejects(
      startRtcRuntimeConnection({
        refs: {
          connectionAbortRef: { current: null },
          clientRef: { current: null },
          rtmClientRef: { current: null },
          micTrackRef: { current: null },
          sessionRef: { current: null },
          connectPromiseRef: { current: null },
          inboundRtmChunksRef: { current: new Map() },
          latestUserTranscriptRef: {
            current: { text: '', clientCaptureId: null },
          },
          onDecodedEnvelopeRef: { current: null },
        },
        userId: 'user-1',
        accessToken: 'access-token',
        memoryOwnerId: null,
        mode: 'communication',
        connectionNotice: null,
        setState: harness.setState,
        cleanupMicrophoneResources: () => undefined,
        handleRtmMessage: () => undefined,
      }),
      /连接失败，请重试/,
    )
  } finally {
    globalThis.fetch = originalFetch
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    })
  }

  assert.equal(harness.getState().isConnecting, false)
  assert.equal(harness.getState().isConnected, false)
  assert.equal(
    harness.getState().error,
    '连接失败，请重试。',
  )
})

test('session-runtime publishes a structured control envelope through RTM when ready', async () => {
  const publishCalls: Array<[string, string]> = []
  const session = createSession()

  await publishRtcRuntimeControlMessage(
    {
      rtmClientRef: {
        current: {
          publish: async (channelName: string, payload: string) => {
            publishCalls.push([channelName, payload])
          },
        } as never,
      },
      sessionRef: {
        current: session,
      },
    },
    'user_input',
    { input_type: 'text', text: '你好' },
  )

  assert.equal(publishCalls.length, 1)
  const [channelName, serializedPayload] = publishCalls[0]
  const payload = JSON.parse(serializedPayload) as Record<string, unknown>
  assert.equal(channelName, 'voxrtc_channel')
  assert.equal(payload.type, 'user_input')
  assert.equal(payload.client_id, 'rtm-user-1')
  assert.equal(payload.session_id, 'voxrtc_channel')
  assert.equal(payload.input_type, 'text')
  assert.equal(payload.text, '你好')
  assert.equal(typeof payload.timestamp, 'number')
  assert.deepEqual(payload.metadata, {
    client_id: 'rtm-user-1',
    session_id: 'voxrtc_channel',
    transport: 'livekit_data',
    mode: 'communication',
    surface: 'communication_workspace',
    session_strategy: 'heavy_realtime',
  })
})

test('session-runtime updates latest transcript, memory turns, and reduced state for final user transcripts', () => {
  const harness = createStateHarness()
  const latestTranscriptRef = { current: { text: '', clientCaptureId: null } }
  const addTurnCalls: Array<[string, string]> = []
  const originalAddTurn = memoryService.addTurn
  memoryService.addTurn = ((role: string, content: string) => {
    addTurnCalls.push([role, content])
    return {} as never
  }) as typeof memoryService.addTurn

  try {
    const handleMessage = createDecodedRtcMessageHandler({
      memoryOwnerId: 'user-1',
      latestUserTranscriptRef: latestTranscriptRef,
      setState: harness.setState,
    })

    handleMessage({
      type: 'transcript',
      role: 'user',
      text: '我想慢一点说',
      is_final: true,
      client_capture_id: 'capture-1',
    })
  } finally {
    memoryService.addTurn = originalAddTurn
  }

  assert.deepEqual(latestTranscriptRef.current, {
    text: '我想慢一点说',
    clientCaptureId: 'capture-1',
  })
  assert.deepEqual(addTurnCalls, [['user', '我想慢一点说']])
  assert.equal(harness.getState().messages.at(-1)?.content, '我想慢一点说')
  assert.equal(harness.getState().latestUserTranscript, '我想慢一点说')
})

test('session-runtime writes audio input telemetry into current session metadata', () => {
  const harness = createStateHarness()
  const latestTranscriptRef = { current: { text: '', clientCaptureId: null } }
  const metadataUpdates: Array<Record<string, unknown>> = []
  const originalUpdateCurrentSessionMetadata = memoryService.updateCurrentSessionMetadata
  memoryService.updateCurrentSessionMetadata = ((metadata: Record<string, unknown>) => {
    metadataUpdates.push(metadata)
  }) as typeof memoryService.updateCurrentSessionMetadata

  try {
    const handleMessage = createDecodedRtcMessageHandler({
      memoryOwnerId: 'user-1',
      latestUserTranscriptRef: latestTranscriptRef,
      setState: harness.setState,
    })

    handleMessage({
      type: 'audio_input_telemetry',
      reason: 'clipping_detected',
      normalized_level: 0.11,
      peak_level: 0.99,
      clipping_detected: true,
      apm_enabled: true,
    })
  } finally {
    memoryService.updateCurrentSessionMetadata = originalUpdateCurrentSessionMetadata
  }

  assert.equal(metadataUpdates.length, 1)
  assert.equal(metadataUpdates[0].lastInputTelemetryReason, 'clipping_detected')
  assert.equal(metadataUpdates[0].lastInputNormalizedLevel, 0.11)
  assert.equal(metadataUpdates[0].lastInputPeakLevel, 0.99)
  assert.equal(metadataUpdates[0].lastInputClippingDetected, true)
  assert.equal(metadataUpdates[0].lastInputApmEnabled, true)
  assert.equal(metadataUpdates[0].audioClippingEventCount, 1)
})

test('session-runtime writes session userdata ack memory summary into current session metadata', () => {
  const harness = createStateHarness()
  const latestTranscriptRef = { current: { text: '', clientCaptureId: null } }
  const metadataUpdates: Array<Record<string, unknown>> = []
  let persistCalls = 0
  const originalUpdateCurrentSessionMetadata = memoryService.updateCurrentSessionMetadata
  const originalPersistCurrentSessionProfileUpdate = memoryService.persistCurrentSessionProfileUpdate
  memoryService.updateCurrentSessionMetadata = ((metadata: Record<string, unknown>) => {
    metadataUpdates.push(metadata)
  }) as typeof memoryService.updateCurrentSessionMetadata
  memoryService.persistCurrentSessionProfileUpdate = (async () => {
    persistCalls += 1
    return true
  }) as typeof memoryService.persistCurrentSessionProfileUpdate

  try {
    const handleMessage = createDecodedRtcMessageHandler({
      memoryOwnerId: 'user-1',
      latestUserTranscriptRef: latestTranscriptRef,
      setState: harness.setState,
    })

    handleMessage({
      type: 'session_userdata_ack',
      session_memory: {
        current_turn_state: 'idle',
        turn_count: 4,
        context_revision: 3,
        last_preparation_source: 'runtime_update',
        interruption_count: 2,
        barge_in_count: 1,
        caption_mode_enabled: true,
      },
      compaction_candidate: {
        session_kind: 'communication',
        summary: '最近确认过的更稳表达是“请先帮我挂号”。',
        fallback_phrases: ['请先帮我挂号。'],
        risky_terms: ['请先帮我'],
        support_strategies: ['优先保留用户原意。'],
        hotwords: ['挂号'],
        recent_user_intents: ['请先帮我'],
        recent_confirmed_phrases: ['请先帮我挂号。'],
      },
    })
  } finally {
    memoryService.updateCurrentSessionMetadata = originalUpdateCurrentSessionMetadata
    memoryService.persistCurrentSessionProfileUpdate = originalPersistCurrentSessionProfileUpdate
  }

  assert.equal(metadataUpdates.length, 1)
  assert.equal(persistCalls, 1)
  assert.equal(metadataUpdates[0].serverCurrentTurnState, 'idle')
  assert.equal(metadataUpdates[0].serverTurnCount, 4)
  assert.equal(metadataUpdates[0].serverContextRevision, 3)
  assert.equal(metadataUpdates[0].serverPreparationSource, 'runtime_update')
  assert.equal(metadataUpdates[0].serverInterruptionCount, 2)
  assert.equal(metadataUpdates[0].serverBargeInCount, 1)
  assert.equal(metadataUpdates[0].serverCaptionModeEnabled, true)
  assert.equal(metadataUpdates[0].serverCompactionSessionKind, 'communication')
  assert.equal(metadataUpdates[0].serverCompactionSummary, '最近确认过的更稳表达是“请先帮我挂号”。')
  assert.deepEqual(metadataUpdates[0].serverCompactionFallbackPhrases, ['请先帮我挂号。'])
  assert.deepEqual(metadataUpdates[0].serverCompactionRiskyTerms, ['请先帮我'])
  assert.deepEqual(metadataUpdates[0].serverCompactionSupportStrategies, ['优先保留用户原意。'])
  assert.deepEqual(metadataUpdates[0].serverCompactionHotwords, ['挂号'])
  assert.deepEqual(metadataUpdates[0].serverCompactionRecentUserIntents, ['请先帮我'])
  assert.deepEqual(metadataUpdates[0].serverCompactionRecentConfirmedPhrases, ['请先帮我挂号。'])
  assert.equal(harness.getState().lastSessionMemoryAck?.currentTurnState, 'idle')
  assert.equal(harness.getState().lastSessionMemoryAck?.turnCount, 4)
  assert.equal(harness.getState().lastSessionMemoryAck?.contextRevision, 3)
  assert.equal(harness.getState().lastSessionMemoryAck?.preparationSource, 'runtime_update')
})

test('session-runtime resolves the bootstrap gate after the matching session_init_ack arrives', async () => {
  const gate = createSessionInitAckGate('req_1', 100)
  gate.handleDecodedMessage({
    type: 'session_init_ack',
    metadata: {
      request_id: 'req_1',
    },
  })

  await assert.doesNotReject(gate.waitForReady())
  gate.cleanup()
})

test('session-runtime rejects the bootstrap gate when no session_init_ack arrives in time', async () => {
  const gate = createSessionInitAckGate('req_missing', 20)

  await assert.rejects(
    gate.waitForReady(),
    /系统已阻止这次“假连接”/,
  )
  gate.cleanup()
})

test('session-runtime forwards decoded envelopes to the optional onDecodedEnvelope callback', () => {
  const seenTypes: string[] = []
  const latestTranscriptRef = { current: { text: '', clientCaptureId: null } }
  const harness = createStateHarness()

  const handleMessage = createRtmMessageHandler({
    inboundRtmChunksRef: { current: new Map() },
    memoryOwnerId: null,
    latestUserTranscriptRef: latestTranscriptRef,
    setState: harness.setState,
    onDecodedEnvelope: (message) => {
      seenTypes.push(String(message.type || 'unknown'))
    },
  })

  handleMessage({
    message: JSON.stringify({
      type: 'session_init_ack',
      metadata: {
        request_id: 'req_1',
      },
    }),
    publisher: 'livekit-room',
    channelName: 'voxrtc_channel',
  })

  assert.deepEqual(seenTypes, ['session_init_ack'])
})

test('disconnect releases SDK room and local refs without HTTP even with no login token', async () => {
  const { disconnectRtcRuntime } = await import('./session-runtime.ts')
  const harness = createStateHarness({ ...createInitialRtcAgentState(), isConnected: true })
  let disconnectCalls = 0
  let cleanupCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('disconnect must not perform HTTP') }
  const refs: import('./session-runtime.ts').SessionRuntimeRefs = {
    connectionAbortRef: { current: null },
    clientRef: { current: { provider: 'livekit', room: {
      disconnect: async () => { disconnectCalls += 1 },
    } as unknown as import('livekit-client').Room } },
    rtmClientRef: { current: { publish: async () => undefined } },
    micTrackRef: { current: null }, sessionRef: { current: createSession() },
    connectPromiseRef: { current: null }, inboundRtmChunksRef: { current: new Map() },
    latestUserTranscriptRef: { current: { text: 'old', clientCaptureId: 'old' } },
    onDecodedEnvelopeRef: { current: () => undefined },
  }
  try {
    await disconnectRtcRuntime({ refs, setState: harness.setState, cleanupMicrophoneResources: () => { cleanupCalls += 1 } })
    await disconnectRtcRuntime({ refs, setState: harness.setState, cleanupMicrophoneResources: () => { cleanupCalls += 1 } })
    assert.equal(disconnectCalls, 1)
    assert.equal(cleanupCalls, 2)
    assert.equal(refs.sessionRef.current, null)
    assert.equal(refs.clientRef.current, null)
    assert.equal(refs.rtmClientRef.current, null)
    assert.equal(refs.onDecodedEnvelopeRef.current, null)
    assert.deepEqual(refs.latestUserTranscriptRef.current, { text: '', clientCaptureId: null })
    assert.equal(harness.getState().isConnected, false)
  } finally { globalThis.fetch = originalFetch }
})

test('disconnect still cleans microphone resources when SDK teardown rejects', async () => {
  const { disconnectRtcRuntime } = await import('./session-runtime.ts')
  let cleaned = false
  const refs: import('./session-runtime.ts').SessionRuntimeRefs = {
    connectionAbortRef: { current: null },
    clientRef: { current: { provider: 'livekit', room: {
      disconnect: async () => { throw new Error('SDK disconnect failed') },
    } as unknown as import('livekit-client').Room } },
    rtmClientRef: { current: null }, micTrackRef: { current: null },
    sessionRef: { current: createSession() }, connectPromiseRef: { current: null },
    inboundRtmChunksRef: { current: new Map() },
    latestUserTranscriptRef: { current: { text: '', clientCaptureId: null } },
    onDecodedEnvelopeRef: { current: null },
  }
  await assert.rejects(disconnectRtcRuntime({
    refs, setState: createStateHarness().setState,
    cleanupMicrophoneResources: () => { cleaned = true },
  }), /SDK disconnect failed/)
  assert.equal(cleaned, true)
  assert.equal(refs.clientRef.current, null)
})

test('disconnect invalidates an in-flight connection so it cannot resurrect the room', async () => {
  const { startRtcRuntimeConnection, disconnectRtcRuntime } = await import('./session-runtime.ts')
  const harness = createStateHarness()
  const pending: { resolve?: () => void } = {}
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Promise<Response>((resolve) => {
    pending.resolve = () => resolve(new Response(JSON.stringify(createSession())))
  })
  const refs: import('./session-runtime.ts').SessionRuntimeRefs = {
    clientRef: { current: null }, rtmClientRef: { current: null }, micTrackRef: { current: null },
    sessionRef: { current: null }, connectPromiseRef: { current: null }, inboundRtmChunksRef: { current: new Map() },
    latestUserTranscriptRef: { current: { text: '', clientCaptureId: null } }, onDecodedEnvelopeRef: { current: null },
    connectionAbortRef: { current: null },
  }
  try {
    const connecting = startRtcRuntimeConnection({
      refs, userId: 'user-1', accessToken: 'token', memoryOwnerId: null,
      mode: 'communication', connectionNotice: null, setState: harness.setState,
      cleanupMicrophoneResources: () => undefined, handleRtmMessage: () => undefined,
    })
    void connecting.catch(() => undefined)
    while (!pending.resolve) await new Promise((resolve) => setTimeout(resolve, 0))
    await disconnectRtcRuntime({ refs, setState: harness.setState, cleanupMicrophoneResources: () => undefined })
    pending.resolve?.()
    await assert.rejects(connecting, /rtc_connection_cancelled/)
    assert.equal(refs.sessionRef.current, null)
    assert.equal(refs.clientRef.current, null)
    assert.equal(harness.getState().isConnected, false)
  } finally { globalThis.fetch = originalFetch }
})
