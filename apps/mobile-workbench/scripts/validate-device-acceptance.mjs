import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const requiredFlows = [
  'login',
  'signed_out_quick_expression',
  'quick_expression_tts_copy_large_text',
  'assistant_rtc_voice_and_text',
  'rtc_cancel_and_quick_reconnect',
  'rtc_account_switch_and_unmount',
  'rtc_audio_route_and_interruption',
  'rtc_ten_utterances_capture_isolation',
  'training_home_eight_topics_and_modern_reading',
  'material_import_select_and_sentence_split',
  'record_review_confirm',
  'strict_replace_recording',
  'discard_local_and_uploaded_recording',
  'scene_template_selection',
  'custom_hotword_crud',
  'profile_material_phrase_crud',
  'offline_recording_and_retry',
]

const resultPath = process.argv[2]
if (!resultPath) {
  console.error('usage: npm run validate:device-acceptance -- <android-or-ios-result.json>')
  process.exit(1)
}

const absolutePath = path.resolve(resultPath)
if (!existsSync(absolutePath)) {
  console.error(`device acceptance result not found: ${absolutePath}`)
  process.exit(1)
}

const result = JSON.parse(readFileSync(absolutePath, 'utf8'))
const failures = []
if (result.platform !== 'android' && result.platform !== 'ios') failures.push('platform must be android or ios')
for (const field of ['device_model', 'os_version', 'app_version', 'build_number', 'tested_at', 'tester_id']) {
  if (typeof result[field] !== 'string' || !result[field].trim()) failures.push(`${field} is required`)
}
if (!Array.isArray(result.flows)) failures.push('flows must be an array')

for (const id of requiredFlows) {
  const flow = Array.isArray(result.flows) ? result.flows.find((entry) => entry?.id === id) : undefined
  if (!flow) {
    failures.push(`missing flow: ${id}`)
    continue
  }
  if (!['pass', 'conditional', 'fail'].includes(flow.status)) failures.push(`${id}: invalid status`)
  if (typeof flow.evidence !== 'string' || !flow.evidence.trim()) failures.push(`${id}: evidence is required`)
  if (flow.status === 'conditional' && (typeof flow.issue !== 'string' || !flow.issue.trim())) {
    failures.push(`${id}: conditional result requires issue`)
  }
  if (flow.status === 'conditional') failures.push(`${id}: conditional is not acceptance; resolve the issue and retest`)
  if (flow.status === 'fail') failures.push(`${id}: failed`)
}

if (failures.length > 0) {
  console.error('mobile device acceptance failed')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`mobile ${result.platform} full-flow acceptance passed`)
console.log(`device: ${result.device_model} / ${result.os_version}`)
console.log(`app: ${result.app_version} (${result.build_number})`)
console.log(`flows: ${requiredFlows.length}`)
