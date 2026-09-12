import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  buildMemoryGrowthProfileSnapshot,
  FeedbackStatus,
  MemoryGrowthProfileSnapshot,
} from './memory-growth.service';
import {
  rankExpressionKitSuggestions,
  type WorkspaceSceneId,
} from './expression-kit.service';
import {
  buildAsrHotwordEntries,
  buildPreparedExpressionCorrectionPairs,
  buildPreparedExpressionPracticeLines,
  buildPreparedExpressionReferenceLines,
  createPreparedExpressionAssetFromDraft,
  normalizePreparedExpressionAsset,
  type PreparedExpressionAsset,
  type PreparedExpressionAsrHotwordEntry,
  type PreparedExpressionCorrectionPair,
} from './prepared-expression.service';
import {
  PreparedExpressionSummaryService,
  type PreparedExpressionSummaryTrigger,
  type PreparedExpressionTrainingSample,
} from './prepared-expression-summary.service';
import {
  buildHotwordProfilesFromSceneTemplateIds,
  getSceneTemplateById,
  listSceneTemplates,
  normalizeSelectedSceneTemplateIds,
  type SceneTemplateDefinition,
} from './scene-template.service';

type JsonRecord = Record<string, unknown>;

const TRAINING_ACTIVITY_CACHE_TTL_MS = 60_000;
let trainingActivityCache: {
  expiresAt: number;
  value: WorkspaceMemorySnapshot['training_activity'];
} | null = null;

export interface Memory {
  id?: string;
  user_id: string;
  session_id: string;
  content: string;
  metadata?: JsonRecord;
  embedding?: number[];
  created_at?: string;
  updated_at?: string;
}

export interface Session {
  id?: string;
  user_id: string;
  start_time: string;
  end_time?: string;
  duration?: number;
  transcript?: string;
  metadata?: JsonRecord;
}

interface VoiceContributionRow {
  contributor_id?: string;
  created_at?: string;
  transcript?: string | null;
  metadata?: JsonRecord;
}

export interface UserProfile {
  id?: string;
  name?: string;
  age?: number;
  condition?: string;
  contact_phone?: string;
  province?: string;
  city?: string;
  disability_category?: string;
  etiology?: string;
  has_dialect?: boolean;
  dialect_profiles?: Array<{ name: string; region: string }> | null;
  dialect_name?: string;
  identity_document_type?: 'disability_certificate' | 'id_card';
  identity_document_number?: string;
  hotwords?: string[];
  preferences?: JsonRecord;
  created_at?: string;
  updated_at?: string;
}

export interface UserProfileMemoryRecord {
  etiology?: string;
  severity?: string;
  document?: string;
  summary?: string;
  common_scenarios?: string[];
  risky_terms?: string[];
  support_strategies?: string[];
  updated_at?: string;
}

const USER_PROFILE_ETIOLOGY_VALUES = [
  'unknown',
  'stroke',
  'parkinsons',
  'cerebral_palsy',
  'brain_injury',
  'hearing_loss',
  'neuromuscular',
  'other',
] as const;

const USER_PROFILE_SEVERITY_VALUES = [
  'unsure',
  'mild',
  'moderate',
  'severe',
] as const;

const USER_PROFILE_ETIOLOGY_LABELS: Record<string, string> = {
  unknown: '病因暂不确定',
  stroke: '脑卒中相关',
  parkinsons: '帕金森相关',
  cerebral_palsy: '脑瘫相关',
  brain_injury: '脑损伤相关',
  hearing_loss: '听力相关',
  neuromuscular: '肌肉退化 / 神经肌肉相关',
  other: '其他或混合原因',
};

const USER_PROFILE_SEVERITY_LABELS: Record<string, string> = {
  unsure: '严重程度待确认',
  mild: '轻度',
  moderate: '中度',
  severe: '重度',
};

export interface QuickPhrase {
  id?: string;
  user_id: string;
  text: string;
  category: PhraseCategory;
  tts_url?: string;
  usage_count: number;
  last_used_at?: string;
  order_index: number;
  created_at?: string;
  updated_at?: string;
}

export interface MemoryProfileSnapshot {
  memories: Memory[];
  sessions: Session[];
  hotwords: string[];
  hotword_profiles: HotwordProfileRecord[];
  growth_profile: MemoryGrowthProfileSnapshot;
  synced_at: string;
}

export interface ProfileBundleItem {
  id: string;
  title: string;
  content: string;
  source: 'user_profile' | 'hotword_profile' | 'memory' | 'session';
  emphasis: 'high' | 'medium' | 'low';
  tags?: string[];
  updated_at?: string;
}

export interface ProfileBundleSnapshot {
  static: ProfileBundleItem[];
  dynamic: ProfileBundleItem[];
  relevant: ProfileBundleItem[];
}

export interface SessionReviewSnapshot {
  session_id: string | null;
  headline: string;
  summary: string;
  focus: string[];
  recent_win: string | null;
  next_step: string | null;
  updated_at: string;
}

export interface ExpressionKitSuggestion {
  id: string;
  text: string;
  source: 'quick_phrase' | 'hotword_profile' | 'frequent_expression';
  category: string;
  note?: string;
  priority: number;
}

export interface WorkspaceMemorySnapshot {
  registration_profile: {
    full_name?: string;
    province?: string;
    city?: string;
    disability_category?: string;
    condition?: string;
    etiology?: string;
    has_dialect?: boolean;
    dialect_profiles?: Array<{ name: string; region: string }> | null;
    dialect_name?: string;
  };
  user_profile_memory: UserProfileMemoryRecord;
  scene_templates: {
    selected_ids: string[];
    library: Array<{
      id: string;
      title: string;
      summary: string;
      scenario: string;
      severity_hint: string;
      condition_hint: string;
      communication_goal: string;
      source_basis: string;
      focus_priority: string[];
      risky_terms: string[];
      support_strategies: string[];
      starter_phrases: string[];
      hotwords: Array<{
        phrase: string;
        category: string;
        note: string;
      }>;
      updated_at: string;
    }>;
  };
  object_zones: Array<{
    id: 'custom_materials' | 'scene_and_hotword_templates' | 'user_profile';
    title: string;
    description: string;
    empty_state: string;
    items: Array<{
      id: string;
      type: 'custom_material' | 'scene_template' | 'user_profile';
      title: string;
      summary: string;
      tags: string[];
      load_behavior: 'manual' | 'recommended' | 'always_on' | 'derived';
      editable: boolean;
      updated_at: string;
    }>;
  }>;
  communication_loadout: {
    recommended_mode: 'urgent' | 'long_form';
    reason: string;
    sections: Array<{
      id: 'always_on' | 'scene_pack' | 'custom_materials';
      title: string;
      description: string;
      items: Array<{
        id: string;
        title: string;
        summary: string;
        source_type: 'custom_material' | 'scene_template' | 'user_profile';
        required: boolean;
        default_selected?: boolean;
        document_content?: string | null;
        reference_lines?: string[];
        hotwords?: string[];
        risky_terms?: string[];
        support_strategies?: string[];
      }>;
    }>;
    updated_at: string;
  };
  profile_bundle: ProfileBundleSnapshot;
  session_review: SessionReviewSnapshot;
  preparation: {
    active_scene_id: WorkspaceSceneId | null;
    profile_summary: string;
    overview: string;
    immediate_goal: string | null;
    scene_brief: string | null;
    common_scenarios: string[];
    strong_phrases: string[];
    risky_terms: string[];
    pronunciation_patterns: string[];
    listener_guidance: string[];
    support_strategies: string[];
    hotwords: string[];
    asr_hotword_entries: PreparedExpressionAsrHotwordEntry[];
    document_context_summary: string | null;
    document_content: string | null;
    reference_lines: string[];
    training_pairs: PreparedExpressionCorrectionPair[];
    next_step: string | null;
    updated_at: string;
  };
  prepared_expression_library: {
    active_id: string | null;
    items: Array<{
      id: string;
      title: string;
      summary: string;
      scene: string | null;
      source: string;
      updated_at: string;
      rehearsal_count: number;
      last_rehearsed_at: string | null;
      is_active: boolean;
    }>;
  };
  prepared_expression: {
    id: string;
    title: string;
    summary: string;
    scene: string | null;
    source: string;
    document_content: string;
    last_rehearsed_at: string | null;
    rehearsal_count: number;
    low_confidence_sections: number;
    hotwords: string[];
    high_risk_phrases: string[];
    fallback_phrases: string[];
    asr_hotword_entries: PreparedExpressionAsrHotwordEntry[];
    reference_lines: string[];
    practice_lines: Array<{
      id: string;
      text: string;
      section_id: string;
      section_title: string;
    }>;
    training_reports: {
      daily_summary: {
        summary: string;
        sample_count: number;
        mismatch_pairs: PreparedExpressionCorrectionPair[];
        next_focus: string[];
        stable_wins: string[];
        pronunciation_patterns: string[];
        support_strategies: string[];
        generated_at: string;
      } | null;
      weekly_summary: {
        summary: string;
        sample_count: number;
        mismatch_pairs: PreparedExpressionCorrectionPair[];
        next_focus: string[];
        stable_wins: string[];
        pronunciation_patterns: string[];
        support_strategies: string[];
        generated_at: string;
      } | null;
      training_plan: {
        summary: string;
        items: string[];
        generated_at: string;
      } | null;
    } | null;
    sections: Array<{
      id: string;
      title: string;
      summary: string;
      anchor_line: string;
      practice_lines: string[];
      high_risk_phrases: string[];
      fallback_phrases: string[];
      hotwords: string[];
      rehearsal_count: number;
      low_confidence_count: number;
      latest_feedback_status: FeedbackStatus | null;
      last_rehearsed_at: string | null;
      is_priority: boolean;
    }>;
    updated_at: string;
  } | null;
  training_activity: {
    daily_target_count: number;
    slogan: string;
    yesterday: {
      day_key: string;
      total_recordings: number;
      top_contributors: Array<{
        rank: number;
        recording_count: number;
      }>;
    };
  };
  expression_kit: {
    active_scene_id: WorkspaceSceneId | null;
    recommended_phrases: ExpressionKitSuggestion[];
    quick_phrases: QuickPhrase[];
    hotword_profiles: HotwordProfileRecord[];
    recommended_focus: string[];
    communication_preferences: CommunicationPreferences;
  };
  synced_at: string;
}

export interface PreparedExpressionLibraryRecord {
  active_asset_id: string | null;
  assets: PreparedExpressionAsset[];
  updated_at: string;
}

export interface CommunicationPreferences {
  opening_phrase?: string;
  pace_hint?: string;
  repair_phrase?: string;
}

export type HotwordCategory =
  | 'medical'
  | 'profession'
  | 'family'
  | 'daily'
  | 'emergency'
  | 'custom';

