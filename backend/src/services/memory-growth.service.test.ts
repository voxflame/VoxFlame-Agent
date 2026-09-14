import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMemoryGrowthProfileSnapshot } from './memory-growth.service';

test('pending automatic text is not counted as unclear or scored as low clarity', () => {
  const profile = buildMemoryGrowthProfileSnapshot({
    sessions: [],
    memories: [
      {
        id: 'pending',
        user_id: 'user-1',
        session_id: 'session-1',
        content: '题目文本',
        created_at: '2026-09-14T00:00:00.000Z',
        metadata: {
          kind: 'training_result',
          reference_text_status: 'pending',
          feedback_status: 'unclear',
        },
      },
      {
        id: 'available',
        user_id: 'user-1',
        session_id: 'session-1',
        content: '另一条题目',
        created_at: '2026-09-14T00:01:00.000Z',
        metadata: {
          kind: 'training_result',
          reference_text_status: 'available',
          feedback_status: 'excellent',
        },
      },
    ],
  });

  assert.equal(profile.statusCounts.unclear, 0);
  assert.equal(profile.statusCounts.excellent, 1);
  assert.equal(profile.stats.rollingClarityAverage, 0.95);
  assert.equal(profile.trends[0]?.unclear, 0);
});
