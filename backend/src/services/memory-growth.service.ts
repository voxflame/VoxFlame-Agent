type JsonRecord = Record<string, unknown>;

export type FeedbackStatus = 'excellent' | 'close' | 'retry' | 'unclear';
export type ImprovementDirection = 'improving' | 'stable' | 'declining';

export interface StoredMemoryRecord {
  id?: string;
  user_id: string;
  session_id: string;
  content: string;
  metadata?: JsonRecord;
  created_at?: string;
  updated_at?: string;
}

export interface StoredSessionRecord {
  id?: string;
  user_id: string;
  start_time: string;
  end_time?: string;
  duration?: number;
  transcript?: string;
  metadata?: JsonRecord;
}

export interface TrainingMemoryMetadata {
  kind?: string;
  exercise_id?: string;
  exercise_category?: string;
  recognized_text?: string;
  reference_text_status?: 'pending' | 'available' | 'unavailable';
  feedback_status?: FeedbackStatus;
  clarity_score?: number;
  keywords?: string[];
  focus_tags?: string[];
  speech_patterns?: string[];
  articulation_tips?: string[];
  pronunciation_targets?: string[];
  pronunciation_summary?: string;
  sessionId?: string;
  sessionKind?: string;
  sessionSource?: string;
  sessionStartedAt?: number;
  sessionEndedAt?: number;
  sessionDurationSeconds?: number;
  sessionTurnCount?: number;
}

export interface TrainingProfileSummaryMetadata {
  total_training_uploads?: number;
  total_training_duration_seconds?: number;
  current_training_streak?: number;
  best_training_streak?: number;
  rolling_clarity_average?: number;
  improvement_slope?: number;
  improvement_direction?: ImprovementDirection;
  total_confusion_patterns?: number;
  status_counts?: Partial<Record<FeedbackStatus, number>>;
  dominant_categories?: MemoryLabelCount[];
  frequent_focus?: MemoryLabelCount[];
  speech_patterns?: MemoryLabelCount[];
  frequent_confusions?: MemoryLabelCount[];
  articulation_tips?: MemoryLabelCount[];
  hotwords?: string[];
  trends?: MemoryTrendPoint[];
  next_step?: string;
  last_pronunciation_summary?: string;
  generated_at?: number;
}

export interface GrowthMemoryRecord {
  id: string;
  userId: string;
  type: 'episodic';
  content: string;
  metadata?: JsonRecord;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryLabelCount {
  label: string;
  count: number;
}

export interface MemorySessionSummary {
  id: string;
  kind: string;
  source: string;
  startedAt: number;
  endedAt?: number;
  durationSeconds: number;
  turnCount: number;
  memoryCount: number;
  trainingAttempts: number;
  avgClarityScore: number;
  topFocusTags: string[];
  topSpeechPatterns: string[];
}

export interface MemoryTrendPoint {
  date: string;
  sessionCount: number;
  memoryCount: number;
  trainingAttempts: number;
  excellent: number;
  close: number;
  retry: number;
  unclear: number;
  avgClarityScore: number;
}

export interface MemoryGrowthStats {
  totalSessions: number;
  totalTurns: number;
  totalMemories: number;
  totalTrainingAttempts: number;
  totalExpressionMemories: number;
  totalDurationSeconds: number;
  avgSessionDurationSeconds: number;
  activeDays: number;
  lastSessionAt: number | null;
  currentTrainingStreak: number;
  bestTrainingStreak: number;
  rollingClarityAverage: number;
  improvementSlope: number;
  improvementDirection: ImprovementDirection;
  totalConfusionPatterns: number;
}

export interface MemoryGrowthProfileSnapshot {
  stats: MemoryGrowthStats;
  memories: GrowthMemoryRecord[];
  trainingMemories: GrowthMemoryRecord[];
  expressionMemories: GrowthMemoryRecord[];
  recentTraining: GrowthMemoryRecord[];
  recentSessions: MemorySessionSummary[];
  frequentExpressions: MemoryLabelCount[];
  frequentFocus: MemoryLabelCount[];
  frequentSpeechPatterns: MemoryLabelCount[];
  frequentConfusions: MemoryLabelCount[];
  articulationTips: MemoryLabelCount[];
  statusCounts: Record<FeedbackStatus, number>;
  hotwords: string[];
  trends: MemoryTrendPoint[];
  nextStep: string;
  generatedAt: number;
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

function readStringArray(record: JsonRecord | undefined, key: string): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readLabelCounts(record: JsonRecord | undefined, key: string): MemoryLabelCount[] {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const label = readString(item, 'label');
      const count = readNumber(item, 'count');
      if (!label || count === null) {
        return null;
      }

      return { label, count };
    })
    .filter((item): item is MemoryLabelCount => item !== null);
}

