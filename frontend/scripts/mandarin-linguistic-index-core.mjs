import { annotateMandarinText } from './mandarin-coverage-core.mjs'

export const TASK_IDS = [
  'mandarin_articulation_baseline',
  'targeted_gap',
  'functional_speech',
  'connected_reading',
  'natural_speech',
  'anchor_retest',
]

const CATEGORY_TASKS = {
  '普通话构音基线': 'mandarin_articulation_baseline',
  '日常与出行': 'functional_speech',
  '看病与求助': 'functional_speech',
  '人群与角色': 'functional_speech',
  '设备与数字': 'functional_speech',
  '会议与协作': 'functional_speech',
  '车载与导航': 'functional_speech',
  '现代文章朗读': 'connected_reading',
  '音系强化': 'targeted_gap',
}

export function taskIdForCategory(category) {
  return CATEGORY_TASKS[category] ?? 'functional_speech'
}

export function buildLinguisticTags(text) {
  const annotation = annotateMandarinText(text)
  return {
    initials: [...new Set(annotation.syllables.map((item) => item.initial))].sort(),
    finals: [...new Set(annotation.syllables.map((item) => item.final))].sort(),
    tones: [...new Set(annotation.syllables.map((item) => String(item.tone)))].sort(),
    syllable_tones: [...new Set(annotation.syllables.map((item) => item.syllableTone))].sort(),
    tone_pairs: [...new Set(annotation.tonePairs)].sort(),
    positions: [...new Set(annotation.syllables.map((item) => item.position))].sort(),
    connected_speech: {
      third_tone_sequence: annotation.thirdToneSequences > 0,
      yi_sandhi: annotation.yiSandhi > 0,
      bu_sandhi: annotation.buSandhi > 0,
      neutral_tone: annotation.neutralTones > 0,
      erhua_candidate: annotation.erhuaCandidates > 0,
    },
  }
}

export function buildLinguisticIndex(items) {
  const indexedItems = {}
  const taskCounts = new Map()
  const tagCounts = {
    initials: new Map(),
    finals: new Map(),
    tones: new Map(),
    syllable_tones: new Map(),
    tone_pairs: new Map(),
    positions: new Map(),
  }
  const connectedCounts = new Map()

  for (const item of items) {
    const text = String(item.text ?? '').trim()
    if (!item.id || !text) continue
    const taskId = taskIdForCategory(String(item.category ?? ''))
    const tags = buildLinguisticTags(text)
    indexedItems[item.id] = {
      task_id: taskId,
      source_category: String(item.category ?? '未分区'),
      ...tags,
    }
    taskCounts.set(taskId, (taskCounts.get(taskId) ?? 0) + 1)
    for (const key of Object.keys(tagCounts)) {
      for (const value of tags[key]) {
        const map = tagCounts[key]
        map.set(value, (map.get(value) ?? 0) + 1)
      }
    }
    for (const [key, enabled] of Object.entries(tags.connected_speech)) {
      if (enabled) connectedCounts.set(key, (connectedCounts.get(key) ?? 0) + 1)
    }
  }

  const sortedCounts = (map) => Object.fromEntries(
    [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  )

  return {
    kind: 'mandarin_linguistic_task_and_tag_index',
    policy: {
      task_layer: 'mutually_exclusive_user_task',
      linguistic_layer: 'overlapping_derived_tags',
      source_category_is_preserved: true,
      no_prompt_text_removed: true,
      tag_derivation: 'citation pinyin and conservative connected-speech heuristics',
      not_a_claim_of_medical_or_dialectal_completeness: true,
    },
    summary: {
      indexed_items: Object.keys(indexedItems).length,
      task_counts: sortedCounts(taskCounts),
      initial_item_counts: sortedCounts(tagCounts.initials),
      final_item_counts: sortedCounts(tagCounts.finals),
      tone_item_counts: sortedCounts(tagCounts.tones),
      syllable_tone_item_counts: sortedCounts(tagCounts.syllable_tones),
      tone_pair_item_counts: sortedCounts(tagCounts.tone_pairs),
      position_item_counts: sortedCounts(tagCounts.positions),
      connected_speech_item_counts: sortedCounts(connectedCounts),
    },
    items: indexedItems,
  }
}
