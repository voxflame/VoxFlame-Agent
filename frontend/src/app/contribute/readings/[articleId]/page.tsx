'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { notFound } from 'next/navigation'
import { ArrowLeft, Check, ChevronRight, Circle } from 'lucide-react'
import { RecordingDurationSummary } from '@/components/recording/RecordingDurationSummary'
import { useAuth } from '@/hooks/useAuth'
import { useRecordingProgress } from '@/hooks/useRecordingProgress'
import { useVoiceUpload } from '@/hooks/useVoiceUpload'
import { getReadingArticle } from '@/lib/corpus/reading-articles'
import { getReadingArticleCycle, getReadingArticleProgress } from '@/lib/corpus/reading-progress'
import { resetReadingArticleProgress } from '@/lib/recording/reading-progress-client'

export default function ReadingArticlePage({ params }: { params: { articleId: string } }) {
  const router = useRouter()
  const [isResetting, setIsResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const article = getReadingArticle(params.articleId)
  const path = `/contribute/readings/${params.articleId}`
  const { userId, isLoading: isAuthLoading, isAuthenticated } = useAuth({
    redirectToLogin: true,
    nextPath: path,
  })
  const { localQueueItems } = useVoiceUpload()
  const progress = useRecordingProgress(userId, isAuthenticated, localQueueItems)

  if (!article) {
    notFound()
  }

  if (isAuthLoading || !isAuthenticated) {
    return <div className="flex min-h-dvh items-center justify-center bg-stone-50 text-sm text-stone-600">正在读取文章进度…</div>
  }

  const cycle = getReadingArticleCycle(
    article,
    progress.recordedReadingSegmentIds,
    progress.recordedReadingRoundKeys,
    progress.readingArticleRoundIds[article.id] ?? null,
  )
  const articleProgress = getReadingArticleProgress(article, cycle.recordedSegmentIds)
  const recordedIds = new Set(cycle.recordedSegmentIds)
  const recorderRoundId = cycle.roundId

  const handleReset = async () => {
    setIsResetting(true)
    setResetError(null)
    try {
      const result = await resetReadingArticleProgress(article.id)
      await progress.refresh()
      router.push(`${path}/record?round=${encodeURIComponent(result.roundId)}`)
    } catch (error) {
      console.error('[reading-article] reset failed:', error)
      setResetError('重置没有保存成功，请稍后再试。以前的录音不会被删除。')
    } finally {
      setIsResetting(false)
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <Link href="/contribute/readings" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-800">
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回材料库
          </Link>
          <p className="mt-1 text-sm font-medium text-amber-800">{article.theme} · {article.difficulty}</p>
          <h1 className="mt-1 text-balance text-3xl font-semibold text-stone-950">{article.title}</h1>
          <p className="mt-2 text-pretty text-sm leading-6 text-stone-600">下方是完整正文，不是文章概况。</p>
          <p className="mt-1 text-pretty text-xs leading-5 text-stone-500">
            作者：{article.author} · 底本：
            <a className="underline underline-offset-2" href={article.source.sourceUrl} target="_blank" rel="noreferrer">
              {article.source.label}
            </a>
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
        <RecordingDurationSummary
          compact
          todayDurationSeconds={progress.todayDurationSeconds}
          totalDurationSeconds={progress.totalDurationSeconds}
          isLoading={progress.isLoading}
          error={progress.error}
        />

        <section aria-labelledby="full-article-heading" className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-amber-800">完整原文</p>
              <h2 id="full-article-heading" className="mt-1 text-balance text-xl font-semibold text-stone-950">
                先通读全文，再逐句录音
              </h2>
            </div>
            <p className="text-sm text-stone-500 tabular-nums">共 {article.segments.length} 句</p>
          </div>
          <p className="mt-5 whitespace-pre-wrap text-pretty text-base leading-8 text-stone-800">
            {article.fullText}
          </p>
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-amber-800">文章进度</p>
              <h2 className="mt-2 text-balance text-2xl font-semibold text-stone-950 tabular-nums">
                {articleProgress.isComplete ? '这篇已经读完' : `已录 ${articleProgress.recordedCount} / ${articleProgress.totalCount} 句`}
              </h2>
              <p className="mt-2 text-pretty text-sm text-stone-600">
                {articleProgress.isComplete ? '系统不会自动重复。想再读一轮时，由你主动开始。' : '录音时只会出现还没录过的句子。'}
              </p>
            </div>
            {articleProgress.isComplete ? (
              <button
                type="button"
                onClick={() => void handleReset()}
                disabled={isResetting}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                {isResetting ? '正在重置…' : '重置本篇进度'}
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            ) : (
              <Link
                href={`${path}/record${recorderRoundId ? `?round=${recorderRoundId}` : ''}`}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-5 py-3 text-sm font-semibold text-white"
              >
                {articleProgress.isStarted ? '继续未录句' : '开始录音'}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </div>
          {articleProgress.isComplete ? (
            <p className="mt-4 text-pretty text-xs leading-5 text-stone-500">
              重置只会开始新一轮待录清单，不会删除以前保存的录音。
            </p>
          ) : null}
          {resetError ? <p role="alert" className="mt-3 text-sm font-medium text-rose-700">{resetError}</p> : null}
        </section>

        <section aria-labelledby="segment-list-heading" className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
          <h2 id="segment-list-heading" className="text-balance text-xl font-semibold text-stone-950">文章句子</h2>
          <p className="mt-1 text-pretty text-sm text-stone-600">绿色表示已经保存或正在本机等待同步。</p>
          <ol className="mt-5 space-y-2">
            {article.segments.map((segment) => {
              const isRecorded = recordedIds.has(segment.id)
              return (
                <li key={segment.id} className={`flex items-start gap-3 rounded-2xl px-4 py-3 ${isRecorded ? 'bg-emerald-50' : 'bg-stone-50'}`}>
                  <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${isRecorded ? 'bg-emerald-700 text-white' : 'text-stone-400'}`}>
                    {isRecorded ? <Check className="size-4" aria-hidden="true" /> : <Circle className="size-5" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-pretty text-base leading-7 text-stone-900">{segment.text}</span>
                    <span className="ml-2 text-xs text-stone-500 tabular-nums">{segment.chineseCharacterCount} 字</span>
                  </span>
                  <span className={`shrink-0 text-xs font-medium ${isRecorded ? 'text-emerald-800' : 'text-stone-500'}`}>
                    {isRecorded ? '已录' : '待录'}
                  </span>
                </li>
              )
            })}
          </ol>
        </section>
      </main>
    </div>
  )
}
