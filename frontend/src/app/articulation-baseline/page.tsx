'use client'

import Link from 'next/link'
import { ArrowLeft, ArrowRight, CircleHelp, Mic } from 'lucide-react'

import { useAuth } from '@/hooks/useAuth'

export default function ArticulationBaselinePage() {
  const { isLoading, isAuthenticated } = useAuth({
    redirectToLogin: true,
    nextPath: '/articulation-baseline',
  })

  if (isLoading) {
    return <main className="flex min-h-dvh items-center justify-center bg-stone-50 text-sm text-stone-600">正在准备普通话基线…</main>
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-dvh bg-stone-50 text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-4 sm:px-8">
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-semibold text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500" href="/practice">
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回练习
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
        <p className="text-sm font-semibold text-amber-700">普通话基线</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold sm:text-5xl">一次只读一个字</h1>
        <p className="mt-5 max-w-2xl text-pretty text-base leading-8 text-stone-600">
          完成 50 个单音节，看看自动参考文字在哪些声母、韵母和声调组合上容易出错。这用于改进识别和同设备复测，不是对你的评分，也不是临床诊断。
        </p>

        <section className="mt-8 rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <Mic className="size-6" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-balance text-2xl font-semibold">准备好就开始</h2>
          <p className="mt-3 text-pretty text-sm leading-7 text-stone-600">
            尽量保持环境、设备和距离稳定。录音页只显示当前字、进度和本次结果。
          </p>
          <Link className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-700 px-6 py-3 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 sm:w-auto" href="/articulation-baseline/record">
            开始 50 字基线
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>

        <Link className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-semibold text-stone-600 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500" href="/articulation-baseline/about">
          <CircleHelp className="size-4" aria-hidden="true" />
          了解题面来源与结果边界
        </Link>
      </main>
    </div>
  )
}
