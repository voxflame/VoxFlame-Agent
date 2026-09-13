import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(appRoot, '../..')

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(appRoot, relativePath), 'utf8'))
}

function walkFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.expo') {
      continue
    }

    const absolute = path.join(dir, entry)
    const stat = statSync(absolute)
    if (stat.isDirectory()) {
      files.push(...walkFiles(absolute))
      continue
    }

    files.push(absolute)
  }

  return files
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const packageJson = readJson('package.json')
const appJson = readJson('app.json')
const mobileConfigSource = readFileSync(
  path.join(appRoot, 'src/api/mobile-config.ts'),
  'utf8',
)
const androidReleaseScript = readFileSync(
  path.join(repoRoot, 'scripts/release-android-preview.sh'),
  'utf8',
)
const androidPublisherScript = readFileSync(
  path.join(repoRoot, 'scripts/publish-android-artifact.sh'),
  'utf8',
)
const downloadPageSource = readFileSync(
  path.join(repoRoot, 'frontend/src/app/download/page.tsx'),
  'utf8',
)
const composeSource = readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8')
const caddySource = readFileSync(path.join(repoRoot, 'infra/caddy/Caddyfile'), 'utf8')
const sourceFiles = walkFiles(appRoot).filter((file) => (
  file.endsWith('.ts')
  || file.endsWith('.tsx')
  || file.endsWith('.json')
  || file.endsWith('.md')
))
const sourceText = sourceFiles
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

const rawUserErrorPatterns = [
  /set(?:ErrorMessage|LocalError|BindingMessage)\([^)]*\.message/,
  /return\s+error\.message/,
  /readiness\.blockers\.join/,
]

for (const pattern of rawUserErrorPatterns) {
  assert(!pattern.test(sourceText), `raw user error pattern found: ${pattern}`)
}

