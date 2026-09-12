export interface MobileExpressionKitSuggestion {
  id: string
  text: string
  source: 'quick_phrase' | 'hotword_profile' | 'frequent_expression'
  category: string
  note?: string
  priority: number
}

export interface MobilePreparedExpressionSection {
  id: string
  title: string
  summary: string
  anchor_line: string
  practice_lines: string[]
  fallback_phrases: string[]
  hotwords: string[]
  is_priority: boolean
}

export interface MobilePreparedExpressionSnapshot {
  id: string
  title: string
  summary: string
  scene: string | null
  document_content: string
  reference_lines: string[]
  practice_lines: Array<{
    id: string
    text: string
    section_id: string
    section_title: string
  }>
  fallback_phrases: string[]
  hotwords: string[]
  sections: MobilePreparedExpressionSection[]
  rehearsal_count: number
  low_confidence_sections: number
  training_reports: MobileTrainingReports | null
  updated_at: string
}

export interface MobileTrainingSummaryWindow {
  summary: string
  sample_count: number
  mismatch_pairs: Array<{ target: string; heard: string; occurrenceCount: number }>
  next_focus: string[]
  stable_wins: string[]
  pronunciation_patterns: string[]
  support_strategies: string[]
  generated_at: string
}

export interface MobileTrainingReports {
  daily_summary: MobileTrainingSummaryWindow | null
  weekly_summary: MobileTrainingSummaryWindow | null
  training_plan: {
    summary: string
    items: string[]
    generated_at: string
  } | null
}

export interface MobilePreparedExpressionAsset {
  draft: {
    id: string
    title: string
    scene: string | null
    source: string
    content: string
    updated_at: string
  }
  structured: {
    id: string
    title: string
    summary: string
    scene: string | null
    source: string
    hotwords: string[]
    highRiskPhrases: string[]
    fallbackPhrases: string[]
    sections: Array<{
      id: string
      title: string
      summary: string
      anchorLine: string
      practiceLines: string[]
      highRiskPhrases: string[]
      fallbackPhrases: string[]
      hotwords: string[]
      basePriority: number
    }>
  }
  training_reports: MobileTrainingReports | null
}

export interface MobilePreparedExpressionLibrary {
  active_asset_id: string | null
  assets: MobilePreparedExpressionAsset[]
  updated_at: string
}

export interface MobileUserProfileMemory {
  etiology?: string
  severity?: string
  document?: string
  summary?: string
  common_scenarios?: string[]
  risky_terms?: string[]
  support_strategies?: string[]
  updated_at?: string
}

export interface MobileSceneTemplate {
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

export interface MobileHotwordProfile {
  id: string
  phrase: string
  category: 'medical' | 'profession' | 'family' | 'daily' | 'emergency' | 'custom'
  scenario: string
  note?: string
  createdAt: number
  updatedAt: number
}

export interface MobileWorkspaceSnapshotContract {
  registration_profile: {
    full_name?: string
    province?: string
    city?: string
    disability_category?: string
    condition?: string
    etiology?: string
    has_dialect?: boolean
    dialect_profiles?: Array<{ name: string; region: string }> | null
    dialect_name?: string
  }
  user_profile_memory: MobileUserProfileMemory
  scene_templates: {
    selected_ids: string[]
    library: MobileSceneTemplate[]
  }
  preparation: {
    overview: string
    immediate_goal: string | null
    scene_brief: string | null
    common_scenarios: string[]
    strong_phrases: string[]
    risky_terms: string[]
    listener_guidance: string[]
    support_strategies: string[]
    hotwords: string[]
    reference_lines: string[]
    next_step: string | null
    updated_at: string
  }
  prepared_expression: MobilePreparedExpressionSnapshot | null
  expression_kit: {
    recommended_phrases: MobileExpressionKitSuggestion[]
    hotword_profiles: MobileHotwordProfile[]
    quick_phrases: Array<{
      id: string
      text: string
      category: string
      usage_count: number
      order_index: number
      updated_at?: string
    }>
    recommended_focus: string[]
  }
  training_activity: {
    daily_target_count: number
    slogan: string
    yesterday: {
      day_key: string
      total_recordings: number
      top_contributors: Array<{
        rank: number
        recording_count: number
      }>
    }
  }
  synced_at: string
}

export interface MobileWorkspaceReadModel {
  syncedAt: string
  immediateGoal: string | null
  preparedTitle: string | null
  preparedSummary: string | null
  priorityLines: string[]
  quickPhrases: string[]
  dailyTargetCount: number
  localEmptyState: string
}

function takeNonEmpty(values: string[], maxCount: number): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, maxCount)
}

export function selectMobileWorkspaceReadModel(
  snapshot: MobileWorkspaceSnapshotContract | null,
): MobileWorkspaceReadModel {
  if (!snapshot) {
    return {
      syncedAt: '',
      immediateGoal: null,
      preparedTitle: null,
      preparedSummary: null,
      priorityLines: [],
      quickPhrases: [
        '请等我说完',
        '请看这句话',
        '我需要一点时间',
      ],
      dailyTargetCount: 20,
      localEmptyState: '登录后同步准备材料',
    }
  }

  const preparedLines = snapshot.prepared_expression?.reference_lines ?? []
  const fallbackLines = snapshot.prepared_expression?.fallback_phrases ?? []
  const preparationLines = snapshot.preparation.strong_phrases
  const quickPhrases = snapshot.expression_kit.quick_phrases
    .sort((left, right) => left.order_index - right.order_index)
    .map((phrase) => phrase.text)

  return {
    syncedAt: snapshot.synced_at,
    immediateGoal: snapshot.preparation.immediate_goal,
    preparedTitle: snapshot.prepared_expression?.title ?? null,
    preparedSummary: snapshot.prepared_expression?.summary ?? null,
    priorityLines: takeNonEmpty([
      ...preparedLines,
      ...fallbackLines,
      ...preparationLines,
    ], 8),
    quickPhrases: takeNonEmpty(quickPhrases, 8),
    dailyTargetCount: snapshot.training_activity.daily_target_count,
    localEmptyState: '还没有同步到准备材料',
  }
}
