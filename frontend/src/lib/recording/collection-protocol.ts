export type CollectionPlanId =
  | 'mandarin_articulation_baseline'
  | 'targeted_gap'
  | 'functional_speech'
  | 'connected_reading'
  | 'natural_speech'
  | 'anchor_retest'

export interface CollectionPlan {
  id: CollectionPlanId
  label: string
  userLabel: string
  description: string
  durationLabel: string
  materialPrefix: string
  availability: 'available' | 'requires_dedicated_flow'
}

export const COLLECTION_PLANS: readonly CollectionPlan[] = [
  {
    id: 'mandarin_articulation_baseline',
    label: '普通话构音表现基线',
    userLabel: '建立可复测的普通话基线',
    description: '逐字完成 50 个单音节，观察系统更容易听错的声母、韵母和声调组合。',
    durationLabel: '固定 50 字',
    materialPrefix: 'mandarin-articulation-baseline',
    availability: 'available',
  },
  {
    id: 'targeted_gap',
    label: '让沟通更顺',
    userLabel: '让系统逐步适应你的声音',
    description: '练系统还不熟悉的自然字词和短句；按平时方式说，不需要刻意纠正发音。',
    durationLabel: '5–10 条',
    materialPrefix: 'coverage-gap',
    availability: 'available',
  },
  {
    id: 'functional_speech',
    label: '常用表达',
    userLabel: '录真正会用到的话',
    description: '覆盖日常、出行、求助、就医、工作和设备等真实沟通任务。',
    durationLabel: '8–15 条',
    materialPrefix: 'functional',
    availability: 'available',
  },
  {
    id: 'connected_reading',
    label: '连续朗读',
    userLabel: '按自己的节奏读一段',
    description: '按自己的节奏读一段，保留真实停顿和回读。',
    durationLabel: '每段 20–60 秒',
    materialPrefix: 'R006/R014/R031/R036/R040',
    availability: 'available',
  },
  {
    id: 'natural_speech',
    label: '自然说话',
    userLabel: '用自己的话说',
    description: '围绕熟悉任务自由表达，不拿目标句要求逐字一致。',
    durationLabel: '30–90 秒',
    materialPrefix: 'T001–T050',
    availability: 'requires_dedicated_flow',
  },
  {
    id: 'anchor_retest',
    label: '稳定复测',
    userLabel: '隔天再录同一组',
    description: '同人、同材料、同设备跨天复测，用于观察稳定变化。',
    durationLabel: '3–5 条或 30–60 秒',
    materialPrefix: 'A001',
    availability: 'requires_dedicated_flow',
  },
] as const

const TOPIC_COLLECTION_PLAN: Record<string, CollectionPlanId> = {
  'articulation-baseline': 'mandarin_articulation_baseline',
  'custom-material': 'connected_reading',
  'daily-mobility': 'functional_speech',
  'medical-help': 'functional_speech',
  roles: 'functional_speech',
  'devices-numbers': 'functional_speech',
  'meeting-collaboration': 'functional_speech',
  'in-car-navigation': 'functional_speech',
  'pronunciation-reading': 'connected_reading',
  'phonology-training': 'targeted_gap',
}

export function getCollectionPlan(id: CollectionPlanId): CollectionPlan {
  return COLLECTION_PLANS.find((plan) => plan.id === id) ?? COLLECTION_PLANS[0]
}

export function getCollectionPlanIdForTopic(topicId: string): CollectionPlanId {
  return TOPIC_COLLECTION_PLAN[topicId] ?? 'functional_speech'
}

export interface CollectionPreflight {
  environmentReady: boolean
  distanceReady: boolean
  understandsConsent: boolean
}

export function isCollectionPreflightReady(preflight: CollectionPreflight): boolean {
  return preflight.environmentReady && preflight.distanceReady && preflight.understandsConsent
}