export interface HotwordProfileRecord {
  id: string;
  phrase: string;
  category: HotwordCategory;
  scenario: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export type PhraseCategory =
  | 'greeting'
  | 'need'
  | 'emotion'
  | 'medical'
  | 'shopping'
  | 'dining'
  | 'transport'
  | 'custom';

export function normalizeCommunicationPreferences(value: unknown): CommunicationPreferences {
  if (!isRecord(value)) {
    return {};
  }

  return {
    opening_phrase: readString(value, 'opening_phrase') ?? undefined,
    pace_hint: readString(value, 'pace_hint') ?? undefined,
    repair_phrase: readString(value, 'repair_phrase') ?? undefined,
  };
}

export function normalizeUserProfileMemory(value: unknown): UserProfileMemoryRecord {
  if (!isRecord(value)) {
    return {};
  }

  const etiology = readString(value, 'etiology');
  const severity = readString(value, 'severity');

  return {
    etiology:
      etiology && USER_PROFILE_ETIOLOGY_VALUES.includes(etiology as typeof USER_PROFILE_ETIOLOGY_VALUES[number])
        ? etiology
        : undefined,
    severity:
      severity && USER_PROFILE_SEVERITY_VALUES.includes(severity as typeof USER_PROFILE_SEVERITY_VALUES[number])
        ? severity
        : undefined,
    document: readString(value, 'document') ?? undefined,
    summary: readString(value, 'summary') ?? undefined,
    common_scenarios: readStringList(value.common_scenarios),
    risky_terms: readStringList(value.risky_terms),
    support_strategies: readStringList(value.support_strategies),
    updated_at: readString(value, 'updated_at') ?? undefined,
  };
}

function dedupeStrings(values: string[], limit?: number): string[] {
  const unique = Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );

  return typeof limit === 'number' ? unique.slice(0, limit) : unique;
}

