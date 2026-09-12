import fs from 'fs/promises'
import path from 'path'
import dotenv from 'dotenv'
import { createClient, type User } from '@supabase/supabase-js'
import { resolveAsrAccountId } from '../src/services/asr-account-routing.service'

dotenv.config({ path: path.join(__dirname, '../.env') })

interface AuditExpectations {
  schema_version: number
  personalized_accounts: Record<string, string>
  fallback_model_version: string
}

interface GatewayAccount {
  account_id: string
  personalized: boolean
  default_model: string
}

interface GatewayAccountsResponse {
  accounts: GatewayAccount[]
  fallback: {
    model_version: string
  }
}

interface TranscriptionResponse {
  text: string
  account_id: string
  model_version: string
  personalized: boolean
  fallback: boolean
}

interface AuditedRoute {
  registered_user: string
  asr_account_id: string
  model_version: string
  personalized: boolean
  fallback: boolean
}

const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8001'
const DEFAULT_AUDIO_PATH = path.resolve(
  __dirname,
  '../../references/clear-vox-model/runtime/funasr_api/asr_example.wav',
)
const EXPECTATIONS_PATH = path.resolve(
  __dirname,
  '../config/asr-model-audit-expectations.json',
)

function requireNonEmpty(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new Error(`${name} is required`)
  }
  return normalized
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function maskEmail(email: string | undefined): string {
  const normalized = email?.trim().toLowerCase() ?? ''
  const [local = '', domain = ''] = normalized.split('@', 2)
  if (!local || !domain) {
    return '(email unavailable)'
  }

  const visiblePrefix = local.slice(0, 2)
  const visibleSuffix = local.length > 4 ? local.slice(-2) : ''
  return `${visiblePrefix}******${visibleSuffix}@${domain}`
}

function parseGatewayAccounts(value: unknown): GatewayAccountsResponse {
  assertCondition(typeof value === 'object' && value !== null, 'Invalid /accounts response')
  const candidate = value as Partial<GatewayAccountsResponse>
  assertCondition(Array.isArray(candidate.accounts), 'Invalid /accounts account list')
  assertCondition(
    typeof candidate.fallback?.model_version === 'string',
    'Invalid /accounts fallback model',
  )

  for (const account of candidate.accounts) {
    assertCondition(typeof account.account_id === 'string', 'Gateway account_id is missing')
    assertCondition(typeof account.default_model === 'string', 'Gateway default_model is missing')
    assertCondition(typeof account.personalized === 'boolean', 'Gateway personalized flag is missing')
  }

  return candidate as GatewayAccountsResponse
}

