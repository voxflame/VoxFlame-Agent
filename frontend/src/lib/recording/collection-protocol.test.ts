import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COLLECTION_PLANS,
  getCollectionPlanIdForTopic,
  isCollectionPreflightReady,
} from './collection-protocol'

test('collection tasks cover linguistic baseline, gaps, real use, connected speech, natural speech, and retest', () => {
  assert.deepEqual(
    COLLECTION_PLANS.map((plan) => plan.id),
    [
      'mandarin_articulation_baseline',
      'targeted_gap',
      'functional_speech',
      'connected_reading',
      'natural_speech',
      'anchor_retest',
    ],
  )
})

test('recording task is derived from the actual topic instead of a free metadata selector', () => {
  assert.equal(getCollectionPlanIdForTopic('daily-mobility'), 'functional_speech')
  assert.equal(getCollectionPlanIdForTopic('medical-help'), 'functional_speech')
  assert.equal(getCollectionPlanIdForTopic('pronunciation-reading'), 'connected_reading')
  assert.equal(getCollectionPlanIdForTopic('custom-material'), 'connected_reading')
  assert.equal(getCollectionPlanIdForTopic('phonology-training'), 'targeted_gap')
  assert.equal(getCollectionPlanIdForTopic('articulation-baseline'), 'mandarin_articulation_baseline')
})

test('targeted gap copy assigns the gap to the system instead of the speaker', () => {
  const plan = COLLECTION_PLANS.find((item) => item.id === 'targeted_gap')

  assert.equal(plan?.label, '让沟通更顺')
  assert.match(plan?.description ?? '', /按平时方式说/)
  assert.doesNotMatch(`${plan?.label}${plan?.userLabel}${plan?.description}`, /补齐声音|补音/)
})

test('recording is blocked until the three preflight checks are complete', () => {
  assert.equal(isCollectionPreflightReady({
    environmentReady: true,
    distanceReady: true,
    understandsConsent: true,
  }), true)
  assert.equal(isCollectionPreflightReady({
    environmentReady: true,
    distanceReady: false,
    understandsConsent: true,
  }), false)
})