assert(packageJson.name === '@voxflame/mobile-workbench', 'package name must stay scoped to mobile workbench')
assert(packageJson.version === appJson.expo?.version, 'package and Expo versions must match')
assert(packageJson.dependencies?.['@react-native-async-storage/async-storage'] === '2.2.0', 'AsyncStorage must stay on the Expo SDK 55 compatible version')
assert(packageJson.dependencies?.['expo-document-picker'], 'Expo document picker is required for native material import')
assert(packageJson.scripts?.check === 'node scripts/check-mobile-workbench.mjs', 'mobile check script is missing')
assert(packageJson.scripts?.['test:communication'] === 'node scripts/test-mobile-quick-expression.mjs', 'mobile communication regression script is missing')
assert(packageJson.scripts?.['test:branding'] === 'node scripts/test-mobile-branding.mjs', 'mobile branding regression script is missing')
assert(packageJson.scripts?.['test:training']?.includes('test-mobile-training-feedback.mjs'), 'mobile training feedback regression is missing')
assert(packageJson.scripts?.['test:training']?.includes('test-mobile-attempt-confirmation.mjs'), 'mobile attempt confirmation regression is missing')
assert(packageJson.scripts?.['test:training']?.includes('test-mobile-collection-controls.mjs'), 'mobile collection control regression is missing')
assert(packageJson.scripts?.['test:memory']?.includes('test-mobile-memory-editor.mjs'), 'mobile memory regression is missing')
assert(packageJson.scripts?.['test:memory']?.includes('test-mobile-memory-account-scope.mjs'), 'mobile memory account isolation regression is missing')
assert(sourceText.includes('confirmMobileTrainingAttempt'), 'recordings must wait for explicit confirmation before upload')
assert(sourceText.includes('replaceMobileTrainingAttempt'), 'strict recording replacement orchestration is missing')
assert(packageJson.scripts?.web === undefined, 'web script must stay disabled until web dependencies are explicit')
assert(packageJson.scripts?.['export:android'] === 'expo export --platform android', 'android export smoke script is missing')
assert(packageJson.scripts?.['export:ios'] === 'expo export --platform ios', 'ios export smoke script is missing')
assert(packageJson.scripts?.['eas:login']?.endsWith('npx --yes eas-cli@latest login --no-browser'), 'EAS login must use SSH-safe terminal authentication')
assert(packageJson.scripts?.['eas:save-token'] === 'bash scripts/save-expo-token.sh', 'persistent Expo token setup script is missing')
assert(packageJson.scripts?.['eas:whoami']?.endsWith('npx --yes eas-cli@latest whoami'), 'EAS account check must use the eas-cli package')
assert(packageJson.scripts?.['eas:init']?.includes('eas-cli@latest init --force --non-interactive'), 'EAS project init script is missing')
assert(packageJson.scripts?.['eas:configure']?.endsWith('node scripts/configure-eas-project.mjs'), 'EAS environment setup script is missing')
assert(packageJson.scripts?.['eas:credentials:ios']?.endsWith('eas-cli@latest credentials --platform ios'), 'interactive iOS credentials setup script is missing')
assert(packageJson.scripts?.['build:android:development']?.includes('--platform android'), 'android development build script is missing')
assert(packageJson.scripts?.['build:ios:development']?.includes('--platform ios'), 'ios development build script is missing')
assert(packageJson.scripts?.['build:android:preview']?.includes('--platform android'), 'android preview build script is missing')
assert(packageJson.scripts?.['release:android:preview'] === 'bash ../../scripts/release-android-preview.sh', 'android website release script is missing')
assert(packageJson.scripts?.['sync:android:latest'] === 'bash ../../scripts/release-android-preview.sh publish-latest', 'android website artifact recovery script is missing')
assert(androidReleaseScript.includes('eas-cli@latest build'), 'android website release must run EAS Build')
assert(androidReleaseScript.includes('VoxFlame-Android.apk'), 'android website release must publish the stable APK name')
assert(androidPublisherScript.includes('VoxFlame-Android.previous.apk'), 'android website publisher must retain a rollback APK')
assert(androidReleaseScript.includes('Direct Android publication retired'), 'artifact builder must not own website publication')
assert(!androidReleaseScript.includes('docker compose'), 'artifact builder must not deploy infrastructure')
assert(downloadPageSource.includes("siteBrand.isCollectionSite ? '' : '/download/android'"), 'main website Android download must keep the permanent first-party URL')
assert(composeSource.includes('NEXT_PUBLIC_VOXFLAME_COLLECTION_ANDROID_APP_DOWNLOAD_URL'), 'collection site must use its own Android package URL')
assert(!caddySource.slice(caddySource.indexOf('# 第二品牌站')).includes('VoxFlame-Android.apk'), 'collection site must not serve the VoxFlame APK')
assert(composeSource.includes('VOXFLAME_ANDROID_RELEASE_DIR:-./releases/android'), 'Caddy must mount the configurable Android release directory')
assert(caddySource.includes('handle /download/android'), 'Caddy must own the permanent Android download route')
assert(packageJson.scripts?.['build:ios:preview']?.includes('--platform ios'), 'ios preview build script is missing')
for (const [scriptName, scriptValue] of Object.entries(packageJson.scripts ?? {})) {
  if (
    (scriptName.startsWith('build:') || scriptName.startsWith('eas:'))
    && scriptValue.includes('eas-cli@latest')
  ) {
    assert(!scriptValue.includes('npx eas '), `${scriptName} must not resolve the wrong npm package named eas`)
    const sanitizesEnvironment = scriptValue.includes('scripts/with-expo-token.sh') || (
      scriptValue.includes('-u HTTP_PROXY -u HTTPS_PROXY')
      && scriptValue.includes('-u NODE_TLS_REJECT_UNAUTHORIZED')
    )
    assert(sanitizesEnvironment, `${scriptName} must load persistent authentication and restore safe network settings`)
  }
}
assert(packageJson.scripts?.['smoke:real-workspace'] === 'node scripts/smoke-real-workspace.mjs', 'real workspace smoke script is missing')
assert(packageJson.scripts?.['smoke:device-env'] === 'node scripts/smoke-device-env.mjs', 'device env smoke script is missing')
assert(packageJson.scripts?.['validate:device-acceptance'] === 'node scripts/validate-device-acceptance.mjs', 'full device acceptance validator is missing')
assert(appJson.expo?.slug === 'voxflame-mobile-workbench', 'expo slug must be stable')
assert(appJson.expo?.owner === 'qiuds-team', 'Expo owner must stay on the qiuds-team account')
assert(appJson.expo?.extra?.rtcSurface === 'mobile_workbench', 'expo extra.rtcSurface must be mobile_workbench')
assert(appJson.expo?.icon, 'shared app icon is required')
assert(appJson.expo?.ios?.bundleIdentifier === 'org.voxflame.mobileworkbench', 'iOS bundle identifier must stay stable')
assert(appJson.expo?.ios?.infoPlist?.NSMicrophoneUsageDescription, 'iOS microphone purpose string is required')
assert(appJson.expo?.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false, 'iOS export-compliance declaration is required')
assert(appJson.expo?.android?.package === 'org.voxflame.mobileworkbench', 'Android package must stay stable')
assert(appJson.expo?.android?.adaptiveIcon?.foregroundImage, 'Android adaptive icon is required')
assert(Number.isInteger(appJson.expo?.android?.versionCode), 'Android versionCode is required')
assert(typeof appJson.expo?.ios?.buildNumber === 'string', 'iOS buildNumber is required')
for (const publicEnvName of [
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_PHONE_AUTH_ENABLED',
]) {
  assert(
    mobileConfigSource.includes(`process.env.${publicEnvName}`),
    `${publicEnvName} must use Expo-compatible static property access`,
  )
}
const mobileBrandingSource = readFileSync(
  path.join(appRoot, 'src/config/mobile-branding.ts'),
  'utf8',
)
for (const publicBrandEnvName of [
  'EXPO_PUBLIC_APP_BRAND_NAME',
  'EXPO_PUBLIC_APP_BRAND_ACCENT',
]) {
  assert(
    mobileBrandingSource.includes(`process.env.${publicBrandEnvName}`),
    `${publicBrandEnvName} must use Expo-compatible static property access`,
  )
}
assert(!sourceText.includes('VoxFlame 用户'), 'user-visible account fallback must use mobile branding')
assert(!sourceText.includes('VoxFlame 账户'), 'user-visible account label must use mobile branding')
assert(
  !mobileConfigSource.includes('process?.env?.[name]')
  && !mobileConfigSource.includes('process.env[name]'),
  'dynamic Expo public env access must not return to release builds',
)

