import { cn } from '@/lib/utils'
import { Clock3 } from 'lucide-react'
import { formatCompactDuration } from '@/lib/recording/recording-duration'

interface RecordingDurationSummaryProps {
  todayDurationSeconds: number
  totalDurationSeconds: number
  pendingUploadCount?: number
  isLoading?: boolean
  error?: string | null
  compact?: boolean
}

export function RecordingDurationSummary({
  todayDurationSeconds,
  totalDurationSeconds,
  pendingUploadCount = 0,
  isLoading = false,
  error = null,
  compact = false,
}: RecordingDurationSummaryProps) {
  return (
    <section
      aria-label="录音时长"
      className="rounded-3xl border border-amber-200 bg-amber-50 p-5 sm:p-6"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <Clock3 className="size-5" aria-hidden="true" />
        你的录音时长
      </div>
      <div className={cn('mt-4 grid gap-3', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-[1.2fr_1fr]')}>
        <div className="rounded-2xl bg-white px-5 py-4 ring-1 ring-amber-200">
          <p className="text-sm font-medium text-stone-600">今天已录</p>
          <p className="mt-2 text-balance text-3xl font-semibold text-stone-950 tabular-nums sm:text-4xl">
            {isLoading ? '正在统计…' : error ? '暂未更新' : formatCompactDuration(todayDurationSeconds)}
          </p>
          <p className="mt-2 text-pretty text-xs leading-5 text-stone-500">按本地日期统计云端已确认的录音。</p>
        </div>
        <div className="rounded-2xl bg-white px-5 py-4 ring-1 ring-amber-200">
          <p className="text-sm font-medium text-stone-600">累计已录</p>
          <p className="mt-2 text-balance text-2xl font-semibold text-stone-950 tabular-nums sm:text-3xl">
            {isLoading ? '正在统计…' : error ? '暂未更新' : formatCompactDuration(totalDurationSeconds)}
          </p>
          <p className="mt-2 text-pretty text-xs leading-5 text-stone-500">同一账号各设备共用，不随音频迁移或常规清理减少。</p>
        </div>
      </div>
      {pendingUploadCount > 0 ? (
        <p role="status" className="mt-3 text-pretty text-xs leading-5 text-amber-900">
          本机有 {pendingUploadCount} 条录音待确认上传，暂不计入上述时长。请保持联网，确认完成前不要清理浏览器数据。
        </p>
      ) : null}
      {error ? <p className="mt-3 text-pretty text-xs text-amber-900">{error}</p> : null}
    </section>
  )
}
