export const MOBILE_COLLECTION_PROTOCOL_VERSION = '2026-08-22.v2'

export type MobileCollectionPlanId =
  | 'mandarin_articulation_baseline'
  | 'targeted_gap'
  | 'functional_speech'
  | 'connected_reading'
  | 'natural_speech'
  | 'anchor_retest'

export const MOBILE_COLLECTION_PLANS: readonly {
  id: MobileCollectionPlanId
  label: string
  description: string
}[] = [
  { id: 'mandarin_articulation_baseline', label: '普通话构音表现基线', description: '逐字完成 50 个单音节，建立可复测的系统听懂基线。' },
  { id: 'targeted_gap', label: '让沟通更顺', description: '从单字、多音字到短句，按平时方式说，让系统逐步适应你的声音。' },
  { id: 'functional_speech', label: '常用表达', description: '录日常、出行、求助、工作等真实会用到的话。' },
  { id: 'connected_reading', label: '连续朗读', description: '按自己的节奏朗读，保留真实停顿和回读。' },
  { id: 'natural_speech', label: '自然说话', description: '围绕熟悉任务自由表达，不要求逐字一致。' },
  { id: 'anchor_retest', label: '稳定复测', description: '隔天再录同一组，观察同条件下的稳定变化。' },
] as const

export function getMobileCollectionPlanId(options: {
  category?: string | null
  usesPreparedMaterial: boolean
}): MobileCollectionPlanId {
  if (options.usesPreparedMaterial || options.category === '现代文章朗读' || options.category === '完整文章') {
    return 'connected_reading'
  }
  if (options.category === '音系强化') {
    return 'targeted_gap'
  }
  if (options.category === '普通话构音基线') {
    return 'mandarin_articulation_baseline'
  }
  return 'functional_speech'
}

export interface MobileCollectionPreflight {
  environmentReady: boolean
  distanceReady: boolean
  understandsConsent: boolean
}

export function isMobileCollectionPreflightReady(
  preflight: MobileCollectionPreflight,
): boolean {
  return preflight.environmentReady && preflight.distanceReady && preflight.understandsConsent
}

export interface MobileCollectionControlState {
  actionLabel: string
  navigationDisabled: boolean
  ready: boolean
}

/** Keeps recording and sentence navigation behind the same visible preflight gate. */
export function getMobileCollectionControlState(
  preflight: MobileCollectionPreflight,
  readyActionLabel: string,
): MobileCollectionControlState {
  const ready = isMobileCollectionPreflightReady(preflight)
  return {
    actionLabel: ready ? readyActionLabel : '先完成上方确认',
    navigationDisabled: !ready,
    ready,
  }
}