function dedupeLoadoutItems<T extends { id: string }>(items: Array<T | null | undefined>): T[] {
  const results: T[] = [];
  const seen = new Set<string>();

  items.forEach((item) => {
    if (!item || seen.has(item.id)) {
      return;
    }

    seen.add(item.id);
    results.push(item);
  });

  return results;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function summarizeLongText(value: string | null | undefined, maxLength = 220): string | null {
  if (!value || !value.trim()) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}...`
    : normalized;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function sortPhrasesForSuggestions(phrases: QuickPhrase[]): QuickPhrase[] {
  return [...phrases].sort((left, right) => {
    if (right.usage_count !== left.usage_count) {
      return right.usage_count - left.usage_count;
    }

    return left.order_index - right.order_index;
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: JsonRecord | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(record: JsonRecord | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeHotwordCategory(value: unknown): HotwordCategory {
  if (
    value === 'medical' ||
    value === 'profession' ||
    value === 'family' ||
    value === 'daily' ||
    value === 'emergency'
  ) {
    return value;
  }

  return 'custom';
}

function normalizeHotwordProfiles(value: unknown): HotwordProfileRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const profiles: HotwordProfileRecord[] = [];

  value.forEach((item) => {
    if (!isRecord(item)) {
      return;
    }

    const phrase = readString(item, 'phrase');
    if (!phrase) {
      return;
    }

    const createdAt = readNumber(item, 'createdAt') ?? Date.now();
    const updatedAt = readNumber(item, 'updatedAt') ?? createdAt;

    profiles.push({
      id: readString(item, 'id') ?? `${phrase}_${createdAt}`,
      phrase,
      category: normalizeHotwordCategory(readString(item, 'category')),
      scenario: readString(item, 'scenario') ?? '',
      note: readString(item, 'note') ?? undefined,
      createdAt,
      updatedAt,
    });
  });

  return profiles.sort((left, right) => right.updatedAt - left.updatedAt);
}

function normalizeSceneTemplateCatalog(
  templates: SceneTemplateDefinition[],
): WorkspaceMemorySnapshot['scene_templates']['library'] {
  return templates.map((template) => ({
    id: template.id,
    title: template.title,
    summary: template.summary,
    scenario: template.scenario,
    severity_hint: template.severity_hint,
    condition_hint: template.condition_hint,
    communication_goal: template.communication_goal,
    source_basis: template.source_basis,
    focus_priority: [...template.focus_priority],
    risky_terms: [...template.risky_terms],
    support_strategies: [...template.support_strategies],
    starter_phrases: [...template.starter_phrases],
    hotwords: template.hotwords.map((entry) => ({
      phrase: entry.phrase,
      category: entry.category,
      note: entry.note,
    })),
    updated_at: template.updated_at,
  }));
}

export class SupabaseService {
  private adminClient: SupabaseClient; // service_role client for system operations
  private static instance: SupabaseService;
  private readonly preparedExpressionSummaryService = new PreparedExpressionSummaryService();

  private constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing Supabase environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY',
      );
    }

    // Backend-owned data must never silently fall back to a browser-facing key.
    this.adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  }

  public static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  // === User Profiles ===
  async ensureUserProfile(userId: string): Promise<boolean> {
    const { error } = await this.adminClient
      .from('user_profiles')
      .upsert(
        {
          id: userId,
        },
        { onConflict: 'id' },
      );

    if (error) {
      console.error('Error ensuring user profile:', error);
      return false;
    }

    return true;
  }

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await this.adminClient
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
    return data;
  }

  async createUserProfile(profile: UserProfile): Promise<UserProfile | null> {
    const { data, error } = await this.adminClient
      .from('user_profiles')
      .insert(profile)
      .select()
      .single();

    if (error) {
      console.error('Error creating user profile:', error);
      return null;
    }
    return data;
  }

  async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<UserProfile | null> {
    const { data, error } = await this.adminClient
      .from('user_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating user profile:', error);
      return null;
    }
    return data;
  }

  async getHotwordProfiles(userId: string): Promise<HotwordProfileRecord[]> {
    const userProfile = await this.getUserProfile(userId);
    return this.getHotwordProfilesFromProfile(userProfile);
  }

  private getHotwordProfilesFromProfile(userProfile: UserProfile | null): HotwordProfileRecord[] {
    const selectedTemplateIds = this.getSelectedSceneTemplateIdsFromProfile(userProfile);
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : {};
    const customProfiles = normalizeHotwordProfiles(preferences.hotword_profiles);
    const templateProfiles = buildHotwordProfilesFromSceneTemplateIds(selectedTemplateIds);
    const seenPhrases = new Set<string>();
    return [...customProfiles, ...templateProfiles].filter((profile) => {
      const key = profile.phrase.trim().toLocaleLowerCase();
      if (!key || seenPhrases.has(key)) return false;
      seenPhrases.add(key);
      return true;
    });
  }

  getSceneTemplateCatalog(): WorkspaceMemorySnapshot['scene_templates']['library'] {
    return normalizeSceneTemplateCatalog(listSceneTemplates());
  }

  private getSelectedSceneTemplateIdsFromProfile(userProfile: UserProfile | null): string[] {
    const preferences = isRecord(userProfile?.preferences) ? userProfile?.preferences : undefined;
    return normalizeSelectedSceneTemplateIds(preferences?.selected_scene_template_ids);
  }

  async getSelectedSceneTemplateIds(userId: string): Promise<string[]> {
    const userProfile = await this.getUserProfile(userId);
    return this.getSelectedSceneTemplateIdsFromProfile(userProfile);
  }

  async saveSelectedSceneTemplateIds(
    userId: string,
    selectedTemplateIds: string[],
  ): Promise<string[]> {
    await this.ensureUserProfile(userId);

    const normalizedTemplateIds = normalizeSelectedSceneTemplateIds(selectedTemplateIds);
    const userProfile = await this.getUserProfile(userId);
    const existingPreferences = isRecord(userProfile?.preferences)
      ? userProfile?.preferences
      : {};
    const nextPreferences: JsonRecord = {
      ...existingPreferences,
      selected_scene_template_ids: normalizedTemplateIds,
    };
    const templateHotwords = buildHotwordProfilesFromSceneTemplateIds(normalizedTemplateIds)
      .map((profile) => profile.phrase);
    const customHotwords = normalizeHotwordProfiles(existingPreferences.hotword_profiles)
      .map((profile) => profile.phrase);
    const preparedExpressionAsset = this.readPreparedExpressionAssetFromProfile(userProfile);

    await this.updateUserProfile(userId, {
      preferences: nextPreferences,
      hotwords: dedupeStrings(
        [
          ...templateHotwords,
          ...customHotwords,
          ...(preparedExpressionAsset?.structured.hotwords ?? []),
        ],
        20,
      ),
    });

    return normalizedTemplateIds;
  }

  async listPreparedExpressionSummaryRefreshCandidates(limit: number = 20): Promise<string[]> {
    const fetchLimit = Math.max(limit * 5, 50);
    const { data, error } = await this.adminClient
      .from('user_profiles')
      .select('id, preferences, updated_at')
      .order('updated_at', { ascending: true })
      .limit(fetchLimit);

    if (error || !Array.isArray(data)) {
      if (error) {
        console.error('Error listing prepared expression summary refresh candidates:', error);
      }
      return [];
    }

    const now = Date.now();
    const staleCandidates = data
      .map((row) => {
        const userProfile = row as UserProfile;
        const asset = this.readPreparedExpressionAssetFromProfile(userProfile);
        if (!asset) {
          return null;
        }

        const dailyGeneratedAt = asset.training_reports?.dailySummary?.generated_at ?? null;
        const weeklyGeneratedAt = asset.training_reports?.weeklySummary?.generated_at ?? null;
        const dailyStale =
          !dailyGeneratedAt || now - new Date(dailyGeneratedAt).getTime() > 18 * 60 * 60 * 1000;
        const weeklyStale =
          !weeklyGeneratedAt || now - new Date(weeklyGeneratedAt).getTime() > 6 * 24 * 60 * 60 * 1000;

        if (!dailyStale && !weeklyStale) {
          return null;
        }

        const lastGeneratedAt = [dailyGeneratedAt, weeklyGeneratedAt]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .sort()[0] ?? '';

        return {
          userId: row.id as string,
          preparedExpressionId: asset.structured.id,
          dailyGeneratedAt,
          weeklyGeneratedAt,
          dailyStale,
          weeklyStale,
          lastGeneratedAt,
        };
      })
      .filter((item): item is {
        userId: string;
        preparedExpressionId: string;
        dailyGeneratedAt: string | null;
        weeklyGeneratedAt: string | null;
        dailyStale: boolean;
        weeklyStale: boolean;
        lastGeneratedAt: string;
      } => item !== null);

    const candidates: Array<{ userId: string; lastGeneratedAt: string }> = [];

    for (const candidate of staleCandidates) {
      const samples = await this.getTrainingResultSamples(candidate.userId);
      const shouldRefreshDaily =
        candidate.dailyStale &&
        this.hasPendingPreparedExpressionSamples(
          samples,
          candidate.dailyGeneratedAt,
          24 * 60 * 60 * 1000,
          now,
        );
      const shouldRefreshWeekly =
        candidate.weeklyStale &&
        this.hasPendingPreparedExpressionSamples(
          samples,
          candidate.weeklyGeneratedAt,
          7 * 24 * 60 * 60 * 1000,
          now,
        );

      if (!shouldRefreshDaily && !shouldRefreshWeekly) {
        continue;
      }

      candidates.push({
        userId: candidate.userId,
        lastGeneratedAt: candidate.lastGeneratedAt,
      });
    }

    return candidates
      .sort((left, right) => left.lastGeneratedAt.localeCompare(right.lastGeneratedAt))
      .slice(0, limit)
      .map((item) => item.userId);
  }

  private hasPendingPreparedExpressionSamples(
    samples: PreparedExpressionTrainingSample[],
    generatedAt: string | null,
    windowMs: number,
    now: number,
  ): boolean {
    const generatedAtTime = generatedAt ? new Date(generatedAt).getTime() : null;

    return samples.some((sample) => {
      const createdAtTime = sample.created_at ? new Date(sample.created_at).getTime() : Number.NaN;
      if (!Number.isFinite(createdAtTime)) {
        return false;
      }

      if (now - createdAtTime > windowMs) {
        return false;
      }

      return generatedAtTime === null || createdAtTime > generatedAtTime;
    });
  }

  async saveHotwordProfiles(
    userId: string,
    profiles: HotwordProfileRecord[],
  ): Promise<HotwordProfileRecord[]> {
    await this.ensureUserProfile(userId);

    const normalizedProfiles = normalizeHotwordProfiles(profiles);
    const userProfile = await this.getUserProfile(userId);
    const existingPreferences = isRecord(userProfile?.preferences)
      ? userProfile?.preferences
      : {};
    const nextPreferences: JsonRecord = {
      ...existingPreferences,
      hotword_profiles: normalizedProfiles,
    };
    const nextHotwords = Array.from(
      new Set([
        ...buildHotwordProfilesFromSceneTemplateIds(
          this.getSelectedSceneTemplateIdsFromProfile(userProfile),
        ).map((profile) => profile.phrase),
        ...normalizedProfiles.map((profile) => profile.phrase),
        ...(this.readPreparedExpressionAssetFromProfile(userProfile)?.structured.hotwords ?? []),
      ]),
    ).slice(0, 20);

    const updated = await this.updateUserProfile(userId, {
      preferences: nextPreferences,
      hotwords: nextHotwords,
    });

    if (!updated) {
      return [];
    }

    return normalizeHotwordProfiles(
      isRecord(updated.preferences) ? updated.preferences.hotword_profiles : [],
    );
  }

  async saveCommunicationPreferences(
    userId: string,
    preferences: CommunicationPreferences,
  ): Promise<CommunicationPreferences> {
    await this.ensureUserProfile(userId);

    const normalizedPreferences = normalizeCommunicationPreferences(preferences);
    const userProfile = await this.getUserProfile(userId);
    const existingPreferences = isRecord(userProfile?.preferences)
      ? userProfile.preferences
      : {};
    const nextPreferences: JsonRecord = {
      ...existingPreferences,
      communication_preferences: normalizedPreferences,
    };

    const updated = await this.updateUserProfile(userId, {
      preferences: nextPreferences,
    });

    if (!updated) {
      return {};
    }

    return normalizeCommunicationPreferences(
      isRecord(updated.preferences) ? updated.preferences.communication_preferences : undefined,
    );
  }

  async updateUserProfileMemory(
    userId: string,
    input: UserProfileMemoryRecord,
    options: { replaceLists?: boolean; replaceFields?: boolean } = {},
  ): Promise<UserProfileMemoryRecord> {
    await this.ensureUserProfile(userId);

    const userProfile = await this.getUserProfile(userId);
    const existingPreferences = isRecord(userProfile?.preferences)
      ? userProfile.preferences
      : {};
    const existingProfileMemory = normalizeUserProfileMemory(
      existingPreferences.user_profile_memory,
    );
    const normalizedInput = normalizeUserProfileMemory(input);
    const updatedAt = normalizedInput.updated_at ?? new Date().toISOString();
    const nextProfileMemory: UserProfileMemoryRecord = {
      etiology: options.replaceFields ? normalizedInput.etiology : normalizedInput.etiology ?? existingProfileMemory.etiology,
      severity: options.replaceFields ? normalizedInput.severity : normalizedInput.severity ?? existingProfileMemory.severity,
      document: options.replaceFields ? normalizedInput.document : normalizedInput.document ?? existingProfileMemory.document,
      summary: normalizedInput.summary ?? existingProfileMemory.summary,
      common_scenarios: dedupeStrings(options.replaceLists
        ? normalizedInput.common_scenarios ?? []
        : [...(normalizedInput.common_scenarios ?? []), ...(existingProfileMemory.common_scenarios ?? [])], 6),
      risky_terms: dedupeStrings(options.replaceLists
        ? normalizedInput.risky_terms ?? []
        : [...(normalizedInput.risky_terms ?? []), ...(existingProfileMemory.risky_terms ?? [])], 6),
      support_strategies: dedupeStrings(options.replaceLists
        ? normalizedInput.support_strategies ?? []
        : [...(normalizedInput.support_strategies ?? []), ...(existingProfileMemory.support_strategies ?? [])], 6),
      updated_at: updatedAt,
    };

    const nextPreferences: JsonRecord = {
      ...existingPreferences,
      user_profile_memory: nextProfileMemory,
    };

    const updated = await this.updateUserProfile(userId, {
      preferences: nextPreferences,
    });

    if (!updated) {
      return existingProfileMemory;
    }

    return this.readUserProfileMemoryFromProfile(updated);
  }

  async getUserProfileMemory(userId: string): Promise<UserProfileMemoryRecord> {
    await this.ensureUserProfile(userId);
    const userProfile = await this.getUserProfile(userId);
    return this.readUserProfileMemoryFromProfile(userProfile);
  }

  async getPreparedExpressionLibrary(userId: string): Promise<PreparedExpressionLibraryRecord> {
    const userProfile = await this.migratePreparedExpressionLibraryIfNeeded(
      userId,
      await this.getUserProfile(userId),
    );
    return this.readPreparedExpressionLibraryFromProfile(userProfile);
  }

  async getPreparedExpressionAsset(
    userId: string,
    assetId?: string | null,
  ): Promise<PreparedExpressionAsset | null> {
    const userProfile = await this.migratePreparedExpressionLibraryIfNeeded(
      userId,
      await this.getUserProfile(userId),
    );
    const library = this.readPreparedExpressionLibraryFromProfile(userProfile);

    if (assetId?.trim()) {
      return library.assets.find((asset) => asset.draft.id === assetId.trim()) ?? null;
    }

    return this.getActivePreparedExpressionAsset(library);
  }

  async savePreparedExpressionAsset(
    userId: string,
    input: {
      id?: string | null;
      title?: string | null;
      scene?: string | null;
      source?: string | null;
      content: string;
      make_active?: boolean;
    },
  ): Promise<PreparedExpressionLibraryRecord> {
    await this.ensureUserProfile(userId);

    const userProfile = await this.getUserProfile(userId);
    const existingPreferences = isRecord(userProfile?.preferences)
      ? userProfile.preferences
      : {};
    const existingLibrary = this.readPreparedExpressionLibraryFromProfile(userProfile);
    const targetAssetId = input.id?.trim() || null;
    const existingAsset = targetAssetId
      ? existingLibrary.assets.find((asset) => asset.draft.id === targetAssetId) ?? null
      : null;
    const nextAsset = createPreparedExpressionAssetFromDraft({
      id: existingAsset?.draft.id ?? targetAssetId ?? null,
      title: input.title ?? existingAsset?.draft.title ?? null,
      scene: input.scene ?? existingAsset?.draft.scene ?? null,
      source: input.source ?? existingAsset?.draft.source ?? null,
      content: input.content,
      updatedAt: new Date().toISOString(),
    });
    const nextAssets = existingAsset
      ? existingLibrary.assets.map((asset) => (
          asset.draft.id === nextAsset.draft.id ? nextAsset : asset
        ))
      : [nextAsset, ...existingLibrary.assets];
    const nextLibrary: PreparedExpressionLibraryRecord = {
      active_asset_id:
        input.make_active === false
          ? existingLibrary.active_asset_id
          : nextAsset.draft.id,
      assets: nextAssets,
      updated_at: new Date().toISOString(),
    };
    const nextPreferences = this.buildPreparedExpressionPreferences(
      existingPreferences,
      nextLibrary,
    );

    const updated = await this.updateUserProfile(userId, {
      preferences: nextPreferences,
      hotwords: dedupeStrings(
        [
          ...(userProfile?.hotwords ?? []),
          ...nextAsset.structured.hotwords,
        ],
        20,
      ),
    });

    return updated
      ? this.readPreparedExpressionLibraryFromProfile(updated)
      : nextLibrary;
  }

  async setActivePreparedExpressionAsset(
    userId: string,
    assetId: string,
  ): Promise<PreparedExpressionLibraryRecord> {
    await this.ensureUserProfile(userId);

    const userProfile = await this.getUserProfile(userId);
    const existingPreferences = isRecord(userProfile?.preferences)
      ? userProfile.preferences
      : {};
    const existingLibrary = this.readPreparedExpressionLibraryFromProfile(userProfile);
    const normalizedAssetId = assetId.trim();
    const assetExists = existingLibrary.assets.some((asset) => asset.draft.id === normalizedAssetId);

    if (!assetExists) {
      return existingLibrary;
    }

    const nextLibrary: PreparedExpressionLibraryRecord = {
      active_asset_id: normalizedAssetId,
      assets: existingLibrary.assets,
      updated_at: new Date().toISOString(),
    };
    const nextPreferences = this.buildPreparedExpressionPreferences(
      existingPreferences,
      nextLibrary,
    );

    const updated = await this.updateUserProfile(userId, {
      preferences: nextPreferences,
    });

    return updated
      ? this.readPreparedExpressionLibraryFromProfile(updated)
      : nextLibrary;
  }

  async deletePreparedExpressionAsset(
    userId: string,
    assetId?: string | null,
  ): Promise<PreparedExpressionLibraryRecord> {
    await this.ensureUserProfile(userId);

    const userProfile = await this.getUserProfile(userId);
    const existingPreferences = isRecord(userProfile?.preferences)
      ? userProfile.preferences
      : {};
    const existingLibrary = this.readPreparedExpressionLibraryFromProfile(userProfile);
    const targetAssetId = assetId?.trim() || existingLibrary.active_asset_id;
    const remainingAssets = targetAssetId
      ? existingLibrary.assets.filter((asset) => asset.draft.id !== targetAssetId)
      : [];
    const nextLibrary: PreparedExpressionLibraryRecord = {
      active_asset_id: remainingAssets[0]?.draft.id ?? null,
      assets: remainingAssets,
      updated_at: new Date().toISOString(),
    };
    const nextPreferences = this.buildPreparedExpressionPreferences(
      existingPreferences,
      nextLibrary,
    );

    await this.updateUserProfile(userId, {
      preferences: nextPreferences,
    });

    return nextLibrary;
  }

  async summarizePreparedExpressionAsset(
    userId: string,
    trigger: PreparedExpressionSummaryTrigger = 'manual',
    assetId?: string | null,
  ): Promise<PreparedExpressionLibraryRecord> {
    await this.ensureUserProfile(userId);

    const userProfile = await this.getUserProfile(userId);
    const existingPreferences = isRecord(userProfile?.preferences)
      ? userProfile.preferences
      : {};
    const existingLibrary = this.readPreparedExpressionLibraryFromProfile(userProfile);
    const targetAsset = assetId?.trim()
      ? existingLibrary.assets.find((asset) => asset.draft.id === assetId.trim()) ?? null
      : this.getActivePreparedExpressionAsset(existingLibrary);
    const existingAsset = targetAsset;
    if (!existingAsset) {
      return existingLibrary;
    }
    const samples = await this.getTrainingResultSamples(userId);
    const summarized = await this.preparedExpressionSummaryService.summarize(
      existingAsset,
      samples,
      trigger,
    );

    const nextLibrary: PreparedExpressionLibraryRecord = {
      active_asset_id: existingLibrary.active_asset_id,
      assets: existingLibrary.assets.map((asset) => (
        asset.draft.id === summarized.draft.id ? summarized : asset
      )),
      updated_at: new Date().toISOString(),
    };
    const nextPreferences = this.buildPreparedExpressionPreferences(
      existingPreferences,
      nextLibrary,
    );

    const updated = await this.updateUserProfile(userId, {
      preferences: nextPreferences,
      hotwords: dedupeStrings(
        [
          ...(userProfile?.hotwords ?? []),
          ...summarized.structured.hotwords,
        ],
        20,
      ),
    });

    return updated
      ? this.readPreparedExpressionLibraryFromProfile(updated)
      : nextLibrary;
  }

  // === Sessions ===
  async ensureSession(session: Session): Promise<Session | null> {
    await this.ensureUserProfile(session.user_id);

    const { data, error } = await this.adminClient
      .from('sessions')
      .upsert(
        {
          ...session,
          metadata: session.metadata || {},
        },
        { onConflict: 'id' },
      )
      .select()
      .single();

    if (error) {
      console.error('Error ensuring session:', error);
      return null;
    }
    return data;
  }

  async createSession(session: Session): Promise<Session | null> {
    const { data, error } = await this.adminClient
      .from('sessions')
      .insert(session)
      .select()
      .single();

    if (error) {
      console.error('Error creating session:', error);
      return null;
    }
    return data;
  }

  async endSession(sessionId: string, endTime: string, transcript?: string): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const duration = Math.floor((new Date(endTime).getTime() - new Date(session.start_time).getTime()) / 1000);

    const { data, error } = await this.adminClient
      .from('sessions')
      .update({ end_time: endTime, duration, transcript })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('Error ending session:', error);
      return null;
    }
    return data;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const { data, error } = await this.adminClient
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error) {
      console.error('Error fetching session:', error);
      return null;
    }
    return data;
  }

  async getUserSessions(userId: string, limit: number = 10): Promise<Session[]> {
    const { data, error } = await this.adminClient
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('start_time', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching user sessions:', error);
      return [];
    }
    return data || [];
  }

  // === Memories ===
  async addMemory(memory: Memory): Promise<Memory | null> {
    await this.ensureUserProfile(memory.user_id);

    const { data, error } = await this.adminClient
      .from('memories')
      .insert(memory)
      .select()
      .single();

    if (error) {
      console.error('Error adding memory:', error);
      return null;
    }
    return data;
  }

  async getMemories(userId: string, limit: number = 50): Promise<Memory[]> {
    const { data, error } = await this.adminClient
      .from('memories')
      .select('id, user_id, session_id, content, metadata, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching memories:', error);
      return [];
    }
    return data || [];
  }

  async searchMemories(userId: string, query: string, limit: number = 10): Promise<Memory[]> {
    // TODO: Implement semantic search with pgvector
    // For now, simple text search
    const { data, error } = await this.adminClient
      .from('memories')
      .select('*')
      .eq('user_id', userId)
      .textSearch('content', query)
      .limit(limit);

    if (error) {
      console.error('Error searching memories:', error);
      return [];
    }
    return data || [];
  }

  async getMemoryById(memoryId: string): Promise<Memory | null> {
    const { data, error } = await this.adminClient
      .from('memories')
      .select('*')
      .eq('id', memoryId)
      .single();

    if (error) {
      console.error('Error fetching memory by ID:', error);
      return null;
    }
    return data;
  }

  async updateMemory(memoryId: string, updates: Partial<Memory>): Promise<Memory | null> {
    const { data, error } = await this.adminClient
      .from('memories')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', memoryId)
      .select()
      .single();

    if (error) {
      console.error('Error updating memory:', error);
      return null;
    }
    return data;
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    const { error } = await this.adminClient
      .from('memories')
      .delete()
      .eq('id', memoryId);

    if (error) {
      console.error('Error deleting memory:', error);
      return false;
    }
    return true;
  }

  async getUserMemoryProfile(
    userId: string,
    memoryLimit: number = 400,
    sessionLimit: number = 120,
  ): Promise<MemoryProfileSnapshot> {
    const [memories, sessions, userProfile] = await Promise.all([
      this.getMemories(userId, memoryLimit),
      this.getUserSessions(userId, sessionLimit),
      this.getUserProfile(userId),
    ]);
    return this.buildMemoryProfileSnapshot(memories, sessions, userProfile);
  }

  private buildMemoryProfileSnapshot(
    memories: Memory[],
    sessions: Session[],
    userProfile: UserProfile | null,
  ): MemoryProfileSnapshot {
    const hotwordProfiles = this.getHotwordProfilesFromProfile(userProfile);
    const collectedHotwords = this.collectHotwords(memories, sessions);
    const profileHotwords = Array.isArray(userProfile?.hotwords)
      ? userProfile.hotwords.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    const hotwords = Array.from(
      new Set([
        ...hotwordProfiles.map((profile) => profile.phrase),
        ...profileHotwords,
        ...collectedHotwords,
      ]),
    ).slice(0, 20);

    return {
      memories,
      sessions,
      hotwords,
      hotword_profiles: hotwordProfiles,
      growth_profile: buildMemoryGrowthProfileSnapshot({
        memories,
        sessions,
        hotwords,
      }),
      synced_at: new Date().toISOString(),
    };
  }

  private readPreparedExpressionAssetFromProfile(
    userProfile: UserProfile | null,
  ): PreparedExpressionAsset | null {
    return this.getActivePreparedExpressionAsset(
      this.readPreparedExpressionLibraryFromProfile(userProfile),
    );
  }

  private readLegacyPreparedExpressionAssetFromProfile(
    userProfile: UserProfile | null,
  ): PreparedExpressionAsset | null {
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : undefined;
    return normalizePreparedExpressionAsset(preferences?.prepared_expression_asset);
  }

  private readPreparedExpressionLibraryFromProfile(
    userProfile: UserProfile | null,
  ): PreparedExpressionLibraryRecord {
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : undefined;
    const libraryValue = isRecord(preferences?.prepared_expression_assets)
      ? preferences.prepared_expression_assets
      : undefined;
    const assetsSource = Array.isArray(libraryValue?.assets)
      ? libraryValue.assets
      : [];
    const assets = assetsSource
      .map((asset) => normalizePreparedExpressionAsset(asset))
      .filter((asset): asset is PreparedExpressionAsset => Boolean(asset));
    const legacyAsset = assets.length > 0
      ? null
      : this.readLegacyPreparedExpressionAssetFromProfile(userProfile);
    const normalizedAssets = legacyAsset ? [legacyAsset] : assets;
    const activeAssetId = readString(libraryValue, 'active_asset_id');
    const normalizedActiveAssetId =
      activeAssetId && normalizedAssets.some((asset) => asset.draft.id === activeAssetId)
        ? activeAssetId
        : normalizedAssets[0]?.draft.id ?? null;

    return {
      active_asset_id: normalizedActiveAssetId,
      assets: normalizedAssets,
      updated_at:
        readString(libraryValue, 'updated_at')
        ?? normalizedAssets[0]?.draft.updated_at
        ?? new Date().toISOString(),
    };
  }

  private async migratePreparedExpressionLibraryIfNeeded(
    userId: string,
    userProfile: UserProfile | null,
  ): Promise<UserProfile | null> {
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : undefined;
    const libraryValue = isRecord(preferences?.prepared_expression_assets)
      ? preferences.prepared_expression_assets
      : undefined;
    const hasNewLibrary = Array.isArray(libraryValue?.assets) && libraryValue.assets.length > 0;
    const legacyAsset = this.readLegacyPreparedExpressionAssetFromProfile(userProfile);

    if (hasNewLibrary || !legacyAsset) {
      return userProfile;
    }

    const nextPreferences = this.buildPreparedExpressionPreferences(
      preferences ?? {},
      {
        active_asset_id: legacyAsset.draft.id,
        assets: [legacyAsset],
        updated_at: legacyAsset.draft.updated_at ?? new Date().toISOString(),
      },
    );

    return this.updateUserProfile(userId, {
      preferences: nextPreferences,
    });
  }

  private getActivePreparedExpressionAsset(
    library: PreparedExpressionLibraryRecord,
  ): PreparedExpressionAsset | null {
    if (!library.active_asset_id) {
      return library.assets[0] ?? null;
    }

    return library.assets.find((asset) => asset.draft.id === library.active_asset_id) ?? library.assets[0] ?? null;
  }

  private buildPreparedExpressionPreferences(
    existingPreferences: JsonRecord,
    library: PreparedExpressionLibraryRecord,
  ): JsonRecord {
    const nextPreferences: JsonRecord = {
      ...existingPreferences,
      prepared_expression_assets: {
        active_asset_id: library.active_asset_id,
        assets: library.assets,
        updated_at: library.updated_at,
      },
    };

    delete nextPreferences.prepared_expression_asset;
    return nextPreferences;
  }

  private readUserProfileMemoryFromProfile(
    userProfile: UserProfile | null,
  ): UserProfileMemoryRecord {
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : undefined;
    const memory = normalizeUserProfileMemory(preferences?.user_profile_memory);
    return {
      ...memory,
      etiology: memory.etiology ?? userProfile?.etiology,
    };
  }

  private async getTrainingResultSamples(
    userId: string,
  ): Promise<PreparedExpressionTrainingSample[]> {
    const weeklyWindowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const pageSize = 1000;
    const rows: VoiceContributionRow[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.adminClient
        .from('voice_contributions')
        .select('created_at, transcript, metadata')
        .eq('contributor_id', userId)
        .gte('created_at', weeklyWindowStart)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);

      if (error || !Array.isArray(data)) {
        if (error) {
          console.error('Error fetching training result samples:', error);
        }
        return [];
      }

      rows.push(...(data as VoiceContributionRow[]));

      if (data.length < pageSize) {
        break;
      }
    }

    return rows
      .filter((row) => {
        const metadata = isRecord(row.metadata) ? row.metadata : undefined;
        return (
          readString(metadata, 'kind') === 'training_result'
        );
      })
      .sort((left, right) => {
        const leftTime = new Date(left.created_at ?? 0).getTime();
        const rightTime = new Date(right.created_at ?? 0).getTime();
        return rightTime - leftTime;
      })
      .map((row) => {
        const metadata = isRecord(row.metadata) ? row.metadata : undefined;

        return {
          created_at: row.created_at ?? null,
          target_text: readString(metadata, 'target_text') ?? readString(metadata, 'exercise_text') ?? '',
          recognized_text:
            readString(metadata, 'recognized_text')
            ?? readString(metadata, 'raw_transcript')
            ?? (typeof row.transcript === 'string' ? row.transcript.trim() : '')
            ?? '',
          exercise_category: readString(metadata, 'exercise_category'),
          feedback_status: readString(metadata, 'feedback_status'),
          prepared_expression_section_id: readString(metadata, 'prepared_expression_section_id'),
          prepared_expression_section_title: readString(metadata, 'prepared_expression_section_title'),
          high_risk_phrases: readStringList(metadata?.high_risk_phrases),
          hotwords: dedupeStrings(
            [
              ...readStringList(metadata?.hotwords),
              ...readStringList(metadata?.keywords),
            ],
            8,
          ),
          speech_patterns: readStringList(metadata?.speech_patterns),
          articulation_tips: readStringList(metadata?.articulation_tips),
          pronunciation_summary: readString(metadata, 'pronunciation_summary'),
        };
      });
  }

  private getChinaDayWindow(offsetDays: number): {
    dayKey: string;
    startIso: string;
    endIso: string;
  } {
    const chinaOffsetMs = 8 * 60 * 60 * 1000;
    const now = new Date();
    const chinaNow = new Date(now.getTime() + chinaOffsetMs);
    const dayStartUtcMs = Date.UTC(
      chinaNow.getUTCFullYear(),
      chinaNow.getUTCMonth(),
      chinaNow.getUTCDate() + offsetDays,
      0,
      0,
      0,
      0,
    ) - chinaOffsetMs;
    const dayEndUtcMs = dayStartUtcMs + 24 * 60 * 60 * 1000;
    const dayKey = new Date(dayStartUtcMs + chinaOffsetMs).toISOString().slice(0, 10);

    return {
      dayKey,
      startIso: new Date(dayStartUtcMs).toISOString(),
      endIso: new Date(dayEndUtcMs).toISOString(),
    };
  }

  private async getTrainingActivitySnapshot(): Promise<WorkspaceMemorySnapshot['training_activity']> {
    if (trainingActivityCache && trainingActivityCache.expiresAt > Date.now()) {
      return trainingActivityCache.value;
    }

    const yesterday = this.getChinaDayWindow(-1);
    const pageSize = 1000;
    const counts = new Map<string, number>();
    let totalRecordings = 0;

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.adminClient
        .from('voice_contributions')
        .select('contributor_id, metadata')
        .gte('created_at', yesterday.startIso)
        .lt('created_at', yesterday.endIso)
        .range(from, from + pageSize - 1);

      if (error || !Array.isArray(data)) {
        if (error) {
          console.error('Error fetching yesterday training activity:', error);
        }
        break;
      }

      for (const row of data as VoiceContributionRow[]) {
        const metadata = isRecord(row.metadata) ? row.metadata : undefined;
        if (readString(metadata, 'kind') !== 'training_result') {
          continue;
        }

        const contributorId = row.contributor_id?.trim();
        if (!contributorId) {
          continue;
        }

        totalRecordings += 1;
        counts.set(contributorId, (counts.get(contributorId) ?? 0) + 1);
      }

      if (data.length < pageSize) {
        break;
      }
    }

    const topContributors = [...counts.values()]
      .sort((left, right) => right - left)
      .slice(0, 3)
      .map((recordingCount, index) => ({
        rank: index + 1,
        recording_count: recordingCount,
      }));

    const value = {
      daily_target_count: 20,
      slogan: '每天先练 20 句',
      yesterday: {
        day_key: yesterday.dayKey,
        total_recordings: totalRecordings,
        top_contributors: topContributors,
      },
    };
    trainingActivityCache = {
      expiresAt: Date.now() + TRAINING_ACTIVITY_CACHE_TTL_MS,
      value,
    };
    return value;
  }

  async getWorkspaceMemorySnapshot(
    userId: string,
    options: { sceneId?: WorkspaceSceneId } = {},
  ): Promise<WorkspaceMemorySnapshot> {
    const [memories, sessions, rawUserProfile, quickPhrases, trainingActivity] = await Promise.all([
      this.getMemories(userId, 400),
      this.getUserSessions(userId, 120),
      this.getUserProfile(userId),
      this.getUserPhrases(userId, undefined, 40),
      this.getTrainingActivitySnapshot(),
    ]);
    const profileSnapshot = this.buildMemoryProfileSnapshot(memories, sessions, rawUserProfile);
    const userProfile = await this.migratePreparedExpressionLibraryIfNeeded(
      userId,
      rawUserProfile,
    );

    const syncedAt = new Date().toISOString();
    const preparedExpression = this.buildPreparedExpressionSnapshot(profileSnapshot, userProfile, syncedAt);
    const preparedExpressionLibrary = this.buildPreparedExpressionLibrarySnapshot(
      profileSnapshot,
      userProfile,
    );
    const selectedSceneTemplateIds = this.getSelectedSceneTemplateIdsFromProfile(userProfile);

    return {
      registration_profile: {
        full_name: userProfile?.name,
        province: userProfile?.province,
        city: userProfile?.city,
        disability_category: userProfile?.disability_category,
        condition: userProfile?.condition,
        etiology: userProfile?.etiology,
        has_dialect: userProfile?.has_dialect,
        dialect_name: userProfile?.dialect_name,
        dialect_profiles: userProfile?.dialect_profiles,
      },
      user_profile_memory: this.readUserProfileMemoryFromProfile(userProfile),
      scene_templates: {
        selected_ids: selectedSceneTemplateIds,
        library: this.getSceneTemplateCatalog(),
      },
      object_zones: this.buildObjectZones(
        profileSnapshot,
        userProfile,
        preparedExpression,
        syncedAt,
        selectedSceneTemplateIds,
        options.sceneId,
      ),
      communication_loadout: this.buildCommunicationLoadout(
        profileSnapshot,
        userProfile,
        preparedExpression,
        syncedAt,
        selectedSceneTemplateIds,
        options.sceneId,
      ),
      profile_bundle: this.buildProfileBundle(profileSnapshot, userProfile),
      session_review: this.buildSessionReview(profileSnapshot, syncedAt),
      preparation: this.buildPreparationSnapshot(
        profileSnapshot,
        userProfile,
        options.sceneId,
        syncedAt,
        preparedExpression,
      ),
      prepared_expression_library: preparedExpressionLibrary,
      prepared_expression: preparedExpression,
      training_activity: trainingActivity,
      expression_kit: this.buildExpressionKit(
        profileSnapshot,
        quickPhrases,
        userProfile,
        options.sceneId,
      ),
      synced_at: syncedAt,
    };
  }

  private buildObjectZones(
    snapshot: MemoryProfileSnapshot,
    userProfile: UserProfile | null,
    preparedExpression: WorkspaceMemorySnapshot['prepared_expression'],
    syncedAt: string,
    selectedSceneTemplateIds: string[],
    sceneId?: WorkspaceSceneId,
  ): WorkspaceMemorySnapshot['object_zones'] {
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : undefined;
    const communicationPreferences = normalizeCommunicationPreferences(
      preferences?.communication_preferences,
    );
    const userProfileMemory = this.readUserProfileMemoryFromProfile(userProfile);
    const preparedExpressionLibrary = this.readPreparedExpressionLibraryFromProfile(userProfile);
    const customMaterialsItems: WorkspaceMemorySnapshot['object_zones'][number]['items'] =
      preparedExpressionLibrary.assets.map((asset) => {
        const isActive = preparedExpressionLibrary.active_asset_id === asset.draft.id;
        return {
          id: asset.draft.id,
          type: 'custom_material' as const,
          title: asset.draft.title,
          summary: asset.structured.summary,
          tags: dedupeStrings(
            [
              isActive ? '当前加载' : null,
              asset.draft.scene,
              asset.structured.highRiskPhrases[0],
            ].filter((value): value is string => typeof value === 'string' && value.length > 0),
            4,
          ),
          load_behavior: isActive ? 'manual' : 'recommended',
          editable: true,
          updated_at: asset.draft.updated_at,
        };
      });

    const sceneTemplateItems: WorkspaceMemorySnapshot['object_zones'][number]['items'] =
      selectedSceneTemplateIds
        .map((templateId) => getSceneTemplateById(templateId))
        .filter((template): template is SceneTemplateDefinition => template !== null)
        .map((template) => ({
          id: `scene-template-${template.id}`,
          type: 'scene_template' as const,
          title: template.title,
          summary: `${template.summary} 当前优先保护：${template.focus_priority.slice(0, 2).join('、')}。`,
          tags: dedupeStrings(
            [
              template.scenario,
              template.severity_hint,
              ...template.hotwords.slice(0, 2).map((entry) => entry.phrase),
            ],
            4,
          ),
          load_behavior: 'recommended' as const,
          editable: false,
          updated_at: template.updated_at,
        }));

    const userProfileItems: WorkspaceMemorySnapshot['object_zones'][number]['items'] = [];
    if (
      userProfileMemory.document ||
      userProfileMemory.summary ||
      userProfileMemory.common_scenarios?.length ||
      userProfileMemory.risky_terms?.length
    ) {
      userProfileItems.push({
        id: 'profile-speaking-pattern',
        type: 'user_profile',
        title: '用户个人画像',
        summary:
          summarizeLongText(userProfileMemory.document) ||
          userProfileMemory.summary ||
          '当前会围绕用户自己确认过的稳定沟通画像继续装配上下文。',
        tags: dedupeStrings(
          [
            ...(userProfileMemory.common_scenarios ?? []).slice(0, 2),
            ...(userProfileMemory.risky_terms ?? []).slice(0, 2),
          ].filter((value): value is string => typeof value === 'string' && value.length > 0),
          4,
        ),
        load_behavior: 'always_on',
        editable: false,
        updated_at: userProfileMemory.updated_at ?? syncedAt,
      });
    }
    if (
      communicationPreferences.opening_phrase ||
      communicationPreferences.pace_hint ||
      communicationPreferences.repair_phrase
    ) {
      userProfileItems.push({
        id: 'profile-communication-preferences',
        type: 'user_profile',
        title: '沟通偏好',
        summary:
          communicationPreferences.opening_phrase ||
          communicationPreferences.pace_hint ||
          communicationPreferences.repair_phrase ||
          '当前还没有固定沟通偏好。',
        tags: dedupeStrings(
          [
            communicationPreferences.opening_phrase,
            communicationPreferences.pace_hint,
            communicationPreferences.repair_phrase,
          ].filter((value): value is string => typeof value === 'string' && value.length > 0),
          3,
        ),
        load_behavior: 'always_on',
        editable: true,
        updated_at: syncedAt,
      });
    }

    return [
      {
        id: 'custom_materials',
        title: '自定义材料区',
        description: '用户自己维护的材料库。选择一份作为当前加载材料，其余文档继续保留在库里。',
        empty_state: '这里还没有自定义材料，先新建第一份参考文档。',
        items: customMaterialsItems,
      },
      {
        id: 'scene_and_hotword_templates',
        title: '场景 / 热词模板',
        description: '开发者维护的场景模板库。你只需要选适合自己的模板，系统会自动带上对应重点词和沟通策略。',
        empty_state: '这里还没有选中的模板。先从下面勾选 1 到 3 套最贴近当前沟通场景的模板。',
        items: sceneTemplateItems,
      },
      {
        id: 'user_profile',
        title: '用户个人画像',
        description: '常驻上下文的小而稳的用户画像与沟通偏好。',
        empty_state: '这里还没有稳定画像，继续训练后会逐步形成。',
        items: userProfileItems,
      },
    ];
  }

  private buildCommunicationLoadout(
    snapshot: MemoryProfileSnapshot,
    userProfile: UserProfile | null,
    preparedExpression: WorkspaceMemorySnapshot['prepared_expression'],
    syncedAt: string,
    selectedSceneTemplateIds: string[],
    sceneId?: WorkspaceSceneId,
  ): WorkspaceMemorySnapshot['communication_loadout'] {
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : undefined;
    const communicationPreferences = normalizeCommunicationPreferences(
      preferences?.communication_preferences,
    );
    const userProfileMemory = this.readUserProfileMemoryFromProfile(userProfile);
    const preparedExpressionLibrary = this.readPreparedExpressionLibraryFromProfile(userProfile);
    const sceneTemplateLibrary = this.getSceneTemplateCatalog();
    const recommendedMode: 'urgent' | 'long_form' =
      preparedExpression?.document_content && preparedExpression.document_content.length > 120
        ? 'long_form'
        : 'urgent';

    const alwaysOnItems: WorkspaceMemorySnapshot['communication_loadout']['sections'][number]['items'] = dedupeLoadoutItems([
      {
        id: 'loadout-profile-summary',
        title: '用户个人画像',
        summary:
          summarizeLongText(userProfileMemory.document) ||
          userProfileMemory.summary ||
          communicationPreferences.opening_phrase ||
          communicationPreferences.pace_hint ||
          '当前会围绕用户确认过的稳定画像和沟通偏好继续装配上下文。',
        source_type: 'user_profile',
        required: true,
      },
      communicationPreferences.repair_phrase ? {
        id: 'loadout-repair-phrase',
        title: '固定补救句',
        summary: communicationPreferences.repair_phrase,
        source_type: 'user_profile',
        required: true,
      } : null,
    ]);

    const scenePackItems: WorkspaceMemorySnapshot['communication_loadout']['sections'][number]['items'] =
      dedupeLoadoutItems([
        ...sceneTemplateLibrary.map((template) => ({
          id: `loadout-template-${template.id}`,
          title: template.title,
          summary: `${template.communication_goal} 当前优先词：${template.hotwords.slice(0, 3).map((entry) => entry.phrase).join('、')}`,
          source_type: 'scene_template' as const,
          required: false,
          default_selected: selectedSceneTemplateIds.includes(template.id),
          hotwords: template.hotwords.map((entry) => entry.phrase),
          risky_terms: template.risky_terms,
          support_strategies: template.support_strategies,
        })),
      ]);

    const customMaterialItems: WorkspaceMemorySnapshot['communication_loadout']['sections'][number]['items'] = dedupeLoadoutItems([
      ...preparedExpressionLibrary.assets.map((asset) => ({
        id: `loadout-material-${asset.draft.id}`,
        title: asset.draft.title,
        summary: asset.structured.summary,
        source_type: 'custom_material' as const,
        required: false,
        default_selected: preparedExpressionLibrary.active_asset_id === asset.draft.id,
        document_content: asset.draft.content,
        reference_lines: dedupeStrings(
          buildPreparedExpressionReferenceLines(asset.structured, {
            maxLines: 40,
            maxChars: 1800,
          }),
          40,
        ),
        hotwords: dedupeStrings(
          [
            ...asset.structured.hotwords,
            ...asset.structured.sections.flatMap((section) => section.hotwords),
          ],
          10,
        ),
      })),
    ]);

    return {
      recommended_mode: recommendedMode,
      reason:
        recommendedMode === 'long_form'
          ? '当前已有较完整的自定义材料，优先建议以“长时间沟通”模式带材料进入对话。'
          : '当前更适合先用轻量 loadout 快速开口，再根据现场情况继续补充。',
      sections: [
        {
          id: 'always_on',
          title: '默认常驻',
          description: '这部分会默认进入当前沟通上下文。',
          items: alwaysOnItems,
        },
        {
          id: 'scene_pack',
          title: '场景 / 热词包',
          description: '按当前场景和重点词推荐加载。',
          items: scenePackItems,
        },
        {
          id: 'custom_materials',
          title: '自定义材料',
          description: '用户主动准备的稿件、提纲和本次表达材料。',
          items: customMaterialItems,
        },
      ],
      updated_at: syncedAt,
    };
  }

  private collectHotwords(memories: Memory[], sessions: Session[]): string[] {
    const wordFreq: Record<string, number> = {};

    const addWord = (word: string) => {
      if (!word || word.length < 2 || word.length > 8) {
        return;
      }
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    };

    memories.forEach((memory) => {
      const metadata = memory.metadata;
      const keywords = Array.isArray(metadata?.keywords) ? metadata?.keywords : [];
      keywords.forEach((keyword) => {
        if (typeof keyword === 'string') {
          addWord(keyword.trim());
        }
      });

      const tokens = memory.content.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
      tokens.forEach(addWord);
    });

    sessions.forEach((session) => {
      if (!session.transcript) {
        return;
      }

      const tokens = session.transcript.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
      tokens.forEach(addWord);
    });

    return Object.entries(wordFreq)
      .sort(([, left], [, right]) => right - left)
      .slice(0, 20)
      .map(([word]) => word);
  }

  private buildProfileBundle(
    snapshot: MemoryProfileSnapshot,
    userProfile: UserProfile | null,
  ): ProfileBundleSnapshot {
    const staticItems: ProfileBundleItem[] = [];
    const dynamicItems: ProfileBundleItem[] = [];
    const relevantItems: ProfileBundleItem[] = [];
    const nowIso = new Date().toISOString();
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : undefined;
    const communicationPreferences = normalizeCommunicationPreferences(
      preferences?.communication_preferences,
    );
    const userProfileMemory = this.readUserProfileMemoryFromProfile(userProfile);

    if (userProfile?.province || userProfile?.city) {
      staticItems.push({
        id: 'registered-location',
        title: '所在地区',
        content: [userProfile.province, userProfile.city].filter(Boolean).join(' '),
        source: 'user_profile',
        emphasis: 'low',
        updated_at: userProfile.updated_at ?? nowIso,
      });
    }

    if (userProfile?.condition) {
      staticItems.push({
        id: 'condition',
        title: '沟通背景',
        content: userProfile.condition,
        source: 'user_profile',
        emphasis: 'high',
        updated_at: userProfile.updated_at ?? nowIso,
      });
    }

    if (snapshot.hotwords.length > 0) {
      staticItems.push({
        id: 'hotwords',
        title: '关键热词',
        content: snapshot.hotwords.slice(0, 8).join('、'),
        source: 'user_profile',
        emphasis: 'high',
        tags: snapshot.hotwords.slice(0, 8),
        updated_at: nowIso,
      });
    }

    if (communicationPreferences.opening_phrase) {
      staticItems.push({
        id: 'opening-phrase',
        title: '我的开场白',
        content: communicationPreferences.opening_phrase,
        source: 'user_profile',
        emphasis: 'high',
        updated_at: userProfile?.updated_at ?? nowIso,
      });
    }

    if (communicationPreferences.pace_hint) {
      staticItems.push({
        id: 'pace-hint',
        title: '我希望别人这样配合',
        content: communicationPreferences.pace_hint,
        source: 'user_profile',
        emphasis: 'medium',
        updated_at: userProfile?.updated_at ?? nowIso,
      });
    }

    if (userProfileMemory.summary) {
      dynamicItems.push({
        id: 'user-profile-memory-summary',
        title: '稳定个人画像',
        content: userProfileMemory.summary,
        source: 'user_profile',
        emphasis: 'high',
        tags: dedupeStrings(
          [
            ...(userProfileMemory.common_scenarios ?? []).slice(0, 2),
            ...(userProfileMemory.risky_terms ?? []).slice(0, 2),
          ],
          4,
        ),
        updated_at: userProfileMemory.updated_at ?? nowIso,
      });
    }

    snapshot.hotword_profiles.slice(0, 4).forEach((profile) => {
      relevantItems.push({
        id: `hotword-${profile.id}`,
        title: profile.phrase,
        content: profile.note || profile.scenario || '已进入个体表达画像',
        source: 'hotword_profile',
        emphasis: 'medium',
        tags: dedupeStrings([profile.category, profile.scenario], 3),
        updated_at: new Date(profile.updatedAt).toISOString(),
      });
    });

    return {
      static: staticItems,
      dynamic: dynamicItems,
      relevant: relevantItems,
    };
  }

  private buildSessionReview(
    snapshot: MemoryProfileSnapshot,
    syncedAt: string,
  ): SessionReviewSnapshot {
    const latestSession = snapshot.growth_profile.recentSessions.find(
      (session) => session.kind !== 'training',
    );

    if (!latestSession) {
      return {
        session_id: null,
        headline: '还没有稳定的沟通复盘',
        summary: '先用沟通页完成一次真实沟通，系统会只围绕沟通场景整理下一次可复用的准备信息。',
        focus: [],
        recent_win: null,
        next_step: null,
        updated_at: syncedAt,
      };
    }

    const focus = dedupeStrings(
      [
        ...latestSession.topFocusTags,
        ...latestSession.topSpeechPatterns,
      ],
      4,
    );

    return {
      session_id: latestSession.id,
      headline: '最近一次沟通复盘',
      summary: `最近一次 ${latestSession.kind} 会话共 ${latestSession.turnCount} 轮，持续 ${latestSession.durationSeconds} 秒，平均清晰度 ${formatPercent(latestSession.avgClarityScore)}。`,
      focus,
      recent_win: latestSession.memoryCount > 0
        ? `这次沟通沉淀了 ${latestSession.memoryCount} 条可复用信息`
        : null,
      next_step: focus[0] ? `下次沟通优先检查：${focus[0]}` : null,
      updated_at: syncedAt,
    };
  }

  private buildPreparationSnapshot(
    snapshot: MemoryProfileSnapshot,
    userProfile: UserProfile | null,
    sceneId: WorkspaceSceneId | undefined,
    syncedAt: string,
    preparedExpression: WorkspaceMemorySnapshot['prepared_expression'],
  ): WorkspaceMemorySnapshot['preparation'] {
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : undefined;
    const communicationPreferences = normalizeCommunicationPreferences(
      preferences?.communication_preferences,
    );
    const userProfileMemory = this.readUserProfileMemoryFromProfile(userProfile);
    const selectedSceneTemplates = this.getSelectedSceneTemplateIdsFromProfile(userProfile)
      .map((templateId) => getSceneTemplateById(templateId))
      .filter((template): template is SceneTemplateDefinition => template !== null);
    const sceneBrief = sceneId
      ? ({
          interview: '这次重点是先稳住开场、节奏和结论，不求华丽，先求完整说完。',
          workplace: '这次重点是先交代关键信息，再进入细节，避免一开始就陷进长解释。',
          stranger: '这次重点是先说明自己的状态，再快速提出需求或问题。',
          medical: '这次重点是先把症状、持续时间和你最需要的帮助讲清楚。',
          caregiver: '这次重点是先说需求和节奏，避免家人或照护者替你抢答。',
          emergency: '这次重点是先把求助、位置和风险说清楚。',
        } satisfies Record<WorkspaceSceneId, string>)[sceneId]
      : null;
    const immediateGoal =
      userProfileMemory.support_strategies?.[0] ||
      communicationPreferences.opening_phrase ||
      sceneBrief ||
      null;
    const supportStrategies = dedupeStrings(
      [
        ...selectedSceneTemplates.flatMap((template) => template.support_strategies),
        preparedExpression?.fallback_phrases[0]
          ? `保底句先准备好：${preparedExpression.fallback_phrases[0]}`
          : '',
        ...(userProfileMemory.support_strategies ?? []),
        communicationPreferences.opening_phrase
          ? `先用固定开场白把节奏稳住：${communicationPreferences.opening_phrase}`
          : '',
        communicationPreferences.pace_hint
          ? `提前告诉对方如何配合你：${communicationPreferences.pace_hint}`
          : '',
        communicationPreferences.repair_phrase
          ? `没听清时优先用补救句：${communicationPreferences.repair_phrase}`
          : '',
      ],
      4,
    );
    const listenerGuidance = dedupeStrings(
      [
        ...selectedSceneTemplates.slice(0, 2).map((template) => `当前模板重点：${template.communication_goal}`),
        preparedExpression?.summary
          ? `这次重要表达的结构已经压缩好，先按段落和锚点往前走。`
          : '',
        communicationPreferences.pace_hint
          ? `希望对方这样配合：${communicationPreferences.pace_hint}`
          : '',
        communicationPreferences.repair_phrase
          ? `没听清时优先这样补救：${communicationPreferences.repair_phrase}`
          : '',
        ...(userProfileMemory.support_strategies ?? []),
      ],
      3,
    );
    const strongPhrases = dedupeStrings(
      [
        ...(preparedExpression?.fallback_phrases ?? []),
        communicationPreferences.opening_phrase,
        communicationPreferences.repair_phrase,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
      6,
    );
    const commonScenarios = dedupeStrings(
      [
        ...snapshot.hotword_profiles
          .map((profile) => profile.scenario)
          .filter((value) => value.trim().length > 0),
        ...(userProfileMemory.common_scenarios ?? []),
        ...(preparedExpression?.scene ? [preparedExpression.scene] : []),
        ...(sceneId ? [sceneId] : []),
      ],
      6,
    );
    const riskyTerms = dedupeStrings(
      [
        ...selectedSceneTemplates.flatMap((template) => template.risky_terms),
        ...(preparedExpression?.high_risk_phrases ?? []),
        ...(userProfileMemory.risky_terms ?? []),
      ],
      6,
    );
    const pronunciationPatterns: string[] = [];
    const hotwords = dedupeStrings(
      [
        ...selectedSceneTemplates.flatMap((template) => template.hotwords.map((entry) => entry.phrase)),
        ...(preparedExpression?.hotwords ?? []),
        ...snapshot.hotword_profiles.slice(0, 6).map((profile) => profile.phrase),
        ...snapshot.hotwords.slice(0, 6),
      ],
      8,
    );
    const profileSummary = (() => {
      if (userProfileMemory.document) {
        return summarizeLongText(userProfileMemory.document, 260) ?? userProfileMemory.document;
      }

      if (userProfileMemory.summary) {
        return userProfileMemory.summary;
      }

      if (communicationPreferences.opening_phrase || communicationPreferences.pace_hint) {
        return '你已经开始形成自己的沟通方式：先用固定开场白稳住节奏，再告诉对方怎样配合你，这会比临场硬撑更有效。';
      }

      if (preparedExpression) {
        return `你已经为“${preparedExpression.title}”建立了一层结构化准备：重点原句、关键提示和保底句会在本次沟通中优先参考。`;
      }

      return '这里会逐步压缩出你的个人表达画像：你最常面对什么场景、系统最容易听偏什么、什么表达和补救方式最适合你。';
    })();
    const overview = preparedExpression
      ? `当前已经围绕“${preparedExpression.title}”压出一层重要表达准备。${immediateGoal ? ` 现在最该先准备的是：${immediateGoal}` : ''}`
      : sceneBrief
        ? `${sceneBrief}${immediateGoal ? ` 当前最该先准备的是：${immediateGoal}` : ''}`
        : immediateGoal
          ? `当前最该先准备的是：${immediateGoal}`
          : '先固定一条开场白、一句补救句和 3 句最关键原句，现场会稳很多。';

    return {
      active_scene_id: sceneId ?? null,
      profile_summary: profileSummary,
      overview,
      immediate_goal: immediateGoal,
      scene_brief: sceneBrief,
      common_scenarios: commonScenarios,
      strong_phrases: strongPhrases,
      risky_terms: riskyTerms,
      pronunciation_patterns: pronunciationPatterns,
      listener_guidance: listenerGuidance,
      support_strategies: supportStrategies,
      hotwords,
      asr_hotword_entries: preparedExpression?.asr_hotword_entries ?? [],
      document_context_summary: preparedExpression?.summary ?? null,
      document_content: preparedExpression?.document_content ?? null,
      reference_lines: preparedExpression?.reference_lines ?? [],
      training_pairs: [],
      next_step: userProfileMemory.support_strategies?.[0] ?? null,
      updated_at: syncedAt,
    };
  }

  private buildPreparedExpressionSnapshot(
    snapshot: MemoryProfileSnapshot,
    userProfile: UserProfile | null,
    syncedAt: string,
  ): WorkspaceMemorySnapshot['prepared_expression'] {
    const asset = this.readPreparedExpressionAssetFromProfile(userProfile);
    if (!asset) {
      return null;
    }
    const template = asset.structured;
    const preparedTrainingMemories = snapshot.memories
      .filter((memory) => {
        const metadata = isRecord(memory.metadata) ? memory.metadata : undefined;
        return (
          readString(metadata, 'kind') === 'training_result' &&
          readString(metadata, 'prepared_expression_id') === template.id
        );
      })
      .sort((left, right) => {
        const leftTime = new Date(left.created_at ?? 0).getTime();
        const rightTime = new Date(right.created_at ?? 0).getTime();
        return rightTime - leftTime;
      });

    const sectionStats = template.sections.map((section) => {
      const sectionMemories = preparedTrainingMemories.filter((memory) => {
        const metadata = isRecord(memory.metadata) ? memory.metadata : undefined;
        return readString(metadata, 'prepared_expression_section_id') === section.id;
      });
      const latestMemory = sectionMemories[0];
      const latestMetadata = isRecord(latestMemory?.metadata) ? latestMemory.metadata : undefined;
      const latestStatus = this.normalizePreparedExpressionStatus(
        readString(latestMetadata, 'feedback_status'),
      );
      const lowConfidenceCount = sectionMemories.filter((memory) => {
        const metadata = isRecord(memory.metadata) ? memory.metadata : undefined;
        return this.normalizePreparedExpressionStatus(
          readString(metadata, 'feedback_status'),
        ) !== 'excellent';
      }).length;
      const rehearsalCount = sectionMemories.length;
      const lastRehearsedAt = latestMemory?.created_at ?? null;

      return {
        id: section.id,
        title: section.title,
        summary: section.summary,
        anchor_line: section.anchorLine,
        practice_lines: section.practiceLines,
        high_risk_phrases: section.highRiskPhrases,
        fallback_phrases: section.fallbackPhrases,
        hotwords: section.hotwords,
        rehearsal_count: rehearsalCount,
        low_confidence_count: lowConfidenceCount,
        latest_feedback_status: latestStatus,
        last_rehearsed_at: lastRehearsedAt,
        priority_score:
          (rehearsalCount === 0 ? 80 : 0) +
          lowConfidenceCount * 20 +
          section.basePriority * 5 +
          (latestStatus === 'retry' ? 15 : latestStatus === 'close' ? 8 : 0),
      };
    });

    const prioritySectionIds = new Set(
      [...sectionStats]
        .sort((left, right) => right.priority_score - left.priority_score)
        .slice(0, 3)
        .map((section) => section.id),
    );

    const sections = sectionStats.map(({ priority_score: _priorityScore, ...section }) => ({
      ...section,
      is_priority: prioritySectionIds.has(section.id),
    }));

    const lastRehearsedAt = preparedTrainingMemories[0]?.created_at ?? null;
    const rehearsedSectionCount = sections.filter((section) => section.rehearsal_count > 0).length;
    const nextFocus = dedupeStrings(
      [
        ...sections
          .filter((section) => section.is_priority)
          .flatMap((section) => [
            section.title,
            section.high_risk_phrases[0] ?? '',
            section.fallback_phrases[0] ?? '',
          ]),
      ],
      5,
    );
    const summary = lastRehearsedAt
        ? `“${template.title}”已经练过 ${preparedTrainingMemories.length} 次，当前覆盖 ${rehearsedSectionCount}/${sections.length} 个结构段落。优先继续收口：${nextFocus[0] ?? sections[0]?.title ?? '开场段落'}。`
        : template.summary;
    const referenceLines = dedupeStrings(
      [
        ...buildPreparedExpressionReferenceLines(template, {
          maxLines: 80,
          maxChars: 4000,
        }),
      ],
      80,
    );
    const practiceLines = buildPreparedExpressionPracticeLines(asset.draft.content).map(
      (line, index) => {
        const section = sections[line.paragraphIndex] ?? sections[0];
        return {
          id: `${template.id}:${section?.id ?? `paragraph-${line.paragraphIndex + 1}`}:${index}`,
          text: line.text,
          section_id: section?.id ?? `paragraph-${line.paragraphIndex + 1}`,
          section_title: section?.title ?? `第 ${line.paragraphIndex + 1} 段`,
        };
      },
    );
    const weeklySummary = asset.training_reports?.weeklySummary ?? null;
    const dailySummary = asset.training_reports?.dailySummary ?? null;

    return {
      id: template.id,
      title: template.title,
      summary,
      scene: template.scene,
      source: template.source,
      document_content: asset.draft.content,
      last_rehearsed_at: lastRehearsedAt,
      rehearsal_count: preparedTrainingMemories.length,
      low_confidence_sections: sections.filter((section) => section.low_confidence_count > 0).length,
      hotwords: dedupeStrings(
        [
          ...template.hotwords,
          ...sections.flatMap((section) => section.hotwords),
        ],
        10,
      ),
      high_risk_phrases: dedupeStrings(
        [
          ...template.highRiskPhrases,
          ...sections
            .filter((section) => section.is_priority)
            .flatMap((section) => section.high_risk_phrases),
        ],
        8,
      ),
      fallback_phrases: dedupeStrings(
        [
          ...template.fallbackPhrases,
          ...sections
            .filter((section) => section.is_priority)
            .flatMap((section) => section.fallback_phrases),
        ],
        6,
      ),
      asr_hotword_entries: buildAsrHotwordEntries(template.hotwords),
      reference_lines: referenceLines,
      practice_lines: practiceLines,
      training_reports: asset.training_reports
        ? {
            daily_summary: dailySummary
              ? {
                  summary: dailySummary.summary,
                  sample_count: dailySummary.sampleCount,
                  mismatch_pairs: dailySummary.mismatchPairs,
                  next_focus: dailySummary.nextFocus,
                  stable_wins: dailySummary.stableWins,
                  pronunciation_patterns: dailySummary.pronunciationPatterns,
                  support_strategies: dailySummary.supportStrategies,
                  generated_at: dailySummary.generated_at,
                }
              : null,
            weekly_summary: weeklySummary
              ? {
                  summary: weeklySummary.summary,
                  sample_count: weeklySummary.sampleCount,
                  mismatch_pairs: weeklySummary.mismatchPairs,
                  next_focus: weeklySummary.nextFocus,
                  stable_wins: weeklySummary.stableWins,
                  pronunciation_patterns: weeklySummary.pronunciationPatterns,
                  support_strategies: weeklySummary.supportStrategies,
                  generated_at: weeklySummary.generated_at,
                }
              : null,
            training_plan: asset.training_reports.trainingPlan
              ? {
                  summary: asset.training_reports.trainingPlan.summary,
                  items: asset.training_reports.trainingPlan.items,
                  generated_at: asset.training_reports.trainingPlan.generated_at,
                }
              : null,
          }
        : null,
      sections,
      updated_at: syncedAt,
    };
  }

  private buildPreparedExpressionLibrarySnapshot(
    snapshot: MemoryProfileSnapshot,
    userProfile: UserProfile | null,
  ): WorkspaceMemorySnapshot['prepared_expression_library'] {
    const library = this.readPreparedExpressionLibraryFromProfile(userProfile);

    return {
      active_id: library.active_asset_id,
      items: library.assets.map((asset) => {
        const relatedTrainingMemories = snapshot.memories
          .filter((memory) => {
            const metadata = isRecord(memory.metadata) ? memory.metadata : undefined;
            return (
              readString(metadata, 'kind') === 'training_result' &&
              readString(metadata, 'prepared_expression_id') === asset.structured.id
            );
          })
          .sort((left, right) => {
            const leftTime = new Date(left.created_at ?? 0).getTime();
            const rightTime = new Date(right.created_at ?? 0).getTime();
            return rightTime - leftTime;
          });
        return {
          id: asset.draft.id,
          title: asset.draft.title,
          summary: asset.structured.summary,
          scene: asset.draft.scene,
          source: asset.draft.source,
          updated_at: asset.draft.updated_at,
          rehearsal_count: relatedTrainingMemories.length,
          last_rehearsed_at: relatedTrainingMemories[0]?.created_at ?? null,
          is_active: library.active_asset_id === asset.draft.id,
        };
      }),
    };
  }

  private normalizePreparedExpressionStatus(value: string | null): FeedbackStatus | null {
    if (value === 'excellent' || value === 'close' || value === 'retry' || value === 'unclear') {
      return value;
    }

    return null;
  }

  private buildExpressionKit(
    snapshot: MemoryProfileSnapshot,
    quickPhrases: QuickPhrase[],
    userProfile?: UserProfile | null,
    sceneId?: WorkspaceSceneId,
  ): WorkspaceMemorySnapshot['expression_kit'] {
    const suggestions: ExpressionKitSuggestion[] = [];
    const preferences = isRecord(userProfile?.preferences) ? userProfile.preferences : undefined;
    const communicationPreferences = normalizeCommunicationPreferences(
      preferences?.communication_preferences,
    );

    [
      {
        id: 'pref-opening',
        text: communicationPreferences.opening_phrase,
        category: 'opening',
        note: '你希望陌生人先听到的第一句话',
      },
      {
        id: 'pref-pace',
        text: communicationPreferences.pace_hint,
        category: 'pace',
        note: '你希望对方如何配合你的沟通节奏',
      },
      {
        id: 'pref-repair',
        text: communicationPreferences.repair_phrase,
        category: 'repair',
        note: '当对方没听清时，你希望优先使用的补救表达',
      },
    ].forEach((item, index) => {
      if (!item.text) {
        return;
      }

      suggestions.push({
        id: item.id,
        text: item.text,
        source: 'quick_phrase',
        category: item.category,
        note: item.note,
        priority: 140 - index,
      });
    });

    sortPhrasesForSuggestions(quickPhrases)
      .slice(0, 6)
      .forEach((phrase, index) => {
        suggestions.push({
          id: `quick-${phrase.id ?? index}`,
          text: phrase.text,
          source: 'quick_phrase',
          category: phrase.category,
          priority: 100 - index,
        });
      });

    snapshot.hotword_profiles.slice(0, 4).forEach((profile, index) => {
      suggestions.push({
        id: `hotword-${profile.id}`,
        text: profile.phrase,
        source: 'hotword_profile',
        category: profile.category,
        note: profile.note || profile.scenario || undefined,
        priority: 70 - index,
      });
    });

    const recommendedPhrases = rankExpressionKitSuggestions(
      suggestions
      .filter((item, index, array) => array.findIndex((candidate) => candidate.text === item.text) === index)
      .slice(0, 12),
      sceneId,
      communicationPreferences,
    ).slice(0, 8);

    const recommendedFocus = dedupeStrings(
      [
        ...snapshot.hotword_profiles.slice(0, 2).map((profile) => profile.phrase),
      ].filter((value): value is string => typeof value === 'string'),
      6,
    );

    return {
      active_scene_id: sceneId ?? null,
      recommended_phrases: recommendedPhrases,
      quick_phrases: sortPhrasesForSuggestions(quickPhrases).slice(0, 12),
      hotword_profiles: snapshot.hotword_profiles.slice(0, 12),
      recommended_focus: recommendedFocus,
      communication_preferences: communicationPreferences,
    };
  }

  // === Quick Phrases ===
  /**
   * 创建新短语
   */
  async createPhrase(phrase: Omit<QuickPhrase, 'id' | 'created_at' | 'updated_at'>): Promise<QuickPhrase | null> {
    const { data, error } = await this.adminClient
      .from('quick_phrases')
      .insert(phrase)
      .select()
      .single();

    if (error) {
      console.error('Error creating phrase:', error);
      return null;
    }
    return data;
  }

  /**
   * 获取用户所有短语，可按分类筛选
   * 注意：此方法使用 adminClient 绕过 RLS，适用于后端 API 调用
   */
  async getUserPhrases(userId: string, category?: string, limit?: number): Promise<QuickPhrase[]> {
    let query = this.adminClient
      .from('quick_phrases')
      .select('*')
      .eq('user_id', userId);

    if (category) {
      query = query.eq('category', category);
    }

    query = query.order('order_index', { ascending: true });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching user phrases:', error);
      return [];
    }
    return data || [];
  }

  /**
   * 更新短语
   */
  async updatePhrase(
    phraseId: string,
    userId: string,
    updates: Partial<QuickPhrase>,
  ): Promise<QuickPhrase | null> {
    const { data, error } = await this.adminClient
      .from('quick_phrases')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', phraseId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating phrase:', error);
      return null;
    }
    return data;
  }

  /**
   * 删除短语
   */
  async deletePhrase(phraseId: string, userId: string): Promise<boolean> {
    const { error } = await this.adminClient
      .from('quick_phrases')
      .delete()
      .eq('id', phraseId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting phrase:', error);
      return false;
    }
    return true;
  }

  /**
   * 增加短语使用次数
   */
  async incrementPhraseUsage(phraseId: string, userId: string): Promise<QuickPhrase | null> {
    // 首先获取当前短语
    const { data: current } = await this.adminClient
      .from('quick_phrases')
      .select('*')
      .eq('id', phraseId)
      .eq('user_id', userId)
      .single();

    if (!current) {
      return null;
    }

    const { data, error } = await this.adminClient
      .from('quick_phrases')
      .update({
        usage_count: (current.usage_count || 0) + 1,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', phraseId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error incrementing phrase usage:', error);
      return null;
    }
    return data;
  }

  /**
   * 批量更新短语顺序
   */
  async reorderPhrases(
    userId: string,
    phraseOrders: Array<{ id: string; order_index: number }>,
  ): Promise<boolean> {
    // Supabase 不支持批量更新，需要逐个更新
    // 使用事务保证一致性
    const updates = phraseOrders.map(({ id, order_index }) =>
      this.adminClient
        .from('quick_phrases')
        .update({ order_index, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
    );

    // 并发执行所有更新
    const results = await Promise.allSettled(updates);

    // 检查是否所有更新都成功
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.error('Error reordering phrases:', failures);
      return false;
    }

    return true;
  }

  /**
   * 从系统预设表获取所有预设短语
   */
  async getPresetPhrases(): Promise<Array<{ text: string; category: PhraseCategory }>> {
    const { data, error } = await this.adminClient
      .from('preset_phrases')
      .select('text, category, order_index')
      .eq('is_active', true)
      .order('order_index', { ascending: true });

    if (error) {
      console.error('Error fetching preset phrases:', error);
      return [];
    }

    return data || [];
  }

  /**
   * 为用户初始化预设短语（从系统预设表复制）
   */
  async initializePresetPhrases(userId: string): Promise<QuickPhrase[]> {
    // 检查用户是否已有短语
    const existing = await this.getUserPhrases(userId);
    if (existing.length > 0) {
      return existing; // 已有短语，不重复初始化
    }

    // 从数据库获取预设短语
    const presets = await this.getPresetPhrases();

    if (presets.length === 0) {
      console.warn('No preset phrases found in database');
      return [];
    }

    // 批量创建预设短语到用户库
    const phrases = presets.map((preset, index: number) => ({
      user_id: userId,
      text: preset.text,
      category: preset.category,
      usage_count: 0,
      order_index: index,
    }));

    // 使用 adminClient (service_role) 绕过 RLS
    const { data, error } = await this.adminClient
      .from('quick_phrases')
      .insert(phrases)
      .select();

    if (error) {
      console.error('Error initializing preset phrases:', error);
      return [];
    }

    return data || [];
  }
}

// Lazy initialization - call getInstance() when needed
// export default SupabaseService.getInstance();
