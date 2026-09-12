import assert from 'node:assert/strict'
import { readRecordingDialect } from './quality-review.service'
import { sanitizeUploadMetadata } from './upload-artifact.service'

assert.deepEqual(readRecordingDialect({ speech_variant: 'mandarin', dialect_name_user_reported: '四川话', dialect_region: '四川成都' }), { dialectName: null, dialectRegion: null })
assert.deepEqual(readRecordingDialect({ dialect_name_user_reported: '四川话' }), { dialectName: null, dialectRegion: null })
assert.deepEqual(readRecordingDialect({ speech_variant: 'dialect', dialect_name_user_reported: '四川话' }), { dialectName: null, dialectRegion: null })
assert.deepEqual(readRecordingDialect({ speech_variant: 'dialect', dialect_name: '四川话', dialect_region: '四川成都' }), { dialectName: '四川话', dialectRegion: '四川成都' })
assert.deepEqual(sanitizeUploadMetadata({ dialect_name: '四川话', dialect_region: '四川成都', province: '广东', city: '深圳', dialect_profiles: [{ name: '粤语', region: '广东广州' }] }), { dialect_name: '四川话', dialect_region: '四川成都' })
console.log('quality review dialect isolation tests passed')
