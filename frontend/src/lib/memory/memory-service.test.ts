import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSessionCloseUserProfileUpdate,
  buildSessionCloseUserProfileUpdateRequestBody,
  mergeConcurrentSyncQueue,
  type Session,
} from './memory-service.ts'

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'user-1',
    startTime: 1_710_000_000_000,
    endTime: 1_710_000_060_000,
    turns: [
      {
        id: 'turn-1',
        role: 'user',
        content: '我说话会慢一点，请先听我说完。',
        timestamp: 1_710_000_010_000,
        sessionId: 'session-1',
      },
    ],
    metadata: {
      kind: 'communication',
      source: 'rtc_agent',
      scene: 'medical',
      latestCorrectionOriginal: '请先听我说完',
      latestCorrectionText: '我说话会慢一点，请先听我说完。',
      currentPreparedExpressionTitle: '门诊沟通',
      currentPreparedExpressionSectionTitle: '挂号开场',
    },
    ...overrides,
  }
}

test('buildSessionCloseUserProfileUpdate narrows communication session into user profile memory fields', () => {
  const update = buildSessionCloseUserProfileUpdate(createSession())

  assert.ok(update)
  assert.match(update?.summary ?? '', /更稳的表达是/)
  assert.deepEqual(update?.common_scenarios, ['medical'])
  assert.deepEqual(update?.risky_terms, ['请先听我说完'])
  assert.ok(
    (update?.support_strategies ?? []).some((item) => item.includes('现场如果系统听偏')),
  )
})

test('buildSessionCloseUserProfileUpdate prefers server runtime candidate when available', () => {
  const update = buildSessionCloseUserProfileUpdate(createSession({
    metadata: {
      kind: 'communication',
      source: 'rtc_agent',
      communicationScene: 'medical',
      latestCorrectionOriginal: '本地旧字段',
      latestCorrectionText: '本地旧改写',
      serverCompactionSessionKind: 'communication',
      serverCompactionSummary: '最近确认过的更稳表达是“请先帮我挂号”。',
      serverCompactionRiskyTerms: ['请先帮我'],
      serverCompactionSupportStrategies: ['先保住挂号这个核心诉求。'],
      serverCompactionRecentUserIntents: ['请先帮我'],
      serverCompactionRecentConfirmedPhrases: ['请先帮我挂号。'],
    },
  }))

  assert.ok(update)
  assert.equal(update?.summary, '最近确认过的更稳表达是“请先帮我挂号”。')
  assert.deepEqual(update?.risky_terms, ['请先帮我'])
  assert.deepEqual(update?.support_strategies, ['先保住挂号这个核心诉求。'])
  assert.deepEqual(update?.common_scenarios, ['medical'])
})

test('buildSessionCloseUserProfileUpdate ignores training sessions', () => {
  const update = buildSessionCloseUserProfileUpdate(createSession({
    metadata: {
      kind: 'training',
      source: 'rtc_agent',
      lastTrainingFeedbackSummary: '这一轮更适合先把开场白练稳。',
    },
  }))

  assert.equal(update, null)
})

test('buildSessionCloseUserProfileUpdateRequestBody builds typed backend payload', () => {
  const payload = buildSessionCloseUserProfileUpdateRequestBody('user-1', createSession())

  assert.ok(payload)
  assert.equal(payload?.user_id, 'user-1')
  assert.equal(payload?.session_id, 'session-1')
  assert.equal(payload?.session.id, 'session-1')
  assert.match(payload?.profile_update.summary ?? '', /更稳的表达是/)
  assert.deepEqual(payload?.profile_update.common_scenarios, ['medical'])
})

test('concurrent queue merge keeps failures and items added while a sync is in flight', () => {
  const first = { id: 'first' }
  const second = { id: 'second' }
  const addedDuringSync = { id: 'third' }

  assert.deepEqual(
    mergeConcurrentSyncQueue(
      [first, second],
      [second],
      [first, second, addedDuringSync],
    ),
    [second, addedDuringSync],
  )
})
