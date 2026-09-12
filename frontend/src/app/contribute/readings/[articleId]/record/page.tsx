import { notFound } from 'next/navigation'
import { TrainingRecorderPage } from '@/app/contribute/page'
import { getReadingArticle, getReadingArticleExercises } from '@/lib/corpus/reading-articles'

export default function ReadingArticleRecorderPage({
  params,
  searchParams,
}: {
  params: { articleId: string }
  searchParams?: { round?: string }
}) {
  const article = getReadingArticle(params.articleId)
  if (!article) {
    notFound()
  }

  const readingRoundId = searchParams?.round?.trim() || null

  return (
    <TrainingRecorderPage
      topicId="pronunciation-reading"
      exerciseOverride={getReadingArticleExercises(article)}
      readingArticle={article}
      allowRecordedExercises={Boolean(readingRoundId)}
      readingRoundId={readingRoundId}
      returnHrefOverride={`/contribute/readings/${article.id}`}
      returnLabelOverride="返回文章"
      nextPathOverride={`/contribute/readings/${article.id}/record${readingRoundId ? `?round=${encodeURIComponent(readingRoundId)}` : ''}`}
    />
  )
}
