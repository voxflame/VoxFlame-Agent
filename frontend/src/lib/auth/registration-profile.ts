import { normalizeDialectProfiles, validateDialectProfiles, type DialectProfile } from './dialect-profile'
import { normalizeMainlandPhone } from './phone'
import {
  TRAINING_ETIOLOGY_OPTIONS,
  type TrainingEtiology,
} from '@/lib/training/training-guidance-profile'

export const DISABILITY_CATEGORY_OPTIONS = [
  '言语残疾',
  '听力残疾',
  '肢体残疾',
  '视力残疾',
  '智力残疾',
  '精神残疾',
  '多重残疾',
  '其他',
] as const

export type IdentityDocumentType = 'disability_certificate' | 'id_card'

export interface RegistrationProfileInput {
  province: string
  city: string
  fullName: string
  phone: string
  disabilityCategory: string
  etiology: TrainingEtiology | ''
  hasDialect: boolean | null
  dialects: DialectProfile[]
  identityDocumentType: IdentityDocumentType
  identityDocumentNumber: string
}

export interface RegistrationProfileMetadata {
  full_name: string
  contact_phone: string
  province: string
  city: string
  disability_category: string
  condition: string
  etiology: TrainingEtiology
  has_dialect?: boolean
  dialect_name?: string
  dialect_profiles?: DialectProfile[]
  identity_document_type: IdentityDocumentType
  identity_document_number: string
  registration_profile_version: 2
}

function normalizeDocumentNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase()
}

function isValidMainlandIdCard(value: string): boolean {
  if (!/^\d{17}[\dX]$/.test(value)) return false

  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const total = weights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0)
  return checks[total % 11] === value[17]
}

export function validateRegistrationProfile(input: RegistrationProfileInput): string | null {
  if (!input.province.trim()) return '请输入省份'
  if (!input.city.trim()) return '请输入城市'
  if (input.fullName.trim().length < 2) return '请输入真实姓名'

  try {
    normalizeMainlandPhone(input.phone)
  } catch {
    return '请输入正确的中国大陆手机号'
  }

  if (!DISABILITY_CATEGORY_OPTIONS.includes(input.disabilityCategory as typeof DISABILITY_CATEGORY_OPTIONS[number])) {
    return '请选择残疾类别'
  }
  if (!TRAINING_ETIOLOGY_OPTIONS.some((option) => option.value === input.etiology)) {
    return '请选择病种'
  }
  if (input.hasDialect) {
    const dialectError = validateDialectProfiles(input.dialects)
    if (dialectError) return dialectError
  }

  const documentNumber = normalizeDocumentNumber(input.identityDocumentNumber)
  if (input.identityDocumentType === 'id_card' && !isValidMainlandIdCard(documentNumber)) {
    return '请输入正确的 18 位身份证号'
  }
  if (
    input.identityDocumentType === 'disability_certificate'
    && !/^\d{17}[\dX]\d{0,4}$/.test(documentNumber)
  ) {
    return '请输入正确的残疾证号'
  }

  return null
}

export function buildRegistrationProfileMetadata(
  input: RegistrationProfileInput,
): RegistrationProfileMetadata {
  const validationMessage = validateRegistrationProfile(input)
  if (validationMessage) throw new Error(validationMessage)

  const disabilityCategory = input.disabilityCategory.trim()
  return {
    full_name: input.fullName.trim(),
    contact_phone: normalizeMainlandPhone(input.phone),
    province: input.province.trim(),
    city: input.city.trim(),
    disability_category: disabilityCategory,
    condition: disabilityCategory,
    etiology: input.etiology as TrainingEtiology,
    ...(input.hasDialect !== null ? { has_dialect: input.hasDialect } : {}),
    ...(input.hasDialect !== null ? {
      dialect_profiles: input.hasDialect ? normalizeDialectProfiles(input.dialects) : [],
      // Legacy clients may consume a single name only; never concatenate a list.
      dialect_name: input.hasDialect && input.dialects.length === 1 ? input.dialects[0].name.trim() : '',
    } : {}),
    identity_document_type: input.identityDocumentType,
    identity_document_number: normalizeDocumentNumber(input.identityDocumentNumber),
    registration_profile_version: 2,
  }
}
