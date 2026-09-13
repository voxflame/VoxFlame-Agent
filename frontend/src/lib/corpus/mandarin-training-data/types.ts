export const MANDARIN_TRAINING_CATEGORY_ORDER = [
  '普通话构音基线',
  '日常与出行',
  '看病与求助',
  '人群与角色',
  '设备与数字',
  '现代文章朗读',
  '会议与协作',
  '车载与导航',
  '音系强化',
] as const

export type MandarinTrainingCategory =
  (typeof MANDARIN_TRAINING_CATEGORY_ORDER)[number]

export interface MandarinTrainingExercise {
  id: string
  text: string
  category: MandarinTrainingCategory
  prompt_type?: 'single_character' | 'word' | 'short_sentence'
  target?: string
  coverage_targets?: string[]
  pronunciation_hint?: string
}

export interface MandarinTrainingCategoryMeta {
  label: string
  shortLabel: string
  description: string
  examples: string[]
  helper: string
  trainingTips: string[]
  corpusCount: number
}

export interface TrainingPhrase {
  text: string
}
