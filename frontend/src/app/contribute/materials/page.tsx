'use client'

import Link from 'next/link'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { RecordingDurationSummary } from '@/components/recording/RecordingDurationSummary'
import { useAuth } from '@/hooks/useAuth'
import { useRecordingProgress } from '@/hooks/useRecordingProgress'
import { useVoiceUpload } from '@/hooks/useVoiceUpload'
import { TRAINING_MATERIAL_AREAS } from '@/lib/training/material-areas'

export default function TrainingMaterialsPage() {
  const { userId, isLoading, isAuthenticated } = useAuth({
    redirectToLogin: true,
    nextPath: '/contribute/materials',
  })
  const { localQueueItems } = useVoiceUpload()
  const progress = useRecordingProgress(userId, isAuthenticated, localQueueItems)

  if (isLoading || !isAuthenticated) {
    return <div className="flex min-h-dvh items-center justify-center bg-stone-50 text-sm text-stone-600">正在准备材料区…</div>
  }

  return (
    <div className="min-h-dvh bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
          <Link href="/contribute" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-800">
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回录音区
          </Link>
          <h1 className="mt-1 text-balance text-2xl font-semibold text-stone-950">选择已有材料</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
        <RecordingDurationSummary
          compact
          todayDurationSeconds={progress.todayDurationSeconds}
          totalDurationSeconds={progress.totalDurationSeconds}
          isLoading={progress.isLoading}
          error={progress.error}
        />

        <section aria-label="已有材料区" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TRAINING_MATERIAL_AREAS.map((area) => (
            <Link
              key={area.id}
              href={area.href}
              className="group flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white px-5 py-4 shadow-sm transition-colors duration-150 hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
            >
              <span className="min-w-0">
                <span className="block text-balance text-base font-semibold text-stone-950">{area.title}</span>
                <span className="mt-1 block text-sm text-stone-500 tabular-nums">{area.count} {area.countUnit}</span>
              </span>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 group-hover:bg-amber-100 group-hover:text-amber-800">
                <ChevronRight className="size-4" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  )
}