const plugins = JSON.stringify(appJson.expo?.plugins ?? [])
assert(plugins.includes('@livekit/react-native-expo-plugin'), 'LiveKit Expo plugin must be configured')
assert(plugins.includes('@config-plugins/react-native-webrtc'), 'react-native-webrtc config plugin must be configured')

const androidPermissions = appJson.expo?.android?.permissions ?? []
assert(androidPermissions.includes('android.permission.RECORD_AUDIO'), 'Android RECORD_AUDIO permission is required')
assert(androidPermissions.includes('android.permission.MODIFY_AUDIO_SETTINGS'), 'Android audio settings permission is required')
for (const requiredAudioPermission of [
  'android.permission.WAKE_LOCK',
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  'android.permission.BLUETOOTH_CONNECT',
]) {
  assert(androidPermissions.includes(requiredAudioPermission), `required Android audio permission missing: ${requiredAudioPermission}`)
}
const blockedAndroidPermissions = appJson.expo?.android?.blockedPermissions ?? []
for (const blockedPermission of [
  'android.permission.CAMERA',
  'android.permission.SYSTEM_ALERT_WINDOW',
]) {
  assert(blockedAndroidPermissions.includes(blockedPermission), `Android permission must stay blocked: ${blockedPermission}`)
}
for (const requiredAudioPermission of [
  'android.permission.WAKE_LOCK',
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  'android.permission.BLUETOOTH_CONNECT',
]) {
  assert(!blockedAndroidPermissions.includes(requiredAudioPermission), `required Android audio permission must not be blocked: ${requiredAudioPermission}`)
}
assert(sourceText.includes('PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT'), 'Android 12+ Bluetooth audio permission request is missing')

for (const requiredFile of [
  'src/auth/mobile-supabase-client.ts',
  'src/auth/use-mobile-auth.ts',
  'src/communication/quick-expression.ts',
  'src/workspace/use-mobile-workspace.ts',
  'src/api/mobile-upload-client.ts',
  'src/realtime/use-mobile-rtc-session.ts',
  'src/realtime/use-livekit-room-connection.ts',
  'src/training/training-catalog.ts',
  'src/training/use-mobile-training-catalog.ts',
  'src/diagnostics/use-mobile-diagnostics.ts',
  'src/queue/native-recorder-storage.ts',
  'src/queue/use-native-recorder-queue.ts',
  'scripts/smoke-device-env.mjs',
  'scripts/configure-eas-project.mjs',
  'scripts/save-expo-token.sh',
  'scripts/with-expo-token.sh',
  'scripts/test-mobile-training-feedback.mjs',
  'scripts/test-mobile-collection-controls.mjs',
  'scripts/test-mobile-quick-expression.mjs',
]) {
  assert(existsSync(path.join(appRoot, requiredFile)), `missing required mobile file: ${requiredFile}`)
}

