import { TrainingRecorderPage } from '@/app/contribute/page'

export default function ArticulationBaselineRecordPage() {
  return (
    <TrainingRecorderPage
      topicId="articulation-baseline"
      returnHrefOverride="/articulation-baseline"
      returnLabelOverride="返回基线说明"
      nextPathOverride="/articulation-baseline/record"
    />
  )
}
