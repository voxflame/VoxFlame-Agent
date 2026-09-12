import assert from 'node:assert/strict'
import test from 'node:test'

import { getSiteBrand } from './site-branding'

test('collection branding has safe defaults and supports an external logo path', () => {
  const previousMode = process.env.NEXT_PUBLIC_VOXFLAME_SITE_MODE
  const previousLogo = process.env.NEXT_PUBLIC_VOXFLAME_BRAND_LOGO_URL
  const previousName = process.env.NEXT_PUBLIC_VOXFLAME_BRAND_NAME
  const previousEnglishName = process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ENGLISH_NAME
  process.env.NEXT_PUBLIC_VOXFLAME_SITE_MODE = 'collection'
  process.env.NEXT_PUBLIC_VOXFLAME_BRAND_LOGO_URL = '/brands/partner.svg'
  delete process.env.NEXT_PUBLIC_VOXFLAME_BRAND_NAME
  delete process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ENGLISH_NAME
  const brand = getSiteBrand()
  assert.equal(brand.isCollectionSite, true)
  assert.equal(brand.name, '语音共建平台')
  assert.equal(brand.englishName, '')
  assert.equal(brand.logoUrl, '/brands/partner.svg')
  if (previousMode === undefined) delete process.env.NEXT_PUBLIC_VOXFLAME_SITE_MODE
  else process.env.NEXT_PUBLIC_VOXFLAME_SITE_MODE = previousMode
  if (previousLogo === undefined) delete process.env.NEXT_PUBLIC_VOXFLAME_BRAND_LOGO_URL
  else process.env.NEXT_PUBLIC_VOXFLAME_BRAND_LOGO_URL = previousLogo
  if (previousName === undefined) delete process.env.NEXT_PUBLIC_VOXFLAME_BRAND_NAME
  else process.env.NEXT_PUBLIC_VOXFLAME_BRAND_NAME = previousName
  if (previousEnglishName === undefined) delete process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ENGLISH_NAME
  else process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ENGLISH_NAME = previousEnglishName
})

test('invalid custom accent falls back to the safe default', () => {
  const previousAccent = process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ACCENT
  process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ACCENT = 'red; background: black'
  assert.equal(getSiteBrand().accentColor, '#C65D2E')
  if (previousAccent === undefined) delete process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ACCENT
  else process.env.NEXT_PUBLIC_VOXFLAME_BRAND_ACCENT = previousAccent
})
