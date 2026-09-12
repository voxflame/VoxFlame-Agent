'use client'

import { config } from '@/lib/config'
import { getAccessToken } from '@/lib/supabase/client'
import type { CommunicationSceneId } from '@/lib/communication/communication-scene'
import type { CommunicationPreferences } from '@/lib/communication/communication-preferences'
import type { WorkspaceMemorySnapshot } from '@/lib/memory/workspace-snapshot'

export interface PreparedExpressionDraftAsset {
  id: string
  title: string
  scene: string | null
  source: string
  content: string
  updated_at: string
}

export interface PreparedExpressionStructuredSectionAsset {
  id: string
  title: string
  summary: string
  anchorLine: string
  practiceLines: string[]
  highRiskPhrases: string[]
  fallbackPhrases: string[]
  hotwords: string[]
  basePriority: number
}

export interface PreparedExpressionStructuredAsset {
  id: string
  title: string
  summary: string
  scene: string | null
  source: string
  hotwords: string[]
  highRiskPhrases: string[]
  fallbackPhrases: string[]
  sections: PreparedExpressionStructuredSectionAsset[]
}

export interface PreparedExpressionAsrHotwordEntryAsset {
  text: string
  weight: number
  lang: 'zh' | 'en'
}

export interface PreparedExpressionCorrectionPairAsset {
  target: string
  heard: string
  occurrenceCount: number
}

export interface PreparedExpressionTrainingSummaryWindowAsset {
  summary: string
  sampleCount: number
  mismatchPairs: PreparedExpressionCorrectionPairAsset[]
  nextFocus: string[]
  stableWins: string[]
  pronunciationPatterns: string[]
  supportStrategies: string[]
  generated_at: string
}

export interface PreparedExpressionTrainingPlanAsset {
  summary: string
  items: string[]
  generated_at: string
}

export interface PreparedExpressionTrainingReportsAsset {
  daily_summary: PreparedExpressionTrainingSummaryWindowAsset | null
  weekly_summary: PreparedExpressionTrainingSummaryWindowAsset | null
  training_plan: PreparedExpressionTrainingPlanAsset | null
}

export interface PreparedExpressionAsset {
  draft: PreparedExpressionDraftAsset
  structured: PreparedExpressionStructuredAsset
  training_reports: PreparedExpressionTrainingReportsAsset | null
}

export interface PreparedExpressionLibraryAsset {
  active_asset_id: string | null
  assets: PreparedExpressionAsset[]
  updated_at: string
}

export interface SceneTemplateLibraryItem {
  id: string
  title: string
  summary: string
  scenario: string
  severity_hint: string
  condition_hint: string
  communication_goal: string
  source_basis: string
  focus_priority: string[]
  risky_terms: string[]
  support_strategies: string[]
  starter_phrases: string[]
  hotwords: Array<{
    phrase: string
    category: string
    note: string
  }>
  updated_at: string
}

export interface UserProfileMemoryAsset {
  etiology?: string
  severity?: string
  document?: string
  summary?: string
  common_scenarios?: string[]
  risky_terms?: string[]
  support_strategies?: string[]
  updated_at?: string
}

function buildWorkspaceSnapshotUrl(
  userId: string,
  sceneId?: CommunicationSceneId,
): string {
  const params = new URLSearchParams()
  if (sceneId) {
    params.set('scene', sceneId)
  }

  return `${config.api.baseUrl}/memory/workspace/${userId}${params.size > 0 ? `?${params.toString()}` : ''}`
}

export async function fetchWorkspaceSnapshot(
  userId: string,
  sceneId?: CommunicationSceneId,
): Promise<WorkspaceMemorySnapshot | null> {
  const token = await getAccessToken()
  if (!token) {
    return null
  }

  const requestKey = `${userId}:${sceneId ?? ''}`
  const existingRequest = workspaceSnapshotRequests.get(requestKey)
  if (existingRequest) {
    return existingRequest
  }

  const request = (async () => {
    const response = await fetch(buildWorkspaceSnapshotUrl(userId, sceneId), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(`workspace_snapshot_${response.status}`)
    }

    return await response.json() as WorkspaceMemorySnapshot
  })()
  workspaceSnapshotRequests.set(requestKey, request)
  try {
    return await request
  } finally {
    if (workspaceSnapshotRequests.get(requestKey) === request) {
      workspaceSnapshotRequests.delete(requestKey)
    }
  }
}

const workspaceSnapshotRequests = new Map<
  string,
  Promise<WorkspaceMemorySnapshot | null>
>()