function readTrendPoints(record: JsonRecord | undefined, key: string): MemoryTrendPoint[] {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const date = readString(item, 'date');
      if (!date) {
        return null;
      }

      return {
        date,
        sessionCount: readNumber(item, 'sessionCount') ?? 0,
        memoryCount: readNumber(item, 'memoryCount') ?? 0,
        trainingAttempts: readNumber(item, 'trainingAttempts') ?? readNumber(item, 'uploadedCount') ?? 0,
        excellent: readNumber(item, 'excellent') ?? 0,
        close: readNumber(item, 'close') ?? 0,
        retry: readNumber(item, 'retry') ?? 0,
        unclear: readNumber(item, 'unclear') ?? 0,
        avgClarityScore: readNumber(item, 'avgClarityScore') ?? 0,
      };
    })
    .filter((item): item is MemoryTrendPoint => item !== null);
}

function toTimestamp(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function toDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function countValues(values: string[], limit?: number): MemoryLabelCount[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  const results = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  return typeof limit === 'number' ? results.slice(0, limit) : results;
}

function toGrowthMemory(memory: StoredMemoryRecord): GrowthMemoryRecord {
  const createdAt = toTimestamp(memory.created_at, Date.now());
  const updatedAt = toTimestamp(memory.updated_at, createdAt);

  return {
    id: memory.id ?? `${memory.session_id}_${createdAt}`,
    userId: memory.user_id,
    type: 'episodic',
    content: memory.content,
    metadata: {
      ...(memory.metadata ?? {}),
      sessionId: memory.session_id,
    },
    createdAt,
    updatedAt,
  };
}

function toTrainingMetadata(memory: GrowthMemoryRecord): TrainingMemoryMetadata {
  return isRecord(memory.metadata) ? (memory.metadata as TrainingMemoryMetadata) : {};
}

function hasFinalReferenceFeedback(metadata: TrainingMemoryMetadata): metadata is TrainingMemoryMetadata & {
  feedback_status: FeedbackStatus;
} {
  return metadata.reference_text_status !== 'pending' && Boolean(metadata.feedback_status);
}

function toTrainingSummaryMetadata(memory: GrowthMemoryRecord): TrainingProfileSummaryMetadata {
  return isRecord(memory.metadata) ? (memory.metadata as TrainingProfileSummaryMetadata) : {};
}

function getMemorySessionId(memory: GrowthMemoryRecord): string | null {
  return toTrainingMetadata(memory).sessionId ?? null;
}

function statusToClarityScore(status: FeedbackStatus, explicitScore?: number | null): number {
  if (typeof explicitScore === 'number' && Number.isFinite(explicitScore)) {
    return Math.max(0, Math.min(1, explicitScore));
  }

  if (status === 'excellent') {
    return 0.95;
  }
  if (status === 'close') {
    return 0.75;
  }
  if (status === 'retry') {
    return 0.45;
  }
  return 0.2;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildLinearSlope(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let index = 0; index < n; index += 1) {
    const x = index;
    const y = values[index];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return 0;
  }

  return (n * sumXY - sumX * sumY) / denominator;
}

function getImprovementDirection(slope: number): ImprovementDirection {
  if (slope >= 0.03) {
    return 'improving';
  }
  if (slope <= -0.03) {
    return 'declining';
  }
  return 'stable';
}

function buildTrainingStreaks(trainingMemories: GrowthMemoryRecord[]): {
  currentTrainingStreak: number;
  bestTrainingStreak: number;
} {
  const dayKeys = Array.from(
    new Set(trainingMemories.map((memory) => toDayKey(memory.createdAt))),
  ).sort();

  if (dayKeys.length === 0) {
    return {
      currentTrainingStreak: 0,
      bestTrainingStreak: 0,
    };
  }

  let bestTrainingStreak = 1;
  let running = 1;

  for (let index = 1; index < dayKeys.length; index += 1) {
    const previous = new Date(`${dayKeys[index - 1]}T00:00:00.000Z`).getTime();
    const current = new Date(`${dayKeys[index]}T00:00:00.000Z`).getTime();
    const diffDays = Math.round((current - previous) / 86_400_000);

    if (diffDays === 1) {
      running += 1;
      bestTrainingStreak = Math.max(bestTrainingStreak, running);
    } else if (diffDays > 1) {
      running = 1;
    }
  }

  const latestDay = new Date(`${dayKeys[dayKeys.length - 1]}T00:00:00.000Z`).getTime();
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const latestGap = Math.round((todayUtc - latestDay) / 86_400_000);

  if (latestGap > 1) {
    return {
      currentTrainingStreak: 0,
      bestTrainingStreak,
    };
  }

  let currentTrainingStreak = 1;
  for (let index = dayKeys.length - 1; index > 0; index -= 1) {
    const current = new Date(`${dayKeys[index]}T00:00:00.000Z`).getTime();
    const previous = new Date(`${dayKeys[index - 1]}T00:00:00.000Z`).getTime();
    const diffDays = Math.round((current - previous) / 86_400_000);
    if (diffDays === 1) {
      currentTrainingStreak += 1;
      continue;
    }
    break;
  }

  return {
    currentTrainingStreak,
    bestTrainingStreak,
  };
}

function buildNextStep(
  frequentSpeechPatterns: MemoryLabelCount[],
  frequentFocus: MemoryLabelCount[],
  articulationTips: MemoryLabelCount[],
  improvementDirection: ImprovementDirection,
): string {
  if (frequentSpeechPatterns[0]) {
    return `下一步先继续盯住“${frequentSpeechPatterns[0].label}”，先做短句重复，再回到整句。`;
  }

  if (frequentFocus[0]) {
    return `下一步先围绕 ${frequentFocus[0].label} 做短句重复，不要同时改太多点。`;
  }

  if (articulationTips[0]) {
    return `如果这条提示对你有帮助，可以参考：${articulationTips[0].label}`;
  }

  if (improvementDirection === 'declining') {
    return '最近的自动文字波动较大，可以先回听最熟的一条句子，再决定是否继续练习。';
  }

  return '可以先从一条最常用的句子开始；每次先回听录音，再按自己的需要决定是否继续。';
}

function buildSessionSummaries(
  memories: GrowthMemoryRecord[],
  sessions: StoredSessionRecord[],
): MemorySessionSummary[] {
  const memoryGroups = new Map<string, GrowthMemoryRecord[]>();

  for (const memory of memories) {
    const sessionId = getMemorySessionId(memory);
    if (!sessionId) {
      continue;
    }

    const group = memoryGroups.get(sessionId) ?? [];
    group.push(memory);
    memoryGroups.set(sessionId, group);
  }

  const summaries = new Map<string, MemorySessionSummary>();

  for (const session of sessions) {
    const startedAt = toTimestamp(session.start_time, Date.now());
    const metadata = isRecord(session.metadata) ? session.metadata : undefined;
    const sessionId = session.id ?? `${session.user_id}_${session.start_time}`;
    const memoriesInSession = memoryGroups.get(sessionId) ?? [];
    const trainingInSession = memoriesInSession.filter(
      (memory) => toTrainingMetadata(memory).kind === 'training_result',
    );
    const durationSeconds =
      session.duration ??
      (session.end_time ? Math.max(0, Math.round((toTimestamp(session.end_time, startedAt) - startedAt) / 1000)) : 0) ??
      readNumber(metadata, 'durationSeconds') ??
      readNumber(metadata, 'sessionDurationSeconds') ??
      0;
    const turnCount =
      readNumber(metadata, 'turnCount') ??
      readNumber(metadata, 'sessionTurnCount') ??
      (session.transcript ? session.transcript.split('\n').filter(Boolean).length : 0) ??
      0;
    const clarityScores = trainingInSession.flatMap((memory) => {
      const trainingMetadata = toTrainingMetadata(memory);
      return hasFinalReferenceFeedback(trainingMetadata) ? [statusToClarityScore(
        trainingMetadata.feedback_status,
        trainingMetadata.clarity_score ?? null,
      )] : [];
    });

    summaries.set(sessionId, {
      id: sessionId,
      kind: readString(metadata, 'kind') ?? 'general',
      source: readString(metadata, 'source') ?? 'local_memory',
      startedAt,
      endedAt: session.end_time ? toTimestamp(session.end_time, startedAt) : undefined,
      durationSeconds,
      turnCount,
      memoryCount: memoriesInSession.length,
      trainingAttempts: trainingInSession.length,
      avgClarityScore: average(clarityScores),
      topFocusTags: countValues(
        trainingInSession.flatMap((memory) => toTrainingMetadata(memory).focus_tags ?? []),
        3,
      ).map((item) => item.label),
      topSpeechPatterns: countValues(
        trainingInSession.flatMap((memory) => {
          const metadata = toTrainingMetadata(memory);
          return [
            ...(metadata.speech_patterns ?? []),
            ...(metadata.articulation_tips ?? []),
            ...(metadata.pronunciation_targets ?? []),
          ];
        }),
        4,
      ).map((item) => item.label),
    });
  }

  for (const [sessionId, memoriesInSession] of Array.from(memoryGroups.entries())) {
    if (summaries.has(sessionId)) {
      continue;
    }

    const firstMemory = memoriesInSession.reduce((earliest, memory) =>
      memory.createdAt < earliest.createdAt ? memory : earliest,
    );
    const lastMemory = memoriesInSession.reduce((latest, memory) =>
      memory.createdAt > latest.createdAt ? memory : latest,
    );
    const firstMetadata = toTrainingMetadata(firstMemory);
    const trainingInSession = memoriesInSession.filter(
      (memory) => toTrainingMetadata(memory).kind === 'training_result',
    );
    const clarityScores = trainingInSession.flatMap((memory) => {
      const trainingMetadata = toTrainingMetadata(memory);
      return hasFinalReferenceFeedback(trainingMetadata) ? [statusToClarityScore(
        trainingMetadata.feedback_status,
        trainingMetadata.clarity_score ?? null,
      )] : [];
    });

    summaries.set(sessionId, {
      id: sessionId,
      kind: firstMetadata.sessionKind ?? 'general',
      source: firstMetadata.sessionSource ?? 'local_memory',
      startedAt: firstMetadata.sessionStartedAt ?? firstMemory.createdAt,
      endedAt: firstMetadata.sessionEndedAt ?? lastMemory.createdAt,
      durationSeconds:
        firstMetadata.sessionDurationSeconds ??
        Math.max(0, Math.round((lastMemory.createdAt - firstMemory.createdAt) / 1000)),
      turnCount: firstMetadata.sessionTurnCount ?? 0,
      memoryCount: memoriesInSession.length,
      trainingAttempts: trainingInSession.length,
      avgClarityScore: average(clarityScores),
      topFocusTags: countValues(
        trainingInSession.flatMap((memory) => toTrainingMetadata(memory).focus_tags ?? []),
        3,
      ).map((item) => item.label),
      topSpeechPatterns: countValues(
        trainingInSession.flatMap((memory) => {
          const metadata = toTrainingMetadata(memory);
          return [
            ...(metadata.speech_patterns ?? []),
            ...(metadata.articulation_tips ?? []),
            ...(metadata.pronunciation_targets ?? []),
          ];
        }),
        4,
      ).map((item) => item.label),
    });
  }

  return Array.from(summaries.values()).sort((left, right) => right.startedAt - left.startedAt);
}

function buildTrendPoints(
  memories: GrowthMemoryRecord[],
  sessions: MemorySessionSummary[],
): MemoryTrendPoint[] {
  type TrendAccumulator = MemoryTrendPoint & {
    clarityTotal: number;
    claritySamples: number;
  };

  const points = new Map<string, TrendAccumulator>();

  for (const session of sessions) {
    const key = toDayKey(session.startedAt);
    const point = points.get(key) ?? {
      date: key,
      sessionCount: 0,
      memoryCount: 0,
      trainingAttempts: 0,
      excellent: 0,
      close: 0,
      retry: 0,
      unclear: 0,
      avgClarityScore: 0,
      clarityTotal: 0,
      claritySamples: 0,
    };
    point.sessionCount += 1;
    points.set(key, point);
  }

  for (const memory of memories) {
    const key = toDayKey(memory.createdAt);
    const point = points.get(key) ?? {
      date: key,
      sessionCount: 0,
      memoryCount: 0,
      trainingAttempts: 0,
      excellent: 0,
      close: 0,
      retry: 0,
      unclear: 0,
      avgClarityScore: 0,
      clarityTotal: 0,
      claritySamples: 0,
    };
    point.memoryCount += 1;

    const metadata = toTrainingMetadata(memory);
    if (metadata.kind === 'training_result') {
      point.trainingAttempts += 1;
      if (hasFinalReferenceFeedback(metadata)) {
        point[metadata.feedback_status] += 1;
        point.clarityTotal += statusToClarityScore(
          metadata.feedback_status,
          metadata.clarity_score ?? null,
        );
        point.claritySamples += 1;
      }
    }

    points.set(key, point);
  }

  return Array.from(points.values())
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 14)
    .map((point) => ({
      date: point.date,
      sessionCount: point.sessionCount,
      memoryCount: point.memoryCount,
      trainingAttempts: point.trainingAttempts,
      excellent: point.excellent,
      close: point.close,
      retry: point.retry,
      unclear: point.unclear,
      avgClarityScore: point.claritySamples > 0 ? point.clarityTotal / point.claritySamples : 0,
    }));
}

