export const MOBILE_LEGAL_CONSENT_VERSION = '2026-09-06'

export interface MobileLegalConsentMetadata {
  legal_consent: {
    privacy_accepted: true
    sensitive_data_accepted: true
    data_collection_accepted: true
    commercial_use_accepted: true
    accepted_at: string
    version: string
  }
}

export function buildMobileLegalConsentMetadata(): MobileLegalConsentMetadata {
  return {
    legal_consent: {
      privacy_accepted: true,
      sensitive_data_accepted: true,
      data_collection_accepted: true,
      commercial_use_accepted: true,
      accepted_at: new Date().toISOString(),
      version: MOBILE_LEGAL_CONSENT_VERSION,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Mirror the backend gate so a user cannot record a batch that cannot upload. */
export function hasCurrentMobileLegalConsent(userMetadata: unknown): boolean {
  const metadata = isRecord(userMetadata) ? userMetadata : {}
  const consent = isRecord(metadata.legal_consent) ? metadata.legal_consent : {}
  const acceptedAt = typeof consent.accepted_at === 'string'
    ? Date.parse(consent.accepted_at)
    : Number.NaN

  return (
    consent.version === MOBILE_LEGAL_CONSENT_VERSION
    && Number.isFinite(acceptedAt)
    && consent.privacy_accepted === true
    && consent.sensitive_data_accepted === true
    && consent.data_collection_accepted === true
    && consent.commercial_use_accepted === true
  )
}
