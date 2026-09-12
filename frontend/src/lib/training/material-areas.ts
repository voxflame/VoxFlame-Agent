import {
  MANDARIN_TRAINING_CATEGORIES,
  MANDARIN_TRAINING_CATEGORY_META,
  type MandarinTrainingCategory,
} from '@/lib/corpus/mandarin-training'
import { MANDARIN_READING_ARTICLES } from '@/lib/corpus/reading-articles'
import {
  getTrainingTopicHref,
  getTrainingTopicIdForCategory,
} from '@/lib/training/training-topic-route'

export interface TrainingMaterialArea {
  id: string
  title: string
  count: number
  countUnit: '句' | '篇'
  href: string
}

const MATERIAL_AREA_TITLES: Partial<Record<MandarinTrainingCategory, string>> = {
  日常与出行: '日常与出行',
  看病与求助: '看病与求助',
  人群与角色: '人群与角色',
  设备与数字: '设备与数字',
  现代文章朗读: '短句朗读',
  会议与协作: '会议与协作',
  车载与导航: '车载与导航',
  音系强化: '系统易漏听',
}

export const TRAINING_MATERIAL_AREAS: readonly TrainingMaterialArea[] = [
  ...MANDARIN_TRAINING_CATEGORIES
    .filter((category) => category !== '评估筛查')
    .map((category) => ({
      id: getTrainingTopicIdForCategory(category),
      title: MATERIAL_AREA_TITLES[category] ?? MANDARIN_TRAINING_CATEGORY_META[category].label,
      count: MANDARIN_TRAINING_CATEGORY_META[category].corpusCount,
      countUnit: '句' as const,
      href: getTrainingTopicHref(getTrainingTopicIdForCategory(category)),
    })),
  ...(MANDARIN_READING_ARTICLES.length > 0 ? [{
    id: 'complete-reading',
    title: '完整文章',
    count: MANDARIN_READING_ARTICLES.length,
    countUnit: '篇' as const,
    href: '/contribute/readings',
  }] : []),
]
