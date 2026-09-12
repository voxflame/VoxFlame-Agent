export type VoxFlameSiteMode = 'main' | 'collection'

export interface VoxFlameSiteBrand {
  mode: VoxFlameSiteMode
  name: string
  englishName: string
  tagline: string
  logoUrl: string | null
  accentColor: string
  origin: string
  isCollectionSite: boolean
}

const DEFAULT_MAIN_ORIGIN = 'https://voxember.com'

function validAccentColor(value: string | undefined): string {
  const normalized = value?.trim()
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : '#C65D2E'
}

function siteMode(value: string | undefined): VoxFlameSiteMode {
  return value?.trim().toLowerCase() === 'collection' ? 'collection' : 'main'
}

export function getSiteBrand(): VoxFlameSiteBrand {
  const mode = siteMode(process.env.NEXT_PUBLIC_VOXFLAME_SITE_MODE)
  const isCollectionSite = mode === 'collection'
  return {
    mode,
    name: process.env.NEXT_PUBLIC_VOXFLAME_BRAND_NAME?.trim() || (isCollectionSite ? '语音共建平台' : '燃言'),
    englishName: process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ENGLISH_NAME?.trim() || (isCollectionSite ? '' : 'VoxFlame'),
    tagline: process.env.NEXT_PUBLIC_VOXFLAME_BRAND_TAGLINE?.trim() || (isCollectionSite ? '每一段真实表达，都让理解更进一步' : '让每个声音都被听见'),
    logoUrl: process.env.NEXT_PUBLIC_VOXFLAME_BRAND_LOGO_URL?.trim() || null,
    accentColor: validAccentColor(process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ACCENT),
    origin: process.env.VOXFLAME_PUBLIC_BASE_URL?.trim() || DEFAULT_MAIN_ORIGIN,
    isCollectionSite,
  }
}
