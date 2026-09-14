'use client'

import Link from 'next/link'
import { ArrowLeft, ArrowRight, AudioLines, ClipboardCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

export default function PracticeGatewayPage() {
  const { isLoading, isAuthenticated } = useAuth({
    redirectToLogin: true,
    nextPath: '/practice',
  })

  if (isLoading) {
    return <main className="flex min-h-dvh items-center justify-center bg-stone-50 text-sm text-stone-600">正在准备练习入口…</main>
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-dvh bg-[#f5f1ea] text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-5xl px-5 py-4 sm:px-8">
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-semibold text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" href="/">
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回首页
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <p className="text-sm font-semibold text-orange-700">练习</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold sm:text-5xl">今天想建立普通话基线，还是录入训练数据？</h1>
        <p className="mt-4 max-w-2xl text-pretty text-base leading-8 text-stone-600">
          构音表现基线和数据录入目的不同、结果不同。选定后，下一页只保留这一个任务。
        </p>

        <section aria-label="练习任务" className="mt-8 grid gap-5 lg:grid-cols-2">
          <Link className="group flex min-h-80 flex-col rounded-3xl bg-stone-950 p-7 text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2" href="/articulation-baseline">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-stone-950">
              <ClipboardCheck className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-7 text-sm font-semibold text-orange-200">50 字普通话构音基线</p>
            <h2 className="mt-2 text-balance text-2xl font-semibold">了解自动文字在哪些字上需要改进</h2>
            <p className="mt-3 text-pretty text-sm leading-7 text-stone-300">逐字完成 50 个单音节，对照录音与参考文字；结果只用于改进识别和收音，不是对你的评分。</p>
            <span className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold">开始基线 <ArrowRight className="size-4" aria-hidden="true" /></span>
          </Link>

          <Link className="group flex min-h-80 flex-col rounded-3xl border border-stone-200 bg-white p-7 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2" href="/contribute">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
              <AudioLines className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-7 text-sm font-semibold text-orange-700">训练与数据录入</p>
            <h2 className="mt-2 text-balance text-2xl font-semibold">练真实会说出口的句子</h2>
            <p className="mt-3 text-pretty text-sm leading-7 text-stone-600">按场景或自定义材料录入，每条都可回听，授权后的样本自动进入训练链路。</p>
            <span className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold text-orange-700">选择录入主题 <ArrowRight className="size-4" aria-hidden="true" /></span>
          </Link>
        </section>
      </main>
    </div>
  )
}
