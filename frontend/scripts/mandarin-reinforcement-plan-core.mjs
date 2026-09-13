import { containsBlockedDefaultCorpusContent } from './mandarin-corpus-content-policy.mjs'

const TASK_PRIORITY = {
  functional_speech: 4,
  targeted_gap: 3,
  mandarin_articulation_baseline: 2,
  connected_reading: 1,
  natural_speech: 1,
  anchor_retest: 1,
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), 'zh-CN')
}

function visibleLength(text) {
  return Array.from(String(text).replace(/\s+/gu, '')).length
}

function burdenLevel(text) {
  const length = visibleLength(text)
  if (length <= 10) return 'low'
  if (length <= 14) return 'moderate'
  return 'higher'
}

function candidateScore(candidate, remaining) {
  const openTargets = candidate.coverageTargets.filter((target) => (remaining.get(target) ?? 0) > 0)
  if (openTargets.length === 0) return Number.NEGATIVE_INFINITY

  const deficitBenefit = openTargets.reduce((sum, target) => sum + (remaining.get(target) ?? 0), 0)
  const taskPriority = TASK_PRIORITY[candidate.taskId] ?? 0
  const lengthPenalty = Math.max(0, visibleLength(candidate.text) - 8)
  return deficitBenefit * 100 + openTargets.length * 24 + taskPriority * 6 - lengthPenalty
}

function targetStatus(target, plannedAssignments, unallocatedCollectionSlots) {
  if (target.tier === 'disputed') return 'held_disputed'
  if (unallocatedCollectionSlots === 0) return 'collection_slots_allocated'
  if (plannedAssignments > 0) return 'collection_slots_partially_allocated'
  return 'no_safe_current_prompt'
}

