import {
  buildPreparedExpressionCorrectionPairs,
  buildPreparedExpressionTemplateFromDraft,
  type PreparedExpressionAsset,
  type PreparedExpressionCorrectionPair,
  type PreparedExpressionTrainingReports,
  type PreparedExpressionTrainingSummaryWindow,
  type PreparedExpressionTemplate,
} from './prepared-expression.service';

export interface PreparedExpressionTrainingSample {
  created_at: string | null;
  target_text: string;
  recognized_text: string;
  exercise_category: string | null;
  feedback_status: string | null;
  prepared_expression_section_id: string | null;
  prepared_expression_section_title: string | null;
  high_risk_phrases: string[];
  hotwords: string[];
  speech_patterns: string[];
  articulation_tips: string[];
  pronunciation_summary: string | null;
}

export type PreparedExpressionSummaryTrigger = 'manual' | 'periodic_auto';

const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DAILY_SUMMARY_SYSTEM_PROMPT =
  '你是 VoxFlame 的今日训练总结器。你只返回 JSON，不要 markdown，不要解释。你只能根据输入的 last_24h_samples 生成 daily_summary，不能使用 7 天样本，不能重写准备材料。summary 必须是简练的规律性内容，不要只围绕一两个字、单个词或单条例子。';
const WEEKLY_SUMMARY_SYSTEM_PROMPT =
  '你是 VoxFlame 的 7 天训练总结器。你只返回 JSON，不要 markdown，不要解释。你只能根据输入的 last_7d_samples 生成 weekly_summary，重点找稳定规律，不要生成每日计划。summary 必须是简练的规律性内容，不要只围绕一两个字、单个词或单条例子。';

interface SummaryWindowPayload {
  summary?: string;
  mismatch_pairs?: Array<{
    target?: string;
    heard?: string;
    occurrence_count?: number;
  }>;
  next_focus?: string[];
  stable_wins?: string[];
  pronunciation_patterns?: string[];
  support_strategies?: string[];
}

interface PreparedExpressionTrainingReportPayload {
  daily_summary?: SummaryWindowPayload;
  weekly_summary?: SummaryWindowPayload;
}

function dedupeStrings(values: Array<string | null | undefined>, limit?: number): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  values.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }

    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    results.push(normalized);
  });

  return typeof limit === 'number' ? results.slice(0, limit) : results;
}

