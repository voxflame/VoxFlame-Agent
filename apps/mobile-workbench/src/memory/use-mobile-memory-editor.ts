import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  activateMobilePreparedExpression,
  createMobileQuickPhrase,
  deleteMobilePreparedExpression,
  deleteMobileQuickPhrase,
  fetchMobilePreparedExpressionLibrary,
  fetchMobileQuickPhrases,
  fetchMobileSceneTemplates,
  saveMobilePreparedExpression,
  saveMobileHotwordProfiles,
  saveMobileSceneTemplates,
  saveMobileUserProfileMemory,
  updateMobileQuickPhrase,
  type MobileQuickPhrase,
} from '../api/mobile-memory-client'
import type { MobileAuthTokenProvider } from '../api/mobile-workbench-client'
import type {
  MobilePreparedExpressionLibrary,
  MobileHotwordProfile,
  MobileSceneTemplate,
  MobileUserProfileMemory,
} from '../contracts/workspace-read-model'
import { toMobileProductMessage } from '../ui/product-message'

export function isCurrentMobileMemoryOwner(
  requestUserId: string,
  currentUserId: string | null,
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestUserId === currentUserId && requestGeneration === currentGeneration
}

export function useMobileMemoryEditor(params: {
  apiBaseUrl: string | null
  userId: string | null
  tokenProvider: MobileAuthTokenProvider
  enabled: boolean
}) {
  const [library, setLibrary] = useState<MobilePreparedExpressionLibrary | null>(null)
  const [phrases, setPhrases] = useState<MobileQuickPhrase[]>([])
  const [sceneTemplates, setSceneTemplates] = useState<MobileSceneTemplate[]>([])
  const [selectedSceneTemplateIds, setSelectedSceneTemplateIds] = useState<string[]>([])
  const [hotwordProfiles, setHotwordProfiles] = useState<MobileHotwordProfile[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const currentUserIdRef = useRef<string | null>(params.userId)
  const requestGenerationRef = useRef(0)
  currentUserIdRef.current = params.userId

  const clientOptions = useMemo(() => params.apiBaseUrl ? ({
    apiBaseUrl: params.apiBaseUrl,
    tokenProvider: params.tokenProvider,
  }) : null, [params.apiBaseUrl, params.tokenProvider])

  const refresh = useCallback(async (): Promise<void> => {
    if (!params.enabled || !params.userId || !clientOptions) {
      requestGenerationRef.current += 1
      setLibrary(null)
      setPhrases([])
      setSceneTemplates([])
      setSelectedSceneTemplateIds([])
      setHotwordProfiles([])
      setStatus('idle')
      setErrorMessage(null)
      return
    }
    const requestUserId = params.userId
    const requestGeneration = requestGenerationRef.current + 1
    requestGenerationRef.current = requestGeneration
    setStatus('loading')
    setErrorMessage(null)
    try {
      const [nextLibrary, nextPhrases, nextSceneTemplates] = await Promise.all([
        fetchMobilePreparedExpressionLibrary(requestUserId, clientOptions),
        fetchMobileQuickPhrases(requestUserId, clientOptions),
        fetchMobileSceneTemplates(requestUserId, clientOptions),
      ])
      if (!isCurrentMobileMemoryOwner(
        requestUserId,
        currentUserIdRef.current,
        requestGeneration,
        requestGenerationRef.current,
      )) return
      setLibrary(nextLibrary)
      setPhrases(nextPhrases)
      setSceneTemplates(nextSceneTemplates.library)
      setSelectedSceneTemplateIds(nextSceneTemplates.selectedIds)
      setStatus('ready')
    } catch (error) {
      if (!isCurrentMobileMemoryOwner(
        requestUserId,
        currentUserIdRef.current,
        requestGeneration,
        requestGenerationRef.current,
      )) return
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'workspace'))
    }
  }, [clientOptions, params.enabled, params.userId])

  useEffect(() => {
    void refresh()
    return () => {
      requestGenerationRef.current += 1
    }
  }, [refresh])

  const mutate = useCallback(async <T,>(
    userId: string,
    operation: () => Promise<T>,
  ): Promise<T | null> => {
    setStatus('saving')
    setErrorMessage(null)
    try {
      const result = await operation()
      if (currentUserIdRef.current !== userId) return null
      setStatus('ready')
      return result
    } catch (error) {
      if (currentUserIdRef.current !== userId) return null
      setStatus('error')
      setErrorMessage(toMobileProductMessage(error, 'workspace'))
      return null
    }
  }, [])

  return {
    library,
    phrases,
    sceneTemplates,
    selectedSceneTemplateIds,
    hotwordProfiles,
    status,
    errorMessage,
    refresh,
    hydrateHotwords(profiles: MobileHotwordProfile[]) {
      setHotwordProfiles(profiles)
    },
    async saveSceneTemplateSelection(selectedIds: string[]) {
      const userId = params.userId
      if (!userId || !clientOptions) return false
      const saved = await mutate(userId, () => saveMobileSceneTemplates(userId, selectedIds, clientOptions))
      if (!saved) return false
      setSelectedSceneTemplateIds(saved)
      return true
    },
    async saveHotwords(profiles: MobileHotwordProfile[]) {
      const userId = params.userId
      if (!userId || !clientOptions) return false
      const saved = await mutate(userId, () => saveMobileHotwordProfiles(userId, profiles, clientOptions))
      if (!saved) return false
      setHotwordProfiles(saved)
      return true
    },
    async saveMaterial(input: { id?: string; title: string; scene?: string | null; source?: string; content: string; make_active?: boolean }) {
      const userId = params.userId
      if (!userId || !clientOptions) return false
      const next = await mutate(userId, () => saveMobilePreparedExpression(userId, input, clientOptions))
      if (!next) return false
      setLibrary(next)
      return true
    },
    async activateMaterial(assetId: string) {
      const userId = params.userId
      if (!userId || !clientOptions) return null
      const next = await mutate(userId, () => activateMobilePreparedExpression(userId, assetId, clientOptions))
      if (!next) return null
      setLibrary(next.library)
      return next.workspaceSnapshot
    },
    async deleteMaterial(assetId: string) {
      const userId = params.userId
      if (!userId || !clientOptions) return false
      const next = await mutate(userId, () => deleteMobilePreparedExpression(userId, assetId, clientOptions))
      if (!next) return false
      setLibrary(next)
      return true
    },
    async saveProfile(input: MobileUserProfileMemory) {
      const userId = params.userId
      if (!userId || !clientOptions) return false
      return Boolean(await mutate(userId, () => saveMobileUserProfileMemory(userId, input, clientOptions)))
    },
    async savePhrase(input: { id?: string; text: string }) {
      const userId = params.userId
      if (!userId || !clientOptions) return false
      const saved = await mutate(userId, () => input.id
        ? updateMobileQuickPhrase(input.id, input.text, clientOptions)
        : createMobileQuickPhrase(userId, input.text, clientOptions))
      if (!saved) return false
      setPhrases((current) => input.id
        ? current.map((phrase) => phrase.id === input.id ? saved : phrase)
        : [...current, saved])
      return true
    },
    async deletePhrase(phraseId: string) {
      const userId = params.userId
      if (!userId || !clientOptions) return false
      const deleted = await mutate(userId, () => deleteMobileQuickPhrase(phraseId, clientOptions))
      if (deleted === null) return false
      setPhrases((current) => current.filter((phrase) => phrase.id !== phraseId))
      return true
    },
  }
}