function parseTranscription(value: unknown): TranscriptionResponse {
  assertCondition(typeof value === 'object' && value !== null, 'Invalid transcription response')
  const candidate = value as Partial<TranscriptionResponse>
  assertCondition(typeof candidate.text === 'string' && candidate.text.trim(), 'Transcript text is missing')
  assertCondition(typeof candidate.account_id === 'string', 'Transcript account_id is missing')
  assertCondition(typeof candidate.model_version === 'string', 'Transcript model_version is missing')
  assertCondition(typeof candidate.personalized === 'boolean', 'Transcript personalized flag is missing')
  assertCondition(typeof candidate.fallback === 'boolean', 'Transcript fallback flag is missing')
  return candidate as TranscriptionResponse
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}: ${body.slice(0, 300)}`)
    }
    return JSON.parse(body) as unknown
  } finally {
    clearTimeout(timeout)
  }
}

async function listAllUsers(supabaseUrl: string, serviceRoleKey: string): Promise<User[]> {
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const users: User[] = []

  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      throw error
    }
    users.push(...data.users)
    if (data.users.length < 200) {
      return users
    }
  }
}

async function transcribe(
  gatewayUrl: string,
  accountId: string,
  audioBytes: Buffer,
): Promise<TranscriptionResponse> {
  const form = new FormData()
  form.append('audio', new Blob([audioBytes], { type: 'audio/wav' }), 'asr-model-audit.wav')
  form.append('language', 'Chinese')
  return parseTranscription(await fetchJson(`${gatewayUrl}/transcribe`, {
    method: 'POST',
    headers: { 'X-Account-ID': accountId },
    body: form,
  }))
}

async function main(): Promise<void> {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error(
      'Refusing to audit with NODE_TLS_REJECT_UNAUTHORIZED=0; unset it so Supabase TLS is verified',
    )
  }

  const supabaseUrl = requireNonEmpty(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    'SUPABASE_URL',
  )
  const serviceRoleKey = requireNonEmpty(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    'SUPABASE_SERVICE_ROLE_KEY',
  )
  const gatewayUrl = (process.env.ASR_MODEL_AUDIT_GATEWAY_URL || DEFAULT_GATEWAY_URL)
    .replace(/\/$/, '')
  const audioPath = path.resolve(process.env.ASR_MODEL_AUDIT_AUDIO || DEFAULT_AUDIO_PATH)

  const expectations = JSON.parse(
    await fs.readFile(EXPECTATIONS_PATH, 'utf8'),
  ) as AuditExpectations
  assertCondition(expectations.schema_version === 1, 'Unsupported ASR audit expectation schema')

  const [users, accountsValue, audioBytes] = await Promise.all([
    listAllUsers(supabaseUrl, serviceRoleKey),
    fetchJson(`${gatewayUrl}/accounts`),
    fs.readFile(audioPath),
  ])
  const gateway = parseGatewayAccounts(accountsValue)
  const gatewayByAccount = new Map(gateway.accounts.map((account) => [account.account_id, account]))
  const usersByAsrAccount = new Map<string, User>()
  for (const user of users) {
    const accountId = resolveAsrAccountId({ userId: user.id, email: user.email })
    if (accountId) {
      assertCondition(
        !usersByAsrAccount.has(accountId),
        `Multiple registered users resolve to ASR account ${accountId}`,
      )
      usersByAsrAccount.set(accountId, user)
    }
  }

  const expectedRoutes = Object.entries(expectations.personalized_accounts)
  const gatewayPersonalizedAccounts = gateway.accounts
    .filter((account) => account.personalized)
    .map((account) => account.account_id)
    .sort()
  assertCondition(
    JSON.stringify(gatewayPersonalizedAccounts) === JSON.stringify(expectedRoutes.map(([id]) => id).sort()),
    `Personalized gateway accounts differ from approved expectations: ${gatewayPersonalizedAccounts.join(', ')}`,
  )
  assertCondition(
    gateway.fallback.model_version === expectations.fallback_model_version,
    `Fallback model mismatch: expected ${expectations.fallback_model_version}, got ${gateway.fallback.model_version}`,
  )

  const auditedRoutes: AuditedRoute[] = []
  for (const [accountId, expectedModel] of expectedRoutes) {
    const user = usersByAsrAccount.get(accountId)
    assertCondition(user, `ASR account ${accountId} does not map to a registered Supabase user`)

    const declaredRoute = gatewayByAccount.get(accountId)
    assertCondition(declaredRoute, `ASR account ${accountId} is absent from the gateway registry`)
    assertCondition(declaredRoute.personalized, `ASR account ${accountId} is not marked personalized`)
    assertCondition(
      declaredRoute.default_model === expectedModel,
      `Registry model mismatch for ${accountId}: expected ${expectedModel}, got ${declaredRoute.default_model}`,
    )

    const result = await transcribe(gatewayUrl, accountId, audioBytes)
    assertCondition(result.account_id === accountId, `Response account mismatch for ${accountId}`)
    assertCondition(
      result.model_version === expectedModel,
      `Inference model mismatch for ${accountId}: expected ${expectedModel}, got ${result.model_version}`,
    )
    assertCondition(result.personalized, `Inference for ${accountId} was not personalized`)
    assertCondition(!result.fallback, `Inference for ${accountId} unexpectedly used fallback`)
    auditedRoutes.push({
      registered_user: maskEmail(user.email),
      asr_account_id: accountId,
      model_version: result.model_version,
      personalized: result.personalized,
      fallback: result.fallback,
    })
  }

  const fallbackAccountId = `voxflame-asr-audit-${Date.now()}`
  assertCondition(!usersByAsrAccount.has(fallbackAccountId), 'Generated fallback account unexpectedly exists')
  assertCondition(!gatewayByAccount.has(fallbackAccountId), 'Generated fallback account is explicitly registered')
  const fallbackResult = await transcribe(gatewayUrl, fallbackAccountId, audioBytes)
  assertCondition(fallbackResult.account_id === fallbackAccountId, 'Fallback response account mismatch')
  assertCondition(
    fallbackResult.model_version === expectations.fallback_model_version,
    `Fallback inference model mismatch: expected ${expectations.fallback_model_version}, got ${fallbackResult.model_version}`,
  )
  assertCondition(!fallbackResult.personalized, 'Unknown account unexpectedly used a personalized model')
  assertCondition(fallbackResult.fallback, 'Unknown account did not report fallback=true')

  const explicitPublicAccounts = gateway.accounts
    .filter((account) => !account.personalized)
    .map((account) => ({
      asr_account_id: account.account_id,
      registered_user: usersByAsrAccount.has(account.account_id),
      model_version: account.default_model,
    }))

  console.log(JSON.stringify({
    status: 'ok',
    registered_user_count: users.length,
    personalized_routes: auditedRoutes,
    unknown_account_fallback: {
      model_version: fallbackResult.model_version,
      personalized: fallbackResult.personalized,
      fallback: fallbackResult.fallback,
    },
    explicit_public_routes: explicitPublicAccounts,
  }, null, 2))
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[ASR account model audit] ${message}`)
  process.exitCode = 1
})