export function buildMemoryGrowthProfileSnapshot(params: {
  memories: StoredMemoryRecord[];
  sessions: StoredSessionRecord[];
  hotwords?: string[];
}): MemoryGrowthProfileSnapshot {
  const memories = params.memories
    .map((memory) => toGrowthMemory(memory))
    .sort((left, right) => right.createdAt - left.createdAt);
  const sessions = [...params.sessions].sort(
    (left, right) => toTimestamp(right.start_time, 0) - toTimestamp(left.start_time, 0),
  );
  const sessionSummaries = buildSessionSummaries(memories, sessions);
  const trainingSummaryMemories = memories.filter(
    (memory) => toTrainingMetadata(memory).kind === 'training_profile_summary',
  );
  const granularTrainingMemories = memories.filter(
    (memory) => toTrainingMetadata(memory).kind === 'training_result',
  );
  const trainingMemories =
    trainingSummaryMemories.length > 0 ? trainingSummaryMemories : granularTrainingMemories;
  const latestTrainingSummary = trainingSummaryMemories[0]
    ? toTrainingSummaryMetadata(trainingSummaryMemories[0])
    : null;
  const expressionMemories = memories.filter((memory) => {
    const kind = toTrainingMetadata(memory).kind;
    return kind !== 'training_result' && kind !== 'training_profile_summary' && kind !== 'session_compaction';
  });
  const frequentExpressions = countValues(
    expressionMemories.map((memory) => memory.content),
    5,
  );
  const frequentFocus = latestTrainingSummary
    ? readLabelCounts(latestTrainingSummary as JsonRecord, 'frequent_focus')
    : countValues(
      [
        ...granularTrainingMemories.flatMap((memory) => toTrainingMetadata(memory).focus_tags ?? []),
      ],
      5,
    );
  const frequentSpeechPatterns = latestTrainingSummary
    ? readLabelCounts(latestTrainingSummary as JsonRecord, 'speech_patterns')
    : countValues(
      [
        ...granularTrainingMemories.flatMap((memory) => {
          const metadata = toTrainingMetadata(memory);
          return [
            ...(metadata.speech_patterns ?? []),
            ...(metadata.articulation_tips ?? []),
            ...(metadata.pronunciation_targets ?? []),
          ];
        }),
      ],
      8,
    );
  const frequentConfusions = latestTrainingSummary
    ? readLabelCounts(latestTrainingSummary as JsonRecord, 'frequent_confusions')
    : countValues(
      [
        ...granularTrainingMemories.flatMap((memory) => {
          const metadata = toTrainingMetadata(memory);
          return [
            ...(metadata.speech_patterns ?? []),
            ...(metadata.pronunciation_targets ?? []),
          ];
        }),
      ],
      8,
    );
  const articulationTips = latestTrainingSummary
    ? readLabelCounts(latestTrainingSummary as JsonRecord, 'articulation_tips')
    : countValues(
      [
        ...granularTrainingMemories.flatMap((memory) => toTrainingMetadata(memory).articulation_tips ?? []),
      ],
      4,
    );
  const keywordHotwords = latestTrainingSummary
    ? readStringArray(latestTrainingSummary as JsonRecord, 'hotwords')
    : Array.from(
      new Set([
        ...countValues(
          granularTrainingMemories.flatMap((memory) => toTrainingMetadata(memory).keywords ?? []),
        ).map((item) => item.label),
      ]),
    );
  const hotwords = Array.from(new Set([...(params.hotwords ?? []), ...keywordHotwords])).slice(0, 12);
  const totalTurns = sessionSummaries.reduce((sum, session) => sum + session.turnCount, 0);
  const totalDurationSeconds = latestTrainingSummary
    ? readNumber(latestTrainingSummary as JsonRecord, 'total_training_duration_seconds') ??
    sessionSummaries.reduce((sum, session) => sum + session.durationSeconds, 0)
    : sessionSummaries.reduce((sum, session) => sum + session.durationSeconds, 0);
  const activeDays = new Set([
    ...memories.map((memory) => toDayKey(memory.createdAt)),
    ...sessionSummaries.map((session) => toDayKey(session.startedAt)),
  ]).size;
  const lastSessionAt = sessionSummaries[0]?.startedAt ?? memories[0]?.createdAt ?? null;
  const summaryStatusCounts = latestTrainingSummary && isRecord(latestTrainingSummary.status_counts as unknown)
    ? latestTrainingSummary.status_counts as JsonRecord
    : undefined;
  const statusCounts: Record<FeedbackStatus, number> = {
    excellent: readNumber(summaryStatusCounts, 'excellent') ?? granularTrainingMemories.filter(
      (memory) => {
        const metadata = toTrainingMetadata(memory);
        return hasFinalReferenceFeedback(metadata) && metadata.feedback_status === 'excellent';
      },
    ).length,
    close: readNumber(summaryStatusCounts, 'close') ?? granularTrainingMemories.filter(
      (memory) => {
        const metadata = toTrainingMetadata(memory);
        return hasFinalReferenceFeedback(metadata) && metadata.feedback_status === 'close';
      },
    ).length,
    retry: readNumber(summaryStatusCounts, 'retry') ?? granularTrainingMemories.filter(
      (memory) => {
        const metadata = toTrainingMetadata(memory);
        return hasFinalReferenceFeedback(metadata) && metadata.feedback_status === 'retry';
      },
    ).length,
    unclear: readNumber(summaryStatusCounts, 'unclear') ?? granularTrainingMemories.filter(
      (memory) => {
        const metadata = toTrainingMetadata(memory);
        return hasFinalReferenceFeedback(metadata) && metadata.feedback_status === 'unclear';
      },
    ).length,
  };

  const trainingScores = [...granularTrainingMemories]
    .sort((left, right) => left.createdAt - right.createdAt)
    .flatMap((memory) => {
      const metadata = toTrainingMetadata(memory);
      return hasFinalReferenceFeedback(metadata) ? [statusToClarityScore(
        metadata.feedback_status,
        metadata.clarity_score ?? null,
      )] : [];
    });
  const recentScores = trainingScores.slice(-7);
  const rollingClarityAverage = latestTrainingSummary
    ? readNumber(latestTrainingSummary as JsonRecord, 'rolling_clarity_average') ?? average(recentScores)
    : average(recentScores);
  const improvementSlope = latestTrainingSummary
    ? readNumber(latestTrainingSummary as JsonRecord, 'improvement_slope') ??
    Number(buildLinearSlope(trainingScores.slice(-12)).toFixed(4))
    : Number(buildLinearSlope(trainingScores.slice(-12)).toFixed(4));
  const improvementDirection = latestTrainingSummary
    ? (readString(latestTrainingSummary as JsonRecord, 'improvement_direction') as ImprovementDirection | null) ??
    getImprovementDirection(improvementSlope)
    : getImprovementDirection(improvementSlope);
  const granularStreaks = buildTrainingStreaks(granularTrainingMemories);
  const currentTrainingStreak = latestTrainingSummary
    ? readNumber(latestTrainingSummary as JsonRecord, 'current_training_streak') ??
    granularStreaks.currentTrainingStreak
    : granularStreaks.currentTrainingStreak;
  const bestTrainingStreak = latestTrainingSummary
    ? readNumber(latestTrainingSummary as JsonRecord, 'best_training_streak') ??
    granularStreaks.bestTrainingStreak
    : granularStreaks.bestTrainingStreak;
  const totalTrainingAttempts = latestTrainingSummary
    ? readNumber(latestTrainingSummary as JsonRecord, 'total_training_uploads') ??
    granularTrainingMemories.length
    : granularTrainingMemories.length;
  const trends = latestTrainingSummary
    ? readTrendPoints(latestTrainingSummary as JsonRecord, 'trends')
    : buildTrendPoints(memories, sessionSummaries);
  const nextStep = latestTrainingSummary
    ? readString(latestTrainingSummary as JsonRecord, 'next_step') ??
    buildNextStep(
      frequentSpeechPatterns,
      frequentFocus,
      articulationTips,
      improvementDirection,
    )
    : buildNextStep(
      frequentSpeechPatterns,
      frequentFocus,
      articulationTips,
      improvementDirection,
    );

  return {
    stats: {
      totalSessions: sessionSummaries.length,
      totalTurns,
      totalMemories: memories.length,
      totalTrainingAttempts,
      totalExpressionMemories: expressionMemories.length,
      totalDurationSeconds,
      avgSessionDurationSeconds:
        sessionSummaries.length > 0 ? totalDurationSeconds / sessionSummaries.length : 0,
      activeDays,
      lastSessionAt,
      currentTrainingStreak,
      bestTrainingStreak,
      rollingClarityAverage,
      improvementSlope,
      improvementDirection,
      totalConfusionPatterns: latestTrainingSummary
        ? readNumber(latestTrainingSummary as JsonRecord, 'total_confusion_patterns') ??
        frequentConfusions.length
        : frequentConfusions.length,
    },
    memories,
    trainingMemories,
    expressionMemories,
    recentTraining: trainingMemories.slice(0, 6),
    recentSessions: sessionSummaries.slice(0, 6),
    frequentExpressions,
    frequentFocus,
    frequentSpeechPatterns,
    frequentConfusions,
    articulationTips,
    statusCounts,
    hotwords,
    trends,
    nextStep,
    generatedAt: Date.now(),
  };
}
