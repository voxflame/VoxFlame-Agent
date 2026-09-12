import { normalizeDialectProfiles, validateDialectProfiles, type DialectProfile } from './dialect-profile'
export const MOBILE_DISABILITY_CATEGORY_OPTIONS = [
  '言语残疾',
  '听力残疾',
  '肢体残疾',
  '视力残疾',
  '智力残疾',
  '精神残疾',
  '多重残疾',
  '其他',
] as const

export const MOBILE_ETIOLOGY_OPTIONS = [
  ['unknown', '暂不确定'],
  ['stroke', '脑卒中'],
  ['parkinsons', '帕金森'],
  ['cerebral_palsy', '脑瘫'],
  ['brain_injury', '脑损伤'],
  ['hearing_loss', '听力相关'],
  ['neuromuscular', '神经肌肉'],
  ['other', '其他'],
] as const

export type MobileIdentityDocumentType = 'disability_certificate' | 'id_card'

export interface MobileRegistrationProfileInput {
  province: string
  city: string
  fullName: string
  phone: string
  disabilityCategory: string
  etiology: string
  hasDialect: boolean | null
  dialects: DialectProfile[]
  identityDocumentType: MobileIdentityDocumentType
  identityDocumentNumber: string
}

export type MobileRegistrationProfileMetadata = Record<string, string | boolean | DialectProfile[] | Record<string, string | boolean>>

function normalizeDocumentNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase()
}

function isValidIdCard(value: string): boolean {
  if (!/^\d{17}[\dX]$/.test(value)) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const total = weights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0)
  return checks[total % 11] === value[17]
}

export function validateMobileRegistrationProfile(input: MobileRegistrationProfileInput): string | null {
  if (!input.province.trim()) return '请输入省份'
  if (!input.city.trim()) return '请输入城市'
  if (input.fullName.trim().length < 2) return '请输入真实姓名'
  if (!/^1[3-9]\d{9}$/.test(input.phone.trim().replace(/[\s()-]/g, '').replace(/^\+?86/, ''))) {
    return '请输入正确的中国大陆手机号'
  }
  if (!MOBILE_DISABILITY_CATEGORY_OPTIONS.includes(input.disabilityCategory as typeof MOBILE_DISABILITY_CATEGORY_OPTIONS[number])) {
    return '请选择残疾类别'
  }
  if (!MOBILE_ETIOLOGY_OPTIONS.some(([value]) => value === input.etiology)) return '请选择病种'
  if (input.hasDialect) {
    const dialectError = validateDialectProfiles(input.dialects)
    if (dialectError) return dialectError
  }
  const documentNumber = normalizeDocumentNumber(input.identityDocumentNumber)
  if (input.identityDocumentType === 'id_card' && !isValidIdCard(documentNumber)) return '请输入正确的 18 位身份证号'
  if (input.identityDocumentType === 'disability_certificate' && !/^\d{17}[\dX]\d{0,4}$/.test(documentNumber)) {
    return '请输入正确的残疾证号'
  }
  return null
}

export function buildMobileRegistrationProfileMetadata(
  input: MobileRegistrationProfileInput,
): MobileRegistrationProfileMetadata {
  const error = validateMobileRegistrationProfile(input)
  if (error) throw new Error(error)
  const normalizedPhone = input.phone.trim().replace(/[\s()-]/g, '').replace(/^\+?86/, '')
  return {
    full_name: input.fullName.trim(),
    contact_phone: `+86${normalizedPhone}`,
    province: input.province.trim(),
    city: input.city.trim(),
    disability_category: input.disabilityCategory.trim(),
    condition: input.disabilityCategory.trim(),
    etiology: input.etiology,
    ...(input.hasDialect !== null ? { has_dialect: input.hasDialect } : {}),
    ...(input.hasDialect !== null ? {
      dialect_profiles: input.hasDialect ? normalizeDialectProfiles(input.dialects) : [],
      // Legacy clients may consume a single name only; never concatenate a list.
      dialect_name: input.hasDialect && input.dialects.length === 1 ? input.dialects[0].name.trim() : '',
    } : {}),
    identity_document_type: input.identityDocumentType,
    identity_document_number: normalizeDocumentNumber(input.identityDocumentNumber),
    registration_profile_version: '2',
  }
}
