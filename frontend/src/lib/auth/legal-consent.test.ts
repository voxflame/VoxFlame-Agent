import assert from 'node:assert/strict'
import test from 'node:test'
import type { User } from '@supabase/supabase-js'

import {
  LEGAL_CONSENT_VERSION,
  hasRequiredLegalConsent,
} from './legal-consent'

function userWithConsent(overrides: Record<string, unknown> = {}): User {
  return {
    user_metadata: {
      legal_consent: {
        privacy_accepted: true,
        sensitive_data_accepted: true,
        data_collection_accepted: true,
        commercial_use_accepted: true,
        accepted_at: '2026-09-04T01:00:00.000Z',
        version: LEGAL_CONSENT_VERSION,
        ...overrides,
      },
    },
  } as unknown as User
}

test('training consent must exist on the authenticated user', () => {
  assert.equal(hasRequiredLegalConsent(userWithConsent()), true)
  assert.equal(hasRequiredLegalConsent(null), false)
  assert.equal(hasRequiredLegalConsent(userWithConsent({ commercial_use_accepted: false })), false)
  assert.equal(hasRequiredLegalConsent(userWithConsent({ version: 'old' })), false)
})