function truncateText(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildMismatchPairs(
  samples: PreparedExpressionTrainingSample[],
  limit: number,
  maxChars: number,
): PreparedExpressionCorrectionPair[] {
  return buildPreparedExpressionCorrectionPairs(
    samples.map((sample) => ({
      target: sample.target_text,
      heard: sample.recognized_text,
    })),
    {
      maxPairs: limit,
      maxChars,
    },
  );
}

function buildStableWins(samples: PreparedExpressionTrainingSample[], limit: number): string[] {
  return dedupeStrings(
    samples.flatMap((sample) => {
      const target = sample.target_text.trim();
      const recognized = sample.recognized_text.trim();
      const exactMatch = target && recognized && target === recognized;
      const excellent = sample.feedback_status === 'excellent';

      if (!exactMatch && !excellent) {
        return [];
      }

      return [truncateText(target || recognized, 18)];
    }),
    limit,
  );
}

function buildNextFocus(
  samples: PreparedExpressionTrainingSample[],
  asset: PreparedExpressionAsset | null,
  limit: number,
): string[] {
  return dedupeStrings(
    [
      ...samples.flatMap((sample) => [
        sample.exercise_category,
        sample.prepared_expression_section_title,
        ...sample.high_risk_phrases,
        ...sample.speech_patterns,
        ...sample.articulation_tips,
      ]),
      ...(asset?.structured.highRiskPhrases ?? []),
      ...(asset?.structured.sections.slice(0, 4).map((section) => section.title) ?? []),
    ],
    limit,
  );
}

function buildCategoryFocus(samples: PreparedExpressionTrainingSample[]): string | null {
  const counts = new Map<string, number>();
  samples.forEach((sample) => {
    const category = sample.exercise_category?.trim();
    if (!category) {
      return;
    }
    counts.set(category, (counts.get(category) ?? 0) + 1);
  });

  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return top?.[0] ?? null;
}

function buildPronunciationPatterns(
  samples: PreparedExpressionTrainingSample[],
  limit: number,
): string[] {
  return dedupeStrings(
    [
      ...samples.flatMap((sample) => sample.speech_patterns),
      ...samples.flatMap((sample) => sample.articulation_tips),
      ...samples
        .map((sample) => sample.pronunciation_summary)
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
    ],
    limit,
  );
}

function summarizeWindowHeuristically(
  label: 'daily' | 'weekly',
  samples: PreparedExpressionTrainingSample[],
  asset: PreparedExpressionAsset | null,
): PreparedExpressionTrainingSummaryWindow | null {
  if (samples.length === 0) {
    return null;
  }

  const mismatchPairs = buildMismatchPairs(samples, 6, 1200);
  const stableWins = buildStableWins(samples, 3);
  const nextFocus = buildNextFocus(samples, asset, 4);
  const categoryFocus = buildCategoryFocus(samples);
  const summaryLead = label === 'daily' ? '今天' : '最近 7 天';
  const focusLead = categoryFocus
    ? `主要集中在“${truncateText(categoryFocus, 16)}”这类句子`
    : nextFocus[0]
      ? `主要集中在“${truncateText(nextFocus[0], 16)}”这类表达`
      : '主要集中在高频目标句';
  const mismatchLead =
    mismatchPairs.length > 1
      ? '目标句和自动参考文字仍有反复差异'
      : mismatchPairs.length === 1
        ? '目标句和自动参考文字还有一处代表性差异'
        : '整体识别较平稳';
  const stableLead =
    stableWins.length > 1
      ? `已有 ${stableWins.length} 个表达相对稳定`
      : stableWins.length === 1
        ? '已有 1 个表达相对稳定'
        : null;
  const summaryTail =
    label === 'daily'
      ? '下一轮先保持同类句复练。'
      : '后续先用同类句复练观察趋势。';

  return {
    summary:
      `${summaryLead}共练了 ${samples.length} 句，${focusLead}，${mismatchLead}` +
      `${stableLead ? `；${stableLead}` : ''}，${summaryTail}`,
    sampleCount: samples.length,
    mismatchPairs,
    nextFocus,
    stableWins,
    pronunciationPatterns: buildPronunciationPatterns(samples, 8),
    supportStrategies: dedupeStrings(
      [
        mismatchPairs[0]
          ? `先单独练“${truncateText(mismatchPairs[0].target, 16)}”，避免再被听成“${truncateText(mismatchPairs[0].heard, 16)}”。`
          : null,
        asset?.structured.fallbackPhrases[0]
          ? `卡住时先回保底句：${asset.structured.fallbackPhrases[0]}`
          : null,
        categoryFocus ? `下一轮继续保留“${categoryFocus}”这组句子，先把同类高频差异收小。` : null,
      ],
      4,
    ),
    generated_at: new Date().toISOString(),
  };
}

function extractJsonObject(rawText: string): PreparedExpressionTrainingReportPayload | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    return parsed as PreparedExpressionTrainingReportPayload;
  } catch {
    return null;
  }
}

