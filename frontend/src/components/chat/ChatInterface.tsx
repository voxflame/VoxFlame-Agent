/**
 * ChatInterface Component
 * Current RTC/RTM communication surface
 * 
 * 对话界面组件 - 温暖、无障碍友好设计
 */

'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRtcAgentSession, ConversationMessage } from '@/hooks/useRtcAgentSession'
import { useWorkspaceMemorySnapshot } from '@/hooks/useWorkspaceMemorySnapshot'
import WaveformVisualizer from '@/components/WaveformVisualizer'
import { UserNav } from '@/components/ui/user-nav'
import { MicrophoneInputFeedback } from '@/components/runtime/MicrophoneInputFeedback'
import type { RtcScene } from '@/lib/realtime-audio/session-contract'
import { memoryService } from '@/lib/memory/memory-service'
import type { WorkspaceMemorySnapshot } from '@/lib/memory/workspace-snapshot'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  ClipboardCopy,
  RotateCcw,
  ScreenShare,
  Volume2,
} from 'lucide-react'

interface ChatInterfaceProps {
  userId?: string
  accessToken?: string
  isAuthenticated?: boolean
  onReturnHome?: () => void
}

type ConfirmedOutputMode = 'display' | 'copy' | 'speech'

function toRtcScene(sceneId: WorkspaceMemorySnapshot['expression_kit']['active_scene_id']): RtcScene | undefined {
  if (sceneId === 'workplace') {
    return 'work'
  }

  if (sceneId === 'caregiver') {
    return 'family'
  }

  return sceneId ?? undefined
}

