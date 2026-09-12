function pathSegments(path: string): string[] | null {
  const normalized = path.trim()
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.includes('\\')
    || normalized.includes('?')
    || normalized.includes('#')
  ) return null

  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return segments
}

/** Keep every signed, completed, or discarded object inside the authenticated account prefix. */
export function uploadPathBelongsToContributor(
  path: unknown,
  contributorId: string,
): path is string {
  if (typeof path !== 'string' || !contributorId.trim()) return false
  const segments = pathSegments(path)
  if (!segments) return false

  if (segments[0] === 'dataset') {
    return segments.length >= 4 && segments[1] === contributorId
  }

  if (segments[0] === 'supervised' && segments[1] === 'mandarin') {
    return segments.length >= 5 && segments[3] === contributorId
  }

  if (segments[0] === 'weak-supervision' && segments[1] === 'dialogue') {
    return segments.length >= 5 && segments[2] === contributorId
  }

  return false
}
