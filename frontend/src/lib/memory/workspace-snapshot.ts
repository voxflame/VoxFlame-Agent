import type { CommunicationPreferences } from '@/lib/communication/communication-preferences'
import type { CommunicationSceneId } from '@/lib/communication/communication-scene'

export interface ExpressionKitSuggestion {
  id: string
  text: string
  source: 'quick_phrase' | 'hotword_profile' | 'frequent_expression'
  category: string
  note?: string
  priority: number
}

export interface ProfileBundleItem {
  id: string
  title: string
  content: string
  source: 'user_profile' | 'hotword_profile' | 'memory' | 'session'
  emphasis: 'high' | 'medium' | 'low'
  tags?: string[]
  updated_at: string
}

export type PreparedExpressionFeedbackStatus =
  | 'excellent'
  | 'close'
  | 'retry'
  | 'unclear'

export interface PreparedExpressionSectionSnapshot {
  id: string
  title: string
  summary: string
  anchor_line: string
  practice_lines: string[]
  high_risk_phrases: string[]
  fallback_phrases: string[]
  hotwords: string[]
  rehearsal_count: number
  low_confidence_count: number
  latest_feedback_status: PreparedExpressionFeedbackStatus | null
  last_rehearsed_at: string | null
  is_priority: boolean
}

export interface PreparedExpressionAsrHotwordEntry {
  text: string
  weight: number
  lang: 'zh' | 'en'
}

export interface PreparedExpressionCorrectionPair {
  target: string
  heard: string
  occurrenceCount: number
}

export interface PreparedExpressionTrainingSummaryWindowSnapshot {
  summary: string
  sample_count: number
  mismatch_pairs: PreparedExpressionCorrectionPair[]
  next_focus: string[]
  stable_wins: string[]
  pronunciation_patterns: string[]
  support_strategies: string[]
  generated_at: string
}

export interface PreparedExpressionTrainingPlanSnapshot {
  summary: string
  items: string[]
  generated_at: string
}

export interface PreparedExpressionTrainingReportsSnapshot {
  daily_summary: PreparedExpressionTrainingSummaryWindowSnapshot | null
  weekly_summary: PreparedExpressionTrainingSummaryWindowSnapshot | null
  training_plan: PreparedExpressionTrainingPlanSnapshot | null
}

export interface PreparedExpressionSnapshot {
  id: string
  title: string
  summary: string
  scene: string | null
  source: string
  document_content: string
  last_rehearsed_at: string | null
  rehearsal_count: number
  low_confidence_sections: number
  hotwords: string[]
  high_risk_phrases: string[]
  fallback_phrases: string[]
  asr_hotword_entries: PreparedExpressionAsrHotwordEntry[]
  reference_lines: string[]
  practice_lines: Array<{
    id: string
    text: string
    section_id: string
    section_title: string
  }>
  training_reports: PreparedExpressionTrainingReportsSnapshot | null
  sections: PreparedExpressionSectionSnapshot[]
  updated_at: string
}

export interface WorkspaceMemorySnapshot {
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
  user_profile_memory: {
    etiology?: string
    severity?: string
    document?: string
    summary?: string
    common_scenarios: string[]
    risky_terms: string[]
    support_strategies: string[]
    updated_at?: string
  }
  scene_templates: {
    selected_ids: string[]
    library: Array<{
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
    }>
  }
  object_zones: Array<{
    id: 'custom_materials' | 'scene_and_hotword_templates' | 'user_profile'
    title: string
    description: string
    empty_state: string
    items: Array<{
      id: string
      type: 'custom_material' | 'scene_template' | 'user_profile'
      title: string
      summary: string
      tags: string[]
      load_behavior: 'manual' | 'recommended' | 'always_on' | 'derived'
      editable: boolean
      updated_at: string
    }>
  }>
  communication_loadout: {
    recommended_mode: 'urgent' | 'long_form'
    reason: string
    sections: Array<{
      id: 'always_on' | 'scene_pack' | 'custom_materials'
      title: string
      description: string
      items: Array<{
        id: string
        title: string
        summary: string
        source_type: 'custom_material' | 'scene_template' | 'user_profile'
        required: boolean
        default_selected?: boolean
        document_content?: string | null
        reference_lines?: string[]
        hotwords?: string[]
        risky_terms?: string[]
        support_strategies?: string[]
      }>
    }>
    updated_at: string
  }
  profile_bundle: {
    static: ProfileBundleItem[]
    dynamic: ProfileBundleItem[]
    relevant: ProfileBundleItem[]
  }
  session_review: {
    session_id: string | null
    headline: string
    summary: string
    focus: string[]
    recent_win: string | null
    next_step: string | null
    updated_at: string
  }
  preparation: {
    active_scene_id: CommunicationSceneId | null
    profile_summary: string
    overview: string
    immediate_goal: string | null
    scene_brief: string | null
    common_scenarios: string[]
    strong_phrases: string[]
    risky_terms: string[]
    pronunciation_patterns: string[]
    listener_guidance: string[]
    support_strategies: string[]
    hotwords: string[]
    asr_hotword_entries: PreparedExpressionAsrHotwordEntry[]
    document_context_summary: string | null
    document_content: string | null
    reference_lines: PreparedExpressionSnapshot['reference_lines']
    training_pairs: PreparedExpressionCorrectionPair[]
    next_step: string | null
    updated_at: string
  }
  prepared_expression_library: {
    active_id: string | null
    items: Array<{
      id: string
      title: string
      summary: string
      scene: string | null
      source: string
      updated_at: string
      rehearsal_count: number
      last_rehearsed_at: string | null
      is_active: boolean
    }>
  }
  prepared_expression: PreparedExpressionSnapshot | null
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
  expression_kit: {
    active_scene_id: CommunicationSceneId | null
    recommended_phrases: ExpressionKitSuggestion[]
    hotword_profiles: Array<{
      id: string
      phrase: string
      category: string
      scenario: string
      note?: string
      createdAt: number
      updatedAt: number
    }>
    quick_phrases: Array<{
      id: string
      text: string
      category: string
      usage_count: number
      order_index: number
      updated_at?: string
    }>
    recommended_focus: string[]
    communication_preferences: CommunicationPreferences
  }
  synced_at: string
}