export function buildMandarinReinforcementPlan({
  ledger,
  linguisticIndex,
  exercises,
  generatedAt = new Date().toISOString(),
  minimumHits = 20,
  maxPlannedRecordingsPerPrompt = 4,
}) {
  const exerciseIds = new Set(exercises.map((exercise) => exercise.id))
  if (exerciseIds.size !== exercises.length) {
    throw new Error('current prompt corpus contains duplicate exercise ids')
  }

  const belowMinimum = ledger.targets.filter((target) => target.coverage_status === 'below_minimum')
  const plannedTargets = belowMinimum.filter((target) => target.tier !== 'disputed')
  const plannedTargetSet = new Set(plannedTargets.map((target) => target.syllable_tone))
  const remaining = new Map(plannedTargets.map((target) => [target.syllable_tone, target.deficit_to_robust]))
  const candidates = []

  for (const exercise of exercises) {
    const indexed = linguisticIndex.items?.[exercise.id]
    if (!indexed || containsBlockedDefaultCorpusContent(exercise.text)) continue
    const coverageTargets = indexed.syllable_tones.filter((target) => plannedTargetSet.has(target))
    if (coverageTargets.length === 0) continue
    candidates.push({
      id: exercise.id,
      text: exercise.text,
      sourceCategory: exercise.category,
      taskId: indexed.task_id,
      linguisticTags: {
        initials: indexed.initials,
        finals: indexed.finals,
        tones: indexed.tones,
        syllable_tones: indexed.syllable_tones,
        tone_pairs: indexed.tone_pairs,
        positions: indexed.positions,
        connected_speech: indexed.connected_speech,
      },
      coverageTargets: [...new Set(coverageTargets)].sort(compareText),
    })
  }

  candidates.sort((left, right) => compareText(left.id, right.id))
  const promptPlans = new Map()

  while ([...remaining.values()].some((value) => value > 0)) {
    let selected = null
    let selectedScore = Number.NEGATIVE_INFINITY

    for (const candidate of candidates) {
      const currentPlan = promptPlans.get(candidate.id)
      if ((currentPlan?.planned_recording_slots ?? 0) >= maxPlannedRecordingsPerPrompt) continue
      const score = candidateScore(candidate, remaining)
      if (score > selectedScore || (score === selectedScore && selected && compareText(candidate.id, selected.id) < 0)) {
        selected = candidate
        selectedScore = score
      }
    }

    if (!selected || selectedScore === Number.NEGATIVE_INFINITY) break
    const currentPlan = promptPlans.get(selected.id) ?? {
      exercise_id: selected.id,
      text: selected.text,
      source_category: selected.sourceCategory,
      task_id: selected.taskId,
      user_burden: burdenLevel(selected.text),
      linguistic_tags: selected.linguisticTags,
      low_frequency_targets: selected.coverageTargets,
      planned_recording_slots: 0,
      target_contributions: {},
    }
    currentPlan.planned_recording_slots += 1
    for (const target of selected.coverageTargets) {
      const targetRemaining = remaining.get(target) ?? 0
      if (targetRemaining <= 0) continue
      remaining.set(target, targetRemaining - 1)
      currentPlan.target_contributions[target] = (currentPlan.target_contributions[target] ?? 0) + 1
    }
    promptPlans.set(selected.id, currentPlan)
  }

  const selectedPrompts = [...promptPlans.values()].sort((left, right) => (
    right.planned_recording_slots - left.planned_recording_slots
      || compareText(left.exercise_id, right.exercise_id)
  ))
  const targetRows = belowMinimum
    .map((target) => {
      const selectedPromptRows = selectedPrompts
        .map((prompt) => ({
          exercise_id: prompt.exercise_id,
          planned_recording_slots: prompt.target_contributions[target.syllable_tone] ?? 0,
        }))
        .filter((prompt) => prompt.planned_recording_slots > 0)
      const plannedAssignments = selectedPromptRows.reduce((sum, prompt) => sum + prompt.planned_recording_slots, 0)
      const unallocatedCollectionSlots = target.tier === 'disputed'
        ? target.deficit_to_robust
        : Math.max(0, target.deficit_to_robust - plannedAssignments)

      return {
        syllable_tone: target.syllable_tone,
        syllable: target.syllable,
        tone: target.tone,
        tier: target.tier,
        status: targetStatus(target, plannedAssignments, unallocatedCollectionSlots),
        current_prompt_hits: target.current_hits,
        prompt_deficit_to_minimum: target.deficit_to_robust,
        planned_recording_slots: plannedAssignments,
        unallocated_collection_slots: unallocatedCollectionSlots,
        projected_prompt_hits_after_reuse_plan: target.current_hits,
        remaining_prompt_diversity_need: target.deficit_to_robust,
        selected_prompts: selectedPromptRows,
        actual_confirmed_recording_hits: null,
      }
    })
    .sort((left, right) => compareText(left.syllable_tone, right.syllable_tone))

  const statusCounts = Object.fromEntries(
    Object.entries(Object.groupBy(targetRows, (target) => target.status))
      .map(([status, targets]) => [status, targets.length])
      .sort(([left], [right]) => compareText(left, right)),
  )
  const taskCounts = Object.fromEntries(
    Object.entries(Object.groupBy(selectedPrompts, (prompt) => prompt.task_id))
      .map(([taskId, prompts]) => [taskId, prompts.length])
      .sort(([left], [right]) => compareText(left, right)),
  )

  return {
    kind: 'voxflame_mandarin_below_minimum_reinforcement_plan',
    generated_at: generatedAt,
    policy: {
      linguistic_ledger_is_primary: true,
      uses_only_current_active_prompts: true,
      current_prompt_text_is_not_modified: true,
      disputed_targets_are_excluded_from_default_collection: true,
      maximum_planned_recording_slots_per_prompt: maxPlannedRecordingsPerPrompt,
      planned_slots_are_future_assignments_not_completed_recordings: true,
      recording_slots_do_not_increase_prompt_diversity: true,
      valid_audio_and_non_empty_target_define_actual_collection_coverage: true,
      spoken_text_and_audio_text_alignment_are_optional_quality_diagnostics: true,
      sparse_targets_require_new_prompt_authoring_and_human_review: true,
    },
    source: {
      current_prompt_items: exercises.length,
      ledger_generated_at: ledger.generated_at,
      linguistic_index_generated_at: linguisticIndex.generated_at,
      minimum_hits: minimumHits,
    },
    summary: {
      below_minimum_targets: targetRows.length,
      default_planned_targets: plannedTargets.length,
      disputed_held_targets: targetRows.filter((target) => target.status === 'held_disputed').length,
      selected_prompts: selectedPrompts.length,
      planned_recording_slots: selectedPrompts.reduce((sum, prompt) => sum + prompt.planned_recording_slots, 0),
      status_counts: statusCounts,
      selected_prompt_task_counts: taskCounts,
    },
    targets: targetRows,
    selected_prompts: selectedPrompts,
  }
}

export function buildMandarinReinforcementProductIndex(plan) {
  return {
    kind: 'voxflame_mandarin_reinforcement_product_index',
    generated_at: plan.generated_at,
    source_kind: plan.kind,
    policy: {
      active_safe_prompts_only: true,
      disputed_targets_are_excluded: true,
      planned_slots_are_not_completed_recordings: true,
    },
    summary: {
      selected_prompts: plan.summary.selected_prompts,
      planned_recording_slots: plan.summary.planned_recording_slots,
    },
    items: Object.fromEntries(plan.selected_prompts.map((prompt) => [
      prompt.exercise_id,
      {
        low_frequency_targets: prompt.low_frequency_targets,
        planned_recording_slots: prompt.planned_recording_slots,
      },
    ])),
  }
}
