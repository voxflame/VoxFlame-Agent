import { MAX_DIALECTS, readDialectProfiles, type DialectProfile } from './src/auth/dialect-profile'
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { StatusBar as ExpoStatusBar } from 'expo-status-bar'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import * as Speech from 'expo-speech'
import Constants from 'expo-constants'

import { getMobileRuntimeConfig } from './src/api/mobile-config'
import { useMobileAuth } from './src/auth/use-mobile-auth'
import {
  displayMainlandPhone,
  normalizeMainlandPhone,
  shouldCreatePhoneUser,
} from './src/auth/mobile-phone'
import {
  buildMobileRegistrationProfileMetadata,
  MOBILE_DISABILITY_CATEGORY_OPTIONS,
  MOBILE_ETIOLOGY_OPTIONS,
  validateMobileRegistrationProfile,
  type MobileIdentityDocumentType,
  type MobileRegistrationProfileInput,
} from './src/auth/registration-profile'
import {
  buildMobileLegalConsentMetadata,
  hasCurrentMobileLegalConsent,
} from './src/auth/legal-consent'
import {
  MOBILE_WORKBENCH_SURFACES,
  type MobileWorkbenchSurfaceId,
} from './src/constants/surfaces'
import type { MobileWorkspaceReadModel } from './src/contracts/workspace-read-model'
import type { MobileWorkspaceSnapshotContract } from './src/contracts/workspace-read-model'
import type {
  MobileWorkbenchRecorderQueueItem,
  MobileWorkbenchScene,
} from './src/contracts/workbench-contracts'
import {
  type MobileDiagnosticSyncStatus,
  useMobileDiagnostics,
} from './src/diagnostics/use-mobile-diagnostics'
import { useNativeRecorderQueue } from './src/queue/use-native-recorder-queue'
import { useLiveKitRoomConnection } from './src/realtime/use-livekit-room-connection'
import { buildMobileWorkbenchRtcSessionIntent } from './src/realtime/rtc-session-intent'
import { useMobileRtcSession } from './src/realtime/use-mobile-rtc-session'
import { useMobileWorkspaceSnapshot } from './src/workspace/use-mobile-workspace'
import { toMobileProductMessage } from './src/ui/product-message'
import { useMobileTrainingCatalog } from './src/training/use-mobile-training-catalog'
import {
  analyzeMobileTrainingAttempt,
  summarizeMobileArticulationBaseline,
  type MobileArticulationBaselineAttempt,
  type MobileTrainingFeedback,
} from './src/training/mobile-training-feedback'
import { buildMobilePreparedMaterialExercises } from './src/training/prepared-material-practice'
import {
  confirmMobileTrainingAttempt,
  discardMobileTrainingAttempt,
  replaceMobileTrainingAttempt,
} from './src/training/mobile-attempt-confirmation'
import {
  getMobileCollectionControlState,
  getMobileCollectionPlanId,
  MOBILE_COLLECTION_PLANS,
} from './src/training/collection-protocol'
import {
  buildMobileSpeechVariantMetadata,
  captureStillBelongsToContributor,
  createMobileUtterancePairId,
  decideMobileAdvance,
  reconcileMobileExerciseSelection,
  shouldOfferMobileDialectPair,
  type MobileTrainingSpeechVariant,
  type MobileTrainingCaptureSnapshot,
} from './src/training/mobile-recording-workflow'
import { useMobileMemoryEditor } from './src/memory/use-mobile-memory-editor'
import {
  removeMobileHotwordProfile,
  upsertMobileHotwordProfile,
} from './src/memory/mobile-hotword-editor'
import type { MobileHotwordProfile } from './src/contracts/workspace-read-model'
import type {
  MobileTrainingCategory,
  MobileTrainingExercise,
} from './src/training/training-catalog'
import { buildMobileQuickExpressionPhrases } from './src/communication/quick-expression'
import { getMobileBranding } from './src/config/mobile-branding'

const LOCAL_PREPARED_LINES = [
  '请等我说完，我会用手机把重点给你看。',
  '我今天主要想确认检查结果和下一步安排。',
  '如果听不清，请让我慢一点重复。',
]

const LOCAL_QUICK_PHRASES = [
  '请看这句话',
  '我需要一点时间',
  '请不要替我回答',
  '我想重新说一遍',
]

const MOBILE_COMMUNICATION_SCENES: Array<{
  id: MobileWorkbenchScene
  label: string
  description: string
}> = [
  { id: 'interview', label: '求职 / 面试', description: '先守住表达权，再说结论和例子。' },
  { id: 'work', label: '工作协作', description: '先说判断、风险和下一步。' },
  { id: 'stranger', label: '陌生人开口', description: '先说明节奏，再说当前诉求。' },
  { id: 'medical', label: '就医沟通', description: '先说症状、位置和需要的帮助。' },
  { id: 'family', label: '家人 / 照护', description: '先说需求，保留自己回答的空间。' },
  { id: 'emergency', label: '紧急求助', description: '先把危险、位置和求助动作说清。' },
]

type MobileTaskRoute =
  | 'communication_home'
  | 'communication_quick'
  | 'communication_setup'
  | 'communication_live'
  | 'practice_home'
  | 'practice_materials'
  | 'practice_readings'
  | 'practice_reading_detail'
  | 'articulation_baseline'
  | 'collection'

type MobileCollectionSource = 'catalog' | 'prepared_material'

type MobileAttemptAction = 'idle' | 'analyzing' | 'uploading' | 'discarding' | 'replacing'
type MobileExerciseSequenceStatus = 'active' | 'load_failed' | 'complete'

interface MobilePendingAttempt {
  item: MobileWorkbenchRecorderQueueItem
  feedback: MobileTrainingFeedback
  baselineAttempt: MobileArticulationBaselineAttempt | null
  speechVariant: MobileTrainingSpeechVariant
  utterancePairId?: string
}

const mobileBrand = getMobileBranding(Constants.expoConfig?.name)
const LEGAL_BASE_URL = 'https://voxember.com'

const COLORS = {
  background: '#F5F1EA',
  surface: '#FFFFFF',
  surfaceMuted: '#FAF8F4',
  ink: '#201B17',
  muted: '#71685F',
  subtle: '#A2988E',
  border: '#E5DDD3',
  accent: mobileBrand.accentColor,
  accentSoft: '#F6E7DD',
  success: '#287052',
  successSoft: '#E7F1EC',
  danger: '#A63D32',
  dangerSoft: '#F8E9E6',
} as const

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function friendlyError(message: string | null): string | null {
  if (!message) {
    return null
  }
  return toMobileProductMessage(message)
}

function connectionLabel(status: string): string {
  if (status === 'connected') return '正在沟通'
  if (status === 'connecting') return '正在连接'
  if (status === 'reconnecting') return '正在恢复连接'
  if (status === 'disconnecting') return '正在结束'
  if (status === 'error') return '连接遇到问题'
  return '可以开始'
}

function permissionLabel(status: string): string {
  if (status === 'granted') return '已允许'
  if (status === 'denied') return '未允许'
  if (status === 'undetermined') return '等待确认'
  return '尚未检查'
}

function syncLabel(status: MobileWorkbenchRecorderQueueItem['syncStatus']): string {
  if (status === 'uploaded' || status === 'indexed') return '已上传'
  if (status === 'upload_pending') return '等待上传'
  if (status === 'failed') return '上传失败'
  return '仅保存在本机'
}

function diagnosticLabel(
  status: MobileDiagnosticSyncStatus,
  pendingCount: number,
): string {
  if (status === 'sending') return '正在发送'
  if (status === 'error') return `待重试 ${pendingCount} 条`
  if (pendingCount > 0) return `待发送 ${pendingCount} 条`
  if (status === 'sent') return '已发送'
  return '自动收集已开启'
}

export default function App() {
  const config = useMemo(() => getMobileRuntimeConfig(), [])
  const auth = useMobileAuth(config)
  const diagnostics = useMobileDiagnostics({
    apiBaseUrl: config.apiBaseUrl,
    authenticated: auth.status === 'signed_in',
    tokenProvider: auth.tokenProvider,
  })
  const workspace = useMobileWorkspaceSnapshot({
    apiBaseUrl: config.apiBaseUrl,
    userId: auth.user?.id ?? null,
    tokenProvider: auth.tokenProvider,
    enabled: auth.status === 'signed_in',
  })
  const recorderQueue = useNativeRecorderQueue({
    apiBaseUrl: config.apiBaseUrl,
    contributorId: auth.user?.id ?? null,
    tokenProvider: auth.tokenProvider,
    surface: 'practice',
    mode: 'training',
  })
  const rtcSession = useMobileRtcSession({
    ownerId: auth.user?.id ?? null,
    apiBaseUrl: config.apiBaseUrl,
    tokenProvider: auth.tokenProvider,
    enabled: auth.status === 'signed_in',
  })
  const liveKitRoom = useLiveKitRoomConnection(auth.status === 'signed_in' ? auth.user?.id ?? null : null)
  const trainingRtcSession = useMobileRtcSession({
    ownerId: auth.user?.id ?? null,
    apiBaseUrl: config.apiBaseUrl,
    tokenProvider: auth.tokenProvider,
    enabled: auth.status === 'signed_in',
  })
  const trainingLiveKitRoom = useLiveKitRoomConnection(auth.status === 'signed_in' ? auth.user?.id ?? null : null)
  const trainingCatalog = useMobileTrainingCatalog({
    apiBaseUrl: config.apiBaseUrl,
    enabled: auth.status === 'signed_in',
    tokenProvider: auth.tokenProvider,
  })
  const memoryEditor = useMobileMemoryEditor({
    apiBaseUrl: config.apiBaseUrl,
    userId: auth.user?.id ?? null,
    tokenProvider: auth.tokenProvider,
    enabled: auth.status === 'signed_in',
  })
  const [activeSurfaceId, setActiveSurfaceId] =
    useState<MobileWorkbenchSurfaceId>('communication')
  const [taskRoute, setTaskRoute] = useState<MobileTaskRoute>('communication_home')
  const [showSignedOutQuickExpression, setShowSignedOutQuickExpression] = useState(false)
  const [collectionEntrySource, setCollectionEntrySource] = useState<MobileCollectionSource>('catalog')
  const [selectedPreparedExpression, setSelectedPreparedExpression] = useState<MobileWorkspaceSnapshotContract['prepared_expression']>(null)
  const [practiceText, setPracticeText] = useState('')
  const [displayPhrase, setDisplayPhrase] = useState('')
  const [confirmedOutput, setConfirmedOutput] = useState('')
  const [communicationScene, setCommunicationScene] = useState<MobileWorkbenchScene | null>(null)
  const mainScrollRef = useRef<ScrollView>(null)

  const selectCommunicationScene = (scene: MobileWorkbenchScene | null): void => {
    if (scene !== communicationScene) {
      rtcSession.clear()
      void liveKitRoom.disconnect()
    }
    setCommunicationScene(scene)
    setTaskRoute(scene ? 'communication_live' : 'communication_setup')
  }

  const rtcIntent = useMemo(
    () => buildMobileWorkbenchRtcSessionIntent({
      surfaceId: 'communication',
      scene: communicationScene ?? 'stranger',
      deviceContext: {
        microphoneStatus: 'unknown',
        networkOnline: true,
        appState: 'active',
      },
    }),
    [communicationScene],
  )
  const preparedLines = workspace.readModel.priorityLines.length > 0
    ? workspace.readModel.priorityLines
    : LOCAL_PREPARED_LINES
  const quickPhrases = workspace.readModel.quickPhrases.length > 0
    ? workspace.readModel.quickPhrases
    : LOCAL_QUICK_PHRASES
  const quickExpressionPhrases = useMemo(
    () => buildMobileQuickExpressionPhrases(
      auth.status === 'signed_in' ? workspace.readModel.quickPhrases : [],
    ),
    [auth.status, workspace.readModel.quickPhrases],
  )

  useEffect(() => {
    if (liveKitRoom.latestAssistantTranscript) {
      setConfirmedOutput(liveKitRoom.latestAssistantTranscript)
    }
  }, [liveKitRoom.latestAssistantTranscript])

  useEffect(() => {
    diagnostics.addBreadcrumb('navigation', 'open_surface', activeSurfaceId)
  }, [activeSurfaceId, diagnostics.addBreadcrumb])

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ animated: false, y: 0 })
  }, [activeSurfaceId, taskRoute])

  useEffect(() => {
    if (!workspace.errorMessage) {
      return
    }

    void diagnostics.capture({
      kind: 'api_failure',
      severity: 'error',
      code: 'workspace_snapshot_failed',
      surface: 'memory',
      phase: 'workspace_refresh',
      endpoint: '/memory/workspace/current',
    })
  }, [diagnostics.capture, workspace.errorMessage])

  useEffect(() => {
    if (!rtcSession.errorMessage) {
      return
    }

    void diagnostics.capture({
      kind: 'rtc_failure',
      severity: 'error',
      code: 'rtc_session_failed',
      surface: 'communication',
      phase: rtcSession.status,
      endpoint: '/rtc/session',
    })
  }, [diagnostics.capture, rtcSession.errorMessage, rtcSession.status])

  useEffect(() => {
    if (!liveKitRoom.errorMessage) {
      return
    }

    void diagnostics.capture({
      kind: 'rtc_failure',
      severity: 'error',
      code: 'livekit_connection_failed',
      surface: 'communication',
      phase: 'livekit_connect',
      connectionState: liveKitRoom.status,
    })
  }, [diagnostics.capture, liveKitRoom.errorMessage, liveKitRoom.status])

  useEffect(() => {
    if (!recorderQueue.errorMessage) {
      return
    }

    void diagnostics.capture({
      kind: 'recording_failure',
      severity: 'error',
      code: 'native_recorder_failed',
      surface: 'practice',
      phase: recorderQueue.isUploading ? 'upload' : 'recording',
    })
  }, [
    diagnostics.capture,
    recorderQueue.errorMessage,
    recorderQueue.isUploading,
  ])

  useEffect(() => {
    setConfirmedOutput('')
  }, [auth.user?.id])

  const startCommunication = async (): Promise<void> => {
    if (liveKitRoom.status === 'connected') return
    trainingRtcSession.clear()
    void trainingLiveKitRoom.disconnect()

    const session = await rtcSession.start(rtcIntent)
    if (session && rtcSession.isCurrent(session)) {
      await liveKitRoom.connect(session)
    }
  }

  const stopCommunication = async (): Promise<void> => {
    rtcSession.clear()
    await liveKitRoom.disconnect()
  }

  const ensureTrainingConnection = async (): Promise<boolean> => {
    if (trainingLiveKitRoom.status === 'connected') return true
    rtcSession.clear()
    void liveKitRoom.disconnect()
    const intent = buildMobileWorkbenchRtcSessionIntent({
      surfaceId: 'practice',
      mode: 'training',
      deviceContext: { microphoneStatus: 'available', networkOnline: true, appState: 'active' },
    })
    const session = await trainingRtcSession.start(intent)
    return session && trainingRtcSession.isCurrent(session) ? await trainingLiveKitRoom.connect(session) : false
  }

  const stopTrainingSession = async (): Promise<void> => {
    trainingRtcSession.clear()
    await trainingLiveKitRoom.disconnect()
  }

  const signOut = async (): Promise<void> => {
    // Both owners are invalidated synchronously before either teardown can wait.
    await Promise.all([stopCommunication(), stopTrainingSession()])
    await auth.signOut()
  }

  const sendDiagnostics = async (): Promise<void> => {
    await diagnostics.capture({
      kind: 'manual',
      severity: 'info',
      code: 'manual_diagnostic_report',
      surface: activeSurfaceId,
      phase: 'account_action',
    })
    const sent = await diagnostics.sendNow()
    Alert.alert(
      sent ? '诊断已发送' : '诊断已保存在本机',
      sent
        ? '只包含版本、设备状态和脱敏错误信息，不包含录音、转写或聊天内容。'
        : '网络恢复并保持登录后，App 会自动重试发送。',
    )
  }

  const changeSurface = (surfaceId: MobileWorkbenchSurfaceId): void => {
    if (
      surfaceId !== 'communication'
      && (
        liveKitRoom.status === 'connected'
        || liveKitRoom.status === 'connecting'
        || liveKitRoom.status === 'reconnecting'
      )
    ) {
      void stopCommunication()
    }
    if (surfaceId !== 'practice' && trainingRtcSession.session) {
      void stopTrainingSession()
    }

    setActiveSurfaceId(surfaceId)
    if (surfaceId === 'communication') {
      setTaskRoute(communicationScene ? 'communication_live' : 'communication_home')
    } else if (surfaceId === 'practice') {
      setTaskRoute('practice_home')
    }
  }

  if (!auth.session) {
    if (showSignedOutQuickExpression) {
      return (
        <StandaloneQuickExpressionScreen
          onBack={() => setShowSignedOutQuickExpression(false)}
          phrases={quickExpressionPhrases}
        />
      )
    }
    return (
      <LoginScreen
        apiConfigured={Boolean(config.apiBaseUrl)}
        auth={auth}
        onOpenQuickExpression={() => setShowSignedOutQuickExpression(true)}
        phoneAuthEnabled={config.phoneAuthEnabled}
      />
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <View style={styles.appShell}>
        <AppHeader
          email={workspace.snapshot?.registration_profile?.full_name?.trim() || auth.user?.email || auth.user?.phone || '用户'}
          status={workspace.status === 'ready' ? '资料已同步' : '正在准备'}
        />

        <ScrollView
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
          ref={mainScrollRef}
          showsVerticalScrollIndicator={false}
          style={styles.content}
        >
          {activeSurfaceId === 'communication' ? (
            taskRoute === 'communication_home' ? (
              <CommunicationHomeScreen
                onOpenAssistant={() => setTaskRoute('communication_setup')}
                onOpenQuick={() => setTaskRoute('communication_quick')}
              />
            ) : taskRoute === 'communication_quick' ? (
              <QuickExpressionScreen
                onBack={() => setTaskRoute('communication_home')}
                phrases={quickExpressionPhrases}
              />
            ) : taskRoute === 'communication_setup' ? (
              <CommunicationSetupScreen
                onBack={() => setTaskRoute('communication_home')}
                onSceneChange={selectCommunicationScene}
                scenes={MOBILE_COMMUNICATION_SCENES}
              />
            ) : (
              <CommunicationScreen
              connectionStatus={liveKitRoom.status}
              displayPhrase={displayPhrase}
              confirmedOutput={confirmedOutput}
              errorMessage={friendlyError(
                liveKitRoom.errorMessage ?? rtcSession.errorMessage,
              )}
              onPhrasePress={setDisplayPhrase}
              onConfirmedOutputChange={setConfirmedOutput}
              onSendText={(text) => liveKitRoom.sendText(text)}
              onStart={() => void startCommunication()}
              onStop={() => void stopCommunication()}
              preparedLines={preparedLines}
              quickPhrases={quickPhrases}
              currentUserTranscript={liveKitRoom.currentUserTranscript}
              latestUserTranscript={liveKitRoom.latestUserTranscript}
              scene={communicationScene}
              scenes={MOBILE_COMMUNICATION_SCENES}
              onBack={() => {
                if (liveKitRoom.status === 'connected' || liveKitRoom.status === 'reconnecting') {
                  void stopCommunication()
                }
                selectCommunicationScene(null)
              }}
              starting={rtcSession.status === 'starting'}
            />
            )
          ) : null}

          {activeSurfaceId === 'practice' ? (
            taskRoute === 'practice_home' ? (
              <PracticeHomeScreen
                catalog={trainingCatalog}
                onOpenCollection={(categoryId, source = 'catalog') => {
                  setCollectionEntrySource(source)
                  setSelectedPreparedExpression(null)
                  if (categoryId) void trainingCatalog.selectCategory(categoryId)
                  setTaskRoute(categoryId === '普通话构音基线' ? 'articulation_baseline' : 'collection')
                }}
                onOpenMaterialAreas={() => setTaskRoute('practice_materials')}
                onOpenMaterials={() => changeSurface('memory')}
                preparedExpression={workspace.snapshot?.prepared_expression ?? null}
              />
            ) : taskRoute === 'practice_materials' ? (
              <PracticeMaterialAreasScreen
                catalog={trainingCatalog}
                onBack={() => setTaskRoute('practice_home')}
                onOpenCategory={(categoryId) => {
                  setCollectionEntrySource('catalog')
                  setSelectedPreparedExpression(null)
                  void trainingCatalog.selectCategory(categoryId)
                  setTaskRoute('collection')
                }}
                onOpenReadings={() => setTaskRoute('practice_readings')}
              />
            ) : taskRoute === 'practice_readings' ? (
              <PracticeReadingArticlesScreen
                articles={trainingCatalog.readingArticles}
                loading={trainingCatalog.status === 'loading'}
                onBack={() => setTaskRoute('practice_materials')}
                onSelect={(articleId) => {
                  setCollectionEntrySource('catalog')
                  setSelectedPreparedExpression(null)
                  void trainingCatalog.selectReadingArticle(articleId)
                  setTaskRoute('practice_reading_detail')
                }}
              />
            ) : taskRoute === 'practice_reading_detail' ? (
              <PracticeReadingArticleScreen
                article={trainingCatalog.selectedReadingArticle}
                loading={trainingCatalog.status === 'loading'}
                onBack={() => setTaskRoute('practice_readings')}
                onStart={() => setTaskRoute('collection')}
              />
            ) : (
              <PracticeScreen
              authUserId={auth.user?.id ?? null}
              hasCurrentLegalConsent={hasCurrentMobileLegalConsent(auth.user?.user_metadata)}
              onPracticeTextChange={setPracticeText}
              practiceText={practiceText}
              preparedExpression={selectedPreparedExpression ?? workspace.snapshot?.prepared_expression ?? null}
              preparedLines={preparedLines}
              profileHasDialect={Boolean(workspace.snapshot?.registration_profile?.has_dialect)}
              profileDialects={readDialectProfiles(workspace.snapshot?.registration_profile)}
              profileEtiology={workspace.snapshot?.user_profile_memory.etiology ?? ''}
              profileSeverity={workspace.snapshot?.user_profile_memory.severity ?? ''}
              queue={recorderQueue}
              catalog={trainingCatalog}
              ensureTrainingConnection={ensureTrainingConnection}
              trainingConnection={trainingLiveKitRoom}
              flow={taskRoute as 'articulation_baseline' | 'collection'}
              initialCollectionSource={collectionEntrySource}
              onBack={() => setTaskRoute('practice_home')}
            />
            )
          ) : null}

          {activeSurfaceId === 'memory' ? (
            <MemoryScreen
              errorMessage={friendlyError(workspace.errorMessage)}
              loading={workspace.status === 'loading'}
              onRefresh={workspace.refresh}
              readModel={workspace.readModel}
              snapshot={workspace.snapshot}
              editor={memoryEditor}
            />
          ) : null}

          {activeSurfaceId === 'device' ? (
            <AccountScreen
              apiConfigured={Boolean(config.apiBaseUrl)}
              auth={auth}
              diagnosticStatus={diagnostics.status}
              onRequestPermission={() => void recorderQueue.requestPermission()}
              onSendDiagnostics={() => void sendDiagnostics()}
              onSignOut={() => void signOut()}
              onSync={workspace.refresh}
              pendingDiagnosticCount={diagnostics.pendingCount}
              permissionStatus={recorderQueue.permissionStatus}
              phoneAuthEnabled={config.phoneAuthEnabled}
              queueCount={recorderQueue.items.filter(
                (item) => item.syncStatus !== 'uploaded' && item.syncStatus !== 'indexed',
              ).length}
              workspaceReady={workspace.status === 'ready'}
            />
          ) : null}
        </ScrollView>

        <BottomNavigation
          activeSurfaceId={activeSurfaceId}
          onChange={changeSurface}
        />
      </View>
    </SafeAreaView>
  )
}

