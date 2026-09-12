export interface MobileBranding {
  name: string
  mark: string
  accentColor: string
}

function validHexColor(value: string | undefined): string {
  const normalized = value?.trim()
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : '#C65D2E'
}

export function getMobileBranding(configuredAppName?: string | null): MobileBranding {
  const configuredName = process.env.EXPO_PUBLIC_APP_BRAND_NAME
  const name = typeof configuredName === 'string' && configuredName.trim()
    ? configuredName.trim()
    : configuredAppName?.trim() || '语音助手'
  const [mark = 'V'] = [...name]
  return {
    name,
    mark,
    accentColor: validHexColor(process.env.EXPO_PUBLIC_APP_BRAND_ACCENT),
  }
}
