import OSS from 'ali-oss'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { fetchAuthAccountIdentities, extractOssAccountKey } from '../services/oss-account-identity'
import { buildOssAccountDocument, ossAccountDocumentPath, accountDocumentOwners, accountDocumentNeedsRefresh } from '../services/oss-account-document'

dotenv.config({ path: process.env.VOXFLAME_BACKEND_ENV_FILE || 'backend/.env' })
function required(key: string): string {
  const value = process.env[key]?.trim()
  if (!value) throw new Error('account_sync_configuration_missing')
  return value
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write')
  const client = new OSS({
    region: required('OSS_REGION'), bucket: required('OSS_BUCKET'), secure: true, timeout: 30_000,
    accessKeyId: required('OSS_ACCESS_KEY_ID'), accessKeySecret: required('OSS_ACCESS_KEY_SECRET'),
  })
  const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  // Complete Auth snapshot before touching objects. An outage must not erase valid contacts.
  const accounts = await fetchAuthAccountIdentities(db)
  const acl = await client.getBucketACL(required('OSS_BUCKET'))
  if (acl.acl !== 'private') throw new Error('account_sync_requires_private_bucket')
  const policy = await client.getBucketPolicy(required('OSS_BUCKET'))
  // Fail closed: custom policies require explicit review rather than assuming ACL overrides grants.
  if (policy.status !== 404 && policy.status !== 200) throw new Error('account_sync_policy_lookup_failed')
  if (policy.policy) throw new Error('account_sync_bucket_policy_requires_review')
  const owners = new Set<string>()
  let marker: string | undefined
  let objects = 0
  do {
    const page = await client.list({ marker, 'max-keys': 1000 }, {})
    for (const object of page.objects ?? []) {
      const owner = extractOssAccountKey(object.name)
      if (owner) owners.add(owner)
      objects += 1
    }
    if (page.isTruncated && !page.nextMarker) throw new Error('account_sync_incomplete_listing')
    marker = page.isTruncated ? page.nextMarker : undefined
  } while (marker)
  // Precompute and validate every destination before the first write.
  const planned = accountDocumentOwners(accounts, owners).map((owner) => ({
    path: ossAccountDocumentPath(owner), document: buildOssAccountDocument(owner, accounts.get(owner)),
  }))
  const counts: Record<string, number> = {}
  for (const row of planned) counts[row.document.identity_status] = (counts[row.document.identity_status] ?? 0) + 1
  console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', objects, ownerCount: planned.length, statuses: counts }))
  if (!write) return
  let verified = 0
  let unchanged = 0
  for (const row of planned) {
    let current: unknown = null
    try {
      const saved = await client.get(row.path)
      current = JSON.parse(saved.content.toString()) as unknown
    } catch (error: unknown) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'NoSuchKey')) throw error
    }
    const currentAcl = current ? await client.getACL(row.path) : null
    if (currentAcl?.acl === 'private' && !accountDocumentNeedsRefresh(current, row.document)) {
      unchanged += 1
      continue
    }
    await client.put(row.path, Buffer.from(JSON.stringify(row.document, null, 2) + '\n'), {
      headers: { 'x-oss-object-acl': 'private', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
    })
    const objectAcl = await client.getACL(row.path)
    if (objectAcl.acl !== 'private') throw new Error('account_sync_object_acl_verification_failed')
    const saved = await client.get(row.path)
    if (saved.content.toString() !== JSON.stringify(row.document, null, 2) + '\n') throw new Error('account_sync_readback_failed')
    verified += 1
  }
  console.log(JSON.stringify({ result: 'verified', accounts: verified, unchanged, contactValuesLogged: false }))
}
void main().catch(() => {
  // SDK errors can embed request headers and contact-bearing responses.
  console.error('OSS account mapping sync failed; no credentials or contact values logged. Check service health and private bucket configuration.')
  process.exitCode = 1
})
