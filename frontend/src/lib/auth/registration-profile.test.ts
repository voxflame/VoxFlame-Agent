import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRegistrationProfileMetadata,
  validateRegistrationProfile,
  type RegistrationProfileInput,
} from './registration-profile.ts'

const validProfile: RegistrationProfileInput = {
  province: '广东省',
  city: '广州市',
  fullName: '张三',
  phone: '138 1234 5678',
  disabilityCategory: '言语残疾',
  etiology: 'stroke',
  hasDialect: true,
  dialects: [{ name: '粤语', region: '广东广州' }],
  identityDocumentType: 'id_card',
  identityDocumentNumber: '11010519491231002X',
}

test('registration profile builds normalized metadata for a new account', () => {
  assert.deepEqual(buildRegistrationProfileMetadata(validProfile), {
    full_name: '张三',
    contact_phone: '+8613812345678',
    province: '广东省',
    city: '广州市',
    disability_category: '言语残疾',
    condition: '言语残疾',
    etiology: 'stroke',
    has_dialect: true,
    dialect_name: '粤语',
    dialect_profiles: [{ name: '粤语', region: '广东广州' }],
    identity_document_type: 'id_card',
    identity_document_number: '11010519491231002X',
    registration_profile_version: 2,
  })
})

test('registration profile rejects missing fields and invalid documents', () => {
  assert.equal(validateRegistrationProfile({ ...validProfile, province: '' }), '请输入省份')
  assert.equal(
    validateRegistrationProfile({ ...validProfile, identityDocumentNumber: '110105194912310021' }),
    '请输入正确的 18 位身份证号',
  )
})

test('registration profile accepts a disability certificate number', () => {
  assert.equal(validateRegistrationProfile({
    ...validProfile,
    identityDocumentType: 'disability_certificate',
    identityDocumentNumber: '11010519491231002X12',
  }), null)
})

test('registration profile allows dialect information to be skipped', () => {
  const metadata = buildRegistrationProfileMetadata({
    ...validProfile,
    hasDialect: null,
    dialects: [],
  })

  assert.equal('has_dialect' in metadata, false)
  assert.equal('dialect_name' in metadata, false)
})