function buildPreparationContextUpdate(
  snapshot: WorkspaceMemorySnapshot | null,
  runtimeScene: RtcScene | undefined,
  selectedItemIds: string[],
) {
  const preparation = snapshot?.preparation
  const preparedExpression = snapshot?.prepared_expression
  const communicationLoadout = snapshot?.communication_loadout
  if (!preparation && !preparedExpression && !communicationLoadout) {
    return null
  }

  const selectedItemIdSet = new Set(selectedItemIds)
  const selectedLoadoutEntries = communicationLoadout?.sections.flatMap((section) => (
    section.items
      .filter((item) => item.required || selectedItemIdSet.has(item.id))
      .map((item) => ({
        sectionTitle: section.title,
        item,
      }))
  )) ?? []
  const includesCustomMaterial = selectedLoadoutEntries.some(
    (entry) => entry.item.source_type === 'custom_material',
  )
  const includesSceneTemplate = selectedLoadoutEntries.some(
    (entry) => entry.item.source_type === 'scene_template',
  )

  const selectedCustomMaterials = selectedLoadoutEntries
    .filter((entry) => entry.item.source_type === 'custom_material')
    .map((entry) => entry.item)
  const selectedSceneTemplates = selectedLoadoutEntries
    .filter((entry) => entry.item.source_type === 'scene_template')
    .map((entry) => entry.item)

  const documentContent =
    includesCustomMaterial
      ? Array.from(
        new Set(
          selectedCustomMaterials
            .map((item) => item.document_content?.trim() || '')
            .filter(Boolean),
        ),
      ).join('\n\n')
        || preparation?.document_content?.trim()
        || preparedExpression?.document_content?.trim()
        || ''
      : ''
  const referenceLines = includesCustomMaterial
    ? Array.from(
      new Set(
        [
          ...selectedCustomMaterials.flatMap((item) => item.reference_lines ?? []),
          ...(preparation?.reference_lines ?? []),
          ...(preparedExpression?.reference_lines ?? []),
        ]
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    ).slice(0, 16)
    : []
  const hotwords = includesSceneTemplate
    ? Array.from(
      new Set(
        [
          ...selectedSceneTemplates.flatMap((item) => item.hotwords ?? []),
          ...(preparation?.hotwords ?? []),
        ]
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).slice(0, 8)
    : []
  const riskyTerms = includesSceneTemplate
    ? Array.from(
      new Set(
        [
          ...selectedSceneTemplates.flatMap((item) => item.risky_terms ?? []),
          ...(preparation?.risky_terms ?? []),
        ]
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).slice(0, 6)
    : []
  const loadoutItems = Array.from(
    new Set(
      selectedLoadoutEntries.map(({ sectionTitle, item }) => (
        `${item.required ? '默认' : '手动'} | ${sectionTitle} | ${item.title}${item.summary.trim() ? `：${item.summary.trim()}` : ''}`
      )),
    ),
  ).slice(0, 6)
  const loadoutReason = communicationLoadout?.reason?.trim() ?? ''
  const immediateGoal = preparation?.immediate_goal?.trim()
    || (
      runtimeScene
        ? `优先在 ${runtimeScene} 场景下先说清最关键的一句。`
        : '优先先把当前最关键的一句说清楚。'
    )
  const profileSummaryParts = [
    preparation?.profile_summary?.trim() ?? '',
    preparation?.scene_brief?.trim() ?? '',
    loadoutReason,
  ].filter(Boolean)
  const listenerGuidance = Array.from(
    new Set([
      ...(preparation?.listener_guidance ?? []),
      includesSceneTemplate && preparation?.scene_brief
        ? `场景提醒：${preparation.scene_brief}`
        : '',
      '紧急沟通时先保住诉求、关键词和补救句，不要为了完整度牺牲速度。',
    ].filter(Boolean)),
  )
  const supportStrategies = Array.from(
    new Set([
      ...selectedSceneTemplates.flatMap((item) => item.support_strategies ?? []),
      ...(preparation?.support_strategies ?? []),
      '优先先说关键词和关键诉求，再决定是否展开补充。',
    ].filter(Boolean)),
  ).slice(0, 4)

  return {
    scene: runtimeScene ?? null,
    immediate_goal: immediateGoal,
    profile_summary: profileSummaryParts.join(' '),
    listener_guidance: listenerGuidance,
    support_strategies: supportStrategies,
    hotwords: hotwords,
    risky_terms: riskyTerms,
    document_summary:
      includesCustomMaterial
        ? (preparation?.document_context_summary ?? preparedExpression?.summary ?? '')
        : '',
    document_content: documentContent,
    reference_lines: referenceLines,
    training_pairs: [],
    loadout_mode: communicationLoadout?.recommended_mode ?? 'urgent',
    loadout_reason: loadoutReason,
    loadout_items: loadoutItems,
  }
}

function buildDefaultSelectedLoadoutItemIds(
  loadout: WorkspaceMemorySnapshot['communication_loadout'] | null,
): string[] {
  if (!loadout) {
    return []
  }

  return loadout.sections.flatMap((section) => (
    section.items
      .filter((item) => item.required || item.default_selected)
      .map((item) => item.id)
  ))
}

export default function ChatInterface({
  userId,
  accessToken,
  isAuthenticated = false,
  onReturnHome,
}: ChatInterfaceProps) {
  const {
    isConnecting,
    isConnected,
    isRecording,
    isThinking,
    sessionId,
    currentASRText,
    currentResponseText,
    messages,
    error,
    analyser,
    connect,
    disconnect,
    stopRecording,
    toggleRecording,
    sendText,
    sendControlEvent,
  } = useRtcAgentSession({
    userId,
    accessToken,
    surface: 'communication_workspace',
  })

  const [textInput, setTextInput] = useState('')
  const messagesScrollRef = useRef<HTMLElement | null>(null)
  const lastPreparationSyncKeyRef = useRef<string | null>(null)
  const pendingPreparationSyncKeyRef = useRef<string | null>(null)
  const [isCaptionMode, setIsCaptionMode] = useState(false)
  const [microphoneEnvironmentWarning, setMicrophoneEnvironmentWarning] = useState<string | null>(null)
  const [confirmedOutputText, setConfirmedOutputText] = useState('')
  const [confirmedOutputSourceId, setConfirmedOutputSourceId] = useState<string | null>(null)
  const [confirmedOutputStatus, setConfirmedOutputStatus] = useState<string | null>(null)
  const [isListenerDisplayOpen, setIsListenerDisplayOpen] = useState(false)
  const [isListenerDisplayFlipped, setIsListenerDisplayFlipped] = useState(false)
  const [isSpeakingConfirmedOutput, setIsSpeakingConfirmedOutput] = useState(false)
  const {
    snapshot: workspaceSnapshot,
  } = useWorkspaceMemorySnapshot({
    userId,
    isAuthenticated,
  })

  useEffect(() => {
    const scrollElement = messagesScrollRef.current
    if (!scrollElement) {
      return
    }

    scrollElement.scrollTop = scrollElement.scrollHeight
  }, [messages, currentASRText, currentResponseText, isRecording, isThinking])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    window.scrollTo({ top: 0, left: 0 })

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (!window.isSecureContext) {
      setMicrophoneEnvironmentWarning('当前页面无法使用麦克风。')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneEnvironmentWarning('当前浏览器不支持语音，请使用系统浏览器。')
      return
    }

    setMicrophoneEnvironmentWarning(null)
  }, [])

  useEffect(() => {
    if (!isConnected) {
      lastPreparationSyncKeyRef.current = null
      return
    }

    void sendControlEvent('caption_mode_update', {
      enabled: isCaptionMode,
    })
  }, [isCaptionMode, isConnected, sendControlEvent])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space to toggle recording (when connected)
      if (e.code === 'Space' && !e.repeat && isConnected && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        toggleRecording()
      }
      // Escape to exit fullscreen caption mode
      if (e.code === 'Escape' && isCaptionMode) {
        setIsCaptionMode(false)
      }
      if (e.code === 'Escape' && isListenerDisplayOpen) {
        setIsListenerDisplayOpen(false)
      }
      // Escape to stop recording
      if (e.code === 'Escape' && isRecording) {
        stopRecording()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCaptionMode, isConnected, isListenerDisplayOpen, isRecording, toggleRecording, stopRecording])

  // Handle text submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (textInput.trim()) {
      void sendText(textInput.trim())
      setTextInput('')
    }
  }

  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant'),
    [messages],
  )

  useEffect(() => {
    if (!latestAssistantMessage || latestAssistantMessage.id === confirmedOutputSourceId) {
      return
    }

    setConfirmedOutputText(latestAssistantMessage.content)
    setConfirmedOutputSourceId(latestAssistantMessage.id)
    setConfirmedOutputStatus('已更新为最新整理文本')
  }, [confirmedOutputSourceId, latestAssistantMessage])

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const recordConfirmedOutputAction = (mode: ConfirmedOutputMode, text: string) => {
    memoryService.updateCurrentSessionMetadata({
      latestConfirmedOutputText: text,
      latestConfirmedOutputMode: mode,
      latestConfirmedOutputAt: new Date().toISOString(),
    })
  }

  const handleOpenListenerDisplay = () => {
    if (!hasConfirmedOutput) {
      setConfirmedOutputStatus('先确认一段要给对方看的文字')
      return
    }

    recordConfirmedOutputAction('display', trimmedConfirmedOutput)
    setIsListenerDisplayOpen(true)
    setConfirmedOutputStatus('已打开大字展示')
  }

  const handleCopyConfirmedOutput = async () => {
    if (!hasConfirmedOutput) {
      setConfirmedOutputStatus('先确认一段要复制的文字')
      return
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(trimmedConfirmedOutput)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = trimmedConfirmedOutput
        textArea.setAttribute('readonly', 'true')
        textArea.style.position = 'fixed'
        textArea.style.left = '-9999px'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }

      recordConfirmedOutputAction('copy', trimmedConfirmedOutput)
      setConfirmedOutputStatus('已复制，可以粘贴到第三方应用')
    } catch (error) {
      console.warn('[chat] failed to copy confirmed output:', error)
      setConfirmedOutputStatus('复制失败，请手动选中文字复制')
    }
  }

  const handleSpeakConfirmedOutput = () => {
    if (isSpeakingConfirmedOutput) {
      window.speechSynthesis.cancel()
      setIsSpeakingConfirmedOutput(false)
      setConfirmedOutputStatus('已停止朗读')
      return
    }

    if (!hasConfirmedOutput) {
      setConfirmedOutputStatus('先确认一段要朗读的文字')
      return
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setConfirmedOutputStatus('当前浏览器不支持本机朗读')
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(trimmedConfirmedOutput)
    utterance.lang = 'zh-CN'
    utterance.rate = 0.92
    utterance.pitch = 1
    utterance.onend = () => {
      setIsSpeakingConfirmedOutput(false)
      setConfirmedOutputStatus('朗读完成')
    }
    utterance.onerror = () => {
      setIsSpeakingConfirmedOutput(false)
      setConfirmedOutputStatus('朗读中断，可以再点一次')
    }

    recordConfirmedOutputAction('speech', trimmedConfirmedOutput)
    setIsSpeakingConfirmedOutput(true)
    setConfirmedOutputStatus('正在本机朗读')
    window.speechSynthesis.speak(utterance)
  }

  const recentCaptionMessages = useMemo(
    () => messages.filter((message) => message.role === 'assistant').slice(-6),
    [messages],
  )
  const latestAssistantText = recentCaptionMessages[recentCaptionMessages.length - 1]?.content
  const captionText = currentResponseText
    || latestAssistantText
    || (isThinking ? '正在整理本句...' : '正在等待语音输入...')
  const hasConversationStarted = messages.length > 0 || Boolean(currentResponseText) || Boolean(currentASRText)
  const hasMessageThreadActivity = hasConversationStarted || isRecording
  const trimmedConfirmedOutput = confirmedOutputText.trim()
  const hasConfirmedOutput = trimmedConfirmedOutput.length > 0
  const communicationLoadout = workspaceSnapshot?.communication_loadout ?? null
  const runtimeScene = toRtcScene(workspaceSnapshot?.expression_kit.active_scene_id ?? null)

  const selectedLoadoutItemIds = useMemo(
    () => buildDefaultSelectedLoadoutItemIds(communicationLoadout),
    [communicationLoadout],
  )

  const preparationContextUpdate = useMemo(
    () => buildPreparationContextUpdate(
      workspaceSnapshot,
      runtimeScene,
      selectedLoadoutItemIds,
    ),
    [runtimeScene, selectedLoadoutItemIds, workspaceSnapshot],
  )

  const selectedLoadoutEntries = useMemo(
    () => communicationLoadout?.sections.flatMap((section) => (
      section.items
        .filter((item) => item.required || selectedLoadoutItemIds.includes(item.id))
        .map((item) => ({
          id: item.id,
          title: item.title,
          sourceType: item.source_type,
          sectionTitle: section.title,
        }))
    )) ?? [],
    [communicationLoadout, selectedLoadoutItemIds],
  )
  useEffect(() => {
    if (!userId || !communicationLoadout) {
      return
    }

    memoryService.updateCurrentSessionMetadata({
      loadoutMode: communicationLoadout.recommended_mode,
      loadoutRecommendedMode: communicationLoadout.recommended_mode,
      loadoutSelectedCount: selectedLoadoutEntries.length,
      loadoutItemIds: selectedLoadoutEntries.map((entry) => entry.id),
      loadoutItemTitles: selectedLoadoutEntries.map((entry) => entry.title),
      loadoutSections: selectedLoadoutEntries.map((entry) => entry.sectionTitle),
      loadoutSourceTypes: selectedLoadoutEntries.map((entry) => entry.sourceType),
    })
  }, [communicationLoadout, selectedLoadoutEntries, userId])

  useEffect(() => {
    if (!isConnected || !preparationContextUpdate) {
      return
    }

    const syncKey = JSON.stringify(preparationContextUpdate)
    if (
      lastPreparationSyncKeyRef.current === syncKey
      || pendingPreparationSyncKeyRef.current === syncKey
    ) {
      return
    }

    pendingPreparationSyncKeyRef.current = syncKey
    void sendControlEvent('preparation_context_update', {
      preparation: preparationContextUpdate,
    })
      .then(() => {
        lastPreparationSyncKeyRef.current = syncKey
      })
      .catch((error: unknown) => {
        console.warn('[chat] failed to sync preparation context:', error)
      })
      .finally(() => {
        if (pendingPreparationSyncKeyRef.current === syncKey) {
          pendingPreparationSyncKeyRef.current = null
        }
      })
  }, [isConnected, preparationContextUpdate, sendControlEvent])

  return (
    <div className="flex h-dvh overflow-hidden bg-stone-50">
      {/* Main Chat Area */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
      <header className="shrink-0 border-b border-stone-200 bg-white px-3 py-2.5 sm:px-6 sm:py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              燃
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-stone-950 sm:text-lg">日常沟通</div>
              <div className="truncate text-xs text-stone-500 sm:text-sm">理解、纠错和连续对话</div>
            </div>
            {sessionId && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                已连接
              </span>
            )}
            {!sessionId && isConnecting && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                连接中
              </span>
            )}
          </div>
          
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {onReturnHome ? (
              <button
                type="button"
                onClick={onReturnHome}
                className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-950 sm:px-3"
              >
                返回快速表达
              </button>
            ) : null}
            {isConnected ? (
              <button
                onClick={disconnect}
                className="min-h-11 rounded-xl bg-stone-200 px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-300 sm:rounded-full sm:px-4"
              >
                断开连接
              </button>
            ) : null}
            <button
              onClick={() => setIsCaptionMode(!isCaptionMode)}
              className="hidden min-h-11 rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 md:inline-flex"
            >
              {isCaptionMode ? '退出字幕辅助' : '字幕辅助'}
            </button>
            <UserNav />
          </div>
        </div>
      </header>

      {/* Messages Area */}
      <main ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-6xl space-y-4 sm:space-y-6">
          {!hasConversationStarted ? (
            <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
              <p className="text-sm font-semibold text-amber-700">日常沟通助手</p>
              <h1 className="mt-2 text-balance text-2xl font-semibold text-stone-950 sm:text-4xl">
                直接说，系统负责听懂和纠错
              </h1>
              <p className="mt-3 max-w-3xl text-pretty text-sm leading-7 text-stone-600 sm:text-base">
                你的画像、已启用场景和当前材料会自动带入，不需要在这里再配置一遍。沟通音频默认不上传为训练样本。
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {!isConnected ? (
                  <button
                    type="button"
                    onClick={() => void connect()}
                    disabled={isConnecting}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-amber-500 px-6 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-wait disabled:bg-amber-300"
                  >
                    {isConnecting ? '正在连接…' : '开始沟通'}
                  </button>
                ) : (
                  <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
                    已准备好，点击下方麦克风开始说话
                  </span>
                )}
                <Link
                  href="/memory#memory-scene-template-selector"
                  className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-950"
                >
                  查看沟通准备
                </Link>
              </div>
              <MicrophoneInputFeedback
                analyser={analyser}
                active={isConnected || isRecording}
                className="mt-5 max-w-md"
              />
              {microphoneEnvironmentWarning ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {microphoneEnvironmentWarning}
                </div>
              ) : null}
            </section>
          ) : null}

          {latestAssistantMessage || hasConfirmedOutput ? (
            <section className="rounded-3xl border border-stone-200 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-sm font-medium text-amber-700">确认输出</div>
                  <h2 className="mt-1 text-xl font-semibold text-stone-950">给对方看的这一句</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 text-pretty">
                    这里承接沟通转写 agent 整理后的文本。你可以先改一下，再展示、朗读或复制。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (latestAssistantMessage) {
                      setConfirmedOutputText(latestAssistantMessage.content)
                      setConfirmedOutputSourceId(latestAssistantMessage.id)
                      setConfirmedOutputStatus('已同步最新整理文本')
                    }
                  }}
                  disabled={!latestAssistantMessage}
                  className="inline-flex items-center gap-2 rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-stone-300 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  同步最新
                </button>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
                <label className="block">
                  <span className="sr-only">确认输出文本</span>
                  <textarea
                    value={confirmedOutputText}
                    onChange={(event) => {
                      setConfirmedOutputText(event.target.value)
                      setConfirmedOutputSourceId((current) => current ?? latestAssistantMessage?.id ?? null)
                      setConfirmedOutputStatus('已手动改写，动作会使用这版文字')
                    }}
                    placeholder="助手整理后的文本会出现在这里。也可以直接输入一句要给对方看的话。"
                    className="min-h-[150px] w-full resize-none rounded-[24px] border border-stone-200 bg-stone-50 px-5 py-4 text-lg leading-8 text-stone-950 outline-none transition focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-100"
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                  <button
                    type="button"
                    onClick={handleOpenListenerDisplay}
                    disabled={!hasConfirmedOutput}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-stone-950 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                  >
                    <ScreenShare className="h-4 w-4" />
                    给对方看
                  </button>
                  <button
                    type="button"
                    onClick={handleSpeakConfirmedOutput}
                    disabled={!hasConfirmedOutput}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-800 transition-colors hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Volume2 className="h-4 w-4" />
                    {isSpeakingConfirmedOutput ? '停止朗读' : '文本发声'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyConfirmedOutput()
                    }}
                    disabled={!hasConfirmedOutput}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-stone-800 transition-colors hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ClipboardCopy className="h-4 w-4" />
                    复制文本
                  </button>
                </div>
              </div>

              {confirmedOutputStatus ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {confirmedOutputStatus}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Message list */}
          {hasMessageThreadActivity ? (
            <section className="rounded-3xl border border-stone-200 bg-white px-4 py-5 sm:px-6">
              <div className="space-y-4">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}

                {(isRecording || currentASRText) ? (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-amber-50 px-4 py-3 text-amber-950 ring-1 ring-amber-100">
                      <div className="mb-1 text-xs font-medium text-amber-700">实时转写</div>
                      <p className="whitespace-pre-wrap text-base leading-7">
                        {currentASRText || '正在听你说话，文字会出现在这里。'}
                        {isRecording ? (
                          <span className="ml-1 inline-block h-4 w-1.5 bg-amber-500 animate-blink" />
                        ) : null}
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* Thinking indicator */}
                {isThinking && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md bg-stone-100 px-4 py-3 text-stone-700">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <span className="h-2 w-2 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                          <span className="h-2 w-2 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                          <span className="h-2 w-2 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                        </div>
                        <span className="text-sm">{currentResponseText || '思考中...'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Streaming response */}
                {currentResponseText && !isThinking && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-3 text-stone-900 shadow-sm">
                      {currentResponseText}
                      <span className="ml-1 inline-block h-4 w-1.5 bg-amber-500 animate-blink"></span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : null}

        </div>
      </main>

      {/* Keep errors near the primary action and clear of mobile browser controls. */}
      {error && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-lg rounded-2xl border border-rose-200 bg-white px-4 py-3 text-center text-sm text-pretty text-rose-700 shadow-lg sm:bottom-6"
        >
          {error}
        </div>
      )}

      {/* Input Area */}
      <footer className="shrink-0 border-t border-stone-200 bg-white px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4">
        <div className="mx-auto max-w-6xl">
          {isRecording ? (
            <div className="mb-3 flex items-center gap-3 rounded-[22px] border border-red-100 bg-red-50 px-4 py-2 shadow-sm">
              <span className="shrink-0 text-xs font-medium text-red-600">实时收音</span>
              <WaveformVisualizer
                analyser={analyser}
                isRecording={isRecording}
                className="min-w-0 flex-1 !h-12 !rounded-2xl !bg-transparent sm:!h-14"
              />
            </div>
          ) : null}
          <div className="flex items-center gap-4">
            {/* Voice button */}
            <button
              onClick={toggleRecording}
              disabled={!isConnected}
              className={cn(
                'flex size-14 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-colors',
                isRecording
                  ? 'bg-red-500 hover:bg-red-600'
                  : isConnected
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'cursor-not-allowed bg-stone-300',
              )}
              aria-label={isRecording ? '停止录音' : '开始录音'}
            >
              {isRecording ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>

            {/* Text input */}
            <form onSubmit={handleSubmit} className="flex-1 flex gap-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={isConnected ? "输入消息，或按空格键说话..." : "请先连接助手"}
                disabled={!isConnected}
                className="flex-1 rounded-full border border-stone-200 px-4 py-3 outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:bg-stone-100"
              />
              <button
                type="submit"
                disabled={!isConnected || !textInput.trim()}
                className="rounded-full bg-amber-500 px-6 py-3 font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                发送
              </button>
            </form>
          </div>

          {/* Hints */}
          <div className="mt-2 text-center text-xs text-stone-500">
            {isConnected ? (
              isRecording ? (
                '正在录音... 再次点击或按空格停止'
              ) : isConnecting ? (
                '正在等待助手真正进入房间，请稍候...'
              ) : (
                '可以直接说话、打字，或者先点一句场景句、再慢慢补充。'
              )
            ) : (
              isConnecting ? '正在等待助手真正进入房间，请稍候...' : '先连接助手，或者先点一条开口句开始'
            )}
          </div>
          {microphoneEnvironmentWarning ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {microphoneEnvironmentWarning}
            </div>
          ) : null}
        </div>
      </footer>
      </div>

      <style jsx>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .animate-blink { animation: blink 1s infinite; }
      `}</style>

      {isCaptionMode && (
        <div className="fixed inset-0 z-30 bg-black text-white flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/20">
            <div className="text-sm text-white/80">全屏字幕模式</div>
            <button
              onClick={() => setIsCaptionMode(false)}
              className="px-4 py-2 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90"
            >
              退出
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-8 py-10">
            <div className="mx-auto flex min-h-full w-full max-w-6xl items-center justify-center">
              <p className="text-center text-4xl font-semibold leading-tight md:text-6xl">
                {captionText}
              </p>
            </div>
          </div>
        </div>
      )}

      {isListenerDisplayOpen && (
        <div className="fixed inset-0 z-40 flex flex-col bg-stone-950 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 px-4 py-4 sm:px-6">
            <div>
              <div className="text-sm font-medium text-white/70">给对方看</div>
              <div className="mt-1 text-lg font-semibold">确认文本</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsListenerDisplayFlipped((current) => !current)}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
              >
                <RotateCcw className="h-4 w-4" />
                {isListenerDisplayFlipped ? '恢复方向' : '面对面反转'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleCopyConfirmedOutput()
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
              >
                <ClipboardCopy className="h-4 w-4" />
                复制
              </button>
              <button
                type="button"
                onClick={() => setIsListenerDisplayOpen(false)}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-stone-950 transition-colors hover:bg-white/90"
              >
                退出
              </button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10">
            <p
              className={cn(
                'max-w-6xl whitespace-pre-wrap text-center text-4xl font-semibold leading-tight text-balance sm:text-6xl lg:text-7xl',
                isListenerDisplayFlipped ? 'rotate-180' : '',
              )}
            >
              {trimmedConfirmedOutput}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// Message bubble component
function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`
          max-w-[80%] rounded-2xl px-4 py-3
          ${isUser
            ? 'bg-amber-500 text-white rounded-br-md'
            : 'rounded-bl-md border border-stone-200 bg-white text-stone-900 shadow-sm'
          }
        `}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        <div className={`mt-1 text-xs ${isUser ? 'text-amber-200' : 'text-stone-400'}`}>
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}
