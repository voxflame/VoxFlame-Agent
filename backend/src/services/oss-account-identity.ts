import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Contact information describes an account; it must never become its storage or speaker key. */
export interface AuthAccountIdentity {
  id: string
  email: string | null
  phone: string | null
  emailVerified: boolean
  phoneVerified: boolean
  anonymous: boolean
}

export type AccountIdentityStatus = 'resolved' | 'contact_missing' | 'anonymous' | 'auth_missing' | 'legacy' | 'unassigned'

export interface OssAccountIdentity {
  accountKey: string
  canonicalAccountId: string | null
  storageKey: string
  status: AccountIdentityStatus
  contactType: 'email' | 'phone' | 'email_and_phone' | 'none'
  emailDisplay: string | null
  phoneDisplay: string | null
  emailVerified: boolean
  phoneVerified: boolean
}

export const ACCOUNT_IDENTITY_SCHEMA = 'voxflame-oss-account-identity-v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** Match only owner positions in known object layouts; never mistake a recording/session UUID for a user. */
export function extractOssAccountKey(objectName: string): string | null {
  const segments = objectName.split('/')
  if (segments.some((part) => part === '.' || part === '..' || part.includes('\\'))) return null
  if (['dataset', 'unlabeled'].includes(segments[0]) && segments[1]) return segments[1]
  if (segments[0] === 'supervised' && segments[1] === 'mandarin' && segments[3]) return segments[3]
  if (segments[0] === 'weak-supervision' && segments[1] === 'dialogue' && segments[2]) return segments[2]
  return null
}

function maskEmail(email: string | null): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  return at > 0 ? `${email.slice(0, Math.min(2, at))}***@${email.slice(at + 1)}` : '***'
}

function maskPhone(phone: string | null): string | null {
  return phone ? `***${phone.slice(-4)}` : null
}

export function resolveOssAccountIdentity(
  accountKey: string | null,
  accounts: ReadonlyMap<string, AuthAccountIdentity>,
  objectName: string = '',
): OssAccountIdentity {
  const account = accountKey ? accounts.get(accountKey) : undefined
  const email = account?.email?.trim() || null
  const phone = account?.phone?.trim() || null
  const status: AccountIdentityStatus = account
    ? account.anonymous ? 'anonymous' : email || phone ? 'resolved' : 'contact_missing'
    : accountKey ? UUID_RE.test(accountKey) ? 'auth_missing' : 'legacy' : 'unassigned'
  return {
    accountKey: accountKey ?? `unassigned:${digest(objectName)}`,
    canonicalAccountId: account?.id ?? null,
    // All resolved contact types share UUID storage, including accounts with both contact types.
    storageKey: account ? `accounts/${account.id}` : `quarantine/${status}/${digest(accountKey ?? objectName)}`,
    status,
    contactType: email && phone ? 'email_and_phone' : email ? 'email' : phone ? 'phone' : 'none',
    emailDisplay: maskEmail(email),
    phoneDisplay: maskPhone(phone),
    emailVerified: account?.emailVerified ?? false,
    phoneVerified: account?.phoneVerified ?? false,
  }
}

/** Admin lookup is paginated and fail-closed; lookup failures must not create fabricated OSS users. */
export async function fetchAuthAccountIdentities(client: SupabaseClient): Promise<Map<string, AuthAccountIdentity>> {
  const accounts = new Map<string, AuthAccountIdentity>()
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error('account_identity_auth_lookup_failed')
    for (const user of data.users) {
      accounts.set(user.id, {
        id: user.id,
        email: user.email?.trim() || null,
        // Preserve Auth's verified representation; never infer a phone from a numeric email local part.
        phone: user.phone?.trim() || null,
        emailVerified: Boolean(user.email_confirmed_at),
        phoneVerified: Boolean(user.phone_confirmed_at),
        anonymous: user.is_anonymous ?? false,
      })
    }
    if (data.users.length < 1000) break
  }
  return accounts
}
