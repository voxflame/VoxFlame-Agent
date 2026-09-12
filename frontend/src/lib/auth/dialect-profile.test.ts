import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { readDialectProfiles, validateDialectProfiles } from './dialect-profile'
import { buildRegistrationProfileMetadata, type RegistrationProfileInput } from './registration-profile'

const dialects = [{ name: ' 四川话 ', region: ' 四川成都 ' }, { name: '粤语', region: '广东广州' }]
const profile: RegistrationProfileInput = {
  province: '广东省', city: '深圳市', fullName: '张三', phone: '13812345678',
  disabilityCategory: '言语残疾', etiology: 'unknown', hasDialect: true, dialects,
  identityDocumentType: 'id_card', identityDocumentNumber: '11010519491231002X',
}

test('multiple dialects retain their own origins, independent of residence', () => {
  const result = buildRegistrationProfileMetadata(profile)
  assert.equal(result.province, '广东省')
  assert.deepEqual(result.dialect_profiles, [{ name: '四川话', region: '四川成都' }, { name: '粤语', region: '广东广州' }])
  assert.equal(result.dialect_name, '')
})
test('skip, explicit no, and unknown region remain distinct', () => {
  assert.equal('dialect_profiles' in buildRegistrationProfileMetadata({ ...profile, hasDialect: null }), false)
  assert.deepEqual(buildRegistrationProfileMetadata({ ...profile, hasDialect: false }).dialect_profiles, [])
  assert.equal(buildRegistrationProfileMetadata({ ...profile, dialects: [{ name: '四川话', region: '' }] }).dialect_profiles?.[0].region, '')
})
test('validation bounds and duplicates', () => {
  assert.ok(validateDialectProfiles([]))
  assert.ok(validateDialectProfiles([{ name: ' ', region: '' }]))
  assert.ok(validateDialectProfiles([{ name: '四川话、粤语', region: '' }]))
  assert.ok(validateDialectProfiles(Array(9).fill({ name: '四川话', region: '' })))
  assert.ok(validateDialectProfiles([{ name: '四川话', region: '' }, { name: ' 四川话 ', region: '' }]))
  assert.ok(validateDialectProfiles([{ name: '字'.repeat(41), region: '' }]))
  assert.ok(validateDialectProfiles([{ name: '四川话', region: '字'.repeat(81) }]))
  assert.equal(validateDialectProfiles(dialects), null)
})
test('legacy lists split for explicit recording selection, no residence inference', () => {
  assert.deepEqual(readDialectProfiles({ has_dialect: true, dialect_name: '四川话、粤语' }), [{ name: '四川话', region: '' }, { name: '粤语', region: '' }])
  assert.deepEqual(readDialectProfiles({ has_dialect: true, dialect_name: '四川话', dialect_profiles: [] }), [])
  assert.deepEqual(readDialectProfiles({ has_dialect: false, dialect_profiles: dialects }), [])
  assert.deepEqual(readDialectProfiles(undefined), [])
})
test('mobile and web use identical dialect contract helpers', () => {
  assert.equal(readFileSync('../apps/mobile-workbench/src/auth/dialect-profile.ts', 'utf8'), readFileSync('src/lib/auth/dialect-profile.ts', 'utf8'))
})

test('mobile registration writes the same dialect list and skip semantics', async () => {
  const { buildMobileRegistrationProfileMetadata } = await import('../../../../apps/mobile-workbench/src/auth/registration-profile.ts')
  const mobile = buildMobileRegistrationProfileMetadata(profile)
  const web = buildRegistrationProfileMetadata(profile)
  assert.deepEqual(mobile, { ...web, registration_profile_version: '2' })
  assert.equal('dialect_profiles' in buildMobileRegistrationProfileMetadata({ ...profile, hasDialect: null }), false)
  assert.deepEqual(buildMobileRegistrationProfileMetadata({ ...profile, hasDialect: false }).dialect_profiles, [])
})