for (const requiredToken of [
  'useAudioRecorder',
  'AudioModule.requestRecordingPermissionsAsync',
  'Paths.document',
  'voxflame-recorder-queue',
  "captureTransport: 'native_recorder'",
  '/upload/sign',
  '/upload/complete',
  '/upload/contribution',
  'uploadReceipt',
  '/rtc/session/start',
  'participantToken',
  'registerGlobals',
  'createNativeAudioLeases(AudioSession)',
  'audio.startAudioSession()',
  'audio.stopAudioSession()',
  'setMicrophoneEnabled',
  'RoomEvent.DataReceived',
  'speech_activity',
  'client_capture_id',
  'end_audio',
  'latestAssistantTranscript',
  'expo-speech',
  'expo-clipboard',
  'expo-document-picker',
  'copyToCacheDirectory: true',
  'new File(asset.uri).text()',
  'source: materialSource',
  '/training/catalog',
  "training_flow: flow",
  'characterEditDistance',
  "flow === 'collection' ? <View style={styles.customPracticePanel}",
  'sentenceId: captureExercise.id',
  'recognizedText: item.recognizedText',
  'understandsConsent: consentReady',
  '我同意本次录音用于训练',
  'MOBILE_COLLECTION_PLANS',
  'collection_plan_id: flow === \'collection\' ? collectionPlanId : undefined',
  'reading_assistance_used: readingAssistanceKeysRef.current.has(readingAssistanceKey)',
  'speechVariant: capture.speechVariant',
  'utterancePairId: capture.utterancePairId',
  "label={isReadingAssistancePlaying ? '正在朗读' : '听一下'}",
  '/prepared-expressions/active',
  '/profile-memory',
  '/scene-templates',
  '/memory/hotwords',
  '/phrases/user/',
  'EXPO_PUBLIC_API_BASE_URL',
  '/mobile/diagnostics',
  'MAX_QUEUED_REPORTS',
  'manual_diagnostic_report',
]) {
  assert(sourceText.includes(requiredToken), `missing recorder queue token: ${requiredToken}`)
}

for (const surface of ['communication', 'practice', 'memory', 'device']) {
  assert(sourceText.includes(`'${surface}'`), `missing mobile surface: ${surface}`)
}

const appSource = readFileSync(path.join(appRoot, 'App.tsx'), 'utf8')
for (const taskRoute of [
  'communication_home',
  'communication_quick',
  'communication_setup',
  'communication_live',
  'practice_home',
  'practice_materials',
  'practice_readings',
  'assessment',
  'collection',
]) {
  assert(appSource.includes(`'${taskRoute}'`), `missing mobile task route: ${taskRoute}`)
}
assert(!appSource.includes("| 'material'\n"), 'custom material must not return as a top-level mobile task route')
assert(appSource.includes("type MobileCollectionSource = 'catalog' | 'prepared_material'"), 'data entry must own catalog and custom-material sources')
assert(appSource.includes('collectionControlState.navigationDisabled'), 'sentence navigation must stay behind recording preflight')
assert(appSource.includes("只需确认一次，本组录音期间保持有效。"), 'recording preflight must remain next to the main action')
assert(!appSource.includes("Alert.alert('先完成采集前确认'"), 'hidden preflight must not fall back to an alert-only dead end')
assert(appSource.includes('mainScrollRef.current?.scrollTo({ animated: false, y: 0 })'), 'task route changes must reset the shared mobile scroll position')
// Retain main's layout guard while using the current Mandarin/dialect target.
const targetIndex = appSource.indexOf('<Text style={styles.trainingTarget}>{activeTargetText}</Text>')
const preflightIndex = appSource.indexOf('<View style={styles.preflightPanel}>', targetIndex)
const recordingActionIndex = appSource.indexOf('<PrimaryButton', preflightIndex)
assert(targetIndex >= 0 && preflightIndex > targetIndex && recordingActionIndex > preflightIndex, 'recording preflight must render between the target sentence and primary recording action')
const preflightSource = appSource.slice(preflightIndex, recordingActionIndex)
for (const checkedState of ['environmentReady', 'distanceReady', 'consentReady']) {
  const checkbox = preflightSource.match(new RegExp(`<Pressable\\b[^>]*accessibilityState=\\{\\{ checked: ${checkedState},[^>]*>`))?.[0]
  assert(checkbox?.includes('accessibilityLabel='), `${checkedState} preflight must have an accessible name`)
  assert(checkbox?.includes('disabled: queue.isRecording || attemptLocked'), `${checkedState} must announce its locked state`)
  assert(checkbox?.includes('disabled={queue.isRecording || attemptLocked}'), `${checkedState} must stay locked during recording and attempt confirmation`)
}
for (const taskScreen of [
  'function CommunicationHomeScreen',
  'function QuickExpressionScreen',
  'function CommunicationSetupScreen',
  'function CommunicationScreen',
  'function PracticeHomeScreen',
  'function PracticeMaterialAreasScreen',
  'function PracticeReadingArticlesScreen',
  'function PracticeScreen',
]) {
  assert(appSource.includes(taskScreen), `missing separated mobile task screen: ${taskScreen}`)
}
assert(appSource.includes('不连接助手，也不上传声音'), 'quick expression must disclose its local-only boundary')
assert(appSource.includes('onOpenQuickExpression'), 'signed-out users must be able to open quick expression')
for (const practiceHomeToken of [
  '用自己的材料',
  '选择已有材料',
  '9 个材料区',
  '完整文章',
  'readingArticles',
]) {
  assert(appSource.includes(practiceHomeToken), `mobile practice home is missing: ${practiceHomeToken}`)
}

