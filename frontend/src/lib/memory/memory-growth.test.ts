import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMemoryGrowthProfile } from './memory-growth'

test('pending automatic text is not counted as unclear or scored as low clarity', () => {
  const profile = buildMemoryGrowthProfile({
    sessions: [],
    memories: [
      {
        id: 'pending',
        userId: 'user-1',
        type: 'episodic',
        content: '题目文本',
        createdAt: Date.parse('2026-09-14T00:00:00.000Z'),
        updatedAt: Date.parse('2026-09-14T00:00:00.000Z'),
        metadata: {
          kind: 'training_result',
          reference_text_status: 'pending',
          feedback_status: 'unclear',
        },
      },
      {
        id: 'available',
        userId: 'user-1',
        type: 'episodic',
        content: '另一条题目',
        createdAt: Date.parse('2026-09-14T00:01:00.000Z'),
        updatedAt: Date.parse('2026-09-14T00:01:00.000Z'),
        metadata: {
          kind: 'training_result',
          reference_text_status: 'available',
          feedback_status: 'excellent',
        },
      },
    ],
  })

  assert.equal(profile.statusCounts.unclear, 0)
  assert.equal(profile.statusCounts.excellent, 1)
  assert.equal(profile.stats.rollingClarityAverage, 0.95)
  assert.equal(profile.trends[0]?.unclear, 0)
})