async function requestDashScopeTrainingReport(
  prompt: string,
  model: string,
  timeoutMs: number,
  systemPrompt: string,
): Promise<PreparedExpressionTrainingReportPayload | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${(process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim().replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 1400,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          parameters: {
            enable_thinking: false,
          },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    const rawText =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((item) => item?.type === 'text' && typeof item.text === 'string')
              .map((item) => item.text)
              .join('')
          : '';

    return extractJsonObject(rawText);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function compactSamples(samples: PreparedExpressionTrainingSample[]) {
  return samples.map((sample) => ({
    created_at: sample.created_at,
    category: sample.exercise_category,
    section: sample.prepared_expression_section_title,
    target_text: sample.target_text,
    recognized_text: sample.recognized_text,
    feedback_status: sample.feedback_status,
    speech_patterns: sample.speech_patterns,
    articulation_tips: sample.articulation_tips,
    pronunciation_summary: sample.pronunciation_summary,
  }));
}

function buildCategoryCounts(samples: PreparedExpressionTrainingSample[]): Record<string, number> {
  return samples.reduce<Record<string, number>>((acc, sample) => {
    const category = sample.exercise_category?.trim();
    if (category) {
      acc[category] = (acc[category] ?? 0) + 1;
    }
    return acc;
  }, {});
}

function buildPreparedExpressionContext(asset: PreparedExpressionAsset | null) {
  return asset
    ? {
        title: asset.draft.title,
        scene: asset.draft.scene,
        source: asset.draft.source,
        high_risk_phrases: asset.structured.highRiskPhrases.slice(0, 6),
        section_titles: asset.structured.sections.slice(0, 8).map((section) => section.title),
      }
    : null;
}

function buildDailySummaryPrompt(
  asset: PreparedExpressionAsset | null,
  dailySamples: PreparedExpressionTrainingSample[],
  trigger: PreparedExpressionSummaryTrigger,
): string {
  return JSON.stringify(
    {
      task: 'training_daily_summary',
      trigger,
      instructions: {
        purpose: '训练页今日总结；帮助用户理解今天真实练习中最明显的规律性差异。',
        focus: [
          '只使用 last_24h_samples。',
          '每条样本都包含 target_text 和 recognized_text，必须围绕这两个字段的差异总结。',
          'summary 用 1 句中文，只写今天可复用的主要规律；不要只围绕一两个字、单个词或单条例子；不超过 70 字。',
          '具体例子放进 mismatch_pairs / stable_wins / support_strategies，不要让 summary 变成例子列表。',
          'mismatch_pairs 只保留今天真实出现的“目标 -> 自动参考文字”差异。',
          'next_focus 写今天下一轮最值得继续盯的 1 到 4 个短焦点。',
          'stable_wins 只写今天已经较稳的目标句或短片段。',
        ],
        limits: {
          daily_mismatch_pairs: 4,
          next_focus: 4,
          stable_wins: 3,
          pronunciation_patterns: 8,
          support_strategies: 4,
        },
        output_schema: {
          daily_summary: {
            summary: 'string',
            mismatch_pairs: [
              {
                target: 'string',
                heard: 'string',
                occurrence_count: 1,
              },
            ],
            next_focus: ['string'],
            stable_wins: ['string'],
            pronunciation_patterns: ['string'],
            support_strategies: ['string'],
          },
        },
      },
      training_context: {
        active_prepared_expression: buildPreparedExpressionContext(asset),
        last_24h_category_counts: buildCategoryCounts(dailySamples),
      },
      last_24h_samples: compactSamples(dailySamples),
    },
    null,
    2,
  );
}

function buildWeeklySummaryPrompt(
  asset: PreparedExpressionAsset | null,
  weeklySamples: PreparedExpressionTrainingSample[],
  trigger: PreparedExpressionSummaryTrigger,
): string {
  return JSON.stringify(
    {
      task: 'training_weekly_summary',
      trigger,
      instructions: {
        purpose: '训练页最近 7 天总结；帮助用户和纠错链路复用一组跨天稳定规律。',
        focus: [
          '只使用 last_7d_samples。',
          'last_7d_samples 是最近 7 天可用训练样本的目标句/识别句全量窗口，不要只看最近几条。',
          '只总结 target_text 和 recognized_text 的稳定差异，不要把材料说明、场景标题或系统提示改写成训练结论。',
          'summary 用 1 句中文，只写 7 天内可复用的稳定规律；不要只围绕一两个字、单个词或单条例子；不超过 90 字。',
          '具体例子放进 mismatch_pairs / stable_wins / support_strategies，不要让 summary 变成例子列表。',
          'mismatch_pairs 只保留最近 7 天重复或最有代表性的“目标 -> 自动参考文字”差异。',
          'next_focus 要能服务训练页和纠错链路，短、明确、可复用。',
        ],
        limits: {
          weekly_mismatch_pairs: 6,
          next_focus: 4,
          stable_wins: 3,
          pronunciation_patterns: 8,
          support_strategies: 4,
        },
        output_schema: {
          weekly_summary: {
            summary: 'string',
            mismatch_pairs: [
              {
                target: 'string',
                heard: 'string',
                occurrence_count: 1,
              },
            ],
            next_focus: ['string'],
            stable_wins: ['string'],
            pronunciation_patterns: ['string'],
            support_strategies: ['string'],
          },
        },
      },
      training_context: {
        active_prepared_expression: buildPreparedExpressionContext(asset),
        last_7d_category_counts: buildCategoryCounts(weeklySamples),
      },
      last_7d_samples: compactSamples(weeklySamples),
    },
    null,
    2,
  );
}

function readPayloadPairs(
  value: unknown,
  limit: number,
  maxChars: number,
): PreparedExpressionCorrectionPair[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const results: PreparedExpressionCorrectionPair[] = [];
  let totalChars = 0;

  for (const pair of value) {
    if (!isRecord(pair)) {
      continue;
    }

    const target = readString(pair, 'target');
    const heard = readString(pair, 'heard');
    if (!target || !heard || target === heard) {
      continue;
    }

    const pairChars = target.length + heard.length + 12;
    if (results.length > 0 && totalChars + pairChars > maxChars) {
      break;
    }

    const occurrenceValue = pair.occurrence_count;
    const occurrenceCount =
      typeof occurrenceValue === 'number' && Number.isFinite(occurrenceValue)
        ? Math.max(1, Math.round(occurrenceValue))
        : 1;

    results.push({
      target,
      heard,
      occurrenceCount,
    });
    totalChars += pairChars;

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

function buildWindowFromPayload(
  payload: SummaryWindowPayload | undefined,
  heuristic: PreparedExpressionTrainingSummaryWindow | null,
): PreparedExpressionTrainingSummaryWindow | null {
  if (!heuristic && !payload) {
    return null;
  }

  const mismatchPairs = payload
    ? readPayloadPairs(payload.mismatch_pairs, 6, 1200)
    : [];

  return {
    summary: payload?.summary?.trim() || heuristic?.summary || '',
    sampleCount: heuristic?.sampleCount || mismatchPairs.length,
    mismatchPairs: mismatchPairs.length > 0 ? mismatchPairs : heuristic?.mismatchPairs ?? [],
    nextFocus: dedupeStrings(payload?.next_focus ?? heuristic?.nextFocus ?? [], 4),
    stableWins: dedupeStrings(payload?.stable_wins ?? heuristic?.stableWins ?? [], 3),
    pronunciationPatterns: dedupeStrings(
      payload?.pronunciation_patterns ?? heuristic?.pronunciationPatterns ?? [],
      8,
    ),
    supportStrategies: dedupeStrings(
      payload?.support_strategies ?? heuristic?.supportStrategies ?? [],
      4,
    ),
    generated_at: heuristic?.generated_at ?? new Date().toISOString(),
  };
}

export class PreparedExpressionSummaryService {
  public async summarize(
    asset: PreparedExpressionAsset,
    samples: PreparedExpressionTrainingSample[],
    trigger: PreparedExpressionSummaryTrigger,
  ): Promise<PreparedExpressionAsset> {
    if (samples.length === 0) {
      return {
        draft: asset.draft,
        structured: buildPreparedExpressionTemplateFromDraft(asset.draft),
        training_reports: null,
      };
    }

    const structured: PreparedExpressionTemplate =
      asset.structured.sections.length > 0
        ? asset.structured
        : buildPreparedExpressionTemplateFromDraft(asset.draft);
    const normalizedAsset: PreparedExpressionAsset = {
      ...asset,
      structured,
      training_reports: null,
    };
    const now = Date.now();
    const dailySamples = samples.filter((sample) => {
      const timestamp = toTimestamp(sample.created_at);
      return timestamp !== null && now - timestamp <= DAILY_WINDOW_MS;
    });
    const weeklySamples = samples.filter((sample) => {
      const timestamp = toTimestamp(sample.created_at);
      return timestamp !== null && now - timestamp <= WEEKLY_WINDOW_MS;
    });

    const heuristicDaily = summarizeWindowHeuristically('daily', dailySamples, normalizedAsset);
    const heuristicWeekly = summarizeWindowHeuristically('weekly', weeklySamples, normalizedAsset);

    const model = process.env.DASHSCOPE_TRAINING_REPORT_MODEL?.trim() || 'qwen3.5-plus';
    const timeoutMs = Math.max(
      3000,
      Number.parseInt(
        process.env.DASHSCOPE_TRAINING_REPORT_TIMEOUT_SECONDS
          || process.env.DASHSCOPE_PREPARED_EXPRESSION_SUMMARY_TIMEOUT_SECONDS
          || '12000',
        10,
      ) || 12000,
    );
    const [dailyPayload, weeklyPayload] = await Promise.all([
      dailySamples.length > 0
        ? requestDashScopeTrainingReport(
            buildDailySummaryPrompt(normalizedAsset, dailySamples, trigger),
            model,
            timeoutMs,
            DAILY_SUMMARY_SYSTEM_PROMPT,
          )
        : Promise.resolve(null),
      weeklySamples.length > 0
        ? requestDashScopeTrainingReport(
            buildWeeklySummaryPrompt(normalizedAsset, weeklySamples, trigger),
            model,
            timeoutMs,
            WEEKLY_SUMMARY_SYSTEM_PROMPT,
          )
        : Promise.resolve(null),
    ]);

    const dailySummary = buildWindowFromPayload(dailyPayload?.daily_summary, heuristicDaily);
    const weeklySummary = buildWindowFromPayload(weeklyPayload?.weekly_summary, heuristicWeekly);

    const trainingReports: PreparedExpressionTrainingReports = {
      dailySummary,
      weeklySummary,
      trainingPlan: null,
    };

    return {
      draft: asset.draft,
      structured,
      training_reports:
        trainingReports.dailySummary || trainingReports.weeklySummary
          ? trainingReports
          : null,
    };
  }
}