export async function saveWorkspaceSceneTemplates(
  userId: string,
  selectedTemplateIds: string[],
): Promise<string[]> {
  const token = await getAccessToken()
  if (!token) {
    return []
  }

  const response = await fetch(`${config.api.baseUrl}/memory/workspace/${userId}/scene-templates`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      selected_template_ids: selectedTemplateIds,
    }),
  })

  if (!response.ok) {
    throw new Error(`workspace_scene_templates_${response.status}`)
  }

  const data = await response.json() as {
    selected_template_ids?: string[]
  }

  return data.selected_template_ids ?? selectedTemplateIds
}

export async function saveWorkspaceCommunicationPreferences(
  userId: string,
  communicationPreferences: CommunicationPreferences,
): Promise<CommunicationPreferences | null> {
  const token = await getAccessToken()
  if (!token) {
    return null
  }

  const response = await fetch(`${config.api.baseUrl}/memory/workspace/${userId}/preferences`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      communication_preferences: communicationPreferences,
    }),
  })

  if (!response.ok) {
    throw new Error(`workspace_preferences_${response.status}`)
  }

  const data = await response.json() as {
    communication_preferences?: CommunicationPreferences
  }

  return data.communication_preferences ?? communicationPreferences
}

export async function saveWorkspaceUserProfileMemory(
  userId: string,
  input: UserProfileMemoryAsset,
): Promise<UserProfileMemoryAsset | null> {
  const token = await getAccessToken()
  if (!token) {
    return null
  }

  const response = await fetch(`${config.api.baseUrl}/memory/workspace/${userId}/profile-memory`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      ...input,
    }),
  })

  if (!response.ok) {
    throw new Error(`workspace_profile_memory_${response.status}`)
  }

  const data = await response.json() as {
    user_profile_memory?: UserProfileMemoryAsset
  }

  return data.user_profile_memory ?? input
}

export async function fetchPreparedExpressionLibrary(
  userId: string,
): Promise<PreparedExpressionLibraryAsset | null> {
  const token = await getAccessToken()
  if (!token) {
    return null
  }

  const response = await fetch(`${config.api.baseUrl}/memory/workspace/${userId}/prepared-expressions`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`prepared_expression_library_${response.status}`)
  }

  const data = await response.json() as {
    prepared_expression_library?: PreparedExpressionLibraryAsset | null
  }

  return data.prepared_expression_library ?? null
}

export async function savePreparedExpressionAsset(
  userId: string,
  input: {
    id?: string | null
    title?: string | null
    scene?: string | null
    source?: string | null
    content: string
    make_active?: boolean
  },
): Promise<PreparedExpressionLibraryAsset | null> {
  const token = await getAccessToken()
  if (!token) {
    return null
  }

  const response = await fetch(`${config.api.baseUrl}/memory/workspace/${userId}/prepared-expressions`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      ...input,
    }),
  })

  if (!response.ok) {
    throw new Error(`prepared_expression_save_${response.status}`)
  }

  const data = await response.json() as {
    prepared_expression_library?: PreparedExpressionLibraryAsset | null
  }

  return data.prepared_expression_library ?? null
}

export async function deletePreparedExpressionAsset(
  userId: string,
  assetId: string,
): Promise<PreparedExpressionLibraryAsset | null> {
  const token = await getAccessToken()
  if (!token) {
    return null
  }

  const response = await fetch(`${config.api.baseUrl}/memory/workspace/${userId}/prepared-expressions/${assetId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`prepared_expression_delete_${response.status}`)
  }

  const data = await response.json() as {
    prepared_expression_library?: PreparedExpressionLibraryAsset | null
  }

  return data.prepared_expression_library ?? null
}

export async function activatePreparedExpressionAsset(
  userId: string,
  assetId: string,
): Promise<PreparedExpressionLibraryAsset | null> {
  const token = await getAccessToken()
  if (!token) {
    return null
  }

  const response = await fetch(`${config.api.baseUrl}/memory/workspace/${userId}/prepared-expressions/active`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      asset_id: assetId,
    }),
  })

  if (!response.ok) {
    throw new Error(`prepared_expression_activate_${response.status}`)
  }

  const data = await response.json() as {
    prepared_expression_library?: PreparedExpressionLibraryAsset | null
  }

  return data.prepared_expression_library ?? null
}

export async function summarizePreparedExpressionAsset(
  userId: string,
  assetId: string,
  trigger: 'manual' | 'periodic_auto' = 'manual',
): Promise<PreparedExpressionLibraryAsset | null> {
  const token = await getAccessToken()
  if (!token) {
    return null
  }

  const response = await fetch(`${config.api.baseUrl}/memory/workspace/${userId}/prepared-expressions/${assetId}/summarize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      trigger,
    }),
  })

  if (!response.ok) {
    throw new Error(`prepared_expression_summarize_${response.status}`)
  }

  const data = await response.json() as {
    prepared_expression_library?: PreparedExpressionLibraryAsset | null
  }

  return data.prepared_expression_library ?? null
}
