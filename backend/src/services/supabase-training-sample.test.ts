import assert from 'node:assert/strict';
import test from 'node:test';

import { toPreparedExpressionTrainingSample } from './supabase.service';

test('training sample never treats the prompt transcript as recognized user speech', () => {
  const sample = toPreparedExpressionTrainingSample({
    created_at: '2026-09-14T00:00:00.000Z',
    transcript: '题目文本',
    metadata: {
      kind: 'training_result',
      target_text: '题目文本',
      reference_text_status: 'pending',
    },
  });

  assert.ok(sample);
  assert.equal(sample.target_text, '题目文本');
  assert.equal(sample.recognized_text, '');
  assert.equal(sample.feedback_status, null);
});

test('training sample uses only explicit automatic reference-text fields', () => {
  const sample = toPreparedExpressionTrainingSample({
    transcript: '题目文本',
    metadata: {
      kind: 'training_result',
      target_text: '题目文本',
      recognized_text: '参考文字',
      feedback_status: 'retry',
    },
  });

  assert.ok(sample);
  assert.equal(sample.recognized_text, '参考文字');
  assert.equal(sample.feedback_status, 'retry');
});
