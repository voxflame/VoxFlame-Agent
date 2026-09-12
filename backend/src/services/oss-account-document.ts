import { createHash } from 'node:crypto'
import type { AuthAccountIdentity } from './oss-account-identity'
import { resolveOssAccountIdentity } from './oss-account-identity'

export const OSS_ACCOUNT_DOCUMENT_SCHEMA = 'voxflame-oss-account-v1'
export const ACCOUNT_MAPPING_MAX_AGE_MS = 60 * 60 * 1000

/** Restricted contact sidecar; audio manifests and speaker IDs remain UUID based. */
export function buildOssAccountDocument(ownerId: string, account: AuthAccountIdentity | undefined, now = new Date()) {
  const identity = resolveOssAccountIdentity(ownerId, account ? new Map([[account.id, account]]) : new Map())
  const active = account && !account.anonymous
  const fields = {
    schema: OSS_ACCOUNT_DOCUMENT_SCHEMA,
    user_id: ownerId,
    canonical_account_id: identity.canonicalAccountId,
    identity_status: identity.status,
    contact_type: active ? identity.contactType : 'none',
    contacts: {
      email: active && account.email ? { value: account.email, verified: account.emailVerified } : null,
      phone: active && account.phone ? { value: account.phone, verified: account.phoneVerified } : null,
    },
    source: 'supabase_auth_admin',
    usage: 'restricted_account_mapping_not_training_input',
  }
  return {
    ...fields,
    revision: createHash('sha256').update(JSON.stringify(fields)).digest('hex'),
    synced_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ACCOUNT_MAPPING_MAX_AGE_MS).toISOString(),
  }
}

/** Reject malformed owner paths instead of writing arbitrary object keys. */
export function ossAccountDocumentPath(ownerId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) throw new Error('invalid_account_owner')
  return `dataset/${ownerId}/account.json`
}

/** Include registrations with no audio yet and old OSS owners for contact-erasure reconciliation. */
export function accountDocumentOwners(accounts: ReadonlyMap<string, AuthAccountIdentity>, ossOwners: Iterable<string>): string[] {
  return [...new Set([...accounts.keys(), ...ossOwners])].sort()
}

/** Refresh identical snapshots periodically so GPU consumers can reject stale identity exports. */
export function accountDocumentNeedsRefresh(current: unknown, desired: ReturnType<typeof buildOssAccountDocument>, nowMs = Date.now()): boolean {
  if (typeof current !== 'object' || current === null) return true
  const doc = current as Record<string, unknown>
  if (doc.schema !== desired.schema || doc.user_id !== desired.user_id || doc.revision !== desired.revision) return true
  if (typeof doc.synced_at !== 'string') return true
  const age = nowMs - Date.parse(doc.synced_at)
  return !Number.isFinite(age) || age < 0 || age >= 15 * 60 * 1000
}