function LoginScreen({
  apiConfigured,
  auth,
  onOpenQuickExpression,
  phoneAuthEnabled,
}: {
  apiConfigured: boolean
  auth: ReturnType<typeof useMobileAuth>
  onOpenQuickExpression(): void
  phoneAuthEnabled: boolean
}) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('email')
  const [email, setEmail] = useState(auth.lastEmail)
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [fullName, setFullName] = useState('')
  const [disabilityCategory, setDisabilityCategory] = useState('')
  const [etiology, setEtiology] = useState('')
  const [hasDialect, setHasDialect] = useState<boolean | null>(null)
  const [dialects, setDialects] = useState<DialectProfile[]>([{ name: '', region: '' }])
  const [identityDocumentType, setIdentityDocumentType] = useState<MobileIdentityDocumentType>('disability_certificate')
  const [identityDocumentNumber, setIdentityDocumentNumber] = useState('')
  const [legalConsentAccepted, setLegalConsentAccepted] = useState(false)
  const [otp, setOtp] = useState('')
  const [phoneCodeSent, setPhoneCodeSent] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)
  const isBusy = (
    auth.status === 'initializing'
    || auth.status === 'signing_in'
    || auth.status === 'sending_code'
    || auth.status === 'verifying_code'
  )

  useEffect(() => {
    if (!email && auth.lastEmail) {
      setEmail(auth.lastEmail)
    }
  }, [auth.lastEmail, email])

  useEffect(() => {
    if (resendSeconds <= 0) {
      return undefined
    }
    const timer = setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendSeconds])

  const requestPhoneCode = async (): Promise<void> => {
    let normalizedPhone: string
    try {
      normalizedPhone = normalizeMainlandPhone(phone)
    } catch {
      setLocalError('手机号格式不正确。')
      return
    }

    if (authMode === 'register') {
      const profile: MobileRegistrationProfileInput = {
        province, city, fullName, phone: normalizedPhone, disabilityCategory, etiology,
        hasDialect, dialects, identityDocumentType, identityDocumentNumber,
      }
      const profileError = validateMobileRegistrationProfile(profile)
      if (profileError) {
        setLocalError(profileError)
        return
      }
      if (!legalConsentAccepted) {
        setLocalError('请先勾选并确认当前版本的统一授权。')
        return
      }
    }
    setLocalError(null)
    const metadata = authMode === 'register'
      ? {
          ...buildMobileRegistrationProfileMetadata({
            province, city, fullName, phone: normalizedPhone, disabilityCategory, etiology,
            hasDialect, dialects, identityDocumentType, identityDocumentNumber,
          }),
          ...buildMobileLegalConsentMetadata(),
        }
      : undefined
    const requested = await auth.requestPhoneLoginCode(
      normalizedPhone,
      shouldCreatePhoneUser(authMode),
      metadata,
    )
    if (requested) {
      setPhoneCodeSent(true)
      setResendSeconds(60)
    }
  }

  const verifyPhoneCode = async (): Promise<void> => {
    let normalizedPhone: string
    try {
      normalizedPhone = normalizeMainlandPhone(phone)
    } catch {
      setLocalError('手机号格式不正确。')
      return
    }
    if (!/^\d{6}$/.test(otp)) {
      setLocalError('请输入短信中的 6 位验证码。')
      return
    }

    setLocalError(null)
    await auth.verifyPhoneLoginCode({
      phone: normalizedPhone,
      otp,
      consent: authMode === 'login' ? legalConsentAccepted : false,
    })
  }

  const registrationProfile: MobileRegistrationProfileInput = {
    province, city, fullName, phone, disabilityCategory, etiology,
    hasDialect, dialects, identityDocumentType, identityDocumentNumber,
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <ScrollView
        contentContainerStyle={styles.loginPage}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>{mobileBrand.mark}</Text>
        </View>
        <Text style={styles.loginTitle}>把想说的话，稳稳传达。</Text>
        <Text style={styles.loginCopy}>
          沟通、练习和准备材料，都在这里。
        </Text>

        <View style={styles.signedOutQuickCard}>
          <Text style={styles.taskCardEyebrow}>现在就要表达</Text>
          <Text style={styles.taskCardTitle}>不用登录，直接让手机替你说</Text>
          <Text style={styles.taskCardCopy}>本机朗读、复制或大字展示，不连接助手，也不上传声音。</Text>
          <PrimaryButton label="打开快速表达" onPress={onOpenQuickExpression} />
        </View>

        <View style={styles.loginCard}>
          {phoneAuthEnabled && authMode === 'login' ? (
            <View accessibilityRole="tablist" style={styles.loginMethodRow}>
              {(['email', 'phone'] as const).map((method) => {
                const active = loginMethod === method
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    key={method}
                    onPress={() => {
                      setLoginMethod(method)
                      setPhoneCodeSent(false)
                      setOtp('')
                      setLocalError(null)
                    }}
                    style={[styles.loginMethodTab, active ? styles.loginMethodTabActive : null]}
                  >
                    <Text style={[styles.loginMethodText, active ? styles.loginMethodTextActive : null]}>
                      {method === 'email' ? '邮箱登录' : '手机登录'}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          ) : null}

          {loginMethod === 'email' ? (
            <>
              <Text style={styles.fieldLabel}>邮箱</Text>
              <TextInput
                accessibilityLabel="邮箱"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isBusy}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="name@example.com"
                placeholderTextColor={COLORS.subtle}
                style={styles.input}
                textContentType="emailAddress"
                value={email}
              />
              <Text style={styles.fieldLabel}>密码</Text>
              <TextInput
                accessibilityLabel="密码"
                editable={!isBusy}
                onChangeText={setPassword}
                placeholder="输入密码"
                placeholderTextColor={COLORS.subtle}
                secureTextEntry
                style={styles.input}
                textContentType="password"
                value={password}
              />
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>中国大陆手机号</Text>
              <TextInput
                accessibilityLabel="中国大陆手机号"
                editable={!isBusy && !phoneCodeSent}
                keyboardType="phone-pad"
                onChangeText={setPhone}
                placeholder="138 1234 5678"
                placeholderTextColor={COLORS.subtle}
                style={styles.input}
                textContentType="telephoneNumber"
                value={phone}
              />
              {phoneCodeSent ? (
                <>
                  <Text style={styles.fieldLabel}>6 位验证码</Text>
                  <TextInput
                    accessibilityLabel="6 位验证码"
                    editable={!isBusy}
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="短信验证码"
                    placeholderTextColor={COLORS.subtle}
                    style={[styles.input, styles.otpInput]}
                    textContentType="oneTimeCode"
                    value={otp}
                  />
                  <View style={styles.phoneCodeActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isBusy || resendSeconds > 0}
                      onPress={() => void requestPhoneCode()}
                      style={styles.textAction}
                    >
                      <Text style={styles.textActionText}>
                        {resendSeconds > 0 ? `${resendSeconds} 秒后重发` : '重新发送'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isBusy}
                      onPress={() => {
                        setPhoneCodeSent(false)
                        setOtp('')
                      }}
                      style={styles.textAction}
                    >
                      <Text style={styles.textActionText}>修改手机号</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={styles.loginHint}>
                  {authMode === 'login'
                    ? '使用已经注册的手机号登录；未注册号码不会自动创建账号。'
                    : `验证手机号后将创建新的${mobileBrand.name}账号。`}
                </Text>
              )}
            </>
          )}
          {authMode === 'register' ? (
            <View style={styles.registrationFields}>
              <Text style={styles.registrationStepActive}>2 填写账户资料</Text>
              <Text style={styles.mutedText}>注册一次，之后直接进入任务。方言资料可跳过。</Text>
              {([
                ['现居省份', province, setProvince, '例如：广东省'],
                ['现居城市', city, setCity, '例如：广州市'],
                ['姓名', fullName, setFullName, '请输入真实姓名'],
              ] as const).map(([label, value, setter, placeholder]) => (
                <View key={label} style={styles.registrationField}>
                  <Text style={styles.fieldLabel}>{label}</Text>
                  <TextInput accessibilityLabel={label} editable={!isBusy && !phoneCodeSent} onChangeText={setter} placeholder={placeholder} placeholderTextColor={COLORS.subtle} style={styles.input} value={value} />
                </View>
              ))}
              <Text style={styles.fieldLabel}>残疾类别</Text>
              <View style={styles.chipWrap}>{MOBILE_DISABILITY_CATEGORY_OPTIONS.map((item) => <Pressable key={item} onPress={() => setDisabilityCategory(item)} style={[styles.filterChip, disabilityCategory === item ? styles.filterChipActive : null]}><Text style={styles.filterChipText}>{item}</Text></Pressable>)}</View>
              <Text style={styles.fieldLabel}>病种</Text>
              <View style={styles.chipWrap}>{MOBILE_ETIOLOGY_OPTIONS.map(([value, label]) => <Pressable key={value} onPress={() => setEtiology(value)} style={[styles.filterChip, etiology === value ? styles.filterChipActive : null]}><Text style={styles.filterChipText}>{label}</Text></Pressable>)}</View>
              <Text style={styles.fieldLabel}>是否使用方言（可跳过）</Text>
              <View style={styles.chipWrap}>{([['yes', '有方言'], ['no', '没有方言'], ['skip', '暂不填写']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: (value === 'yes' && hasDialect === true) || (value === 'no' && hasDialect === false) || (value === 'skip' && hasDialect === null), disabled: isBusy || phoneCodeSent }} disabled={isBusy || phoneCodeSent} onPress={() => { const next = value === 'skip' ? null : value === 'yes'; setHasDialect(next); if (!next) setDialects([{ name: '', region: '' }]) }} style={[styles.filterChip, ((hasDialect === true && value === 'yes') || (hasDialect === false && value === 'no') || (hasDialect === null && value === 'skip')) ? styles.filterChipActive : null]}><Text style={styles.filterChipText}>{label}</Text></Pressable>)}</View>
              {hasDialect ? <View style={styles.consentStack}>
                <Text style={styles.fieldLabel}>常用方言（可添加多种）</Text>
                <Text style={styles.mutedText}>按实际使用的方言填写，不按出生地或现居地推断。每种方言的来源地区可填省市，不确定可留空。最多 8 种。</Text>
                {dialects.map((entry, index) => <View key={index} style={styles.registrationField}>
                  <Text style={styles.fieldLabel}>方言 {index + 1} 名称</Text>
                  <TextInput accessibilityLabel={`方言 ${index + 1} 名称`} editable={!isBusy && !phoneCodeSent} maxLength={40}
                    value={entry.name} placeholder="例如：四川话" placeholderTextColor={COLORS.subtle} style={styles.input}
                    onChangeText={(name) => setDialects((items) => items.map((item, i) => i === index ? { ...item, name } : item))} />
                  <Text style={styles.fieldLabel}>方言 {index + 1} 来源地区（选填）</Text>
                  <TextInput accessibilityLabel={`方言 ${index + 1} 来源地区（选填）`} editable={!isBusy && !phoneCodeSent} maxLength={80}
                    value={entry.region} placeholder="例如：四川成都，不是现居地" placeholderTextColor={COLORS.subtle} style={styles.input}
                    onChangeText={(region) => setDialects((items) => items.map((item, i) => i === index ? { ...item, region } : item))} />
                  {dialects.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel={`移除方言 ${index + 1}`} disabled={isBusy || phoneCodeSent}
                    onPress={() => setDialects((items) => items.filter((_, i) => i !== index))} style={styles.textAction}><Text style={styles.textActionText}>移除这项</Text></Pressable> : null}
                </View>)}
                <Pressable accessibilityRole="button" disabled={isBusy || phoneCodeSent || dialects.length >= MAX_DIALECTS}
                  accessibilityState={{ disabled: isBusy || phoneCodeSent || dialects.length >= MAX_DIALECTS }}
                  onPress={() => setDialects((items) => [...items, { name: '', region: '' }])} style={styles.textAction}><Text style={styles.textActionText}>添加另一种方言</Text></Pressable>
              </View> : null}
              <Text style={styles.fieldLabel}>证件类型</Text>
              <View style={styles.chipWrap}>{([['disability_certificate', '残疾证号'], ['id_card', '身份证号']] as const).map(([value, label]) => <Pressable key={value} onPress={() => setIdentityDocumentType(value)} style={[styles.filterChip, identityDocumentType === value ? styles.filterChipActive : null]}><Text style={styles.filterChipText}>{label}</Text></Pressable>)}</View>
              <TextInput accessibilityLabel="证件号" editable={!isBusy && !phoneCodeSent} onChangeText={setIdentityDocumentNumber} placeholder={identityDocumentType === 'id_card' ? '18 位身份证号' : '请输入残疾证号'} placeholderTextColor={COLORS.subtle} style={styles.input} value={identityDocumentNumber} />
              <View style={styles.consentStack}>
                <LegalDocumentLinks />
                <ConsentToggle
                  label={unifiedConsentLabel()}
                  checked={legalConsentAccepted}
                  onPress={() => setLegalConsentAccepted((accepted) => !accepted)}
                />
              </View>
            </View>
          ) : null}
          {authMode === 'login' ? (
            <View style={styles.consentStack}>
              <Text style={styles.mutedText}>登录前请确认当前版本的数据授权。已有账号只需确认一次，确认后即可继续进入任务。</Text>
              <LegalDocumentLinks />
              <ConsentToggle
                label={unifiedConsentLabel()}
                checked={legalConsentAccepted}
                onPress={() => setLegalConsentAccepted((accepted) => !accepted)}
              />
            </View>
          ) : null}
          {localError || friendlyError(auth.errorMessage) ? (
            <InlineMessage tone="danger" text={localError ?? friendlyError(auth.errorMessage) ?? ''} />
          ) : null}
          {!apiConfigured || auth.status === 'config_missing' ? (
            <InlineMessage tone="danger" text="服务暂不可用，请稍后再试。" />
          ) : null}
          <PrimaryButton
            disabled={isBusy || !apiConfigured || auth.status === 'config_missing'}
            label={isBusy
              ? phoneAuthEnabled && loginMethod === 'phone' ? '正在处理…' : '正在登录…'
              : loginMethod === 'phone'
                ? phoneCodeSent
                  ? authMode === 'register' ? '验证并注册' : '验证并登录'
                  : '发送验证码'
                : authMode === 'register' ? '提交注册' : '邮箱登录'}
            onPress={() => {
              if (loginMethod === 'email') {
                if (authMode === 'register') {
                  const profileError = validateMobileRegistrationProfile(registrationProfile)
                  if (profileError) { setLocalError(profileError); return }
                  if (!legalConsentAccepted) { setLocalError('请先勾选并确认当前版本的统一授权。'); return }
                  void auth.signUpWithPassword({ email, password, metadata: { ...buildMobileRegistrationProfileMetadata(registrationProfile), ...buildMobileLegalConsentMetadata() } })
                } else {
                  if (!legalConsentAccepted) {
                    setLocalError('请先勾选并确认当前版本的统一授权。')
                    return
                  }
                  void auth.signInWithPassword({ email, password, consent: true })
                }
                return
              }
              void (phoneCodeSent ? verifyPhoneCode() : requestPhoneCode())
            }}
          />
          {phoneAuthEnabled ? (
            <Pressable
              accessibilityRole="button"
              disabled={isBusy}
              onPress={() => {
                const nextMode = authMode === 'login' ? 'register' : 'login'
                setAuthMode(nextMode)
                setLoginMethod(nextMode === 'register' ? 'phone' : 'email')
                setPhoneCodeSent(false)
                setOtp('')
                setLocalError(null)
              }}
              style={styles.textAction}
            >
              <Text style={styles.textActionText}>
                {authMode === 'login' ? '使用手机号注册' : '返回账号登录'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.privacyCopy}>
          你的沟通资料仅用于已登录账户的同步。
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

function AppHeader({ email, status }: { email: string; status: string }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.wordmark}>{mobileBrand.name}</Text>
        <Text numberOfLines={1} style={styles.headerEmail}>{email}</Text>
      </View>
      <View style={styles.statusBadge}>
        <View style={styles.statusDot} />
        <Text style={styles.statusBadgeText}>{status}</Text>
      </View>
    </View>
  )
}

function CommunicationHomeScreen({
  onOpenAssistant,
  onOpenQuick,
}: {
  onOpenAssistant(): void
  onOpenQuick(): void
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.heroHeading}>
        <Text style={styles.eyebrow}>沟通</Text>
        <Text style={styles.pageTitle}>你现在想怎么表达？</Text>
        <Text style={styles.pageCopy}>选一种方式直接进入，不需要先进入另一种模式。</Text>
      </View>
      <Pressable
        accessibilityHint="不连接助手，使用本机朗读和大字展示"
        accessibilityRole="button"
        onPress={onOpenQuick}
        style={({ pressed }) => [styles.modeCard, styles.modeCardAccent, pressed ? styles.pressed : null]}
      >
        <Text style={styles.modeCardEyebrow}>立即可用</Text>
        <Text style={styles.modeCardTitle}>快速表达</Text>
        <Text style={styles.modeCardCopy}>点一句或自己输入，让手机直接替你说；也可以复制或给对方看。</Text>
        <Text style={styles.modeCardAction}>进入快速表达 ›</Text>
      </Pressable>
      <Pressable
        accessibilityHint="选择场景并进入语音沟通助手"
        accessibilityRole="button"
        onPress={onOpenAssistant}
        style={({ pressed }) => [styles.modeCard, styles.modeCardDark, pressed ? styles.pressed : null]}
      >
        <Text style={[styles.modeCardEyebrow, styles.modeCardEyebrowDark]}>需要理解和纠错</Text>
        <Text style={[styles.modeCardTitle, styles.modeCardTitleDark]}>语音助手</Text>
        <Text style={[styles.modeCardCopy, styles.modeCardCopyDark]}>需要语音识别、意图纠错、记忆或连续对话时再连接助手。</Text>
        <Text style={[styles.modeCardAction, styles.modeCardActionDark]}>选择沟通场景 ›</Text>
      </Pressable>
    </View>
  )
}

function StandaloneQuickExpressionScreen({
  onBack,
  phrases,
}: {
  onBack(): void
  phrases: Array<{ id: string; text: string }>
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <ScrollView
        contentContainerStyle={[styles.pageContent, styles.standaloneQuickPage]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <QuickExpressionScreen onBack={onBack} phrases={phrases} />
      </ScrollView>
    </SafeAreaView>
  )
}

function QuickExpressionScreen({
  onBack,
  phrases,
}: {
  onBack(): void
  phrases: Array<{ id: string; text: string }>
}) {
  const [draft, setDraft] = useState('')
  const [showPartnerView, setShowPartnerView] = useState(false)
  const [outputStatus, setOutputStatus] = useState<string | null>(null)

  useEffect(() => () => {
    Speech.stop()
  }, [])

  const speakText = (text: string): void => {
    const value = text.trim()
    if (!value) {
      setOutputStatus('先选择或输入一句要说的话。')
      return
    }
    Speech.stop()
    Speech.speak(value, {
      language: 'zh-CN',
      rate: 0.92,
      onDone: () => setOutputStatus('已经说完。'),
      onError: () => setOutputStatus('朗读中断了，可以再点一次。'),
    })
    setOutputStatus('正在用本机语音说出这句话。')
  }

  const usePhrase = (text: string): void => {
    setDraft(text)
    speakText(text)
  }

  const speak = (): void => {
    speakText(draft)
  }

  const copy = async (): Promise<void> => {
    const text = draft.trim()
    if (!text) {
      setOutputStatus('先选择或输入一句要复制的话。')
      return
    }
    await Clipboard.setStringAsync(text)
    setOutputStatus('已复制，可以粘贴到其他应用。')
  }

  return (
    <View style={styles.screen}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.textAction}>
        <Text style={styles.textActionText}>← 返回沟通方式</Text>
      </Pressable>
      <View style={styles.heroHeading}>
        <Text style={styles.eyebrow}>快速表达</Text>
        <Text style={styles.pageTitle}>点一句，直接替你说出来</Text>
        <Text style={styles.pageCopy}>不连接助手，也不上传声音。适合问候、出行和临时求助。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>马上要用</Text>
        <View style={styles.quickPhraseGrid}>
          {phrases.map((phrase) => (
            <Pressable
              accessibilityHint="立即用本机语音朗读这句话"
              accessibilityRole="button"
              key={phrase.id}
              onPress={() => usePhrase(phrase.text)}
              style={({ pressed }) => [
                styles.quickPhraseButton,
                draft.trim() === phrase.text ? styles.quickPhraseButtonActive : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.quickPhraseButtonText}>{phrase.text}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>自己输入一句</Text>
        <TextInput
          accessibilityLabel="快速表达文字"
          multiline
          onChangeText={setDraft}
          placeholder="输入要让手机替你说的话"
          placeholderTextColor={COLORS.subtle}
          style={styles.practiceInput}
          value={draft}
        />
        <PrimaryButton disabled={!draft.trim()} label="语音发送" onPress={speak} />
        <View style={styles.outputActions}>
          <SecondaryButton disabled={!draft.trim()} label="给对方看" onPress={() => setShowPartnerView(true)} />
          <SecondaryButton disabled={!draft.trim()} label="复制" onPress={() => void copy()} />
        </View>
        {outputStatus ? <Text accessibilityLiveRegion="polite" style={styles.outputStatus}>{outputStatus}</Text> : null}
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setShowPartnerView(false)}
        transparent={false}
        visible={showPartnerView}
      >
        <SafeAreaView style={styles.partnerView}>
          <Text style={styles.partnerLabel}>请看这句话</Text>
          <Text selectable style={styles.partnerText}>{draft.trim()}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowPartnerView(false)}
            style={styles.partnerCloseButton}
          >
            <Text style={styles.partnerCloseText}>返回快速表达</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </View>
  )
}

function CommunicationSetupScreen({
  onBack,
  onSceneChange,
  scenes,
}: {
  onBack(): void
  onSceneChange(scene: MobileWorkbenchScene): void
  scenes: Array<{ id: MobileWorkbenchScene; label: string; description: string }>
}) {
  return (
    <View style={styles.screen}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.textAction}>
        <Text style={styles.textActionText}>← 返回沟通方式</Text>
      </Pressable>
      <View style={styles.heroHeading}>
        <Text style={styles.eyebrow}>沟通准备</Text>
        <Text style={styles.pageTitle}>这一次，你要和谁沟通？</Text>
        <Text style={styles.pageCopy}>先选场景，合适的开场句和沟通重点会带进下一页。</Text>
      </View>
      <View style={styles.taskCard}>
        <Text style={styles.taskCardEyebrow}>选择当前场景</Text>
        <Text style={styles.taskCardTitle}>每次只准备一件最重要的事</Text>
        <View style={styles.categoryList}>
          {scenes.map((item) => (
            <Pressable
              accessibilityHint="进入实时沟通工作台"
              accessibilityRole="button"
              key={item.id}
              onPress={() => onSceneChange(item.id)}
              style={({ pressed }) => [styles.categoryRow, pressed ? styles.pressed : null]}
            >
              <View style={styles.categoryCopy}>
                <Text style={styles.categoryTitle}>{item.label}</Text>
                <Text style={styles.mutedText}>{item.description}</Text>
              </View>
              <Text style={styles.phraseArrow}>›</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  )
}

function CommunicationScreen({
  confirmedOutput,
  connectionStatus,
  currentUserTranscript,
  displayPhrase,
  errorMessage,
  latestUserTranscript,
  onConfirmedOutputChange,
  onPhrasePress,
  onBack,
  onSendText,
  onStart,
  onStop,
  preparedLines,
  quickPhrases,
  scene,
  scenes,
  starting,
}: {
  confirmedOutput: string
  connectionStatus: string
  currentUserTranscript: string
  displayPhrase: string
  errorMessage: string | null
  latestUserTranscript: string
  onConfirmedOutputChange(value: string): void
  onPhrasePress(phrase: string): void
  onBack(): void
  onSendText(text: string): Promise<boolean>
  onStart(): void
  onStop(): void
  preparedLines: string[]
  quickPhrases: string[]
  scene: MobileWorkbenchScene | null
  scenes: Array<{ id: MobileWorkbenchScene; label: string; description: string }>
  starting: boolean
}) {
  const [showPartnerView, setShowPartnerView] = useState(false)
  const [outputStatus, setOutputStatus] = useState<string | null>(null)
  const connected = connectionStatus === 'connected' || connectionStatus === 'reconnecting'
  const busy = connectionStatus === 'connecting' || connectionStatus === 'disconnecting' || starting
  const leadPhrase = displayPhrase || preparedLines[0]
  const liveTranscript = currentUserTranscript || latestUserTranscript

  const usePhrase = async (phrase: string): Promise<void> => {
    onPhrasePress(phrase)
    onConfirmedOutputChange(phrase)
    if (connected) {
      await onSendText(phrase)
    }
  }

  const speakConfirmedOutput = (): void => {
    const text = confirmedOutput.trim()
    if (!text) {
      setOutputStatus('先写好要朗读的一句话。')
      return
    }
    Speech.stop()
    Speech.speak(text, {
      language: 'zh-CN',
      rate: 0.9,
      onDone: () => setOutputStatus('朗读完成。'),
      onError: () => setOutputStatus('朗读没有完成，请重试。'),
    })
    setOutputStatus('正在朗读。')
  }

  const copyConfirmedOutput = async (): Promise<void> => {
    const text = confirmedOutput.trim()
    if (!text) {
      setOutputStatus('先写好要复制的一句话。')
      return
    }
    await Clipboard.setStringAsync(text)
    setOutputStatus('已复制，可以粘贴到其他应用。')
  }

  const sendConfirmedOutput = async (): Promise<void> => {
    const text = confirmedOutput.trim()
    if (!text) {
      setOutputStatus('先写好要发送的一句话。')
      return
    }
    if (!connected) {
      setOutputStatus('先开始沟通，再把文字发给助手。')
      return
    }
    const sent = await onSendText(text)
    setOutputStatus(sent ? '已发给助手。' : '发送没有完成，请重试。')
  }

  return (
    <View style={styles.screen}>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.textAction}>
        <Text style={styles.textActionText}>← 返回场景选择</Text>
      </Pressable>
      <View style={styles.heroHeading}>
        <Text style={styles.eyebrow}>实时沟通</Text>
        <Text style={styles.pageTitle}>先把关键一句说清楚</Text>
        <Text style={styles.pageCopy}>你随时可以停下、重说，或直接把文字给对方看。</Text>
      </View>

      {scene ? <><View style={styles.sceneBar}>
        <View style={styles.sceneBarCopy}>
          <Text style={styles.cardLabel}>当前场景</Text>
          <Text style={styles.categoryTitle}>{scenes.find((item) => item.id === scene)?.label}</Text>
        </View>
      </View>
      <View style={styles.communicationCard}>
        <View style={styles.connectionRow}>
          <View style={[styles.liveDot, connected ? styles.liveDotActive : null]} />
          <Text style={styles.connectionText}>{connectionLabel(connectionStatus)}</Text>
        </View>
        <Text style={styles.displayPhrase}>{leadPhrase}</Text>
        <PrimaryButton
          disabled={busy}
          label={connected ? '结束沟通' : busy ? '正在连接…' : '开始沟通'}
          onPress={connected ? onStop : onStart}
          tone={connected ? 'neutral' : 'accent'}
        />
        {errorMessage ? <InlineMessage tone="danger" text={errorMessage} /> : null}
      </View></> : null}

      {scene ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>文字沟通</Text>
          {connected || liveTranscript ? (
            <Text style={styles.liveTranscript}>
              {liveTranscript || '开始说话后，系统听到的内容会出现在这里。'}
            </Text>
          ) : null}
          <Text style={styles.fieldLabel}>输入或修改一句话</Text>
          <TextInput
            accessibilityLabel="确认输出"
            multiline
            onChangeText={onConfirmedOutputChange}
            placeholder="可以直接输入；助手整理后的文字也会出现在这里。"
            placeholderTextColor={COLORS.subtle}
            style={styles.practiceInput}
            value={confirmedOutput}
          />
          <PrimaryButton
            disabled={!connected || !confirmedOutput.trim()}
            label={connected ? '发给助手' : '开始沟通后可发送'}
            onPress={() => void sendConfirmedOutput()}
          />
          <View style={styles.outputActions}>
            <SecondaryButton label="给对方看" onPress={() => setShowPartnerView(true)} />
            <SecondaryButton label="文本发声" onPress={speakConfirmedOutput} />
            <SecondaryButton label="复制" onPress={() => void copyConfirmedOutput()} />
          </View>
          {outputStatus ? <Text style={styles.outputStatus}>{outputStatus}</Text> : null}
        </View>
      ) : null}

      {scene ? <><SectionHeader title="常用短句" />
      <View style={styles.phraseList}>
        {quickPhrases.slice(0, 6).map((phrase) => (
          <Pressable
            accessibilityHint="将这句话放大显示"
            accessibilityRole="button"
            key={phrase}
            onPress={() => void usePhrase(phrase)}
            style={({ pressed }) => [
              styles.phraseButton,
              displayPhrase === phrase ? styles.phraseButtonActive : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.phraseButtonText}>{phrase}</Text>
            <Text style={styles.phraseArrow}>›</Text>
          </Pressable>
        ))}
      </View></> : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setShowPartnerView(false)}
        transparent={false}
        visible={showPartnerView}
      >
        <SafeAreaView style={styles.partnerView}>
          <Text style={styles.partnerLabel}>请看这句话</Text>
          <Text selectable style={styles.partnerText}>
            {confirmedOutput.trim() || '请给我一点时间。'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowPartnerView(false)}
            style={styles.partnerCloseButton}
          >
            <Text style={styles.partnerCloseText}>返回沟通</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </View>
  )
}

function PracticeHomeScreen({
  catalog,
  onOpenCollection,
  onOpenMaterialAreas,
  onOpenMaterials,
  preparedExpression,
}: {
  catalog: ReturnType<typeof useMobileTrainingCatalog>
  onOpenCollection(categoryId?: string, source?: MobileCollectionSource): void
  onOpenMaterialAreas(): void
  onOpenMaterials(): void
  preparedExpression: MobileWorkspaceSnapshotContract['prepared_expression']
}) {
  const materialExercises = buildMobilePreparedMaterialExercises(preparedExpression)

  return (
    <View style={styles.screen}>
      <View style={styles.heroHeading}>
        <Text style={styles.eyebrow}>练习</Text>
        <Text style={styles.pageTitle}>录下你真正会说的话</Text>
        <Text style={styles.pageCopy}>选择一种方式开始。</Text>
      </View>

      <Pressable
        accessibilityHint="逐字完成固定的普通话构音表现基线"
        accessibilityRole="button"
        onPress={() => onOpenCollection('普通话构音基线')}
        style={({ pressed }) => [styles.articulationBaselineEntry, pressed ? styles.pressed : null]}
      >
        <Text style={styles.taskCardEyebrow}>50 个单音节</Text>
        <Text style={styles.taskCardTitle}>普通话构音表现基线</Text>
        <Text style={styles.taskCardCopy}>观察系统在哪些声母、韵母和声调组合上更容易听错，不作为临床诊断。</Text>
      </Pressable>

      <Pressable
        accessibilityHint="使用自己上传或粘贴的材料"
        accessibilityRole="button"
        onPress={() => {
          if (materialExercises.length > 0) {
            onOpenCollection(undefined, 'prepared_material')
            return
          }
          onOpenMaterials()
        }}
        style={({ pressed }) => [styles.ownMaterialCard, pressed ? styles.pressed : null]}
      >
        <Text style={styles.taskCardTitle}>用自己的材料</Text>
        {preparedExpression ? <Text numberOfLines={1} style={styles.mutedText}>《{preparedExpression.title}》</Text> : null}
        <Text style={styles.materialAction}>›</Text>
      </Pressable>

      <Pressable
        accessibilityHint="进入九个已有材料区"
        accessibilityRole="button"
        onPress={onOpenMaterialAreas}
        style={({ pressed }) => [styles.ownMaterialCard, pressed ? styles.pressed : null]}
      >
        <Text style={styles.taskCardTitle}>选择已有材料</Text>
        <Text style={styles.mutedText}>9 个材料区</Text>
        <Text style={styles.materialAction}>›</Text>
      </Pressable>
      {preparedExpression?.training_reports ? (
        <View style={styles.trainingReportPreview}>
          <View style={styles.sectionIntro}>
            <Text style={styles.sectionTitle}>训练回顾</Text>
            <Text style={styles.mutedText}>只看下一步，不做压力报表。</Text>
          </View>
          <View style={styles.reportItem}>
            <Text style={styles.cardLabel}>今天</Text>
            <Text style={styles.reportText}>{preparedExpression.training_reports.daily_summary?.summary ?? '今天继续练几句后会自动更新。'}</Text>
          </View>
          <View style={styles.reportItem}>
            <Text style={styles.cardLabel}>最近 7 天</Text>
            <Text style={styles.reportText}>{preparedExpression.training_reports.weekly_summary?.summary ?? '积累更多真实训练后再看稳定规律。'}</Text>
          </View>
        </View>
      ) : null}
      {catalog.status === 'loading' ? <ActivityIndicator color={COLORS.accent} /> : null}
      {catalog.errorMessage ? <InlineMessage tone="danger" text={catalog.errorMessage} /> : null}
    </View>
  )
}

function PracticeMaterialAreasScreen({
  catalog,
  onBack,
  onOpenCategory,
  onOpenReadings,
}: {
  catalog: ReturnType<typeof useMobileTrainingCatalog>
  onBack(): void
  onOpenCategory(categoryId: string): void
  onOpenReadings(): void
}) {
  const categories = catalog.categories.filter((category) => category.kind === 'collection')
  return (
    <View style={styles.screen}>
      <SecondaryButton compact label="返回" onPress={onBack} />
      <Text style={styles.pageTitle}>选择已有材料</Text>
      <View style={styles.practiceTopicList}>
        {categories.map((category) => (
          <Pressable
            accessibilityRole="button"
            key={category.id}
            onPress={() => onOpenCategory(category.id)}
            style={({ pressed }) => [styles.practiceTopicRow, pressed ? styles.pressed : null]}
          >
            <Text style={styles.categoryTitle}>{category.id === '现代文章朗读' ? '短句朗读' : category.label}</Text>
            <Text style={styles.categoryCount}>{category.count} 句　›</Text>
          </Pressable>
        ))}
        {catalog.readingArticles.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenReadings}
            style={({ pressed }) => [styles.practiceTopicRow, pressed ? styles.pressed : null]}
          >
            <Text style={styles.categoryTitle}>完整文章</Text>
            <Text style={styles.categoryCount}>{catalog.readingArticles.length} 篇　›</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function PracticeReadingArticlesScreen({
  articles,
  loading,
  onBack,
  onSelect,
}: {
  articles: ReturnType<typeof useMobileTrainingCatalog>['readingArticles']
  loading: boolean
  onBack(): void
  onSelect(articleId: string): void
}) {
  return (
    <View style={styles.screen}>
      <SecondaryButton compact label="返回" onPress={onBack} />
      <Text style={styles.pageTitle}>完整文章</Text>
      {loading ? <ActivityIndicator color={COLORS.accent} /> : null}
      {!loading && articles.length === 0 ? (
        <InlineMessage tone="danger" text="暂无通过完整正文、底本与权利核验的文章。" />
      ) : null}
      <View style={styles.practiceTopicList}>
        {articles.map((article) => (
          <Pressable
            accessibilityRole="button"
            key={article.id}
            onPress={() => onSelect(article.id)}
            style={({ pressed }) => [styles.practiceTopicRow, pressed ? styles.pressed : null]}
          >
            <Text style={styles.categoryTitle}>{article.title}</Text>
            <Text style={styles.categoryCount}>{article.segmentCount} 句　›</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function PracticeReadingArticleScreen({
  article,
  loading,
  onBack,
  onStart,
}: {
  article: ReturnType<typeof useMobileTrainingCatalog>['selectedReadingArticle']
  loading: boolean
  onBack(): void
  onStart(): void
}) {
  return (
    <View style={styles.screen}>
      <SecondaryButton compact label="返回文章列表" onPress={onBack} />
      {loading ? <ActivityIndicator color={COLORS.accent} /> : null}
      {!loading && !article ? (
        <InlineMessage tone="danger" text="这篇文章没有通过全文核验，已从目录移除。" />
      ) : null}
      {article ? (
        <>
          <Text style={styles.pageTitle}>{article.title}</Text>
          <Text style={styles.pageCopy}>{article.author} · {article.summary}</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>完整原文</Text>
            <Text style={styles.readingFullText}>{article.fullText}</Text>
          </View>
          <Text style={styles.mutedText}>底本：{article.sourceLabel} · 共 {article.segmentCount} 个录音句</Text>
          <PrimaryButton label="通读完成，开始逐句录音" onPress={onStart} />
        </>
      ) : null}
    </View>
  )
}

function PracticeScreen({
  authUserId,
  hasCurrentLegalConsent,
  catalog,
  ensureTrainingConnection,
  onPracticeTextChange,
  practiceText,
  preparedExpression,
  preparedLines,
  profileHasDialect,
  profileDialects,
  profileEtiology,
  profileSeverity,
  queue,
  trainingConnection,
  flow,
  initialCollectionSource,
  onBack,
}: {
  authUserId: string | null
  hasCurrentLegalConsent: boolean
  catalog: ReturnType<typeof useMobileTrainingCatalog>
  ensureTrainingConnection(): Promise<boolean>
  onPracticeTextChange(value: string): void
  practiceText: string
  preparedExpression: MobileWorkspaceSnapshotContract['prepared_expression']
  preparedLines: string[]
  profileHasDialect: boolean
  profileDialects: DialectProfile[]
  profileEtiology: string
  profileSeverity: string
  queue: ReturnType<typeof useNativeRecorderQueue>
  trainingConnection: ReturnType<typeof useLiveKitRoomConnection>
  flow: 'articulation_baseline' | 'collection'
  initialCollectionSource: MobileCollectionSource
  onBack(): void
}) {
  const [selectedExercise, setSelectedExercise] = useState<MobileTrainingExercise | null>(null)
  const [exerciseIndex, setExerciseIndex] = useState(0)
  const activeCaptureRef = useRef<MobileTrainingCaptureSnapshot | null>(null)
  const [feedback, setFeedback] = useState<MobileTrainingFeedback | null>(null)
  const [pendingAttempt, setPendingAttempt] = useState<MobilePendingAttempt | null>(null)
  const [pendingDialectTarget, setPendingDialectTarget] = useState<{
    exercise: MobileTrainingExercise
    utterancePairId: string
  } | null>(null)
  const [attemptAction, setAttemptAction] = useState<MobileAttemptAction>('idle')
  const [baselineAttempts, setBaselineAttempts] = useState<MobileArticulationBaselineAttempt[]>([])
  const [showRecordings, setShowRecordings] = useState(false)
  const collectionSource = initialCollectionSource
  const [environmentReady, setEnvironmentReady] = useState(false)
  const [distanceReady, setDistanceReady] = useState(false)
  const [consentReady, setConsentReady] = useState(false)
  const [ageBand, setAgeBand] = useState('')
  const [sex, setSex] = useState('')
  const [isReadingAssistancePlaying, setIsReadingAssistancePlaying] = useState(false)
  const [readingAssistanceStatus, setReadingAssistanceStatus] = useState<string | null>(null)
  const [exerciseSequenceStatus, setExerciseSequenceStatus] = useState<MobileExerciseSequenceStatus>('active')
  const readingAssistanceKeysRef = useRef<Set<string>>(new Set())
  const selectionScopeRef = useRef<string | null>(null)
  const materialExercises = useMemo(
    () => buildMobilePreparedMaterialExercises(preparedExpression),
    [preparedExpression],
  )
  const usesPreparedMaterial = flow === 'collection' && collectionSource === 'prepared_material'
  const visibleExercises = usesPreparedMaterial ? materialExercises : catalog.exercises
  const visibleTotal = usesPreparedMaterial ? materialExercises.length : catalog.total
  const selectedCategory = catalog.categories.find(
    (category) => category.id === catalog.selectedCategory,
  )
  const collectionPlanId = getMobileCollectionPlanId({
    category: catalog.selectedReadingArticle ? '完整文章' : selectedCategory?.id,
    usesPreparedMaterial,
  })
  const collectionPlan = MOBILE_COLLECTION_PLANS.find((plan) => plan.id === collectionPlanId)
  const targetText = practiceText.trim() || selectedExercise?.text || preparedLines[0] || '输入想练习的一句话'
  const effectiveExercise: MobileTrainingExercise = practiceText.trim()
    ? {
        id: `mobile-custom:${selectedExercise?.id ?? 'manual'}`,
        text: practiceText.trim(),
        category: '自定义练习',
      }
    : selectedExercise ?? {
        id: 'mobile-manual',
        text: targetText,
        category: '自定义练习',
      }
  const activeTargetText = pendingDialectTarget?.exercise.text ?? targetText
  const readingAssistanceKey = `${effectiveExercise.id}:${targetText}`
  const baselineSummary = summarizeMobileArticulationBaseline(
    baselineAttempts,
    flow === 'articulation_baseline' ? visibleTotal : 0,
  )
  const collectionControlState = getMobileCollectionControlState({
    environmentReady,
    distanceReady,
    understandsConsent: consentReady && hasCurrentLegalConsent,
  }, flow === 'articulation_baseline' ? '开始说这个词' : '开始说这句话')
  const attemptLocked = pendingAttempt !== null || attemptAction !== 'idle'
  const [selectedDialectKey, setSelectedDialectKey] = useState('')
  const selectedDialect = profileDialects.find((entry) => JSON.stringify(entry) === selectedDialectKey)
    ?? (profileDialects.length === 1 ? profileDialects[0] : undefined)
  const profileDialectName = selectedDialect?.name ?? ''
  const dialectPairEnabled = shouldOfferMobileDialectPair({
    hasDialect: profileHasDialect,
    dialectName: profileDialects[0]?.name,
    isAssessment: flow === 'articulation_baseline',
  })
  const activeSpeechVariant: MobileTrainingSpeechVariant = pendingDialectTarget ? 'dialect' : 'mandarin'
  const selectionScopeKey = usesPreparedMaterial
    ? `prepared:${preparedExpression?.id ?? 'none'}`
    : catalog.selectedReadingArticle
      ? `reading:${catalog.selectedReadingArticle.id}`
      : `category:${catalog.selectedCategory ?? 'none'}`

  useEffect(() => {
    const scopeChanged = selectionScopeRef.current !== selectionScopeKey
    const nextSelection = reconcileMobileExerciseSelection(
      visibleExercises,
      scopeChanged ? null : selectedExercise?.id ?? null,
    )
    selectionScopeRef.current = selectionScopeKey
    setSelectedExercise(nextSelection.exercise)
    setExerciseIndex(nextSelection.index)
    if (scopeChanged) setExerciseSequenceStatus('active')
  }, [selectedExercise?.id, selectionScopeKey, visibleExercises])

  useEffect(() => {
    if (!practiceText.trim()) setFeedback(null)
  }, [practiceText])

  useEffect(() => {
    Speech.stop()
    setIsReadingAssistancePlaying(false)
    setReadingAssistanceStatus(null)
  }, [readingAssistanceKey])

  useEffect(() => () => {
    Speech.stop()
  }, [])

  const playReadingAssistance = (): void => {
    if (queue.isRecording || attemptLocked || isReadingAssistancePlaying) return

    Speech.stop()
    setIsReadingAssistancePlaying(true)
    setReadingAssistanceStatus('正在准备朗读，听完后再开始录音。')
    Speech.speak(targetText, {
      language: 'zh-CN',
      rate: 0.85,
      onStart: () => {
        readingAssistanceKeysRef.current.add(readingAssistanceKey)
        setReadingAssistanceStatus('正在朗读，听完后再开始录音。')
      },
      onDone: () => {
        setIsReadingAssistancePlaying(false)
        setReadingAssistanceStatus('朗读完成，请按你平时的方式说。')
      },
      onStopped: () => setIsReadingAssistancePlaying(false),
      onError: () => {
        setIsReadingAssistancePlaying(false)
        setReadingAssistanceStatus('朗读没有完成，可以再点一次或换一句。')
      },
    })
  }

  const confirmDiscard = (item: MobileWorkbenchRecorderQueueItem): void => {
    Alert.alert(
      '删除这条录音？',
      item.syncStatus === 'uploaded' || item.syncStatus === 'indexed'
        ? '将同时撤回云端训练资产并删除本机录音。这个操作无法恢复。'
        : '将删除本机录音。这个操作无法恢复。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: item.syncStatus === 'uploaded' || item.syncStatus === 'indexed' ? '撤回并删除' : '删除录音',
          style: 'destructive',
          onPress: () => void queue.discard(item.recordingId),
        },
      ],
    )
  }

  const startTrainingAttempt = async (): Promise<boolean> => {
    if (activeCaptureRef.current || queue.isRecording || attemptAction !== 'idle') {
      return false
    }
    setFeedback(null)
    if (isReadingAssistancePlaying) {
      Alert.alert('示例还在朗读', '请等朗读结束后再开始录音。')
      return false
    }
    if (!collectionControlState.ready) {
      return false
    }
    const captureId = `mobile-training-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if (!authUserId) return false
    const speechVariant: MobileTrainingSpeechVariant = pendingDialectTarget ? 'dialect' : 'mandarin'
    if (speechVariant === 'dialect' && !selectedDialect) {
      Alert.alert('请选择方言', '请先选择本次录音使用的方言，也可以跳过。')
      return false
    }
    const utterancePairId = pendingDialectTarget?.utterancePairId
      ?? (dialectPairEnabled ? createMobileUtterancePairId() : undefined)
    const captureExercise = pendingDialectTarget?.exercise ?? effectiveExercise
    const captureSnapshot: MobileTrainingCaptureSnapshot = {
      captureId,
      contributorId: authUserId,
      exercise: captureExercise,
      exerciseIndex,
      preparedExpressionId: usesPreparedMaterial ? preparedExpression?.id : undefined,
      speechVariant,
      dialect: speechVariant === 'dialect' ? selectedDialect : undefined,
      utterancePairId,
    }
    activeCaptureRef.current = captureSnapshot
    const connectionPromise = ensureTrainingConnection()
    const started = await queue.startRecording(captureExercise.text, {
      sentenceId: captureExercise.id,
      source: flow === 'articulation_baseline' ? 'mobile_articulation_baseline' : usesPreparedMaterial ? 'mobile_prepared_material' : 'mobile_training_catalog',
      metadata: {
        exercise_category: captureExercise.category,
        training_flow: flow,
        collection_source: usesPreparedMaterial ? 'prepared_material' : 'catalog',
        collection_plan_id: collectionPlanId,
        baseline_protocol: flow === 'articulation_baseline' ? 'mandarin_articulation_baseline' : undefined,
        baseline_protocol_version: flow === 'articulation_baseline' ? '2026-09-13.v1' : undefined,
        reading_material_kind: catalog.selectedReadingArticle ? 'public_domain_classic' : undefined,
        reading_article_id: catalog.selectedReadingArticle?.id,
        reading_article_version: catalog.selectedReadingArticle?.version,
        reading_segment_id: catalog.selectedReadingArticle ? captureExercise.id : undefined,
        reading_segment_index: catalog.selectedReadingArticle ? exerciseIndex : undefined,
        reading_segment_count: catalog.selectedReadingArticle?.segmentCount,
        client_capture_id: captureId,
        age_band: ageBand.trim() || undefined,
        sex: sex.trim() || undefined,
        etiology: profileEtiology || undefined,
        severity: profileSeverity || undefined,
        reading_assistance_used: readingAssistanceKeysRef.current.has(readingAssistanceKey),
        ...buildMobileSpeechVariantMetadata({
          speechVariant,
          utterancePairId,
          dialectName: captureSnapshot.dialect?.name,
          dialectRegion: captureSnapshot.dialect?.region,
        }),
      },
    })
    if (!started) {
      activeCaptureRef.current = null
      return false
    }
    void connectionPromise.then(async (connected) => {
      if (!connected || activeCaptureRef.current?.captureId !== captureId) return
      await trainingConnection.startTrainingCapture(captureId, flow === 'articulation_baseline')
    })
    return true
  }

  const stopAndAnalyze = async (): Promise<void> => {
    const capture = activeCaptureRef.current
    if (!capture) return
    activeCaptureRef.current = null
    setAttemptAction('analyzing')
    const connected = trainingConnection.status === 'connected'
    const [item, stopped] = await Promise.all([
      queue.stopRecording(),
      connected
        ? trainingConnection.stopTrainingCapture(capture.captureId)
        : Promise.resolve(false),
    ])
    if (!item) {
      setAttemptAction('idle')
      return
    }
    if (!captureStillBelongsToContributor(capture, authUserId)) {
      setAttemptAction('idle')
      Alert.alert('账号已经切换', '这条录音已安全保存在原账号的本机队列中，请切回原账号后处理。')
      return
    }
    // Upload immediately after capture stops. Transcript analysis enriches the
    // local queue afterward; it must never gate durable audio persistence.
    void queue.uploadRecording(item.recordingId, item)
    const heardText = stopped || connected
      ? await trainingConnection.waitForFinalTranscript(capture.captureId)
      : ''
    const exercise = capture.exercise
    const nextFeedback = analyzeMobileTrainingAttempt(exercise, heardText)
    setFeedback(nextFeedback)
    const enrichedItem = await queue.attachRecognition(item.recordingId, heardText, {
      kind: 'training_result',
      exercise_id: exercise.id,
      exercise_text: exercise.text,
      target_text: exercise.text,
      raw_transcript: heardText,
      recognized_text: heardText,
      feedback_status: nextFeedback.status,
      clarity_score: nextFeedback.status === 'excellent'
        ? 0.95
        : nextFeedback.status === 'close' ? 0.78 : nextFeedback.status === 'retry' ? 0.48 : 0.2,
      missing_chars: nextFeedback.missingChars,
      extra_chars: nextFeedback.extraChars,
      ...(capture.preparedExpressionId
        ? { prepared_expression_id: capture.preparedExpressionId }
        : {}),
      ...buildMobileSpeechVariantMetadata({
        speechVariant: capture.speechVariant,
        utterancePairId: capture.utterancePairId,
        dialectName: capture.dialect?.name,
        dialectRegion: capture.dialect?.region,
      }),
    })
    const baselineAttempt = flow === 'articulation_baseline'
      ? {
          exerciseId: exercise.id,
          targetText: exercise.text,
          heardText,
          normalizedTarget: nextFeedback.normalizedTarget,
          normalizedHeard: nextFeedback.normalizedHeard,
          missingChars: nextFeedback.missingChars,
          extraChars: nextFeedback.extraChars,
          durationMs: item.recording.audio.durationMs,
          qualityDisposition: item.recording.audio.quality?.disposition,
        }
      : null
    setPendingAttempt({
      item: enrichedItem ?? item,
      feedback: nextFeedback,
      baselineAttempt,
      speechVariant: capture.speechVariant,
      utterancePairId: capture.utterancePairId,
    })
    setAttemptAction('idle')
  }

  const selectExerciseAt = (index: number): void => {
    const bounded = Math.max(0, Math.min(visibleExercises.length - 1, index))
    setExerciseIndex(bounded)
    setSelectedExercise(visibleExercises[bounded] ?? null)
    onPracticeTextChange('')
    setFeedback(null)
    setPendingDialectTarget(null)
    setExerciseSequenceStatus('active')
  }

  const confirmPendingAttempt = async (): Promise<void> => {
    if (!pendingAttempt || attemptAction !== 'idle') return
    setAttemptAction('uploading')
    const result = await confirmMobileTrainingAttempt(
      () => queue.uploadRecording(pendingAttempt.item.recordingId, pendingAttempt.item),
    )
    if (result === 'confirmed') {
      if (pendingAttempt.baselineAttempt) {
        const confirmedAttempt = pendingAttempt.baselineAttempt
        setBaselineAttempts((current) => [
          ...current.filter((entry) => entry.exerciseId !== confirmedAttempt.exerciseId),
          confirmedAttempt,
        ])
      }
      if (pendingAttempt.speechVariant === 'mandarin' && dialectPairEnabled && pendingAttempt.utterancePairId) {
        setPendingDialectTarget({
          exercise: {
            id: pendingAttempt.item.sentenceId ?? effectiveExercise.id,
            text: pendingAttempt.item.text,
            category: effectiveExercise.category,
          },
          utterancePairId: pendingAttempt.utterancePairId,
        })
        setPendingAttempt(null)
        setFeedback(null)
        Alert.alert(
          '普通话录音已收下',
          `接下来仍是同一句。可以用${profileDialectName || '方言'}自然地说一遍，也可以跳过。`,
        )
        setAttemptAction('idle')
        return
      }
      setPendingDialectTarget(null)
      setPendingAttempt(null)
      setFeedback(null)
      const advance = decideMobileAdvance({
        currentIndex: exerciseIndex,
        loadedCount: visibleExercises.length,
        totalCount: visibleTotal,
      })
      if (advance.kind === 'select_loaded') {
        selectExerciseAt(advance.index)
      } else if (advance.kind === 'load_more' && !usesPreparedMaterial) {
        const nextPage = await catalog.loadMore()
        const nextExercise = nextPage[0] ?? null
        if (nextExercise) {
          setExerciseIndex(advance.nextIndex)
          setSelectedExercise(nextExercise)
          onPracticeTextChange('')
          setExerciseSequenceStatus('active')
        } else {
          setExerciseSequenceStatus('load_failed')
        }
      } else {
        setExerciseSequenceStatus('complete')
      }
    }
    setAttemptAction('idle')
  }

  const skipDialectAttempt = (): void => {
    if (!pendingDialectTarget || attemptAction !== 'idle') return
    setPendingDialectTarget(null)
    setFeedback(null)
    const advance = decideMobileAdvance({
      currentIndex: exerciseIndex,
      loadedCount: visibleExercises.length,
      totalCount: visibleTotal,
    })
    if (advance.kind === 'select_loaded') {
      selectExerciseAt(advance.index)
    } else if (advance.kind === 'load_more' && !usesPreparedMaterial) {
      void catalog.loadMore().then((nextPage) => {
        const nextExercise = nextPage[0] ?? null
        if (!nextExercise) {
          setExerciseSequenceStatus('load_failed')
          return
        }
        setExerciseIndex(advance.nextIndex)
        setSelectedExercise(nextExercise)
        onPracticeTextChange('')
        setExerciseSequenceStatus('active')
      })
    } else {
      setExerciseSequenceStatus('complete')
    }
  }

  const discardPendingAttempt = async (): Promise<void> => {
    if (!pendingAttempt || attemptAction !== 'idle') return
    setAttemptAction('discarding')
    const result = await discardMobileTrainingAttempt(
      () => queue.discard(pendingAttempt.item.recordingId),
    )
    if (result === 'discarded') {
      setPendingAttempt(null)
      setFeedback(null)
    }
    setAttemptAction('idle')
  }

  const replacePendingAttempt = async (): Promise<void> => {
    if (!pendingAttempt || attemptAction !== 'idle') return
    setAttemptAction('replacing')
    const result = await replaceMobileTrainingAttempt(
      async () => {
        const discarded = await queue.discard(pendingAttempt.item.recordingId)
        if (discarded) {
          setPendingAttempt(null)
          setFeedback(null)
        }
        return discarded
      },
      startTrainingAttempt,
    )
    if (result === 'start_failed') {
      Alert.alert('旧录音已撤回', '新录音没有开始，请检查麦克风权限后重新点击录音。')
    }
    setAttemptAction('idle')
  }

  return (
    <View style={styles.screen}>
      <View style={styles.heroHeading}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: attemptLocked }} disabled={attemptLocked} onPress={onBack} style={styles.textAction}>
          <Text style={styles.textActionText}>← 返回练习选择</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{flow === 'articulation_baseline' ? '普通话基线' : '数据录入'}</Text>
        <Text style={styles.pageTitle}>
          {flow === 'articulation_baseline' ? '普通话构音表现基线' : '训练与数据录入'}
        </Text>
        <Text style={styles.pageCopy}>
          {flow === 'articulation_baseline'
            ? '按顺序逐字完成 50 个单音节，查看系统听懂和复测建议；结果不是临床诊断。'
            : `已选择「${usesPreparedMaterial ? '自定义材料' : catalog.selectedReadingArticle?.title ?? selectedCategory?.label ?? '当前材料'}」。确认一次后，可以连续录制这一组。`}
        </Text>
      </View>
      <>
          <View style={styles.trainingStage}>
            <View style={styles.trainingProgressRow}>
              <Text style={styles.cardLabel}>{usesPreparedMaterial ? '自定义材料' : catalog.selectedReadingArticle?.title ?? selectedCategory?.label ?? '训练题库'}</Text>
              <View style={styles.trainingProgressMeta}>
                {dialectPairEnabled ? (
                  <Text style={[styles.variantBadge, activeSpeechVariant === 'dialect' ? styles.variantBadgeDialect : null]}>
                    {activeSpeechVariant === 'dialect' ? `${profileDialectName || '方言'}表达` : '普通话表达'}
                  </Text>
                ) : null}
                <Text style={styles.trainingProgressText}>{exerciseIndex + 1} / {visibleTotal || 1}</Text>
              </View>
            </View>
            <Text style={styles.trainingTarget}>{activeTargetText}</Text>
            {activeSpeechVariant === 'dialect' ? (
              <Text style={styles.dialectPrompt}>同一句用你最自然的方言说法表达，不要求逐字对应普通话。</Text>
            ) : null}
            {activeSpeechVariant === 'dialect' ? <View style={styles.consentStack}>
              <Text style={styles.preflightCopy}>本次录音使用的方言（只标记这一条方言录音）</Text>
              <View style={styles.chipWrap}>{profileDialects.map((entry) => <Pressable key={JSON.stringify(entry)} accessibilityRole="radio"
                accessibilityLabel={`${entry.name}，${entry.region || '来源地区未填写'}`}
                accessibilityState={{ checked: selectedDialect === entry, disabled: queue.isRecording || attemptLocked }}
                disabled={queue.isRecording || attemptLocked} onPress={() => setSelectedDialectKey(JSON.stringify(entry))}
                style={[styles.filterChip, selectedDialect === entry ? styles.filterChipActive : null]}>
                <Text style={styles.filterChipText}>{entry.name} · {entry.region || '来源地区未填写'}</Text>
              </Pressable>)}</View>
            </View> : null}
            <View style={styles.preflightPanel}>
              <Text style={styles.preflightTitle}>{flow === 'articulation_baseline' ? '基线前确认' : '录音前确认'}</Text>
              <Text style={styles.preflightCopy}>只需确认一次，本组录音期间保持有效。</Text>
              <View style={styles.preflightChecklist}>
                <View style={styles.preflightShortRow}>
                  <Pressable
                    accessibilityLabel="环境安静"
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: environmentReady, disabled: queue.isRecording || attemptLocked }}
                    disabled={queue.isRecording || attemptLocked}
                    onPress={() => setEnvironmentReady((value) => !value)} style={[styles.preflightCheck, styles.preflightShortCheck, environmentReady ? styles.preflightCheckActive : null, queue.isRecording || attemptLocked ? styles.disabled : null]}>
                    <Text style={styles.checkMark}>{environmentReady ? '✓' : '○'}</Text>
                    <Text style={styles.preflightCheckText}>环境安静</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="麦克风位置稳定"
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: distanceReady, disabled: queue.isRecording || attemptLocked }}
                    disabled={queue.isRecording || attemptLocked}
                    onPress={() => setDistanceReady((value) => !value)} style={[styles.preflightCheck, styles.preflightShortCheck, distanceReady ? styles.preflightCheckActive : null, queue.isRecording || attemptLocked ? styles.disabled : null]}>
                    <Text style={styles.checkMark}>{distanceReady ? '✓' : '○'}</Text>
                    <Text style={styles.preflightCheckText}>位置稳定</Text>
                  </Pressable>
                </View>
                <Pressable
                    accessibilityLabel={hasCurrentLegalConsent ? (flow === 'articulation_baseline' ? '同意本次录音用于构音表现基线和系统改进' : '同意本次录音用于训练') : '当前账号需要重新登录并确认数据授权'}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: consentReady, disabled: queue.isRecording || attemptLocked }}
                    disabled={queue.isRecording || attemptLocked}
                    onPress={() => setConsentReady((value) => !value)} style={[styles.preflightCheck, consentReady ? styles.preflightCheckActive : null, queue.isRecording || attemptLocked ? styles.disabled : null]}>
                  <Text style={styles.checkMark}>{consentReady ? '✓' : '○'}</Text>
                  <Text style={styles.preflightCheckText}>{hasCurrentLegalConsent ? (flow === 'articulation_baseline' ? '我同意本次录音用于构音表现基线和系统改进' : '我同意本次录音用于训练') : '当前账号需要重新登录并确认数据授权'}</Text>
                </Pressable>
              </View>
              <Text accessibilityLiveRegion="polite" style={styles.preflightStatus}>
                {collectionControlState.ready ? '已确认，可以开始录音。' : '完成上面 3 项后即可开始。'}
              </Text>
            </View>
            <View style={styles.recordingMeta}>
              <Text style={styles.recordingMetaText}>
                {queue.isRecording ? '正在听你说' : feedback ? '本次反馈' : `麦克风${permissionLabel(queue.permissionStatus)}`}
              </Text>
              <Text style={styles.timer}>{formatDuration(queue.durationMs)}</Text>
            </View>
            <PrimaryButton
              disabled={!queue.isRecording && (!collectionControlState.ready || attemptLocked || isReadingAssistancePlaying || exerciseSequenceStatus !== 'active')}
              label={queue.isRecording ? '说完了' : exerciseSequenceStatus === 'complete' ? '本组已经完成' : exerciseSequenceStatus === 'load_failed' ? '下一句尚未加载' : attemptAction === 'analyzing' ? '正在整理本次录音…' : pendingAttempt ? '请先决定是否收录' : collectionControlState.actionLabel}
              onPress={() => {
                if (queue.isRecording) {
                  void stopAndAnalyze()
                } else {
                  void startTrainingAttempt()
                }
              }}
              tone={queue.isRecording ? 'neutral' : 'accent'}
            />
            {pendingDialectTarget && !queue.isRecording && !pendingAttempt ? (
              <SecondaryButton
                disabled={attemptAction !== 'idle'}
                label="这句先跳过方言"
                onPress={skipDialectAttempt}
              />
            ) : null}
            <View style={styles.readingAssistanceRow}>
              <Text style={styles.readingAssistancePrompt}>有字不认识？</Text>
              <SecondaryButton
                compact
                disabled={queue.isRecording || attemptLocked || isReadingAssistancePlaying}
                label={isReadingAssistancePlaying ? '正在朗读' : '听一下'}
                onPress={playReadingAssistance}
              />
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.readingAssistanceStatus}>
              {readingAssistanceStatus ?? '只在需要时播放，听完仍按你平时的方式说。'}
            </Text>
            {exerciseSequenceStatus === 'complete' ? (
              <InlineMessage tone="success" text="本组已经完成。选择其他材料，或主动返回上一句复练。" />
            ) : exerciseSequenceStatus === 'load_failed' ? (
              <InlineMessage tone="danger" text="录音已经收下，但下一页暂时没有加载成功。请点击下方“加载更多句子”继续。" />
            ) : null}
            {friendlyError(queue.errorMessage) ? (
              <InlineMessage tone="danger" text={friendlyError(queue.errorMessage) ?? ''} />
            ) : null}
            {feedback ? (
              <View style={styles.feedbackPanel}>
                <Text style={styles.feedbackLabel}>系统听到</Text>
                <Text style={styles.feedbackHeard}>{feedback.normalizedHeard || '暂时没有听清'}</Text>
                <Text style={styles.feedbackSummary}>{feedback.summary}</Text>
                <Text style={styles.mutedText}>{feedback.suggestion}</Text>
                {pendingAttempt ? (
                  <View style={styles.confirmationActions}>
                    <Text style={styles.confirmationHint}>录音仍保存在本机，确认后才会上传。</Text>
                    <PrimaryButton
                      disabled={attemptAction !== 'idle'}
                      label={attemptAction === 'uploading' ? '正在收录…' : '确认收录'}
                      onPress={() => void confirmPendingAttempt()}
                    />
                    <View style={styles.actionRow}>
                      <SecondaryButton disabled={attemptAction !== 'idle'} label="回听" onPress={() => queue.playRecording(pendingAttempt.item.recordingId)} />
                      <SecondaryButton disabled={attemptAction !== 'idle'} label={attemptAction === 'replacing' ? '正在替换…' : '重录这一句'} onPress={() => void replacePendingAttempt()} />
                      <SecondaryButton destructive disabled={attemptAction !== 'idle'} label={attemptAction === 'discarding' ? '正在撤回…' : '不收录'} onPress={() => void discardPendingAttempt()} />
                    </View>
                    <Text style={styles.confirmationHint}>重录会先撤回旧录音；撤回失败时不会开始新录音。</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {flow === 'articulation_baseline' ? (
              <View style={styles.articulationBaselineProgress}>
                <Text style={styles.categoryTitle}>{baselineSummary.label}</Text>
                <Text style={styles.mutedText}>{baselineSummary.summary}</Text>
                <View style={styles.reportItem}>
                  <Text style={styles.cardLabel}>普通话构音表现基线</Text>
                  <Text style={styles.reportText}>系统听懂 {baselineSummary.accuracyPercent}%</Text>
                  <Text style={styles.mutedText}>
                    个性化数据约 {baselineSummary.personalizationSeconds} 秒 / 5 分钟参考量
                  </Text>
                  <View style={styles.personalizationTrack}>
                    <View
                      style={[
                        styles.personalizationFill,
                        { width: `${baselineSummary.personalizationProgressPercent}%` },
                      ]}
                    />
                  </View>
                  {baselineSummary.patterns.length > 0 ? (
                    <Text style={styles.mutedText}>
                      本轮易混淆：{baselineSummary.patterns.map((pattern) => `${pattern.label}${pattern.count}次`).join('、')}
                    </Text>
                  ) : null}
                  <Text style={styles.mutedText}>{baselineSummary.nextAction}</Text>
                  <Text style={styles.reportBoundary}>{baselineSummary.boundary}</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.stepActions}>
              <SecondaryButton disabled={collectionControlState.navigationDisabled || exerciseIndex === 0 || queue.isRecording || attemptLocked} label="上一句" onPress={() => selectExerciseAt(exerciseIndex - 1)} />
              <SecondaryButton disabled={collectionControlState.navigationDisabled || exerciseIndex >= visibleExercises.length - 1 || queue.isRecording || attemptLocked} label="下一句" onPress={() => selectExerciseAt(exerciseIndex + 1)} />
            </View>
          </View>

          {!usesPreparedMaterial && catalog.exercises.length < catalog.total ? (
            <SecondaryButton
              disabled={catalog.status === 'loading' || queue.isRecording || attemptLocked}
              label={catalog.status === 'loading' ? '正在加载…' : '加载更多句子'}
              onPress={() => {
                void catalog.loadMore().then((nextPage) => {
                  if (exerciseSequenceStatus !== 'load_failed' || nextPage.length === 0) return
                  setExerciseIndex(exerciseIndex + 1)
                  setSelectedExercise(nextPage[0])
                  onPracticeTextChange('')
                  setExerciseSequenceStatus('active')
                })
              }}
            />
          ) : null}
        </>

      {flow === 'collection' ? (
        <View style={styles.optionalCollectionCard}>
          <Text style={styles.taskCardEyebrow}>可选：补充采集资料</Text>
        <Text style={styles.taskCardCopy}>{collectionPlan?.label ?? '常用表达'} · {collectionPlan?.description}</Text>
          {selectedExercise?.prompt_type === 'single_character' && selectedExercise.pronunciation_hint ? (
            <Text style={styles.mutedText}>读音提示：{selectedExercise.pronunciation_hint}</Text>
          ) : null}
          <View style={styles.inlineFields}>
            <View style={styles.inlineField}>
              <Text style={styles.fieldLabel}>年龄段</Text>
              <TextInput accessibilityLabel="年龄段" onChangeText={setAgeBand} placeholder="如 70–79" placeholderTextColor={COLORS.subtle} style={styles.smallInput} value={ageBand} />
            </View>
            <View style={styles.inlineField}>
              <Text style={styles.fieldLabel}>性别</Text>
              <TextInput accessibilityLabel="性别" onChangeText={setSex} placeholder="可不填" placeholderTextColor={COLORS.subtle} style={styles.smallInput} value={sex} />
            </View>
          </View>
        </View>
      ) : null}

      {flow === 'collection' ? <View style={styles.customPracticePanel}>
        <Text style={styles.fieldLabel}>改成自己的句子</Text>
        <TextInput
          accessibilityLabel="练习句"
          editable={!queue.isRecording && !attemptLocked}
          multiline
          onChangeText={onPracticeTextChange}
          placeholder={preparedLines[0] ?? '输入想练习的一句话'}
          placeholderTextColor={COLORS.subtle}
          style={styles.practiceInput}
          value={practiceText}
        />
        <Text style={styles.mutedText}>输入后会替换上方目标句；录完先由你确认，网络失败时仍留在本机。</Text>
      </View> : null}

      <><Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showRecordings }}
        onPress={() => setShowRecordings((value) => !value)}
        style={styles.recordingDisclosure}
      >
        <Text style={styles.sectionTitle}>录音记录</Text>
        <Text style={styles.sectionAside}>{queue.items.length} 条 · {showRecordings ? '收起' : '查看'}</Text>
      </Pressable>
      {showRecordings ? <><SectionHeader
        aside={`${queue.items.length} 条`}
        title="本机录音"
      />
      {queue.items.length === 0 ? (
        <EmptyState text="完成第一条录音后，可以在这里回放或上传。" />
      ) : (
        <View style={styles.recordingList}>
          {queue.items.map((item) => (
            <View key={item.recordingId} style={styles.recordingItem}>
              <Text numberOfLines={2} style={styles.recordingText}>{item.text}</Text>
              <View style={styles.recordingItemMeta}>
                <Text style={styles.mutedText}>{syncLabel(item.syncStatus)}</Text>
                <Text style={styles.mutedText}>
                  {formatDuration(item.recording.audio.durationMs)}
                </Text>
              </View>
              {item.lastError ? (
                <InlineMessage tone="danger" text="上次上传没有完成，可以稍后重试。" />
              ) : null}
              <View style={styles.actionRow}>
                <SecondaryButton
                  label="回放"
                  onPress={() => queue.playRecording(item.recordingId)}
                />
                <SecondaryButton
                  disabled={
                    item.syncStatus === 'uploaded'
                    || item.syncStatus === 'indexed'
                    || queue.uploadingRecordingId === item.recordingId
                  }
                  label={
                    queue.uploadingRecordingId === item.recordingId
                      ? '上传中…'
                      : item.syncStatus === 'uploaded' || item.syncStatus === 'indexed'
                        ? '已上传'
                        : '上传'
                  }
                  onPress={() => void queue.uploadRecording(item.recordingId)}
                />
                <SecondaryButton
                  destructive
                  disabled={queue.uploadingRecordingId === item.recordingId}
                  label="删除"
                  onPress={() => confirmDiscard(item)}
                />
              </View>
            </View>
          ))}
        </View>
      )}</> : null}</>
    </View>
  )
}

function MemoryScreen({
  editor,
  errorMessage,
  loading,
  onRefresh,
  readModel,
  snapshot,
}: {
  editor: ReturnType<typeof useMobileMemoryEditor>
  errorMessage: string | null
  loading: boolean
  onRefresh(): void
  readModel: MobileWorkspaceReadModel
  snapshot: MobileWorkspaceSnapshotContract | null
}) {
  const [section, setSection] = useState<'overview' | 'materials' | 'profile' | 'scenes' | 'phrases'>('overview')
  const [materialId, setMaterialId] = useState<string | undefined>()
  const [materialTitle, setMaterialTitle] = useState('')
  const [materialContent, setMaterialContent] = useState('')
  const [materialSource, setMaterialSource] = useState('manual_input')
  const [materialStatus, setMaterialStatus] = useState<string | null>(null)
  const [profileDocument, setProfileDocument] = useState('')
  const [profileEtiology, setProfileEtiology] = useState('')
  const [profileSeverity, setProfileSeverity] = useState('')
  const [profileScenarios, setProfileScenarios] = useState('')
  const [profileRiskyTerms, setProfileRiskyTerms] = useState('')
  const [profileStrategies, setProfileStrategies] = useState('')
  const [phraseId, setPhraseId] = useState<string | undefined>()
  const [phraseText, setPhraseText] = useState('')
  const [hotwordId, setHotwordId] = useState<string | undefined>()
  const [hotwordPhrase, setHotwordPhrase] = useState('')
  const [hotwordCategory, setHotwordCategory] = useState<MobileHotwordProfile['category']>('custom')
  const [hotwordScenario, setHotwordScenario] = useState('')
  const [hotwordNote, setHotwordNote] = useState('')
  const [sceneStatus, setSceneStatus] = useState<string | null>(null)
  const busy = loading || editor.status === 'loading' || editor.status === 'saving'

  useEffect(() => {
    const profile = snapshot?.user_profile_memory
    setProfileEtiology(profile?.etiology ?? '')
    setProfileSeverity(profile?.severity ?? '')
    setProfileDocument(profile?.document ?? '')
    setProfileScenarios((profile?.common_scenarios ?? []).join('\n'))
    setProfileRiskyTerms((profile?.risky_terms ?? []).join('\n'))
    setProfileStrategies((profile?.support_strategies ?? []).join('\n'))
  }, [snapshot?.user_profile_memory])

  useEffect(() => {
    const templatePhrases = new Set(
      editor.sceneTemplates
        .filter((template) => editor.selectedSceneTemplateIds.includes(template.id))
        .flatMap((template) => template.hotwords.map((entry) => entry.phrase.trim().toLocaleLowerCase())),
    )
    editor.hydrateHotwords(
      (snapshot?.expression_kit.hotword_profiles ?? []).filter(
        (profile) => !templatePhrases.has(profile.phrase.trim().toLocaleLowerCase()),
      ),
    )
  }, [editor.sceneTemplates, editor.selectedSceneTemplateIds, snapshot?.expression_kit.hotword_profiles])

  const editMaterial = (id?: string): void => {
    const asset = editor.library?.assets.find((item) => item.draft.id === id)
    setMaterialId(asset?.draft.id)
    setMaterialTitle(asset?.draft.title ?? '')
    setMaterialContent(asset?.draft.content ?? '')
    setMaterialSource(asset?.draft.source ?? 'manual_input')
    setMaterialStatus(null)
  }

  const importMaterialFile = async (): Promise<void> => {
    setMaterialStatus(null)
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/markdown'],
        copyToCacheDirectory: true,
        multiple: false,
      })
      if (result.canceled) return
      const asset = result.assets[0]
      if (!asset) return
      if (typeof asset.size === 'number' && asset.size > 512_000) {
        setMaterialStatus('文件超过 500 KB，请换一份更短的 .txt 或 .md。')
        return
      }
      const lowerName = asset.name.toLowerCase()
      if (!lowerName.endsWith('.txt') && !lowerName.endsWith('.md') && !lowerName.endsWith('.text')) {
        setMaterialStatus('请选择 .txt 或 .md 文本文件。')
        return
      }
      const content = await new File(asset.uri).text()
      if (!content.trim()) {
        setMaterialStatus('这个文件没有可用文字。')
        return
      }
      setMaterialContent(content)
      setMaterialSource(asset.name)
      if (!materialTitle.trim()) {
        setMaterialTitle(asset.name.replace(/\.(?:md|txt|text)$/i, ''))
      }
      setMaterialStatus('文件已读入，保存后会由同一套规则自动切句。')
    } catch {
      setMaterialStatus('文件读取失败，请换一份 .txt 或 .md 再试。')
    }
  }

  const saveMaterial = async (): Promise<void> => {
    if (!materialTitle.trim() || !materialContent.trim()) return
    const saved = await editor.saveMaterial({
      id: materialId,
      title: materialTitle.trim(),
      content: materialContent.trim(),
      source: materialSource,
      make_active: !materialId,
    })
    if (saved) {
      editMaterial(undefined)
      onRefresh()
      setMaterialStatus('材料已保存并完成统一切句，可以在训练页直接录音。')
    }
  }

  const splitLines = (value: string): string[] => value
    .split(/\n|，|；/)
    .map((item) => item.trim())
    .filter(Boolean)

  const resetHotwordEditor = (): void => {
    setHotwordId(undefined)
    setHotwordPhrase('')
    setHotwordCategory('custom')
    setHotwordScenario('')
    setHotwordNote('')
  }

  const saveHotword = async (): Promise<void> => {
    const nextProfiles = upsertMobileHotwordProfile(editor.hotwordProfiles, {
      id: hotwordId,
      phrase: hotwordPhrase,
      category: hotwordCategory,
      scenario: hotwordScenario,
      note: hotwordNote,
    })
    if (await editor.saveHotwords(nextProfiles)) {
      resetHotwordEditor()
      onRefresh()
    }
  }

  const toggleSceneTemplate = async (templateId: string): Promise<void> => {
    setSceneStatus(null)
    const selected = editor.selectedSceneTemplateIds.includes(templateId)
    const nextIds = selected
      ? editor.selectedSceneTemplateIds.filter((id) => id !== templateId)
      : [...editor.selectedSceneTemplateIds, templateId]
    if (await editor.saveSceneTemplateSelection(nextIds)) {
      setSceneStatus(selected ? '这套模板已停用。' : '这套模板已启用，下次沟通会自动带上重点词和策略。')
      onRefresh()
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.heroHeading}>
        <Text style={styles.eyebrow}>沟通准备</Text>
        <Text style={styles.pageTitle}>把要说的话放在手边</Text>
        <Text style={styles.pageCopy}>这里与网页版使用同一份沟通档案。</Text>
      </View>

      <View accessibilityRole="tablist" style={styles.segmentedTabs}>
        {([
          ['overview', '概览'],
          ['materials', '材料'],
          ['profile', '画像'],
          ['scenes', '场景'],
          ['phrases', '短句'],
        ] as const).map(([id, label]) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: section === id }}
            key={id}
            onPress={() => setSection(id)}
            style={[styles.segmentedTab, section === id ? styles.segmentedTabActive : null]}
          >
            <Text style={[styles.segmentedTabText, section === id ? styles.segmentedTabTextActive : null]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {section === 'overview' ? <><View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderCopy}>
            <Text style={styles.cardLabel}>下一次重点</Text>
            <Text style={styles.cardTitle}>
              {readModel.immediateGoal || '先准备一句最重要的话'}
            </Text>
          </View>
          <SecondaryButton
            compact
            disabled={loading}
            label={loading ? '同步中' : '同步'}
            onPress={onRefresh}
          />
        </View>
        {errorMessage ? <InlineMessage tone="danger" text={errorMessage} /> : null}
      </View>

      <SectionHeader title={readModel.preparedTitle || '准备好的表达'} />
      {readModel.preparedSummary ? (
        <Text style={styles.sectionSummary}>{readModel.preparedSummary}</Text>
      ) : null}
      {readModel.priorityLines.length === 0 ? (
        <EmptyState text={readModel.localEmptyState} />
      ) : (
        <View style={styles.preparedList}>
          {readModel.priorityLines.map((line, index) => (
            <View key={`${line}-${index}`} style={styles.preparedItem}>
              <Text style={styles.preparedIndex}>{String(index + 1).padStart(2, '0')}</Text>
              <Text style={styles.preparedText}>{line}</Text>
            </View>
          ))}
        </View>
      )}

      <SectionHeader title="随时可用" />
      <View style={styles.chipWrap}>
        {readModel.quickPhrases.map((phrase) => (
          <View key={phrase} style={styles.chip}>
            <Text style={styles.chipText}>{phrase}</Text>
          </View>
        ))}
      </View>

      <SectionHeader title="训练回顾" />
      <View style={styles.reportGrid}>
        <View style={styles.reportItem}>
          <Text style={styles.cardLabel}>今天</Text>
          <Text style={styles.reportText}>
            {snapshot?.prepared_expression?.training_reports?.daily_summary?.summary
              ?? '完成练习后，今天最值得继续的重点会出现在这里。'}
          </Text>
        </View>
        <View style={styles.reportItem}>
          <Text style={styles.cardLabel}>最近 7 天</Text>
          <Text style={styles.reportText}>
            {snapshot?.prepared_expression?.training_reports?.weekly_summary?.summary
              ?? '积累几次练习后，再看稳定规律，不急着给自己下结论。'}
          </Text>
        </View>
      </View>
      </> : null}

      {section === 'materials' ? <>
        <View style={styles.sectionIntro}>
          <Text style={styles.sectionTitle}>自定义材料</Text>
          <Text style={styles.mutedText}>保存后会同步到 Web，并可直接进入训练切句。</Text>
        </View>
        {(editor.library?.assets ?? []).map((asset) => {
          const active = editor.library?.active_asset_id === asset.draft.id
          return (
            <View key={asset.draft.id} style={[styles.libraryItem, active ? styles.libraryItemActive : null]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderCopy}>
                  <Text style={styles.cardTitle}>{asset.draft.title}</Text>
                  <Text numberOfLines={2} style={styles.mutedText}>{asset.structured.summary}</Text>
                </View>
                {active ? <Text style={styles.activeBadge}>正在使用</Text> : null}
              </View>
              <View style={styles.actionRow}>
                {!active ? <SecondaryButton label="设为当前" onPress={() => void editor.activateMaterial(asset.draft.id).then(onRefresh)} /> : null}
                <SecondaryButton label="编辑" onPress={() => editMaterial(asset.draft.id)} />
                <SecondaryButton destructive label="删除" onPress={() => Alert.alert(
                  '删除这份材料？',
                  'Web 和 App 中都会删除，无法恢复。',
                  [
                    { text: '取消', style: 'cancel' },
                    { text: '删除', style: 'destructive', onPress: () => void editor.deleteMaterial(asset.draft.id).then(onRefresh) },
                  ],
                )} />
              </View>
            </View>
          )
        })}
        <View style={styles.editorPanel}>
          <Text style={styles.cardTitle}>{materialId ? '编辑材料' : '新增材料'}</Text>
          <TextInput accessibilityLabel="材料标题" editable={!busy} onChangeText={setMaterialTitle} placeholder="例如：下次复诊要说的话" placeholderTextColor={COLORS.subtle} style={styles.input} value={materialTitle} />
          <SecondaryButton disabled={busy} label="从手机导入 .txt / .md" onPress={() => void importMaterialFile()} />
          <TextInput
            accessibilityLabel="材料正文"
            editable={!busy}
            multiline
            onChangeText={(value) => {
              setMaterialContent(value)
              setMaterialSource('manual_input')
              setMaterialStatus(null)
            }}
            placeholder="粘贴或输入完整材料"
            placeholderTextColor={COLORS.subtle}
            style={[styles.practiceInput, styles.materialInput]}
            value={materialContent}
          />
          <Text style={styles.mutedText}>系统会按与 Web 相同的标点、段落和长度规则切句。</Text>
          {materialStatus ? <Text accessibilityLiveRegion="polite" style={styles.outputStatus}>{materialStatus}</Text> : null}
          <View style={styles.actionRow}>
            {materialId ? <SecondaryButton label="取消编辑" onPress={() => editMaterial(undefined)} /> : null}
            <PrimaryButton disabled={busy || !materialTitle.trim() || !materialContent.trim()} label={busy ? '正在保存…' : '保存材料'} onPress={() => void saveMaterial()} />
          </View>
        </View>
      </> : null}

      {section === 'profile' ? <View style={styles.editorPanel}>
        <Text style={styles.cardTitle}>我的沟通画像</Text>
        <Text style={styles.mutedText}>只写对沟通有帮助的事实，不需要医学化描述自己。</Text>
        <Text style={styles.fieldLabel}>希望别人怎样理解我</Text>
        <TextInput accessibilityLabel="沟通画像" editable={!busy} multiline onChangeText={setProfileDocument} placeholder="例如：我理解没有问题，但需要更多时间把话说完整。" placeholderTextColor={COLORS.subtle} style={styles.practiceInput} value={profileDocument} />
        <View style={styles.inlineFields}>
          <View style={styles.inlineField}><Text style={styles.fieldLabel}>情况 / 病因（可选）</Text><View style={styles.chipWrap}>{([['unknown', '暂不确定'], ['stroke', '脑卒中'], ['parkinsons', '帕金森'], ['cerebral_palsy', '脑瘫'], ['brain_injury', '脑损伤'], ['hearing_loss', '听力相关'], ['neuromuscular', '神经肌肉'], ['other', '其他']] as const).map(([id, label]) => <Pressable accessibilityRole="button" accessibilityState={{ selected: profileEtiology === id }} key={id} onPress={() => setProfileEtiology(profileEtiology === id ? '' : id)} style={[styles.filterChip, profileEtiology === id ? styles.filterChipActive : null]}><Text style={[styles.filterChipText, profileEtiology === id ? styles.filterChipTextActive : null]}>{label}</Text></Pressable>)}</View></View>
          <View style={styles.inlineField}><Text style={styles.fieldLabel}>表达支持程度（可选）</Text><View style={styles.chipWrap}>{([['unsure', '暂不确定'], ['mild', '较少支持'], ['moderate', '中等支持'], ['severe', '较多支持']] as const).map(([id, label]) => <Pressable accessibilityRole="button" accessibilityState={{ selected: profileSeverity === id }} key={id} onPress={() => setProfileSeverity(profileSeverity === id ? '' : id)} style={[styles.filterChip, profileSeverity === id ? styles.filterChipActive : null]}><Text style={[styles.filterChipText, profileSeverity === id ? styles.filterChipTextActive : null]}>{label}</Text></Pressable>)}</View></View>
        </View>
        <Text style={styles.fieldLabel}>常见场景（每行一项）</Text>
        <TextInput accessibilityLabel="常见沟通场景" editable={!busy} multiline onChangeText={setProfileScenarios} placeholder="工作会议\n就医沟通" placeholderTextColor={COLORS.subtle} style={styles.practiceInput} value={profileScenarios} />
        <Text style={styles.fieldLabel}>容易被听错的词（每行一项）</Text>
        <TextInput accessibilityLabel="容易被听错的词" editable={!busy} multiline onChangeText={setProfileRiskyTerms} placeholder="药名\n人名\n专业词" placeholderTextColor={COLORS.subtle} style={styles.practiceInput} value={profileRiskyTerms} />
        <Text style={styles.fieldLabel}>有效支持方式（每行一项）</Text>
        <TextInput accessibilityLabel="有效支持方式" editable={!busy} multiline onChangeText={setProfileStrategies} placeholder="让我先说完\n必要时看手机文字" placeholderTextColor={COLORS.subtle} style={styles.practiceInput} value={profileStrategies} />
        <PrimaryButton disabled={busy} label={busy ? '正在保存…' : '保存画像'} onPress={() => void editor.saveProfile({
          ...snapshot?.user_profile_memory,
          etiology: profileEtiology.trim(),
          severity: profileSeverity.trim(),
          document: profileDocument.trim(),
          common_scenarios: splitLines(profileScenarios),
          risky_terms: splitLines(profileRiskyTerms),
          support_strategies: splitLines(profileStrategies),
        }).then((saved) => { if (saved) onRefresh() })} />
      </View> : null}

      {section === 'scenes' ? <>
        <View style={styles.sectionIntro}>
          <Text style={styles.sectionTitle}>场景模板</Text>
          <Text style={styles.mutedText}>模板由系统统一维护；你决定启用哪些，沟通时会自动带上对应策略和重点词。</Text>
        </View>
        {sceneStatus ? <InlineMessage tone="success" text={sceneStatus} /> : null}
        {editor.sceneTemplates.map((template) => {
          const selected = editor.selectedSceneTemplateIds.includes(template.id)
          return (
            <View key={template.id} style={[styles.libraryItem, selected ? styles.libraryItemActive : null]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderCopy}>
                  <Text style={styles.cardTitle}>{template.title}</Text>
                  <Text style={styles.mutedText}>{template.summary}</Text>
                </View>
                {selected ? <Text style={styles.activeBadge}>已启用</Text> : null}
              </View>
              <Text style={styles.mutedText}>目标：{template.communication_goal}</Text>
              <View style={styles.chipWrap}>
                {template.hotwords.slice(0, 6).map((item) => <View key={`${template.id}-${item.phrase}`} style={styles.chip}><Text style={styles.chipText}>{item.phrase}</Text></View>)}
              </View>
              <Text style={styles.mutedText}>开口句：{template.starter_phrases.slice(0, 2).join('；')}</Text>
              <SecondaryButton disabled={busy} label={selected ? '停用这套模板' : '启用这套模板'} onPress={() => void toggleSceneTemplate(template.id)} />
            </View>
          )
        })}

        <View style={styles.sectionIntro}>
          <Text style={styles.sectionTitle}>我的重点词</Text>
          <Text style={styles.mutedText}>添加人名、药名、地点或专业词，Web、App 和语音助手会使用同一份列表。</Text>
        </View>
        {editor.hotwordProfiles.map((profile) => (
          <View key={profile.id} style={styles.phraseEditorRow}>
            <View style={styles.cardHeaderCopy}>
              <Text style={styles.preparedText}>{profile.phrase}</Text>
              <Text style={styles.mutedText}>{profile.scenario || '通用场景'}{profile.note ? ` · ${profile.note}` : ''}</Text>
            </View>
            <View style={styles.compactActions}>
              <SecondaryButton compact label="编辑" onPress={() => {
                setHotwordId(profile.id)
                setHotwordPhrase(profile.phrase)
                setHotwordCategory(profile.category)
                setHotwordScenario(profile.scenario)
                setHotwordNote(profile.note ?? '')
              }} />
              <SecondaryButton compact destructive label="删除" onPress={() => Alert.alert(
                '删除这个重点词？',
                'Web、App 和后续沟通中都会移除。',
                [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void editor.saveHotwords(removeMobileHotwordProfile(editor.hotwordProfiles, profile.id)).then((saved) => { if (saved) onRefresh() }) }],
              )} />
            </View>
          </View>
        ))}
        <View style={styles.editorPanel}>
          <Text style={styles.cardTitle}>{hotwordId ? '编辑重点词' : '新增重点词'}</Text>
          <TextInput accessibilityLabel="重点词" editable={!busy} onChangeText={setHotwordPhrase} placeholder="例如：左旋多巴" placeholderTextColor={COLORS.subtle} style={styles.input} value={hotwordPhrase} />
          <TextInput accessibilityLabel="重点词使用场景" editable={!busy} onChangeText={setHotwordScenario} placeholder="例如：神经内科复诊" placeholderTextColor={COLORS.subtle} style={styles.input} value={hotwordScenario} />
          <TextInput accessibilityLabel="重点词备注" editable={!busy} onChangeText={setHotwordNote} placeholder="可选：希望系统特别注意什么" placeholderTextColor={COLORS.subtle} style={styles.input} value={hotwordNote} />
          <View style={styles.chipWrap}>
            {([
              ['custom', '通用'], ['medical', '医疗'], ['profession', '工作'],
              ['family', '家庭'], ['daily', '日常'], ['emergency', '紧急'],
            ] as const).map(([id, label]) => (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: hotwordCategory === id }} key={id} onPress={() => setHotwordCategory(id)} style={[styles.filterChip, hotwordCategory === id ? styles.filterChipActive : null]}>
                <Text style={[styles.filterChipText, hotwordCategory === id ? styles.filterChipTextActive : null]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actionRow}>
            {hotwordId ? <SecondaryButton label="取消" onPress={resetHotwordEditor} /> : null}
            <PrimaryButton disabled={busy || !hotwordPhrase.trim()} label={busy ? '正在保存…' : '保存重点词'} onPress={() => void saveHotword()} />
          </View>
        </View>
      </> : null}

      {section === 'phrases' ? <>
        <View style={styles.sectionIntro}>
          <Text style={styles.sectionTitle}>常用短句</Text>
          <Text style={styles.mutedText}>沟通页和 Web 会使用同一份短句。</Text>
        </View>
        {editor.phrases.map((phrase) => (
          <View key={phrase.id} style={styles.phraseEditorRow}>
            <Text style={styles.preparedText}>{phrase.text}</Text>
            <View style={styles.compactActions}>
              <SecondaryButton compact label="编辑" onPress={() => { setPhraseId(phrase.id); setPhraseText(phrase.text) }} />
              <SecondaryButton compact destructive label="删除" onPress={() => Alert.alert(
                '删除这条短句？',
                'Web 和 App 中都会删除。',
                [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void editor.deletePhrase(phrase.id).then(onRefresh) }],
              )} />
            </View>
          </View>
        ))}
        <View style={styles.editorPanel}>
          <Text style={styles.cardTitle}>{phraseId ? '编辑短句' : '新增短句'}</Text>
          <TextInput accessibilityLabel="常用短句内容" editable={!busy} onChangeText={setPhraseText} placeholder="例如：请让我把这句话说完" placeholderTextColor={COLORS.subtle} style={styles.input} value={phraseText} />
          <View style={styles.actionRow}>
            {phraseId ? <SecondaryButton label="取消" onPress={() => { setPhraseId(undefined); setPhraseText('') }} /> : null}
            <PrimaryButton disabled={busy || !phraseText.trim()} label={busy ? '正在保存…' : '保存短句'} onPress={() => void editor.savePhrase({ id: phraseId, text: phraseText.trim() }).then((saved) => {
              if (saved) { setPhraseId(undefined); setPhraseText(''); onRefresh() }
            })} />
          </View>
        </View>
      </> : null}

      {editor.errorMessage ? <InlineMessage tone="danger" text={editor.errorMessage} /> : null}
    </View>
  )
}

function AccountScreen({
  apiConfigured,
  auth,
  diagnosticStatus,
  onRequestPermission,
  onSendDiagnostics,
  onSignOut,
  onSync,
  pendingDiagnosticCount,
  permissionStatus,
  phoneAuthEnabled,
  queueCount,
  workspaceReady,
}: {
  apiConfigured: boolean
  auth: ReturnType<typeof useMobileAuth>
  diagnosticStatus: MobileDiagnosticSyncStatus
  onRequestPermission(): void
  onSendDiagnostics(): void
  onSignOut(): void
  onSync(): void
  pendingDiagnosticCount: number
  permissionStatus: string
  phoneAuthEnabled: boolean
  queueCount: number
  workspaceReady: boolean
}) {
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [bindingCodeSent, setBindingCodeSent] = useState(false)
  const [bindingMessage, setBindingMessage] = useState(
    '绑定后，邮箱和手机号都可以登录同一个账号。',
  )
  const isBinding = auth.status === 'binding_phone'

  const requestBindingCode = async (): Promise<void> => {
    let normalizedPhone: string
    try {
      normalizedPhone = normalizeMainlandPhone(phone)
    } catch {
      setBindingMessage('手机号格式不正确。')
      return
    }

    const requested = await auth.requestPhoneBindingCode(normalizedPhone)
    if (requested) {
      setBindingCodeSent(true)
      setBindingMessage(`验证码已发送至 ${displayMainlandPhone(normalizedPhone)}，5 分钟内有效。`)
    }
  }

  const verifyBindingCode = async (): Promise<void> => {
    let normalizedPhone: string
    try {
      normalizedPhone = normalizeMainlandPhone(phone)
    } catch {
      setBindingMessage('手机号格式不正确。')
      return
    }
    if (!/^\d{6}$/.test(otp)) {
      setBindingMessage('请输入短信中的 6 位验证码。')
      return
    }

    const verified = await auth.verifyPhoneBindingCode({ phone: normalizedPhone, otp })
    if (verified) {
      setBindingCodeSent(false)
      setOtp('')
      setBindingMessage('手机号已绑定，原邮箱和全部数据保持不变。')
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.heroHeading}>
        <Text style={styles.eyebrow}>我的</Text>
        <Text style={styles.pageTitle}>账户与设备</Text>
        <Text style={styles.pageCopy}>只保留开始沟通前真正需要确认的状态。</Text>
      </View>

          <View style={styles.profileCard}>
        <View style={styles.avatar}><Text style={styles.avatarText}>V</Text></View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileEmail}>
            {auth.user?.email ?? auth.user?.phone ?? `${mobileBrand.name}用户`}
          </Text>
          <Text style={styles.mutedText}>{mobileBrand.name}账户</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.cardLabel}>更多登录选择</Text>
          <Text style={styles.cardTitle}>手机号登录</Text>
          <Text style={styles.mutedText}>邮箱登录会继续保留，手机号只是同一账号的另一种入口。</Text>
        </View>
        {auth.user?.phone ? (
          <InlineMessage
            tone="success"
            text={`已绑定 ${displayMainlandPhone(auth.user.phone)}，现在可以使用短信验证码登录。`}
          />
        ) : phoneAuthEnabled ? (
          <>
            <Text style={styles.fieldLabel}>中国大陆手机号</Text>
            <TextInput
              accessibilityLabel="绑定中国大陆手机号"
              editable={!isBinding && !bindingCodeSent}
              keyboardType="phone-pad"
              onChangeText={setPhone}
              placeholder="138 1234 5678"
              placeholderTextColor={COLORS.subtle}
              style={styles.input}
              textContentType="telephoneNumber"
              value={phone}
            />
            {bindingCodeSent ? (
              <>
                <Text style={styles.fieldLabel}>6 位验证码</Text>
                <TextInput
                  accessibilityLabel="绑定验证码"
                  editable={!isBinding}
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="短信验证码"
                  placeholderTextColor={COLORS.subtle}
                  style={[styles.input, styles.otpInput]}
                  textContentType="oneTimeCode"
                  value={otp}
                />
              </>
            ) : null}
            <Text style={styles.loginHint}>{bindingMessage}</Text>
            {friendlyError(auth.errorMessage) ? (
              <InlineMessage tone="danger" text={friendlyError(auth.errorMessage) ?? ''} />
            ) : null}
            <PrimaryButton
              disabled={isBinding}
              label={isBinding
                ? '正在处理…'
                : bindingCodeSent ? '确认绑定' : '发送绑定验证码'}
              onPress={() => void (bindingCodeSent ? verifyBindingCode() : requestBindingCode())}
            />
            {bindingCodeSent ? (
              <Pressable
                accessibilityRole="button"
                disabled={isBinding}
                onPress={() => {
                  setBindingCodeSent(false)
                  setOtp('')
                  setBindingMessage('可以修改手机号后重新发送验证码。')
                }}
                style={styles.textAction}
              >
                <Text style={styles.textActionText}>修改手机号</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <Text style={styles.loginHint}>手机号登录尚未开放，现有邮箱登录不受影响。</Text>
        )}
      </View>

      <View style={styles.settingList}>
        <SettingRow
          action="检查"
          label="麦克风权限"
          onPress={onRequestPermission}
          value={permissionLabel(permissionStatus)}
        />
        <SettingRow
          action="同步"
          label="沟通资料"
          onPress={onSync}
          value={workspaceReady ? '已同步' : '等待同步'}
        />
        <SettingRow
          label="待上传录音"
          value={`${queueCount} 条`}
        />
        <SettingRow
          label="在线服务"
          value={apiConfigured ? '可用' : '暂不可用'}
        />
        <SettingRow
          action="发送"
          label="自动诊断"
          onPress={onSendDiagnostics}
          value={diagnosticLabel(diagnosticStatus, pendingDiagnosticCount)}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onSignOut}
        style={({ pressed }) => [styles.signOutButton, pressed ? styles.pressed : null]}
      >
        <Text style={styles.signOutText}>退出登录</Text>
      </Pressable>
      <Text style={styles.privacyCopy}>
        本地录音在你删除前会保留在这台设备上。诊断不包含录音、转写、聊天内容或登录凭据。
      </Text>
      <LegalDocumentLinks />
    </View>
  )
}

function BottomNavigation({
  activeSurfaceId,
  onChange,
}: {
  activeSurfaceId: MobileWorkbenchSurfaceId
  onChange(surfaceId: MobileWorkbenchSurfaceId): void
}) {
  return (
    <View accessibilityRole="tablist" style={styles.bottomNavigation}>
      {MOBILE_WORKBENCH_SURFACES.map((surface) => {
        const active = surface.id === activeSurfaceId
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={surface.id}
            onPress={() => onChange(surface.id)}
            style={({ pressed }) => [styles.navItem, pressed ? styles.pressed : null]}
          >
            <View style={[styles.navMark, active ? styles.navMarkActive : null]} />
            <Text style={[styles.navLabel, active ? styles.navLabelActive : null]}>
              {surface.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function PrimaryButton({
  disabled = false,
  label,
  onPress,
  tone = 'accent',
}: {
  disabled?: boolean
  label: string
  onPress(): void
  tone?: 'accent' | 'neutral'
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        tone === 'neutral' ? styles.primaryButtonNeutral : null,
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  )
}

function SecondaryButton({
  compact = false,
  destructive = false,
  disabled = false,
  label,
  onPress,
}: {
  compact?: boolean
  destructive?: boolean
  disabled?: boolean
  label: string
  onPress(): void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        compact ? styles.secondaryButtonCompact : null,
        destructive ? styles.secondaryButtonDestructive : null,
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[
        styles.secondaryButtonText,
        destructive ? styles.secondaryButtonTextDestructive : null,
      ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function SectionHeader({ title, aside }: { title: string; aside?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {aside ? <Text style={styles.sectionAside}>{aside}</Text> : null}
    </View>
  )
}

function ConsentToggle({ label, checked, onPress }: { label: string; checked: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={styles.consentRow}>
      <Text style={styles.consentCheck}>{checked ? '✓' : '○'}</Text>
      <Text style={styles.consentLabel}>{label}</Text>
    </Pressable>
  )
}

function LegalDocumentLinks() {
  const openDocument = (path: string): void => {
    void Linking.openURL(`${LEGAL_BASE_URL}${path}`).catch(() => {
      Alert.alert('暂时无法打开', `请在浏览器访问 ${LEGAL_BASE_URL}${path}`)
    })
  }

  return (
    <View accessibilityRole="summary" style={styles.legalLinks}>
      <Pressable accessibilityRole="link" onPress={() => openDocument('/privacy')}>
        <Text style={styles.legalLinkText}>查看《生声不息隐私政策》</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => openDocument('/terms')}>
        <Text style={styles.legalLinkText}>查看《生声不息用户服务协议》</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => openDocument('/data-collection')}>
        <Text style={styles.legalLinkText}>查看《数据采集说明》</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => openDocument('/third-party-services')}>
        <Text style={styles.legalLinkText}>查看《第三方服务与 SDK 清单》</Text>
      </Pressable>
    </View>
  )
}

function unifiedConsentLabel(): string {
  return '我已阅读并统一同意《生声不息用户服务协议》《生声不息隐私政策》《数据采集说明》，并同意处理语音及健康相关敏感信息，以及将授权数据用于模型训练、评测、产品改进和服务运营等商业用途'
}

function InlineMessage({ text, tone }: { text: string; tone: 'danger' | 'success' }) {
  return (
    <View style={[
      styles.inlineMessage,
      tone === 'success' ? styles.inlineMessageSuccess : styles.inlineMessageDanger,
    ]}
    >
      <Text style={[
        styles.inlineMessageText,
        tone === 'success' ? styles.inlineMessageTextSuccess : styles.inlineMessageTextDanger,
      ]}
      >
        {text}
      </Text>
    </View>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>{text}</Text>
    </View>
  )
}

function SettingRow({
  action,
  label,
  onPress,
  value,
}: {
  action?: string
  label: string
  onPress?: () => void
  value: string
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      {action && onPress ? (
        <Pressable
          accessibilityLabel={`${action}${label}`}
          accessibilityRole="button"
          onPress={onPress}
          style={({ pressed }) => [styles.inlineAction, pressed ? styles.pressed : null]}
        >
          <Text style={styles.inlineActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
  },
  appShell: { flex: 1 },
  content: { flex: 1 },
  pageContent: { paddingHorizontal: 20, paddingBottom: 32 },
  standaloneQuickPage: { paddingTop: 18 },
  screen: { gap: 18 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 12,
  },
  wordmark: { color: COLORS.ink, fontSize: 18, fontWeight: '800' },
  headerEmail: { color: COLORS.muted, fontSize: 11, marginTop: 2, maxWidth: 180 },
  statusBadge: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusDot: { backgroundColor: COLORS.success, borderRadius: 999, height: 6, width: 6 },
  statusBadgeText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  heroHeading: { paddingBottom: 4, paddingTop: 18 },
  eyebrow: { color: COLORS.accent, fontSize: 13, fontWeight: '800', marginBottom: 8 },
  pageTitle: { color: COLORS.ink, fontSize: 29, fontWeight: '800', lineHeight: 37 },
  pageCopy: { color: COLORS.muted, fontSize: 15, lineHeight: 23, marginTop: 8 },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  readingFullText: { color: COLORS.ink, fontSize: 16, lineHeight: 28, marginTop: 12 },
  modeCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    minHeight: 190,
    padding: 20,
  },
  modeCardAccent: { backgroundColor: COLORS.accentSoft, borderColor: '#E7BCA4' },
  modeCardDark: { backgroundColor: COLORS.ink, borderColor: COLORS.ink },
  modeCardEyebrow: { color: COLORS.accent, fontSize: 12, fontWeight: '800' },
  modeCardEyebrowDark: { color: '#F1B99D' },
  modeCardTitle: { color: COLORS.ink, fontSize: 25, fontWeight: '800', lineHeight: 33 },
  modeCardTitleDark: { color: '#FFFFFF' },
  modeCardCopy: { color: COLORS.muted, fontSize: 15, lineHeight: 23 },
  modeCardCopyDark: { color: '#D6CEC6' },
  modeCardAction: { color: COLORS.accent, fontSize: 14, fontWeight: '800', marginTop: 'auto' },
  modeCardActionDark: { color: '#F1B99D' },
  quickPhraseGrid: { gap: 8 },
  quickPhraseButton: {
    backgroundColor: COLORS.surfaceMuted,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  quickPhraseButtonActive: { backgroundColor: COLORS.accentSoft, borderColor: '#E7BCA4' },
  quickPhraseButtonText: { color: COLORS.ink, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  communicationCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 18,
    padding: 20,
  },
  sceneBar: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 14,
  },
  sceneBarCopy: { flex: 1 },
  connectionRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  liveDot: { backgroundColor: COLORS.subtle, borderRadius: 999, height: 8, width: 8 },
  liveDotActive: { backgroundColor: COLORS.success },
  connectionText: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
  displayPhrase: { color: COLORS.ink, fontSize: 25, fontWeight: '700', lineHeight: 37 },
  liveTranscript: { color: COLORS.ink, fontSize: 21, fontWeight: '700', lineHeight: 31 },
  outputActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  outputStatus: { color: COLORS.muted, fontSize: 13, lineHeight: 20 },
  partnerView: {
    alignItems: 'center',
    backgroundColor: COLORS.ink,
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingVertical: 36,
  },
  partnerLabel: { color: '#D6CEC6', fontSize: 16, fontWeight: '700' },
  partnerText: { color: '#FFFFFF', fontSize: 42, fontWeight: '800', lineHeight: 58, textAlign: 'center' },
  partnerCloseButton: { backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  partnerCloseText: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.accent,
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  primaryButtonNeutral: { backgroundColor: COLORS.ink },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceMuted,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  secondaryButtonCompact: { flex: 0, minHeight: 40, paddingHorizontal: 14 },
  secondaryButtonDestructive: { backgroundColor: COLORS.dangerSoft, borderColor: COLORS.dangerSoft },
  secondaryButtonText: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  secondaryButtonTextDestructive: { color: COLORS.danger },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
  sectionHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '800' },
  sectionAside: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
  sectionSummary: { color: COLORS.muted, fontSize: 14, lineHeight: 22, marginTop: -10 },
  phraseList: { gap: 8 },
  phraseButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  phraseButtonActive: { backgroundColor: COLORS.accentSoft, borderColor: COLORS.accentSoft },
  phraseButtonText: { color: COLORS.ink, flex: 1, fontSize: 15, lineHeight: 22 },
  phraseArrow: { color: COLORS.accent, fontSize: 24, marginLeft: 12 },
  fieldLabel: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  input: {
    backgroundColor: COLORS.surfaceMuted,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    color: COLORS.ink,
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  practiceInput: {
    backgroundColor: COLORS.surfaceMuted,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    color: COLORS.ink,
    fontSize: 17,
    lineHeight: 26,
    minHeight: 92,
    padding: 14,
    textAlignVertical: 'top',
  },
  taskCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 9,
    padding: 18,
  },
  taskCardEyebrow: { color: COLORS.accent, fontSize: 12, fontWeight: '800' },
  taskCardTitle: { color: COLORS.ink, fontSize: 21, fontWeight: '800', lineHeight: 29 },
  taskCardCopy: { color: COLORS.muted, fontSize: 14, lineHeight: 22 },
  practiceStartCard: {
    backgroundColor: COLORS.accentSoft,
    borderColor: '#E7BCA4',
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    minHeight: 190,
    padding: 20,
  },
  practiceStartHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  practiceCountBadge: { backgroundColor: COLORS.surface, borderRadius: 999, color: COLORS.muted, fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 6 },
  practiceStartTitle: { color: COLORS.ink, fontSize: 25, fontWeight: '800', lineHeight: 34 },
  practiceStartAction: { color: COLORS.accent, fontSize: 15, fontWeight: '800', marginTop: 'auto' },
  ownMaterialCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 9,
    padding: 18,
  },
  materialAction: { color: COLORS.accent, fontSize: 14, fontWeight: '800', marginTop: 4 },
  materialChoiceList: { gap: 8 },
  materialChoiceRow: { alignItems: 'center', backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', minHeight: 64, padding: 13 },
  materialChoiceRowActive: { backgroundColor: COLORS.successSoft, borderColor: '#B8D4C7' },
  practiceTopicList: { gap: 9 },
  practiceTopicRow: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 82,
    padding: 14,
  },
  practiceTopicRowFeatured: { backgroundColor: '#FFF8ED', borderColor: '#EACB98' },
  practiceTopicMeta: { alignItems: 'flex-end', gap: 6 },
  readingBadge: { backgroundColor: '#F3E2C5', borderRadius: 999, color: '#7D4B17', fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4 },
  articulationBaselineEntry: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceMuted,
    borderColor: COLORS.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 16,
  },
  signedOutQuickCard: {
    backgroundColor: COLORS.accentSoft,
    borderColor: '#E7BCA4',
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    marginBottom: 16,
    padding: 18,
    width: '100%',
  },
  checkMark: { color: COLORS.accent, fontSize: 17, fontWeight: '800' },
  preflightPanel: { backgroundColor: '#312A25', borderColor: '#514840', borderRadius: 16, borderWidth: 1, gap: 10, padding: 14 },
  preflightTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  preflightCopy: { color: '#D6CEC6', fontSize: 13, lineHeight: 20 },
  preflightChecklist: { gap: 8 },
  preflightShortRow: { flexDirection: 'row', gap: 8 },
  preflightCheck: { alignItems: 'center', backgroundColor: '#211D1A', borderColor: '#62574F', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
  preflightShortCheck: { flex: 1 },
  preflightCheckActive: { backgroundColor: '#26372F', borderColor: '#6D9B82' },
  preflightCheckText: { color: '#F5F1ED', flex: 1, fontSize: 14, lineHeight: 20 },
  preflightStatus: { color: '#D6CEC6', fontSize: 12, lineHeight: 18 },
  inlineFields: { flexDirection: 'row', gap: 10 },
  inlineField: { flex: 1, gap: 6 },
  smallInput: { backgroundColor: COLORS.surfaceMuted, borderColor: COLORS.border, borderRadius: 10, borderWidth: 1, color: COLORS.ink, minHeight: 42, paddingHorizontal: 10 },
  trainingStage: { backgroundColor: COLORS.ink, borderRadius: 24, gap: 18, padding: 22 },
  trainingProgressRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  trainingProgressMeta: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  trainingProgressText: { color: '#CFC7BF', fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '800' },
  variantBadge: { backgroundColor: '#DCE9F4', borderRadius: 999, color: '#244D68', fontSize: 11, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 5 },
  variantBadgeDialect: { backgroundColor: '#F3E2C5', color: '#7D4B17' },
  trainingTarget: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', lineHeight: 43 },
  dialectPrompt: { color: '#F3E2C5', fontSize: 13, lineHeight: 20 },
  readingAssistanceRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  readingAssistancePrompt: { color: '#E9E2DB', fontSize: 13, lineHeight: 20 },
  readingAssistanceStatus: { color: '#CFC7BF', fontSize: 12, lineHeight: 18 },
  feedbackPanel: { backgroundColor: '#312A25', borderRadius: 16, gap: 6, padding: 15 },
  feedbackLabel: { color: '#D4A68E', fontSize: 12, fontWeight: '800' },
  feedbackHeard: { color: '#FFFFFF', fontSize: 21, fontWeight: '800', lineHeight: 30 },
  feedbackSummary: { color: '#E9E2DB', fontSize: 14, lineHeight: 21 },
  confirmationActions: { borderTopColor: '#514840', borderTopWidth: 1, gap: 10, marginTop: 8, paddingTop: 14 },
  confirmationHint: { color: '#CFC7BF', fontSize: 12, lineHeight: 18 },
  articulationBaselineProgress: { backgroundColor: COLORS.surfaceMuted, borderRadius: 14, gap: 4, padding: 14 },
  stepActions: { flexDirection: 'row', gap: 8 },
  optionalCollectionCard: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, gap: 10, padding: 14 },
  customPracticePanel: { borderTopColor: COLORS.border, borderTopWidth: 1, gap: 10, paddingTop: 18 },
  recordingDisclosure: { alignItems: 'center', borderTopColor: COLORS.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 56 },
  categoryList: { gap: 8, marginTop: 6 },
  categoryRow: {
    alignItems: 'center',
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  categoryCopy: { flex: 1, gap: 3 },
  categoryTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  categoryCount: { color: COLORS.accent, fontSize: 12, fontWeight: '800' },
  exerciseList: { gap: 8 },
  exerciseRow: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  exerciseRowActive: { backgroundColor: COLORS.accentSoft, borderColor: COLORS.accent },
  exerciseIndex: { color: COLORS.accent, fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '800' },
  exerciseText: { color: COLORS.ink, flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 22 },
  recordingMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  recordingMetaText: { color: COLORS.muted, fontSize: 13 },
  timer: { color: COLORS.ink, fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '800' },
  recordingList: { gap: 10 },
  recordingItem: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 15,
  },
  recordingText: { color: COLORS.ink, fontSize: 16, fontWeight: '700', lineHeight: 24 },
  recordingItemMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  mutedText: { color: COLORS.muted, fontSize: 13, lineHeight: 20 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inlineMessage: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  inlineMessageDanger: { backgroundColor: COLORS.dangerSoft },
  inlineMessageSuccess: { backgroundColor: COLORS.successSoft },
  inlineMessageText: { fontSize: 13, lineHeight: 19 },
  inlineMessageTextDanger: { color: COLORS.danger },
  inlineMessageTextSuccess: { color: COLORS.success },
  emptyState: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
  },
  emptyStateText: { color: COLORS.muted, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  cardHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  cardHeaderCopy: { flex: 1 },
  cardLabel: { color: COLORS.accent, fontSize: 12, fontWeight: '800', marginBottom: 7 },
  cardTitle: { color: COLORS.ink, fontSize: 20, fontWeight: '800', lineHeight: 29 },
  preparedList: { gap: 8 },
  preparedItem: {
    alignItems: 'flex-start',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 15,
  },
  preparedIndex: { color: COLORS.accent, fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '800', paddingTop: 3 },
  preparedText: { color: COLORS.ink, flex: 1, fontSize: 15, lineHeight: 23 },
  segmentedTabs: { backgroundColor: '#EAE4DC', borderRadius: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 3, padding: 4 },
  segmentedTab: { alignItems: 'center', borderRadius: 10, flexBasis: 64, flexGrow: 1, justifyContent: 'center', minHeight: 42 },
  segmentedTabActive: { backgroundColor: COLORS.surface },
  segmentedTabText: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
  segmentedTabTextActive: { color: COLORS.ink, fontWeight: '800' },
  filterChip: { backgroundColor: COLORS.surfaceMuted, borderColor: COLORS.border, borderRadius: 999, borderWidth: 1, minHeight: 38, paddingHorizontal: 12, justifyContent: 'center' },
  filterChipActive: { backgroundColor: COLORS.accentSoft, borderColor: COLORS.accent },
  filterChipText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: COLORS.accent, fontWeight: '800' },
  sectionIntro: { gap: 5, paddingTop: 2 },
  libraryItem: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, gap: 13, padding: 16 },
  libraryItemActive: { borderColor: COLORS.accent },
  activeBadge: { backgroundColor: COLORS.accentSoft, borderRadius: 999, color: COLORS.accent, fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 },
  editorPanel: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 20, borderWidth: 1, gap: 13, padding: 17 },
  materialInput: { minHeight: 180 },
  phraseEditorRow: { alignItems: 'flex-start', backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 14 },
  compactActions: { flexDirection: 'row', gap: 6 },
  reportGrid: { gap: 10 },
  reportItem: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 16, borderWidth: 1, padding: 16 },
  reportText: { color: COLORS.ink, fontSize: 14, lineHeight: 23 },
  trainingReportPreview: { gap: 10, paddingTop: 4 },
  personalizationTrack: { height: 6, overflow: 'hidden', borderRadius: 999, backgroundColor: COLORS.border },
  personalizationFill: { height: 6, borderRadius: 999, backgroundColor: COLORS.accent },
  reportBoundary: { color: COLORS.subtle, fontSize: 12, lineHeight: 18 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: COLORS.accentSoft, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  chipText: { color: '#6E3A24', fontSize: 13, fontWeight: '700' },
  profileCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: COLORS.ink,
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  profileCopy: { flex: 1 },
  profileEmail: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  settingList: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  settingRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 68,
  },
  settingCopy: { flex: 1 },
  settingLabel: { color: COLORS.ink, fontSize: 15, fontWeight: '700' },
  settingValue: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  inlineAction: { justifyContent: 'center', minHeight: 44, paddingLeft: 18 },
  inlineActionText: { color: COLORS.accent, fontSize: 14, fontWeight: '800' },
  signOutButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 50,
  },
  signOutText: { color: COLORS.danger, fontSize: 15, fontWeight: '800' },
  bottomNavigation: {
    backgroundColor: COLORS.surface,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingBottom: 8,
    paddingHorizontal: 10,
    paddingTop: 7,
  },
  navItem: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 52 },
  navMark: { backgroundColor: COLORS.subtle, borderRadius: 999, height: 5, marginBottom: 7, width: 5 },
  navMarkActive: { backgroundColor: COLORS.accent, width: 20 },
  navLabel: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
  navLabelActive: { color: COLORS.ink },
  loginPage: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  brandMark: {
    alignItems: 'center',
    backgroundColor: COLORS.ink,
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    marginBottom: 24,
    width: 52,
  },
  brandMarkText: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  loginTitle: { color: COLORS.ink, fontSize: 31, fontWeight: '800', lineHeight: 40 },
  loginCopy: { color: COLORS.muted, fontSize: 15, lineHeight: 23, marginTop: 10 },
  loginCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 11,
    marginTop: 30,
    padding: 18,
  },
  loginMethodRow: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  loginMethodTab: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  loginMethodTabActive: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  loginMethodText: { color: COLORS.muted, fontSize: 14, fontWeight: '700' },
  loginMethodTextActive: { color: COLORS.ink },
  loginHint: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 10,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  registrationFields: { gap: 10, marginTop: 8 },
  registrationField: { gap: 6 },
  registrationStepActive: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },
  consentStack: { borderTopColor: COLORS.border, borderTopWidth: 1, gap: 10, marginTop: 4, paddingTop: 12 },
  consentRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, minHeight: 38 },
  consentCheck: { color: COLORS.accent, fontSize: 18, fontWeight: '800', lineHeight: 22 },
  consentLabel: { color: COLORS.muted, flex: 1, fontSize: 12, lineHeight: 19 },
  legalLinks: { gap: 8, marginBottom: 2 },
  legalLinkText: { color: COLORS.accent, fontSize: 12, fontWeight: '700', lineHeight: 19, textDecorationLine: 'underline' },
  otpInput: { fontSize: 20, letterSpacing: 8, textAlign: 'center' },
  phoneCodeActions: { flexDirection: 'row', justifyContent: 'space-between' },
  textAction: { alignItems: 'center', justifyContent: 'center', minHeight: 40, paddingHorizontal: 4 },
  textActionText: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },
  privacyCopy: { color: COLORS.muted, fontSize: 12, lineHeight: 19, marginTop: 14, textAlign: 'center' },
})
