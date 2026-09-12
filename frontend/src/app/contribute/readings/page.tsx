'use client'

import Link from 'next/link'
import { ArrowLeft, CheckCircle2, ChevronRight } from 'lucide-react'
import { RecordingDurationSummary } from '@/components/recording/RecordingDurationSummary'
import { useAuth } from '@/hooks/useAuth'
import { useRecordingProgress } from '@/hooks/useRecordingProgress'
import { useVoiceUpload } from '@/hooks/useVoiceUpload'
import { MANDARIN_READING_ARTICLES } from '@/lib/corpus/reading-articles'
import { rankReadingArticles } from '@/lib/corpus/reading-progress'

export default function ReadingLibraryPage() {
  const { userId, isLoading: isAuthLoading, isAuthenticated } = useAuth({
    redirectToLogin: true,
    nextPath: '/contribute/readings',
  })
  const { localQueueItems } = useVoiceUpload()
  const progress = useRecordingProgress(userId, isAuthenticated, localQueueItems)
  const rankedArticles = rankReadingArticles(
    MANDARIN_READING_ARTICLES,
    progress.recordedReadingSegmentIds,
    progress.recordedReadingRoundKeys,
    progress.readingArticleRoundIds,
  )
  const recommended = rankedArticles[0] ?? null

  if (isAuthLoading || !isAuthenticated) {
    return <div className="flex min-h-dvh items-center justify-center bg-stone-50 text-sm text-stone-600">正在准备朗读材料…</div>
  }

  return (
    <div className="min-h-dvh bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <Link href="/contribute" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-800">
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回录音区
          </Link>
          <h1 className="mt-1 text-balance text-2xl font-semibold text-stone-950">普通话长文朗读</h1>
          <p className="mt-1 max-w-3xl text-pretty text-sm leading-6 text-stone-600">
            只收录能核验完整正文、底本和权利状态的普通话朗读文章。
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
        <RecordingDurationSummary
          todayDurationSeconds={progress.todayDurationSeconds}
          totalDurationSeconds={progress.totalDurationSeconds}
          isLoading={progress.isLoading}
          error={progress.error}
        />

        {recommended ? (
          <Link
            href={`/contribute/readings/${recommended.article.id}`}
            className="grid gap-4 rounded-3xl border border-amber-300 bg-white p-5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6"
          >
            <div>
              <p className="text-sm font-semibold text-amber-800">系统推荐 · 完成度较低</p>
              <h2 className="mt-2 text-balance text-2xl font-semibold text-stone-950">《{recommended.article.title}》</h2>
              <p className="mt-2 text-pretty text-sm leading-6 text-stone-600">
                {recommended.article.author} · {recommended.article.summary}
              </p>
              <p className="mt-3 text-sm font-medium text-stone-700 tabular-nums">
                {recommended.isStarted ? `已录 ${recommended.recordedCount} / ${recommended.totalCount} 句` : `尚未开始 · 共 ${recommended.totalCount} 句`}
              </p>
            </div>
            <span className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-5 py-3 text-sm font-semibold text-white">
              {recommended.isStarted ? '继续这一篇' : '开始这一篇'}
              <ChevronRight className="size-4" aria-hidden="true" />
            </span>
          </Link>
        ) : null}

        {rankedArticles.length === 0 ? (
          <section className="rounded-3xl border border-stone-200 bg-white px-5 py-8 shadow-sm sm:px-7">
            <h2 className="text-balance text-xl font-semibold text-stone-950">暂无通过全文核验的材料</h2>
            <p className="mt-3 max-w-2xl text-pretty text-sm leading-7 text-stone-600">
              原有 60 条只有概况和提纲，已全部移除。完整正文、作者、可核验底本或权利状态缺任一项，都不会出现在这里。
            </p>
            <Link href="/contribute/materials" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-700 px-5 py-3 text-sm font-semibold text-white">
              返回选择其他材料
            </Link>
          </section>
        ) : (
        <section aria-labelledby="reading-list-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="reading-list-heading" className="text-balance text-xl font-semibold text-stone-950">全部材料</h2>
              <p className="mt-1 text-pretty text-sm text-stone-600">已按完成度从低到高排列，不需要手动选择排序。</p>
            </div>
            <p className="text-sm text-stone-500 tabular-nums">共 {rankedArticles.length} 篇</p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rankedArticles.map((item) => (
              <Link
                key={item.article.id}
                href={`/contribute/readings/${item.article.id}`}
                className="flex flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-amber-800">{item.article.theme} · {item.article.difficulty}</p>
                    <h3 className="mt-1 text-balance text-lg font-semibold text-stone-950">{item.article.title}</h3>
                  </div>
                  {item.isComplete ? <CheckCircle2 className="size-5 shrink-0 text-emerald-700" aria-label="已完成" /> : null}
                </div>
                <p className="mt-2 text-pretty text-sm leading-6 text-stone-600">
                  {item.article.author} · {item.article.summary}
                </p>
                <div className="mt-auto pt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-stone-100" aria-hidden="true">
                    <div className="h-full rounded-full bg-amber-600" style={{ width: `${item.completionRatio * 100}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                    <span className="text-stone-600 tabular-nums">已录 {item.recordedCount} / {item.totalCount} 句</span>
                    <span className="font-semibold text-amber-800">{item.isComplete ? '查看全文' : item.isStarted ? '继续阅读' : '阅读全文'} →</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
        )}

        <p className="text-pretty text-xs leading-5 text-stone-500">
          后续材料必须是完整全文，并保留作者、底本链接、权利状态和内容哈希。
        </p>
      </main>
    </div>
  )
}