assert(!sourceText.includes(`from '@/`), 'Metro runtime must not depend on tsconfig-only @ alias imports')

for (const forbidden of [
  `mobile_${'companion'}`,
  'LIVEKIT_API_SECRET',
  'SUPABASE_SERVICE_ROLE',
  'DASHSCOPE_API_KEY',
]) {
  assert(!sourceText.includes(forbidden), `forbidden token found: ${forbidden}`)
}

assert(
  existsSync(path.join(repoRoot, 'backend/src/controllers/rtc.controller.ts')),
  'repo root detection failed',
)

const backendRtcController = readFileSync(
  path.join(repoRoot, 'backend/src/controllers/rtc.controller.ts'),
  'utf8',
)
const backendRtcService = readFileSync(
  path.join(repoRoot, 'backend/src/contracts/rtc-session.ts'),
  'utf8',
)
const backendIndex = readFileSync(
  path.join(repoRoot, 'backend/src/index.ts'),
  'utf8',
)

const backendMobileDiagnosticsController = readFileSync(
  path.join(repoRoot, 'backend/src/controllers/mobile-diagnostics.controller.ts'),
  'utf8',
)

for (const route of ["router.post('/session/start'"]) {
  assert(backendRtcController.includes(route), `backend RTC route missing: ${route}`)
}

for (const contractToken of [
  "| 'mobile_workbench'",
  'participantToken: string',
  'requestedStrategy: RtcSessionStrategy',
  'recommendedStrategy: RtcSessionStrategy',
  'grantedCapabilities: RtcCapabilityId[]',
]) {
  assert(backendRtcService.includes(contractToken), `backend RTC contract drift: ${contractToken}`)
}

for (const workspaceRoute of [
  "memoryRouter.get('/workspace/:userId'",
  "memoryRouter.get('/workspace/:userId/prepared-expressions'",
  "memoryRouter.post('/hotwords'",
]) {
  assert(backendIndex.includes(workspaceRoute), `backend workspace route missing: ${workspaceRoute}`)
}

assert(
  backendIndex.includes("app.use('/api/mobile/diagnostics', authMiddleware, mobileDiagnosticsRouter)"),
  'authenticated mobile diagnostics route is missing',
)
for (const privacyGuard of [
  'MAX_REPORTS_PER_REQUEST',
  'MAX_BREADCRUMBS_PER_REPORT',
  'sanitizeEndpoint',
  'sanitizeStack',
  'userFingerprint',
]) {
  assert(
    backendMobileDiagnosticsController.includes(privacyGuard),
    `mobile diagnostics privacy guard missing: ${privacyGuard}`,
  )
}

console.log('mobile workbench check passed')

const expectedRtcContract = '// GENERATED from backend/src/contracts/rtc-session.ts; run node scripts/sync-rtc-contract.mjs\n' + backendRtcService
assert(readFileSync(path.join(repoRoot, 'apps/mobile-workbench/src/contracts/generated/rtc-session.ts'), 'utf8') === expectedRtcContract, 'RTC generated contract drift; run node scripts/sync-rtc-contract.mjs')
for (const removed of ["router.post('/session/ping'", "router.post('/session/stop'", "router.get('/graphs'"]) {
  assert(!backendRtcController.includes(removed), `removed no-op RTC route returned: ${removed}`)
}
