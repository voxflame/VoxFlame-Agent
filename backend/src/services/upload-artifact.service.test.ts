import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRecordingManifestEntry,
  normalizeRecordingProgressSnapshot,
  classifyManifestRecordingState,
  executeRecoverableDiscard,
  removeManifestRecordingLines,
  removeTranscriptRecordingLines,
  resolveDiscardContributionMatches,
  resolveActiveManifestRows,
  runSerializedArtifactOperation,
  sanitizeUploadMetadata,
  summarizeRecordingProgress,
} from './upload-artifact.service'

test('append-only discard events hide matching manifest recordings without deleting siblings', () => {
  const active = resolveActiveManifestRows([
    { recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
    { recording_id: 'rec-2', audio: { path: 'dataset/u/rec-2.wav' } },
    {
      event: 'recording_discarded',
      schema_version: '1.0',
      recording_id: 'rec-1',
      audio: { path: 'dataset/u/rec-1.wav' },
    },
  ])

  assert.deepEqual(active, [
    { recording_id: 'rec-2', audio: { path: 'dataset/u/rec-2.wav' } },
  ])
})

test('discard events remain terminal when a delayed duplicate manifest row arrives', () => {
  const active = resolveActiveManifestRows([
    { recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
    { event: 'recording_discarded', recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
    { recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
  ])

  assert.deepEqual(active, [])
})

test('manifest state rejects a late upload after an append-only discard event', () => {
  assert.equal(classifyManifestRecordingState([
    { recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
    { event: 'recording_discarded', recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
    { recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } },
  ], 'rec-1', 'dataset/u/rec-1.wav'), 'discarded')
  assert.equal(classifyManifestRecordingState([
    { recording_id: 'rec-2', audio: { path: 'dataset/u/rec-2.wav' } },
  ], 'rec-2', 'dataset/u/rec-2.wav'), 'active')
  assert.equal(classifyManifestRecordingState([], 'rec-3', 'dataset/u/rec-3.wav'), 'missing')
})

test('manifest scrub removes target text while preserving its tombstone and sibling recordings', () => {
  const content = [
    JSON.stringify({ recording_id: 'rec-1', prompt: { text: '需要撤回的正文' }, audio: { path: 'dataset/u/rec-1.wav' } }),
    JSON.stringify({ recording_id: 'rec-2', prompt: { text: '保留的正文' }, audio: { path: 'dataset/u/rec-2.wav' } }),
    JSON.stringify({ event: 'recording_discarded', recording_id: 'rec-1', audio: { path: 'dataset/u/rec-1.wav' } }),
  ].join('\n') + '\n'

  const scrubbed = removeManifestRecordingLines(content, 'rec-1', 'dataset/u/rec-1.wav')
  assert.equal(scrubbed.includes('需要撤回的正文'), false)
  assert.equal(scrubbed.includes('保留的正文'), true)
  assert.equal(scrubbed.includes('recording_discarded'), true)
})

test('transcript scrub removes only the matching audio line', () => {
  const content = [
    'rec-1\tdataset/u/rec-1.wav\t需要撤回的正文',
    'rec-2\tdataset/u/rec-2.wav\t保留的正文',
  ].join('\n') + '\n'

  assert.equal(
    removeTranscriptRecordingLines(content, 'dataset/u/rec-1.wav', 'rec-1'),
    'rec-2\tdataset/u/rec-2.wav\t保留的正文\n',
  )
})

test('discard identifiers must resolve to the same recording', () => {
  const recordingA = {
    id: 'contribution-a',
    audio_path: 'dataset/u/rec-a.wav',
    sentence_id: 'sentence-a',
    metadata: { recording_id: 'rec-a' },
  }
  const recordingB = {
    id: 'contribution-b',
    audio_path: 'dataset/u/rec-b.wav',
    sentence_id: 'sentence-b',
    metadata: { recording_id: 'rec-b' },
  }

  assert.equal(resolveDiscardContributionMatches({
    contributorId: 'u',
    contributionId: recordingA.id,
    audioPath: recordingA.audio_path,
    recordingId: 'rec-a',
  }, {
    contributionId: recordingA,
    audioPath: recordingA,
    recordingId: recordingA,
  }), recordingA)

  assert.throws(() => resolveDiscardContributionMatches({
    contributorId: 'u',
    contributionId: recordingA.id,
    audioPath: recordingB.audio_path,
    recordingId: 'rec-a',
  }, {
    contributionId: recordingA,
    audioPath: recordingB,
    recordingId: recordingA,
  }), /discard_identifier_mismatch/)
})

test('discard rejects a stale identifier when another supplied identifier still resolves', () => {
  const recording = {
    id: 'contribution-a',
    audio_path: 'dataset/u/rec-a.wav',
    sentence_id: 'sentence-a',
    metadata: { recording_id: 'rec-a' },
  }

  assert.throws(() => resolveDiscardContributionMatches({
    contributorId: 'u',
    contributionId: 'wrong-contribution',
    audioPath: recording.audio_path,
    recordingId: 'rec-a',
  }, {
    contributionId: null,
    audioPath: recording,
    recordingId: recording,
  }), /discard_identifier_mismatch/)

  const historicalRecording = {
    ...recording,
    metadata: {},
  }
  assert.equal(resolveDiscardContributionMatches({
    contributorId: 'u',
    contributionId: historicalRecording.id,
    audioPath: historicalRecording.audio_path,
    recordingId: 'rec-a',
  }, {
    contributionId: historicalRecording,
    audioPath: historicalRecording,
    recordingId: null,
  }), historicalRecording)

  assert.equal(resolveDiscardContributionMatches({
    contributorId: 'u',
    contributionId: 'already-removed',
    audioPath: recording.audio_path,
    recordingId: 'rec-a',
  }, {
    contributionId: null,
    audioPath: null,
    recordingId: null,
  }), null)
})

test('discard rejects mismatched path and recording ID without relying on a database row', () => {
  assert.throws(() => resolveDiscardContributionMatches({
    contributorId: 'u',
    audioPath: 'dataset/u/mobile-workbench/rec-a.wav',
    recordingId: 'rec-b',
  }, {
    contributionId: null,
    audioPath: null,
    recordingId: null,
  }), /discard_identifier_mismatch/)
})

test('shared artifact mutations are serialized per contributor', async () => {
  const calls: string[] = []
  await Promise.all([
    runSerializedArtifactOperation('account-a', async () => {
      calls.push('upload:start')
      await Promise.resolve()
      calls.push('upload:end')
    }),
    runSerializedArtifactOperation('account-a', async () => {
      calls.push('discard:start')
      calls.push('discard:end')
    }),
  ])

  assert.deepEqual(calls, ['upload:start', 'upload:end', 'discard:start', 'discard:end'])
})

test('server upload metadata allow-list drops device, browser, and arbitrary fields', () => {
  assert.deepEqual(
    sanitizeUploadMetadata({
      target_text: '你好',
      spoken_text: '泥好',
      severity: 'mild',
      etiology: 'stroke',
      recording_id: 'rec-1',
      pronunciation_targets: ['zang4', 'zha2'],
      reading_assistance_used: true,
      sample_rate: 16_000,
      user_agent: 'private-browser-details',
      microphone_label: 'USB microphone',
      client_capture_id: 'internal-capture-id',
      raw_audio: 'should-not-be-a-metadata-value',
      empty: '   ',
      unsupported_object: { secret: true },
    }),
    {
      target_text: '你好',
      spoken_text: '泥好',
      severity: 'mild',
      etiology: 'stroke',
      recording_id: 'rec-1',
      pronunciation_targets: ['zang4', 'zha2'],
      reading_assistance_used: true,
      sample_rate: 16_000,
    },
  )
})

test('manifest keeps explicit pronunciation targets without promoting arbitrary metadata', () => {
  const manifest = buildRecordingManifestEntry(
    'contributor-1',
    'supervised/mandarin/音系强化/recording-1.wav',
    '阿胶已经开封',
    null,
    1.25,
    sanitizeUploadMetadata({
      target_text: '阿胶已经开封',
      exercise_id: 'coverage-recording-gap-1',
      exercise_category: '音系强化',
      pronunciation_targets: ['e1', 'jiao1'],
      user_agent: 'must-not-enter-manifest-metadata',
    }),
  )

  assert.deepEqual(manifest.prompt.target_focus, ['e1', 'jiao1'])
  assert.equal((manifest.metadata as Record<string, unknown>).user_agent, undefined)
  assert.equal(manifest.prompt.text, '阿胶已经开封')
})

test('manifest carries the server-verified consent snapshot', () => {
  const manifest = buildRecordingManifestEntry(
    'contributor-1',
    'dataset/contributor-1/mobile-workbench/recording-1.m4a',
    '请再说一次',
    null,
    1.5,
    sanitizeUploadMetadata({
      recording_id: 'recording-1',
      consent_scope: 'training_only',
      consent_version: '2026-09-06',
      consent_accepted_at: '2026-09-04T01:00:00.000Z',
      admission_status: 'admitted',
      admission_version: '2026-09-04.1',
    }),
  )

  assert.deepEqual(manifest.consent, {
    scope: 'training_only',
    version: '2026-09-06',
    accepted_at: '2026-09-04T01:00:00.000Z',
    retention_tier: 'synced_hot',
    sync_status: 'uploaded',
    visibility: 'private',
  })
})

test('server metadata keeps article lineage without accepting article body', () => {
  assert.deepEqual(
    sanitizeUploadMetadata({
      reading_material_kind: 'voxflame_original',
      reading_article_id: 'reading-001',
      reading_article_version: '1.0.0',
      reading_segment_id: 'reading-001-segment-01',
      reading_segment_index: 0,
      reading_segment_count: 10,
      reading_round_id: 'round-1',
      reading_article_body: '不应随每条录音重复进入元数据',
    }),
    {
      reading_material_kind: 'voxflame_original',
      reading_article_id: 'reading-001',
      reading_article_version: '1.0.0',
      reading_segment_id: 'reading-001-segment-01',
      reading_segment_index: 0,
      reading_segment_count: 10,
      reading_round_id: 'round-1',
    },
  )
})

test('recording progress separates local calendar day and returns safe identifiers', () => {
  const snapshot = summarizeRecordingProgress(
    [
      {
        sentence_id: 'ordinary-1',
        duration_seconds: 25.5,
        created_at: '2026-08-27T15:59:00.000Z',
        metadata: { exercise_category: '日常与出行' },
      },
      {
        sentence_id: 'reading-001-segment-01',
        duration_seconds: 34.5,
        created_at: '2026-08-27T16:01:00.000Z',
        metadata: { reading_segment_id: 'reading-001-segment-01' },
      },
      {
        sentence_id: 'reading-001-segment-02',
        duration_seconds: 20,
        created_at: '2026-08-28T03:00:00.000Z',
        metadata: { reading_segment_id: 'reading-001-segment-02' },
      },
    ],
    -480,
    Date.parse('2026-08-28T04:00:00.000Z'),
  )

  assert.deepEqual(snapshot.recordedSentenceIds, [
    'ordinary-1',
    'reading-001-segment-01',
    'reading-001-segment-02',
  ])
  assert.deepEqual(snapshot.recordedReadingSegmentIds, [
    'reading-001-segment-01',
    'reading-001-segment-02',
  ])
  assert.deepEqual(snapshot.recordedReadingRoundKeys, [
    'initial:reading-001-segment-01',
    'initial:reading-001-segment-02',
  ])
  assert.deepEqual(snapshot.readingArticleRoundIds, {})
  assert.deepEqual(snapshot.lastRecordedExerciseIds, {
    'category:日常与出行': 'ordinary-1',
  })
  assert.equal(snapshot.todayDurationSeconds, 54.5)
  assert.equal(snapshot.totalDurationSeconds, 80)
})

test('recording progress keeps the latest resume anchor per category or prepared material', () => {
  const snapshot = summarizeRecordingProgress([
    {
      sentence_id: 'daily-1',
      created_at: '2026-08-28T01:00:00.000Z',
      metadata: { exercise_category: '日常与出行' },
    },
    {
      sentence_id: 'daily-2',
      created_at: '2026-08-28T02:00:00.000Z',
      metadata: { exercise_category: '日常与出行' },
    },
    {
      sentence_id: 'prepared-1',
      created_at: '2026-08-28T03:00:00.000Z',
      metadata: {
        exercise_category: '现代文章朗读',
        prepared_expression_id: 'material-1',
      },
    },
  ], 0)

  assert.deepEqual(snapshot.lastRecordedExerciseIds, {
    'category:日常与出行': 'daily-2',
    'prepared_expression:material-1': 'prepared-1',
  })
})

for (const failure of [
  { step: 'manifest' },
  { step: 'transcript' },
  { step: 'audio' },
] as const) {
  test(`discard keeps the durable contribution when ${failure.step} cleanup fails`, async () => {
    const calls: string[] = []
    const runStep = async (step: string): Promise<boolean> => {
      calls.push(step)
      if (step === failure.step) throw new Error(`${step} unavailable`)
      return true
    }

    await assert.rejects(
      executeRecoverableDiscard({
        removeManifestEntry: () => runStep('manifest'),
        removeTranscriptEntry: () => runStep('transcript'),
        removeAudioObject: () => runStep('audio'),
        removeContribution: () => runStep('database'),
      }),
      new RegExp(`${failure.step} unavailable`),
    )

    assert.deepEqual(new Set(calls), new Set(['manifest', 'transcript', 'audio']))
    assert.equal(calls.includes('database'), false)
  })
}

test('discard reports a database failure only after all external cleanup completed', async () => {
  const calls: string[] = []

  await assert.rejects(
    executeRecoverableDiscard({
      removeManifestEntry: async () => {
        calls.push('manifest')
        return true
      },
      removeTranscriptEntry: async () => {
        calls.push('transcript')
        return true
      },
      removeAudioObject: async () => {
        calls.push('audio')
        return true
      },
      removeContribution: async () => {
        calls.push('database')
        throw new Error('database unavailable')
      },
    }),
    /database unavailable/,
  )

  assert.equal(calls.includes('manifest'), true)
  assert.equal(calls.includes('transcript'), true)
  assert.equal(calls.includes('audio'), true)
  assert.equal(calls.at(-1), 'database')
})

test('discard removes the contribution last after external cleanup completes', async () => {
  const calls: string[] = []
  const result = await executeRecoverableDiscard({
    removeManifestEntry: async () => {
      calls.push('manifest')
      return true
    },
    removeTranscriptEntry: async () => {
      calls.push('transcript')
      return true
    },
    removeAudioObject: async () => {
      calls.push('audio')
      return true
    },
    removeContribution: async () => {
      calls.push('database')
      return true
    },
  })

  assert.equal(calls.includes('manifest'), true)
  assert.equal(calls.includes('transcript'), true)
  assert.equal(calls.includes('audio'), true)
  assert.equal(calls.at(-1), 'database')
  assert.deepEqual(result, {
    removedContribution: true,
    removedAudioObject: true,
    removedManifestEntry: true,
    removedTranscriptEntry: true,
  })
})


test('progress rejects legacy/deletable totals instead of pretending they are durable', () => {
  assert.equal(normalizeRecordingProgressSnapshot({ totalDurationSeconds: 120 }), null)
  assert.equal(normalizeRecordingProgressSnapshot(null), null)
  assert.equal(normalizeRecordingProgressSnapshot({ durationAccounting: 'durable_v1' }), null)
  assert.equal(normalizeRecordingProgressSnapshot({ durationAccounting: 'durable_v1', totalDurationSeconds: -1, todayDurationSeconds: 0 }), null)
  const snapshot = normalizeRecordingProgressSnapshot({
    durationAccounting: 'durable_v1', totalDurationSeconds: 120, todayDurationSeconds: 30,
    recordedSentenceIds: ['s1'],
  })
  assert.equal(snapshot?.totalDurationSeconds, 120)
  assert.equal(snapshot?.todayDurationSeconds, 30)
  assert.deepEqual(snapshot?.recordedSentenceIds, ['s1'])
})
