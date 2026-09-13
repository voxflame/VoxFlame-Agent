export const TRAINING_TOPIC_IDS = [
  'custom-material',
  'articulation-baseline',
  'daily-mobility',
  'medical-help',
  'roles',
  'devices-numbers',
  'pronunciation-reading',
  'meeting-collaboration',
  'in-car-navigation',
  'phonology-training',
] as const

export type TrainingTopicId = (typeof TRAINING_TOPIC_IDS)[number]

const TRAINING_TOPIC_ID_SET = new Set<string>(TRAINING_TOPIC_IDS)

export function isTrainingTopicId(value: string): value is TrainingTopicId {
  return TRAINING_TOPIC_ID_SET.has(value)
}
