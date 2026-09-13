import { pinyin } from 'pinyin-pro'

import type { MandarinTrainingExercise } from './types'

/**
 * A fixed, single-character Mandarin observation set for same-device retesting.
 * This is a product baseline, not a clinical norm or diagnostic scale.
 */
const ARTICULATION_BASELINE_CHARACTERS = [
  '包', '抛', '猫', '飞', '刀', '套', '闹', '鹿', '高', '铐',
  '河', '鸡', '七', '吸', '猪', '出', '书', '肉', '紫', '粗',
  '四', '杯', '泡', '倒', '菇', '哭', '壳', '纸', '室', '字',
  '刺', '蓝', '狼', '心', '星', '船', '床', '拔', '鹅', '一',
  '家', '浇', '乌', '雨', '椅', '鼻', '蛙', '娃', '瓦', '袜',
] as const

export const MANDARIN_ARTICULATION_BASELINE_VERSION = '2026-09-13.v1'

export const MANDARIN_ARTICULATION_BASELINE_EXERCISES: MandarinTrainingExercise[] =
  ARTICULATION_BASELINE_CHARACTERS.map((text, index) => ({
    id: `mandarin_articulation_baseline_${String(index + 1).padStart(3, '0')}`,
    text,
    category: '普通话构音基线',
    prompt_type: 'single_character',
    target: pinyin(text, { toneType: 'num', type: 'array' })[0],
  }))
