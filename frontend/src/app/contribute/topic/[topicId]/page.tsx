import { notFound } from 'next/navigation'
import {
  isTrainingTopicId,
  type TrainingTopicId,
} from '@/lib/training/training-topic-route'
import { TrainingRecorderPage } from '@/app/contribute/page'

interface TrainingTopicPageProps {
  params: {
    topicId: string
  }
  searchParams?: {
    new?: string
  }
}

export default function TrainingTopicPage({ params, searchParams }: TrainingTopicPageProps) {
  if (params.topicId === 'articulation-baseline') {
    notFound()
  }

  if (!isTrainingTopicId(params.topicId)) {
    notFound()
  }

  return (
    <TrainingRecorderPage
      topicId={params.topicId as TrainingTopicId}
      wantsNewMaterial={params.topicId === 'custom-material' && searchParams?.new === '1'}
    />
  )
}
