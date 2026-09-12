/** User-reported language background, never an inferred recording label. */
export interface DialectProfile {
  name: string
  region: string
}

export const MAX_DIALECTS = 8

export function validateDialectProfiles(dialects: DialectProfile[]): string | null {
  if (!dialects.length) return '请添加至少一种方言，或选择暂不填写'
  if (dialects.length > MAX_DIALECTS) return '最多填写 8 种方言'
  const seen = new Set<string>()
  for (const dialect of dialects) {
    if (!dialect.name.trim()) return '请填写每种方言的名称'
    if (/[、,，;；\n]/.test(dialect.name)) return '每行只填一种方言，多种请点击添加'
    if (dialect.name.trim().length > 40 || dialect.region.trim().length > 80) return '方言名称最多 40 字，来源地区最多 80 字'
    const key = JSON.stringify([dialect.name.trim(), dialect.region.trim()])
    if (seen.has(key)) return '同一种方言和来源地区无需重复填写'
    seen.add(key)
  }
  return null
}

export function normalizeDialectProfiles(dialects: DialectProfile[]): DialectProfile[] {
  return dialects.map(({ name, region }) => ({ name: name.trim(), region: region.trim() }))
}

/** Read-only compat for pre-list profiles; retire after legacy clients/data are migrated.
 * An explicit empty list wins. Never infer dialect origin from residence.
 */
export function readDialectProfiles(profile: {
  has_dialect?: boolean
  dialect_profiles?: DialectProfile[] | null
  dialect_name?: string | null
} | null | undefined): DialectProfile[] {
  if (!profile?.has_dialect) return []
  const candidates = Array.isArray(profile.dialect_profiles)
    ? profile.dialect_profiles
    : (profile.dialect_name ?? '').split(/[、,，;；\n]+/).map((name) => ({ name, region: '' }))
  const seen = new Set<string>()
  return candidates.flatMap((entry) => {
    if (!entry || typeof entry.name !== 'string') return []
    const name = entry.name.trim().slice(0, 40)
    const region = typeof entry.region === 'string' ? entry.region.trim().slice(0, 80) : ''
    const key = JSON.stringify([name, region])
    if (!name || seen.has(key)) return []
    seen.add(key)
    return [{ name, region }]
  }).slice(0, MAX_DIALECTS)
}
