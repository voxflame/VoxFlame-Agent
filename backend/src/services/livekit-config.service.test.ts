import { parseRtcStartSessionResult } from '../contracts/rtc-session'
import assert from 'node:assert/strict'
import { TokenVerifier } from 'livekit-server-sdk'
import {
  LiveKitConfigError,
  LiveKitConfigService,
} from './livekit-config.service'
import { LiveKitSessionService } from './livekit-session.service'
import { resolveAsrAccountId } from './asr-account-routing.service'
import {
  deriveRtcBrowserWebSocketUrl,
  RtcOrchestrationService,
} from './rtc-orchestration.service'

function withEnv(
  values: Record<string, string | undefined>,
  fn: () => void,
): void {
  const previous = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function withEnvAsync(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    await fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function runLiveKitConfigTests(): Promise<void> {
  assert.equal(
    resolveAsrAccountId({
      userId: '64758dee-5026-4b53-a063-1d02d0834f67',
      email: '2307294809@qq.com',
    }),
    '2307294809',
  )
  assert.equal(
    resolveAsrAccountId({
      userId: 'new-stable-user-id',
      email: 'member@example.com',
    }),
    'new-stable-user-id',
  )
  assert.equal(
    resolveAsrAccountId({
      userId: 'phone-account-user-id',
      email: '13818790456@example.com',
    }),
    'phone-account-user-id',
  )
  assert.equal(
    resolveAsrAccountId({
      userId: 'mixed-qq-user-id',
      email: 'vox2307294809@qq.com',
    }),
    'mixed-qq-user-id',
  )
  assert.equal(
    resolveAsrAccountId({
      userId: '  stable-trimmed-user-id  ',
      email: null,
    }),
    'stable-trimmed-user-id',
  )
  assert.equal(
    deriveRtcBrowserWebSocketUrl('ws://localhost:7880', 'http://localhost:3000'),
    'ws://localhost:7880',
  )
  assert.equal(
    deriveRtcBrowserWebSocketUrl('ws://livekit-server:7880', 'https://111.230.35.89'),
    'wss://111.230.35.89:7880',
  )
  assert.equal(
    deriveRtcBrowserWebSocketUrl(
      'ws://127.0.0.1:7880',
      'https://111.230.35.89/?mode=communicate',
    ),
    'wss://111.230.35.89:7880',
  )
  assert.equal(
    deriveRtcBrowserWebSocketUrl('wss://livekit.example.com', 'https://111.230.35.89'),
    null,
  )
  assert.equal(deriveRtcBrowserWebSocketUrl('ws://localhost:7880', undefined), null)

  withEnv(
    {
      LIVEKIT_URL: undefined,
      LIVEKIT_BROWSER_URL: undefined,
      VOXFLAME_PUBLIC_BASE_URL: undefined,
      LIVEKIT_API_KEY: undefined,
      LIVEKIT_API_SECRET: undefined,
      LIVEKIT_AGENT_NAME: undefined,
      RTC_ENABLE_LIVEKIT_EXPERIMENT: undefined,
    },
    () => {
      const service = new LiveKitConfigService()
      const status = service.getStatus()

      assert.equal(status.configured, false)
      assert.equal(status.enabled, false)
      assert.deepEqual(status.missingEnv, [
        'LIVEKIT_URL',
        'LIVEKIT_API_KEY',
        'LIVEKIT_API_SECRET',
      ])
      assert.match(status.detail, /not configured yet/i)
    },
  )

  withEnv(
    {
      LIVEKIT_URL: 'wss://livekit.example.com',
      LIVEKIT_BROWSER_URL: 'wss://browser-livekit.example.com',
      VOXFLAME_PUBLIC_BASE_URL: undefined,
      LIVEKIT_API_KEY: 'lk_api_key',
      LIVEKIT_API_SECRET: 'lk_api_secret',
      RTC_ENABLE_LIVEKIT_EXPERIMENT: '0',
    },
    () => {
      const service = new LiveKitConfigService()

      assert.throws(
        () => service.assertCanStart(),
        (error: unknown) =>
          error instanceof LiveKitConfigError &&
          error.statusCode === 501 &&
          /not enabled yet/i.test(error.message),
      )
    },
  )

  withEnv(
    {
      LIVEKIT_URL: 'wss://livekit.internal.example.com',
      LIVEKIT_BROWSER_URL: 'wss://livekit.example.com',
      VOXFLAME_PUBLIC_BASE_URL: undefined,
      LIVEKIT_API_KEY: 'lk_api_key',
      LIVEKIT_API_SECRET: 'lk_api_secret',
      LIVEKIT_AGENT_NAME: 'voxflame-agent',
      RTC_ENABLE_LIVEKIT_EXPERIMENT: 'true',
    },
    () => {
      const service = new LiveKitConfigService()
      const status = service.getStatus()

      assert.equal(status.configured, true)
      assert.equal(status.enabled, true)
      assert.equal(status.serverUrl, 'wss://livekit.internal.example.com')
      assert.equal(status.browserUrl, 'wss://livekit.example.com')
      assert.equal(status.agentName, 'voxflame-agent')
      assert.deepEqual(status.missingEnv, [])
      assert.doesNotThrow(() => service.assertCanStart())
    },
  )

  withEnv(
    {
      LIVEKIT_URL: 'ws://livekit-server:7880',
      LIVEKIT_BROWSER_URL: undefined,
      VOXFLAME_PUBLIC_BASE_URL: 'https://111.230.35.89.sslip.io',
      LIVEKIT_API_KEY: 'lk_api_key',
      LIVEKIT_API_SECRET: 'lk_api_secret',
      RTC_ENABLE_LIVEKIT_EXPERIMENT: 'true',
    },
    () => {
      const service = new LiveKitConfigService()
      const status = service.getStatus()

      assert.equal(status.serverUrl, 'ws://livekit-server:7880')
      assert.equal(status.browserUrl, 'wss://111.230.35.89.sslip.io')
    },
  )

  const service = new LiveKitSessionService()
  const session = await service.createSession({
    requestId: 'req_livekit_12345678',
    roomName: 'voxflame-room-1',
    userUid: 42,
    timeoutSeconds: 120,
    intent: {
      surface: 'communication_workspace',
      mode: 'communication',
      sessionStrategy: 'heavy_realtime',
      requestedCapabilities: ['transport_send_control'],
      grantedCapabilities: ['transport_send_control'],
      scene: 'medical',
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
    serverUrl: 'wss://livekit.example.com',
    apiKey: 'test_api_key',
    apiSecret: 'test_api_secret',
    agentName: 'voxflame-agent',
    authenticatedUserId: '64758dee-5026-4b53-a063-1d02d0834f67',
    asrAccountId: '2307294809',
  })

  assert.equal(session.roomName, 'voxflame-room-1')
  assert.equal(session.participantName, 'voxflame-user-42')
  assert.equal(session.participantAttributes['vox.mode'], 'communication')
  assert.equal(session.agentDispatch?.agentName, 'voxflame-agent')
  assert.equal(JSON.parse(session.participantMetadata).asr_account_id, undefined)
  assert.equal(JSON.parse(session.participantMetadata).authenticated_user_id, undefined)
  assert.equal(session.participantAttributes['vox.authenticated_user_id'], undefined)
  assert.equal(
    JSON.parse(session.agentDispatch?.metadata ?? '{}').asr_account_id,
    '2307294809',
  )
  assert.equal(
    JSON.parse(session.agentDispatch?.metadata ?? '{}').authenticated_user_id,
    '64758dee-5026-4b53-a063-1d02d0834f67',
  )

  const verifier = new TokenVerifier('test_api_key', 'test_api_secret')
  const grants = await verifier.verify(session.participantToken)
  assert.equal(grants.video?.room, 'voxflame-room-1')
  assert.equal(grants.metadata, session.participantMetadata)
  assert.equal(grants.attributes?.['vox.surface'], 'communication_workspace')

  console.log('livekit-session.service tests passed')

  await withEnvAsync(
    {
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_BROWSER_URL: 'wss://voxember.com',
      LIVEKIT_API_KEY: 'test_api_key',
      LIVEKIT_API_SECRET: 'test_api_secret',
      LIVEKIT_AGENT_NAME: 'voxflame-agent',
      RTC_ENABLE_LIVEKIT_EXPERIMENT: '1',
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      const originalFetch = globalThis.fetch
      let fetchCalls = 0
      globalThis.fetch = (async () => {
        fetchCalls += 1
        throw new Error('unexpected HTTP health probe')
      }) as typeof fetch

      try {
        const orchestration = new RtcOrchestrationService()
        const result = await orchestration.startSession({
          mode: 'communication',
          intent: {
            surface: 'communication_workspace',
            mode: 'communication',
            sessionStrategy: 'heavy_realtime',
            requestedCapabilities: ['transport_send_control'],
            deviceContext: {
              secureContext: true,
              mediaDevicesSupported: true,
              microphoneStatus: 'available',
              networkOnline: true,
            },
          },
        })

        assert.deepEqual(parseRtcStartSessionResult(JSON.parse(JSON.stringify(result))), result)
        assert.equal(result.intent.scene, null)
        for (const field of ['graphName', 'appId', 'token', 'rtmToken', 'rtmUserId', 'rtmChannelName', 'botUid', 'userUid', 'timeoutSeconds', 'controlServerUrl']) {
          assert.equal(Object.prototype.hasOwnProperty.call(result, field), false, field)
        }
        assert.equal(result.executionBackend, 'livekit')
        assert.equal(result.transport.agentDispatch?.agentName, 'voxflame-agent')
        assert.equal(
          Object.prototype.hasOwnProperty.call(
            result.transport.agentDispatch ?? {},
            'metadata',
          ),
          false,
        )
        assert.equal(fetchCalls, 0)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )

  console.log('rtc-orchestration.service tests passed')

  console.log('livekit-config.service tests passed')
}

runLiveKitConfigTests().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
